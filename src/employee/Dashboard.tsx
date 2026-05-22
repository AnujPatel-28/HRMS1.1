import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, Calendar, ClipboardList, TrendingUp } from "lucide-react";
import type { Attendance, Leave, Task } from "../types";
import { db } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { Skeleton } from "../shared/Skeleton";

const TODAY = new Date().toISOString().slice(0, 10);
const MONTH_START = TODAY.slice(0, 7) + "-01";

export default function EmployeeDashboard() {
  const { employee } = useEmployee();
  const { tenantId } = useTenant();
  const [todayAtt, setTodayAtt] = useState<Attendance | null>(null);
  const [monthAtt, setMonthAtt] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employee?.id || !tenantId) return;
    const fetch = async () => {
      setLoading(true);
      const [attTodayRes, attMonthRes, leavesRes, tasksRes] = await Promise.all([
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).eq("date", TODAY).maybeSingle(),
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).gte("date", MONTH_START).lte("date", TODAY),
        db.from("leaves").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).order("applied_at", { ascending: false }).limit(5),
        db.from("tasks").select("*").eq("tenant_id", tenantId).eq("assigned_to", employee.id).order("created_at", { ascending: false }).limit(5),
      ]);
      setTodayAtt(attTodayRes.data as Attendance | null);
      setMonthAtt((attMonthRes.data ?? []) as Attendance[]);
      setLeaves((leavesRes.data ?? []) as Leave[]);
      setTasks((tasksRes.data ?? []) as Task[]);
      setLoading(false);
    };
    void fetch();
  }, [employee?.id, tenantId]);

  const daysPresent = monthAtt.filter(a => a.status === "present" || a.status === "half_day").length;
  const daysLeave = monthAtt.filter(a => a.status === "on_leave").length;
  const daysAbsent = new Date().getDate() - 1 - daysPresent - daysLeave;
  const pendingTasks = tasks.filter(t => t.status === "assigned" || t.status === "in_progress" || t.status === "rejected").length;
  const pendingLeaves = leaves.filter(l => l.status === "pending").length;

  const todayStatus = () => {
    if (!todayAtt) return { label: "Not Punched In", color: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" };
    if (todayAtt.punch_out) return { label: "Punched Out", color: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" };
    return { label: "Clocked In", color: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" };
  };
  const status = todayStatus();

  if (loading) return (
    <section className="space-y-6">
      <Skeleton className="h-16 w-64" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-2xl" />)}
      </div>
    </section>
  );

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Welcome back, {employee?.full_name?.split(" ")[0]} 👋</h2>
        <p className="text-sm text-slate-500">Here's your day at a glance.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link to="/employee/punch"
          className={`flex flex-col gap-2 rounded-2xl border p-4 shadow-xl -translate-y-1 hover:-translate-y-2 hover:shadow-2xl transition-all duration-300 ${status.color}`}>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${status.dot} animate-pulse`} />
            <span className="text-xs font-semibold uppercase tracking-wide">Today</span>
          </div>
          <p className="text-lg font-bold">{status.label}</p>
          {todayAtt?.punch_in && (
            <p className="text-xs opacity-75">Since {new Date(todayAtt.punch_in).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
          )}
        </Link>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl -translate-y-1">
          <div className="flex items-center gap-2 text-slate-500 mb-2">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">This Month</span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div><p className="text-xl font-bold text-emerald-600">{daysPresent}</p><p className="text-[10px] text-slate-500">Present</p></div>
            <div><p className="text-xl font-bold text-blue-600">{daysLeave}</p><p className="text-[10px] text-slate-500">Leave</p></div>
            <div><p className="text-xl font-bold text-rose-600">{Math.max(0, daysAbsent)}</p><p className="text-[10px] text-slate-500">Absent</p></div>
          </div>
        </div>

        <Link to="/employee/tasks"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-xl -translate-y-1 hover:-translate-y-2 hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center gap-2 text-amber-600 mb-2">
            <ClipboardList className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">Pending Tasks</span>
          </div>
          <p className="text-3xl font-bold text-amber-700">{pendingTasks}</p>
        </Link>

        <Link to="/employee/leaves"
          className="rounded-2xl border border-purple-200 bg-purple-50 p-4 shadow-xl -translate-y-1 hover:-translate-y-2 hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center gap-2 text-purple-600 mb-2">
            <Calendar className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">Leave Requests</span>
          </div>
          <p className="text-3xl font-bold text-purple-700">{pendingLeaves}</p>
          <p className="text-xs text-purple-500 mt-1">pending</p>
        </Link>
      </div>

      {/* Recent Activity */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Recent Attendance */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl -translate-y-1">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-slate-400" />
            <h3 className="font-semibold text-slate-800">Recent Attendance</h3>
          </div>
          <div className="space-y-2">
            {monthAtt.slice(-5).reverse().map(a => (
              <div key={a.id} className="flex items-center justify-between rounded-lg px-3 py-2 bg-slate-50 text-sm">
                <span className="text-slate-600">{new Date(a.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${
                  a.status === "present" ? "bg-emerald-100 text-emerald-700" :
                  a.status === "on_leave" ? "bg-blue-100 text-blue-700" :
                  "bg-rose-100 text-rose-700"
                }`}>{a.status.replace("_", " ")}</span>
              </div>
            ))}
            {monthAtt.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No records this month.</p>}
          </div>
        </div>

        {/* Recent Tasks */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl -translate-y-1">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="h-4 w-4 text-slate-400" />
            <h3 className="font-semibold text-slate-800">Recent Tasks</h3>
          </div>
          <div className="space-y-2">
            {tasks.slice(0, 3).map(t => (
              <div key={t.id} className="rounded-lg px-3 py-2 bg-slate-50">
                <p className="text-sm font-medium text-slate-800 truncate">{t.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${
                    t.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                    t.status === "submitted" ? "bg-purple-100 text-purple-700" :
                    t.status === "rejected" ? "bg-rose-100 text-rose-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>{t.status.replace("_", " ")}</span>
                  {t.due_date && <span className="text-[10px] text-slate-400">Due {t.due_date}</span>}
                </div>
              </div>
            ))}
            {tasks.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No tasks assigned.</p>}
          </div>
        </div>

        {/* Recent Leaves */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl -translate-y-1">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="h-4 w-4 text-slate-400" />
            <h3 className="font-semibold text-slate-800">Recent Leaves</h3>
          </div>
          <div className="space-y-2">
            {leaves.slice(0, 3).map(l => (
              <div key={l.id} className="rounded-lg px-3 py-2 bg-slate-50">
                <p className="text-sm font-medium text-slate-800 capitalize">{l.leave_type} Leave</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    l.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                    l.status === "rejected" ? "bg-rose-100 text-rose-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>{l.status}</span>
                  <span className="text-[10px] text-slate-400">{l.start_date} → {l.end_date}</span>
                </div>
              </div>
            ))}
            {leaves.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No leave requests.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
