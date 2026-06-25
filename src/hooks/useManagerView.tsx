import { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./useAuth";
import { db } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";

interface ManagerViewContextValue {
  isManager: boolean;
  isManagerMode: boolean;
  toggleManagerMode: () => void;
  directReportIds: string[];
  filterIds: string[];
}

const ManagerViewContext = createContext<ManagerViewContextValue | undefined>(undefined);

export function ManagerViewProvider({ children }: { children: React.ReactNode }) {
  const { currentEmployee, isManager } = useAuth();
  const { tenantId } = useTenant();

  const [isManagerMode, setIsManagerMode] = useState(() => {
    if (!currentEmployee?.id) return false;
    return localStorage.getItem(`talentmesh_manager_mode_${currentEmployee.id}`) === "true";
  });

  const [directReportIds, setDirectReportIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isManager || !currentEmployee?.id || !tenantId) {
      setDirectReportIds([]);
      return;
    }

    db.from("employees")
      .select("id")
      .eq("manager_id", currentEmployee.id)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .then(({ data }) => {
        setDirectReportIds(data?.map((e) => e.id) || []);
      });
  }, [currentEmployee?.id, isManager, tenantId]);

  const toggleManagerMode = () => {
    if (!isManager) return;
    const newMode = !isManagerMode;
    setIsManagerMode(newMode);
    if (currentEmployee?.id) {
      localStorage.setItem(`talentmesh_manager_mode_${currentEmployee.id}`, String(newMode));
    }
  };

  const filterIds = isManagerMode ? directReportIds : [currentEmployee?.id || ""];

  return (
    <ManagerViewContext.Provider
      value={{
        isManager,
        isManagerMode,
        toggleManagerMode,
        directReportIds,
        filterIds,
      }}
    >
      {children}
    </ManagerViewContext.Provider>
  );
}

export function useManagerView() {
  const context = useContext(ManagerViewContext);
  if (context === undefined) {
    throw new Error("useManagerView must be used within a ManagerViewProvider");
  }
  return context;
}
