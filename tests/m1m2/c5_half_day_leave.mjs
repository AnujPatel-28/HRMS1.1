#!/usr/bin/env node
// C5 -- half-day leave. A disposable employee (with a login) applies through the real RPC; HR approves
// and cancels. Past days with real punch events prove the derived status and late/early flags.
// Conventions follow c4_rederive_day.mjs. RLS invariant 1/2/0 before and after.
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

const A = "a0000000-0000-4000-8000-000000000001";
const employeeA = { email: "employee.a@m1m2.test", userId: "a0000000-0000-4000-8001-000000000001" };
const hrA = { email: "hr-employee.a@m1m2.test", userId: "a0000000-0000-4000-8002-000000000001" };
const employeeB = { email: "employee.b@m1m2.test", userId: "b0000000-0000-4000-8001-000000000001" };

const P = { email: `c5-emp-${randomUUID().slice(0, 8)}@m1m2.test`, userId: randomUUID(), employeeId: randomUUID() };
P.membershipId = (() => {
  const hex = createHash("md5").update(`${A}:${P.userId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
})();
const S = randomUUID();                    // shift, late/early marking on, 09:00-18:00, every day
const LT_HALF = randomUUID(), LT_FULL = randomUUID();
const CODE_HALF = `C5H${P.userId.slice(0, 2)}`.toUpperCase(), CODE_FULL = `C5F${P.userId.slice(0, 2)}`.toUpperCase(); // codes are max 5 chars

const iso = (d) => d.toISOString().slice(0, 10);
const F = iso(new Date(Date.now() + 30 * 86400000));   // future working day for the apply path
const F2 = iso(new Date(Date.now() + 31 * 86400000));
const YEAR_F = Number(F.slice(0, 4));
const PAST1 = "2026-08-10", PAST2 = "2026-08-11", PAST3 = "2026-08-12";   // punch days
const LP1 = randomUUID(), LP2 = randomUUID();          // SQL-inserted pending half-day leaves (backdated)

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
    if (!(name in expected)) continue;
    const { data, error } = await client.database.from("employees").select("id").eq("tenant_id", A);
    assert.equal(error, null, `${name} employees: ${fp(error)}`);
    counts[name] = data.length;
  }
  assert.deepEqual(counts, expected);
  console.log(`RLS Company A employees (${Object.keys(counts).join(" / ")}): ${Object.values(counts).join(" / ")}`);
}
// TB's gateway drops idle keep-alive sockets after CLI work; absorb that with a throwaway read
// so the real call gets a fresh socket (see c4_rederive_day.mjs). The real call is never retried.
async function warm(client) {
  const { error } = await client.database.from("tenants").select("id").limit(1);
  if (error && /fetch failed/i.test(error.message ?? "")) console.log("NOTE warm-up absorbed a dropped keep-alive socket");
}

const balance = () => runSql(`SELECT balance, used_days FROM public.leave_balances WHERE employee_id='${P.employeeId}' AND leave_type_id='${LT_HALF}' AND year=${YEAR_F}`).rows[0];
const leave = (id) => runSql(`SELECT status, total_days, approved_business_days, day_fraction, half_day_session FROM public.leaves WHERE id='${id}'`).rows[0];
const day = (d) => runSql(`SELECT status, late_entry, is_late, early_exit, leave_id FROM public.attendance WHERE tenant_id='${A}' AND employee_id='${P.employeeId}' AND date='${d}'`).rows;

function setupFixture() {
  runSql(`
    INSERT INTO public.shifts(id,tenant_id,name,start_time,end_time,working_days,working_hours_threshold_for_absent,working_hours_threshold_for_half_day,
      last_sync_of_events,enable_late_entry_marking,late_entry_grace_minutes,enable_early_exit_marking,early_exit_grace_minutes)
      VALUES ('${S}','${A}','C5 fixture','09:00','18:00','{0,1,2,3,4,5,6}',2,4,now(),true,10,true,10);
    INSERT INTO auth.users(id,email,password,email_verified,metadata)
      VALUES ('${P.userId}','${P.email}',crypt('${password.replaceAll("'", "''")}',gen_salt('bf',10)),true,'{"role":"employee","tenant_id":"${A}"}'::jsonb);
    INSERT INTO public.employees(id,user_id,tenant_id,full_name,email,status,date_of_joining)
      VALUES ('${P.employeeId}','${P.userId}','${A}','C5 Fixture Employee','${P.email}','active','2026-01-01');
    INSERT INTO public.tenant_memberships(tenant_id,user_id,employee_id,status) VALUES ('${A}','${P.userId}','${P.employeeId}','active');
    INSERT INTO public.membership_template_assignments(membership_id,tenant_id,template_key,is_active) VALUES ('${P.membershipId}','${A}','employee',true);
    INSERT INTO public.employee_shifts(tenant_id,employee_id,shift_id,effective_from) VALUES ('${A}','${P.employeeId}','${S}','2026-01-01');
    INSERT INTO public.leave_types(id,tenant_id,name,code,is_active,allow_half_day) VALUES
      ('${LT_HALF}','${A}','C5 Half-capable','${CODE_HALF}',true,true),
      ('${LT_FULL}','${A}','C5 Full-only','${CODE_FULL}',true,false);
    INSERT INTO public.leave_balances(tenant_id,employee_id,leave_type_id,year,balance,total_allocated,used_days) VALUES
      ('${A}','${P.employeeId}','${LT_HALF}',${YEAR_F},5,5,0),
      ('${A}','${P.employeeId}','${LT_FULL}',${YEAR_F},5,5,0)
      ON CONFLICT DO NOTHING;
    INSERT INTO public.leave_balances(tenant_id,employee_id,leave_type_id,year,balance,total_allocated,used_days) VALUES
      ('${A}','${P.employeeId}','${LT_HALF}',2026,5,5,0) ON CONFLICT DO NOTHING;
    -- PAST1: arrives 14:00 (first-half leave). PAST2: leaves 13:00 (second-half leave). PAST3: arrives 14:00, no leave.
    INSERT INTO public.attendance_events(tenant_id,employee_id,event_time,direction,source,shift_id,shift_start,shift_end) VALUES
      ('${A}','${P.employeeId}','${PAST1}T14:00:00+05:30','in','app','${S}','${PAST1}T09:00:00+05:30','${PAST1}T18:00:00+05:30'),
      ('${A}','${P.employeeId}','${PAST1}T18:00:00+05:30','out','app','${S}','${PAST1}T09:00:00+05:30','${PAST1}T18:00:00+05:30'),
      ('${A}','${P.employeeId}','${PAST2}T09:00:00+05:30','in','app','${S}','${PAST2}T09:00:00+05:30','${PAST2}T18:00:00+05:30'),
      ('${A}','${P.employeeId}','${PAST2}T13:00:00+05:30','out','app','${S}','${PAST2}T09:00:00+05:30','${PAST2}T18:00:00+05:30'),
      ('${A}','${P.employeeId}','${PAST3}T14:00:00+05:30','in','app','${S}','${PAST3}T09:00:00+05:30','${PAST3}T18:00:00+05:30'),
      ('${A}','${P.employeeId}','${PAST3}T18:00:00+05:30','out','app','${S}','${PAST3}T09:00:00+05:30','${PAST3}T18:00:00+05:30');
    INSERT INTO public.leaves(id,tenant_id,employee_id,leave_type_id,leave_type,start_date,end_date,total_days,reason,status,day_fraction,half_day_session) VALUES
      ('${LP1}','${A}','${P.employeeId}','${LT_HALF}','other','${PAST1}','${PAST1}',0.5,'C5 probe','pending',0.5,'first'),
      ('${LP2}','${A}','${P.employeeId}','${LT_HALF}','other','${PAST2}','${PAST2}',0.5,'C5 probe','pending',0.5,'second');
  `);
}
function teardownFixture() {
  runSql(`
    DELETE FROM public.notifications WHERE tenant_id='${A}' AND (employee_id='${P.employeeId}' OR reference_id IN (SELECT id FROM public.leaves WHERE employee_id='${P.employeeId}'));
    DELETE FROM public.audit_logs WHERE tenant_id='${A}' AND (target_id='${P.employeeId}' OR target_id IN (SELECT id FROM public.leaves WHERE employee_id='${P.employeeId}'));
    DELETE FROM public.attendance_events WHERE tenant_id='${A}' AND employee_id='${P.employeeId}';
    DELETE FROM public.attendance WHERE tenant_id='${A}' AND employee_id='${P.employeeId}';
    DELETE FROM public.leaves WHERE employee_id='${P.employeeId}';
    DELETE FROM public.leave_balances WHERE employee_id='${P.employeeId}';
    DELETE FROM public.leave_types WHERE id IN ('${LT_HALF}','${LT_FULL}');
    DELETE FROM public.attendance_derivation_runs WHERE tenant_id='${A}' AND shift_id='${S}';
    DELETE FROM public.employee_shifts WHERE employee_id='${P.employeeId}';
    DELETE FROM public.shifts WHERE id='${S}';
    DELETE FROM public.membership_template_assignments WHERE membership_id='${P.membershipId}';
    DELETE FROM public.tenant_memberships WHERE id='${P.membershipId}';
    DELETE FROM public.employees WHERE id='${P.employeeId}';
    DELETE FROM auth.users WHERE id='${P.userId}';
  `);
  const left = Number(runSql(`SELECT (SELECT count(*) FROM public.employees WHERE id='${P.employeeId}') + (SELECT count(*) FROM public.leave_types WHERE id IN ('${LT_HALF}','${LT_FULL}')) AS n`).rows[0].n);
  assert.equal(left, 0, "C5 fixture residue");
}

const apply = (client, args) => client.database.rpc("employee_apply_leave_request", { p_tenant_id: A, p_reason: "C5 probe", ...args });

await guardedMutation("C5 disposable fixture", async () => {
  const key = anonKey();
  const clients = { employee: await signIn(employeeA, key), hr: await signIn(hrA, key), crossTenant: await signIn(employeeB, key) };
  await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });
  const hr = clients.hr;
  try {
    setupFixture();
    const me = await signIn(P, key);

    // --- apply validation ---
    let r = await apply(me, { p_leave_type_id: LT_FULL, p_start_date: F, p_end_date: F, p_half_day_session: "first" });
    check(!!r.error && /does not allow half-day/.test(r.error.message), `type without allow_half_day rejects half-day -> ${fp(r.error) || "ALLOWED"}`);
    r = await apply(me, { p_leave_type_id: LT_HALF, p_start_date: F, p_end_date: F2, p_half_day_session: "first" });
    check(!!r.error && /single day/.test(r.error.message), `multi-day half-day rejected -> ${fp(r.error) || "ALLOWED"}`);
    r = await apply(me, { p_leave_type_id: LT_HALF, p_start_date: F, p_end_date: F, p_half_day_session: "middle" });
    check(!!r.error && /first or second/.test(r.error.message), `invalid session rejected -> ${fp(r.error) || "ALLOWED"}`);

    // 5-argument call (the pre-C5 frontend) still applies a full-day leave.
    r = await apply(me, { p_leave_type_id: LT_HALF, p_start_date: F2, p_end_date: F2 });
    const full = r.error ? null : leave(r.data);
    check(!r.error && Number(full?.total_days) === 1 && Number(full?.day_fraction) === 1 && full?.half_day_session === null,
      `5-argument (old frontend) apply still works -> ${r.error ? fp(r.error) : JSON.stringify(full)}`);
    if (!r.error) runSql(`DELETE FROM public.notifications WHERE reference_id='${r.data}'; DELETE FROM public.leaves WHERE id='${r.data}'`);

    await warm(me);
    r = await apply(me, { p_leave_type_id: LT_HALF, p_start_date: F, p_end_date: F, p_half_day_session: "first" });
    const LF = r.data;
    const lf = r.error ? null : leave(LF);
    check(!r.error && Number(lf.total_days) === 0.5 && Number(lf.day_fraction) === 0.5 && lf.half_day_session === "first",
      `valid half-day applied -> ${r.error ? fp(r.error) : JSON.stringify(lf)}`);

    // --- approve / cancel: 0.5 deducted and restored ---
    const b0 = balance();
    await warm(hr);
    const ap = await hr.database.rpc("approve_leave_request", { p_leave_id: LF });
    const b1 = balance(), la = leave(LF);
    check(!ap.error && Number(b1.balance) === Number(b0.balance) - 0.5 && Number(b1.used_days) === Number(b0.used_days) + 0.5 && Number(la.approved_business_days) === 0.5,
      `approve deducts 0.5 -> balance ${b0.balance}->${b1.balance}, used ${b0.used_days}->${b1.used_days}, approved_business_days=${la.approved_business_days} ${ap.error ? fp(ap.error) : ""}`);
    check(day(F)[0]?.status === "half_day", `approve marks the day half_day (got ${day(F)[0]?.status})`);
    await warm(hr);
    const cn = await hr.database.rpc("cancel_leave_request", { p_leave_id: LF, p_rejection_reason: "C5 probe", p_new_status: "cancelled" });
    const b2 = balance();
    check(!cn.error && Number(b2.balance) === Number(b0.balance) && Number(b2.used_days) === Number(b0.used_days),
      `cancel restores balance -> ${b2.balance} / used ${b2.used_days} ${cn.error ? fp(cn.error) : ""}`);
    check(!day(F).some((d) => d.status === "half_day" || d.leave_id), `cancel re-derives the day (rows now: ${JSON.stringify(day(F))})`);

    // --- punches + half-day leave: status and late/early flags ---
    for (const [id, d, flag, label] of [[LP1, PAST1, "late_entry", "first-half leave, 14:00 arrival"], [LP2, PAST2, "early_exit", "second-half leave, 13:00 exit"]]) {
      await warm(hr);
      const a = await hr.database.rpc("approve_leave_request", { p_leave_id: id });
      await warm(hr);
      const rd = await hr.database.rpc("hr_rederive_attendance_day", { p_tenant_id: A, p_employee_id: P.employeeId, p_date: d });
      const row = day(d)[0];
      check(!a.error && !rd.error && row?.status === "half_day" && row?.[flag] === false && (flag !== "late_entry" || row?.is_late === false),
        `${label}: status=${row?.status} ${flag}=${row?.[flag]} is_late=${row?.is_late} ${fp(a.error)} ${fp(rd.error)}`);
    }
    await warm(hr);
    const rc = await hr.database.rpc("hr_rederive_attendance_day", { p_tenant_id: A, p_employee_id: P.employeeId, p_date: PAST3 });
    check(!rc.error && day(PAST3)[0]?.late_entry === true, `control: same 14:00 arrival without leave is late (late_entry=${day(PAST3)[0]?.late_entry}) ${fp(rc.error)}`);

    // --- HR sets allow_half_day through the real Policy Center save RPC ---
    const ltRow = () => runSql(`SELECT name, code, days_per_year, accrual_type, carry_forward_enabled, carry_forward_max_days,
      encashment_enabled, applicable_from_day, probation_restricted, requires_document, min_notice_days, max_consecutive_days,
      is_active, is_paid, allow_half_day, updated_at::text AS updated_at FROM public.leave_types WHERE id='${LT_FULL}'`).rows[0];
    const payloadOf = (row) => { const { allow_half_day, updated_at, ...rest } = row; return rest; };
    const save = async (extra) => {
      const row = ltRow();
      await warm(hr);
      return hr.database.rpc("save_leave_type_transaction", { p_leave_type_id: LT_FULL, p_expected_updated_at: row.updated_at, p_payload: { ...payloadOf(row), ...extra } });
    };
    let sv = await save({ allow_half_day: true });
    check(!sv.error && ltRow().allow_half_day === true, `HR enables allow_half_day via save_leave_type_transaction -> ${fp(sv.error) || ltRow().allow_half_day}`);
    sv = await save({});
    check(!sv.error && ltRow().allow_half_day === true, `save without the key (older client) keeps it on -> ${fp(sv.error) || ltRow().allow_half_day}`);
    sv = await save({ allow_half_day: false });
    check(!sv.error && ltRow().allow_half_day === false, `HR switches it off again -> ${fp(sv.error) || ltRow().allow_half_day}`);
    const empSave = await me.database.rpc("save_leave_type_transaction", { p_leave_type_id: LT_FULL, p_expected_updated_at: ltRow().updated_at, p_payload: { ...payloadOf(ltRow()), allow_half_day: true } });
    check(!!empSave.error && ltRow().allow_half_day === false, `employee cannot change a leave type -> ${empSave.error ? "DENIED " + fp(empSave.error) : "ALLOWED"}`);

    // --- no direct write path appeared ---
    const direct = await me.database.from("leaves").update({ day_fraction: 0.5 }).eq("employee_id", P.employeeId).select("id");
    check(!!direct.error || direct.data.length === 0, `employee direct UPDATE of leaves -> ${direct.error ? "DENIED" : direct.data.length + " rows"}`);
  } finally {
    teardownFixture();
    await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });
  }
  const failed = results.filter((l) => l.startsWith("FAIL"));
  console.log(`\nC5: ${results.length - failed.length}/${results.length} PASS`);
  assert.equal(failed.length, 0, `C5 failures:\n${failed.join("\n")}`);
});
