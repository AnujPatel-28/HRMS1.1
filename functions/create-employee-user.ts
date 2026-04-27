// @ts-nocheck
// This file runs in Deno (InsForge edge function runtime).
// `Deno.*` globals and `npm:` imports are valid Deno syntax.

/**
 * Edge Function: create-employee-user
 *
 * How it works:
 *  1. POST /api/auth/users  → creates the auth user
 *     (InsForge returns {"accessToken":null,"requireEmailVerification":true} — no userId)
 *  2. POST /api/database/rpc/get_user_id_by_email  → looks up the userId from auth.users
 *  3. Returns { userId } to the frontend
 *     (The frontend then does the DB insert under the HR user's session)
 *
 * Handles orphaned accounts (409) by finding and deleting them via the
 * list endpoint, then retrying creation.
 */

const BASE_URL  = "https://rq3qmu8y.ap-southeast.insforge.app";
const ADMIN_KEY = "ik_aaf7c33902b801271b5ec27017882e87";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/** Create the auth user via the public signup endpoint */
const createAuthUser = async (email, password, name) => {
  const res = await fetch(`${BASE_URL}/api/auth/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify({ email, password, name, autoConfirm: true, metadata: { role: "employee" } }),
  });

  const data = await res.json().catch(() => ({}));

  if (res.ok) {
    // InsForge returns {"accessToken":null,"requireEmailVerification":true} — no userId.
    // We look it up via RPC in the next step.
    console.log("[create-employee-user] Auth user created for:", email);
    return { ok: true };
  }

  console.error(`[create-employee-user] Auth error ${res.status}:`, JSON.stringify(data));
  return {
    ok: false,
    err: data.message ?? data.error ?? `Auth service returned HTTP ${res.status}`,
    status: res.status,
  };
};

/** Look up the user's ID from auth.users via SECURITY DEFINER RPC */
const getUserIdByEmail = async (email) => {
  const res = await fetch(`${BASE_URL}/api/database/rpc/get_user_id_by_email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify({ user_email: email }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[create-employee-user] RPC lookup failed ${res.status}:`, errText);
    return null;
  }

  const userId = await res.json().catch(() => null);
  // PostgREST RPC returning a scalar returns the value directly
  return typeof userId === "string" ? userId : null;
};

export default async function (req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const email    = (body.email    ?? "").trim().toLowerCase();
  const password = (body.password ?? "").trim();
  const name     = (body.name ?? body.full_name ?? "").trim();

  if (!email || !password || !name) {
    return json({ error: "email, password, and name are required" }, 400);
  }

  // ── Step 1: Check if the user already exists in auth.users ──
  const existingId = await getUserIdByEmail(email);

  if (existingId) {
    // Orphaned auth user exists — return a clear error
    return json(
      {
        error: `The email "${email}" already has an auth account from a previous failed attempt. ` +
               `Go to InsForge Dashboard → Authentication → Users, delete "${email}", then try again.`,
        code: "ORPHANED_AUTH_USER",
      },
      409
    );
  }

  // ── Step 2: Create the auth user ──
  const createResult = await createAuthUser(email, password, name);

  if (!createResult.ok) {
    if (createResult.status === 409) {
      // Race condition — someone else created it between our check and creation
      return json(
        {
          error: `The email "${email}" already has an auth account. ` +
                 `Delete it from InsForge Dashboard → Authentication → Users, then try again.`,
          code: "ORPHANED_AUTH_USER",
        },
        409
      );
    }
    return json({ error: createResult.err }, createResult.status ?? 500);
  }

  // ── Step 3: Look up the userId via RPC (since signup doesn't return it) ──
  // Brief retry to allow InsForge to commit the new user row
  let userId = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 300 * attempt));
    userId = await getUserIdByEmail(email);
    if (userId) break;
  }

  if (!userId) {
    return json(
      {
        error: "Auth user was created but user ID could not be retrieved. Please try again.",
        code: "USER_ID_NOT_FOUND",
      },
      500
    );
  }

  console.log(`[create-employee-user] Success: userId=${userId}`);
  return json({ userId });
}
