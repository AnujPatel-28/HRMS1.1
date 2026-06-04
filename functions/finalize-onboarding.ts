// @ts-nocheck
// Edge Function: finalize-onboarding
// Updates the onboarding state to 'active' once the employee row is inserted.

import { createClient } from "npm:@insforge/sdk";

const BASE_URL = Deno.env.get("INSFORGE_BASE_URL") || Deno.env.get("INSFORGE_URL") || "https://rq3qmu8y.ap-southeast.insforge.app";
const ADMIN_KEY = Deno.env.get("INSFORGE_ADMIN_KEY") || Deno.env.get("API_KEY");

if (!BASE_URL || !ADMIN_KEY) {
  console.warn("[finalize-onboarding] Missing env vars BASE_URL or ADMIN_KEY.");
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const logAudit = async (tenantId, actorId, actorRole, action, targetType, targetId, details) => {
  try {
    const client = createClient({ baseUrl: BASE_URL, anonKey: ADMIN_KEY });
    await client.database.from("audit_logs").insert([{
      tenant_id: tenantId,
      actor_id: actorId,
      actor_role: actorRole,
      action,
      target_type: targetType,
      target_id: targetId,
      details
    }]);
  } catch (e) {
    console.error("[finalize-onboarding] Audit log failed", e);
  }
};

export default async function (request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!BASE_URL || !ADMIN_KEY) {
    return json({ error: "Server configuration error. Missing required environment variables." }, 500);
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = request.headers.get("Authorization") || "";
  const userToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!userToken) return json({ error: "Unauthorized" }, 401);

  let actorId = null;
  let actorRole = "unknown";
  let actorTenant = null;
  
  if (userToken) {
    const client = createClient({ baseUrl: BASE_URL, edgeFunctionToken: userToken });
    const { data: userData } = await client.auth.getCurrentUser();
    const user = userData?.user;
    if (user) {
      actorId = user.id;
      actorRole = user.metadata?.role || user.user_metadata?.role || user.app_metadata?.role || "unknown";
      actorTenant = user.metadata?.tenant_id || user.user_metadata?.tenant_id || user.app_metadata?.tenant_id || null;
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const tenantId = (body.tenant_id ?? "").trim();

  if (!email || !tenantId) {
    return json({ error: "email and tenant_id are required" }, 400);
  }

  if (actorRole !== "hr" || actorTenant !== tenantId) {
    return json({ error: "Forbidden" }, 403);
  }

  // Rate limiting
  if (tenantId && actorId) {
    const client = createClient({ baseUrl: BASE_URL, edgeFunctionToken: userToken });
    const { data: rateLimitOk, error: rateLimitErr } = await client.database.rpc("check_rate_limit", {
      p_tenant_id: tenantId,
      p_user_id: actorId,
      p_endpoint: 'finalize-onboarding',
      p_max_requests: 20,
      p_window_interval: '1 hour'
    });

    if (rateLimitErr || rateLimitOk === false) {
      return json({ error: "Rate limit exceeded. Please try again later." }, 429);
    }
  }

  const adminClient = createClient({ baseUrl: BASE_URL, anonKey: ADMIN_KEY });

  // Get auth user ID from email
  let targetAuthUserId = null;
  try {
    const authUsersRes = await fetch(`${BASE_URL}/api/database/rpc/get_auth_user_details_by_email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_KEY}` },
      body: JSON.stringify({ user_email: email })
    });
    const authData = await authUsersRes.json();
    if (Array.isArray(authData) && authData.length > 0) targetAuthUserId = authData[0].id;
  } catch (e) {
    console.error("Failed to get auth user ID for finalize-onboarding");
  }

  if (!targetAuthUserId) {
    return json({ error: "Auth user not found for this email" }, 404);
  }

  // Update onboarding state
  const { error: updateErr } = await adminClient.database.from("employee_onboarding")
    .update({ status: 'active' })
    .eq('auth_user_id', targetAuthUserId)
    .eq('tenant_id', tenantId);
    
  if (updateErr) {
    console.error("[finalize-onboarding] Update failed", updateErr);
    return json({ error: "Failed to finalize onboarding state" }, 500);
  }

  // Log audit event
  await logAudit(
    tenantId,
    actorId,
    actorRole,
    "employee.onboarding_completed",
    "auth_user",
    targetAuthUserId,
    { email }
  );

  return json({ success: true });
}
