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
import { MONTH_NAMES, formatCurrency, roundCurrency, calcPayslip, getWorkingDays, getEsiContributionPeriod, type PayslipCalc, type SalaryPolicySnapshot } from "./payroll-calc";
import { PayrollError } from "../../utils/errors";
import { uploadPayslipPdf } from "./payslip-pdf";
import { useDepartmentLabel, useJobTitleLabel } from "../../contexts/OrgUnitsContext";

const LATE_MARK_BATCH_SIZE = 20;

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
  overtimeBreakdown?: { id: string; amount: number }[];
  hasMidMonthRevision?: boolean;
  expensesReimbursement?: number;
  expenseItems?: any[];
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
  const totalGross = rows.reduce((s, r) => s + r.grossSalary + r.overtimeAmount, 0);
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

// Main Component
export default function RunPayroll() {
  const deptLabel = useDepartmentLabel();
  const titleLabel = useJobTitleLabel();
  const { tenantId, tenant, hasModule } = useTenant();
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
  const [noAttendance, setNoAttendance] = useState<Employee[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [midMonthEmployees, setMidMonthEmployees] = useState<string[]>([]);
  const [overrideChecked, setOverrideChecked] = useState(false);

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

  // Reset overrides when changing period to prevent leak across months
  useEffect(() => {
    setOverrides({});
  }, [month, year]);

  // ── Step 2: calculate ──────────────────────────────────────────────────────
  const calculate = useCallback(async () => {
    setLoading(true);
    try {
      const monthStr = `${year}-${String(month).padStart(2, "0")}`;
      // PREFLIGHT — payroll's two inputs are attendance and the holiday calendar, and NEITHER
      // can be inferred from its own absence. A disabled module's tables return
      // `{data: [], error: null}` through RLS, so the error checks below never fire: the run
      // would compute from an empty set and persist the result as real payslips.
      //
      // Two concrete money bugs this prevents, both silent:
      //   attendance OFF -> every employee falls to the `daysAbsent: workingDays` default
      //                     below, full LOP, net pay floors at zero.
      //   leave OFF      -> holidays resolve empty, getWorkingDays counts them as working
      //                     days, and payroll-calc.ts:266 charges every one of them as an
      //                     `unaccountedDays` deduction.
      //
      // Blocking is the correct behaviour, not a limitation: "no data" and "zero days
      // present" must never be the same value. When CSV import lands, an imported period
      // summary satisfies this check in place of the module.
      // Leave is NO LONGER required here. The holiday calendar moved to the core
      // work_calendar module in 20260821180000, so `attendance + payroll` without Leave is a
      // supported combination and no longer produces holiday deductions. Attendance remains
      // required: nothing else can say how many days a person actually worked.
      if (!hasModule("attendance")) {
        throw new Error(
          `Payroll cannot be calculated: Attendance is not enabled for this company. ` +
          `Payroll reads attendance to work out payable days, and cannot assume them. ` +
          `Enable the module, or import the period's attendance summary.`
        );
      }

      const startDate = `${monthStr}-01`;
      const endDate = `${monthStr}-${new Date(year, month, 0).getDate().toString().padStart(2, "0")}`;

      const [empRes, structRes, attRes, holRes, overtimeRes, settingsRes, leavesRes, existingPayslipsRes, approvedExpensesRes, esiHistoryRes] = await Promise.all([
        db.from("employees").select("*").eq("tenant_id", tenantId).eq("status", "active").order("full_name"),
        db.from("salary_structures").select("*").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
        db.from("attendance").select("employee_id,status,date").eq("tenant_id", tenantId).gte("date", startDate).lte("date", endDate),
        db.from("holidays").select("date").eq("tenant_id", tenantId).gte("date", startDate).lte("date", endDate),
        db
          .from("overtime_records")
          .select("id,employee_id,regular_hours,overtime_hours,overtime_rate,approved,date")
          .eq("tenant_id", tenantId)
          .eq("approved", true)
          .gte("date", startDate)
          .lte("date", endDate),
        db.from("tenant_settings").select("key,value").eq("tenant_id", tenantId),
        db.from("leaves").select("employee_id,start_date,end_date,leave_types!inner(is_paid)").eq("tenant_id", tenantId).eq("status", "approved").lte("start_date", endDate).gte("end_date", startDate),
        existingRun
          ? db.from("payslips").select("employee_id,net_payable,policy_snapshot").eq("tenant_id", tenantId).eq("payroll_run_id", existingRun.id)
          : Promise.resolve({ data: [], error: null }),
        db.from("expenses").select("*").eq("tenant_id", tenantId).eq("status", "approved").is("payroll_run_id", null),
        // Earlier payslips in this ESI contribution period, to detect existing coverage.
        db
          .from("payslips")
          .select("employee_id,esi_employee,month,year")
          .eq("tenant_id", tenantId)
          .gt("esi_employee", 0),
      ]);

      if (empRes.error) throw empRes.error;
      if (structRes.error) throw structRes.error;
      if (attRes.error) throw attRes.error;
      if (holRes.error) throw holRes.error;
      if (overtimeRes.error) throw overtimeRes.error;
      if (settingsRes.error) throw settingsRes.error;
      if (leavesRes.error) throw leavesRes.error;
      if (existingPayslipsRes.error) throw existingPayslipsRes.error;
      if (approvedExpensesRes.error) throw approvedExpensesRes.error;
      if (esiHistoryRes.error) throw esiHistoryRes.error;

      // Employees already covered by ESI earlier in the current contribution period keep their
      // coverage for the rest of it, even if their wages have since crossed the ceiling.
      const esiPeriod = getEsiContributionPeriod(year, month);
      const periodStartOrdinal = esiPeriod.startYear * 12 + esiPeriod.startMonth;
      const currentOrdinal = year * 12 + month;
      const esiCoveredInPeriod = new Set<string>();
      ((esiHistoryRes.data ?? []) as { employee_id: string; month: number; year: number }[]).forEach((slip) => {
        const ordinal = slip.year * 12 + slip.month;
        if (ordinal >= periodStartOrdinal && ordinal < currentOrdinal) {
          esiCoveredInPeriod.add(slip.employee_id);
        }
      });
      const employees = (empRes.data ?? []) as Employee[];
      const allStructures = (structRes.data ?? []) as SalaryStructure[];
      const attendances = (attRes.data ?? []) as { employee_id: string; status: string; date: string }[];
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
      const approvedExpenses = (approvedExpensesRes.data ?? []) as any[];
      const expensesMap = new Map<string, { total: number; items: any[] }>();
      approvedExpenses.forEach((exp) => {
        const cur = expensesMap.get(exp.employee_id) ?? { total: 0, items: [] };
        cur.total += exp.amount;
        cur.items.push(exp);
        expensesMap.set(exp.employee_id, cur);
      });
      const settingsRows = (settingsRes.data ?? []) as { key: string; value: string }[];
      const settings = settingsRows.reduce<Record<string, string>>((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {});

      const lockDateStr = settings.payroll_lock_date;
      if (lockDateStr) {
        const lockDate = new Date(lockDateStr);
        const currentPeriodDate = new Date(year, month - 1, 1);
        if (currentPeriodDate <= lockDate) {
          throw new PayrollError("PAYROLL_LOCKED", `Payroll is locked for periods on or before ${lockDateStr}`);
        }
      }

      const policy: SalaryPolicySnapshot = {
        snapshot_version: 3,
        lopCalculationMethod: (settings.lop_calculation_method as any) || "working_days",
        pfWageCeiling: settings.pf_wage_ceiling ? Number(settings.pf_wage_ceiling) : 15000,
        esiGrossCeiling: settings.esi_gross_ceiling ? Number(settings.esi_gross_ceiling) : 21000,
        professionalTaxState: settings.professional_tax_state || "",
        professionalTaxManualAmount: settings.professional_tax_manual_amount ? Number(settings.professional_tax_manual_amount) : null,
        professionalTaxSlabsApplied: true,
        esiContributionPeriodLockIn: true,
      };

      // Latest structure per employee (effective_from ≤ last day of month)
      const effectiveCutoff = endDate;
      const structMap = new Map<string, SalaryStructure>();
      allStructures.forEach((s) => {
        if (s.effective_from <= effectiveCutoff) {
          if (!structMap.has(s.employee_id)) structMap.set(s.employee_id, s);
        }
      });

      // Generate all calendar date strings for this month in YYYY-MM-DD format
      const daysInMonth = new Date(year, month, 0).getDate();
      const monthDates: string[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        monthDates.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
      }

      // Unpaid leaves mapping using timezone-safe string comparison
      const approvedLeaves = (leavesRes.data ?? []) as any[];
      const unpaidLeaveMap = new Map<string, Set<string>>(); // employee_id -> set of unpaid date strings
      
      approvedLeaves.forEach(leave => {
        if (leave.leave_types && leave.leave_types.is_paid === false) {
          const leaveStart = leave.start_date.substring(0, 10);
          const leaveEnd = leave.end_date.substring(0, 10);
          
          const current = unpaidLeaveMap.get(leave.employee_id) || new Set<string>();
          monthDates.forEach(dt => {
            if (dt >= leaveStart && dt <= leaveEnd) {
              current.add(dt);
            }
          });
          unpaidLeaveMap.set(leave.employee_id, current);
        }
      });

      // Attendance counts per employee
      const attMap = new Map<string, { daysPresent: number; daysAbsent: number; paidLeaveDays: number; unpaidLeaveDays: number; halfDays: number }>();
      attendances.forEach(({ employee_id, status, date }) => {
        const cur = attMap.get(employee_id) ?? { daysPresent: 0, daysAbsent: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, halfDays: 0 };
        if (status === "present") cur.daysPresent++;
        else if (status === "absent") cur.daysAbsent++;
        else if (status === "half_day") cur.halfDays++;
        else if (status === "on_leave") {
          const isUnpaid = unpaidLeaveMap.get(employee_id)?.has(date);
          if (isUnpaid) cur.unpaidLeaveDays++;
          else cur.paidLeaveDays++;
        }
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

      // Asynchronously fetch late marks in parallel chunks with failure isolation
      const lateSummaryMap = new Map<string, { late_count?: number; threshold?: number; deduction_hours?: number }>();
      const eligibleEmployees = employees.filter(emp => structMap.has(emp.id));
      
      for (let i = 0; i < eligibleEmployees.length; i += LATE_MARK_BATCH_SIZE) {
        const chunk = eligibleEmployees.slice(i, i + LATE_MARK_BATCH_SIZE);
        const results = await Promise.all(
          chunk.map(async (emp) => {
            try {
              const { data, error } = await functions.invoke("calculate-late-marks", {
                body: {
                  tenant_id: tenantId,
                  employee_id: emp.id,
                  month,
                  year,
                },
              });
              if (error) throw error;
              return { employeeId: emp.id, data };
            } catch (err) {
              console.error(`Failed to calculate late marks for employee ${emp.id}:`, err);
              return { employeeId: emp.id, data: null };
            }
          })
        );
        results.forEach(res => {
          if (res.data) {
            lateSummaryMap.set(res.employeeId, res.data);
          } else {
            lateSummaryMap.set(res.employeeId, {});
          }
        });
      }

      const newRows: RowCalc[] = [];
      const newSkipped: Employee[] = [];
      const newNoAttendance: Employee[] = [];
      const midMonthRevisions: string[] = [];

      for (const emp of employees) {
        const struct = structMap.get(emp.id);
        if (!struct) { newSkipped.push(emp); continue; }
        
        const overtimeSummary = overtimeByEmployee.get(emp.id);
        const overtimeAmount = overtimeSummary?.totalAmount ?? 0;
        
        // An employee with NO attendance rows at all has unknown attendance, not zero
        // attendance. The previous default here was `daysAbsent: workingDays` — chosen to
        // avoid defaulting to full pay, but it swapped overpaying for paying nothing, and
        // persisted that as a real payslip. Neither guess is safe, so they are set aside for
        // HR to resolve, exactly like an employee with no salary structure.
        const att = attMap.get(emp.id);
        if (!att) { newNoAttendance.push(emp); continue; }
        const calc = calcPayslip(struct, att, overtimeAmount, year, month, holidayDates, policy, {
          esiCoveredEarlierInPeriod: esiCoveredInPeriod.has(emp.id),
        });
        
        const lateSummary = lateSummaryMap.get(emp.id) ?? {};
        const workHoursPerDay = Number(tenant?.work_hours_per_day ?? 8);
        if (workHoursPerDay <= 0) {
          throw new Error("Invalid tenant payroll configuration: work hours per day must be greater than zero");
        }
        const hourlyRate = calc.grossSalary / (workHoursPerDay * workingDays);
        const lateDeductionAmount = roundCurrency((lateSummary.deduction_hours ?? 0) * hourlyRate);
        const otherDeductions = roundCurrency(calc.otherDeductions + lateDeductionAmount);
        const totalDeductions = roundCurrency(calc.totalDeductions + lateDeductionAmount);
        const expData = expensesMap.get(emp.id) ?? { total: 0, items: [] };
        const totalExpenses = expData.total;
        const netPayable = Math.max(roundCurrency(calc.grossSalary - totalDeductions), 0) + totalExpenses;

        // Check for mid-month revisions
        const empStructures = allStructures.filter((s) => s.employee_id === emp.id);
        const hasRevision = empStructures.some((s) => {
          const startsMidMonth = s.effective_from > startDate && s.effective_from <= endDate;
          if (!startsMidMonth) return false;
          // Check if there is another structure that was effective prior to this mid-month one
          return empStructures.some((other) => other.effective_from < s.effective_from);
        });

        if (hasRevision) {
          midMonthRevisions.push(emp.full_name);
        }

        newRows.push({
          ...calc,
          employee: emp,
          structure: struct,
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
          hasMidMonthRevision: hasRevision,
          expensesReimbursement: totalExpenses,
          expenseItems: expData.items,
        });
      }

      setRows(newRows);
      setSkipped(newSkipped);
      setNoAttendance(newNoAttendance);
      setMidMonthEmployees(midMonthRevisions);
      setOverrideChecked(false);

      // Hydrate overrides if resuming a draft run without erasing current in-session changes
      setOverrides((currentOverrides) => {
        const merged: Record<string, string> = { ...currentOverrides };
        if (existingRun && existingPayslipsRes.data) {
          existingPayslipsRes.data.forEach((slip: any) => {
            const snapshot = slip.policy_snapshot as any;
            if (snapshot && snapshot.override_net !== undefined && snapshot.override_net !== null) {
              if (merged[slip.employee_id] === undefined) {
                merged[slip.employee_id] = String(slip.net_payable);
              }
            }
          });
        }
        return merged;
      });
    } catch (err: any) {
      if (err instanceof PayrollError && err.code === "PAYROLL_LOCKED") {
        toastError(err.message);
        void logAction("payroll.lock_violation", "tenant", tenantId, { month, year, message: err.message });
      } else {
        toastError("Failed to calculate payroll. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [tenantId, month, year, toastError]);

  useEffect(() => {
    if (step === 2) void calculate();
  }, [step, calculate]);

  const rowsWithFinal = useMemo(() =>
    rows.map((r) => {
      const calculatedNet = Math.max(roundCurrency(r.netPayable + r.overtimeAmount), 0);
      const overrideRaw = overrides[r.employeeId];
      const finalNet = overrideRaw !== undefined
        ? Math.max(roundCurrency(Number(overrideRaw) || 0), 0)
        : calculatedNet;
      return { ...r, calculatedNet, finalNet };
    }), [rows, overrides]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async (approve: boolean) => {
    if (rowsWithFinal.length === 0) { toastError("No employees to process."); return; }
    setSaving(true);
    try {
      const status: RunStatus = approve ? "approved" : "draft";
      const totalGross = roundCurrency(rowsWithFinal.reduce((s, r) => s + r.grossSalary + r.overtimeAmount, 0));
      const totalDed = roundCurrency(rowsWithFinal.reduce((s, r) => s + r.totalDeductions, 0));
      const totalNet = roundCurrency(rowsWithFinal.reduce((s, r) => s + r.finalNet, 0));

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

        const pdfUrl = tenant ? await uploadPayslipPdf(storage, tenant, { ...r.employee, department: deptLabel(r.employee, "") || null, designation: titleLabel(r.employee, "") || null }, r, tenantId, month, year) : null;
        const payload = {
          tenant_id: tenantId,
          payroll_run_id: runId,
          employee_id: r.employeeId,
          month, year,
          days_in_month: r.daysInMonth,
          working_days: r.workingDays,
          days_present: r.daysPresent,
          days_absent: r.daysAbsent,
          days_on_leave: r.paidLeaveDays + r.unpaidLeaveDays,
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
          expenses_reimbursement: r.expensesReimbursement || 0,
          policy_snapshot: {
            ...r.policySnapshot,
            paid_leave_days: r.paidLeaveDays,
            unpaid_leave_days: r.unpaidLeaveDays,
            effective_unpaid_days: r.effectiveUnpaidDays,
            working_days: r.workingDays,
            paid_days: r.paidDays,
            lop_ratio: r.lopRatio,
            lop_divisor: r.lopDivisor,
            overtime_amount: r.overtimeAmount,
            esi_base: r.esiBase,
            pf_base: r.pfBase,
            calculated_net: r.calculatedNet,
            override_net: overrides[r.employeeId] !== undefined ? r.finalNet : null,
            expense_items: r.expenseItems || [],
          },
        };
        const { error: slipErr } = await db.from("payslips").upsert([payload], { onConflict: "tenant_id,payroll_run_id,employee_id" });
        if (slipErr) throw slipErr;
      }

      if (approve) {
        // Collect all expense IDs included in this payroll run
        const allExpenseIds: string[] = [];
        rowsWithFinal.forEach((r) => {
          if (r.expenseItems) {
            r.expenseItems.forEach((exp: any) => {
              allExpenseIds.push(exp.id);
            });
          }
        });

        if (allExpenseIds.length > 0) {
          const { error: expUpdateErr } = await db
            .from("expenses")
            .update({
              status: "reimbursed",
              payroll_run_id: runId,
              reimbursed_at: new Date().toISOString(),
            })
            .in("id", allExpenseIds);
          if (expUpdateErr) throw expUpdateErr;
        }
      }

      success(approve ? "Payroll approved and payslips saved!" : "Payroll saved as draft.");
      
      const policyHash = rowsWithFinal.length > 0 ? JSON.stringify(rowsWithFinal[0].policySnapshot) : "";
      const actionType = approve
        ? (runId && existingRun ? "payroll.regenerated" : "payroll.generated")
        : "payroll.draft_saved";
        
      void logAction(actionType, "payroll_run", runId, { 
        month, 
        year, 
        total_net: totalNet, 
        employee_count: rowsWithFinal.length, 
        policy_hash: policyHash,
        mid_month_overridden: overrideChecked
      });

      // Log mid-month salary overrides for audit traceability
      for (const r of rowsWithFinal) {
        if (r.hasMidMonthRevision) {
          void logAction("payroll.mid_month_salary_override", "employee", r.employeeId, {
            employee_name: r.employee.full_name,
            month,
            year,
            effective_from: r.structure.effective_from,
            ctc_annual: r.structure.ctc_annual,
          });
        }
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
                  <table className="w-full min-w-full md:min-w-[900px] text-sm divide-y divide-slate-100 block md:table">
                    <thead className="hidden md:table-header-group bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                      <tr>
                        {["Employee","Present","Absent","Leave","Half","Gross","Deductions","Net Payable"].map(h => (
                          <th key={h} className="px-4 py-3 text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 block md:table-row-group">
                      {rowsWithFinal.map((r) => (
                        <tr key={r.employeeId} className="hover:bg-slate-50/70 block md:table-row border-b border-slate-100 p-4 md:p-0 md:border-none relative">
                          <td className="px-0 py-1.5 md:px-4 md:py-3 md:table-cell flex items-start justify-between md:justify-start">
                            <span className="md:hidden text-xs font-semibold text-slate-500 mt-0.5">Employee</span>
                            <div className="text-right md:text-left">
                              <p className="font-medium text-slate-900">{r.employee.full_name}</p>
                              <p className="text-xs text-slate-500 capitalize">{deptLabel(r.employee, "")}</p>
                              {r.overtimeAmount && r.overtimeAmount > 0 ? (
                                <p className="text-xs font-medium text-purple-700">Overtime: {formatCurrency(r.overtimeAmount)}</p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-0 py-1.5 md:px-4 md:py-3 text-right md:text-center md:table-cell flex items-center justify-between md:justify-center">
                            <span className="md:hidden text-xs font-semibold text-slate-500">Present</span>
                            <span>{r.daysPresent}</span>
                          </td>
                          <td className="px-0 py-1.5 md:px-4 md:py-3 text-right md:text-center text-red-500 md:table-cell flex items-center justify-between md:justify-center">
                            <span className="md:hidden text-xs font-semibold text-slate-500">Absent</span>
                            <span>{r.daysAbsent}</span>
                          </td>
                          <td className="px-0 py-1.5 md:px-4 md:py-3 text-right md:text-center md:table-cell flex items-center justify-between md:justify-center">
                            <span className="md:hidden text-xs font-semibold text-slate-500">Leave</span>
                            <span>{r.paidLeaveDays + r.unpaidLeaveDays}</span>
                          </td>
                          <td className="px-0 py-1.5 md:px-4 md:py-3 text-right md:text-center md:table-cell flex items-center justify-between md:justify-center">
                            <span className="md:hidden text-xs font-semibold text-slate-500">Half</span>
                            <span>{r.halfDays}</span>
                          </td>
                          <td className="px-0 py-1.5 md:px-4 md:py-3 font-medium md:table-cell flex items-center justify-between md:justify-start text-right md:text-left">
                            <span className="md:hidden text-xs font-semibold text-slate-500">Gross</span>
                            <div>
                              <p>{formatCurrency(r.grossSalary + r.overtimeAmount)}</p>
                              {r.overtimeAmount > 0 ? (
                                <p className="text-xs font-medium text-purple-700">Incl. OT: {formatCurrency(r.overtimeAmount)}</p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-0 py-1.5 md:px-4 md:py-3 text-red-600 md:table-cell flex items-center justify-between md:justify-start text-right md:text-left">
                            <span className="md:hidden text-xs font-semibold text-slate-500">Deductions</span>
                            <span>−{formatCurrency(r.totalDeductions)}</span>
                          </td>
                          <td className="px-0 py-2 md:px-4 md:py-3 md:table-cell flex items-center justify-between md:justify-start mt-2 md:mt-0 pt-3 md:pt-0 border-t border-slate-100 md:border-none">
                            <span className="md:hidden text-xs font-semibold text-slate-500">Net Payable</span>
                            <div className="flex items-center gap-1 justify-end">
                              <span className="text-xs text-slate-400">₹</span>
                              <input
                                type="number"
                                value={overrides[r.employeeId] ?? r.finalNet.toFixed(0)}
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

              {midMonthEmployees.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    <p className="text-sm font-semibold text-amber-800">Warning — Mid-Month Salary Revision Detected</p>
                  </div>
                  <p className="text-xs text-amber-700 mb-2">
                    The following employees have a salary structure revision mid-month. Since split-period calculations are not supported, the newest structure will apply to the entire month:
                  </p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {midMonthEmployees.map(name => <span key={name} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">{name}</span>)}
                  </div>
                  <label className="flex items-center gap-2 text-xs font-semibold text-amber-800 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={overrideChecked} 
                      onChange={(e) => setOverrideChecked(e.target.checked)} 
                      className="rounded border-amber-300 text-amber-600 focus:ring-amber-500" 
                    />
                    I understand and want to proceed anyway. (This will be logged for auditing).
                  </label>
                </div>
              )}

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

              {noAttendance.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    <p className="text-sm font-semibold text-amber-800">Skipped — No Attendance Data</p>
                  </div>
                  <p className="text-xs text-amber-700 mb-2">
                    These employees have no attendance records for this period, so their payable days cannot be
                    worked out. Add or correct their attendance, then recalculate — they are left out rather than
                    guessed at.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {noAttendance.map(e => <span key={e.id} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">{e.full_name}</span>)}
                  </div>
                </div>
              )}

              <div className="flex justify-between">
                <button onClick={() => setStep(1)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition">← Back</button>
                <button 
                  onClick={() => setStep(3)} 
                  disabled={rows.length === 0 || (midMonthEmployees.length > 0 && !overrideChecked)} 
                  className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition"
                >
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
              {noAttendance.length > 0 && <span className="text-amber-700"> {noAttendance.length} employee(s) skipped (no attendance data).</span>}
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

