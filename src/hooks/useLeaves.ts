import { useCallback, useState } from "react";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import type { Leave } from "../types";

export function useLeaves(employeeId?: string) {
  const { tenantId } = useTenant();
  const [items, setItems] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLeaves = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    const { data } = await db
      .from("leaves")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employeeId)
      .order("applied_at", { ascending: false });
    setItems((data as Leave[]) ?? []);
    setLoading(false);
  }, [employeeId, tenantId]);

  const applyLeave = useCallback(
    async (payload: { leave_type_id: string; start_date: string; end_date: string; reason: string }) => {
      if (!employeeId || !tenantId) return;
      // P2-04: route through employee_apply_leave_request instead of a raw insert -- the RPC is
      // the only path that checks notice days, balance, overlap and per-date working-day/holiday
      // coverage; a direct insert bypassed all of it.
      await db.rpc("employee_apply_leave_request", {
        p_tenant_id: tenantId,
        p_leave_type_id: payload.leave_type_id,
        p_start_date: payload.start_date,
        p_end_date: payload.end_date,
        p_reason: payload.reason,
      });
      await fetchLeaves();
    },
    [employeeId, fetchLeaves, tenantId],
  );

  return { items, loading, fetchLeaves, applyLeave };
}
