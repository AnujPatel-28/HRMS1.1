/**
 * Single source of truth for tenant hostnames.
 *
 * Tenants live at `<subdomain>.<BASE_DOMAIN>` (e.g. acme.hrms.talentmeshsolutions.com).
 * There is no wildcard domain yet, so every subdomain is added by hand in Vercel
 * and GoDaddy after the tenant is created in the Super Admin Console.
 */

export const BASE_DOMAIN = (import.meta.env.VITE_BASE_DOMAIN as string | undefined)
  ?.trim()
  .toLowerCase()
  .replace(/^\.+|\.+$/g, "") || undefined;

/** CNAME target Vercel expects for a subdomain. */
export const VERCEL_CNAME_TARGET = "cname.vercel-dns.com";

/**
 * Labels that must never be handed to a tenant: they either collide with the
 * platform's own hosts or with common infrastructure records. Kept in sync with
 * the `tenants_subdomain_shape_check` constraint.
 */
export const RESERVED_SUBDOMAINS = new Set([
  "www", "admin", "api", "app", "hrms", "mail", "smtp", "imap", "pop",
  "ns1", "ns2", "mx", "cdn", "static", "assets", "blog", "docs", "help",
  "support", "status", "dev", "staging", "test", "demo", "portal",
  "dashboard", "login", "auth", "account", "accounts", "billing",
  "payments", "webhook", "webhooks", "vercel", "insforge", "talentmesh",
  "talentmeshsolutions", "superadmin", "root", "system", "internal",
  "secure", "vpn", "git", "my",
]);

export const SUBDOMAIN_MIN_LENGTH = 3;
export const SUBDOMAIN_MAX_LENGTH = 30;

/** Strips anything a subdomain cannot contain. Does not validate — see validateSubdomain. */
export function normalizeSubdomain(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, SUBDOMAIN_MAX_LENGTH);
}

export function slugifyCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SUBDOMAIN_MAX_LENGTH);
}

/** Returns a human-readable problem with the subdomain, or null when it is usable. */
export function validateSubdomain(value: string): string | null {
  if (!value) return "Subdomain is required.";
  if (value.length < SUBDOMAIN_MIN_LENGTH) return `Must be at least ${SUBDOMAIN_MIN_LENGTH} characters.`;
  if (value.length > SUBDOMAIN_MAX_LENGTH) return `Must be ${SUBDOMAIN_MAX_LENGTH} characters or fewer.`;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value)) {
    return "Use lowercase letters, numbers and hyphens only, and don't start or end with a hyphen.";
  }
  if (value.includes("--")) return "Cannot contain two hyphens in a row.";
  if (RESERVED_SUBDOMAINS.has(value)) return `"${value}" is reserved by the platform.`;
  return null;
}

/** Full hostname for a tenant, e.g. "acme.hrms.talentmeshsolutions.com". */
export function tenantHost(subdomain: string): string | null {
  if (!BASE_DOMAIN || !subdomain) return null;
  return `${subdomain}.${BASE_DOMAIN}`;
}

/** Login URL for a tenant, e.g. "https://acme.hrms.talentmeshsolutions.com". */
export function tenantUrl(subdomain: string): string | null {
  const host = tenantHost(subdomain);
  return host ? `https://${host}` : null;
}

/**
 * The DNS record name to create in GoDaddy. GoDaddy manages the apex zone
 * (talentmeshsolutions.com), so the record name is the tenant host with the
 * root domain stripped — "acme.hrms" for acme.hrms.talentmeshsolutions.com.
 * Assumes a two-label root domain, which is the case for talentmeshsolutions.com.
 */
export function dnsRecordName(subdomain: string): string | null {
  const host = tenantHost(subdomain);
  if (!host) return null;
  const labels = host.split(".");
  return labels.length > 2 ? labels.slice(0, labels.length - 2).join(".") : null;
}

/** The apex zone the record belongs to, e.g. "talentmeshsolutions.com". */
export function rootDomain(): string | null {
  if (!BASE_DOMAIN) return null;
  const labels = BASE_DOMAIN.split(".");
  return labels.length >= 2 ? labels.slice(-2).join(".") : BASE_DOMAIN;
}
