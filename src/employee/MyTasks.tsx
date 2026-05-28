
import { useEffect, useRef, useState } from "react";
import { Paperclip, X, CheckCircle, Clock, AlertCircle, XCircle, CheckSquare } from "lucide-react";
import type { Task, TaskSubmission } from "../types";
import { db, storage } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";



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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, TaskSubmission>>({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { success, error } = useToast();

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

  useEffect(() => { void fetchTasks(); }, [employee?.id, tenantId]);

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

      const { error: rpcErr } = await db.rpc('submit_task_request', {
        p_task_id: task.id,
        p_employee_id: employee.id,
        p_notes: notes || null,
        p_attachment_url: attachment_url,
        p_attachment_name: attachment_name
      });
      if (rpcErr) throw rpcErr;

      // Notify HR
      const { data: hrEmps } = await db.from("employees").select("id").eq("tenant_id", tenantId).eq("department", "operations");
      if (hrEmps && hrEmps.length > 0) {
        await db.from("notifications").insert(
          hrEmps.map((h: { id: string }) => ({
            employee_id: h.id,
            tenant_id: tenantId,
            title: "Task Submitted",
            body: `${employee.full_name} submitted: "${task.title}"`,
            type: "general",
            reference_id: task.id,
          }))
        );
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
      <div>
        <h2 className="text-xl font-semibold text-slate-900">My Tasks</h2>
        <p className="text-sm text-slate-500">{tasks.length} task{tasks.length !== 1 ? "s" : ""} assigned to you.</p>
      </div>

      {tasks.length === 0 ? (
        <EmptyState icon={CheckSquare} title="No tasks assigned to you yet" description="You'll see your tasks here when HR assigns them." />
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

                {/* Expanded Detail */}
                {expanded && (
                  <div className="border-t border-slate-100 p-4 space-y-4">
                    {task.description && (
                      <p className="text-sm text-slate-600 bg-slate-50 rounded-xl px-4 py-3">{task.description}</p>
                    )}

                    {/* Rejected state */}
                    {task.status === "rejected" && sub && (
                      <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
                        <p className="font-semibold mb-1">Rejected by HR</p>
                        {sub.review_notes && <p className="text-xs">Reason: {sub.review_notes}</p>}
                        <p className="text-xs mt-1 text-rose-500">Please re-submit your task below.</p>
                      </div>
                    )}

                    {/* Submitted state */}
                    {task.status === "submitted" && sub && (
                      <div className="rounded-xl bg-purple-50 border border-purple-200 px-4 py-3 text-sm">
                        <p className="font-semibold text-purple-700 mb-1">Awaiting HR Review</p>
                        {sub.notes && <p className="text-slate-600 text-xs">Your notes: {sub.notes}</p>}
                        {sub.attachment_url && (
                          <a href={sub.attachment_url} target="_blank" rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
                            <Paperclip className="h-3.5 w-3.5" /> {sub.attachment_name ?? "Attachment"}
                          </a>
                        )}
                      </div>
                    )}

                    {/* Approved state */}
                    {task.status === "approved" && (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm">
                        <p className="font-semibold text-emerald-700 flex items-center gap-1"><CheckCircle className="h-4 w-4" /> Approved by HR</p>
                        {sub?.review_notes && <p className="text-slate-600 text-xs mt-1">Notes: {sub.review_notes}</p>}
                      </div>
                    )}

                    {/* Submit form */}
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
                          {submitting ? "Submitting…" : "Submit Task"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
