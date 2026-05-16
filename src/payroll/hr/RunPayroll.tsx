import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Loader2, Play, RefreshCw } from "lucide-react";
import { db, storage } from "../../insforge/client";
import { useTenant } from "../../contexts/TenantContext";
import { useEmployee } from "../../hooks/useEmployee";
import { useAuditLog } from "../../hooks/useAuditLog";
import { useToast } from "../../shared/ToastContext";
import { Skeleton } from "../../shared/Skeleton";
import type { Employee } from "../../types";
import type { SalaryStructure } from "./SalaryStructures";
import { MONTH_NAMES, formatCurrency, calcPayslip, getWorkingDays, type PayslipCalc } from "./payroll-calc";
import { generatePayslipHtml } from "./payslip-html";

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

      const [empRes, structRes, attRes, holRes] = await Promise.all([
        db.from("employees").select("*").eq("tenant_id", tenantId).eq("status", "active").order("full_name"),
        db.from("salary_structures").select("*").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
        db.from("attendance").select("employee_id,status").eq("tenant_id", tenantId).gte("date", startDate).lte("date", endDate),
        db.from("holidays").select("date").eq("tenant_id", tenantId).gte("date", startDate).lte("date", endDate),
      ]);

      if (empRes.error) throw empRes.error;
      const employees = (empRes.data ?? []) as Employee[];
      const allStructures = (structRes.data ?? []) as SalaryStructure[];
      const attendances = (attRes.data ?? []) as { employee_id: string; status: string }[];
      const holidayDates = ((holRes.data ?? []) as { date: string }[]).map((h) => h.date);

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

      const newRows: RowCalc[] = [];
      const newSkipped: Employee[] = [];

      employees.forEach((emp) => {
        const struct = structMap.get(emp.id);
        if (!struct) { newSkipped.push(emp); return; }
        const att = attMap.get(emp.id) ?? { daysPresent: workingDays, daysAbsent: 0, daysOnLeave: 0, halfDays: 0 };
        const calc = calcPayslip(struct, att, year, month, holidayDates);
        newRows.push({ ...calc, employee: emp, structure: struct });
      });

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
        const pdfUrl = await uploadPayslip(r, r.finalNet, month, year, tenantId, tenant);
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
                          </td>
                          <td className="px-4 py-3 text-center">{r.daysPresent}</td>
                          <td className="px-4 py-3 text-center text-red-500">{r.daysAbsent}</td>
                          <td className="px-4 py-3 text-center">{r.daysOnLeave}</td>
                          <td className="px-4 py-3 text-center">{r.halfDays}</td>
                          <td className="px-4 py-3 font-medium">{formatCurrency(r.grossSalary)}</td>
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
  finalNet: number,
  month: number,
  year: number,
  tenantId: string,
  tenant: import("../../contexts/TenantContext").Tenant | null,
): Promise<string | null> {
  if (!tenant) return null;
  try {
    const html = generatePayslipHtml(tenant, r.employee, r, finalNet, month, year);
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
