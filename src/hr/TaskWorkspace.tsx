import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import { Skeleton } from "../shared/Skeleton";
import { useToast } from "../shared/ToastContext";
import { getTenantDate } from "../utils/date";
import {
  WorkspaceShell,
  WorkspaceStats,
  WorkspaceSection,
  WorkspaceEmpty,
  type WorkspaceStat,
} from "./components/WorkspaceShell";

/**
 * The Task & Project module's surface. Board-shaped, not time-shaped: what is moving, what is
 * stuck, and what is waiting on HR — as opposed to the attendance workspace's "is the job running".
 * Different layout primitives per module is the point (navigation proposal §4.3).
 *
 * Status vocabulary is the one the database actually enforces:
 *   assigned | in_progress | submitted | approved | rejected
 */

const PIPELINE = [
  { key: "assigned", label: "Assigned" },
  { key: "in_progress", label: "In progress" },
  { key: "submitted", label: "Submitted" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
] as const;

type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  assigned_to: string | null;
  auto_red_marked_at: string | null;
};

type ProjectRow = { id: string; name: string; status: string; end_date: string | null };

export default function TaskWorkspace() {
  const { tenantId, tenant } = useTenant();
  const { error: toastError } = useToast();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});

  const today = useMemo(() => getTenantDate(tenant?.timezone || "UTC"), [tenant?.timezone]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [tasksRes, projectsRes, employeesRes] = await Promise.all([
        db.from("tasks").select("id,title,status,due_date,assigned_to,auto_red_marked_at")
          .eq("tenant_id", tenantId).order("due_date", { ascending: true }).limit(500),
        db.from("projects").select("id,name,status,end_date").eq("tenant_id", tenantId),
        db.from("employees").select("id,full_name").eq("tenant_id", tenantId).eq("status", "active"),
      ]);
      if (tasksRes.error) throw tasksRes.error;
      setTasks((tasksRes.data ?? []) as TaskRow[]);
      setProjects((projectsRes.data ?? []) as ProjectRow[]);
      setEmployeeNames(
        Object.fromEntries(((employeesRes.data ?? []) as { id: string; full_name: string }[]).map((e) => [e.id, e.full_name])),
      );
    } catch (err) {
      console.error("TaskWorkspace load:", err);
      toastError("Failed to load the task overview.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useMemo(() => tasks.filter((t) => t.status !== "approved" && t.status !== "rejected"), [tasks]);
  const overdue = useMemo(
    () => open.filter((t) => t.due_date && t.due_date < today).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    [open, today],
  );
  const awaitingApproval = useMemo(() => tasks.filter((t) => t.status === "submitted"), [tasks]);
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const task of tasks) map[task.status] = (map[task.status] ?? 0) + 1;
    return map;
  }, [tasks]);

  const stats = useMemo<WorkspaceStat[]>(
    () => [
      { label: "Open tasks", value: open.length, hint: `${tasks.length} total`, href: "/hr/tasks" },
      {
        label: "Overdue",
        value: overdue.length,
        tone: overdue.length > 0 ? "bad" : "good",
        hint: overdue.length > 0 ? "Past their due date and not closed" : "Nothing past due",
        href: "/hr/tasks",
      },
      {
        label: "Awaiting approval",
        value: awaitingApproval.length,
        tone: awaitingApproval.length > 0 ? "warn" : "good",
        hint: awaitingApproval.length > 0 ? "Submitted, needs a decision" : "Nothing waiting",
        href: "/hr/tasks",
      },
      {
        label: "Active projects",
        value: projects.filter((p) => p.status === "active").length,
        hint: `${projects.length} total`,
        href: "/hr/pms",
      },
    ],
    [awaitingApproval.length, open.length, overdue.length, projects, tasks.length],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const maxCount = Math.max(1, ...PIPELINE.map((stage) => counts[stage.key] ?? 0));

  return (
    <WorkspaceShell
      title="Task & Project"
      subtitle="What is moving, what is stuck, and what is waiting on you."
      actions={
        <Link to="/hr/tasks" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700">
          Open tasks
        </Link>
      }
    >
      <WorkspaceStats stats={stats} />

      <WorkspaceSection title="Pipeline">
        {tasks.length === 0 ? (
          <WorkspaceEmpty>No tasks yet.</WorkspaceEmpty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-5">
            {PIPELINE.map((stage) => {
              const count = counts[stage.key] ?? 0;
              return (
                <div key={stage.key}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium text-slate-600">{stage.label}</span>
                    <span className="text-sm font-semibold tabular-nums text-slate-900">{count}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${stage.key === "rejected" ? "bg-rose-400" : stage.key === "approved" ? "bg-emerald-400" : "bg-brand-500"}`}
                      style={{ width: `${(count / maxCount) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </WorkspaceSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkspaceSection
          title="Overdue"
          action={<Link to="/hr/tasks" className="text-xs font-semibold text-brand-700 hover:text-brand-800">All tasks →</Link>}
        >
          {overdue.length === 0 ? (
            <WorkspaceEmpty>Nothing is past its due date.</WorkspaceEmpty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {overdue.slice(0, 6).map((task) => (
                <li key={task.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                    <p className="truncate text-xs text-slate-500">
                      {task.assigned_to ? employeeNames[task.assigned_to] ?? "Unassigned" : "Unassigned"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-rose-600">due {task.due_date}</span>
                </li>
              ))}
            </ul>
          )}
        </WorkspaceSection>

        <WorkspaceSection
          title="Awaiting approval"
          action={<Link to="/hr/tasks" className="text-xs font-semibold text-brand-700 hover:text-brand-800">Review →</Link>}
        >
          {awaitingApproval.length === 0 ? (
            <WorkspaceEmpty>Nothing submitted for review.</WorkspaceEmpty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {awaitingApproval.slice(0, 6).map((task) => (
                <li key={task.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                    <p className="truncate text-xs text-slate-500">
                      {task.assigned_to ? employeeNames[task.assigned_to] ?? "Unassigned" : "Unassigned"}
                    </p>
                  </div>
                  {task.due_date ? <span className="shrink-0 text-xs text-slate-400">due {task.due_date}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </WorkspaceSection>
      </div>
    </WorkspaceShell>
  );
}
