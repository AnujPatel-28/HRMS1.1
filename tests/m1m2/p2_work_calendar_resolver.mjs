#!/usr/bin/env node
// P2-01 shared work-calendar resolver: acceptance evidence for
// migrations/20260912182000_m1m2-shared-work-calendar-resolver.sql.
//
// Enumerated callers of the three primitives (found by grepping repo SQL/TS and, for DB
// functions, searching every public.pg_proc body for the three names):
//   DB:       attendance_derive_pass1, attendance_derive_pass2 (work_calendar_holiday)
//             attendance_run_scheduled_derivation (tenant_business_date)
//             payroll_period_input (work_calendar_working_days) -- exercised live below (AC5)
//   Frontend: src/employee/PunchInOut.tsx -- calls tenant_business_date(p_tenant_id) with no
//             p_instant/second arg, exactly reproduced below (AC5)
//   Comment-only (no call): src/payroll/hr/payroll-calc.ts references work_calendar_working_days
//             in a comment; the actual call is server-side via payroll_period_input.
// attendance_derive_pass1/pass2/attendance_run_scheduled_derivation are NOT executed here: the
// branch's attendance-derivation-hourly schedule is deliberately deactivated (see migration
// header / brief S5) and running them would mutate attendance_events/attendance state outside
// this package's allowed files. Their compatibility is instead proven structurally: the
// migration is a body-only CREATE OR REPLACE on tenant_business_date's exact existing
// (uuid, timestamptz) signature (verified post-migration below, AC6/AC5) and
// work_calendar_holiday/work_calendar_working_days were not modified at all.
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
const EMPLOYEE_A = { email: "employee.a@m1m2.test", userId: "a0000000-0000-4000-8001-000000000001" };
const HR_EMPLOYEE_A = { email: "hr-employee.a@m1m2.test", userId: "a0000000-0000-4000-8002-000000000001" };
const EMPLOYEE_B = { email: "employee.b@m1m2.test", userId: "b0000000-0000-4000-8001-000000000001" };

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

/**
 * The SDK's underlying HTTP client occasionally drops a long-idle keep-alive connection with a
 * bare "fetch failed" after this suite's CLI-heavy sections (the DST loop alone makes ~25
 * sequential `insforge db query` subprocess calls). Not a resolver defect -- retried once.
 */
async function withFetchRetry(makeCall, label) {
  const first = await makeCall();
  if (!first.error || !/fetch failed/i.test(messageOf(first.error))) return first;
  console.log(`${label}: transient fetch failure, retrying once`);
  return makeCall();
}

/** Independent oracle for local calendar date: Node's own tz database, not Postgres's. */
function localDateInZone(isoInstant, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date(isoInstant));
}

async function rlsInvariant(clients) {
  const counts = {};
  for (const [label, client] of Object.entries(clients)) {
    const { data, error } = await withFetchRetry(
      () => client.database.from("employees").select("id").eq("tenant_id", COMPANY_A),
      `AC7 RLS invariant (${label})`,
    );
    assert.equal(error, null, `${label}: ${messageOf(error)}`);
    counts[label] = data.length;
  }
  return counts;
}

await guardedMutation("P2-01 work calendar resolver", async () => {
  const anonKey = readBranchAnonKey();
  const employeeAClient = await signIn(EMPLOYEE_A, anonKey);
  const hrClient = await signIn(HR_EMPLOYEE_A, anonKey);
  const employeeBClient = await signIn(EMPLOYEE_B, anonKey);
  const employeeAId = rowsOf(runSql(
    `SELECT id FROM public.employees WHERE tenant_id='${COMPANY_A}'::uuid AND user_id='${EMPLOYEE_A.userId}'::uuid`,
  ))[0]?.id;
  assert.ok(employeeAId, "employee.a employee row not found");

  // ==========================================================================================
  // AC — signature/ACL guard: exactly one function per name, unchanged signature, no anon EXECUTE.
  // This is the direct evidence that the migration did NOT create a second (overloaded)
  // tenant_business_date -- see the migration header for why that was the real risk here.
  // ==========================================================================================
  const catalog = rowsOf(runSql(`
    SELECT p.proname, count(*) AS cnt,
           array_agg(pg_get_function_identity_arguments(p.oid) ORDER BY p.oid) AS sigs,
           array_agg(p.proacl::text ORDER BY p.oid) AS acls,
           bool_and(p.prosecdef) AS all_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('tenant_business_date','work_calendar_holiday','work_calendar_working_days')
    GROUP BY p.proname
  `.trim()));
  assert.equal(catalog.length, 3, "expected exactly tenant_business_date/work_calendar_holiday/work_calendar_working_days");
  for (const row of catalog) {
    assert.equal(Number(row.cnt), 1, `${row.proname}: expected exactly one overload, found ${row.cnt} (${row.sigs})`);
    assert.equal(row.all_definer, true, `${row.proname}: must be SECURITY DEFINER`);
    for (const acl of row.acls) assert.doesNotMatch(acl, /anon=/, `${row.proname}: anon must not hold EXECUTE`);
  }
  const bdSig = catalog.find((r) => r.proname === "tenant_business_date").sigs[0];
  assert.equal(bdSig, "p_tenant_id uuid, p_instant timestamp with time zone", "tenant_business_date signature changed");
  console.log(`AC5/AC6 signature guard: ${catalog.map((r) => `${r.proname}(${r.sigs[0]})`).join("; ")} -- exactly one overload each, no anon EXECUTE.`);

  const searchPaths = rowsOf(runSql(`
    SELECT p.proname, p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('tenant_business_date','work_calendar_holiday','work_calendar_working_days')
  `.trim()));
  for (const row of searchPaths) {
    assert.ok(
      (row.proconfig ?? []).some((c) => c === "search_path=" || c.startsWith("search_path=")),
      `${row.proname}: search_path not pinned (${JSON.stringify(row.proconfig)})`,
    );
  }
  console.log("AC6 search_path guard: all three carry a pinned search_path.");

  // Anon: no EXECUTE on any of the three (unauthenticated client, no sign-in).
  const anonOnly = createClient({ baseUrl: TB_M1M2.baseUrl, anonKey });
  const anonDate = await anonOnly.database.rpc("tenant_business_date", { p_tenant_id: COMPANY_A });
  assert.equal(anonDate.error?.code, "42501", `anon tenant_business_date: expected 42501, got ${messageOf(anonDate.error)}`);
  const anonHoliday = await anonOnly.database.rpc("work_calendar_holiday", {
    p_tenant_id: COMPANY_A, p_employee_id: employeeAId, p_date: "2026-01-01",
  });
  assert.equal(anonHoliday.error?.code, "42501", `anon work_calendar_holiday: expected 42501, got ${messageOf(anonHoliday.error)}`);
  const anonDays = await anonOnly.database.rpc("work_calendar_working_days", {
    p_tenant_id: COMPANY_A, p_employee_id: employeeAId, p_start: "2026-01-01", p_end: "2026-01-07",
  });
  assert.equal(anonDays.error?.code, "42501", `anon work_calendar_working_days: expected 42501, got ${messageOf(anonDays.error)}`);
  console.log("AC6 anon denial: tenant_business_date/work_calendar_holiday/work_calendar_working_days all 42501 for an anon caller.");

  // Cross-tenant: employee.b (Company B) asking about Company A's tenant_id gets NULL, not an error
  // and not another tenant's data -- the fence fails closed rather than throwing.
  const crossTenantDate = noError(
    await employeeBClient.database.rpc("tenant_business_date", { p_tenant_id: COMPANY_A }),
    "employee.b cross-tenant tenant_business_date",
  );
  assert.equal(crossTenantDate, null, "cross-tenant tenant_business_date must resolve NULL, not another tenant's date");
  const crossTenantDays = noError(
    await employeeBClient.database.rpc("work_calendar_working_days", {
      p_tenant_id: COMPANY_A, p_employee_id: employeeAId, p_start: "2026-01-01", p_end: "2026-01-07",
    }),
    "employee.b cross-tenant work_calendar_working_days",
  );
  assert.equal(crossTenantDays, null, "cross-tenant work_calendar_working_days must resolve NULL");
  console.log("Cross-tenant fence: employee.b querying Company A's tenant_id resolves NULL on both functions, not an error and not real data.");

  // ==========================================================================================
  // AC1 -- Leave-only tenant (Attendance disabled) resolves a correct business date, and the
  // day-counting primitive P2-04/payroll will consume (work_calendar_working_days) works too.
  // Pre-migration evidence (captured before this migration was applied, same shape as below):
  //   tenant_business_date(Company A, now())          -> {"data":null,"error":null}   (BUG)
  //   work_calendar_working_days(...Sep 14-20 2026...) -> {"data":6,"error":null}      (already fine)
  //   work_calendar_holiday(...Sep 14 2026...)         -> source:"none", is_holiday:false (already fine)
  // ==========================================================================================
  const beforeModules = rowsOf(runSql(
    `SELECT module_key, enabled FROM public.tenant_modules WHERE tenant_id='${COMPANY_A}'::uuid AND module_key IN ('attendance','leave') ORDER BY module_key`,
  ));
  const attendanceWasEnabled = beforeModules.find((r) => r.module_key === "attendance")?.enabled;
  assert.equal(attendanceWasEnabled, true, "expected Company A to start with attendance enabled");

  let ac1;
  try {
    runSql(`UPDATE public.tenant_modules SET enabled=false WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='attendance'`);

    const businessDate = noError(
      await employeeAClient.database.rpc("tenant_business_date", { p_tenant_id: COMPANY_A }),
      "AC1 tenant_business_date (attendance disabled)",
    );
    assert.notEqual(businessDate, null, "AC1 FAILED: tenant_business_date still NULL with Attendance disabled");
    assert.match(businessDate, /^\d{4}-\d{2}-\d{2}$/, "AC1: business date is not a date string");

    const workingDays = noError(
      await employeeAClient.database.rpc("work_calendar_working_days", {
        p_tenant_id: COMPANY_A, p_employee_id: employeeAId, p_start: "2026-09-14", p_end: "2026-09-20",
      }),
      "AC1 work_calendar_working_days (attendance disabled)",
    );
    assert.equal(workingDays, 6, "AC1: expected 6 default working days (Mon-Sat) for Sep 14-20 2026 with no shift assignment");

    const holiday = noError(
      await employeeAClient.database.rpc("work_calendar_holiday", {
        p_tenant_id: COMPANY_A, p_employee_id: employeeAId, p_date: "2026-09-14",
      }),
      "AC1 work_calendar_holiday (attendance disabled)",
    );
    assert.equal(holiday[0].is_holiday, false);
    assert.equal(holiday[0].source, "none");

    ac1 = { businessDate, workingDays, holidaySource: holiday[0].source };
  } finally {
    runSql(`UPDATE public.tenant_modules SET enabled=true WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='attendance'`);
    const restored = rowsOf(runSql(
      `SELECT enabled FROM public.tenant_modules WHERE tenant_id='${COMPANY_A}'::uuid AND module_key='attendance'`,
    ))[0]?.enabled;
    assert.equal(restored, true, "FAILED TO RESTORE Company A attendance module after AC1 -- fixture left dirty");
  }
  console.log(`AC1 (Leave-only / Attendance disabled): tenant_business_date=${ac1.businessDate} (was NULL pre-fix); work_calendar_working_days=${ac1.workingDays}; work_calendar_holiday.source=${ac1.holidaySource}.`);

  // ==========================================================================================
  // AC2 -- module gating is consistent across the set: none of the three read tenant_modules /
  // call tenant_has_module_for at all (structural guard against the gate silently coming back).
  // ==========================================================================================
  const bodies = rowsOf(runSql(`
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('tenant_business_date','work_calendar_holiday','work_calendar_working_days')
  `.trim()));
  for (const row of bodies) {
    assert.doesNotMatch(row.def, /tenant_has_module_for|tenant_modules/, `${row.proname}: must not reference module entitlement`);
  }
  console.log("AC2: none of the three functions reference tenant_has_module_for/tenant_modules -- module gating is consistently absent, by design (infrastructure), across the whole set.");

  // ==========================================================================================
  // AC3 -- all three holiday tiers resolve, precedence documented and tested, including a date
  // where all three tiers disagree. Fixture: dedicated throwaway shift+calendar, only touching
  // employee.a and rows this test creates itself; torn down in `finally`.
  // ==========================================================================================
  const SHIFT_ID = "a0000000-0000-4000-80f1-000000000001";
  const CAL_SHIFT_ID = "a0000000-0000-4000-80f2-000000000001";
  const CAL_EMP_ID = "a0000000-0000-4000-80f2-000000000002";
  const ES_ID = "a0000000-0000-4000-80f3-000000000001";
  const D_ALL_DISAGREE = "2026-10-05"; // shift, employee and tenant-default all have a row
  const D_EMPLOYEE_VS_TENANT = "2026-10-06"; // employee calendar vs tenant default disagree
  const D_TENANT_ONLY = "2026-10-07"; // only the tenant-default table has a row
  const D_NONE = "2026-10-08"; // nothing anywhere

  const priorEmployeeCalendar = rowsOf(runSql(
    `SELECT holiday_calendar_id FROM public.employees WHERE id='${employeeAId}'::uuid`,
  ))[0]?.holiday_calendar_id ?? null;

  try {
    runSql(`
      DELETE FROM public.employee_shifts WHERE id='${ES_ID}'::uuid;
      DELETE FROM public.holiday_calendar_days WHERE calendar_id IN ('${CAL_SHIFT_ID}'::uuid,'${CAL_EMP_ID}'::uuid);
      DELETE FROM public.shifts WHERE id='${SHIFT_ID}'::uuid;
      DELETE FROM public.holiday_calendars WHERE id IN ('${CAL_SHIFT_ID}'::uuid,'${CAL_EMP_ID}'::uuid);
      DELETE FROM public.holidays WHERE tenant_id='${COMPANY_A}'::uuid AND date IN ('${D_ALL_DISAGREE}'::date,'${D_EMPLOYEE_VS_TENANT}'::date,'${D_TENANT_ONLY}'::date);
    `.trim());

    runSql(`
      INSERT INTO public.holiday_calendars (id, tenant_id, name, is_default) VALUES
        ('${CAL_SHIFT_ID}'::uuid, '${COMPANY_A}'::uuid, 'P2-01 test: shift calendar', false),
        ('${CAL_EMP_ID}'::uuid, '${COMPANY_A}'::uuid, 'P2-01 test: employee calendar', false);
      INSERT INTO public.holiday_calendar_days (id, tenant_id, calendar_id, date, name, is_half_day) VALUES
        (gen_random_uuid(), '${COMPANY_A}'::uuid, '${CAL_SHIFT_ID}'::uuid, '${D_ALL_DISAGREE}'::date, 'Shift tier wins', true),
        (gen_random_uuid(), '${COMPANY_A}'::uuid, '${CAL_EMP_ID}'::uuid,   '${D_ALL_DISAGREE}'::date, 'Employee tier (should lose)', false),
        (gen_random_uuid(), '${COMPANY_A}'::uuid, '${CAL_EMP_ID}'::uuid,   '${D_EMPLOYEE_VS_TENANT}'::date, 'Employee tier wins', false);
      INSERT INTO public.holidays (id, tenant_id, date, name, is_half_day) VALUES
        (gen_random_uuid(), '${COMPANY_A}'::uuid, '${D_ALL_DISAGREE}'::date, 'Tenant default (should lose to shift)', false),
        (gen_random_uuid(), '${COMPANY_A}'::uuid, '${D_EMPLOYEE_VS_TENANT}'::date, 'Tenant default (should lose to employee)', false),
        (gen_random_uuid(), '${COMPANY_A}'::uuid, '${D_TENANT_ONLY}'::date, 'Tenant default only', false);
      INSERT INTO public.shifts (
        id, tenant_id, name, start_time, end_time, working_days, is_default, is_active,
        punch_out_closes_minutes_after, working_hours_threshold_for_absent,
        working_hours_threshold_for_half_day, determine_check_in_and_check_out,
        working_hours_calculation_based_on, enable_late_entry_marking, late_entry_grace_minutes,
        enable_early_exit_marking, early_exit_grace_minutes, enable_auto_derivation,
        mark_attendance_on_holidays, allowed_punch_sources, holiday_calendar_id
      ) VALUES (
        '${SHIFT_ID}'::uuid, '${COMPANY_A}'::uuid, 'P2-01 test shift', '09:00', '18:00',
        ARRAY[1,2,3,4,5,6], false, true, 60, 4, 6, 'alternating', 'first_last', false, 0, false, 0,
        false, false, ARRAY['web'], '${CAL_SHIFT_ID}'::uuid
      );
      INSERT INTO public.employee_shifts (id, tenant_id, employee_id, shift_id, effective_from, effective_to)
        VALUES ('${ES_ID}'::uuid, '${COMPANY_A}'::uuid, '${employeeAId}'::uuid, '${SHIFT_ID}'::uuid, '2026-10-01'::date, '2026-10-31'::date);
      UPDATE public.employees SET holiday_calendar_id='${CAL_EMP_ID}'::uuid WHERE id='${employeeAId}'::uuid;
    `.trim());

    const allDisagreeRows = noError(
      await employeeAClient.database.rpc("work_calendar_holiday", { p_tenant_id: COMPANY_A, p_employee_id: employeeAId, p_date: D_ALL_DISAGREE }),
      "AC3 all-tiers-disagree",
    );
    // Guards against tier bleed-through: if the resolver's UNION ALL ever returned more than one
    // matching tier (e.g. a NOT EXISTS clause regressed), this would still look like a pass on
    // source alone if the winning row happened to sort first -- row count makes that impossible.
    assert.equal(allDisagreeRows.length, 1, `resolver must return exactly one row, not one per matching tier (got ${allDisagreeRows.length})`);
    const allDisagree = allDisagreeRows[0];
    assert.equal(allDisagree.source, "shift", `shift tier must win on ${D_ALL_DISAGREE}, got ${allDisagree.source}`);
    assert.equal(allDisagree.is_holiday, true);
    assert.equal(allDisagree.is_half_day, true);
    assert.equal(allDisagree.holiday_name, "Shift tier wins");

    const employeeVsTenant = noError(
      await employeeAClient.database.rpc("work_calendar_holiday", { p_tenant_id: COMPANY_A, p_employee_id: employeeAId, p_date: D_EMPLOYEE_VS_TENANT }),
      "AC3 employee-vs-tenant",
    )[0];
    assert.equal(employeeVsTenant.source, "employee", `employee tier must win on ${D_EMPLOYEE_VS_TENANT}, got ${employeeVsTenant.source}`);
    assert.equal(employeeVsTenant.holiday_name, "Employee tier wins");

    const tenantOnly = noError(
      await employeeAClient.database.rpc("work_calendar_holiday", { p_tenant_id: COMPANY_A, p_employee_id: employeeAId, p_date: D_TENANT_ONLY }),
      "AC3 tenant-default-only",
    )[0];
    assert.equal(tenantOnly.source, "tenant_default");
    assert.equal(tenantOnly.holiday_name, "Tenant default only");

    const none = noError(
      await employeeAClient.database.rpc("work_calendar_holiday", { p_tenant_id: COMPANY_A, p_employee_id: employeeAId, p_date: D_NONE }),
      "AC3 none",
    )[0];
    assert.equal(none.source, "none");
    assert.equal(none.is_holiday, false);

    console.log(`AC3 holiday precedence: ${D_ALL_DISAGREE} all three disagree -> source=shift (correct); ${D_EMPLOYEE_VS_TENANT} employee vs tenant disagree -> source=employee (correct); ${D_TENANT_ONLY} -> source=tenant_default; ${D_NONE} -> source=none. Precedence confirmed: shift > employee > tenant_default > none.`);
  } finally {
    runSql(`
      DELETE FROM public.employee_shifts WHERE id='${ES_ID}'::uuid;
      DELETE FROM public.holiday_calendar_days WHERE calendar_id IN ('${CAL_SHIFT_ID}'::uuid,'${CAL_EMP_ID}'::uuid);
      DELETE FROM public.shifts WHERE id='${SHIFT_ID}'::uuid;
      DELETE FROM public.holiday_calendars WHERE id IN ('${CAL_SHIFT_ID}'::uuid,'${CAL_EMP_ID}'::uuid);
      DELETE FROM public.holidays WHERE tenant_id='${COMPANY_A}'::uuid AND date IN ('${D_ALL_DISAGREE}'::date,'${D_EMPLOYEE_VS_TENANT}'::date,'${D_TENANT_ONLY}'::date);
      UPDATE public.employees SET holiday_calendar_id=${priorEmployeeCalendar ? `'${priorEmployeeCalendar}'::uuid` : "NULL"} WHERE id='${employeeAId}'::uuid;
    `.trim());
    const cleanupCheck = rowsOf(runSql(
      `SELECT holiday_calendar_id FROM public.employees WHERE id='${employeeAId}'::uuid`,
    ))[0]?.holiday_calendar_id ?? null;
    assert.equal(cleanupCheck, priorEmployeeCalendar, "FAILED TO RESTORE employee.a holiday_calendar_id after AC3 -- fixture left dirty");
  }

  // ==========================================================================================
  // AC4 -- DST correctness against an independent oracle (Node's Intl/tz database, not
  // Postgres's), across both the 2026 spring-forward gap and the fall-back ambiguous hour, for
  // a non-UTC tenant timezone. Company B's timezone is changed temporarily and restored.
  // ==========================================================================================
  const priorTimezone = rowsOf(runSql(`SELECT timezone FROM public.tenants WHERE id='${COMPANY_B}'::uuid`))[0]?.timezone;
  assert.ok(priorTimezone, "Company B has no timezone set");
  const DST_ZONE = "America/New_York";
  const instants = [
    "2026-03-08T04:59:00Z", "2026-03-08T05:00:00Z", // local midnight boundary before spring-forward
    "2026-03-08T06:30:00Z", "2026-03-08T06:59:00Z",  // 01:30, 01:59 EST -- last minutes before the gap
    "2026-03-08T07:00:00Z", "2026-03-08T07:30:00Z",  // 03:00, 03:30 EDT -- first minutes after the gap
    "2026-11-01T03:59:00Z", "2026-11-01T04:00:00Z",  // local midnight boundary before fall-back
    "2026-11-01T05:30:00Z",                            // 01:30 EDT -- ambiguous hour, 1st occurrence
    "2026-11-01T06:30:00Z",                            // 01:30 EST -- ambiguous hour, 2nd occurrence (same local time, different instant)
    "2026-11-02T04:59:00Z", "2026-11-02T05:00:00Z",  // local midnight boundary the day after fall-back
  ];
  let dstResults;
  try {
    runSql(`UPDATE public.tenants SET timezone='${DST_ZONE}' WHERE id='${COMPANY_B}'::uuid`);
    dstResults = instants.map((iso) => {
      const expected = localDateInZone(iso, DST_ZONE);
      const raw = rowsOf(runSql(
        `SELECT tenant_business_date('${COMPANY_B}'::uuid, '${iso}'::timestamptz) AS d`,
      ))[0]?.d;
      // The CLI's JSON encoding round-trips `date` as a midnight ISO timestamp; the calendar
      // date itself (the first 10 chars) is what tenant_business_date actually returned.
      const actual = typeof raw === "string" ? raw.slice(0, 10) : raw;
      return { iso, expected, actual };
    });
    for (const r of dstResults) {
      assert.equal(r.actual, r.expected, `DST mismatch at ${r.iso}: Postgres=${r.actual}, Intl oracle=${r.expected}`);
    }
    // Ambiguous hour: both duplicate-local-time instants must independently resolve, and agree
    // with each other, since both are still "Nov 1" wall-clock time in the zone.
    const firstOccurrence = dstResults.find((r) => r.iso === "2026-11-01T05:30:00Z").actual;
    const secondOccurrence = dstResults.find((r) => r.iso === "2026-11-01T06:30:00Z").actual;
    assert.equal(firstOccurrence, "2026-11-01");
    assert.equal(secondOccurrence, "2026-11-01");
  } finally {
    runSql(`UPDATE public.tenants SET timezone='${priorTimezone}' WHERE id='${COMPANY_B}'::uuid`);
    const restoredTz = rowsOf(runSql(`SELECT timezone FROM public.tenants WHERE id='${COMPANY_B}'::uuid`))[0]?.timezone;
    assert.equal(restoredTz, priorTimezone, "FAILED TO RESTORE Company B timezone after AC4 -- fixture left dirty");
  }
  console.log(`AC4 DST (${DST_ZONE}, 2026 spring-forward + fall-back): ${dstResults.length}/${dstResults.length} instants matched Node's independent Intl/tz oracle, including both occurrences of the repeated local hour resolving to the same correct date (2026-11-01).`);

  // ==========================================================================================
  // AC5 -- consumer contract: reproduce the two real non-DB-internal callers exactly and prove
  // they still resolve. attendance_derive_pass1/pass2/attendance_run_scheduled_derivation are
  // enumerated above but not executed (see file header).
  // ==========================================================================================
  const punchInOutShapeCall = noError(
    await withFetchRetry(
      () => employeeAClient.database.rpc("tenant_business_date", { p_tenant_id: COMPANY_A }),
      "AC5 PunchInOut.tsx call shape",
    ),
    "AC5 PunchInOut.tsx call shape",
  );
  assert.match(punchInOutShapeCall, /^\d{4}-\d{2}-\d{2}$/, "AC5: PunchInOut.tsx-shaped call did not resolve a date");

  const periodInput = noError(
    await withFetchRetry(
      () => hrClient.database.rpc("payroll_period_input", {
        p_tenant_id: COMPANY_A, p_period_start: "2026-09-01", p_period_end: "2026-09-07",
      }),
      "AC5 payroll_period_input",
    ),
    "AC5 payroll_period_input (consumes work_calendar_working_days)",
  );
  assert.ok(Array.isArray(periodInput), "AC5: payroll_period_input did not return rows");
  for (const row of periodInput) {
    assert.ok(Number.isInteger(row.working_days), `AC5: payroll_period_input row has non-integer working_days: ${JSON.stringify(row)}`);
  }
  // Company A has zero public.attendance rows in TB-M1M2, so payroll_period_input's `FROM att`
  // CTE yields no employee rows here -- this proves the caller resolves without error, not the
  // work_calendar_working_days value it would compute. That value is independently proven by the
  // direct RPC call in AC1 above (returned 6 for Sep 14-20 2026 with no shift assignment).
  console.log(`AC5: PunchInOut.tsx-shaped tenant_business_date(p_tenant_id) call -> ${punchInOutShapeCall}. payroll_period_input executed without error, returned ${periodInput.length} row(s) (Company A has no attendance data in this period, so this proves the caller resolves, not the working_days value -- see AC1 for that).`);

  // ==========================================================================================
  // AC7 -- RLS invariant 1/2/0 unaffected by this migration (no table policy touched).
  // ==========================================================================================
  const counts = await rlsInvariant({ "employee.a": employeeAClient, "hr-employee.a": hrClient, "employee.b": employeeBClient });
  assert.equal(counts["employee.a"], 1);
  assert.equal(counts["hr-employee.a"], 2);
  assert.equal(counts["employee.b"], 0);
  console.log(`AC7 RLS invariant unchanged: employee.a=${counts["employee.a"]}, hr-employee.a=${counts["hr-employee.a"]}, employee.b=${counts["employee.b"]} (expected 1/2/0).`);

  console.log("P2-01 work calendar resolver: signature/ACL guard, module-gating consistency, Leave-only business date, holiday precedence (3 tiers + disagreement), DST (independent oracle), consumer contract and RLS invariant all passed.");
});
