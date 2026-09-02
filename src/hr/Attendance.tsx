import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, Download, Users, BarChart3, Clock, Pencil, Check, X, ClipboardList, MapPin, FileEdit, Camera, ListTree } from "lucide-react";
import type { Attendance, Employee, Shift, EmployeeShift, AttendanceSelfie } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db, storage } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useAuditLog } from "../hooks/useAuditLog";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import PunchTrailTray from "./components/PunchTrailTray";
import { EmptyState } from "../shared/EmptyState";
import { SelectDropdown } from "../shared/components/SelectDropdown";
import LocationMap from "../shared/LocationMap";
import { calculateDistance, getLocationStatusText, type LocationStatus } from "../utils/geolocation";
import { functions } from "../insforge/client";
import type { SalaryStructure } from "../payroll/hr/SalaryStructures";
import { getWorkingDays, formatCurrency } from "../payroll/hr/payroll-calc";
import { formatLocalDate } from "../utils/date";
import { useDepartmentLabel, useUnitNames } from "../contexts/OrgUnitsContext";

type ViewMode = "daily" | "employee" | "summary" | "overtime" | "corrections";
type AttendanceStatus =
  | "present" | "absent" | "half_day" | "on_leave"
  | "weekly_off" | "holiday" | "work_from_home"
  /** Not a stored status. Marks a synthetic row for an employee with NO attendance record
   *  on this date. The register must never assert an absence it cannot know about. */
  | "no_record";

interface AttendanceWithEmployee extends Omit<Attendance, "status"> {
  /** A stored status, or the display-only "no_record" sentinel for a synthetic row. */
  status: AttendanceStatus;
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
    weekly_off: "bg-slate-100 text-slate-600",
    holiday: "bg-violet-100 text-violet-700",
    work_from_home: "bg-teal-100 text-teal-700",
    no_record: "bg-slate-50 text-slate-400",
  };
  const label: Record<AttendanceStatus, string> = {
    present: "Present",
    absent: "Absent",
    half_day: "Half Day",
    on_leave: "On Leave",
    weekly_off: "Weekly Off",
    holiday: "Holiday",
    work_from_home: "Work From Home",
    no_record: "No record",
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
  const deptLabel = useDepartmentLabel();
  const unitNames = useUnitNames();

  const [dailyDate, setDailyDate] = useState(fmt(new Date()));
  const [dailyRows, setDailyRows] = useState<AttendanceWithEmployee[]>([]);
  const [dailySelfies, setDailySelfies] = useState<AttendanceSelfie[]>([]);
  const [selectedVerificationRow, setSelectedVerificationRow] = useState<AttendanceWithEmployee | null>(null);
  const [previewSelfieUrl, setPreviewSelfieUrl] = useState<string | null>(null);
  const [activeMapTab, setActiveMapTab] = useState<"punch_in" | "punch_out">("punch_in");

  useEffect(() => {
    if (selectedVerificationRow) {
      if (selectedVerificationRow.punch_in_lat != null) {
        setActiveMapTab("punch_in");
      } else if (selectedVerificationRow.punch_out_lat != null) {
        setActiveMapTab("punch_out");
      }
    }
  }, [selectedVerificationRow]);

  // Quick Action "Allow Remote Work" Modal States
  const [quickExceptionModalOpen, setQuickExceptionModalOpen] = useState(false);
  const [quickEmployeeId, setQuickEmployeeId] = useState("");
  const [quickStartDate, setQuickStartDate] = useState(fmt(new Date()));
  const [quickEndDate, setQuickEndDate] = useState(fmt(new Date()));
  const [quickType, setQuickType] = useState<"work_from_home" | "client_visit" | "business_travel" | "field_work" | "other">("work_from_home");
  const [quickReason, setQuickReason] = useState("");
  const [submittingException, setSubmittingException] = useState(false);

  const checkExceptionOverlap = async (employeeId: string, start: string, end: string): Promise<boolean> => {
    const { data: overlaps, error } = await db
      .from("attendance_location_exceptions")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employeeId)
      .eq("status", "approved")
      .lte("start_date", end)
      .gte("end_date", start);
    
    if (error) {
      console.error("Overlap check failed", error);
      return false;
    }
    return (overlaps ?? []).length > 0;
  };

  const saveQuickException = async () => {
    if (!quickEmployeeId || !quickReason.trim()) {
      toastError("Please fill out all fields.");
      return;
    }
    if (quickEndDate < quickStartDate) {
      toastError("End date cannot be before start date.");
      return;
    }
    
    setSubmittingException(true);
    try {
      const hasOverlap = await checkExceptionOverlap(quickEmployeeId, quickStartDate, quickEndDate);
      if (hasOverlap) {
        toastError("An approved remote exception already exists for this employee within the selected date range.");
        setSubmittingException(false);
        return;
      }
      
      const { error: insErr } = await db.rpc("hr_create_remote_exception", {
        p_tenant_id: tenantId,
        p_employee_id: quickEmployeeId,
        p_exception_type: quickType,
        p_start_date: quickStartDate,
        p_end_date: quickEndDate,
        p_reason: quickReason.trim(),
      });
        
      if (insErr) throw insErr;
      
      void logAction("attendance.remote_exception_created", "attendance_location_exceptions", null, {
        employee_id: quickEmployeeId,
        start_date: quickStartDate,
        end_date: quickEndDate,
        type: quickType,
      });
      
      success("Remote exception created and approved successfully.");
      setQuickExceptionModalOpen(false);
      setQuickEmployeeId("");
      setQuickReason("");
    } catch (err) {
      console.error(err);
      toastError("Failed to create remote exception.");
    } finally {
      setSubmittingException(false);
    }
  };

  function verificationBadge(status: string | null | undefined) {
    if (!status) return null;
    const map: Record<string, { cls: string; label: string }> = {
      office_verified: { cls: "border border-emerald-200 bg-emerald-50 text-emerald-700", label: "✓ Office Verified" },
      remote_approved: { cls: "border border-blue-200 bg-blue-50 text-blue-700", label: "🏠 Remote Approved" },
      outside_geofence: { cls: "border border-rose-200 bg-rose-50 text-rose-700", label: "⚠ Outside Geofence" },
      gps_low_confidence: { cls: "border border-amber-200 bg-amber-50 text-amber-700", label: "⚠ Low GPS Confidence" },
      gps_denied: { cls: "border border-slate-200 bg-slate-50 text-slate-700", label: "⚠ GPS Denied" },
      gps_unavailable: { cls: "border border-slate-200 bg-slate-50 text-slate-700", label: "⚠ GPS Unavailable" },
      manual_override: { cls: "border border-indigo-200 bg-indigo-50 text-indigo-700", label: "✏️ Manual Override" },
      selfie_missing: { cls: "border border-amber-200 bg-amber-50 text-amber-700", label: "📷 Selfie Missing" },
    };
    return map[status] ?? null;
  }

  function SelfieThumbnail({ storagePath }: { storagePath: string }) {
    const [url, setUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      let active = true;
      const fetchSelfie = async () => {
        setLoading(true);
        try {
          const { data, error } = await storage.from("attendance-selfies").download(storagePath);
          if (error) throw error;
          if (data && active) {
            const blobUrl = URL.createObjectURL(data);
            setUrl(blobUrl);
          }
        } catch (err) {
          console.error("Failed to load selfie", err);
        } finally {
          if (active) setLoading(false);
        }
      };
      void fetchSelfie();
      return () => {
        active = false;
        if (url) URL.revokeObjectURL(url);
      };
    }, [storagePath]);

    if (loading) return <div className="h-8 w-8 rounded-lg bg-slate-100 animate-pulse border border-slate-200" />;
    if (!url) return <div className="h-8 w-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] text-slate-400">📷</div>;

    return (
      <div className="relative group h-8 w-8 rounded-lg overflow-hidden border border-slate-200 shadow-sm shrink-0">
        <img src={url} alt="Selfie" className="h-full w-full object-cover cursor-pointer" onClick={() => setPreviewSelfieUrl(url)} />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <span className="text-[8px] text-white font-bold">VIEW</span>
        </div>
      </div>
    );
  }

  function SelfieImage({ storagePath, className = "h-24 w-24 rounded-xl" }: { storagePath: string; className?: string }) {
    const [url, setUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      let active = true;
      const fetchSelfie = async () => {
        setLoading(true);
        try {
          const { data, error } = await storage.from("attendance-selfies").download(storagePath);
          if (error) throw error;
          if (data && active) {
            const blobUrl = URL.createObjectURL(data);
            setUrl(blobUrl);
          }
        } catch (err) {
          console.error("Failed to load selfie", err);
        } finally {
          if (active) setLoading(false);
        }
      };
      void fetchSelfie();
      return () => {
        active = false;
        if (url) URL.revokeObjectURL(url);
      };
    }, [storagePath]);

    if (loading) return <div className={`${className} bg-slate-100 animate-pulse border border-slate-200`} />;
    if (!url) return <div className={`${className} bg-slate-100 border border-slate-200 flex items-center justify-center text-xs text-slate-400`}>📷 Failed to load</div>;

    return (
      <img
        src={url}
        alt="Selfie"
        data-selfie-path={storagePath}
        className={`${className} object-cover cursor-pointer border border-slate-200 shadow-sm hover:opacity-90 transition`}
        onClick={() => setPreviewSelfieUrl(url)}
      />
    );
  }

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
  // B7d: which day's punch trail is open. Nothing in the product read attendance_events before this.
  const [trailRow, setTrailRow] = useState<AttendanceWithEmployee | null>(null);
  const [activeBreaks, setActiveBreaks] = useState<{ id: string; employee_id: string; break_type: string; started_at: string }[]>([]);

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
      const [attRes, shiftRes, empShiftRes, activeBreaksRes, selfiesRes] = await Promise.all([
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("date", dailyDate),
        db.from("shifts").select("*").eq("tenant_id", tenantId).eq("is_active", true),
        db.from("employee_shifts").select("*").eq("tenant_id", tenantId)
          .lte("effective_from", dailyDate)
          .or(`effective_to.is.null,effective_to.gte.${dailyDate}`),
        db.from("attendance_breaks").select("id, employee_id, break_type, started_at").eq("tenant_id", tenantId).is("ended_at", null),
        db.from("attendance_selfies").select("*").eq("tenant_id", tenantId),
      ]);

      if (attRes.error) throw attRes.error;
      if (shiftRes.error) throw shiftRes.error;
      if (empShiftRes.error) throw empShiftRes.error;
      if (activeBreaksRes.error) throw activeBreaksRes.error;
      if (selfiesRes.error) throw selfiesRes.error;

      setShifts((shiftRes.data ?? []) as Shift[]);
      setEmployeeShifts((empShiftRes.data ?? []) as EmployeeShift[]);
      setActiveBreaks((activeBreaksRes.data ?? []) as any[]);
      setDailySelfies((selfiesRes.data ?? []) as AttendanceSelfie[]);

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
          // NOT "absent". Derivation deliberately produces NO ROW for an unpunched day,
          // because "nobody punched yet", "the module is off" and "they were absent" are
          // three different facts. Fabricating one here contradicted the Summary tab on
          // this same screen and showed a full roster of false absences every morning —
          // on future dates, holidays, weekly offs and offboarded staff alike.
          status: "no_record" as AttendanceStatus,
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
          total_break_minutes: 0,
          current_break_id: null,
          current_break_start: null,
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
      const finalIsLate = (editStatus === "half_day" || editStatus === "absent") ? false : row.is_late;
      const { error: rpcError } = await db.rpc("hr_update_attendance", {
        p_tenant_id: tenantId,
        p_attendance_id: row.id || null,
        p_employee_id: row.employee_id,
        p_date: dailyDate,
        p_punch_in: editPunchIn || null,
        p_punch_out: editPunchOut || null,
        p_status: editStatus,
        p_is_late: finalIsLate ?? null,
        p_expected_status: row.status || null,
      });
      if (rpcError) throw rpcError;

      success("Attendance updated.");
      setEditId(null);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to update attendance.");
    } finally {
      setSaving(false);
      void fetchDaily();
    }
  }

  function startEdit(row: AttendanceWithEmployee) {
    setEditId(row.employee_id);
    setEditPunchIn(row.punch_in ? new Date(row.punch_in).toTimeString().slice(0, 5) : "");
    setEditPunchOut(row.punch_out ? new Date(row.punch_out).toTimeString().slice(0, 5) : "");
    // "no_record" is a display sentinel, not a storable status. HR editing such a day is
    // CREATING the record, so open the picker on the sensible default rather than a value the
    // dropdown does not offer.
    setEditStatus(row.status === "no_record" ? "present" : (row.status as AttendanceStatus));
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
    // Filter on the unit FK, not the dying department text — the dropdown carries org_unit_id values.
    if (correctionDepartmentFilter !== "all" && (row.employee?.org_unit_id || "") !== correctionDepartmentFilter) return false;
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
      const { error } = await db.rpc("hr_set_overtime_status", {
        p_tenant_id: tenantId,
        p_overtime_id: recordId,
        p_approved: true,
      });
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
      const { error } = await db.rpc("hr_set_overtime_status", {
        p_tenant_id: tenantId,
        p_overtime_id: recordId,
        p_approved: false,
      });
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
        const { error } = await db.rpc("hr_set_overtime_status", {
          p_tenant_id: tenantId,
          p_overtime_id: row.id,
          p_approved: true,
        });
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

  async function approveCorrection(correction: AttendanceCorrectionRow) {
    if (!hrEmployee?.id || !tenant) return;

    if (tenantSettings.payroll_lock_date && correction.attendance_date <= tenantSettings.payroll_lock_date) {
      toastError("Payroll is locked for this date. Cannot approve correction.");
      return;
    }

    if (!correction.requested_punch_in && !correction.requested_punch_out) {
      toastError("Cannot approve a correction with no requested punch times.");
      return;
    }

    setCorrectionActionLoading(true);
    try {
      const { error: rpcError } = await db.rpc("hr_approve_attendance_correction", {
        p_tenant_id: tenantId,
        p_correction_id: correction.id,
      });
      if (rpcError) throw rpcError;

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
      const { error: rejectError } = await db.rpc("hr_reject_attendance_correction", {
        p_tenant_id: tenantId,
        p_correction_id: rejectCorrection.id,
        p_rejection_reason: rejectCorrectionReason.trim(),
      });
      if (rejectError) throw rejectError;

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
      row.status === "no_record" ? "No record" : row.status,
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
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={() => setQuickExceptionModalOpen(true)}
                className="w-full sm:w-auto justify-center inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition shadow-sm"
              >
                Allow Remote Work
              </button>
              <button
                onClick={exportDaily}
                className="w-full sm:w-auto justify-center inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition shadow-sm"
              >
                <Download className="h-4 w-4" /> Export CSV
              </button>
            </div>
          </div>

          {!dailyLoading && filteredDailyRows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10">
              <EmptyState icon={Users} title="No employees found" description="There are no employees to display attendance for." minimal />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Active Breaks Widget */}
              {tenantSettings["break_tracking_enabled"] === "true" && activeBreaks.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/30 p-5 shadow-sm">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-3 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                    Employees Currently On Break ({activeBreaks.length})
                  </h4>
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {activeBreaks.map((brk) => {
                      const emp = allEmployees.find(e => e.id === brk.employee_id);
                      const start = new Date(brk.started_at);
                      const elapsedMins = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000));
                      const limit = brk.break_type === "lunch"
                        ? (tenant?.lunch_break_minutes || 60)
                        : parseInt(tenantSettings["short_break_limit_minutes"] || "15", 10);
                      const isOver = elapsedMins >= limit;
                      const overMins = isOver ? elapsedMins - limit : 0;
                      
                      return (
                        <div key={brk.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex flex-col justify-between">
                          <div>
                            <p className="font-semibold text-slate-800 text-sm">{emp?.full_name ?? "Employee"}</p>
                            <p className="text-[10px] text-slate-500 capitalize">{deptLabel(emp, "Operations")} • {brk.break_type.replace("_", " ")}</p>
                          </div>
                          <div className="mt-3 flex items-center justify-between">
                            <span className="text-[10px] text-slate-400">Started {start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                            <div className="flex flex-col items-end">
                              <span className={`font-mono text-xs font-bold ${isOver ? "text-rose-600 animate-pulse" : "text-amber-600"}`}>
                                {elapsedMins} mins
                              </span>
                              {isOver && (
                                <span className="text-[9px] text-rose-500 font-semibold">Over by {overMins}m</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm block md:table">
                  <thead className="hidden md:table-header-group bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3">Punch In</th>
                      <th className="px-4 py-3">Punch Out</th>
                      <th className="px-4 py-3">Work Hours</th>
                      <th className="px-4 py-3">Break Time</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Verification</th>
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
                          {[...Array(8)].map((__, cellIndex) => (
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
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">{row.employee?.full_name ?? "-"}</span>
                              {row.current_break_id && (
                                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 uppercase tracking-wide animate-pulse">
                                  On Break
                                </span>
                              )}
                            </div>
                            {isEditing ? (
                              <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as AttendanceStatus)} className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold uppercase outline-none focus:ring-2 focus:ring-brand-500 bg-white">
                                <option value="present">Present</option>
                                <option value="absent">Absent</option>
                                <option value="half_day">Half Day</option>
                                <option value="on_leave">On Leave</option>
                              </select>
                            ) : (
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${row.status === 'present' ? 'bg-emerald-500' : row.status === 'absent' ? 'bg-rose-500' : row.status === 'half_day' ? 'bg-amber-500' : row.status === 'no_record' ? 'bg-slate-300' : 'bg-blue-500'}`}></span>
                                {label}
                              </span>
                            )}
                          </div>
                          
                          <div className="grid grid-cols-4 gap-1 bg-slate-50 p-2.5 rounded-lg text-center mb-3 border border-slate-100">
                            <div className="flex flex-col justify-center">
                              <span className="text-[10px] font-bold uppercase text-slate-400 mb-1 tracking-wider">In</span>
                              {isEditing ? (
                                <input type="time" value={editPunchIn} onChange={(event) => setEditPunchIn(event.target.value)} className="w-full rounded-md border border-slate-300 px-1 py-1 text-xs text-center outline-none focus:ring-2 focus:ring-brand-500 bg-white" />
                              ) : (
                                <div className="flex flex-col items-center">
                                  <span className="font-semibold text-slate-800 text-xs">{fmtTime(row.punch_in)}</span>
                                  {row.is_late ? <span className="mt-0.5 rounded px-1 py-0.5 bg-rose-100 text-[8px] font-bold text-rose-700 uppercase">Late</span> : null}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col justify-center border-l border-slate-200">
                              <span className="text-[10px] font-bold uppercase text-slate-400 mb-1 tracking-wider">Out</span>
                              {isEditing ? (
                                <input type="time" value={editPunchOut} onChange={(event) => setEditPunchOut(event.target.value)} className="w-full rounded-md border border-slate-300 px-1 py-1 text-xs text-center outline-none focus:ring-2 focus:ring-brand-500 bg-white" />
                              ) : (
                                <span className="font-semibold text-slate-800 text-xs">{fmtTime(row.punch_out)}</span>
                              )}
                            </div>
                            <div className="flex flex-col justify-center border-l border-slate-200">
                              <span className="text-[10px] font-bold uppercase text-slate-400 mb-1 tracking-wider">Hours</span>
                              <span className="font-semibold text-slate-800 text-xs">{row.work_hours != null ? `${row.work_hours.toFixed(2)}h` : "-"}</span>
                            </div>
                            <div className="flex flex-col justify-center border-l border-slate-200">
                              <span className="text-[10px] font-bold uppercase text-slate-400 mb-1 tracking-wider">Break</span>
                              <span className="font-semibold text-slate-800 text-xs">{row.total_break_minutes > 0 ? `${row.total_break_minutes}m` : "-"}</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {row.location_status ? (
                                <button
                                  type="button"
                                  onClick={() => setSelectedVerificationRow(row)}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition hover:scale-[1.02] ${verificationBadge(row.location_status)?.cls}`}
                                >
                                  {verificationBadge(row.location_status)?.label}
                                </button>
                              ) : punchInLat != null ? (
                                <button
                                  type="button"
                                  onClick={() => setSelectedLocationRow(row)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600 shadow-sm"
                                >
                                  <MapPin className="h-4 w-4" />
                                </button>
                              ) : <span className="text-xs text-slate-400 font-medium">No Location</span>}
                              
                              {dailySelfies.find(s => s.attendance_id === row.id && s.type === "punch_in") && (
                                <SelfieThumbnail storagePath={dailySelfies.find(s => s.attendance_id === row.id && s.type === "punch_in")!.storage_path} />
                              )}
                              {dailySelfies.find(s => s.attendance_id === row.id && s.type === "punch_out") && (
                                <SelfieThumbnail storagePath={dailySelfies.find(s => s.attendance_id === row.id && s.type === "punch_out")!.storage_path} />
                              )}
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
                                <div className="inline-flex items-center gap-2">
                                  <button onClick={() => startEdit(row)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 transition-colors shadow-sm">
                                    <Pencil className="h-3 w-3" /> Edit
                                  </button>
                                  <button onClick={() => setTrailRow(row)} title="Show the punch events behind this day" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 transition-colors shadow-sm">
                                    <ListTree className="h-3 w-3" /> Trail
                                  </button>
                                </div>
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
                        <td className="hidden md:table-cell px-4 py-3 text-slate-700">
                          <span className="font-medium text-slate-800">
                            {row.total_break_minutes > 0 ? `${row.total_break_minutes} mins` : "-"}
                          </span>
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
                              <span className={`h-1.5 w-1.5 rounded-full ${row.status === 'present' ? 'bg-emerald-500' : row.status === 'absent' ? 'bg-rose-500' : row.status === 'half_day' ? 'bg-amber-500' : row.status === 'no_record' ? 'bg-slate-300' : 'bg-blue-500'}`}></span>
                              {label}
                            </span>
                          )}
                        </td>
                        <td className="hidden md:table-cell px-4 py-3">
                          <div className="flex items-center gap-2">
                            {row.location_status ? (
                              <button
                                type="button"
                                onClick={() => setSelectedVerificationRow(row)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition hover:scale-[1.02] ${verificationBadge(row.location_status)?.cls}`}
                              >
                                {verificationBadge(row.location_status)?.label}
                              </button>
                            ) : punchInLat != null ? (
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
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                            
                            {dailySelfies.find(s => s.attendance_id === row.id && s.type === "punch_in") && (
                              <SelfieThumbnail storagePath={dailySelfies.find(s => s.attendance_id === row.id && s.type === "punch_in")!.storage_path} />
                            )}
                            {dailySelfies.find(s => s.attendance_id === row.id && s.type === "punch_out") && (
                              <SelfieThumbnail storagePath={dailySelfies.find(s => s.attendance_id === row.id && s.type === "punch_out")!.storage_path} />
                            )}
                          </div>
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
                            <div className="flex items-center justify-center gap-2">
                              <button onClick={() => startEdit(row)} className="justify-center inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-600 hover:bg-brand-50 transition-colors active:scale-95">
                                <Pencil className="h-3.5 w-3.5" /> Edit
                              </button>
                              <button onClick={() => setTrailRow(row)} className="justify-center inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors active:scale-95">
                                <ListTree className="h-3.5 w-3.5" /> Trail
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
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
                // Options are the org units actually represented in the roster; value is the unit id
                // so the filter above can match on org_unit_id, label is the resolved name.
                ...Array.from(new Set(allEmployees.map((employee) => employee.org_unit_id).filter(Boolean) as string[]))
                  .map((unitId) => ({ value: unitId, label: unitNames[unitId] ?? "—" }))
                  .sort((a, b) => a.label.localeCompare(b.label))
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
                              <span className="text-xs capitalize text-slate-500">{deptLabel(row.employee)}</span>
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
                        <p className="text-xs capitalize text-slate-500">{deptLabel(row.employee)}</p>
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

      {selectedVerificationRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedVerificationRow(null)}>
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                  <span>Attendance Verification Details</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${verificationBadge(selectedVerificationRow.location_status)?.cls}`}>
                    {verificationBadge(selectedVerificationRow.location_status)?.label || "No Status"}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Audit logs and geolocation verification for punch records on {selectedVerificationRow.date}
                </p>
              </div>
              <button onClick={() => setSelectedVerificationRow(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition border border-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            {/* 2-Column Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Left Column: Verification Snapshot details */}
              <div className="space-y-4">
                {/* Employee Details Card */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-3">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Employee Information</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs font-medium text-slate-500">Full Name</p>
                      <p className="font-semibold text-slate-900 mt-0.5">{selectedVerificationRow.employee?.full_name}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500">Employee Code</p>
                      <p className="font-semibold text-slate-900 mt-0.5">{selectedVerificationRow.employee?.employee_code || "N/A"}</p>
                    </div>
                  </div>
                </div>

                {/* Audit & Policy Card */}
                {selectedVerificationRow.verification_snapshot ? (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Verification Snapshot</h4>
                    <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm">
                      <div>
                        <p className="text-xs font-medium text-slate-500">Work Mode</p>
                        <p className="font-semibold text-slate-900 capitalize mt-0.5">
                          {selectedVerificationRow.verification_snapshot.work_mode || "Office"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-500">GPS Mode</p>
                        <p className="font-semibold text-slate-900 capitalize mt-0.5">
                          {selectedVerificationRow.verification_snapshot.gps_mode || "Warn"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-500">Accuracy & Confidence</p>
                        <p className="font-semibold text-slate-900 mt-0.5 flex items-center gap-1.5">
                          <span>{selectedVerificationRow.verification_snapshot.accuracy != null ? `${selectedVerificationRow.verification_snapshot.accuracy}m` : "N/A"}</span>
                          {selectedVerificationRow.verification_snapshot.confidence && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                              selectedVerificationRow.verification_snapshot.confidence === "high" ? "bg-emerald-100 text-emerald-800" :
                              selectedVerificationRow.verification_snapshot.confidence === "medium" ? "bg-blue-100 text-blue-800" :
                              "bg-amber-100 text-amber-800"
                            }`}>
                              {selectedVerificationRow.verification_snapshot.confidence}
                            </span>
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-500">Remote Exception</p>
                        <p className="font-semibold text-slate-900 capitalize mt-0.5 truncate" title={selectedVerificationRow.verification_snapshot.exception_id ? selectedVerificationRow.verification_snapshot.exception_type : undefined}>
                          {selectedVerificationRow.verification_snapshot.exception_id ? `${selectedVerificationRow.verification_snapshot.exception_type?.replace(/_/g, " ")}` : "No Exception"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-500">Selfie Required</p>
                        <p className="font-semibold text-slate-900 mt-0.5">
                          {selectedVerificationRow.verification_snapshot.selfie_required ? "Yes" : "No"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-500">Selfie Captured</p>
                        <p className="font-semibold text-slate-900 mt-0.5">
                          {selectedVerificationRow.verification_snapshot.selfie_captured ? "Yes" : "No"}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                    No verification snapshot available. This record was punched prior to verification layer activation.
                  </div>
                )}
              </div>

              {/* Right Column: GPS & Locations Map */}
              <div className="space-y-4">
                {selectedVerificationRow.punch_in_lat != null || selectedVerificationRow.punch_out_lat != null ? (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-3 h-full flex flex-col justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Location Mapping</h4>
                      
                      {/* Tabs / Switcher if both exist */}
                      {selectedVerificationRow.punch_in_lat != null && selectedVerificationRow.punch_out_lat != null && (
                        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 mb-3">
                          <button
                            type="button"
                            onClick={() => setActiveMapTab("punch_in")}
                            className={`flex-1 text-center py-1 text-xs font-semibold rounded-md transition ${activeMapTab === "punch_in" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                          >
                            Punch In Location
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveMapTab("punch_out")}
                            className={`flex-1 text-center py-1 text-xs font-semibold rounded-md transition ${activeMapTab === "punch_out" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                          >
                            Punch Out Location
                          </button>
                        </div>
                      )}

                      {/* Coordinates Info based on active tab */}
                      <div className="bg-white rounded-lg p-2.5 border border-slate-100 text-[11px] mb-2 space-y-1">
                        {((activeMapTab === "punch_in" && selectedVerificationRow.punch_in_lat != null) || (selectedVerificationRow.punch_out_lat == null && selectedVerificationRow.punch_in_lat != null)) ? (
                          <>
                            <div className="flex justify-between">
                              <span className="font-semibold text-slate-600">Punch-in Coordinates:</span>
                              <span className="font-mono text-slate-900">{selectedVerificationRow.punch_in_lat}, {selectedVerificationRow.punch_in_lng}</span>
                            </div>
                            <div className="flex justify-between border-t border-slate-50 pt-1">
                              <span className="font-semibold text-slate-600">Distance from Office:</span>
                              <span className="font-bold text-slate-900">
                                {(officeLat !== null && officeLng !== null) ? `${Math.round(calculateDistance(Number(selectedVerificationRow.punch_in_lat), Number(selectedVerificationRow.punch_in_lng), officeLat, officeLng))}m` : "N/A"}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between">
                              <span className="font-semibold text-slate-600">Punch-out Coordinates:</span>
                              <span className="font-mono text-slate-900">{selectedVerificationRow.punch_out_lat}, {selectedVerificationRow.punch_out_lng}</span>
                            </div>
                            <div className="flex justify-between border-t border-slate-50 pt-1">
                              <span className="font-semibold text-slate-600">Distance from Office:</span>
                              <span className="font-bold text-slate-900">
                                {(officeLat !== null && officeLng !== null) ? `${Math.round(calculateDistance(Number(selectedVerificationRow.punch_out_lat), Number(selectedVerificationRow.punch_out_lng), officeLat, officeLng))}m` : "N/A"}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Leaflet map container */}
                    <div className="flex-1 min-h-[170px] relative border border-slate-200 rounded-lg overflow-hidden shadow-inner bg-slate-100">
                      {((activeMapTab === "punch_in" && selectedVerificationRow.punch_in_lat != null) || (selectedVerificationRow.punch_out_lat == null && selectedVerificationRow.punch_in_lat != null)) ? (
                        <LocationMap
                          key="punch_in_map"
                          lat={Number(selectedVerificationRow.punch_in_lat)}
                          lng={Number(selectedVerificationRow.punch_in_lng)}
                          label={`${selectedVerificationRow.employee?.full_name ?? "Employee"} punch-in`}
                          accuracy={selectedVerificationRow.punch_in_location_accuracy != null ? Number(selectedVerificationRow.punch_in_location_accuracy) : null}
                        />
                      ) : selectedVerificationRow.punch_out_lat != null ? (
                        <LocationMap
                          key="punch_out_map"
                          lat={Number(selectedVerificationRow.punch_out_lat)}
                          lng={Number(selectedVerificationRow.punch_out_lng)}
                          label={`${selectedVerificationRow.employee?.full_name ?? "Employee"} punch-out`}
                          accuracy={selectedVerificationRow.punch_out_location_accuracy != null ? Number(selectedVerificationRow.punch_out_location_accuracy) : null}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 h-full flex flex-col items-center justify-center bg-slate-50/20">
                    <MapPin className="h-8 w-8 text-slate-300 mb-2 animate-bounce" />
                    <p className="font-medium text-slate-500">No GPS coordinates captured</p>
                    {selectedVerificationRow.verification_snapshot?.gps_error_reason && (
                      <p className="text-rose-600 mt-2 font-medium bg-rose-50 border border-rose-100 px-3 py-1.5 rounded-lg text-[11px]">
                        Reason: {selectedVerificationRow.verification_snapshot.gps_error_reason}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Section: Selfie Verification */}
            {(() => {
              const punchInSelfie = dailySelfies.find(s => s.attendance_id === selectedVerificationRow.id && s.type === "punch_in");
              const punchOutSelfie = dailySelfies.find(s => s.attendance_id === selectedVerificationRow.id && s.type === "punch_out");
              if (!punchInSelfie && !punchOutSelfie) return null;
              return (
                <div className="border-t border-slate-100 pt-5 mt-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Selfie Verification</h4>
                  <div className="grid grid-cols-2 gap-4">
                    {punchInSelfie ? (
                      <div className="rounded-xl border border-slate-100 bg-slate-50/30 p-3 flex flex-col items-center justify-center space-y-2 group hover:border-slate-200 hover:bg-slate-50 transition shadow-sm cursor-pointer" onClick={() => {
                        // Trigger zoom via clicking the image container too
                        const img = document.querySelector(`[data-selfie-path="${punchInSelfie.storage_path}"]`) as HTMLImageElement;
                        if (img) img.click();
                      }}>
                        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Punch In Selfie</p>
                        <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-white shadow-inner">
                          <SelfieImage storagePath={punchInSelfie.storage_path} className="h-32 w-32 object-cover animate-fade-in" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                            <span className="text-[10px] text-white font-bold tracking-widest bg-black/60 px-2.5 py-1 rounded-md">ZOOM</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 p-4 flex flex-col items-center justify-center text-center opacity-60 bg-slate-50/50">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Punch In Selfie</p>
                        <div className="h-32 w-32 rounded-lg bg-slate-100 border border-slate-200 flex flex-col items-center justify-center text-[10px] text-slate-400 gap-1.5 font-medium">
                          <Camera className="h-5 w-5 text-slate-300" />
                          <span>No Selfie Captured</span>
                        </div>
                      </div>
                    )}

                    {punchOutSelfie ? (
                      <div className="rounded-xl border border-slate-100 bg-slate-50/30 p-3 flex flex-col items-center justify-center space-y-2 group hover:border-slate-200 hover:bg-slate-50 transition shadow-sm cursor-pointer" onClick={() => {
                        const img = document.querySelector(`[data-selfie-path="${punchOutSelfie.storage_path}"]`) as HTMLImageElement;
                        if (img) img.click();
                      }}>
                        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Punch Out Selfie</p>
                        <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-white shadow-inner">
                          <SelfieImage storagePath={punchOutSelfie.storage_path} className="h-32 w-32 object-cover animate-fade-in" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                            <span className="text-[10px] text-white font-bold tracking-widest bg-black/60 px-2.5 py-1 rounded-md">ZOOM</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 p-4 flex flex-col items-center justify-center text-center opacity-60 bg-slate-50/50">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Punch Out Selfie</p>
                        <div className="h-32 w-32 rounded-lg bg-slate-100 border border-slate-200 flex flex-col items-center justify-center text-[10px] text-slate-400 gap-1.5 font-medium">
                          <Camera className="h-5 w-5 text-slate-300" />
                          <span>No Selfie Captured</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Footer */}
            <div className="flex justify-end pt-4 border-t border-slate-100">
              <button
                onClick={() => setSelectedVerificationRow(null)}
                className="rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 text-sm font-semibold transition shadow-sm border border-slate-800 hover:shadow"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}

      {quickExceptionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => setQuickExceptionModalOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Allow Remote Work (Quick Action)</h3>
              <p className="mt-1 text-sm text-slate-500">Quickly create a remote work location exception for an employee.</p>
            </div>
            
            <div className="space-y-4 px-5 py-5 text-sm">
              <label className="block space-y-1">
                <span className="font-medium text-slate-700">Select Employee</span>
                <select
                  value={quickEmployeeId}
                  onChange={(e) => setQuickEmployeeId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none bg-white"
                >
                  <option value="">Choose Employee...</option>
                  {allEmployees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.employee_code ?? "No Code"})</option>
                  ))}
                </select>
              </label>
              
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="font-medium text-slate-700">Start Date</span>
                  <input
                    type="date"
                    value={quickStartDate}
                    onChange={(e) => setQuickStartDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="font-medium text-slate-700">End Date</span>
                  <input
                    type="date"
                    value={quickEndDate}
                    onChange={(e) => setQuickEndDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
                  />
                </label>
              </div>
              
              <label className="block space-y-1">
                <span className="font-medium text-slate-700">Exception Type</span>
                <select
                  value={quickType}
                  onChange={(e) => setQuickType(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none bg-white"
                >
                  <option value="work_from_home">Work From Home (WFH)</option>
                  <option value="client_visit">Client Visit</option>
                  <option value="business_travel">Business Travel</option>
                  <option value="field_work">Field Work</option>
                  <option value="other">Other Exception</option>
                </select>
              </label>
              
              <label className="block space-y-1">
                <span className="font-medium text-slate-700">Reason</span>
                <textarea
                  value={quickReason}
                  onChange={(e) => setQuickReason(e.target.value)}
                  placeholder="Provide details about the exception location/need"
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
                />
              </label>
            </div>
            
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setQuickExceptionModalOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveQuickException()}
                disabled={submittingException}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                {submittingException ? "Saving..." : "Allow Remote Work"}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewSelfieUrl && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-md animate-fade-in"
          onClick={() => setPreviewSelfieUrl(null)}
        >
          <div className="relative max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl flex flex-col items-center justify-center p-2" onClick={(e) => e.stopPropagation()}>
            <button 
              onClick={() => setPreviewSelfieUrl(null)}
              className="absolute top-4 right-4 z-10 rounded-full bg-black/60 p-2 text-white/80 hover:bg-black/80 hover:text-white transition shadow-md"
            >
              <X className="h-6 w-6" />
            </button>
            <img 
              src={previewSelfieUrl} 
              alt="Selfie Preview" 
              className="max-w-full max-h-[80vh] object-contain rounded-xl"
            />
          </div>
        </div>
      )}
      {trailRow ? (
        <PunchTrailTray
          open
          onClose={() => setTrailRow(null)}
          tenantId={tenantId}
          employeeId={trailRow.employee_id}
          employeeName={trailRow.employee?.full_name ?? "Employee"}
          date={dailyDate}
          attendanceId={trailRow.id || null}
          derivationSource={(trailRow as { derivation_source?: string | null }).derivation_source ?? null}
        />
      ) : null}
    </section>
  );
}
