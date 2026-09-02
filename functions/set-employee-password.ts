// @ts-nocheck
// Edge Function: set-employee-password
// Allows an authenticated HR user to reset an employee password in the same tenant.

import bcrypt from "npm:bcryptjs";
import { createClient } from "npm:@insforge/sdk";

const BASE_URL =
  Deno.env.get("INSFORGE_BASE_URL") ||
  Deno.env.get("INSFORGE_URL") ||
  "https://rq3qmu8y.ap-southeast.insforge.app";

const ADMIN_KEY = Deno.env.get("INSFORGE_ADMIN_KEY") || Deno.env.get("API_KEY");

if (!BASE_URL || !ADMIN_KEY) {
  console.warn("[set-employee-password] Missing env vars BASE_URL or ADMIN_KEY.");
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

const extractTenantId = (body) => {
  const tenantId = body?.tenant_id ?? body?.metadata?.tenant_id;
  return typeof tenantId === "string" ? tenantId.trim() : "";
};

const parseRpcError = async (res) => {
  const data = await res.json().catch(() => null);
  if (data?.message) return data.message;
  if (data?.error) return data.error;
  return `Password update failed with HTTP ${res.status}`;
};

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
    console.error("[set-employee-password] Audit log failed", e);
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
  
  if (userToken) {
    const client = createClient({ baseUrl: BASE_URL, edgeFunctionToken: userToken });
    const { data: userData } = await client.auth.getCurrentUser();
    const user = userData?.user;
    if (user) {
      actorId = user.id;
      actorRole = user.metadata?.role || user.user_metadata?.role || user.app_metadata?.role || "unknown";
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = (body.password ?? "").trim();
  const tenantId = extractTenantId(body);

  if (!email || !password || !tenantId) {
    return json({ error: "email, password, and tenant_id are required" }, 400);
  }

  if (password.length < 8) {
    return json({ error: "Password must be at least 8 characters." }, 400);
  }

  if (tenantId && actorId) {
    const client = createClient({ baseUrl: BASE_URL, edgeFunctionToken: userToken });
    const { data: rateLimitOk, error: rateLimitErr } = await client.database.rpc("check_rate_limit", {
      p_tenant_id: tenantId,
      p_user_id: actorId,
      p_endpoint: 'set-employee-password',
      p_max_requests: 20,
      p_window_interval: '1 hour'
    });

    // Same defect create-employee-user had: a FAILED check and a HIT limit are different
    // failures and must not share a message. Collapsing them is what disguised a missing
    // EXECUTE grant as "Rate limit exceeded" and hid a hard block for weeks.
    if (rateLimitErr) {
      return json({
        error: `Rate limit check failed: ${rateLimitErr.message ?? String(rateLimitErr)}`,
      }, 500);
    }

    if (rateLimitOk === false) {
      return json({ error: "Rate limit exceeded. Please try again later." }, 429);
    }
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const rpcRes = await fetch(`${BASE_URL}/api/database/rpc/set_employee_password_by_hr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        target_email: email,
        target_password_hash: passwordHash,
        tenant_uuid: tenantId,
      }),
    });

    if (!rpcRes.ok) {
      return json({ error: await parseRpcError(rpcRes) }, rpcRes.status);
    }

    const userId = await rpcRes.json().catch(() => null);
    
    // Update onboarding state
    if (userId) {
      try {
        const client = createClient({ baseUrl: BASE_URL, anonKey: ADMIN_KEY });
        await client.database.from("employee_onboarding")
          .update({ status: 'password_set' })
          .eq('auth_user_id', userId)
          .eq('tenant_id', tenantId);
      } catch (e) {
        console.error("[set-employee-password] Onboarding status update failed", e);
      }
    }

    // Log audit event
    await logAudit(
      tenantId,
      actorId,
      actorRole,
      "employee.password_set",
      "auth_user",
      userId,
      { email }
    );
    
    return json({ success: true, user_id: userId });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Failed to update password." }, 500);
  }
}
