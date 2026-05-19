import type { Tenant } from "../../contexts/TenantContext";
import type { Employee } from "../../types";

import type { PayslipCalc } from "./payroll-calc";
import { MONTH_NAMES, formatCurrency } from "./payroll-calc";

function row(label: string, value: string) {
  return `<tr><td style="padding:4px 8px;color:#475569;font-size:13px">${label}</td><td style="padding:4px 8px;font-size:13px;font-weight:600;text-align:right">${value}</td></tr>`;
}

export function generatePayslipHtml(
  tenant: Tenant,
  employee: Employee,
  calc: PayslipCalc & { lateMarkDeductionAmount?: number },
  netFinal: number,
  month: number,
  year: number,
): string {
  const logo = tenant.logo_url
    ? `<img src="${tenant.logo_url}" style="height:48px;object-fit:contain" />`
    : "";
  const lateMarkDeduction = calc.lateMarkDeductionAmount && calc.lateMarkDeductionAmount > 0
    ? row("Late mark deduction", formatCurrency(calc.lateMarkDeductionAmount))
    : "";

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Payslip – ${MONTH_NAMES[month - 1]} ${year}</title>
<style>
  body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#1e293b;background:#fff}
  h1{font-size:22px;font-weight:700;margin:0}
  .header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #6d28d9;padding-bottom:12px;margin-bottom:16px}
  .section{margin-bottom:16px}
  .section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6d28d9;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:8px}
  table{width:100%;border-collapse:collapse}
  .net{background:#f3f0ff;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;margin-top:16px}
  .net-label{font-size:15px;font-weight:600}
  .net-value{font-size:22px;font-weight:700;color:#6d28d9}
  .footer{margin-top:24px;font-size:11px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;padding-top:12px}
  .emp-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;font-size:13px}
  .emp-grid span{color:#475569}
  .emp-grid strong{color:#0f172a}
  @media print{body{padding:0}}
</style></head><body>
<div class="header">
  <div>${logo}<div style="margin-top:4px"><p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6d28d9">${tenant.company_name}</p><h1>PAYSLIP</h1></div></div>
  <div style="text-align:right"><p style="margin:0;font-size:14px;font-weight:600">${MONTH_NAMES[month - 1]} ${year}</p><p style="margin:0;font-size:12px;color:#64748b">Pay Period</p></div>
</div>

<div class="section">
  <div class="section-title">Employee Details</div>
  <div class="emp-grid">
    <div><span>Name: </span><strong>${employee.full_name}</strong></div>
    <div><span>Code: </span><strong>${employee.employee_code ?? "—"}</strong></div>
    <div><span>Department: </span><strong style="text-transform:capitalize">${employee.department ?? "—"}</strong></div>
    <div><span>Designation: </span><strong>${employee.designation ?? "—"}</strong></div>
    <div><span>Days Present: </span><strong>${calc.daysPresent}</strong></div>
    <div><span>Days Absent: </span><strong>${calc.daysAbsent}</strong></div>
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
  <div class="section">
    <div class="section-title">Earnings</div>
    <table>${row("Basic", formatCurrency(calc.basicMonthly))}${row("HRA", formatCurrency(calc.hraMonthly))}${row("Special Allowance", formatCurrency(calc.specialAllowance))}${row("Other Allowances", formatCurrency(calc.otherAllowances))}
    <tr style="border-top:1px solid #e2e8f0"><td style="padding:6px 8px;font-weight:700;font-size:13px">Gross</td><td style="padding:6px 8px;font-weight:700;font-size:13px;text-align:right">${formatCurrency(calc.grossSalary)}</td></tr></table>
  </div>
  <div class="section">
    <div class="section-title">Deductions</div>
    <table>${row("PF (Employee)", formatCurrency(calc.pfEmployee))}${row("ESI (Employee)", formatCurrency(calc.esiEmployee))}${row("TDS", formatCurrency(calc.tds))}${lateMarkDeduction}${row("Other", formatCurrency(Math.max(calc.otherDeductions - (calc.lateMarkDeductionAmount ?? 0), 0)))}
    <tr style="border-top:1px solid #e2e8f0"><td style="padding:6px 8px;font-weight:700;font-size:13px">Total Deductions</td><td style="padding:6px 8px;font-weight:700;font-size:13px;text-align:right">${formatCurrency(calc.totalDeductions)}</td></tr></table>
  </div>
</div>

<div class="net"><span class="net-label">Net Payable</span><span class="net-value">${formatCurrency(netFinal)}</span></div>
<div class="footer">This is a computer-generated payslip. No signature required.</div>
</body></html>`;
}
