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
  if (message.includes("INVALID") || message.includes("EXPIRED") || message.includes("ALREADY_USED")) return 400;
  if (message.includes("MISMATCH") || message.includes("REQUIRED") || message.includes("INACTIVE")) return 403;
  if (message.includes("NOT_FOUND")) return 404;
  return 400;
};

export default async function (request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!BASE_URL) return json({ error: "Server configuration error" }, 500);

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "INVITATION_AUTHENTICATION_REQUIRED" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const client = createClient({ baseUrl: BASE_URL, edgeFunctionToken: token });
  const { data: current, error: authError } = await client.auth.getCurrentUser();
  if (authError || !current?.user?.id) return json({ error: "INVITATION_AUTHENTICATION_REQUIRED" }, 401);

  const isOwnerTransfer = typeof body?.ownerTransferId === "string";
  const rpc = isOwnerTransfer ? "accept_owner_transfer" : "accept_tenant_invitation";
  const args = isOwnerTransfer
    ? { p_transfer_id: body.ownerTransferId }
    : { p_token: typeof body?.token === "string" ? body.token : "" };
  const { data, error } = await client.database.rpc(rpc, args);
  if (error) {
    const message = error.message || "INVITATION_ACCEPT_FAILED";
    return json({ error: message }, classify(message));
  }
  return json({ data });
}
