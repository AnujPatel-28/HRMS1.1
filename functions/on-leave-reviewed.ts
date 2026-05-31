// @ts-nocheck - Deno runtime file, not compiled by the Vite/Node TypeScript toolchain
import { createClient } from "npm:@insforge/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  return new Response(
    JSON.stringify({ error: "Deprecated. Leave approval is handled by the approve_leave_request SQL RPC." }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
