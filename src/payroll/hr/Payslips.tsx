import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, ExternalLink, Eye, Loader2, Mail, MailCheck, X } from "lucide-react";
import { db, storage } from "../../insforge/client";
import { useTenant } from "../../contexts/TenantContext";
import { useToast } from "../../shared/ToastContext";
import { useAuditLog } from "../../hooks/useAuditLog";
import { Skeleton } from "../../shared/Skeleton";
import { EmptyState } from "../../shared/EmptyState";
import type { Employee } from "../../types";
import { MONTH_NAMES, formatCurrency } from "./payroll-calc";
import {
  buildPayslipPreviewHtml,
  createPayslipPdfBlob,
  downloadTenantPayslipBlob,
  getPayslipStoragePath,
  isTenantPayslipPath,
  payslipFilename,
  type PayslipPdfData,
} from "./payslip-pdf";

type RunStatus = "draft" | "under_review" | "approved" | "paid";
const PAYSLIP_TEMPLATE_KEY = "payroll.payslip_template";
const PAYSLIP_TEMPLATE_VALUE = "standard_v1";
const LEGACY_TEMPLATE_VALUE = "zoho_standard_v1";

// ─── Enterprise Safety Constants ──────────────────────────────────────────────────
// Batch size caps: 30 recipients per mailto: link stays safely below browser URL limits.
// 10 batches max = 300 employees. Beyond this, use the future email queue workflow.
const RECIPIENT_BATCH_SIZE = 30;
const MAX_EMAIL_BATCHES = 10;

// Snapshot versioning: bump when the payroll engine's policy_snapshot shape changes.
// Old snapshots below this version fall back to DB column values (safe defaults).
// CRITICAL: Never auto-regenerate historical payslips. Always render from stored DB values.
// Changing PF/ESI ceilings must NOT retroactively alter what employees see on old payslips.
const SUPPORTED_SNAPSHOT_VERSION = 2;

interface PayrollRun {
  id: string;
  tenant_id: string;
  month: number;
  year: number;
  status: RunStatus;
  total_net: number | null;
  employee_count: number | null;
}

interface PolicySnapshot {
  snapshot_version?: number;
  paid_leave_days?: number;
  unpaid_leave_days?: number;
  overtime_amount?: number;
  pf_base?: number | null;
  esi_base?: number | null;
  override_net?: number | null;
  [key: string]: unknown;
}

interface Payslip {
  id: string;
  tenant_id: string;
  employee_id: string;
  month: number;
  year: number;
  days_in_month: number;
  working_days: number;
  days_present: number;
  days_absent: number;
  days_on_leave: number;  // stored total (paid+unpaid) — DB column kept as-is
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
  emailed_at: string | null;
  policy_snapshot?: PolicySnapshot | null;
  employee_name?: string;
  employee_email?: string;
  employee_code?: string | null;
  employee_department?: Employee["department"];
  employee_designation?: string | null;
  expenses_reimbursement?: number;
}

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

// NOTE ON emailed_at SEMANTICS:
// In the current mailto: workflow, emailed_at means "payslip email was prepared"
// (i.e. the mail composer was opened with the employee's address pre-filled).
// It does NOT mean the email was actually delivered.
// When the future email_jobs queue is built (send-payslip-email Edge Function),
// emailed_at should be updated only on confirmed delivery, not on preparation.
async function openPdfBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadPdfBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

function openMailComposer(slip: Payslip) {
  if (!slip.employee_email) return;
  const subject = `Payslip for ${MONTH_NAMES[slip.month - 1]} ${slip.year}`;
  const body = [
    `Hi ${slip.employee_name ?? "there"},`,
    "",
    `Your payslip for ${MONTH_NAMES[slip.month - 1]} ${slip.year} is ready.`,
    "Please log in to the TalentMesh payroll portal to view or download the PDF.",
    "",
    "Regards,",
    "HR Team",
  ].join("\n");
  window.location.href = `mailto:${encodeURIComponent(slip.employee_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function sharePayslipPdf(slip: Payslip, blob: Blob) {
  const file = new File([blob], payslipFilename(slip.employee_name, slip.month, slip.year), { type: "application/pdf" });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };

  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    await nav.share({
      files: [file],
      title: `Payslip - ${MONTH_NAMES[slip.month - 1]} ${slip.year}`,
      text: `Payslip for ${slip.employee_name ?? "employee"}`,
    });
    return true;
  }

  openMailComposer(slip);
  return Boolean(slip.employee_email);
}

function employeeFromPayslip(slip: Payslip, tenantId: string): Employee {
  return {
    id: slip.employee_id,
    tenant_id: tenantId,
    user_id: null,
    full_name: slip.employee_name ?? "Employee",
    email: slip.employee_email ?? "",
    phone: null,
    date_of_birth: null,
    gender: null,
    address: null,
    city: null,
    state: null,
    pincode: null,
    department: slip.employee_department ?? null,
    designation: slip.employee_designation ?? null,
    employee_code: slip.employee_code ?? null,
    date_of_joining: null,
    employment_type: null,
    status: "active",
    aadhaar_number: null,
    pan_number: null,
    bank_name: null,
    account_number: null,
    ifsc_code: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    emergency_contact_relation: null,
    profile_photo_url: null,
    created_by: null,
    created_at: "",
    updated_at: "",
  };
}

function pdfDataFromPayslip(slip: Payslip): PayslipPdfData {
  const snapshot = slip.policy_snapshot ?? null;
  const snapshotVersion = snapshot?.snapshot_version ?? 0;

  // Version-aware parsing: v0/v1 = legacy, fall back to DB columns.
  // v2+ = full semantic fields available in snapshot.
  // If a future engine version exceeds SUPPORTED_SNAPSHOT_VERSION, warn and render best-effort.
  if (snapshotVersion > SUPPORTED_SNAPSHOT_VERSION) {
    console.warn(
      `[Payslips] Snapshot version ${snapshotVersion} exceeds supported version ${SUPPORTED_SNAPSHOT_VERSION}. Rendering with available fields.`
    );
  }

  // Snapshot field fallback table:
  // | Field             | Snapshot Source (v2+)         | Legacy Fallback (v0/v1)  |
  // |-------------------|-------------------------------|---------------------------|
  // | paid_leave_days   | snapshot.paid_leave_days      | days_on_leave (combined) |
  // | unpaid_leave_days | snapshot.unpaid_leave_days    | 0                        |
  // | overtime_amount   | snapshot.overtime_amount      | 0                        |
  // | pf_base           | snapshot.pf_base              | null                     |
  // | esi_base          | snapshot.esi_base             | null                     |
  const hasSplitLeaves = snapshotVersion >= 2 && snapshot !== null;
  const paidLeaveDays = hasSplitLeaves
    ? (snapshot!.paid_leave_days ?? slip.days_on_leave)
    : slip.days_on_leave;
  const unpaidLeaveDays = hasSplitLeaves
    ? (snapshot!.unpaid_leave_days ?? 0)
    : 0;

  return {
    employeeId: slip.employee_id,
    daysInMonth: slip.days_in_month,
    workingDays: slip.working_days,
    daysPresent: slip.days_present,
    daysAbsent: slip.days_absent,
    paidLeaveDays,
    unpaidLeaveDays,
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
    expenseItems: (slip.policy_snapshot as any)?.expense_items || [],
  };
}

function templatePreviewEmployee(tenantId: string): Employee {
  return {
    id: "preview-employee",
    tenant_id: tenantId,
    user_id: null,
    full_name: "Anuj Patel",
    email: "employee@example.com",
    phone: null,
    date_of_birth: null,
    gender: null,
    address: null,
    city: null,
    state: null,
    pincode: null,
    department: "operations",
    designation: "Payroll Executive",
    employee_code: "EMP-001",
    date_of_joining: null,
    employment_type: "full_time",
    status: "active",
    aadhaar_number: null,
    pan_number: null,
    bank_name: null,
    account_number: null,
    ifsc_code: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    emergency_contact_relation: null,
    profile_photo_url: null,
    created_by: null,
    created_at: "",
    updated_at: "",
  };
}

const templatePreviewSlip: PayslipPdfData = {
  employeeId: "preview-employee",
  daysInMonth: 31,
  workingDays: 26,
  daysPresent: 24,
  daysAbsent: 1,
  paidLeaveDays: 1,
  unpaidLeaveDays: 0,
  halfDays: 0,
  basicMonthly: 40000,
  hraMonthly: 20000,
  specialAllowance: 12000,
  otherAllowances: 3000,
  grossSalary: 75000,
  pfEmployee: 4800,
  pfEmployer: 4800,
  esiEmployee: 0,
  esiEmployer: 0,
  tds: 6500,
  otherDeductions: 0,
  totalDeductions: 11300,
  netPayable: 63700,
};

function PayslipRow({
  slip,
  tenantId,
  tenant,
  onEmailed,
  payrollRunId,
}: {
  slip: Payslip;
  tenantId: string;
  tenant: NonNullable<ReturnType<typeof useTenant>["tenant"]>;
  onEmailed: (id: string) => void;
  payrollRunId: string;
}) {
  const { success, error: toastError, info } = useToast();
  const { logAction } = useAuditLog();
  const [loadingView, setLoadingView] = useState(false);
  const [loadingDownload, setLoadingDownload] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const hasPdf = Boolean(slip.pdf_url);

  const getPdfBlob = async () => {
    if (!slip.pdf_url) throw new Error("Payslip PDF is not available.");
    const path = getPayslipStoragePath(slip.pdf_url);
    if (!isTenantPayslipPath(path, tenantId)) {
      throw new Error("Payslip does not belong to this tenant.");
    }

    try {
      await downloadTenantPayslipBlob(storage, tenantId, slip.pdf_url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "This payslip needs regeneration.";
      if (message !== "This payslip needs regeneration.") throw err;
    }

    return createPayslipPdfBlob(tenant, employeeFromPayslip(slip, tenantId), pdfDataFromPayslip(slip), slip.month, slip.year);
  };

  const handleView = async () => {
    setLoadingView(true);
    try {
      await openPdfBlob(await getPdfBlob());
      void logAction("payslip.previewed", "payslip", slip.id, { payroll_run_id: payrollRunId, employee_id: slip.employee_id });
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to open payslip PDF.");
    } finally {
      setLoadingView(false);
    }
  };

  const handleDownload = async () => {
    setLoadingDownload(true);
    try {
      downloadPdfBlob(await getPdfBlob(), payslipFilename(slip.employee_name, slip.month, slip.year));
      void logAction("payslip.downloaded", "payslip", slip.id, { payroll_run_id: payrollRunId, employee_id: slip.employee_id });
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to download payslip PDF.");
    } finally {
      setLoadingDownload(false);
    }
  };

  const handleEmail = async () => {
    setEmailing(true);
    try {
      const blob = await getPdfBlob();
      const prepared = await sharePayslipPdf(slip, blob);
      if (!prepared) {
        toastError("Employee email address is missing.");
        return;
      }

      const sentAt = new Date().toISOString();
      const { error } = await db
        .from("payslips")
        .update({ emailed_at: sentAt })
        .eq("tenant_id", tenantId)
        .eq("id", slip.id);
      if (error) throw error;

      onEmailed(slip.id);
      success("Payslip email prepared.");
      if (!navigator.share) info("Your mail app opened with the employee address and payslip message.");
    } catch {
      toastError("Failed to prepare payslip email.");
    } finally {
      setEmailing(false);
    }
  };

  return (
    <tr className="transition-colors hover:bg-slate-50/70">
      <td className="px-4 py-3">
        <p className="font-medium text-slate-900">{slip.employee_name ?? "-"}</p>
        <p className="text-xs text-slate-500">{slip.employee_email ?? ""}</p>
      </td>
      <td className="px-4 py-3 text-slate-700">{formatCurrency(slip.gross_salary)}</td>
      <td className="px-4 py-3 text-red-600">-{formatCurrency(slip.total_deductions)}</td>
      <td className="px-4 py-3 font-semibold text-emerald-700">{formatCurrency(slip.net_payable)}</td>
      <td className="px-4 py-3">
        {slip.emailed_at ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
            <MailCheck className="h-3.5 w-3.5" />
            Prepared
          </span>
        ) : (
          <span className="text-xs text-slate-400">Not prepared</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleView}
            disabled={!hasPdf || loadingView}
            title={hasPdf ? "Preview PDF" : "PDF not available"}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loadingView ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!hasPdf || loadingDownload}
            title={hasPdf ? "Download PDF" : "PDF not available"}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loadingDownload ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleEmail}
            disabled={!hasPdf || emailing}
            title={hasPdf ? "Send to email" : "PDF not available"}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {emailing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
          </button>
        </div>
      </td>
    </tr>
  );
}

function RunRow({ run, tenantId, tenant }: { run: PayrollRun; tenantId: string; tenant: NonNullable<ReturnType<typeof useTenant>["tenant"]> }) {
  const { error: toastError, success } = useToast();
  const { logAction } = useAuditLog();
  const [expanded, setExpanded] = useState(false);
  const [slips, setSlips] = useState<Payslip[]>([]);
  const [loadingSlips, setLoadingSlips] = useState(false);
  const [emailingAll, setEmailingAll] = useState(false);
  // Optimistic concurrency: cache the run's updated_at when slips load.
  // Before any bulk mutation we verify this hasn't changed in another session.
  const [cachedRunUpdatedAt, setCachedRunUpdatedAt] = useState<string | null>(null);

  const fetchSlips = useCallback(async () => {
    setLoadingSlips(true);
    try {
      const [slipsRes, runRes] = await Promise.all([
        db.from("payslips").select("*").eq("tenant_id", tenantId).eq("payroll_run_id", run.id).order("net_payable", { ascending: false }),
        db.from("payroll_runs").select("updated_at").eq("id", run.id).single(),
      ]);
      if (slipsRes.error) throw slipsRes.error;

      // Cache freshness timestamp for optimistic concurrency guard
      if (runRes.data) setCachedRunUpdatedAt((runRes.data as { updated_at: string }).updated_at);

      const slipRows = (slipsRes.data ?? []) as Payslip[];
      const empIds = slipRows.map((s) => s.employee_id);
      if (empIds.length === 0) {
        setSlips([]);
        return;
      }

      const { data: empData, error: empError } = await db
        .from("employees")
        .select("id,full_name,email,employee_code,department,designation")
        .eq("tenant_id", tenantId)
        .in("id", empIds);
      if (empError) throw empError;

      const empMap = new Map(
        ((empData ?? []) as {
          id: string;
          full_name: string;
          email: string;
          employee_code: string | null;
          department: Employee["department"];
          designation: string | null;
        }[]).map((e) => [e.id, e]),
      );
      setSlips(
        slipRows.map((s) => ({
          ...s,
          employee_name: empMap.get(s.employee_id)?.full_name,
          employee_email: empMap.get(s.employee_id)?.email,
          employee_code: empMap.get(s.employee_id)?.employee_code,
          employee_department: empMap.get(s.employee_id)?.department,
          employee_designation: empMap.get(s.employee_id)?.designation,
        })),
      );
    } catch {
      toastError("Failed to load payslips.");
    } finally {
      setLoadingSlips(false);
    }
  }, [run.id, tenantId, toastError]);

  const handleToggle = () => {
    setExpanded((value) => !value);
    if (!expanded && slips.length === 0) void fetchSlips();
  };

  const handleEmailAll = async () => {
    // Separate candidates into skipped (no email or no PDF) and actionable
    const skipped = slips.filter((s) => !s.emailed_at && (!s.pdf_url || !s.employee_email));
    const eligible = slips.filter((s) => !s.emailed_at && s.pdf_url && s.employee_email);

    if (eligible.length === 0 && skipped.length === 0) {
      success("All available payslips have already been prepared.");
      return;
    }
    if (eligible.length === 0) {
      toastError("No employees with both a PDF and email address found.");
      return;
    }

    // Optimistic concurrency guard — normalize timestamps before comparison
    // to handle serializer differences (e.g. "...Z" vs "...000Z")
    if (cachedRunUpdatedAt) {
      const { data: latestRun } = await db.from("payroll_runs").select("updated_at").eq("id", run.id).single();
      const latestTs = latestRun ? new Date((latestRun as { updated_at: string }).updated_at).getTime() : null;
      const cachedTs = new Date(cachedRunUpdatedAt).getTime();
      if (latestTs !== null && latestTs !== cachedTs) {
        toastError("This payroll run was modified by another administrator. Please refresh and try again.");
        return;
      }
    }

    // Large-tenant safety: cap at MAX_EMAIL_BATCHES × RECIPIENT_BATCH_SIZE
    const maxRecipients = RECIPIENT_BATCH_SIZE * MAX_EMAIL_BATCHES;
    const capped = eligible.length > maxRecipients;
    const toEmail = capped ? eligible.slice(0, maxRecipients) : eligible;
    if (capped) {
      toastError(
        `Only the first ${maxRecipients} payslips can be prepared via email link. For larger runs, please use the export/queue workflow.`
      );
    }

    setEmailingAll(true);
    const sentAt = new Date().toISOString();
    const successfullyQueued: string[] = [];

    try {
      void logAction("payslip.email_batch_started", "payroll_run", run.id, {
        month: run.month, year: run.year, employee_count: toEmail.length,
        batch_count: Math.ceil(toEmail.length / RECIPIENT_BATCH_SIZE),
      });

      // Emit audit events for skipped recipients
      for (const s of skipped) {
        void logAction("payslip.email_recipient_skipped", "payslip", s.id, {
          employee_id: s.employee_id,
          reason: !s.employee_email ? "missing_email" : "no_pdf",
        });
      }

      const subject = `Payslips for ${MONTH_NAMES[run.month - 1]} ${run.year}`;
      const body = [
        "Hello,", "",
        `Payslips for ${MONTH_NAMES[run.month - 1]} ${run.year} are ready.`,
        "Please log in to the TalentMesh payroll portal to view or download the PDF.",
        "", "Regards,", "HR Team",
      ].join("\n");

      const batches = [];
      for (let i = 0; i < toEmail.length; i += RECIPIENT_BATCH_SIZE) {
        batches.push(toEmail.slice(i, i + RECIPIENT_BATCH_SIZE));
      }

      for (const batch of batches) {
        const recipients = batch.map((s) => s.employee_email).filter(Boolean).join(",");
        window.open(`mailto:${recipients}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
        batch.forEach((s) => successfullyQueued.push(s.id));
      }

      // emailed_at = "mail composer opened for this employee" (not guaranteed delivered).
      // This will be upgraded to a true delivery timestamp when the email_jobs queue is built.
      if (successfullyQueued.length > 0) {
        const { error } = await db
          .from("payslips")
          .update({ emailed_at: sentAt })
          .eq("tenant_id", tenantId)
          .in("id", successfullyQueued);
        if (error) throw error;
        setSlips((prev) => prev.map((s) => successfullyQueued.includes(s.id) ? { ...s, emailed_at: sentAt } : s));
      }

      void logAction("payslip.email_batch_completed", "payroll_run", run.id, {
        month: run.month, year: run.year,
        queued_count: successfullyQueued.length,
        skipped_count: skipped.length,
      });

      success(`${successfullyQueued.length} payslip(s) prepared for email.${
        skipped.length > 0 ? ` ${skipped.length} skipped (missing email or PDF).` : ""
      }`);
    } catch {
      void logAction("payslip.email_batch_failed", "payroll_run", run.id, { month: run.month, year: run.year });
      toastError("Failed to prepare payslip emails.");
    } finally {
      setEmailingAll(false);
    }
  };

  const handleSlipEmailed = (id: string) => {
    setSlips((prev) => prev.map((s) => (s.id === id ? { ...s, emailed_at: new Date().toISOString() } : s)));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={handleToggle} className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-slate-50">
        <div className="flex items-center gap-4">
          <div>
            <p className="font-semibold text-slate-900">
              {MONTH_NAMES[run.month - 1]} {run.year}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{run.employee_count ?? 0} employees</p>
          </div>
          <StatusBadge status={run.status} />
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden text-right sm:block">
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
            <button
              type="button"
              onClick={handleEmailAll}
              disabled={emailingAll || slips.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60"
            >
              {emailingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              Email All
            </button>
          </div>

          {loadingSlips ? (
            <div className="space-y-2 px-5 pb-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[700px] w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    {["Employee", "Gross", "Deductions", "Net", "Email Status", "Actions"].map((heading) => (
                      <th key={heading} className="px-4 py-2.5 text-left">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {slips.map((slip) => (
                    <PayslipRow key={slip.id} slip={slip} tenantId={tenantId} tenant={tenant} onEmailed={handleSlipEmailed} payrollRunId={run.id} />
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

export default function Payslips() {
  const { tenantId, tenant } = useTenant();
  const { error: toastError, success } = useToast();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db
      .from("payroll_runs")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("year", { ascending: false })
      .order("month", { ascending: false });
    if (error) toastError("Failed to load payroll runs.");
    else setRuns((data ?? []) as PayrollRun[]);
    setLoading(false);
  }, [tenantId, toastError]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    let active = true;
    const fetchTemplate = async () => {
      const { data } = await db
        .from("tenant_settings")
        .select("value")
        .eq("tenant_id", tenantId)
        .eq("key", PAYSLIP_TEMPLATE_KEY)
        .maybeSingle();
      const value = (data as { value?: string } | null)?.value;
      if (active) setTemplateSaved(value === PAYSLIP_TEMPLATE_VALUE || value === LEGACY_TEMPLATE_VALUE);
    };
    void fetchTemplate();
    return () => {
      active = false;
    };
  }, [tenantId]);

  const handleSaveTemplate = async () => {
    setSavingTemplate(true);
    try {
      const { error } = await db
        .from("tenant_settings")
        .upsert(
          [{ tenant_id: tenantId, key: PAYSLIP_TEMPLATE_KEY, value: PAYSLIP_TEMPLATE_VALUE }],
          { onConflict: "tenant_id,key" },
        );
      if (error) throw error;
      setTemplateSaved(true);
      success("Payslip template saved for this company.");
    } catch {
      toastError("Failed to save payslip template.");
    } finally {
      setSavingTemplate(false);
    }
  };

  const previewHtml = tenant
    ? buildPayslipPreviewHtml(tenant, templatePreviewEmployee(tenantId), templatePreviewSlip, new Date().getMonth() + 1, new Date().getFullYear())
    : "";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Payslips</h2>
        <p className="text-sm text-slate-500">View and manage all payroll runs and employee payslips.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-slate-900">Payslip Template</p>
          <p className="text-xs text-slate-500">Saved per tenant; company name and logo are filled from the active company profile.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Eye className="h-3.5 w-3.5" />
            Preview Template
          </button>
          <button
            type="button"
            onClick={handleSaveTemplate}
            disabled={templateSaved || savingTemplate}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-100 disabled:text-emerald-800"
          >
            {savingTemplate ? "Saving..." : templateSaved ? "Template Saved" : "Save Template"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
      ) : runs.length === 0 ? (
        <EmptyState icon={Download} title="No payroll runs yet" description="Run your first payroll to see payslips here." />
      ) : (
        <div className="space-y-3">
          {tenant ? runs.map((run) => <RunRow key={run.id} run={run} tenantId={tenantId} tenant={tenant} />) : null}
        </div>
      )}

      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Payslip Template Preview</h3>
                <p className="text-xs text-slate-500">{tenant?.company_name ?? "Company"} details are shown as they will appear on payslips.</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
              <div className="mx-auto w-full max-w-[794px] overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                <iframe
                  title="Payslip template preview"
                  srcDoc={previewHtml}
                  className="h-[1123px] w-[794px] origin-top"
                  style={{ transform: "scale(0.75)", transformOrigin: "top left", width: "794px", height: "1123px", display: "block" }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
