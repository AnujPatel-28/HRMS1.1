// @ts-nocheck
// This file runs in Deno (InsForge edge function runtime).

const BASE_URL  = Deno.env.get("INSFORGE_BASE_URL") || Deno.env.get("INSFORGE_URL") || "https://rq3qmu8y.ap-southeast.insforge.app";
const ADMIN_KEY = Deno.env.get("INSFORGE_ADMIN_KEY") || Deno.env.get("API_KEY");

if (!BASE_URL || !ADMIN_KEY) {
  console.warn("[verify-employee-code] Missing env vars BASE_URL or ADMIN_KEY.");
}

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

import { createClient } from "npm:@insforge/sdk";

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
    console.error("[verify-employee-code] Audit log failed", e);
  }
};

export default async function (req) {
  // ⚠️ OPTIONS must be handled FIRST — before any other logic — to avoid CORS errors
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!BASE_URL || !ADMIN_KEY) {
    return json({ error: "Server configuration error. Missing required environment variables." }, 500);
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const email = (body.email ?? "").trim().toLowerCase();
  const otp   = (body.otp   ?? "").trim();

  // Extract caller info to authorize and log the action
  const authHeader = req.headers.get("Authorization");
  let callerToken = "";
  if (authHeader) callerToken = authHeader.replace(/^Bearer\s+/i, "");

  let actorId = null;
  let actorRole = "unknown";
  let tenantId = null;
  let callerClient = null;

  if (callerToken) {
    callerClient = createClient({ baseUrl: BASE_URL, edgeFunctionToken: callerToken });
    const { data: userData } = await callerClient.auth.getCurrentUser();
    const user = userData?.user;
    if (user) {
      actorId = user.id;
      actorRole = user.metadata?.role || user.user_metadata?.role || user.app_metadata?.role || "unknown";
      tenantId = user.metadata?.tenant_id || user.user_metadata?.tenant_id || user.app_metadata?.tenant_id || null;
    }
  }

  if (!email || !otp) {
    return json({ error: "email and otp are required" }, 400);
  }

  if (!actorId || !tenantId || !callerClient) return json({ error: "Unauthorized" }, 401);
  const { data: callerIsHr, error: callerIsHrError } = await callerClient.database.rpc("is_hr");
  if (callerIsHrError) return json({ error: "HR authority check failed." }, 503);
  if (callerIsHr !== true) return json({ error: "Forbidden. Only HR may verify employee codes." }, 403);

  let targetAuthUserId = null;
  try {
    const targetRes = await fetch(`${BASE_URL}/api/database/rpc/get_auth_user_details_by_email_v2`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_KEY}` },
      body: JSON.stringify({ user_email: email }),
    });
    const targetRows = await targetRes.json().catch(() => []);
    const target = Array.isArray(targetRows) ? targetRows[0] : null;
    if (!target?.id) return json({ error: "Employee account not found." }, 404);
    if (target.tenant_id !== tenantId) return json({ error: "Forbidden. Cross-tenant target." }, 403);
    targetAuthUserId = target.id;
  } catch {
    return json({ error: "Employee account lookup failed." }, 503);
  }

  if (tenantId && actorId) {
    // Runs on the SERVER client, not the caller's. 20260904120000 revoked EXECUTE on
    // check_rate_limit from `authenticated` (only project_admin holds it), so calling it through
    // the caller's token fails. Do NOT re-grant: the function is caller-parameterised, so an
    // authenticated caller could burn or reset another user's counter. tenantId and actorId below
    // are server-derived from the verified token above, not body input.
    const serverClient = createClient({ baseUrl: BASE_URL, anonKey: ADMIN_KEY });
    const { data: rateLimitOk, error: rateLimitErr } = await serverClient.database.rpc("check_rate_limit", {
      p_tenant_id: tenantId,
      p_user_id: actorId,
      p_endpoint: 'verify-employee-code',
      p_max_requests: 20,
      p_window_interval: '1 hour'
    });

    // A FAILED check and a HIT limit are different failures and must not share a message.
    // Collapsing them is exactly what disguised the missing EXECUTE grant as "Rate limit
    // exceeded" and hid a hard block for weeks — twice.
    if (rateLimitErr) {
      return json({
        error: `Rate limit check failed: ${rateLimitErr.message ?? String(rateLimitErr)}`,
      }, 500);
    }

    if (rateLimitOk === false) {
      return json({ error: "Rate limit exceeded. Please try again later." }, 429);
    }
  }

  if (!/^\d{6}$/.test(otp)) {
    return json({ error: "OTP must be exactly 6 digits" }, 400);
  }

  const url = `${BASE_URL}/api/auth/email/verify`;
  console.log('[verify-employee-code] Calling:', url, 'for:', email);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify({ email, otp }),
  });

  const responseText = await res.clone().text();
  console.log('[verify-employee-code] Status:', res.status);

  let data = {};
  try { data = JSON.parse(responseText); } catch { /* non-JSON response */ }

  if (res.ok) {
    console.log("[verify-employee-code] Success for:", email);
    
    // Log audit event
    if (tenantId) {
      const client = createClient({ baseUrl: BASE_URL, anonKey: ADMIN_KEY });
      
      if (targetAuthUserId) {
        try {
          await client.database.from("employee_onboarding")
            .update({ status: 'otp_verified' })
            .eq('auth_user_id', targetAuthUserId)
            .eq('tenant_id', tenantId);
        } catch (e) {
          console.error("[verify-employee-code] Onboarding status update failed", e);
        }
      }

      await logAudit(
        tenantId,
        actorId,
        actorRole,
        "employee.otp_verified",
        "email",
        email,
        { email }
      );
    }
    
    return json({ success: true });
  }

  console.error(`[verify-employee-code] Error ${res.status}:`, responseText);
  return json({
    error: data.message ?? data.error ?? `Verification failed (HTTP ${res.status})`,
    debug_status: res.status,
  }, 400);
}
