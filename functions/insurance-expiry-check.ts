// @ts-nocheck - Deno runtime file, not compiled by the Vite TypeScript toolchain
import { createClient } from "npm:@insforge/sdk";

const BASE_URL = Deno.env.get("INSFORGE_BASE_URL") || Deno.env.get("INSFORGE_URL");
const ADMIN_KEY = Deno.env.get("INSFORGE_ADMIN_KEY") || Deno.env.get("API_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (!BASE_URL || !ADMIN_KEY) {
    return new Response(JSON.stringify({ error: "Missing INSFORGE_BASE_URL or INSFORGE_ADMIN_KEY secrets." }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const client = createClient({ baseUrl: BASE_URL, anonKey: ADMIN_KEY });

  try {
    console.log("Invoking fn_check_insurance_expiries stored procedure...");

    // Execute the stored procedure which runs as SECURITY DEFINER
    const { data, error } = await client.database.rpc("fn_check_insurance_expiries");

    if (error) throw error;

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Insurance expiry check completed successfully via RPC."
    }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("insurance-expiry-check execution error:", err);
    return new Response(JSON.stringify({ error: err.message || err.toString() }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
}
