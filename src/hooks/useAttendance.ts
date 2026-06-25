import { useCallback, useState } from "react";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import type { Attendance } from "../types";
import { formatLocalDate } from "../utils/date";

export function useAttendance(
  employeeIdOrIds?: string | string[],
  viewMode: "self" | "team" = "self"
) {
  const { tenantId } = useTenant();
  const [items, setItems] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    try {
      if (viewMode === "self") {
        if (!employeeIdOrIds || Array.isArray(employeeIdOrIds)) {
          setItems([]);
          return;
        }
        const { data } = await db
          .from("attendance")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("employee_id", employeeIdOrIds)
          .order("date", { ascending: false });
        setItems((data as Attendance[]) ?? []);
      } else {
        const ids = Array.isArray(employeeIdOrIds) ? employeeIdOrIds : [];
        if (ids.length === 0) {
          setItems([]);
          return;
        }
        const { data } = await db
          .from("attendance")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("employee_id", ids)
          .order("date", { ascending: false });
        setItems((data as Attendance[]) ?? []);
      }
    } catch (err) {
      console.error(err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [employeeIdOrIds, viewMode, tenantId]);

  const punchIn = useCallback(
    async (ipAddress?: string) => {
      if (viewMode !== "self" || !employeeIdOrIds || Array.isArray(employeeIdOrIds)) return;
      const today = formatLocalDate(new Date());
      await db.from("attendance").insert([
        {
          employee_id: employeeIdOrIds,
          tenant_id: tenantId,
          date: today,
          punch_in_ip: ipAddress ?? null,
          status: "present",
          session_status: "open",
        },
      ]);
      await fetchAttendance();
    },
    [employeeIdOrIds, viewMode, fetchAttendance, tenantId],
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
