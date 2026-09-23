#!/usr/bin/env node
// C7 -- PERMISSIVE tenant-only write policies. An ordinary employee (employee.a) attempts real,
// valid writes on nine tables; every row it manages to create is removed immediately. HR write
// paths and every legitimate employee read path are exercised against disposable fixture rows.
// Conventions follow c3_manager_convergence.mjs. RLS invariant 1/2/0 before and after.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

const A = "a0000000-0000-4000-8000-000000000001";
const employeeA = { email: "employee.a@m1m2.test", userId: "a0000000-0000-4000-8001-000000000001", employeeId: "a0000000-0000-4000-8001-000000000002" };
const hrA = { email: "hr-employee.a@m1m2.test", userId: "a0000000-0000-4000-8002-000000000001", employeeId: "a0000000-0000-4000-8002-000000000002" };
const employeeB = { email: "employee.b@m1m2.test", userId: "b0000000-0000-4000-8001-000000000001" };

// Fixture rows (created by SQL, owned by nobody under test). Marker values keep teardown exact.
const fx = {
  shift: randomUUID(), office: randomUUID(), empShiftSelf: randomUUID(), empShiftHr: randomUUID(),
  run: randomUUID(), window: randomUUID(), exceptionHr: randomUUID(), exceptionSelf: randomUUID(), onboarding: randomUUID(),
};
const MARK = "C7 fixture";
let payrollWasEnabled = null; // Company A's payroll module flag before the run, restored in teardown
const FY = "2099-00";

const fp = (error) => [error?.code, error?.message].filter(Boolean).join(" | ");
const results = [];
const record = (line) => { results.push(line); console.log(line); };

function anonKey() {
  const cli = join(root, "node_modules", "@insforge", "cli", "dist", "index.js");
  const result = spawnSync(process.execPath, [cli, "secrets", "get", "ANON_KEY", "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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
    const { data, error } = await client.database.from("employees").select("id").eq("tenant_id", A);
    assert.equal(error, null, `${name} employees: ${fp(error)}`);
    counts[name] = data.length;
  }
  assert.deepEqual(counts, expected);
  console.log(`RLS Company A employees (${Object.keys(counts).join(" / ")}): ${Object.values(counts).join(" / ")}`);
}

function setupFixture() {
  payrollWasEnabled = runSql(`SELECT enabled FROM public.tenant_modules WHERE tenant_id='${A}' AND module_key='payroll'`).rows[0]?.enabled ?? false;
  runSql(`
    UPDATE public.tenant_modules SET enabled = true WHERE tenant_id='${A}' AND module_key='payroll';
    INSERT INTO public.shifts(id,tenant_id,name,start_time,end_time) VALUES ('${fx.shift}','${A}','${MARK}','09:00','18:00');
    INSERT INTO public.office_locations(id,tenant_id,name,lat,lng) VALUES ('${fx.office}','${A}','${MARK}',12.97,77.59);
    INSERT INTO public.employee_shifts(id,tenant_id,employee_id,shift_id,effective_from,effective_to) VALUES
      ('${fx.empShiftSelf}','${A}','${employeeA.employeeId}','${fx.shift}','2099-01-01','2099-01-31'),
      ('${fx.empShiftHr}','${A}','${hrA.employeeId}','${fx.shift}','2099-01-01','2099-01-31');
    INSERT INTO public.payroll_runs(id,tenant_id,month,year) VALUES ('${fx.run}','${A}',1,2099);
    INSERT INTO public.it_declaration_windows(id,tenant_id,financial_year) VALUES ('${fx.window}','${A}','${FY}');
    INSERT INTO public.attendance_location_exceptions(id,tenant_id,employee_id,exception_type,start_date,end_date,reason) VALUES
      ('${fx.exceptionHr}','${A}','${hrA.employeeId}','work_from_home','2099-01-01','2099-01-02','${MARK}'),
      ('${fx.exceptionSelf}','${A}','${employeeA.employeeId}','work_from_home','2099-01-01','2099-01-02','${MARK}');
    INSERT INTO public.employee_onboarding(id,tenant_id,auth_user_id,status) VALUES ('${fx.onboarding}','${A}','${randomUUID()}','pending');
  `);
}

function teardownFixture() {
  runSql(`
    UPDATE public.tenant_modules SET enabled = ${payrollWasEnabled === true || payrollWasEnabled === "true"} WHERE tenant_id='${A}' AND module_key='payroll';
    DELETE FROM public.employee_shifts WHERE tenant_id='${A}' AND (shift_id='${fx.shift}' OR effective_from >= '2099-01-01');
    DELETE FROM public.shifts WHERE tenant_id='${A}' AND (id='${fx.shift}' OR name LIKE 'C7 %');
    DELETE FROM public.office_locations WHERE tenant_id='${A}' AND name LIKE 'C7 %';
    DELETE FROM public.payroll_runs WHERE tenant_id='${A}' AND year >= 2099;
    DELETE FROM public.it_declaration_windows WHERE tenant_id='${A}' AND financial_year LIKE '2099%';
    DELETE FROM public.it_declarations WHERE tenant_id='${A}' AND financial_year LIKE '2099%';
    DELETE FROM public.attendance_location_exceptions WHERE tenant_id='${A}' AND (reason LIKE 'C7 %' OR start_date >= '2099-01-01');
    DELETE FROM public.employee_onboarding WHERE tenant_id='${A}' AND (id='${fx.onboarding}' OR last_error LIKE 'C7 %' OR status='c7-probe');
  `);
  const left = runSql(`SELECT
    (SELECT count(*) FROM public.shifts WHERE tenant_id='${A}' AND name LIKE 'C7 %') +
    (SELECT count(*) FROM public.office_locations WHERE tenant_id='${A}' AND name LIKE 'C7 %') +
    (SELECT count(*) FROM public.payroll_runs WHERE tenant_id='${A}' AND year >= 2099) +
    (SELECT count(*) FROM public.employee_onboarding WHERE id='${fx.onboarding}') AS n`).rows[0].n;
  assert.equal(Number(left), 0, "C7 fixture residue");
}

// Attack: a valid INSERT as employee.a. A created row is an exploit; delete it at once.
async function attackInsert(client, table, row) {
  const res = await client.database.from(table).insert(row).select("id");
  if (!res.error && res.data?.length) runSql(`DELETE FROM public.${table} WHERE id IN (${res.data.map((r) => `'${r.id}'`).join(",")})`);
  const ok = !!res.error;
  record(`${ok ? "PASS" : "FAIL"} employee INSERT ${table}: ${ok ? "DENIED " + fp(res.error) : "CREATED a row"}`);
  return ok;
}
// Attack: UPDATE / DELETE a fixture row employee.a does not own. Success = rows returned.
async function attackWrite(client, table, id, patch) {
  let pass = true;
  const upd = await client.database.from(table).update(patch).eq("id", id).select("id");
  const u = upd.error ? "DENIED" : `${upd.data.length} rows`;
  if (!upd.error && upd.data.length) pass = false;
  const del = await client.database.from(table).delete().eq("id", id).select("id");
  const d = del.error ? "DENIED" : `${del.data.length} rows`;
  if (!del.error && del.data.length) pass = false;
  const still = Number(runSql(`SELECT count(*) AS n FROM public.${table} WHERE id='${id}'`).rows[0].n);
  if (still !== 1) pass = false;
  record(`${pass ? "PASS" : "FAIL"} employee UPDATE/DELETE ${table} (not own): update=${u} delete=${d} row present=${still === 1}`);
  return pass;
}
async function canRead(client, table, id, expected, label) {
  const res = await client.database.from(table).select("id").eq("id", id);
  const n = res.error ? `ERR ${fp(res.error)}` : res.data.length;
  const pass = n === expected;
  record(`${pass ? "PASS" : "FAIL"} ${label} reads ${table}: ${n} (expected ${expected})`);
  return pass;
}
async function hrRoundTrip(client, table, row, patch) {
  const ins = await client.database.from(table).insert(row).select("id");
  if (ins.error) { record(`FAIL HR INSERT ${table}: ${fp(ins.error)}`); return false; }
  const id = ins.data[0].id;
  const upd = await client.database.from(table).update(patch).eq("id", id).select("id");
  const del = await client.database.from(table).delete().eq("id", id).select("id");
  const pass = !upd.error && upd.data.length === 1 && !del.error && del.data.length === 1;
  record(`${pass ? "PASS" : "FAIL"} HR insert/update/delete ${table}: ${pass ? "ALLOWED" : fp(upd.error || del.error)}`);
  return pass;
}

await guardedMutation("C7 disposable fixture", async () => {
  const key = anonKey();
  const clients = { employee: await signIn(employeeA, key), hr: await signIn(hrA, key), crossTenant: await signIn(employeeB, key) };
  await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });
  const emp = clients.employee, hr = clients.hr;
  const checks = [];
  try {
    setupFixture();

    // --- legitimate employee reads ---
    checks.push(await canRead(emp, "shifts", fx.shift, 1, "employee"));
    checks.push(await canRead(emp, "office_locations", fx.office, 1, "employee"));
    checks.push(await canRead(emp, "employee_shifts", fx.empShiftSelf, 1, "employee (own)"));
    checks.push(await canRead(emp, "payroll_runs", fx.run, 1, "employee (MyPayslips status)"));
    checks.push(await canRead(emp, "it_declaration_windows", fx.window, 1, "employee (TaxDeclaration)"));
    checks.push(await canRead(emp, "attendance_location_exceptions", fx.exceptionSelf, 1, "employee (own)"));
    checks.push(await canRead(emp, "attendance_location_exceptions", fx.exceptionHr, 0, "employee (colleague's)"));
    checks.push(await canRead(clients.crossTenant, "shifts", fx.shift, 0, "cross-tenant employee"));

    // --- legitimate employee write: own tax declaration (declarations_self_all) ---
    const own = await emp.database.from("it_declarations").insert({ tenant_id: A, employee_id: employeeA.employeeId, financial_year: FY }).select("id");
    const ownPass = !own.error && own.data.length === 1;
    record(`${ownPass ? "PASS" : "FAIL"} employee INSERT own it_declarations: ${ownPass ? "ALLOWED" : fp(own.error)}`);
    checks.push(ownPass);

    // --- HR write paths ---
    checks.push(await hrRoundTrip(hr, "shifts", { tenant_id: A, name: "C7 hr", start_time: "10:00", end_time: "19:00" }, { name: "C7 hr2" }));
    checks.push(await hrRoundTrip(hr, "office_locations", { tenant_id: A, name: "C7 hr", lat: 1, lng: 1 }, { lat: 2 }));
    checks.push(await hrRoundTrip(hr, "employee_shifts", { tenant_id: A, employee_id: hrA.employeeId, shift_id: fx.shift, effective_from: "2099-09-01" }, { effective_to: "2099-12-31" }));
    checks.push(await hrRoundTrip(hr, "payroll_runs", { tenant_id: A, month: 3, year: 2099 }, { status: "under_review" }));
    checks.push(await hrRoundTrip(hr, "it_declaration_windows", { tenant_id: A, financial_year: "2099-03" }, { financial_year: "2099-04" }));
    checks.push(await hrRoundTrip(hr, "attendance_location_exceptions", { tenant_id: A, employee_id: employeeA.employeeId, exception_type: "work_from_home", start_date: "2099-04-01", end_date: "2099-04-02", reason: "C7 hr" }, { status: "approved" }));
    checks.push(await hrRoundTrip(hr, "employee_onboarding", { tenant_id: A, auth_user_id: randomUUID(), status: "c7-probe" }, { last_error: "C7 hr" }));
    // --- attacks (employee.a) ---
    checks.push(await attackInsert(emp, "shifts", { tenant_id: A, name: "C7 attack", start_time: "09:00", end_time: "17:00" }));
    checks.push(await attackInsert(emp, "office_locations", { tenant_id: A, name: "C7 attack", lat: 0, lng: 0 }));
    checks.push(await attackInsert(emp, "employee_shifts", { tenant_id: A, employee_id: hrA.employeeId, shift_id: fx.shift, effective_from: "2099-06-01" }));
    checks.push(await attackInsert(emp, "payroll_runs", { tenant_id: A, month: 2, year: 2099 }));
    checks.push(await attackInsert(emp, "it_declaration_windows", { tenant_id: A, financial_year: "2099-01" }));
    checks.push(await attackInsert(emp, "it_declarations", { tenant_id: A, employee_id: hrA.employeeId, financial_year: FY }));
    checks.push(await attackInsert(emp, "attendance_location_exceptions", { tenant_id: A, employee_id: employeeA.employeeId, exception_type: "work_from_home", start_date: "2099-02-01", end_date: "2099-02-02", reason: "C7 attack", status: "approved" }));
    checks.push(await attackInsert(emp, "employee_onboarding", { tenant_id: A, auth_user_id: randomUUID(), status: "c7-probe" }));
    checks.push(await attackInsert(emp, "employee_policy_acknowledgements", { tenant_id: A, employee_id: hrA.employeeId, policy_id: randomUUID() }));
    checks.push(await attackWrite(emp, "shifts", fx.shift, { start_time: "00:00" }));
    checks.push(await attackWrite(emp, "office_locations", fx.office, { lat: 0 }));
    checks.push(await attackWrite(emp, "employee_shifts", fx.empShiftHr, { effective_from: "2099-03-01" }));
    checks.push(await attackWrite(emp, "payroll_runs", fx.run, { status: "paid" }));
    checks.push(await attackWrite(emp, "it_declaration_windows", fx.window, { financial_year: "2099-02" }));
    checks.push(await attackWrite(emp, "attendance_location_exceptions", fx.exceptionHr, { status: "approved" }));
    checks.push(await attackWrite(emp, "employee_onboarding", fx.onboarding, { last_error: "C7 attack" }));

  } finally {
    teardownFixture();
    await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });
  }
  const failed = results.filter((l) => l.startsWith("FAIL"));
  console.log(`\nC7: ${results.length - failed.length}/${results.length} PASS`);
  assert.equal(failed.length, 0, `C7 failures:\n${failed.join("\n")}`);
});
