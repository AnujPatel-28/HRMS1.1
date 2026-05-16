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

const TODAY = new Date().toISOString().slice(0, 10);

export default function PunchInOut() {
  const { employee } = useEmployee();
  const { tenant, tenantId } = useTenant();
  const { logAction } = useAuditLog();
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [elapsed, setElapsed] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { success, error, info } = useToast();

  const [startHour, startMin] = (tenant?.punch_in_start ?? "09:00").split(":").map(Number);
  const [cutoffHour, cutoffMin] = (tenant?.punch_in_cutoff ?? "10:30").split(":").map(Number);
  const currentTime = new Date();
  const canPunchIn = currentTime.getHours() > startHour || (currentTime.getHours() === startHour && currentTime.getMinutes() >= startMin);

  const fetchData = async () => {
    if (!employee?.id || !tenantId || !tenant) return;
    try {
      const [attRes, taskRes] = await Promise.all([
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).eq("date", TODAY).maybeSingle(),
        db.from("tasks").select("*").eq("tenant_id", tenantId).eq("assigned_to", employee.id).eq("due_date", TODAY),
      ]);
      setAttendance(attRes.data as Attendance | null);
      setTodayTasks((taskRes.data ?? []) as Task[]);
    } catch (err) {
      error("Failed to load attendance data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, [employee?.id, tenantId, tenant]);

  // Live timer
  useEffect(() => {
    if (attendance?.punch_in && !attendance.punch_out) {
      const tick = () => {
        const diff = Date.now() - new Date(attendance.punch_in!).getTime();
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setElapsed(`${h}h ${m}m ${s}s`);
      };
      tick();
      timerRef.current = setInterval(tick, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [attendance?.punch_in, attendance?.punch_out]);

  async function getIp(): Promise<string> {
    try {
      const res = await fetch("https://api.ipify.org?format=json");
      const { ip } = await res.json();
      return ip as string;
    } catch { return "unknown"; }
  }

  async function punchIn() {
    if (!employee?.id || !tenantId || !tenant || acting || !canPunchIn) return;
    setActing(true);
    try {
      const ip = await getIp();
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const isHalfDay = hour > cutoffHour || (hour === cutoffHour && minute > cutoffMin);
      const unapprovedTasks = todayTasks.filter(t => t.status !== "approved");
      const allowed = tenant.punch_out_gate_enabled ? unapprovedTasks.length === 0 : true;

      const { data: inserted, error: dbErr } = await db.from("attendance").insert([{
        employee_id: employee.id,
        tenant_id: tenantId,
        date: TODAY,
        punch_in: now.toISOString(),
        punch_in_ip: ip,
        punch_out_allowed: allowed,
        status: isHalfDay ? "half_day" : "present",
      }]).select("id").single();

      if (dbErr) throw dbErr;
      
      void logAction("punch_in", "attendance", inserted?.id);
      success("Punched in successfully!");
      void fetchData();
    } catch (err) {
      error("Failed to punch in.");
      console.error(err);
    } finally {
      setActing(false);
    }
  }

  async function punchOut() {
    if (!attendance?.id || !attendance.punch_in || !tenant || acting) return;
    setActing(true);
    try {
      const now = new Date();
      const punchInTime = new Date(attendance.punch_in);
      const rawHours = (now.getTime() - punchInTime.getTime()) / 3600000;
      const workHours = Math.max(0, rawHours - (tenant.lunch_break_minutes / 60));
      
      const { error: dbErr } = await db.from("attendance").update({
        punch_out: now.toISOString(),
        work_hours: parseFloat(workHours.toFixed(2)),
      }).eq("tenant_id", tenantId).eq("id", attendance.id);

      if (dbErr) throw dbErr;

      void logAction("punch_out", "attendance", attendance.id, { work_hours: parseFloat(workHours.toFixed(2)) });
      success("Punched out successfully! Have a great day!");
      void fetchData();
    } catch (err) {
      error("Failed to punch out.");
      console.error(err);
    } finally {
      setActing(false);
    }
  }

  if (loading || !tenant) return (
    <section className="space-y-6">
      <Skeleton className="h-12 w-48" />
      <Skeleton className="h-64 w-full max-w-sm mx-auto rounded-2xl" />
    </section>
  );

  // State 4: Already punched out
  if (attendance?.punch_out) {
    const h = Math.floor((attendance.work_hours ?? 0));
    const m = Math.round(((attendance.work_hours ?? 0) - h) * 60);
    return (
      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Punch In / Out</h2>
          <p className="text-sm text-slate-500">{TODAY}</p>
        </div>
        <div className="max-w-sm mx-auto rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center shadow-sm">
          <CheckCircle className="h-14 w-14 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-xl font-bold text-emerald-700 mb-1">Day Complete!</h3>
          <p className="text-slate-600 mb-4">You worked <span className="font-bold text-emerald-700">{h}h {m}m</span> today.</p>
          <div className="text-sm text-slate-500 space-y-1">
            <p>Punch In: {new Date(attendance.punch_in!).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
            <p>Punch Out: {new Date(attendance.punch_out).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        </div>
      </section>
    );
  }

  // State 1: Not punched in
  if (!attendance) {
    return (
      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Punch In / Out</h2>
          <p className="text-sm text-slate-500">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <div className="max-w-sm mx-auto rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm space-y-4">
          <div className="grid h-20 w-20 mx-auto place-items-center rounded-full bg-slate-100">
            <LogIn className="h-10 w-10 text-slate-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-700">Not clocked in</p>
            <p className="text-sm text-slate-400">Ready to start your day?</p>
          </div>
          <button onClick={punchIn} disabled={acting || !canPunchIn}
            className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white shadow-md hover:bg-emerald-700 active:scale-95 transition disabled:opacity-60">
            {acting ? "Punching In…" : canPunchIn ? "🟢 Punch In" : `Punch-in opens at ${tenant.punch_in_start}`}
          </button>
          {!canPunchIn && <p className="text-sm font-medium text-amber-600">Punch-in opens at {tenant.punch_in_start}</p>}
          <p className="text-xs text-slate-400">Office hours: {tenant.punch_in_start} onwards · Half day after {tenant.punch_in_cutoff}</p>
          <p className="text-xs text-slate-400">Your IP address will be recorded.</p>
        </div>
      </section>
    );
  }

  // States 2 & 3: Punched in
  const unapprovedTasks = todayTasks.filter(t => t.status !== "approved");
  const locked = tenant.punch_out_gate_enabled ? unapprovedTasks.length > 0 : false;
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Punch In / Out</h2>
        <p className="text-sm text-slate-500">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
      </div>

      {/* Status bar */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 flex items-center gap-3">
        <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
        <div>
          <p className="font-semibold text-emerald-700">You are clocked in</p>
          <p className="text-sm text-emerald-600">
            Since {new Date(attendance.punch_in!).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            {" · "}<span className="font-mono font-semibold">{elapsed}</span>
          </p>
        </div>
        <div className="ml-auto">
          <Clock className="h-8 w-8 text-emerald-300" />
        </div>
      </div>

      {/* Punch Out button */}
      <div className="max-w-sm mx-auto space-y-3 text-center">
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
              ? "bg-slate-300 hover:bg-slate-400 cursor-not-allowed"
              : "bg-brand-600 hover:bg-brand-700 active:scale-95"
          } disabled:opacity-80`}>
          <span className="flex items-center justify-center gap-2">
            {locked ? <Lock className="h-5 w-5" /> : <LogOut className="h-5 w-5" />}
            {acting ? "Punching Out…" : "Punch Out"}
          </span>
        </button>

        {locked ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 space-y-2">
            <p className="text-sm font-semibold text-amber-700 flex items-center justify-center gap-1">
              <Lock className="h-4 w-4" /> Punch-out locked
            </p>
            <p className="text-xs text-amber-600">Awaiting HR approval of your task submission.</p>
            <Link to="/employee/tasks"
              className="inline-block text-xs font-semibold text-brand-600 underline hover:text-brand-800">
              View my tasks →
            </Link>
          </div>
        ) : (
          <p className="text-sm text-slate-500">You're free to punch out when ready.</p>
        )}
      </div>

      {/* Today's Tasks */}
      {todayTasks.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-3">Today's Tasks</h3>
          <div className="space-y-2">
            {todayTasks.map(t => (
              <div key={t.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-sm font-medium text-slate-800">{t.title}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${
                  t.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                  t.status === "submitted" ? "bg-purple-100 text-purple-700" :
                  "bg-amber-100 text-amber-700"
                }`}>{t.status.replace("_", " ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
