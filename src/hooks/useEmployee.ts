/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { db } from "../insforge/client";
import type { Employee } from "../types";
import { useAuth } from "./useAuth";

export function useEmployee() {
  const { user } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchEmployee = useCallback(async () => {
    if (!user?.id) {
      setEmployee(null);
      return;
    }

    setLoading(true);
    const { data, error } = await db.from("employees").select("*").eq("user_id", user.id).maybeSingle();

    if (!error) {
      setEmployee((data as Employee | null) ?? null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void fetchEmployee();
  }, [fetchEmployee]);

  return { employee, loading, refreshEmployee: fetchEmployee };
}
