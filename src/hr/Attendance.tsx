import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, Download, Users, BarChart3, Clock, Pencil, Check, X, ClipboardList } from "lucide-react";
import type { Attendance, Employee } from "../types";
import { db } from "../insforge/client";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";

type ViewMode = "daily" | "employee" | "summary";
type AttendanceStatus = "present" | "absent" | "half_day" | "on_leave";

interface AttendanceWithEmployee extends Attendance {
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

function fmt(date: Date) {
  return date.toISOString().slice(0, 10);
}

function fmtTime(ts: string | null) {
  if (!ts) return "—";
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
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HRAttendance() {
  const [view, setView] = useState<ViewMode>("daily");
  const { success, error: toastError } = useToast();

  // ── Daily view state
  const [dailyDate, setDailyDate] = useState(fmt(new Date()));
  const [dailyRows, setDailyRows] = useState<AttendanceWithEmployee[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editPunchIn, setEditPunchIn] = useState("");
  const [editPunchOut, setEditPunchOut] = useState("");
  const [editStatus, setEditStatus] = useState<AttendanceStatus>("present");
  const [saving, setSaving] = useState(false);

  // ── Employee view state
  const [empViewEmployee, setEmpViewEmployee] = useState<string>("");
  const [empViewYear, setEmpViewYear] = useState(new Date().getFullYear());
  const [empViewMonth, setEmpViewMonth] = useState(new Date().getMonth()); // 0-based
  const [empAttendance, setEmpAttendance] = useState<Attendance[]>([]);
  const [empLoading, setEmpLoading] = useState(false);

  // ── Summary view state
  const [summaryYear, setSummaryYear] = useState(new Date().getFullYear());
  const [summaryMonth, setSummaryMonth] = useState(new Date().getMonth());
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // ── Fetch all employees once
  useEffect(() => {
    let active = true;
    db.from("employees")
      .select("*")
      .order("full_name")
      .then(({ data }) => {
        if (active && data) setAllEmployees(data as Employee[]);
      });
    return () => { active = false; };
  }, []);

  // ── Fetch Daily view
  const fetchDaily = useCallback(async () => {
    setDailyLoading(true);
    try {
      const { data: attData, error: fetchErr } = await db.from("attendance").select("*").eq("date", dailyDate);
      if (fetchErr) throw fetchErr;
      const att = (attData ?? []) as Attendance[];
      const merged: AttendanceWithEmployee[] = allEmployees.map((emp) => {
        const rec = att.find((a) => a.employee_id === emp.id);
        if (rec) return { ...rec, employee: emp };
        return {
          id: "",
          employee_id: emp.id,
          date: dailyDate,
          punch_in: null,
          punch_out: null,
          punch_out_allowed: false,
          punch_in_ip: null,
          punch_out_ip: null,
          work_hours: null,
          status: "absent" as AttendanceStatus,
          notes: null,
          created_at: "",
          employee: emp,
        };
      });
      setDailyRows(merged);
    } catch (err) {
      toastError("Failed to fetch daily attendance.");
    } finally {
      setDailyLoading(false);
    }
  }, [dailyDate, allEmployees, toastError]);

  useEffect(() => {
    if (view === "daily" && allEmployees.length > 0) void fetchDaily();
  }, [view, fetchDaily, allEmployees]);

  // ── Fetch Employee view
  const fetchEmpAttendance = useCallback(async () => {
    if (!empViewEmployee) return;
    setEmpLoading(true);
    try {
      const start = fmt(new Date(empViewYear, empViewMonth, 1));
      const end = fmt(new Date(empViewYear, empViewMonth + 1, 0));
      const { data, error: fetchErr } = await db.from("attendance").select("*")
        .eq("employee_id", empViewEmployee).gte("date", start).lte("date", end);
      if (fetchErr) throw fetchErr;
      setEmpAttendance((data ?? []) as Attendance[]);
    } catch (err) {
      toastError("Failed to fetch employee attendance.");
    } finally {
      setEmpLoading(false);
    }
  }, [empViewEmployee, empViewYear, empViewMonth, toastError]);

  useEffect(() => {
    if (view === "employee") void fetchEmpAttendance();
  }, [view, fetchEmpAttendance]);

  // ── Fetch Summary view
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const start = fmt(new Date(summaryYear, summaryMonth, 1));
      const end = fmt(new Date(summaryYear, summaryMonth + 1, 0));
      const { data: attData, error: fetchErr } = await db.from("attendance").select("*").gte("date", start).lte("date", end);
      if (fetchErr) throw fetchErr;
      const att = (attData ?? []) as Attendance[];
      const rows: SummaryRow[] = allEmployees.map((emp) => {
        const empAtt = att.filter((a) => a.employee_id === emp.id);
        const present = empAtt.filter((a) => a.status === "present" || a.status === "half_day").length;
        const absent = empAtt.filter((a) => a.status === "absent").length;
        const onLeave = empAtt.filter((a) => a.status === "on_leave").length;
        const withHours = empAtt.filter((a) => a.work_hours != null && a.work_hours > 0);
        const avg = withHours.length > 0 ? withHours.reduce((s, a) => s + (a.work_hours ?? 0), 0) / withHours.length : 0;
        const late = empAtt.filter((a) => {
          if (!a.punch_in) return false;
          const h = new Date(a.punch_in).getHours();
          return h >= 10;
        }).length;
        return { employee: emp, daysPresent: present, daysAbsent: absent, daysOnLeave: onLeave, avgWorkHours: avg, latePunchIns: late };
      });
      setSummaryRows(rows);
    } catch (err) {
      toastError("Failed to fetch summary.");
    } finally {
      setSummaryLoading(false);
    }
  }, [summaryYear, summaryMonth, allEmployees, toastError]);

  useEffect(() => {
    if (view === "summary" && allEmployees.length > 0) void fetchSummary();
  }, [view, fetchSummary, allEmployees]);

  // ── Save edit
  async function saveEdit(row: AttendanceWithEmployee) {
    setSaving(true);
    try {
      const punchIn = editPunchIn ? new Date(`${dailyDate}T${editPunchIn}:00`).toISOString() : null;
      const punchOut = editPunchOut ? new Date(`${dailyDate}T${editPunchOut}:00`).toISOString() : null;
      const workHours = punchIn && punchOut
        ? (new Date(punchOut).getTime() - new Date(punchIn).getTime()) / 3600000
        : null;

      if (row.id) {
        await db.from("attendance").update({ punch_in: punchIn, punch_out: punchOut, status: editStatus, work_hours: workHours }).eq("id", row.id);
      } else {
        await db.from("attendance").insert([{
          employee_id: row.employee_id, date: dailyDate,
          punch_in: punchIn, punch_out: punchOut, status: editStatus, work_hours: workHours,
        }]);
      }
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

  // ── Calendar grid for employee view
  const calendarDays = useMemo(() => {
    const firstDay = new Date(empViewYear, empViewMonth, 1).getDay();
    const daysInMonth = new Date(empViewYear, empViewMonth + 1, 0).getDate();
    return { firstDay, daysInMonth };
  }, [empViewYear, empViewMonth]);

  const attByDate = useMemo(() => {
    const map: Record<string, Attendance> = {};
    empAttendance.forEach((a) => { map[a.date] = a; });
    return map;
  }, [empAttendance]);

  // ── Export handlers
  function exportDaily() {
    const header = ["Employee", "Punch In", "Punch Out", "Work Hours", "Status"];
    const rows = dailyRows.map((r) => [
      r.employee?.full_name ?? r.employee_id,
      fmtTime(r.punch_in), fmtTime(r.punch_out),
      r.work_hours != null ? r.work_hours.toFixed(2) : "—",
      r.status,
    ]);
    exportCSV([header, ...rows], `attendance_${dailyDate}.csv`);
  }

  function exportSummary() {
    const header = ["Employee", "Present", "Absent", "On Leave", "Avg Hours", "Late Punch-ins"];
    const rows = summaryRows.map((r) => [
      r.employee.full_name,
      String(r.daysPresent), String(r.daysAbsent), String(r.daysOnLeave),
      r.avgWorkHours.toFixed(2), String(r.latePunchIns),
    ]);
    exportCSV([header, ...rows], `summary_${summaryYear}_${summaryMonth + 1}.csv`);
  }

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Attendance Management</h2>
          <p className="text-sm text-slate-500">Track, edit and export employee attendance records.</p>
        </div>
        <div className="flex gap-2">
          {[
            { key: "daily", icon: Calendar, label: "Daily" },
            { key: "employee", icon: Users, label: "Employee" },
            { key: "summary", icon: BarChart3, label: "Summary" },
          ].map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setView(key as ViewMode)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                view === key ? "bg-brand-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── DAILY VIEW ── */}
      {view === "daily" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700">Date:</label>
              <input
                type="date"
                value={dailyDate}
                onChange={(e) => setDailyDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none ring-brand-600 focus:ring"
              />
            </div>
            <button
              onClick={exportDaily}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Punch In</th>
                  <th className="px-4 py-3 font-semibold">Punch Out</th>
                  <th className="px-4 py-3 font-semibold">Work Hours</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {dailyLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(6)].map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[100px]" /></td>
                      ))}
                    </tr>
                  ))
                ) : dailyRows.length === 0 ? (
                  <tr><td colSpan={6} className="p-10"><EmptyState icon={Users} title="No employees found" description="There are no employees to display attendance for." /></td></tr>
                ) : (
                  dailyRows.map((row) => {
                    const isEditing = editId === row.employee_id;
                    const { cls, label } = statusBadge(row.status as AttendanceStatus);
                    return (
                      <tr key={row.employee_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{row.employee?.full_name ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {isEditing
                            ? <input type="time" value={editPunchIn} onChange={(e) => setEditPunchIn(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs" />
                            : fmtTime(row.punch_in)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {isEditing
                            ? <input type="time" value={editPunchOut} onChange={(e) => setEditPunchOut(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs" />
                            : fmtTime(row.punch_out)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {row.work_hours != null ? `${row.work_hours.toFixed(2)}h` : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as AttendanceStatus)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                              <option value="present">Present</option>
                              <option value="absent">Absent</option>
                              <option value="half_day">Half Day</option>
                              <option value="on_leave">On Leave</option>
                            </select>
                          ) : (
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <div className="flex gap-1">
                              <button onClick={() => saveEdit(row)} disabled={saving} className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-50">
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => setEditId(null)} className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => startEdit(row)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                              <Pencil className="h-3 w-3" /> Edit
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
        </div>
      )}

      {/* ── EMPLOYEE VIEW ── */}
      {view === "employee" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <select
              value={empViewEmployee}
              onChange={(e) => setEmpViewEmployee(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
            >
              <option value="">Select Employee</option>
              {allEmployees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <div className="flex items-center gap-2">
              <button onClick={() => { const d = new Date(empViewYear, empViewMonth - 1); setEmpViewYear(d.getFullYear()); setEmpViewMonth(d.getMonth()); }} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[130px] text-center text-sm font-semibold text-slate-700">{monthNames[empViewMonth]} {empViewYear}</span>
              <button onClick={() => { const d = new Date(empViewYear, empViewMonth + 1); setEmpViewYear(d.getFullYear()); setEmpViewMonth(d.getMonth()); }} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>

          {/* Legend */}
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
            <div className="py-10 flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
                  <div key={d} className="py-2 text-center text-xs font-semibold text-slate-500">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {Array.from({ length: calendarDays.firstDay }).map((_, i) => <div key={`empty-${i}`} className="h-14 border-b border-r border-slate-100" />)}
                {Array.from({ length: calendarDays.daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dateStr = `${empViewYear}-${String(empViewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const rec = attByDate[dateStr];
                  const dotColor = rec ? calDotColor(rec.status) : "bg-white border border-slate-200";
                  const isWeekend = new Date(dateStr).getDay() === 0 || new Date(dateStr).getDay() === 6;
                  return (
                    <div key={day} className={`flex h-14 flex-col items-center justify-center gap-1 border-b border-r border-slate-100 ${isWeekend ? "bg-slate-50" : ""}`}>
                      <span className="text-xs text-slate-500">{day}</span>
                      <span className={`h-3 w-3 rounded-full ${isWeekend && !rec ? "bg-slate-200" : dotColor}`} title={rec?.status ?? (isWeekend ? "weekend" : "no record")} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SUMMARY VIEW ── */}
      {view === "summary" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button onClick={() => { const d = new Date(summaryYear, summaryMonth - 1); setSummaryYear(d.getFullYear()); setSummaryMonth(d.getMonth()); }} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[130px] text-center text-sm font-semibold text-slate-700">{monthNames[summaryMonth]} {summaryYear}</span>
              <button onClick={() => { const d = new Date(summaryYear, summaryMonth + 1); setSummaryYear(d.getFullYear()); setSummaryMonth(d.getMonth()); }} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <button onClick={exportSummary} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold text-center">Days Present</th>
                  <th className="px-4 py-3 font-semibold text-center">Days Absent</th>
                  <th className="px-4 py-3 font-semibold text-center">Days On Leave</th>
                  <th className="px-4 py-3 font-semibold text-center">Avg Work Hours</th>
                  <th className="px-4 py-3 font-semibold text-center">Late Punch-ins</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {summaryLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(6)].map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[80px]" /></td>
                      ))}
                    </tr>
                  ))
                ) : summaryRows.length === 0 ? (
                  <tr><td colSpan={6} className="p-10"><EmptyState icon={ClipboardList} title="No summary data" description="No attendance records available for the selected period." /></td></tr>
                ) : (
                  summaryRows.map((r) => (
                    <tr key={r.employee.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{r.employee.full_name}</td>
                      <td className="px-4 py-3 text-center"><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">{r.daysPresent}</span></td>
                      <td className="px-4 py-3 text-center"><span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">{r.daysAbsent}</span></td>
                      <td className="px-4 py-3 text-center"><span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">{r.daysOnLeave}</span></td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-slate-700"><Clock className="h-3.5 w-3.5" />{r.avgWorkHours.toFixed(1)}h</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${r.latePunchIns > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{r.latePunchIns}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
