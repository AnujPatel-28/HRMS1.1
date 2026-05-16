import { useCallback, useState } from "react";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import type { Task } from "../types";

export function useTasks(employeeId?: string) {
  const { tenantId } = useTenant();
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    const { data } = await db
      .from("tasks")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("assigned_to", employeeId)
      .order("created_at", { ascending: false });
    setItems((data as Task[]) ?? []);
    setLoading(false);
  }, [employeeId, tenantId]);

  const updateTaskStatus = useCallback(
    async (taskId: string, status: Task["status"]) => {
      await db.from("tasks").update({ status }).eq("tenant_id", tenantId).eq("id", taskId);
      await fetchTasks();
    },
    [fetchTasks, tenantId],
  );

  return { items, loading, fetchTasks, updateTaskStatus };
}
