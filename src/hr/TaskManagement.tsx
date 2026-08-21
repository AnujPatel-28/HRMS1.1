import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X, Eye, Paperclip, ChevronDown, ChevronUp, Trash2, ClipboardList } from "lucide-react";
import type { Employee, Task, TaskSubmission } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import { useAuditLog } from "../hooks/useAuditLog";
import { useEmployee } from "../hooks/useEmployee";
import { useOrgStructure } from "../hooks/useOrgStructure";
import { useToast } from "../shared/ToastContext";
import { ConfirmModal } from "../shared/ConfirmModal";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { SelectDropdown } from "../shared/components/SelectDropdown";
import { ALL_TASK_STATUSES, BLOCKING_TASK_STATUSES, SUBMITTED_TASK_STATUSES } from "../utils/taskConstants";

type Tab = "active" | "inbox" | "all" | "assign";
type StatusFilter = "all" | Task["status"];
type PriorityFilter = "all" | Task["priority"];

const PRIORITY_BADGE: Record<Task["priority"], string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-rose-100 text-rose-700",
};
const STATUS_BADGE: Record<Task["status"], string> = {
  assigned: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  submitted: "bg-purple-100 text-purple-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  overdue: "bg-red-100 text-red-700",
};

import { Link } from "react-router-dom";
import { useDepartmentLabel } from "../contexts/OrgUnitsContext";

interface TaskWithEmployee extends Task {
  assignee?: Employee;
  submission?: TaskSubmission;
  projects?: { name: string } | null;
}

const EMPTY_FORM = {
  title: "", description: "", assigned_to: "", assign_mode: "employee" as "employee"|"department",
  department: "", priority: "medium" as Task["priority"], due_date: "", due_time: "",
};

export default function TaskManagement() {
  const { employee: hrEmployee } = useEmployee();
  const { tenantId } = useTenant();
  const { logAction } = useAuditLog();
  const { orgUnits } = useOrgStructure();
  const deptLabel = useDepartmentLabel();
  const [tab, setTab] = useState<Tab>("active");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<TaskWithEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [empFilter, setEmpFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string|null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [empSearch, setEmpSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rejectId, setRejectId] = useState<string|null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  
  const { success, error: toastError } = useToast();
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; taskId: string | null }>({ isOpen: false, taskId: null });

  // employees.department now mirrors the org unit NAME (kept in sync by a DB trigger), so it's fine for
  // display but not a stable filter/assignment key — options carry org_unit_id as the value instead.
  const deptOptions = useMemo(() => {
    const lookupDepartments = orgUnits.map((unit) => ({ value: unit.id, label: unit.name }));
    return lookupDepartments.length > 0
      ? lookupDepartments
      : [
          { value: "sales", label: "Sales" },
          { value: "dev", label: "Development" },
          { value: "marketing", label: "Marketing" },
          { value: "operations", label: "Operations" },
          { value: "design", label: "Design" },
          { value: "other", label: "Other" },
        ];
  }, [orgUnits]);

  useEffect(() => {
    db.from("employees").select("*").eq("tenant_id", tenantId).eq("status","active").order("full_name")
      .then(({ data }) => { if (data) setEmployees(data as Employee[]); });
  }, [tenantId]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      let q = db.from("tasks").select("*, projects(name)").eq("tenant_id", tenantId).order("created_at", { ascending: false });
      if (tab === "active") q = q.in("status", ["in_progress", ...BLOCKING_TASK_STATUSES]);
      if (tab === "inbox") q = q.eq("status","submitted");
      if (statusFilter !== "all" && tab === "all") q = q.eq("status", statusFilter);
      if (priorityFilter !== "all") q = q.eq("priority", priorityFilter);
      if (empFilter !== "all") q = q.eq("assigned_to", empFilter);
      // department_filter is now stale slug text pre-migration; org_unit_id is the stable FK to filter on.
      if (deptFilter !== "all") q = q.eq("org_unit_id", deptFilter);
      const { data, error: fetchErr } = await q;
      if (fetchErr) throw fetchErr;
      
      const taskList = (data ?? []) as Task[];
      const subIds = taskList.filter(t => SUBMITTED_TASK_STATUSES.includes(t.status as any)).map(t => t.id);
      let subMap: Record<string,TaskSubmission> = {};
      if (subIds.length > 0) {
        const { data: subs } = await db.from("task_submissions")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("task_id", subIds)
          .order("submitted_at", { ascending: true });
        (subs ?? []).forEach((s: TaskSubmission) => { subMap[s.task_id] = s; });
      }
      const empMap: Record<string,Employee> = {};
      employees.forEach(e => { empMap[e.id] = e; });
      setTasks(taskList.map(t => ({ ...t, assignee: empMap[t.assigned_to], submission: subMap[t.id] })));
    } catch (err) {
      toastError("Failed to fetch tasks.");
    } finally {
      setLoading(false);
    }
  }, [tab, statusFilter, priorityFilter, empFilter, deptFilter, employees, tenantId, toastError]);

  useEffect(() => { if (employees.length >= 0) void fetchTasks(); }, [fetchTasks, employees]);

  async function assignTask() {
    if (!form.title) {
      toastError("Please enter a task title.");
      return;
    }
    if (!hrEmployee?.id) {
      toastError("Employee profile not found. You cannot assign tasks.");
      return;
    }
    if (form.assign_mode === "employee" && !form.assigned_to) {
      toastError("Please select an employee from the list.");
      return;
    }
    if (form.assign_mode === "department" && !form.department) {
      toastError("Please select a department.");
      return;
    }
    setSubmitting(true);
    const targets: Employee[] = form.assign_mode === "employee"
      ? employees.filter(e => e.id === form.assigned_to)
      // department text is the unit's name now, not a stable key — match on org_unit_id, what the picker selects.
      : employees.filter(e => e.org_unit_id === form.department);
    if (form.assign_mode === "department" && targets.length === 0) {
      toastError("No active employees found in that department.");
      setSubmitting(false);
      return;
    }
    try {
      const deptName = form.assign_mode === "department" ? deptOptions.find(d => d.value === form.department)?.label ?? null : null;
      for (const emp of targets) {
        const { error: taskErr } = await db.from("tasks").insert([{
          title: form.title, description: form.description || null,
          tenant_id: tenantId,
          assigned_to: emp.id, assigned_by: hrEmployee.id,
          // department_filter keeps the unit's name for legacy display; org_unit_id is the real join key.
          department_filter: deptName,
          org_unit_id: form.assign_mode === "department" ? form.department : null,
          priority: form.priority, due_date: form.due_date || null, due_time: form.due_time || null,
          status: "assigned",
          attendance_lock_date: form.due_date || null
        }]);
        if (taskErr) throw taskErr;
        const { error: notifErr } = await db.from("notifications").insert([{
          tenant_id: tenantId,
          employee_id: emp.id, title: "New Task Assigned",
          body: `You have been assigned: "${form.title}"${form.due_date ? ` — due ${form.due_date}` : ""}`,
          type: "task_assigned",
        }]);
        if (notifErr) throw notifErr;
      }
      success(`Task assigned to ${targets.length} employee${targets.length !== 1 ? 's' : ''}`);
      setForm(EMPTY_FORM);
      setTab("active");
    } catch (err: any) {
      console.error("Assign task error:", err);
      toastError(err.message || "Failed to assign task.");
    } finally {
      setSubmitting(false);
      void fetchTasks();
    }
  }

  async function approveTask(task: TaskWithEmployee) {
    if (!task.submission) return;
    setSavingReview(true);
    try {
      // p_hr_employee_id removed — reviewer is derived server-side from auth.uid()
      const { error: rpcErr } = await db.rpc('approve_task_request', {
        p_task_id: task.id
      });
      if (rpcErr) throw rpcErr;
      
      const targetDate = task.attendance_lock_date || task.due_date || new Date().toISOString().slice(0,10);
      
      await db.from("calendar_events").insert([{
        tenant_id: tenantId,
        employee_id: task.assigned_to, date: targetDate, type: "green", task_id: task.id,
        notes: `Task approved: ${task.title}`,
      }]);
      await db.from("notifications").insert([{
        tenant_id: tenantId,
        employee_id: task.assigned_to, title: "Task Approved ✅",
        body: `Your task "${task.title}" was approved — you can now punch out.`,
        type: "task_approved", reference_id: task.id,
      }]);
      void logAction("task.approved", "task", task.id);
      success("Task approved.");
    } catch (err) {
      toastError("Failed to approve task.");
    } finally {
      setSavingReview(false);
      void fetchTasks();
    }
  }

  async function rejectTask(task: TaskWithEmployee) {
    if (!task.submission) return;
    setSavingReview(true);
    try {
      // p_hr_employee_id removed — reviewer is derived server-side from auth.uid()
      const { error: rpcErr } = await db.rpc('reject_task_request', {
        p_task_id: task.id,
        p_notes: rejectNotes || null
      });
      if (rpcErr) throw rpcErr;
      
      await db.from("notifications").insert([{
        tenant_id: tenantId,
        employee_id: task.assigned_to, title: "Task Rejected",
        body: `Your task "${task.title}" was rejected.${rejectNotes ? ` Reason: ${rejectNotes}` : ""} Please resubmit.`,
        type: "task_rejected", reference_id: task.id,
      }]);
      void logAction("task.rejected", "task", task.id, { reason: rejectNotes });
      success("Task rejected.");
      setRejectId(null); setRejectNotes("");
    } catch (err) {
      toastError("Failed to reject task.");
    } finally {
      setSavingReview(false);
      void fetchTasks();
    }
  }

  async function handleDeleteTask() {
    if (!deleteModal.taskId) return;
    try {
      await db.from("tasks").delete().eq("tenant_id", tenantId).eq("id", deleteModal.taskId);
      success("Task deleted.");
      setDeleteModal({ isOpen: false, taskId: null });
      void fetchTasks();
    } catch (err) {
      toastError("Failed to delete task.");
    }
  }

  const filteredEmp = employees.filter(e =>
    e.full_name.toLowerCase().includes(empSearch.toLowerCase()) || e.email.toLowerCase().includes(empSearch.toLowerCase())
  );

  const TABS: { key: Tab; label: string }[] = [
    { key: "active", label: "Active Tasks" },
    { key: "inbox", label: `Submissions Inbox${tasks.filter(t=>t.status==="submitted").length && tab==="inbox" ? ` (${tasks.length})` : ""}` },
    { key: "all", label: "All Tasks" },
    { key: "assign", label: "Assign Task" },
  ];

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Task Management</h2>
        <p className="text-sm text-slate-500">Assign, track and review employee tasks.</p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${tab===t.key ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ASSIGN TAB ── */}
      {tab === "assign" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8 shadow-sm max-w-5xl">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-slate-900">Assign New Task</h3>
            <p className="text-sm text-slate-500">Fill out the details below to assign a task to an employee or department.</p>
          </div>
          
          <div className="space-y-8">
            {/* Task Details */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-slate-700 border-b border-slate-100 pb-2">1. Task Details</h4>
              <div className="space-y-3">
                <input value={form.title} onChange={e => setForm({...form,title:e.target.value})}
                  placeholder="Task title *" className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition-shadow bg-slate-50 hover:bg-white focus:bg-white" />
                <textarea value={form.description} onChange={e => setForm({...form,description:e.target.value})}
                  placeholder="Description (optional)" rows={3}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition-shadow bg-slate-50 hover:bg-white focus:bg-white resize-none" />
              </div>
            </div>

            {/* Assignment */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-slate-700 border-b border-slate-100 pb-2">2. Assignment</h4>
              
              {/* Segmented Control */}
              <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
                {(["employee","department"] as const).map(m => (
                  <button key={m} onClick={() => setForm({...form,assign_mode:m,assigned_to:"",department:""})}
                    className={`rounded-lg px-5 py-2 text-sm font-medium transition-all capitalize ${form.assign_mode===m?"bg-white text-brand-700 shadow-sm":"text-slate-500 hover:text-slate-700"}`}>
                    {m==="employee" ? "Single Employee" : "Entire Department"}
                  </button>
                ))}
              </div>

              {form.assign_mode === "employee" ? (
                <div className="space-y-3">
                  <input value={empSearch} onChange={e => setEmpSearch(e.target.value)}
                    placeholder="Search employee…" className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition-shadow bg-slate-50 hover:bg-white focus:bg-white" />
                  <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
                    {filteredEmp.map(e => (
                      <button key={e.id} onClick={() => { setForm({...form,assigned_to:e.id}); setEmpSearch(e.full_name); }}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 ${form.assigned_to===e.id?"bg-brand-50":""}`}>
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                          {e.full_name.slice(0,2).toUpperCase()}
                        </span>
                        <span className="flex-1 font-medium text-slate-800">{e.full_name}</span>
                        <span className="text-xs capitalize text-slate-400">{deptLabel(e)}</span>
                        {form.assigned_to === e.id && <Check className="h-4 w-4 text-brand-600" />}
                      </button>
                    ))}
                    {filteredEmp.length === 0 && <div className="p-4 text-center text-sm text-slate-500">No employees found.</div>}
                  </div>
                </div>
              ) : (
                <select value={form.department} onChange={e => setForm({...form,department:e.target.value})}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition-shadow bg-slate-50 hover:bg-white focus:bg-white">
                  <option value="">Select department *</option>
                  {deptOptions.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              )}
            </div>

            {/* Schedule & Priority */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-slate-700 border-b border-slate-100 pb-2">3. Schedule & Priority</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Due Date</label>
                  <input type="date" value={form.due_date} onChange={e => setForm({...form,due_date:e.target.value})}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition-shadow bg-slate-50 hover:bg-white focus:bg-white" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Time</label>
                  <input type="time" value={form.due_time} onChange={e => setForm({...form,due_time:e.target.value})}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition-shadow bg-slate-50 hover:bg-white focus:bg-white" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Priority</label>
                  <select value={form.priority} onChange={e => setForm({...form,priority:e.target.value as Task["priority"]})}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition-shadow bg-slate-50 hover:bg-white focus:bg-white">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">🚨 Urgent</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-100">
              <button onClick={assignTask} disabled={submitting}
                className="rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-brand-700 hover:shadow disabled:opacity-50 active:scale-[0.98]">
                {submitting ? "Assigning…" : "Assign Task"}
              </button>
              <button onClick={() => { setForm(EMPTY_FORM); setEmpSearch(""); }}
                className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]">
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SUBMISSIONS INBOX ── */}
      {tab === "inbox" && (
        <div className="space-y-4">
          {loading ? (
            [...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)
          ) : tasks.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No submissions pending review" description="When employees submit tasks, they will appear here for you to review." />
          ) : tasks.map(task => (
            <div key={task.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-start gap-4 p-5">
                {task.assignee?.profile_photo_url
                  ? <img src={task.assignee.profile_photo_url} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />
                  : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-purple-100 text-sm font-bold text-purple-700">
                      {task.assignee?.full_name.slice(0,2).toUpperCase() ?? "?"}
                    </div>
                }
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900">{task.title}</p>
                  <p className="text-sm text-slate-500">{task.assignee?.full_name ?? "—"} · {deptLabel(task.assignee)}</p>
                  {task.submission && (
                    <p className="mt-1 text-xs text-slate-400">
                      Submitted {new Date(task.submission.submitted_at).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2 items-center">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${PRIORITY_BADGE[task.priority]}`}>{task.priority}</span>
                  <button onClick={() => setExpandedId(expandedId===task.id ? null : task.id)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    {expandedId===task.id ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
                  </button>
                </div>
              </div>

              {expandedId === task.id && task.submission && (
                <div className="border-t border-slate-100 p-5 space-y-4">
                  <div className="rounded-xl bg-purple-50 border border-purple-100 p-4">
                    <p className="text-xs font-semibold text-purple-700 mb-1">Submission Notes</p>
                    <p className="text-sm text-slate-700">{task.submission.notes ?? "No notes provided."}</p>
                    {task.submission.attachment_url && (
                      <a href={task.submission.attachment_url} target="_blank" rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white border border-purple-200 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-50">
                        <Paperclip className="h-3.5 w-3.5" />
                        {task.submission.attachment_name ?? "View Attachment"}
                      </a>
                    )}
                  </div>

                  {rejectId === task.id ? (
                    <div className="space-y-2">
                      <textarea value={rejectNotes} onChange={e => setRejectNotes(e.target.value)}
                        placeholder="Rejection reason (optional)…" rows={2}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-rose-500 focus:ring" />
                      <div className="flex gap-2">
                        <button onClick={() => rejectTask(task)} disabled={savingReview}
                          className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                          Confirm Reject
                        </button>
                        <button onClick={() => { setRejectId(null); setRejectNotes(""); }}
                          className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => approveTask(task)} disabled={savingReview}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                        <Check className="h-4 w-4" /> Approve
                      </button>
                      <button onClick={() => setRejectId(task.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100">
                        <X className="h-4 w-4" /> Reject
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── ACTIVE TASKS + ALL TASKS ── */}
      {(tab === "active" || tab === "all") && (
        <>
          <div className="flex flex-wrap gap-2">
            <SelectDropdown
              value={empFilter}
              onChange={setEmpFilter}
              options={[
                { value: "all", label: "All Employees" },
                ...employees.map(e => ({ value: e.id, label: e.full_name }))
              ]}
              searchable
              containerClassName="min-w-0 flex-1 sm:flex-none sm:min-w-[170px]"
              triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            <SelectDropdown
              value={deptFilter}
              onChange={setDeptFilter}
              options={[{ value: "all", label: "All Departments" }, ...deptOptions]}
              containerClassName="min-w-0 flex-1 sm:flex-none sm:min-w-[150px]"
              triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            {tab==="all" && (
              <SelectDropdown
                value={statusFilter}
                onChange={(val) => setStatusFilter(val as StatusFilter)}
                options={[
                  { value: "all", label: "All Statuses" },
                  ...ALL_TASK_STATUSES.map(s => ({ value: s, label: s.replace("_"," ").replace(/\b\w/g, l => l.toUpperCase()) }))
                ]}
                containerClassName="min-w-0 flex-1 sm:flex-none sm:min-w-[150px]"
                triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            )}
            <SelectDropdown
              value={priorityFilter}
              onChange={(val) => setPriorityFilter(val as PriorityFilter)}
              options={[
                { value: "all", label: "All Priorities" },
                ...(["low","medium","high","urgent"] as const).map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))
              ]}
              containerClassName="min-w-0 flex-1 sm:flex-none sm:min-w-[150px]"
              triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {["Task","Project","Assigned To","Dept","Priority","Due Date","Status","Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(8)].map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[100px]" /></td>
                      ))}
                    </tr>
                  ))
                ) : tasks.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-10">
                      <EmptyState icon={ClipboardList} title="No tasks found" description="No tasks match the current filters." minimal />
                    </td>
                  </tr>
                ) : tasks.map(task => {
                  const expanded = expandedId === task.id;
                  return [
                    <tr key={task.id} className={`hover:bg-slate-50 transition cursor-pointer ${expanded?"bg-slate-50":""}`}
                      onClick={() => setExpandedId(expanded ? null : task.id)}>
                      <td className="px-4 py-3 font-medium text-slate-900">{task.title}</td>
                      <td className="px-4 py-3">
                        {task.project_id ? (
                          <Link to={`/hr/pms/${task.project_id}`} className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 transition" onClick={e => e.stopPropagation()}>
                            {task.projects?.name || "Project"}
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400 font-medium">Standalone</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{task.assignee?.full_name ?? "—"}</td>
                      <td className="px-4 py-3 capitalize text-slate-500 text-xs">{deptLabel(task.assignee)}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${PRIORITY_BADGE[task.priority]}`}>{task.priority}</span></td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{task.due_date ?? "—"}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_BADGE[task.status]}`}>{task.status.replace("_"," ")}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          {(task.status === "submitted" || (task.status === "overdue" && task.submission)) && (
                            <button onClick={() => { setTab("inbox"); setExpandedId(task.id); }}
                              className="rounded-lg bg-purple-50 border border-purple-200 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100">
                              <Eye className="inline h-3 w-3 mr-1"/>Review
                            </button>
                          )}
                          <button onClick={() => setDeleteModal({ isOpen: true, taskId: task.id })}
                            className="rounded-lg border border-rose-200 p-1.5 text-rose-500 hover:bg-rose-50">
                            <Trash2 className="h-3.5 w-3.5"/>
                          </button>
                        </div>
                      </td>
                    </tr>,
                    expanded && task.description ? (
                      <tr key={`${task.id}-detail`} className="bg-slate-50">
                        <td colSpan={8} className="px-4 pb-4 pt-0">
                          <p className="rounded-xl bg-white border border-slate-200 px-4 py-3 text-sm text-slate-600">{task.description}</p>
                        </td>
                      </tr>
                    ) : null
                  ];
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, taskId: null })}
        onConfirm={handleDeleteTask}
        title="Delete Task"
        message="Are you sure you want to delete this task? This action cannot be undone."
        confirmText="Delete Task"
        confirmColor="red"
      />
    </section>
  );
}
