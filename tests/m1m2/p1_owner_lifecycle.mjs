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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PASSWORD = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "persona-password.local"), "utf8").trim();
const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const OWNER = { id: "a0000000-0000-4000-8004-000000000001", email: "owner.a@m1m2.test" };
const COMPANY_ADMIN = { id: "a0000000-0000-4000-8005-000000000001", email: "company-admin.a@m1m2.test" };
const PLATFORM_ADMIN = { id: "f0000000-0000-4000-8000-000000000001", email: "platform-repair@m1m2.test" };
const OWNERLESS = {
  tenantId: "c0000000-0000-4000-8000-000000000003",
  userId: "c0000000-0000-4000-8001-000000000001",
  email: "ownerless-legacy-hr@m1m2.test",
};
const BOOTSTRAP = {
  tenantId: "d0000000-0000-4000-8000-000000000004",
  email: "bootstrap-admin@m1m2.test",
  secondEmail: "bootstrap-second-admin@m1m2.test",
};
const PENDING_LEAVE_ID = "83f1421d-1977-4f20-9587-71070844b9b2";

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
const membershipId = (tenantId, userId) => {
  const hex = createHash("md5").update(`${tenantId}:${userId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const rowsOf = (result) => result?.rows ?? result?.data?.rows ?? [];
const messageOf = (error) => [error?.code, error?.message, error?.error, error?.statusCode, error?.details]
  .filter((value) => value !== undefined && value !== null && value !== "")
  .join(" | ");

function readBranchAnonKey() {
  const cli = join(repoRoot, "node_modules", "@insforge", "cli", "dist", "index.js");
  const result = spawnSync(process.execPath, [cli, "secrets", "get", "ANON_KEY", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, "Could not read TB-M1M2 ANON_KEY; raw CLI output suppressed");
  const start = result.stdout.indexOf("{");
  assert.notEqual(start, -1);
  return JSON.parse(result.stdout.slice(start)).value;
}

async function signIn(persona, anonKey) {
  const client = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey });
  const { data, error } = await client.auth.signInWithPassword({ email: persona.email, password: PASSWORD });
  assert.equal(error, null, `${persona.email}: ${messageOf(error)}`);
  if (persona.id) assert.equal(data?.user?.id, persona.id, `${persona.email}: unexpected identity`);
  return { client, user: data.user };
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

async function manage(client, operation, payload = {}) {
  const result = await client.functions.invoke("manage-tenant-access", {
    method: "POST",
    body: { operation, payload },
  });
  return result.error ? result : { data: result.data?.data ?? result.data, error: null };
}

async function acceptTransfer(client, transferId) {
  const result = await client.functions.invoke("accept-tenant-invitation", {
    method: "POST",
    body: { ownerTransferId: transferId },
  });
  return result.error ? result : { data: result.data?.data ?? result.data, error: null };
}

function activeOwners(tenantId) {
  return rowsOf(runSql(`
    SELECT o.membership_id
    FROM public.tenant_ownerships o
    WHERE o.tenant_id='${tenantId}'::uuid AND o.ended_at IS NULL
    ORDER BY o.started_at
  `.trim()));
}

function assertOnlyOwner(tenantId, expectedMembershipId, label) {
  const owners = activeOwners(tenantId);
  assert.equal(owners.length, 1, `${label}: expected exactly one active owner`);
  assert.equal(owners[0].membership_id, expectedMembershipId, `${label}: wrong active owner`);
}

async function exerciseCompanyConfiguration(client, tenantId, prefix) {
  for (const [table, row] of [
    ["org_units", { id: `${prefix}0000000-0000-4000-8010-000000000001`, tenant_id: tenantId, name: "Bootstrap Unit", unit_type: "department" }],
    ["job_titles", { id: `${prefix}0000000-0000-4000-8010-000000000002`, tenant_id: tenantId, title: "Bootstrap Title" }],
    ["locations", { id: `${prefix}0000000-0000-4000-8010-000000000003`, tenant_id: tenantId, name: "Bootstrap Location" }],
    ["employment_types", { id: `${prefix}0000000-0000-4000-8010-000000000004`, tenant_id: tenantId, name: "Bootstrap Type", code: "BOOT" }],
  ]) {
    runSql(`DELETE FROM public.${table} WHERE id='${row.id}'::uuid`);
    noError(await client.database.from(table).insert(row), `${table} bootstrap insert`);
    noError(await client.database.from(table).delete().eq("id", row.id), `${table} bootstrap delete`);
  }
}

await guardedMutation("P1-02 owner lifecycle", async (verified) => {
  const ownerMembershipId = membershipId(COMPANY_A, OWNER.id);
  const companyAdminMembershipId = membershipId(COMPANY_A, COMPANY_ADMIN.id);
  const ownerlessMembershipId = membershipId(OWNERLESS.tenantId, OWNERLESS.userId);

  runSql(`
    DELETE FROM public.tenant_owner_transfers WHERE tenant_id='${COMPANY_A}'::uuid;
    DELETE FROM public.tenant_ownerships WHERE tenant_id='${COMPANY_A}'::uuid;
    UPDATE public.tenant_memberships
    SET status='active', revoked_at=NULL, revoked_by=NULL, revoke_reason=NULL,
        access_version=access_version+1, updated_at=clock_timestamp()
    WHERE id IN ('${ownerMembershipId}'::uuid,'${companyAdminMembershipId}'::uuid);
    UPDATE public.membership_template_assignments
    SET is_active=true, revoked_at=NULL, revoked_by=NULL, revoke_reason=NULL
    WHERE membership_id='${companyAdminMembershipId}'::uuid AND template_key='company_admin';
    INSERT INTO public.tenant_ownerships (tenant_id,membership_id,started_by)
    VALUES ('${COMPANY_A}'::uuid,'${ownerMembershipId}'::uuid,'${OWNER.id}'::uuid);
  `.trim());
  runSql(`
    DELETE FROM public.audit_logs WHERE tenant_id IN ('${OWNERLESS.tenantId}'::uuid,'${BOOTSTRAP.tenantId}'::uuid);
    DELETE FROM public.tenant_owner_transfers WHERE tenant_id IN ('${OWNERLESS.tenantId}'::uuid,'${BOOTSTRAP.tenantId}'::uuid);
    DELETE FROM public.tenant_ownerships WHERE tenant_id IN ('${OWNERLESS.tenantId}'::uuid,'${BOOTSTRAP.tenantId}'::uuid);
    DELETE FROM public.tenant_invitations WHERE tenant_id IN ('${OWNERLESS.tenantId}'::uuid,'${BOOTSTRAP.tenantId}'::uuid);
    DELETE FROM public.membership_template_assignments WHERE tenant_id IN ('${OWNERLESS.tenantId}'::uuid,'${BOOTSTRAP.tenantId}'::uuid);
    DELETE FROM public.tenant_memberships WHERE tenant_id IN ('${OWNERLESS.tenantId}'::uuid,'${BOOTSTRAP.tenantId}'::uuid);
    DELETE FROM auth.users WHERE id='${OWNERLESS.userId}'::uuid
       OR lower(email) IN (lower(${sqlString(BOOTSTRAP.email)}),lower(${sqlString(BOOTSTRAP.secondEmail)}));
    DELETE FROM public.tenant_modules WHERE tenant_id IN ('${OWNERLESS.tenantId}'::uuid,'${BOOTSTRAP.tenantId}'::uuid);
    DELETE FROM public.tenants WHERE id IN ('${OWNERLESS.tenantId}'::uuid,'${BOOTSTRAP.tenantId}'::uuid);
  `.trim());
  runSql(`
    DELETE FROM public.platform_admins WHERE user_id='${PLATFORM_ADMIN.id}'::uuid;
  `.trim());
  runSql(`
    INSERT INTO auth.users (id,email,password,email_verified,metadata)
    VALUES ('${PLATFORM_ADMIN.id}'::uuid,${sqlString(PLATFORM_ADMIN.email)},crypt(${sqlString(PASSWORD)},gen_salt('bf',10)),true,'{"role":"admin"}'::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      email=EXCLUDED.email,password=EXCLUDED.password,email_verified=true,metadata=EXCLUDED.metadata;
    INSERT INTO auth.users (id,email,password,email_verified,metadata)
    VALUES ('${OWNERLESS.userId}'::uuid,${sqlString(OWNERLESS.email)},crypt(${sqlString(PASSWORD)},gen_salt('bf',10)),true,
      '{"role":"hr","tenant_id":"${OWNERLESS.tenantId}"}'::jsonb);
    INSERT INTO public.platform_admins (user_id,email,role,is_active)
    VALUES ('${PLATFORM_ADMIN.id}'::uuid,${sqlString(PLATFORM_ADMIN.email)},'owner',true);
    INSERT INTO public.tenants (id,company_name,subdomain,status) VALUES
      ('${OWNERLESS.tenantId}'::uuid,'P1-02 Ownerless Fixture','p102-ownerless','active'),
      ('${BOOTSTRAP.tenantId}'::uuid,'P1-02 Bootstrap Fixture','p102-bootstrap','active');
    INSERT INTO public.tenant_memberships
      (tenant_id,user_id,status,access_version,created_by,updated_by)
    VALUES ('${OWNERLESS.tenantId}'::uuid,'${OWNERLESS.userId}'::uuid,'active',1,'${OWNERLESS.userId}'::uuid,'${OWNERLESS.userId}'::uuid);
  `.trim());

  const anonKey = readBranchAnonKey();
  const { client: owner } = await signIn(OWNER, anonKey);
  const { client: companyAdmin } = await signIn(COMPANY_ADMIN, anonKey);
  const { client: platformAdmin } = await signIn(PLATFORM_ADMIN, anonKey);
  const { client: ownerlessHr } = await signIn({ id: OWNERLESS.userId, email: OWNERLESS.email }, anonKey);
  assert.equal(noError(await platformAdmin.database.rpc("is_superadmin"), "platform admin authority"), true);

  assertOnlyOwner(COMPANY_A, ownerMembershipId, "initial state");
  const firstTransfer = noError(await manage(owner, "owner.transfer.begin", {
    targetMembershipId: companyAdminMembershipId,
    reason: "P1-02 atomic transfer test",
  }), "begin owner transfer");
  assertOnlyOwner(COMPANY_A, ownerMembershipId, "pending transfer");
  noError(await acceptTransfer(companyAdmin, firstTransfer.transferId), "accept owner transfer");
  assertOnlyOwner(COMPANY_A, companyAdminMembershipId, "accepted transfer");
  const replay = noError(await acceptTransfer(companyAdmin, firstTransfer.transferId), "replay owner transfer");
  assert.equal(replay.idempotent, true);
  assertOnlyOwner(COMPANY_A, companyAdminMembershipId, "replayed transfer");

  const returnTransfer = noError(await manage(companyAdmin, "owner.transfer.begin", {
    targetMembershipId: ownerMembershipId,
    reason: "restore fixture owner",
  }), "begin return transfer");
  noError(await acceptTransfer(owner, returnTransfer.transferId), "accept return transfer");
  assertOnlyOwner(COMPANY_A, ownerMembershipId, "returned transfer");

  const abandoned = noError(await manage(owner, "owner.transfer.begin", {
    targetMembershipId: companyAdminMembershipId,
    reason: "abandon test",
  }), "begin abandoned transfer");
  noError(await manage(owner, "owner.transfer.abandon", {
    transferId: abandoned.transferId,
    reason: "acceptance test abandon",
  }), "abandon transfer");
  const abandonReplay = noError(await manage(owner, "owner.transfer.abandon", {
    transferId: abandoned.transferId,
    reason: "acceptance test abandon replay",
  }), "replay abandon");
  assert.equal(abandonReplay.idempotent, true);
  assertOnlyOwner(COMPANY_A, ownerMembershipId, "abandoned transfer");

  assert.equal(noError(await ownerlessHr.database.rpc("is_hr"), "ownerless legacy HR"), true);
  assert.equal(activeOwners(OWNERLESS.tenantId).length, 0, "legacy HR became implicit owner");
  expectError(
    await ownerlessHr.database.rpc("repair_ownerless_tenant", {
      p_tenant_id: OWNERLESS.tenantId,
      p_target_membership_id: ownerlessMembershipId,
      p_reason: "unauthorized repair attempt",
    }),
    /PLATFORM_REPAIR_AUTHORITY_REQUIRED|P1001/i,
    "ordinary member ownerless repair",
  );
  assert.equal(activeOwners(OWNERLESS.tenantId).length, 0, "failed repair created an owner");
  noError(await platformAdmin.database.rpc("repair_ownerless_tenant", {
    p_tenant_id: OWNERLESS.tenantId,
    p_target_membership_id: ownerlessMembershipId,
    p_reason: "P1-02 protected ownerless repair",
  }), "platform ownerless repair");
  assertOnlyOwner(OWNERLESS.tenantId, ownerlessMembershipId, "platform repair");

  const bootstrapResult = noError(await platformAdmin.functions.invoke("create-hr-admin-user", {
    method: "POST",
    body: {
      email: BOOTSTRAP.email,
      name: "P1-02 Bootstrap Admin",
      tenant_id: BOOTSTRAP.tenantId,
      temp_password: PASSWORD,
    },
  }), "first-admin bootstrap");
  assert.equal(bootstrapResult.success, true);
  assert.ok(bootstrapResult.user_id);
  const { client: bootstrapAdmin } = await signIn({ id: bootstrapResult.user_id, email: BOOTSTRAP.email }, anonKey);
  const bootstrapSummary = noError(await bootstrapAdmin.database.rpc("get_my_capability_summary"), "bootstrap capability");
  assert.equal(bootstrapSummary.employeeId, null);
  assert.equal(bootstrapSummary.membershipId, membershipId(BOOTSTRAP.tenantId, bootstrapResult.user_id));
  assert.deepEqual(bootstrapSummary.responsibilities, ["owner", "company_admin"]);
  assert.deepEqual(
    bootstrapSummary.grants.map((grant) => `${grant.action}:${grant.scopeType}`).sort(),
    [
      "access.manage", "designation.manage", "membership.employee_associate",
      "membership.invite", "membership.read", "membership.revoke", "org.manage",
      "org.read", "owner.transfer", "reporting.manage",
    ].map((action) => `${action}:company`).sort(),
  );
  assert.equal(noError(await bootstrapAdmin.database.rpc("is_hr"), "bootstrap is_hr"), false);
  assert.equal(rowsOf(runSql(`SELECT id FROM public.employees WHERE user_id='${bootstrapResult.user_id}'::uuid`)).length, 0);
  assertOnlyOwner(BOOTSTRAP.tenantId, bootstrapSummary.membershipId, "bootstrap owner");
  await exerciseCompanyConfiguration(bootstrapAdmin, BOOTSTRAP.tenantId, "d");
  expectError(
    await bootstrapAdmin.database.rpc("approve_leave_request", {
      p_leave_id: PENDING_LEAVE_ID,
      p_working_dates: null,
      p_approved_business_days: null,
    }),
    // P2-04 answers a leave outside the caller's tenant with P1003 APPROVAL_SUBJECT_UNAVAILABLE (it
    // does not reveal the row exists). Still a denial; the older HR/P1001 wording is also accepted.
    /HR|Forbidden|denied|P1001|APPROVAL_SUBJECT_UNAVAILABLE/i,
    "bootstrap Company Admin leave approval",
  );
  expectError(
    await bootstrapAdmin.database.rpc("set_employee_password_by_hr", {
      target_email: BOOTSTRAP.email,
      target_password_hash: "not-a-real-hash",
      tenant_uuid: BOOTSTRAP.tenantId,
    }),
    /Forbidden|denied/i,
    "bootstrap Company Admin HR password operation",
  );

  expectError(
    await platformAdmin.functions.invoke("create-hr-admin-user", {
      method: "POST",
      body: {
        email: BOOTSTRAP.secondEmail,
        name: "P1-02 Forbidden Second Admin",
        tenant_id: BOOTSTRAP.tenantId,
        temp_password: PASSWORD,
      },
    }),
    /BOOTSTRAP_ALREADY_COMPLETE|Failed to bootstrap|500/i,
    "subsequent bootstrap admin",
  );
  assert.equal(
    rowsOf(runSql(`SELECT id FROM auth.users WHERE lower(email)=lower(${sqlString(BOOTSTRAP.secondEmail)})`)).length,
    0,
    "failed second bootstrap left an orphan auth user",
  );

  const ownerlessAudit = rowsOf(runSql(`
    SELECT actor_id,details->>'actor_user_id' AS actor_user_id
    FROM public.audit_logs
    WHERE tenant_id='${OWNERLESS.tenantId}'::uuid AND action='access.ownerless_tenant_repaired'
  `.trim()));
  assert.equal(ownerlessAudit.length, 1);
  assert.equal(ownerlessAudit[0].actor_id, null);
  assert.equal(ownerlessAudit[0].actor_user_id, PLATFORM_ADMIN.id);

  console.log(`Verified target: ${verified.projectName} (${verified.projectId})`);
  console.log("Owner transfer passed: pending kept source, acceptance atomically swapped, replay/abandon were idempotent, and fixture returned to one owner.");
  console.log("Ownerless legacy HR had zero implicit owners; ordinary repair was denied and protected platform repair created exactly one owner.");
  console.log("First-admin bootstrap produced a non-employee Owner + exact Company Admin, is_hr=false, configuration writes allowed, leave/HR operations denied, and subsequent bootstrap compensated its auth user.");
});
