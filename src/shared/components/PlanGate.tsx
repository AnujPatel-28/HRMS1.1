import React from "react";
import { useTenant } from "../../contexts/TenantContext";

interface PlanGateProps {
  feature: "pms" | string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PlanGate({ feature, children, fallback = null }: PlanGateProps) {
  const { tenant } = useTenant();
  const plan = tenant?.plan?.toLowerCase() || "trial";

  const isFeatureAllowed = () => {
    if (feature === "pms") {
      // Growth plan and above (growth, pro)
      return plan === "growth" || plan === "pro";
    }
    return true;
  };

  if (isFeatureAllowed()) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
