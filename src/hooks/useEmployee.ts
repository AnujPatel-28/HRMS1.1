/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import type { Employee } from "../types";
import { useAuth } from "./useAuth";

export function useEmployee() {
  const { user } = useAuth();
  const { tenantId } = useTenant();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchEmployee = useCallback(async () => {
    if (!user?.id) {
      setEmployee(null);
      return;
    }

    setLoading(true);
    // PostgREST resolves the self-referencing FK on `employees` in the REVERSE direction: the
    // embed `manager:employees!manager_id(full_name)` returns an ARRAY of the employee's DIRECT
    // REPORTS, not their manager. `.full_name` on an array is undefined, so `|| null` fired for
    // every row and the manager rendered as "—" everywhere. The `!employees_manager_id_fkey`
    // constraint hint does NOT work here ("Could not find a relationship"). Resolve explicitly.
    const { data, error } = await db
      .from("employees")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!error) {
      if (data) {
        const empData = data as any;
        // One row, so there is no sibling list to look the name up in. The directory view
        // already exposes a working `manager_name` — use it rather than re-deriving one.
        let managerName: string | null = null;
        if (empData.manager_id) {
          const { data: mgr } = await db
            .from("employee_directory_public")
            .select("full_name")
            .eq("id", empData.manager_id)
            .maybeSingle();
          managerName = (mgr as { full_name?: string } | null)?.full_name ?? null;
        }
        setEmployee({ ...empData, manager_name: managerName } as Employee);
      } else {
        setEmployee(null);
      }
    }
    setLoading(false);
  }, [tenantId, user]);

  useEffect(() => {
    void fetchEmployee();
  }, [fetchEmployee]);

  return { employee, loading, refreshEmployee: fetchEmployee };
}
