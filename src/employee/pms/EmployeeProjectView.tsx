import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ChevronRight, Users, CheckCircle2, Clock, AlertCircle, Paperclip, X, CheckSquare, Send } from "lucide-react";
import { db, storage } from "../../insforge/client";
import { useTenant } from "../../contexts/TenantContext";
import { useEmployee } from "../../hooks/useEmployee";
import { useToast } from "../../shared/ToastContext";
import { Skeleton } from "../../shared/Skeleton";
import { EmptyState } from "../../shared/EmptyState";
import type { Project, Employee, Task, TaskSubmission } from "../../types";

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
  approved: { label: "Approved", color: "bg-emerald-100 text-emerald-700", icon: <CheckCircle2 className="h-4 w-4" /> },
  rejected: { label: "Rejected", color: "bg-rose-100 text-rose-700", icon: <AlertCircle className="h-4 w-4" /> },
  overdue: { label: "Overdue", color: "bg-red-100 text-red-700", icon: <AlertCircle className="h-4 w-4" /> },
};

export default function EmployeeProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const { tenantId } = useTenant();
  const { employee } = useEmployee();
  const navigate = useNavigate();
  const { success, error } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, TaskSubmission>>({});
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [teamMembers, setTeamMembers] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // Expanded card state
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Task submission form state
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchProjectData = async () => {
    if (!tenantId || !projectId || !employee?.id) return;
    try {
      // 1. Fetch project
      const { data: projData, error: projErr } = await db
        .from("projects")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", projectId)
        .maybeSingle();

      if (projErr) throw projErr;
      if (!projData) {
        error("Project not found or you don't have access.");
        navigate("/employee/tasks");
        return;
      }
      setProject(projData as Project);

      // 2. Fetch all employees to map names/avatars
      const { data: empData } = await db
        .from("employee_directory_public")
        .select("id, full_name, profile_photo_url, designation")
        .eq("tenant_id", tenantId)
        .eq("status", "active");
      const empList = (empData ?? []) as Employee[];
      setAllEmployees(empList);

      const empMap = new Map<string, Employee>();
      empList.forEach((e) => empMap.set(e.id, e));

      // 3. Fetch employee's tasks in this project
      const { data: taskData, error: taskErr } = await db
        .from("tasks")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .eq("assigned_to", employee.id)
        .order("created_at", { ascending: false });
      if (taskErr) throw taskErr;
      const taskList = (taskData ?? []) as Task[];
      setTasks(taskList);

      // 4. Fetch submissions for employee's tasks
      const tIds = taskList.map((t) => t.id);
      if (tIds.length > 0) {
        const { data: subData } = await db
          .from("task_submissions")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("task_id", tIds);
        const subMap: Record<string, TaskSubmission> = {};
        (subData ?? []).forEach((s: TaskSubmission) => {
          subMap[s.task_id] = s;
        });
        setSubmissions(subMap);
      } else {
        setSubmissions({});
      }

      // 5. Fetch all tasks in this project to resolve project team members
      const { data: allProjTasks } = await db
        .from("tasks")
        .select("assigned_to")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId);

      if (allProjTasks) {
        const uniqueIds = Array.from(new Set(allProjTasks.map((t) => t.assigned_to)));
        const members = uniqueIds
          .map((id) => empMap.get(id))
          .filter((e) => e && e.id !== employee.id) as Employee[]; // Filter out current employee
        setTeamMembers(members);
      }
    } catch (err: any) {
      console.error(err);
      error(err.message || "Failed to load project details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProjectData();
  }, [tenantId, projectId, employee?.id]);

  const handleSubmitTask = async (task: Task) => {
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
      const { error: rpcErr } = await db.rpc("submit_task_request", {
        p_task_id: task.id,
        p_notes: notes.trim() || null,
        p_attachment_url: attachment_url,
        p_attachment_name: attachment_name,
      });
      if (rpcErr) throw rpcErr;

      // Notify manager or HR
      const targetNotifyId = employee.manager_id;
      if (targetNotifyId) {
        await db.from("notifications").insert([
          {
            employee_id: targetNotifyId,
            tenant_id: tenantId,
            title: "Project Task Submitted",
            body: `${employee.full_name} submitted task: "${task.title}" in project "${project?.name}"`,
            type: "general",
            reference_id: task.id,
          },
        ]);
      } else {
        const { data: hrEmps } = await db.from("employees").select("id").eq("tenant_id", tenantId).eq("department", "operations");
        if (hrEmps && hrEmps.length > 0) {
          await db.from("notifications").insert(
            hrEmps.map((h: { id: string }) => ({
              employee_id: h.id,
              tenant_id: tenantId,
              title: "Project Task Submitted",
              body: `${employee.full_name} submitted task: "${task.title}" in project "${project?.name}"`,
              type: "general",
              reference_id: task.id,
            }))
          );
        }
      }

      success("Task submitted successfully!");
      setNotes("");
      setFile(null);
      setExpandedTaskId(null);
      void fetchProjectData();
    } catch (err: any) {
      console.error(err);
      error(err.message || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const projectManager = useMemo(() => {
    if (!project?.manager_id || allEmployees.length === 0) return null;
    return allEmployees.find((e) => e.id === project.manager_id);
  }, [project, allEmployees]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!project) return null;

  return (
    <section className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <Link to="/employee/tasks?tab=projects" className="hover:text-brand-600 transition">
          My Projects
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-900 truncate max-w-[200px]">{project.name}</span>
      </div>

      {/* Project Overview Card */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-2xl font-bold text-slate-900">{project.name}</h2>
              <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-600">
                {project.status.replace("_", " ")}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-500 font-medium">
              <span>Manager: {projectManager?.full_name || "Unassigned"}</span>
              <span className="hidden sm:inline text-slate-300">•</span>
              <span>
                Timeline: {project.start_date || "—"} → {project.end_date || "—"}
              </span>
            </div>
            <p className="mt-4 text-sm text-slate-600 max-w-3xl leading-relaxed">
              {project.description || "No description provided."}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Employee's Tasks Section */}
        <div className="md:col-span-2 space-y-4">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-brand-600" />
            <span>My Tasks in this Project</span>
          </h3>

          <div className="space-y-3">
            {tasks.map((task) => {
              const expanded = expandedTaskId === task.id;
              const sub = submissions[task.id];
              const cfg = STATUS_CONFIG[task.status] || { label: "Task", color: "bg-slate-100 text-slate-700", icon: null };
              const canSubmit = task.status === "assigned" || task.status === "in_progress" || task.status === "rejected";

              return (
                <div key={task.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div
                    className="flex cursor-pointer items-start justify-between gap-4 p-5 hover:bg-slate-50 transition"
                    onClick={() => {
                      const expanding = !expanded;
                      setExpandedTaskId(expanding ? task.id : null);
                      if (expanding) {
                        setNotes("");
                        setFile(null);
                      }
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900 text-sm leading-snug">{task.title}</p>
                        {task.status === "rejected" && <AlertCircle className="h-4 w-4 text-rose-500" />}
                      </div>
                      {task.due_date && (
                        <p className="text-xs text-slate-400 mt-1">
                          Due: {task.due_date}
                          {task.due_time ? ` at ${task.due_time}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      <span className={`rounded-full px-2.5 py-0.5 font-semibold capitalize ${PRIORITY_BADGE[task.priority]}`}>
                        {task.priority}
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-slate-100 p-5 space-y-4 bg-slate-50/50">
                      {task.description && (
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Instructions</p>
                          <p className="text-sm text-slate-600 bg-white rounded-xl border border-slate-200/50 px-4 py-3">
                            {task.description}
                          </p>
                        </div>
                      )}

                      {task.status === "rejected" && sub && (
                        <div className="rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-700">
                          <p className="font-bold mb-1">Rejected by Manager</p>
                          {sub.review_notes && <p className="font-medium">Reason: {sub.review_notes}</p>}
                          <p className="mt-1 text-rose-500 font-semibold">Please address feedback and re-submit below.</p>
                        </div>
                      )}

                      {task.status === "submitted" && sub && (
                        <div className="rounded-2xl bg-purple-50 border border-purple-200 px-4 py-3 text-xs">
                          <p className="font-bold text-purple-700 mb-1">Awaiting Review</p>
                          {sub.notes && <p className="text-slate-600 font-medium">Your notes: {sub.notes}</p>}
                          {sub.attachment_url && (
                            <a
                              href={sub.attachment_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-brand-600 hover:underline font-semibold"
                            >
                              <Paperclip className="h-3.5 w-3.5" /> {sub.attachment_name || "Attachment"}
                            </a>
                          )}
                        </div>
                      )}

                      {task.status === "approved" && (
                        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs">
                          <p className="font-bold text-emerald-700 flex items-center gap-1">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Approved
                          </p>
                          {sub?.review_notes && (
                            <p className="text-slate-600 mt-1 font-medium">Notes: {sub.review_notes}</p>
                          )}
                        </div>
                      )}

                      {canSubmit && (
                        <div className="space-y-4 border-t border-slate-200/60 pt-4 bg-white p-4 rounded-2xl border border-slate-200">
                          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Submit Your Result</h4>
                          <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            placeholder="Describe what you accomplished..."
                            className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs outline-none ring-brand-600 focus:ring focus:border-brand-500 bg-slate-50 hover:bg-white focus:bg-white resize-none"
                          />

                          {file ? (
                            <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs">
                              <Paperclip className="h-3.5 w-3.5 text-brand-600" />
                              <span className="flex-1 truncate font-medium text-brand-700">{file.name}</span>
                              <button onClick={() => setFile(null)} className="text-slate-400 hover:text-rose-500">
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => fileRef.current?.click()}
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                            >
                              <Paperclip className="h-3.5 w-3.5" /> Attach File
                            </button>
                          )}
                          <input
                            type="file"
                            className="hidden"
                            ref={fileRef}
                            onChange={(e) => setFile(e.target.files?.[0] || null)}
                          />

                          <button
                            onClick={() => void handleSubmitTask(task)}
                            disabled={submitting}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-5 py-2 text-xs font-semibold text-white hover:bg-brand-700 transition shadow disabled:opacity-50"
                          >
                            <Send className="h-3.5 w-3.5" /> {submitting ? "Submitting..." : "Submit Task"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {tasks.length === 0 && (
              <EmptyState
                icon={CheckSquare}
                title="No tasks assigned to you"
                description="Your manager hasn't assigned you any tasks in this project yet."
              />
            )}
          </div>
        </div>

        {/* Team Members Section */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Users className="h-5 w-5 text-brand-600" />
            <span>Project Team</span>
          </h3>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              {projectManager?.profile_photo_url ? (
                <img
                  src={projectManager.profile_photo_url}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover border border-slate-100"
                />
              ) : (
                <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 font-bold text-xs">
                  {projectManager?.full_name.slice(0, 2).toUpperCase() || "?"}
                </div>
              )}
              <div>
                <p className="text-xs font-bold text-slate-800 leading-snug">{projectManager?.full_name || "Unassigned"}</p>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Project Manager</p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Contributors</p>
              {teamMembers.map((member) => (
                <div key={member.id} className="flex items-center gap-2.5">
                  {member.profile_photo_url ? (
                    <img
                      src={member.profile_photo_url}
                      alt=""
                      className="h-7 w-7 rounded-full object-cover border border-slate-100"
                    />
                  ) : (
                    <div className="grid h-7 w-7 place-items-center rounded-full bg-indigo-50 font-bold text-indigo-700 text-[10px]">
                      {member.full_name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span className="text-xs font-semibold text-slate-700 truncate">{member.full_name}</span>
                </div>
              ))}
              {teamMembers.length === 0 && (
                <p className="text-xs font-medium text-slate-400">No other team members assigned yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
