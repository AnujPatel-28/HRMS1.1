import type { SalaryStructure } from "./SalaryStructures";

export const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(n));
}

/** Count Sundays in a given month/year */
function countSundays(year: number, month: number) {
  const days = new Date(year, month, 0).getDate();
  let sundays = 0;
  for (let d = 1; d <= days; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) sundays++;
  }
  return sundays;
}

/** Working days = total days − Sundays − holidays (that are not on Sundays) */
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
  netOverride: number | null; // HR manual override
}

export function calcPayslip(
  struct: SalaryStructure,
  att: { daysPresent: number; daysAbsent: number; daysOnLeave: number; halfDays: number },
  year: number,
  month: number,
  holidayDates: string[],
): PayslipCalc {
  const daysInMonth = new Date(year, month, 0).getDate();
  const workingDays = getWorkingDays(year, month, holidayDates);

  const monthlyCtc = struct.ctc_annual / 12;
  const basicMonthly = monthlyCtc * (struct.basic_percent / 100);
  const hraMonthly = basicMonthly * (struct.hra_percent / 100);
  const grossMonthly = basicMonthly + hraMonthly + struct.special_allowance + struct.other_allowances;

  const perDay = grossMonthly / workingDays;
  const paidDays = att.daysPresent + att.halfDays * 0.5 + att.daysOnLeave;
  const adjustedGross = Math.min(paidDays * perDay, grossMonthly);

  const daysRatio = paidDays / workingDays;
  const pfEmployee = struct.pf_applicable ? basicMonthly * daysRatio * 0.12 : 0;
  const pfEmployer = struct.pf_applicable ? basicMonthly * daysRatio * 0.12 : 0;
  const esiEmployee = struct.esi_applicable && adjustedGross < 21000 ? adjustedGross * 0.0075 : 0;
  const esiEmployer = struct.esi_applicable && adjustedGross < 21000 ? adjustedGross * 0.0325 : 0;
  const tds = struct.tds_monthly;
  const otherDeductions = struct.other_allowances > 0 ? 0 : 0; // other_deductions not in struct
  const totalDeductions = pfEmployee + esiEmployee + tds + otherDeductions;
  const netPayable = Math.max(adjustedGross - totalDeductions, 0);

  return {
    employeeId: struct.employee_id,
    structureId: struct.id,
    daysInMonth,
    workingDays,
    daysPresent: att.daysPresent,
    daysAbsent: att.daysAbsent,
    daysOnLeave: att.daysOnLeave,
    halfDays: att.halfDays,
    basicMonthly,
    hraMonthly,
    specialAllowance: struct.special_allowance,
    otherAllowances: struct.other_allowances,
    grossSalary: adjustedGross,
    pfEmployee,
    pfEmployer,
    esiEmployee,
    esiEmployer,
    tds,
    otherDeductions,
    totalDeductions,
    netPayable,
    netOverride: null,
  };
}
