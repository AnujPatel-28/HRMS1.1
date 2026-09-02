import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Search, ChevronRight, UserPlus } from "lucide-react";
import type { Employee } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { SelectDropdown } from "../shared/components/SelectDropdown";
import { useOrgStructure } from "../hooks/useOrgStructure";
import { useDepartmentLabel, useJobTitleLabel } from "../contexts/OrgUnitsContext";

export default function EmployeeList() {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [workLocationFilter, setWorkLocationFilter] = useState("all");

  const { error: toastError } = useToast();
  const { orgUnits, locations } = useOrgStructure();
  const deptLabel = useDepartmentLabel();
  const titleLabel = useJobTitleLabel();

  useEffect(() => {
    let active = true;
    setLoading(true);

    const fetchEmployees = async () => {
      try {
        // NO self-referencing embed here. `select("*, manager:employees!manager_id(full_name)")`
        // did not just fail to resolve the embed — it came back with `manager_id: null` on EVERY
        // row, nulling the base column too, so the Manager column rendered "—" for everyone and
        // "Reports To" was blank on employee detail. It failed silently, with no error.
        //
        // The manager is another employee in the same tenant and is therefore already in `data`,
        // so the name is a local lookup: no embed, no second request, no view dependency.
        const { data, error } = await db
          .from("employees")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false });

        if (error) throw error;

        if (active) {
          const rows = (data as any[]) ?? [];
          const nameById = new Map<string, string>(
            rows.map((emp) => [emp.id as string, emp.full_name as string]),
          );
          const mapped = rows.map((emp) => ({
            ...emp,
            manager_name: emp.manager_id ? nameById.get(emp.manager_id) ?? null : null,
          }));
          setEmployees(mapped);
        }
      } catch (err) {
        toastError("Failed to fetch employees.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchEmployees();
    return () => {
      active = false;
    };
  }, [tenantId, toastError]);

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

  const departmentOptions = useMemo(() => {
    // Every active unit, at any depth — see the note in Directory.tsx.
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

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase();

    return employees.filter((employee) => {
      const matchesDepartment = departmentFilter === "all" || employee.org_unit_id === departmentFilter;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "pending_review"
          ? employee.status === "draft" || employee.status === "pending_hr_review" || (employee.status === "inactive" && !employee.user_id)
          : (statusFilter === "inactive"
              ? employee.status === "inactive" && !!employee.user_id
              : employee.status === statusFilter));
      const matchesGrade = gradeFilter === "all" || employee.grade === gradeFilter;
      const matchesLocation = workLocationFilter === "all" || employee.location_id === workLocationFilter || employee.work_location === workLocationFilter;
      const matchesSearch =
        normalizedQuery.length === 0 ||
        employee.full_name.toLowerCase().includes(normalizedQuery) ||
        (employee.employee_code ?? "").toLowerCase().includes(normalizedQuery);

      return matchesDepartment && matchesStatus && matchesGrade && matchesLocation && matchesSearch;
    });
  }, [employees, search, departmentFilter, statusFilter, gradeFilter, workLocationFilter]);

  const statusBadgeClass = (employee: Employee) => {
    const { status, user_id } = employee;
    if (status === "active") return "bg-emerald-100 text-emerald-700";
    if (status === "inactive") {
      if (!user_id) return "bg-orange-100 text-orange-700";
      return "bg-amber-100 text-amber-700";
    }
    if (status === "terminated") return "bg-rose-100 text-rose-700";
    if (status === "draft" || status === "pending_hr_review") return "bg-orange-100 text-orange-700";
    if (status === "pending_onboarding") return "bg-blue-100 text-blue-700";
    return "bg-slate-100 text-slate-600";
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Employees</h2>
          <p className="hidden text-sm text-slate-500 sm:block">Manage employee records and profiles.</p>
        </div>
        <div className="flex items-center gap-3">
          {employees.filter(e => e.status === 'draft' || e.status === 'pending_hr_review' || (e.status === 'inactive' && !e.user_id)).length > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter("pending_review")}
              className="flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700 transition hover:bg-orange-100"
            >
              <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
              {employees.filter(e => e.status === 'draft' || e.status === 'pending_hr_review' || (e.status === 'inactive' && !e.user_id)).length} Pending Review
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate("/hr/employees/create")}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 md:px-4 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <span className="hidden sm:inline">Add Employee</span>
            <UserPlus className="h-4 w-4 sm:hidden" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 lg:grid lg:grid-cols-5">
        <div className="relative lg:col-span-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or code"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-4">
          <SelectDropdown
            value={departmentFilter}
            onChange={setDepartmentFilter}
            options={departmentOptions}

            triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />

          <SelectDropdown
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All Statuses" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "terminated", label: "Terminated" },
              { value: "pending_review", label: "⚠ Pending Review" },
            ]}
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
      </div>

      {/* DESKTOP VIEW */}
      <div className="mt-4 hidden md:block overflow-hidden rounded-xl border border-slate-200 shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Photo</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Employee Code</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Designation</th>
              <th className="px-4 py-3">Manager</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}>
                  <td className="px-4 py-3"><Skeleton className="h-10 w-10 rounded-full" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-6 w-16 rounded-full" /></td>
                  <td className="px-4 py-3"></td>
                </tr>
              ))
            ) : filteredEmployees.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-10">
                  <EmptyState 
                    icon={Users} 
                    title="No employees found" 
                    description={search || departmentFilter !== "all" || statusFilter !== "all" || gradeFilter !== "all" || workLocationFilter !== "all" ? "No employees match your filters." : "No employees yet. Click 'Add Employee' to create the first profile."}
                  />
                </td>
              </tr>
            ) : (
              filteredEmployees.map((employee) => (
                <tr
                  key={employee.id}
                  onClick={() => navigate(`/hr/employees/${employee.id}`)}
                  className="group cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    {employee.profile_photo_url ? (
                      <img
                        src={employee.profile_photo_url}
                        alt={employee.full_name}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                        {employee.full_name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{employee.full_name}</td>
                  <td className="px-4 py-3 text-slate-700">{employee.employee_code ?? "—"}</td>
                  <td className="px-4 py-3 capitalize text-slate-700">{deptLabel(employee)}</td>
                  <td className="px-4 py-3 text-slate-700 capitalize">{titleLabel(employee)}</td>
                  <td className="px-4 py-3 text-slate-700">{employee.manager_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusBadgeClass(employee)}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        employee.status === 'active' ? 'bg-emerald-500' :
                        employee.status === 'inactive' ? (employee.user_id ? 'bg-amber-500' : 'bg-orange-500') :
                        employee.status === 'terminated' ? 'bg-rose-500' :
                        employee.status === 'draft' || employee.status === 'pending_hr_review' ? 'bg-orange-500' :
                        'bg-blue-500'
                      }`}></span>
                      {employee.status === 'inactive' && !employee.user_id ? 'Pending HR' : employee.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="inline h-4 w-4 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MOBILE VIEW */}
      <div className="mt-4 grid gap-3 md:hidden">
        {loading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
              <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))
        ) : filteredEmployees.length === 0 ? (
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-6 shadow-inner">
            <EmptyState 
              icon={Users} 
              title="No employees found" 
              description={search || departmentFilter !== "all" || statusFilter !== "all" || gradeFilter !== "all" || workLocationFilter !== "all" ? "No matches for your filters." : "No employees yet."}
            />
          </div>
        ) : (
          filteredEmployees.map((employee) => (
            <div
              key={employee.id}
              onClick={() => navigate(`/hr/employees/${employee.id}`)}
              className="group flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] transition-all hover:border-slate-200 hover:shadow-md active:scale-[0.98]"
            >
              <div className="flex items-center gap-3 min-w-0">
                {employee.profile_photo_url ? (
                  <img
                    src={employee.profile_photo_url}
                    alt={employee.full_name}
                    className="h-12 w-12 shrink-0 rounded-full object-cover shadow-sm ring-1 ring-slate-100"
                  />
                ) : (
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-600 ring-1 ring-slate-200">
                    {employee.full_name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-900 group-hover:text-brand-600 transition-colors">
                    {employee.full_name}
                  </p>
                  <p className="truncate text-xs font-medium text-slate-500 capitalize mt-0.5">
                    {deptLabel(employee)} • {employee.employee_code ?? "—"}
                  </p>
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${statusBadgeClass(employee)}`}>
                {employee.status.replace(/_/g, " ")}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
