import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, ExternalLink, Mail, MailCheck, Loader2 } from "lucide-react";
import { db } from "../../insforge/client";
import { useTenant } from "../../contexts/TenantContext";
import { useToast } from "../../shared/ToastContext";
import { Skeleton } from "../../shared/Skeleton";
import { EmptyState } from "../../shared/EmptyState";
import { MONTH_NAMES, formatCurrency } from "./payroll-calc";

// ─── Types ────────────────────────────────────────────────────────────────────
type RunStatus = "draft" | "under_review" | "approved" | "paid";

interface PayrollRun {
  id: string;
  month: number;
  year: number;
  status: RunStatus;
  total_gross: number | null;
  total_deductions: number | null;
  total_net: number | null;
  employee_count: number | null;
  created_at: string;
}

interface Payslip {
  id: string;
  employee_id: string;
  month: number;
  year: number;
  gross_salary: number;
  total_deductions: number;
  net_payable: number;
  pdf_url: string | null;
  emailed_at: string | null;
  employee_name?: string;
  employee_email?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_STYLES: Record<RunStatus, string> = {
  draft: "bg-slate-100 text-slate-600",
  under_review: "bg-blue-100 text-blue-700",
  approved: "bg-emerald-100 text-emerald-700",
  paid: "bg-purple-100 text-purple-700",
};

function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}

// ─── Payslip Row ──────────────────────────────────────────────────────────────
function PayslipRow({ slip, onEmailed }: { slip: Payslip; onEmailed: (id: string) => void }) {
  const { success, error: toastError } = useToast();
  const [emailing, setEmailing] = useState(false);
  const hasPdf = Boolean(slip.pdf_url);

  const handleView = () => {
    if (!hasPdf) { toastError("PDF not available."); return; }
    window.open(slip.pdf_url!, "_blank", "noopener,noreferrer");
  };

  const handleDownload = () => {
    if (!hasPdf) { toastError("PDF not available."); return; }
    const a = document.createElement("a");
    a.href = slip.pdf_url!;
    a.download = `Payslip_${MONTH_NAMES[slip.month - 1]}_${slip.year}.html`;
    a.target = "_blank";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleEmail = async () => {
    setEmailing(true);
    try {
      const { error } = await db.from("payslips").update({ emailed_at: new Date().toISOString() }).eq("id", slip.id);
      if (error) throw error;
      success(`Payslip marked as emailed.`);
      onEmailed(slip.id);
    } catch { toastError("Failed to mark as emailed."); }
    finally { setEmailing(false); }
  };

  return (
    <tr className="hover:bg-slate-50/70 transition-colors">
      <td className="px-4 py-3">
        <p className="font-medium text-slate-900">{slip.employee_name ?? "—"}</p>
        <p className="text-xs text-slate-500">{slip.employee_email ?? ""}</p>
      </td>
      <td className="px-4 py-3 text-slate-700">{formatCurrency(slip.gross_salary)}</td>
      <td className="px-4 py-3 text-red-600">−{formatCurrency(slip.total_deductions)}</td>
      <td className="px-4 py-3 font-semibold text-emerald-700">{formatCurrency(slip.net_payable)}</td>
      <td className="px-4 py-3">
        {slip.emailed_at ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium"><MailCheck className="h-3.5 w-3.5" />Sent</span>
        ) : (
          <span className="text-xs text-slate-400">Not sent</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button onClick={handleView} disabled={!hasPdf} title="View" className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition">
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleDownload} disabled={!hasPdf} title="Download" className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition">
            <Download className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleEmail} disabled={emailing || Boolean(slip.emailed_at)} title="Mark as emailed" className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition">
            {emailing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Run Row (expandable) ─────────────────────────────────────────────────────
function RunRow({ run, tenantId }: { run: PayrollRun; tenantId: string }) {
  const { error: toastError, success } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [slips, setSlips] = useState<Payslip[]>([]);
  const [loadingSlips, setLoadingSlips] = useState(false);
  const [emailingAll, setEmailingAll] = useState(false);

  const fetchSlips = useCallback(async () => {
    setLoadingSlips(true);
    try {
      const { data: slipsData, error } = await db
        .from("payslips").select("*")
        .eq("tenant_id", tenantId).eq("payroll_run_id", run.id)
        .order("net_payable", { ascending: false });
      if (error) throw error;

      const slipRows = (slipsData ?? []) as Payslip[];
      const empIds = slipRows.map((s) => s.employee_id);
      if (empIds.length > 0) {
        const { data: empData } = await db.from("employees").select("id,full_name,email").in("id", empIds).eq("tenant_id", tenantId);
        const empMap = new Map(((empData ?? []) as { id: string; full_name: string; email: string }[]).map((e) => [e.id, e]));
        setSlips(slipRows.map((s) => ({ ...s, employee_name: empMap.get(s.employee_id)?.full_name, employee_email: empMap.get(s.employee_id)?.email })));
      } else {
        setSlips([]);
      }
    } catch { toastError("Failed to load payslips."); }
    finally { setLoadingSlips(false); }
  }, [run.id, tenantId, toastError]);

  const handleToggle = () => {
    setExpanded((v) => !v);
    if (!expanded && slips.length === 0) void fetchSlips();
  };

  const handleEmailAll = async () => {
    setEmailingAll(true);
    try {
      const unEmailed = slips.filter((s) => !s.emailed_at).map((s) => s.id);
      if (unEmailed.length === 0) { success("All payslips already marked as emailed."); return; }
      const { error } = await db.from("payslips").update({ emailed_at: new Date().toISOString() }).in("id", unEmailed);
      if (error) throw error;
      success(`${unEmailed.length} payslip(s) marked as emailed.`);
      void fetchSlips();
    } catch { toastError("Failed."); }
    finally { setEmailingAll(false); }
  };

  const handleSlipEmailed = (id: string) => {
    setSlips((prev) => prev.map((s) => s.id === id ? { ...s, emailed_at: new Date().toISOString() } : s));
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button onClick={handleToggle} className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition text-left">
        <div className="flex items-center gap-4">
          <div>
            <p className="font-semibold text-slate-900">{MONTH_NAMES[run.month - 1]} {run.year}</p>
            <p className="text-xs text-slate-500 mt-0.5">{run.employee_count ?? 0} employees</p>
          </div>
          <StatusBadge status={run.status} />
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden sm:block text-right">
            <p className="text-xs text-slate-500">Net Payroll</p>
            <p className="font-semibold text-slate-900">{formatCurrency(run.total_net ?? 0)}</p>
          </div>
          {expanded ? <ChevronDown className="h-5 w-5 text-slate-400" /> : <ChevronRight className="h-5 w-5 text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100">
          <div className="flex items-center justify-between px-5 py-3">
            <p className="text-sm text-slate-600">{slips.length} payslip(s)</p>
            <button onClick={handleEmailAll} disabled={emailingAll}
              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-60 transition">
              {emailingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              Email All
            </button>
          </div>

          {loadingSlips ? (
            <div className="px-5 pb-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[700px] w-full text-sm divide-y divide-slate-100">
                <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    {["Employee","Gross","Deductions","Net","Email Status","Actions"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {slips.map((slip) => (
                    <PayslipRow key={slip.id} slip={slip} onEmailed={handleSlipEmailed} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Payslips() {
  const { tenantId } = useTenant();
  const { error: toastError } = useToast();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db.from("payroll_runs").select("*").eq("tenant_id", tenantId).order("year", { ascending: false }).order("month", { ascending: false });
    if (error) { toastError("Failed to load payroll runs."); } else { setRuns((data ?? []) as PayrollRun[]); }
    setLoading(false);
  }, [tenantId, toastError]);

  useEffect(() => { void fetchRuns(); }, [fetchRuns]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Payslips</h2>
        <p className="text-sm text-slate-500">View and manage all payroll runs and employee payslips.</p>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
      ) : runs.length === 0 ? (
        <EmptyState icon={Download} title="No payroll runs yet" description="Run your first payroll to see payslips here." />
      ) : (
        <div className="space-y-3">
          {runs.map((run) => <RunRow key={run.id} run={run} tenantId={tenantId} />)}
        </div>
      )}
    </div>
  );
}
