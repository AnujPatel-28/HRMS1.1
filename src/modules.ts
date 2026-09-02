/**
 * Module keys, mirroring the `public.modules` catalogue seeded by
 * migrations/20260817200000_module-registry.sql.
 *
 * The database is the enforcement boundary — a disabled module's tables are unreadable through the
 * API regardless of what the UI does (see doc/architecture/02-module-registry.md §3). Everything here
 * is presentation: it stops a tenant being shown screens that would come back empty.
 */
export const MODULE_KEYS = [
  "directory",
  "attendance",
  "leave",
  "payroll",
  "tasks",
  "expenses",
  "insurance",
  "policy_center",
  "work_calendar",
  "chat",
  "connect",
  "onboarding",
  "offboarding",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/**
 * Core modules cannot be disabled, so nothing gated on them ever needs checking.
 *
 * `policy_center` is core as of 20260821150000, and not because it is popular. PolicyCenter
 * is the ONLY surface for the statutory settings other modules read — lop_calculation_method,
 * pf_wage_ceiling, esi_gross_ceiling, professional_tax_state, late-mark and regularization
 * rules. Gated off, payroll and attendance silently fall back to hardcoded defaults (PF 15000,
 * ESI 21000, PT 0) with no UI anywhere to correct them. Settings that other modules depend on
 * cannot themselves be sellable. Keep this list in step with `modules.is_core` in the database.
 *
 * `work_calendar` is core as of 20260821180000 and for the same reason: it owns the holiday
 * calendar and the per-employee working-day pattern that attendance derivation, leave day-counting
 * and payroll's working-days divisor all read. Gated off, they do not go absent — they go WRONG.
 * It was missing from this file until 20260902, which is why `/hr/holidays` was gated on `leave`
 * and an attendance-only tenant could not reach the holiday screen its own derivation depends on.
 */
export const CORE_MODULES: readonly ModuleKey[] = ["directory", "policy_center", "work_calendar"];

/**
 * Route prefix -> owning module. Longest prefix wins, so `/hr/policy-center` resolves to
 * policy_center rather than being shadowed by a shorter `/hr/policies` entry.
 *
 * Routes with no entry are ungated (dashboard, settings, profile, product selector).
 */
const ROUTE_MODULES: ReadonlyArray<readonly [string, ModuleKey]> = [
  ["/hr/attendance", "attendance"],
  ["/hr/shifts", "attendance"],
  ["/employee/attendance", "attendance"],
  ["/employee/punch", "attendance"],

  ["/hr/leaves", "leave"],
  ["/employee/leaves", "leave"],

  // The holiday calendar is core substrate, NOT part of Leave. Gating it on `leave` locked
  // `QA Attendance Only` (leave disabled, attendance enabled) out of the very screen its
  // attendance derivation reads.
  ["/hr/holidays", "work_calendar"],

  ["/payroll", "payroll"],
  ["/hr/declarations", "payroll"],
  ["/employee/payslips", "payroll"],

  ["/hr/tasks", "tasks"],
  ["/hr/pms", "tasks"],
  ["/employee/tasks", "tasks"],
  ["/employee/pms", "tasks"],

  ["/hr/expenses", "expenses"],
  ["/employee/expenses", "expenses"],

  ["/hr/insurance", "insurance"],
  ["/employee/insurance", "insurance"],

  ["/hr/policies", "policy_center"],
  ["/hr/policy-center", "policy_center"],
  ["/employee/policies", "policy_center"],

  ["/hr/chat", "chat"],
  ["/employee/chat", "chat"],

  ["/hr/connect", "connect"],
  ["/employee/connect", "connect"],

  ["/hr/offboarding", "offboarding"],
  ["/employee/exit", "offboarding"],

  ["/employee/onboarding", "onboarding"],
];

/** Returns the module owning a path, or null when the route is not module-gated. */
export function moduleForPath(pathname: string): ModuleKey | null {
  let best: { prefix: string; key: ModuleKey } | null = null;
  for (const [prefix, key] of ROUTE_MODULES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (!best || prefix.length > best.prefix.length) best = { prefix, key };
    }
  }
  return best?.key ?? null;
}
