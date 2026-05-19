import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Loader2, Play, RefreshCw } from "lucide-react";
import { db, functions, storage } from "../../insforge/client";
import { useTenant } from "../../contexts/TenantContext";
import { useEmployee } from "../../hooks/useEmployee";
import { useAuditLog } from "../../hooks/useAuditLog";
import { useToast } from "../../shared/ToastContext";
import { Skeleton } from "../../shared/Skeleton";
import type { Employee } from "../../types";
import type { SalaryStructure } from "./SalaryStructures";
import { MONTH_NAMES, formatCurrency, calcPayslip, getWorkingDays, type PayslipCalc } from "./payroll-calc";

// ─── Types ────────────────────────────────────────────────────────────────────
type RunStatus = "draft" | "under_review" | "approved" | "paid";

interface PayrollRun {
  id: string;
  tenant_id: string;
  month: number;
  year: number;
  status: RunStatus;
  total_gross: number | null;
  total_deductions: number | null;
  total_net: number | null;
  employee_count: number | null;
}

interface RowCalc extends PayslipCalc {
  employee: Employee;
  structure: SalaryStructure;
  lateMarkCount?: number;
  lateMarkThreshold?: number;
  lateMarkDeductionHours?: number;
  lateMarkDeductionAmount?: number;
  overtimeHours?: number;
  overtimeAmount?: number;
  overtimeBreakdown?: { id: string; amount: number }[];
}

const now = new Date();
const CURRENT_YEAR = now.getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1];

// ─── Stepper ──────────────────────────────────────────────────────────────────
function Stepper({ step }: { step: number }) {
  const steps = ["Select Period", "Review & Calculate", "Confirm & Save"];
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((label, i) => {
        const active = i + 1 === step;
        const done = i + 1 < step;
        return (
          <div key={label} className="flex items-center gap-2">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all ${done ? "bg-emerald-500 text-white" : active ? "bg-purple-600 text-white" : "bg-slate-200 text-slate-500"}`}>
              {done ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`text-sm font-medium hidden sm:block ${active ? "text-slate-900" : "text-slate-400"}`}>{label}</span>
            {i < steps.length - 1 && <ChevronRight className="h-4 w-4 text-slate-300 mx-1" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────
function SummaryCard({ rows }: { rows: (RowCalc & { finalNet: number })[] }) {
  const totalGross = rows.reduce((s, r) => s + r.grossSalary, 0);
  const totalDed = rows.reduce((s, r) => s + r.totalDeductions, 0);
  const totalNet = rows.reduce((s, r) => s + r.finalNet, 0);
  const stats = [
    { label: "Employees", value: String(rows.length) },
    { label: "Total Gross", value: formatCurrency(totalGross) },
    { label: "Total Deductions", value: formatCurrency(totalDed) },
    { label: "Total Net", value: formatCurrency(totalNet) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-5">
      {stats.map(({ label, value }) => (
        <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
        </div>
      ))}
    </div>
  );
}

function buildGrossMonthly(structure: SalaryStructure) {
  const monthlyCtc = structure.ctc_annual / 12;
  const basicMonthly = monthlyCtc * (structure.basic_percent / 100);
  const hraMonthly = basicMonthly * (structure.hra_percent / 100);
  return basicMonthly + hraMonthly + structure.special_allowance + structure.other_allowances;
}

function payslipRow(label: string, value: string) {
  return `<tr><td style="padding:4px 8px;color:#475569;font-size:13px">${label}</td><td style="padding:4px 8px;font-size:13px;font-weight:600;text-align:right">${value}</td></tr>`;
}

function buildPayslipHtml(
  tenant: import("../../contexts/TenantContext").Tenant,
  employee: Employee,
  calc: RowCalc & { finalNet: number },
  month: number,
  year: number,
) {
  const logo = tenant.logo_url
    ? `<img src="${tenant.logo_url}" style="height:48px;object-fit:contain" />`
    : "";
  const overtimeLine = calc.overtimeAmount && calc.overtimeAmount > 0
    ? payslipRow("Overtime", formatCurrency(calc.overtimeAmount))
    : "";
  const lateMarkDeduction = calc.lateMarkDeductionAmount && calc.lateMarkDeductionAmount > 0
    ? payslipRow("Late mark deduction", formatCurrency(calc.lateMarkDeductionAmount))
    : "";

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Payslip - ${MONTH_NAMES[month - 1]} ${year}</title>
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
    <div><span>Code: </span><strong>${employee.employee_code ?? "-"}</strong></div>
    <div><span>Department: </span><strong style="text-transform:capitalize">${employee.department ?? "-"}</strong></div>
    <div><span>Designation: </span><strong>${employee.designation ?? "-"}</strong></div>
    <div><span>Days Present: </span><strong>${calc.daysPresent}</strong></div>
    <div><span>Days Absent: </span><strong>${calc.daysAbsent}</strong></div>
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
  <div class="section">
    <div class="section-title">Earnings</div>
    <table>${payslipRow("Basic", formatCurrency(calc.basicMonthly))}${payslipRow("HRA", formatCurrency(calc.hraMonthly))}${payslipRow("Special Allowance", formatCurrency(calc.specialAllowance))}${payslipRow("Other Allowances", formatCurrency(calc.otherAllowances))}${overtimeLine}
    <tr style="border-top:1px solid #e2e8f0"><td style="padding:6px 8px;font-weight:700;font-size:13px">Gross</td><td style="padding:6px 8px;font-weight:700;font-size:13px;text-align:right">${formatCurrency(calc.grossSalary)}</td></tr></table>
  </div>
  <div class="section">
    <div class="section-title">Deductions</div>
    <table>${payslipRow("PF (Employee)", formatCurrency(calc.pfEmployee))}${payslipRow("ESI (Employee)", formatCurrency(calc.esiEmployee))}${payslipRow("TDS", formatCurrency(calc.tds))}${lateMarkDeduction}${payslipRow("Other", formatCurrency(Math.max(calc.otherDeductions - (calc.lateMarkDeductionAmount ?? 0), 0)))}
    <tr style="border-top:1px solid #e2e8f0"><td style="padding:6px 8px;font-weight:700;font-size:13px">Total Deductions</td><td style="padding:6px 8px;font-weight:700;font-size:13px;text-align:right">${formatCurrency(calc.totalDeductions)}</td></tr></table>
  </div>
</div>

<div class="net"><span class="net-label">Net Payable</span><span class="net-value">${formatCurrency(calc.finalNet)}</span></div>
<div class="footer">This is a computer-generated payslip. No signature required.</div>
</body></html>`;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function RunPayroll() {
  const { tenantId, tenant } = useTenant();
  const { employee: hrEmployee } = useEmployee();
  const { logAction } = useAuditLog();
  const { success, error: toastError } = useToast();

  const [step, setStep] = useState(1);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [existingRun, setExistingRun] = useState<PayrollRun | null>(null);
  const [checkingRun, setCheckingRun] = useState(false);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RowCalc[]>([]);
  const [skipped, setSkipped] = useState<Employee[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);

  // ── Step 1: check existing run ─────────────────────────────────────────────
  const checkExistingRun = useCallback(async () => {
    setCheckingRun(true);
    setExistingRun(null);
    const { data } = await db.from("payroll_runs").select("*").eq("tenant_id", tenantId).eq("month", month).eq("year", year).maybeSingle();
    setExistingRun((data as PayrollRun | null) ?? null);
    setCheckingRun(false);
  }, [tenantId, month, year]);

  useEffect(() => { void checkExistingRun(); }, [checkExistingRun]);

  // ── Step 2: calculate ──────────────────────────────────────────────────────
  const calculate = useCallback(async () => {
    setLoading(true);
    try {
      const monthStr = `${year}-${String(month).padStart(2, "0")}`;
      const startDate = `${monthStr}-01`;
      const endDate = `${monthStr}-${new Date(year, month, 0).getDate().toString().padStart(2, "0")}`;

      const [empRes, structRes, attRes, holRes, overtimeRes] = await Promise.all([
        db.from("employees").select("*").eq("tenant_id", tenantId).eq("status", "active").order("full_name"),
        db.from("salary_structures").select("*").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
        db.from("attendance").select("employee_id,status").eq("tenant_id", tenantId).gte("date", startDate).lte("date", endDate),
        db.from("holidays").select("date").eq("tenant_id", tenantId).gte("date", startDate).lte("date", endDate),
        db
          .from("overtime_records")
          .select("id,employee_id,regular_hours,overtime_hours,overtime_rate,approved,date")
          .eq("tenant_id", tenantId)
          .eq("approved", true)
          .gte("date", startDate)
          .lte("date", endDate),
      ]);

      if (empRes.error) throw empRes.error;
      if (structRes.error) throw structRes.error;
      if (attRes.error) throw attRes.error;
      if (holRes.error) throw holRes.error;
      if (overtimeRes.error) throw overtimeRes.error;
      const employees = (empRes.data ?? []) as Employee[];
      const allStructures = (structRes.data ?? []) as SalaryStructure[];
      const attendances = (attRes.data ?? []) as { employee_id: string; status: string }[];
      const holidayDates = ((holRes.data ?? []) as { date: string }[]).map((h) => h.date);
      const overtimeRecords = (overtimeRes.data ?? []) as {
        id: string;
        employee_id: string;
        regular_hours: number;
        overtime_hours: number;
        overtime_rate: number;
        approved: boolean;
        date: string;
      }[];

      // Latest structure per employee (effective_from ≤ first day of month)
      const effectiveCutoff = startDate;
      const structMap = new Map<string, SalaryStructure>();
      allStructures.forEach((s) => {
        if (s.effective_from <= effectiveCutoff) {
          if (!structMap.has(s.employee_id)) structMap.set(s.employee_id, s);
        }
      });

      // Attendance counts per employee
      const attMap = new Map<string, { daysPresent: number; daysAbsent: number; daysOnLeave: number; halfDays: number }>();
      attendances.forEach(({ employee_id, status }) => {
        const cur = attMap.get(employee_id) ?? { daysPresent: 0, daysAbsent: 0, daysOnLeave: 0, halfDays: 0 };
        if (status === "present") cur.daysPresent++;
        else if (status === "absent") cur.daysAbsent++;
        else if (status === "on_leave") cur.daysOnLeave++;
        else if (status === "half_day") cur.halfDays++;
        attMap.set(employee_id, cur);
      });

      const workingDays = getWorkingDays(year, month, holidayDates);

      const overtimeByEmployee = new Map<string, { totalHours: number; totalAmount: number; breakdown: { id: string; amount: number }[] }>();
      overtimeRecords.forEach((record) => {
        const structure = structMap.get(record.employee_id);
        if (!structure || record.regular_hours <= 0 || workingDays <= 0) return;
        const grossMonthly = buildGrossMonthly(structure);
        const hourlyRate = grossMonthly / (record.regular_hours * workingDays);
        const overtimeAmount = record.overtime_hours * record.overtime_rate * hourlyRate;
        const current = overtimeByEmployee.get(record.employee_id) ?? { totalHours: 0, totalAmount: 0, breakdown: [] };
        current.totalHours += record.overtime_hours;
        current.totalAmount += overtimeAmount;
        current.breakdown.push({ id: record.id, amount: overtimeAmount });
        overtimeByEmployee.set(record.employee_id, current);
      });

      const newRows: RowCalc[] = [];
      const newSkipped: Employee[] = [];

      for (const emp of employees) {
        const struct = structMap.get(emp.id);
        if (!struct) { newSkipped.push(emp); continue; }
        const att = attMap.get(emp.id) ?? { daysPresent: workingDays, daysAbsent: 0, daysOnLeave: 0, halfDays: 0 };
        const calc = calcPayslip(struct, att, year, month, holidayDates);
        const { data: lateData, error: lateError } = await functions.invoke("calculate-late-marks", {
          body: {
            tenant_id: tenantId,
            employee_id: emp.id,
            month,
            year,
          },
        });
        if (lateError) throw lateError;
        const lateSummary = (lateData ?? {}) as {
          late_count?: number;
          threshold?: number;
          deduction_hours?: number;
        };
        const grossMonthly = buildGrossMonthly(struct);
        const hourlyRate = grossMonthly / (Number(tenant?.work_hours_per_day ?? 8) * workingDays);
        const lateDeductionAmount = (lateSummary.deduction_hours ?? 0) * hourlyRate;
        const overtimeSummary = overtimeByEmployee.get(emp.id);
        const overtimeAmount = overtimeSummary?.totalAmount ?? 0;
        const otherDeductions = calc.otherDeductions + lateDeductionAmount;
        const totalDeductions = calc.totalDeductions + lateDeductionAmount;
        const grossSalary = calc.grossSalary + overtimeAmount;
        const netPayable = Math.max(grossSalary - totalDeductions, 0);
        newRows.push({
          ...calc,
          employee: emp,
          structure: struct,
          grossSalary,
          otherDeductions,
          totalDeductions,
          netPayable,
          lateMarkCount: lateSummary.late_count ?? 0,
          lateMarkThreshold: lateSummary.threshold ?? 0,
          lateMarkDeductionHours: lateSummary.deduction_hours ?? 0,
          lateMarkDeductionAmount: lateDeductionAmount,
          overtimeHours: overtimeSummary?.totalHours ?? 0,
          overtimeAmount,
          overtimeBreakdown: overtimeSummary?.breakdown ?? [],
        });
      }

      setRows(newRows);
      setSkipped(newSkipped);
      setOverrides({});
    } catch {
      toastError("Failed to calculate payroll. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, month, year, toastError]);

  useEffect(() => {
    if (step === 2) void calculate();
  }, [step, calculate]);

  // ── Rows with final net ────────────────────────────────────────────────────
  const rowsWithFinal = useMemo(() =>
    rows.map((r) => ({
      ...r,
      finalNet: overrides[r.employeeId] !== undefined ? Number(overrides[r.employeeId]) || r.netPayable : r.netPayable,
    })), [rows, overrides]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async (approve: boolean) => {
    if (rowsWithFinal.length === 0) { toastError("No employees to process."); return; }
    setSaving(true);
    try {
      const status: RunStatus = approve ? "approved" : "draft";
      const totalGross = rowsWithFinal.reduce((s, r) => s + r.grossSalary, 0);
      const totalDed = rowsWithFinal.reduce((s, r) => s + r.totalDeductions, 0);
      const totalNet = rowsWithFinal.reduce((s, r) => s + r.finalNet, 0);

      // Upsert payroll_run
      let runId = existingRun?.id ?? null;
      if (runId) {
        const { error } = await db.from("payroll_runs").update({ status, total_gross: totalGross, total_deductions: totalDed, total_net: totalNet, employee_count: rowsWithFinal.length }).eq("id", runId);
        if (error) throw error;
      } else {
        const { data, error } = await db.from("payroll_runs").insert([{
          tenant_id: tenantId, month, year, status,
          total_gross: totalGross, total_deductions: totalDed, total_net: totalNet,
          employee_count: rowsWithFinal.length, run_by: hrEmployee?.id ?? null,
        }]).select("id").single();
        if (error) throw error;
        runId = (data as { id: string }).id;
      }

      // Generate and upload payslips
      for (const r of rowsWithFinal) {
        if (r.overtimeBreakdown && r.overtimeBreakdown.length > 0) {
          for (const overtimeRecord of r.overtimeBreakdown) {
            const { error: overtimeUpdateError } = await db
              .from("overtime_records")
              .update({ overtime_amount: Math.round(overtimeRecord.amount * 100) / 100 })
              .eq("tenant_id", tenantId)
              .eq("id", overtimeRecord.id);
            if (overtimeUpdateError) throw overtimeUpdateError;
          }
        }

        const pdfUrl = await uploadPayslip(r, month, year, tenantId, tenant);
        const payload = {
          tenant_id: tenantId,
          payroll_run_id: runId,
          employee_id: r.employeeId,
          month, year,
          days_in_month: r.daysInMonth,
          working_days: r.workingDays,
          days_present: r.daysPresent,
          days_absent: r.daysAbsent,
          days_on_leave: r.daysOnLeave,
          half_days: r.halfDays,
          basic_monthly: r.basicMonthly,
          hra_monthly: r.hraMonthly,
          special_allowance: r.specialAllowance,
          other_allowances: r.otherAllowances,
          gross_salary: r.grossSalary,
          pf_employee: r.pfEmployee,
          pf_employer: r.pfEmployer,
          esi_employee: r.esiEmployee,
          esi_employer: r.esiEmployer,
          tds: r.tds,
          other_deductions: r.otherDeductions,
          total_deductions: r.totalDeductions,
          net_payable: r.finalNet,
          pdf_url: pdfUrl,
        };
        const { error: slipErr } = await db.from("payslips").upsert([payload], { onConflict: "tenant_id,payroll_run_id,employee_id" });
        if (slipErr) console.error("Payslip upsert error:", slipErr);
      }

      success(approve ? "Payroll approved and payslips saved!" : "Payroll saved as draft.");
      if (approve) {
        void logAction("payroll.approved", "payroll_run", runId, { month, year, total_net: totalNet });
      }
      setStep(1);
      setExistingRun(null);
      void checkExistingRun();
    } catch (err) {
      toastError("Failed to save payroll. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [rowsWithFinal, existingRun, tenantId, month, year, hrEmployee, tenant, success, toastError, checkExistingRun]);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Run Payroll</h2>
        <p className="text-sm text-slate-500">Process monthly payroll for all active employees.</p>
      </div>

      <Stepper step={step} />

      {/* ── Step 1 ── */}
      {step === 1 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm max-w-lg">
          <h3 className="text-base font-semibold text-slate-900 mb-4">Select Pay Period</h3>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Month</span>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-purple-500 focus:ring">
                {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Year</span>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-purple-500 focus:ring">
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </div>

          {checkingRun ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Checking...</div>
          ) : existingRun ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-800">Payroll already run for {MONTH_NAMES[month - 1]} {year}</p>
              <p className="text-xs text-amber-700 mt-1">Status: <span className="font-bold capitalize">{existingRun.status.replace("_", " ")}</span></p>
              <button onClick={() => setStep(2)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition">
                <RefreshCw className="h-4 w-4" /> Continue editing
              </button>
            </div>
          ) : (
            <button onClick={() => setStep(2)} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition">
              <Play className="h-4 w-4" /> Start Payroll Run
            </button>
          )}
        </div>
      )}

      {/* ── Step 2 ── */}
      {step === 2 && (
        <div className="space-y-4">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : (
            <>
              <SummaryCard rows={rowsWithFinal} />

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900">Payroll Calculation — {MONTH_NAMES[month-1]} {year}</h3>
                  <span className="text-xs text-slate-500">{rows.length} employees</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[900px] w-full text-sm divide-y divide-slate-100">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                      <tr>
                        {["Employee","Present","Absent","Leave","Half","Gross","Deductions","Net Payable"].map(h => (
                          <th key={h} className="px-4 py-3 text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rowsWithFinal.map((r) => (
                        <tr key={r.employeeId} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{r.employee.full_name}</p>
                            <p className="text-xs text-slate-500 capitalize">{r.employee.department}</p>
                            {r.overtimeAmount && r.overtimeAmount > 0 ? (
                              <p className="text-xs font-medium text-purple-700">Overtime: {formatCurrency(r.overtimeAmount)}</p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-center">{r.daysPresent}</td>
                          <td className="px-4 py-3 text-center text-red-500">{r.daysAbsent}</td>
                          <td className="px-4 py-3 text-center">{r.daysOnLeave}</td>
                          <td className="px-4 py-3 text-center">{r.halfDays}</td>
                          <td className="px-4 py-3 font-medium">
                            <p>{formatCurrency(r.grossSalary)}</p>
                            {r.overtimeAmount && r.overtimeAmount > 0 ? (
                              <p className="text-xs font-medium text-purple-700">Includes OT</p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-red-600">−{formatCurrency(r.totalDeductions)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-slate-400">₹</span>
                              <input
                                type="number"
                                value={overrides[r.employeeId] ?? r.netPayable.toFixed(0)}
                                onChange={(e) => setOverrides((prev) => ({ ...prev, [r.employeeId]: e.target.value }))}
                                className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm font-semibold text-emerald-700 outline-none focus:ring-1 ring-purple-400"
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {skipped.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    <p className="text-sm font-semibold text-amber-800">Skipped — No Salary Structure</p>
                  </div>
                  <p className="text-xs text-amber-700 mb-2">Set up their structure in Salary Management before including them.</p>
                  <div className="flex flex-wrap gap-2">
                    {skipped.map(e => <span key={e.id} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">{e.full_name}</span>)}
                  </div>
                </div>
              )}

              <div className="flex justify-between">
                <button onClick={() => setStep(1)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition">← Back</button>
                <button onClick={() => setStep(3)} disabled={rows.length === 0} className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition">
                  Review & Confirm →
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Step 3 ── */}
      {step === 3 && (
        <div className="space-y-4 max-w-2xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900 mb-4">Payroll Summary — {MONTH_NAMES[month-1]} {year}</h3>
            <SummaryCard rows={rowsWithFinal} />
            <p className="text-sm text-slate-600 mt-2">
              {rowsWithFinal.length} employee payslips will be generated.
              {skipped.length > 0 && <span className="text-amber-700"> {skipped.length} employee(s) skipped (no salary structure).</span>}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => setStep(2)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition">← Edit</button>
            <button onClick={() => handleSave(false)} disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save as Draft
            </button>
            <button onClick={() => handleSave(true)} disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? "Processing..." : "Approve Payroll"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Upload helper ─────────────────────────────────────────────────────────────
async function uploadPayslip(
  r: RowCalc & { finalNet: number },
  month: number,
  year: number,
  tenantId: string,
  tenant: import("../../contexts/TenantContext").Tenant | null,
): Promise<string | null> {
  if (!tenant) return null;
  try {
    const html = buildPayslipHtml(tenant, r.employee, r, month, year);
    const blob = new Blob([html], { type: "text/html" });
    const path = `${tenantId}/${year}/${month}/${r.employeeId}.html`;
    const { data, error } = await storage.from("payslips").upload(path, blob);
    if (error) { console.error("Upload error:", error); return null; }
    return (data as { url?: string } | null)?.url ?? null;
  } catch (e) {
    console.error("Payslip upload failed:", e);
    return null;
  }
}
