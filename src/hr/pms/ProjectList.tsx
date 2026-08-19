import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, Calendar, Users, FolderKanban, CheckCircle2, ChevronRight, X, Shield, Building } from "lucide-react";
import { db } from "../../insforge/client";
import { useTenant } from "../../contexts/TenantContext";
import { useEmployee } from "../../hooks/useEmployee";
import { useToast } from "../../shared/ToastContext";
import { Skeleton } from "../../shared/Skeleton";
import { EmptyState } from "../../shared/EmptyState";
import type { Project, Employee, Task } from "../../types";

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

const STATUS_COLOR: Record<Project["status"], string> = {
  planning: "bg-blue-50 text-blue-700 border-blue-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  on_hold: "bg-amber-50 text-amber-700 border-amber-200",
  completed: "bg-slate-50 text-slate-700 border-slate-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
};

interface ProjectCardData extends Project {
  manager?: Employee;
  tasks: Task[];
}

export default function ProjectList() {
  const { tenantId } = useTenant();
  const { employee: currentHr } = useEmployee();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [projects, setProjects] = useState<ProjectCardData[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<"all" | Project["status"]>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formStatus, setFormStatus] = useState<Project["status"]>("planning");
  const [formManagerId, setFormManagerId] = useState("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formVisibilityType, setFormVisibilityType] = useState<"all" | "departments" | "people">("all");
  const [formSelectedDepts, setFormSelectedDepts] = useState<string[]>([]);
  const [formSelectedOrgUnitIds, setFormSelectedOrgUnitIds] = useState<string[]>([]);
  const [formSelectedPeople, setFormSelectedPeople] = useState<string[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitOption[]>([]);
  
  // Searching/filtering managers in modal
  const [managerSearch, setManagerSearch] = useState("");
  const [isManagerDropdownOpen, setIsManagerDropdownOpen] = useState(false);

  // Searching/filtering people in modal visibility
  const [peopleSearch, setPeopleSearch] = useState("");

  const fetchProjectsAndEmployees = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      // 1. Fetch employees
      const { data: empData, error: empErr } = await db
        .from("employees")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("full_name");
      if (empErr) throw empErr;
      const empList = (empData ?? []) as Employee[];
      setEmployees(empList);

      const empMap = new Map<string, Employee>();
      empList.forEach((e) => empMap.set(e.id, e));

      // 2. Fetch projects
      const { data: projData, error: projErr } = await db
        .from("projects")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (projErr) throw projErr;
      const projList = (projData ?? []) as Project[];

      // 3. Fetch tasks for progress calculation
      const { data: taskData, error: taskErr } = await db
        .from("tasks")
        .select("*")
        .eq("tenant_id", tenantId)
        .not("project_id", "is", null);
      if (taskErr) throw taskErr;
      const allTasks = (taskData ?? []) as Task[];

      // Group tasks by project
      const tasksByProject = new Map<string, Task[]>();
      allTasks.forEach((t) => {
        if (!t.project_id) return;
        if (!tasksByProject.has(t.project_id)) {
          tasksByProject.set(t.project_id, []);
        }
        tasksByProject.get(t.project_id)!.push(t);
      });

      // Construct card data
      const enriched: ProjectCardData[] = projList.map((p) => ({
        ...p,
        manager: p.manager_id ? empMap.get(p.manager_id) : undefined,
        tasks: tasksByProject.get(p.id) || [],
      }));

      setProjects(enriched);
    } catch (err: any) {
      console.error(err);
      toastError(err.message || "Failed to load projects.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProjectsAndEmployees();
  }, [tenantId]);

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

  // Statistics
  const stats = useMemo(() => {
    let active = 0;
    let planning = 0;
    let completed = 0;
    let totalTasks = 0;

    projects.forEach((p) => {
      if (p.status === "active") active++;
      if (p.status === "planning") planning++;
      if (p.status === "completed") completed++;
      totalTasks += p.tasks.length;
    });

    return { active, planning, completed, totalTasks };
  }, [projects]);

  // Filtered Projects
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const matchesStatus = filterTab === "all" || p.status === filterTab;
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesStatus && matchesSearch;
    });
  }, [projects, filterTab, searchQuery]);

  // Manager List (HR + Managers)
  const eligibleManagers = useMemo(() => {
    const managerIds = new Set(employees.map((e) => e.manager_id).filter(Boolean));
    return employees.filter((e) => e.role === "hr" || managerIds.has(e.id));
  }, [employees]);

  const filteredModalManagers = useMemo(() => {
    return eligibleManagers.filter((e) =>
      e.full_name.toLowerCase().includes(managerSearch.toLowerCase()) ||
      e.email.toLowerCase().includes(managerSearch.toLowerCase())
    );
  }, [eligibleManagers, managerSearch]);

  const filteredModalPeople = useMemo(() => {
    return employees.filter((e) =>
      e.full_name.toLowerCase().includes(peopleSearch.toLowerCase())
    );
  }, [employees, peopleSearch]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toastError("Project name is required.");
      return;
    }
    if (formStartDate && formEndDate && new Date(formEndDate) <= new Date(formStartDate)) {
      toastError("End date must be after start date.");
      return;
    }

    try {
      const visibility_config = {
        type: formVisibilityType,
        departments: formVisibilityType === "departments" ? formSelectedDepts : undefined,
        // Slice B target-side key, written alongside `departments` — RLS still reads `departments`
        // until Slice B is applied. visibility_config is jsonb, so this key is safe to write today.
        org_unit_ids: formVisibilityType === "departments" ? formSelectedOrgUnitIds : undefined,
        employee_ids: formVisibilityType === "people" ? formSelectedPeople : undefined,
      };

      const { data, error } = await db
        .from("projects")
        .insert([
          {
            tenant_id: tenantId,
            name: formName.trim(),
            description: formDesc.trim() || null,
            status: formStatus,
            manager_id: formManagerId || null,
            start_date: formStartDate || null,
            end_date: formEndDate || null,
            visibility_config,
            created_by: currentHr?.id || null,
          },
        ])
        .select();

      if (error) throw error;

      success("Project created. Now add tasks to it.");
      setIsModalOpen(false);
      resetForm();
      if (data && data[0]) {
        navigate(`/hr/pms/${data[0].id}`);
      } else {
        void fetchProjectsAndEmployees();
      }
    } catch (err: any) {
      toastError(err.message || "Failed to create project.");
    }
  };

  const resetForm = () => {
    setFormName("");
    setFormDesc("");
    setFormStatus("planning");
    setFormManagerId("");
    setFormStartDate("");
    setFormEndDate("");
    setFormVisibilityType("all");
    setFormSelectedDepts([]);
    setFormSelectedOrgUnitIds([]);
    setFormSelectedPeople([]);
    setManagerSearch("");
    setPeopleSearch("");
  };

  function formatDateRange(startStr: string | null, endStr: string | null) {
    if (!startStr && !endStr) return "No dates set";
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    const start = startStr ? new Date(startStr).toLocaleDateString("en-US", options) : "—";
    const end = endStr ? new Date(endStr).toLocaleDateString("en-US", options) : "—";
    return `${start} → ${end}`;
  }

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Projects</h2>
          <p className="text-sm text-slate-500">
            Active projects: <span className="font-semibold text-slate-700">{stats.active}</span>
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setIsModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" /> New Project
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Active", value: stats.active, icon: FolderKanban, color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
          { label: "Planning", value: stats.planning, icon: Calendar, color: "text-blue-600 bg-blue-50 border-blue-100" },
          { label: "Completed", value: stats.completed, icon: CheckCircle2, color: "text-slate-600 bg-slate-50 border-slate-100" },
          { label: "Total Tasks", value: stats.totalTasks, icon: Users, color: "text-purple-600 bg-purple-50 border-purple-100" },
        ].map((s, idx) => (
          <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-500">{s.label}</span>
              <span className={`rounded-xl p-2 border ${s.color}`}>
                <s.icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters and Search */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
          {(["all", "planning", "active", "on_hold", "completed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterTab(t)}
              className={`rounded-lg px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                filterTab === t ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "on_hold" ? "On Hold" : t}
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects..."
            className="w-full rounded-xl border border-slate-300 pl-10 pr-4 py-2 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition-shadow bg-slate-50 hover:bg-white focus:bg-white"
          />
        </div>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="grid gap-6 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-2xl" />
          ))}
        </div>
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects found"
          description={
            searchQuery ? "No projects match your search query." : "Start by creating a new project using the button above."
          }
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {filteredProjects.map((proj) => {
            const totalTasks = proj.tasks.length;
            const completedTasks = proj.tasks.filter((t) => t.status === "approved").length;
            const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

            // Get up to 5 unique employee IDs from tasks
            const uniqueAssignees = Array.from(new Set(proj.tasks.map((t) => t.assigned_to)))
              .map((id) => employees.find((e) => e.id === id))
              .filter(Boolean) as Employee[];

            const displayTeam = uniqueAssignees.slice(0, 5);
            const extraCount = uniqueAssignees.length - displayTeam.length;

            return (
              <div
                key={proj.id}
                className="group relative flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md hover:border-slate-300"
              >
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-lg font-bold text-slate-900 group-hover:text-brand-600 transition truncate max-w-[70%]">
                      {proj.name}
                    </h3>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize tracking-wide shrink-0 ${
                        STATUS_COLOR[proj.status]
                      }`}
                    >
                      {proj.status.replace("_", " ")}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-slate-500 line-clamp-2 h-10">
                    {proj.description || "No description provided."}
                  </p>

                  <div className="mt-4 flex items-center justify-between text-xs text-slate-400 border-t border-slate-100 pt-4">
                    <div className="flex items-center gap-2">
                      {proj.manager?.profile_photo_url ? (
                        <img
                          src={proj.manager.profile_photo_url}
                          alt=""
                          className="h-6 w-6 rounded-full object-cover"
                        />
                      ) : (
                        <div className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 font-bold text-slate-600">
                          {proj.manager?.full_name?.slice(0, 2).toUpperCase() || "?"}
                        </div>
                      )}
                      <span className="font-medium text-slate-600 truncate max-w-[120px]">
                        {proj.manager?.full_name || "Unassigned"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 font-medium text-slate-500">
                      <Calendar className="h-3.5 w-3.5 text-slate-400" />
                      <span>{formatDateRange(proj.start_date, proj.end_date)}</span>
                    </div>
                  </div>

                  {/* Task progress */}
                  <div className="mt-4 space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-slate-600">
                        {completedTasks} / {totalTasks} tasks completed
                      </span>
                      <span className="text-brand-600">{progress}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>
                </div>

                {/* Team Avatars & Action */}
                <div className="mt-6 flex items-center justify-between gap-4 border-t border-slate-100 pt-4">
                  <div className="flex items-center -space-x-2 overflow-hidden">
                    {displayTeam.map((member) => (
                      <div key={member.id} title={member.full_name} className="relative z-10 hover:z-20">
                        {member.profile_photo_url ? (
                          <img
                            src={member.profile_photo_url}
                            alt={member.full_name}
                            className="h-7 w-7 rounded-full object-cover border-2 border-white ring-1 ring-slate-100"
                          />
                        ) : (
                          <div className="grid h-7 w-7 place-items-center rounded-full bg-indigo-50 border-2 border-white text-[10px] font-bold text-indigo-700 ring-1 ring-slate-100">
                            {member.full_name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                      </div>
                    ))}
                    {extraCount > 0 && (
                      <span className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 border-2 border-white text-[9px] font-bold text-slate-600 ring-1 ring-slate-100">
                        +{extraCount}
                      </span>
                    )}
                    {uniqueAssignees.length === 0 && (
                      <span className="text-xs text-slate-400 font-medium">No team members assigned</span>
                    )}
                  </div>

                  <Link
                    to={`/hr/pms/${proj.id}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition active:scale-[0.98]"
                  >
                    View Project <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Project Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="relative flex flex-col w-full max-w-2xl max-h-[90vh] bg-white rounded-3xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <span className="rounded-xl bg-brand-50 p-2 text-brand-600">
                  <FolderKanban className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Create New Project</h3>
                  <p className="text-xs text-slate-500">Define your project details, manager, and access rules.</p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateProject} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Project Name & Desc */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Project Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Q3 Hiring Drive"
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition bg-slate-50 hover:bg-white focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Description
                  </label>
                  <textarea
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder="Enter project goals, objectives, or instructions..."
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
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as Project["status"])}
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
                      {formManagerId
                        ? employees.find((e) => e.id === formManagerId)?.full_name
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
                            setFormManagerId("");
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
                              setFormManagerId(m.id);
                              setIsManagerDropdownOpen(false);
                            }}
                            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs rounded-lg transition hover:bg-slate-50 ${
                              formManagerId === m.id ? "bg-brand-50 font-bold text-brand-700" : "text-slate-700"
                            }`}
                          >
                            <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-[10px] font-bold">
                              {m.full_name.slice(0, 2).toUpperCase()}
                            </span>
                            <div className="flex-1 truncate">
                              <p className="font-semibold">{m.full_name}</p>
                              <p className="text-[10px] text-slate-400 capitalize">{m.designation || m.role}</p>
                            </div>
                          </button>
                        ))}
                        {filteredModalManagers.length === 0 && (
                          <div className="p-3 text-center text-xs text-slate-400">No managers found.</div>
                        )}
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
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 transition bg-slate-50 hover:bg-white focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
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
                      { type: "all", label: "All Employees", icon: Building },
                      { type: "departments", label: "Departments", icon: Shield },
                      { type: "people", label: "Specific People", icon: Users },
                    ].map((v) => (
                      <button
                        key={v.type}
                        type="button"
                        onClick={() => setFormVisibilityType(v.type as any)}
                        className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                          formVisibilityType === v.type
                            ? "bg-white text-slate-900 shadow"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        <v.icon className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{v.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Specific Departments Multi-select */}
                {formVisibilityType === "departments" && (
                  <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Select Departments</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {DEPT_OPTIONS.map((dept) => {
                        const isChecked = formSelectedDepts.includes(dept);
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
                                  setFormSelectedDepts(formSelectedDepts.filter((d) => d !== dept));
                                } else {
                                  setFormSelectedDepts([...formSelectedDepts, dept]);
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
                    picker above (which RLS still reads until Slice B is applied). */}
                {formVisibilityType === "departments" && (
                  <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Select Org Units (optional)</p>
                    {orgUnits.length === 0 ? (
                      <p className="text-xs text-slate-400">No org units configured for this tenant yet.</p>
                    ) : (
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {sortOrgUnitsHierarchically(orgUnits).map((unit) => {
                          const depth = getOrgUnitDepth(unit, orgUnits);
                          const isChecked = formSelectedOrgUnitIds.includes(unit.id);
                          return (
                            <button
                              key={unit.id}
                              type="button"
                              onClick={() => {
                                if (isChecked) {
                                  setFormSelectedOrgUnitIds(formSelectedOrgUnitIds.filter((id) => id !== unit.id));
                                } else {
                                  setFormSelectedOrgUnitIds([...formSelectedOrgUnitIds, unit.id]);
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
                {formVisibilityType === "people" && (
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
                        const isChecked = formSelectedPeople.includes(emp.id);
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
                                  setFormSelectedPeople(formSelectedPeople.filter((id) => id !== emp.id));
                                } else {
                                  setFormSelectedPeople([...formSelectedPeople, emp.id]);
                                }
                              }}
                              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            />
                            <div className="flex-1 truncate">
                              <p className="font-semibold text-slate-800">{emp.full_name}</p>
                              <p className="text-[10px] text-slate-400 capitalize">{emp.department || "No Department"}</p>
                            </div>
                          </label>
                        );
                      })}
                      {filteredModalPeople.length === 0 && (
                        <div className="p-3 text-center text-xs text-slate-400">No employees found.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </form>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition shadow-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProject}
                className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 active:scale-[0.98] transition shadow-sm"
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
