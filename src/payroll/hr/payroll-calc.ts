import type { SalaryStructure } from "./SalaryStructures";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface SalaryPolicySnapshot {
  snapshot_version: 2;
  lopCalculationMethod: "calendar" | "fixed_26" | "working_days";
  pfWageCeiling: number;
  esiGrossCeiling: number;
  professionalTaxState: string;
  professionalTaxManualAmount: number | null;
}

export function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(n));
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

const DEFAULT_PROFESSIONAL_TAX_BY_STATE: Record<string, number> = {
  karnataka: 200,
  maharashtra: 200,
  telangana: 200,
  andhra_pradesh: 200,
  gujarat: 200,
  tamil_nadu: 209,
};

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
  policy: SalaryPolicySnapshot
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

  // ESI Eligibility based on full normal gross; deduction base includes overtime
  const esiApplicable = struct.esi_applicable && (grossMonthly <= esiGrossCeiling);
  const esiBase = esiApplicable ? (proratedGross + overtimeAmount) : 0;
  
  let esiEmployee = 0;
  let esiEmployer = 0;
  if (esiApplicable) {
    esiEmployee = roundCurrency(esiBase * 0.0075);
    esiEmployer = roundCurrency(esiBase * 0.0325);
  }

  const tds = struct.tds_monthly;
  
  // Professional Tax
  let professionalTax = 0;
  if (policy.professionalTaxManualAmount !== null && policy.professionalTaxManualAmount !== undefined) {
    professionalTax = policy.professionalTaxManualAmount;
  } else if (policy.professionalTaxState) {
    professionalTax = DEFAULT_PROFESSIONAL_TAX_BY_STATE[policy.professionalTaxState] || 0;
  }
  
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
