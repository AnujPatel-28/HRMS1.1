#!/usr/bin/env node
// C4 -- re-derive an already-derived attendance day. Disposable employee + shift in Company A
// (which has no shifts of its own). Days: D1 has punches, D2 has none, D3 is HR-corrected/locked.
// Approve a leave over D1..D3, cancel it, and compare evidence byte-for-byte (to_jsonb), not by eye.
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
const employeeA = { email: "employee.a@m1m2.test", userId: "a0000000-0000-4000-8001-000000000001" };
const hrA = { email: "hr-employee.a@m1m2.test", userId: "a0000000-0000-4000-8002-000000000001" };
const employeeB = { email: "employee.b@m1m2.test", userId: "b0000000-0000-4000-8001-000000000001" };

const E = randomUUID();       // disposable employee (HR acts on them)
const EU = randomUUID();      // its auth user: leave approval requires the subject to have a login
const S = randomUUID();       // disposable shift
const L = randomUUID();       // the leave
const L2 = randomUUID();      // leave for the leave-only-tenant scenario
const D1 = "2026-08-03", D2 = "2026-08-04", D3 = "2026-08-05", D4 = "2026-08-06";
let attendanceWasEnabled = null; // Company A's attendance module flag, restored in finally

const fp = (error) => [error?.code, error?.message].filter(Boolean).join(" | ");
const results = [];
const check = (pass, line) => { const l = `${pass ? "PASS" : "FAIL"} ${line}`; results.push(l); console.log(l); return pass; };

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

// TB's gateway intermittently drops an idle keep-alive socket: the first request after a few
// seconds of CLI work (runSql) then fails at the network layer ("fetch failed") and never reaches
// the function. A throwaway read before each such call absorbs that, so the real call gets a fresh
// socket -- and no function error can ever be masked (the real call is not retried).
async function warm(client) {
  const { error } = await client.database.from("tenants").select("id").limit(1);
  if (error && /fetch failed/i.test(error.message ?? "")) console.log("NOTE warm-up absorbed a dropped keep-alive socket");
}

const day = (d) => runSql(`SELECT id, status, is_locked, leave_id, punch_in, punch_out, in_time, out_time, work_hours, notes
  FROM public.attendance WHERE tenant_id='${A}' AND employee_id='${E}' AND date='${d}'`).rows;
const rowJson = (d) => runSql(`SELECT to_jsonb(a) - 'derived_at' AS j FROM public.attendance a WHERE tenant_id='${A}' AND employee_id='${E}' AND date='${d}'`).rows.map((r) => JSON.stringify(r.j));
const events = () => runSql(`SELECT to_jsonb(e) AS j FROM public.attendance_events e WHERE tenant_id='${A}' AND employee_id='${E}' ORDER BY event_time`).rows.map((r) => JSON.stringify(r.j));
const evidence = (d) => runSql(`SELECT punch_in, punch_out, in_time, out_time FROM public.attendance WHERE tenant_id='${A}' AND employee_id='${E}' AND date='${d}'`).rows.map((r) => JSON.stringify(r));

function setupFixture() {
  runSql(`
    INSERT INTO public.shifts(id,tenant_id,name,start_time,end_time,working_days,working_hours_threshold_for_absent,working_hours_threshold_for_half_day,last_sync_of_events)
      VALUES ('${S}','${A}','C4 fixture','09:00','18:00','{0,1,2,3,4,5,6}',2,4,now());
    INSERT INTO auth.users(id,email,password,email_verified,metadata)
      VALUES ('${EU}','c4-${E.slice(0, 8)}@m1m2.test',crypt(gen_random_uuid()::text,gen_salt('bf',4)),true,'{"role":"employee"}'::jsonb);
    INSERT INTO public.employees(id,user_id,tenant_id,full_name,email,status,date_of_joining)
      VALUES ('${E}','${EU}','${A}','C4 Fixture Employee','c4-${E.slice(0, 8)}@m1m2.test','active','2026-01-01');
    INSERT INTO public.employee_shifts(tenant_id,employee_id,shift_id,effective_from) VALUES ('${A}','${E}','${S}','2026-01-01');
    INSERT INTO public.attendance_events(tenant_id,employee_id,event_time,direction,source,shift_id,shift_start,shift_end) VALUES
      ('${A}','${E}','${D1}T09:00:00+05:30','in','app','${S}','${D1}T09:00:00+05:30','${D1}T18:00:00+05:30'),
      ('${A}','${E}','${D1}T18:00:00+05:30','out','app','${S}','${D1}T09:00:00+05:30','${D1}T18:00:00+05:30');
  `);
}
function teardownFixture() {
  runSql(`
    DELETE FROM public.notifications WHERE tenant_id='${A}' AND employee_id='${E}';
    DELETE FROM public.audit_logs WHERE tenant_id='${A}' AND (target_id='${E}' OR target_id='${L}' OR target_id='${L2}');
    DELETE FROM public.attendance_events WHERE tenant_id='${A}' AND employee_id='${E}';
    DELETE FROM public.attendance WHERE tenant_id='${A}' AND employee_id='${E}';
    DELETE FROM public.leaves WHERE id IN ('${L}','${L2}');
    DELETE FROM public.attendance_derivation_runs WHERE tenant_id='${A}' AND (shift_id='${S}' OR (shift_id IS NULL AND from_date='${D1}' AND to_date='${D3}'));
    DELETE FROM public.employee_shifts WHERE employee_id='${E}';
    DELETE FROM public.shifts WHERE id='${S}';
    DELETE FROM public.employees WHERE id='${E}';
    DELETE FROM auth.users WHERE id='${EU}';
  `);
  const left = Number(runSql(`SELECT (SELECT count(*) FROM public.employees WHERE id='${E}') + (SELECT count(*) FROM public.shifts WHERE id='${S}') AS n`).rows[0].n);
  assert.equal(left, 0, "C4 fixture residue");
}

await guardedMutation("C4 disposable fixture", async () => {
  const key = anonKey();
  const clients = { employee: await signIn(employeeA, key), hr: await signIn(hrA, key), crossTenant: await signIn(employeeB, key) };
  await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });
  const hr = clients.hr, emp = clients.employee;
  try {
    setupFixture();

    // Baseline: derive D1..D3 through the existing HR path, then HR-correct and lock D3.
    await warm(hr);
    const run = await hr.database.rpc("hr_run_attendance_derivation", { p_tenant_id: A, p_from: D1, p_to: D3 });
    assert.equal(run.error, null, `baseline derivation: ${fp(run.error)}`);
    runSql(`UPDATE public.attendance SET is_locked=true, status='present', notes='C4 HR correction' WHERE tenant_id='${A}' AND employee_id='${E}' AND date='${D3}'`);
    const b1 = day(D1)[0], b2 = day(D2)[0], b3 = day(D3)[0];
    assert.equal(b1?.status, "present", `precondition D1 present, got ${JSON.stringify(b1)}`);
    assert.equal(b2?.status, "absent", `precondition D2 absent, got ${JSON.stringify(b2)}`);
    assert.equal(b3?.is_locked, true, "precondition D3 locked");
    console.log(`Baseline: D1=${b1.status} (${b1.work_hours}h), D2=${b2.status}, D3=${b3.status} locked`);
    const ev0 = events(), evid0 = evidence(D1), lock0 = rowJson(D3);

    // Approve a leave over D1..D3 (no leave type -> no balance involved).
    runSql(`INSERT INTO public.leaves(id,tenant_id,employee_id,leave_type,start_date,end_date,reason,status)
      VALUES ('${L}','${A}','${E}','casual','${D1}','${D3}','C4 probe','pending')`);
    await warm(hr);
    const ap = await hr.database.rpc("approve_leave_request", { p_leave_id: L });
    assert.equal(ap.error, null, `approve: ${fp(ap.error)}`);
    check(day(D1)[0]?.status === "on_leave", `approve -> D1 on_leave (got ${day(D1)[0]?.status})`);
    check(JSON.stringify(evidence(D1)) === JSON.stringify(evid0), "approve keeps D1 punch evidence byte-identical");
    check(JSON.stringify(rowJson(D3)) === JSON.stringify(lock0), `approve leaves the locked D3 untouched (status now ${day(D3)[0]?.status})`);

    // Cancel -> every day snaps back.
    await warm(hr);
    const cn = await hr.database.rpc("cancel_leave_request", { p_leave_id: L, p_rejection_reason: "C4 probe", p_new_status: "cancelled" });
    assert.equal(cn.error, null, `cancel: ${fp(cn.error)}`);
    check(day(D1)[0]?.status === "present", `cancel -> D1 back to punch-derived 'present' (got ${day(D1)[0]?.status})`);
    check(day(D1).length === 1, `cancel -> D1 has exactly one row (got ${day(D1).length})`);
    check(JSON.stringify(evidence(D1)) === JSON.stringify(evid0), "cancel keeps D1 punch/in/out times byte-identical");
    check(JSON.stringify(events()) === JSON.stringify(ev0), "cancel keeps every event row byte-identical (incl. attendance_id)");
    check(day(D2)[0]?.status === "absent", `cancel -> no-event D2 back to calendar status 'absent' (got ${day(D2)[0]?.status ?? "no row"})`);
    check(JSON.stringify(rowJson(D3)) === JSON.stringify(lock0), "cancel leaves the locked D3 byte-identical");

    // HR "recalculate day": works, is idempotent, respects the lock.
    await warm(hr);
    const r1 = await hr.database.rpc("hr_rederive_attendance_day", { p_tenant_id: A, p_employee_id: E, p_date: D1 });
    const r2 = await hr.database.rpc("hr_rederive_attendance_day", { p_tenant_id: A, p_employee_id: E, p_date: D1 });
    check(!r1.error && !r2.error && r1.data === "present" && r2.data === "present", `HR recalculate D1 twice -> ${r1.data ?? fp(r1.error)} / ${r2.data ?? fp(r2.error)}`);
    check(day(D1).length === 1 && JSON.stringify(events()) === JSON.stringify(ev0) && JSON.stringify(evidence(D1)) === JSON.stringify(evid0),
      "retry is idempotent: one row, events and punch evidence unchanged");
    await warm(hr);
    const r3 = await hr.database.rpc("hr_rederive_attendance_day", { p_tenant_id: A, p_employee_id: E, p_date: D3 });
    check(r3.data === "locked" && JSON.stringify(rowJson(D3)) === JSON.stringify(lock0), `HR recalculate locked D3 -> ${r3.data ?? fp(r3.error)}, row untouched`);

    // Authority.
    await warm(emp);
    const e1 = await emp.database.rpc("hr_rederive_attendance_day", { p_tenant_id: A, p_employee_id: E, p_date: D1 });
    check(!!e1.error, `employee calls hr_rederive_attendance_day -> ${e1.error ? "DENIED " + fp(e1.error) : "ALLOWED"}`);
    const e2 = await emp.database.rpc("attendance_rederive_day", { p_tenant_id: A, p_employee_id: E, p_date: D1 });
    check(!!e2.error, `employee calls internal attendance_rederive_day -> ${e2.error ? "DENIED " + fp(e2.error) : "ALLOWED"}`);
    const x1 = await clients.crossTenant.database.rpc("hr_rederive_attendance_day", { p_tenant_id: A, p_employee_id: E, p_date: D1 });
    check(!!x1.error, `cross-tenant employee calls hr_rederive_attendance_day -> ${x1.error ? "DENIED" : "ALLOWED"}`);

    // Module independence: a Leave-only tenant (attendance OFF) must still cancel an approved leave.
    attendanceWasEnabled = runSql(`SELECT enabled FROM public.tenant_modules WHERE tenant_id='${A}' AND module_key='attendance'`).rows[0]?.enabled;
    runSql(`UPDATE public.tenant_modules SET enabled=false WHERE tenant_id='${A}' AND module_key='attendance'`);
    runSql(`INSERT INTO public.leaves(id,tenant_id,employee_id,leave_type,start_date,end_date,reason,status)
      VALUES ('${L2}','${A}','${E}','casual','${D4}','${D4}','C4 leave-only probe','pending')`);
    await warm(hr);
    const ap2 = await hr.database.rpc("approve_leave_request", { p_leave_id: L2 });
    check(!ap2.error, `attendance OFF: approve -> ${ap2.error ? fp(ap2.error) : "ok"}`);
    await warm(hr);
    const cn2 = await hr.database.rpc("cancel_leave_request", { p_leave_id: L2, p_rejection_reason: "C4 probe", p_new_status: "cancelled" });
    const leftD4 = runSql(`SELECT count(*)::int n FROM public.attendance WHERE tenant_id='${A}' AND employee_id='${E}' AND date='${D4}'`).rows[0].n;
    const statusL2 = runSql(`SELECT status FROM public.leaves WHERE id='${L2}'`).rows[0].status;
    check(!cn2.error && statusL2 === "cancelled" && leftD4 === 0,
      `attendance OFF: cancel succeeds (${cn2.error ? fp(cn2.error) : "ok"}), leave=${statusL2}, placeholder rows left=${leftD4}`);
  } finally {
    if (attendanceWasEnabled !== null) {
      runSql(`UPDATE public.tenant_modules SET enabled=${attendanceWasEnabled === true || attendanceWasEnabled === "true"} WHERE tenant_id='${A}' AND module_key='attendance'`);
    }
    teardownFixture();
    for (const c of Object.values(clients)) await warm(c);
    await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });
  }
  const failed = results.filter((l) => l.startsWith("FAIL"));
  console.log(`\nC4: ${results.length - failed.length}/${results.length} PASS`);
  assert.equal(failed.length, 0, `C4 failures:\n${failed.join("\n")}`);
});
