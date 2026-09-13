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
  const { hasModule, moduleStatus, retryAccess } = useTenant();
  const { pathname } = useLocation();

  const required = moduleForPath(pathname);
  if (required && moduleStatus === "unavailable") {
    return (
      <div className="grid min-h-[18rem] place-items-center rounded-xl border border-slate-200 bg-white px-4 text-center">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Module access unavailable.</h2>
          <p className="mt-2 text-sm text-slate-600">We could not verify this module. Please retry.</p>
          <button
            type="button"
            onClick={() => void retryAccess()}
            className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (required && !hasModule(required)) {
    return <Navigate to={to} replace />;
  }

  return <>{children}</>;
}
