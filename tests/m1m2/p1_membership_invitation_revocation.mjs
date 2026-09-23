#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@insforge/sdk";

import { guardedMutation, runSql } from "./_harness.mjs";
import { TB_M1M2 } from "./_target.mjs";

const COMPANY_A_TENANT_ID = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B_TENANT_ID = "b0000000-0000-4000-8000-000000000002";
const LEGACY_HR_ID = "a0000000-0000-4000-8003-000000000001";
const LEGACY_HR_EMAIL = "legacy-hr.a@m1m2.test";
const SMOKE_EMPLOYEE_EMAIL = "onboarding-smoke.a@m1m2.test";
const OWNER = Object.freeze({
  id: "a0000000-0000-4000-8004-000000000001",
  email: "owner.a@m1m2.test",
});
const COMPANY_ADMIN = Object.freeze({
  id: "a0000000-0000-4000-8005-000000000001",
  email: "company-admin.a@m1m2.test",
});
const EMPLOYEE_A = Object.freeze({
  id: "a0000000-0000-4000-8001-000000000001",
  employeeId: "a0000000-0000-4000-8001-000000000002",
  email: "employee.a@m1m2.test",
});
const HR_A = Object.freeze({
  id: "a0000000-0000-4000-8002-000000000001",
  employeeId: "a0000000-0000-4000-8002-000000000002",
  email: "hr-employee.a@m1m2.test",
});
const EMPLOYEE_B = Object.freeze({
  id: "b0000000-0000-4000-8001-000000000001",
  email: "employee.b@m1m2.test",
});
const PENDING_LEAVE_ID = "83f1421d-1977-4f20-9587-71070844b9b2";

const membershipId = (tenantId, userId) => {
  // PostgreSQL's md5(text)::uuid formats the 32 hex characters as 8-4-4-4-12.
  const hex = createHash("md5").update(`${tenantId}:${userId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const TEMPLATE_GRANTS = Object.freeze({
  company_admin: {
    company: [
      "access.manage",
      "designation.manage",
      "membership.employee_associate",
      "membership.invite",
      "membership.read",
      "membership.revoke",
      "org.manage",
      "org.read",
      "reporting.manage",
    ],
  },
  hr_admin: {
    company: [
      "attendance.approve", "attendance.correct", "attendance.read", "device.manage",
      "employee.basic.read", "employee.export", "employee.sensitive.read", "employee.write",
      "leave.approve", "leave.configure", "leave.read", "org.read", "policy.configure",
      "policy.publish", "policy.read", "shift.manage", "shift.read", "task.assign", "task.review",
      // contracts.md §16 A1 (user decision 2026-09-21, migration 189200).
      "channel.manage", "project.read",
    ],
  },
  manager: {
    company: ["org.read", "policy.read"],
    direct_reports: ["attendance.approve", "attendance.read", "employee.basic.read", "leave.read", "task.assign", "task.review"],
  },
  employee: {
    channel: ["channel.read", "message.send"],
    company: ["feed.post", "feed.read", "org.read", "policy.read"],
    project: ["project.read", "task.submit"],
    self: [
      "attendance.correction.request", "attendance.read", "employee.basic.read", "employee.write",
      "leave.read", "leave.request", "policy.acknowledge", "policy.read", "shift.read", "task.submit",
    ],
  },
  project_manager: {
    company: ["org.read"],
    project: ["project.manage", "project.members.manage", "project.read", "task.assign", "task.review"],
  },
  communication_moderator: {
    channel: ["channel.manage", "channel.read", "message.moderate", "message.send"],
    // channel.manage@company: contracts.md §16 A1 (channel creation needs a company-scope action).
    company: ["channel.manage", "feed.moderate", "feed.post", "feed.read"],
  },
});

const PASSWORD =
  process.env.M1M2_PERSONA_PASSWORD ||
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "persona-password.local"), "utf8").trim();

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

function messageOf(error) {
  return [error?.code, error?.message, error?.error, error?.statusCode, error?.details]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" | ");
}

function rowsOf(result) {
  return result?.rows ?? result?.data?.rows ?? [];
}

function readBranchAnonKey() {
  const cli = join(repoRoot, "node_modules", "@insforge", "cli", "dist", "index.js");
  const result = spawnSync(process.execPath, [cli, "secrets", "get", "ANON_KEY", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, "Could not read TB-M1M2 ANON_KEY; raw CLI output suppressed");
  const start = result.stdout.indexOf("{");
  assert.notEqual(start, -1, "ANON_KEY response contained no JSON");
  const payload = JSON.parse(result.stdout.slice(start));
  assert.equal(payload.key, "ANON_KEY");
  assert.ok(payload.value);
  return payload.value;
}

async function signIn(persona, anonKey) {
  const client = createClient({
    baseUrl: TB_M1M2.baseUrl,
    functionsUrl: TB_M1M2.functionsUrl,
    anonKey,
  });
  const { data, error } = await client.auth.signInWithPassword({ email: persona.email, password: PASSWORD });
  assert.equal(error, null, `${persona.email}: ${messageOf(error)}`);
  assert.equal(data?.user?.id, persona.id, `${persona.email}: unexpected identity`);
  return client;
}

function noError(result, label) {
  assert.equal(result.error, null, `${label}: ${messageOf(result.error)}`);
  return result.data;
}

function expectError(result, pattern, label) {
  assert.ok(result.error, `${label}: unexpectedly succeeded`);
  const fingerprint = messageOf(result.error);
  assert.match(fingerprint, pattern, `${label}: unexpected denial: ${fingerprint}`);
  return fingerprint;
}

async function invokeAccess(client, operation, payload = {}, expectedAccessVersion) {
  const result = await client.functions.invoke("manage-tenant-access", {
    method: "POST",
    body: { operation, payload, expectedAccessVersion },
  });
  if (result.error) return result;
  return { data: result.data?.data ?? result.data, error: null };
}

async function acceptInvitation(client, body) {
  const result = await client.functions.invoke("accept-tenant-invitation", { method: "POST", body });
  if (result.error) return result;
  return { data: result.data?.data ?? result.data, error: null };
}

async function countCompanyAEmployees(client) {
  return (noError(
    await client.database.from("employees").select("id").eq("tenant_id", COMPANY_A_TENANT_ID),
    "Company A employee read",
  ) ?? []).length;
}

function assertTemplateCatalog() {
  const actualRows = rowsOf(runSql(
    "SELECT template_key, action, scope_type FROM public.access_template_grants ORDER BY template_key, scope_type, action",
  ));
  const expectedRows = [];
  for (const [template_key, scopes] of Object.entries(TEMPLATE_GRANTS)) {
    for (const [scope_type, actions] of Object.entries(scopes)) {
      for (const action of actions) expectedRows.push({ template_key, action, scope_type });
    }
  }
  const normalize = (rows) => rows
    .map(({ template_key, action, scope_type }) => ({ template_key, action, scope_type }))
    .sort((a, b) => `${a.template_key}|${a.scope_type}|${a.action}`.localeCompare(`${b.template_key}|${b.scope_type}|${b.action}`));
  assert.deepEqual(normalize(actualRows), normalize(expectedRows), "fixed template matrix drifted");
}

async function runMembershipInvitationRevocation() {
  await guardedMutation("P1-02 membership/invitation/revocation", async (verified) => {
    const anonKey = readBranchAnonKey();
    const companyAdminMembershipId = membershipId(COMPANY_A_TENANT_ID, COMPANY_ADMIN.id);

    // Restore a deterministic pre-invitation state without touching either tenant's employee fixtures.
    runSql(`
      DELETE FROM public.tenant_owner_transfers
      WHERE tenant_id='${COMPANY_A_TENANT_ID}'::uuid
        AND (source_membership_id='${companyAdminMembershipId}'::uuid OR target_membership_id='${companyAdminMembershipId}'::uuid);
      DELETE FROM public.tenant_ownerships WHERE membership_id='${companyAdminMembershipId}'::uuid;
      DELETE FROM public.tenant_invitations
      WHERE tenant_id='${COMPANY_A_TENANT_ID}'::uuid
        AND lower(email) IN (lower(${sqlString(COMPANY_ADMIN.email)}), lower(${sqlString(EMPLOYEE_A.email)}), lower(${sqlString(EMPLOYEE_B.email)}));
      DELETE FROM public.membership_template_assignments WHERE membership_id='${companyAdminMembershipId}'::uuid;
      DELETE FROM public.tenant_memberships WHERE id='${companyAdminMembershipId}'::uuid;
      UPDATE auth.users SET metadata='{"role":"employee","tenant_id":"${COMPANY_A_TENANT_ID}"}'::jsonb
      WHERE id='${COMPANY_ADMIN.id}'::uuid;
    `.trim());

    assertTemplateCatalog();
    runSql(`
      DO $test$
      BEGIN
        PERFORM public.write_access_audit(
          '${COMPANY_A_TENANT_ID}'::uuid,
          '${OWNER.id}'::uuid,
          'access.invalid_target_test',
          'tenant_membership',
          'not-a-uuid',
          '{}'::jsonb
        );
        RAISE EXCEPTION 'expected ACCESS_AUDIT_TARGET_ID_INVALID';
      EXCEPTION
        WHEN SQLSTATE 'P1001' THEN
          IF SQLERRM <> 'ACCESS_AUDIT_TARGET_ID_INVALID' THEN RAISE; END IF;
      END
      $test$;
    `.trim());
    const owner = await signIn(OWNER, anonKey);
    const employeeA = await signIn(EMPLOYEE_A, anonKey);
    const hrA = await signIn(HR_A, anonKey);
    const employeeB = await signIn(EMPLOYEE_B, anonKey);
    const companyAdmin = await signIn(COMPANY_ADMIN, anonKey);

    assert.equal(await countCompanyAEmployees(employeeA), 1, "employee persona RLS changed");
    assert.equal(await countCompanyAEmployees(hrA), 2, "HR persona RLS changed");
    assert.equal(await countCompanyAEmployees(employeeB), 0, "cross-tenant persona RLS changed");

    const ownerSummary = noError(await owner.database.rpc("get_my_capability_summary"), "owner capability");
    assert.equal(ownerSummary.employeeId, null);
    assert.equal(ownerSummary.membershipId, membershipId(COMPANY_A_TENANT_ID, OWNER.id));
    assert.equal(noError(await owner.database.rpc("is_hr"), "owner is_hr"), false);

    const directRoleInsert = await hrA.database.from("employee_roles").insert({
      tenant_id: COMPANY_A_TENANT_ID,
      employee_id: EMPLOYEE_A.employeeId,
      role: "manager",
      scope_type: "tenant",
      is_active: true,
    });
    expectError(directRoleInsert, /denied|policy|permission|row-level/i, "HR direct employee_roles insert");
    const roleBefore = rowsOf(runSql(`SELECT is_active FROM public.employee_roles WHERE id='a0000000-0000-4000-8002-000000000003'::uuid`));
    assert.equal(roleBefore[0]?.is_active, true);
    await hrA.database.from("employee_roles").update({ is_active: false }).eq("id", "a0000000-0000-4000-8002-000000000003");
    await hrA.database.from("employee_roles").delete().eq("id", "a0000000-0000-4000-8002-000000000003");
    const roleAfter = rowsOf(runSql(`SELECT is_active FROM public.employee_roles WHERE id='a0000000-0000-4000-8002-000000000003'::uuid`));
    assert.equal(roleAfter.length, 1, "HR directly deleted its employee_roles row");
    assert.equal(roleAfter[0].is_active, true, "HR directly updated its employee_roles row");

    const forgedAudit = await employeeA.database.from("audit_logs").insert({
      tenant_id: COMPANY_A_TENANT_ID,
      actor_id: HR_A.id,
      actor_role: "hr_admin",
      action: "access.membership_revoked",
      target_type: "tenant_membership",
      target_id: membershipId(COMPANY_A_TENANT_ID, OWNER.id),
      details: { forged: true },
    });
    const forgedAuditDenial = expectError(forgedAudit, /denied|policy|permission|row-level/i, "forged access audit");

    const created = noError(await invokeAccess(owner, "invitation.create", {
      email: COMPANY_ADMIN.email,
      templateKey: "company_admin",
      scopeType: "company",
      expiresInHours: 24,
    }), "create company-admin invitation");
    assert.ok(created.invitationId && created.token);
    const ownerAudit = rowsOf(runSql(`
      SELECT actor_id, details->>'actor_user_id' AS actor_user_id,
             details->>'actor_membership_id' AS actor_membership_id
      FROM public.audit_logs
      WHERE tenant_id='${COMPANY_A_TENANT_ID}'::uuid
        AND action='access.invitation_created'
        AND target_id='${created.invitationId}'::uuid
    `.trim()));
    assert.equal(ownerAudit.length, 1, "owner invitation did not write exactly one audit row");
    assert.equal(ownerAudit[0].actor_id, null, "non-employee audit actor_id must be null");
    assert.equal(ownerAudit[0].actor_user_id, OWNER.id);
    assert.equal(ownerAudit[0].actor_membership_id, membershipId(COMPANY_A_TENANT_ID, OWNER.id));

    const hrMembershipId = membershipId(COMPANY_A_TENANT_ID, HR_A.id);
    noError(await invokeAccess(owner, "template.assign", {
      membershipId: hrMembershipId,
      templateKey: "company_admin",
      reason: "audit actor semantics acceptance test",
    }), "temporarily grant HR access management");
    const employeeActorInvite = noError(await invokeAccess(hrA, "invitation.create", {
      email: "audit-actor.a@m1m2.test",
      templateKey: "employee",
      scopeType: "company",
    }), "employee actor invitation");
    const employeeActorAudit = rowsOf(runSql(`
      SELECT actor_id, details->>'actor_user_id' AS actor_user_id
      FROM public.audit_logs
      WHERE tenant_id='${COMPANY_A_TENANT_ID}'::uuid
        AND action='access.invitation_created'
        AND target_id='${employeeActorInvite.invitationId}'::uuid
    `.trim()));
    assert.equal(employeeActorAudit.length, 1, "employee invitation did not write exactly one audit row");
    assert.equal(employeeActorAudit[0].actor_id, HR_A.employeeId, "audit actor_id is not the employee id");
    assert.equal(employeeActorAudit[0].actor_user_id, HR_A.id);
    noError(await invokeAccess(owner, "template.revoke", {
      membershipId: hrMembershipId,
      templateKey: "company_admin",
      reason: "audit actor semantics acceptance test complete",
    }), "remove temporary HR access management");

    expectError(
      await acceptInvitation(companyAdmin, {
        token: `${created.token.slice(0, -1)}${created.token.endsWith("0") ? "1" : "0"}`,
      }),
      /INVALID|400/i,
      "tampered invitation",
    );
    const accepted = noError(await acceptInvitation(companyAdmin, { token: created.token }), "accept invitation");
    assert.equal(accepted.membershipId, companyAdminMembershipId);
    expectError(await acceptInvitation(companyAdmin, { token: created.token }), /ALREADY_USED|400/i, "invitation replay");

    const wrongTenantInvite = noError(await invokeAccess(owner, "invitation.create", {
      email: EMPLOYEE_B.email,
      templateKey: "company_admin",
      scopeType: "company",
    }), "create wrong-tenant invitation");
    expectError(await acceptInvitation(employeeB, { token: wrongTenantInvite.token }), /MISMATCH|403/i, "wrong-tenant invitation");

    const expiringInvite = noError(await invokeAccess(owner, "invitation.create", {
      email: EMPLOYEE_A.email,
      templateKey: "company_admin",
      scopeType: "company",
    }), "create expiring invitation");
    runSql(`UPDATE public.tenant_invitations SET invited_at=clock_timestamp()-interval '2 hours', expires_at=clock_timestamp()-interval '1 hour' WHERE id='${expiringInvite.invitationId}'::uuid`);
    expectError(await acceptInvitation(employeeA, { token: expiringInvite.token }), /EXPIRED|400/i, "expired invitation");

    const adminSummary = noError(await companyAdmin.database.rpc("get_my_capability_summary"), "company admin capability");
    assert.equal(adminSummary.employeeId, null);
    assert.equal(adminSummary.membershipId, companyAdminMembershipId);
    assert.deepEqual(adminSummary.responsibilities, ["company_admin"]);
    const expectedCompanyAdminGrants = TEMPLATE_GRANTS.company_admin.company.map((action) => ({ action, scopeType: "company" }));
    assert.deepEqual(
      [...adminSummary.grants].sort((a, b) => a.action.localeCompare(b.action)),
      [...expectedCompanyAdminGrants].sort((a, b) => a.action.localeCompare(b.action)),
    );
    assert.equal(noError(await companyAdmin.database.rpc("is_hr"), "company admin is_hr"), false);
    assert.equal(
      noError(await companyAdmin.database.rpc("has_access_action", { p_action: "org.manage", p_scope_type: "company", p_scope_id: null }), "company scope"),
      true,
    );
    assert.equal(
      noError(await companyAdmin.database.rpc("has_access_action", { p_action: "org.manage", p_scope_type: "self", p_scope_id: null }), "cross-scope denial"),
      false,
    );

    for (const [templateKey, action, scopeType] of [
      ["hr_admin", "leave.approve", "company"],
      ["manager", "task.review", "direct_reports"],
      ["project_manager", "project.manage", "project"],
      ["communication_moderator", "message.moderate", "channel"],
    ]) {
      noError(await invokeAccess(owner, "template.assign", {
        membershipId: companyAdminMembershipId,
        templateKey,
        reason: "association-required acceptance test",
      }), `assign ${templateKey}`);
      expectError(
        await companyAdmin.database.rpc("assert_access_action", {
          p_action: action,
          p_scope_type: scopeType,
          p_expected_access_version: null,
        }),
        /EMPLOYEE_ASSOCIATION_REQUIRED|P1001/i,
        `${templateKey} without employee association`,
      );
    }
    const noEmployee = rowsOf(runSql(`SELECT id FROM public.employees WHERE user_id='${COMPANY_ADMIN.id}'::uuid`));
    assert.equal(noEmployee.length, 0, "operational template fabricated an employee");

    for (const [table, row, changes] of [
      ["org_units", { id: "a0000000-0000-4000-8010-000000000001", tenant_id: COMPANY_A_TENANT_ID, name: "P1-02 Unit", unit_type: "department" }, { name: "P1-02 Unit Updated" }],
      ["job_titles", { id: "a0000000-0000-4000-8010-000000000002", tenant_id: COMPANY_A_TENANT_ID, title: "P1-02 Title" }, { title: "P1-02 Title Updated" }],
      ["locations", { id: "a0000000-0000-4000-8010-000000000003", tenant_id: COMPANY_A_TENANT_ID, name: "P1-02 Location" }, { name: "P1-02 Location Updated" }],
      ["employment_types", { id: "a0000000-0000-4000-8010-000000000004", tenant_id: COMPANY_A_TENANT_ID, name: "P1-02 Type", code: "P102" }, { name: "P1-02 Type Updated" }],
    ]) {
      runSql(`DELETE FROM public.${table} WHERE id='${row.id}'::uuid`);
      noError(await companyAdmin.database.from(table).insert(row), `${table} insert by Company Admin`);
      noError(await companyAdmin.database.from(table).update(changes).eq("id", row.id), `${table} update by Company Admin`);
      noError(await companyAdmin.database.from(table).delete().eq("id", row.id), `${table} delete by Company Admin`);
    }

    expectError(
      await companyAdmin.database.rpc("approve_leave_request", {
        p_leave_id: PENDING_LEAVE_ID,
        p_working_dates: null,
        p_approved_business_days: null,
      }),
      // PENDING_LEAVE_ID is in tenant da7a0000, not Company A: P2-04 answers a cross-tenant leave with
      // P1003 APPROVAL_SUBJECT_UNAVAILABLE rather than revealing it. Still a denial. Since C10 the
      // answer is the same whatever the leave's status, or whether it exists at all, so this check
      // no longer depends on that QA leave staying pending.
      /Forbidden|HR|denied|P1001|APPROVAL_SUBJECT_UNAVAILABLE/i,
      "Company Admin leave approval",
    );

    expectError(
      await hrA.database.rpc("set_employee_password_by_hr", {
        target_email: EMPLOYEE_B.email,
        target_password_hash: "not-a-real-hash",
        tenant_uuid: COMPANY_B_TENANT_ID,
      }),
      /Forbidden|tenant|denied/i,
      "cross-tenant password reset",
    );
    expectError(
      await hrA.functions.invoke("create-employee-user", {
        method: "POST",
        body: { email: "cross-tenant-create@m1m2.test", password: PASSWORD, name: "Denied", tenant_id: COMPANY_B_TENANT_ID },
      }),
      /Forbidden|tenant|denied|403/i,
      "cross-tenant employee account creation",
    );
    expectError(
      await hrA.functions.invoke("set-employee-password", {
        method: "POST",
        body: { email: EMPLOYEE_B.email, password: PASSWORD, tenant_id: COMPANY_B_TENANT_ID },
      }),
      /Forbidden|tenant|denied|403/i,
      "cross-tenant password edge function",
    );

    const beforeAudit = Number(rowsOf(runSql(`SELECT count(*)::int AS count FROM public.audit_logs WHERE tenant_id='${COMPANY_A_TENANT_ID}'::uuid AND action='access.membership_revoked' AND target_id=${sqlString(companyAdminMembershipId)}`))[0]?.count ?? 0);
    const revoked = noError(await invokeAccess(owner, "membership.revoke", {
      membershipId: companyAdminMembershipId,
      reason: "revocation freshness acceptance test",
    }), "revoke company admin");
    assert.equal(revoked.status, "revoked");
    const afterAudit = Number(rowsOf(runSql(`SELECT count(*)::int AS count FROM public.audit_logs WHERE tenant_id='${COMPANY_A_TENANT_ID}'::uuid AND action='access.membership_revoked' AND target_id=${sqlString(companyAdminMembershipId)}`))[0]?.count ?? 0);
    assert.equal(afterAudit, beforeAudit + 1, "revoke did not write exactly one server audit row");
    const retry = noError(await invokeAccess(owner, "membership.revoke", {
      membershipId: companyAdminMembershipId,
      reason: "revocation freshness acceptance test",
    }), "retry revoke");
    assert.equal(retry.idempotent, true);
    const afterRetryAudit = Number(rowsOf(runSql(`SELECT count(*)::int AS count FROM public.audit_logs WHERE tenant_id='${COMPANY_A_TENANT_ID}'::uuid AND action='access.membership_revoked' AND target_id=${sqlString(companyAdminMembershipId)}`))[0]?.count ?? 0);
    assert.equal(afterRetryAudit, afterAudit, "idempotent revoke duplicated the audit row");

    expectError(await companyAdmin.database.rpc("list_tenant_access"), /INACTIVE|DENIED|P1001/i, "revoked token database/RPC");
    expectError(await invokeAccess(companyAdmin, "invitation.create", {
      email: "nobody@m1m2.test", templateKey: "company_admin", scopeType: "company",
    }), /INACTIVE|DENIED|403/i, "revoked token edge function");

    console.log(`Verified target: ${verified.projectName} (${verified.projectId})`);
    console.log("Persona Company A employee rows rechecked: employee=1, HR+employee=2, Company B=0.");
    console.log(`Membership PK ${companyAdminMembershipId} equals md5(tenant_id || ':' || user_id)::uuid.`);
    console.log("Audit actor semantics passed: employee actor_id uses employee id; non-employee actor_id is null with user/membership ids in details.");
    console.log(`Forged access audit denied: ${forgedAuditDenial}`);
    console.log("Invitation tamper/replay/expiry/wrong-tenant checks passed; non-employee operational templates returned association-required.");
    console.log("Revoked old token denied on database/RPC and edge function; private storage (P3-04) and realtime (P3-03) revocation are covered by p3_private_buckets and p3_realtime_isolation.");
  });
}

async function invokeOk(client, slug, body) {
  const { data, error } = await client.functions.invoke(slug, { method: "POST", body });
  assert.equal(error, null, `${slug}: ${messageOf(error)}`);
  assert.ok(data && typeof data === "object", `${slug}: expected a JSON response`);
  return data;
}

async function runOnboardingBaseline(phase = "before-state") {
  await guardedMutation(`P1-02 AC12 ${phase}`, async () => {
    runSql(`
      DELETE FROM public.tenant_ownerships
      WHERE membership_id IN (
        SELECT m.id FROM public.tenant_memberships m
        JOIN auth.users u ON u.id=m.user_id
        WHERE lower(u.email)=lower(${sqlString(SMOKE_EMPLOYEE_EMAIL)})
      );
      DELETE FROM public.membership_template_assignments
      WHERE membership_id IN (
        SELECT m.id FROM public.tenant_memberships m
        JOIN auth.users u ON u.id=m.user_id
        WHERE lower(u.email)=lower(${sqlString(SMOKE_EMPLOYEE_EMAIL)})
      );
      DELETE FROM public.tenant_memberships
      WHERE user_id IN (
        SELECT id FROM auth.users WHERE lower(email)=lower(${sqlString(SMOKE_EMPLOYEE_EMAIL)})
      );
      DELETE FROM auth.users WHERE lower(email) = lower(${sqlString(SMOKE_EMPLOYEE_EMAIL)});
      INSERT INTO auth.users (id, email, password, email_verified, metadata)
      VALUES (
        '${LEGACY_HR_ID}'::uuid,
        ${sqlString(LEGACY_HR_EMAIL)},
        crypt(${sqlString(PASSWORD)}, gen_salt('bf', 10)),
        true,
        '{"role":"hr","tenant_id":"${COMPANY_A_TENANT_ID}"}'::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        password = EXCLUDED.password,
        email_verified = EXCLUDED.email_verified,
        metadata = EXCLUDED.metadata;
      DELETE FROM public.rate_limits
      WHERE tenant_id = '${COMPANY_A_TENANT_ID}'::uuid
        AND user_id = '${LEGACY_HR_ID}'::uuid
        AND endpoint IN ('create-employee-user', 'set-employee-password');
    `.trim());

    const client = createClient({
      baseUrl: TB_M1M2.baseUrl,
      functionsUrl: TB_M1M2.functionsUrl,
    });
    const { data: login, error: loginError } = await client.auth.signInWithPassword({
      email: LEGACY_HR_EMAIL,
      password: PASSWORD,
    });
    assert.equal(loginError, null, `legacy HR sign-in: ${messageOf(loginError)}`);
    assert.ok(login?.accessToken, "legacy HR sign-in returned no access token");

    const created = await invokeOk(client, "create-employee-user", {
      email: SMOKE_EMPLOYEE_EMAIL,
      password: PASSWORD,
      name: "P1-02 Onboarding Smoke",
      tenant_id: COMPANY_A_TENANT_ID,
    });
    assert.ok(created.userId, "create-employee-user returned no userId");

    const passwordSet = await invokeOk(client, "set-employee-password", {
      email: SMOKE_EMPLOYEE_EMAIL,
      password: PASSWORD,
      tenant_id: COMPANY_A_TENANT_ID,
    });
    assert.equal(passwordSet.success, true, "set-employee-password did not report success");

    console.log(
      `P1-02 AC12 ${phase} passed: create-employee-user and ` +
        "set-employee-password both completed without a rate-limit-check failure.",
    );
  });
}

if (process.argv.includes("--baseline") || process.argv.includes("--after")) {
  await runOnboardingBaseline(process.argv.includes("--after") ? "after-state" : "before-state");
} else {
  await runMembershipInvitationRevocation();
}
