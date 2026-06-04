import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, LogIn, LogOut, Clock, CheckCircle } from "lucide-react";
import type { Attendance, Task } from "../types";
import { db, functions, storage } from "../insforge/client";
import { useAuditLog } from "../hooks/useAuditLog";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { checkGeofence, getCurrentPosition, type LocationStatus } from "../utils/geolocation";
import { useEmployeeShift } from "../hooks/useEmployeeShift";
import { formatLocalDate } from "../utils/date";
import { BLOCKING_TASK_STATUSES } from "../utils/taskConstants";

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

  const [breakTypeModalOpen, setBreakTypeModalOpen] = useState(false);
  const [breakElapsed, setBreakElapsed] = useState("");
  const [breakOvertime, setBreakOvertime] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [activeBreakType, setActiveBreakType] = useState<string | null>(null);
  const breakTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Selfie Verification States
  const [selfieModalOpen, setSelfieModalOpen] = useState(false);
  const [selfieStream, setSelfieStream] = useState<MediaStream | null>(null);
  const [selfieBlob, setSelfieBlob] = useState<Blob | null>(null);
  const [selfiePreviewUrl, setSelfiePreviewUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pendingPunchContext, setPendingPunchContext] = useState<{
    direction: "punch_in" | "punch_out";
    policy: {
      geofenceRequired: boolean;
      selfieRequired: boolean;
      gpsRequired: boolean;
      remoteExceptionId: string | null;
      remoteExceptionType: string | null;
    };
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const startCamera = async () => {
    setCameraError(null);
    setSelfieBlob(null);
    setSelfiePreviewUrl(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      setSelfieStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access error:", err);
      setCameraError("Unable to access camera. Please check permissions.");
    }
  };

  const stopCamera = () => {
    if (selfieStream) {
      selfieStream.getTracks().forEach((track) => track.stop());
      setSelfieStream(null);
    }
  };

  const captureSelfie = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              setSelfieBlob(blob);
              setSelfiePreviewUrl(URL.createObjectURL(blob));
              stopCamera();
            }
          },
          "image/jpeg",
          0.8
        );
      }
    }
  };

  useEffect(() => {
    if (selfieModalOpen) {
      void startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [selfieModalOpen]);

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
  // Gap #3: respect the shift-level punch_in_opens_minutes_before window.
  // Employees can punch in this many minutes BEFORE shift start (default 60).
  const openBeforeMinutes = shift?.punch_in_opens_minutes_before ?? 60;
  const canPunchIn = effectiveCurrentMinutes >= shiftStartTime - openBeforeMinutes;
  const regularizationEnabled = tenantSettings["regularization_enabled"] === "true";
  // Gap #5: read dynamic regularization window from tenant settings (default 7 days).
  const regularizationWindowDays = Math.max(1, parseInt(tenantSettings["regularization_window_days"] || "7", 10));

  const fetchData = async () => {
    if (!employee?.id || !tenantId || !tenant) return;
    try {
      const today = new Date();
      const recentStart = new Date(today);
      // Gap #5: use the dynamically-read window. At render time tenantSettings may
      // not be loaded yet (first render), so we read the raw state here.
      // We default to 7 to match the tenant-settings default.
      const windowDays = Math.max(1, parseInt(tenantSettings["regularization_window_days"] || "7", 10));
      recentStart.setDate(today.getDate() - (windowDays - 1));
      const recentStartDate = formatLocalDate(recentStart);
      const [attRes, todayClosedRes, taskRes, settingsRes, recentAttRes, overtimeRes, correctionsRes] = await Promise.all([
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).eq("session_status", "open").not("punch_in", "is", null).order("punch_in", { ascending: false }).limit(1).maybeSingle(),
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).eq("date", TODAY).eq("session_status", "closed").order("punch_out", { ascending: false }).limit(1).maybeSingle(),
        db.from("tasks").select("*").eq("tenant_id", tenantId).eq("assigned_to", employee.id).lte("due_date", TODAY).in("status", [...BLOCKING_TASK_STATUSES]),
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

      let activeBreak = null;
      if (activeAttendance && activeAttendance.current_break_id) {
        const { data: breakData } = await db
          .from("attendance_breaks")
          .select("break_type")
          .eq("id", activeAttendance.current_break_id)
          .maybeSingle();
        activeBreak = breakData;
      }
      setActiveBreakType(activeBreak ? (activeBreak as { break_type: string }).break_type : null);

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
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (attendance?.current_break_start) {
      const limit = activeBreakType === "lunch" 
        ? (tenant.lunch_break_minutes || 60) 
        : parseInt(tenantSettings["short_break_limit_minutes"] || "15", 10);

      const tickBreak = () => {
        const diff = Date.now() - new Date(attendance.current_break_start!).getTime();
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        
        setBreakElapsed(`${m}m ${s}s`);
        
        if (m >= limit) {
          setBreakOvertime(m - limit);
        } else {
          setBreakOvertime(0);
        }
      };
      tickBreak();
      breakTimerRef.current = setInterval(tickBreak, 1000);
    } else {
      setBreakElapsed("");
      setBreakOvertime(0);
    }
    return () => {
      if (breakTimerRef.current) clearInterval(breakTimerRef.current);
    };
  }, [attendance?.current_break_start, activeBreakType, tenant.lunch_break_minutes, tenantSettings]);

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

  interface PunchRequirements {
    geofenceRequired: boolean;
    selfieRequired: boolean;
    gpsRequired: boolean;
    remoteExceptionId: string | null;
    remoteExceptionType: string | null;
  }

  const determinePunchPolicy = async (direction: "punch_in" | "punch_out"): Promise<PunchRequirements> => {
    const remoteWorkHandling = tenantSettings["remote_work_handling"] || "hr_approved_exceptions";
    const selfieModeSetting = tenantSettings["attendance_selfie_mode"] || "disabled";
    
    let geofenceRequired = true;
    let remoteExceptionId: string | null = null;
    let remoteExceptionType: string | null = null;
    
    if (remoteWorkHandling === "always_allowed") {
      geofenceRequired = false;
    } else if (remoteWorkHandling === "hr_approved_exceptions") {
      const workMode = employee?.work_mode || "office";
      if (workMode === "remote") {
        geofenceRequired = false;
      } else if (workMode === "hybrid" || workMode === "office") {
        const { data: activeExceptions } = await db
          .from("attendance_location_exceptions")
          .select("id, exception_type")
          .eq("tenant_id", tenantId)
          .eq("employee_id", employee.id)
          .eq("status", "approved")
          .lte("start_date", TODAY)
          .gte("end_date", TODAY)
          .limit(1)
          .maybeSingle();
        
        if (activeExceptions) {
          geofenceRequired = false;
          remoteExceptionId = activeExceptions.id;
          remoteExceptionType = activeExceptions.exception_type;
        }
      }
    } else {
      geofenceRequired = true;
    }
    
    let selfieRequired = false;
    if (selfieModeSetting === "both") {
      selfieRequired = true;
    } else if (selfieModeSetting === "punch_in" && direction === "punch_in") {
      selfieRequired = true;
    } else if (selfieModeSetting === "punch_out" && direction === "punch_out") {
      selfieRequired = true;
    }
    
    const gpsRequired = geofenceRequired || (tenantSettings["gps_verification_mode"] || "warn") !== "disabled";
    
    return {
      geofenceRequired,
      selfieRequired,
      gpsRequired,
      remoteExceptionId,
      remoteExceptionType,
    };
  };

  const handlePunchClick = async (direction: "punch_in" | "punch_out") => {
    if (!employee?.id || !tenantId || !tenant || acting) return;
    
    setActing(true);
    setActionText("Checking punch policy...");
    
    try {
      const policy = await determinePunchPolicy(direction);
      
      setPendingPunchContext({
        direction,
        policy,
      });
      
      if (policy.selfieRequired) {
        setSelfieModalOpen(true);
        setActionText("");
      } else {
        await executePunchWorkflow(direction, policy, null);
      }
    } catch (err) {
      console.error("Policy check failed", err);
      error("Failed to initiate punch flow.");
      setActing(false);
      setActionText("");
    }
  };

  const handleSelfieUpload = async (
    attendanceId: string,
    type: "punch_in" | "punch_out",
    selfieBlob: Blob
  ) => {
    const filePath = `${tenantId}/${employee.id}/${attendanceId}/${type}.jpg`;
    
    const { data: uploadData, error: uploadError } = await storage
      .from("attendance-selfies")
      .upload(filePath, selfieBlob);
      
    if (uploadError) {
      console.error("Selfie upload failed:", uploadError);
      await db
        .from("attendance")
        .update({ location_status: "selfie_missing" })
        .eq("tenant_id", tenantId)
        .eq("id", attendanceId);
      void logAction("attendance.selfie_missing", "attendance", attendanceId, { error: uploadError.message });
      return;
    }
    
    const { error: selfieDbErr } = await db
      .from("attendance_selfies")
      .insert([{
        attendance_id: attendanceId,
        tenant_id: tenantId,
        employee_id: employee.id,
        type,
        storage_path: uploadData.key,
      }]);
      
    if (selfieDbErr) {
      console.error("Selfie DB link failed:", selfieDbErr);
      await storage.from("attendance-selfies").remove(uploadData.key);
      return;
    }
    
    void logAction("attendance.selfie_uploaded", "attendance", attendanceId, { type });
  };

  const executePunchWorkflow = async (
    direction: "punch_in" | "punch_out",
    policy: PunchRequirements,
    selfieBlob: Blob | null
  ) => {
    setActionText("Getting location...");
    
    const gpsMode = tenantSettings["gps_verification_mode"] || "warn";
    const highConfMax = Number(tenantSettings["high_confidence_max"] || 50);
    const medConfMax = Number(tenantSettings["medium_confidence_max"] || 150);
    const lowConfMax = Number(tenantSettings["low_confidence_max"] || 300);
    
    const officeLat = parseFloat(tenantSettings["office_lat"] || "0");
    const officeLng = parseFloat(tenantSettings["office_lng"] || "0");
    const radiusMeters = parseInt(tenantSettings["geofence_radius_meters"] || "500", 10);
    
    let lat: number | null = null;
    let lng: number | null = null;
    let accuracy: number | null = null;
    let confidence: "high" | "medium" | "low" | "very_low" | null = null;
    let status: "office_verified" | "remote_approved" | "outside_geofence" | "gps_low_confidence" | "gps_denied" | "gps_unavailable" | "manual_override" | "selfie_missing" | null = null;
    
    let gpsCaptured = false;
    let gpsErrorReason: string | null = null;
    
    const shouldPromptGps = policy.geofenceRequired || gpsMode !== "disabled";
    
    if (shouldPromptGps) {
      try {
        const position = await getCurrentPosition();
        lat = position.lat;
        lng = position.lng;
        accuracy = position.accuracy;
        gpsCaptured = true;
        
        if (accuracy <= highConfMax) confidence = "high";
        else if (accuracy <= medConfMax) confidence = "medium";
        else if (accuracy <= lowConfMax) confidence = "low";
        else confidence = "very_low";
        
        if (confidence === "low" || confidence === "very_low") {
          void logAction("attendance.gps_low_confidence", "attendance", null, {
            accuracy,
            confidence,
            direction
          });
        }
      } catch (geoError) {
        console.error("GPS capture failed:", geoError);
        gpsCaptured = false;
        if (geoError instanceof Error && geoError.message === "DENIED") {
          gpsErrorReason = "denied";
          void logAction("attendance.gps_denied", "attendance", null, { direction });
        } else {
          gpsErrorReason = "unavailable";
          void logAction("attendance.gps_unavailable", "attendance", null, { direction });
        }
      }
    }
    
    if (!policy.geofenceRequired) {
      status = "remote_approved";
    } else {
      if (gpsMode === "disabled") {
        status = "office_verified";
      } else if (!gpsCaptured) {
        if (gpsMode === "strict") {
          error("Punch blocked: Location access is required in strict mode.");
          setActing(false);
          setActionText("");
          return;
        } else {
          status = gpsErrorReason === "denied" ? "gps_denied" : "gps_unavailable";
        }
      } else {
        const fenceResult = checkGeofence(lat!, lng!, officeLat, officeLng, radiusMeters);
        if (fenceResult.inside) {
          status = "office_verified";
        } else {
          if (gpsMode === "strict") {
            error(`Punch blocked: You are ${fenceResult.distanceMeters}m outside the designated office area.`);
            void logAction("geofence_blocked", "attendance", null, {
              reason: "outside_radius",
              direction,
              distance_meters: fenceResult.distanceMeters,
              radius_meters: radiusMeters,
              severity: "WARNING",
            });
            setActing(false);
            setActionText("");
            return;
          } else {
            status = "outside_geofence";
            toast(`Recorded punch outside office area (${fenceResult.distanceMeters}m).`, "info");
          }
        }
      }
    }
    
    const isSelfieMissing = policy.selfieRequired && !selfieBlob;
    if (isSelfieMissing) {
      status = "selfie_missing";
    }
    
    const verificationSnapshot = {
      accuracy,
      confidence,
      work_mode: employee?.work_mode || "office",
      gps_mode: gpsMode,
      selfie_required: policy.selfieRequired,
      selfie_captured: !!selfieBlob,
      exception_id: policy.remoteExceptionId,
      exception_type: policy.remoteExceptionType,
      geofence_required: policy.geofenceRequired,
      office_lat: officeLat,
      office_lng: officeLng,
      geofence_radius: radiusMeters,
      gps_captured: gpsCaptured,
      gps_error_reason: gpsErrorReason,
    };
    
    setActionText(direction === "punch_in" ? "Clocking In..." : "Clocking Out...");
    try {
      if (direction === "punch_in") {
        await runPunchInDb(lat, lng, accuracy, status, confidence, policy.remoteExceptionId, verificationSnapshot, selfieBlob);
      } else {
        await runPunchOutDb(lat, lng, accuracy, status, confidence, policy.remoteExceptionId, verificationSnapshot, selfieBlob);
      }
    } catch (err) {
      console.error("Punch database error:", err);
      error("Failed to complete punch.");
    } finally {
      setActing(false);
      setActionText("");
      setSelfieModalOpen(false);
      setPendingPunchContext(null);
      setSelfieBlob(null);
      setSelfiePreviewUrl(null);
    }
  };

  const runPunchInDb = async (
    lat: number | null,
    lng: number | null,
    accuracy: number | null,
    status: string | null,
    confidence: string | null,
    remoteExceptionId: string | null,
    verificationSnapshot: Record<string, any>,
    selfieBlob: Blob | null
  ) => {
    try {
      await db.rpc("close_stale_attendance");
    } catch (err) {
      console.error("Failed to auto-close stale sessions", err);
    }

    const ip = await getIp();
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
    
    const unapprovedTasks = todayTasks.filter((task) => BLOCKING_TASK_STATUSES.includes(task.status as any));
    const allowed = tenant.punch_out_gate_enabled ? unapprovedTasks.length === 0 : true;
    
    const gracePeriodMinutes =
      shift?.late_mark_grace_override != null
        ? shift.late_mark_grace_override
        : parseInt(tenantSettings["late_mark_grace_minutes"] || "0", 10);
    const elapsedSinceShiftStartMinutes = (now.getTime() - shiftStartDate.getTime()) / 60000;
    const lateMarkFeatureEnabled = tenantSettings["late_mark_enabled"] === "true";
    const isLate = lateMarkFeatureEnabled && elapsedSinceShiftStartMinutes > gracePeriodMinutes;
    
    const { data: inserted, error: dbErr } = await db.from("attendance").insert([{
      employee_id: employee.id,
      tenant_id: tenantId,
      date: TODAY,
      punch_in_ip: ip,
      punch_out_allowed: allowed,
      status: isHalfDay ? "half_day" : "present",
      session_status: "open",
      punch_in_lat: lat,
      punch_in_lng: lng,
      punch_in_location_accuracy: accuracy,
      punch_in_location_status: status === "selfie_missing" ? "selfie_missing" : status,
      location_accuracy: accuracy,
      location_confidence: confidence,
      location_status: status,
      remote_exception_id: remoteExceptionId,
      verification_snapshot: verificationSnapshot,
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
    
    const attendanceId = inserted?.id;
    
    if (selfieBlob && attendanceId) {
      await handleSelfieUpload(attendanceId, "punch_in", selfieBlob);
    } else if (!selfieBlob && verificationSnapshot.selfie_required) {
      void logAction("attendance.selfie_missing", "attendance", attendanceId);
    }
    
    void logAction("punch_in", "attendance", attendanceId);
    success("Punched in successfully!");
    void fetchData();
  };

  const runPunchOutDb = async (
    lat: number | null,
    lng: number | null,
    accuracy: number | null,
    status: string | null,
    confidence: string | null,
    remoteExceptionId: string | null,
    verificationSnapshot: Record<string, any>,
    selfieBlob: Blob | null
  ) => {
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
      p_attendance_id: attendance!.id,
      p_tenant_id: tenantId,
      p_lat: lat,
      p_lng: lng,
      p_acc: accuracy,
      p_loc_status: status === "selfie_missing" ? "selfie_missing" : (status || "unavailable"),
      p_lunch_minutes: tenant.lunch_break_minutes || 0,
      p_overtime_enabled: overtimeEnabled,
      p_overtime_rate: overtimeRate,
      p_expected_shift_hours: parseFloat(expectedShiftHours.toFixed(2))
    });
    
    if (dbErr) throw dbErr;
    if (data && data.success === false) {
      throw data;
    }
    
    const { error: updateErr } = await db
      .from("attendance")
      .update({
        location_accuracy: accuracy,
        location_confidence: confidence,
        location_status: status,
        remote_exception_id: remoteExceptionId,
        verification_snapshot: verificationSnapshot,
      })
      .eq("tenant_id", tenantId)
      .eq("id", attendance!.id);
      
    if (updateErr) {
      console.error("Failed to update punch-out verification columns", updateErr);
    }
    
    const workHoursReturned = data?.work_hours ?? 0;
    
    if (selfieBlob) {
      await handleSelfieUpload(attendance!.id, "punch_out", selfieBlob);
    } else if (!selfieBlob && verificationSnapshot.selfie_required) {
      void logAction("attendance.selfie_missing", "attendance", attendance!.id);
    }
    
    void logAction("punch_out", "attendance", attendance!.id, {
      work_hours: workHoursReturned,
      expected_hours: Number(expectedHours.toFixed(2)),
    });
    success("Punched out successfully! Have a great day!");
    void fetchData();
  };

  async function startBreak(breakType: string) {
    if (!attendance?.id || !tenantId || acting || !isOnline) return;
    setActing(true);
    setActionText("Starting Break...");
    try {
      const { error: rpcError } = await db.rpc("start_employee_break", {
        p_attendance_id: attendance.id,
        p_tenant_id: tenantId,
        p_break_type: breakType,
      });

      if (rpcError) throw rpcError;

      success(`Break started: ${breakType.replace("_", " ")}`);
      setBreakTypeModalOpen(false);
      void fetchData();
    } catch (err: any) {
      console.error(err);
      const msg = err.message || "Failed to start break.";
      error(msg);
    } finally {
      setActing(false);
      setActionText("");
    }
  }

  async function endBreak() {
    if (!attendance?.id || !tenantId || acting || !isOnline) return;
    setActing(true);
    setActionText("Ending Break...");
    try {
      const { error: rpcError } = await db.rpc("end_employee_break", {
        p_attendance_id: attendance.id,
        p_tenant_id: tenantId,
      });

      if (rpcError) throw rpcError;

      success("Break ended successfully.");
      void fetchData();
    } catch (err: any) {
      console.error(err);
      const msg = err.message || "Failed to end break.";
      error(msg);
    } finally {
      setActing(false);
      setActionText("");
    }
  }

  // Gap #5: use the tenant-configured window, not a hard-coded 7.
  const recentDays = Array.from({ length: regularizationWindowDays }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const dateStr = formatLocalDate(date);
    const record = recentAttendance.find((item) => item.date === dateStr) ?? null;
    const correction = correctionByDate[dateStr];
    const workingDay = shift ? shift.working_days.includes(date.getDay()) : true;
    let issueLabel: string | null = null;

    if ((!record || record.status === "absent") && workingDay) {
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
        {/* Gap #5: heading reflects the actual policy window */}
        <h3 className="font-semibold text-slate-800">Past {regularizationWindowDays} Day{regularizationWindowDays !== 1 ? "s" : ""}</h3>
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
  }  let mainContent: React.ReactNode;

  if (attendance?.status === "on_leave") {
    mainContent = (
      <div className="mx-auto max-w-sm rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center shadow-sm">
        <CheckCircle className="mx-auto mb-3 h-14 w-14 text-emerald-500" />
        <h3 className="mb-1 text-xl font-bold text-emerald-700">On Leave</h3>
        <p className="mb-4 text-slate-600">Enjoy your time off! No punch-in required today.</p>
      </div>
    );
  } else if (attendance?.status === "absent") {
    mainContent = (
      <div className="mx-auto max-w-sm rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center shadow-sm">
        <CheckCircle className="mx-auto mb-3 h-14 w-14 text-rose-500" />
        <h3 className="mb-1 text-xl font-bold text-rose-700">Marked Absent</h3>
        <p className="mb-4 text-slate-600">You have been marked absent for today.</p>
        {regularizationEnabled && !correctionByDate[TODAY] ? (
          <button
            type="button"
            onClick={() => openCorrectionModal(TODAY)}
            className="w-full mt-2 rounded-xl border border-brand-200 bg-white py-3 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
          >
            Request Regularization
          </button>
        ) : correctionByDate[TODAY]?.status === "pending" ? (
          <p className="mt-2 text-xs font-semibold text-amber-700">Correction request pending</p>
        ) : null}
      </div>
    );
  } else if (attendance?.punch_out) {
    const h = Math.floor(attendance.work_hours ?? 0);
    const m = Math.round(((attendance.work_hours ?? 0) - h) * 60);
    const locationIndicator = getLocationIndicator(attendance.punch_in_location_status);
    const todayOvertime = overtimeByDate[TODAY];

    mainContent = (
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
    );
  } else if (!attendance) {
    const shiftStartLabel = formatTimeLabel(shift?.start_time ?? tenant.punch_in_start);
    const shiftEndLabel = formatTimeLabel(shift?.end_time ?? tenant.punch_in_cutoff);
    const halfDayLabel = formatTimeLabel(halfDayCutoff);

    mainContent = (
      <div className="mx-auto max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-slate-100">
          <LogIn className="h-10 w-10 text-slate-400" />
        </div>
        <div>
          <p className="text-lg font-semibold text-slate-700">Not clocked in</p>
          <p className="text-sm text-slate-400">Ready to start your day?</p>
        </div>
        <button
          onClick={() => handlePunchClick("punch_in")}
          disabled={acting || !canPunchIn || !isWorkingDay}
          className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white shadow-md transition hover:bg-emerald-700 active:scale-95 disabled:opacity-60"
        >
          {acting ? actionText || "Punching In..." : "Punch In"}
        </button>
        {!isWorkingDay ? <p className="text-sm font-medium text-amber-600">Today is not a working day for your shift.</p> : null}
        {!isWorkingDay ? null : !canPunchIn ? (
          <p className="text-sm font-medium text-amber-600">
            Punch-in opens {openBeforeMinutes > 0 ? `${openBeforeMinutes} min before` : "at"} your shift start ({shiftStartLabel}).
          </p>
        ) : null}
        <p className="text-xs text-slate-400">Office hours: {shiftStartLabel} - {shiftEndLabel} | Half day after {halfDayLabel} | Expected {expectedHours.toFixed(1)}h</p>
        <p className="text-xs text-slate-400">
          {shift?.is_default ? "Standard shift" : `Your shift: ${shift?.name} (${shiftStartLabel} - ${shiftEndLabel})`}
        </p>
        <p className="text-xs text-slate-400">Your IP address will be recorded.</p>
      </div>
    );
  } else {
    const unapprovedTasks = todayTasks.filter((task) => BLOCKING_TASK_STATUSES.includes(task.status as any));
    const locked = tenant.punch_out_gate_enabled ? unapprovedTasks.length > 0 : false;
    const locationIndicator = getLocationIndicator(attendance.punch_in_location_status);

    mainContent = (
      <>
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

        {tenantSettings["break_tracking_enabled"] === "true" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Break Tracker</h3>
              <span className="text-xs text-slate-500 capitalize">
                Deduction mode: {tenantSettings["break_deduction_mode"] === "actual" ? "Actual tracked" : "Fixed lunch time"}
              </span>
            </div>

            {!attendance.current_break_id ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">You are not currently on a break. You can start a break below.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBreakTypeModalOpen(true)}
                    disabled={acting || !isOnline}
                    className="flex-1 rounded-xl bg-slate-100 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 active:scale-95 disabled:opacity-60"
                  >
                    Start Break
                  </button>
                </div>
                {!isOnline && <p className="text-xs text-rose-500 font-semibold text-center">You must be online to start or end breaks.</p>}
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-ping" />
                    <p className="font-semibold text-amber-700 capitalize">On Break: {activeBreakType?.replace("_", " ")}</p>
                  </div>
                  <p className="font-mono font-bold text-amber-700 text-lg">{breakElapsed}</p>
                </div>

                {breakOvertime > 0 && (
                  <p className="text-xs font-semibold text-rose-600 animate-pulse">
                    Exceeded limit by {breakOvertime} min{breakOvertime !== 1 ? "s" : ""}!
                  </p>
                )}

                <button
                  onClick={endBreak}
                  disabled={acting || !isOnline}
                  className="w-full rounded-xl bg-amber-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-amber-700 active:scale-95 disabled:opacity-60"
                >
                  {acting ? actionText || "Ending Break..." : "End Break"}
                </button>
                {!isOnline && <p className="text-xs text-rose-500 font-semibold text-center">You must be online to start or end breaks.</p>}
              </div>
            )}

            <div className="text-xs text-slate-500 space-y-1">
              <p>Total break minutes recorded today: <span className="font-bold text-slate-700">{attendance.total_break_minutes || 0} mins</span></p>
              {tenantSettings["break_deduction_mode"] !== "actual" && (
                <p className="text-slate-400">Note: In Fixed Mode, the system automatically deducts {tenant.lunch_break_minutes || 60} mins if you work for 5+ hours, regardless of break duration.</p>
              )}
            </div>
          </div>
        )}

        <div className="mx-auto max-w-sm space-y-3 text-center">
          <button
            onClick={() => {
              if (locked) {
                info("You must get HR approval on tasks before punching out.");
              } else {
                void handlePunchClick("punch_out");
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
              <p className="text-xs text-amber-600">
                {unapprovedTasks.length} task{unapprovedTasks.length > 1 ? "s" : ""} need HR approval before you can punch out.
              </p>
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
                    task.status === "overdue" ? "bg-red-100 text-red-700" :
                    task.status === "rejected" ? "bg-rose-100 text-rose-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>{task.status.replace("_", " ")}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Punch In / Out</h2>
        <p className="text-sm text-slate-500">
          {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {mainContent}

      {renderPastSevenDays()}

      {selectedCorrectionDate && (
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
      )}

      {breakTypeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => setBreakTypeModalOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl space-y-4" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 text-center">Select Break Type</h3>
            <div className="grid gap-2">
              <button
                onClick={() => startBreak("lunch")}
                className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-95"
              >
                Lunch Break ({tenant.lunch_break_minutes || 60} mins policy)
              </button>
              <button
                onClick={() => startBreak("short_break")}
                className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-95"
              >
                Short Break ({tenantSettings["short_break_limit_minutes"] || 15} mins policy)
              </button>
              <button
                onClick={() => startBreak("tea_break")}
                className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-95"
              >
                Tea Break ({tenantSettings["short_break_limit_minutes"] || 15} mins policy)
              </button>
            </div>
            <button
              onClick={() => setBreakTypeModalOpen(false)}
              className="w-full rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-600 py-2 text-center"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selfieModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4 relative" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 text-center">
              Selfie Verification Required
            </h3>
            
            {cameraError ? (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-center">
                <p className="text-sm font-medium text-rose-800">{cameraError}</p>
                <button
                  onClick={startCamera}
                  className="mt-3 text-xs font-semibold text-brand-600 underline hover:text-brand-800"
                >
                  Try Again
                </button>
              </div>
            ) : selfiePreviewUrl ? (
              <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shadow-inner flex items-center justify-center">
                <img src={selfiePreviewUrl} alt="Selfie Preview" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-slate-950 shadow-inner flex items-center justify-center">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 border-2 border-dashed border-white/30 rounded-xl pointer-events-none m-4" />
              </div>
            )}
            
            <div className="space-y-2">
              {!selfiePreviewUrl && !cameraError && (
                <button
                  onClick={captureSelfie}
                  className="w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700 active:scale-95"
                >
                  Capture Photo
                </button>
              )}
              
              {selfiePreviewUrl && (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelfieBlob(null);
                      setSelfiePreviewUrl(null);
                      void startCamera();
                    }}
                    className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition active:scale-95"
                  >
                    Retake
                  </button>
                  <button
                    onClick={() => {
                      if (pendingPunchContext) {
                        void executePunchWorkflow(
                          pendingPunchContext.direction,
                          pendingPunchContext.policy,
                          selfieBlob
                        );
                      }
                    }}
                    className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95"
                  >
                    Confirm & Punch
                  </button>
                </div>
              )}
              
              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  onClick={() => {
                    stopCamera();
                    setSelfieModalOpen(false);
                    setSelfieBlob(null);
                    setSelfiePreviewUrl(null);
                    setCameraError(null);
                    setActing(false);
                  }}
                  className="flex-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-600 py-2 text-center"
                >
                  Cancel Punch
                </button>
                <button
                  onClick={() => {
                    stopCamera();
                    setSelfieModalOpen(false);
                    setCameraError(null);
                    if (pendingPunchContext) {
                      void executePunchWorkflow(
                        pendingPunchContext.direction,
                        pendingPunchContext.policy,
                        null
                      );
                    }
                  }}
                  className="flex-1 rounded-lg text-xs font-semibold text-amber-600 hover:text-amber-700 py-2 text-center"
                >
                  Skip / Camera Unavailable
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
