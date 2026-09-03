import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import { Skeleton } from "../shared/Skeleton";
import { useToast } from "../shared/ToastContext";
import { getTenantDate } from "../utils/date";
import {
  WorkspaceShell,
  WorkspaceStats,
  WorkspaceSection,
  WorkspaceEmpty,
  type WorkspaceStat,
} from "./components/WorkspaceShell";

/**
 * The attendance module's own surface: is the module working, and what needs a human.
 *
 * Deliberately NOT a copy of /hr/dashboard, which is cross-module and answers "how is the company".
 * The gap this fills is the one the 2026-09-02 audit kept hitting — attendance could be silently
 * not running (no shifts, or a failed derivation) and nothing in the product said so.
 */

type DerivationRun = {
  status: string;
  error_count: number;
  finished_at: string | null;
  started_at: string;
  trigger: string;
};

type CorrectionRow = {
  id: string;
  employee_id: string;
  attendance_date: string;
  reason: string | null;
  created_at: string;
};

type DeviceRow = { id: string; name: string; last_seen_at: string | null; is_active: boolean };

function relativeHours(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function ago(iso: string | null): string {
  const hours = relativeHours(iso);
  if (hours === null) return "never";
  if (hours < 1) return "under an hour ago";
  if (hours < 48) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AttendanceWorkspace() {
  const { tenantId, tenant } = useTenant();
  const { error: toastError } = useToast();
  const [loading, setLoading] = useState(true);

  const [lastRun, setLastRun] = useState<DerivationRun | null>(null);
  const [shiftCount, setShiftCount] = useState(0);
  const [hasDefaultShift, setHasDefaultShift] = useState(false);
  const [activeEmployees, setActiveEmployees] = useState(0);
  const [assignedEmployees, setAssignedEmployees] = useState(0);
  const [todayRows, setTodayRows] = useState<{ punch_in: string | null; punch_out: string | null }[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});

  const today = useMemo(() => getTenantDate(tenant?.timezone || "UTC"), [tenant?.timezone]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [runsRes, shiftsRes, employeesRes, assignmentsRes, todayRes, correctionsRes, devicesRes] =
        await Promise.all([
          db.from("attendance_derivation_runs").select("status,error_count,finished_at,started_at,trigger")
            .eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(1),
          db.from("shifts").select("id,is_default").eq("tenant_id", tenantId).eq("is_active", true),
          db.from("employees").select("id,full_name").eq("tenant_id", tenantId).eq("status", "active"),
          db.from("employee_shifts").select("employee_id").eq("tenant_id", tenantId)
            .lte("effective_from", today).or(`effective_to.is.null,effective_to.gte.${today}`),
          db.from("attendance").select("punch_in,punch_out").eq("tenant_id", tenantId).eq("date", today),
          db.from("attendance_corrections").select("id,employee_id,attendance_date,reason,created_at")
            .eq("tenant_id", tenantId).eq("status", "pending").order("created_at", { ascending: true }).limit(6),
          db.from("attendance_devices").select("id,name,last_seen_at,is_active").eq("tenant_id", tenantId),
        ]);

      const shifts = (shiftsRes.data ?? []) as { id: string; is_default: boolean | null }[];
      const employees = (employeesRes.data ?? []) as { id: string; full_name: string }[];

      setLastRun(((runsRes.data ?? []) as DerivationRun[])[0] ?? null);
      setShiftCount(shifts.length);
      setHasDefaultShift(shifts.some((s) => s.is_default));
      setActiveEmployees(employees.length);
      setEmployeeNames(Object.fromEntries(employees.map((e) => [e.id, e.full_name])));
      setAssignedEmployees(
        new Set(((assignmentsRes.data ?? []) as { employee_id: string }[]).map((r) => r.employee_id)).size,
      );
      setTodayRows((todayRes.data ?? []) as { punch_in: string | null; punch_out: string | null }[]);
      setCorrections((correctionsRes.data ?? []) as CorrectionRow[]);
      setDevices((devicesRes.data ?? []) as DeviceRow[]);
    } catch (err) {
      console.error("AttendanceWorkspace load:", err);
      toastError("Failed to load the attendance overview.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, today, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo<WorkspaceStat[]>(() => {
    const punchedIn = todayRows.filter((r) => r.punch_in && !r.punch_out).length;
    const completed = todayRows.filter((r) => r.punch_in && r.punch_out).length;
    // A default shift covers everyone without an explicit assignment, so "uncovered" only means
    // something when the tenant has no default.
    const uncovered = hasDefaultShift ? 0 : Math.max(0, activeEmployees - assignedEmployees);

    const runHours = relativeHours(lastRun?.finished_at ?? null);
    const runFailed = lastRun ? lastRun.status === "failed" || lastRun.error_count > 0 : false;

    return [
      {
        label: "Derivation",
        value: shiftCount === 0 ? "Not running" : !lastRun ? "Never run" : runFailed ? "Failing" : "Healthy",
        tone: shiftCount === 0 || runFailed ? "bad" : !lastRun || (runHours !== null && runHours > 3) ? "warn" : "good",
        hint:
          shiftCount === 0
            ? "No active shift — the hourly run skips this organisation"
            : lastRun
              ? `Last run ${ago(lastRun.finished_at ?? lastRun.started_at)}`
              : "Configured but has never run",
        href: shiftCount === 0 ? "/hr/shifts" : undefined,
      },
      { label: "Currently punched in", value: punchedIn, hint: `${completed} completed today`, href: "/hr/attendance" },
      {
        label: "Shift coverage",
        value: uncovered === 0 ? "Complete" : `${uncovered} uncovered`,
        tone: uncovered === 0 ? "good" : "warn",
        hint: uncovered === 0 ? `${shiftCount} active shift${shiftCount === 1 ? "" : "s"}` : "They fall back to default punch rules",
        href: "/hr/shifts",
      },
      {
        label: "Corrections waiting",
        value: corrections.length,
        tone: corrections.length > 0 ? "warn" : "good",
        hint: corrections.length > 0 ? "Needs HR review" : "Nothing pending",
        href: "/hr/attendance",
      },
    ];
  }, [activeEmployees, assignedEmployees, corrections.length, hasDefaultShift, lastRun, shiftCount, todayRows]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const staleDevices = devices.filter((d) => d.is_active && (relativeHours(d.last_seen_at) ?? Infinity) > 24);

  return (
    <WorkspaceShell
      title="Attendance"
      subtitle="Whether the module is running, and what needs you today."
      actions={
        <Link to="/hr/attendance" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700">
          Open attendance
        </Link>
      }
    >
      <WorkspaceStats stats={stats} />

      {shiftCount === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Attendance is not being derived.</p>
          <p className="mt-1 text-xs text-amber-700">
            The hourly run only processes organisations with at least one active shift. Punches are
            still recorded, but they are never turned into a day's attendance.{" "}
            <Link to="/hr/shifts" className="font-semibold underline">Create a shift</Link> to start.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkspaceSection
          title="Corrections waiting for review"
          action={<Link to="/hr/attendance" className="text-xs font-semibold text-brand-700 hover:text-brand-800">Review all →</Link>}
        >
          {corrections.length === 0 ? (
            <WorkspaceEmpty>No correction requests pending.</WorkspaceEmpty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {corrections.map((correction) => (
                <li key={correction.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {employeeNames[correction.employee_id] ?? "Unknown employee"}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {correction.attendance_date}
                      {correction.reason ? ` — ${correction.reason}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{ago(correction.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </WorkspaceSection>

        <WorkspaceSection
          title="Devices"
          action={<Link to="/hr/devices" className="text-xs font-semibold text-brand-700 hover:text-brand-800">Manage →</Link>}
        >
          {devices.length === 0 ? (
            <WorkspaceEmpty>No kiosk or biometric device registered.</WorkspaceEmpty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {devices.map((device) => {
                const stale = device.is_active && (relativeHours(device.last_seen_at) ?? Infinity) > 24;
                return (
                  <li key={device.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${!device.is_active ? "bg-slate-300" : stale ? "bg-amber-500" : "bg-emerald-500"}`} />
                      <p className="truncate text-sm font-medium text-slate-800">{device.name}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-500">
                      {device.is_active ? ago(device.last_seen_at) : "inactive"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {staleDevices.length > 0 ? (
            <p className="mt-2 text-xs text-amber-700">
              {staleDevices.length} active device{staleDevices.length === 1 ? " has" : "s have"} not reported in over a day.
            </p>
          ) : null}
        </WorkspaceSection>
      </div>
    </WorkspaceShell>
  );
}
