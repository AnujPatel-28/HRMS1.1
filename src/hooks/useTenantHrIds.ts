import { useEffect, useState } from "react";
import { db } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";

/**
 * The employee ids that hold HR in the caller's own tenant.
 *
 * Replaces four `.from("employees").eq("role", "hr")` queries, made impossible by the
 * removal of `employees.role` (06-organisation-management.md §9.6).
 *
 * It has to be the `tenant_hr_employee_ids()` RPC rather than a query against
 * `employee_roles`: that table's `employee_roles_self_select` policy lets an employee read
 * only their OWN grants, so a non-HR user asking "who is HR" through the table gets an
 * empty set — silently, as zero rows rather than an error. The RPC is SECURITY DEFINER and
 * filters to `get_auth_tenant_id()`, so it answers correctly for every role and can leak
 * nothing across a tenant boundary. Verified as HR and as employee-role users in two
 * different tenants.
 *
 * Returns an empty set while loading. Every caller uses it to *include* someone (notify
 * HR, offer HR as a manager, badge HR in the chart), so an empty set degrades to "no HR
 * found" rather than to a wrong positive.
 */
export function useTenantHrIds(): Set<string> {
  const { tenantId } = useTenant();
  const [hrIds, setHrIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!tenantId) {
      setHrIds(new Set());
      return;
    }

    let active = true;
    void (async () => {
      const { data, error } = await db.rpc("tenant_hr_employee_ids");
      if (!active) return;
      if (error) {
        console.error("Failed to resolve tenant HR employees", error);
        setHrIds(new Set());
        return;
      }
      setHrIds(new Set((data ?? []) as string[]));
    })();

    return () => {
      active = false;
    };
  }, [tenantId]);

  return hrIds;
}
