/**
 * Map an `employment_types.code` onto the vocabulary `employees_employment_type_check` accepts.
 *
 * The org rebuild introduced the `employment_types` table with SHORT codes (FT, CON, INT) while
 * the legacy `employees.employment_type` text column kept a CHECK constraint expecting the LONG
 * forms (full_time, contract, intern...). Writing the code straight through therefore failed with
 *   new row for relation "employees" violates check constraint "employees_employment_type_check"
 * on any tenant whose codes are short. The QA tenant holds a MIX (CON, FT, full_time, intern,
 * INT), so creation succeeded or failed depending on which type was picked.
 *
 * Returns null for anything unrecognised: the constraint permits NULL and `employment_type_id` is
 * the real source of truth, so an unmappable code must not block employee creation.
 */
export const EMPLOYMENT_TYPE_CHECK_VALUES = new Set([
  "full_time", "part_time", "contract", "consultant",
  "freelancer", "intern", "temporary", "vendor",
]);

export function toLegacyEmploymentType(code: string | null | undefined): string | null {
  if (!code) return null;
  const raw = code.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (EMPLOYMENT_TYPE_CHECK_VALUES.has(raw)) return raw;

  const aliases: Record<string, string> = {
    ft: "full_time", fulltime: "full_time",
    pt: "part_time", parttime: "part_time",
    con: "contract", ctr: "contract", contractor: "contract",
    cons: "consultant",
    fl: "freelancer", freelance: "freelancer",
    int: "intern", internship: "intern",
    temp: "temporary",
    ven: "vendor",
  };
  return aliases[raw] ?? null;
}
