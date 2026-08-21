import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Users, WalletCards } from "lucide-react";
import { useTenant } from "../../contexts/TenantContext";
import { db } from "../../insforge/client";
import { EmptyState } from "../../shared/EmptyState";
import { Skeleton } from "../../shared/Skeleton";
import { useToast } from "../../shared/ToastContext";
import type { Employee } from "../../types";
import { SalaryForm, calculateBreakdown, formatCurrency } from "./SalaryForm";
import { useDepartmentLabel, useUnitNames } from "../../contexts/OrgUnitsContext";

export type SalaryStructure = {
  id: string;
  tenant_id: string;
  employee_id: string;
  effective_from: string;
  ctc_annual: number;
  basic_percent: number;
  hra_percent: number;
  special_allowance: number;
  pf_applicable: boolean;
  esi_applicable: boolean;
  tds_monthly: number;
  other_allowances: number;
  created_by: string | null;
  created_at: string | null;
};

const employeeColumns = [
  "id",
  "tenant_id",
  "user_id",
  "full_name",
  "email",
  "phone",
  "date_of_birth",
  "gender",
  "address",
  "city",
  "state",
  "pincode",
  "org_unit_id",
  "job_title_id",
  "employee_code",
  "date_of_joining",
  "employment_type",
  "status",
  "aadhaar_number",
  "pan_number",
  "bank_name",
  "account_number",
  "ifsc_code",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relation",
  "profile_photo_url",
  "created_by",
  "created_at",
  "updated_at",
].join(",");

function pickCurrentStructures(structures: SalaryStructure[]) {
  const byEmployee = new Map<string, SalaryStructure>();
  const sorted = [...structures].sort((a, b) => {
    const dateCompare = b.effective_from.localeCompare(a.effective_from);
    return dateCompare !== 0 ? dateCompare : (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });

  sorted.forEach((structure) => {
    if (!byEmployee.has(structure.employee_id)) {
      byEmployee.set(structure.employee_id, structure);
    }
  });

  return byEmployee;
}

export default function SalaryStructures() {
  const deptLabel = useDepartmentLabel();
  const unitNames = useUnitNames();
  const { tenantId } = useTenant();
  const { error: toastError } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [employeeResult, structureResult] = await Promise.all([
        db.from("employees").select(employeeColumns).eq("tenant_id", tenantId).order("full_name", { ascending: true }),
        db
          .from("salary_structures")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("effective_from", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

      if (employeeResult.error) throw employeeResult.error;
      if (structureResult.error) throw structureResult.error;

      setEmployees((employeeResult.data as unknown as Employee[]) ?? []);
      setStructures((structureResult.data as unknown as SalaryStructure[]) ?? []);
    } catch (err) {
      toastError("Failed to fetch salary structures.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toastError]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const currentStructures = useMemo(() => pickCurrentStructures(structures), [structures]);
  const configuredCount = employees.filter((employee) => currentStructures.has(employee.id)).length;
  const remainingCount = Math.max(employees.length - configuredCount, 0);

  // Options are the org units actually represented in the roster: the VALUE is the unit id so the
  // filter below matches on org_unit_id, the LABEL is the resolved name.
  const departments = useMemo(
    () =>
      Array.from(new Set(employees.map((employee) => employee.org_unit_id).filter(Boolean) as string[]))
        .map((unitId) => ({ id: unitId, name: unitNames[unitId] ?? "—" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees, unitNames],
  );

  const filteredEmployees = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return employees.filter((employee) => {
      const matchesSearch = normalizedSearch.length === 0 || employee.full_name.toLowerCase().includes(normalizedSearch);
      const matchesDepartment = departmentFilter === "all" || employee.org_unit_id === departmentFilter;
      return matchesSearch && matchesDepartment;
    });
  }, [departmentFilter, employees, search]);

  const firstUnconfigured = employees.find((employee) => !currentStructures.has(employee.id));

  return (
    <>
      <section className="space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                <WalletCards className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Salary Structures</h2>
                <p className="text-sm text-slate-500">
                  {configuredCount} of {employees.length} employees have salary structures configured
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => firstUnconfigured && setSelectedEmployee(firstUnconfigured)}
              disabled={!firstUnconfigured}
              className="rounded-lg border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-white"
            >
              Set up remaining employees
            </button>
          </div>
          {remainingCount > 0 && (
            <p className="mt-3 text-sm text-slate-500">
              {remainingCount} employee{remainingCount === 1 ? "" : "s"} still need payroll salary setup.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by employee name"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none ring-brand-600 focus:ring"
              />
            </label>

            <select
              value={departmentFilter}
              onChange={(event) => setDepartmentFilter(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize outline-none ring-brand-600 focus:ring"
            >
              <option value="all">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[1100px] divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Employee name</th>
                  <th className="px-4 py-3 font-semibold">Department</th>
                  <th className="px-4 py-3 font-semibold">Annual CTC</th>
                  <th className="px-4 py-3 font-semibold">Basic/mo</th>
                  <th className="px-4 py-3 font-semibold">HRA/mo</th>
                  <th className="px-4 py-3 font-semibold">Gross/mo</th>
                  <th className="px-4 py-3 font-semibold">Net estimate/mo</th>
                  <th className="px-4 py-3 font-semibold">PF</th>
                  <th className="px-4 py-3 font-semibold">ESI</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {loading ? (
                  [...Array(5)].map((_, index) => (
                    <tr key={index}>
                      {[...Array(10)].map((__, cellIndex) => (
                        <td key={cellIndex} className="px-4 py-3">
                          <Skeleton className="h-4 w-24" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-10">
                      <EmptyState
                        icon={Users}
                        title="No employees found"
                        description="No employee records match the current salary filters."
                      />
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((employee) => {
                    const structure = currentStructures.get(employee.id) ?? null;
                    const breakdown = structure
                      ? calculateBreakdown({
                          ctcAnnual: structure.ctc_annual,
                          basicPercent: structure.basic_percent,
                          hraPercent: structure.hra_percent,
                          specialAllowance: structure.special_allowance,
                          otherAllowances: structure.other_allowances,
                          pfApplicable: structure.pf_applicable,
                          esiApplicable: structure.esi_applicable,
                          tdsMonthly: structure.tds_monthly,
                        })
                      : null;

                    return (
                      <tr key={employee.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{employee.full_name}</div>
                          <div className="text-xs text-slate-500">{employee.employee_code ?? employee.email}</div>
                        </td>
                        <td className="px-4 py-3 capitalize text-slate-700">{deptLabel(employee, "Not assigned")}</td>
                        {structure && breakdown ? (
                          <>
                            <td className="px-4 py-3 font-medium text-slate-900">{formatCurrency(structure.ctc_annual)}</td>
                            <td className="px-4 py-3 text-slate-700">{formatCurrency(breakdown.basicMonthly)}</td>
                            <td className="px-4 py-3 text-slate-700">{formatCurrency(breakdown.hraMonthly)}</td>
                            <td className="px-4 py-3 text-slate-700">{formatCurrency(breakdown.grossMonthly)}</td>
                            <td className="px-4 py-3 font-semibold text-emerald-700">{formatCurrency(breakdown.netMonthly)}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${structure.pf_applicable ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                {structure.pf_applicable ? "Yes" : "No"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${structure.esi_applicable ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                {structure.esi_applicable ? "Yes" : "No"}
                              </span>
                            </td>
                          </>
                        ) : (
                          <td className="px-4 py-3" colSpan={7}>
                            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                              Not set
                            </span>
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedEmployee(employee)}
                            className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                          >
                            Add / Edit Salary
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {selectedEmployee && (
        <SalaryForm
          employee={selectedEmployee}
          structure={currentStructures.get(selectedEmployee.id) ?? null}
          onClose={() => setSelectedEmployee(null)}
          onSaved={fetchData}
        />
      )}
    </>
  );
}
