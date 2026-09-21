#!/usr/bin/env node
// P3-03 Tier 2 — within-tenant chat/Connect authorization. Owns its own disposable fixtures
// (tenant A only), `finally` teardown, RLS invariant 1/2/0 before and after. Mirrors the
// signIn/runSql/fixture patterns established by p3_realtime_isolation.mjs and p3_projects_tasks.mjs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@insforge/sdk";
import { io } from "socket.io-client";
import { guardedMutation, runSql } from "./_harness.mjs";
import { TB_M1M2 } from "./_target.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const password = readFileSync(join(here, "persona-password.local"), "utf8").trim();

const companyA = "a0000000-0000-4000-8000-000000000001";
const employeeA = { email: "employee.a@m1m2.test", userId: "a0000000-0000-4000-8001-000000000001", employeeId: "a0000000-0000-4000-8001-000000000002" };
const hrA = { email: "hr-employee.a@m1m2.test", userId: "a0000000-0000-4000-8002-000000000001", employeeId: "a0000000-0000-4000-8002-000000000002", membershipId: "7d538ee4-0355-3fb5-872f-2dcea87c62d1" };
const employeeB = { email: "employee.b@m1m2.test", userId: "b0000000-0000-4000-8001-000000000001" };
const companyAdminA = { email: "company-admin.a@m1m2.test", userId: "a0000000-0000-4000-8005-000000000001" };

const CHAN_PRIV = "c3040000-0000-4000-8000-000000000001"; // custom, members employeeA + hrA
const CHAN_HIDDEN = "c3040000-0000-4000-8000-000000000002"; // custom, member employeeA only
const MSG_1 = "c3040000-0000-4000-8000-000000000003"; // in CHAN_PRIV, sender employeeA
const PROJECT_1 = "c3040000-0000-4000-8000-000000000004"; // tenant A, managed by employeeA, no membership row for hrA
const POST_A = "c3040000-0000-4000-8000-000000000005"; // author employeeA
const POST_HR = "c3040000-0000-4000-8000-000000000006"; // author hrA

// Existing (non-disposable) custom channels named in the brief — read-only checks only.
const VISHAL_TENANT = "111035ce-979c-429a-a482-ddfa87dbfe6e";
const VISHAL_CHANNEL = "3199f16f-0fcd-4f95-88d1-39155f86b64c";
const VISHAL_EMPLOYEE = "91eaf0ab-8ef7-4d07-80af-7d94ab88e05c";
const TEST_TENANT = "97da3641-d69e-4e7a-bdc9-760675be8d28";
const TEST_CHANNEL = "e6999fdf-c4a1-4d4c-8266-324831929f02";
const TEST2_CHANNEL = "7c94918c-5718-4246-93b2-a9f7d248cce8";

const rows = (result) => result?.rows ?? result?.data?.rows ?? [];
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const fingerprint = (error) => [error?.code, error?.message, error?.details].filter(Boolean).join(" | ");
const log = (label, value) => console.log(label, JSON.stringify(value));

function denied(result, label, pattern = /P1003|denied|unavailable|permission|row-level security/i) {
  assert.ok(result.error, `${label}: unexpectedly succeeded (${JSON.stringify(result.data)})`);
  assert.match(fingerprint(result.error), pattern, `${label}: ${fingerprint(result.error)}`);
  console.log(`PASS ${label}: DENIED ${fingerprint(result.error)}`);
}
function allowed(result, label) {
  assert.equal(result.error, null, `${label}: ${fingerprint(result.error)}`);
  console.log(`PASS ${label}: ALLOWED ${JSON.stringify(result.data)}`);
  return result.data;
}
function emptyRead(result, label) {
  assert.equal(result.error, null, `${label}: ${fingerprint(result.error)}`);
  assert.equal((result.data ?? []).length, 0, `${label}: expected zero rows, got ${JSON.stringify(result.data)}`);
  console.log(`PASS ${label}: zero rows (denied)`);
}
function nonEmptyRead(result, label, minLength = 1) {
  assert.equal(result.error, null, `${label}: ${fingerprint(result.error)}`);
  assert.ok((result.data ?? []).length >= minLength, `${label}: expected >= ${minLength} rows, got ${JSON.stringify(result.data)}`);
  console.log(`PASS ${label}: ${result.data.length} row(s) (allowed)`);
  return result.data;
}

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
  assert.equal(error, null, `${persona.email} login: ${error?.message}`);
  assert.equal(data?.user?.id, persona.userId);
  return { client, token: data.accessToken };
}

async function rlsInvariant(clients) {
  const counts = {};
  for (const [name, { client }] of Object.entries(clients)) {
    const { data, error } = await client.database.from("employees").select("id").eq("tenant_id", companyA);
    assert.equal(error, null, `${name} employees: ${fingerprint(error)}`);
    counts[name] = data.length;
  }
  assert.deepEqual(counts, { employee: 1, hr: 2, crossTenant: 0 });
  console.log(`RLS Company A employees (${Object.keys(counts).join(" / ")}): ${Object.values(counts).join(" / ")}`);
}

function setupFixture() {
  runSql(`
    INSERT INTO public.chat_channels (id, tenant_id, name, type, created_by) VALUES
      ('${CHAN_PRIV}', '${companyA}', 'p3c-priv', 'custom', '${employeeA.employeeId}'),
      ('${CHAN_HIDDEN}', '${companyA}', 'p3c-hidden', 'custom', '${employeeA.employeeId}');
    INSERT INTO public.chat_channel_members (tenant_id, channel_id, employee_id) VALUES
      ('${companyA}', '${CHAN_PRIV}', '${employeeA.employeeId}'),
      ('${companyA}', '${CHAN_PRIV}', '${hrA.employeeId}'),
      ('${companyA}', '${CHAN_HIDDEN}', '${employeeA.employeeId}');
    INSERT INTO public.chat_messages (id, tenant_id, sender_id, channel, channel_id, content) VALUES
      ('${MSG_1}', '${companyA}', '${employeeA.employeeId}', 'p3c-priv', '${CHAN_PRIV}', 'p3c fixture message');
    INSERT INTO public.projects (id, tenant_id, name, manager_id, status) VALUES
      ('${PROJECT_1}', '${companyA}', 'p3c fixture project', '${employeeA.employeeId}', 'planning');
    INSERT INTO public.posts (id, tenant_id, author_id, content, type) VALUES
      ('${POST_A}', '${companyA}', '${employeeA.employeeId}', 'p3c post by employee.a', 'post'),
      ('${POST_HR}', '${companyA}', '${hrA.employeeId}', 'p3c post by hr-employee.a', 'post');
    INSERT INTO public.membership_template_assignments (membership_id, tenant_id, template_key, is_active)
      VALUES ('${hrA.membershipId}', '${companyA}', 'communication_moderator', true)
      ON CONFLICT (membership_id, template_key) DO UPDATE SET is_active = true, revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL;
  `);
}

function teardownFixture() {
  runSql(`
    DELETE FROM public.membership_template_assignments WHERE membership_id = '${hrA.membershipId}' AND template_key = 'communication_moderator';
    DELETE FROM public.post_reactions WHERE post_id IN ('${POST_A}', '${POST_HR}');
    DELETE FROM public.posts WHERE id IN ('${POST_A}', '${POST_HR}');
    DELETE FROM public.projects WHERE id = '${PROJECT_1}';
    DELETE FROM public.chat_messages WHERE channel_id IN ('${CHAN_PRIV}', '${CHAN_HIDDEN}');
    DELETE FROM public.chat_channel_members WHERE channel_id IN ('${CHAN_PRIV}', '${CHAN_HIDDEN}');
    DELETE FROM public.chat_channels WHERE id IN ('${CHAN_PRIV}', '${CHAN_HIDDEN}');
    DELETE FROM public.chat_channels WHERE tenant_id = '${companyA}' AND name = 'p3c-hr-created';
  `);
}

async function socketFor(name, token, phase) {
  const s = io(TB_M1M2.baseUrl, { transports: ["websocket"], auth: { token }, reconnection: false, timeout: 15000 });
  s.events = [];
  s.onAny((event, ...args) => { s.events.push({ event, args }); log(`RAW ${phase} ${name} ${event}`, args); });
  await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
  return s;
}
async function subscribe(s, name, channel) {
  const ack = await s.timeout(10000).emitWithAck("realtime:subscribe", { channel });
  log(`ACK ${name} ${channel}`, ack);
  return ack;
}

await guardedMutation("P3-03 Tier 2 disposable fixture", async () => {
  const key = anonKey();
  const clients = {
    employee: await signIn(employeeA, key),
    hr: await signIn(hrA, key),
    crossTenant: await signIn(employeeB, key),
  };
  const companyAdmin = await signIn(companyAdminA, key);
  await rlsInvariant(clients);

  const sockets = [];
  let fixtureUp = false;
  try {
    setupFixture();
    fixtureUp = true;

    // --- T2-1: catalogue grants (A1) ---
    const summary = await clients.hr.client.database.rpc("get_my_capability_summary");
    assert.equal(summary.error, null, fingerprint(summary.error));
    const grants = summary.data.grants;
    assert.ok(grants.some((g) => g.action === "channel.manage" && g.scopeType === "company"), "hr_admin missing channel.manage@company");
    assert.ok(grants.some((g) => g.action === "project.read" && g.scopeType === "company"), "hr_admin missing project.read@company");
    console.log(`PASS T2-1 hr-employee.a capability summary carries channel.manage@company + project.read@company`);

    // --- T2-2: channel access ---
    // HR (channel.manage) sees a private channel it is not a member of, but not its messages.
    nonEmptyRead(await clients.hr.client.database.from("chat_channels").select("id").eq("id", CHAN_HIDDEN), "T2-2 HR reads private channel metadata (not a member)");
    emptyRead(await clients.hr.client.database.from("chat_messages").select("id").eq("channel_id", CHAN_HIDDEN), "T2-2 HR reads messages of private channel it is not a member of");
    // Member reads own private channel messages.
    nonEmptyRead(await clients.employee.client.database.from("chat_messages").select("id").eq("channel_id", CHAN_PRIV), "T2-2 member reads own private channel messages");
    // Non-member employee (cross-tenant) denied entirely by tenant isolation already; same-tenant
    // non-member case is exercised by HR above (she is an employee, just not a CHAN_HIDDEN member).
    // Company Admin alone (no employee row) reads no private channel metadata or messages.
    emptyRead(await companyAdmin.client.database.from("chat_channels").select("id").in("id", [CHAN_PRIV, CHAN_HIDDEN]), "T2-2 Company Admin alone reads private channel metadata");
    emptyRead(await companyAdmin.client.database.from("chat_messages").select("id").eq("channel_id", CHAN_PRIV), "T2-2 Company Admin alone reads private channel messages");

    // Realtime: HR cannot subscribe to a private channel topic it is not a member of; a member can.
    const employeeSocket = await socketFor("employee.a", clients.employee.token, "T2");
    sockets.push(employeeSocket);
    const hrSocket = await socketFor("hr-employee.a", clients.hr.token, "T2");
    sockets.push(hrSocket);
    const privTopic = `chat:${companyA}:${CHAN_PRIV}`;
    const hiddenTopic = `chat:${companyA}:${CHAN_HIDDEN}`;
    const memberAck = await subscribe(employeeSocket, "employee.a", privTopic);
    assert.equal(memberAck.ok, true, "member subscribe to own private channel denied");
    console.log("PASS T2-2 member subscribes to its private channel topic");
    const hrHiddenAck = await subscribe(hrSocket, "hr-employee.a", hiddenTopic);
    assert.equal(hrHiddenAck.ok, false, "HR (channel.manage only) was allowed to subscribe to a private channel it is not a member of");
    console.log("PASS T2-2 HR cannot subscribe to a private channel topic it is not a member of");
    // Legitimate delivery: an id-only event reaches the member.
    runSql(`UPDATE public.chat_messages SET content = 'p3c updated body' WHERE id = '${MSG_1}'`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const delivered = employeeSocket.events.filter((e) => e.event === "UPDATE_message");
    assert.ok(delivered.length > 0, "member did not receive its own channel event");
    const payload = delivered[0].args[0];
    assert.ok(!("content" in payload) && !("attachment_url" in payload), "realtime payload leaked content");
    console.log(`PASS T2-2 member receives id-only event: ${JSON.stringify(payload)}`);

    // --- T2-3: writes through RPCs ---
    denied(await clients.employee.client.database.rpc("p3_create_chat_channel", { p_name: "p3c-employee-created", p_type: "global" }), "T2-3 employee.a create channel denied");
    const createdId = allowed(await clients.hr.client.database.rpc("p3_create_chat_channel", { p_name: "p3c-hr-created", p_type: "global" }), "T2-3 HR creates channel");
    assert.ok(createdId, "channel.manage create returned no id");
    const memberCount = allowed(await clients.hr.client.database.rpc("p3_set_channel_members", { p_channel_id: createdId, p_employee_ids: [employeeA.employeeId] }), "T2-3 HR adds members");
    assert.equal(memberCount, 1);
    allowed(await clients.hr.client.database.rpc("delete_chat_channel", { channel_id: createdId }), "T2-3 HR archives (deletes) the channel it created");

    // Send-retry idempotency on (channel_id, client_message_id).
    const retryId = randomUUID();
    const firstSend = allowed(await clients.employee.client.database.rpc("p3_send_chat_message", { p_channel_id: CHAN_PRIV, p_content: "p3c retry body", p_client_message_id: retryId }), "T2-3 send-retry first attempt");
    const secondSend = allowed(await clients.employee.client.database.rpc("p3_send_chat_message", { p_channel_id: CHAN_PRIV, p_content: "p3c retry body", p_client_message_id: retryId }), "T2-3 send-retry second attempt (same client_message_id)");
    assert.equal(firstSend, secondSend, "retry produced a second row");
    const retryRows = rows(runSql(`SELECT id FROM public.chat_messages WHERE channel_id = '${CHAN_PRIV}' AND client_message_id = '${retryId}'`));
    assert.equal(retryRows.length, 1, `expected exactly one row for the retried client_message_id, got ${retryRows.length}`);
    console.log(`PASS T2-3 send-retry: one row, id ${firstSend} == ${secondSend}`);

    // Edit: author only, no moderate bypass. The RPC does not raise for a non-matching row (it
    // mirrors p3_update_project's FOUND-based pattern) -- denial is a `false` return, not an error.
    const hrEditAttempt = allowed(await clients.hr.client.database.rpc("p3_edit_chat_message", { p_message_id: MSG_1, p_content: "hr tries to edit" }), "T2-3 non-author (HR) edit call");
    assert.equal(hrEditAttempt, false, "non-author edit unexpectedly reported success");
    console.log("PASS T2-3 non-author (HR) edit denied: FOUND=false");
    const editOk = allowed(await clients.employee.client.database.rpc("p3_edit_chat_message", { p_message_id: MSG_1, p_content: "p3c edited by author" }), "T2-3 author edits own message");
    assert.equal(editOk, true);

    // Moderate soft-delete: HR now holds communication_moderator + is an explicit CHAN_PRIV member.
    const moderateOk = allowed(await clients.hr.client.database.rpc("p3_delete_chat_message", { p_message_id: MSG_1 }), "T2-3 moderator soft-deletes another member's message");
    assert.equal(moderateOk, true);
    const afterDelete = rows(runSql(`SELECT is_deleted FROM public.chat_messages WHERE id = '${MSG_1}'`));
    assert.equal(afterDelete[0]?.is_deleted, true);

    // --- T2-4: Connect ---
    emptyRead(await clients.employee.client.database.from("posts").update({ content: "hack" }).eq("id", POST_HR).select("id"), "T2-4 employee.a updates another author's post (denied)");
    nonEmptyRead(await clients.hr.client.database.from("posts").update({ content: "moderated" }).eq("id", POST_A).select("id"), "T2-4 moderator (feed.moderate) updates employee.a's post");
    nonEmptyRead(await clients.employee.client.database.from("posts").update({ content: "p3c edited by author" }).eq("id", POST_A).select("id"), "T2-4 author updates own post");
    const reactionSpoof = await clients.employee.client.database.from("post_reactions").insert([{ tenant_id: companyA, post_id: POST_A, employee_id: hrA.employeeId, reaction: "like" }]);
    assert.ok(reactionSpoof.error, "reaction on behalf of another employee was not denied");
    console.log(`PASS T2-4 reaction on behalf of another employee denied: ${fingerprint(reactionSpoof.error)}`);
    const ownReaction = await clients.employee.client.database.from("post_reactions").insert([{ tenant_id: companyA, post_id: POST_A, employee_id: employeeA.employeeId, reaction: "like" }]).select();
    assert.equal(ownReaction.error, null, fingerprint(ownReaction.error));
    console.log("PASS T2-4 employee reacts on own behalf: ALLOWED");

    // --- T2-5: HR reads all projects, cannot manage ---
    nonEmptyRead(await clients.hr.client.database.from("projects").select("id").eq("id", PROJECT_1), "T2-5 HR reads a project it is not a member of");
    denied(await clients.hr.client.database.rpc("p3_update_project", { p_project_id: PROJECT_1, p_name: "hr tries to rename", p_description: null, p_status: "planning" }), "T2-5 HR p3_update_project denied", /PROJECT_MANAGE_DENIED|P1003/i);

    // --- Existing custom channels (vishal/test/test2) still readable by their members ---
    const vishalMembers = rows(runSql(`SELECT employee_id FROM public.chat_channel_members WHERE channel_id = '${VISHAL_CHANNEL}' ORDER BY employee_id`));
    assert.ok(vishalMembers.some((r) => r.employee_id === VISHAL_EMPLOYEE), "Vishal membership row missing after migration");
    const testMembers = rows(runSql(`SELECT count(*)::int AS n FROM public.chat_channel_members WHERE channel_id IN ('${TEST_CHANNEL}', '${TEST2_CHANNEL}')`));
    console.log(`EXISTING membership rows intact: vishal=${vishalMembers.length}, test+test2=${testMembers[0]?.n}`);
    console.log("UNTESTED: authenticated RLS read for 'test'/'test2' members — no m1m2.test credentials for those tenant-97da3641 personas; membership rows confirmed unchanged by SQL only.");

    // One-user login proof (Vishal), same temp-password technique as p3_realtime_isolation.mjs --existing.
    const vishalUsers = rows(runSql(`SELECT u.id, u.email, u.password FROM auth.users u JOIN public.employees e ON e.user_id = u.id WHERE e.id = '${VISHAL_EMPLOYEE}' AND e.tenant_id = '${VISHAL_TENANT}'`));
    assert.equal(vishalUsers.length, 1, "Expected exactly one Vishal auth user");
    const original = vishalUsers[0];
    let vishalPasswordChanged = false;
    try {
      runSql(`UPDATE auth.users SET password = crypt(${q(password)}, gen_salt('bf', 10)) WHERE id = ${q(original.id)}::uuid`);
      vishalPasswordChanged = true;
      const vishalClient = createClient({ baseUrl: TB_M1M2.baseUrl, anonKey: key });
      const login = await vishalClient.auth.signInWithPassword({ email: original.email, password });
      if (login.error) {
        console.log(`UNTESTED existing-member login for Vishal: ${login.error.message}`);
      } else {
        const readChannel = await vishalClient.database.from("chat_channels").select("id, name").eq("id", VISHAL_CHANNEL);
        nonEmptyRead(readChannel, "PASS existing 'vishal' channel still readable by its member after Tier 2");
        const readMessages = await vishalClient.database.from("chat_messages").select("id").eq("channel_id", VISHAL_CHANNEL);
        assert.equal(readMessages.error, null, fingerprint(readMessages.error));
        console.log(`PASS existing 'vishal' channel messages readable by its member: ${readMessages.data.length} row(s)`);
      }
    } finally {
      if (vishalPasswordChanged) {
        runSql(`UPDATE auth.users SET password = ${q(original.password)} WHERE id = ${q(original.id)}::uuid`);
        const equality = rows(runSql(`SELECT password = ${q(original.password)} AS restored FROM auth.users WHERE id = ${q(original.id)}::uuid`));
        log("PASSWORD_HASH_RESTORED", equality);
        assert.equal(equality[0]?.restored, true, "Vishal's original password hash was not restored");
      }
    }
  } finally {
    for (const s of sockets) s.disconnect();
    if (fixtureUp) teardownFixture();
    await rlsInvariant(clients);
  }
});
