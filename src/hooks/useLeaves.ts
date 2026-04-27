import { useCallback, useState } from "react";
import { db } from "../insforge/client";
import type { Leave } from "../types";

export function useLeaves(employeeId?: string) {
  const [items, setItems] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLeaves = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    const { data } = await db
      .from("leaves")
      .select("*")
      .eq("employee_id", employeeId)
      .order("applied_at", { ascending: false });
    setItems((data as Leave[]) ?? []);
    setLoading(false);
  }, [employeeId]);

  const applyLeave = useCallback(
    async (payload: Pick<Leave, "leave_type" | "start_date" | "end_date" | "reason">) => {
      if (!employeeId) return;
      await db.from("leaves").insert([
        {
          employee_id: employeeId,
          ...payload,
        },
      ]);
      await fetchLeaves();
    },
    [employeeId, fetchLeaves],
  );

  return { items, loading, fetchLeaves, applyLeave };
}
