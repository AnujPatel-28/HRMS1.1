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

/** Non-employee protected owner; Company Admin is assigned independently. */
export const COMPANY_A_OWNER = Object.freeze({
  authUserId: "a0000000-0000-4000-8004-000000000001",
  email: "owner.a@m1m2.test",
  fullName: "M1M2 Owner A",
  tenant: { id: COMPANY_A_TENANT_ID },
});

/** Normal invitation-path Company Admin with deliberately no employee row. */
export const COMPANY_A_COMPANY_ADMIN = Object.freeze({
  authUserId: "a0000000-0000-4000-8005-000000000001",
  email: "company-admin.a@m1m2.test",
  fullName: "M1M2 Company Admin A",
  tenant: { id: COMPANY_A_TENANT_ID },
});

const EMPLOYEE_PERSONAS = [COMPANY_A_EMPLOYEE, COMPANY_A_HR_EMPLOYEE, COMPANY_B_EMPLOYEE];
const NON_EMPLOYEE_PERSONAS = [COMPANY_A_OWNER, COMPANY_A_COMPANY_ADMIN];
const ALL_PERSONAS = [...EMPLOYEE_PERSONAS, ...NON_EMPLOYEE_PERSONAS];

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

const employeesValues = EMPLOYEE_PERSONAS.map(
  (p) => `('${p.employeeId}'::uuid, '${p.authUserId}'::uuid, '${p.tenant.id}'::uuid, ${sqlStr(p.fullName)}, ${sqlStr(p.email)})`,
).join(", ");

const PRECHECK_SQL = `
SELECT email, id FROM auth.users WHERE email IN (${ALL_PERSONAS.map((p) => sqlStr(p.email)).join(", ")}) AND id NOT IN (${ALL_PERSONAS.map((p) => `'${p.authUserId}'::uuid`).join(", ")})
UNION ALL
SELECT email, id FROM public.employees WHERE email IN (${ALL_PERSONAS.map((p) => sqlStr(p.email)).join(", ")}) AND id NOT IN (${EMPLOYEE_PERSONAS.map((p) => `'${p.employeeId}'::uuid`).join(", ")});
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
),
ins_memberships AS (
  INSERT INTO public.tenant_memberships (
    tenant_id, user_id, employee_id, status, access_version, created_by, updated_by,
    revoked_at, revoked_by, revoke_reason
  )
  SELECT
    p.tenant_id,
    p.user_id,
    p.employee_id,
    'active',
    1,
    p.user_id,
    p.user_id,
    NULL,
    NULL,
    NULL
  FROM (VALUES
    ('${COMPANY_A_EMPLOYEE.tenant.id}'::uuid, '${COMPANY_A_EMPLOYEE.authUserId}'::uuid, '${COMPANY_A_EMPLOYEE.employeeId}'::uuid),
    ('${COMPANY_A_HR_EMPLOYEE.tenant.id}'::uuid, '${COMPANY_A_HR_EMPLOYEE.authUserId}'::uuid, '${COMPANY_A_HR_EMPLOYEE.employeeId}'::uuid),
    ('${COMPANY_B_EMPLOYEE.tenant.id}'::uuid, '${COMPANY_B_EMPLOYEE.authUserId}'::uuid, '${COMPANY_B_EMPLOYEE.employeeId}'::uuid),
    ('${COMPANY_A_OWNER.tenant.id}'::uuid, '${COMPANY_A_OWNER.authUserId}'::uuid, NULL::uuid),
    ('${COMPANY_A_COMPANY_ADMIN.tenant.id}'::uuid, '${COMPANY_A_COMPANY_ADMIN.authUserId}'::uuid, NULL::uuid)
  ) p(tenant_id,user_id,employee_id)
  ON CONFLICT (tenant_id,user_id) DO UPDATE SET
    employee_id=EXCLUDED.employee_id,
    status='active',
    access_version=GREATEST(public.tenant_memberships.access_version,1),
    updated_by=EXCLUDED.updated_by,
    updated_at=clock_timestamp(),
    revoked_at=NULL,
    revoked_by=NULL,
    revoke_reason=NULL
  RETURNING id
),
ins_employee_templates AS (
  INSERT INTO public.membership_template_assignments (membership_id,tenant_id,template_key,assigned_by)
  SELECT md5(p.tenant_id::text || ':' || p.user_id::text)::uuid,p.tenant_id,'employee',p.user_id
  FROM (VALUES
    ('${COMPANY_A_EMPLOYEE.tenant.id}'::uuid, '${COMPANY_A_EMPLOYEE.authUserId}'::uuid),
    ('${COMPANY_A_HR_EMPLOYEE.tenant.id}'::uuid, '${COMPANY_A_HR_EMPLOYEE.authUserId}'::uuid),
    ('${COMPANY_B_EMPLOYEE.tenant.id}'::uuid, '${COMPANY_B_EMPLOYEE.authUserId}'::uuid)
  ) p(tenant_id,user_id)
  ON CONFLICT (membership_id,template_key) DO UPDATE SET
    is_active=true,revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL
  RETURNING membership_id
),
ins_hr_template AS (
  INSERT INTO public.membership_template_assignments (membership_id,tenant_id,template_key,assigned_by)
  VALUES (
    md5('${COMPANY_A_HR_EMPLOYEE.tenant.id}' || ':' || '${COMPANY_A_HR_EMPLOYEE.authUserId}')::uuid,
    '${COMPANY_A_HR_EMPLOYEE.tenant.id}'::uuid,'hr_admin','${COMPANY_A_HR_EMPLOYEE.authUserId}'::uuid
  )
  ON CONFLICT (membership_id,template_key) DO UPDATE SET
    is_active=true,revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL
  RETURNING membership_id
),
ins_admin_templates AS (
  INSERT INTO public.membership_template_assignments (membership_id,tenant_id,template_key,assigned_by)
  SELECT md5(p.tenant_id::text || ':' || p.user_id::text)::uuid,p.tenant_id,'company_admin',p.user_id
  FROM (VALUES
    ('${COMPANY_A_OWNER.tenant.id}'::uuid, '${COMPANY_A_OWNER.authUserId}'::uuid),
    ('${COMPANY_A_COMPANY_ADMIN.tenant.id}'::uuid, '${COMPANY_A_COMPANY_ADMIN.authUserId}'::uuid)
  ) p(tenant_id,user_id)
  ON CONFLICT (membership_id,template_key) DO UPDATE SET
    is_active=true,revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL
  RETURNING membership_id
),
ins_owner AS (
  INSERT INTO public.tenant_ownerships (tenant_id,membership_id,started_by)
  SELECT
    '${COMPANY_A_OWNER.tenant.id}'::uuid,
    md5('${COMPANY_A_OWNER.tenant.id}' || ':' || '${COMPANY_A_OWNER.authUserId}')::uuid,
    '${COMPANY_A_OWNER.authUserId}'::uuid
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tenant_ownerships o
    WHERE o.tenant_id='${COMPANY_A_OWNER.tenant.id}'::uuid AND o.ended_at IS NULL
  )
  RETURNING id
)
SELECT (SELECT count(*) FROM ins_users) AS users_written,
       (SELECT count(*) FROM ins_employees) AS employees_written,
       (SELECT count(*) FROM ins_role) AS role_rows_written,
       (SELECT count(*) FROM ins_memberships) AS memberships_written,
       (SELECT count(*) FROM ins_owner) AS owners_written;
`;

const VERIFY_SQL = `
SELECT
  u.email,
  (u.metadata->>'tenant_id')::uuid AS tenant_id,
  (u.password = crypt(${sqlStr(PASSWORD)}, u.password)) AS password_matches,
  m.tenant_id = (u.metadata->>'tenant_id')::uuid AS metadata_tenant_matches,
  EXISTS (SELECT 1 FROM public.employees e WHERE e.user_id=u.id) AS has_employee_row,
  m.id AS membership_id,
  m.id = md5(m.tenant_id::text || ':' || m.user_id::text)::uuid AS membership_id_matches,
  EXISTS (
    SELECT 1 FROM public.employee_roles r
    JOIN public.employees e ON e.id=r.employee_id
    WHERE e.user_id=u.id AND r.role = 'hr_admin' AND r.is_active
  ) AS has_hr_admin_role,
  EXISTS (
    SELECT 1 FROM public.membership_template_assignments a
    WHERE a.membership_id=m.id AND a.template_key='company_admin' AND a.is_active
  ) AS has_company_admin_template,
  EXISTS (
    SELECT 1 FROM public.tenant_ownerships o
    WHERE o.membership_id=m.id AND o.ended_at IS NULL
  ) AS is_owner
FROM auth.users u
JOIN public.tenant_memberships m ON m.user_id=u.id AND m.tenant_id=(u.metadata->>'tenant_id')::uuid
WHERE u.id IN (${ALL_PERSONAS.map((p) => `'${p.authUserId}'::uuid`).join(", ")})
ORDER BY u.email;
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
      if (!row.membership_id || row.membership_id_matches !== true) {
        throw new HarnessBlockedError(
          "PERSONA_MEMBERSHIP_ID_MISMATCH",
          `${row.email}: membership id does not match the frozen md5 formula.`,
        );
      }
      const expectHr = row.email === COMPANY_A_HR_EMPLOYEE.email;
      if (row.has_hr_admin_role !== expectHr) {
        throw new HarnessBlockedError(
          "PERSONA_HR_GRANT_MISMATCH",
          `${row.email}: hr_admin role state is ${row.has_hr_admin_role}, expected ${expectHr}.`,
        );
      }
      const expectEmployee = EMPLOYEE_PERSONAS.some((persona) => persona.email === row.email);
      if (row.has_employee_row !== expectEmployee) {
        throw new HarnessBlockedError(
          "PERSONA_EMPLOYEE_ASSOCIATION_MISMATCH",
          `${row.email}: employee association is ${row.has_employee_row}, expected ${expectEmployee}.`,
        );
      }
      const expectCompanyAdmin = row.email === COMPANY_A_OWNER.email || row.email === COMPANY_A_COMPANY_ADMIN.email;
      if (row.has_company_admin_template !== expectCompanyAdmin) {
        throw new HarnessBlockedError(
          "PERSONA_COMPANY_ADMIN_MISMATCH",
          `${row.email}: Company Admin state is ${row.has_company_admin_template}, expected ${expectCompanyAdmin}.`,
        );
      }
      if (row.is_owner !== (row.email === COMPANY_A_OWNER.email)) {
        throw new HarnessBlockedError(
          "PERSONA_OWNER_MISMATCH",
          `${row.email}: owner state is ${row.is_owner}.`,
        );
      }
    }

    for (const row of verification) {
      console.log(
        `  ${row.email}: password/tenant/membership ok, employee=${row.has_employee_row}, ` +
          `hr_admin=${row.has_hr_admin_role}, company_admin=${row.has_company_admin_template}, owner=${row.is_owner}.`,
      );
    }
    console.log(
      `M1M2 synthetic personas: 5 login-capable personas present on ${verified.projectName}; ` +
        `Owner and Company Admin deliberately have no employee row.`,
    );
  });
} catch (error) {
  const code = error instanceof HarnessBlockedError ? error.code : "PERSONAS_ERROR";
  console.error(`${code}: ${error.message}`);
  process.exit(1);
}

/**
 * P2-04 addition (2026-09-15): both fixture tenants are born with ZERO `leave_types` and ZERO
 * `leave_balances` (measured live), so AC1/AC3/AC4/AC5/AC7 are untestable without opening data.
 * This is fixture setup, not accrual history: one leave type, opening balances only, no invented
 * usage. `total_allocated`/`balance` are seeded consistently with `used_days = 0` so a
 * no-double-debit retry test has a clean baseline. Idempotent via each table's real unique key
 * (leave_types: tenant_id+code; leave_balances: tenant_id+employee_id+leave_type_id+year).
 */
export const COMPANY_A_LEAVE_TYPE_CL = Object.freeze({
  id: "a0000000-0000-4000-8006-000000000001",
  tenantId: COMPANY_A_TENANT_ID,
  code: "CL",
  name: "P2-04 Casual Leave",
});
export const LEAVE_FIXTURE_YEAR = 2026;
export const LEAVE_OPENING_BALANCE = 12;

const LEAVE_SEED_SQL = `
WITH ins_type AS (
  INSERT INTO public.leave_types (
    id, tenant_id, name, code, days_per_year, accrual_type, min_notice_days, is_active
  )
  VALUES (
    '${COMPANY_A_LEAVE_TYPE_CL.id}'::uuid, '${COMPANY_A_TENANT_ID}'::uuid,
    ${sqlStr(COMPANY_A_LEAVE_TYPE_CL.name)}, ${sqlStr(COMPANY_A_LEAVE_TYPE_CL.code)},
    ${LEAVE_OPENING_BALANCE}, 'lump_sum', 0, true
  )
  ON CONFLICT (tenant_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        days_per_year = EXCLUDED.days_per_year,
        min_notice_days = EXCLUDED.min_notice_days,
        is_active = true
  RETURNING id
),
ins_balances AS (
  INSERT INTO public.leave_balances (
    tenant_id, employee_id, leave_type_id, year, total_allocated, carried_forward, used_days, pending_days, balance
  )
  SELECT
    '${COMPANY_A_TENANT_ID}'::uuid, p.employee_id, '${COMPANY_A_LEAVE_TYPE_CL.id}'::uuid,
    ${LEAVE_FIXTURE_YEAR}, ${LEAVE_OPENING_BALANCE}, 0, 0, 0, ${LEAVE_OPENING_BALANCE}
  FROM (VALUES
    ('${COMPANY_A_EMPLOYEE.employeeId}'::uuid),
    ('${COMPANY_A_HR_EMPLOYEE.employeeId}'::uuid)
  ) p(employee_id)
  ON CONFLICT (tenant_id, employee_id, leave_type_id, year) DO UPDATE
    SET total_allocated = EXCLUDED.total_allocated,
        carried_forward = EXCLUDED.carried_forward,
        used_days = 0,
        pending_days = 0,
        balance = EXCLUDED.balance,
        updated_at = now()
  RETURNING id
)
SELECT (SELECT count(*) FROM ins_type) AS types_written,
       (SELECT count(*) FROM ins_balances) AS balances_written;
`;

const LEAVE_VERIFY_SQL = `
SELECT
  (SELECT count(*) FROM public.leave_types WHERE id = '${COMPANY_A_LEAVE_TYPE_CL.id}'::uuid AND is_active) AS type_active,
  (SELECT count(*) FROM public.leave_balances
     WHERE tenant_id = '${COMPANY_A_TENANT_ID}'::uuid AND leave_type_id = '${COMPANY_A_LEAVE_TYPE_CL.id}'::uuid
       AND year = ${LEAVE_FIXTURE_YEAR} AND balance = ${LEAVE_OPENING_BALANCE} AND used_days = 0) AS balances_clean;
`;

try {
  await guardedMutation("P2-04 leave fixtures (opening balances only)", async (verified) => {
    runSql(LEAVE_SEED_SQL.trim());
    const [check] = rowsOf(runSql(LEAVE_VERIFY_SQL.trim()));
    if (Number(check.type_active) !== 1) {
      throw new HarnessBlockedError(
        "LEAVE_TYPE_SEED_MISMATCH",
        `Expected 1 active leave type ${COMPANY_A_LEAVE_TYPE_CL.code}; found ${check.type_active}.`,
      );
    }
    if (Number(check.balances_clean) !== 2) {
      throw new HarnessBlockedError(
        "LEAVE_BALANCE_SEED_MISMATCH",
        `Expected 2 clean opening balances (employee A, HR+employee A) at ${LEAVE_OPENING_BALANCE}/0 used; found ${check.balances_clean}.`,
      );
    }
    console.log(
      `M1M2 leave fixtures: leave type ${COMPANY_A_LEAVE_TYPE_CL.code} active on ${verified.projectName}; ` +
        `2 opening balances at ${LEAVE_OPENING_BALANCE} days for year ${LEAVE_FIXTURE_YEAR}, used_days=0.`,
    );
  });
} catch (error) {
  const code = error instanceof HarnessBlockedError ? error.code : "PERSONAS_ERROR";
  console.error(`${code}: ${error.message}`);
  process.exit(1);
}
