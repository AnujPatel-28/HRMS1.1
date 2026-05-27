import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, ExternalLink, Eye, Loader2, Mail, MailCheck, X } from "lucide-react";
import { db, storage } from "../../insforge/client";
import { useTenant } from "../../contexts/TenantContext";
import { useToast } from "../../shared/ToastContext";
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

interface PayrollRun {
  id: string;
  tenant_id: string;
  month: number;
  year: number;
  status: RunStatus;
  total_net: number | null;
  employee_count: number | null;
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
  employee_name?: string;
  employee_email?: string;
  employee_code?: string | null;
  employee_department?: Employee["department"];
  employee_designation?: string | null;
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
  return {
    employeeId: slip.employee_id,
    daysInMonth: slip.days_in_month,
    workingDays: slip.working_days,
    daysPresent: slip.days_present,
    daysAbsent: slip.days_absent,
    // DB stores combined days_on_leave; split as all-paid for display (no LOP breakdown in legacy DB column)
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
}: {
  slip: Payslip;
  tenantId: string;
  tenant: NonNullable<ReturnType<typeof useTenant>["tenant"]>;
  onEmailed: (id: string) => void;
}) {
  const { success, error: toastError, info } = useToast();
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
            Sent
          </span>
        ) : (
          <span className="text-xs text-slate-400">Not sent</span>
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
  const [expanded, setExpanded] = useState(false);
  const [slips, setSlips] = useState<Payslip[]>([]);
  const [loadingSlips, setLoadingSlips] = useState(false);
  const [emailingAll, setEmailingAll] = useState(false);

  const fetchSlips = useCallback(async () => {
    setLoadingSlips(true);
    try {
      const { data: slipsData, error } = await db
        .from("payslips")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("payroll_run_id", run.id)
        .order("net_payable", { ascending: false });
      if (error) throw error;

      const slipRows = (slipsData ?? []) as Payslip[];
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
    const unEmailed = slips.filter((s) => !s.emailed_at && s.pdf_url && s.employee_email);
    if (unEmailed.length === 0) {
      success("All available payslips are already prepared.");
      return;
    }

    setEmailingAll(true);
    try {
      const recipients = unEmailed.map((s) => s.employee_email).filter(Boolean).join(",");
      const subject = `Payslips for ${MONTH_NAMES[run.month - 1]} ${run.year}`;
      const body = [
        "Hello,",
        "",
        `Payslips for ${MONTH_NAMES[run.month - 1]} ${run.year} are ready.`,
        "Please log in to the TalentMesh payroll portal to view or download the PDF.",
        "",
        "Regards,",
        "HR Team",
      ].join("\n");
      window.location.href = `mailto:${recipients}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      const sentAt = new Date().toISOString();
      const { error } = await db
        .from("payslips")
        .update({ emailed_at: sentAt })
        .eq("tenant_id", tenantId)
        .in("id", unEmailed.map((s) => s.id));
      if (error) throw error;

      setSlips((prev) => prev.map((s) => (unEmailed.some((item) => item.id === s.id) ? { ...s, emailed_at: sentAt } : s)));
      success(`${unEmailed.length} payslip email(s) prepared.`);
    } catch {
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
                    <PayslipRow key={slip.id} slip={slip} tenantId={tenantId} tenant={tenant} onEmailed={handleSlipEmailed} />
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
              <iframe
                title="Payslip template preview"
                srcDoc={previewHtml}
                className="mx-auto h-[1123px] w-[794px] max-w-full origin-top rounded-lg border border-slate-200 bg-white shadow-sm"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
