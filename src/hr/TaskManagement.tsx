import { useCallback, useEffect, useState } from "react";
import { Check, X, Eye, Paperclip, ChevronDown, ChevronUp, Trash2, ClipboardList } from "lucide-react";
import type { Employee, Task, TaskSubmission } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import { useAuditLog } from "../hooks/useAuditLog";
import { useEmployee } from "../hooks/useEmployee";
import { useToast } from "../shared/ToastContext";
import { ConfirmModal } from "../shared/ConfirmModal";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";

type Tab = "active" | "inbox" | "all" | "assign";
type StatusFilter = "all" | Task["status"];
type PriorityFilter = "all" | Task["priority"];
const DEPT_OPTIONS = ["all","sales","dev","marketing","operations","design","other"] as const;

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
};

interface TaskWithEmployee extends Task { assignee?: Employee; submission?: TaskSubmission; }

const EMPTY_FORM = {
  title: "", description: "", assigned_to: "", assign_mode: "employee" as "employee"|"department",
  department: "", priority: "medium" as Task["priority"], due_date: "", due_time: "",
};

export default function TaskManagement() {
  const { employee: hrEmployee } = useEmployee();
  const { tenantId } = useTenant();
  const { logAction } = useAuditLog();
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

  useEffect(() => {
    db.from("employees").select("*").eq("tenant_id", tenantId).eq("status","active").order("full_name")
      .then(({ data }) => { if (data) setEmployees(data as Employee[]); });
  }, [tenantId]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      let q = db.from("tasks").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
      if (tab === "active") q = q.in("status", ["assigned","in_progress","submitted"]);
      if (tab === "inbox") q = q.eq("status","submitted");
      if (statusFilter !== "all" && tab === "all") q = q.eq("status", statusFilter);
      if (priorityFilter !== "all") q = q.eq("priority", priorityFilter);
      if (empFilter !== "all") q = q.eq("assigned_to", empFilter);
      if (deptFilter !== "all") q = q.eq("department_filter", deptFilter);
      const { data, error: fetchErr } = await q;
      if (fetchErr) throw fetchErr;
      
      const taskList = (data ?? []) as Task[];
      const subIds = taskList.filter(t => ["submitted","approved","rejected"].includes(t.status)).map(t => t.id);
      let subMap: Record<string,TaskSubmission> = {};
      if (subIds.length > 0) {
        const { data: subs } = await db.from("task_submissions").select("*").eq("tenant_id", tenantId).in("task_id", subIds);
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
    if (!form.title || !hrEmployee?.id) return;
    if (form.assign_mode === "employee" && !form.assigned_to) return;
    if (form.assign_mode === "department" && !form.department) return;
    setSubmitting(true);
    const targets: Employee[] = form.assign_mode === "employee"
      ? employees.filter(e => e.id === form.assigned_to)
      : employees.filter(e => e.department === form.department);
    try {
      for (const emp of targets) {
        await db.from("tasks").insert([{
          title: form.title, description: form.description || null,
          tenant_id: tenantId,
          assigned_to: emp.id, assigned_by: hrEmployee.id,
          department_filter: form.assign_mode === "department" ? form.department : null,
          priority: form.priority, due_date: form.due_date || null, due_time: form.due_time || null,
          status: "assigned",
        }]);
        await db.from("notifications").insert([{
          tenant_id: tenantId,
          employee_id: emp.id, title: "New Task Assigned",
          body: `You have been assigned: "${form.title}"${form.due_date ? ` — due ${form.due_date}` : ""}`,
          type: "task_assigned",
        }]);
      }
      success(`Task assigned to ${targets.length} employee${targets.length !== 1 ? 's' : ''}`);
      setForm(EMPTY_FORM);
      setTab("active");
    } catch (err) {
      toastError("Failed to assign task.");
    } finally {
      setSubmitting(false);
      void fetchTasks();
    }
  }

  async function approveTask(task: TaskWithEmployee) {
    if (!hrEmployee?.id || !task.submission) return;
    setSavingReview(true);
    try {
      const today = new Date().toISOString().slice(0,10);
      await db.from("tasks").update({ status: "approved" }).eq("tenant_id", tenantId).eq("id", task.id);
      await db.from("task_submissions").update({
        status: "approved", reviewed_by: hrEmployee.id, reviewed_at: new Date().toISOString(),
      }).eq("tenant_id", tenantId).eq("id", task.submission.id);
      await db.from("attendance").update({ punch_out_allowed: true })
        .eq("tenant_id", tenantId).eq("employee_id", task.assigned_to).eq("date", today);
      await db.from("calendar_events").insert([{
        tenant_id: tenantId,
        employee_id: task.assigned_to, date: today, type: "green", task_id: task.id,
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
    if (!hrEmployee?.id || !task.submission) return;
    setSavingReview(true);
    try {
      await db.from("tasks").update({ status: "assigned" }).eq("tenant_id", tenantId).eq("id", task.id);
      await db.from("task_submissions").update({
        status: "rejected", reviewed_by: hrEmployee.id, reviewed_at: new Date().toISOString(),
        review_notes: rejectNotes || null,
      }).eq("tenant_id", tenantId).eq("id", task.submission.id);
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
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-800">Assign New Task</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={form.title} onChange={e => setForm({...form,title:e.target.value})}
              placeholder="Task title *" className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring md:col-span-2" />
            <textarea value={form.description} onChange={e => setForm({...form,description:e.target.value})}
              placeholder="Description (optional)" rows={3}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring md:col-span-2" />

            {/* Assign mode toggle */}
            <div className="flex gap-2 md:col-span-2">
              {(["employee","department"] as const).map(m => (
                <button key={m} onClick={() => setForm({...form,assign_mode:m,assigned_to:"",department:""})}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium border transition capitalize ${form.assign_mode===m?"bg-brand-600 text-white border-brand-600":"border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  {m==="employee" ? "Single Employee" : "Entire Department"}
                </button>
              ))}
            </div>

            {form.assign_mode === "employee" ? (
              <div className="md:col-span-2 space-y-2">
                <input value={empSearch} onChange={e => setEmpSearch(e.target.value)}
                  placeholder="Search employee…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {filteredEmp.map(e => (
                    <button key={e.id} onClick={() => { setForm({...form,assigned_to:e.id}); setEmpSearch(e.full_name); }}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-slate-50 ${form.assigned_to===e.id?"bg-brand-50":""}`}>
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                        {e.full_name.slice(0,2).toUpperCase()}
                      </span>
                      <span className="flex-1 font-medium text-slate-800">{e.full_name}</span>
                      <span className="text-xs capitalize text-slate-400">{e.department ?? "—"}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <select value={form.department} onChange={e => setForm({...form,department:e.target.value})}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring md:col-span-2">
                <option value="">Select department *</option>
                {DEPT_OPTIONS.filter(d=>d!=="all").map(d=><option key={d} value={d} className="capitalize">{d}</option>)}
              </select>
            )}

            <select value={form.priority} onChange={e => setForm({...form,priority:e.target.value as Task["priority"]})}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring">
              <option value="low">Low Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="high">High Priority</option>
              <option value="urgent">🚨 Urgent</option>
            </select>
            <div />
            <input type="date" value={form.due_date} onChange={e => setForm({...form,due_date:e.target.value})}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />
            <input type="time" value={form.due_time} onChange={e => setForm({...form,due_time:e.target.value})}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={assignTask} disabled={submitting}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {submitting ? "Assigning…" : "Assign Task"}
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setEmpSearch(""); }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Reset</button>
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
                  <p className="text-sm text-slate-500">{task.assignee?.full_name ?? "—"} · {task.assignee?.department ?? "—"}</p>
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
            <select value={empFilter} onChange={e => setEmpFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none ring-brand-600 focus:ring">
              <option value="all">All Employees</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none ring-brand-600 focus:ring">
              {DEPT_OPTIONS.map(d => <option key={d} value={d} className="capitalize">{d==="all"?"All Departments":d}</option>)}
            </select>
            {tab==="all" && (
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none ring-brand-600 focus:ring">
                <option value="all">All Statuses</option>
                {(["assigned","in_progress","submitted","approved","rejected"] as const).map(s =>
                  <option key={s} value={s}>{s.replace("_"," ")}</option>
                )}
              </select>
            )}
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as PriorityFilter)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none ring-brand-600 focus:ring">
              <option value="all">All Priorities</option>
              {(["low","medium","high","urgent"] as const).map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
            </select>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {["Task","Assigned To","Dept","Priority","Due Date","Status","Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(7)].map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[100px]" /></td>
                      ))}
                    </tr>
                  ))
                ) : tasks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-10">
                      <EmptyState icon={ClipboardList} title="No tasks found" description="No tasks match the current filters." />
                    </td>
                  </tr>
                ) : tasks.map(task => {
                  const expanded = expandedId === task.id;
                  return [
                    <tr key={task.id} className={`hover:bg-slate-50 transition cursor-pointer ${expanded?"bg-slate-50":""}`}
                      onClick={() => setExpandedId(expanded ? null : task.id)}>
                      <td className="px-4 py-3 font-medium text-slate-900">{task.title}</td>
                      <td className="px-4 py-3 text-slate-600">{task.assignee?.full_name ?? "—"}</td>
                      <td className="px-4 py-3 capitalize text-slate-500 text-xs">{task.assignee?.department ?? "—"}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${PRIORITY_BADGE[task.priority]}`}>{task.priority}</span></td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{task.due_date ?? "—"}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_BADGE[task.status]}`}>{task.status.replace("_"," ")}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          {task.status === "submitted" && (
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
                        <td colSpan={7} className="px-4 pb-4 pt-0">
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
