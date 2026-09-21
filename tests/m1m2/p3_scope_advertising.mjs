#!/usr/bin/env node
// P3-02b — advertise project:<id> and channel:<id> scopes. Owns its own disposable fixtures
// (tenant A only), `finally` teardown, RLS invariant 1/2/0 before and after. Mirrors the
// signIn/runSql/fixture patterns established by p3_projects_tasks.mjs and p3_chat_connect.mjs.
//
// Acceptance (prompts/p3-02b_advertise_project_channel_scope_2026-09-21.md §5):
//   1. Agreement: every emitted project/channel grant satisfies has_access_action(...) = true,
//      and a sample of non-emitted combinations (other project, other channel, non-member, wrong
//      action) = false.
//   2. PM sees project.manage/project.members.manage/task.assign/task.review for their project
//      only; a member sees project.read (+ task.submit); HR sees project.read@company and no
//      project-scoped manage grant.
//   3. Channel: explicit member gets channel grants for that channel; a global channel produces
//      none; moderator gets message.moderate for channels they belong to; Company Admin alone
//      gets none.
//   4. Revocation freshness: remove a project membership -> the next summary call no longer
//      emits it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@insforge/sdk";
import { guardedMutation, runSql } from "./_harness.mjs";
import { TB_M1M2 } from "./_target.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const password = readFileSync(join(here, "persona-password.local"), "utf8").trim();
const companyA = "a0000000-0000-4000-8000-000000000001";

const employeeA = { email: "employee.a@m1m2.test", userId: "a0000000-0000-4000-8001-000000000001", employeeId: "a0000000-0000-4000-8001-000000000002" };
const hrA = { email: "hr-employee.a@m1m2.test", userId: "a0000000-0000-4000-8002-000000000001", employeeId: "a0000000-0000-4000-8002-000000000002" };
const employeeB = { email: "employee.b@m1m2.test", userId: "b0000000-0000-4000-8001-000000000001" };
const companyAdminA = { email: "company-admin.a@m1m2.test", userId: "a0000000-0000-4000-8005-000000000001" };

const membershipId = (userId) => {
  const hex = createHash("md5").update(`${companyA}:${userId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const pm = { email: "p302b-pm.a@m1m2.test", userId: "a302b000-0000-4000-8000-000000001001", employeeId: "a302b000-0000-4000-8000-000000001002" };
pm.membershipId = membershipId(pm.userId);
const member = { email: "p302b-member.a@m1m2.test", userId: "a302b000-0000-4000-8000-000000002001", employeeId: "a302b000-0000-4000-8000-000000002002" };
member.membershipId = membershipId(member.userId);
const moderator = { email: "p302b-moderator.a@m1m2.test", userId: "a302b000-0000-4000-8000-000000003001", employeeId: "a302b000-0000-4000-8000-000000003002" };
moderator.membershipId = membershipId(moderator.userId);

const projectX = "a302b000-0000-4000-8000-000000004001"; // pm=manager, member=member
const projectZ = "a302b000-0000-4000-8000-000000004002"; // no memberships at all (negative control)
const channelPriv = "a302b000-0000-4000-8000-000000005001"; // custom, members: member + moderator
const channelGlobal = "a302b000-0000-4000-8000-000000005002"; // global, no explicit members

const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const fingerprint = (error) => [error?.code, error?.message, error?.details].filter(Boolean).join(" | ");

function anonKey() {
  const cli = join(root, "node_modules", "@insforge", "cli", "dist", "index.js");
  const result = spawnSync(process.execPath, [cli, "secrets", "get", "ANON_KEY", "--json"], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, "Could not read TB-M1M2 anon key; raw CLI output suppressed");
  return JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))).value;
}

async function signIn(persona, key) {
  const client = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey: key });
  const { data, error } = await client.auth.signInWithPassword({ email: persona.email, password });
  assert.equal(error, null, `${persona.email} login: ${fingerprint(error)}`);
  assert.equal(data?.user?.id, persona.userId);
  return client;
}

async function rlsInvariant(clients) {
  const counts = {};
  for (const [name, client] of Object.entries(clients)) {
    const { data, error } = await client.database.from("employees").select("id").eq("tenant_id", companyA);
    assert.equal(error, null, `${name} employees: ${fingerprint(error)}`);
    counts[name] = data.length;
  }
  assert.deepEqual(counts, { employee: 1, hr: 2, crossTenant: 0 });
  console.log(`RLS Company A employees (${Object.keys(counts).join(" / ")}): ${Object.values(counts).join(" / ")}`);
}

function setupFixture() {
  const sql = `
    INSERT INTO auth.users(id,email,password,email_verified,metadata) VALUES
      ('${pm.userId}'::uuid,${q(pm.email)},crypt(${q(password)},gen_salt('bf',10)),true,
       ${q(JSON.stringify({ role: "employee", tenant_id: companyA }))}::jsonb),
      ('${member.userId}'::uuid,${q(member.email)},crypt(${q(password)},gen_salt('bf',10)),true,
       ${q(JSON.stringify({ role: "employee", tenant_id: companyA }))}::jsonb),
      ('${moderator.userId}'::uuid,${q(moderator.email)},crypt(${q(password)},gen_salt('bf',10)),true,
       ${q(JSON.stringify({ role: "employee", tenant_id: companyA }))}::jsonb);
    INSERT INTO public.employees(id,user_id,tenant_id,full_name,email) VALUES
      ('${pm.employeeId}'::uuid,'${pm.userId}'::uuid,'${companyA}'::uuid,'P302b PM',${q(pm.email)}),
      ('${member.employeeId}'::uuid,'${member.userId}'::uuid,'${companyA}'::uuid,'P302b Member',${q(member.email)}),
      ('${moderator.employeeId}'::uuid,'${moderator.userId}'::uuid,'${companyA}'::uuid,'P302b Moderator',${q(moderator.email)});
    INSERT INTO public.tenant_memberships(tenant_id,user_id,employee_id,status) VALUES
      ('${companyA}'::uuid,'${pm.userId}'::uuid,'${pm.employeeId}'::uuid,'active'),
      ('${companyA}'::uuid,'${member.userId}'::uuid,'${member.employeeId}'::uuid,'active'),
      ('${companyA}'::uuid,'${moderator.userId}'::uuid,'${moderator.employeeId}'::uuid,'active');
    INSERT INTO public.membership_template_assignments(membership_id,tenant_id,template_key,is_active) VALUES
      ('${pm.membershipId}'::uuid,'${companyA}'::uuid,'employee',true),
      ('${pm.membershipId}'::uuid,'${companyA}'::uuid,'project_manager',true),
      ('${member.membershipId}'::uuid,'${companyA}'::uuid,'employee',true),
      ('${moderator.membershipId}'::uuid,'${companyA}'::uuid,'employee',true),
      ('${moderator.membershipId}'::uuid,'${companyA}'::uuid,'communication_moderator',true);
    INSERT INTO public.projects(id,tenant_id,name,status,manager_id,created_by) VALUES
      ('${projectX}'::uuid,'${companyA}'::uuid,'P302b Project X','active','${pm.employeeId}'::uuid,'${pm.employeeId}'::uuid),
      ('${projectZ}'::uuid,'${companyA}'::uuid,'P302b Project Z','active',NULL,'${hrA.employeeId}'::uuid);
    INSERT INTO public.project_memberships(tenant_id,project_id,employee_id,role) VALUES
      ('${companyA}'::uuid,'${projectX}'::uuid,'${pm.employeeId}'::uuid,'manager'),
      ('${companyA}'::uuid,'${projectX}'::uuid,'${member.employeeId}'::uuid,'member');
    INSERT INTO public.chat_channels(id,tenant_id,name,type,created_by) VALUES
      ('${channelPriv}'::uuid,'${companyA}'::uuid,'p302b-priv','custom','${moderator.employeeId}'::uuid),
      ('${channelGlobal}'::uuid,'${companyA}'::uuid,'p302b-global','global','${moderator.employeeId}'::uuid);
    INSERT INTO public.chat_channel_members(tenant_id,channel_id,employee_id) VALUES
      ('${companyA}'::uuid,'${channelPriv}'::uuid,'${member.employeeId}'::uuid),
      ('${companyA}'::uuid,'${channelPriv}'::uuid,'${moderator.employeeId}'::uuid);
  `;
  try {
    runSql(sql);
  } catch (error) {
    const cli = join(root, "node_modules", "@insforge", "cli", "dist", "index.js");
    const debug = spawnSync(process.execPath, [cli, "db", "query", sql, "--json"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    const message = (debug.stderr || debug.stdout || "fixture SQL failed").replaceAll(password, "[redacted]").slice(0, 1000);
    throw new Error(`Fixture setup failed: ${message}`, { cause: error });
  }
}

function teardownFixture() {
  runSql(`
    DELETE FROM public.chat_channel_members WHERE channel_id IN ('${channelPriv}'::uuid,'${channelGlobal}'::uuid);
    DELETE FROM public.chat_channels WHERE id IN ('${channelPriv}'::uuid,'${channelGlobal}'::uuid);
    DELETE FROM public.project_memberships WHERE project_id IN ('${projectX}'::uuid,'${projectZ}'::uuid);
    DELETE FROM public.projects WHERE id IN ('${projectX}'::uuid,'${projectZ}'::uuid);
    DELETE FROM public.membership_template_assignments WHERE membership_id IN
      ('${pm.membershipId}'::uuid,'${member.membershipId}'::uuid,'${moderator.membershipId}'::uuid);
    DELETE FROM public.tenant_memberships WHERE id IN
      ('${pm.membershipId}'::uuid,'${member.membershipId}'::uuid,'${moderator.membershipId}'::uuid);
    DELETE FROM public.employees WHERE id IN
      ('${pm.employeeId}'::uuid,'${member.employeeId}'::uuid,'${moderator.employeeId}'::uuid);
    DELETE FROM auth.users WHERE id IN ('${pm.userId}'::uuid,'${member.userId}'::uuid,'${moderator.userId}'::uuid);
  `);
}

function scoped(grants, scopeType, scopeId) {
  return grants.filter((g) => g.scopeType === scopeType && g.scopeId === scopeId);
}
function hasGrant(grants, action, scopeType, scopeId) {
  return grants.some((g) => g.action === action && g.scopeType === scopeType && g.scopeId === scopeId);
}

async function summaryOf(client, label) {
  const { data, error } = await client.database.rpc("get_my_capability_summary");
  assert.equal(error, null, `${label} summary: ${fingerprint(error)}`);
  return data;
}
async function serverAllows(client, action, scopeType, scopeId) {
  const { data, error } = await client.database.rpc("has_access_action", {
    p_action: action, p_scope_type: scopeType, p_scope_id: scopeId,
  });
  assert.equal(error, null, `has_access_action(${action},${scopeType},${scopeId}): ${fingerprint(error)}`);
  return data;
}

async function assertAgreement(client, label, grants) {
  for (const grant of grants) {
    if (grant.scopeType !== "project" && grant.scopeType !== "channel") continue;
    const server = await serverAllows(client, grant.action, grant.scopeType, grant.scopeId);
    assert.equal(server, true, `${label}: emitted ${grant.action}@${grant.scopeType}:${grant.scopeId} but server denies it`);
    console.log(`PASS AC1 agreement ${label}: ${grant.action}@${grant.scopeType}:${grant.scopeId} -> server=true`);
  }
}

async function fullSuite(clients, key) {
  try {
    setupFixture();

    clients.pm = await signIn(pm, key);
    clients.member = await signIn(member, key);
    clients.moderator = await signIn(moderator, key);
    clients.companyAdmin = await signIn(companyAdminA, key);

    // --- AC1/AC2: project scope ---
    const pmSummary = await summaryOf(clients.pm, "pm");
    await assertAgreement(clients.pm, "pm", pmSummary.grants);
    for (const action of ["project.manage", "project.members.manage", "task.assign", "task.review", "project.read"]) {
      assert.ok(hasGrant(pmSummary.grants, action, "project", projectX), `pm missing ${action}@project:${projectX}`);
    }
    console.log("PASS AC2 PM sees manage/member/assign/review/read for its own project");
    // Negative: pm has no membership in projectZ at all.
    assert.equal(scoped(pmSummary.grants, "project", projectZ).length, 0, "pm unexpectedly advertised for projectZ");
    assert.equal(await serverAllows(clients.pm, "project.manage", "project", projectZ), false, "pm unexpectedly allowed project.manage on projectZ");
    console.log("PASS AC1 negative: pm project.manage on projectZ (not a member) -> false");

    const memberSummary = await summaryOf(clients.member, "member");
    await assertAgreement(clients.member, "member", memberSummary.grants);
    assert.ok(hasGrant(memberSummary.grants, "project.read", "project", projectX), "member missing project.read@project:X");
    for (const action of ["project.manage", "project.members.manage", "task.assign", "task.review"]) {
      assert.equal(hasGrant(memberSummary.grants, action, "project", projectX), false, `member unexpectedly holds ${action}@project:X`);
    }
    console.log("PASS AC2 member sees project.read only (no manage actions) for its project");
    // D1: task.submit is covered in the new helper via is_project_member + the employee template's
    // project-scope grant, since p3_project_scope's branches cover project.read/manage only.
    assert.ok(hasGrant(memberSummary.grants, "task.submit", "project", projectX), "member missing task.submit@project:X (D1 fallback)");
    assert.equal(await serverAllows(clients.member, "task.submit", "project", projectX), true, "server disagrees with task.submit@project:X for member");
    console.log("PASS D1 member task.submit@project:X emitted and agrees with server");
    // Negative: wrong action for a real membership, and a non-member persona.
    assert.equal(await serverAllows(clients.member, "project.manage", "project", projectX), false, "member unexpectedly allowed project.manage on own project");
    assert.equal(await serverAllows(clients.member, "project.read", "project", projectZ), false, "member unexpectedly allowed project.read on projectZ (non-member)");
    assert.equal(await serverAllows(clients.employee, "project.read", "project", projectX), false, "unrelated employee.a unexpectedly allowed project.read on projectX");
    console.log("PASS AC1 negatives: wrong action on own project / non-member on other project / unrelated persona");

    // HR: project.read@company only, never a project-scoped manage grant.
    const hrSummary = await summaryOf(clients.hr, "hr");
    assert.ok(hasGrant(hrSummary.grants, "project.read", "company", undefined), "hr-employee.a missing project.read@company (A1)");
    assert.equal(scoped(hrSummary.grants, "project", projectX).length, 0, "HR unexpectedly holds a project-scoped grant for projectX");
    assert.equal(scoped(hrSummary.grants, "project", projectZ).length, 0, "HR unexpectedly holds a project-scoped grant for projectZ");
    console.log("PASS AC2 HR sees project.read@company and no project-scoped manage grant");

    // --- AC1/AC3: channel scope ---
    const modSummary = await summaryOf(clients.moderator, "moderator");
    await assertAgreement(clients.moderator, "moderator", modSummary.grants);
    for (const action of ["channel.read", "message.send", "message.moderate", "channel.manage"]) {
      assert.ok(hasGrant(modSummary.grants, action, "channel", channelPriv), `moderator missing ${action}@channel:${channelPriv}`);
    }
    console.log("PASS AC3 moderator sees channel.read/message.send/message.moderate/channel.manage for its channel");
    assert.equal(scoped(modSummary.grants, "channel", channelGlobal).length, 0, "moderator unexpectedly advertised for the global channel (no explicit membership)");
    console.log("PASS AC3 global channel produces no explicit-membership grant");

    const memberChannelSummary = memberSummary; // already fetched above; member is also a channelPriv member
    for (const action of ["channel.read", "message.send"]) {
      assert.ok(hasGrant(memberChannelSummary.grants, action, "channel", channelPriv), `member missing ${action}@channel:${channelPriv} (D1 fallback)`);
    }
    for (const action of ["message.moderate", "channel.manage"]) {
      assert.equal(hasGrant(memberChannelSummary.grants, action, "channel", channelPriv), false, `plain member unexpectedly holds ${action}@channel:${channelPriv}`);
    }
    console.log("PASS AC3 explicit non-moderator member gets channel.read/message.send only for its channel");
    assert.equal(scoped(memberChannelSummary.grants, "channel", channelGlobal).length, 0, "member unexpectedly advertised for the global channel");

    // Negative: unrelated persona (employee.a, not a member of channelPriv).
    assert.equal(await serverAllows(clients.employee, "channel.read", "channel", channelPriv), false, "unrelated employee.a unexpectedly allowed channel.read on channelPriv");
    console.log("PASS AC1 negative: non-member employee.a denied channel.read on channelPriv");

    // Company Admin alone (no employee association) gets no project/channel grant at all.
    const adminSummary = await summaryOf(clients.companyAdmin, "companyAdmin");
    assert.equal(adminSummary.grants.filter((g) => g.scopeType === "project" || g.scopeType === "channel").length, 0, "Company Admin alone unexpectedly holds a project/channel grant");
    console.log("PASS AC3 Company Admin alone gains no project/channel scope grant");

    // --- Every non-scoped grant still has no scopeId key at all (D3 shape, deploy-skew guard) ---
    for (const grant of [...pmSummary.grants, ...hrSummary.grants, ...adminSummary.grants]) {
      if (grant.scopeType === "project" || grant.scopeType === "channel") continue;
      assert.equal(Object.hasOwn(grant, "scopeId"), false, `non-scoped grant ${grant.action}@${grant.scopeType} unexpectedly carries a scopeId key`);
    }
    console.log("PASS wire shape: non-scoped grants carry no scopeId key (AuthContext ~99-104 compatibility)");

    // --- AC4: revocation freshness, same signed-in session ---
    runSql(`UPDATE public.project_memberships SET is_active=false WHERE tenant_id='${companyA}'::uuid AND project_id='${projectX}'::uuid AND employee_id='${member.employeeId}'::uuid`);
    const memberAfterRevoke = await summaryOf(clients.member, "member (post-revocation)");
    assert.equal(scoped(memberAfterRevoke.grants, "project", projectX).length, 0, "revoked member still advertised for projectX");
    assert.equal(await serverAllows(clients.member, "project.read", "project", projectX), false, "server still allows project.read for a revoked member");
    console.log("PASS AC4 revocation freshness: deactivated project_memberships row -> next summary call stops advertising it, same session");
  } finally {
    teardownFixture();
    await rlsInvariant({ employee: clients.employee, hr: clients.hr, crossTenant: clients.crossTenant });
  }
}

await guardedMutation("P3-02b disposable fixture", async () => {
  const key = anonKey();
  const clients = {
    employee: await signIn(employeeA, key),
    hr: await signIn(hrA, key),
    crossTenant: await signIn(employeeB, key),
  };
  await rlsInvariant(clients);
  await fullSuite(clients, key);
  console.log("P3-02b scope advertising: agreement, PM/member/HR project scoping, channel scoping, revocation freshness all PASS.");
});
