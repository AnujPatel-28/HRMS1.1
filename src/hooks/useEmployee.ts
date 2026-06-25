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
    const { data, error } = await db
      .from("employees")
      .select("*, manager:employees!manager_id(full_name)")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!error) {
      if (data) {
        const empData = data as any;
        setEmployee({
          ...empData,
          manager_name: empData.manager?.full_name || null
        } as Employee);
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
