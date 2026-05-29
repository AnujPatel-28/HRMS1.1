// @ts-nocheck
// This file runs in Deno (InsForge edge function runtime).

/**
 * Edge Function: create-employee-user
 *
 * Creates an employee auth user, preserving tenant_id in auth metadata so RLS
 * policies can isolate the user immediately after login.
 */

const BASE_URL = "https://rq3qmu8y.ap-southeast.insforge.app";
const ADMIN_KEY = "ik_aaf7c33902b801271b5ec27017882e87";
const DEFAULT_TENANT_ID = "c3816de9-2222-49d0-842b-8e99613c635a";

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

// New Helper: Get Auth User Details (id and created_at)
const getAuthUserDetailsByEmail = async (email) => {
  const res = await fetch(`${BASE_URL}/api/database/rpc/get_auth_user_details_by_email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify({ user_email: email }),
  });

  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (Array.isArray(data) && data.length > 0) {
    return data[0]; // { id: "...", created_at: "..." }
  }
  return null;
};

// New Helper: Check if email is linked to any employee record
const checkEmployeeRecordExists = async (email) => {
  const res = await fetch(`${BASE_URL}/api/database/rpc/check_employee_exists_by_email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify({ user_email: email }),
  });

  if (!res.ok) return false;
  const data = await res.json().catch(() => false);
  return !!data;
};

const deleteAuthUser = async (userId) => {
  const res = await fetch(`${BASE_URL}/api/auth/users`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify({ userIds: [userId] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[create-employee-user] Delete user failed ${res.status}:`, text);
  }
  return res.ok;
};

const createAuthUser = async (email, password, name, tenantId) => {
  const res = await fetch(`${BASE_URL}/api/auth/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify({
      email,
      password,
      name,
      metadata: { role: "employee", tenant_id: tenantId },
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (res.ok) {
    console.log("[create-employee-user] Auth user created (OTP sent) for:", email);
    return { ok: true };
  }

  console.error(`[create-employee-user] Auth error ${res.status}:`, JSON.stringify(data));
  return {
    ok: false,
    err: data.message ?? data.error ?? `Auth service returned HTTP ${res.status}`,
    status: res.status,
  };
};

export default async function (req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ message: "Method not allowed", error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ message: "Invalid JSON body", error: "Invalid JSON body" }, 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = (body.password ?? "").trim();
  const name = (body.name ?? body.full_name ?? "").trim();
  const tenantId = (body.tenant_id ?? body.metadata?.tenant_id ?? DEFAULT_TENANT_ID).trim();

  if (!email || !password || !name) {
    return json({ message: "email, password, and name are required", error: "email, password, and name are required" }, 400);
  }

  if (!tenantId) {
    return json({ message: "tenant_id is required", error: "tenant_id is required" }, 400);
  }

  // 1. Check if employee record exists globally in public.employees (Cross-Tenant check)
  const employeeExists = await checkEmployeeRecordExists(email);
  if (employeeExists) {
    console.warn(`[create-employee-user] Email ${email} already mapped to an existing employee record.`);
    return json(
      {
        message: "This email is already registered to an employee in the system. Please provide a different email, or ask the employee to use an email alias (e.g., name+company@gmail.com).",
        error: "CROSS_TENANT_EMAIL_CONFLICT",
        code: "CROSS_TENANT_EMAIL_CONFLICT",
      },
      409
    );
  }

  const authDetails = await getAuthUserDetailsByEmail(email);

  if (authDetails) {
    // Check threshold for orphaned auth account deletion (e.g. > 1 hour old)
    const createdAtTime = new Date(authDetails.created_at).getTime();
    const ageInHours = (Date.now() - createdAtTime) / (1000 * 60 * 60);

    if (ageInHours < 1) {
      console.warn(`[create-employee-user] Orphaned auth user ${email} is too new (${ageInHours.toFixed(2)} hours).`);
      return json(
        {
          message: "This email recently started the onboarding process but hasn't finished. Please wait 1 hour before trying again, or use a different email.",
          error: "ORPHANED_AUTH_USER_TOO_NEW",
          code: "ORPHANED_AUTH_USER_TOO_NEW",
        },
        409
      );
    }

    // Safe to delete genuinely orphaned and old auth account
    console.log(`[create-employee-user] Safe to delete orphaned auth user for ${email} (id=${authDetails.id}). Deleting and recreating...`);
    const deleted = await deleteAuthUser(authDetails.id);
    if (!deleted) {
      return json({
        message: `The email \"${email}\" already has an auth account that could not be removed automatically. Please go to InsForge Dashboard > Authentication > Users, delete \"${email}\", and try again.`,
        error: "ORPHANED_AUTH_USER",
        code: "ORPHANED_AUTH_USER",
      }, 409);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const createResult = await createAuthUser(email, password, name, tenantId);

  if (!createResult.ok) {
    return json({ message: createResult.err, error: createResult.err }, createResult.status ?? 500);
  }

  let userId = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    const details = await getAuthUserDetailsByEmail(email);
    if (details) {
      userId = details.id;
      break;
    }
  }

  if (!userId) {
    return json(
      {
        message: "Auth user was created but user ID could not be retrieved. Please try again.",
        error: "USER_ID_NOT_FOUND",
        code: "USER_ID_NOT_FOUND",
      },
      500,
    );
  }

  console.log(`[create-employee-user] Done: userId=${userId}, OTP sent to ${email}`);
  return json({ userId });
}
