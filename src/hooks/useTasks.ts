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
      if (status !== "in_progress") throw new Error("Use the submission and review actions to change task status.");
      const { error } = await db.rpc("p3_set_task_state", { p_task_id: taskId, p_status: status });
      if (error) throw error;
      await fetchTasks();
    },
    [fetchTasks, tenantId],
  );

  return { items, loading, fetchTasks, updateTaskStatus };
}
