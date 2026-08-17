/**
 * Verification for the Professional Tax slab engine and the ESI contribution-period lock-in.
 * Run: npx tsx scratch/payroll_pt_esi_verify.ts
 */
import { resolveProfessionalTax, getEsiContributionPeriod } from "../src/payroll/hr/payroll-calc";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  -> got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

console.log("\n── Professional Tax: Karnataka (exempt at/below 25,000) ──");
// The old flat map charged 200 here. This is the over-deduction bug.
check("KA 18,000 in June", resolveProfessionalTax("karnataka", 18000, 6, null), 0);
check("KA 25,000 in June (boundary, inclusive)", resolveProfessionalTax("karnataka", 25000, 6, null), 0);
check("KA 25,001 in June", resolveProfessionalTax("karnataka", 25001, 6, null), 200);

console.log("\n── Professional Tax: Maharashtra (banded + February top-up) ──");
check("MH 7,000 in June", resolveProfessionalTax("maharashtra", 7000, 6, null), 0);
check("MH 9,000 in June", resolveProfessionalTax("maharashtra", 9000, 6, null), 175);
check("MH 30,000 in June", resolveProfessionalTax("maharashtra", 30000, 6, null), 200);
check("MH 30,000 in February", resolveProfessionalTax("maharashtra", 30000, 2, null), 300);
// An exempt employee must not be dragged into the February top-up.
check("MH 7,000 in February (still exempt)", resolveProfessionalTax("maharashtra", 7000, 2, null), 0);

console.log("\n── Professional Tax: Tamil Nadu (half-yearly, collected Sep & Mar) ──");
// The old map charged 209 every single month.
check("TN 40,000 in June (not a collection month)", resolveProfessionalTax("tamil_nadu", 40000, 6, null), 0);
check("TN 40,000 in September (240k half-yearly)", resolveProfessionalTax("tamil_nadu", 40000, 9, null), 1250);
check("TN 4,000 in September (24k half-yearly)", resolveProfessionalTax("tamil_nadu", 4000, 9, null), 135);
check("TN 40,000 in March", resolveProfessionalTax("tamil_nadu", 40000, 3, null), 1250);

console.log("\n── Professional Tax: overrides and unknown states ──");
check("Manual override wins", resolveProfessionalTax("karnataka", 18000, 6, 150), 150);
check("Manual override of 0 is respected", resolveProfessionalTax("karnataka", 90000, 6, 0), 0);
check("Unknown state", resolveProfessionalTax("atlantis", 50000, 6, null), 0);
check("No state configured", resolveProfessionalTax("", 50000, 6, null), 0);

console.log("\n── ESI contribution periods ──");
check("June -> Apr same year", getEsiContributionPeriod(2026, 6), { startYear: 2026, startMonth: 4 });
check("April -> Apr same year (boundary)", getEsiContributionPeriod(2026, 4), { startYear: 2026, startMonth: 4 });
check("September -> Apr same year (boundary)", getEsiContributionPeriod(2026, 9), { startYear: 2026, startMonth: 4 });
check("October -> Oct same year (boundary)", getEsiContributionPeriod(2026, 10), { startYear: 2026, startMonth: 10 });
check("December -> Oct same year", getEsiContributionPeriod(2026, 12), { startYear: 2026, startMonth: 10 });
// The year-straddling case: Jan–Mar belongs to the previous October's period.
check("January -> Oct previous year", getEsiContributionPeriod(2026, 1), { startYear: 2025, startMonth: 10 });
check("March -> Oct previous year (boundary)", getEsiContributionPeriod(2026, 3), { startYear: 2025, startMonth: 10 });

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
