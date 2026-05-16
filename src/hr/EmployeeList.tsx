import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users } from "lucide-react";
import type { Employee } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";

export default function EmployeeList() {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { error: toastError } = useToast();

  useEffect(() => {
    let active = true;

    const fetchEmployees = async () => {
      try {
        const { data, error } = await db
          .from("employees")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false });

        if (error) throw error;

        if (active) {
          setEmployees((data as Employee[]) ?? []);
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

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase();

    return employees.filter((employee) => {
      const matchesDepartment = departmentFilter === "all" || employee.department === departmentFilter;
      const matchesStatus = statusFilter === "all" || employee.status === statusFilter;
      const matchesSearch =
        normalizedQuery.length === 0 ||
        employee.full_name.toLowerCase().includes(normalizedQuery) ||
        (employee.employee_code ?? "").toLowerCase().includes(normalizedQuery);

      return matchesDepartment && matchesStatus && matchesSearch;
    });
  }, [employees, search, departmentFilter, statusFilter]);

  const statusBadgeClass = (status: Employee["status"]) => {
    if (status === "active") return "bg-emerald-100 text-emerald-700";
    if (status === "inactive") return "bg-amber-100 text-amber-700";
    return "bg-rose-100 text-rose-700";
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Employees</h2>
          <p className="text-sm text-slate-500">Manage employee records and profiles.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/hr/employees/create")}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Add Employee
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or employee code"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
        />

        <select
          value={departmentFilter}
          onChange={(event) => setDepartmentFilter(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
        >
          <option value="all">All Departments</option>
          <option value="sales">Sales</option>
          <option value="dev">Development</option>
          <option value="marketing">Marketing</option>
          <option value="operations">Operations</option>
          <option value="design">Design</option>
          <option value="other">Other</option>
        </select>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="terminated">Terminated</option>
        </select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3 font-semibold">Photo</th>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Employee Code</th>
              <th className="px-4 py-3 font-semibold">Department</th>
              <th className="px-4 py-3 font-semibold">Designation</th>
              <th className="px-4 py-3 font-semibold">Status</th>
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
                  <td className="px-4 py-3"><Skeleton className="h-6 w-16 rounded-full" /></td>
                </tr>
              ))
            ) : filteredEmployees.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-10">
                  <EmptyState 
                    icon={Users} 
                    title="No employees found" 
                    description={search || departmentFilter !== "all" || statusFilter !== "all" ? "No employees match your filters." : "No employees yet. Click 'Add Employee' to create the first profile."}
                  />
                </td>
              </tr>
            ) : (
              filteredEmployees.map((employee) => (
                <tr
                  key={employee.id}
                  onClick={() => navigate(`/hr/employees/${employee.id}`)}
                  className="cursor-pointer hover:bg-slate-50"
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
                  <td className="px-4 py-3 text-slate-700">{employee.designation ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(employee.status)}`}>
                      {employee.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
