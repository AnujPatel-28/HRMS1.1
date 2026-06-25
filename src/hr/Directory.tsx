import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Grid, List, MapPin, Mail, User, X, ChevronRight, Notebook } from "lucide-react";
import type { Employee } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { SelectDropdown } from "../shared/components/SelectDropdown";
import { useAuth } from "../hooks/useAuth";

export default function Directory() {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const { role } = useAuth();
  const { error: toastError } = useToast();

  const isHr = role === "hr";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [workLocationFilter, setWorkLocationFilter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");
  
  const [viewType, setViewType] = useState<"grid" | "list">(() => {
    return (localStorage.getItem("directory_view_preference") as "grid" | "list") || "grid";
  });

  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  useEffect(() => {
    localStorage.setItem("directory_view_preference", viewType);
  }, [viewType]);

  useEffect(() => {
    let active = true;
    setLoading(true);

    const fetchDirectory = async () => {
      try {
        const { data, error } = await db
          .from("employees")
          .select("*, manager:employees!manager_id(full_name)")
          .eq("tenant_id", tenantId)
          .eq("status", "active")
          .order("full_name", { ascending: true });

        if (error) throw error;

        if (active && data) {
          const mapped = (data as any[]).map((e) => ({
            ...e,
            manager_name: e.manager?.full_name || null,
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
  }, [tenantId, toastError]);

  const departmentOptions = [
    { value: "all", label: "All Departments" },
    { value: "sales", label: "Sales" },
    { value: "dev", label: "Development" },
    { value: "marketing", label: "Marketing" },
    { value: "operations", label: "Operations" },
    { value: "design", label: "Design" },
    { value: "other", label: "Other" },
  ];

  const workLocationOptions = [
    { value: "all", label: "All Locations" },
    { value: "Head Office", label: "Head Office" },
    { value: "Branch Office", label: "Branch Office" },
    { value: "Remote", label: "Remote" },
    { value: "Work From Home", label: "Work From Home" },
    { value: "Other", label: "Other" },
  ];

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

  const clearFilters = () => {
    setSearch("");
    setDepartmentFilter("all");
    setGradeFilter("all");
    setWorkLocationFilter("all");
    setManagerFilter("all");
  };

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase();

    return employees.filter((employee) => {
      const matchesDepartment = departmentFilter === "all" || employee.department === departmentFilter;
      const matchesGrade = gradeFilter === "all" || employee.grade === gradeFilter;
      const matchesLocation = workLocationFilter === "all" || employee.work_location === workLocationFilter;
      const matchesManager = managerFilter === "all" || employee.manager_id === managerFilter;
      const matchesSearch =
        normalizedQuery.length === 0 ||
        employee.full_name.toLowerCase().includes(normalizedQuery) ||
        (employee.designation ?? "").toLowerCase().includes(normalizedQuery) ||
        employee.email.toLowerCase().includes(normalizedQuery);

      return matchesDepartment && matchesGrade && matchesLocation && matchesManager && matchesSearch;
    });
  }, [employees, search, departmentFilter, gradeFilter, workLocationFilter, managerFilter]);

  const hasActiveFilters =
    search ||
    departmentFilter !== "all" ||
    gradeFilter !== "all" ||
    workLocationFilter !== "all" ||
    managerFilter !== "all";

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

        <div className="flex items-center justify-between">
          <div className="max-w-xs md:max-w-none">
            <SelectDropdown
              value={managerFilter}
              onChange={setManagerFilter}
              options={managerOptions}
              triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
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
                    <p className="text-xs text-slate-500 font-medium truncate mt-0.5">{emp.designation || "—"}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {emp.department && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      {emp.department}
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
                    <span className="truncate">{emp.work_location || "Not specified"}</span>
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
                  <td className="px-4 py-4 text-slate-700 capitalize font-medium">{emp.department || "—"}</td>
                  <td className="px-4 py-4 text-slate-600 capitalize font-medium">{emp.designation?.toLowerCase() || "—"}</td>
                  <td className="px-4 py-4">
                    {emp.grade ? (
                      <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-bold text-blue-600">{emp.grade}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-4 text-slate-600 font-medium">{emp.manager_name || "—"}</td>
                  <td className="px-4 py-4 text-slate-600 font-medium">{emp.work_location || "—"}</td>
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

      {/* DETAIL MODAL */}
      {selectedEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setSelectedEmployee(null)}
          />
          
          {/* modal card */}
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl p-6 overflow-hidden animate-in fade-in zoom-in duration-200">
            <button
              type="button"
              onClick={() => setSelectedEmployee(null)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              title="Close modal"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-4 border-b border-slate-100 pb-5">
              {selectedEmployee.profile_photo_url ? (
                <img
                  src={selectedEmployee.profile_photo_url}
                  alt={selectedEmployee.full_name}
                  className="h-16 w-16 rounded-full object-cover shadow border border-slate-100"
                />
              ) : (
                <div className="grid h-16 w-16 place-items-center rounded-full bg-slate-100 text-lg font-bold text-slate-600 ring-2 ring-slate-100">
                  {selectedEmployee.full_name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <h3 className="text-xl font-bold text-slate-900 truncate">{selectedEmployee.full_name}</h3>
                <p className="text-sm font-semibold text-slate-500 mt-0.5 capitalize">{selectedEmployee.designation || "—"}</p>
                {selectedEmployee.department && (
                  <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600 mt-1">
                    {selectedEmployee.department}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-5 space-y-4 text-sm max-h-[60vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Grade</span>
                  <p className="font-semibold text-slate-800 mt-0.5">{selectedEmployee.grade || "—"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Work Location</span>
                  <p className="font-semibold text-slate-800 mt-0.5">{selectedEmployee.work_location || "—"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Manager</span>
                  <p className="font-semibold text-slate-800 mt-0.5">{selectedEmployee.manager_name || "—"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Employee Code</span>
                  <p className="font-semibold text-slate-800 mt-0.5 font-mono">{selectedEmployee.employee_code || "—"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Date of Joining</span>
                  <p className="font-semibold text-slate-800 mt-0.5">
                    {selectedEmployee.date_of_joining ? new Date(selectedEmployee.date_of_joining).toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' }) : "—"}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Email</span>
                  <a href={`mailto:${selectedEmployee.email}`} className="font-semibold text-brand-600 hover:text-brand-700 transition mt-0.5 block truncate">
                    {selectedEmployee.email}
                  </a>
                </div>
                {selectedEmployee.phone && (
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Phone</span>
                    <p className="font-semibold text-slate-800 mt-0.5">{selectedEmployee.phone}</p>
                  </div>
                )}
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Bio</span>
                <p className="text-slate-600 mt-1 leading-relaxed bg-slate-50 rounded-xl p-3 border border-slate-100">
                  {selectedEmployee.employee_bio || "This employee has not set a bio yet."}
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setSelectedEmployee(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition shadow-sm"
              >
                Close
              </button>
              {isHr && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEmployee(null);
                    navigate(`/hr/employees/${selectedEmployee.id}`);
                  }}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition shadow"
                >
                  Edit Profile
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
