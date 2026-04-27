import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Attendance, CalendarEvent, Employee, Holiday, Leave, Task } from "../types";
import { db } from "../insforge/client";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DEPT_OPTIONS = ["all","sales","dev","marketing","operations","design","other"] as const;
const TODAY = new Date().toISOString().slice(0,10);

type EmpDay = {
  emp: Employee;
  status: "approved"|"incomplete"|"leave"|"absent"|"holiday";
};

type DayPopup = {
  date: string;
  empDays: EmpDay[];
  tasks: Task[];
  holiday: Holiday|null;
};

export default function HRCalendar() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [deptFilter, setDeptFilter] = useState("all");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [popup, setPopup] = useState<DayPopup|null>(null);

  const startDate = useMemo(() => `${year}-${String(month+1).padStart(2,"0")}-01`, [year,month]);
  const endDate = useMemo(() => {
    const d = new Date(year, month+1, 0);
    return `${year}-${String(month+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }, [year,month]);

  useEffect(() => {
    db.from("employees").select("*").eq("status","active").order("full_name")
      .then(({ data }) => { if (data) setEmployees(data as Employee[]); });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [attQ, leaveQ, evtQ, holQ, taskQ] = await Promise.all([
      db.from("attendance").select("*").gte("date",startDate).lte("date",endDate),
      db.from("leaves").select("*").eq("status","approved").gte("start_date",startDate).lte("end_date",endDate),
      db.from("calendar_events").select("*").gte("date",startDate).lte("date",endDate),
      db.from("holidays").select("*").gte("date",startDate).lte("date",endDate),
      db.from("tasks").select("*").gte("due_date",startDate).lte("due_date",endDate),
    ]);
    setAttendance((attQ.data??[]) as Attendance[]);
    setLeaves((leaveQ.data??[]) as Leave[]);
    setEvents((evtQ.data??[]) as CalendarEvent[]);
    setHolidays((holQ.data??[]) as Holiday[]);
    setTasks((taskQ.data??[]) as Task[]);
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // --- Lookup maps ---
  const attByDateEmp = useMemo(() => {
    const m: Record<string,Record<string,Attendance>> = {};
    attendance.forEach(a => { (m[a.date] ??= {})[a.employee_id] = a; });
    return m;
  }, [attendance]);

  const leaveByDateEmp = useMemo(() => {
    const m: Record<string,Set<string>> = {};
    leaves.forEach(l => {
      for (let d = new Date(l.start_date); d <= new Date(l.end_date); d.setDate(d.getDate()+1)) {
        const k = d.toISOString().slice(0,10);
        (m[k] ??= new Set()).add(l.employee_id);
      }
    });
    return m;
  }, [leaves]);

  const eventByDateEmp = useMemo(() => {
    const m: Record<string,Record<string,CalendarEvent>> = {};
    events.forEach(e => { (m[e.date] ??= {})[e.employee_id] = e; });
    return m;
  }, [events]);

  const holByDate = useMemo(() => {
    const m: Record<string,Holiday> = {};
    holidays.forEach(h => { m[h.date] = h; });
    return m;
  }, [holidays]);

  const tasksByDate = useMemo(() => {
    const m: Record<string,Task[]> = {};
    tasks.forEach(t => { if (t.due_date) (m[t.due_date]??=[]).push(t); });
    return m;
  }, [tasks]);

  const visibleEmps = useMemo(() =>
    deptFilter === "all" ? employees : employees.filter(e => e.department === deptFilter),
  [employees, deptFilter]);

  function getEmpStatus(empId: string, dateStr: string): EmpDay["status"] {
    const hol = holByDate[dateStr];
    if (hol) return "holiday";
    if (leaveByDateEmp[dateStr]?.has(empId)) return "leave";
    const evt = eventByDateEmp[dateStr]?.[empId];
    if (evt?.type === "green") return "approved";
    const att = attByDateEmp[dateStr]?.[empId];
    if (att) {
      if (att.status === "present") return "approved";
      if (att.status === "on_leave") return "leave";
    }
    // Check if they have a task today that's not approved
    const dayTasks = tasksByDate[dateStr]?.filter(t => t.assigned_to === empId) ?? [];
    if (dayTasks.some(t => t.status !== "approved")) return "incomplete";
    if (dayTasks.length > 0 && dayTasks.every(t => t.status === "approved")) return "approved";
    return "absent";
  }

  function getDotClass(status: EmpDay["status"]) {
    switch (status) {
      case "approved": return "bg-emerald-500";
      case "incomplete": return "bg-rose-500";
      case "leave": return "bg-blue-500";
      case "absent": return "bg-gray-300";
      case "holiday": return "border-2 border-slate-300 bg-white";
    }
  }

  function openPopup(day: number) {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const hol = holByDate[dateStr] ?? null;
    const empDays: EmpDay[] = visibleEmps.map(emp => ({
      emp, status: getEmpStatus(emp.id, dateStr),
    }));
    setPopup({ date: dateStr, empDays, tasks: tasksByDate[dateStr] ?? [], holiday: hol });
  }

  function getDaySummary(day: number) {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const hol = holByDate[dateStr];
    if (hol) return [{ color:"border-2 border-slate-300 bg-white", count: 1 }];
    const counts: Record<EmpDay["status"],number> = { approved:0,incomplete:0,leave:0,absent:0,holiday:0 };
    visibleEmps.slice(0,8).forEach(e => { counts[getEmpStatus(e.id,dateStr)]++; });
    return (Object.entries(counts) as [EmpDay["status"],number][])
      .filter(([,n]) => n>0)
      .map(([s,n]) => ({ color: getDotClass(s as EmpDay["status"]), count: n }));
  }

  // --- Today stats ---
  const todayAtt = useMemo(() => attByDateEmp[TODAY] ?? {}, [attByDateEmp]);
  const presentToday = useMemo(() => Object.values(todayAtt).filter(a=>a.status==="present").length, [todayAtt]);
  const absentToday = useMemo(() => employees.length - presentToday - (leaveByDateEmp[TODAY]?.size??0), [employees,presentToday,leaveByDateEmp]);
  const pendingTasksToday = useMemo(() => (tasksByDate[TODAY]??[]).filter(t=>t.status!=="approved").length, [tasksByDate]);
  const approvedTasksToday = useMemo(() => (tasksByDate[TODAY]??[]).filter(t=>t.status==="approved").length, [tasksByDate]);

  const navMonth = (d: number) => {
    const nd = new Date(year, month+d);
    setYear(nd.getFullYear()); setMonth(nd.getMonth());
  };

  const firstDow = new Date(year,month,1).getDay();
  const daysInMonth = new Date(year,month+1,0).getDate();
  const isToday = (day: number) =>
    `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}` === TODAY;

  const empName = (id: string) => employees.find(e=>e.id===id)?.full_name ?? "Unknown";

  return (
    <section className="space-y-5">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label:"Present Today", value: presentToday, color:"text-emerald-600", bg:"bg-emerald-50 border-emerald-200" },
          { label:"Absent Today", value: absentToday, color:"text-rose-600", bg:"bg-rose-50 border-rose-200" },
          { label:"Pending Tasks", value: pendingTasksToday, color:"text-amber-600", bg:"bg-amber-50 border-amber-200" },
          { label:"Tasks Approved", value: approvedTasksToday, color:"text-brand-600", bg:"bg-brand-50 border-brand-200" },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl border p-4 ${s.bg}`}>
            <p className="text-xs font-medium text-slate-500">{s.label}</p>
            <p className={`mt-1 text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Team Calendar</h2>
          <p className="text-sm text-slate-500">Attendance, tasks and leaves at a glance.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={deptFilter} onChange={e=>setDeptFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none ring-brand-600 focus:ring">
            {DEPT_OPTIONS.map(d=><option key={d} value={d} className="capitalize">{d==="all"?"All Departments":d}</option>)}
          </select>
          <button onClick={()=>navMonth(-1)} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100"><ChevronLeft className="h-4 w-4"/></button>
          <span className="min-w-[140px] text-center text-sm font-semibold text-slate-700">{MONTHS[month]} {year}</span>
          <button onClick={()=>navMonth(1)} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100"><ChevronRight className="h-4 w-4"/></button>
          <button onClick={()=>{setYear(new Date().getFullYear());setMonth(new Date().getMonth());}}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Today</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        {[
          {color:"bg-emerald-500", label:"Task Approved / Present"},
          {color:"bg-rose-500", label:"Task Incomplete"},
          {color:"bg-blue-500", label:"On Leave"},
          {color:"bg-gray-300", label:"Absent / No Record"},
          {color:"border-2 border-slate-300 bg-white", label:"Holiday"},
        ].map(l=>(
          <span key={l.label} className="flex items-center gap-1.5 text-slate-600">
            <span className={`h-2.5 w-2.5 rounded-full ${l.color}`}/>
            {l.label}
          </span>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden ${loading?"opacity-60":""}`}>
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>(
            <div key={d} className="py-2.5 text-center text-xs font-semibold text-slate-500">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({length:firstDow}).map((_,i)=>(
            <div key={`e-${i}`} className="min-h-[90px] border-b border-r border-slate-100 bg-slate-50/50"/>
          ))}
          {Array.from({length:daysInMonth}).map((_,i)=>{
            const day = i+1;
            const summary = getDaySummary(day);
            const today = isToday(day);
            const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const dow = new Date(dateStr).getDay();
            const isWknd = dow===0||dow===6;
            return (
              <div key={day} onClick={()=>openPopup(day)}
                className={`min-h-[90px] cursor-pointer border-b border-r border-slate-100 p-2 transition hover:bg-slate-50 ${isWknd?"bg-slate-50/60":""}`}>
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${today?"bg-brand-600 text-white":"text-slate-700"}`}>
                  {day}
                </span>
                {holByDate[dateStr] && (
                  <p className="mt-0.5 truncate text-[9px] font-medium text-purple-600">{holByDate[dateStr].name}</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-0.5">
                  {summary.slice(0,6).map((s,si)=>(
                    <span key={si} className={`h-2 w-2 rounded-full ${s.color}`} title={`${s.count}`}/>
                  ))}
                </div>
                {(tasksByDate[dateStr]?.length??0) > 0 && (
                  <p className="mt-1 text-[9px] font-medium text-amber-600">
                    {tasksByDate[dateStr].length} task{tasksByDate[dateStr].length>1?"s":""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Day Popup Modal */}
      {popup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={()=>setPopup(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[80vh] flex flex-col"
            onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="font-semibold text-slate-900">
                  {new Date(popup.date+"T00:00:00").toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
                </h3>
                {popup.holiday && <p className="text-xs text-purple-600 mt-0.5">🎉 {popup.holiday.name}</p>}
              </div>
              <button onClick={()=>setPopup(null)} className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100">
                <X className="h-4 w-4 text-slate-500"/>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Employee Status */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Team Status</p>
                <div className="space-y-1.5">
                  {popup.empDays.map(({ emp, status }) => (
                    <div key={emp.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getDotClass(status)}`}/>
                      <span className="flex-1 text-sm font-medium text-slate-800">{emp.full_name}</span>
                      <span className="text-xs capitalize text-slate-400">{emp.department??""}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                        status==="approved"?"bg-emerald-100 text-emerald-700":
                        status==="incomplete"?"bg-rose-100 text-rose-700":
                        status==="leave"?"bg-blue-100 text-blue-700":
                        status==="holiday"?"bg-purple-100 text-purple-700":
                        "bg-gray-100 text-gray-500"
                      }`}>{status}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tasks */}
              {popup.tasks.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Tasks Due</p>
                  <div className="space-y-1.5">
                    {popup.tasks.map(t => (
                      <div key={t.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2">
                        <span className="flex-1 text-sm font-medium text-slate-800">{t.title}</span>
                        <span className="text-xs capitalize text-slate-400">{empName(t.assigned_to)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                          t.status==="approved"?"bg-emerald-100 text-emerald-700":
                          t.status==="submitted"?"bg-purple-100 text-purple-700":
                          t.status==="rejected"?"bg-rose-100 text-rose-700":
                          "bg-amber-100 text-amber-700"
                        }`}>{t.status.replace("_"," ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
