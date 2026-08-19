/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { db, setCurrentTenantId } from "../insforge/client";
import { useAuth } from "../hooks/useAuth";
import { BASE_DOMAIN } from "../utils/domain";
import { CORE_MODULES, type ModuleKey } from "../modules";

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
  /** True when the module is enabled for this tenant. Core modules are always true. */
  hasModule: (key: ModuleKey) => boolean;
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

const isLocalhost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

/**
 * Parses the hostname to extract the tenant subdomain.
 * Rules for nested subdomain architecture:
 * - hrms.talentmeshsolutions.com -> null (Super admin portal)
 * - www.talentmeshsolutions.com  -> null (Landing page)
 * - talentmeshsolutions.com -> null (Landing page)
 * - localhost -> null (Local development)
 * - abc.hrms.talentmeshsolutions.com -> "abc" (Tenant portal)
 */
const getSubdomain = (hostname: string): string | null => {
  const host = hostname.toLowerCase();

  if (isLocalhost(host)) return null;

  // Local development with tenant subdomains (e.g. talentmesh.localhost)
  if (host.endsWith(".localhost")) {
    const labels = host.split(".");
    if (labels.length === 2) {
      return labels[0]; // Returns "talentmesh"
    }
    return null;
  }

  if (BASE_DOMAIN) {
    // The base domain itself is the super admin / landing host, never a tenant.
    if (host === BASE_DOMAIN || host === `www.${BASE_DOMAIN}`) return null;

    if (host.endsWith(`.${BASE_DOMAIN}`)) {
      // A valid tenant URL has exactly ONE extra label before the base domain.
      const prefix = host.slice(0, -(BASE_DOMAIN.length + 1));
      const tenant = prefix.includes(".") ? null : prefix;

      if (import.meta.env.DEV) {
        console.log(`[Tenant Debug] Detected tenant: "${tenant}" from hostname: "${host}"`);
      }

      return tenant;
    }

    return null;
  }

  // Fallback when VITE_BASE_DOMAIN is not configured. The platform's base host
  // is <app>.<domain>.<tld> (3 labels), so a tenant host carries at least 4.
  // Without this floor, the base host itself resolves to the tenant "hrms".
  const labels = host.split(".").filter(Boolean);
  if (labels.length >= 4 && labels[0] !== "www") return labels[0];
  return null;
};

/**
 * Helper to check if the current hostname belongs to a specific tenant.
 * Returns true for company.hrms.talentmeshsolutions.com
 * Returns false for hrms.talentmeshsolutions.com, talentmeshsolutions.com, localhost
 */
export const isTenantSubdomain = (hostname: string = window.location.hostname): boolean => {
  return getSubdomain(hostname) !== null;
};

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [enabledModules, setEnabledModules] = useState<Set<ModuleKey> | null>(null);
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

    // VITE_DEFAULT_TENANT_ID is a local-development convenience only. On a real
    // host the tenant must come from the subdomain — otherwise the super admin
    // host (and the apex domain) would quietly serve one tenant's portal.
    const defaultTenantId = isLocalhost(hostname)
      ? (import.meta.env.VITE_DEFAULT_TENANT_ID as string | undefined)
      : undefined;

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

    // Entitlements, fetched once per session alongside the tenant. RLS already scopes this to the
    // caller's own tenant (tenant_modules_self_read), so no tenant filter is needed here.
    const { data: moduleRows, error: moduleError } = await db
      .from("tenant_modules")
      .select("module_key")
      .eq("enabled", true);

    if (moduleError) {
      // Fail OPEN, deliberately: the database is the real boundary, so a failed lookup must not
      // black out the whole app. A disabled module's screens will simply come back empty.
      console.warn("Could not load module entitlements; showing all modules.", moduleError);
      setEnabledModules(null);
    } else {
      setEnabledModules(new Set((moduleRows ?? []).map((r) => (r as { module_key: ModuleKey }).module_key)));
    }

    setIsLoading(false);
  }, [authTenantId, role]);

  useEffect(() => {
    void refreshTenant();
  }, [refreshTenant]);

  const hasModule = useCallback(
    (key: ModuleKey) => {
      if (CORE_MODULES.includes(key)) return true;
      // null = entitlements unavailable; show everything rather than hiding the product.
      if (enabledModules === null) return true;
      return enabledModules.has(key);
    },
    [enabledModules],
  );

  const value = useMemo(
    () => ({
      tenant,
      tenantId: tenant?.id ?? "",
      isLoading,
      refreshTenant,
      hasModule,
    }),
    [tenant, isLoading, refreshTenant, hasModule],
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
