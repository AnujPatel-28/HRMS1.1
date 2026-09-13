#!/usr/bin/env node
/**
 * Seeds the synthetic login-capable personas for TB-M1M2's tenants.
 *
 * `seed.mjs` creates the tenants and module entitlement only, deliberately with no auth users or
 * employees. This file adds the people, as its own P1-02-adjacent step. Deterministic by fixed
 * UUIDs; idempotent (re-running changes no observable state — see the password note below).
 *
 * Run with a password supplied via env, never a literal in this file:
 *   M1M2_PERSONA_PASSWORD=<value> node tests/m1m2/fixtures/personas.mjs
 * There is no package.json script for this yet — add one, or invoke directly, as a caller choice.
 *
 * ---- Investigation this file rests on (2026-09-13, live against TB-M1M2) ----
 *
 * 1. `public.employees` has 47 columns; only `full_name`, `email`, `status` (default 'active')
 *    and `work_mode` (default 'office') are NOT NULL, and `tenant_id` is NOT NULL with a DEFAULT
 *    of an unrelated tenant (`c3816de9-2222-49d0-842b-8e99613c635a`) — every insert below passes
 *    `tenant_id` explicitly so that default is never silently relied on.
 *
 * 2. `is_hr()` has two independent sources (both confirmed SQL-settable from this harness, since
 *    `db query` runs as `project_admin`, which holds INSERT/UPDATE on `auth.users`):
 *      (a) auth.users.metadata->>'role' = 'hr' (read live off the row, not frozen at JWT mint time)
 *      (b) an active public.employee_roles row with role = 'hr_admin' for the caller's employee
 *    This file uses ONLY (b) for the composed persona. Per project memory
 *    ("Role has two sources by design" / "never backfill hr_admin"), (a) is the legacy/superadmin
 *    path and new HR grants are meant to go through the employee_roles table — using it here also
 *    means the RLS test actually exercises the table branch of is_hr(), not the JWT branch.
 *    Consequence worth flagging: `create-employee-user` and any other edge function that gates on
 *    `user.metadata?.role === "hr"` will NOT recognize the composed persona as HR — it holds HR
 *    authority at the RLS layer only. If a lane needs an edge-function-capable HR caller, that is
 *    a second, different persona and a caller decision, not something this file should silently do.
 *
 * 3. Auth users CAN be created SQL-only, with no other credential. `auth` schema has exactly:
 *    config, custom_oauth_configs, email_otps, oauth_configs, user_providers, users. Email/password
 *    login is a single `auth.users` row: `user_providers` (the only table that could hold a second
 *    required row) is empty project-wide, including for a known password-login HR user — it is
 *    OAuth-only linkage this app's email/password path never touches. No trigger fires on
 *    `auth.users` insert. So: INSERT id/email/password/email_verified/metadata directly, hashing
 *    with pgcrypto's `crypt(password, gen_salt('bf', 10))` (pgcrypto is installed; existing rows
 *    are `$2a$10$...` bcrypt, the same shape `crypt`/`gen_salt('bf', 10)` produces). No admin key,
 *    anon key or literal password is embedded to do this — only runSql, per the harness contract.
 *
 * Re-running: `gen_salt('bf', 10)` is random per call, so the stored hash text changes on every
 * run even when M1M2_PERSONA_PASSWORD does not. The credential itself does not change — the same
 * password still authenticates — so this counts as idempotent in the sense that matters (login
 * behaviour), not byte-for-byte row equality.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { guardedMutation, HarnessBlockedError, runSql } from "../_harness.mjs";

/**
 * Tenant ids, duplicated from seed.mjs rather than imported from it: seed.mjs's mutation runs
 * unconditionally at module top level (no `import.meta.url` guard like _harness.mjs has), so
 * importing anything from it would re-run its seed on every `personas.mjs` invocation. seed.mjs
 * is out of scope to change, so these two ids are the single exception to "no duplication" here —
 * keep them equal to seed.mjs's COMPANY_A.id / COMPANY_B.id if that file ever changes.
 */
const COMPANY_A_TENANT_ID = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B_TENANT_ID = "b0000000-0000-4000-8000-000000000002";

/**
 * The persona password, from `M1M2_PERSONA_PASSWORD` or, failing that, the git-ignored
 * `tests/m1m2/persona-password.local`.
 *
 * The file fallback exists because the env-var-only form is unusable on this project's primary
 * shell: PowerShell has no `VAR=value cmd` prefix syntax, so `M1M2_PERSONA_PASSWORD=x node …`
 * is a parse error there. The file is matched by `.gitignore`'s `*.local` rule — verified with
 * `git check-ignore` — and is the same convention as `doc/qa/CREDENTIALS.local.md`. Every lane that
 * needs to log in as a persona reads it from there rather than being told the value.
 *
 * Still no invented default: with neither source present this fails closed.
 */
const PASSWORD =
  process.env.M1M2_PERSONA_PASSWORD ||
  (() => {
    try {
      // This file lives in tests/m1m2/fixtures/; the password file sits one level up in tests/m1m2/.
      return readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "persona-password.local"),
        "utf8",
      ).trim();
    } catch {
      return "";
    }
  })();
if (!PASSWORD) {
  console.error(
    "PERSONA_PASSWORD_MISSING: set M1M2_PERSONA_PASSWORD, or write the password to " +
      "tests/m1m2/persona-password.local (git-ignored). No default is invented.",
  );
  process.exit(1);
}

/** Fixed fixture identities. Never reuse these ids for anything else. */
export const COMPANY_A_EMPLOYEE = Object.freeze({
  authUserId: "a0000000-0000-4000-8001-000000000001",
  employeeId: "a0000000-0000-4000-8001-000000000002",
  email: "employee.a@m1m2.test",
  fullName: "M1M2 Employee A",
  tenant: { id: COMPANY_A_TENANT_ID },
});
/** Composed persona: employee AND hr_admin. Tests no-self-approval. */
export const COMPANY_A_HR_EMPLOYEE = Object.freeze({
  authUserId: "a0000000-0000-4000-8002-000000000001",
  employeeId: "a0000000-0000-4000-8002-000000000002",
  roleRowId: "a0000000-0000-4000-8002-000000000003",
  email: "hr-employee.a@m1m2.test",
  fullName: "M1M2 HR+Employee A",
  tenant: { id: COMPANY_A_TENANT_ID },
});
/** Cross-tenant isolation negative. */
export const COMPANY_B_EMPLOYEE = Object.freeze({
  authUserId: "b0000000-0000-4000-8001-000000000001",
  employeeId: "b0000000-0000-4000-8001-000000000002",
  email: "employee.b@m1m2.test",
  fullName: "M1M2 Employee B",
  tenant: { id: COMPANY_B_TENANT_ID },
});

const ALL_PERSONAS = [COMPANY_A_EMPLOYEE, COMPANY_A_HR_EMPLOYEE, COMPANY_B_EMPLOYEE];

function sqlStr(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function metadataJson(tenantId) {
  return sqlStr(JSON.stringify({ role: "employee", tenant_id: tenantId }));
}

const authUsersValues = ALL_PERSONAS.map(
  (p) =>
    `('${p.authUserId}'::uuid, ${sqlStr(p.email)}, crypt(${sqlStr(PASSWORD)}, gen_salt('bf', 10)), true, ${metadataJson(p.tenant.id)}::jsonb)`,
).join(", ");

const employeesValues = ALL_PERSONAS.map(
  (p) => `('${p.employeeId}'::uuid, '${p.authUserId}'::uuid, '${p.tenant.id}'::uuid, ${sqlStr(p.fullName)}, ${sqlStr(p.email)})`,
).join(", ");

const PRECHECK_SQL = `
SELECT email, id FROM auth.users WHERE email IN (${ALL_PERSONAS.map((p) => sqlStr(p.email)).join(", ")}) AND id NOT IN (${ALL_PERSONAS.map((p) => `'${p.authUserId}'::uuid`).join(", ")})
UNION ALL
SELECT email, id FROM public.employees WHERE email IN (${ALL_PERSONAS.map((p) => sqlStr(p.email)).join(", ")}) AND id NOT IN (${ALL_PERSONAS.map((p) => `'${p.employeeId}'::uuid`).join(", ")});
`;

const SEED_SQL = `
WITH seeded_users(id, email, password, email_verified, metadata) AS (VALUES ${authUsersValues}),
ins_users AS (
  INSERT INTO auth.users (id, email, password, email_verified, metadata)
  SELECT id, email, password, email_verified, metadata FROM seeded_users
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        password = EXCLUDED.password,
        email_verified = EXCLUDED.email_verified,
        metadata = EXCLUDED.metadata
  RETURNING id
),
seeded_employees(id, user_id, tenant_id, full_name, email) AS (VALUES ${employeesValues}),
ins_employees AS (
  INSERT INTO public.employees (id, user_id, tenant_id, full_name, email)
  SELECT id, user_id, tenant_id, full_name, email FROM seeded_employees
  ON CONFLICT (id) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        tenant_id = EXCLUDED.tenant_id,
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email
  RETURNING id
),
ins_role AS (
  INSERT INTO public.employee_roles (id, tenant_id, employee_id, role, scope_type, is_active)
  VALUES (
    '${COMPANY_A_HR_EMPLOYEE.roleRowId}'::uuid,
    '${COMPANY_A_HR_EMPLOYEE.tenant.id}'::uuid,
    '${COMPANY_A_HR_EMPLOYEE.employeeId}'::uuid,
    'hr_admin', 'tenant', true
  )
  ON CONFLICT (id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        employee_id = EXCLUDED.employee_id,
        role = EXCLUDED.role,
        scope_type = EXCLUDED.scope_type,
        is_active = true
  RETURNING id
)
SELECT (SELECT count(*) FROM ins_users) AS users_written,
       (SELECT count(*) FROM ins_employees) AS employees_written,
       (SELECT count(*) FROM ins_role) AS role_rows_written;
`;

const VERIFY_SQL = `
SELECT
  e.email,
  e.tenant_id,
  (u.password = crypt(${sqlStr(PASSWORD)}, u.password)) AS password_matches,
  (u.metadata->>'tenant_id')::uuid = e.tenant_id AS metadata_tenant_matches,
  EXISTS (
    SELECT 1 FROM public.employee_roles r
    WHERE r.employee_id = e.id AND r.role = 'hr_admin' AND r.is_active
  ) AS has_hr_admin_role
FROM public.employees e
JOIN auth.users u ON u.id = e.user_id
WHERE e.id IN (${ALL_PERSONAS.map((p) => `'${p.employeeId}'::uuid`).join(", ")})
ORDER BY e.email;
`;

function rowsOf(result) {
  return result?.rows ?? result?.data?.rows ?? [];
}

try {
  await guardedMutation("M1M2 synthetic personas", async (verified) => {
    const tenantCheck = rowsOf(
      runSql(
        `SELECT id FROM public.tenants WHERE id IN ('${COMPANY_A_TENANT_ID}'::uuid, '${COMPANY_B_TENANT_ID}'::uuid)`,
      ),
    );
    if (tenantCheck.length !== 2) {
      throw new HarnessBlockedError(
        "PERSONAS_TENANTS_MISSING",
        "Both fixture tenants must exist before personas; run test:m1m2:seed first.",
      );
    }

    const collisions = rowsOf(runSql(PRECHECK_SQL.trim()));
    if (collisions.length > 0) {
      throw new HarnessBlockedError(
        "PERSONA_EMAIL_COLLISION",
        `Persona email(s) already in use under a different id: ${collisions.map((r) => r.email).join(", ")}.`,
      );
    }

    runSql(SEED_SQL.trim());

    const verification = rowsOf(runSql(VERIFY_SQL.trim()));
    if (verification.length !== ALL_PERSONAS.length) {
      throw new HarnessBlockedError(
        "PERSONA_VERIFY_MISSING_ROW",
        `Expected ${ALL_PERSONAS.length} personas after seeding; found ${verification.length}.`,
      );
    }
    for (const row of verification) {
      if (row.password_matches !== true) {
        throw new HarnessBlockedError(
          "PERSONA_PASSWORD_MISMATCH",
          `${row.email}: stored hash does not match M1M2_PERSONA_PASSWORD.`,
        );
      }
      if (row.metadata_tenant_matches !== true) {
        throw new HarnessBlockedError(
          "PERSONA_TENANT_METADATA_MISMATCH",
          `${row.email}: auth.users metadata.tenant_id does not match employees.tenant_id; RLS would deny this persona everything.`,
        );
      }
      const expectHr = row.email === COMPANY_A_HR_EMPLOYEE.email;
      if (row.has_hr_admin_role !== expectHr) {
        throw new HarnessBlockedError(
          "PERSONA_HR_GRANT_MISMATCH",
          `${row.email}: hr_admin role state is ${row.has_hr_admin_role}, expected ${expectHr}.`,
        );
      }
    }

    for (const row of verification) {
      console.log(`  ${row.email}: password ok, tenant metadata ok, hr_admin=${row.has_hr_admin_role}.`);
    }
    console.log(
      `M1M2 synthetic personas: 3 login-capable personas present on ${verified.projectName} ` +
        `(${COMPANY_A_EMPLOYEE.email}, ${COMPANY_A_HR_EMPLOYEE.email} [hr_admin], ${COMPANY_B_EMPLOYEE.email}).`,
    );
  });
} catch (error) {
  const code = error instanceof HarnessBlockedError ? error.code : "PERSONAS_ERROR";
  console.error(`${code}: ${error.message}`);
  process.exit(1);
}
