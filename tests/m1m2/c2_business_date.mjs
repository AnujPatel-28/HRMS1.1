#!/usr/bin/env node
// C2 -- business date everywhere: acceptance evidence for
// migrations/20260912193000_m1m2-business-date-convergence.sql.
//
// Technique for every differential check below (advisor-reviewed): the functions under test call
// now() internally and take no "as of" parameter, so we cannot inject a fixed instant into them.
// Instead we temporarily set a FIXTURE TENANT's timezone to an extreme zone whose local calendar
// date is GUARANTEED to differ from the wall-clock UTC date at every possible test-run time:
//   ZONE_PLUS  = Pacific/Kiritimati (UTC+14) -- its date is always EQUAL TO OR AHEAD OF UTC's.
//   ZONE_MINUS = Pacific/Pago_Pago  (UTC-11) -- its date is always EQUAL TO OR BEHIND UTC's.
// The two are 25 hours apart, which is more than one calendar day, so they can never show the same
// date as each other -- at least one of them differs from plain UTC CURRENT_DATE at any instant
// (proved in the session transcript, not just asserted -- see the assertion right after the oracle
// below). Boundary values are then expressed purely in terms of T = tenant_business_date(tenant,
// now()), e.g. "reject at T+1, allow at T+2" for a 2-day notice requirement. That is correct under
// the FIXED implementation regardless of which zone ends up chosen, and -- because T and plain
// CURRENT_DATE necessarily differ by exactly one day whenever the picked zone differs from UTC --
// at least one of the two boundary checks would have produced the OPPOSITE verdict under the old
// CURRENT_DATE-based implementation. No sleeping until a specific wall-clock hour is required.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@insforge/sdk";

import { guardedMutation, runSql } from "./_harness.mjs";
import { TB_M1M2 } from "./_target.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PASSWORD = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "persona-password.local"), "utf8").trim();

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const EMPLOYEE_A = { email: "employee.a@m1m2.test", userId: "a0000000-0000-4000-8001-000000000001", employeeId: "a0000000-0000-4000-8001-000000000002" };
const HR_EMPLOYEE_A = { email: "hr-employee.a@m1m2.test", userId: "a0000000-0000-4000-8002-000000000001", employeeId: "a0000000-0000-4000-8002-000000000002" };
const LEAVE_TYPE_CL = "a0000000-0000-4000-8006-000000000001";
const TEST_TAG = "[c2-business-date]";

const ZONE_PLUS = "Pacific/Kiritimati"; // UTC+14
const ZONE_MINUS = "Pacific/Pago_Pago"; // UTC-11

const rowsOf = (result) => result?.rows ?? [];
const messageOf = (error) => [error?.code, error?.message, error?.details].filter(Boolean).join(" | ");

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

/**
 * The TB host occasionally drops a connection with a bare "fetch failed" / "Network request
 * failed" during this suite's long CLI-heavy run (same class the repo already retries once in
 * p2_work_calendar_resolver.mjs's withFetchRetry) -- not a sign-in defect. Retried once.
 */
async function signIn(persona, anonKey) {
  const client = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey });
  let result = await client.auth.signInWithPassword({ email: persona.email, password: PASSWORD });
  if (result.error && /fetch failed|network request failed/i.test(messageOf(result.error))) {
    console.log(`${persona.email}: transient sign-in network failure, retrying once`);
    result = await client.auth.signInWithPassword({ email: persona.email, password: PASSWORD });
  }
  const { data, error } = result;
  assert.equal(error, null, `${persona.email}: ${messageOf(error)}`);
  assert.equal(data?.user?.id, persona.userId, `${persona.email}: unexpected identity`);
  return client;
}

function noError(result, label) {
  assert.equal(result.error, null, `${label}: ${messageOf(result.error)}`);
  return result.data;
}

function expectError(result, pattern, label) {
  assert.notEqual(result.error, null, `${label}: expected an error, got success (${JSON.stringify(result.data)})`);
  assert.match(messageOf(result.error), pattern, `${label}: ${messageOf(result.error)}`);
}

/**
 * The TB host occasionally drops a connection with a bare "fetch failed" during this suite's long
 * CLI+SDK-heavy run (same class p2_work_calendar_resolver.mjs already retries once with its own
 * withFetchRetry) -- not a defect in the function under test. Retried once. A genuine business
 * error (e.g. "requires at least 2 days notice") is a normal `{error}` result, not a thrown/network
 * failure, so expectError's own callers are unaffected by this wrapper.
 */
async function withFetchRetry(makeCall, label) {
  const first = await makeCall();
  if (!first.error || !/fetch failed|network request failed/i.test(messageOf(first.error))) return first;
  console.log(`${label}: transient fetch failure, retrying once`);
  return makeCall();
}

/** Independent oracle for local calendar date: Node's own tz database, not Postgres's. */
function localDateInZone(instant, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(instant);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

await guardedMutation("C2 business date everywhere", async () => {
  const anonKey = readBranchAnonKey();
  const employeeAClient = await signIn(EMPLOYEE_A, anonKey);
  const hrClient = await signIn(HR_EMPLOYEE_A, anonKey);

  // ============================================================================================
  // Sweep -- after this migration, only the two deliberately-unchanged functions may reference
  // CURRENT_DATE outside a comment. (Comment lines containing the literal text "CURRENT_DATE" are
  // expected in several of the fixed functions -- they explain the change -- and must not count.)
  // ============================================================================================
  const CHANGED = [
    "employee_apply_leave_request", "hr_schedule_shift_change", "create_employee_transaction",
    "open_initial_unit_assignment", "attendance_evaluate_location", "expire_location_exceptions",
    "fn_accrue_monthly_leaves",
  ];
  const LEFT_UNCHANGED = ["fn_check_insurance_expiries", "attendance_reconcile_missing_selfies"];
  const sweep = rowsOf(runSql(
    `SELECT proname, prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosrc ILIKE '%current_date%' ORDER BY 1`,
  ));
  const realHits = {};
  for (const row of sweep) {
    const realLines = row.prosrc.split("\n").map((l) => l.trim())
      .filter((l) => /current_date/i.test(l) && !l.startsWith("--"));
    if (realLines.length > 0) realHits[row.proname] = realLines;
  }
  assert.deepEqual(
    Object.keys(realHits).sort(),
    [...LEFT_UNCHANGED].sort(),
    `non-comment CURRENT_DATE survives outside the two deliberately-unchanged functions: ${JSON.stringify(realHits)}`,
  );
  for (const fn of CHANGED) assert.ok(!realHits[fn], `${fn}: still has a non-comment CURRENT_DATE`);
  console.log(
    `Sweep: prosrc ILIKE '%current_date%' matches ${sweep.map((r) => r.proname).join(", ")}. `
    + `Non-comment survivors: ${Object.keys(realHits).join(", ") || "(none)"} -- exactly the two deliberately-unchanged functions `
    + `(insurance is an excluded product; the selfie lookback window is a harmless +/-1 day shift). All ${CHANGED.length} changed functions have zero non-comment CURRENT_DATE lines.`,
  );

  // ============================================================================================
  // Signature guard -- exactly one pg_proc row per changed name (CREATE OR REPLACE must replace,
  // never add an overload -- the repo's own recorded trap, see P2-01's migration header).
  // ============================================================================================
  const catalog = rowsOf(runSql(`
    SELECT p.proname, count(*) AS cnt, array_agg(pg_get_function_identity_arguments(p.oid) ORDER BY p.oid) AS sigs
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY(ARRAY[${CHANGED.map((n) => `'${n}'`).join(",")}])
    GROUP BY p.proname
  `.trim()));
  assert.equal(catalog.length, CHANGED.length, `expected ${CHANGED.length} distinct function names, found ${catalog.length}`);
  for (const row of catalog) assert.equal(Number(row.cnt), 1, `${row.proname}: expected exactly one overload, found ${row.cnt} (${row.sigs})`);
  console.log(`Signature guard: all ${CHANGED.length} changed functions have exactly one pg_proc row each -- no accidental overload.`);

  // ============================================================================================
  // Independent oracle + zone selection (see file header for the guarantee).
  // ============================================================================================
  const nowInstant = new Date();
  const utcDate = nowInstant.toISOString().slice(0, 10);
  const plusDate = localDateInZone(nowInstant, ZONE_PLUS);
  const minusDate = localDateInZone(nowInstant, ZONE_MINUS);
  assert.notEqual(plusDate, minusDate, "ZONE_PLUS/ZONE_MINUS must never agree (25h apart) -- oracle broken, abort");
  const zoneForA = plusDate !== utcDate ? ZONE_PLUS : ZONE_MINUS;
  console.log(`Independent oracle at ${nowInstant.toISOString()}: UTC=${utcDate}, ${ZONE_PLUS}=${plusDate}, ${ZONE_MINUS}=${minusDate}. Using ${zoneForA} for Company A (guaranteed to differ from UTC's date right now).`);

  const priorTzA = rowsOf(runSql(`SELECT timezone FROM public.tenants WHERE id='${COMPANY_A}'::uuid`))[0]?.timezone;
  assert.ok(priorTzA, "Company A has no timezone set");

  let leaveNoticeIds = [];
  let eligibilityLeaveIds = [];
  let disposableEmployeeId = null;
  let disposableOrgUnitId = null;
  let disposableShiftId = null;

  try {
    runSql(`UPDATE public.tenants SET timezone='${zoneForA}' WHERE id='${COMPANY_A}'::uuid`);
    const bizDateRaw = rowsOf(runSql(`SELECT public.tenant_business_date('${COMPANY_A}'::uuid, now()) AS d, CURRENT_DATE AS cd`))[0];
    const T = String(bizDateRaw.d).slice(0, 10);
    const U = String(bizDateRaw.cd).slice(0, 10);
    assert.notEqual(T, U, `fixture failed to create a divergence: tenant_business_date(A)=${T}, CURRENT_DATE=${U}`);
    console.log(`Company A timezone set to ${zoneForA}: tenant_business_date(A, now())=${T}, server CURRENT_DATE=${U} -- divergence confirmed.`);

    // ==========================================================================================
    // 1a. employee_apply_leave_request -- minimum notice uses T, not U.
    // ==========================================================================================
    const priorNoticeSetting = rowsOf(runSql(
      `SELECT value FROM public.tenant_settings WHERE tenant_id='${COMPANY_A}'::uuid AND key='leave_min_notice_days'`,
    ))[0];
    assert.equal(priorNoticeSetting, undefined, "fixture precondition failed: leave_min_notice_days already set for Company A");
    try {
      runSql(`INSERT INTO public.tenant_settings (id, tenant_id, key, value) VALUES (gen_random_uuid(), '${COMPANY_A}'::uuid, 'leave_min_notice_days', '2')`);

      const dateTooSoon = addDays(T, 1); // notice given = 1 day < 2 required -> must reject
      const dateOk = addDays(T, 2); // notice given = 2 days -> must accept
      const rejected = await withFetchRetry(
        () => employeeAClient.database.rpc("employee_apply_leave_request", {
          p_tenant_id: COMPANY_A, p_leave_type_id: LEAVE_TYPE_CL,
          p_start_date: dateTooSoon, p_end_date: dateTooSoon, p_reason: `${TEST_TAG} notice-reject`,
        }),
        "notice boundary: T+1",
      );
      expectError(rejected, /requires at least 2 days notice/i, "notice boundary: T+1 must be rejected");

      const accepted = noError(
        await withFetchRetry(
          () => employeeAClient.database.rpc("employee_apply_leave_request", {
            p_tenant_id: COMPANY_A, p_leave_type_id: LEAVE_TYPE_CL,
            p_start_date: dateOk, p_end_date: dateOk, p_reason: `${TEST_TAG} notice-accept`,
          }),
          "notice boundary: T+2",
        ),
        "notice boundary: T+2 must be accepted",
      );
      leaveNoticeIds.push(accepted);
      console.log(`AC (employee_apply_leave_request, notice): min_notice_days=2, T=${T}. start=T+1=${dateTooSoon} -> rejected "requires at least 2 days notice" (would have been ALLOWED under old CURRENT_DATE=${U} whenever U differs from T in the ahead direction). start=T+2=${dateOk} -> accepted. Boundary tracks T, not U.`);
    } finally {
      runSql(`DELETE FROM public.tenant_settings WHERE tenant_id='${COMPANY_A}'::uuid AND key='leave_min_notice_days'`);
      for (const id of leaveNoticeIds) runSql(`DELETE FROM public.leaves WHERE id='${id}'::uuid`);
      const restored = rowsOf(runSql(
        `SELECT value FROM public.tenant_settings WHERE tenant_id='${COMPANY_A}'::uuid AND key='leave_min_notice_days'`,
      ))[0];
      assert.equal(restored, undefined, "FAILED TO RESTORE leave_min_notice_days after notice test -- fixture left dirty");
    }

    // ==========================================================================================
    // 1b. employee_apply_leave_request -- days-since-joining eligibility uses T, not U.
    // ==========================================================================================
    const priorDoj = rowsOf(runSql(`SELECT date_of_joining FROM public.employees WHERE id='${EMPLOYEE_A.employeeId}'::uuid`))[0]?.date_of_joining;
    assert.equal(priorDoj, null, "fixture precondition failed: employee.a already has a date_of_joining");
    const priorApplicableFromDay = rowsOf(runSql(`SELECT applicable_from_day FROM public.leave_types WHERE id='${LEAVE_TYPE_CL}'::uuid`))[0]?.applicable_from_day;
    assert.equal(Number(priorApplicableFromDay), 0, "fixture precondition failed: CL applicable_from_day already non-zero");
    try {
      runSql(`UPDATE public.leave_types SET applicable_from_day=5 WHERE id='${LEAVE_TYPE_CL}'::uuid`);
      const eligStart = addDays(T, 3); // satisfies the 2-day notice requirement (already restored to 0 by then, harmless either way)

      // date_of_joining = T-4 -> days_since_joining(correct) = 4 < 5 -> must reject on eligibility.
      runSql(`UPDATE public.employees SET date_of_joining='${addDays(T, -4)}'::date WHERE id='${EMPLOYEE_A.employeeId}'::uuid`);
      const rejected = await withFetchRetry(
        () => employeeAClient.database.rpc("employee_apply_leave_request", {
          p_tenant_id: COMPANY_A, p_leave_type_id: LEAVE_TYPE_CL,
          p_start_date: eligStart, p_end_date: eligStart, p_reason: `${TEST_TAG} eligibility-reject`,
        }),
        "eligibility boundary: T-4",
      );
      expectError(rejected, /is only available after 5 days of employment/i, "eligibility boundary: T-4 must be rejected");

      // date_of_joining = T-5 -> days_since_joining(correct) = 5, not < 5 -> must NOT hit the
      // eligibility exception (may still fail later for an unrelated reason, e.g. no working days
      // on eligStart's weekday -- that is not this check's concern).
      runSql(`UPDATE public.employees SET date_of_joining='${addDays(T, -5)}'::date WHERE id='${EMPLOYEE_A.employeeId}'::uuid`);
      const allowed = await withFetchRetry(
        () => employeeAClient.database.rpc("employee_apply_leave_request", {
          p_tenant_id: COMPANY_A, p_leave_type_id: LEAVE_TYPE_CL,
          p_start_date: eligStart, p_end_date: eligStart, p_reason: `${TEST_TAG} eligibility-accept`,
        }),
        "eligibility boundary: T-5",
      );
      if (allowed.error) {
        assert.doesNotMatch(messageOf(allowed.error), /only available after/i, `eligibility boundary: T-5 must not hit the eligibility exception (got: ${messageOf(allowed.error)})`);
      } else {
        eligibilityLeaveIds.push(allowed.data);
      }
      console.log(`AC (employee_apply_leave_request, eligibility): applicable_from_day=5, T=${T}. date_of_joining=T-4=${addDays(T, -4)} -> rejected "only available after 5 days" (would have been ALLOWED under old CURRENT_DATE in the other zone direction). date_of_joining=T-5=${addDays(T, -5)} -> eligibility check passed (${allowed.error ? `later rejection unrelated: ${messageOf(allowed.error)}` : "leave created"}). Boundary tracks T, not U.`);
    } finally {
      runSql(`UPDATE public.leave_types SET applicable_from_day=0 WHERE id='${LEAVE_TYPE_CL}'::uuid`);
      runSql(`UPDATE public.employees SET date_of_joining=NULL WHERE id='${EMPLOYEE_A.employeeId}'::uuid`);
      for (const id of eligibilityLeaveIds) runSql(`DELETE FROM public.leaves WHERE id='${id}'::uuid`);
      const restoredDoj = rowsOf(runSql(`SELECT date_of_joining FROM public.employees WHERE id='${EMPLOYEE_A.employeeId}'::uuid`))[0]?.date_of_joining;
      const restoredAfd = rowsOf(runSql(`SELECT applicable_from_day FROM public.leave_types WHERE id='${LEAVE_TYPE_CL}'::uuid`))[0]?.applicable_from_day;
      assert.equal(restoredDoj, null, "FAILED TO RESTORE employee.a date_of_joining -- fixture left dirty");
      assert.equal(Number(restoredAfd), 0, "FAILED TO RESTORE CL applicable_from_day -- fixture left dirty");
    }

    // ==========================================================================================
    // 2. hr_schedule_shift_change -- default "tomorrow" and the future-effective guard use T.
    // ==========================================================================================
    try {
      disposableOrgUnitId = null; // shift test does not need an org unit
      disposableShiftId = "a0000000-0000-4000-8c20-000000000001";
      disposableEmployeeId = "a0000000-0000-4000-8c20-000000000002";
      runSql(`
        INSERT INTO public.shifts (id, tenant_id, name, start_time, end_time)
        VALUES ('${disposableShiftId}'::uuid, '${COMPANY_A}'::uuid, '${TEST_TAG} shift', '09:00', '18:00');
        INSERT INTO public.employees (id, tenant_id, full_name, email, work_mode, status)
        VALUES ('${disposableEmployeeId}'::uuid, '${COMPANY_A}'::uuid, '${TEST_TAG} throwaway', 'c2-throwaway-shift@m1m2.test', 'office', 'active');
      `.trim());

      // Guard: scheduling effective exactly "today" per tenant reckoning must be rejected.
      const guardResult = await withFetchRetry(
        () => hrClient.database.rpc("hr_schedule_shift_change", {
          p_tenant_id: COMPANY_A, p_employee_id: disposableEmployeeId, p_shift_id: disposableShiftId, p_effective_from: T,
        }),
        "hr_schedule_shift_change guard at T",
      );
      expectError(guardResult, /must be effective in the future/i, "hr_schedule_shift_change guard at T");

      // Default: omitting p_effective_from must resolve to T+1, not U+1.
      const defaultResult = noError(
        await withFetchRetry(
          () => hrClient.database.rpc("hr_schedule_shift_change", {
            p_tenant_id: COMPANY_A, p_employee_id: disposableEmployeeId, p_shift_id: disposableShiftId, p_effective_from: null,
          }),
          "hr_schedule_shift_change default effective_from",
        ),
        "hr_schedule_shift_change default effective_from",
      );
      const created = rowsOf(runSql(`SELECT effective_from FROM public.employee_shifts WHERE id='${defaultResult}'::uuid`))[0];
      const expectedDefault = addDays(T, 1);
      const buggyDefault = addDays(U, 1);
      assert.equal(String(created.effective_from).slice(0, 10), expectedDefault,
        `default effective_from must be T+1=${expectedDefault}, not U+1=${buggyDefault} (got ${created.effective_from})`);
      console.log(`AC (hr_schedule_shift_change): T=${T}, U=${U}. p_effective_from=T=${T} -> rejected "must be effective in the future". Omitted p_effective_from -> resolved to T+1=${expectedDefault} (old CURRENT_DATE-based code would have used U+1=${buggyDefault}).`);
    } finally {
      runSql(`
        DELETE FROM public.audit_logs WHERE target_type='employee_shifts' AND details->>'employee_id'='${disposableEmployeeId}';
        DELETE FROM public.employee_shifts WHERE employee_id='${disposableEmployeeId}'::uuid;
        DELETE FROM public.employee_unit_assignments WHERE employee_id='${disposableEmployeeId}'::uuid;
        DELETE FROM public.employees WHERE id='${disposableEmployeeId}'::uuid;
        DELETE FROM public.shifts WHERE id='${disposableShiftId}'::uuid;
      `.trim());
      const gone = rowsOf(runSql(`SELECT id FROM public.employees WHERE id='${disposableEmployeeId}'::uuid`));
      assert.equal(gone.length, 0, "FAILED TO REMOVE throwaway employee after hr_schedule_shift_change test");
    }

    // ==========================================================================================
    // 3 + 4. create_employee_transaction + open_initial_unit_assignment trigger -- both source
    // their fallback effective_from from T when p_date_of_joining/date_of_joining is NULL.
    // ==========================================================================================
    let newEmpId = null;
    try {
      disposableOrgUnitId = "a0000000-0000-4000-8c20-000000000003";
      runSql(`INSERT INTO public.org_units (id, tenant_id, name) VALUES ('${disposableOrgUnitId}'::uuid, '${COMPANY_A}'::uuid, '${TEST_TAG} unit')`);

      const beforeCall = rowsOf(runSql(`SELECT public.tenant_business_date('${COMPANY_A}'::uuid, now()) AS d`))[0].d;
      const T2 = String(beforeCall).slice(0, 10);
      const NEW_HIRE_EMAIL = "c2-throwaway-newhire@m1m2.test";

      const createResult = await withFetchRetry(
        () => hrClient.database.rpc("create_employee_transaction", {
          p_user_id: null, p_full_name: `${TEST_TAG} new hire`, p_email: NEW_HIRE_EMAIL,
          p_phone: null, p_date_of_birth: null, p_gender: null, p_address: null, p_city: null, p_state: null, p_pincode: null,
          p_department: null, p_org_unit_id: disposableOrgUnitId, p_designation: null, p_job_title_id: null,
          p_employee_code: null, p_date_of_joining: null, p_employment_type: null, p_employment_type_id: null,
          p_aadhaar_number: null, p_pan_number: null, p_bank_name: null, p_account_number: null, p_ifsc_code: null,
          p_emergency_contact_name: null, p_emergency_contact_phone: null, p_emergency_contact_relation: null,
          p_work_mode: "office", p_grade: null, p_work_location: null, p_location_id: null,
          p_manager_id: HR_EMPLOYEE_A.employeeId, p_secondary_manager_id: null, p_probation_period: null,
        }),
        "create_employee_transaction",
      );
      if (createResult.error && /already registered/i.test(messageOf(createResult.error))) {
        // withFetchRetry's retry can land here only if the FIRST attempt actually committed on the
        // server but the response was lost to the same transient network failure -- the row exists,
        // just not the id we would have gotten back. Recover it by the email we just used instead
        // of treating this as a real duplicate-email business error.
        console.log("create_employee_transaction: retry hit 'already registered' -- recovering the id the first (server-committed, response-lost) attempt created.");
        newEmpId = rowsOf(runSql(`SELECT id FROM public.employees WHERE tenant_id='${COMPANY_A}'::uuid AND lower(email)=lower('${NEW_HIRE_EMAIL}')`))[0]?.id;
      } else {
        newEmpId = noError(createResult, "create_employee_transaction");
      }
      assert.ok(newEmpId, "create_employee_transaction did not return a new id");

      const reportingRow = rowsOf(runSql(
        `SELECT effective_from FROM public.employee_reporting_relationships WHERE employee_id='${newEmpId}'::uuid AND relationship_type='primary'`,
      ))[0];
      assert.ok(reportingRow, "no primary employee_reporting_relationships row created");
      assert.equal(String(reportingRow.effective_from).slice(0, 10), T2,
        `create_employee_transaction: reporting relationship effective_from must be T=${T2} (fallback when p_date_of_joining is NULL), got ${reportingRow.effective_from}`);

      const unitRow = rowsOf(runSql(
        `SELECT effective_from FROM public.employee_unit_assignments WHERE employee_id='${newEmpId}'::uuid`,
      ))[0];
      assert.ok(unitRow, "open_initial_unit_assignment trigger did not fire (no employee_unit_assignments row)");
      assert.equal(String(unitRow.effective_from).slice(0, 10), T2,
        `open_initial_unit_assignment: effective_from must be T=${T2} (date_of_joining NULL), got ${unitRow.effective_from}`);

      console.log(`AC (create_employee_transaction + open_initial_unit_assignment): T=${T2}, U=${U}. New employee with p_date_of_joining=NULL -> employee_reporting_relationships.effective_from=${reportingRow.effective_from}, employee_unit_assignments.effective_from=${unitRow.effective_from} -- both equal T, not U (old CURRENT_DATE-based code would have used U in the direction where U != T).`);
    } finally {
      if (newEmpId) {
        runSql(`
          DELETE FROM public.audit_logs WHERE target_type='employees' AND target_id='${newEmpId}'::uuid;
          DELETE FROM public.employee_reporting_relationships WHERE employee_id='${newEmpId}'::uuid;
          DELETE FROM public.employee_unit_assignments WHERE employee_id='${newEmpId}'::uuid;
          DELETE FROM public.employee_onboarding_self WHERE employee_id='${newEmpId}'::uuid;
          DELETE FROM public.leave_balances WHERE employee_id='${newEmpId}'::uuid;
          DELETE FROM public.employees WHERE id='${newEmpId}'::uuid;
        `.trim());
      }
      if (disposableOrgUnitId) runSql(`DELETE FROM public.org_units WHERE id='${disposableOrgUnitId}'::uuid`);
      if (newEmpId) {
        const gone = rowsOf(runSql(`SELECT id FROM public.employees WHERE id='${newEmpId}'::uuid`));
        assert.equal(gone.length, 0, "FAILED TO REMOVE throwaway new-hire employee");
      }
    }

    // ==========================================================================================
    // 5. attendance_evaluate_location -- p_business_date fallback uses T, not U.
    // ==========================================================================================
    const geofenceSettingKeys = ["geofence_enabled", "remote_work_handling", "gps_verification_mode"];
    for (const key of geofenceSettingKeys) {
      const existing = rowsOf(runSql(`SELECT 1 FROM public.tenant_settings WHERE tenant_id='${COMPANY_A}'::uuid AND key='${key}'`));
      assert.equal(existing.length, 0, `fixture precondition failed: tenant_settings.${key} already set for Company A`);
    }
    const exceptionId = "a0000000-0000-4000-8c20-000000000004";
    try {
      runSql(`
        INSERT INTO public.tenant_settings (id, tenant_id, key, value) VALUES
          (gen_random_uuid(), '${COMPANY_A}'::uuid, 'geofence_enabled', 'true'),
          (gen_random_uuid(), '${COMPANY_A}'::uuid, 'remote_work_handling', 'hr_approved_exceptions'),
          (gen_random_uuid(), '${COMPANY_A}'::uuid, 'gps_verification_mode', 'warn');
        INSERT INTO public.attendance_location_exceptions (id, tenant_id, employee_id, exception_type, start_date, end_date, reason, status)
        VALUES ('${exceptionId}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, 'work_from_home', '${U}'::date, '${U}'::date, '${TEST_TAG}', 'approved');
      `.trim());

      // Exception is dated U (not T): with the fallback using T, this must NOT match.
      // (attendance_evaluate_location is STABLE / read-only -- no side effects, safe to retry.)
      const notMatched = noError(
        await withFetchRetry(
          () => employeeAClient.database.rpc("attendance_evaluate_location", {
            p_tenant_id: COMPANY_A, p_employee_id: EMPLOYEE_A.employeeId, p_lat: null, p_lng: null, p_accuracy: null, p_business_date: null,
          }),
          "attendance_evaluate_location (exception dated U, fallback should use T)",
        ),
        "attendance_evaluate_location (exception dated U, fallback should use T)",
      );
      assert.notEqual(notMatched[0].loc_status, "remote_approved", `exception dated U=${U} must not match when fallback uses T=${T}, got ${notMatched[0].loc_status}`);

      runSql(`UPDATE public.attendance_location_exceptions SET start_date='${T}'::date, end_date='${T}'::date WHERE id='${exceptionId}'::uuid`);
      const matched = noError(
        await withFetchRetry(
          () => employeeAClient.database.rpc("attendance_evaluate_location", {
            p_tenant_id: COMPANY_A, p_employee_id: EMPLOYEE_A.employeeId, p_lat: null, p_lng: null, p_accuracy: null, p_business_date: null,
          }),
          "attendance_evaluate_location (exception dated T, fallback should use T)",
        ),
        "attendance_evaluate_location (exception dated T, fallback should use T)",
      );
      assert.equal(matched[0].loc_status, "remote_approved", `exception dated T=${T} must match the fallback, got ${matched[0].loc_status}`);
      assert.equal(matched[0].remote_exception_id, exceptionId);
      console.log(`AC (attendance_evaluate_location): T=${T}, U=${U}. Approved exception dated U -> fallback (using T) does not match, loc_status=${notMatched[0].loc_status}. Same exception redated to T -> fallback matches, loc_status=remote_approved. Fallback tracks T, not U.`);
    } finally {
      runSql(`DELETE FROM public.attendance_location_exceptions WHERE id='${exceptionId}'::uuid`);
      for (const key of geofenceSettingKeys) runSql(`DELETE FROM public.tenant_settings WHERE tenant_id='${COMPANY_A}'::uuid AND key='${key}'`);
      for (const key of geofenceSettingKeys) {
        const gone = rowsOf(runSql(`SELECT 1 FROM public.tenant_settings WHERE tenant_id='${COMPANY_A}'::uuid AND key='${key}'`));
        assert.equal(gone.length, 0, `FAILED TO RESTORE tenant_settings.${key} after attendance_evaluate_location test`);
      }
    }

    // ==========================================================================================
    // 6. expire_location_exceptions -- per-row tenant business date, sign-agnostic pair.
    //    Invoked exactly as its only realistic caller would (project_admin via `db query`, no
    //    JWT): measured live that this makes auth.uid() IS NULL, which is tenant_business_date's
    //    documented service-context escape -- so it resolves a real date for every tenant
    //    regardless of who can access what, never the NULL-for-a-foreign-tenant case the advisor
    //    flagged for an authenticated caller. Confirmed here again, not just asserted.
    // ==========================================================================================
    const authCtx = rowsOf(runSql(`SELECT auth.uid() AS uid`))[0];
    assert.equal(authCtx.uid, null, "expire_location_exceptions/fn_accrue_monthly_leaves precondition: db-query auth.uid() must be NULL");
    const expiresRowId = "a0000000-0000-4000-8c20-000000000005";
    const staysApprovedRowId = "a0000000-0000-4000-8c20-000000000006";
    try {
      runSql(`
        INSERT INTO public.attendance_location_exceptions (id, tenant_id, employee_id, exception_type, start_date, end_date, reason, status) VALUES
          ('${expiresRowId}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, 'other', '${addDays(T, -10)}'::date, '${addDays(T, -1)}'::date, '${TEST_TAG} expires', 'approved'),
          ('${staysApprovedRowId}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, 'other', '${T}'::date, '${T}'::date, '${TEST_TAG} stays', 'approved');
      `.trim());

      runSql(`SELECT public.expire_location_exceptions()`);

      const expiresRow = rowsOf(runSql(`SELECT status FROM public.attendance_location_exceptions WHERE id='${expiresRowId}'::uuid`))[0];
      const staysRow = rowsOf(runSql(`SELECT status FROM public.attendance_location_exceptions WHERE id='${staysApprovedRowId}'::uuid`))[0];
      assert.equal(expiresRow.status, "expired", `end_date=T-1=${addDays(T, -1)} must expire (T-1 < T is always true)`);
      assert.equal(staysRow.status, "approved", `end_date=T=${T} must NOT expire (T < T is always false)`);
      console.log(`AC (expire_location_exceptions): T=${T}, U=${U}. Row with end_date=T-1=${addDays(T, -1)} -> expired. Row with end_date=T=${T} -> stays approved. (Old server-UTC code compared against U=${U} instead -- at least one of these two rows would have gotten the opposite verdict whenever T != U, which we already confirmed above.)`);
    } finally {
      runSql(`DELETE FROM public.attendance_location_exceptions WHERE id IN ('${expiresRowId}'::uuid,'${staysApprovedRowId}'::uuid)`);
    }

    // ==========================================================================================
    // 7. fn_accrue_monthly_leaves -- per-row tenant business date across TWO tenants at once.
    //    Company A stays on zoneForA; Company B is temporarily set to whichever of ZONE_PLUS/
    //    ZONE_MINUS was NOT used for A, guaranteeing (proved in the file header) that the two
    //    tenants' business dates differ from each other, regardless of the real wall-clock time.
    // ==========================================================================================
    const zoneForB = zoneForA === ZONE_PLUS ? ZONE_MINUS : ZONE_PLUS;
    const priorTzB = rowsOf(runSql(`SELECT timezone FROM public.tenants WHERE id='${COMPANY_B}'::uuid`))[0]?.timezone;
    assert.ok(priorTzB, "Company B has no timezone set");
    const disposableLeaveTypeA = "a0000000-0000-4000-8c20-000000000007";
    const disposableLeaveTypeB = "b0000000-0000-4000-8c20-000000000008";
    const balanceA = "a0000000-0000-4000-8c20-000000000009";
    const balanceB = "b0000000-0000-4000-8c20-000000000010";
    const EMPLOYEE_B_ID = "b0000000-0000-4000-8001-000000000002";
    try {
      runSql(`UPDATE public.tenants SET timezone='${zoneForB}' WHERE id='${COMPANY_B}'::uuid`);
      const tA = String(rowsOf(runSql(`SELECT public.tenant_business_date('${COMPANY_A}'::uuid, now()) AS d`))[0].d).slice(0, 10);
      const tB = String(rowsOf(runSql(`SELECT public.tenant_business_date('${COMPANY_B}'::uuid, now()) AS d`))[0].d).slice(0, 10);
      assert.notEqual(tA, tB, `fixture failed: tenant_business_date(A)=${tA} must differ from tenant_business_date(B)=${tB}`);

      runSql(`
        INSERT INTO public.leave_types (id, tenant_id, code, name, days_per_year, accrual_type, is_active)
        VALUES ('${disposableLeaveTypeA}'::uuid, '${COMPANY_A}'::uuid, 'C2ACC', '${TEST_TAG} monthly', 12, 'monthly', true);
        INSERT INTO public.leave_types (id, tenant_id, code, name, days_per_year, accrual_type, is_active)
        VALUES ('${disposableLeaveTypeB}'::uuid, '${COMPANY_B}'::uuid, 'C2ACC', '${TEST_TAG} monthly', 12, 'monthly', true);
        INSERT INTO public.leave_balances (id, tenant_id, employee_id, leave_type_id, year, total_allocated, used_days, carried_forward, balance, last_accrual_date, updated_at)
        VALUES ('${balanceA}'::uuid, '${COMPANY_A}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, '${disposableLeaveTypeA}'::uuid, EXTRACT(YEAR FROM '${tA}'::date)::integer, 12, 0, 0, 0, ('${tA}'::date - interval '40 days')::date, now());
        INSERT INTO public.leave_balances (id, tenant_id, employee_id, leave_type_id, year, total_allocated, used_days, carried_forward, balance, last_accrual_date, updated_at)
        VALUES ('${balanceB}'::uuid, '${COMPANY_B}'::uuid, '${EMPLOYEE_B_ID}'::uuid, '${disposableLeaveTypeB}'::uuid, EXTRACT(YEAR FROM '${tB}'::date)::integer, 12, 0, 0, 0, ('${tB}'::date - interval '40 days')::date, now());
      `.trim());

      runSql(`SELECT public.fn_accrue_monthly_leaves()`);

      const rowA = rowsOf(runSql(`SELECT last_accrual_date, balance FROM public.leave_balances WHERE id='${balanceA}'::uuid`))[0];
      const rowB = rowsOf(runSql(`SELECT last_accrual_date, balance FROM public.leave_balances WHERE id='${balanceB}'::uuid`))[0];
      assert.equal(String(rowA.last_accrual_date).slice(0, 10), tA, `Company A's row must accrue to its OWN tenant date ${tA}, got ${rowA.last_accrual_date}`);
      assert.equal(String(rowB.last_accrual_date).slice(0, 10), tB, `Company B's row must accrue to its OWN tenant date ${tB}, got ${rowB.last_accrual_date}`);
      assert.notEqual(String(rowA.last_accrual_date).slice(0, 10), String(rowB.last_accrual_date).slice(0, 10),
        "the two tenants' accrual dates must differ -- if they matched, the job used one shared server date instead of a per-row tenant date");
      assert.equal(Number(rowA.balance), 1, `Company A balance should be 12/12=1.0, got ${rowA.balance}`);
      assert.equal(Number(rowB.balance), 1, `Company B balance should be 12/12=1.0, got ${rowB.balance}`);
      console.log(`AC (fn_accrue_monthly_leaves): Company A (tz=${zoneForA}) tenant_business_date=${tA}, Company B (tz=${zoneForB}) tenant_business_date=${tB} (necessarily different, 25h apart). After running fn_accrue_monthly_leaves(): A.last_accrual_date=${rowA.last_accrual_date}, B.last_accrual_date=${rowB.last_accrual_date} -- each equals its OWN tenant's business date, not one shared server date. Both balances accrued 1.0 (12/12 months).`);
    } finally {
      runSql(`
        DELETE FROM public.leave_balances WHERE id IN ('${balanceA}'::uuid,'${balanceB}'::uuid);
        DELETE FROM public.leave_types WHERE id IN ('${disposableLeaveTypeA}'::uuid,'${disposableLeaveTypeB}'::uuid);
      `.trim());
      runSql(`UPDATE public.tenants SET timezone='${priorTzB}' WHERE id='${COMPANY_B}'::uuid`);
      const restoredTzB = rowsOf(runSql(`SELECT timezone FROM public.tenants WHERE id='${COMPANY_B}'::uuid`))[0]?.timezone;
      assert.equal(restoredTzB, priorTzB, "FAILED TO RESTORE Company B timezone after fn_accrue_monthly_leaves test");
    }
  } finally {
    runSql(`UPDATE public.tenants SET timezone='${priorTzA}' WHERE id='${COMPANY_A}'::uuid`);
    const restoredTzA = rowsOf(runSql(`SELECT timezone FROM public.tenants WHERE id='${COMPANY_A}'::uuid`))[0]?.timezone;
    assert.equal(restoredTzA, priorTzA, "FAILED TO RESTORE Company A timezone -- fixture left dirty");
  }

  // ==========================================================================================
  // RLS invariant 1/2/0 unaffected by this migration (no table policy touched).
  // ==========================================================================================
  const employeeBClient = await signIn({ email: "employee.b@m1m2.test", userId: "b0000000-0000-4000-8001-000000000001" }, anonKey);
  const hrRls = await withFetchRetry(() => hrClient.database.from("employees").select("id").eq("tenant_id", COMPANY_A), "RLS invariant (hr-employee.a)");
  const empRls = await withFetchRetry(() => employeeAClient.database.from("employees").select("id").eq("tenant_id", COMPANY_A), "RLS invariant (employee.a)");
  const empBRls = await withFetchRetry(() => employeeBClient.database.from("employees").select("id").eq("tenant_id", COMPANY_A), "RLS invariant (employee.b)");
  assert.equal(hrRls.error, null, `RLS invariant (hr-employee.a): ${messageOf(hrRls.error)}`);
  assert.equal(empRls.error, null, `RLS invariant (employee.a): ${messageOf(empRls.error)}`);
  assert.equal(empBRls.error, null, `RLS invariant (employee.b): ${messageOf(empBRls.error)}`);
  assert.equal(empRls.data.length, 1, "RLS invariant: employee.a should see exactly 1 row");
  assert.equal(hrRls.data.length, 2, "RLS invariant: hr-employee.a should see exactly 2 rows");
  assert.equal(empBRls.data.length, 0, "RLS invariant: employee.b should see 0 rows in Company A");
  console.log(`RLS invariant unchanged: employee.a=${empRls.data.length}, hr-employee.a=${hrRls.data.length}, employee.b=${empBRls.data.length} (expected 1/2/0).`);

  console.log("C2 business date everywhere: sweep, signature guard, and all 7 changed functions verified to use tenant_business_date instead of server-UTC CURRENT_DATE; RLS invariant unchanged.");
});
