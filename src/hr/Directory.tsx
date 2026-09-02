import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Grid, List, MapPin, Mail, User, X, ChevronRight, Notebook, Lock, Globe } from "lucide-react";
import type { Employee } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { SelectDropdown } from "../shared/components/SelectDropdown";
import { useAuth } from "../hooks/useAuth";
import { useOrgStructure } from "../hooks/useOrgStructure";
import { useDepartmentLabel, useJobTitleLabel } from "../contexts/OrgUnitsContext";

export default function Directory() {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const { role, user } = useAuth();
  const { error: toastError } = useToast();
  const { orgUnits, locations, employmentTypes } = useOrgStructure();
  const deptLabel = useDepartmentLabel();
  const titleLabel = useJobTitleLabel();

  const getLocationLabel = (emp: Employee) => {
    if (emp.location_id) {
      const loc = locations.find((l) => l.id === emp.location_id);
      if (loc) return loc.name;
    }
    return emp.work_location || "—";
  };

  const isHr = role === "hr";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [workLocationFilter, setWorkLocationFilter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState("all");
  
  const [viewType, setViewType] = useState<"grid" | "list">(() => {
    return (localStorage.getItem("directory_view_preference") as "grid" | "list") || "grid";
  });

  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  const currentUserEmployeeId = useMemo(() => {
    if (!user) return null;
    const match = employees.find((emp) => emp.user_id === user.id);
    return match ? match.id : null;
  }, [employees, user]);

  useEffect(() => {
    localStorage.setItem("directory_view_preference", viewType);
  }, [viewType]);

  useEffect(() => {
    let active = true;
    setLoading(true);

    const fetchDirectory = async () => {
      try {
        // PostgREST resolves the self-referencing FK on `employees` in the REVERSE direction: the
        // embed `manager:employees!manager_id(full_name)` returns an ARRAY of the employee's DIRECT
        // REPORTS, not their manager. `.full_name` on an array is undefined, so `|| null` fired for
        // every row and the manager rendered as "—" everywhere. The `!employees_manager_id_fkey`
        // constraint hint does NOT work here ("Could not find a relationship"). Resolve explicitly.
        const query = isHr
          ? db.from("employees").select("*")
          : db.from("employee_directory_public").select("*");

        const { data, error } = await query
          .eq("tenant_id", tenantId)
          .order("full_name", { ascending: true });

        if (error) throw error;

        if (active && data) {
          const rows = data as any[];
          // The manager is another employee in the same result set, so this is a local lookup.
          // The non-HR branch reads the view, which already carries a working `manager_name`.
          const nameById = new Map<string, string>(rows.map((e) => [e.id, e.full_name]));
          const mapped = rows.map((e) => ({
            ...e,
            manager_name: e.manager_name || (e.manager_id ? nameById.get(e.manager_id) ?? null : null),
          }));
          setEmployees(mapped);
        }
      } catch (err) {
        toastError("Failed to fetch directory.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchDirectory();
    return () => {
      active = false;
    };
  }, [isHr, tenantId, toastError]);

  const departmentOptions = useMemo(() => {
    // Every active unit, at any depth — 06 §0 allows assignment to a Division or Team, so
    // filtering on unit_type === "department" hid units the HR admin had deliberately created.
    const lookupDepartments = orgUnits
      .map((unit) => ({ value: unit.id, label: unit.name }));

    return lookupDepartments.length > 0
      ? [{ value: "all", label: "All Departments" }, ...lookupDepartments]
      : [
          { value: "all", label: "All Departments" },
          { value: "sales", label: "Sales" },
          { value: "dev", label: "Development" },
          { value: "marketing", label: "Marketing" },
          { value: "operations", label: "Operations" },
          { value: "design", label: "Design" },
          { value: "other", label: "Other" },
        ];
  }, [orgUnits]);

  const workLocationOptions = useMemo(() => {
    const lookupLocations = locations.map((location) => ({ value: location.id, label: location.name }));

    return lookupLocations.length > 0
      ? [{ value: "all", label: "All Locations" }, ...lookupLocations]
      : [
          { value: "all", label: "All Locations" },
          { value: "Head Office", label: "Head Office" },
          { value: "Branch Office", label: "Branch Office" },
          { value: "Remote", label: "Remote" },
          { value: "Work From Home", label: "Work From Home" },
          { value: "Other", label: "Other" },
        ];
  }, [locations]);

  const gradeOptions = useMemo(() => {
    const grades = new Set<string>();
    employees.forEach((emp) => {
      if (emp.grade && emp.grade.trim()) {
        grades.add(emp.grade.trim());
      }
    });
    return [
      { value: "all", label: "All Grades" },
      ...Array.from(grades).sort().map((g) => ({ value: g, label: g })),
    ];
  }, [employees]);

  const managerOptions = useMemo(() => {
    const managers = new Map<string, string>();
    employees.forEach((emp) => {
      if (emp.manager_id && emp.manager_name) {
        managers.set(emp.manager_id, emp.manager_name);
      }
    });
    return [
      { value: "all", label: "All Managers" },
      ...Array.from(managers.entries()).map(([id, name]) => ({ value: id, label: name })),
    ];
  }, [employees]);

  const statusOptions = useMemo(() => {
    if (!isHr) return [{ value: "active", label: "Active Only" }];
    return [
      { value: "all", label: "All Statuses" },
      { value: "active", label: "Active Only" },
      { value: "inactive", label: "Inactive Only" },
      { value: "terminated", label: "Terminated Only" },
    ];
  }, [isHr]);

  const employmentTypeOptions = useMemo(() => {
    const lookupTypes = employmentTypes.map((t) => ({ value: t.id, label: t.name }));
    return [
      { value: "all", label: "All Employment Types" },
      ...lookupTypes,
    ];
  }, [employmentTypes]);

  const clearFilters = () => {
    setSearch("");
    setDepartmentFilter("all");
    setGradeFilter("all");
    setWorkLocationFilter("all");
    setManagerFilter("all");
    setStatusFilter("active");
    setEmploymentTypeFilter("all");
  };

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase();

    return employees.filter((employee) => {
      const matchesDepartment = departmentFilter === "all" || employee.org_unit_id === departmentFilter;
      const matchesGrade = gradeFilter === "all" || employee.grade === gradeFilter;
      const matchesLocation = workLocationFilter === "all" || employee.location_id === workLocationFilter || employee.work_location === workLocationFilter;
      const matchesManager = managerFilter === "all" || employee.manager_id === managerFilter;
      const matchesStatus = statusFilter === "all" || employee.status === statusFilter;
      const matchesEmploymentType =
        employmentTypeFilter === "all" ||
        employee.employment_type_id === employmentTypeFilter ||
        employee.employment_type === employmentTypeFilter;

      const matchesSearch =
        normalizedQuery.length === 0 ||
        employee.full_name.toLowerCase().includes(normalizedQuery) ||
        titleLabel(employee, "").toLowerCase().includes(normalizedQuery) ||
        employee.email.toLowerCase().includes(normalizedQuery);

      return matchesDepartment && matchesGrade && matchesLocation && matchesManager && matchesStatus && matchesEmploymentType && matchesSearch;
    });
  }, [employees, search, departmentFilter, gradeFilter, workLocationFilter, managerFilter, statusFilter, employmentTypeFilter, titleLabel]);

  const hasActiveFilters =
    search ||
    departmentFilter !== "all" ||
    gradeFilter !== "all" ||
    workLocationFilter !== "all" ||
    managerFilter !== "all" ||
    statusFilter !== "active" ||
    employmentTypeFilter !== "all";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm">
      {/* HEADER */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Company Directory</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {loading ? "Loading directory..." : `${filteredEmployees.length} employee${filteredEmployees.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* VIEW TOGGLE */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setViewType("grid")}
              className={`rounded-md p-1.5 transition-colors ${
                viewType === "grid" ? "bg-white text-brand-600 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
              title="Grid View"
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewType("list")}
              className={`rounded-md p-1.5 transition-colors ${
                viewType === "list" ? "bg-white text-brand-600 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
              title="List View"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="mt-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, designation, email..."
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <SelectDropdown
            value={departmentFilter}
            onChange={setDepartmentFilter}
            options={departmentOptions}
            triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />

          <SelectDropdown
            value={gradeFilter}
            onChange={setGradeFilter}
            options={gradeOptions}
            triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />

          <SelectDropdown
            value={workLocationFilter}
            onChange={setWorkLocationFilter}
            options={workLocationOptions}
            triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-48">
              <SelectDropdown
                value={managerFilter}
                onChange={setManagerFilter}
                options={managerOptions}
                triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div className="w-full sm:w-48">
              <SelectDropdown
                value={employmentTypeFilter}
                onChange={setEmploymentTypeFilter}
                options={employmentTypeOptions}
                triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div className="w-full sm:w-48">
              <SelectDropdown
                value={statusFilter}
                onChange={setStatusFilter}
                options={statusOptions}
                triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-semibold text-rose-600 hover:text-rose-700 transition"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* MAIN VIEW */}
      {loading ? (
        <div className="mt-6">
          {viewType === "grid" ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="rounded-2xl border border-slate-100 p-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-12 w-12 rounded-full shrink-0" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm mt-6">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 border-b border-slate-100 p-4">
                  <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-28" />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : filteredEmployees.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={Notebook}
            title="No employees found"
            description="Try adjusting your search criteria or filters."
          />
        </div>
      ) : viewType === "grid" ? (
        /* GRID VIEW */
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredEmployees.map((emp) => (
            <div
              key={emp.id}
              onClick={() => setSelectedEmployee(emp)}
              className="group cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start gap-3">
                  {emp.profile_photo_url ? (
                    <img
                      src={emp.profile_photo_url}
                      alt={emp.full_name}
                      className="h-12 w-12 shrink-0 rounded-full object-cover shadow-inner border border-slate-100"
                    />
                  ) : (
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-600 ring-1 ring-slate-200">
                      {emp.full_name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 truncate group-hover:text-brand-600 transition-colors">
                      {emp.full_name}
                    </h3>
                    <p className="text-xs text-slate-500 font-medium truncate mt-0.5">{titleLabel(emp)}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {deptLabel(emp) !== "—" && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      {deptLabel(emp)}
                    </span>
                  )}
                  {emp.grade && (
                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-bold text-blue-600">
                      {emp.grade}
                    </span>
                  )}
                </div>

                <div className="mt-4 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{getLocationLabel(emp) !== "—" ? getLocationLabel(emp) : "Not specified"}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">
                      {emp.manager_name ? `Reports to: ${emp.manager_name}` : "No manager"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                <a
                  href={`mailto:${emp.email}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-brand-600 transition"
                >
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  <span>Email</span>
                </a>
                <ChevronRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* LIST VIEW */
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.01)]">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Photo & Name</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Designation</th>
                <th className="px-4 py-3">Grade</th>
                <th className="px-4 py-3">Employee Manager</th>
                <th className="px-4 py-3">Work Location</th>
                {isHr && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {filteredEmployees.map((emp) => (
                <tr
                  key={emp.id}
                  onClick={() => setSelectedEmployee(emp)}
                  className="group cursor-pointer hover:bg-slate-50/50 transition-colors"
                >
                  <td className="px-4 py-4 text-xs font-mono text-slate-400 truncate max-w-[60px]">
                    {emp.employee_code || "—"}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2.5">
                      {emp.profile_photo_url ? (
                        <img
                          src={emp.profile_photo_url}
                          alt={emp.full_name}
                          className="h-8 w-8 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 shrink-0">
                          {emp.full_name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className="font-semibold text-slate-900 truncate max-w-[150px] group-hover:text-brand-600 transition-colors">
                        {emp.full_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-slate-700 capitalize font-medium">{deptLabel(emp)}</td>
                  <td className="px-4 py-4 text-slate-600 capitalize font-medium">{titleLabel(emp)}</td>
                  <td className="px-4 py-4">
                    {emp.grade ? (
                      <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-bold text-blue-600">{emp.grade}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-4 text-slate-600 font-medium">{emp.manager_name || "—"}</td>
                  <td className="px-4 py-4 text-slate-600 font-medium">{getLocationLabel(emp)}</td>
                  {isHr && (
                    <td className="px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/hr/employees/${emp.id}`);
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
                      >
                        View Profile
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* QUICK PROFILE DRAWER */}
      {selectedEmployee && (() => {
        const statusBadge = (status: string) => {
          switch (status) {
            case "active":
              return "bg-emerald-50 text-emerald-700 border-emerald-100";
            case "inactive":
              return "bg-amber-50 text-amber-700 border-amber-100";
            case "terminated":
              return "bg-rose-50 text-rose-700 border-rose-100";
            default:
              return "bg-slate-50 text-slate-650 border-slate-200";
          }
        };

        const profileCompletenessVal = (() => {
          const fields = [
            selectedEmployee.full_name,
            selectedEmployee.email,
            selectedEmployee.phone,
            selectedEmployee.date_of_joining,
            selectedEmployee.employee_code,
            selectedEmployee.org_unit_id,
            selectedEmployee.job_title_id,
            selectedEmployee.employment_type_id || selectedEmployee.employment_type,
            selectedEmployee.aadhaar_number,
            selectedEmployee.pan_number,
            selectedEmployee.bank_name,
            selectedEmployee.account_number,
            selectedEmployee.ifsc_code,
          ];
          const completed = fields.filter((f) => f && String(f).trim() !== "").length;
          return Math.round((completed / fields.length) * 100);
        })();

        const canViewSensitive = isHr || selectedEmployee.id === currentUserEmployeeId;

        return (
          <div className="fixed inset-0 z-50 flex justify-end overflow-hidden">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300"
              onClick={() => setSelectedEmployee(null)}
            />
            
            {/* Drawer */}
            <div className="relative w-full max-w-md h-full bg-white shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-300">
              {/* Decorative Banner */}
              <div className="relative h-28 bg-gradient-to-r from-brand-600 to-indigo-600 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedEmployee(null)}
                  className="absolute right-4 top-4 rounded-full p-2 bg-white/10 hover:bg-white/20 text-white transition-colors"
                  title="Close Drawer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Identity & Status */}
              <div className="px-6 pb-4 relative -mt-10 flex flex-col items-center text-center border-b border-slate-100 shrink-0">
                {selectedEmployee.profile_photo_url ? (
                  <img
                    src={selectedEmployee.profile_photo_url}
                    alt={selectedEmployee.full_name}
                    className="h-20 w-20 rounded-full object-cover shadow border-4 border-white bg-white"
                  />
                ) : (
                  <div className="grid h-20 w-20 place-items-center rounded-full bg-slate-100 text-xl font-bold text-slate-700 shadow border-4 border-white">
                    {selectedEmployee.full_name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <h3 className="text-lg font-bold text-slate-900 mt-2">{selectedEmployee.full_name}</h3>
                <p className="text-xs font-semibold text-slate-500 capitalize">{titleLabel(selectedEmployee)}</p>
                
                <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                  {deptLabel(selectedEmployee) !== "—" && (
                    <span className="rounded-full bg-brand-50 border border-brand-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brand-600">
                      {deptLabel(selectedEmployee)}
                    </span>
                  )}
                  <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${statusBadge(selectedEmployee.status)}`}>
                    {selectedEmployee.status}
                  </span>
                </div>
              </div>

              {/* Scrollable details */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Profile Completeness bar */}
                {canViewSensitive && (
                  <div className="bg-slate-50/60 rounded-xl border border-slate-200/60 p-4">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                      <span>Profile Completeness</span>
                      <span className="text-brand-600">{profileCompletenessVal}%</span>
                    </div>
                    <div className="mt-2 w-full bg-slate-200/60 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className={`h-full rounded-full bg-brand-600`}
                        style={{ width: `${profileCompletenessVal}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* About Bio */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">About / Bio</span>
                  <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 rounded-xl p-3 border border-slate-100 font-medium">
                    {selectedEmployee.employee_bio || "This employee has not set a bio yet."}
                  </p>
                </div>

                {/* Employment details grid */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-1">Employment Details</h4>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Grade</span>
                      <p className="font-semibold text-slate-700 mt-0.5">{selectedEmployee.grade || "—"}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Work Location</span>
                      <p className="font-semibold text-slate-700 mt-0.5">{getLocationLabel(selectedEmployee)}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Reporting Manager</span>
                      <p className="font-semibold text-slate-700 mt-0.5">{selectedEmployee.manager_name || "—"}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Work Mode</span>
                      <p className="font-semibold text-slate-700 mt-0.5 capitalize">{selectedEmployee.work_mode || "office"}</p>
                    </div>
                  </div>
                </div>

                {/* Contact information details */}
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between">
                    <span>Contact Info</span>
                    {!canViewSensitive && (
                      <span className="text-[9px] font-medium text-slate-450 normal-case flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        Restricted
                      </span>
                    )}
                  </h4>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Corporate Email</span>
                      <a href={`mailto:${selectedEmployee.email}`} className="font-semibold text-brand-600 hover:underline">{selectedEmployee.email}</a>
                    </div>

                    {canViewSensitive ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Mobile Number</span>
                          <a href={`tel:${selectedEmployee.phone}`} className="font-semibold text-brand-600 hover:underline">{selectedEmployee.phone || "—"}</a>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Employee Code</span>
                          <span className="font-mono text-slate-700">{selectedEmployee.employee_code || "—"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Date of Joining</span>
                          <span className="font-semibold text-slate-700">
                            {selectedEmployee.date_of_joining ? new Date(selectedEmployee.date_of_joining).toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' }) : "—"}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-center mt-2">
                        <p className="text-[10px] text-slate-500 flex items-center justify-center gap-1.5 font-medium">
                          <Lock className="h-3 w-3 text-slate-400" />
                          Private contact details are restricted to HR personnel.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedEmployee(null)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
                >
                  Close
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedEmployee(null);
                    navigate(`/hr/org-chart?focus=${selectedEmployee.id}`);
                  }}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-bold text-slate-750 hover:bg-slate-50 transition shadow-sm flex items-center justify-center gap-1"
                >
                  <Globe className="h-3.5 w-3.5 text-slate-400" />
                  Org Chart
                </button>

                {isHr && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEmployee(null);
                      navigate(`/hr/employees/${selectedEmployee.id}`);
                    }}
                    className="flex-1 rounded-xl bg-brand-600 py-2 text-xs font-bold text-white hover:bg-brand-700 transition shadow"
                  >
                    Edit Profile
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
