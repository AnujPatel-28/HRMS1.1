import { useCallback, useState } from "react";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import type { Attendance } from "../types";

export function useAttendance(employeeId?: string) {
  const { tenantId } = useTenant();
  const [items, setItems] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAttendance = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    const { data } = await db
      .from("attendance")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employeeId)
      .order("date", { ascending: false });
    setItems((data as Attendance[]) ?? []);
    setLoading(false);
  }, [employeeId, tenantId]);

  const punchIn = useCallback(
    async (ipAddress?: string) => {
      if (!employeeId) return;
      const today = new Date().toISOString().slice(0, 10);
      await db.from("attendance").insert([
        {
          employee_id: employeeId,
          tenant_id: tenantId,
          date: today,
          punch_in_ip: ipAddress ?? null,
          status: "present",
          session_status: "open",
        },
      ]);
      await fetchAttendance();
    },
    [employeeId, fetchAttendance, tenantId],
  );

  const punchOut = useCallback(
    async (attendanceId: string, ipAddress?: string) => {
      const now = new Date().toISOString();
      await db
        .from("attendance")
        .update({ punch_out: now, punch_out_ip: ipAddress ?? null, punch_out_allowed: false, session_status: "closed" })
        .eq("tenant_id", tenantId)
        .eq("id", attendanceId);
      await fetchAttendance();
    },
    [fetchAttendance, tenantId],
  );

  return { items, loading, fetchAttendance, punchIn, punchOut };
}
