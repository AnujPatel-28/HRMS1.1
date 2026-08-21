import { useEffect, useState, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ChevronRight, Calendar, Users, FolderKanban, CheckCircle2, AlertCircle, Edit, Trash2, Plus, X, Paperclip, Check, Search } from "lucide-react";
import { db } from "../../insforge/client";
import { useTenant } from "../../contexts/TenantContext";
import { useEmployee } from "../../hooks/useEmployee";
import { useToast } from "../../shared/ToastContext";
import { Skeleton } from "../../shared/Skeleton";
import { EmptyState } from "../../shared/EmptyState";
import { useAuditLog } from "../../hooks/useAuditLog";
import type { Project, Employee, Task, TaskSubmission } from "../../types";
import { useDepartmentLabel, useJobTitleLabel } from "../../contexts/OrgUnitsContext";
import { useTenantHrIds } from "../../hooks/useTenantHrIds";

const PRIORITY_DOT: Record<Task["priority"], string> = {
  low: "bg-slate-400",
  medium: "bg-blue-500",
  high: "bg-amber-500",
  urgent: "bg-rose-500",
};

const STATUS_CONFIG: Record<Task["status"], { label: string; color: string }> = {
  assigned: { label: "Assigned", color: "bg-blue-50 text-blue-700 border-blue-100" },
  in_progress: { label: "In Progress", color: "bg-amber-50 text-amber-700 border-amber-100" },
  submitted: { label: "Submitted", color: "bg-purple-50 text-purple-700 border-purple-100" },
  approved: { label: "Approved", color: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  rejected: { label: "Rejected", color: "bg-rose-50 text-rose-700 border-rose-100" },
  overdue: { label: "Overdue", color: "bg-red-50 text-red-700 border-red-100" },
};

const STATUS_COLOR: Record<Project["status"], string> = {
  planning: "bg-blue-50 text-blue-700 border-blue-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  on_hold: "bg-amber-50 text-amber-700 border-amber-200",
  completed: "bg-slate-50 text-slate-700 border-slate-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
};

const DEPT_OPTIONS = ["sales", "dev", "marketing", "operations", "design", "other"] as const;

// Org unit picker for the "departments" visibility branch (Slice B org_unit_ids write path). Same
// depth/hierarchical-sort shape as src/hr/OrgStructureManagement.tsx, trimmed to the columns needed.
type OrgUnitOption = { id: string; name: string; parent_id: string | null };

function getOrgUnitDepth(unit: OrgUnitOption, all: OrgUnitOption[]): number {
  let depth = 0;
  let parentId = unit.parent_id;
  const visited = new Set<string>();
  while (parentId) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = all.find(u => u.id === parentId);
    if (!parent) break;
    depth++;
    parentId = parent.parent_id;
  }
  return depth;
}

function sortOrgUnitsHierarchically(units: OrgUnitOption[]): OrgUnitOption[] {
  const roots = units.filter(u => !u.parent_id || !units.some(p => p.id === u.parent_id));
  const childrenMap = new Map<string, OrgUnitOption[]>();
  units.forEach(u => {
    if (u.parent_id) {
      const list = childrenMap.get(u.parent_id) || [];
      list.push(u);
      childrenMap.set(u.parent_id, list);
    }
  });
  const result: OrgUnitOption[] = [];
  const traverse = (node: OrgUnitOption) => {
    result.push(node);
    const children = (childrenMap.get(node.id) || []).sort((a, b) => a.name.localeCompare(b.name));
    children.forEach(traverse);
  };
  roots.sort((a, b) => a.name.localeCompare(b.name)).forEach(traverse);
  return result;
}

export default function ProjectDetail() {
  const deptLabel = useDepartmentLabel();
  const titleLabel = useJobTitleLabel();
  const hrIds = useTenantHrIds();
  const { projectId } = useParams<{ projectId: string }>();
  const { tenantId } = useTenant();
  const { employee: currentHr } = useEmployee();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const { logAction } = useAuditLog();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, TaskSubmission>>({});
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // UI Navigation
  const [activeTab, setActiveTab] = useState<"tasks" | "team" | "timeline" | "overview">("tasks");

  // Inline Title Editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");

  // Status Badge Dropdown
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editStatus, setEditStatus] = useState<Project["status"]>("planning");
  const [editManagerId, setEditManagerId] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editVisibilityType, setEditVisibilityType] = useState<"all" | "departments" | "people">("all");
  const [editSelectedDepts, setEditSelectedDepts] = useState<string[]>([]);
  const [editSelectedOrgUnitIds, setEditSelectedOrgUnitIds] = useState<string[]>([]);
  const [editSelectedPeople, setEditSelectedPeople] = useState<string[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitOption[]>([]);
  const [managerSearch, setManagerSearch] = useState("");
  const [isManagerDropdownOpen, setIsManagerDropdownOpen] = useState(false);
  const [peopleSearch, setPeopleSearch] = useState("");

  // Task Drawer State
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isTaskDrawerOpen, setIsTaskDrawerOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);
  const [savingReview, setSavingReview] = useState(false);

  // Add Task Modal State
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskPriority, setTaskPriority] = useState<Task["priority"]>("medium");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskDueTime, setTaskDueTime] = useState("");
  const [taskAssigneeSearch, setTaskAssigneeSearch] = useState("");
  const [isTaskAssigneeDropdownOpen, setIsTaskAssigneeDropdownOpen] = useState(false);

  const fetchProjectData = async () => {
    if (!tenantId || !projectId) return;
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
        toastError("Project not found.");
        navigate("/hr/pms");
        return;
      }
      setProject(projData as Project);
      setTitleInput(projData.name);

      // 2. Fetch employees
      const { data: empData, error: empErr } = await db
        .from("employees")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("full_name");
      if (empErr) throw empErr;
      setEmployees((empData ?? []) as Employee[]);

      // 3. Fetch tasks for this project
      const { data: taskData, error: taskErr } = await db
        .from("tasks")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (taskErr) throw taskErr;
      const taskList = (taskData ?? []) as Task[];
      setTasks(taskList);

      // 4. Fetch submissions for task cards
      const submittedIds = taskList.map((t) => t.id);
      if (submittedIds.length > 0) {
        const { data: subData } = await db
          .from("task_submissions")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("task_id", submittedIds);
        const subMap: Record<string, TaskSubmission> = {};
        (subData ?? []).forEach((s: TaskSubmission) => {
          subMap[s.task_id] = s;
        });
        setSubmissions(subMap);

        // 5. Fetch audit logs for tasks
        const { data: logData } = await db
          .from("audit_logs")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("target_type", "task")
          .in("target_id", submittedIds)
          .order("created_at", { ascending: false })
          .limit(10);
        setAuditLogs(logData ?? []);
      } else {
        setSubmissions({});
        setAuditLogs([]);
      }
    } catch (err: any) {
      console.error(err);
      toastError(err.message || "Failed to load project details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProjectData();
  }, [tenantId, projectId]);

  // Org units for the "departments" visibility Org Unit picker (Slice B org_unit_ids write path).
  useEffect(() => {
    let active = true;
    if (!tenantId) return;
    db.from("org_units").select("id, name, parent_id").eq("tenant_id", tenantId).eq("is_active", true)
      .order("name", { ascending: true }).then(({ data }) => {
        if (active && data) setOrgUnits(data as OrgUnitOption[]);
      });
    return () => { active = false; };
  }, [tenantId]);

  // Inline Title Save
  const handleSaveTitle = async () => {
    if (!titleInput.trim() || !project) return;
    try {
      const { error } = await db
        .from("projects")
        .update({ name: titleInput.trim() })
        .eq("id", project.id);
      if (error) throw error;
      setProject({ ...project, name: titleInput.trim() });
      success("Project title updated.");
      setIsEditingTitle(false);
    } catch (err: any) {
      toastError(err.message || "Failed to update title.");
    }
  };

  // Change Project Status
  const handleUpdateStatus = async (status: Project["status"]) => {
    if (!project) return;
    try {
      const { error } = await db
        .from("projects")
        .update({ status })
        .eq("id", project.id);
      if (error) throw error;
      setProject({ ...project, status });
      success(`Status updated to ${status.replace("_", " ")}`);
      setIsStatusDropdownOpen(false);
    } catch (err: any) {
      toastError(err.message || "Failed to update status.");
    }
  };

  // Populate Edit Modal
  const openEditModal = () => {
    if (!project) return;
    setEditName(project.name);
    setEditDesc(project.description || "");
    setEditStatus(project.status);
    setEditManagerId(project.manager_id || "");
    setEditStartDate(project.start_date || "");
    setEditEndDate(project.end_date || "");
    const vis = project.visibility_config || { type: "all" };
    setEditVisibilityType(vis.type || "all");
    setEditSelectedDepts(vis.departments || []);
    setEditSelectedOrgUnitIds(vis.org_unit_ids || []);
    setEditSelectedPeople(vis.employee_ids || []);
    setManagerSearch("");
    setPeopleSearch("");
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim() || !project) return;
    if (editStartDate && editEndDate && new Date(editEndDate) <= new Date(editStartDate)) {
      toastError("End date must be after start date.");
      return;
    }
    if (editVisibilityType === "departments" && editSelectedOrgUnitIds.length === 0) {
      // projects_employee_read now gates the departments branch on org_unit_ids only — an empty
      // selection here would save a project no employee could ever read.
      toastError("Select at least one org unit. The legacy department list is no longer read by RLS.");
      return;
    }

    try {
      const visibility_config = {
        type: editVisibilityType,
        departments: editVisibilityType === "departments" ? editSelectedDepts : undefined,
        // Slice B target-side key, written alongside `departments` — RLS still reads `departments`
        // Slice B is APPLIED (20260820110000): projects_employee_read gates the departments branch
        // on org_unit_ids ONLY. `departments` is kept for display and is no longer an RLS input.
        org_unit_ids: editVisibilityType === "departments" ? editSelectedOrgUnitIds : undefined,
        employee_ids: editVisibilityType === "people" ? editSelectedPeople : undefined,
      };

      const { data, error } = await db
        .from("projects")
        .update({
          name: editName.trim(),
          description: editDesc.trim() || null,
          status: editStatus,
          manager_id: editManagerId || null,
          start_date: editStartDate || null,
          end_date: editEndDate || null,
          visibility_config,
          updated_at: new Date().toISOString(),
        })
        .eq("id", project.id)
        .select();

      // RLS refuses a write by matching zero rows, which comes back as a SUCCESSFUL empty response
      // rather than an error (src/admin/TenantModulesPanel.tsx:77-79). An empty array is truthy in
      // JS, so this update must check length, not just presence.
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Project was not updated — the write was rejected.");
      }
      success("Project details updated.");
      setIsEditModalOpen(false);
      void fetchProjectData();
    } catch (err: any) {
      toastError(err.message || "Failed to update project.");
    }
  };

  // Drag and Drop Tasks
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("text/plain", taskId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: Task["status"]) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === targetStatus) return;

    try {
      const { error } = await db
        .from("tasks")
        .update({ status: targetStatus, updated_at: new Date().toISOString() })
        .eq("id", taskId);

      if (error) throw error;
      success(`Task status updated to ${targetStatus.replace("_", " ")}.`);
      void fetchProjectData();
      void logAction(`task.${targetStatus}`, "task", taskId);
    } catch (err: any) {
      toastError(err.message || "Failed to update task status.");
    }
  };

  // Add Task to Project
  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !taskAssigneeId || !project) {
      toastError("Title and assignee are required.");
      return;
    }
    if (!currentHr?.id) {
      toastError("Your employee profile not found.");
      return;
    }

    try {
      const { error } = await db.from("tasks").insert([
        {
          tenant_id: tenantId,
          title: taskTitle.trim(),
          description: taskDesc.trim() || null,
          assigned_to: taskAssigneeId,
          assigned_by: currentHr.id,
          priority: taskPriority,
          due_date: taskDueDate || null,
          due_time: taskDueTime || null,
          status: "assigned",
          project_id: project.id,
          attendance_lock_date: taskDueDate || null,
        },
      ]);
      if (error) throw error;

      // Add Notification
      await db.from("notifications").insert([
        {
          tenant_id: tenantId,
          employee_id: taskAssigneeId,
          title: "New Project Task Assigned",
          body: `You have been assigned: "${taskTitle.trim()}" in project "${project.name}"`,
          type: "task_assigned",
        },
      ]);

      success("Task added to project.");
      setIsAddTaskModalOpen(false);
      setTaskTitle("");
      setTaskDesc("");
      setTaskAssigneeId("");
      setTaskDueDate("");
      setTaskDueTime("");
      setTaskAssigneeSearch("");
      void fetchProjectData();
    } catch (err: any) {
      toastError(err.message || "Failed to add task.");
    }
  };

  // Review (Approve/Reject) Submissions from Drawer
  const handleApproveTask = async (task: Task) => {
    const sub = submissions[task.id];
    if (!sub) return;
    setSavingReview(true);
    try {
      const { error: rpcErr } = await db.rpc("approve_task_request", {
        p_task_id: task.id,
      });
      if (rpcErr) throw rpcErr;

      const targetDate = task.attendance_lock_date || task.due_date || new Date().toISOString().slice(0, 10);

      await db.from("calendar_events").insert([
        {
          tenant_id: tenantId,
          employee_id: task.assigned_to,
          date: targetDate,
          type: "green",
          task_id: task.id,
          notes: `Task approved: ${task.title}`,
        },
      ]);

      await db.from("notifications").insert([
        {
          tenant_id: tenantId,
          employee_id: task.assigned_to,
          title: "Task Approved ✅",
          body: `Your task "${task.title}" in project "${project?.name}" was approved.`,
          type: "task_approved",
          reference_id: task.id,
        },
      ]);

      void logAction("task.approved", "task", task.id);
      success("Task approved.");
      setIsTaskDrawerOpen(false);
      void fetchProjectData();
    } catch (err) {
      toastError("Failed to approve task.");
    } finally {
      setSavingReview(false);
    }
  };

  const handleRejectTask = async (task: Task) => {
    const sub = submissions[task.id];
    if (!sub) return;
    if (!rejectNotes.trim()) {
      toastError("Rejection notes are required.");
      return;
    }
    setSavingReview(true);
    try {
      const { error: rpcErr } = await db.rpc("reject_task_request", {
        p_task_id: task.id,
        p_notes: rejectNotes.trim(),
      });
      if (rpcErr) throw rpcErr;

      await db.from("notifications").insert([
        {
          tenant_id: tenantId,
          employee_id: task.assigned_to,
          title: "Task Rejected",
          body: `Your task "${task.title}" in project "${project?.name}" was rejected. Reason: ${rejectNotes.trim()}`,
          type: "task_rejected",
          reference_id: task.id,
        },
      ]);

      void logAction("task.rejected", "task", task.id, { reason: rejectNotes.trim() });
      success("Task rejected.");
      setIsTaskDrawerOpen(false);
      setRejectNotes("");
      setIsRejecting(false);
      void fetchProjectData();
    } catch (err) {
      toastError("Failed to reject task.");
    } finally {
      setSavingReview(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      const { error } = await db
        .from("tasks")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", taskId);
      if (error) throw error;
      success("Task deleted.");
      setIsTaskDrawerOpen(false);
      void fetchProjectData();
    } catch (err) {
      toastError("Failed to delete task.");
    }
  };

  // Helper Maps & Lists
  const empMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees.forEach((e) => map.set(e.id, e));
    return map;
  }, [employees]);

  const projectManager = useMemo(() => {
    if (!project?.manager_id) return null;
    return empMap.get(project.manager_id);
  }, [project, empMap]);

  // Filters for dropdown searchable lists
  const eligibleManagers = useMemo(() => {
    const managerIds = new Set(employees.map((e) => e.manager_id).filter(Boolean));
    // HR comes from tenant_hr_employee_ids(), not employees.role, which no longer exists.
    return employees.filter((e) => hrIds.has(e.id) || managerIds.has(e.id));
  }, [employees, hrIds]);

  const filteredModalManagers = useMemo(() => {
    return eligibleManagers.filter((e) =>
      e.full_name.toLowerCase().includes(managerSearch.toLowerCase())
    );
  }, [eligibleManagers, managerSearch]);

  const filteredModalPeople = useMemo(() => {
    return employees.filter((e) =>
      e.full_name.toLowerCase().includes(peopleSearch.toLowerCase())
    );
  }, [employees, peopleSearch]);

  const filteredTaskAssignees = useMemo(() => {
    return employees.filter((e) =>
      e.full_name.toLowerCase().includes(taskAssigneeSearch.toLowerCase())
    );
  }, [employees, taskAssigneeSearch]);

  // Kanban Tasks Partitioning
  const kanbanColumns = useMemo(() => {
    const columns: Record<string, Task[]> = {
      assigned: [],
      in_progress: [],
      submitted: [],
      approved: [],
    };

    tasks.forEach((t) => {
      if (t.status === "assigned" || t.status === "rejected") {
        columns.assigned.push(t);
      } else if (t.status === "in_progress" || t.status === "overdue") {
        columns.in_progress.push(t);
      } else if (t.status === "submitted") {
        columns.submitted.push(t);
      } else if (t.status === "approved") {
        columns.approved.push(t);
      }
    });

    return columns;
  }, [tasks]);

  // Team tab data: unique employees who have tasks in this project
  const teamMembersData = useMemo(() => {
    const memberTasks: Record<string, Task[]> = {};
    tasks.forEach((t) => {
      if (!memberTasks[t.assigned_to]) {
        memberTasks[t.assigned_to] = [];
      }
      memberTasks[t.assigned_to].push(t);
    });

    return Object.entries(memberTasks).map(([empId, tList]) => {
      const emp = empMap.get(empId);
      const total = tList.length;
      const approved = tList.filter((t) => t.status === "approved").length;
      const completionRate = total > 0 ? Math.round((approved / total) * 100) : 0;
      return {
        employee: emp,
        taskCount: total,
        completionRate,
      };
    });
  }, [tasks, empMap]);

  // Overview KPIs & circular progress
  const overviewStats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "approved").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress" || t.status === "submitted").length;
    const overdue = tasks.filter((t) => t.status === "overdue").length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    let daysRemaining = 0;
    if (project?.end_date) {
      const diffMs = new Date(project.end_date).getTime() - new Date().getTime();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }

    return { total, completed, inProgress, overdue, teamSize: teamMembersData.length, daysRemaining, progress };
  }, [tasks, teamMembersData, project]);

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
        <Link to="/hr/pms" className="hover:text-brand-600 transition">
          Projects
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-900 truncate max-w-[200px]">{project.name}</span>
      </div>

      {/* Project Header Card */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Inline Title Editor */}
            {isEditingTitle ? (
              <div className="flex items-center gap-2 max-w-lg">
                <input
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  className="text-2xl font-bold text-slate-900 border-b border-brand-500 outline-none w-full bg-slate-50 px-2 py-0.5 rounded-lg focus:bg-white"
                  autoFocus
                  onBlur={handleSaveTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveTitle();
                    if (e.key === "Escape") {
                      setTitleInput(project.name);
                      setIsEditingTitle(false);
                    }
                  }}
                />
                <button
                  onClick={handleSaveTitle}
                  className="rounded-lg bg-emerald-500 p-1 text-white hover:bg-emerald-600 shadow"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <h2
                onClick={() => setIsEditingTitle(true)}
                className="text-2xl font-bold text-slate-900 cursor-pointer hover:bg-slate-50 hover:underline decoration-dashed rounded px-1 -ml-1 transition truncate"
                title="Click to edit name"
              >
                {project.name}
              </h2>
            )}

            {/* Manager and Dates details */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-500 font-medium">
              <div className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-slate-400" />
                <span>Manager: {projectManager?.full_name || "Unassigned"}</span>
              </div>
              <div className="hidden sm:block text-slate-300">•</div>
              <div className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-slate-400" />
                <span>
                  {project.start_date || "—"} → {project.end_date || "—"}
                </span>
              </div>
            </div>

            <p className="mt-4 text-sm text-slate-600 max-w-3xl leading-relaxed">
              {project.description || "No description specified."}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Status Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-bold capitalize tracking-wide shadow-sm flex items-center gap-2 hover:bg-slate-50 transition active:scale-[0.98] ${
                  STATUS_COLOR[project.status]
                }`}
              >
                <span>{project.status.replace("_", " ")}</span>
                <span className="text-[10px]">▼</span>
              </button>

              {isStatusDropdownOpen && (
                <div className="absolute right-0 z-50 mt-1.5 w-36 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg space-y-1">
                  {(["planning", "active", "on_hold", "completed", "cancelled"] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => void handleUpdateStatus(st)}
                      className={`flex w-full items-center px-3 py-2 text-left text-xs font-semibold rounded-xl capitalize transition ${
                        project.status === st ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {st.replace("_", " ")}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Edit Button */}
            <button
              onClick={openEditModal}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition active:scale-[0.98]"
            >
              <Edit className="h-3.5 w-3.5" /> Edit Project
            </button>
          </div>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-slate-200">
        {(["tasks", "team", "timeline", "overview"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 px-5 py-3 text-sm font-semibold capitalize tracking-wide transition-all ${
              activeTab === tab
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── TASKS TAB ── */}
      {activeTab === "tasks" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h3 className="text-lg font-bold text-slate-900">Project Tasks</h3>
            <button
              onClick={() => setIsAddTaskModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-700 shadow transition active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" /> Add Task
            </button>
          </div>

          {/* Kanban Board */}
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
            {Object.entries(kanbanColumns).map(([colName, colTasks]) => {
              const displayTitle = colName.replace("_", " ").toUpperCase();
              return (
                <div
                  key={colName}
                  onDragOver={handleDragOver}
                  onDrop={(e) => void handleDrop(e, colName === "assigned" ? "assigned" : colName === "in_progress" ? "in_progress" : colName as Task["status"])}
                  className="flex-1 min-w-[280px] bg-slate-50 rounded-3xl border border-slate-200/60 p-4 flex flex-col max-h-[600px] overflow-y-auto"
                >
                  {/* Column Header */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-3">
                    <span className="text-xs font-bold text-slate-500 tracking-wider">{displayTitle}</span>
                    <span className="rounded-full bg-slate-200 text-slate-700 px-2 py-0.5 text-xs font-bold">
                      {colTasks.length}
                    </span>
                  </div>

                  {/* Task Cards */}
                  <div className="space-y-3 flex-1">
                    {colTasks.map((t) => {
                      const assignee = empMap.get(t.assigned_to);
                      const isOverdue = t.status === "overdue" || (t.due_date && new Date(t.due_date) < new Date() && t.status !== "approved");
                      return (
                        <div
                          key={t.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, t.id)}
                          onClick={() => {
                            setSelectedTask(t);
                            setIsTaskDrawerOpen(true);
                          }}
                          className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm cursor-grab active:cursor-grabbing hover:border-brand-300 hover:shadow transition group flex flex-col justify-between min-h-[110px]"
                        >
                          <div>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[t.priority]}`}></span>
                              <span className="text-[10px] font-bold text-slate-400 capitalize">{t.priority}</span>
                            </div>
                            <h4 className="font-semibold text-slate-900 text-sm leading-snug line-clamp-2 group-hover:text-brand-600 transition">
                              {t.title}
                            </h4>
                          </div>

                          <div className="mt-4 flex items-center justify-between gap-3 text-xs border-t border-slate-50 pt-2.5">
                            <div className="flex items-center gap-1.5 truncate max-w-[120px]">
                              {assignee?.profile_photo_url ? (
                                <img
                                  src={assignee.profile_photo_url}
                                  alt=""
                                  className="h-5 w-5 rounded-full object-cover shrink-0"
                                />
                              ) : (
                                <div className="grid h-5 w-5 place-items-center rounded-full bg-slate-100 font-bold text-[9px] shrink-0 text-slate-500">
                                  {assignee?.full_name?.slice(0, 2).toUpperCase() || "?"}
                                </div>
                              )}
                              <span className="truncate text-slate-500 font-medium">{assignee?.full_name || "—"}</span>
                            </div>

                            {t.due_date && (
                              <span
                                className={`font-semibold shrink-0 text-[10px] ${
                                  isOverdue ? "text-rose-600" : "text-slate-400"
                                }`}
                              >
                                {t.due_date}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {colTasks.length === 0 && (
                      <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-200 rounded-2xl text-center text-xs text-slate-400 font-medium min-h-[120px]">
                        Drag tasks here
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TEAM TAB ── */}
      {activeTab === "team" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Project Team Members</h3>
          <div className="divide-y divide-slate-100">
            {teamMembersData.map((member) => (
              <div key={member.employee?.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  {member.employee?.profile_photo_url ? (
                    <img
                      src={member.employee.profile_photo_url}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover border border-slate-100"
                    />
                  ) : (
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-indigo-50 font-bold text-indigo-700 text-sm">
                      {member.employee?.full_name?.slice(0, 2).toUpperCase() || "?"}
                    </div>
                  )}
                  <div>
                    <h4 className="font-semibold text-slate-800 text-sm">{member.employee?.full_name}</h4>
                    <p className="text-xs text-slate-400 capitalize">{deptLabel(member.employee, "")} Department</p>
                  </div>
                </div>

                <div className="flex items-center gap-8 text-right">
                  <div>
                    <p className="text-xs text-slate-400 font-medium">Task Count</p>
                    <p className="text-sm font-bold text-slate-700">{member.taskCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 font-medium">Completion Rate</p>
                    <p className="text-sm font-bold text-emerald-600">{member.completionRate}%</p>
                  </div>
                  <button
                    onClick={() => {
                      setTaskAssigneeId(member.employee?.id || "");
                      setTaskAssigneeSearch(member.employee?.full_name || "");
                      setIsAddTaskModalOpen(true);
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition active:scale-[0.98]"
                  >
                    Assign Task
                  </button>
                </div>
              </div>
            ))}
            {teamMembersData.length === 0 && (
              <EmptyState
                icon={Users}
                title="No team members working on this project"
                description="Assign project tasks to employees to add them to the team."
                minimal
              />
            )}
          </div>
        </div>
      )}

      {/* ── TIMELINE TAB ── */}
      {activeTab === "timeline" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-6 overflow-x-auto">
          <h3 className="text-lg font-bold text-slate-900">Project Timeline</h3>
          {project.start_date && project.end_date ? (
            <div className="min-w-[600px] py-4">
              {/* Project Bar */}
              <div className="relative mb-8">
                <div className="h-6 w-full rounded-full bg-slate-100 border border-slate-200 flex items-center justify-between px-4 text-xs font-semibold text-slate-600">
                  <span>Start: {project.start_date}</span>
                  <span>Project Duration</span>
                  <span>End: {project.end_date}</span>
                </div>
              </div>

              {/* Tasks Bars */}
              <div className="space-y-4">
                {tasks.filter((t) => t.due_date).map((t) => {
                  const start = new Date(project.start_date!);
                  const end = new Date(project.end_date!);
                  const totalMs = end.getTime() - start.getTime() || 1;

                  const due = new Date(t.due_date!);
                  const taskStart = new Date(due.getTime() - 24 * 60 * 60 * 1000); // 1 day before

                  const leftPercent = Math.max(0, Math.min(100, ((taskStart.getTime() - start.getTime()) / totalMs) * 100));
                  const widthPercent = Math.max(2, Math.min(100 - leftPercent, ((24 * 60 * 60 * 1000) / totalMs) * 100));

                  const config = STATUS_CONFIG[t.status] || { label: "Task", color: "bg-slate-500 text-white" };

                  return (
                    <div key={t.id} className="relative h-8 flex items-center">
                      <div className="absolute left-0 w-24 text-xs font-semibold text-slate-500 truncate pr-2 text-right">
                        {empMap.get(t.assigned_to)?.full_name.split(" ")[0]}
                      </div>
                      <div className="ml-24 flex-1 h-full relative">
                        <div
                          className={`absolute h-5 rounded-lg text-[9px] font-bold px-2 py-0.5 truncate shadow-sm flex items-center border capitalize ${
                            config.color
                          }`}
                          style={{
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                          }}
                          title={`${t.title} (Due: ${t.due_date})`}
                        >
                          {t.title}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {tasks.filter((t) => t.due_date).length === 0 && (
                  <div className="text-center text-xs font-medium text-slate-400 py-6">
                    No scheduled tasks with due dates.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <Calendar className="mx-auto h-12 w-12 text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-700">Project dates are not configured</p>
              <p className="text-xs text-slate-400 mt-1">Please set project Start and End dates to generate the timeline.</p>
              <button
                onClick={openEditModal}
                className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Set Dates
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── OVERVIEW TAB ── */}
      {activeTab === "overview" && (
        <div className="grid gap-6 md:grid-cols-3">
          {/* Progress Circular Circle */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col items-center justify-center text-center">
            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-6">Overall Progress</h4>
            <div className="relative flex items-center justify-center h-32 w-32">
              <svg className="h-full w-full transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  className="stroke-slate-100"
                  strokeWidth="8"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  className="stroke-emerald-500 transition-all duration-700"
                  strokeWidth="8"
                  fill="transparent"
                  strokeDasharray={2 * Math.PI * 40}
                  strokeDashoffset={2 * Math.PI * 40 - (overviewStats.progress / 100) * (2 * Math.PI * 40)}
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-2xl font-bold text-slate-800">{overviewStats.progress}%</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase">Completed</span>
              </div>
            </div>
            <p className="mt-4 text-xs font-medium text-slate-500">
              {overviewStats.completed} of {overviewStats.total} total tasks approved
            </p>
          </div>

          {/* Quick Metrics */}
          <div className="md:col-span-2 grid grid-cols-2 gap-4">
            {[
              { label: "Completed Tasks", value: overviewStats.completed, color: "text-emerald-600 border-emerald-100 bg-emerald-50" },
              { label: "In Progress Tasks", value: overviewStats.inProgress, color: "text-blue-600 border-blue-100 bg-blue-50" },
              { label: "Overdue Tasks", value: overviewStats.overdue, color: "text-rose-600 border-rose-100 bg-rose-50" },
              { label: "Team Size", value: overviewStats.teamSize, color: "text-purple-600 border-purple-100 bg-purple-50" },
              { label: "Days Remaining", value: overviewStats.daysRemaining, color: "text-amber-600 border-amber-100 bg-amber-50" },
              { label: "Total Tasks", value: overviewStats.total, color: "text-slate-600 border-slate-100 bg-slate-50" },
            ].map((m, idx) => (
              <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{m.label}</p>
                <p className="mt-1 text-2xl font-bold text-slate-800">{m.value}</p>
              </div>
            ))}
          </div>

          {/* Recent Activity Logs */}
          <div className="md:col-span-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 pb-2">
              Recent Activity
            </h4>
            <div className="space-y-3">
              {auditLogs.map((log) => {
                const actorName = empMap.get(log.actor_id)?.full_name || log.actor_role;
                const task = tasks.find((t) => t.id === log.target_id);
                return (
                  <div key={log.id} className="flex items-start justify-between gap-4 text-xs font-medium">
                    <div>
                      <span className="font-bold text-slate-700">{actorName}</span>
                      <span className="text-slate-400"> updated task </span>
                      <span className="font-semibold text-slate-800">"{task?.title || "Deleted Task"}"</span>
                      <span className="text-slate-400"> to </span>
                      <span className="font-bold capitalize text-brand-600">
                        {log.action.replace("task.", "").replace("_", " ")}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {new Date(log.created_at).toLocaleDateString()}
                    </span>
                  </div>
                );
              })}
              {auditLogs.length === 0 && (
                <div className="text-center text-xs font-medium text-slate-400 py-4">No recent activity logged.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Side Panel (Drawer) */}
      {isTaskDrawerOpen && selectedTask && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity" onClick={() => setIsTaskDrawerOpen(false)} />
          <div className="absolute inset-y-0 right-0 max-w-lg w-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-250">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 bg-slate-50">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Task Detail</span>
                <h3 className="text-md font-bold text-slate-800 truncate max-w-[360px]">{selectedTask.title}</h3>
              </div>
              <button
                onClick={() => setIsTaskDrawerOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Task Details */}
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[selectedTask.priority]}`}></span>
                    <span className="font-bold uppercase tracking-wider text-slate-600">
                      {selectedTask.priority} Priority
                    </span>
                  </div>
                  {selectedTask.due_date && (
                    <span className="font-semibold text-slate-500">Due: {selectedTask.due_date}</span>
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Description</p>
                  <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-200/50">
                    {selectedTask.description || "No description provided."}
                  </p>
                </div>
              </div>

              {/* Assignee Details */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Assignee</p>
                <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-2xl">
                  {empMap.get(selectedTask.assigned_to)?.profile_photo_url ? (
                    <img
                      src={empMap.get(selectedTask.assigned_to)?.profile_photo_url}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover border border-slate-100"
                    />
                  ) : (
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 font-bold text-slate-600">
                      {empMap.get(selectedTask.assigned_to)?.full_name.slice(0, 2).toUpperCase() || "?"}
                    </div>
                  )}
                  <div>
                    <h4 className="font-semibold text-slate-800 text-sm">
                      {empMap.get(selectedTask.assigned_to)?.full_name || "—"}
                    </h4>
                    <p className="text-xs text-slate-400 capitalize">
                      {deptLabel(empMap.get(selectedTask.assigned_to), "No Department")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Submission Area */}
              {submissions[selectedTask.id] && (
                <div className="border-t border-slate-100 pt-5 space-y-4">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Employee Submission</p>
                  <div className="rounded-2xl bg-purple-50 border border-purple-100 p-4 space-y-3">
                    <p className="text-xs font-bold text-purple-700">Notes</p>
                    <p className="text-sm text-slate-700 bg-white/70 p-3 rounded-xl border border-purple-100/50">
                      {submissions[selectedTask.id].notes || "No submission notes."}
                    </p>
                    {submissions[selectedTask.id].attachment_url && (
                      <a
                        href={submissions[selectedTask.id].attachment_url!}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-purple-200 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-50 shadow-sm transition"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        {submissions[selectedTask.id].attachment_name || "View Attachment"}
                      </a>
                    )}
                  </div>

                  {/* Rejection UI */}
                  {isRejecting ? (
                    <div className="space-y-3 p-4 bg-rose-50 border border-rose-200 rounded-2xl">
                      <p className="text-xs font-bold text-rose-700 uppercase tracking-wider">Rejection Reason</p>
                      <textarea
                        value={rejectNotes}
                        onChange={(e) => setRejectNotes(e.target.value)}
                        placeholder="State why the work is not acceptable..."
                        rows={2}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 bg-white"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => void handleRejectTask(selectedTask)}
                          disabled={savingReview}
                          className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                        >
                          Confirm Rejection
                        </button>
                        <button
                          onClick={() => {
                            setIsRejecting(false);
                            setRejectNotes("");
                          }}
                          className="rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    selectedTask.status === "submitted" && (
                      <div className="flex gap-2.5 pt-2 border-t border-slate-100">
                        <button
                          onClick={() => void handleApproveTask(selectedTask)}
                          disabled={savingReview}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700 transition shadow-sm active:scale-[0.98]"
                        >
                          Approve Task
                        </button>
                        <button
                          onClick={() => setIsRejecting(true)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition shadow-sm active:scale-[0.98]"
                        >
                          Reject Task
                        </button>
                      </div>
                    )
                  )}

                  {selectedTask.status === "approved" && (
                    <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-emerald-800 text-xs font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>Task was approved and attendance block removed.</span>
                    </div>
                  )}

                  {selectedTask.status === "rejected" && (
                    <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-xs">
                      <p className="font-bold text-rose-700 flex items-center gap-1.5">
                        <AlertCircle className="h-4 w-4 text-rose-600" /> Task Rejected
                      </p>
                      {submissions[selectedTask.id].review_notes && (
                        <p className="text-slate-600 mt-1 font-medium">Reason: {submissions[selectedTask.id].review_notes}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="border-t border-slate-100 bg-slate-50 px-6 py-4 flex items-center justify-end">
              <button
                onClick={() => void handleDeleteTask(selectedTask.id)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 px-4 py-2 text-xs font-semibold transition active:scale-[0.98]"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete Task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="relative flex flex-col w-full max-w-2xl max-h-[90vh] bg-white rounded-3xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <span className="rounded-xl bg-brand-50 p-2 text-brand-600">
                  <FolderKanban className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Edit Project Details</h3>
                  <p className="text-xs text-slate-500">Update project configurations and access list.</p>
                </div>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleEditSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Project Name & Desc */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Project Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="e.g. Q3 Hiring Drive"
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition bg-slate-50 hover:bg-white focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Description
                  </label>
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="Enter project goals, objectives..."
                    rows={3}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition bg-slate-50 hover:bg-white focus:bg-white resize-none"
                  />
                </div>
              </div>

              {/* Status and Manager Row */}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as Project["status"])}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition bg-slate-50 hover:bg-white focus:bg-white"
                  >
                    <option value="planning">Planning</option>
                    <option value="active">Active</option>
                    <option value="on_hold">On Hold</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                {/* Searchable Manager Dropdown */}
                <div className="relative">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Project Manager
                  </label>
                  <div
                    onClick={() => setIsManagerDropdownOpen(!isManagerDropdownOpen)}
                    className="flex items-center justify-between w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none bg-slate-50 cursor-pointer hover:bg-white focus-within:bg-white focus-within:ring focus-within:ring-brand-500/20"
                  >
                    <span className="truncate">
                      {editManagerId
                        ? employees.find((e) => e.id === editManagerId)?.full_name
                        : "Select manager..."}
                    </span>
                    <span className="text-slate-400 text-xs">▼</span>
                  </div>

                  {isManagerDropdownOpen && (
                    <div className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg divide-y divide-slate-100">
                      <div className="relative pb-2">
                        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                        <input
                          type="text"
                          value={managerSearch}
                          onChange={(e) => setManagerSearch(e.target.value)}
                          placeholder="Search manager..."
                          className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-1.5 text-xs outline-none focus:border-brand-500"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="pt-2 space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditManagerId("");
                            setIsManagerDropdownOpen(false);
                          }}
                          className="flex w-full items-center px-3 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50 rounded-lg"
                        >
                          None (Unassigned)
                        </button>
                        {filteredModalManagers.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setEditManagerId(m.id);
                              setIsManagerDropdownOpen(false);
                            }}
                            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs rounded-lg transition hover:bg-slate-50 ${
                              editManagerId === m.id ? "bg-brand-50 font-bold text-brand-700" : "text-slate-700"
                            }`}
                          >
                            <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-[10px] font-bold">
                              {m.full_name.slice(0, 2).toUpperCase()}
                            </span>
                            <div className="flex-1 truncate">
                              <p className="font-semibold">{m.full_name}</p>
                              <p className="text-[10px] text-slate-400 capitalize">{titleLabel(m, "Member")}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Start & End Date Row */}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition bg-slate-50 hover:bg-white focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition bg-slate-50 hover:bg-white focus:bg-white"
                  />
                </div>
              </div>

              {/* Visibility Configurations */}
              <div className="space-y-4 border-t border-slate-100 pt-6">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Visibility Mode
                  </label>
                  <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1 rounded-xl">
                    {[
                      { type: "all", label: "All Employees" },
                      { type: "departments", label: "Departments" },
                      { type: "people", label: "Specific People" },
                    ].map((v) => (
                      <button
                        key={v.type}
                        type="button"
                        onClick={() => setEditVisibilityType(v.type as any)}
                        className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                          editVisibilityType === v.type
                            ? "bg-white text-slate-900 shadow"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Specific Departments Multi-select */}
                {editVisibilityType === "departments" && (
                  <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Select Departments (Legacy)</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {DEPT_OPTIONS.map((dept) => {
                        const isChecked = editSelectedDepts.includes(dept);
                        return (
                          <label
                            key={dept}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium cursor-pointer transition capitalize hover:bg-slate-50 ${
                              isChecked
                                ? "border-brand-300 bg-brand-50 text-brand-700"
                                : "border-slate-200 text-slate-600"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setEditSelectedDepts(editSelectedDepts.filter((d) => d !== dept));
                                } else {
                                  setEditSelectedDepts([...editSelectedDepts, dept]);
                                }
                              }}
                              className="hidden"
                            />
                            <span>{dept}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Org Unit Picker — Slice B org_unit_ids write path, alongside the legacy Departments
                    picker above, which RLS no longer reads — org units are the authoritative target. */}
                {editVisibilityType === "departments" && (
                  <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Select Org Units <span className="text-rose-500">*</span></p>
                    {orgUnits.length === 0 ? (
                      <p className="text-xs text-slate-400">No org units configured for this tenant yet.</p>
                    ) : (
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {sortOrgUnitsHierarchically(orgUnits).map((unit) => {
                          const depth = getOrgUnitDepth(unit, orgUnits);
                          const isChecked = editSelectedOrgUnitIds.includes(unit.id);
                          return (
                            <button
                              key={unit.id}
                              type="button"
                              onClick={() => {
                                if (isChecked) {
                                  setEditSelectedOrgUnitIds(editSelectedOrgUnitIds.filter((id) => id !== unit.id));
                                } else {
                                  setEditSelectedOrgUnitIds([...editSelectedOrgUnitIds, unit.id]);
                                }
                              }}
                              style={{ paddingLeft: `${0.625 + depth * 1.25}rem` }}
                              className={`w-full flex items-center gap-1.5 rounded-lg py-1.5 pr-2.5 text-left text-xs font-medium transition ${
                                isChecked
                                  ? "bg-brand-50 border border-brand-200 text-brand-700"
                                  : "hover:bg-slate-50 border border-transparent text-slate-600"
                              }`}
                            >
                              {depth > 0 && <span className="text-slate-300">└─</span>}
                              <span className="flex-1 truncate">{unit.name}</span>
                              {isChecked && <span className="text-brand-600 text-xs font-bold">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Specific People Multi-select */}
                {editVisibilityType === "people" && (
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Select Employees</p>
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        value={peopleSearch}
                        onChange={(e) => setPeopleSearch(e.target.value)}
                        placeholder="Search employee by name..."
                        className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-xs outline-none focus:border-brand-500"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto divide-y divide-slate-100">
                      {filteredModalPeople.map((emp) => {
                        const isChecked = editSelectedPeople.includes(emp.id);
                        return (
                          <label
                            key={emp.id}
                            className={`flex items-center gap-3 px-3 py-2.5 text-xs font-medium cursor-pointer hover:bg-slate-50 rounded-xl transition ${
                              isChecked ? "bg-brand-50/50" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setEditSelectedPeople(editSelectedPeople.filter((id) => id !== emp.id));
                                } else {
                                  setEditSelectedPeople([...editSelectedPeople, emp.id]);
                                }
                              }}
                              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            />
                            <div className="flex-1 truncate">
                              <p className="font-semibold text-slate-800">{emp.full_name}</p>
                              <p className="text-[10px] text-slate-400 capitalize">{deptLabel(emp, "No Department")}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </form>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition shadow-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSubmit}
                className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 active:scale-[0.98] transition shadow-sm"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Task Modal */}
      {isAddTaskModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="relative flex flex-col w-full max-w-xl max-h-[90vh] bg-white rounded-3xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <span className="rounded-xl bg-brand-50 p-2 text-brand-600">
                  <Plus className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Add Task to Project</h3>
                  <p className="text-xs text-slate-500">Create and delegate a new task for this project.</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddTaskModalOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleAddTask} className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Task Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="Task title"
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition bg-slate-50 hover:bg-white focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Description
                </label>
                <textarea
                  value={taskDesc}
                  onChange={(e) => setTaskDesc(e.target.value)}
                  placeholder="Task instructions..."
                  rows={3}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition bg-slate-50 hover:bg-white focus:bg-white resize-none"
                />
              </div>

              {/* Assignee Selection */}
              <div className="relative">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Assign To <span className="text-rose-500">*</span>
                </label>
                <div
                  onClick={() => setIsTaskAssigneeDropdownOpen(!isTaskAssigneeDropdownOpen)}
                  className="flex items-center justify-between w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none bg-slate-50 cursor-pointer hover:bg-white focus-within:bg-white focus-within:ring focus-within:ring-brand-500/20"
                >
                  <span className="truncate">
                    {taskAssigneeId
                      ? employees.find((e) => e.id === taskAssigneeId)?.full_name
                      : "Select team member..."}
                  </span>
                  <span className="text-slate-400 text-xs">▼</span>
                </div>

                {isTaskAssigneeDropdownOpen && (
                  <div className="absolute left-0 right-0 z-50 mt-1 max-h-50 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg divide-y divide-slate-100">
                    <div className="relative pb-2">
                      <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        value={taskAssigneeSearch}
                        onChange={(e) => setTaskAssigneeSearch(e.target.value)}
                        placeholder="Search employee..."
                        className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-1.5 text-xs outline-none focus:border-brand-500"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div className="pt-2 space-y-1">
                      {filteredTaskAssignees.map((emp) => (
                        <button
                          key={emp.id}
                          type="button"
                          onClick={() => {
                            setTaskAssigneeId(emp.id);
                            setIsTaskAssigneeDropdownOpen(false);
                          }}
                          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs rounded-lg transition hover:bg-slate-50 ${
                            taskAssigneeId === emp.id ? "bg-brand-50 font-bold text-brand-700" : "text-slate-700"
                          }`}
                        >
                          <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-[10px] font-bold">
                            {emp.full_name.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="flex-1 truncate">
                            <p className="font-semibold">{emp.full_name}</p>
                            <p className="text-[10px] text-slate-400 capitalize">{deptLabel(emp, "No Department")}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Due Date & Priority */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={taskDueDate}
                    onChange={(e) => setTaskDueDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition bg-slate-50 hover:bg-white focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Priority
                  </label>
                  <select
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value as Task["priority"])}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition bg-slate-50 hover:bg-white focus:bg-white"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
            </form>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setIsAddTaskModalOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition shadow-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleAddTask}
                className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 active:scale-[0.98] transition shadow-sm"
              >
                Add Task
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
