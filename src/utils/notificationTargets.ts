import { db } from "../insforge/client";

/**
 * Narrow shape for the unit walk. The shared `OrgUnit` type predates the Slice A columns
 * (`head_employee_id`), so the query declares only what it reads.
 */
interface UnitHeadRow {
  id: string;
  parent_id: string | null;
  head_employee_id: string | null;
}

interface DirectoryRow {
  id: string;
  role: string | null;
}

/**
 * Resolves who is notified when an employee submits a task.
 *
 * Order, per `doc/architecture/06-organisation-management.md` §9.1:
 *   1. the submitter's own unit head (`org_units.head_employee_id` for `employees.org_unit_id`)
 *   2. else the PARENT unit's head (a Backend Team with no head reaches the Engineering head,
 *      rather than jumping straight to HR)
 *   3. else the tenant's HR admins
 *
 * A head that is inactive, deleted, or the submitter themselves is skipped — §6 escalates to the
 * parent unit when a unit head has left, and notifying yourself about your own submission is a no-op.
 *
 * Replaces `.eq("department", "operations")`, which notified nobody in any tenant without a
 * department literally named lowercase `operations` (§2.3).
 *
 * @returns employee ids to notify; empty when nothing resolves.
 */
export async function resolveTaskNotificationTargets(
  tenantId: string,
  submitterEmployeeId: string,
  orgUnitId: string | null | undefined
): Promise<string[]> {
  // employee_directory_public, not employees: a standard employee can only SELECT their own
  // `employees` row, so a colleague lookup against that table comes back empty.
  const { data: directory } = await db
    .from("employee_directory_public")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("status", "active");

  const activeEmployees = (directory ?? []) as DirectoryRow[];
  const activeIds = new Set(activeEmployees.map((e) => e.id));

  if (orgUnitId) {
    // `is_active` is deliberately not filtered: the submitter's unit must resolve even if it
    // has been deactivated. One read of the tenant's units, resolved in memory.
    const { data: unitData } = await db
      .from("org_units")
      .select("id, parent_id, head_employee_id")
      .eq("tenant_id", tenantId);

    const units = new Map(((unitData ?? []) as UnitHeadRow[]).map((u) => [u.id, u]));
    const ownUnit = units.get(orgUnitId);
    const parentUnit = ownUnit?.parent_id ? units.get(ownUnit.parent_id) : undefined;

    for (const head of [ownUnit?.head_employee_id, parentUnit?.head_employee_id]) {
      if (head && head !== submitterEmployeeId && activeIds.has(head)) return [head];
    }
  }

  return activeEmployees.filter((e) => e.role === "hr").map((e) => e.id);
}
