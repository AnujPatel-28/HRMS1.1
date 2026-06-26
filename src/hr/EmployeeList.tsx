import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  Search,
  ChevronRight,
  UserPlus,
  SlidersHorizontal,
  X,
  ChevronLeft
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Employee } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { SelectDropdown } from "../shared/components/SelectDropdown";
import CreateEmployeeTray from "./CreateEmployeeTray";

// ── Reusable Mobile Bottom Sheet / Tray ──
function MobileTray({
  isOpen,
  onClose,
  title,
  children,
  onBack,
  showBack = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  onBack?: () => void;
  showBack?: boolean;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed -inset-10 z-[110] bg-slate-900/60 backdrop-blur-xs md:hidden"
            onClick={onClose}
          />

          {/* Bottom Sheet container */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed bottom-0 left-0 right-0 z-[120] max-h-[90vh] overflow-y-auto rounded-t-[28px] border-t border-slate-200 bg-white p-6 shadow-2xl md:hidden pb-safe flex flex-col"
          >
            {/* Visual drag indicator handle */}
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200 shrink-0" />

            {/* Header */}
            <div className="mb-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                {showBack && onBack && (
                  <button
                    onClick={onBack}
                    className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                )}
                <h3 className="text-lg font-bold text-slate-900 font-display">{title}</h3>
              </div>
              <button
                onClick={onClose}
                className="rounded-full bg-slate-100 p-1.5 text-slate-500 hover:bg-slate-200 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto pb-10">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Confetti Burst Animation Component ──
function ConfettiBurst({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; color: string; scale: number; rotate: number }[]>([]);

  useEffect(() => {
    if (active) {
      const colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4"];
      const newParticles = Array.from({ length: 80 }).map((_, idx) => ({
        id: idx,
        x: (Math.random() - 0.5) * 280,
        y: -(Math.random() * 180 + 120),
        color: colors[Math.floor(Math.random() * colors.length)],
        scale: Math.random() * 0.6 + 0.4,
        rotate: Math.random() * 360,
      }));
      setParticles(newParticles);
      const timer = setTimeout(() => setParticles([]), 2500);
      return () => clearTimeout(timer);
    }
  }, [active]);

  if (particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[1000] flex items-center justify-center">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0, rotate: 0 }}
          animate={{
            x: p.x,
            y: p.y + 350,
            opacity: [1, 1, 0],
            scale: p.scale,
            rotate: p.rotate + 360,
          }}
          transition={{
            duration: 1.8 + Math.random() * 0.6,
            ease: "easeOut",
          }}
          className="absolute w-2.5 h-2.5"
          style={{
            backgroundColor: p.color,
            borderRadius: Math.random() > 0.5 ? "50%" : "2px",
          }}
        />
      ))}
    </div>
  );
}

export default function EmployeeList() {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  
  // Filters
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [workLocationFilter, setWorkLocationFilter] = useState("all");

  // Mobile Filter Tray State
  const [filterTrayOpen, setFilterTrayOpen] = useState(false);
  const [isCreateTrayOpen, setIsCreateTrayOpen] = useState(false);
  const [confettiActive, setConfettiActive] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const { error: toastError } = useToast();

  useEffect(() => {
    let active = true;
    setLoading(true);

    const fetchEmployees = async () => {
      try {
        const { data, error } = await db
          .from("employees")
          .select("*, manager:employees!manager_id(full_name)")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false });

        if (error) throw error;

        if (active) {
          const mapped = (data as any[] ?? []).map((emp) => ({
            ...emp,
            manager_name: emp.manager?.full_name || null,
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
  }, [tenantId, toastError, refreshTrigger]);

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

  const workLocationOptions = [
    { value: "all", label: "All Locations" },
    { value: "Head Office", label: "Head Office" },
    { value: "Branch Office", label: "Branch Office" },
    { value: "Remote", label: "Remote" },
    { value: "Work From Home", label: "Work From Home" },
    { value: "Other", label: "Other" },
  ];

  const activeFilters = useMemo(() => {
    const list: { key: string; label: string; clear: () => void }[] = [];
    if (departmentFilter !== "all") {
      list.push({ key: "dept", label: `Dept: ${departmentFilter}`, clear: () => setDepartmentFilter("all") });
    }
    if (statusFilter !== "all") {
      list.push({ key: "status", label: `Status: ${statusFilter}`, clear: () => setStatusFilter("all") });
    }
    if (gradeFilter !== "all") {
      list.push({ key: "grade", label: `Grade: ${gradeFilter}`, clear: () => setGradeFilter("all") });
    }
    if (workLocationFilter !== "all") {
      list.push({ key: "location", label: `Loc: ${workLocationFilter}`, clear: () => setWorkLocationFilter("all") });
    }
    return list;
  }, [departmentFilter, statusFilter, gradeFilter, workLocationFilter]);

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase();

    return employees.filter((employee) => {
      const matchesDepartment = departmentFilter === "all" || employee.department === departmentFilter;
      const matchesStatus = statusFilter === "all" || employee.status === statusFilter;
      const matchesGrade = gradeFilter === "all" || employee.grade === gradeFilter;
      const matchesLocation = workLocationFilter === "all" || employee.work_location === workLocationFilter;
      const matchesSearch =
        normalizedQuery.length === 0 ||
        employee.full_name.toLowerCase().includes(normalizedQuery) ||
        (employee.employee_code ?? "").toLowerCase().includes(normalizedQuery);

      return matchesDepartment && matchesStatus && matchesGrade && matchesLocation && matchesSearch;
    });
  }, [employees, search, departmentFilter, statusFilter, gradeFilter, workLocationFilter]);

  const statusBadgeClass = (status: Employee["status"]) => {
    if (status === "active") return "bg-emerald-100 text-emerald-700";
    if (status === "inactive") return "bg-amber-100 text-amber-700";
    return "bg-rose-100 text-rose-700";
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-5 shadow-sm pt-4 md:pt-5">
      
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">Employees</h2>
          <p className="hidden text-xs text-slate-500 sm:block mt-0.5">Manage employee records and profiles.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.innerWidth < 768) {
              setIsCreateTrayOpen(true);
            } else {
              navigate("/hr/employees/create");
            }
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-700 px-3.5 py-2.5 md:px-4 text-xs font-semibold text-white shadow-md hover:bg-brand-600 active:scale-95 transition-all duration-150"
        >
          <span className="hidden sm:inline">Add Employee</span>
          <UserPlus className="h-4 w-4 sm:hidden" />
        </button>
      </div>

      {/* Search & Filter Trigger Bar */}
      <div className="mt-4 flex gap-2 md:grid md:grid-cols-5">
        
        {/* Search */}
        <div className="relative flex-1 md:col-span-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or code"
            className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-xs outline-none transition-all hover:bg-slate-50 focus:bg-white focus:border-brand-600 bg-slate-50/50"
          />
        </div>

        {/* Mobile Filter Button */}
        <button
          type="button"
          onClick={() => setFilterTrayOpen(true)}
          className="md:hidden flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 p-2.5 text-xs font-semibold text-slate-700 transition active:scale-95 shadow-xs shrink-0"
        >
          <SlidersHorizontal className="h-4 w-4 text-slate-500" />
          Filter
          {activeFilters.length > 0 && (
            <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-brand-700 text-[9px] font-bold text-white px-1 shadow-sm">
              {activeFilters.length}
            </span>
          )}
        </button>

        {/* Desktop Filter Dropdowns */}
        <div className="hidden md:grid md:grid-cols-4 md:col-span-4 gap-3">
          <SelectDropdown
            value={departmentFilter}
            onChange={setDepartmentFilter}
            options={[
              { value: "all", label: "All Departments" },
              { value: "sales", label: "Sales" },
              { value: "dev", label: "Development" },
              { value: "marketing", label: "Marketing" },
              { value: "operations", label: "Operations" },
              { value: "design", label: "Design" },
              { value: "other", label: "Other" },
            ]}
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

      {/* Mobile Active Filter Tags */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3 md:hidden">
          {activeFilters.map((f) => (
            <div
              key={f.key}
              onClick={f.clear}
              className="flex items-center gap-1.5 rounded-full bg-brand-50 border border-brand-200/50 px-2.5 py-1 text-[9px] font-bold text-brand-700 cursor-pointer active:scale-95 transition-all shadow-xs"
            >
              <span>{f.label}</span>
              <X className="h-3 w-3 shrink-0 opacity-75 hover:opacity-100" />
            </div>
          ))}
          <button
            onClick={() => {
              setDepartmentFilter("all");
              setStatusFilter("all");
              setGradeFilter("all");
              setWorkLocationFilter("all");
            }}
            className="text-[9px] font-extrabold text-slate-400 hover:text-slate-600 px-1.5 py-1 uppercase tracking-wider"
          >
            Clear All
          </button>
        </div>
      )}

      {/* DESKTOP TABLE VIEW */}
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
                  <td className="px-4 py-3 capitalize text-slate-700">{employee.department ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700 capitalize">{employee.designation?.toLowerCase() ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{employee.manager_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusBadgeClass(employee.status)}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${employee.status === 'active' ? 'bg-emerald-500' : employee.status === 'inactive' ? 'bg-amber-500' : 'bg-rose-500'}`}></span>
                      {employee.status}
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

      {/* MOBILE LIST VIEW */}
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
          <AnimatePresence>
            {filteredEmployees.map((employee, idx) => (
              <motion.div
                key={employee.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(idx * 0.05, 0.4), ease: [0.25, 1, 0.5, 1] }}
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
                    <p className="truncate font-bold text-slate-800 group-hover:text-brand-600 transition-colors font-display text-sm">
                      {employee.full_name}
                    </p>
                    <p className="truncate text-xs font-semibold text-slate-400 capitalize mt-0.5">
                      {employee.department ? employee.department : "No Dept"} • {employee.employee_code ?? "—"}
                    </p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${statusBadgeClass(employee.status)}`}>
                  {employee.status}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* ── MOBILE FILTER TRAY ── */}
      <MobileTray
        isOpen={filterTrayOpen}
        onClose={() => setFilterTrayOpen(false)}
        title="Filter Employees"
      >
        <div className="space-y-4 pt-1">
          {/* Department Selection */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Department
            </label>
            <SelectDropdown
              value={departmentFilter}
              onChange={setDepartmentFilter}
              options={[
                { value: "all", label: "All Departments" },
                { value: "sales", label: "Sales" },
                { value: "dev", label: "Development" },
                { value: "marketing", label: "Marketing" },
                { value: "operations", label: "Operations" },
                { value: "design", label: "Design" },
                { value: "other", label: "Other" },
              ]}
              triggerClassName="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 outline-none transition-shadow hover:bg-slate-100"
            />
          </div>

          {/* Status Selection */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Status
            </label>
            <SelectDropdown
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All Statuses" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
                { value: "terminated", label: "Terminated" },
              ]}
              triggerClassName="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 outline-none transition-shadow hover:bg-slate-100"
            />
          </div>

          {/* Grade Selection */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Grade
            </label>
            <SelectDropdown
              value={gradeFilter}
              onChange={setGradeFilter}
              options={gradeOptions}
              triggerClassName="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 outline-none transition-shadow hover:bg-slate-100"
            />
          </div>

          {/* Location Selection */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Location
            </label>
            <SelectDropdown
              value={workLocationFilter}
              onChange={setWorkLocationFilter}
              options={workLocationOptions}
              triggerClassName="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 outline-none transition-shadow hover:bg-slate-100"
            />
          </div>

          {/* Close/Apply button */}
          <button
            type="button"
            onClick={() => setFilterTrayOpen(false)}
            className="w-full rounded-xl bg-brand-700 hover:bg-brand-600 py-3 text-xs font-bold text-white shadow-md mt-2.5 transition active:scale-98"
          >
            Apply Filters
          </button>
        </div>
      </MobileTray>

      {/* Create Employee Mobile Sheet Tray */}
      <CreateEmployeeTray
        isOpen={isCreateTrayOpen}
        onClose={() => setIsCreateTrayOpen(false)}
        onSuccess={() => {
          setRefreshTrigger((prev) => prev + 1);
          setConfettiActive(true);
          setTimeout(() => setConfettiActive(false), 2500);
        }}
      />

      {/* Confetti Explosion on successful create */}
      <ConfettiBurst active={confettiActive} />

    </section>
  );
}
