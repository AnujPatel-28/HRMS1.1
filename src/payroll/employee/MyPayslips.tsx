import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  TrendingUp,
  Wallet,
  Building,
  CreditCard,
  Briefcase,
  FileText
} from "lucide-react";
import { db, storage } from "../../insforge/client";
import { useTenant } from "../../contexts/TenantContext";
import { useEmployee } from "../../hooks/useEmployee";
import { useToast } from "../../shared/ToastContext";
import { EmptyState } from "../../shared/EmptyState";
import { Skeleton } from "../../shared/Skeleton";
import TaxDeclaration from "../../employee/TaxDeclaration";
import {
  createPayslipPdfBlob,
  downloadTenantPayslipBlob,
  getPayslipStoragePath,
  isTenantPayslipPath,
  payslipFilename,
  type PayslipPdfData,
} from "../hr/payslip-pdf";

// ─── Types ────────────────────────────────────────────────────────────────────

type PayrollRunStatus = "draft" | "under_review" | "approved" | "paid";

interface Payslip {
  id: string;
  tenant_id: string;
  payroll_run_id: string;
  employee_id: string;
  month: number;
  year: number;
  days_in_month: number;
  working_days: number;
  days_present: number;
  days_absent: number;
  days_on_leave: number;
  half_days: number;
  basic_monthly: number;
  hra_monthly: number;
  special_allowance: number;
  other_allowances: number;
  gross_salary: number;
  pf_employee: number;
  pf_employer: number;
  esi_employee: number;
  esi_employer: number;
  tds: number;
  other_deductions: number;
  total_deductions: number;
  net_payable: number;
  pdf_url: string | null;
  created_at: string;
  // joined from payroll_runs
  run_status?: PayrollRunStatus;
  expenses_reimbursement?: number;
  policy_snapshot?: any;
}

interface SalaryStructure {
  id: string;
  effective_from: string;
  ctc_annual: number;
  basic_percent: number;
  hra_percent: number;
  special_allowance: number;
  other_allowances: number;
  pf_applicable: boolean;
  esi_applicable: boolean;
  tds_monthly: number;
}

function pdfDataFromPayslip(slip: Payslip): PayslipPdfData {
  return {
    employeeId: slip.employee_id,
    daysInMonth: slip.days_in_month,
    workingDays: slip.working_days,
    daysPresent: slip.days_present,
    daysAbsent: slip.days_absent,
    // DB stores combined days_on_leave; treat all as paid for display purposes
    paidLeaveDays: slip.days_on_leave,
    unpaidLeaveDays: 0,
    halfDays: slip.half_days,
    basicMonthly: slip.basic_monthly,
    hraMonthly: slip.hra_monthly,
    specialAllowance: slip.special_allowance,
    otherAllowances: slip.other_allowances,
    grossSalary: slip.gross_salary,
    pfEmployee: slip.pf_employee,
    pfEmployer: slip.pf_employer,
    esiEmployee: slip.esi_employee,
    esiEmployer: slip.esi_employer,
    tds: slip.tds,
    otherDeductions: slip.other_deductions,
    totalDeductions: slip.total_deductions,
    netPayable: slip.net_payable,
    expensesReimbursement: slip.expenses_reimbursement ?? 0,
    expenseItems: slip.policy_snapshot?.expense_items || [],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function getSlipStatus(runStatus?: PayrollRunStatus): "approved" | "draft" {
  if (runStatus === "approved" || runStatus === "paid") return "approved";
  return "draft";
}

function StatusBadge({ status }: { status: "approved" | "draft" }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Approved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Draft
    </span>
  );
}

// ─── Recent Earnings Cards ────────────────────────────────────────────────────

function RecentEarningsCards({ payslips }: { payslips: Payslip[] }) {
  const recent = useMemo(() => {
    return [...payslips]
      .sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        return b.month - a.month;
      })
      .slice(0, 3);
  }, [payslips]);

  if (recent.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {recent.map((slip) => (
        <div
          key={slip.id}
          className="relative overflow-hidden rounded-2xl border border-purple-100 bg-white p-5 shadow-sm"
        >
          {/* Decorative gradient blob */}
          <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-purple-100/60 blur-2xl" />
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-purple-500">
                {MONTH_NAMES[slip.month - 1]} {slip.year}
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {formatCurrency(slip.net_payable)}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">Net payable</p>
            </div>
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-50 text-purple-600">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
            <span>Gross: {formatCurrency(slip.gross_salary)}</span>
            <StatusBadge status={getSlipStatus(slip.run_status)} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MyPayslips() {
  const { tenantId, tenant } = useTenant();
  const { employee, loading: empLoading } = useEmployee();
  const { error: toastError } = useToast();

  const [activeTab, setActiveTab] = useState<"payslip" | "salary" | "declaration" | "bank">("payslip");
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [salaryStructure, setSalaryStructure] = useState<SalaryStructure | null>(null);
  const [structureLoading, setStructureLoading] = useState(false);

  const fetchPayslips = useCallback(async () => {
    if (!employee?.id || !tenantId) return;

    setLoading(true);
    try {
      // Fetch payslips for this employee only
      const { data: slipsData, error: slipsError } = await db
        .from("payslips")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employee.id)
        .order("year", { ascending: false })
        .order("month", { ascending: false });

      if (slipsError) throw slipsError;

      const slips = (slipsData ?? []) as Payslip[];

      if (slips.length === 0) {
        setPayslips([]);
        setLoading(false);
        return;
      }

      // Fetch the corresponding payroll_run statuses
      const runIds = [...new Set(slips.map((s) => s.payroll_run_id))];
      const { data: runsData, error: runsError } = await db
        .from("payroll_runs")
        .select("id,status")
        .in("id", runIds)
        .eq("tenant_id", tenantId);

      if (runsError) throw runsError;

      const runMap = new Map<string, PayrollRunStatus>(
        ((runsData ?? []) as { id: string; status: PayrollRunStatus }[]).map((r) => [r.id, r.status])
      );

      setPayslips(
        slips.map((slip) => ({
          ...slip,
          run_status: runMap.get(slip.payroll_run_id),
        }))
      );
    } catch {
      toastError("Failed to load your payslips. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [employee?.id, tenantId, toastError]);

  const fetchSalaryStructure = useCallback(async () => {
    if (!employee?.id || !tenantId) return;
    setStructureLoading(true);
    try {
      const { data, error } = await db
        .from("salary_structures")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employee.id)
        .order("effective_from", { ascending: false })
        .limit(1);

      if (error) throw error;
      if (data && data.length > 0) {
        setSalaryStructure(data[0] as SalaryStructure);
      } else {
        setSalaryStructure(null);
      }
    } catch {
      toastError("Failed to load salary structure details.");
    } finally {
      setStructureLoading(false);
    }
  }, [employee?.id, tenantId, toastError]);

  useEffect(() => {
    if (!empLoading) {
      void fetchPayslips();
      void fetchSalaryStructure();
    }
  }, [fetchPayslips, fetchSalaryStructure, empLoading]);

  // ── Download helper ─────────────────────────────────────────────────────────
  const handleDownload = async (slip: Payslip) => {
    if (!slip.pdf_url || !tenant || !employee) {
      toastError("PDF not available for this payslip yet.");
      return;
    }
    try {
      const path = getPayslipStoragePath(slip.pdf_url);
      if (!isTenantPayslipPath(path, tenantId)) throw new Error("Payslip does not belong to this tenant.");
      try {
        await downloadTenantPayslipBlob(storage, tenantId, slip.pdf_url);
      } catch (err) {
        if ((err as Error).message !== "This payslip needs regeneration.") throw err;
      }
      const blob = await createPayslipPdfBlob(tenant, employee, pdfDataFromPayslip(slip), slip.month, slip.year);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = payslipFilename(employee?.full_name, slip.month, slip.year);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to download payslip PDF.");
    }
  };

  const handleView = async (slip: Payslip) => {
    if (!slip.pdf_url || !tenant || !employee) {
      toastError("PDF not available for this payslip yet.");
      return;
    }
    try {
      const path = getPayslipStoragePath(slip.pdf_url);
      if (!isTenantPayslipPath(path, tenantId)) throw new Error("Payslip does not belong to this tenant.");
      try {
        await downloadTenantPayslipBlob(storage, tenantId, slip.pdf_url);
      } catch (err) {
        if ((err as Error).message !== "This payslip needs regeneration.") throw err;
      }
      const blob = await createPayslipPdfBlob(tenant, employee, pdfDataFromPayslip(slip), slip.month, slip.year);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to open payslip PDF.");
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const isLoading = loading || empLoading;

  return (
    <div className="space-y-6">
      {/* Hero header card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-700 via-purple-600 to-indigo-600 p-6 text-white shadow-lg">
        {/* Background pattern */}
        <div className="pointer-events-none absolute inset-0 opacity-10">
          <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full border-4 border-white" />
          <div className="absolute -bottom-12 -left-8 h-40 w-40 rounded-full border-4 border-white" />
        </div>
        <div className="relative flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <Wallet className="h-7 w-7 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Your earnings at a glance</h2>
            <p className="mt-0.5 text-sm text-purple-200">
              {payslips.length > 0
                ? `${payslips.length} payslip${payslips.length === 1 ? "" : "s"} on record`
                : "Your payslip history"}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-slate-200 bg-white px-5 pt-2 rounded-2xl shadow-sm">
        <nav className="flex space-x-6">
          {[
            { id: "payslip", label: "Pay Slip" },
            { id: "salary", label: "Salary Structure" },
            { id: "declaration", label: "Declaration" },
            { id: "bank", label: "Bank Account" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-all ${
                activeTab === t.id
                  ? "border-purple-600 text-purple-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "payslip" && (
        <>
          {/* Recent 3 months stat cards */}
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-7 w-36" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </div>
          ) : (
            <RecentEarningsCards payslips={payslips} />
          )}

          {/* Full payslip table */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">All Payslips</h3>
              {!isLoading && payslips.length > 0 && (
                <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700">
                  {payslips.length} record{payslips.length === 1 ? "" : "s"}
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="divide-y divide-slate-100">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-4">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            ) : payslips.length === 0 ? (
              <div className="p-10">
                <EmptyState
                  icon={Wallet}
                  title="No payslips yet"
                  description="Your payslips will appear here once HR runs the monthly payroll."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50 text-left">
                    <tr>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Month</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Year</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Gross</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Deductions</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Net Payable</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {payslips.map((slip) => {
                      const status = getSlipStatus(slip.run_status);
                      const hasPdf = Boolean(slip.pdf_url);
                      return (
                        <tr key={slip.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-5 py-4 font-medium text-slate-900">
                            {MONTH_NAMES[slip.month - 1]}
                          </td>
                          <td className="px-5 py-4 text-slate-700">{slip.year}</td>
                          <td className="px-5 py-4 text-slate-700">{formatCurrency(slip.gross_salary)}</td>
                          <td className="px-5 py-4 text-red-600">−{formatCurrency(slip.total_deductions)}</td>
                          <td className="px-5 py-4 font-semibold text-emerald-700">{formatCurrency(slip.net_payable)}</td>
                          <td className="px-5 py-4">
                            <StatusBadge status={status} />
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={!hasPdf}
                                onClick={() => handleView(slip)}
                                title={hasPdf ? "View PDF" : "PDF not available"}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                View
                              </button>
                              <button
                                type="button"
                                disabled={!hasPdf}
                                onClick={() => handleDownload(slip)}
                                title={hasPdf ? "Download PDF" : "PDF not available"}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40 transition"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Download
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === "salary" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-purple-50 text-purple-600">
              <Briefcase className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">My Salary Structure</h3>
              <p className="text-xs text-slate-500">Your current annual CTC structure and breakdown</p>
            </div>
          </div>

          {structureLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : !salaryStructure ? (
            <EmptyState
              icon={Briefcase}
              title="No salary structure set"
              description="Your salary structure has not been configured by HR yet."
            />
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {/* Overview Details */}
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-5 space-y-4">
                <h4 className="font-semibold text-slate-800 text-sm border-b border-slate-200 pb-2">Annual Structure Summary</h4>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <p className="text-slate-500">Annual CTC</p>
                    <p className="mt-1 text-lg font-bold text-slate-800">{formatCurrency(salaryStructure.ctc_annual)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Effective Date</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      {new Date(salaryStructure.effective_from).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Basic Allowance %</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{salaryStructure.basic_percent}%</p>
                  </div>
                  <div>
                    <p className="text-slate-500">HRA Allowance %</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{salaryStructure.hra_percent}%</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Provident Fund (PF)</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      {salaryStructure.pf_applicable ? "Eligible (12% of basic)" : "Not Applicable"}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">ESI Deductions</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      {salaryStructure.esi_applicable ? "Eligible" : "Not Applicable"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Component breakdown */}
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-5 space-y-4">
                <h4 className="font-semibold text-slate-800 text-sm border-b border-slate-200 pb-2">Monthly Component Projections</h4>
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-1.5">Salary Component</th>
                      <th className="py-1.5 text-right">Monthly Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    <tr>
                      <td className="py-2">Basic Component</td>
                      <td className="py-2 text-right">
                        {formatCurrency((salaryStructure.ctc_annual / 12) * (salaryStructure.basic_percent / 100))}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2">House Rent Allowance (HRA)</td>
                      <td className="py-2 text-right">
                        {formatCurrency(
                          (salaryStructure.ctc_annual / 12) *
                            (salaryStructure.basic_percent / 100) *
                            (salaryStructure.hra_percent / 100)
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2">Special Allowance</td>
                      <td className="py-2 text-right">{formatCurrency(salaryStructure.special_allowance)}</td>
                    </tr>
                    <tr>
                      <td className="py-2">Other Allowances</td>
                      <td className="py-2 text-right">{formatCurrency(salaryStructure.other_allowances)}</td>
                    </tr>
                    <tr className="font-semibold text-slate-900 border-t border-slate-300">
                      <td className="py-2">Estimated Monthly Gross</td>
                      <td className="py-2 text-right">
                        {formatCurrency(
                          (salaryStructure.ctc_annual / 12) * (salaryStructure.basic_percent / 100) +
                            (salaryStructure.ctc_annual / 12) *
                              (salaryStructure.basic_percent / 100) *
                              (salaryStructure.hra_percent / 100) +
                            salaryStructure.special_allowance +
                            salaryStructure.other_allowances
                        )}
                      </td>
                    </tr>
                    <tr className="text-red-600">
                      <td className="py-2">TDS Deductions (Manual Set)</td>
                      <td className="py-2 text-right">−{formatCurrency(salaryStructure.tds_monthly)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "declaration" && employee && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-purple-50 text-purple-600">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">IT Declaration</h3>
              <p className="text-xs text-slate-500">Declare investments to claim exemptions and optimize TDS</p>
            </div>
          </div>
          <TaxDeclaration employeeId={employee.id} tenantId={tenantId ?? ""} />
        </div>
      )}

      {activeTab === "bank" && employee && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-purple-50 text-purple-600">
              <Building className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">My Bank Account Credentials</h3>
              <p className="text-xs text-slate-500">Your registered bank details for salary disbursements</p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Bank Card Info */}
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-5 space-y-4">
              <h4 className="font-semibold text-slate-800 text-sm border-b border-slate-200 pb-2">Bank Details</h4>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Bank Name</span>
                  <span className="font-bold text-slate-800">{employee.bank_name || "Not Configured"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 flex items-center gap-1">
                    <CreditCard className="h-3.5 w-3.5 text-slate-400" />
                    Account Number
                  </span>
                  <span className="font-bold text-slate-800">{employee.account_number || "Not Configured"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">IFSC Code</span>
                  <span className="font-bold text-slate-800">{employee.ifsc_code || "Not Configured"}</span>
                </div>
              </div>
            </div>

            {/* Tax Credentials */}
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-5 space-y-4">
              <h4 className="font-semibold text-slate-800 text-sm border-b border-slate-200 pb-2">Tax Identifiers</h4>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">PAN Number</span>
                  <span className="font-bold text-slate-800 uppercase">{employee.pan_number || "Not Configured"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Aadhaar Number</span>
                  <span className="font-bold text-slate-800">{employee.aadhaar_number || "Not Configured"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
