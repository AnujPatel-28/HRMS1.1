/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { db, setCurrentTenantId } from "../insforge/client";
import { useAuth } from "../hooks/useAuth";

export type Tenant = {
  id: string;
  company_name: string;
  subdomain: string;
  plan: "trial" | "starter" | "growth" | "pro" | string;
  status: "trial" | "active" | "suspended" | "cancelled" | string;
  timezone: string;
  punch_in_start: string;
  punch_in_cutoff: string;
  work_hours_per_day: number;
  lunch_break_minutes: number;
  punch_out_gate_enabled: boolean;
  logo_url: string | null;
};

type TenantContextValue = {
  tenant: Tenant | null;
  tenantId: string;
  isLoading: boolean;
  refreshTenant: () => Promise<void>;
};

export const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function useTenant() {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error("useTenant must be used within TenantProvider");
  }
  return context;
}

const tenantColumns = [
  "id",
  "company_name",
  "subdomain",
  "plan",
  "status",
  "timezone",
  "punch_in_start",
  "punch_in_cutoff",
  "work_hours_per_day",
  "lunch_break_minutes",
  "punch_out_gate_enabled",
  "logo_url",
].join(",");

// The base domain for this SaaS app (the root — not a tenant).
// Any hostname that ends with this and has exactly ONE extra label
// before it is a tenant subdomain.
// e.g. "abc.hrms.talentmeshsolutions.com"  → tenant "abc"
//      "hrms.talentmeshsolutions.com"       → null (root app, no tenant)
const BASE_DOMAIN = import.meta.env.VITE_BASE_DOMAIN as string | undefined;

const isLocalhost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

const getSubdomain = (hostname: string): string | null => {
  // Always return null on localhost — dev uses VITE_DEFAULT_TENANT_ID instead.
  if (isLocalhost(hostname)) return null;

  const labels = hostname.split(".").filter(Boolean);

  // If a base domain is configured (e.g. "hrms.talentmeshsolutions.com"),
  // parse it so we know exactly how many labels the root has.
  if (BASE_DOMAIN) {
    const baseLabels = BASE_DOMAIN.split(".").filter(Boolean);
    // Tenant URL = base domain labels + 1 extra label at the front.
    // e.g. base = "hrms.talentmeshsolutions.com" (3 labels)
    //      tenant URL = "abc.hrms.talentmeshsolutions.com" (4 labels)
    if (labels.length === baseLabels.length + 1) {
      // Confirm the suffix matches the base domain exactly.
      const suffix = labels.slice(1).join(".");
      if (suffix === BASE_DOMAIN) {
        return labels[0]; // "abc"
      }
    }
    // Root domain itself or unrecognised — no tenant.
    return null;
  }

  // Fallback for environments without VITE_BASE_DOMAIN set:
  // treat anything with 3+ labels as having a subdomain.
  // This matches the original behaviour.
  return labels.length >= 3 ? labels[0] : null;
};

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [wrongTenant, setWrongTenant] = useState(false);
  const { role, tenantId: authTenantId } = useAuth();

  const refreshTenant = useCallback(async () => {
    setIsLoading(true);
    setNotFound(false);
    setBlocked(false);
    setWrongTenant(false);

    const hostname = window.location.hostname;
    const subdomain = getSubdomain(hostname);
    const defaultTenantId = import.meta.env.VITE_DEFAULT_TENANT_ID as string | undefined;

    const query = db.from("tenants").select(tenantColumns).limit(1);
    const result = subdomain
      ? await query.eq("subdomain", subdomain).maybeSingle()
      : defaultTenantId
        ? await query.eq("id", defaultTenantId).maybeSingle()
        : { data: null, error: new Error("Missing VITE_DEFAULT_TENANT_ID") };

    if (result.error || !result.data) {
      setTenant(null);
      setCurrentTenantId(null);
      setNotFound(true);
      setIsLoading(false);
      return;
    }

    const nextTenant = result.data as Tenant;
    if (role !== "superadmin" && authTenantId !== nextTenant.id) {
      setTenant(null);
      setCurrentTenantId(null);
      setWrongTenant(true);
      setIsLoading(false);
      return;
    }

    if (nextTenant.status === "suspended" || nextTenant.status === "cancelled") {
      setTenant(null);
      setCurrentTenantId(null);
      setBlocked(true);
      setIsLoading(false);
      return;
    }

    setTenant(nextTenant);
    setCurrentTenantId(nextTenant.id);
    setIsLoading(false);
  }, [authTenantId, role]);

  useEffect(() => {
    void refreshTenant();
  }, [refreshTenant]);

  const value = useMemo(
    () => ({
      tenant,
      tenantId: tenant?.id ?? "",
      isLoading,
      refreshTenant,
    }),
    [tenant, isLoading, refreshTenant],
  );

  if (isLoading) {
    return <div className="grid min-h-screen place-items-center text-slate-500">Loading...</div>;
  }

  if (notFound) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-4 text-center">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Company not found.</h1>
          <p className="mt-2 text-slate-600">Please check your URL.</p>
        </div>
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-4 text-center">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Company account unavailable.</h1>
          <p className="mt-2 text-slate-600">Please contact TalentMesh support.</p>
        </div>
      </div>
    );
  }

  if (wrongTenant) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-4 text-center">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Wrong company portal.</h1>
          <p className="mt-2 text-slate-600">Please open the login URL for your company.</p>
        </div>
      </div>
    );
  }

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}
