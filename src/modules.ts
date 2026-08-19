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
  "chat",
  "connect",
  "onboarding",
  "offboarding",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/** `directory` is core: it cannot be disabled, so nothing gated on it ever needs checking. */
export const CORE_MODULES: readonly ModuleKey[] = ["directory"];

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
  ["/hr/holidays", "leave"],
  ["/employee/leaves", "leave"],

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
