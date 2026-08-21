/**
 * Resolving an employee's job title for display.
 *
 * `employees.designation` (free text) was dropped — 06-organisation-management.md §5 step 6, second
 * half. The real field is `employees.job_title_id`, and its display name is `job_titles.title`.
 *
 * Mirrors `departmentLabel.ts` deliberately: same shape, same fallback semantics, so the two read the
 * same way at every call site.
 */

/** `job_titles.id` -> `job_titles.title`. Built once per tenant by OrgUnitsProvider. */
export type JobTitleLookup = Record<string, string>;

/** Anything carrying a job-title pointer — employees, directory rows, embedded relation objects. */
export type HasJobTitle = { job_title_id?: string | null } | null | undefined;

/** The employee's job title, or `fallback` when they have none or the lookup has not loaded. */
export function jobTitleLabel(
  employee: HasJobTitle,
  jobTitles: JobTitleLookup,
  fallback = "—",
): string {
  const titleId = employee?.job_title_id;
  if (!titleId) return fallback;
  return jobTitles[titleId] ?? fallback;
}
