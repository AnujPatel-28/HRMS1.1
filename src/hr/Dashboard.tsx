import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, CalendarCheck, Clock, AlertCircle,
  TrendingUp, CheckCircle2, XCircle, ArrowRight, CheckCircle, Bell
} from "lucide-react";
import type { Attendance, Employee, Leave, Notification } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { formatLocalDate } from "../utils/date";
import TenantDebug from "../shared/TenantDebug";


interface KPI {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function HRDashboard() {
  const navigate = useNavigate();
  const { employee } = useEmployee();
  const { tenantId, tenant } = useTenant();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<(Leave & { employee?: Employee })[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<Attendance[]>([]);
  const [recentNotifs, setRecentNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const { error: toastError } = useToast();

  // Business-calendar date for today's attendance snapshot.
  // Must use local timezone — not toISOString() which is UTC.
  const today = formatLocalDate(new Date());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, leaveRes, attRes, notifRes] = await Promise.all([
        db.from("employees").select("*").eq("tenant_id", tenantId).eq("status", "active"),
        db.from("leaves").select("*").eq("tenant_id", tenantId).eq("status", "pending").order("applied_at", { ascending: false }).limit(5),
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("date", today),
        db.from("notifications").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(6),
      ]);

      if (empRes.error) throw empRes.error;
      if (leaveRes.error) throw leaveRes.error;
      if (attRes.error) throw attRes.error;
      if (notifRes.error) throw notifRes.error;

      const emps = (empRes.data ?? []) as Employee[];
      const empMap: Record<string, Employee> = {};
      emps.forEach((e) => { empMap[e.id] = e; });

      setEmployees(emps);
      setPendingLeaves(((leaveRes.data ?? []) as Leave[]).map((l) => ({ ...l, employee: empMap[l.employee_id] })));
      setTodayAttendance((attRes.data ?? []) as Attendance[]);
      setRecentNotifs((notifRes.data ?? []) as Notification[]);
    } catch (err) {
      toastError("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, today, toastError]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const presentCount = todayAttendance.filter((a) => a.status === "present").length;
  const absentCount = employees.length - todayAttendance.length;
  const onLeaveCount = todayAttendance.filter((a) => a.status === "on_leave").length;

  const kpis: KPI[] = [
    {
      label: "Total Employees",
      value: employees.length,
      sub: "Active headcount",
      icon: <Users className="h-5 w-5" />,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Present Today",
      value: presentCount,
      sub: `${employees.length > 0 ? Math.round((presentCount / employees.length) * 100) : 0}% attendance rate`,
      icon: <CalendarCheck className="h-5 w-5" />,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Absent / No Punch",
      value: absentCount,
      sub: "Missing today",
      icon: <AlertCircle className="h-5 w-5" />,
      color: "text-rose-600",
      bg: "bg-rose-50",
    },
    {
      label: "On Leave Today",
      value: onLeaveCount,
      sub: "Approved leaves",
      icon: <Clock className="h-5 w-5" />,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
  ];

  const leaveBadge = (status: Leave["status"]) => {
    if (status === "approved") return "bg-emerald-100 text-emerald-700";
    if (status === "rejected") return "bg-rose-100 text-rose-700";
    return "bg-amber-100 text-amber-700";
  };

  return (
    <section className="space-y-6">
      {/* TEMPORARY: Subdomain detection debug — remove before release */}
      <TenantDebug />

      {/* Welcome */}
      <div
        className="rounded-2xl border border-brand-100 p-6 text-white shadow-xl -translate-y-1 bg-cover bg-center bg-no-repeat bg-[url('/full.svg')] min-[912px]:bg-[url('/green%20gradiant.svg')] relative overflow-hidden"
        style={{ backgroundColor: "#059669" }}
      >
        <div className="relative z-10 w-full md:w-2/3">
          <p className="text-sm font-medium opacity-80">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"},</p>
          <h2 className="mt-0.5 text-2xl font-bold">{employee?.full_name ?? "HR Manager"} 👋</h2>
          <p className="mt-1 text-sm opacity-70">Here's what's happening at {tenant?.company_name ?? "TalentMesh"} today — {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.</p>
        </div>

        {/* Desktop Illustration */}
        <img
          src="/illu1.svg"
          alt=""
          className="absolute right-4 bottom-0 h-[135%] w-auto object-contain object-bottom hidden min-[912px]:block pointer-events-none z-0"
        />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl -translate-y-1 lg:min-h-[180px]">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{k.label}</p>
              <span className={`rounded-xl p-2 ${k.bg} ${k.color}`}>{k.icon}</span>
            </div>
            <p className={`mt-3 text-3xl font-bold ${k.color}`}>
              {loading ? <Skeleton className="h-9 w-16" /> : k.value}
            </p>
            <div className="mt-1">
              {loading ? <Skeleton className="h-4 w-24" /> : <p className="text-xs text-slate-400">{k.sub}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Pending Leave Requests */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl -translate-y-1">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Pending Leave Requests</h3>
            <button
              onClick={() => navigate("/hr/leaves")}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : pendingLeaves.length === 0 ? (
            <div className="py-4"><EmptyState icon={CheckCircle} title="All caught up!" description="No pending leave requests." /></div>
          ) : (
            <div className="space-y-3">
              {pendingLeaves.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                      {l.employee?.full_name.slice(0, 2).toUpperCase() ?? "??"}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{l.employee?.full_name ?? "Unknown"}</p>
                      <p className="text-xs capitalize text-slate-500">{l.leave_type} · {fmt(l.start_date)} → {fmt(l.end_date)}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${leaveBadge(l.status)}`}>
                    {l.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Today's Attendance Snapshot */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl -translate-y-1">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Today's Attendance</h3>
            <button
              onClick={() => navigate("/hr/attendance")}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
            >
              Full view <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Donut-style progress bars */}
          <div className="space-y-3">
            {[
              { label: "Present", count: presentCount, total: employees.length, color: "bg-emerald-500" },
              { label: "Absent", count: absentCount, total: employees.length, color: "bg-rose-400" },
              { label: "On Leave", count: onLeaveCount, total: employees.length, color: "bg-blue-400" },
            ].map(({ label, count, total, color }) => {
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-xs text-slate-600">
                    <span>{label}</span>
                    <span className="font-semibold">{count} <span className="font-normal text-slate-400">/ {total}</span></span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Employee avatars — present */}
          {todayAttendance.filter((a) => a.status === "present").length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-xs font-medium text-slate-500">Punched in today</p>
              <div className="flex flex-wrap gap-2">
                {todayAttendance
                  .filter((a) => a.status === "present")
                  .slice(0, 12)
                  .map((a) => {
                    const emp = employees.find((e) => e.id === a.employee_id);
                    return (
                      <div
                        key={a.id}
                        title={emp?.full_name}
                        className="grid h-8 w-8 place-items-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 ring-2 ring-white"
                      >
                        {emp?.full_name.slice(0, 2).toUpperCase() ?? "?"}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Notifications */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl -translate-y-1">
        <h3 className="mb-4 font-semibold text-slate-800">Recent Activity</h3>
        {loading ? (
          <div className="space-y-3 py-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
          </div>
        ) : recentNotifs.length === 0 ? (
          <div className="py-4"><EmptyState icon={Bell} title="No activity" description="No recent notifications to display." /></div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentNotifs.map((n) => (
              <div key={n.id} className="flex items-start gap-3 py-3">
                <span className={`mt-0.5 shrink-0 rounded-full p-1.5 ${n.is_read ? "bg-slate-100 text-slate-400" : "bg-brand-100 text-brand-600"}`}>
                  {n.type?.includes("approved") ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : n.type?.includes("rejected") ? (
                    <XCircle className="h-3.5 w-3.5" />
                  ) : (
                    <TrendingUp className="h-3.5 w-3.5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{n.title}</p>
                  <p className="truncate text-xs text-slate-500">{n.body}</p>
                </div>
                <span className="ml-auto shrink-0 text-xs text-slate-400">
                  {new Date(n.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
