import { createClient } from "@insforge/sdk";

const projectUrl = import.meta.env.VITE_INSFORGE_URL as string | undefined;
const apiKey = (import.meta.env.VITE_INSFORGE_ANON_KEY ?? import.meta.env.VITE_INSFORGE_KEY) as string | undefined;
const defaultTenantId = import.meta.env.VITE_DEFAULT_TENANT_ID as string | undefined;

let currentTenantId: string | null = defaultTenantId ?? null;

if (!projectUrl || !apiKey) {
  console.warn("Missing InsForge env vars: VITE_INSFORGE_URL / VITE_INSFORGE_ANON_KEY");
}

const baseInsforge = createClient({
  baseUrl: projectUrl ?? "",
  anonKey: apiKey ?? "",
});

export function setCurrentTenantId(tenantId: string | null) {
  currentTenantId = tenantId ?? defaultTenantId ?? null;
}

export function getCurrentTenantId() {
  return currentTenantId;
}

export function getQueryFilter() {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new Error("Tenant has not been resolved yet.");
  }
  return { tenant_id: tenantId };
}

const withTenantMetadata = (body: unknown) => {
  const tenantId = getCurrentTenantId();
  if (!tenantId || !body || typeof body !== "object" || body instanceof FormData || Array.isArray(body)) {
    return body;
  }

  const record = body as Record<string, unknown>;
  const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
    ? record.metadata as Record<string, unknown>
    : {};

  return {
    ...record,
    tenant_id: record.tenant_id ?? tenantId,
    metadata: {
      ...metadata,
      tenant_id: metadata.tenant_id ?? tenantId,
    },
  };
};

const invokeFunction = baseInsforge.functions.invoke.bind(baseInsforge.functions);

export const functions = {
  invoke: (slug: string, options?: { body?: unknown; [key: string]: unknown }) =>
    invokeFunction(slug, options ? { ...options, body: withTenantMetadata(options.body) } : options),
};

export const insforge = {
  ...baseInsforge,
  functions,
};

const database = baseInsforge.database;
const originalRpc = database.rpc.bind(database);

(database as any).rpc = async (fn: string, args?: Record<string, unknown>) => {
  const res = await originalRpc(fn, args);
  if (
    res.error &&
    (res.error.message?.toLowerCase().includes("invalid token") ||
      res.error.message?.toLowerCase().includes("jwt") ||
      (res.error as any).statusCode === 401)
  ) {
    console.warn(`RPC ${fn} failed due to expired token. Attempting session refresh...`);
    const refresh = await baseInsforge.auth.getCurrentUser();
    if (refresh.data?.user) {
      console.log("Session refreshed successfully. Retrying RPC...");
      return originalRpc(fn, args);
    }
  }
  return res;
};

export const db = database;
export const auth = insforge.auth;
export const storage = insforge.storage;
export const realtime = insforge.realtime;
