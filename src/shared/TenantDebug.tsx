/**
 * TenantDebug — TEMPORARY developer component.
 *
 * Purpose:
 *   Visually confirms that multi-tenant subdomain detection is working
 *   correctly in the current environment.
 *
 * How subdomain detection works (TenantContext.tsx):
 *   1. Reads window.location.hostname
 *   2. Splits into labels by "."
 *   3. If labels.length >= 3  → first label = tenant subdomain
 *      e.g. "abc.hrms.talentmeshsolutions.com" → "abc"
 *   4. If labels.length < 3   → root domain, no tenant (null)
 *      e.g. "hrms.talentmeshsolutions.com" → null
 *   5. On localhost           → falls back to VITE_DEFAULT_TENANT_ID env var
 *
 * Remove this component once subdomain routing is confirmed in production.
 */

import { useTenant } from "../contexts/TenantContext";

export default function TenantDebug() {
  const { tenant, tenantId } = useTenant();

  // Derive the subdomain from the live hostname so the debug panel
  // shows exactly what the detection logic resolved to.
  const hostname = window.location.hostname;
  const labels = hostname.split(".").filter(Boolean);
  const detectedSubdomain =
    hostname === "localhost" || hostname === "127.0.0.1"
      ? "(localhost — using VITE_DEFAULT_TENANT_ID)"
      : labels.length >= 3
        ? labels[0]
        : "(root domain — no subdomain)";

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-mono shadow-sm">
      {/* Header */}
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-amber-700">
        🛠 Tenant Debug — Remove before release
      </p>

      {/* Detection results */}
      <div className="space-y-1 text-slate-700">
        <p>
          <span className="text-slate-500">Hostname: </span>
          <span className="font-semibold">{hostname}</span>
        </p>
        <p>
          <span className="text-slate-500">Detected Subdomain: </span>
          <span className="font-semibold text-amber-700">{detectedSubdomain}</span>
        </p>
        <p>
          <span className="text-slate-500">Current Tenant: </span>
          <span className="font-semibold text-emerald-700">
            {tenant?.company_name ?? "—"} ({tenant?.subdomain ?? "none"})
          </span>
        </p>
        <p>
          <span className="text-slate-500">Tenant ID: </span>
          <span className="font-semibold text-slate-600">{tenantId || "—"}</span>
        </p>
        <p>
          <span className="text-slate-500">Plan: </span>
          <span className="font-semibold capitalize">{tenant?.plan ?? "—"}</span>
        </p>
        <p>
          <span className="text-slate-500">Status: </span>
          <span
            className={`font-semibold capitalize ${
              tenant?.status === "active" ? "text-emerald-700" : "text-rose-600"
            }`}
          >
            {tenant?.status ?? "—"}
          </span>
        </p>
      </div>
    </div>
  );
}
