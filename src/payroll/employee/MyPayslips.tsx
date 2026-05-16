import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { db } from "../../insforge/client";
import { useTenant } from "../../contexts/TenantContext";
import { useEmployee } from "../../hooks/useEmployee";
import { useToast } from "../../shared/ToastContext";
import { EmptyState } from "../../shared/EmptyState";
import { Skeleton } from "../../shared/Skeleton";

// ─── Types ────────────────────────────────────────────────────────────────────

type PayrollRunStatus = "draft" | "under_review" | "approved" | "paid";

interface Payslip {
  id: string;
  tenant_id: string;
  payroll_run_id: string;
  employee_id: string;
  month: number;
  year: number;
  gross_salary: number;
  total_deductions: number;
  net_payable: number;
  pdf_url: string | null;
  created_at: string;
  // joined from payroll_runs
  run_status?: PayrollRunStatus;
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
  // Most recent 3 payslips sorted by year/month desc
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
  const { tenantId } = useTenant();
  const { employee, loading: empLoading } = useEmployee();
  const { error: toastError } = useToast();

  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    if (!empLoading) {
      void fetchPayslips();
    }
  }, [fetchPayslips, empLoading]);

  // ── Download helper ─────────────────────────────────────────────────────────
  const handleDownload = (slip: Payslip) => {
    if (!slip.pdf_url) {
      toastError("PDF not available for this payslip yet.");
      return;
    }
    const a = document.createElement("a");
    a.href = slip.pdf_url;
    a.download = `Payslip_${MONTH_NAMES[slip.month - 1]}_${slip.year}.pdf`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleView = (slip: Payslip) => {
    if (!slip.pdf_url) {
      toastError("PDF not available for this payslip yet.");
      return;
    }
    window.open(slip.pdf_url, "_blank", "noopener,noreferrer");
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
    </div>
  );
}
