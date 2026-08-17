import type { SalaryStructure } from "./SalaryStructures";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface SalaryPolicySnapshot {
  snapshot_version: 3;
  lopCalculationMethod: "calendar" | "fixed_26" | "working_days";
  pfWageCeiling: number;
  esiGrossCeiling: number;
  professionalTaxState: string;
  professionalTaxManualAmount: number | null;
  /** v3: PT resolved from state slabs rather than a flat per-state amount. */
  professionalTaxSlabsApplied: boolean;
  /** v3: ESI coverage held for the full contribution period once it begins. */
  esiContributionPeriodLockIn: boolean;
}

export function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(n));
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Professional Tax is slab-based on gross, not a flat per-state amount.
 *
 * ⚠️ These are seeded defaults and MUST be signed off by finance/CA before a live payroll run.
 * PT is state legislation and changes; the long-term home for this is the `salary_slabs` /
 * `salary_slab_rows` tables in the salary-component design, where each tenant can maintain
 * its own effective-dated rates. Until then, a tenant can override the resolved amount with
 * `professional_tax_manual_amount` in tenant_settings.
 *
 * `upTo` is inclusive; `null` means the open-ended top slab.
 */
interface PtSlab {
  upTo: number | null;
  amount: number;
}

interface PtStateRule {
  /** monthly = charged every month; half_yearly = charged once per half-year (Tamil Nadu). */
  basis: "monthly" | "half_yearly";
  slabs: PtSlab[];
  /** Maharashtra tops up February to reach the ₹2,500 annual cap. */
  februaryAmount?: number;
  /** For half_yearly states: the months in which the half-yearly amount is deducted. */
  chargeMonths?: number[];
}

const PROFESSIONAL_TAX_RULES: Record<string, PtStateRule> = {
  // Exemption raised to ₹25,000/month by the 2025 amendment. Some published tables still show an
  // intermediate ₹150 band for 15,001–25,000; that band predates the amendment. Verify before go-live.
  karnataka: {
    basis: "monthly",
    slabs: [
      { upTo: 25000, amount: 0 },
      { upTo: null, amount: 200 },
    ],
  },
  maharashtra: {
    basis: "monthly",
    slabs: [
      { upTo: 7500, amount: 0 },
      { upTo: 10000, amount: 175 },
      { upTo: null, amount: 200 },
    ],
    februaryAmount: 300,
  },
  gujarat: {
    basis: "monthly",
    slabs: [
      { upTo: 5999, amount: 0 },
      { upTo: 8999, amount: 80 },
      { upTo: 11999, amount: 150 },
      { upTo: null, amount: 200 },
    ],
  },
  telangana: {
    basis: "monthly",
    slabs: [
      { upTo: 15000, amount: 0 },
      { upTo: 20000, amount: 150 },
      { upTo: null, amount: 200 },
    ],
  },
  andhra_pradesh: {
    basis: "monthly",
    slabs: [
      { upTo: 15000, amount: 0 },
      { upTo: 20000, amount: 150 },
      { upTo: null, amount: 200 },
    ],
  },
  // Tamil Nadu assesses on half-yearly income and is collected in September and March.
  tamil_nadu: {
    basis: "half_yearly",
    chargeMonths: [9, 3],
    slabs: [
      { upTo: 21000, amount: 0 },
      { upTo: 30000, amount: 135 },
      { upTo: 45000, amount: 315 },
      { upTo: 60000, amount: 690 },
      { upTo: 75000, amount: 1025 },
      { upTo: null, amount: 1250 },
    ],
  },
};

function amountForSlab(slabs: PtSlab[], base: number): number {
  for (const slab of slabs) {
    if (slab.upTo === null || base <= slab.upTo) return slab.amount;
  }
  return 0;
}

/**
 * Resolve the Professional Tax deduction for one month.
 * A tenant-configured manual amount always wins, preserving the previous override behaviour.
 */
export function resolveProfessionalTax(
  state: string,
  monthlyGross: number,
  month: number,
  manualAmount: number | null | undefined
): number {
  if (manualAmount !== null && manualAmount !== undefined) return manualAmount;
  if (!state) return 0;

  const rule = PROFESSIONAL_TAX_RULES[state];
  if (!rule) return 0;

  if (rule.basis === "half_yearly") {
    if (!rule.chargeMonths?.includes(month)) return 0;
    // Half-yearly income, approximated from the current month's gross.
    return amountForSlab(rule.slabs, monthlyGross * 6);
  }

  const amount = amountForSlab(rule.slabs, monthlyGross);
  // The February top-up only applies to employees who are actually liable.
  if (month === 2 && rule.februaryAmount !== undefined && amount > 0) return rule.februaryAmount;
  return amount;
}

/**
 * ESI contribution periods are April–September and October–March.
 * Coverage is judged at the start of a period and held until the period ends.
 */
export function getEsiContributionPeriod(year: number, month: number): { startYear: number; startMonth: number } {
  if (month >= 4 && month <= 9) return { startYear: year, startMonth: 4 };
  if (month >= 10) return { startYear: year, startMonth: 10 };
  return { startYear: year - 1, startMonth: 10 };
}

function countSundays(year: number, month: number) {
  const days = new Date(year, month, 0).getDate();
  let sundays = 0;
  for (let d = 1; d <= days; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) sundays++;
  }
  return sundays;
}

export function getWorkingDays(year: number, month: number, holidayDates: string[]) {
  const total = new Date(year, month, 0).getDate();
  const sundays = countSundays(year, month);
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const holidaysNotSunday = holidayDates.filter((d) => {
    if (!d.startsWith(prefix)) return false;
    return new Date(d).getDay() !== 0;
  }).length;
  return Math.max(total - sundays - holidaysNotSunday, 1);
}

export interface PayslipCalc {
  employeeId: string;
  structureId: string;
  daysInMonth: number;
  workingDays: number;
  daysPresent: number;
  daysAbsent: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  effectiveUnpaidDays: number;
  paidDays: number;
  lopRatio: number;
  lopDivisor: number;
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
  netOverride: number | null;
  overtimeAmount: number;
  esiBase: number;
  pfBase: number;
  policySnapshot: SalaryPolicySnapshot;
  hasAttendanceAnomaly?: boolean;
}

export function calcPayslip(
  struct: SalaryStructure,
  att: { daysPresent: number; daysAbsent: number; paidLeaveDays: number; unpaidLeaveDays: number; halfDays: number },
  overtimeAmount: number,
  year: number,
  month: number,
  holidayDates: string[],
  policy: SalaryPolicySnapshot,
  opts: { esiCoveredEarlierInPeriod?: boolean } = {}
): PayslipCalc {
  const daysInMonth = Math.max(new Date(year, month, 0).getDate(), 1);
  const workingDays = Math.max(getWorkingDays(year, month, holidayDates), 1);

  if (workingDays <= 0) {
    throw new Error("Invalid payroll period: working days cannot be zero");
  }

  const monthlyCtc = struct.ctc_annual / 12;
  const basicMonthly = roundCurrency(monthlyCtc * (struct.basic_percent / 100));
  const hraMonthly = roundCurrency(basicMonthly * (struct.hra_percent / 100));
  const grossMonthly = basicMonthly + hraMonthly + struct.special_allowance + struct.other_allowances;

  let lopDivisor = workingDays;
  if (policy.lopCalculationMethod === "calendar") {
    lopDivisor = daysInMonth;
  } else if (policy.lopCalculationMethod === "fixed_26") {
    lopDivisor = 26;
  }

  // --- Attendance Normalization Layer ---
  const paidDays = att.daysPresent + att.halfDays * 0.5 + att.paidLeaveDays;
  const explicitUnpaidDays = att.daysAbsent + att.unpaidLeaveDays;

  // Sanity check: Ensure total tracked days do not exceed working days
  const totalTrackedDays = paidDays + explicitUnpaidDays;
  const hasAttendanceAnomaly = totalTrackedDays > workingDays;

  let normalizedPaidDays = paidDays;
  let normalizedUnpaidDays = explicitUnpaidDays;

  if (hasAttendanceAnomaly) {
    // Normalize by prioritizing paid days and making unpaid days the remainder
    normalizedPaidDays = Math.min(paidDays, workingDays);
    normalizedUnpaidDays = Math.max(0, workingDays - normalizedPaidDays);
    console.warn(
      `[Payroll Engine] Attendance anomaly detected for employee ${struct.employee_id}. ` +
      `Total tracked days (${totalTrackedDays}) exceeds working days (${workingDays}). ` +
      `Normalized to Paid: ${normalizedPaidDays}, Unpaid: ${normalizedUnpaidDays}.`
    );
  }

  // Implicit absences (e.g. if HR only enters daysPresent and leaves daysAbsent empty)
  const unaccountedDays = Math.max(0, workingDays - (normalizedPaidDays + normalizedUnpaidDays));
  const totalDeductibleDays = normalizedUnpaidDays + unaccountedDays;

  // Explicit attendance classification layer
  const attendanceState: "full_unpaid" | "partial_payable" = 
    (normalizedPaidDays === 0 && totalDeductibleDays >= workingDays) 
      ? "full_unpaid" 
      : "partial_payable";
      
  let daysRatio = 1;
  if (attendanceState === "full_unpaid") {
    daysRatio = 0;
  } else {
    if (policy.lopCalculationMethod === "working_days") {
      daysRatio = normalizedPaidDays / workingDays;
    } else if (policy.lopCalculationMethod === "calendar") {
      daysRatio = (daysInMonth - totalDeductibleDays) / daysInMonth;
    } else {
      daysRatio = normalizedPaidDays / 26;
    }
  }

  const boundedDaysRatio = Math.max(0, Math.min(daysRatio, 1));
  const effectiveUnpaidDays = totalDeductibleDays;
  // --------------------------------------

  const proratedBasic = roundCurrency(basicMonthly * boundedDaysRatio);
  const proratedHra = roundCurrency(hraMonthly * boundedDaysRatio);
  const proratedSpecial = roundCurrency(struct.special_allowance * boundedDaysRatio);
  const proratedOther = roundCurrency(struct.other_allowances * boundedDaysRatio);
  const proratedGross = proratedBasic + proratedHra + proratedSpecial + proratedOther;

  // Defend against nulls/undefined values in policy
  const pfWageCeiling = policy.pfWageCeiling ?? 15000;
  const esiGrossCeiling = policy.esiGrossCeiling ?? 21000;

  // PF Calculation (Excludes Overtime)
  const proratedPfCeiling = roundCurrency(pfWageCeiling * boundedDaysRatio);
  const pfEligibleWage = Math.min(proratedBasic, proratedPfCeiling);
  const pfBase = struct.pf_applicable ? pfEligibleWage : 0;
  const pfEmployee = struct.pf_applicable ? roundCurrency(pfBase * 0.12) : 0;
  const pfEmployer = struct.pf_applicable ? roundCurrency(pfBase * 0.12) : 0;

  // ESI eligibility is judged on full normal gross; the deduction base includes overtime.
  //
  // Contribution-period lock-in: an employee covered at any point in the current period
  // (Apr–Sep or Oct–Mar) stays covered until that period ends, even once their wages rise past
  // the ceiling. Dropping them the month they cross would under-deduct and break ECR filing.
  const esiWithinCeiling = grossMonthly <= esiGrossCeiling;
  const esiApplicable =
    struct.esi_applicable && (esiWithinCeiling || opts.esiCoveredEarlierInPeriod === true);
  const esiBase = esiApplicable ? (proratedGross + overtimeAmount) : 0;
  
  let esiEmployee = 0;
  let esiEmployer = 0;
  if (esiApplicable) {
    esiEmployee = roundCurrency(esiBase * 0.0075);
    esiEmployer = roundCurrency(esiBase * 0.0325);
  }

  const tds = struct.tds_monthly;
  
  // Professional Tax — slab-based on the full monthly gross, not the prorated one.
  // PT liability follows the wage the employee is engaged at, so a part-paid month does not
  // move them into a lower slab.
  const professionalTax = resolveProfessionalTax(
    policy.professionalTaxState,
    grossMonthly,
    month,
    policy.professionalTaxManualAmount
  );


  const otherDeductions = professionalTax; // Add other struct deductions here if needed
  
  const totalDeductions = roundCurrency(pfEmployee + esiEmployee + tds + otherDeductions);
  const netPayable = Math.max(roundCurrency(proratedGross - totalDeductions), 0);

  return {
    employeeId: struct.employee_id,
    structureId: struct.id,
    daysInMonth,
    workingDays,
    daysPresent: att.daysPresent,
    daysAbsent: att.daysAbsent,
    paidLeaveDays: att.paidLeaveDays,
    unpaidLeaveDays: att.unpaidLeaveDays,
    halfDays: att.halfDays,
    basicMonthly: proratedBasic,
    hraMonthly: proratedHra,
    specialAllowance: proratedSpecial,
    otherAllowances: proratedOther,
    grossSalary: proratedGross,
    pfEmployee,
    pfEmployer,
    esiEmployee,
    esiEmployer,
    tds,
    otherDeductions,
    totalDeductions,
    netPayable,
    netOverride: null,
    overtimeAmount,
    esiBase,
    pfBase,
    effectiveUnpaidDays,
    paidDays,
    lopRatio: boundedDaysRatio,
    lopDivisor,
    policySnapshot: policy,
    hasAttendanceAnomaly,
  };
}
