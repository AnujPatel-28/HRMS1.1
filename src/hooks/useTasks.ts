import { useCallback, useState } from "react";
import { db } from "../insforge/client";
import type { Task } from "../types";

export function useTasks(employeeId?: string) {
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    const { data } = await db
      .from("tasks")
      .select("*")
      .eq("assigned_to", employeeId)
      .order("created_at", { ascending: false });
    setItems((data as Task[]) ?? []);
    setLoading(false);
  }, [employeeId]);

  const updateTaskStatus = useCallback(
    async (taskId: string, status: Task["status"]) => {
      await db.from("tasks").update({ status }).eq("id", taskId);
      await fetchTasks();
    },
    [fetchTasks],
  );

  return { items, loading, fetchTasks, updateTaskStatus };
}
