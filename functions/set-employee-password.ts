// @ts-nocheck
// Edge Function: set-employee-password
// Allows an authenticated HR user to reset an employee password in the same tenant.

import bcrypt from "npm:bcryptjs";

const BASE_URL =
  Deno.env.get("INSFORGE_BASE_URL") ||
  Deno.env.get("INSFORGE_URL") ||
  "https://rq3qmu8y.ap-southeast.insforge.app";

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

export default async function (request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = request.headers.get("Authorization") || "";
  const userToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!userToken) return json({ error: "Unauthorized" }, 401);

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
    return json({ success: true, user_id: userId });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Failed to update password." }, 500);
  }
}
