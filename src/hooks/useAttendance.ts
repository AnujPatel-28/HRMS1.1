import { useCallback, useState } from "react";
import { db } from "../insforge/client";
import type { Attendance } from "../types";

export function useAttendance(employeeId?: string) {
  const [items, setItems] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAttendance = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    const { data } = await db
      .from("attendance")
      .select("*")
      .eq("employee_id", employeeId)
      .order("date", { ascending: false });
    setItems((data as Attendance[]) ?? []);
    setLoading(false);
  }, [employeeId]);

  const punchIn = useCallback(
    async (ipAddress?: string) => {
      if (!employeeId) return;
      const today = new Date().toISOString().slice(0, 10);
      await db.from("attendance").insert([
        {
          employee_id: employeeId,
          date: today,
          punch_in: new Date().toISOString(),
          punch_in_ip: ipAddress ?? null,
          status: "present",
        },
      ]);
      await fetchAttendance();
    },
    [employeeId, fetchAttendance],
  );

  const punchOut = useCallback(
    async (attendanceId: string, ipAddress?: string) => {
      const now = new Date().toISOString();
      await db
        .from("attendance")
        .update({ punch_out: now, punch_out_ip: ipAddress ?? null, punch_out_allowed: false })
        .eq("id", attendanceId);
      await fetchAttendance();
    },
    [fetchAttendance],
  );

  return { items, loading, fetchAttendance, punchIn, punchOut };
}
