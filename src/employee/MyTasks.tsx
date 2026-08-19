import { useEffect, useRef, useState, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Paperclip, X, CheckCircle, Clock, AlertCircle, XCircle, CheckSquare, Plus, Trash2, ClipboardList, FolderKanban } from "lucide-react";
import type { Task, TaskSubmission, Employee } from "../types";
import { db, storage } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { useManagerView } from "../hooks/useManagerView";
import { resolveTaskNotificationTargets } from "../utils/notificationTargets";

const PRIORITY_BADGE: Record<Task["priority"], string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-rose-100 text-rose-700",
};

const STATUS_CONFIG: Record<Task["status"], { label: string; color: string; icon: React.ReactNode }> = {
  assigned: { label: "Assigned", color: "bg-blue-100 text-blue-700", icon: <Clock className="h-4 w-4" /> },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-700", icon: <Clock className="h-4 w-4" /> },
  submitted: { label: "Submitted", color: "bg-purple-100 text-purple-700", icon: <Clock className="h-4 w-4" /> },
  approved: { label: "Approved", color: "bg-emerald-100 text-emerald-700", icon: <CheckCircle className="h-4 w-4" /> },
  rejected: { label: "Rejected", color: "bg-rose-100 text-rose-700", icon: <XCircle className="h-4 w-4" /> },
  overdue: { label: "Overdue", color: "bg-red-100 text-red-700", icon: <AlertCircle className="h-4 w-4" /> },
};

export default function MyTasks() {
  const { employee } = useEmployee();
  const { tenantId } = useTenant();
  const { isManagerMode, directReportIds } = useManagerView();

  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"my" | "team" | "projects">("my");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, TaskSubmission>>({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  // Submission variables for employee punching task
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Manager-specific task states
  const [teamTasks, setTeamTasks] = useState<Task[]>([]);
  const [teamSubmissions, setTeamSubmissions] = useState<Record<string, TaskSubmission>>({});
  const [teamEmployees, setTeamEmployees] = useState<Employee[]>([]);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignForm, setAssignForm] = useState({
    title: "",
    description: "",
    assigned_to: "",
    priority: "medium" as Task["priority"],
    due_date: "",
    due_time: "",
  });
  const [assignSubmitting, setAssignSubmitting] = useState(false);

  // Manager review states
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  const { success, error } = useToast();

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "projects") {
      setActiveTab("projects");
    } else if (isManagerMode) {
      setActiveTab("team");
    } else {
      setActiveTab("my");
    }
  }, [isManagerMode, searchParams]);

  const fetchTasks = async () => {
    if (!employee?.id || !tenantId) return;
    try {
      const { data: taskData, error: taskErr } = await db.from("tasks").select("*").eq("tenant_id", tenantId).eq("assigned_to", employee.id).order("created_at", { ascending: false });
      if (taskErr) throw taskErr;
      const tList = (taskData ?? []) as Task[];
      setTasks(tList);

      const ids = tList.map(t => t.id);
      if (ids.length > 0) {
        const { data: subData, error: subErr } = await db.from("task_submissions")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("task_id", ids)
          .order("submitted_at", { ascending: true });
        if (subErr) throw subErr;
        const map: Record<string, TaskSubmission> = {};
        (subData ?? []).forEach((s: TaskSubmission) => { map[s.task_id] = s; });
        setSubmissions(map);
      }
    } catch (err) {
      error("Failed to fetch tasks.");
    } finally {
      setLoading(false);
    }
  };

  const fetchTeamTasks = async () => {
    if (!tenantId || directReportIds.length === 0) {
      setTeamTasks([]);
      return;
    }
    try {
      const { data: taskData, error: taskErr } = await db
        .from("tasks")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("assigned_to", directReportIds)
        .order("created_at", { ascending: false });
      if (taskErr) throw taskErr;
      const tList = (taskData ?? []) as Task[];
      setTeamTasks(tList);

      const ids = tList.map(t => t.id);
      if (ids.length > 0) {
        const { data: subData, error: subErr } = await db.from("task_submissions")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("task_id", ids)
          .order("submitted_at", { ascending: true });
        if (subErr) throw subErr;
        const map: Record<string, TaskSubmission> = {};
        (subData ?? []).forEach((s: TaskSubmission) => { map[s.task_id] = s; });
        setTeamSubmissions(map);
      }

      const { data: empData } = await db
        .from("employees")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("id", directReportIds);
      if (empData) {
        setTeamEmployees(empData as Employee[]);
      }
    } catch (err) {
      console.error("Failed to fetch team tasks", err);
    }
  };

  useEffect(() => {
    void fetchTasks();
    if (isManagerMode && directReportIds.length > 0) {
      void fetchTeamTasks();
    }
  }, [employee?.id, tenantId, isManagerMode, directReportIds]);

  async function submitTask(task: Task) {
    if (!employee?.id || !tenantId || submitting) return;
    setSubmitting(true);
    let attachment_url = null;
    let attachment_name = null;

    try {
      if (file) {
        const { data: uploadData, error: uploadErr } = await storage.from("task-attachments").uploadAuto(file);
        if (uploadErr || !uploadData) throw new Error(`Failed to upload file: ${uploadErr?.message}`);
        attachment_url = uploadData.url;
        attachment_name = file.name;
      }

      // Submitter identity is derived server-side from auth.uid(); do not pass p_employee_id.
      const { error: rpcErr } = await db.rpc('submit_task_request', {
        p_task_id: task.id,
        p_notes: notes || null,
        p_attachment_url: attachment_url,
        p_attachment_name: attachment_name
      });
      if (rpcErr) throw rpcErr;

      // Notify the manager, else the unit head chain (06 §9.1: own unit head → parent unit head → HR)
      const targetNotifyIds = employee.manager_id
        ? [employee.manager_id]
        : await resolveTaskNotificationTargets(tenantId, employee.id, employee.org_unit_id);

      if (targetNotifyIds.length > 0) {
        // .select() matters: RLS refuses a write by matching zero rows, which comes back as a
        // SUCCESSFUL empty response rather than an error.
        const { data: notified, error: notifyErr } = await db.from("notifications").insert(
          targetNotifyIds.map((id) => ({
            employee_id: id,
            tenant_id: tenantId,
            title: "Task Submitted",
            body: `${employee.full_name} submitted task: "${task.title}"`,
            type: "general",
            reference_id: task.id,
          }))
        ).select();
        if (notifyErr || !notified || (notified as unknown[]).length === 0) {
          console.error("Task submitted, but the submission notification was refused.", notifyErr);
        }
      } else {
        console.error("Task submitted, but no notification recipient could be resolved.");
      }

      success("Task submitted successfully!");
      setNotes(""); setFile(null); setExpandedId(null);
      void fetchTasks();
    } catch (err) {
      console.error(err);
      error("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssignTask(e: React.FormEvent) {
    e.preventDefault();
    if (!assignForm.title || !assignForm.assigned_to || !employee?.id) {
      error("Task title and assignee are required.");
      return;
    }
    setAssignSubmitting(true);
    try {
      const { error: taskErr } = await db.from("tasks").insert([{
        title: assignForm.title,
        description: assignForm.description || null,
        tenant_id: tenantId,
        assigned_to: assignForm.assigned_to,
        assigned_by: employee.id,
        priority: assignForm.priority,
        due_date: assignForm.due_date || null,
        due_time: assignForm.due_time || null,
        status: "assigned",
        attendance_lock_date: assignForm.due_date || null
      }]);
      if (taskErr) throw taskErr;

      await db.from("notifications").insert([{
        tenant_id: tenantId,
        employee_id: assignForm.assigned_to,
        title: "New Task Assigned",
        body: `You have been assigned task: "${assignForm.title}"${assignForm.due_date ? ` — due ${assignForm.due_date}` : ""}`,
        type: "task_assigned",
      }]);

      success("Task assigned successfully!");
      setAssignForm({ title: "", description: "", assigned_to: "", priority: "medium", due_date: "", due_time: "" });
      setShowAssignForm(false);
      void fetchTeamTasks();
    } catch (err: any) {
      console.error(err);
      error(err.message || "Failed to assign task.");
    } finally {
      setAssignSubmitting(false);
    }
  }

  async function handleApproveTask(task: Task) {
    setSavingReview(true);
    try {
      const { error: rpcErr } = await db.rpc('approve_task_request', {
        p_task_id: task.id
      });
      if (rpcErr) throw rpcErr;
      
      const targetDate = task.attendance_lock_date || task.due_date || new Date().toISOString().slice(0, 10);
      
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

      success("Task approved.");
      void fetchTeamTasks();
    } catch (err) {
      error("Failed to approve task.");
    } finally {
      setSavingReview(false);
    }
  }

  async function handleRejectTask(task: Task) {
    if (!rejectNotes.trim()) {
      error("Please enter rejection notes.");
      return;
    }
    setSavingReview(true);
    try {
      const { error: rpcErr } = await db.rpc('reject_task_request', {
        p_task_id: task.id,
        p_notes: rejectNotes
      });
      if (rpcErr) throw rpcErr;
      
      await db.from("notifications").insert([{
        tenant_id: tenantId,
        employee_id: task.assigned_to, title: "Task Rejected",
        body: `Your task "${task.title}" was rejected. Reason: ${rejectNotes}. Please resubmit.`,
        type: "task_rejected", reference_id: task.id,
      }]);

      success("Task rejected.");
      setRejectId(null); setRejectNotes("");
      void fetchTeamTasks();
    } catch (err) {
      error("Failed to reject task.");
    } finally {
      setSavingReview(false);
    }
  }

  async function handleDeleteTask(taskId: string) {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      const { error: delErr } = await db.from("tasks").delete().eq("tenant_id", tenantId).eq("id", taskId);
      if (delErr) throw delErr;
      success("Task deleted.");
      void fetchTeamTasks();
    } catch (err) {
      error("Failed to delete task.");
    }
  }

  if (loading) return (
    <section className="space-y-5">
      <Skeleton className="h-16 w-64" />
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
      </div>
    </section>
  );

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{isManagerMode ? "Team Tasks" : "My Tasks"}</h2>
          <p className="text-sm text-slate-500">
            {isManagerMode ? "Delegate and review tasks for your team." : `${tasks.length} task${tasks.length !== 1 ? "s" : ""} assigned to you.`}
          </p>
        </div>
        {isManagerMode && (
          <button
            onClick={() => setShowAssignForm(!showAssignForm)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition"
          >
            <Plus className="h-4 w-4" /> {showAssignForm ? "Cancel Assignment" : "Assign Task"}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {isManagerMode && (
          <button onClick={() => setActiveTab("team")}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab==="team" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
            Team Tasks
          </button>
        )}
        <button onClick={() => setActiveTab("my")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab==="my" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
          My Tasks
        </button>
        <button onClick={() => setActiveTab("projects")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab==="projects" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
          Projects
        </button>
      </div>

      {/* Assign Task Form */}
      {isManagerMode && showAssignForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm max-w-lg">
          <h3 className="font-semibold text-slate-800 mb-4">Assign New Task</h3>
          <form onSubmit={handleAssignTask} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Task Title *</label>
              <input type="text" value={assignForm.title} onChange={e => setAssignForm({...assignForm, title: e.target.value})} required
                placeholder="Enter task title"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
              <textarea value={assignForm.description} onChange={e => setAssignForm({...assignForm, description: e.target.value})} rows={3}
                placeholder="Enter task description"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring resize-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Assign To *</label>
              <select value={assignForm.assigned_to} onChange={e => setAssignForm({...assignForm, assigned_to: e.target.value})} required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring">
                <option value="">Select team member</option>
                {teamEmployees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Due Date</label>
                <input type="date" value={assignForm.due_date} onChange={e => setAssignForm({...assignForm, due_date: e.target.value})}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Due Time</label>
                <input type="time" value={assignForm.due_time} onChange={e => setAssignForm({...assignForm, due_time: e.target.value})}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Priority</label>
              <select value={assignForm.priority} onChange={e => setAssignForm({...assignForm, priority: e.target.value as Task["priority"]})}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <button type="submit" disabled={assignSubmitting}
              className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition">
              {assignSubmitting ? "Assigning…" : "Assign Task"}
            </button>
          </form>
        </div>
      )}

      {/* Personal Tasks Render */}
      {activeTab === "my" && (
        tasks.length === 0 ? (
          <EmptyState icon={CheckSquare} title="No tasks assigned to you yet" description="You'll see your tasks here when your manager assigns them." />
        ) : (
          <div className="space-y-3">
            {tasks.map(task => {
              const expanded = expandedId === task.id;
              const sub = submissions[task.id];
              const cfg = STATUS_CONFIG[task.status];
              const canSubmit = task.status === "assigned" || task.status === "in_progress" || task.status === "rejected";

              return (
                <div key={task.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div
                    className="flex cursor-pointer items-start justify-between gap-4 p-4 hover:bg-slate-50 transition"
                    onClick={() => {
                      const expanding = !expanded;
                      setExpandedId(expanding ? task.id : null);
                      if (expanding) { setNotes(""); setFile(null); }
                    }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900">{task.title}</p>
                        {task.status === "rejected" && <AlertCircle className="h-4 w-4 text-rose-500" />}
                      </div>
                      {task.due_date && <p className="text-xs text-slate-500 mt-0.5">Due: {task.due_date}{task.due_time ? ` at ${task.due_time}` : ""}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${PRIORITY_BADGE[task.priority]}`}>{task.priority}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.color}`}>{cfg.icon} {cfg.label}</span>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-slate-100 p-4 space-y-4">
                      {task.description && (
                        <p className="text-sm text-slate-600 bg-slate-50 rounded-xl px-4 py-3">{task.description}</p>
                      )}

                      {task.status === "rejected" && sub && (
                        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
                          <p className="font-semibold mb-1">Rejected by Manager</p>
                          {sub.review_notes && <p className="text-xs">Reason: {sub.review_notes}</p>}
                          <p className="text-xs mt-1 text-rose-500">Please re-submit your task below.</p>
                        </div>
                      )}

                      {task.status === "submitted" && sub && (
                        <div className="rounded-xl bg-purple-50 border border-purple-200 px-4 py-3 text-sm">
                          <p className="font-semibold text-purple-700 mb-1">Awaiting Manager Review</p>
                          {sub.notes && <p className="text-slate-600 text-xs">Your notes: {sub.notes}</p>}
                          {sub.attachment_url && (
                            <a href={sub.attachment_url} target="_blank" rel="noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
                              <Paperclip className="h-3.5 w-3.5" /> {sub.attachment_name ?? "Attachment"}
                            </a>
                          )}
                        </div>
                      )}

                      {task.status === "approved" && (
                        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm">
                          <p className="font-semibold text-emerald-700 flex items-center gap-1"><CheckCircle className="h-4 w-4" /> Approved</p>
                          {sub?.review_notes && <p className="text-slate-600 text-xs mt-1">Notes: {sub.review_notes}</p>}
                        </div>
                      )}

                      {canSubmit && (
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-slate-700">Submit Your Work</h4>
                          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                            placeholder="Describe what you did / your result…"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />

                          {file ? (
                            <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs">
                              <Paperclip className="h-3.5 w-3.5 text-brand-600" />
                              <span className="flex-1 truncate font-medium text-brand-700">{file.name}</span>
                              <button onClick={() => setFile(null)} className="text-slate-400 hover:text-rose-500"><X className="h-3.5 w-3.5" /></button>
                            </div>
                          ) : (
                            <button onClick={() => fileRef.current?.click()}
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
                              <Paperclip className="h-3.5 w-3.5" /> Attach File (optional)
                            </button>
                          )}
                          <input type="file" className="hidden" ref={fileRef} onChange={e => setFile(e.target.files?.[0] || null)} />

                          <button onClick={() => submitTask(task)} disabled={submitting}
                            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                            {submitting ? "Submit Task" : "Submit Task"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Team Tasks Render */}
      {activeTab === "team" && isManagerMode && (
        teamTasks.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No team tasks delegated yet" description="Assign your team members tasks using the button above." />
        ) : (
          <div className="space-y-3">
            {teamTasks.map(task => {
              const expanded = expandedId === task.id;
              const sub = teamSubmissions[task.id];
              const cfg = STATUS_CONFIG[task.status];
              const emp = teamEmployees.find(e => e.id === task.assigned_to);

              return (
                <div key={task.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div
                    className="flex cursor-pointer items-start justify-between gap-4 p-4 hover:bg-slate-50 transition"
                    onClick={() => {
                      setExpandedId(expanded ? null : task.id);
                      setRejectId(null); setRejectNotes("");
                    }}>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">{task.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Assigned To: <span className="font-medium text-slate-700">{emp?.full_name ?? "Unknown"}</span>
                        {task.due_date && ` | Due: ${task.due_date}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${PRIORITY_BADGE[task.priority]}`}>{task.priority}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.color}`}>{cfg.icon} {cfg.label}</span>
                      <button onClick={e => { e.stopPropagation(); handleDeleteTask(task.id); }}
                        className="rounded-lg border border-rose-200 p-1 text-rose-500 hover:bg-rose-50 transition">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-slate-100 p-4 space-y-4">
                      {task.description && (
                        <p className="text-sm text-slate-600 bg-slate-50 rounded-xl px-4 py-3">{task.description}</p>
                      )}

                      {/* Review Area */}
                      {task.status === "submitted" && sub && (
                        <div className="rounded-xl bg-purple-50 border border-purple-100 p-4 space-y-3">
                          <p className="text-xs font-semibold text-purple-700">Submission Details</p>
                          <p className="text-sm text-slate-700">{sub.notes ?? "No submission notes."}</p>
                          {sub.attachment_url && (
                            <a href={sub.attachment_url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-purple-200 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-50">
                              <Paperclip className="h-3.5 w-3.5" />
                              {sub.attachment_name ?? "View Attachment"}
                            </a>
                          )}

                          {rejectId === task.id ? (
                            <div className="space-y-2 pt-2 border-t border-purple-200">
                              <textarea value={rejectNotes} onChange={e => setRejectNotes(e.target.value)}
                                placeholder="Rejection notes (required)…" rows={2} required
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-rose-500 focus:ring" />
                              <div className="flex gap-2">
                                <button onClick={() => handleRejectTask(task)} disabled={savingReview}
                                  className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                                  Confirm Reject
                                </button>
                                <button onClick={() => { setRejectId(null); setRejectNotes(""); }}
                                  className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex gap-2 pt-2 border-t border-purple-200">
                              <button onClick={() => handleApproveTask(task)} disabled={savingReview}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition">
                                Approve Task
                              </button>
                              <button onClick={() => setRejectId(task.id)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-100 transition">
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {task.status === "approved" && sub && (
                        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
                          <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1"><CheckCircle className="h-4 w-4" /> Task Approved</p>
                          <p className="text-xs text-slate-500 mt-1">Submitted notes: {sub.notes}</p>
                          {sub.attachment_url && (
                            <a href={sub.attachment_url} target="_blank" rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
                              <Paperclip className="h-3.5 w-3.5" /> {sub.attachment_name ?? "Attachment"}
                            </a>
                          )}
                        </div>
                      )}

                      {task.status === "rejected" && sub && (
                        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4">
                          <p className="text-xs font-semibold text-rose-700 flex items-center gap-1"><AlertCircle className="h-4 w-4" /> Task Rejected</p>
                          {sub.review_notes && <p className="text-xs text-slate-600 mt-1">Rejection reason: {sub.review_notes}</p>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Projects Render */}
      {activeTab === "projects" && (
        <EmployeeProjectsTab employeeId={employee?.id} tenantId={tenantId} />
      )}
    </section>
  );
}

function EmployeeProjectsTab({ employeeId, tenantId }: { employeeId?: string; tenantId: string | null }) {
  const [empProjTasks, setEmpProjTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!employeeId || !tenantId) return;
    setLoading(true);
    db.from("tasks")
      .select("*, projects(*)")
      .eq("tenant_id", tenantId)
      .eq("assigned_to", employeeId)
      .not("project_id", "is", null)
      .then(({ data, error }) => {
        if (!error && data) {
          setEmpProjTasks(data);
        }
        setLoading(false);
      });
  }, [employeeId, tenantId]);

  const projectsList = useMemo(() => {
    const map: Record<string, { id: string; name: string; status: string; taskCount: number; approvedCount: number }> = {};
    empProjTasks.forEach((t) => {
      if (!t.project_id || !t.projects) return;
      const p = t.projects;
      if (!map[t.project_id]) {
        map[t.project_id] = {
          id: t.project_id,
          name: p.name,
          status: p.status,
          taskCount: 0,
          approvedCount: 0,
        };
      }
      map[t.project_id].taskCount++;
      if (t.status === "approved") {
        map[t.project_id].approvedCount++;
      }
    });
    return Object.values(map);
  }, [empProjTasks]);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {[...Array(2)].map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (projectsList.length === 0) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="No projects assigned"
        description="You are not assigned to any project tasks currently."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {projectsList.map((proj) => {
        const progress = proj.taskCount > 0 ? Math.round((proj.approvedCount / proj.taskCount) * 100) : 0;
        const colors =
          {
            planning: "bg-blue-50 text-blue-700 border-blue-200",
            active: "bg-emerald-50 text-emerald-700 border-emerald-200",
            on_hold: "bg-amber-50 text-amber-700 border-amber-200",
            completed: "bg-slate-50 text-slate-700 border-slate-200",
            cancelled: "bg-rose-50 text-rose-700 border-rose-200",
          }[proj.status] || "bg-slate-50 text-slate-700";

        return (
          <div
            key={proj.id}
            onClick={() => navigate(`/employee/pms/${proj.id}`)}
            className="group relative flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow hover:border-slate-300 transition cursor-pointer"
          >
            <div>
              <div className="flex items-start justify-between gap-4">
                <h4 className="font-bold text-slate-800 group-hover:text-brand-600 transition truncate max-w-[70%]">
                  {proj.name}
                </h4>
                <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold capitalize ${colors}`}>
                  {proj.status.replace("_", " ")}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400 font-medium">
                {proj.taskCount} task{proj.taskCount !== 1 ? "s" : ""} assigned to you
              </p>
            </div>

            <div className="mt-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-slate-500">
                  {proj.approvedCount} / {proj.taskCount} tasks approved
                </span>
                <span className="text-brand-600">{progress}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

