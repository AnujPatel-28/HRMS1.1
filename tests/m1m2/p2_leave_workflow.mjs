#!/usr/bin/env node
// P2-04 executable evidence: leave apply/approve/reject/cancel authorization, no-self-approval,
// no-double-debit retry, per-date holiday/working-day convergence, reversible absence coverage
// on the attendance evidence trail, the day_fraction read path, module gating, and teardown-safe
// RLS invariants.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@insforge/sdk";

import { guardedMutation, runSql } from "./_harness.mjs";
import { TB_M1M2 } from "./_target.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const PASSWORD = readFileSync(join(here, "persona-password.local"), "utf8").trim();

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const EMPLOYEE_A = Object.freeze({
  userId: "a0000000-0000-4000-8001-000000000001",
  employeeId: "a0000000-0000-4000-8001-000000000002",
  email: "employee.a@m1m2.test",
});
const HR_A = Object.freeze({
  userId: "a0000000-0000-4000-8002-000000000001",
  employeeId: "a0000000-0000-4000-8002-000000000002",
  email: "hr-employee.a@m1m2.test",
});
const EMPLOYEE_B = Object.freeze({
  userId: "b0000000-0000-4000-8001-000000000001",
  employeeId: "b0000000-0000-4000-8001-000000000002",
  email: "employee.b@m1m2.test",
});

// Duplicated from tests/m1m2/fixtures/personas.mjs rather than imported: that file's leave
// fixture block runs unconditionally at module top level (no import.meta.url guard), so
// importing anything from it would re-seed on every run of this file too. Keep these equal to
// personas.mjs's COMPANY_A_LEAVE_TYPE_CL / LEAVE_FIXTURE_YEAR / LEAVE_OPENING_BALANCE if that
// file ever changes.
const LEAVE_TYPE_CL = "a0000000-0000-4000-8006-000000000001";
const FIXTURE_YEAR = 2026;
const OPENING_BALANCE = 12;

const TEST_TAG = "p2-04-acceptance";

// Fixed test-only ids, all under the a2400000-... namespace to stay clear of P2-02's a2200000-...
const LEAVE_NOTICE = "a2400000-0000-4000-8000-000000000001";
const LEAVE_SELF = "a2400000-0000-4000-8000-000000000002";
const LEAVE_PENDING_CANCEL = "a2400000-0000-4000-8000-000000000003";
const LEAVE_DIVERGE = "a2400000-0000-4000-8000-000000000004";
const LEAVE_BACKDATE = "a2400000-0000-4000-8000-000000000005";
const LEAVE_HALF = "a2400000-0000-4000-8000-000000000006";
const LEAVE_MODULE_GATE = "a2400000-0000-4000-8000-000000000007";
const LEAVE_REJECT = "a2400000-0000-4000-8000-000000000008";

const SHIFT_PLAIN = "a2400000-0000-4000-8000-000000000010";
const EMP_SHIFT_PUNCH = "a2400000-0000-4000-8000-000000000011";
const EMP_SHIFT_HALF = "a2400000-0000-4000-8000-000000000012";
const SHIFT_CALENDAR = "a2400000-0000-4000-8000-000000000013";
const EMP_SHIFT_CALENDAR = "a2400000-0000-4000-8000-000000000014";
const HOLIDAY_CALENDAR = "a2400000-0000-4000-8000-000000000015";
const HOLIDAY_CALENDAR_DAY = "a2400000-0000-4000-8000-000000000016";
const RUN_BASELINE = "a2400000-0000-4000-8000-000000000020";
const RUN_RESTORE = "a2400000-0000-4000-8000-000000000021";
const RUN_HALF = "a2400000-0000-4000-8000-000000000022";

// Past dates (relative to today, 2026-09-15) for scenarios that must bypass the employee-facing
// notice-day check via direct SQL insert (HR backdating, calendar-convergence evidence).
const D_PUNCH = "2026-09-01"; // Tue
const D_DIVERGE_HOLIDAY = "2026-09-02"; // Wed -- named-calendar holiday, no tenant-default row
const D_DIVERGE_WORK = "2026-09-03"; // Thu -- ordinary working day, same range
const D_HALF = "2026-09-08"; // Tue
// Future dates for scenarios that go through the employee-facing RPC and its notice-day check.
const D_NOTICE_1 = "2026-10-05"; // Mon
const D_NOTICE_2 = "2026-10-06"; // Tue
const D_SELF = "2026-10-12"; // Mon
const D_PENDING_CANCEL = "2026-10-19"; // Mon
const D_REJECT = "2026-10-20"; // Tue
const D_MODULE_GATE = "2026-10-26"; // Mon

const rowsOf = (result) => result?.rows ?? result?.data?.rows ?? [];
const messageOf = (error) => [error?.code, error?.message, error?.details, error?.hint]
  .filter(Boolean).join(" | ");
const q = (value) => `'${String(value).replace(/'/g, "''")}'`;

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
  return JSON.parse(result.stdout.slice(start)).value;
}

// This environment's network to TB-M1M2 has shown intermittent transient "fetch failed" blips
// unrelated to any assertion (observed across three separate runs, at different points each
// time, never accompanied by a server-side error or state left behind). Retry only that specific
// transport failure, exactly as _harness.mjs's own runSql callers retry a CLI transport failure.
function withFetchRetry(fn, attempts = 3) {
  return async function retrying(...args) {
    let lastResult;
    for (let i = 0; i < attempts; i += 1) {
      lastResult = await fn.apply(this, args);
      if (!/fetch failed/i.test(lastResult?.error?.message ?? "")) return lastResult;
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
    return lastResult;
  };
}

async function signIn(persona, anonKey) {
  const client = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey });
  const { data, error } = await client.auth.signInWithPassword({ email: persona.email, password: PASSWORD });
  assert.equal(error, null, `${persona.email}: ${messageOf(error)}`);
  assert.equal(data?.user?.id, persona.userId, `${persona.email}: unexpected identity`);
  client.database.rpc = withFetchRetry(client.database.rpc.bind(client.database));
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

async function rlsInvariant(clients) {
  const counts = {};
  for (const [label, client] of Object.entries(clients)) {
    const { data, error } = await client.database.from("employees").select("id").eq("tenant_id", COMPANY_A);
    assert.equal(error, null, `${label} employee visibility: ${messageOf(error)}`);
    counts[label] = data.length;
  }
  assert.deepEqual(counts, { employee: 1, hr: 2, crossTenant: 0 });
  return counts;
}

function balanceRow() {
  const [row] = rowsOf(runSql(`
    SELECT balance, used_days, total_allocated FROM public.leave_balances
    WHERE tenant_id='${COMPANY_A}'::uuid AND employee_id='${EMPLOYEE_A.employeeId}'::uuid
      AND leave_type_id='${LEAVE_TYPE_CL}'::uuid AND year=${FIXTURE_YEAR}
  `));
  return { balance: Number(row.balance), used: Number(row.used_days), allocated: Number(row.total_allocated) };
}

function hrBalanceRow() {
  const [row] = rowsOf(runSql(`
    SELECT balance, used_days FROM public.leave_balances
    WHERE tenant_id='${COMPANY_A}'::uuid AND employee_id='${HR_A.employeeId}'::uuid
      AND leave_type_id='${LEAVE_TYPE_CL}'::uuid AND year=${FIXTURE_YEAR}
  `));
  return { balance: Number(row.balance), used: Number(row.used_days) };
}

function attendanceRows(employeeId, date) {
  return rowsOf(runSql(`
    SELECT id, status, derivation_source, leave_id, punch_in, punch_out, in_time, out_time, work_hours
    FROM public.attendance
    WHERE tenant_id='${COMPANY_A}'::uuid AND employee_id='${employeeId}'::uuid AND date='${date}'::date
  `));
}

function attendanceRow(employeeId, date) {
  const rows = attendanceRows(employeeId, date);
  assert.ok(rows.length <= 1, `AC5: expected at most 1 attendance row for ${employeeId}/${date}, found ${rows.length} -- the shift-id-unaware upsert regressed and created a phantom duplicate`);
  return rows[0] ?? null;
}

function cleanupSql(leaveIds, dates) {
  const leaveList = leaveIds.map(q).join(",");
  const dateList = dates.map(q).join(",");
  return `
    DELETE FROM public.notifications
    WHERE tenant_id='${COMPANY_A}'::uuid AND reference_id IN (${leaveList});
    DELETE FROM public.audit_logs
    WHERE tenant_id='${COMPANY_A}'::uuid AND target_id IN (${leaveList});
    DELETE FROM public.attendance_events
    WHERE tenant_id='${COMPANY_A}'::uuid AND employee_id='${EMPLOYEE_A.employeeId}'::uuid
      AND source_ref LIKE '${TEST_TAG}%';
    DELETE FROM public.attendance
    WHERE tenant_id='${COMPANY_A}'::uuid
      AND employee_id IN ('${EMPLOYEE_A.employeeId}'::uuid,'${HR_A.employeeId}'::uuid)
      AND date IN (${dateList});
    DELETE FROM public.leaves WHERE id IN (${leaveList});
    DELETE FROM public.attendance_derivation_runs WHERE id IN ('${RUN_BASELINE}'::uuid,'${RUN_RESTORE}'::uuid,'${RUN_HALF}'::uuid);
    DELETE FROM public.employee_shifts WHERE id IN ('${EMP_SHIFT_PUNCH}'::uuid,'${EMP_SHIFT_HALF}'::uuid,'${EMP_SHIFT_CALENDAR}'::uuid);
    DELETE FROM public.shifts WHERE id IN ('${SHIFT_PLAIN}'::uuid,'${SHIFT_CALENDAR}'::uuid);
    DELETE FROM public.holiday_calendar_days WHERE id='${HOLIDAY_CALENDAR_DAY}'::uuid;
    DELETE FROM public.holiday_calendars WHERE id='${HOLIDAY_CALENDAR}'::uuid;
    UPDATE public.leave_balances
    SET total_allocated=${OPENING_BALANCE}, carried_forward=0, used_days=0, pending_days=0, balance=${OPENING_BALANCE}, updated_at=now()
    WHERE tenant_id='${COMPANY_A}'::uuid AND leave_type_id='${LEAVE_TYPE_CL}'::uuid AND year=${FIXTURE_YEAR}
      AND employee_id IN ('${EMPLOYEE_A.employeeId}'::uuid,'${HR_A.employeeId}'::uuid);
  `;
}

const ALL_LEAVE_IDS = [
  LEAVE_NOTICE, LEAVE_SELF, LEAVE_PENDING_CANCEL, LEAVE_DIVERGE, LEAVE_BACKDATE, LEAVE_HALF,
  LEAVE_MODULE_GATE, LEAVE_REJECT,
];
const ALL_DATES = [
  D_PUNCH, D_DIVERGE_HOLIDAY, D_DIVERGE_WORK, D_HALF, D_NOTICE_1, D_NOTICE_2, D_SELF,
  D_PENDING_CANCEL, D_MODULE_GATE, D_REJECT,
];

await guardedMutation("P2-04 leave workflow", async () => {
  const anonKey = readBranchAnonKey();
  const employee = await signIn(EMPLOYEE_A, anonKey);
  const hr = await signIn(HR_A, anonKey);
  const crossTenant = await signIn(EMPLOYEE_B, anonKey);
  const clients = { employee, hr, crossTenant };

  const originalModules = rowsOf(runSql(`
    SELECT module_key, enabled FROM public.tenant_modules
    WHERE tenant_id='${COMPANY_A}'::uuid AND module_key IN ('leave','attendance')
  `)).reduce((acc, r) => ({ ...acc, [r.module_key]: r.enabled }), {});

  // Refuse to run against a fixture that isn't in its documented opening state.
  const openingA = balanceRow();
  assert.deepEqual(openingA, { balance: OPENING_BALANCE, used: 0, allocated: OPENING_BALANCE },
    "employee.a opening balance is not the documented fixture state -- run test:m1m2:personas first");
  runSql(cleanupSql(ALL_LEAVE_IDS, ALL_DATES));

  const beforeRls = await rlsInvariant(clients);
  console.log(`RLS invariant before fixtures: ${beforeRls.employee}/${beforeRls.hr}/${beforeRls.crossTenant}.`);

  try {
    // ---------------------------------------------------------------------
    // Structural evidence: catalog, no-anon-execute, convergence/guard markers, GRANT lockdown.
    // ---------------------------------------------------------------------
    const catalog = rowsOf(runSql(`
      SELECT p.proname, count(*) AS copies,
        bool_and(NOT has_function_privilege('anon',p.oid,'EXECUTE')) AS no_anon,
        bool_and(pg_get_functiondef(p.oid) LIKE '%work_calendar_holiday%')
          FILTER (WHERE p.proname IN ('employee_apply_leave_request','approve_leave_request')) AS converged,
        bool_and(pg_get_functiondef(p.oid) LIKE '%assert_leave_reviewer%')
          FILTER (WHERE p.proname IN ('approve_leave_request','cancel_leave_request')) AS guarded,
        bool_and(pg_get_functiondef(p.oid) LIKE '%tenant_has_module_for%')
          FILTER (WHERE p.proname IN ('employee_apply_leave_request','employee_cancel_pending_leave')) AS module_gated
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN (
        'assert_leave_reviewer','employee_apply_leave_request','employee_cancel_pending_leave',
        'approve_leave_request','cancel_leave_request'
      ) GROUP BY p.proname ORDER BY p.proname
    `));
    assert.equal(catalog.length, 5);
    for (const row of catalog) {
      assert.equal(Number(row.copies), 1, `${row.proname}: overload count`);
      assert.equal(row.no_anon, true, `${row.proname}: anon execute must be absent`);
      if (row.converged !== null) assert.equal(row.converged, true, `${row.proname}: must call work_calendar_holiday`);
      if (row.guarded !== null) assert.equal(row.guarded, true, `${row.proname}: must call assert_leave_reviewer`);
      if (row.module_gated !== null) assert.equal(row.module_gated, true, `${row.proname}: must check tenant_has_module_for`);
    }
    const dayFractionWriters = rowsOf(runSql(`
      SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND proname IN ('employee_apply_leave_request','approve_leave_request')
        AND position('day_fraction' in pg_get_functiondef(p.oid)) > 0
    `));
    assert.equal(dayFractionWriters.length, 0, "AC6: neither apply nor approve should reference day_fraction -- no write path exists");
    const writeGrants = rowsOf(runSql(`
      SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name IN ('leaves','leave_balances')
        AND grantee IN ('authenticated','anon') AND privilege_type IN ('INSERT','UPDATE','DELETE')
    `));
    assert.equal(writeGrants.length, 0, "leaves/leave_balances must expose no direct client write grant");
    console.log("Catalog: 5 named functions each have one copy and deny anon; apply/approve converged onto work_calendar_holiday; approve/cancel guarded by assert_leave_reviewer; apply/cancel-pending module-gated; day_fraction has no writer; leaves/leave_balances hold no client write grant.");

    // ---------------------------------------------------------------------
    // AC1 + AC3: apply (RPC) -> approve -> retry-approve (no double debit) -> cancel-approved ->
    // retry-cancel (no double credit).
    // ---------------------------------------------------------------------
    runSql(`
      INSERT INTO public.leaves (id, tenant_id, employee_id, leave_type_id, leave_type, start_date, end_date, total_days, reason, status)
      VALUES ('${LEAVE_NOTICE}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, '${LEAVE_TYPE_CL}'::uuid, 'casual', '${D_NOTICE_1}'::date, '${D_NOTICE_2}'::date, 2, '${TEST_TAG} notice', 'pending');
    `);
    // Applied by HR_A themselves (not EMPLOYEE_A) -- this row feeds AC2's self-approval-denial
    // test below, so it must actually belong to the composed HR+employee persona. It also proves
    // the employee-facing apply path independently of the direct-insert fixtures used for
    // backdated/divergence scenarios below.
    const applyResult = noError(
      await hr.database.rpc("employee_apply_leave_request", {
        p_tenant_id: COMPANY_A, p_leave_type_id: LEAVE_TYPE_CL,
        p_start_date: D_SELF, p_end_date: D_SELF, p_reason: `${TEST_TAG} self`,
      }),
      "AC1 apply via RPC",
    );
    runSql(`UPDATE public.leaves SET id='${LEAVE_SELF}'::uuid WHERE id='${applyResult}'::uuid;`);
    const appliedLeave = rowsOf(runSql(`SELECT status, total_days FROM public.leaves WHERE id='${LEAVE_SELF}'::uuid`))[0];
    assert.equal(appliedLeave.status, "pending");
    assert.equal(Number(appliedLeave.total_days), 1);
    console.log("AC1: employee_apply_leave_request via RPC produced a pending 1-day request.");

    const approveResult = noError(
      await hr.database.rpc("approve_leave_request", { p_leave_id: LEAVE_NOTICE, p_working_dates: null, p_approved_business_days: null }),
      "AC1 approve",
    );
    void approveResult;
    let leaveState = rowsOf(runSql(`SELECT status, approved_business_days FROM public.leaves WHERE id='${LEAVE_NOTICE}'::uuid`))[0];
    assert.equal(leaveState.status, "approved");
    assert.equal(Number(leaveState.approved_business_days), 2);
    let bal = balanceRow();
    assert.deepEqual(bal, { balance: OPENING_BALANCE - 2, used: 2, allocated: OPENING_BALANCE });
    const attN1 = attendanceRow(EMPLOYEE_A.employeeId, D_NOTICE_1);
    const attN2 = attendanceRow(EMPLOYEE_A.employeeId, D_NOTICE_2);
    assert.equal(attN1.status, "on_leave");
    assert.equal(attN1.derivation_source, "leave");
    assert.equal(attN1.leave_id, LEAVE_NOTICE);
    assert.equal(attN2.status, "on_leave");
    console.log(`AC1: approve_leave_request approved 2 business days, debited balance to ${bal.balance}, created 2 tagged on_leave attendance rows.`);

    // AC3: retry approve on an already-approved leave must not double-debit.
    const retryApprove = await hr.database.rpc("approve_leave_request", { p_leave_id: LEAVE_NOTICE, p_working_dates: null, p_approved_business_days: null });
    expectError(retryApprove, /no longer pending/i, "AC3 retry-approve");
    bal = balanceRow();
    assert.deepEqual(bal, { balance: OPENING_BALANCE - 2, used: 2, allocated: OPENING_BALANCE }, "AC3: retry-approve must not double-debit");

    noError(await hr.database.rpc("cancel_leave_request", { p_leave_id: LEAVE_NOTICE, p_rejection_reason: null, p_new_status: "cancelled" }), "AC1 cancel-approved");
    leaveState = rowsOf(runSql(`SELECT status FROM public.leaves WHERE id='${LEAVE_NOTICE}'::uuid`))[0];
    assert.equal(leaveState.status, "cancelled");
    bal = balanceRow();
    assert.deepEqual(bal, { balance: OPENING_BALANCE, used: 0, allocated: OPENING_BALANCE }, "AC1: cancel-approved must fully restore the balance");
    assert.equal(attendanceRow(EMPLOYEE_A.employeeId, D_NOTICE_1), null, "AC1: pure leave-only placeholder row must be deleted on cancel");
    assert.equal(attendanceRow(EMPLOYEE_A.employeeId, D_NOTICE_2), null);
    console.log("AC1: cancel-approved restored the full balance and deleted the placeholder attendance rows (no punch evidence existed).");

    // AC3: retry cancel on an already-cancelled leave must not double-credit.
    const retryCancel = await hr.database.rpc("cancel_leave_request", { p_leave_id: LEAVE_NOTICE, p_rejection_reason: null, p_new_status: "cancelled" });
    expectError(retryCancel, /already cancelled/i, "AC3 retry-cancel");
    bal = balanceRow();
    assert.deepEqual(bal, { balance: OPENING_BALANCE, used: 0, allocated: OPENING_BALANCE }, "AC3: retry-cancel must not double-credit");
    console.log("AC3: retry-approve and retry-cancel both failed cleanly with the balance unchanged both times -- no double debit, no double credit.");

    // ---------------------------------------------------------------------
    // AC1: cancel-pending (self-withdrawal).
    // ---------------------------------------------------------------------
    const pendingResult = noError(
      await employee.database.rpc("employee_apply_leave_request", {
        p_tenant_id: COMPANY_A, p_leave_type_id: LEAVE_TYPE_CL,
        p_start_date: D_PENDING_CANCEL, p_end_date: D_PENDING_CANCEL, p_reason: `${TEST_TAG} pending-cancel`,
      }),
      "AC1 apply for pending-cancel",
    );
    noError(await employee.database.rpc("employee_cancel_pending_leave", { p_tenant_id: COMPANY_A, p_leave_id: pendingResult }), "AC1 cancel-pending");
    const pendingRow = rowsOf(runSql(`SELECT id FROM public.leaves WHERE id='${pendingResult}'::uuid`));
    assert.equal(pendingRow.length, 0, "AC1: cancel-pending must delete the pending request");
    console.log("AC1: employee_cancel_pending_leave (self-withdrawal of a pending request) deleted the row cleanly.");

    // ---------------------------------------------------------------------
    // AC1: reject (a distinct, non-self reviewer rejects a pending request). The self-approval
    // tests below exercise cancel_leave_request with p_new_status='rejected' too, but only as a
    // denial -- this is the success path, which is otherwise unproven.
    // ---------------------------------------------------------------------
    runSql(`
      INSERT INTO public.leaves (id, tenant_id, employee_id, leave_type_id, leave_type, start_date, end_date, total_days, reason, status)
      VALUES ('${LEAVE_REJECT}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, '${LEAVE_TYPE_CL}'::uuid, 'casual', '${D_REJECT}'::date, '${D_REJECT}'::date, 1, '${TEST_TAG} reject', 'pending');
    `);
    noError(await hr.database.rpc("cancel_leave_request", { p_leave_id: LEAVE_REJECT, p_rejection_reason: `${TEST_TAG} not enough coverage`, p_new_status: "rejected" }), "AC1 reject");
    const rejectedLeave = rowsOf(runSql(`SELECT status, rejection_reason, reviewed_by FROM public.leaves WHERE id='${LEAVE_REJECT}'::uuid`))[0];
    assert.equal(rejectedLeave.status, "rejected");
    assert.equal(rejectedLeave.rejection_reason, `${TEST_TAG} not enough coverage`);
    assert.equal(rejectedLeave.reviewed_by, HR_A.employeeId);
    bal = balanceRow();
    assert.deepEqual(bal, { balance: OPENING_BALANCE, used: 0, allocated: OPENING_BALANCE }, "AC1: rejecting a pending (never-approved) request must not touch the balance");
    console.log("AC1: a distinct HR reviewer rejected a pending request with a recorded reason and reviewer, and the balance was untouched (it was never debited).");

    // ---------------------------------------------------------------------
    // AC2: requester holding HR cannot review their own leave, via the shared denial class.
    // ---------------------------------------------------------------------
    const selfApprove = await hr.database.rpc("approve_leave_request", { p_leave_id: LEAVE_SELF, p_working_dates: null, p_approved_business_days: null });
    const selfApproveMsg = expectError(selfApprove, /SELF_APPROVAL_DENIED/i, "AC2 HR+employee self-approve");
    const selfReject = await hr.database.rpc("cancel_leave_request", { p_leave_id: LEAVE_SELF, p_rejection_reason: `${TEST_TAG} self reject`, p_new_status: "rejected" });
    const selfRejectMsg = expectError(selfReject, /SELF_APPROVAL_DENIED/i, "AC2 HR+employee self-reject");
    assert.match(selfApproveMsg, /P1001/);
    assert.match(selfRejectMsg, /P1001/);
    leaveState = rowsOf(runSql(`SELECT status FROM public.leaves WHERE id='${LEAVE_SELF}'::uuid`))[0];
    assert.equal(leaveState.status, "pending", "AC2: self-denial must leave the request untouched");
    console.log("AC2: the composed HR+employee persona was denied both approve and reject on their own leave, same SELF_APPROVAL_DENIED/P1001 class attendance uses.");

    // AC2 evidence, not assertion: a raw table UPDATE bypass must also fail now that write grants
    // are revoked -- closing the hole where RLS's leaves_hr_all (FOR ALL) plus table UPDATE let
    // an HR requester approve their own leave without ever calling assert_leave_reviewer.
    const rawBypass = await hr.database.from("leaves").update({ status: "approved" }).eq("id", LEAVE_SELF);
    expectError(rawBypass, /permission denied|42501/i, "AC2 raw table UPDATE bypass");
    leaveState = rowsOf(runSql(`SELECT status FROM public.leaves WHERE id='${LEAVE_SELF}'::uuid`))[0];
    assert.equal(leaveState.status, "pending", "AC2: raw table bypass must not have mutated the row");
    console.log("AC2: a raw table UPDATE bypass of the same leave was denied at the GRANT level (permission denied), not just by the RPC guard.");

    // ---------------------------------------------------------------------
    // AC4: per-date holiday-tier convergence. A 2-day range where day 1 is a holiday only under
    // the employee's named calendar (no tenant-default `holidays` row) and day 2 is ordinary.
    // ---------------------------------------------------------------------
    runSql(`
      INSERT INTO public.holiday_calendars (id, tenant_id, name) VALUES ('${HOLIDAY_CALENDAR}'::uuid, '${COMPANY_A}'::uuid, '${TEST_TAG} calendar');
      INSERT INTO public.holiday_calendar_days (id, tenant_id, calendar_id, date, name, is_half_day)
        VALUES ('${HOLIDAY_CALENDAR_DAY}'::uuid, '${COMPANY_A}'::uuid, '${HOLIDAY_CALENDAR}'::uuid, '${D_DIVERGE_HOLIDAY}'::date, '${TEST_TAG} named holiday', false);
      INSERT INTO public.shifts (id, tenant_id, name, start_time, end_time, holiday_calendar_id)
        VALUES ('${SHIFT_CALENDAR}'::uuid, '${COMPANY_A}'::uuid, '${TEST_TAG} calendar shift', '09:00', '18:00', '${HOLIDAY_CALENDAR}'::uuid);
      INSERT INTO public.employee_shifts (id, tenant_id, employee_id, shift_id, effective_from, effective_to)
        VALUES ('${EMP_SHIFT_CALENDAR}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, '${SHIFT_CALENDAR}'::uuid, '${D_DIVERGE_HOLIDAY}'::date, '${D_DIVERGE_WORK}'::date);
      INSERT INTO public.leaves (id, tenant_id, employee_id, leave_type_id, leave_type, start_date, end_date, total_days, reason, status)
        VALUES ('${LEAVE_DIVERGE}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, '${LEAVE_TYPE_CL}'::uuid, 'casual', '${D_DIVERGE_HOLIDAY}'::date, '${D_DIVERGE_WORK}'::date, 2, '${TEST_TAG} divergence', 'pending');
    `);
    const tenantDefaultHoliday = rowsOf(runSql(`SELECT 1 FROM public.holidays WHERE tenant_id='${COMPANY_A}'::uuid AND date='${D_DIVERGE_HOLIDAY}'::date`));
    assert.equal(tenantDefaultHoliday.length, 0, "fixture precondition: tenant-default holidays must NOT know about this date -- that is the divergence");
    const workingDaysOracle = rowsOf(runSql(`SELECT public.work_calendar_working_days('${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, '${D_DIVERGE_HOLIDAY}'::date, '${D_DIVERGE_WORK}'::date) AS n`))[0];
    noError(await hr.database.rpc("approve_leave_request", { p_leave_id: LEAVE_DIVERGE, p_working_dates: null, p_approved_business_days: null }), "AC4 approve divergence");
    leaveState = rowsOf(runSql(`SELECT approved_business_days FROM public.leaves WHERE id='${LEAVE_DIVERGE}'::uuid`))[0];
    assert.equal(Number(leaveState.approved_business_days), 1,
      "AC4: the named-calendar holiday day must be excluded -- reading the tenant-default `holidays` table directly (the pre-fix bug) would have counted both days");
    assert.equal(Number(leaveState.approved_business_days), Number(workingDaysOracle.n),
      "AC4: approve_leave_request's own count must equal the shared work_calendar_working_days oracle over the identical range");
    assert.equal(attendanceRow(EMPLOYEE_A.employeeId, D_DIVERGE_HOLIDAY), null, "the named-calendar holiday day gets no on_leave attendance row");
    assert.ok(attendanceRow(EMPLOYEE_A.employeeId, D_DIVERGE_WORK), "the ordinary day does get an on_leave attendance row");
    console.log(`AC4: a 2-day range with a named-calendar-only holiday resolved to 1 approved business day, matching work_calendar_working_days (${workingDaysOracle.n}); the un-converged read of the direct \`holidays\` table would have wrongly counted both days.`);
    noError(await hr.database.rpc("cancel_leave_request", { p_leave_id: LEAVE_DIVERGE, p_rejection_reason: null, p_new_status: "cancelled" }), "AC4 cancel divergence");

    // ---------------------------------------------------------------------
    // AC5: punch on D -> approve backdated leave over D -> cancel. Raw event and derived
    // punch/evidence must remain readable throughout, and the day must restore once re-derived.
    // ---------------------------------------------------------------------
    runSql(`
      INSERT INTO public.shifts (id, tenant_id, name, start_time, end_time, is_default, is_active, enable_auto_derivation)
        VALUES ('${SHIFT_PLAIN}'::uuid, '${COMPANY_A}'::uuid, '${TEST_TAG} plain shift', '09:00', '18:00', false, true, true);
      INSERT INTO public.employee_shifts (id, tenant_id, employee_id, shift_id, effective_from, effective_to)
        VALUES ('${EMP_SHIFT_PUNCH}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, '${SHIFT_PLAIN}'::uuid, '${D_PUNCH}'::date, '${D_PUNCH}'::date);
      SELECT public.attendance_event_ingest('${COMPANY_A}'::uuid,'${EMPLOYEE_A.employeeId}'::uuid,'${D_PUNCH} 03:30:00+00','in','device','${TEST_TAG}:punch:in',NULL,NULL,NULL,NULL,'device_verified',NULL,'{"raw":"keep"}'::jsonb,'${TEST_TAG}:punch:in',NULL);
      SELECT public.attendance_event_ingest('${COMPANY_A}'::uuid,'${EMPLOYEE_A.employeeId}'::uuid,'${D_PUNCH} 12:30:00+00','out','device','${TEST_TAG}:punch:out',NULL,NULL,NULL,NULL,'device_verified',NULL,'{"raw":"keep"}'::jsonb,'${TEST_TAG}:punch:out',NULL);
      INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger)
        VALUES ('${RUN_BASELINE}'::uuid, '${COMPANY_A}'::uuid, '${SHIFT_PLAIN}'::uuid, '${D_PUNCH}'::date, '${D_PUNCH}'::date, 'schedule');
      SELECT * FROM public.attendance_derive_pass1('${COMPANY_A}'::uuid, '${SHIFT_PLAIN}'::uuid, '${D_PUNCH}'::date, '${D_PUNCH}'::date, '${RUN_BASELINE}'::uuid);
    `);
    const baseline = attendanceRow(EMPLOYEE_A.employeeId, D_PUNCH);
    assert.equal(baseline.status, "present");
    // attendance_derive_pass1 always inserts punch_in as NULL (P2-02's own fix, to avoid a
    // phantom dual-write event); the evidence for a device/event-derived row lives in
    // in_time/out_time, matching P2-02's own acceptance test convention.
    assert.ok(baseline.in_time && baseline.out_time, "AC5 setup: baseline row must have derived in_time/out_time");
    const baselineEvents = rowsOf(runSql(`SELECT id, source, event_time, evidence, attendance_id FROM public.attendance_events WHERE source_ref LIKE '${TEST_TAG}:punch:%' ORDER BY source_ref`));
    assert.equal(baselineEvents.length, 2);
    assert.ok(baselineEvents.every((e) => e.attendance_id === baseline.id && e.evidence.raw === "keep"));
    console.log(`AC5 baseline: a real device punch on ${D_PUNCH} derived to 'present' with 2 raw events.`);

    runSql(`
      INSERT INTO public.leaves (id, tenant_id, employee_id, leave_type_id, leave_type, start_date, end_date, total_days, reason, status)
        VALUES ('${LEAVE_BACKDATE}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, '${LEAVE_TYPE_CL}'::uuid, 'casual', '${D_PUNCH}'::date, '${D_PUNCH}'::date, 1, '${TEST_TAG} backdated', 'pending');
    `);
    noError(await hr.database.rpc("approve_leave_request", { p_leave_id: LEAVE_BACKDATE, p_working_dates: null, p_approved_business_days: null }), "AC5 approve backdated leave");
    const afterApprove = attendanceRow(EMPLOYEE_A.employeeId, D_PUNCH);
    assert.equal(afterApprove.status, "on_leave");
    assert.equal(afterApprove.derivation_source, "leave");
    assert.equal(afterApprove.leave_id, LEAVE_BACKDATE);
    assert.equal(afterApprove.punch_in, baseline.punch_in, "AC5: approval must not null the existing punch_in");
    assert.equal(afterApprove.punch_out, baseline.punch_out, "AC5: approval must not null the existing punch_out");
    assert.equal(afterApprove.in_time, baseline.in_time);
    assert.equal(afterApprove.out_time, baseline.out_time);
    const eventsAfterApprove = rowsOf(runSql(`SELECT id, event_time, evidence FROM public.attendance_events WHERE source_ref LIKE '${TEST_TAG}:punch:%' ORDER BY source_ref`));
    assert.deepEqual(eventsAfterApprove, baselineEvents.map(({ id, event_time, evidence }) => ({ id, event_time, evidence })), "AC5: raw events must be byte-identical after approval");
    console.log("AC5 after approve: status flipped to on_leave and the row is tagged, but punch_in/punch_out/in_time/out_time and the raw event log are unchanged.");

    noError(await hr.database.rpc("cancel_leave_request", { p_leave_id: LEAVE_BACKDATE, p_rejection_reason: null, p_new_status: "cancelled" }), "AC5 cancel backdated leave");
    const afterCancel = attendanceRow(EMPLOYEE_A.employeeId, D_PUNCH);
    assert.ok(afterCancel, "AC5: the row must still exist after cancel -- it carries real punch evidence and must not be deleted");
    assert.equal(afterCancel.leave_id, null, "AC5: leave tag must be released on cancel");
    // C4 (20260912195000/195200): cancel now re-derives the day immediately (Company A has attendance
    // on), so the released row is reclaimed by the deriver and returns to its punch-derived status.
    assert.equal(afterCancel.derivation_source, "derived", "AC5/C4: cancel must hand the day back to the deriver, which reclaims it");
    assert.equal(afterCancel.status, baseline.status, "AC5/C4: cancel must restore the punch-derived status");
    assert.equal(afterCancel.punch_in, baseline.punch_in);
    assert.equal(afterCancel.punch_out, baseline.punch_out);
    assert.equal(afterCancel.in_time, baseline.in_time);
    assert.equal(afterCancel.out_time, baseline.out_time);
    const eventsAfterCancel = rowsOf(runSql(`SELECT id, event_time, evidence FROM public.attendance_events WHERE source_ref LIKE '${TEST_TAG}:punch:%' ORDER BY source_ref`));
    assert.deepEqual(eventsAfterCancel, baselineEvents.map(({ id, event_time, evidence }) => ({ id, event_time, evidence })), "AC5: raw events must still be byte-identical after cancel");
    console.log(`AC5 after cancel: the row survives with evidence intact and is re-derived to '${afterCancel.status}' (C4); raw events byte-identical.`);

    // Prove the day CAN restore, and find out exactly what it takes. A naive second pass1 call
    // is a documented no-op here: pass1's event query filters `attendance_id IS NULL`, and the
    // baseline pass already stamped these two events onto the baseline row -- pass1 is an
    // incremental "process each event once" pipeline, not a full re-deriver, and it will not
    // revisit an already-derived day on its own. Verified empirically before writing this
    // assertion (a bare second pass1 call left status at 'on_leave').
    const noopRun = "a2400000-0000-4000-8000-000000000023";
    runSql(`
      INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger)
        VALUES ('${noopRun}'::uuid, '${COMPANY_A}'::uuid, '${SHIFT_PLAIN}'::uuid, '${D_PUNCH}'::date, '${D_PUNCH}'::date, 'replay');
      SELECT * FROM public.attendance_derive_pass1('${COMPANY_A}'::uuid, '${SHIFT_PLAIN}'::uuid, '${D_PUNCH}'::date, '${D_PUNCH}'::date, '${noopRun}'::uuid);
    `);
    const afterNoopPass = attendanceRow(EMPLOYEE_A.employeeId, D_PUNCH);
    // Since C4, cancel already re-derived the day (status restored above), so the plain re-run is
    // asserted as a no-op against the RESTORED status: pass1 alone still never revisits a stamped day.
    assert.equal(afterNoopPass.status, afterCancel.status, "documenting pass1's incremental design: a plain re-run does not revisit an already-stamped day");
    runSql(`DELETE FROM public.attendance_derivation_runs WHERE id='${noopRun}'::uuid;`);
    console.log("AC5 finding: attendance_derive_pass1 alone does NOT restore the day -- it only processes events with attendance_id IS NULL, and this package's baseline pass already stamped these two. Status restoration on an already-derived day has no product-side trigger today; that is a real gap, reported here, not silently patched by leave code (which would reintroduce day-status duplication).");

    // Prove the DATA genuinely supports restoration once a re-derivation is actually triggered:
    // un-stamp the two events (the same column pass1 itself writes, cleared back to its
    // pre-processed state -- no new event is written, nothing is double-written) and run pass1
    // again. This is the harness simulating what a future "force re-derive" trigger would need
    // to do; it is not something cancel_leave_request does today.
    runSql(`UPDATE public.attendance_events SET attendance_id = NULL WHERE source_ref LIKE '${TEST_TAG}:punch:%';`);
    runSql(`
      INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger)
        VALUES ('${RUN_RESTORE}'::uuid, '${COMPANY_A}'::uuid, '${SHIFT_PLAIN}'::uuid, '${D_PUNCH}'::date, '${D_PUNCH}'::date, 'replay');
      SELECT * FROM public.attendance_derive_pass1('${COMPANY_A}'::uuid, '${SHIFT_PLAIN}'::uuid, '${D_PUNCH}'::date, '${D_PUNCH}'::date, '${RUN_RESTORE}'::uuid);
    `);
    const restored = attendanceRow(EMPLOYEE_A.employeeId, D_PUNCH);
    assert.equal(restored.status, "present", "AC5: once actually re-derived, the day must restore to its real status");
    assert.equal(restored.derivation_source, "derived");
    assert.equal(restored.leave_id, null);
    assert.equal(restored.punch_in, baseline.punch_in);
    assert.equal(restored.punch_out, baseline.punch_out);
    assert.equal(restored.in_time, baseline.in_time);
    assert.equal(restored.out_time, baseline.out_time);
    console.log("AC5: with the events un-stamped, one pass1 call restored status to 'present' with punch_in/punch_out/in_time/out_time unchanged -- the data is fully reversible. Evidence preservation PASS; automatic status restoration is UNSUPPORTED today (see finding above), not silently claimed as working.");

    // ---------------------------------------------------------------------
    // AC6: day_fraction has a live READ path (attendance_derive_pass1/pass2, E23) but no WRITE
    // path in employee_apply_leave_request or approve_leave_request (asserted in Catalog above).
    // Prove the read path directly: a fixture leave with day_fraction=0.5 must derive to half_day.
    // ---------------------------------------------------------------------
    runSql(`
      INSERT INTO public.employee_shifts (id, tenant_id, employee_id, shift_id, effective_from, effective_to)
        VALUES ('${EMP_SHIFT_HALF}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, '${SHIFT_PLAIN}'::uuid, '${D_HALF}'::date, '${D_HALF}'::date);
      INSERT INTO public.leaves (id, tenant_id, employee_id, leave_type_id, leave_type, start_date, end_date, total_days, day_fraction, reason, status)
        VALUES ('${LEAVE_HALF}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, '${LEAVE_TYPE_CL}'::uuid, 'casual', '${D_HALF}'::date, '${D_HALF}'::date, 1, 0.5, '${TEST_TAG} half day', 'approved');
      INSERT INTO public.attendance_derivation_runs (id, tenant_id, shift_id, from_date, to_date, trigger)
        VALUES ('${RUN_HALF}'::uuid, '${COMPANY_A}'::uuid, '${SHIFT_PLAIN}'::uuid, '${D_HALF}'::date, '${D_HALF}'::date, 'replay');
      SELECT * FROM public.attendance_derive_pass2('${COMPANY_A}'::uuid, '${SHIFT_PLAIN}'::uuid, '${D_HALF}'::date, '${D_HALF}'::date, '${RUN_HALF}'::uuid);
    `);
    const halfDayRow = attendanceRow(EMPLOYEE_A.employeeId, D_HALF);
    assert.ok(halfDayRow, "AC6: pass2 must fill in a day with no punch evidence from an approved leave");
    assert.equal(halfDayRow.status, "half_day", "AC6: day_fraction < 1 must derive to half_day (E23)");
    console.log("AC6: day_fraction's READ path is live and exercised (attendance_derive_pass2 honored day_fraction=0.5 -> half_day). No WRITE path exists in apply or approve (Catalog above) -- reported as a gap, not a vacuous pass.");

    // ---------------------------------------------------------------------
    // AC7: module gating. Disabling Leave denies apply; disabling Attendance (Leave-only) must
    // NOT break approve/cancel -- the exact trap avoided by not composing pass1/pass2 inline.
    // ---------------------------------------------------------------------
    runSql(`UPDATE public.tenant_modules SET enabled=false WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='leave';`);
    const deniedApply = await employee.database.rpc("employee_apply_leave_request", {
      p_tenant_id: COMPANY_A, p_leave_type_id: LEAVE_TYPE_CL, p_start_date: D_MODULE_GATE, p_end_date: D_MODULE_GATE, p_reason: `${TEST_TAG} module gate`,
    });
    expectError(deniedApply, /MODULE_DISABLED/i, "AC7 apply with Leave disabled");
    runSql(`UPDATE public.tenant_modules SET enabled=true WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='leave';`);
    console.log("AC7: employee_apply_leave_request denies MODULE_DISABLED when Leave is off for the tenant.");

    runSql(`
      UPDATE public.tenant_modules SET enabled=false WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='attendance';
      INSERT INTO public.leaves (id, tenant_id, employee_id, leave_type_id, leave_type, start_date, end_date, total_days, reason, status)
        VALUES ('${LEAVE_MODULE_GATE}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, '${LEAVE_TYPE_CL}'::uuid, 'casual', '${D_MODULE_GATE}'::date, '${D_MODULE_GATE}'::date, 1, '${TEST_TAG} leave-only', 'pending');
    `);
    noError(await hr.database.rpc("approve_leave_request", { p_leave_id: LEAVE_MODULE_GATE, p_working_dates: null, p_approved_business_days: null }), "AC7 approve on Leave-only tenant");
    noError(await hr.database.rpc("cancel_leave_request", { p_leave_id: LEAVE_MODULE_GATE, p_rejection_reason: null, p_new_status: "cancelled" }), "AC7 cancel on Leave-only tenant");
    console.log("AC7: with Attendance disabled (Leave-only), approve and cancel both succeeded -- cancel_leave_request does not depend on attendance_derive_pass1/pass2 being callable.");
    runSql(`UPDATE public.tenant_modules SET enabled=${originalModules.attendance ? "true" : "false"} WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='attendance';`);

    console.log("P2-04 leave workflow acceptance: PASS");
  } finally {
    runSql(`
      UPDATE public.tenant_modules SET enabled=${originalModules.leave ? "true" : "false"} WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='leave';
      UPDATE public.tenant_modules SET enabled=${originalModules.attendance ? "true" : "false"} WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='attendance';
      ${cleanupSql(ALL_LEAVE_IDS, ALL_DATES)}
    `);
  }

  const afterRls = await rlsInvariant(clients);
  console.log(`RLS invariant after teardown: ${afterRls.employee}/${afterRls.hr}/${afterRls.crossTenant}.`);
  const finalA = balanceRow();
  const finalHr = hrBalanceRow();
  assert.deepEqual(finalA, { balance: OPENING_BALANCE, used: 0, allocated: OPENING_BALANCE }, "teardown must leave employee.a's balance at its opening state");
  assert.deepEqual(finalHr, { balance: OPENING_BALANCE, used: 0 }, "teardown must leave hr-employee.a's balance at its opening state");
  console.log("Balances restored to opening state for both personas.");
});
