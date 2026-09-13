// @ts-nocheck
import { createClient } from "npm:@insforge/sdk";

const BASE_URL = Deno.env.get("INSFORGE_BASE_URL") || Deno.env.get("INSFORGE_URL");
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

const classify = (message) => {
  if (message.includes("AUTHENTICATION_REQUIRED")) return 401;
  if (
    message.includes("DENIED") ||
    message.includes("REQUIRED") ||
    message.includes("INACTIVE") ||
    message.includes("PROTECTED") ||
    message.includes("MISMATCH") ||
    message.includes("STALE")
  ) return 403;
  if (message.includes("NOT_FOUND") || message.includes("UNKNOWN")) return 404;
  return 400;
};

export default async function (request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!BASE_URL) return json({ error: "Server configuration error" }, 500);

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "ACCESS_AUTHENTICATION_REQUIRED" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const operation = typeof body?.operation === "string" ? body.operation : "";
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
  const expectedAccessVersion = Number.isInteger(body?.expectedAccessVersion)
    ? body.expectedAccessVersion
    : null;
  if (!operation) return json({ error: "operation is required" }, 400);

  const client = createClient({ baseUrl: BASE_URL, edgeFunctionToken: token });
  const { data: current, error: authError } = await client.auth.getCurrentUser();
  if (authError || !current?.user?.id) return json({ error: "ACCESS_AUTHENTICATION_REQUIRED" }, 401);

  const { data, error } = await client.database.rpc("manage_tenant_access", {
    p_operation: operation,
    p_payload: payload,
    p_expected_access_version: expectedAccessVersion,
  });
  if (error) {
    const message = error.message || "ACCESS_OPERATION_FAILED";
    return json({ error: message }, classify(message));
  }
  return json({ data });
}
