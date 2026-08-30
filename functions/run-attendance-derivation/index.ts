/**
 * B1 -- the scheduled derivation trigger.
 *
 * Deliberately thin. All orchestration -- which tenants, which shifts, the per-tenant business
 * date, the lookback window, run-row bookkeeping, per-shift error isolation -- lives in
 * attendance_run_scheduled_derivation. Doing it here instead would mean one HTTP round trip per
 * shift, run bookkeeping split across separate calls that can fail independently, and D9 timezone
 * logic sitting a network hop away from the tenant row it depends on. An earlier draft of this
 * function did exactly that; the logic moved into SQL in 20260829200000 and this is what is left.
 *
 * AUTH -- the thing that blocked B1 for several sessions:
 * hr_run_attendance_derivation opens with assert_hr_for_tenant, which raises when auth.uid() IS
 * NULL. A scheduled invocation has no end-user JWT, so it could never call it. The admin key maps
 * to project_admin, which is exactly what attendance_run_scheduled_derivation requires and what no
 * API role has. Same pattern the onboarding functions and kiosk-punch already use.
 *
 * CALLER AUTH. Unlike kiosk-punch -- which is deliberately open because the device credentials
 * ARE the authentication -- this function takes no user input and performs privileged writes
 * across EVERY tenant. Left open, anyone who learned the URL could force derivation runs at will
 * and read back tenant and run identifiers from the summary. So it requires a shared trigger
 * token, supplied by the schedule as a header and compared against a function secret.
 *
 * Required function secrets: INSFORGE_BASE_URL, INSFORGE_ADMIN_KEY (falls back to API_KEY),
 * DERIVATION_TRIGGER_TOKEN.
 */

import { createClient } from "npm:@insforge/sdk";

const BASE_URL = Deno.env.get("INSFORGE_BASE_URL");
const ADMIN_KEY = Deno.env.get("INSFORGE_ADMIN_KEY") || Deno.env.get("API_KEY");

// Re-derive the last few days, not just today. Events arrive late -- a biometric unit that was
// offline syncs its backlog with true timestamps -- so days already derived can change (E15).
// Pass 1 is idempotent and skips is_locked rows, so repeating is safe.
const DEFAULT_LOOKBACK_DAYS = 2;

const TRIGGER_TOKEN = Deno.env.get("DERIVATION_TRIGGER_TOKEN");

/** Length-independent comparison, so a wrong token cannot be narrowed by timing. */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function (request: Request) {
  if (!BASE_URL || !ADMIN_KEY) {
    return json({ success: false, error: "Missing INSFORGE_BASE_URL or admin key secret." }, 500);
  }

  // Refuse before doing anything else. A missing secret fails CLOSED -- an unconfigured deploy
  // must not silently become an open endpoint.
  if (!TRIGGER_TOKEN) {
    console.error("[run-attendance-derivation] DERIVATION_TRIGGER_TOKEN is not set; refusing.");
    return json({ success: false, error: "Trigger not configured." }, 503);
  }
  const presented = request.headers.get("x-trigger-token") || "";
  if (!tokensMatch(presented, TRIGGER_TOKEN)) {
    return json({ success: false, error: "Forbidden" }, 403);
  }

  // A schedule invokes with no body. Allow an explicit lookback for a manual catch-up run.
  let lookback = DEFAULT_LOOKBACK_DAYS;
  try {
    const body = await request.json();
    if (body && Number.isInteger(body.lookback_days)) lookback = body.lookback_days;
  } catch {
    // No body, or not JSON. Expected for a scheduled call.
  }

  const client = createClient({ baseUrl: BASE_URL, anonKey: ADMIN_KEY });

  try {
    const { data, error } = await client.database.rpc("attendance_run_scheduled_derivation", {
      p_lookback_days: lookback,
    });

    if (error) {
      // Logged rather than swallowed: a schedule that fails silently is C4, the exact gap B1
      // exists to close.
      console.error("[run-attendance-derivation] failed:", error.message);
      return json({ success: false, error: error.message }, 500);
    }

    console.log("[run-attendance-derivation]", JSON.stringify(data));
    return json(data ?? { success: true });
  } catch (err) {
    console.error("[run-attendance-derivation] unexpected error:", err);
    return json({ success: false, error: String(err) }, 500);
  }
}
