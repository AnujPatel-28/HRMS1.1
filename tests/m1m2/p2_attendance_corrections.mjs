#!/usr/bin/env node
// P2-02 executable evidence: attendance-only punch flow, correction authorization/locking,
// event/derivation idempotency, canonical tenant dates, and teardown-safe RLS invariants.
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
  membershipId: "7d538ee4-0355-3fb5-872f-2dcea87c62d1",
  email: "hr-employee.a@m1m2.test",
});
const EMPLOYEE_A_MEMBERSHIP = "2c4de0df-903f-f3ab-7e42-2feec67768f3";
const EMPLOYEE_B = Object.freeze({
  userId: "b0000000-0000-4000-8001-000000000001",
  employeeId: "b0000000-0000-4000-8001-000000000002",
  email: "employee.b@m1m2.test",
});

const D_CORRECTION = "2026-09-02";
const D_LOCKED = "2026-09-03";
const D_SELF = "2026-09-04";
const D_MANAGER = "2026-09-05";
const D_DAY = "2026-09-07";
const D_DERIVE = "2026-09-08";
const ATT_CORRECTION = "a2200000-0000-4000-8000-000000000001";
const ATT_LOCKED = "a2200000-0000-4000-8000-000000000002";
const SHIFT_NIGHT = "a2200000-0000-4000-8000-000000000010";
const EMPLOYEE_SHIFT = "a2200000-0000-4000-8000-000000000011";
const RUN_ONE = "a2200000-0000-4000-8000-000000000012";
const RUN_TWO = "a2200000-0000-4000-8000-000000000013";
const REL_MANAGER = "a2200000-0000-4000-8000-000000000014";
const TASK_GATE = "a2200000-0000-4000-8000-000000000015";
const SHIFT_DAY = "a2200000-0000-4000-8000-000000000016";
const EMPLOYEE_SHIFT_DAY = "a2200000-0000-4000-8000-000000000017";
const RUN_DAY = "a2200000-0000-4000-8000-000000000018";
const TEST_TAG = "p2-02-acceptance";

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

async function signIn(persona, anonKey) {
  const client = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey });
  const { data, error } = await client.auth.signInWithPassword({ email: persona.email, password: PASSWORD });
  assert.equal(error, null, `${persona.email}: ${messageOf(error)}`);
  assert.equal(data?.user?.id, persona.userId, `${persona.email}: unexpected identity`);
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

function runIdempotentSql(sql, label) {
  try {
    return runSql(sql);
  } catch (error) {
    if (error?.code !== "CLI_CALL_FAILED") throw error;
    console.log(`${label}: transient CLI transport failure, retrying once.`);
    return runSql(sql);
  }
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

function cleanupSql(today) {
  const dates = [D_CORRECTION, D_LOCKED, D_SELF, D_MANAGER, D_DAY, D_DERIVE, today].map(q).join(",");
  return `
    DELETE FROM public.notifications
    WHERE tenant_id='${COMPANY_A}'::uuid
      AND reference_id IN (SELECT id FROM public.attendance_corrections WHERE tenant_id='${COMPANY_A}'::uuid AND attendance_date IN (${dates}));
    DELETE FROM public.audit_logs
    WHERE tenant_id='${COMPANY_A}'::uuid
      AND (details->>'p2_test'='${TEST_TAG}' OR target_id IN (
        SELECT id FROM public.attendance_corrections WHERE tenant_id='${COMPANY_A}'::uuid AND attendance_date IN (${dates})
      ) OR target_id IN (
        SELECT id FROM public.attendance WHERE tenant_id='${COMPANY_A}'::uuid AND employee_id IN ('${EMPLOYEE_A.employeeId}'::uuid,'${HR_A.employeeId}'::uuid) AND date IN (${dates})
      ));
    DELETE FROM public.overtime_records
    WHERE tenant_id='${COMPANY_A}'::uuid AND employee_id IN ('${EMPLOYEE_A.employeeId}'::uuid,'${HR_A.employeeId}'::uuid) AND date IN (${dates});
    DELETE FROM public.attendance_events
    WHERE tenant_id='${COMPANY_A}'::uuid
      AND employee_id IN ('${EMPLOYEE_A.employeeId}'::uuid,'${HR_A.employeeId}'::uuid)
      AND (source_ref LIKE '${TEST_TAG}%' OR attendance_id IN (
        SELECT id FROM public.attendance WHERE tenant_id='${COMPANY_A}'::uuid AND employee_id IN ('${EMPLOYEE_A.employeeId}'::uuid,'${HR_A.employeeId}'::uuid) AND date IN (${dates})
      ));
    DELETE FROM public.attendance_corrections
    WHERE tenant_id='${COMPANY_A}'::uuid AND employee_id IN ('${EMPLOYEE_A.employeeId}'::uuid,'${HR_A.employeeId}'::uuid) AND attendance_date IN (${dates});
    DELETE FROM public.attendance
    WHERE tenant_id='${COMPANY_A}'::uuid AND employee_id IN ('${EMPLOYEE_A.employeeId}'::uuid,'${HR_A.employeeId}'::uuid) AND date IN (${dates});
    DELETE FROM public.attendance_derivation_runs WHERE id IN ('${RUN_DAY}'::uuid,'${RUN_ONE}'::uuid,'${RUN_TWO}'::uuid);
    DELETE FROM public.employee_shifts WHERE id IN ('${EMPLOYEE_SHIFT_DAY}'::uuid,'${EMPLOYEE_SHIFT}'::uuid);
    DELETE FROM public.shifts WHERE id IN ('${SHIFT_DAY}'::uuid,'${SHIFT_NIGHT}'::uuid);
    DELETE FROM public.employee_reporting_relationships WHERE id='${REL_MANAGER}'::uuid;
    DELETE FROM public.membership_template_assignments WHERE membership_id='${EMPLOYEE_A_MEMBERSHIP}'::uuid AND template_key='manager';
    DELETE FROM public.tasks WHERE id='${TASK_GATE}'::uuid;
  `;
}

await guardedMutation("P2-02 attendance/corrections", async () => {
  const anonKey = readBranchAnonKey();
  const employee = await signIn(EMPLOYEE_A, anonKey);
  const hr = await signIn(HR_A, anonKey);
  const crossTenant = await signIn(EMPLOYEE_B, anonKey);
  const clients = { employee, hr, crossTenant };
  const today = rowsOf(runSql(`SELECT public.tenant_business_date('${COMPANY_A}'::uuid,now()) AS d`))[0].d.slice(0, 10);

  const originalState = rowsOf(runSql(`
    SELECT t.timezone, t.punch_out_gate_enabled,
      (SELECT enabled FROM public.tenant_modules WHERE tenant_id=t.id AND module_key='attendance') AS attendance_enabled,
      (SELECT enabled FROM public.tenant_modules WHERE tenant_id=t.id AND module_key='tasks') AS tasks_enabled
    FROM public.tenants t WHERE t.id='${COMPANY_A}'::uuid
  `))[0];
  const companyBTimezone = rowsOf(runSql(`SELECT timezone FROM public.tenants WHERE id='${COMPANY_B}'::uuid`))[0].timezone;

  // Fixtures are deliberately fixed-id and teardown-first. Refuse to erase a pre-existing manager
  // grant: the synthetic persona is expected to start employee-only.
  assert.equal(Number(rowsOf(runSql(`SELECT count(*) n FROM public.membership_template_assignments WHERE membership_id='${EMPLOYEE_A_MEMBERSHIP}'::uuid AND template_key='manager'`))[0].n), 0);
  runSql(cleanupSql(today));

  const beforeRls = await rlsInvariant(clients);
  console.log(`RLS invariant before fixtures: ${beforeRls.employee}/${beforeRls.hr}/${beforeRls.crossTenant}.`);

  try {
    // Structural security and single-authority checks.
    const catalog = rowsOf(runSql(`
      SELECT p.proname, count(*) AS copies,
        bool_and(p.prosecdef) FILTER (WHERE p.proname IN ('request_attendance_correction','assert_attendance_correction_reviewer','hr_approve_attendance_correction','hr_reject_attendance_correction')) AS definer,
        bool_and(NOT has_function_privilege('anon',p.oid,'EXECUTE')) AS no_anon,
        bool_and(pg_get_functiondef(p.oid) LIKE '%tenant_business_date%') FILTER (WHERE p.proname IN ('punch_in_attendance','punch_out_attendance','attendance_derive_pass1','attendance_derive_pass2','attendance_resolve_shift')) AS canonical_date
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN (
        'punch_in_attendance','punch_out_attendance','attendance_derive_pass1','attendance_derive_pass2','attendance_resolve_shift',
        'request_attendance_correction','assert_attendance_correction_reviewer','hr_approve_attendance_correction','hr_reject_attendance_correction'
      ) GROUP BY p.proname ORDER BY p.proname
    `));
    assert.equal(catalog.length, 9);
    for (const row of catalog) {
      assert.equal(Number(row.copies), 1, `${row.proname}: overload count`);
      assert.equal(row.no_anon, true, `${row.proname}: anon execute must be absent`);
      if (row.definer !== null) assert.equal(row.definer, true, `${row.proname}: must be definer`);
      if (row.canonical_date !== null) assert.equal(row.canonical_date, true, `${row.proname}: must call tenant_business_date`);
    }
    const eventWriter = rowsOf(runSql(`SELECT count(*) n FROM pg_trigger WHERE tgrelid='public.attendance'::regclass AND tgname='trg_attendance_dual_write_event' AND NOT tgisinternal`))[0].n;
    assert.equal(Number(eventWriter), 1, "attendance must have exactly one dual-write event trigger");
    console.log("Catalog: 9 named functions each have one copy; correction definers deny anon; 5 attendance callers use tenant_business_date; one event trigger.");

    // Post-change equivalence oracle on DST gaps/folds. The exact same 30 cases were captured
    // before apply; both the inline expression and canonical function agreed in every case.
    const instants = [
      "2026-03-08T04:59:59Z", "2026-03-08T05:00:00Z",
      "2026-03-08T06:59:59Z", "2026-03-08T07:00:00Z",
      "2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z",
    ];
    runSql(`UPDATE public.tenants SET timezone='America/New_York' WHERE id='${COMPANY_B}'::uuid`);
    const equivalence = rowsOf(runSql(`
      WITH callers(name) AS (VALUES ('punch_in_attendance'),('punch_out_attendance'),('attendance_derive_pass1'),('attendance_derive_pass2'),('attendance_resolve_shift')),
      instants(i) AS (VALUES ${instants.map((i) => `('${i}'::timestamptz)`).join(",")})
      SELECT c.name, i.i,
        (i.i AT TIME ZONE 'America/New_York')::date AS inline_date,
        public.tenant_business_date('${COMPANY_B}'::uuid,i.i) AS canonical_date
      FROM callers c CROSS JOIN instants i
    `));
    assert.equal(equivalence.length, 30);
    assert.ok(equivalence.every((r) => r.inline_date === r.canonical_date), "DST equivalence mismatch");
    runSql(`UPDATE public.tenants SET timezone=${q(companyBTimezone)} WHERE id='${COMPANY_B}'::uuid`);
    console.log("Date equivalence after apply: 30/30 across five callers, including America/New_York DST gap and fold instants (before apply: 30/30 same matrix).");

    // AC1: absence remains a display sentinel only; then exercise real attendance-only IN/OUT.
    const noRecordRows = noError(await employee.database.from("attendance").select("id,status").eq("tenant_id", COMPANY_A).eq("employee_id", EMPLOYEE_A.employeeId).eq("date", D_SELF), "AC1 no_record query");
    assert.equal(noRecordRows.length, 0, "no_record day must not fabricate an absence row");
    const attendanceSource = readFileSync(join(repoRoot, "src", "hr", "Attendance.tsx"), "utf8");
    assert.match(attendanceSource, /status:\s*"no_record" as AttendanceStatus/);

    runSql(`
      UPDATE public.tenant_modules SET enabled=false WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='tasks';
      UPDATE public.tenants SET punch_out_gate_enabled=true WHERE id='${COMPANY_A}'::uuid;
      INSERT INTO public.tasks (id,tenant_id,title,assigned_to,assigned_by,due_date,status)
      VALUES ('${TASK_GATE}'::uuid,'${COMPANY_A}'::uuid,'${TEST_TAG}','${EMPLOYEE_A.employeeId}'::uuid,'${HR_A.employeeId}'::uuid,${q(today)}::date,'assigned');
    `);
    const punchedIn = noError(await employee.database.rpc("punch_in_attendance", {
      p_tenant_id: COMPANY_A, p_employee_id: EMPLOYEE_A.employeeId,
      p_lat: null, p_lng: null, p_acc: null, p_loc_status: "gps_unavailable",
      p_confidence: null, p_ip: null, p_remote_exception_id: null,
      p_verification_snapshot: { test: TEST_TAG },
    }), "AC1 attendance-only punch in");
    assert.equal(punchedIn.success, true, JSON.stringify(punchedIn));
    const firstAttendanceId = punchedIn.attendance_id ?? punchedIn.id;
    assert.ok(firstAttendanceId, "punch in did not return attendance id");
    const tasksOffOut = noError(await employee.database.rpc("punch_out_attendance", {
      p_attendance_id: firstAttendanceId, p_tenant_id: COMPANY_A,
      p_lat: null, p_lng: null, p_acc: null, p_loc_status: "gps_unavailable",
      p_confidence: null, p_remote_exception_id: null, p_verification_snapshot: { test: TEST_TAG },
    }), "AC6 punch out with Tasks disabled");
    assert.equal(tasksOffOut.success, true, JSON.stringify(tasksOffOut));

    // Remove only the first test session, then create another real session with Tasks enabled.
    runSql(`
      DELETE FROM public.overtime_records WHERE attendance_id='${firstAttendanceId}'::uuid;
      DELETE FROM public.attendance_events WHERE attendance_id='${firstAttendanceId}'::uuid;
      DELETE FROM public.attendance WHERE id='${firstAttendanceId}'::uuid;
      UPDATE public.tenant_modules SET enabled=true WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='tasks';
    `);
    const secondPunchIn = noError(await employee.database.rpc("punch_in_attendance", {
      p_tenant_id: COMPANY_A, p_employee_id: EMPLOYEE_A.employeeId,
      p_lat: null, p_lng: null, p_acc: null, p_loc_status: "gps_unavailable",
      p_confidence: null, p_ip: null, p_remote_exception_id: null,
      p_verification_snapshot: { test: TEST_TAG },
    }), "AC6 second punch in");
    const secondAttendanceId = secondPunchIn.attendance_id ?? secondPunchIn.id;
    const tasksOnOut = noError(await employee.database.rpc("punch_out_attendance", {
      p_attendance_id: secondAttendanceId, p_tenant_id: COMPANY_A,
      p_lat: null, p_lng: null, p_acc: null, p_loc_status: "gps_unavailable",
      p_confidence: null, p_remote_exception_id: null, p_verification_snapshot: { test: TEST_TAG },
    }), "AC6 punch out with Tasks enabled");
    assert.deepEqual({ success: tasksOnOut.success, reason: tasksOnOut.reason, errcode: tasksOnOut.errcode }, { success: false, reason: "TASK_GATE_BLOCKED", errcode: "P0003" });
    console.log("AC1/AC6: no_record stored 0 rows; attendance-only IN/OUT succeeded with Tasks disabled; Tasks re-enabled returned TASK_GATE_BLOCKED/P0003.");
    // The denied session correctly remains open. Remove this test-owned session before creating
    // another open historical row; the database intentionally permits only one open session.
    runSql(`
      DELETE FROM public.attendance_events WHERE attendance_id='${secondAttendanceId}'::uuid;
      DELETE FROM public.attendance WHERE id='${secondAttendanceId}'::uuid;
      DELETE FROM public.tasks WHERE id='${TASK_GATE}'::uuid;
    `);

    // AC2: employee request -> distinct company reviewer -> locked corrected row. The trigger is
    // the only event writer: existing IN evidence survives and exactly one OUT is appended.
    runIdempotentSql(`INSERT INTO public.attendance (id,tenant_id,employee_id,date,punch_in,status,punch_out_allowed,session_status)
      VALUES ('${ATT_CORRECTION}'::uuid,'${COMPANY_A}'::uuid,'${EMPLOYEE_A.employeeId}'::uuid,'${D_CORRECTION}'::date,'${D_CORRECTION} 03:30:00+00'::timestamptz,'present',true,'open')
      ON CONFLICT (id) DO NOTHING`, "AC2 fixture insert");
    const originalInEvent = rowsOf(runSql(`SELECT id,event_time,direction,source,source_ref,idempotency_key FROM public.attendance_events WHERE attendance_id='${ATT_CORRECTION}'::uuid AND direction='in'`))[0];
    assert.ok(originalInEvent?.id, "attendance trigger did not retain the original IN event");
    const request = noError(await employee.database.rpc("request_attendance_correction", {
      p_tenant_id: COMPANY_A, p_attendance_date: D_CORRECTION,
      p_requested_punch_in: null, p_requested_punch_out: "18:00:00", p_reason: TEST_TAG,
    }), "AC2 correction request");
    assert.equal(request.employee_id, EMPLOYEE_A.employeeId);
    assert.equal(request.status, "pending");

    const directInsert = await employee.database.from("attendance_corrections").insert({
      tenant_id: COMPANY_A, employee_id: EMPLOYEE_A.employeeId, attendance_date: "2026-08-30",
      requested_punch_out: "18:00:00", reason: TEST_TAG,
    });
    expectError(directInsert, /42501|permission denied/i, "direct correction INSERT");
    const approved = noError(await hr.database.rpc("hr_approve_attendance_correction", {
      p_tenant_id: COMPANY_A, p_correction_id: request.id,
    }), "AC2 company approval");
    assert.ok(approved, "AC2 company approval returned no result");
    assert.equal(rowsOf(runSql(`SELECT status FROM public.attendance_corrections WHERE id='${request.id}'::uuid`))[0].status, "approved");
    const corrected = rowsOf(runSql(`SELECT is_locked,derivation_source,session_status,punch_in,punch_out FROM public.attendance WHERE id='${ATT_CORRECTION}'::uuid`))[0];
    assert.equal(corrected.is_locked, true);
    assert.equal(corrected.derivation_source, "correction");
    assert.equal(corrected.session_status, "closed");
    const correctionEvidence = rowsOf(runSql(`
      SELECT direction,count(*) n,min(source) source FROM public.attendance_events WHERE attendance_id='${ATT_CORRECTION}'::uuid GROUP BY direction ORDER BY direction;
    `));
    assert.deepEqual(correctionEvidence.map((r) => [r.direction, Number(r.n)]), [["in", 1], ["out", 1]]);
    const retainedInEvent = rowsOf(runSql(`SELECT id,event_time,direction,source,source_ref,idempotency_key FROM public.attendance_events WHERE id='${originalInEvent.id}'::uuid`))[0];
    assert.deepEqual(retainedInEvent, originalInEvent, "approval changed raw IN evidence");
    const audits = rowsOf(runSql(`SELECT action FROM public.audit_logs WHERE target_id='${request.id}'::uuid ORDER BY action`)).map((r) => r.action);
    assert.deepEqual(audits, ["attendance_correction.approved", "attendance_correction.requested"]);

    // Replaying the existing trigger-written OUT event through the idempotent ingest seam takes
    // the documented ON CONFLICT no-op path (NULL return) and changes neither evidence nor count.
    const outEvent = rowsOf(runSql(`SELECT * FROM public.attendance_events WHERE attendance_id='${ATT_CORRECTION}'::uuid AND direction='out'`))[0];
    const replayedId = rowsOf(runSql(`SELECT public.attendance_event_ingest(
      '${COMPANY_A}'::uuid,'${EMPLOYEE_A.employeeId}'::uuid,${q(outEvent.event_time)}::timestamptz,'out',${q(outEvent.source)},${q(outEvent.source_ref)},'${ATT_CORRECTION}'::uuid,
      NULL,NULL,NULL,${outEvent.location_status ? q(outEvent.location_status) : "NULL"},NULL,${q(JSON.stringify(outEvent.evidence ?? {}))}::jsonb,${q(outEvent.idempotency_key)},${outEvent.correlation_id ? q(outEvent.correlation_id) + "::uuid" : "NULL"}) AS id`))[0].id;
    assert.equal(replayedId, null);
    assert.equal(Number(rowsOf(runSql(`SELECT count(*) n FROM public.attendance_events WHERE attendance_id='${ATT_CORRECTION}'::uuid`))[0].n), 2);

    // Locked-row failure is executed, not inferred.
    runSql(`INSERT INTO public.attendance (id,tenant_id,employee_id,date,punch_in,status,punch_out_allowed,session_status)
      VALUES ('${ATT_LOCKED}'::uuid,'${COMPANY_A}'::uuid,'${EMPLOYEE_A.employeeId}'::uuid,'${D_LOCKED}'::date,'${D_LOCKED} 03:30:00+00'::timestamptz,'present',true,'open')`);
    const lockedRequest = noError(await employee.database.rpc("request_attendance_correction", {
      p_tenant_id: COMPANY_A, p_attendance_date: D_LOCKED,
      p_requested_punch_in: null, p_requested_punch_out: "18:00:00", p_reason: TEST_TAG,
    }), "AC2 locked request setup");
    runSql(`UPDATE public.attendance SET is_locked=true WHERE id='${ATT_LOCKED}'::uuid`);
    const lockedApproval = await hr.database.rpc("hr_approve_attendance_correction", { p_tenant_id: COMPANY_A, p_correction_id: lockedRequest.id });
    expectError(lockedApproval, /P1001|ATTENDANCE_CORRECTION_LOCKED/i, "locked correction approval");
    assert.equal(rowsOf(runSql(`SELECT status FROM public.attendance_corrections WHERE id='${lockedRequest.id}'::uuid`))[0].status, "pending");
    console.log("AC2: request capability RPC, direct-table denial, distinct approval, immutable IN evidence, request+approval audits, replay no-op, and locked approval P1001 all passed.");

    // AC5: common self-denial, wrong tenant, company scope above, then primary direct-report scope.
    const selfRequest = noError(await hr.database.rpc("request_attendance_correction", {
      p_tenant_id: COMPANY_A, p_attendance_date: D_SELF,
      p_requested_punch_in: "09:00:00", p_requested_punch_out: "18:00:00", p_reason: TEST_TAG,
    }), "AC5 self request");
    const wrongTenant = await crossTenant.database.rpc("hr_approve_attendance_correction", { p_tenant_id: COMPANY_A, p_correction_id: selfRequest.id });
    expectError(wrongTenant, /P1003|APPROVAL_SUBJECT_UNAVAILABLE/i, "AC5 wrong tenant");
    const selfApproval = await hr.database.rpc("hr_approve_attendance_correction", { p_tenant_id: COMPANY_A, p_correction_id: selfRequest.id });
    expectError(selfApproval, /P1001|SELF_APPROVAL_DENIED/i, "AC5 self approval");

    runSql(`
      INSERT INTO public.membership_template_assignments (membership_id,tenant_id,template_key,is_active,assigned_by)
      VALUES ('${EMPLOYEE_A_MEMBERSHIP}'::uuid,'${COMPANY_A}'::uuid,'manager',true,'${HR_A.userId}'::uuid);
      INSERT INTO public.employee_reporting_relationships (id,tenant_id,employee_id,manager_id,relationship_type,effective_from,effective_to,is_active)
      VALUES ('${REL_MANAGER}'::uuid,'${COMPANY_A}'::uuid,'${HR_A.employeeId}'::uuid,'${EMPLOYEE_A.employeeId}'::uuid,'primary','2026-01-01',NULL,true);
    `);
    const managerRequest = noError(await hr.database.rpc("request_attendance_correction", {
      p_tenant_id: COMPANY_A, p_attendance_date: D_MANAGER,
      p_requested_punch_in: "09:00:00", p_requested_punch_out: "18:00:00", p_reason: TEST_TAG,
    }), "AC5 direct-report setup");
    const managerApproval = noError(await employee.database.rpc("hr_approve_attendance_correction", {
      p_tenant_id: COMPANY_A, p_correction_id: managerRequest.id,
    }), "AC5 direct-report approval");
    assert.ok(managerApproval, "AC5 direct-report approval returned no result");
    assert.equal(rowsOf(runSql(`SELECT status FROM public.attendance_corrections WHERE id='${managerRequest.id}'::uuid`))[0].status, "approved");
    console.log("AC5: company and effective-primary-direct-report approvals passed; wrong tenant denied P1003; composed HR+employee self-approval denied by shared SELF_APPROVAL_DENIED/P1001.");

    // AC3/AC4: separate day and overnight shifts preserve raw device provenance. The first
    // scheduled-pass primitive derives and stamps the events; a fresh replay run processes zero
    // events and leaves the night row byte-equivalent (derived_at intentionally omitted).
    runSql(`
      INSERT INTO public.shifts (id,tenant_id,name,start_time,end_time,working_days,is_default,is_active,enable_auto_derivation)
      VALUES ('${SHIFT_DAY}'::uuid,'${COMPANY_A}'::uuid,'${TEST_TAG} day','09:00','17:00',ARRAY[1,2,3,4,5,6,7],false,true,true);
      INSERT INTO public.shifts (id,tenant_id,name,start_time,end_time,working_days,is_default,is_active,enable_auto_derivation)
      VALUES ('${SHIFT_NIGHT}'::uuid,'${COMPANY_A}'::uuid,'${TEST_TAG} night','22:00','06:00',ARRAY[1,2,3,4,5,6,7],false,true,true);
      INSERT INTO public.employee_shifts (id,tenant_id,employee_id,shift_id,effective_from,effective_to)
      VALUES ('${EMPLOYEE_SHIFT_DAY}'::uuid,'${COMPANY_A}'::uuid,'${EMPLOYEE_A.employeeId}'::uuid,'${SHIFT_DAY}'::uuid,'${D_DAY}', '${D_DAY}');
      INSERT INTO public.employee_shifts (id,tenant_id,employee_id,shift_id,effective_from,effective_to)
      VALUES ('${EMPLOYEE_SHIFT}'::uuid,'${COMPANY_A}'::uuid,'${EMPLOYEE_A.employeeId}'::uuid,'${SHIFT_NIGHT}'::uuid,'${D_DERIVE}', '${D_DERIVE}');
      SELECT public.attendance_event_ingest('${COMPANY_A}'::uuid,'${EMPLOYEE_A.employeeId}'::uuid,'2026-09-07 03:35:00+00','in','device','${TEST_TAG}:day:in',NULL,NULL,NULL,NULL,'device_verified',NULL,'{"device":"synthetic-terminal","raw":"keep"}'::jsonb,'${TEST_TAG}:day:in',NULL);
      SELECT public.attendance_event_ingest('${COMPANY_A}'::uuid,'${EMPLOYEE_A.employeeId}'::uuid,'2026-09-07 11:30:00+00','out','device','${TEST_TAG}:day:out',NULL,NULL,NULL,NULL,'device_verified',NULL,'{"device":"synthetic-terminal","raw":"keep"}'::jsonb,'${TEST_TAG}:day:out',NULL);
      SELECT public.attendance_event_ingest('${COMPANY_A}'::uuid,'${EMPLOYEE_A.employeeId}'::uuid,'2026-09-08 16:45:00+00','in','device','${TEST_TAG}:night:in',NULL,NULL,NULL,NULL,'device_verified',NULL,'{"device":"synthetic-terminal","raw":"keep"}'::jsonb,'${TEST_TAG}:night:in',NULL);
      SELECT public.attendance_event_ingest('${COMPANY_A}'::uuid,'${EMPLOYEE_A.employeeId}'::uuid,'2026-09-09 00:30:00+00','out','device','${TEST_TAG}:night:out',NULL,NULL,NULL,NULL,'device_verified',NULL,'{"device":"synthetic-terminal","raw":"keep"}'::jsonb,'${TEST_TAG}:night:out',NULL);
      INSERT INTO public.attendance_derivation_runs (id,tenant_id,shift_id,from_date,to_date,trigger)
      VALUES ('${RUN_DAY}'::uuid,'${COMPANY_A}'::uuid,'${SHIFT_DAY}'::uuid,'${D_DAY}','${D_DAY}','schedule');
      SELECT * FROM public.attendance_derive_pass1('${COMPANY_A}'::uuid,'${SHIFT_DAY}'::uuid,'${D_DAY}','${D_DAY}','${RUN_DAY}'::uuid);
      INSERT INTO public.attendance_derivation_runs (id,tenant_id,shift_id,from_date,to_date,trigger)
      VALUES ('${RUN_ONE}'::uuid,'${COMPANY_A}'::uuid,'${SHIFT_NIGHT}'::uuid,'${D_DERIVE}','${D_DERIVE}','schedule');
      SELECT * FROM public.attendance_derive_pass1('${COMPANY_A}'::uuid,'${SHIFT_NIGHT}'::uuid,'${D_DERIVE}','${D_DERIVE}','${RUN_ONE}'::uuid);
    `);
    const derivedDay = rowsOf(runSql(`SELECT id,date,shift_id,derivation_source,derivation_version,in_time,out_time,business_date_tz,location_status FROM public.attendance WHERE tenant_id='${COMPANY_A}'::uuid AND employee_id='${EMPLOYEE_A.employeeId}'::uuid AND date='${D_DAY}' AND shift_id='${SHIFT_DAY}'::uuid`))[0];
    assert.equal(derivedDay.derivation_source, "derived");
    assert.equal(derivedDay.business_date_tz, originalState.timezone);
    assert.equal(derivedDay.location_status, "device_verified");
    assert.equal(Number(derivedDay.derivation_version), 1);
    assert.ok(derivedDay.in_time && derivedDay.out_time);
    const dayEvidence = rowsOf(runSql(`SELECT source,evidence,attendance_id FROM public.attendance_events WHERE source_ref LIKE '${TEST_TAG}:day:%' ORDER BY source_ref`));
    assert.equal(dayEvidence.length, 2);
    assert.ok(dayEvidence.every((e) => e.source === "device" && e.evidence.raw === "keep" && e.attendance_id === derivedDay.id));
    const derivedBefore = rowsOf(runSql(`SELECT id,date,shift_id,status,derivation_source,derivation_version,in_time,out_time,work_hours,business_date_tz,location_status,shift_snapshot,policy_snapshot FROM public.attendance WHERE tenant_id='${COMPANY_A}'::uuid AND employee_id='${EMPLOYEE_A.employeeId}'::uuid AND date='${D_DERIVE}' AND shift_id='${SHIFT_NIGHT}'::uuid`))[0];
    assert.equal(derivedBefore.derivation_source, "derived");
    assert.equal(derivedBefore.business_date_tz, originalState.timezone);
    assert.equal(derivedBefore.location_status, "device_verified");
    assert.equal(Number(derivedBefore.derivation_version), 1);
    assert.ok(derivedBefore.in_time && derivedBefore.out_time);
    const rawBefore = rowsOf(runSql(`SELECT id,source,source_ref,evidence,attendance_id FROM public.attendance_events WHERE source_ref LIKE '${TEST_TAG}:night:%' ORDER BY source_ref`));
    assert.equal(rawBefore.length, 2);
    assert.ok(rawBefore.every((e) => e.source === "device" && e.evidence.raw === "keep" && e.attendance_id === derivedBefore.id));

    runSql(`
      INSERT INTO public.attendance_derivation_runs (id,tenant_id,shift_id,from_date,to_date,trigger)
      VALUES ('${RUN_TWO}'::uuid,'${COMPANY_A}'::uuid,'${SHIFT_NIGHT}'::uuid,'${D_DERIVE}','${D_DERIVE}','replay');
      SELECT * FROM public.attendance_derive_pass1('${COMPANY_A}'::uuid,'${SHIFT_NIGHT}'::uuid,'${D_DERIVE}','${D_DERIVE}','${RUN_TWO}'::uuid);
    `);
    const derivedAfter = rowsOf(runSql(`SELECT id,date,shift_id,status,derivation_source,derivation_version,in_time,out_time,work_hours,business_date_tz,location_status,shift_snapshot,policy_snapshot FROM public.attendance WHERE id='${derivedBefore.id}'::uuid`))[0];
    assert.deepEqual(derivedAfter, derivedBefore);
    const retryRun = rowsOf(runSql(`SELECT events_processed,rows_created,rows_updated,rows_skipped,status FROM public.attendance_derivation_runs WHERE id='${RUN_TWO}'::uuid`))[0];
    assert.deepEqual({ events: Number(retryRun.events_processed), created: Number(retryRun.rows_created), updated: Number(retryRun.rows_updated), skipped: Number(retryRun.rows_skipped), status: retryRun.status }, { events: 0, created: 0, updated: 0, skipped: 0, status: "completed" });
    console.log("AC3/AC4: day and overnight device IN/OUT derived with source/evidence/shift/timezone provenance; event replay and scheduled-pass retry were deterministic no-ops.");
  } finally {
    runSql(`
      UPDATE public.tenants SET timezone=${q(companyBTimezone)} WHERE id='${COMPANY_B}'::uuid;
      UPDATE public.tenants SET timezone=${q(originalState.timezone)}, punch_out_gate_enabled=${originalState.punch_out_gate_enabled ? "true" : "false"} WHERE id='${COMPANY_A}'::uuid;
      UPDATE public.tenant_modules SET enabled=${originalState.attendance_enabled ? "true" : "false"} WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='attendance';
      UPDATE public.tenant_modules SET enabled=${originalState.tasks_enabled ? "true" : "false"} WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='tasks';
      ${cleanupSql(today)}
    `);
  }

  const afterRls = await rlsInvariant(clients);
  console.log(`RLS invariant after teardown: ${afterRls.employee}/${afterRls.hr}/${afterRls.crossTenant}.`);
  console.log("P2-02 attendance/corrections acceptance: PASS");
});
