import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, LogIn, LogOut, Clock, CheckCircle } from "lucide-react";
import type { Attendance, Task } from "../types";
import { db } from "../insforge/client";
import { useAuditLog } from "../hooks/useAuditLog";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { checkGeofence, getCurrentPosition, type LocationStatus } from "../utils/geolocation";
import { useEmployeeShift } from "../hooks/useEmployeeShift";
import { formatLocalDate } from "../utils/date";
import { functions } from "../insforge/client";

// Business calendar date — uses local timezone to avoid UTC date-shift bugs.
// See src/utils/date.ts for full explanation.
const TODAY = formatLocalDate(new Date());

type AttendanceWithLocation = Attendance & {
  is_late?: boolean | null;
  punch_in_lat?: number | string | null;
  punch_in_lng?: number | string | null;
  punch_in_location_accuracy?: number | string | null;
  punch_in_location_status?: LocationStatus | null;
  punch_out_lat?: number | string | null;
  punch_out_lng?: number | string | null;
  punch_out_location_accuracy?: number | string | null;
  punch_out_location_status?: LocationStatus | null;
};

type OvertimeRecord = {
  id: string;
  attendance_id: string | null;
  date: string;
  regular_hours: number;
  overtime_hours: number;
  overtime_rate: number;
  overtime_amount: number | null;
  approved: boolean;
};

type AttendanceCorrection = {
  id: string;
  attendance_date: string;
  requested_punch_in: string | null;
  requested_punch_out: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  rejection_reason?: string | null;
  created_at?: string | null;
};

type LateMarkSummary = {
  late_count: number;
  threshold: number;
  excess_late_marks: number;
  deduction_hours: number;
  has_deduction: boolean;
};

function settingMap(rows: { key: string; value: string }[]) {
  return rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

function getLocationIndicator(status: LocationStatus | null | undefined) {
  if (status === "captured") return { dot: "bg-emerald-500", text: "Location recorded", textClass: "text-emerald-700" };
  if (status === "denied") return { dot: "bg-amber-500", text: "Location not shared", textClass: "text-amber-700" };
  if (status === "outside_fence") return { dot: "bg-rose-500", text: "Recorded outside office", textClass: "text-rose-700" };
  return { dot: "bg-slate-400", text: "Location unavailable", textClass: "text-slate-600" };
}

function parseTime(timeStr: string): number {
  const [hours, minutes] = timeStr.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function formatTimeLabel(timeStr: string | null | undefined) {
  if (!timeStr) return "--:--";
  return timeStr.slice(0, 5);
}

function fmtTime(value: string | null | undefined) {
  if (!value) return "--:--";
  return new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function getExpectedHours(startTime: string, endTime: string) {
  const shiftStart = parseTime(startTime);
  const shiftEnd = parseTime(endTime);
  const diffMinutes = shiftEnd >= shiftStart ? shiftEnd - shiftStart : (24 * 60 - shiftStart) + shiftEnd;
  return diffMinutes / 60;
}

function formatHours(hours: number | null | undefined) {
  if (hours == null || !Number.isFinite(hours)) return "--";
  return `${hours.toFixed(2)}h`;
}

function formatDateLabel(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function toTimeInputValue(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toTimeString().slice(0, 5);
}

export default function PunchInOut() {
  const { employee } = useEmployee();
  const { tenant, tenantId } = useTenant();
  const { shift, isLoading: shiftLoading } = useEmployeeShift();
  const { logAction } = useAuditLog();
  const [attendance, setAttendance] = useState<AttendanceWithLocation | null>(null);
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [tenantSettings, setTenantSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [actionText, setActionText] = useState("");
  const [elapsed, setElapsed] = useState("");
  const [lateMarkSummary, setLateMarkSummary] = useState<LateMarkSummary | null>(null);
  const [recentAttendance, setRecentAttendance] = useState<AttendanceWithLocation[]>([]);
  const [overtimeByDate, setOvertimeByDate] = useState<Record<string, OvertimeRecord>>({});
  const [correctionByDate, setCorrectionByDate] = useState<Record<string, AttendanceCorrection>>({});
  const [selectedCorrectionDate, setSelectedCorrectionDate] = useState<string | null>(null);
  const [correctionPunchIn, setCorrectionPunchIn] = useState("");
  const [correctionPunchOut, setCorrectionPunchOut] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { success, error, info, toast } = useToast();

  const currentTime = new Date();
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const shiftStartTime = shift?.start_time ? parseTime(shift.start_time) : parseTime(tenant?.punch_in_start ?? "09:00");
  const halfDayCutoff = shift?.half_day_cutoff_override ?? tenant?.punch_in_cutoff ?? "10:30";
  const halfDayCutoffMinutes = parseTime(halfDayCutoff);
  const expectedHours = shift ? getExpectedHours(shift.start_time, shift.end_time) : Number(tenant?.work_hours_per_day ?? 8);
  const isWorkingDay = shift ? shift.working_days.includes(currentTime.getDay()) : true;
  const isNightShift = shift ? parseTime(shift.end_time) < parseTime(shift.start_time) : false;
  let effectiveCurrentMinutes = currentMinutes;
  if (isNightShift && currentMinutes < 12 * 60) {
    effectiveCurrentMinutes += 1440;
  }
  const canPunchIn = effectiveCurrentMinutes >= shiftStartTime;
  const regularizationEnabled = tenantSettings["regularization_enabled"] === "true";

  const fetchData = async () => {
    if (!employee?.id || !tenantId || !tenant) return;
    try {
      const today = new Date();
      const recentStart = new Date(today);
      recentStart.setDate(today.getDate() - 6);
      const recentStartDate = formatLocalDate(recentStart);
      const [attRes, todayClosedRes, taskRes, settingsRes, recentAttRes, overtimeRes, correctionsRes] = await Promise.all([
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).eq("session_status", "open").not("punch_in", "is", null).order("punch_in", { ascending: false }).limit(1).maybeSingle(),
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).eq("date", TODAY).eq("session_status", "closed").order("punch_out", { ascending: false }).limit(1).maybeSingle(),
        db.from("tasks").select("*").eq("tenant_id", tenantId).eq("assigned_to", employee.id).eq("due_date", TODAY),
        db.from("tenant_settings").select("key,value").eq("tenant_id", tenantId),
        db
          .from("attendance")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("employee_id", employee.id)
          .gte("date", recentStartDate)
          .lte("date", TODAY)
          .order("date", { ascending: false }),
        db
          .from("overtime_records")
          .select("id,attendance_id,date,regular_hours,overtime_hours,overtime_rate,overtime_amount,approved")
          .eq("tenant_id", tenantId)
          .eq("employee_id", employee.id)
          .gte("date", recentStartDate)
          .lte("date", TODAY),
        db
          .from("attendance_corrections")
          .select("id,attendance_date,requested_punch_in,requested_punch_out,reason,status,rejection_reason,created_at")
          .eq("tenant_id", tenantId)
          .eq("employee_id", employee.id)
          .gte("attendance_date", recentStartDate)
          .lte("attendance_date", TODAY),
      ]);
      
      let activeAttendance = null;
      if (attRes.data) {
        activeAttendance = attRes.data;
      } else if (todayClosedRes.data) {
        activeAttendance = todayClosedRes.data;
      }
      setAttendance(activeAttendance as AttendanceWithLocation | null);
      setTodayTasks((taskRes.data ?? []) as Task[]);
      setTenantSettings(settingMap((settingsRes.data ?? []) as { key: string; value: string }[]));
      setRecentAttendance((recentAttRes.data ?? []) as AttendanceWithLocation[]);
      setOvertimeByDate(
        ((overtimeRes.data ?? []) as OvertimeRecord[]).reduce<Record<string, OvertimeRecord>>((acc, record) => {
          acc[record.date] = record;
          return acc;
        }, {}),
      );
      setCorrectionByDate(
        ((correctionsRes.data ?? []) as AttendanceCorrection[]).reduce<Record<string, AttendanceCorrection>>((acc, record) => {
          const existing = acc[record.attendance_date];
          if (!existing) {
            acc[record.attendance_date] = record;
          } else if (existing.status !== "pending" && record.status === "pending") {
            acc[record.attendance_date] = record;
          }
          return acc;
        }, {}),
      );
    } catch (err) {
      error("Failed to load attendance data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, [employee?.id, tenantId, tenant]);

  useEffect(() => {
    if (attendance?.punch_in && !attendance.punch_out) {
      const tick = () => {
        const diff = Date.now() - new Date(attendance.punch_in).getTime();
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setElapsed(`${h}h ${m}m ${s}s`);
      };
      tick();
      timerRef.current = setInterval(tick, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [attendance?.punch_in, attendance?.punch_out]);

  useEffect(() => {
    const fetchLateMarks = async () => {
      if (!attendance?.is_late || !employee?.id || !tenantId) {
        setLateMarkSummary(null);
        return;
      }
      try {
        const month = new Date().getMonth() + 1;
        const year = new Date().getFullYear();
        const { data, error: fnError } = await functions.invoke("calculate-late-marks", {
          body: {
            tenant_id: tenantId,
            employee_id: employee.id,
            month,
            year,
          },
        });
        if (fnError) throw fnError;
        setLateMarkSummary(data as LateMarkSummary);
      } catch (err) {
        console.error("Failed to fetch late mark summary", err);
        setLateMarkSummary(null);
      }
    };
    void fetchLateMarks();
  }, [attendance?.is_late, employee?.id, tenantId]);

  async function getIp(): Promise<string> {
    try {
      const res = await fetch("https://api.ipify.org?format=json");
      const { ip } = await res.json();
      return ip as string;
    } catch {
      return "unknown";
    }
  }

  async function punchIn() {
    if (!employee?.id || !tenantId || !tenant || acting || !shift || shiftLoading || !canPunchIn || !isWorkingDay) return;
    setActing(true);
    setActionText("Getting your location...");
    try {
      await db.rpc("close_stale_attendance");
    } catch (err) {
      console.error("Failed to auto-close stale sessions", err);
    }
    try {
      const ipPromise = getIp();
      const now = new Date();
      const shiftStartDate = new Date();
      shiftStartDate.setHours(Math.floor(shiftStartTime / 60), shiftStartTime % 60, 0, 0);
      if (isNightShift && now.getHours() < 12) {
        shiftStartDate.setDate(shiftStartDate.getDate() - 1);
      }
      const halfDayCutoffDate = new Date(shiftStartDate);
      halfDayCutoffDate.setHours(Math.floor(halfDayCutoffMinutes / 60), halfDayCutoffMinutes % 60, 0, 0);
      if (isNightShift && halfDayCutoffMinutes < shiftStartTime) {
        halfDayCutoffDate.setDate(halfDayCutoffDate.getDate() + 1);
      }
      const isHalfDay = now.getTime() > halfDayCutoffDate.getTime();
      const unapprovedTasks = todayTasks.filter((task) => task.status !== "approved");
      const allowed = tenant.punch_out_gate_enabled ? unapprovedTasks.length === 0 : true;
      const geofenceEnabled = tenantSettings["geofence_enabled"] === "true";
      const officeLat = parseFloat(tenantSettings["office_lat"] || "0");
      const officeLng = parseFloat(tenantSettings["office_lng"] || "0");
      const radiusMeters = parseInt(tenantSettings["geofence_radius_meters"] || "500", 10);
      const locationData: {
        punch_in_lat: number | null;
        punch_in_lng: number | null;
        punch_in_location_accuracy: number | null;
        punch_in_location_status: LocationStatus;
      } = {
        punch_in_lat: null,
        punch_in_lng: null,
        punch_in_location_accuracy: null,
        punch_in_location_status: "unavailable",
      };

      try {
        const position = await getCurrentPosition();
        if (position.accuracy > 100) {
          throw new Error("LOW_ACCURACY");
        }
        locationData.punch_in_lat = position.lat;
        locationData.punch_in_lng = position.lng;
        locationData.punch_in_location_accuracy = position.accuracy;
        locationData.punch_in_location_status = "captured";

        if (geofenceEnabled && officeLat !== 0 && officeLng !== 0) {
          const fenceResult = checkGeofence(position.lat, position.lng, officeLat, officeLng, radiusMeters);
          if (!fenceResult.inside) {
            locationData.punch_in_location_status = "outside_fence";
            toast(
              `You are ${fenceResult.distanceMeters}m from the office. Punch-in recorded with your location.`,
              "info",
            );
          }
        }
      } catch (geoError) {
        if (geoError instanceof Error && geoError.message === "DENIED") {
          locationData.punch_in_location_status = "denied";
          info("Location permission denied. Punch-in recorded without location.");
        } else {
          locationData.punch_in_location_status = "unavailable";
        }
      }

      const ip = await ipPromise;
      setActionText("Punching In...");
      const gracePeriodMinutes = parseInt(tenantSettings["late_mark_grace_minutes"] || "0", 10);
      const elapsedSinceShiftStartMinutes = (now.getTime() - shiftStartDate.getTime()) / 60000;
      const isLate = elapsedSinceShiftStartMinutes > gracePeriodMinutes;

      const { data: inserted, error: dbErr } = await db.from("attendance").insert([{
        employee_id: employee.id,
        tenant_id: tenantId,
        date: TODAY,
        punch_in_ip: ip,
        punch_out_allowed: allowed,
        status: isHalfDay ? "half_day" : "present",
        session_status: "open",
        ...locationData,
      }]).select("id").single();

      if (dbErr) throw dbErr;

      if (isLate && inserted?.id) {
        const { error: lateErr } = await db
          .from("attendance")
          .update({ is_late: true })
          .eq("tenant_id", tenantId)
          .eq("id", inserted.id);
        if (lateErr) throw lateErr;
      }

      void logAction("punch_in", "attendance", inserted?.id);
      success("Punched in successfully!");
      void fetchData();
    } catch (err) {
      if (err instanceof Error && err.message === "LOW_ACCURACY") {
        error("GPS accuracy is too low (>100m). Please step outside or connect to Wi-Fi.");
      } else {
        error("Failed to punch in.");
        console.error(err);
      }
    } finally {
      setActing(false);
      setActionText("");
    }
  }

  async function punchOut() {
    if (!attendance?.id || !tenant || !tenantId || !employee?.id || acting) return;
    if (!attendance.punch_in) {
      void logAction("attendance.corrupted_session_detected", "attendance", attendance.id, { severity: "WARNING" });
      error("Your attendance session is corrupted. HR has been notified.");
      return;
    }
    setActing(true);
    setActionText("Getting your location...");
    try {
      const geofenceEnabled = tenantSettings["geofence_enabled"] === "true";
      const officeLat = parseFloat(tenantSettings["office_lat"] || "0");
      const officeLng = parseFloat(tenantSettings["office_lng"] || "0");
      const radiusMeters = parseInt(tenantSettings["geofence_radius_meters"] || "500", 10);
      const locationData: {
        punch_out_lat: number | null;
        punch_out_lng: number | null;
        punch_out_location_accuracy: number | null;
        punch_out_location_status: LocationStatus;
      } = {
        punch_out_lat: null,
        punch_out_lng: null,
        punch_out_location_accuracy: null,
        punch_out_location_status: "unavailable",
      };

      try {
        const position = await getCurrentPosition();
        if (position.accuracy > 100) {
          throw new Error("LOW_ACCURACY");
        }
        locationData.punch_out_lat = position.lat;
        locationData.punch_out_lng = position.lng;
        locationData.punch_out_location_accuracy = position.accuracy;
        locationData.punch_out_location_status = "captured";

        if (geofenceEnabled && officeLat !== 0 && officeLng !== 0) {
          const fenceResult = checkGeofence(position.lat, position.lng, officeLat, officeLng, radiusMeters);
          if (!fenceResult.inside) {
            locationData.punch_out_location_status = "outside_fence";
          }
        }
      } catch (geoError) {
        if (geoError instanceof Error && geoError.message === "DENIED") {
          locationData.punch_out_location_status = "denied";
          info("Location permission denied. Punch-out recorded without location.");
        } else {
          locationData.punch_out_location_status = "unavailable";
        }
      }

      setActionText("Punching Out...");

      const overtimeEnabled = tenantSettings["overtime_enabled"] === "true";
      const overtimeRate = parseFloat(tenantSettings["overtime_rate"] || "1.5");
      let expectedShiftHours = Number(tenant.work_hours_per_day || 8);
      
      if (shift) {
        const shiftStartMin = parseTime(shift.start_time);
        const shiftEndMin = parseTime(shift.end_time);
        const lunchMinutes = tenant.lunch_break_minutes || 0;
        const shiftDurationMinutes = shiftEndMin >= shiftStartMin
          ? shiftEndMin - shiftStartMin
          : (24 * 60 - shiftStartMin) + shiftEndMin;
        expectedShiftHours = (shiftDurationMinutes - lunchMinutes) / 60;
      }

      const { data, error: dbErr } = await db.rpc("punch_out_attendance", {
        p_attendance_id: attendance.id,
        p_tenant_id: tenantId,
        p_lat: locationData.punch_out_lat,
        p_lng: locationData.punch_out_lng,
        p_acc: locationData.punch_out_location_accuracy,
        p_loc_status: locationData.punch_out_location_status,
        p_lunch_minutes: tenant.lunch_break_minutes || 0,
        p_overtime_enabled: overtimeEnabled,
        p_overtime_rate: overtimeRate,
        p_expected_shift_hours: parseFloat(expectedShiftHours.toFixed(2))
      });

      if (dbErr) throw dbErr;
      if (data && data.success === false) {
        throw new Error(data.reason || "Server rejected punch out");
      }

      const workHoursReturned = data?.work_hours ?? 0;

      void logAction("punch_out", "attendance", attendance.id, {
        work_hours: workHoursReturned,
        expected_hours: Number(expectedHours.toFixed(2)),
      });
      success("Punched out successfully! Have a great day!");
      void fetchData();
    } catch (err) {
      if (err instanceof Error && err.message === "LOW_ACCURACY") {
        error("GPS accuracy is too low (>100m). Please step outside or connect to Wi-Fi.");
      } else {
        error("Failed to punch out.");
        console.error(err);
      }
    } finally {
      setActing(false);
      setActionText("");
    }
  }

  const recentDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const dateStr = formatLocalDate(date);
    const record = recentAttendance.find((item) => item.date === dateStr) ?? null;
    const correction = correctionByDate[dateStr];
    const workingDay = shift ? shift.working_days.includes(date.getDay()) : true;
    let issueLabel: string | null = null;

    if (!record && workingDay) {
      issueLabel = "Absent / Missing";
    } else if (record?.punch_in && !record.punch_out && dateStr !== TODAY) {
      issueLabel = "Missing punch-out";
    } else if (record?.punch_out && !record.punch_in) {
      issueLabel = "Missing punch-in";
    }

    return {
      date: dateStr,
      record,
      correction,
      overtime: overtimeByDate[dateStr],
      issueLabel,
      canRequestCorrection: Boolean(issueLabel && regularizationEnabled && correction?.status !== "pending"),
    };
  });

  function openCorrectionModal(dateStr: string) {
    const record = recentDays.find((item) => item.date === dateStr)?.record ?? null;
    setSelectedCorrectionDate(dateStr);
    setCorrectionPunchIn(toTimeInputValue(record?.punch_in));
    setCorrectionPunchOut(toTimeInputValue(record?.punch_out));
    setCorrectionReason("");
  }

  function closeCorrectionModal() {
    if (correctionSubmitting) return;
    setSelectedCorrectionDate(null);
    setCorrectionPunchIn("");
    setCorrectionPunchOut("");
    setCorrectionReason("");
  }

  async function submitCorrectionRequest() {
    if (!employee?.id || !tenantId || !selectedCorrectionDate) return;
    if (!correctionReason.trim()) {
      error("Please explain why correction is needed.");
      return;
    }

    setCorrectionSubmitting(true);
    try {
      const { data: existingRequests, error: existingError } = await db
        .from("attendance_corrections")
        .select("id,status")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employee.id)
        .eq("attendance_date", selectedCorrectionDate);
      if (existingError) throw existingError;

      const hasPending = ((existingRequests ?? []) as { id: string; status: AttendanceCorrection["status"] }[])
        .some((request) => request.status === "pending");
      if (hasPending) {
        error("You already have a pending correction request for this date.");
        return;
      }

      const payload = {
        tenant_id: tenantId,
        employee_id: employee.id,
        attendance_date: selectedCorrectionDate,
        requested_punch_in: correctionPunchIn || null,
        requested_punch_out: correctionPunchOut || null,
        reason: correctionReason.trim(),
        status: "pending" as const,
        reviewed_by: null,
        reviewed_at: null,
        rejection_reason: null,
      };

      const { error: upsertError } = await db
        .from("attendance_corrections")
        .upsert([payload], { onConflict: "tenant_id,employee_id,attendance_date" });
      if (upsertError) throw upsertError;

      success("Correction request submitted. HR will review it shortly.");
      setSelectedCorrectionDate(null);
      setCorrectionPunchIn("");
      setCorrectionPunchOut("");
      setCorrectionReason("");
      void fetchData();
    } catch (err) {
      console.error(err);
      error("Failed to submit correction request.");
    } finally {
      setCorrectionSubmitting(false);
    }
  }

  const renderPastSevenDays = () => (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4 text-slate-400" />
        <h3 className="font-semibold text-slate-800">Past 7 Days</h3>
      </div>
      <div className="space-y-2">
        {recentDays.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">No attendance records found for the last 7 days.</p>
        ) : recentDays.map(({ date, record, correction, overtime, issueLabel, canRequestCorrection }) => {
          return (
            <div key={date} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-slate-800">
                  {new Date(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                </p>
                <p className="text-xs text-slate-500">
                  {fmtTime(record?.punch_in)} - {fmtTime(record?.punch_out)} | {formatHours(record?.work_hours)}
                </p>
                {issueLabel ? <p className="mt-1 text-xs font-semibold text-rose-600">{issueLabel}</p> : null}
                {correction?.status === "pending" ? (
                  <p className="mt-1 text-xs font-medium text-amber-700">Correction request pending</p>
                ) : issueLabel && !regularizationEnabled ? (
                  <p className="mt-1 text-xs font-medium text-slate-500">Attendance correction is disabled by HR settings.</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {overtime ? (
                  <>
                    <span className="text-xs font-semibold text-purple-700">OT: {overtime.overtime_hours.toFixed(2)}h</span>
                    {overtime.approved ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Approved</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Pending HR review</span>
                    )}
                  </>
                ) : null}
                {record ? (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${
                    record.status === "present" ? "bg-emerald-100 text-emerald-700" :
                    record.status === "half_day" ? "bg-amber-100 text-amber-700" :
                    record.status === "on_leave" ? "bg-blue-100 text-blue-700" :
                    "bg-rose-100 text-rose-700"
                  }`}>
                    {record.status.replace("_", " ")}
                  </span>
                ) : null}
                {canRequestCorrection ? (
                  <button
                    type="button"
                    onClick={() => openCorrectionModal(date)}
                    className="rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-50"
                  >
                    Request Correction
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const selectedCorrectionEntry = selectedCorrectionDate
    ? recentDays.find((item) => item.date === selectedCorrectionDate) ?? null
    : null;

  if (loading || !tenant || shiftLoading) {
    return (
      <section className="space-y-6">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="mx-auto h-64 w-full max-w-sm rounded-2xl" />
      </section>
    );
  }

  if (attendance?.status === "on_leave") {
    return (
      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Punch In / Out</h2>
          <p className="text-sm text-slate-500">{TODAY}</p>
        </div>
        <div className="mx-auto max-w-sm rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center shadow-sm">
          <CheckCircle className="mx-auto mb-3 h-14 w-14 text-emerald-500" />
          <h3 className="mb-1 text-xl font-bold text-emerald-700">On Leave</h3>
          <p className="mb-4 text-slate-600">Enjoy your time off! No punch-in required today.</p>
        </div>
        {renderPastSevenDays()}
      </section>
    );
  }

  if (attendance?.punch_out) {
    const h = Math.floor(attendance.work_hours ?? 0);
    const m = Math.round(((attendance.work_hours ?? 0) - h) * 60);
    const locationIndicator = getLocationIndicator(attendance.punch_in_location_status);
    const todayOvertime = overtimeByDate[TODAY];

    return (
      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Punch In / Out</h2>
          <p className="text-sm text-slate-500">{TODAY}</p>
        </div>
        <div className="mx-auto max-w-sm rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center shadow-sm">
          <CheckCircle className="mx-auto mb-3 h-14 w-14 text-emerald-500" />
          <h3 className="mb-1 text-xl font-bold text-emerald-700">Day Complete!</h3>
          <p className="mb-4 text-slate-600">You worked <span className="font-bold text-emerald-700">{h}h {m}m</span> today.</p>
          {todayOvertime?.overtime_hours ? (
            <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-left text-sm text-purple-800">
              <p className="font-semibold">You worked {todayOvertime.overtime_hours.toFixed(2)} hours of overtime today.</p>
              <p className="mt-1">This has been recorded and will be reviewed by HR.</p>
            </div>
          ) : null}
          <div className="space-y-1 text-sm text-slate-500">
            <p>Punch In: {new Date(attendance.punch_in).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
            <p className={`inline-flex items-center gap-2 ${locationIndicator.textClass}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${locationIndicator.dot}`} />
              {locationIndicator.text}
            </p>
            <p>Punch Out: {new Date(attendance.punch_out).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        </div>
        {renderPastSevenDays()}
      </section>
    );
  }

  if (!attendance) {
    const shiftStartLabel = formatTimeLabel(shift?.start_time ?? tenant.punch_in_start);
    const shiftEndLabel = formatTimeLabel(shift?.end_time ?? tenant.punch_in_cutoff);
    const halfDayLabel = formatTimeLabel(halfDayCutoff);

    return (
      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Punch In / Out</h2>
          <p className="text-sm text-slate-500">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <div className="mx-auto max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-slate-100">
            <LogIn className="h-10 w-10 text-slate-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-700">Not clocked in</p>
            <p className="text-sm text-slate-400">Ready to start your day?</p>
          </div>
          <button
            onClick={punchIn}
            disabled={acting || !canPunchIn || !isWorkingDay}
            className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white shadow-md transition hover:bg-emerald-700 active:scale-95 disabled:opacity-60"
          >
            {acting ? actionText || "Punching In..." : "Punch In"}
          </button>
          {!isWorkingDay ? <p className="text-sm font-medium text-amber-600">Today is not a working day for your shift.</p> : null}
          {!isWorkingDay ? null : !canPunchIn ? (
            <p className="text-sm font-medium text-amber-600">Your shift starts at {shift?.name ?? "Standard shift"}: {shiftStartLabel}</p>
          ) : null}
          <p className="text-xs text-slate-400">Office hours: {shiftStartLabel} - {shiftEndLabel} | Half day after {halfDayLabel} | Expected {expectedHours.toFixed(1)}h</p>
          <p className="text-xs text-slate-400">
            {shift?.is_default ? "Standard shift" : `Your shift: ${shift?.name} (${shiftStartLabel} - ${shiftEndLabel})`}
          </p>
          <p className="text-xs text-slate-400">Your IP address will be recorded.</p>
        </div>
        {renderPastSevenDays()}
      </section>
    );
  }

  const unapprovedTasks = todayTasks.filter((task) => task.status !== "approved");
  const locked = tenant.punch_out_gate_enabled ? unapprovedTasks.length > 0 : false;
  const locationIndicator = getLocationIndicator(attendance.punch_in_location_status);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Punch In / Out</h2>
        <p className="text-sm text-slate-500">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
        <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
        <div>
          <p className="font-semibold text-emerald-700">You are clocked in</p>
          <p className="text-sm text-emerald-600">
            Since {new Date(attendance.punch_in).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            {" | "}<span className="font-mono font-semibold">{elapsed}</span>
          </p>
          <p className={`mt-2 inline-flex items-center gap-2 text-sm ${locationIndicator.textClass}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${locationIndicator.dot}`} />
            {locationIndicator.text}
          </p>
        </div>
        <div className="ml-auto">
          <Clock className="h-8 w-8 text-emerald-300" />
        </div>
      </div>

      {attendance.is_late ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">Today's punch-in was marked as late.</p>
          <p className="mt-1">
            Late arrivals this month: {lateMarkSummary?.late_count ?? "..."} / {lateMarkSummary?.threshold ?? "..."} allowed.
          </p>
        </div>
      ) : null}

      <div className="mx-auto max-w-sm space-y-3 text-center">
        <button
          onClick={() => {
            if (locked) {
              info("You must get HR approval on tasks before punching out.");
            } else {
              void punchOut();
            }
          }}
          disabled={acting}
          className={`w-full rounded-xl py-4 text-lg font-bold text-white shadow-md transition ${
            locked
              ? "cursor-not-allowed bg-slate-300 hover:bg-slate-400"
              : "bg-brand-600 hover:bg-brand-700 active:scale-95"
          } disabled:opacity-80`}
        >
          <span className="flex items-center justify-center gap-2">
            {locked ? <Lock className="h-5 w-5" /> : <LogOut className="h-5 w-5" />}
            {acting ? actionText || "Punching Out..." : "Punch Out"}
          </span>
        </button>

        {locked ? (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="flex items-center justify-center gap-1 text-sm font-semibold text-amber-700">
              <Lock className="h-4 w-4" /> Punch-out locked
            </p>
            <p className="text-xs text-amber-600">Awaiting HR approval of your task submission.</p>
            <Link
              to="/employee/tasks"
              className="inline-block text-xs font-semibold text-brand-600 underline hover:text-brand-800"
            >
              View my tasks
            </Link>
          </div>
        ) : (
          <p className="text-sm text-slate-500">You're free to punch out when ready.</p>
        )}
      </div>

      {todayTasks.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold text-slate-800">Today's Tasks</h3>
          <div className="space-y-2">
            {todayTasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-sm font-medium text-slate-800">{task.title}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${
                  task.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                  task.status === "submitted" ? "bg-purple-100 text-purple-700" :
                  "bg-amber-100 text-amber-700"
                }`}>{task.status.replace("_", " ")}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {renderPastSevenDays()}

      {selectedCorrectionDate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={closeCorrectionModal}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Request Attendance Correction — {formatDateLabel(selectedCorrectionDate)}</h3>
              <p className="mt-1 text-sm text-slate-500">
                Current: Punch-in: {selectedCorrectionEntry?.record?.punch_in ? fmtTime(selectedCorrectionEntry.record.punch_in) : "Missing"}
                {" | "}
                Punch-out: {selectedCorrectionEntry?.record?.punch_out ? fmtTime(selectedCorrectionEntry.record.punch_out) : "Missing"}
              </p>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Corrected punch-in time</span>
                  <input
                    type="time"
                    value={correctionPunchIn}
                    onChange={(event) => setCorrectionPunchIn(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Corrected punch-out time</span>
                  <input
                    type="time"
                    value={correctionPunchOut}
                    onChange={(event) => setCorrectionPunchOut(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
                  />
                </label>
              </div>
              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Reason</span>
                <textarea
                  value={correctionReason}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  placeholder="Please explain why correction is needed"
                  rows={4}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={closeCorrectionModal}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitCorrectionRequest()}
                disabled={correctionSubmitting}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                {correctionSubmitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
