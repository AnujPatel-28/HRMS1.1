import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, Download, Users, BarChart3, Clock, Pencil, Check, X, ClipboardList, MapPin, FileEdit } from "lucide-react";
import type { Attendance, Employee, Shift, EmployeeShift } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useAuditLog } from "../hooks/useAuditLog";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { SelectDropdown } from "../shared/components/SelectDropdown";
import LocationMap from "../shared/LocationMap";
import { calculateDistance, getLocationStatusText, type LocationStatus } from "../utils/geolocation";
import { functions } from "../insforge/client";
import type { SalaryStructure } from "../payroll/hr/SalaryStructures";
import { getWorkingDays, formatCurrency } from "../payroll/hr/payroll-calc";
import { formatLocalDate } from "../utils/date";
import { calculateShiftDuration, calculateLateness, toAttendanceTimestamp, normalizeShiftTimes } from "../utils/attendance";

type ViewMode = "daily" | "employee" | "summary" | "overtime" | "corrections";
type AttendanceStatus = "present" | "absent" | "half_day" | "on_leave";

interface AttendanceWithEmployee extends Attendance {
  is_late?: boolean | null;
  punch_in_lat?: number | string | null;
  punch_in_lng?: number | string | null;
  punch_in_location_accuracy?: number | string | null;
  punch_in_location_status?: LocationStatus | null;
  punch_out_lat?: number | string | null;
  punch_out_lng?: number | string | null;
  punch_out_location_accuracy?: number | string | null;
  punch_out_location_status?: LocationStatus | null;
  employee?: Employee;
}

interface SummaryRow {
  employee: Employee;
  daysPresent: number;
  daysAbsent: number;
  daysOnLeave: number;
  avgWorkHours: number;
  latePunchIns: number;
}

interface OvertimeRow {
  id: string;
  tenant_id: string;
  employee_id: string;
  attendance_id: string | null;
  date: string;
  regular_hours: number;
  overtime_hours: number;
  overtime_rate: number;
  overtime_amount: number | null;
  approved: boolean;
  approved_by: string | null;
  employee?: Employee;
  estimatedAmount: number | null;
}

interface AttendanceCorrectionRow {
  id: string;
  tenant_id: string;
  employee_id: string;
  attendance_date: string;
  requested_punch_in: string | null;
  requested_punch_out: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string | null;
  employee?: Employee;
  attendance?: AttendanceWithEmployee | null;
}

type LateMarkSummary = {
  late_count: number;
  threshold: number;
  excess_late_marks: number;
  deduction_hours: number;
  has_deduction: boolean;
};

const fmt = formatLocalDate;

function fmtTime(ts: string | null) {
  if (!ts) return "-";
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: AttendanceStatus) {
  const map: Record<AttendanceStatus, string> = {
    present: "bg-emerald-100 text-emerald-700",
    absent: "bg-rose-100 text-rose-700",
    half_day: "bg-amber-100 text-amber-700",
    on_leave: "bg-blue-100 text-blue-700",
  };
  const label: Record<AttendanceStatus, string> = {
    present: "Present",
    absent: "Absent",
    half_day: "Half Day",
    on_leave: "On Leave",
  };
  return { cls: map[status] ?? "bg-slate-100 text-slate-600", label: label[status] ?? status };
}

function calDotColor(status: string | null) {
  if (status === "present") return "bg-emerald-500";
  if (status === "absent") return "bg-gray-400";
  if (status === "on_leave") return "bg-blue-500";
  if (status === "half_day") return "bg-amber-400";
  return "bg-white border border-slate-300";
}

function exportCSV(rows: string[][], filename: string) {
  const csv = rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function settingMap(rows: { key: string; value: string }[]) {
  return rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function locationBadge(status: LocationStatus | null | undefined) {
  if (status === "captured") return { cls: "bg-emerald-100 text-emerald-700", label: getLocationStatusText(status) };
  if (status === "denied") return { cls: "bg-amber-100 text-amber-700", label: getLocationStatusText(status) };
  if (status === "outside_fence") return { cls: "bg-rose-100 text-rose-700", label: getLocationStatusText(status) };
  return { cls: "bg-slate-100 text-slate-600", label: getLocationStatusText(status) };
}

function getGrossMonthly(structure: SalaryStructure) {
  const monthlyCtc = structure.ctc_annual / 12;
  const basicMonthly = monthlyCtc * (structure.basic_percent / 100);
  const hraMonthly = basicMonthly * (structure.hra_percent / 100);
  return basicMonthly + hraMonthly + structure.special_allowance + structure.other_allowances;
}

function pickCurrentStructures(structures: SalaryStructure[], effectiveCutoff: string) {
  const byEmployee = new Map<string, SalaryStructure>();
  const sorted = [...structures].sort((a, b) => {
    const dateCompare = b.effective_from.localeCompare(a.effective_from);
    return dateCompare !== 0 ? dateCompare : (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });

  sorted.forEach((structure) => {
    if (structure.effective_from <= effectiveCutoff && !byEmployee.has(structure.employee_id)) {
      byEmployee.set(structure.employee_id, structure);
    }
  });

  return byEmployee;
}



export default function HRAttendance() {
  const [view, setView] = useState<ViewMode>("daily");
  const { success, error: toastError } = useToast();
  const { tenantId, tenant } = useTenant();
  const { employee: hrEmployee } = useEmployee();
  const { logAction } = useAuditLog();

  const [dailyDate, setDailyDate] = useState(fmt(new Date()));
  const [dailyRows, setDailyRows] = useState<AttendanceWithEmployee[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employeeShifts, setEmployeeShifts] = useState<EmployeeShift[]>([]);
  const [selectedShift, setSelectedShift] = useState<string>("all");
  const [dailyLoading, setDailyLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editPunchIn, setEditPunchIn] = useState("");
  const [editPunchOut, setEditPunchOut] = useState("");
  const [editStatus, setEditStatus] = useState<AttendanceStatus>("present");
  const [saving, setSaving] = useState(false);
  const [tenantSettings, setTenantSettings] = useState<Record<string, string>>({});
  const [selectedLocationRow, setSelectedLocationRow] = useState<AttendanceWithEmployee | null>(null);

  const [empViewEmployee, setEmpViewEmployee] = useState<string>("");
  const [empViewYear, setEmpViewYear] = useState(new Date().getFullYear());
  const [empViewMonth, setEmpViewMonth] = useState(new Date().getMonth());
  const [empAttendance, setEmpAttendance] = useState<Attendance[]>([]);
  const [empLoading, setEmpLoading] = useState(false);

  const [summaryYear, setSummaryYear] = useState(new Date().getFullYear());
  const [summaryMonth, setSummaryMonth] = useState(new Date().getMonth());
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [lateMarkMap, setLateMarkMap] = useState<Record<string, LateMarkSummary>>({});
  const [overtimeRows, setOvertimeRows] = useState<OvertimeRow[]>([]);
  const [overtimeLoading, setOvertimeLoading] = useState(false);
  const [overtimeEmployeeFilter, setOvertimeEmployeeFilter] = useState("all");
  const [overtimeStatusFilter, setOvertimeStatusFilter] = useState<"all" | "approved" | "pending">("all");
  const [correctionRows, setCorrectionRows] = useState<AttendanceCorrectionRow[]>([]);
  const [correctionsLoading, setCorrectionsLoading] = useState(false);
  const [correctionStatusFilter, setCorrectionStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [correctionDepartmentFilter, setCorrectionDepartmentFilter] = useState("all");
  const [correctionDateFrom, setCorrectionDateFrom] = useState("");
  const [correctionDateTo, setCorrectionDateTo] = useState("");
  const [rejectCorrection, setRejectCorrection] = useState<AttendanceCorrectionRow | null>(null);
  const [rejectCorrectionReason, setRejectCorrectionReason] = useState("");
  const [correctionActionLoading, setCorrectionActionLoading] = useState(false);

  const overtimeNow = new Date();
  const overtimeMonth = overtimeNow.getMonth();
  const overtimeYear = overtimeNow.getFullYear();
  const overtimeMonthStart = fmt(new Date(overtimeYear, overtimeMonth, 1));
  const overtimeMonthEnd = fmt(new Date(overtimeYear, overtimeMonth + 1, 0));
  const [overtimeDateFrom, setOvertimeDateFrom] = useState(overtimeMonthStart);
  const [overtimeDateTo, setOvertimeDateTo] = useState(overtimeMonthEnd);

  useEffect(() => {
    let active = true;
    db.from("employees")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("full_name")
      .then(({ data }) => {
        if (active && data) setAllEmployees(data as Employee[]);
      });
    return () => { active = false; };
  }, [tenantId]);

  useEffect(() => {
    let active = true;
    db.from("tenant_settings")
      .select("key,value")
      .eq("tenant_id", tenantId)
      .then(({ data }) => {
        if (active) {
          setTenantSettings(settingMap((data ?? []) as { key: string; value: string }[]));
        }
      });
    return () => { active = false; };
  }, [tenantId]);

  const fetchDaily = useCallback(async () => {
    setDailyLoading(true);
    try {
      const [attRes, shiftRes, empShiftRes] = await Promise.all([
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("date", dailyDate),
        db.from("shifts").select("*").eq("tenant_id", tenantId).eq("is_active", true),
        db.from("employee_shifts").select("*").eq("tenant_id", tenantId)
          .lte("effective_from", dailyDate)
          .or(`effective_to.is.null,effective_to.gte.${dailyDate}`),
      ]);

      if (attRes.error) throw attRes.error;
      if (shiftRes.error) throw shiftRes.error;
      if (empShiftRes.error) throw empShiftRes.error;

      setShifts((shiftRes.data ?? []) as Shift[]);
      setEmployeeShifts((empShiftRes.data ?? []) as EmployeeShift[]);

      const att = (attRes.data ?? []) as AttendanceWithEmployee[];
      const merged: AttendanceWithEmployee[] = allEmployees.map((emp) => {
        const rec = att.find((row) => row.employee_id === emp.id);
        if (rec) return { ...rec, employee: emp };
        return {
          id: "",
          tenant_id: tenantId,
          employee_id: emp.id,
          date: dailyDate,
          punch_in: null,
          punch_out: null,
          punch_out_allowed: false,
          punch_in_ip: null,
          punch_out_ip: null,
          work_hours: null,
          status: "absent" as AttendanceStatus,
          session_status: "closed",
          notes: null,
          created_at: "",
          punch_in_lat: null,
          punch_in_lng: null,
          punch_in_location_accuracy: null,
          punch_in_location_status: null,
          punch_out_lat: null,
          punch_out_lng: null,
          punch_out_location_accuracy: null,
          punch_out_location_status: null,
          employee: emp,
        };
      });
      setDailyRows(merged);
    } catch (err) {
      toastError("Failed to fetch daily attendance.");
    } finally {
      setDailyLoading(false);
    }
  }, [dailyDate, allEmployees, tenantId, toastError]);

  useEffect(() => {
    if (view === "daily" && allEmployees.length > 0) void fetchDaily();
  }, [view, fetchDaily, allEmployees]);

  const fetchEmpAttendance = useCallback(async () => {
    if (!empViewEmployee) return;
    setEmpLoading(true);
    try {
      const start = fmt(new Date(empViewYear, empViewMonth, 1));
      const end = fmt(new Date(empViewYear, empViewMonth + 1, 0));
      const { data, error: fetchErr } = await db.from("attendance").select("*")
        .eq("tenant_id", tenantId).eq("employee_id", empViewEmployee).gte("date", start).lte("date", end);
      if (fetchErr) throw fetchErr;
      setEmpAttendance((data ?? []) as Attendance[]);
    } catch (err) {
      toastError("Failed to fetch employee attendance.");
    } finally {
      setEmpLoading(false);
    }
  }, [empViewEmployee, empViewYear, empViewMonth, tenantId, toastError]);

  useEffect(() => {
    if (view === "employee") void fetchEmpAttendance();
  }, [view, fetchEmpAttendance]);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const start = fmt(new Date(summaryYear, summaryMonth, 1));
      const end = fmt(new Date(summaryYear, summaryMonth + 1, 0));
      const { data: attData, error: fetchErr } = await db
        .from("attendance")
        .select("*")
        .eq("tenant_id", tenantId)
        .gte("date", start)
        .lte("date", end);
      if (fetchErr) throw fetchErr;
      const att = (attData ?? []) as Attendance[];
      const rows: SummaryRow[] = allEmployees.map((emp) => {
        const empAtt = att.filter((row) => row.employee_id === emp.id);
        const present = empAtt.filter((row) => row.status === "present" || row.status === "half_day").length;
        const absent = empAtt.filter((row) => row.status === "absent").length;
        const onLeave = empAtt.filter((row) => row.status === "on_leave").length;
        const withHours = empAtt.filter((row) => row.work_hours != null && row.work_hours > 0);
        const avg = withHours.length > 0 ? withHours.reduce((sum, row) => sum + (row.work_hours ?? 0), 0) / withHours.length : 0;
        const late = empAtt.filter((row) => (row as AttendanceWithEmployee).is_late === true).length;
        return { employee: emp, daysPresent: present, daysAbsent: absent, daysOnLeave: onLeave, avgWorkHours: avg, latePunchIns: late };
      });
      setSummaryRows(rows);
    } catch (err) {
      toastError("Failed to fetch summary.");
    } finally {
      setSummaryLoading(false);
    }
  }, [summaryYear, summaryMonth, allEmployees, tenantId, toastError]);

  useEffect(() => {
    if (view === "summary" && allEmployees.length > 0) void fetchSummary();
  }, [view, fetchSummary, allEmployees]);

  useEffect(() => {
    const fetchLateMarkSummaries = async () => {
      if (view !== "summary" || summaryRows.length === 0) return;
      try {
        const results = await Promise.all(summaryRows.map(async (row) => {
          const { data, error: fnError } = await functions.invoke("calculate-late-marks", {
            body: {
              tenant_id: tenantId,
              employee_id: row.employee.id,
              month: summaryMonth + 1,
              year: summaryYear,
            },
          });
          if (fnError) throw fnError;
          return [row.employee.id, data as LateMarkSummary] as const;
        }));
        setLateMarkMap(Object.fromEntries(results));
      } catch (err) {
        console.error("Failed to fetch late mark summaries", err);
        setLateMarkMap({});
      }
    };
    void fetchLateMarkSummaries();
  }, [summaryMonth, summaryRows, summaryYear, tenantId, view]);

  const fetchOvertime = useCallback(async () => {
    setOvertimeLoading(true);
    try {
      const [recordsRes, structuresRes, holidaysRes] = await Promise.all([
        db
          .from("overtime_records")
          .select("*")
          .eq("tenant_id", tenantId)
          .gte("date", overtimeMonthStart)
          .lte("date", overtimeMonthEnd)
          .order("date", { ascending: false }),
        db
          .from("salary_structures")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("effective_from", { ascending: false })
          .order("created_at", { ascending: false }),
        db
          .from("holidays")
          .select("date")
          .eq("tenant_id", tenantId)
          .gte("date", overtimeMonthStart)
          .lte("date", overtimeMonthEnd),
      ]);

      if (recordsRes.error) throw recordsRes.error;
      if (structuresRes.error) throw structuresRes.error;
      if (holidaysRes.error) throw holidaysRes.error;

      const structures = (structuresRes.data ?? []) as SalaryStructure[];
      const structureMap = pickCurrentStructures(structures, overtimeMonthStart);
      const holidayDates = ((holidaysRes.data ?? []) as { date: string }[]).map((holiday) => holiday.date);
      const workingDays = getWorkingDays(overtimeYear, overtimeMonth + 1, holidayDates);
      const rows = ((recordsRes.data ?? []) as OvertimeRow[]).map((record) => {
        const employee = allEmployees.find((item) => item.id === record.employee_id);
        const structure = structureMap.get(record.employee_id);
        const grossMonthly = structure ? getGrossMonthly(structure) : null;
        const estimatedAmount = grossMonthly && record.regular_hours > 0
          ? record.overtime_hours * (grossMonthly / (record.regular_hours * workingDays))
          : null;
        return {
          ...record,
          employee,
          estimatedAmount,
        };
      });

      setOvertimeRows(rows);
    } catch (err) {
      toastError("Failed to fetch overtime records.");
    } finally {
      setOvertimeLoading(false);
    }
  }, [allEmployees, overtimeMonth, overtimeMonthEnd, overtimeMonthStart, overtimeYear, tenantId, toastError]);

  useEffect(() => {
    if (view === "overtime" && allEmployees.length > 0) void fetchOvertime();
  }, [allEmployees, fetchOvertime, view]);

  const fetchCorrections = useCallback(async () => {
    setCorrectionsLoading(true);
    try {
      let correctionsQuery = db
        .from("attendance_corrections")
        .select("*")
        .eq("tenant_id", tenantId);

      if (correctionDateFrom) correctionsQuery = correctionsQuery.gte("attendance_date", correctionDateFrom);
      if (correctionDateTo) correctionsQuery = correctionsQuery.lte("attendance_date", correctionDateTo);

      const { data: correctionsData, error: correctionsError } = await correctionsQuery;
      if (correctionsError) throw correctionsError;

      const corrections = (correctionsData ?? []) as AttendanceCorrectionRow[];
      const employeeIds = Array.from(new Set(corrections.map((row) => row.employee_id)));
      const correctionDates = Array.from(new Set(corrections.map((row) => row.attendance_date)));

      let attendanceRows: AttendanceWithEmployee[] = [];
      if (employeeIds.length > 0 && correctionDates.length > 0) {
        const minDate = correctionDates.reduce((min, date) => date < min ? date : min, correctionDates[0]);
        const maxDate = correctionDates.reduce((max, date) => date > max ? date : max, correctionDates[0]);
        const { data: attendanceData, error: attendanceError } = await db
          .from("attendance")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("employee_id", employeeIds)
          .gte("date", minDate)
          .lte("date", maxDate);
        if (attendanceError) throw attendanceError;
        attendanceRows = (attendanceData ?? []) as AttendanceWithEmployee[];
      }

      const employeeMap = allEmployees.reduce<Record<string, Employee>>((acc, employee) => {
        acc[employee.id] = employee;
        return acc;
      }, {});

      const mergedRows = corrections.map((row) => ({
        ...row,
        employee: employeeMap[row.employee_id],
        attendance: attendanceRows.find((attendanceRow) =>
          attendanceRow.employee_id === row.employee_id && attendanceRow.date === row.attendance_date,
        ) ?? null,
      }));

      mergedRows.sort((a, b) => {
        if (a.status === "pending" && b.status !== "pending") return -1;
        if (a.status !== "pending" && b.status === "pending") return 1;
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      });

      setCorrectionRows(mergedRows);
    } catch (err) {
      toastError("Failed to fetch attendance corrections.");
    } finally {
      setCorrectionsLoading(false);
    }
  }, [allEmployees, correctionDateFrom, correctionDateTo, tenantId, toastError]);

  useEffect(() => {
    if (view === "corrections" && allEmployees.length > 0) void fetchCorrections();
  }, [allEmployees, fetchCorrections, view]);

  async function saveEdit(row: AttendanceWithEmployee) {
    if (tenantSettings.payroll_lock_date && dailyDate <= tenantSettings.payroll_lock_date) {
      toastError("Payroll is locked for this date. Cannot edit attendance.");
      return;
    }
    setSaving(true);
    try {
      let punchIn = null;
      let punchOut = null;
      let workHours = null;

      if (editPunchIn && editPunchOut) {
        const durationResult = calculateShiftDuration(editPunchIn, editPunchOut, tenant?.lunch_break_minutes || 0);
        if (durationResult.error) {
          toastError(durationResult.error);
          setSaving(false);
          return;
        }
        workHours = durationResult.hours;

        const { inDate, outDate } = normalizeShiftTimes(dailyDate, editPunchIn, editPunchOut);
        punchIn = inDate.toISOString();
        punchOut = outDate.toISOString();
      } else {
        punchIn = editPunchIn ? new Date(`${dailyDate}T${editPunchIn}:00`).toISOString() : null;
        punchOut = editPunchOut ? new Date(`${dailyDate}T${editPunchOut}:00`).toISOString() : null;
      }

      const finalIsLate = (editStatus === "half_day" || editStatus === "absent") ? false : row.is_late;

      if (row.id) {
        await db.from("attendance").update({ punch_in: punchIn, punch_out: punchOut, status: editStatus, work_hours: workHours, is_late: finalIsLate }).eq("tenant_id", tenantId).eq("id", row.id);
      } else {
        await db.from("attendance").insert([{
          employee_id: row.employee_id,
          date: dailyDate,
          tenant_id: tenantId,
          punch_in: punchIn,
          punch_out: punchOut,
          status: editStatus,
          work_hours: workHours,
          is_late: finalIsLate,
        }]);
      }
      void logAction("attendance.edited", "attendance", row.id || "new", {
        employee_id: row.employee_id,
        date: dailyDate,
        old_status: row.status,
        new_status: editStatus,
        punch_in: punchIn,
        punch_out: punchOut,
        severity: "WARNING",
      });
      success("Attendance updated.");
      setEditId(null);
    } catch (err) {
      toastError("Failed to update attendance.");
    } finally {
      setSaving(false);
      void fetchDaily();
    }
  }

  function startEdit(row: AttendanceWithEmployee) {
    setEditId(row.employee_id);
    setEditPunchIn(row.punch_in ? new Date(row.punch_in).toTimeString().slice(0, 5) : "");
    setEditPunchOut(row.punch_out ? new Date(row.punch_out).toTimeString().slice(0, 5) : "");
    setEditStatus(row.status as AttendanceStatus);
  }

  const calendarDays = useMemo(() => {
    const firstDay = new Date(empViewYear, empViewMonth, 1).getDay();
    const daysInMonth = new Date(empViewYear, empViewMonth + 1, 0).getDate();
    return { firstDay, daysInMonth };
  }, [empViewYear, empViewMonth]);

  const attByDate = useMemo(() => {
    const map: Record<string, Attendance> = {};
    empAttendance.forEach((row) => { map[row.date] = row; });
    return map;
  }, [empAttendance]);

  const filteredOvertimeRows = useMemo(() => overtimeRows.filter((row) => {
    if (overtimeEmployeeFilter !== "all" && row.employee_id !== overtimeEmployeeFilter) return false;
    if (overtimeStatusFilter === "approved" && !row.approved) return false;
    if (overtimeStatusFilter === "pending" && row.approved) return false;
    if (row.date < overtimeDateFrom || row.date > overtimeDateTo) return false;
    return true;
  }), [overtimeDateFrom, overtimeDateTo, overtimeEmployeeFilter, overtimeRows, overtimeStatusFilter]);

  const overtimeSummary = useMemo(() => {
    const totalHours = overtimeRows.reduce((sum, row) => sum + row.overtime_hours, 0);
    const uniqueEmployees = new Set(overtimeRows.map((row) => row.employee_id)).size;
    const approvedCount = overtimeRows.filter((row) => row.approved).length;
    const pendingCount = overtimeRows.filter((row) => !row.approved).length;
    return { totalHours, uniqueEmployees, approvedCount, pendingCount };
  }, [overtimeRows]);

  const filteredCorrectionRows = useMemo(() => correctionRows.filter((row) => {
    if (correctionStatusFilter !== "all" && row.status !== correctionStatusFilter) return false;
    if (correctionDepartmentFilter !== "all" && (row.employee?.department || "") !== correctionDepartmentFilter) return false;
    if (correctionDateFrom && row.attendance_date < correctionDateFrom) return false;
    if (correctionDateTo && row.attendance_date > correctionDateTo) return false;
    return true;
  }), [correctionDateFrom, correctionDateTo, correctionDepartmentFilter, correctionRows, correctionStatusFilter]);

  async function approveOvertime(recordId: string) {
    const record = overtimeRows.find(r => r.id === recordId);
    if (record && tenantSettings.payroll_lock_date && record.date <= tenantSettings.payroll_lock_date) {
      toastError("Payroll is locked for this date. Cannot approve overtime.");
      return;
    }
    try {
      const { error } = await db
        .from("overtime_records")
        .update({ approved: true, approved_by: hrEmployee?.id ?? null })
        .eq("tenant_id", tenantId)
        .eq("id", recordId);
      if (error) throw error;
      void logAction("overtime.approved", "overtime_records", recordId, {
        record_id: recordId,
        employee_id: record?.employee_id,
        date: record?.date,
        hours: record?.overtime_hours,
        severity: "INFO",
      });
      success("Overtime approved.");
      void fetchOvertime();
    } catch (err) {
      toastError("Failed to approve overtime.");
    }
  }

  async function rejectOvertime(recordId: string) {
    const record = overtimeRows.find(r => r.id === recordId);
    if (record && tenantSettings.payroll_lock_date && record.date <= tenantSettings.payroll_lock_date) {
      toastError("Payroll is locked for this date. Cannot reject overtime.");
      return;
    }
    try {
      const { error } = await db
        .from("overtime_records")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", recordId);
      if (error) throw error;
      success("Overtime record rejected and removed.");
      void fetchOvertime();
    } catch (err) {
      toastError("Failed to reject overtime.");
    }
  }

  async function approveAllOvertime() {
    const pendingRows = overtimeRows.filter((row) => !row.approved);
    if (pendingRows.length === 0) {
      success("No pending overtime records to approve.");
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let lockedCount = 0;

    for (const row of pendingRows) {
      if (tenantSettings.payroll_lock_date && row.date <= tenantSettings.payroll_lock_date) {
        lockedCount++;
        continue;
      }
      try {
        const { error } = await db
          .from("overtime_records")
          .update({ approved: true, approved_by: hrEmployee?.id ?? null })
          .eq("tenant_id", tenantId)
          .eq("id", row.id);
        if (error) throw error;
        successCount++;
      } catch (err) {
        failCount++;
      }
    }

    void logAction("overtime.bulk_approved", "overtime_records", "bulk", {
      count: successCount,
      succeeded: successCount,
      failed: failCount,
      severity: "WARNING",
    });

    if (successCount > 0) {
      success(`Approved ${successCount} overtime records.`);
    }
    if (failCount > 0 || lockedCount > 0) {
      toastError(`Failed: ${failCount}, Locked: ${lockedCount}`);
    }
    void fetchOvertime();
  }

  async function resolveShiftStartTime(employeeId: string, attendanceDate: string) {
    const { data: assignment, error: assignmentError } = await db
      .from("employee_shifts")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employeeId)
      .lte("effective_from", attendanceDate)
      .or(`effective_to.is.null,effective_to.gte.${attendanceDate}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (assignmentError) throw assignmentError;

    if (assignment) {
      const { data: shiftData, error: shiftError } = await db
        .from("shifts")
        .select("start_time")
        .eq("tenant_id", tenantId)
        .eq("id", (assignment as { shift_id: string }).shift_id)
        .maybeSingle();
      if (shiftError) throw shiftError;
      if ((shiftData as { start_time?: string } | null)?.start_time) {
        return (shiftData as { start_time: string }).start_time.slice(0, 5);
      }
    }

    const { data: defaultShift, error: defaultShiftError } = await db
      .from("shifts")
      .select("start_time")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (defaultShiftError) throw defaultShiftError;

    return (defaultShift as { start_time?: string } | null)?.start_time?.slice(0, 5) ?? tenant?.punch_in_start ?? "09:00";
  }

  async function approveCorrection(correction: AttendanceCorrectionRow) {
    if (!hrEmployee?.id || !tenant) return;

    if (tenantSettings.payroll_lock_date && correction.attendance_date <= tenantSettings.payroll_lock_date) {
      toastError("Payroll is locked for this date. Cannot approve correction.");
      return;
    }

    // ── Guard: reject empty corrections (both sides null) ──────────────────────
    // Prevents HR from accidentally approving a no-op correction that would
    // recalculate work_hours to null and overwrite a valid attendance record.
    if (!correction.requested_punch_in && !correction.requested_punch_out) {
      toastError("Cannot approve a correction with no requested punch times.");
      return;
    }

    setCorrectionActionLoading(true);
    try {
      const reviewedAt = new Date().toISOString();
      const graceMinutes = parseInt(tenantSettings["late_mark_grace_minutes"] || "0", 10);
      const shiftStart = await resolveShiftStartTime(correction.employee_id, correction.attendance_date);

      // ── Fetch existing attendance FIRST so we can do a partial update ────────
      // This must happen before we compute effective times so we can fall back
      // to the existing timestamps for whichever side was not requested.
      const { data: existingAttendance, error: attendanceLookupError } = await db
        .from("attendance")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", correction.employee_id)
        .eq("date", correction.attendance_date)
        .maybeSingle();
      if (attendanceLookupError) throw attendanceLookupError;

      // Extract existing HH:MM strings from the DB timestamps (if any).
      // These are used as fallbacks when the correction only covers one side.
      const existingPunchInHHMM = existingAttendance?.punch_in
        ? new Date(existingAttendance.punch_in).toTimeString().slice(0, 5)
        : null;
      const existingPunchOutHHMM = existingAttendance?.punch_out
        ? new Date(existingAttendance.punch_out).toTimeString().slice(0, 5)
        : null;

      // ── Merge: requested value takes priority; fall back to existing DB value.
      // Use nullish coalescing (??) so an explicit empty string from the request
      // still falls through to the existing value (not treating "" as a value).
      // This ensures corrections are always PARTIAL updates, never full rewrites.
      const effectivePunchIn = correction.requested_punch_in ?? existingPunchInHHMM;
      const effectivePunchOut = correction.requested_punch_out ?? existingPunchOutHHMM;

      // ── Calculate duration using MERGED effective times ──────────────────────
      // Both sides must be present to calculate work_hours; if only one side
      // is available (e.g. employee only correcting punch-in), hours stay null.
      const durationResult = calculateShiftDuration(
        effectivePunchIn,
        effectivePunchOut,
        tenant.lunch_break_minutes,
      );
      if (durationResult.error) {
        throw new Error(durationResult.error);
      }
      const workHours = durationResult.hours;

      // ── Lateness uses merged punch-in (correction may only fix punch-out) ────
      const isLate = (existingAttendance?.status === "half_day" || existingAttendance?.status === "absent")
        ? false
        : effectivePunchIn
          ? calculateLateness(correction.attendance_date, shiftStart, effectivePunchIn, graceMinutes)
          : (existingAttendance?.is_late ?? false);

      // ── Build ISO timestamps from merged effective times ──────────────────────
      // normalizeShiftTimes handles night shifts (punch-out before punch-in means +1 day).
      let punchInIso: string | null = existingAttendance?.punch_in ?? null;
      let punchOutIso: string | null = existingAttendance?.punch_out ?? null;

      if (effectivePunchIn && effectivePunchOut) {
        // Both sides known — can normalize for night shifts correctly.
        const { inDate, outDate } = normalizeShiftTimes(
          correction.attendance_date,
          effectivePunchIn,
          effectivePunchOut,
        );
        punchInIso = inDate.toISOString();
        punchOutIso = outDate.toISOString();
      } else if (effectivePunchIn) {
        // Only punch-in is known — update only that side.
        punchInIso = toAttendanceTimestamp(correction.attendance_date, effectivePunchIn);
        // punchOutIso stays as the existing DB value (already set above).
      } else if (effectivePunchOut) {
        // Only punch-out is known — update only that side.
        // punchInIso stays as the existing DB value (already set above).
        punchOutIso = toAttendanceTimestamp(correction.attendance_date, effectivePunchOut);
      }

      // ── Mark the correction as approved ─────────────────────────────────────
      const { error: correctionError } = await db
        .from("attendance_corrections")
        .update({
          status: "approved",
          reviewed_by: hrEmployee.id,
          reviewed_at: reviewedAt,
          rejection_reason: null,
        })
        .eq("tenant_id", tenantId)
        .eq("id", correction.id);
      if (correctionError) throw correctionError;

      // ── Build the attendance payload ──────────────────────────────────────────
      // Only include fields that changed to keep the update minimal and safe.
      const attendancePayload: Record<string, unknown> = {
        punch_in: punchInIso,
        punch_out: punchOutIso,
        is_late: isLate,
      };
      // Only overwrite work_hours if we could compute it from merged values.
      // If only one side was provided and no existing counterpart, leave hours as-is.
      if (workHours != null) {
        attendancePayload.work_hours = parseFloat(workHours.toFixed(2));
      }

      if (existingAttendance?.id) {
        // ── Partial update: preserves session_status, status, location data, etc.
        const { error: attendanceUpdateError } = await db
          .from("attendance")
          .update(attendancePayload)
          .eq("tenant_id", tenantId)
          .eq("id", existingAttendance.id);
        if (attendanceUpdateError) throw attendanceUpdateError;
      } else {
        // ── Insert new record when no attendance row exists yet for this date ───
        const { error: attendanceInsertError } = await db
          .from("attendance")
          .insert([{
            tenant_id: tenantId,
            employee_id: correction.employee_id,
            date: correction.attendance_date,
            punch_in: punchInIso,
            punch_out: punchOutIso,
            work_hours: workHours != null ? parseFloat(workHours.toFixed(2)) : null,
            is_late: isLate,
            status: "present",
            punch_out_allowed: true,
          }]);
        if (attendanceInsertError) throw attendanceInsertError;
      }

      // ── Audit log: capture before/after snapshot ─────────────────────────────
      // Uses existing audit_logs table (tenant-scoped, RLS-safe) via useAuditLog.
      // UTC timestamps are intentional here — audit logs must always be in UTC.
      void logAction(
        "attendance_correction.approved",
        "attendance_corrections",
        correction.id,
        {
          employee_id: correction.employee_id,
          attendance_date: correction.attendance_date,
          approver_id: hrEmployee.id,
          approved_at: reviewedAt,
          before: {
            punch_in: existingAttendance?.punch_in ?? null,
            punch_out: existingAttendance?.punch_out ?? null,
            work_hours: existingAttendance?.work_hours ?? null,
            is_late: existingAttendance?.is_late ?? null,
          },
          after: {
            punch_in: punchInIso,
            punch_out: punchOutIso,
            work_hours: workHours != null ? parseFloat(workHours.toFixed(2)) : null,
            is_late: isLate,
          },
          requested: {
            punch_in: correction.requested_punch_in,
            punch_out: correction.requested_punch_out,
          },
          reason: correction.reason,
          severity: "CRITICAL",
        },
      );

      const { error: notificationError } = await db.from("notifications").insert([{
        tenant_id: tenantId,
        employee_id: correction.employee_id,
        title: "Attendance Correction Approved",
        body: `Your attendance correction for ${fmt(new Date(correction.attendance_date))} has been approved and updated.`,
        type: "general",
        reference_id: correction.id,
      }]);
      if (notificationError) throw notificationError;

      success("Attendance correction approved.");
      void fetchCorrections();
    } catch (err) {
      console.error(err);
      toastError(err instanceof Error ? err.message : "Failed to approve attendance correction.");
    } finally {
      setCorrectionActionLoading(false);
    }
  }

  async function rejectCorrectionRequest() {
    if (!rejectCorrection || !hrEmployee?.id) return;
    if (tenantSettings.payroll_lock_date && rejectCorrection.attendance_date <= tenantSettings.payroll_lock_date) {
      toastError("Payroll is locked for this date. Cannot reject correction.");
      return;
    }
    if (!rejectCorrectionReason.trim()) {
      toastError("Reason for rejection is required.");
      return;
    }

    setCorrectionActionLoading(true);
    try {
      const { error: rejectError } = await db
        .from("attendance_corrections")
        .update({
          status: "rejected",
          reviewed_by: hrEmployee.id,
          reviewed_at: new Date().toISOString(),
          rejection_reason: rejectCorrectionReason.trim(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", rejectCorrection.id);
      if (rejectError) throw rejectError;

      const { error: notificationError } = await db.from("notifications").insert([{
        tenant_id: tenantId,
        employee_id: rejectCorrection.employee_id,
        title: "Attendance Correction Rejected",
        body: `Your correction request for ${fmt(new Date(rejectCorrection.attendance_date))} was rejected. Reason: ${rejectCorrectionReason.trim()}`,
        type: "general",
        reference_id: rejectCorrection.id,
      }]);
      if (notificationError) throw notificationError;

      void logAction("correction.rejected", "attendance_corrections", rejectCorrection.id, {
        correction_id: rejectCorrection.id,
        employee_id: rejectCorrection.employee_id,
        rejection_reason: rejectCorrectionReason.trim(),
        severity: "WARNING",
      });
      success("Attendance correction rejected.");
      setRejectCorrection(null);
      setRejectCorrectionReason("");
      void fetchCorrections();
    } catch (err) {
      console.error(err);
      toastError("Failed to reject attendance correction.");
    } finally {
      setCorrectionActionLoading(false);
    }
  }

  const filteredDailyRows = useMemo(() => {
    if (selectedShift === "all") return dailyRows;
    const assignedIds = new Set(
      employeeShifts
        .filter((es) => es.shift_id === selectedShift)
        .map((es) => es.employee_id)
    );
    const isDefault = shifts.find(s => s.id === selectedShift)?.is_default;
    const hasAnyAssignment = new Set(employeeShifts.map(es => es.employee_id));

    return dailyRows.filter(row => {
      if (assignedIds.has(row.employee_id)) return true;
      if (isDefault && !hasAnyAssignment.has(row.employee_id)) return true;
      return false;
    });
  }, [selectedShift, dailyRows, employeeShifts, shifts]);

  function exportDaily() {
    const header = ["Employee", "Punch In", "Punch Out", "Work Hours", "Status"];
    const rows = filteredDailyRows.map((row) => [
      row.employee?.full_name ?? row.employee_id,
      fmtTime(row.punch_in),
      fmtTime(row.punch_out),
      row.work_hours != null ? row.work_hours.toFixed(2) : "-",
      row.status,
    ]);
    exportCSV([header, ...rows], `attendance_${dailyDate}.csv`);
  }

  function exportSummary() {
    const header = ["Employee", "Present", "Absent", "On Leave", "Avg Hours", "Late Marks"];
    const rows = summaryRows.map((row) => [
      row.employee.full_name,
      String(row.daysPresent),
      String(row.daysAbsent),
      String(row.daysOnLeave),
      row.avgWorkHours.toFixed(2),
      String(row.latePunchIns),
    ]);
    exportCSV([header, ...rows], `summary_${summaryYear}_${summaryMonth + 1}.csv`);
  }

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const officeLat = toNumber(tenantSettings["office_lat"]);
  const officeLng = toNumber(tenantSettings["office_lng"]);

  return (
    <section className="space-y-8 md:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-6 md:gap-3">
        <div>
          <h2 className="text-2xl md:text-xl font-bold md:font-semibold text-slate-900">Attendance Management</h2>
          <p className="text-base md:text-sm text-slate-500 mt-2 md:mt-0">Track, edit and export employee attendance records.</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full md:w-auto pb-2 md:pb-0">
          {[
            { key: "daily", icon: Calendar, label: "Daily" },
            { key: "employee", icon: Users, label: "Employee" },
            { key: "summary", icon: BarChart3, label: "Summary" },
            { key: "overtime", icon: Clock, label: "Overtime" },
            { key: "corrections", icon: FileEdit, label: "Corrections" },
          ].map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setView(key as ViewMode)}
              className={`flex-1 md:flex-none justify-center whitespace-nowrap inline-flex items-center gap-1.5 md:gap-2 rounded-xl px-3 py-2 md:px-3 md:py-2 text-[13px] md:text-sm font-medium transition-all active:scale-[0.98] ${view === key ? "bg-brand-600 text-white shadow-sm ring-1 ring-brand-600" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "daily" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 md:p-5 shadow-sm">
          <div className="mb-5 md:mb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-4 md:gap-3">
            <div className="flex flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
              <div className="flex flex-col gap-1.5 w-full sm:w-auto">
                <label className="text-xs sm:text-sm font-semibold sm:font-medium text-slate-500 sm:text-slate-700 uppercase sm:normal-case tracking-wider sm:tracking-normal">Date</label>
                <input
                  type="date"
                  value={dailyDate}
                  onChange={(event) => setDailyDate(event.target.value)}
                  className="w-full sm:w-auto rounded-lg border border-slate-300 px-3 py-2.5 sm:py-1.5 text-sm outline-none ring-brand-600 focus:ring"
                />
              </div>
              <div className="flex flex-col gap-1.5 w-full sm:w-auto">
                <label className="text-xs sm:text-sm font-semibold sm:font-medium text-slate-500 sm:text-slate-700 uppercase sm:normal-case tracking-wider sm:tracking-normal">Shift</label>
                <SelectDropdown
                  value={selectedShift}
                  onChange={setSelectedShift}
                  options={[
                    { value: "all", label: "All Shifts" },
                    ...shifts.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  containerClassName="w-full sm:w-auto min-w-[140px]"
                  triggerClassName="w-full sm:w-auto rounded-lg border border-slate-300 bg-white px-3 py-2.5 sm:py-1.5 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>
            <button
              onClick={exportDaily}
              className="w-full sm:w-auto justify-center inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition shadow-sm"
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>

          {!dailyLoading && filteredDailyRows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10">
              <EmptyState icon={Users} title="No employees found" description="There are no employees to display attendance for." minimal />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm block md:table">
                <thead className="hidden md:table-header-group bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Punch In</th>
                    <th className="px-4 py-3">Punch Out</th>
                    <th className="px-4 py-3">Work Hours</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white block md:table-row-group">
                  {dailyLoading ? (
                    [...Array(5)].map((_, index) => (
                      <tr key={index} className="block md:table-row border-b border-slate-100 md:border-0 mb-3 md:mb-0 p-4 md:p-0">
                        <td className="md:hidden block">
                          <div className="flex justify-between mb-3"><Skeleton className="h-5 w-32" /><Skeleton className="h-5 w-16" /></div>
                          <Skeleton className="h-16 w-full rounded-lg mb-3" />
                          <div className="flex justify-between"><Skeleton className="h-8 w-8 rounded-lg" /><Skeleton className="h-8 w-20 rounded-lg" /></div>
                        </td>
                        {[...Array(7)].map((__, cellIndex) => (
                          <td key={cellIndex} className="hidden md:table-cell px-4 py-3"><Skeleton className="h-4 w-full max-w-[100px]" /></td>
                        ))}
                      </tr>
                    ))
                  ) : (
                  filteredDailyRows.map((row) => {
                    const isEditing = editId === row.employee_id;
                    const { cls, label } = statusBadge(row.status as AttendanceStatus);
                    const punchInLat = toNumber(row.punch_in_lat);
                    return (
                      <tr key={row.employee_id} className="hover:bg-slate-50 block md:table-row border border-slate-200 md:border-0 md:border-b rounded-xl md:rounded-none mb-3 md:mb-0 p-3 md:p-0 bg-white shadow-sm md:shadow-none relative">
                        
                        {/* MOBILE COMPACT TILE VIEW */}
                        <td className="md:hidden block">
                          <div className="flex items-center justify-between mb-3">
                            <span className="font-bold text-slate-900">{row.employee?.full_name ?? "-"}</span>
                            {isEditing ? (
                              <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as AttendanceStatus)} className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold uppercase outline-none focus:ring-2 focus:ring-brand-500 bg-white">
                                <option value="present">Present</option>
                                <option value="absent">Absent</option>
                                <option value="half_day">Half Day</option>
                                <option value="on_leave">On Leave</option>
                              </select>
                            ) : (
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${row.status === 'present' ? 'bg-emerald-500' : row.status === 'absent' ? 'bg-rose-500' : row.status === 'half_day' ? 'bg-amber-500' : 'bg-blue-500'}`}></span>
                                {label}
                              </span>
                            )}
                          </div>
                          
                          <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-lg text-center mb-3 border border-slate-100">
                            <div className="flex flex-col justify-center">
                              <span className="text-[10px] font-bold uppercase text-slate-400 mb-1 tracking-wider">In</span>
                              {isEditing ? (
                                <input type="time" value={editPunchIn} onChange={(event) => setEditPunchIn(event.target.value)} className="w-full rounded-md border border-slate-300 px-1 py-1 text-xs text-center outline-none focus:ring-2 focus:ring-brand-500 bg-white" />
                              ) : (
                                <div className="flex flex-col items-center">
                                  <span className="font-semibold text-slate-800 text-sm">{fmtTime(row.punch_in)}</span>
                                  {row.is_late ? <span className="mt-0.5 rounded px-1 py-0.5 bg-rose-100 text-[9px] font-bold text-rose-700 uppercase">Late</span> : null}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col justify-center border-x border-slate-200">
                              <span className="text-[10px] font-bold uppercase text-slate-400 mb-1 tracking-wider">Out</span>
                              {isEditing ? (
                                <input type="time" value={editPunchOut} onChange={(event) => setEditPunchOut(event.target.value)} className="w-full rounded-md border border-slate-300 px-1 py-1 text-xs text-center outline-none focus:ring-2 focus:ring-brand-500 bg-white" />
                              ) : (
                                <span className="font-semibold text-slate-800 text-sm">{fmtTime(row.punch_out)}</span>
                              )}
                            </div>
                            <div className="flex flex-col justify-center">
                              <span className="text-[10px] font-bold uppercase text-slate-400 mb-1 tracking-wider">Hours</span>
                              <span className="font-semibold text-slate-800 text-sm">{row.work_hours != null ? `${row.work_hours.toFixed(2)}h` : "-"}</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between">
                            <div>
                              {punchInLat != null ? (
                                <button
                                  type="button"
                                  onClick={() => setSelectedLocationRow(row)}
                                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-all hover:scale-105 active:scale-95 ${row.punch_in_location_status === "outside_fence"
                                      ? "border-rose-200 bg-rose-50 text-rose-600 shadow-sm"
                                      : "border-emerald-200 bg-emerald-50 text-emerald-600 shadow-sm"
                                    }`}
                                >
                                  <MapPin className="h-4 w-4" />
                                </button>
                              ) : <span className="text-xs text-slate-400 font-medium">No Location</span>}
                            </div>
                            <div>
                              {isEditing ? (
                                <div className="flex gap-2">
                                  <button onClick={() => setEditId(null)} className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all border border-slate-200">
                                    <X className="h-4 w-4" />
                                  </button>
                                  <button onClick={() => saveEdit(row)} disabled={saving} className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-sm">
                                    <Check className="h-4 w-4" />
                                  </button>
                                </div>
                              ) : (
                                <button onClick={() => startEdit(row)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 transition-colors shadow-sm">
                                  <Pencil className="h-3 w-3" /> Edit
                                </button>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* DESKTOP STANDARD TDS */}
                        <td className="hidden md:table-cell px-4 py-3">
                          <span className="font-bold text-slate-900">{row.employee?.full_name ?? "-"}</span>
                        </td>
                        <td className="hidden md:table-cell px-4 py-3 text-slate-700">
                          {isEditing
                            ? <input type="time" value={editPunchIn} onChange={(event) => setEditPunchIn(event.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-500" />
                            : (
                              <div className="inline-flex items-center gap-2">
                                <span className="font-medium">{fmtTime(row.punch_in)}</span>
                                {row.is_late ? <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 uppercase tracking-wide">Late</span> : null}
                              </div>
                            )}
                        </td>
                        <td className="hidden md:table-cell px-4 py-3 text-slate-700">
                          {isEditing
                            ? <input type="time" value={editPunchOut} onChange={(event) => setEditPunchOut(event.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-500" />
                            : <span className="font-medium">{fmtTime(row.punch_out)}</span>}
                        </td>
                        <td className="hidden md:table-cell px-4 py-3 text-slate-700">
                          <span className="font-medium text-slate-800">{row.work_hours != null ? `${row.work_hours.toFixed(2)}h` : "-"}</span>
                        </td>
                        <td className="hidden md:table-cell px-4 py-3">
                          {isEditing ? (
                            <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as AttendanceStatus)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-500">
                              <option value="present">Present</option>
                              <option value="absent">Absent</option>
                              <option value="half_day">Half Day</option>
                              <option value="on_leave">On Leave</option>
                            </select>
                          ) : (
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${row.status === 'present' ? 'bg-emerald-500' : row.status === 'absent' ? 'bg-rose-500' : row.status === 'half_day' ? 'bg-amber-500' : 'bg-blue-500'}`}></span>
                              {label}
                            </span>
                          )}
                        </td>
                        <td className="hidden md:table-cell px-4 py-3">
                          {punchInLat != null ? (
                            <button
                              type="button"
                              onClick={() => setSelectedLocationRow(row)}
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border transition-all hover:scale-105 active:scale-95 ${row.punch_in_location_status === "outside_fence"
                                  ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 shadow-[0_2px_8px_-2px_rgba(225,29,72,0.2)]"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 shadow-[0_2px_8px_-2px_rgba(16,185,129,0.2)]"
                                }`}
                              title="View location details"
                            >
                              <MapPin className="h-4 w-4" />
                            </button>
                          ) : "-"}
                        </td>
                        <td className="hidden md:table-cell px-4 py-3 text-right">
                          {isEditing ? (
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => saveEdit(row)} disabled={saving} className="justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-all active:scale-95 flex items-center gap-1.5 shadow-sm hover:shadow-md hover:shadow-emerald-600/20">
                                <Check className="h-4 w-4" /> Save
                              </button>
                              <button onClick={() => setEditId(null)} className="justify-center rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-all active:scale-95 flex items-center gap-1.5 border border-slate-200 hover:border-slate-300">
                                <X className="h-4 w-4" /> Cancel
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => startEdit(row)} className="justify-center inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-600 hover:bg-brand-50 transition-colors active:scale-95">
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>
      ) : null}

      {view === "employee" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 md:p-5 shadow-sm">
          <div className="mb-6 md:mb-5 flex flex-col sm:flex-row sm:items-center gap-6 md:gap-3">
            <SelectDropdown
              value={empViewEmployee}
              onChange={setEmpViewEmployee}
              options={[
                { value: "", label: "Select Employee" },
                ...allEmployees.map((employee) => ({ value: employee.id, label: employee.full_name }))
              ]}
              containerClassName="w-full sm:w-auto sm:min-w-[200px]"
              triggerClassName="w-full sm:w-auto rounded-lg border border-slate-300 bg-white px-3 py-2.5 sm:py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              searchable
            />
            <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
              <button onClick={() => { const date = new Date(empViewYear, empViewMonth - 1); setEmpViewYear(date.getFullYear()); setEmpViewMonth(date.getMonth()); }} className="rounded-lg border border-slate-200 p-2 sm:p-1.5 hover:bg-slate-100 transition flex items-center justify-center"><ChevronLeft className="h-5 w-5 sm:h-4 sm:w-4" /></button>
              <span className="min-w-[130px] text-center text-sm font-semibold text-slate-700">{monthNames[empViewMonth]} {empViewYear}</span>
              <button onClick={() => { const date = new Date(empViewYear, empViewMonth + 1); setEmpViewYear(date.getFullYear()); setEmpViewMonth(date.getMonth()); }} className="rounded-lg border border-slate-200 p-2 sm:p-1.5 hover:bg-slate-100 transition flex items-center justify-center"><ChevronRight className="h-5 w-5 sm:h-4 sm:w-4" /></button>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-3 text-xs">
            {[
              { color: "bg-emerald-500", label: "Present / Task Approved" },
              { color: "bg-rose-500", label: "Task Incomplete" },
              { color: "bg-blue-500", label: "On Leave" },
              { color: "bg-gray-400", label: "Absent" },
              { color: "bg-white border border-slate-300", label: "Holiday / Weekend" },
            ].map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1.5 text-slate-600">
                <span className={`h-3 w-3 rounded-full ${color}`} />
                {label}
              </span>
            ))}
          </div>

          {!empViewEmployee ? (
            <div className="py-10"><EmptyState icon={Users} title="Select an employee" description="Choose an employee to view their attendance calendar." /></div>
          ) : empLoading ? (
            <div className="flex flex-col gap-2 py-10">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                  <div key={day} className="py-2 text-center text-xs font-semibold text-slate-500">{day}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {Array.from({ length: calendarDays.firstDay }).map((_, index) => <div key={`empty-${index}`} className="h-14 border-b border-r border-slate-100" />)}
                {Array.from({ length: calendarDays.daysInMonth }).map((_, index) => {
                  const day = index + 1;
                  const dateStr = `${empViewYear}-${String(empViewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const record = attByDate[dateStr];
                  const isFuture = new Date(dateStr) > new Date();
                  const dotColor = isFuture ? "bg-slate-50 border border-slate-100" : record ? calDotColor(record.status) : "bg-white border border-slate-200";
                  const isWeekend = new Date(dateStr).getDay() === 0 || new Date(dateStr).getDay() === 6;
                  return (
                    <div key={day} className={`flex h-14 flex-col items-center justify-center gap-1 border-b border-r border-slate-100 ${isWeekend ? "bg-slate-50" : ""}`}>
                      <span className="text-xs text-slate-500">{day}</span>
                      {isFuture ? (
                        <span className="text-xs font-semibold text-slate-300">—</span>
                      ) : (
                        <span className={`h-3 w-3 rounded-full ${isWeekend && !record ? "bg-slate-200" : dotColor}`} title={record?.status ?? (isWeekend ? "weekend" : "no record")} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {view === "summary" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button onClick={() => { const date = new Date(summaryYear, summaryMonth - 1); setSummaryYear(date.getFullYear()); setSummaryMonth(date.getMonth()); }} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[130px] text-center text-sm font-semibold text-slate-700">{monthNames[summaryMonth]} {summaryYear}</span>
              <button onClick={() => { const date = new Date(summaryYear, summaryMonth + 1); setSummaryYear(date.getFullYear()); setSummaryMonth(date.getMonth()); }} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <button onClick={exportSummary} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>

          {!summaryLoading && summaryRows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10">
              <EmptyState icon={ClipboardList} title="No summary data" description="No attendance records available for the selected period." minimal />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm block md:table">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 hidden md:table-header-group">
                  <tr>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3 text-center">Days Present</th>
                    <th className="px-4 py-3 text-center">Days Absent</th>
                    <th className="px-4 py-3 text-center">Days On Leave</th>
                    <th className="px-4 py-3 text-center">Avg Work Hours</th>
                    <th className="px-4 py-3 text-center">Late Marks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white block md:table-row-group">
                  {summaryLoading ? (
                    [...Array(5)].map((_, index) => (
                      <tr key={index} className="block md:table-row border-b border-slate-100 md:border-0 mb-3 md:mb-0 p-4 md:p-0">
                        <td className="md:hidden block">
                          <Skeleton className="h-5 w-32 mb-4" />
                          <div className="grid grid-cols-2 gap-3 mb-3">
                             <Skeleton className="h-16 w-full rounded-lg" />
                             <Skeleton className="h-16 w-full rounded-lg" />
                             <Skeleton className="h-16 w-full rounded-lg" />
                             <Skeleton className="h-16 w-full rounded-lg" />
                          </div>
                          <Skeleton className="h-10 w-full rounded-lg" />
                        </td>
                        {[...Array(6)].map((__, cellIndex) => (
                          <td key={cellIndex} className="hidden md:table-cell px-4 py-3"><Skeleton className="h-4 w-full max-w-[80px]" /></td>
                        ))}
                      </tr>
                    ))
                  ) : (
                  summaryRows.map((row) => {
                    const lateSummary = lateMarkMap[row.employee.id];
                    const lateCount = lateSummary?.late_count ?? row.latePunchIns;
                    const threshold = lateSummary?.threshold ?? 0;
                    const deductionHours = lateSummary?.deduction_hours ?? 0;
                    return (
                      <tr key={row.employee.id} className="hover:bg-slate-50 block md:table-row border border-slate-200 md:border-0 md:border-b rounded-2xl md:rounded-none mb-4 md:mb-0 p-5 md:p-0 bg-white shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] md:shadow-none relative">
                        {/* MOBILE VIEW */}
                        <td className="block md:hidden border-b border-slate-100 pb-4 mb-4">
                          <div className="font-bold text-slate-900 text-base">{row.employee.full_name}</div>
                        </td>
                        <td className="block md:hidden">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-emerald-50 rounded-xl p-3 text-center border border-emerald-100/50">
                              <div className="text-[10px] uppercase text-emerald-600 font-bold tracking-wider mb-1">Present</div>
                              <div className="text-xl font-black text-emerald-700">{row.daysPresent}</div>
                            </div>
                            <div className="bg-rose-50 rounded-xl p-3 text-center border border-rose-100/50">
                              <div className="text-[10px] uppercase text-rose-600 font-bold tracking-wider mb-1">Absent</div>
                              <div className="text-xl font-black text-rose-700">{row.daysAbsent}</div>
                            </div>
                            <div className="bg-blue-50 rounded-xl p-3 text-center border border-blue-100/50">
                              <div className="text-[10px] uppercase text-blue-600 font-bold tracking-wider mb-1">Leave</div>
                              <div className="text-xl font-black text-blue-700">{row.daysOnLeave}</div>
                            </div>
                            <div className="bg-amber-50 rounded-xl p-3 text-center border border-amber-100/50">
                              <div className="text-[10px] uppercase text-amber-600 font-bold tracking-wider mb-1">Late</div>
                              <div className="text-xl font-black text-amber-700">{lateCount}</div>
                            </div>
                          </div>
                          <div className="mt-4 flex items-center justify-between bg-slate-50 rounded-xl p-3.5 border border-slate-100">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Avg Work Hours</span>
                            <span className="font-bold text-slate-800 inline-flex items-center gap-1.5"><Clock className="w-4 h-4 text-slate-400"/> {row.avgWorkHours.toFixed(1)}h</span>
                          </div>
                        </td>

                        {/* DESKTOP VIEW */}
                        <td className="hidden md:table-cell px-4 py-3 font-medium text-slate-900">{row.employee.full_name}</td>
                        <td className="hidden md:table-cell px-4 py-3 text-center">
                          <span className={`inline-flex items-center justify-center min-w-[2rem] rounded-full px-2 py-0.5 text-xs font-bold ${row.daysPresent > 0 ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/50' : 'text-slate-400'}`}>
                            {row.daysPresent}
                          </span>
                        </td>
                        <td className="hidden md:table-cell px-4 py-3 text-center">
                          <span className={`inline-flex items-center justify-center min-w-[2rem] rounded-full px-2 py-0.5 text-xs font-bold ${row.daysAbsent > 0 ? 'bg-rose-50 text-rose-600 border border-rose-200/50' : 'text-slate-400'}`}>
                            {row.daysAbsent}
                          </span>
                        </td>
                        <td className="hidden md:table-cell px-4 py-3 text-center">
                          <span className={`inline-flex items-center justify-center min-w-[2rem] rounded-full px-2 py-0.5 text-xs font-bold ${row.daysOnLeave > 0 ? 'bg-blue-50 text-blue-600 border border-blue-200/50' : 'text-slate-400'}`}>
                            {row.daysOnLeave}
                          </span>
                        </td>
                        <td className="hidden md:table-cell px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 font-semibold justify-center ${row.avgWorkHours > 0 ? 'text-slate-700' : 'text-slate-400'}`}>
                            <Clock className={`h-3.5 w-3.5 ${row.avgWorkHours > 0 ? 'text-slate-400' : 'text-slate-300'}`} />
                            {row.avgWorkHours.toFixed(1)}h
                          </span>
                        </td>
                        <td className="hidden md:table-cell px-4 py-3 text-center">
                          <span
                            title={`${lateCount} late arrivals this month. Threshold: ${threshold}. Deduction: ${deductionHours} hours.`}
                            className={`inline-flex items-center justify-center min-w-[2rem] rounded-full px-2 py-0.5 text-xs font-bold ${lateCount >= threshold && threshold > 0 ? "bg-rose-50 text-rose-600 border border-rose-200/50" : lateCount > 0 ? "bg-amber-50 text-amber-600 border border-amber-200/50" : "text-slate-400"}`}
                          >
                            {lateCount}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {view === "overtime" ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-purple-200 bg-purple-50 p-5 shadow-sm">
            <p className="text-sm font-semibold text-purple-800">Total overtime this month</p>
            <div className="mt-2 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-2">
              <span className="text-2xl font-bold text-slate-900">{overtimeSummary.totalHours.toFixed(2)} hours</span>
              <span className="text-sm font-medium text-slate-500">across {overtimeSummary.uniqueEmployees} employee{overtimeSummary.uniqueEmployees === 1 ? "" : "s"}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-slate-600 flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500"></span>{overtimeSummary.approvedCount} approved</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500"></span>{overtimeSummary.pendingCount} pending</span>
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Overtime Records</h3>
                <p className="text-sm font-medium text-slate-500">{monthNames[overtimeMonth]} {overtimeYear}</p>
              </div>
              <button
                type="button"
                onClick={() => void approveAllOvertime()}
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-emerald-700 shadow-sm hover:shadow active:scale-[0.98]"
              >
                <Check className="h-4 w-4" />
                Approve all
              </button>
            </div>

            <div className="mb-6 flex flex-col lg:grid lg:grid-cols-4 gap-3">
              <SelectDropdown
                value={overtimeEmployeeFilter}
                onChange={setOvertimeEmployeeFilter}
                options={[
                  { value: "all", label: "All employees" },
                  ...allEmployees.map((employee) => ({ value: employee.id, label: employee.full_name }))
                ]}
                containerClassName="w-full lg:col-span-1"
                triggerClassName="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-all hover:bg-slate-100 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20"
                searchable
              />
              <div className="grid grid-cols-2 gap-3 lg:col-span-2">
                <input
                  type="date"
                  value={overtimeDateFrom}
                  onChange={(event) => setOvertimeDateFrom(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition-all focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20"
                />
                <input
                  type="date"
                  value={overtimeDateTo}
                  onChange={(event) => setOvertimeDateTo(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition-all focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <SelectDropdown
                value={overtimeStatusFilter}
                onChange={(val) => setOvertimeStatusFilter(val as "all" | "approved" | "pending")}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "approved", label: "Approved" },
                  { value: "pending", label: "Pending" }
                ]}
                containerClassName="w-full lg:col-span-1"
                triggerClassName="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-all hover:bg-slate-100 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            {!overtimeLoading && filteredOvertimeRows.length === 0 ? (
              <div className="rounded-xl bg-slate-50/50 py-12 px-4 border-2 border-dashed border-slate-200">
                <EmptyState icon={Clock} title="No overtime records" description="No overtime records match the selected filters for this month." minimal />
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full md:min-w-[1100px] divide-y divide-slate-200 text-sm block md:table">
                  <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 hidden md:table-header-group">
                    <tr>
                      {["Employee", "Date", "Regular hours", "Overtime hours", "Rate", "Est. amount", "Approved", "Actions"].map((heading) => (
                        <th key={heading} className="px-4 py-3">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white block md:table-row-group">
                    {overtimeLoading ? (
                      [...Array(5)].map((_, index) => (
                        <tr key={index} className="block md:table-row border-b border-slate-100 md:border-0 mb-3 md:mb-0 p-4 md:p-0">
                          <td className="md:hidden block">
                            <Skeleton className="h-5 w-40 mb-3" />
                            <div className="grid grid-cols-2 gap-3 mb-3">
                               <Skeleton className="h-12 w-full rounded-lg" />
                               <Skeleton className="h-12 w-full rounded-lg" />
                            </div>
                            <div className="flex gap-2">
                               <Skeleton className="h-8 w-8 rounded-full" />
                               <Skeleton className="h-8 w-8 rounded-full" />
                            </div>
                          </td>
                          {[...Array(8)].map((__, cellIndex) => (
                            <td key={cellIndex} className="hidden md:table-cell px-4 py-3"><Skeleton className="h-4 w-full max-w-[120px]" /></td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      filteredOvertimeRows.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50 block md:table-row border border-slate-200 md:border-0 md:border-b rounded-2xl md:rounded-none mb-4 md:mb-0 p-5 md:p-0 bg-white shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] md:shadow-none relative">
                          
                          {/* MOBILE VIEW */}
                          <td className="block md:hidden border-b border-slate-100 pb-4 mb-4">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <div className="font-bold text-slate-900 text-base">{row.employee?.full_name ?? row.employee_id}</div>
                                <div className="text-xs text-slate-500 mt-0.5">{new Date(row.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
                              </div>
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${row.approved ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${row.approved ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                                {row.approved ? "Approved" : "Pending"}
                              </span>
                            </div>
                          </td>
                          <td className="block md:hidden">
                            <div className="grid grid-cols-2 gap-3 mb-4">
                              <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                                <div className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-1">Regular</div>
                                <div className="text-lg font-black text-slate-700">{row.regular_hours.toFixed(2)}h</div>
                              </div>
                              <div className="bg-purple-50 rounded-xl p-3 text-center border border-purple-100">
                                <div className="text-[10px] uppercase text-purple-600 font-bold tracking-wider mb-1">Overtime</div>
                                <div className="text-lg font-black text-purple-700">{row.overtime_hours.toFixed(2)}h</div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3 border border-slate-100 mb-4">
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Rate</span>
                                <span className="text-sm font-semibold text-slate-700">{row.overtime_rate.toFixed(2)}x</span>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Est. Amount</span>
                                <span className="text-sm font-bold text-slate-800">
                                  {row.overtime_amount == null ? (row.estimatedAmount != null ? formatCurrency(row.estimatedAmount) : "—") : formatCurrency(row.overtime_amount)}
                                </span>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void approveOvertime(row.id)}
                                className="flex-1 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-100 text-emerald-700 transition font-semibold hover:bg-emerald-200"
                              >
                                <Check className="h-4 w-4" /> Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => void rejectOvertime(row.id)}
                                className="flex-1 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-100 text-rose-700 transition font-semibold hover:bg-rose-200"
                              >
                                <X className="h-4 w-4" /> Reject
                              </button>
                            </div>
                          </td>

                          {/* DESKTOP VIEW */}
                          <td className="hidden md:table-cell px-4 py-3 font-medium text-slate-900">{row.employee?.full_name ?? row.employee_id}</td>
                          <td className="hidden md:table-cell px-4 py-3 text-slate-700">{new Date(row.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                          <td className="hidden md:table-cell px-4 py-3 text-slate-700">{row.regular_hours.toFixed(2)}h</td>
                          <td className="hidden md:table-cell px-4 py-3 font-semibold text-purple-700">{row.overtime_hours.toFixed(2)}h</td>
                          <td className="hidden md:table-cell px-4 py-3 text-slate-700">{row.overtime_rate.toFixed(2)}x</td>
                          <td className="hidden md:table-cell px-4 py-3 text-slate-700">
                            {row.overtime_amount == null ? (
                              <div>
                                <span>—</span>
                                {row.estimatedAmount != null ? (
                                  <p className="text-xs text-slate-500">Preview {formatCurrency(row.estimatedAmount)}</p>
                                ) : null}
                              </div>
                            ) : formatCurrency(row.overtime_amount)}
                          </td>
                          <td className="hidden md:table-cell px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${row.approved ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${row.approved ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                              {row.approved ? "Approved" : "Pending"}
                            </span>
                          </td>
                          <td className="hidden md:table-cell px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void approveOvertime(row.id)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 transition hover:bg-emerald-200"
                                title="Approve overtime"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void rejectOvertime(row.id)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-100 text-rose-700 transition hover:bg-rose-200"
                                title="Reject overtime"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {view === "corrections" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Attendance Corrections</h3>
              <p className="text-sm text-slate-500">Pending requests are shown first for faster review.</p>
            </div>
          </div>

          <div className="mb-6 flex flex-col lg:grid lg:grid-cols-4 gap-3">
            <SelectDropdown
              value={correctionStatusFilter}
              onChange={(val) => setCorrectionStatusFilter(val as "all" | "pending" | "approved" | "rejected")}
              options={[
                { value: "all", label: "All statuses" },
                { value: "pending", label: "Pending" },
                { value: "approved", label: "Approved" },
                { value: "rejected", label: "Rejected" }
              ]}
              containerClassName="w-full lg:col-span-1"
              triggerClassName="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-all hover:bg-slate-100 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20"
            />
            <div className="grid grid-cols-2 gap-3 lg:col-span-2">
              <input
                type="date"
                value={correctionDateFrom}
                onChange={(event) => setCorrectionDateFrom(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition-all focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20"
              />
              <input
                type="date"
                value={correctionDateTo}
                onChange={(event) => setCorrectionDateTo(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition-all focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <SelectDropdown
              value={correctionDepartmentFilter}
              onChange={setCorrectionDepartmentFilter}
              options={[
                { value: "all", label: "All departments" },
                ...Array.from(new Set(allEmployees.map((employee) => employee.department).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)).map((department) => ({ value: department, label: department }))
              ]}
              containerClassName="w-full lg:col-span-1"
              triggerClassName="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm capitalize text-slate-700 outline-none transition-all hover:bg-slate-100 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          {!correctionsLoading && filteredCorrectionRows.length === 0 ? (
            <div className="rounded-xl bg-slate-50/50 py-12 px-4 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center">
              <EmptyState icon={FileEdit} title="No correction requests" description="No attendance corrections match the selected filters." minimal />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full md:min-w-[1400px] divide-y divide-slate-200 text-sm block md:table">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 hidden md:table-header-group">
                  <tr>
                    {["Employee", "Date", "Current punch-in", "Current punch-out", "Requested punch-in", "Requested punch-out", "Reason", "Submitted", "Status", "Actions"].map((heading) => (
                      <th key={heading} className="px-4 py-3">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white block md:table-row-group">
                  {correctionsLoading ? (
                    [...Array(5)].map((_, index) => (
                      <tr key={index} className="block md:table-row border-b border-slate-100 md:border-0 mb-3 md:mb-0 p-4 md:p-0">
                        <td className="md:hidden block">
                          <Skeleton className="h-5 w-40 mb-3" />
                          <Skeleton className="h-24 w-full mb-3" />
                          <Skeleton className="h-10 w-full" />
                        </td>
                        {[...Array(10)].map((__, cellIndex) => (
                          <td key={cellIndex} className="hidden md:table-cell px-4 py-3"><Skeleton className="h-4 w-full max-w-[120px]" /></td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    filteredCorrectionRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 block md:table-row border border-slate-200 md:border-0 md:border-b rounded-2xl md:rounded-none mb-4 md:mb-0 p-5 md:p-0 bg-white shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] md:shadow-none relative">
                      
                      {/* MOBILE VIEW */}
                      <td className="block md:hidden border-b border-slate-100 pb-4 mb-4">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <p className="font-bold text-slate-900 text-base">{row.employee?.full_name ?? row.employee_id}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs capitalize text-slate-500">{row.employee?.department ?? "—"}</span>
                              <span className="text-slate-300">•</span>
                              <span className="text-xs text-slate-500">{fmt(new Date(row.attendance_date))}</span>
                            </div>
                          </div>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${row.status === "approved" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : row.status === "rejected" ? "bg-rose-50 text-rose-700 border border-rose-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${row.status === 'approved' ? 'bg-emerald-500' : row.status === 'rejected' ? 'bg-rose-500' : 'bg-amber-500'}`}></span>
                            {row.status}
                          </span>
                        </div>
                      </td>
                      <td className="block md:hidden">
                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 mb-4 space-y-3">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Current Punch In</span>
                              <span className="text-sm font-semibold text-slate-600 line-through">{fmtTime(row.attendance?.punch_in ?? null)}</span>
                              <span className="block text-[10px] font-bold text-emerald-500 uppercase tracking-wider mt-2 mb-1">Req. Punch In</span>
                              <span className="text-sm font-bold text-slate-900">{row.requested_punch_in ?? "Missing"}</span>
                            </div>
                            <div>
                              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Current Punch Out</span>
                              <span className="text-sm font-semibold text-slate-600 line-through">{fmtTime(row.attendance?.punch_out ?? null)}</span>
                              <span className="block text-[10px] font-bold text-emerald-500 uppercase tracking-wider mt-2 mb-1">Req. Punch Out</span>
                              <span className="text-sm font-bold text-slate-900">{row.requested_punch_out ?? "Missing"}</span>
                            </div>
                          </div>
                          {row.reason && (
                            <div className="pt-3 border-t border-slate-200/60">
                              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Reason</span>
                              <p className="text-sm text-slate-700 italic">&quot;{row.reason}&quot;</p>
                            </div>
                          )}
                        </div>
                        
                        {row.status === "pending" ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void approveCorrection(row)}
                              disabled={correctionActionLoading}
                              className="flex-1 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-100 text-emerald-700 transition font-semibold hover:bg-emerald-200 disabled:opacity-60"
                            >
                              <Check className="h-4 w-4" /> Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => { setRejectCorrection(row); setRejectCorrectionReason(""); }}
                              disabled={correctionActionLoading}
                              className="flex-1 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-100 text-rose-700 transition font-semibold hover:bg-rose-200 disabled:opacity-60"
                            >
                              <X className="h-4 w-4" /> Reject
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-10 rounded-xl bg-slate-50 border border-slate-100 text-sm font-medium text-slate-500">
                            Reviewed
                          </div>
                        )}
                      </td>

                      {/* DESKTOP VIEW */}
                      <td className="hidden md:table-cell px-4 py-3">
                        <p className="font-medium text-slate-900">{row.employee?.full_name ?? row.employee_id}</p>
                        <p className="text-xs capitalize text-slate-500">{row.employee?.department ?? "—"}</p>
                      </td>
                      <td className="hidden md:table-cell px-4 py-3 text-slate-700">{fmt(new Date(row.attendance_date))}</td>
                      <td className="hidden md:table-cell px-4 py-3 text-slate-700">{fmtTime(row.attendance?.punch_in ?? null)}</td>
                      <td className="hidden md:table-cell px-4 py-3 text-slate-700">{fmtTime(row.attendance?.punch_out ?? null)}</td>
                      <td className="hidden md:table-cell px-4 py-3 text-slate-700">{row.requested_punch_in ?? "Missing"}</td>
                      <td className="hidden md:table-cell px-4 py-3 text-slate-700">{row.requested_punch_out ?? "Missing"}</td>
                      <td className="hidden md:table-cell max-w-xs px-4 py-3 text-slate-700">{row.reason}</td>
                      <td className="hidden md:table-cell px-4 py-3 text-slate-700">{row.created_at ? new Date(row.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td className="hidden md:table-cell px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${row.status === "approved" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                            row.status === "rejected" ? "bg-rose-50 text-rose-700 border border-rose-200" :
                              "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${row.status === 'approved' ? 'bg-emerald-500' : row.status === 'rejected' ? 'bg-rose-500' : 'bg-amber-500'}`}></span>
                          {row.status}
                        </span>
                        {row.status === "rejected" && row.rejection_reason ? (
                          <p className="mt-1 text-xs text-rose-600">{row.rejection_reason}</p>
                        ) : null}
                      </td>
                      <td className="hidden md:table-cell px-4 py-3">
                        {row.status === "pending" ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void approveCorrection(row)}
                              disabled={correctionActionLoading}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 transition hover:bg-emerald-200 disabled:opacity-60"
                              title="Approve correction"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => { setRejectCorrection(row); setRejectCorrectionReason(""); }}
                              disabled={correctionActionLoading}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-100 text-rose-700 transition hover:bg-rose-200 disabled:opacity-60"
                              title="Reject correction"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Reviewed</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>
      ) : null}

      {selectedLocationRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => setSelectedLocationRow(null)}>
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{selectedLocationRow.employee?.full_name ?? "Employee location"}</h3>
                <p className="text-sm text-slate-500">Attendance location details</p>
              </div>
              <button type="button" onClick={() => setSelectedLocationRow(null)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[80vh] space-y-5 overflow-y-auto px-5 py-5">
              {(() => {
                const punchInLat = toNumber(selectedLocationRow.punch_in_lat);
                const punchInLng = toNumber(selectedLocationRow.punch_in_lng);
                const punchOutLat = toNumber(selectedLocationRow.punch_out_lat);
                const punchOutLng = toNumber(selectedLocationRow.punch_out_lng);
                const punchInAccuracy = toNumber(selectedLocationRow.punch_in_location_accuracy);
                const punchOutAccuracy = toNumber(selectedLocationRow.punch_out_location_accuracy);
                const punchInDistance = punchInLat != null && punchInLng != null && officeLat != null && officeLng != null
                  ? Math.round(calculateDistance(punchInLat, punchInLng, officeLat, officeLng))
                  : null;
                const punchOutDistance = punchOutLat != null && punchOutLng != null && officeLat != null && officeLng != null
                  ? Math.round(calculateDistance(punchOutLat, punchOutLng, officeLat, officeLng))
                  : null;
                const punchInBadge = locationBadge(selectedLocationRow.punch_in_location_status);
                const punchOutBadge = locationBadge(selectedLocationRow.punch_out_location_status);

                return (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Punch In</p>
                        <p className="mt-1 text-base font-semibold text-slate-900">{fmtTime(selectedLocationRow.punch_in)}</p>
                        <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${punchInBadge.cls}`}>{punchInBadge.label}</span>
                        {punchInDistance != null ? <p className="mt-3 text-sm text-slate-600">Distance from office: {punchInDistance}m</p> : null}
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Punch Out</p>
                        <p className="mt-1 text-base font-semibold text-slate-900">{fmtTime(selectedLocationRow.punch_out)}</p>
                        <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${punchOutBadge.cls}`}>{punchOutBadge.label}</span>
                        {punchOutDistance != null ? <p className="mt-3 text-sm text-slate-600">Distance from office: {punchOutDistance}m</p> : null}
                      </div>
                    </div>

                    {punchInLat != null && punchInLng != null ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-slate-900">Punch-in map</h4>
                          {punchInAccuracy != null ? <p className="text-xs text-slate-500">Accuracy: {Math.round(punchInAccuracy)}m</p> : null}
                        </div>
                        <LocationMap
                          lat={punchInLat}
                          lng={punchInLng}
                          label={`${selectedLocationRow.employee?.full_name ?? "Employee"} punch-in`}
                          accuracy={punchInAccuracy}
                        />
                      </div>
                    ) : null}

                    {punchOutLat != null && punchOutLng != null ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-slate-900">Punch-out map</h4>
                          {punchOutAccuracy != null ? <p className="text-xs text-slate-500">Accuracy: {Math.round(punchOutAccuracy)}m</p> : null}
                        </div>
                        <LocationMap
                          lat={punchOutLat}
                          lng={punchOutLng}
                          label={`${selectedLocationRow.employee?.full_name ?? "Employee"} punch-out`}
                          accuracy={punchOutAccuracy}
                        />
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      ) : null}

      {rejectCorrection ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => { if (!correctionActionLoading) setRejectCorrection(null); }}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Reject Attendance Correction</h3>
              <p className="mt-1 text-sm text-slate-500">{rejectCorrection.employee?.full_name ?? "Employee"} • {fmt(new Date(rejectCorrection.attendance_date))}</p>
            </div>
            <div className="space-y-3 px-5 py-5">
              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Reason for rejection</span>
                <textarea
                  value={rejectCorrectionReason}
                  onChange={(event) => setRejectCorrectionReason(event.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setRejectCorrection(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void rejectCorrectionRequest()}
                disabled={correctionActionLoading}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                {correctionActionLoading ? "Rejecting..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
