import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useTenant } from "../contexts/TenantContext";
import { moduleForPath } from "../modules";

/**
 * Redirects away from a route whose owning module is disabled for this tenant.
 *
 * Presentation only — the database is the enforcement boundary (a disabled module's tables are
 * unreadable through the API regardless). This exists so a tenant that has not bought Payroll sees
 * no Payroll screen, rather than an empty one.
 *
 * Redirects silently. A tenant that never bought a module should not be shown an error about it —
 * an error toast is exactly the confusing failure mode the 2026-08-14 outage produced.
 */
export function RequireModule({ children, to }: { children: ReactNode; to: string }) {
  const { hasModule } = useTenant();
  const { pathname } = useLocation();

  const required = moduleForPath(pathname);
  if (required && !hasModule(required)) {
    return <Navigate to={to} replace />;
  }

  return <>{children}</>;
}
