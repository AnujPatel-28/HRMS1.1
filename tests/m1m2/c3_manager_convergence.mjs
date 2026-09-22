#!/usr/bin/env node
// C3 -- manager authority converges on the primary reporting relationship.
// Fixture conventions (signIn/anonKey/rlsInvariant, disposable personas, `finally` teardown,
// RLS invariant 1/2/0 before and after) follow c1_employee_self_edit.mjs.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
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

const membershipId = (userId) => {
  const hex = createHash("md5").update(`${companyA}:${userId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const persona = (tag) => {
  const p = { email: `c3-${tag}-${randomUUID().slice(0, 8)}@m1m2.test`, userId: randomUUID(), employeeId: randomUUID() };
  p.membershipId = membershipId(p.userId);
  return p;
};
// Two signed-in managers (old and new), one report with bank/identity data, one legacy orphan
// (manager_id set, no primary row) shaped like the old "draft report" the delete policy matched.
const mgrOld = persona("mgr-old");
const mgrNew = persona("mgr-new");
const report = { employeeId: randomUUID() };
const orphan = { employeeId: randomUUID() };
const fixtureEmployees = [mgrOld.employeeId, mgrNew.employeeId, report.employeeId, orphan.employeeId];

const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
const fp = (error) => [error?.code, error?.message, error?.details].filter(Boolean).join(" | ");
const ids = (list) => list.map((id) => `'${id}'::uuid`).join(",");

function denied(result, label) {
  assert.ok(result.error, `${label}: unexpectedly succeeded (${JSON.stringify(result.data)})`);
  console.log(`PASS ${label}: DENIED ${fp(result.error)}`);
}
function allowed(result, label) {
  assert.equal(result.error, null, `${label}: ${fp(result.error)}`);
  console.log(`PASS ${label}: ALLOWED`);
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

async function signIn(p, key) {
  const client = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey: key });
  const { data, error } = await client.auth.signInWithPassword({ email: p.email, password });
  assert.equal(error, null, `${p.email} login: ${fp(error)}`);
  assert.equal(data?.user?.id, p.userId);
  return client;
}

async function rlsInvariant(clients, expected) {
  const counts = {};
  for (const [name, client] of Object.entries(clients)) {
    if (!(name in expected)) continue;
    const { data, error } = await client.database.from("employees").select("id").eq("tenant_id", companyA);
    assert.equal(error, null, `${name} employees: ${fp(error)}`);
    counts[name] = data.length;
  }
  assert.deepEqual(counts, expected);
  console.log(`RLS Company A employees (${Object.keys(counts).join(" / ")}): ${Object.values(counts).join(" / ")}`);
}

function setupFixture() {
  const authRow = (p) => `('${p.userId}'::uuid,${q(p.email)},crypt(${q(password)},gen_salt('bf',10)),true,${q(JSON.stringify({ role: "employee", tenant_id: companyA }))}::jsonb)`;
  runSql(`
    INSERT INTO auth.users(id,email,password,email_verified,metadata) VALUES ${authRow(mgrOld)}, ${authRow(mgrNew)};
    INSERT INTO public.employees(id,user_id,tenant_id,full_name,email,status) VALUES
      ('${mgrOld.employeeId}'::uuid,'${mgrOld.userId}'::uuid,'${companyA}'::uuid,'C3 Old Manager',${q(mgrOld.email)},'active'),
      ('${mgrNew.employeeId}'::uuid,'${mgrNew.userId}'::uuid,'${companyA}'::uuid,'C3 New Manager',${q(mgrNew.email)},'active');
    INSERT INTO public.employees(id,tenant_id,full_name,email,status,account_number,pan_number) VALUES
      ('${report.employeeId}'::uuid,'${companyA}'::uuid,'C3 Report',${q(`c3-report-${report.employeeId.slice(0, 8)}@m1m2.test`)},'active','C3ACCOUNT0001','C3PAN0001X');
    INSERT INTO public.employees(id,tenant_id,full_name,email,status,manager_id) VALUES
      ('${orphan.employeeId}'::uuid,'${companyA}'::uuid,'C3 Legacy Orphan',${q(`c3-orphan-${orphan.employeeId.slice(0, 8)}@m1m2.test`)},'inactive','${mgrOld.employeeId}'::uuid);
    INSERT INTO public.tenant_memberships(tenant_id,user_id,employee_id,status) VALUES
      ('${companyA}'::uuid,'${mgrOld.userId}'::uuid,'${mgrOld.employeeId}'::uuid,'active'),
      ('${companyA}'::uuid,'${mgrNew.userId}'::uuid,'${mgrNew.employeeId}'::uuid,'active');
    INSERT INTO public.membership_template_assignments(membership_id,tenant_id,template_key,is_active) VALUES
      ('${mgrOld.membershipId}'::uuid,'${companyA}'::uuid,'employee',true),
      ('${mgrOld.membershipId}'::uuid,'${companyA}'::uuid,'manager',true),
      ('${mgrNew.membershipId}'::uuid,'${companyA}'::uuid,'employee',true),
      ('${mgrNew.membershipId}'::uuid,'${companyA}'::uuid,'manager',true);
  `);
}

function teardownFixture() {
  runSql(`
    DELETE FROM public.notifications WHERE tenant_id='${companyA}'::uuid AND reference_id IN (SELECT id FROM public.new_hire_requests WHERE requested_by IN (${ids(fixtureEmployees)}));
    DELETE FROM public.new_hire_requests WHERE requested_by IN (${ids(fixtureEmployees)});
    DELETE FROM public.audit_logs WHERE target_id IN (${ids(fixtureEmployees)});
    DELETE FROM public.employee_reporting_relationships WHERE employee_id IN (${ids(fixtureEmployees)}) OR manager_id IN (${ids(fixtureEmployees)});
    DELETE FROM public.membership_template_assignments WHERE membership_id IN (${ids([mgrOld.membershipId, mgrNew.membershipId])});
    DELETE FROM public.tenant_memberships WHERE id IN (${ids([mgrOld.membershipId, mgrNew.membershipId])});
    DELETE FROM public.employees WHERE id IN (${ids(fixtureEmployees)});
    DELETE FROM auth.users WHERE id IN (${ids([mgrOld.userId, mgrNew.userId])});
  `);
}

const isManagerOf = async (client, employeeId) => {
  const { data, error } = await client.database.rpc("is_manager_of", { p_employee_id: employeeId });
  assert.equal(error, null, `is_manager_of: ${fp(error)}`);
  return data;
};
const reportIds = async (client) => {
  const { data, error } = await client.database.rpc("my_direct_report_ids");
  assert.equal(error, null, `my_direct_report_ids: ${fp(error)}`);
  return data ?? [];
};

async function probeReportingPath(clients) {
  // HR edits the manager through the path EmployeeCreate/EmployeeDetail now use.
  allowed(await clients.hr.database.rpc("update_employee_reporting_relationship", {
    p_employee_id: report.employeeId, p_primary_manager_id: mgrOld.employeeId, p_secondary_manager_id: null,
  }), "HR assigns report -> old manager via update_employee_reporting_relationship");
  const rel1 = runSql(`SELECT manager_id FROM public.employee_reporting_relationships WHERE employee_id='${report.employeeId}' AND relationship_type='primary' AND is_active`).rows;
  assert.deepEqual(rel1.map((r) => r.manager_id), [mgrOld.employeeId]);
  console.log(`PASS primary relationship row -> old manager: ${JSON.stringify(rel1)}`);

  assert.equal(await isManagerOf(clients.mgrOld, report.employeeId), true);
  console.log("PASS is_manager_of(report) as old manager: true");
  const oldTeam = await reportIds(clients.mgrOld);
  assert.ok(oldTeam.includes(report.employeeId), "report missing from my_direct_report_ids");
  assert.ok(!oldTeam.includes(orphan.employeeId), "legacy orphan listed as a report");
  console.log(`PASS my_direct_report_ids(old manager) = ${JSON.stringify(oldTeam)} (orphan excluded)`);

  // Manager sees basic fields, never bank/identity.
  const direct = await clients.mgrOld.database.from("employees").select("id, account_number, pan_number").eq("id", report.employeeId);
  assert.equal(direct.error, null, fp(direct.error));
  assert.equal(direct.data.length, 0, `manager read report's employees row: ${JSON.stringify(direct.data)}`);
  console.log("PASS manager direct employees read of report (account_number, pan_number): 0 rows");
  const view = await clients.mgrOld.database.from("employee_directory_public").select("*").eq("id", report.employeeId);
  assert.equal(view.error, null, fp(view.error));
  assert.equal(view.data.length, 1);
  assert.equal(view.data[0].full_name, "C3 Report");
  assert.ok(!("account_number" in view.data[0]) && !("pan_number" in view.data[0]), "directory view exposes bank/PAN");
  console.log(`PASS manager directory read of report: basic fields only (${Object.keys(view.data[0]).length} columns, no account_number/pan_number)`);

  // Reassign: authority moves with the primary row.
  allowed(await clients.hr.database.rpc("update_employee_reporting_relationship", {
    p_employee_id: report.employeeId, p_primary_manager_id: mgrNew.employeeId, p_secondary_manager_id: null,
  }), "HR reassigns report -> new manager");
  assert.equal(await isManagerOf(clients.mgrNew, report.employeeId), true);
  assert.equal(await isManagerOf(clients.mgrOld, report.employeeId), false);
  const synced = runSql(`SELECT manager_id FROM public.employees WHERE id='${report.employeeId}'`).rows[0].manager_id;
  assert.equal(synced, mgrNew.employeeId);
  console.log("PASS after reassignment: is_manager_of new=true old=false; manager_id display column synced");
}

async function probeFallbackGone(clients) {
  assert.equal(await isManagerOf(clients.mgrOld, orphan.employeeId), false);
  console.log("PASS legacy orphan (manager_id=old manager, no primary row): is_manager_of = false");
}

async function probeNoEmployeeDelete(clients) {
  // The orphan has exactly the shape the dropped delete policy matched (inactive, no user, manager_id=me).
  const del = await clients.mgrOld.database.from("employees").delete().eq("id", orphan.employeeId).select("id");
  const still = runSql(`SELECT count(*)::int n FROM public.employees WHERE id='${orphan.employeeId}'`).rows[0].n;
  assert.equal(still, 1, "employee row deleted by a non-HR user");
  console.log(`PASS manager delete of draft-shaped employees row: ${del.error ? "DENIED " + fp(del.error) : `${del.data.length} rows`}; row still present`);
  const delA = await clients.employee.database.from("employees").delete().eq("tenant_id", companyA).select("id");
  assert.ok(delA.error || delA.data.length === 0, `employee.a deleted rows: ${JSON.stringify(delA.data)}`);
  console.log(`PASS employee.a delete any employees row: ${delA.error ? "DENIED " + fp(delA.error) : "0 rows"}`);
}

async function probeRelationshipWrites(clients) {
  const ins = await clients.employee.database.from("employee_reporting_relationships").insert({
    tenant_id: companyA, employee_id: hrA.employeeId, manager_id: employeeA.employeeId,
    relationship_type: "primary", effective_from: "2020-01-01", is_active: true,
  }).select("id");
  if (!ins.error) runSql(`DELETE FROM public.employee_reporting_relationships WHERE id IN (${ids(ins.data.map((r) => r.id))})`);
  denied(ins, "employee.a inserts primary relationship naming themself manager of HR");
  assert.equal(await isManagerOf(clients.employee, hrA.employeeId), false);
  console.log("PASS is_manager_of(hr) as employee.a: false");
  const upd = await clients.employee.database.from("employee_reporting_relationships").update({ is_active: false }).eq("employee_id", report.employeeId).select("id");
  assert.ok(upd.error || upd.data.length === 0, `employee.a updated relationship rows: ${JSON.stringify(upd.data)}`);
  console.log(`PASS employee.a update of report's relationship rows: ${upd.error ? "DENIED" : "0 rows"}`);
  const orgChart = await clients.employee.database.from("employee_reporting_relationships").select("employee_id").eq("employee_id", report.employeeId);
  assert.equal(orgChart.error, null, fp(orgChart.error));
  assert.ok(orgChart.data.length > 0, "org chart read lost");
  console.log(`PASS employee.a org-chart read of relationships still works (${orgChart.data.length} rows)`);
}

async function probeCancel(clients) {
  const submit = await clients.mgrOld.database.rpc("c1_submit_new_hire_request", {
    p_name: "C3 Cancel Probe", p_email: `c3-cancel-${randomUUID().slice(0, 8)}@m1m2.test`, p_job_title_id: null, p_proposed_date_of_joining: null,
  });
  const requestId = allowed(submit, "old manager submits a new hire request");
  denied(await clients.mgrNew.database.rpc("c1_cancel_new_hire_request", { p_request_id: requestId }), "another manager cancels the request");
  allowed(await clients.mgrOld.database.rpc("c1_cancel_new_hire_request", { p_request_id: requestId }), "requester cancels own pending request");
  const status = runSql(`SELECT status FROM public.new_hire_requests WHERE id='${requestId}'`).rows[0].status;
  assert.equal(status, "cancelled");
  console.log(`PASS request status after cancel: ${status}`);
  denied(await clients.mgrOld.database.rpc("c1_cancel_new_hire_request", { p_request_id: requestId }), "requester cancels an already-cancelled request");
  denied(await clients.hr.database.rpc("c1_review_new_hire_request", { p_request_id: requestId, p_approved: true }), "HR approves a cancelled request");
  assert.equal(runSql(`SELECT status FROM public.new_hire_requests WHERE id='${requestId}'`).rows[0].status, "cancelled");
}

await guardedMutation("C3 disposable fixture", async () => {
  const key = anonKey();
  const clients = {
    employee: await signIn(employeeA, key),
    hr: await signIn(hrA, key),
    crossTenant: await signIn(employeeB, key),
  };
  await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });

  try {
    setupFixture();
    clients.mgrOld = await signIn(mgrOld, key);
    clients.mgrNew = await signIn(mgrNew, key);
    await rlsInvariant(clients, { employee: 1, hr: 6, crossTenant: 0, mgrOld: 1, mgrNew: 1 });

    await probeReportingPath(clients);
    await probeFallbackGone(clients);
    await probeNoEmployeeDelete(clients);
    await probeRelationshipWrites(clients);
    await probeCancel(clients);
  } finally {
    teardownFixture();
    await rlsInvariant({ employee: clients.employee, hr: clients.hr, crossTenant: clients.crossTenant }, { employee: 1, hr: 2, crossTenant: 0 });
  }
});
