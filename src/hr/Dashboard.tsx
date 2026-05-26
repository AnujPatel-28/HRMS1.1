import { useCallback, useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, CalendarCheck, Clock, AlertCircle,
  TrendingUp, CheckCircle2, XCircle, ArrowRight, CheckCircle, Bell, Filter
} from "lucide-react";
import type { Attendance, Employee, Leave, Notification, Shift, EmployeeShift } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { SelectDropdown } from "../shared/components/SelectDropdown";
import { formatLocalDate } from "../utils/date";


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

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employeeShifts, setEmployeeShifts] = useState<EmployeeShift[]>([]);
  const [selectedShift, setSelectedShift] = useState<string>("all");

  const [loading, setLoading] = useState(true);

  const { error: toastError } = useToast();

  // Business-calendar date for today's attendance snapshot.
  // Must use local timezone — not toISOString() which is UTC.
  const today = formatLocalDate(new Date());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, leaveRes, attRes, notifRes, shiftRes, empShiftRes] = await Promise.all([
        db.from("employees").select("*").eq("tenant_id", tenantId).eq("status", "active"),
        db.from("leaves").select("*").eq("tenant_id", tenantId).eq("status", "pending").order("applied_at", { ascending: false }).limit(5),
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("date", today),
        db.from("notifications").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(6),
        db.from("shifts").select("*").eq("tenant_id", tenantId).eq("is_active", true),
        db.from("employee_shifts").select("*").eq("tenant_id", tenantId)
          .lte("effective_from", today)
          .or(`effective_to.is.null,effective_to.gte.${today}`),
      ]);

      if (empRes.error) throw empRes.error;
      if (leaveRes.error) throw leaveRes.error;
      if (attRes.error) throw attRes.error;
      if (notifRes.error) throw notifRes.error;
      if (shiftRes.error) throw shiftRes.error;
      if (empShiftRes.error) throw empShiftRes.error;

      const emps = (empRes.data ?? []) as Employee[];
      const empMap: Record<string, Employee> = {};
      emps.forEach((e) => { empMap[e.id] = e; });

      setEmployees(emps);
      setPendingLeaves(((leaveRes.data ?? []) as Leave[]).map((l) => ({ ...l, employee: empMap[l.employee_id] })));
      setTodayAttendance((attRes.data ?? []) as Attendance[]);
      setRecentNotifs((notifRes.data ?? []) as Notification[]);
      setShifts((shiftRes.data ?? []) as Shift[]);
      setEmployeeShifts((empShiftRes.data ?? []) as EmployeeShift[]);
    } catch (err) {
      toastError("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, today, toastError]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const filteredEmployees = useMemo(() => {
    if (selectedShift === "all") return employees;
    const assignedIds = new Set(
      employeeShifts
        .filter((es) => es.shift_id === selectedShift)
        .map((es) => es.employee_id)
    );
    const isDefault = shifts.find(s => s.id === selectedShift)?.is_default;
    const hasAnyAssignment = new Set(employeeShifts.map(es => es.employee_id));

    return employees.filter(emp => {
      if (assignedIds.has(emp.id)) return true;
      if (isDefault && !hasAnyAssignment.has(emp.id)) return true;
      return false;
    });
  }, [selectedShift, employees, employeeShifts, shifts]);

  const filteredAttendance = useMemo(() => {
    if (selectedShift === "all") return todayAttendance;
    const validEmpIds = new Set(filteredEmployees.map(e => e.id));
    return todayAttendance.filter(a => validEmpIds.has(a.employee_id));
  }, [selectedShift, todayAttendance, filteredEmployees]);

  const presentCount = filteredAttendance.filter((a) => a.status === "present").length;
  const absentCount = filteredEmployees.length - filteredAttendance.length;
  const onLeaveCount = filteredAttendance.filter((a) => a.status === "on_leave").length;

  const kpis: KPI[] = [
    {
      label: "Total Employees",
      value: filteredEmployees.length,
      sub: "Active headcount",
      icon: <Users className="h-5 w-5" />,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Present Today",
      value: presentCount,
      sub: `${filteredEmployees.length > 0 ? Math.round((presentCount / filteredEmployees.length) * 100) : 0}% attendance rate`,
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
      {/* Overview Section */}
      <div className="flex flex-col gap-4 sm:gap-6 lg:bg-white lg:rounded-3xl lg:border lg:border-slate-200 lg:shadow-sm lg:p-6">
        {/* Overview Header & Shift Selector */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:px-2 lg:px-0">
          <h3 className="text-lg font-bold text-slate-900">Today's Overview</h3>
          
          {/* MOBILE VIEW */}
          <div className="md:hidden inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 shadow-sm border border-slate-200 w-fit">
            {!loading && shifts.length === 0 ? (
              <button
                onClick={() => navigate("/hr/shifts")}
                className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600 hover:text-amber-700"
              >
                + Add a Shift
              </button>
            ) : (
              <>
                <Filter className="h-4 w-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-700">View:</span>
                <SelectDropdown
                  value={selectedShift}
                  onChange={setSelectedShift}
                  options={[
                    { value: "all", label: "All Shifts" },
                    ...shifts.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  containerClassName="min-w-[130px]"
                  triggerClassName="w-full bg-transparent text-sm font-semibold text-brand-700 py-0 px-1 border-none hover:bg-transparent"
                />
              </>
            )}
          </div>

        {/* DESKTOP VIEW */}
        <div className="hidden md:flex items-center">
          {!loading && shifts.length === 0 ? (
            <div className="inline-flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2">
              <span className="text-sm text-amber-700 font-medium">No shifts configured</span>
              <button
                onClick={() => navigate("/hr/shifts")}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600 transition-colors"
              >
                + Add a Shift
              </button>
            </div>
          ) : (
            <div className="inline-flex items-center rounded-xl bg-white p-1 shadow-sm border border-slate-200">
              <button
                onClick={() => setSelectedShift("all")}
                className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${selectedShift === "all"
                    ? "relative z-10 bg-brand-50 text-brand-700 shadow-sm ring-1 ring-brand-200"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}
              >
                All Shifts
              </button>
              {shifts.map((shift) => (
                <button
                  key={shift.id}
                  onClick={() => setSelectedShift(shift.id ?? "")}
                  className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${selectedShift === shift.id
                      ? "relative z-10 bg-brand-50 text-brand-700 shadow-sm ring-1 ring-brand-200"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    }`}
                >
                  {shift.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {kpis.map((k) => {
          const glowMap: Record<string, string> = {
            "text-brand-600": "bg-blue-400",
            "text-emerald-600": "bg-emerald-400",
            "text-rose-600": "bg-rose-400",
            "text-amber-600": "bg-amber-400",
          };
          const glowClass = glowMap[k.color] || "bg-slate-400";
          return (
            <div key={k.label} className="h-full">
              {/* MOBILE VIEW (Hidden on lg) */}
              <div className="relative h-full overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col justify-between lg:hidden">
                <div className={`absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl opacity-20 ${glowClass}`} />
                <div className="relative z-10 flex items-start justify-between mb-4">
                  <p className="text-[11px] font-semibold text-slate-500 pr-1 leading-tight">{k.label.replace(' / No Punch', '')}</p>
                  <span className={`shrink-0 rounded-xl p-2 ${k.bg} ${k.color} shadow-sm ring-1 ring-white/50`}>
                    {k.icon}
                  </span>
                </div>
                <div className="relative z-10">
                  <p className={`text-2xl font-black tracking-tight ${k.color}`}>
                    {loading ? <Skeleton className="h-8 w-12" /> : k.value}
                  </p>
                  <div className="mt-1">
                    {loading ? <Skeleton className="h-3 w-20" /> : <p className="text-[9px] font-medium text-slate-400">{k.sub}</p>}
                  </div>
                </div>
              </div>

              {/* DESKTOP VIEW (Hidden below lg) */}
              <div className="hidden lg:flex relative overflow-hidden h-full rounded-2xl border border-slate-100 bg-slate-50/50 p-5 lg:min-h-[180px] flex-col justify-between transition-all hover:bg-white hover:shadow-lg hover:-translate-y-1">
                <div className={`absolute -right-10 -top-10 h-32 w-32 rounded-full blur-3xl opacity-20 ${glowClass}`} />
                <div className="relative z-10 flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-500">{k.label}</p>
                  <span className={`rounded-xl p-2 ${k.bg} ${k.color}`}>{k.icon}</span>
                </div>
                <div className="relative z-10">
                  <p className={`text-3xl font-bold ${k.color}`}>
                    {loading ? <Skeleton className="h-9 w-16" /> : k.value}
                  </p>
                  <div className="mt-1">
                    {loading ? <Skeleton className="h-4 w-24" /> : <p className="text-xs text-slate-400">{k.sub}</p>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
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
              { label: "Present", count: presentCount, total: filteredEmployees.length, color: "bg-emerald-500" },
              { label: "Absent", count: absentCount, total: filteredEmployees.length, color: "bg-rose-400" },
              { label: "On Leave", count: onLeaveCount, total: filteredEmployees.length, color: "bg-blue-400" },
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
          {filteredAttendance.filter((a) => a.status === "present").length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-xs font-medium text-slate-500">Punched in today</p>
              <div className="flex flex-wrap gap-2">
                {filteredAttendance
                  .filter((a) => a.status === "present")
                  .slice(0, 12)
                  .map((a) => {
                    const emp = filteredEmployees.find((e) => e.id === a.employee_id);
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
