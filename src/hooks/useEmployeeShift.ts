import { useCallback, useEffect, useState } from "react";
import { db } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import { useEmployee } from "./useEmployee";
import type { Shift } from "../types";

type UseEmployeeShiftResult = {
  shift: Shift | null;
  isLoading: boolean;
  error: string | null;
};

function formatTimeValue(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return value.slice(0, 5);
}

function normalizeShift(raw: Partial<Shift> | null, fallback?: Partial<Shift>): Shift | null {
  if (!raw && !fallback) return null;
  const source = { ...fallback, ...raw };
  if (!source.name || !source.start_time || !source.end_time) return null;
  return {
    id: source.id,
    tenant_id: source.tenant_id,
    name: source.name,
    start_time: formatTimeValue(source.start_time, "09:00"),
    end_time: formatTimeValue(source.end_time, "18:00"),
    working_days: Array.isArray(source.working_days) ? source.working_days.map(Number) : [1, 2, 3, 4, 5, 6],
    half_day_cutoff_override: source.half_day_cutoff_override ? formatTimeValue(source.half_day_cutoff_override, "10:30") : null,
    is_default: source.is_default ?? true,
    is_active: source.is_active ?? true,
    created_at: source.created_at,
    updated_at: source.updated_at,
  };
}

export function useEmployeeShift(): UseEmployeeShiftResult {
  const { tenant, tenantId } = useTenant();
  const { employee } = useEmployee();
  const [shift, setShift] = useState<Shift | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchShift = useCallback(async () => {
    if (!tenantId || !tenant || !employee?.id) {
      setShift(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    const today = new Date().toISOString().slice(0, 10);

    try {
      const { data: activeAssignment, error: assignmentError } = await db
        .from("employee_shifts")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employee.id)
        .lte("effective_from", today)
        .or(`effective_to.is.null,effective_to.gte.${today}`)
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (assignmentError) throw assignmentError;

      if (activeAssignment) {
        const { data: assignedShift, error: shiftError } = await db
          .from("shifts")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("id", (activeAssignment as { shift_id: string }).shift_id)
          .maybeSingle();

        if (shiftError) throw shiftError;

        const normalizedAssignedShift = normalizeShift(assignedShift as Shift | null);
        if (normalizedAssignedShift) {
          setShift(normalizedAssignedShift);
          setIsLoading(false);
          return;
        }
      }

      const { data: defaultShift, error: defaultError } = await db
        .from("shifts")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_default", true)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (defaultError) throw defaultError;

      const normalizedDefaultShift = normalizeShift(defaultShift as Shift | null);
      if (normalizedDefaultShift) {
        setShift(normalizedDefaultShift);
        setIsLoading(false);
        return;
      }

      setShift(normalizeShift(null, {
        name: "Standard shift",
        start_time: tenant.punch_in_start,
        end_time: `${String(Math.min(23, Number(tenant.punch_in_start.slice(0, 2)) + Number(tenant.work_hours_per_day || 8))).padStart(2, "0")}:${tenant.punch_in_start.slice(3, 5)}`,
        working_days: [1, 2, 3, 4, 5, 6],
        half_day_cutoff_override: tenant.punch_in_cutoff,
        is_default: true,
        is_active: true,
      }));
    } catch (err) {
      console.error(err);
      setError("Failed to load employee shift.");
      setShift(normalizeShift(null, {
        name: "Standard shift",
        start_time: tenant.punch_in_start,
        end_time: `${String(Math.min(23, Number(tenant.punch_in_start.slice(0, 2)) + Number(tenant.work_hours_per_day || 8))).padStart(2, "0")}:${tenant.punch_in_start.slice(3, 5)}`,
        working_days: [1, 2, 3, 4, 5, 6],
        half_day_cutoff_override: tenant.punch_in_cutoff,
        is_default: true,
        is_active: true,
      }));
    } finally {
      setIsLoading(false);
    }
  }, [employee?.id, tenant, tenantId]);

  useEffect(() => {
    void fetchShift();
  }, [fetchShift]);

  return { shift, isLoading, error };
}
