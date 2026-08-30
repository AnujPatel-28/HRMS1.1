// @ts-nocheck
// This file runs in Deno (InsForge edge function runtime).

/**
 * Edge Function: kiosk-punch
 *
 * HTTP boundary for the B8 kiosk adapter (a shared tablet in reception/factory floor). No
 * employee JWT is involved -- the tablet itself is the authenticated thing, via a device serial +
 * secret pair issued by hr_register_attendance_device. The employee only ever types their
 * employee_code + kiosk PIN.
 *
 * device_ingest_punch is project_admin ONLY (REVOKEd from authenticated and anon), so this
 * function must hold service credentials -- an ordinary user session cannot reach it at all. The
 * RPC itself re-verifies the device secret and resolves the employee; this function does not
 * duplicate any of that logic, it only translates the call and its result.
 *
 * Required function secrets (already set for this project, same as the other onboarding functions):
 *   INSFORGE_BASE_URL   -- e.g. https://rq3qmu8y.ap-southeast.insforge.app
 *   INSFORGE_ADMIN_KEY  -- falls back to the reserved API_KEY secret (project_admin key)
 */

const BASE_URL = Deno.env.get("INSFORGE_BASE_URL") || Deno.env.get("INSFORGE_URL") || "https://rq3qmu8y.ap-southeast.insforge.app";
const ADMIN_KEY = Deno.env.get("INSFORGE_ADMIN_KEY") || Deno.env.get("API_KEY");

if (!BASE_URL || !ADMIN_KEY) {
  console.warn(
    "[kiosk-punch] Missing env vars INSFORGE_BASE_URL and/or INSFORGE_ADMIN_KEY. " +
    "Ensure they are set in InsForge Dashboard -> Functions -> Secrets."
  );
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

import { createClient } from "npm:@insforge/sdk";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// device_ingest_punch RAISEs one of these bare codes. EMPLOYEE_NOT_RESOLVED deliberately covers
// both "no such employee_code" and "wrong PIN" with the SAME result, so a caller can't tell which
// one was wrong -- map it to ONE combined message and do not add any lookup here that would
// re-introduce that distinction.
const ERROR_MESSAGES = {
  DEVICE_AUTH_FAILED: "This kiosk is not recognized. Please contact HR.",
  DEVICE_INACTIVE: "This kiosk has been deactivated. Please contact HR.",
  MODULE_DISABLED: "Attendance is not enabled for this organization. Please contact HR.",
  EMPLOYEE_NOT_RESOLVED: "Employee code or PIN is incorrect.",
  SOURCE_NOT_ALLOWED: "Punching from this kiosk is not allowed for your shift. Please contact HR.",
  // 20260829170000. Deliberately does NOT say whether the kiosk or the employee is locked, nor
  // for how long: telling an attacker which key they tripped, and when it clears, hands them the
  // schedule for their next attempt.
  LOCKED_OUT: "Too many failed attempts. Please wait a few minutes and try again.",
};

function friendlyMessage(rawCode) {
  const text = typeof rawCode === "string" ? rawCode.trim() : "";
  // Exact match first (the RPC returns bare codes with no extra text -- confirmed live against
  // the deployed function); fall back to a substring check in case the gateway ever wraps them.
  if (ERROR_MESSAGES[text]) return ERROR_MESSAGES[text];
  const found = Object.keys(ERROR_MESSAGES).find((code) => text.includes(code));
  return found ? ERROR_MESSAGES[found] : "Unable to record punch. Please try again or contact HR.";
}

export default async function (request) {
  // OPTIONS must be handled FIRST -- before any other logic -- to avoid CORS errors
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!BASE_URL || !ADMIN_KEY) {
    return json({ success: false, error: "Server configuration error. Missing required environment variables." }, 500);
  }
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const serial = String(body.serial ?? "").trim();
  const secret = String(body.secret ?? "").trim();
  const employeeCode = String(body.employee_code ?? "").trim();
  const pin = String(body.pin ?? "").trim();

  if (!serial || !secret || !employeeCode || !pin) {
    return json({ success: false, error: "serial, secret, employee_code, and pin are required" }, 400);
  }

  const adminClient = createClient({ baseUrl: BASE_URL, anonKey: ADMIN_KEY });

  try {
    const { data, error: rpcError } = await adminClient.database.rpc("device_ingest_punch", {
      p_serial: serial,
      p_secret: secret,
      p_employee_ref: employeeCode,
      p_pin: pin,
    });

    if (rpcError) {
      console.error("[kiosk-punch] device_ingest_punch error:", rpcError);
      return json({ success: false, error: friendlyMessage(rpcError.message) });
    }

    if (!data || data.success === false) {
      return json({ success: false, error: friendlyMessage(data?.error) });
    }

    // Best-effort display name for the kiosk screen. The punch already succeeded above, so a
    // failure here must not turn into a failed punch -- it only loses the friendly name.
    let employeeName = null;
    try {
      const { data: empRow } = await adminClient.database
        .from("employees")
        .select("full_name")
        .eq("id", data.employee_id)
        .maybeSingle();
      employeeName = empRow?.full_name ?? null;
    } catch (lookupErr) {
      console.error("[kiosk-punch] Employee name lookup failed:", lookupErr);
    }

    return json({
      success: true,
      employee_name: employeeName,
      direction: data.direction,
      occurred_at: data.occurred_at,
    });
  } catch (err) {
    console.error("[kiosk-punch] Uncaught exception:", err);
    return json({ success: false, error: "Unable to record punch. Please try again or contact HR." }, 500);
  }
}
