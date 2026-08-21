/**
 * Resolving an employee's department for display.
 *
 * `employees.department` (free text) is being dropped — 06-organisation-management.md §5 step 6. The
 * unit an employee belongs to is `employees.org_unit_id`, and its NAME lives on `org_units`. Every
 * screen that used to render the text column resolves through here instead.
 *
 * Kept as a plain function, not a hook, so non-React callers (PDF generation, org-chart tree building)
 * can use the same resolution as the components.
 */

/** `org_units.id` -> `org_units.name`. Built once per tenant by OrgUnitsProvider. */
export type UnitNameLookup = Record<string, string>;

/** Anything carrying a unit pointer. Deliberately structural — callers pass employees, directory
 *  rows, and embedded relation objects, which are all different types with this one field. */
export type HasOrgUnit = { org_unit_id?: string | null } | null | undefined;

/**
 * The employee's unit name, or `fallback` when they have no unit or the lookup has not loaded.
 *
 * 06 §6: "no unit" means UNASSIGNED — never "all departments". Returning the fallback keeps that
 * distinction at the display layer, matching how the RLS helpers treat a null unit as no-match.
 */
export function departmentLabel(
  employee: HasOrgUnit,
  unitNames: UnitNameLookup,
  fallback = "—",
): string {
  const unitId = employee?.org_unit_id;
  if (!unitId) return fallback;
  return unitNames[unitId] ?? fallback;
}
