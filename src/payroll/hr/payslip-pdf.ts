import html2pdf from "html2pdf.js";
import type { Tenant } from "../../contexts/TenantContext";
import type { Employee } from "../../types";
import { MONTH_NAMES, formatCurrency } from "./payroll-calc";

export type PayslipPdfData = {
  employeeId: string;
  daysInMonth: number;
  workingDays: number;
  daysPresent: number;
  daysAbsent: number;
  daysOnLeave: number;
  halfDays: number;
  basicMonthly: number;
  hraMonthly: number;
  specialAllowance: number;
  otherAllowances: number;
  grossSalary: number;
  pfEmployee: number;
  pfEmployer: number;
  esiEmployee: number;
  esiEmployer: number;
  tds: number;
  otherDeductions: number;
  totalDeductions: number;
  netPayable: number;
  finalNet?: number;
  overtimeAmount?: number;
  lateMarkDeductionAmount?: number;
};

type StorageClient = {
  from: (bucket: string) => {
    download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
    remove?: (path: string) => Promise<{ error: unknown }>;
    upload: (path: string, file: Blob) => Promise<{ data?: unknown; error: unknown }>;
  };
};

const esc = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const moneyRow = (label: string, value: number, strong = false) => `
  <tr>
    <td style="padding:8px 0;color:#475569;font-size:12px;${strong ? "font-weight:700;color:#0f172a" : ""}">${esc(label)}</td>
    <td style="padding:8px 0;text-align:right;font-size:12px;font-weight:${strong ? "700" : "600"};color:${strong ? "#0f172a" : "#334155"}">${formatCurrency(value)}</td>
  </tr>
`;

export function buildPayslipStoragePath(tenantId: string, year: number, month: number, employeeId: string) {
  return `${tenantId}/${year}/${String(month).padStart(2, "0")}/${employeeId}.pdf`;
}

export function getPayslipStoragePath(pdfUrl: string) {
  if (pdfUrl.startsWith("http://") || pdfUrl.startsWith("https://")) {
    const markers = ["/objects/", "/object/", "/payslips/"];
    for (const marker of markers) {
      const idx = pdfUrl.indexOf(marker);
      if (idx !== -1) return decodeURIComponent(pdfUrl.slice(idx + marker.length));
    }
  }
  return pdfUrl.replace(/^\/+/, "");
}

export function isTenantPayslipPath(path: string, tenantId: string) {
  return path === tenantId || path.startsWith(`${tenantId}/`);
}

export function payslipFilename(employeeName: string | undefined, month: number, year: number) {
  const cleanName = (employeeName ?? "Employee").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return `Payslip_${cleanName || "Employee"}_${MONTH_NAMES[month - 1]}_${year}.pdf`;
}

function logoMarkup(tenant: Tenant) {
  const initials = esc(tenant.company_name.slice(0, 2).toUpperCase());
  const fallback = `<div data-logo-fallback style="height:54px;width:54px;border-radius:12px;background:#ecfdf5;color:#047857;display:${tenant.logo_url ? "none" : "flex"};align-items:center;justify-content:center;font-size:20px;font-weight:800">${initials}</div>`;

  if (!tenant.logo_url) return fallback;

  return `
    <div style="min-height:54px;display:flex;align-items:center">
      <img
        src="${esc(tenant.logo_url)}"
        style="max-height:54px;max-width:160px;object-fit:contain;display:block"
        crossorigin="anonymous"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
      />
      ${fallback}
    </div>
  `;
}

export function buildPayslipTemplateHtml(
  tenant: Tenant,
  employee: Employee,
  slip: PayslipPdfData,
  month: number,
  year: number,
) {
  const netPay = slip.finalNet ?? slip.netPayable;
  const lateDeduction = slip.lateMarkDeductionAmount ?? 0;
  const otherDeductions = Math.max(slip.otherDeductions - lateDeduction, 0);
  const overtime = slip.overtimeAmount ?? 0;
  const logo = logoMarkup(tenant);

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Payslip - ${esc(MONTH_NAMES[month - 1])} ${year}</title>
</head>
<body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <main style="width:794px;min-height:1123px;margin:0 auto;background:#ffffff;padding:34px 38px;box-sizing:border-box">
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="vertical-align:top">${logo}</td>
        <td style="text-align:right;vertical-align:top">
          <p style="margin:0 0 5px;font-size:11px;font-weight:700;letter-spacing:.12em;color:#047857;text-transform:uppercase">${esc(tenant.company_name)}</p>
          <h1 style="margin:0;font-size:28px;line-height:1.1;color:#0f172a">Payslip</h1>
          <p style="margin:8px 0 0;color:#64748b;font-size:13px">${esc(MONTH_NAMES[month - 1])} ${year}</p>
        </td>
      </tr>
    </table>

    <div style="height:4px;background:#10b981;margin:24px 0 22px;border-radius:999px"></div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
      <tr>
        <td style="width:50%;vertical-align:top;padding-right:18px">
          <p style="margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:.08em;color:#64748b;text-transform:uppercase">Employee Summary</p>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <tr><td style="padding:5px 0;color:#64748b">Employee Name</td><td style="padding:5px 0;text-align:right;font-weight:700">${esc(employee.full_name)}</td></tr>
            <tr><td style="padding:5px 0;color:#64748b">Employee Code</td><td style="padding:5px 0;text-align:right;font-weight:700">${esc(employee.employee_code ?? "-")}</td></tr>
            <tr><td style="padding:5px 0;color:#64748b">Department</td><td style="padding:5px 0;text-align:right;font-weight:700;text-transform:capitalize">${esc(employee.department ?? "-")}</td></tr>
            <tr><td style="padding:5px 0;color:#64748b">Designation</td><td style="padding:5px 0;text-align:right;font-weight:700">${esc(employee.designation ?? "-")}</td></tr>
          </table>
        </td>
        <td style="width:50%;vertical-align:top;padding-left:18px">
          <p style="margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:.08em;color:#64748b;text-transform:uppercase">Pay Period</p>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <tr><td style="padding:5px 0;color:#64748b">Days in Month</td><td style="padding:5px 0;text-align:right;font-weight:700">${slip.daysInMonth}</td></tr>
            <tr><td style="padding:5px 0;color:#64748b">Working Days</td><td style="padding:5px 0;text-align:right;font-weight:700">${slip.workingDays}</td></tr>
            <tr><td style="padding:5px 0;color:#64748b">Paid Days</td><td style="padding:5px 0;text-align:right;font-weight:700">${slip.daysPresent + slip.daysOnLeave + slip.halfDays * 0.5}</td></tr>
            <tr><td style="padding:5px 0;color:#64748b">Absent / Half Days</td><td style="padding:5px 0;text-align:right;font-weight:700">${slip.daysAbsent} / ${slip.halfDays}</td></tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:22px">
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="width:50%;vertical-align:top;padding:18px 22px;border-right:1px solid #e2e8f0">
            <p style="margin:0 0 8px;font-size:12px;font-weight:800;color:#047857;text-transform:uppercase;letter-spacing:.08em">Earnings</p>
            <table style="width:100%;border-collapse:collapse">
              ${moneyRow("Basic", slip.basicMonthly)}
              ${moneyRow("House Rent Allowance", slip.hraMonthly)}
              ${moneyRow("Special Allowance", slip.specialAllowance)}
              ${moneyRow("Other Allowances", slip.otherAllowances)}
              ${overtime > 0 ? moneyRow("Overtime", overtime) : ""}
              <tr><td colspan="2" style="height:1px;background:#e2e8f0"></td></tr>
              ${moneyRow("Gross Earnings", slip.grossSalary, true)}
            </table>
          </td>
          <td style="width:50%;vertical-align:top;padding:18px 22px">
            <p style="margin:0 0 8px;font-size:12px;font-weight:800;color:#dc2626;text-transform:uppercase;letter-spacing:.08em">Deductions</p>
            <table style="width:100%;border-collapse:collapse">
              ${moneyRow("PF Employee", slip.pfEmployee)}
              ${moneyRow("ESI Employee", slip.esiEmployee)}
              ${moneyRow("TDS", slip.tds)}
              ${lateDeduction > 0 ? moneyRow("Late Mark Deduction", lateDeduction) : ""}
              ${moneyRow("Other Deductions", otherDeductions)}
              <tr><td colspan="2" style="height:1px;background:#e2e8f0"></td></tr>
              ${moneyRow("Total Deductions", slip.totalDeductions, true)}
            </table>
          </td>
        </tr>
      </table>
    </div>

    <table style="width:100%;border-collapse:collapse;background:#ecfdf5;border:1px solid #bbf7d0;border-radius:12px;overflow:hidden">
      <tr>
        <td style="padding:18px 22px">
          <p style="margin:0;font-size:12px;color:#047857;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Net Pay</p>
          <p style="margin:6px 0 0;font-size:13px;color:#475569">Total earnings minus total deductions</p>
        </td>
        <td style="padding:18px 22px;text-align:right;font-size:28px;font-weight:800;color:#047857">${formatCurrency(netPay)}</td>
      </tr>
    </table>

    <p style="margin:26px 0 0;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:14px">
      This is a computer-generated payslip. No signature required.
    </p>
  </main>
</body>
</html>`;
}

export function htmlToPdfBlob(html: string): Promise<Blob> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "width:794px",
    "height:1123px",
    "background:#ffffff",
    "border:0",
    "opacity:0.01",
    "pointer-events:none",
    "z-index:0",
  ].join(";");
  document.body.appendChild(frame);

  const cleanup = () => {
    if (document.body.contains(frame)) document.body.removeChild(frame);
  };

  return new Promise<Blob>((resolve, reject) => {
    const doc = frame.contentDocument;
    if (!doc) {
      cleanup();
      reject(new Error("Unable to create payslip render frame."));
      return;
    }

    const render = async () => {
      try {
        await Promise.all(
          Array.from(doc.images).map((image) => {
            if (image.complete) return Promise.resolve();
            return new Promise<void>((resolveImage) => {
              image.onload = () => resolveImage();
              image.onerror = () => resolveImage();
            });
          }),
        );

        const target = doc.querySelector("main") ?? doc.body;
        const blob = await (html2pdf()
          .set({
            margin: 0,
            filename: "payslip.pdf",
            image: { type: "jpeg", quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: "#ffffff" },
            jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          })
          .from(target)
          .toPdf()
          .outputPdf("blob") as unknown as Promise<Blob>);
        cleanup();
        resolve(new Blob([blob], { type: "application/pdf" }));
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    doc.open();
    doc.write(html);
    doc.close();
    window.setTimeout(() => void render(), 100);
  });
}

export function buildPayslipPreviewHtml(tenant: Tenant, employee: Employee, slip: PayslipPdfData, month: number, year: number) {
  return buildPayslipTemplateHtml(tenant, employee, slip, month, year);
}

export async function createPayslipPdfBlob(tenant: Tenant, employee: Employee, slip: PayslipPdfData, month: number, year: number) {
  return htmlToPdfBlob(buildPayslipTemplateHtml(tenant, employee, slip, month, year));
}

export async function uploadPayslipPdf(
  storage: StorageClient,
  tenant: Tenant,
  employee: Employee,
  slip: PayslipPdfData,
  tenantId: string,
  month: number,
  year: number,
) {
  const path = buildPayslipStoragePath(tenantId, year, month, slip.employeeId);
  const pdfBlob = await createPayslipPdfBlob(tenant, employee, slip, month, year);
  const bucket = storage.from("payslips");
  if (bucket.remove) await bucket.remove(path);
  const { error } = await bucket.upload(path, pdfBlob);
  if (error) throw error;
  return path;
}

export async function downloadTenantPayslipBlob(storage: StorageClient, tenantId: string, pdfUrl: string) {
  const path = getPayslipStoragePath(pdfUrl);
  if (!isTenantPayslipPath(path, tenantId)) {
    throw new Error("Payslip does not belong to this tenant.");
  }
  const { data, error } = await storage.from("payslips").download(path);
  if (error || !data) throw error ?? new Error("Payslip file was not found.");
  if (path.endsWith(".html") || data.type === "text/html") {
    return htmlToPdfBlob(await data.text());
  }
  const blob = new Blob([data], { type: "application/pdf" });
  await assertPdfBlob(blob);
  return blob;
}

export async function assertPdfBlob(blob: Blob) {
  const header = await blob.slice(0, 4).text();
  if (header !== "%PDF" || blob.size < 3000) {
    throw new Error("This payslip needs regeneration.");
  }
}
