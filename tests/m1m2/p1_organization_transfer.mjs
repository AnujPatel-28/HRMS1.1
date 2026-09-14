#!/usr/bin/env node
// P1-03 dated organization placement and reporting: acceptance evidence for
// migrations/20260912183000_m1m2-dated-organization-transfer.sql.
//
// Consumers of is_manager_of found by grepping every public.pg_proc body (see AC3 setup): exactly
// one, can_view_employee, which is itself the qual of three PERMISSIVE RLS policies --
// attendance_select_manager, attendance_events_select_manager, leaves_select_manager -- verified
// live below via pg_policies, not assumed. That is the entire "employee/attendance/leave
// manager-scope reads" surface AC3 requires; there is no fourth path.
//
// Frontend files in this package's allowed list (AuthContext.tsx, OrgUnitsContext.tsx,
// useOrgStructure.ts, useManagerView.tsx, OrgStructureManagement.tsx, OrgChart.tsx,
// managerCycleValidation.ts, orgChart.ts) were read, not edited. None of them read
// secondary_manager_id or any non-primary relationship_type as a scope grant; OrgChart.tsx's own
// employee_reporting_relationships query already filters by relationship_type itself for display.
// useManagerView.tsx computes directReportIds from employees.manager_id directly, not the
// relationship table -- verified safe only because exactly two functions write
// employees.manager_id (update_employee_reporting_relationship, create_employee_transaction) and
// both keep it in sync with a matching primary-type row in the same transaction (grepped every
// public.pg_proc body for "manager_id" and every src/ write site). See migration header S2/S5 for
// the full precedence record and the one deliberately-not-fixed limitation
// (create_employee_transaction still sources its initial effective_from from CURRENT_DATE).
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
const EMPLOYEE_B = { email: "employee.b@m1m2.test", userId: "b0000000-0000-4000-8001-000000000001" };

// Synthetic targets, own namespace (80f4-*), created and torn down entirely by this file. None of
// them has a user_id -- they are data subjects, not logins; the acting personas above are real.
const T_TYPES = "a0000000-0000-4000-80f4-000000000001"; // AC3: relationship_type loop + legacy secondary_manager_id + mentor/legacy combo
const T_FALLBACK = "a0000000-0000-4000-80f4-000000000002"; // legacy manager_id fallback, zero relationship rows (not-yet-migrated)
const T_BLOCKED = "a0000000-0000-4000-80f4-000000000003"; // closed primary row + legacy manager_id set -> must stay blocked
const T_BOUNDARY_OUT = "a0000000-0000-4000-80f4-000000000004"; // AC4 live: outgoing primary, effective_to=today
const T_BOUNDARY_IN = "a0000000-0000-4000-80f4-000000000005"; // AC4 live: incoming primary, effective_from=today
const T_EXCLUSION = "a0000000-0000-4000-80f4-000000000006"; // AC4 constraint: same employee_id, adjacent vs overlapping ranges
const T_TRANSFER = "a0000000-0000-4000-80f4-000000000007"; // AC5: real update_employee_reporting_relationship transfer
const T_ACL = "a0000000-0000-4000-80f4-000000000008"; // AC2/AC7: self-manager, cross-tenant manager negative RPC calls
const ALL_TARGETS = [T_TYPES, T_FALLBACK, T_BLOCKED, T_BOUNDARY_OUT, T_BOUNDARY_IN, T_EXCLUSION, T_TRANSFER, T_ACL];

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

async function withFetchRetry(makeCall, label) {
  const first = await makeCall();
  if (!first.error || !/fetch failed/i.test(messageOf(first.error))) return first;
  console.log(`${label}: transient fetch failure, retrying once`);
  return makeCall();
}

function wipeTargets() {
  runSql(`
    DELETE FROM public.attendance WHERE employee_id IN (${ALL_TARGETS.map((t) => `'${t}'::uuid`).join(",")});
    DELETE FROM public.leaves WHERE employee_id IN (${ALL_TARGETS.map((t) => `'${t}'::uuid`).join(",")});
    DELETE FROM public.employee_reporting_relationships WHERE employee_id IN (${ALL_TARGETS.map((t) => `'${t}'::uuid`).join(",")});
    DELETE FROM public.audit_logs WHERE target_id IN (${ALL_TARGETS.map((t) => `'${t}'::uuid`).join(",")});
    DELETE FROM public.employees WHERE id IN (${ALL_TARGETS.map((t) => `'${t}'::uuid`).join(",")});
  `.trim());
}

await guardedMutation("P1-03 dated organization placement and reporting", async () => {
  const anonKey = readBranchAnonKey();
  const employeeAClient = await signIn(EMPLOYEE_A, anonKey);
  const hrClient = await signIn(HR_EMPLOYEE_A, anonKey);
  const employeeBClient = await signIn(EMPLOYEE_B, anonKey);

  // Precondition, asserted live (not inferred): employee.a is not HR and holds no scoped grant.
  // can_view_employee has four OR branches -- if either of these were true, every AC3 negative
  // below would read "still granted" for the wrong reason (HR/grant, not the relationship_type
  // gate this migration fixed), and this suite would be worthless as evidence.
  const grantRows = rowsOf(runSql(
    `SELECT count(*) AS n FROM public.employee_roles WHERE employee_id='${EMPLOYEE_A.employeeId}'::uuid AND is_active AND role IN ('manager','hr_admin','payroll_admin')`,
  ));
  assert.equal(Number(grantRows[0].n), 0, "precondition failed: employee.a holds a scoped employee_roles grant");
  const isHrCheck = noError(await employeeAClient.database.rpc("is_hr", {}), "employee.a is_hr()");
  assert.equal(isHrCheck, false, "precondition failed: employee.a's is_hr() resolves true");
  const metaRole = rowsOf(runSql(`SELECT metadata->>'role' AS role FROM auth.users WHERE id='${EMPLOYEE_A.userId}'::uuid`))[0]?.role;
  assert.equal(metaRole, "employee", "precondition failed: employee.a auth.users metadata role is not 'employee'");
  console.log(`Precondition: employee.a holds zero scoped employee_roles grants and auth.users metadata role='${metaRole}' (not HR). is_hr() RPC probe: ${JSON.stringify(isHrCheck)}.`);

  wipeTargets();
  try {
    // ==========================================================================================
    // Structural guard: exactly one is_manager_of and one update_employee_reporting_relationship,
    // unchanged signatures, no anon EXECUTE. Direct evidence the body-only replace did not create
    // an overload (the exact failure P2-01's brief documented and this brief repeats at S5).
    // ==========================================================================================
    const catalog = rowsOf(runSql(`
      SELECT p.proname, count(*) AS cnt,
             array_agg(pg_get_function_identity_arguments(p.oid) ORDER BY p.oid) AS sigs,
             array_agg(p.proacl::text ORDER BY p.oid) AS acls,
             bool_and(p.prosecdef) AS all_definer
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public'
        AND p.proname IN ('is_manager_of','update_employee_reporting_relationship')
      GROUP BY p.proname
    `.trim()));
    assert.equal(catalog.length, 2, "expected exactly is_manager_of/update_employee_reporting_relationship");
    for (const row of catalog) {
      assert.equal(Number(row.cnt), 1, `${row.proname}: expected exactly one overload, found ${row.cnt} (${row.sigs})`);
      assert.equal(row.all_definer, true, `${row.proname}: must be SECURITY DEFINER`);
      for (const acl of row.acls) assert.doesNotMatch(acl, /anon=/, `${row.proname}: anon must not hold EXECUTE`);
    }
    const imSig = catalog.find((r) => r.proname === "is_manager_of").sigs[0];
    assert.equal(imSig, "p_employee_id uuid", "is_manager_of signature changed");
    console.log(`pg_proc overload guard: ${catalog.map((r) => `${r.proname}(${r.sigs[0]})`).join("; ")} -- exactly one row each, no anon EXECUTE.`);

    // The relationship_type CHECK now legalizes all six contract types.
    const checkDef = rowsOf(runSql(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='employee_reporting_relationships_relationship_type_check'`,
    ))[0].def;
    for (const t of ["primary", "secondary", "mentor", "project_manager", "reviewer", "temporary"]) {
      assert.match(checkDef, new RegExp(`'${t}'`), `relationship_type CHECK missing '${t}'`);
    }
    console.log(`AC3 setup: relationship_type CHECK legalizes all six contract types: ${checkDef}`);

    // The exclusion-constraint guard now exists in place of the old open-ended-only unique index.
    const excl = rowsOf(runSql(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='employee_reporting_primary_no_overlap' AND contype='x'`,
    ));
    assert.equal(excl.length, 1, "employee_reporting_primary_no_overlap exclusion constraint missing");
    console.log(`AC4 setup: ${excl[0].def}`);

    // Enumerate every consumer of is_manager_of: exactly can_view_employee, and exactly the three
    // RLS policies whose qual is can_view_employee(employee_id). This IS the full
    // "employee/attendance/leave manager-scope reads" surface AC3 requires -- not assumed.
    const consumers = rowsOf(runSql(`SELECT proname FROM pg_proc WHERE prosrc ILIKE '%is_manager_of%' AND proname <> 'is_manager_of'`));
    assert.deepEqual(consumers.map((r) => r.proname).sort(), ["can_view_employee"], "is_manager_of consumer set changed");
    const policies = rowsOf(runSql(
      `SELECT tablename, policyname FROM pg_policies WHERE qual ILIKE '%can_view_employee%' ORDER BY tablename`,
    ));
    assert.deepEqual(
      policies.map((p) => `${p.tablename}.${p.policyname}`).sort(),
      ["attendance.attendance_select_manager", "attendance_events.attendance_events_select_manager", "leaves.leaves_select_manager"],
      "can_view_employee consumer policy set changed",
    );
    console.log(`AC3 surface: is_manager_of -> can_view_employee -> {${policies.map((p) => `${p.tablename}.${p.policyname}`).join(", ")}}. This is the entire manager-scope-read surface.`);

    // ==========================================================================================
    // AC3 (the package) -- each of the five non-primary types individually fails employee/
    // attendance/leave manager-scope reads; 'primary' is the positive control proving the negative
    // results are real denials, not a broken/NULL predicate that denies everything.
    // ==========================================================================================
    runSql(`
      INSERT INTO public.employees (id, tenant_id, full_name, email) VALUES
        ('${T_TYPES}'::uuid, '${COMPANY_A}'::uuid, 'P1-03 AC3 Target', 'p1-03-ac3-target@m1m2.test');
      INSERT INTO public.attendance (employee_id, tenant_id, date, status) VALUES
        ('${T_TYPES}'::uuid, '${COMPANY_A}'::uuid, '2026-09-01', 'present');
      INSERT INTO public.leaves (employee_id, tenant_id, start_date, end_date, reason, status) VALUES
        ('${T_TYPES}'::uuid, '${COMPANY_A}'::uuid, '2026-09-01', '2026-09-01', 'P1-03 AC3 fixture', 'pending');
    `.trim());

    async function checkScope(label, expected) {
      const im = noError(
        await withFetchRetry(() => employeeAClient.database.rpc("is_manager_of", { p_employee_id: T_TYPES }), `${label} is_manager_of`),
        `${label} is_manager_of`,
      );
      const cve = noError(
        await withFetchRetry(() => employeeAClient.database.rpc("can_view_employee", { p_employee_id: T_TYPES }), `${label} can_view_employee`),
        `${label} can_view_employee`,
      );
      const att = noError(
        await withFetchRetry(() => employeeAClient.database.from("attendance").select("id").eq("employee_id", T_TYPES), `${label} attendance`),
        `${label} attendance`,
      );
      const lv = noError(
        await withFetchRetry(() => employeeAClient.database.from("leaves").select("id").eq("employee_id", T_TYPES), `${label} leaves`),
        `${label} leaves`,
      );
      assert.equal(im, expected, `${label}: is_manager_of expected ${expected}, got ${im}`);
      assert.equal(cve, expected, `${label}: can_view_employee expected ${expected}, got ${cve}`);
      assert.equal(att.length, expected ? 1 : 0, `${label}: attendance rows expected ${expected ? 1 : 0}, got ${att.length}`);
      assert.equal(lv.length, expected ? 1 : 0, `${label}: leaves rows expected ${expected ? 1 : 0}, got ${lv.length}`);
      return { im, cve, attRows: att.length, lvRows: lv.length };
    }

    const NON_PRIMARY_TYPES = ["secondary", "mentor", "project_manager", "reviewer", "temporary"];
    const results = {};
    for (const type of NON_PRIMARY_TYPES) {
      runSql(`
        DELETE FROM public.employee_reporting_relationships WHERE employee_id='${T_TYPES}'::uuid;
        UPDATE public.employees SET manager_id=NULL, secondary_manager_id=NULL WHERE id='${T_TYPES}'::uuid;
        INSERT INTO public.employee_reporting_relationships (tenant_id, employee_id, manager_id, relationship_type, effective_from, effective_to, is_active)
          VALUES ('${COMPANY_A}'::uuid, '${T_TYPES}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, '${type}', '2026-01-01', NULL, true);
      `.trim());
      results[type] = await checkScope(`AC3 relationship_type='${type}'`, false);
    }

    // Positive control: the SAME row, only relationship_type flipped to 'primary', now grants.
    runSql(`UPDATE public.employee_reporting_relationships SET relationship_type='primary' WHERE employee_id='${T_TYPES}'::uuid`);
    const positiveControl = await checkScope("AC3 positive control relationship_type='primary'", true);

    // Legacy secondary_manager_id: a separate grant path from the 'secondary' row type (brief S6).
    // No relationship row at all now; secondary_manager_id set directly on the employees row.
    runSql(`
      DELETE FROM public.employee_reporting_relationships WHERE employee_id='${T_TYPES}'::uuid;
      UPDATE public.employees SET manager_id=NULL, secondary_manager_id='${EMPLOYEE_A.employeeId}'::uuid WHERE id='${T_TYPES}'::uuid;
    `.trim());
    const legacySecondary = await checkScope("AC3 legacy employees.secondary_manager_id (no relationship row)", false);

    // Precedence check (recorded in migration S2): a 'mentor' row plus legacy manager_id set. The
    // fallback must still fire here, because no PRIMARY-type row exists for this employee -- only
    // 'primary' rows suppress the legacy fallback, not "any row of any type".
    runSql(`
      DELETE FROM public.employee_reporting_relationships WHERE employee_id='${T_TYPES}'::uuid;
      UPDATE public.employees SET manager_id='${EMPLOYEE_A.employeeId}'::uuid, secondary_manager_id=NULL WHERE id='${T_TYPES}'::uuid;
      INSERT INTO public.employee_reporting_relationships (tenant_id, employee_id, manager_id, relationship_type, effective_from, effective_to, is_active)
        VALUES ('${COMPANY_A}'::uuid, '${T_TYPES}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, 'mentor', '2026-01-01', NULL, true);
    `.trim());
    const mentorPlusLegacy = await checkScope("AC3 precedence: mentor row present + legacy manager_id set", true);

    console.log(
      `AC3 (the package): ${NON_PRIMARY_TYPES.map((t) => `${t}=denied`).join(", ")}; primary=granted (positive control); ` +
      `legacy secondary_manager_id alone=denied; mentor-row+legacy-manager_id=granted (fallback correctly ignores a non-primary row). ` +
      `Full is_manager_of/can_view_employee/attendance/leaves results: ${JSON.stringify({ ...results, primary: positiveControl, legacySecondary, mentorPlusLegacy })}`,
    );

    // ==========================================================================================
    // Legacy fallback structural cases: not-yet-migrated (zero relationship rows) grants; blocked
    // (a closed primary row with no replacement, plus legacy manager_id still set) does NOT grant.
    // ==========================================================================================
    runSql(`
      INSERT INTO public.employees (id, tenant_id, full_name, email, manager_id) VALUES
        ('${T_FALLBACK}'::uuid, '${COMPANY_A}'::uuid, 'P1-03 Fallback Target', 'p1-03-fallback-target@m1m2.test', '${EMPLOYEE_A.employeeId}'::uuid);
    `.trim());
    const fallbackIm = noError(
      await employeeAClient.database.rpc("is_manager_of", { p_employee_id: T_FALLBACK }),
      "not-yet-migrated fallback",
    );
    assert.equal(fallbackIm, true, "not-yet-migrated employee (legacy manager_id, zero relationship rows) must fall back to legacy manager_id");

    runSql(`
      INSERT INTO public.employees (id, tenant_id, full_name, email, manager_id) VALUES
        ('${T_BLOCKED}'::uuid, '${COMPANY_A}'::uuid, 'P1-03 Blocked Target', 'p1-03-blocked-target@m1m2.test', '${EMPLOYEE_A.employeeId}'::uuid);
      INSERT INTO public.employee_reporting_relationships (tenant_id, employee_id, manager_id, relationship_type, effective_from, effective_to, is_active)
        VALUES ('${COMPANY_A}'::uuid, '${T_BLOCKED}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, 'primary', '2026-01-01', '2026-02-01', false);
    `.trim());
    const blockedIm = noError(
      await employeeAClient.database.rpc("is_manager_of", { p_employee_id: T_BLOCKED }),
      "blocked (closed primary, no replacement)",
    );
    assert.equal(blockedIm, false, "employee with a closed primary row and no replacement must read as blocked, not fall back to legacy manager_id");
    console.log(`Precedence structural cases: not-yet-migrated (zero relationship rows) -> fallback grants (${fallbackIm}); closed-primary-no-replacement -> blocked, no fallback (${blockedIm}).`);

    // ==========================================================================================
    // AC4 -- boundary date D using TODAY's real tenant business date (a genuine live boundary, not
    // simulated): outgoing primary effective_to=D must NOT resolve on D; incoming primary
    // effective_from=D must resolve on D. Two separate targets isolate outgoing vs incoming using
    // the one available non-HR persona (employee.a) on both sides without a second login.
    // ==========================================================================================
    const businessDate = rowsOf(runSql(`SELECT public.tenant_business_date('${COMPANY_A}'::uuid) AS d`))[0].d.slice(0, 10);
    runSql(`
      INSERT INTO public.employees (id, tenant_id, full_name, email) VALUES
        ('${T_BOUNDARY_OUT}'::uuid, '${COMPANY_A}'::uuid, 'P1-03 Boundary Out', 'p1-03-boundary-out@m1m2.test'),
        ('${T_BOUNDARY_IN}'::uuid, '${COMPANY_A}'::uuid, 'P1-03 Boundary In', 'p1-03-boundary-in@m1m2.test');
      INSERT INTO public.employee_reporting_relationships (tenant_id, employee_id, manager_id, relationship_type, effective_from, effective_to, is_active)
        VALUES ('${COMPANY_A}'::uuid, '${T_BOUNDARY_OUT}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, 'primary', '2026-01-01', '${businessDate}', true);
      INSERT INTO public.employee_reporting_relationships (tenant_id, employee_id, manager_id, relationship_type, effective_from, effective_to, is_active)
        VALUES ('${COMPANY_A}'::uuid, '${T_BOUNDARY_IN}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, 'primary', '${businessDate}', NULL, true);
    `.trim());
    const outgoingOnD = noError(await employeeAClient.database.rpc("is_manager_of", { p_employee_id: T_BOUNDARY_OUT }), "AC4 outgoing on D");
    const incomingOnD = noError(await employeeAClient.database.rpc("is_manager_of", { p_employee_id: T_BOUNDARY_IN }), "AC4 incoming on D");
    assert.equal(outgoingOnD, false, `AC4: outgoing primary with effective_to=${businessDate} must NOT resolve on D=${businessDate} (half-open)`);
    assert.equal(incomingOnD, true, `AC4: incoming primary with effective_from=${businessDate} must resolve on D=${businessDate}`);
    console.log(`AC4 live boundary (D=${businessDate}, today's real tenant business date): outgoing (effective_to=D) -> is_manager_of=${outgoingOnD} (correctly excluded); incoming (effective_from=D) -> is_manager_of=${incomingOnD} (correctly included). Exactly one resolves on D.`);

    // ==========================================================================================
    // AC4 -- exclusion constraint itself, same employee_id: adjacent half-open ranges touching
    // exactly at D must succeed (this IS the boundary case); a genuinely overlapping range must be
    // rejected by the database, not just by application logic.
    // ==========================================================================================
    runSql(`
      INSERT INTO public.employees (id, tenant_id, full_name, email) VALUES
        ('${T_EXCLUSION}'::uuid, '${COMPANY_A}'::uuid, 'P1-03 Exclusion Target', 'p1-03-exclusion-target@m1m2.test');
      INSERT INTO public.employee_reporting_relationships (tenant_id, employee_id, manager_id, relationship_type, effective_from, effective_to, is_active)
        VALUES ('${COMPANY_A}'::uuid, '${T_EXCLUSION}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, 'primary', '2026-01-01', '${businessDate}', true);
      INSERT INTO public.employee_reporting_relationships (tenant_id, employee_id, manager_id, relationship_type, effective_from, effective_to, is_active)
        VALUES ('${COMPANY_A}'::uuid, '${T_EXCLUSION}'::uuid, '${HR_EMPLOYEE_A.employeeId}'::uuid, 'primary', '${businessDate}', NULL, true);
    `.trim());
    console.log(`AC4 exclusion constraint: two adjacent primary rows for the same employee (outgoing effective_to=${businessDate}, incoming effective_from=${businessDate}) inserted without error -- adjacency, not overlap, under half-open semantics.`);

    // Same-employee, two-candidate-manager version of the live boundary check above: exactly one
    // of the two now-active primary rows for T_EXCLUSION resolves as manager on D.
    const exclOutOnD = noError(await employeeAClient.database.rpc("is_manager_of", { p_employee_id: T_EXCLUSION }), "AC4 exclusion outgoing on D");
    const exclInOnD = noError(await hrClient.database.rpc("is_manager_of", { p_employee_id: T_EXCLUSION }), "AC4 exclusion incoming on D");
    assert.equal(exclOutOnD, false, "AC4: same-employee outgoing manager (effective_to=D) must NOT resolve on D");
    assert.equal(exclInOnD, true, "AC4: same-employee incoming manager (effective_from=D) must resolve on D");
    console.log(`AC4 same-employee boundary: on D=${businessDate}, employee.a (outgoing) resolves=${exclOutOnD}, hr-employee.a (incoming) resolves=${exclInOnD} -- exactly one of the two candidate managers resolves.`);

    let overlapRejected = false;
    try {
      runSql(`
        INSERT INTO public.employee_reporting_relationships (tenant_id, employee_id, manager_id, relationship_type, effective_from, effective_to, is_active)
          VALUES ('${COMPANY_A}'::uuid, '${T_EXCLUSION}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, 'primary', '2026-08-01', NULL, true);
      `.trim());
    } catch {
      overlapRejected = true;
    }
    assert.equal(overlapRejected, true, "AC4: a genuinely overlapping primary row for the same employee must be rejected by the exclusion constraint");
    console.log("AC4 exclusion constraint: a third primary row (effective_from=2026-08-01, open-ended) overlapping the first row's [2026-01-01, D) range was rejected by the database, as required.");

    // Coupling check (recorded in migration S4): an INACTIVE primary may freely overlap ACTIVE ones
    // for the same employee -- the exclusion's WHERE and the resolver's is_active requirement are
    // meant to agree, not because overlap among active rows is ever allowed. The two adjacent rows
    // above stay active (non-overlapping in time, hence no violation); this third insert overlaps
    // both in raw date-range terms but is is_active=false, so the exclusion's WHERE filter never
    // considers it.
    let inactiveOverlapSucceeded = true;
    try {
      runSql(`
        INSERT INTO public.employee_reporting_relationships (tenant_id, employee_id, manager_id, relationship_type, effective_from, effective_to, is_active)
          VALUES ('${COMPANY_A}'::uuid, '${T_EXCLUSION}'::uuid, '${EMPLOYEE_A.employeeId}'::uuid, 'primary', '2026-01-01', NULL, false);
      `.trim());
    } catch {
      inactiveOverlapSucceeded = false;
    }
    assert.equal(inactiveOverlapSucceeded, true, "AC4: an is_active=false primary row must NOT be blocked by the exclusion constraint even if its range overlaps active rows (by design -- see migration S4)");
    const exclusionResolvers = rowsOf(runSql(
      `SELECT count(*) FILTER (WHERE is_active) AS active_primaries, count(*) FILTER (WHERE NOT is_active) AS inactive_primaries FROM public.employee_reporting_relationships WHERE employee_id='${T_EXCLUSION}'::uuid AND relationship_type='primary'`,
    ))[0];
    // Two ACTIVE primaries is correct here: the outgoing/incoming pair are historically adjacent
    // (non-overlapping ranges), not overlapping-on-any-date -- that property was just proven above
    // via the live is_manager_of boundary check, not by counting rows.
    assert.equal(Number(exclusionResolvers.active_primaries), 2, "AC4: the two adjacent (non-overlapping) active primaries must both remain, undisturbed");
    assert.equal(Number(exclusionResolvers.inactive_primaries), 1, "AC4: the inactive overlapping row must have been accepted");
    console.log(`AC4 is_active coupling: an inactive overlapping primary row was accepted (by design); ${exclusionResolvers.active_primaries} active (adjacent, non-overlapping) and ${exclusionResolvers.inactive_primaries} inactive (overlapping, ignored by the constraint) primaries coexist for this employee.`);

    // ==========================================================================================
    // AC5 -- real transfer via update_employee_reporting_relationship: history unchanged (assert
    // the OLD row's own values, not just that a new row exists), scope flips on the effective
    // date, dynamic re-resolution (no caching -- same call, new answer) -- AC6's own requirement,
    // exercised here rather than argued separately.
    // ==========================================================================================
    runSql(`
      INSERT INTO public.employees (id, tenant_id, full_name, email) VALUES
        ('${T_TRANSFER}'::uuid, '${COMPANY_A}'::uuid, 'P1-03 Transfer Target', 'p1-03-transfer-target@m1m2.test');
    `.trim());

    const firstTransfer = await hrClient.database.rpc("update_employee_reporting_relationship", {
      p_employee_id: T_TRANSFER,
      p_primary_manager_id: EMPLOYEE_A.employeeId,
      p_secondary_manager_id: null,
    });
    assert.equal(firstTransfer.error, null, `AC5 initial assignment: ${messageOf(firstTransfer.error)}`);

    const afterFirst = noError(await employeeAClient.database.rpc("is_manager_of", { p_employee_id: T_TRANSFER }), "AC5 after first assignment");
    assert.equal(afterFirst, true, "AC5: employee.a must gain scope immediately after being assigned as primary manager");

    const originalRow = rowsOf(runSql(
      `SELECT id, manager_id, relationship_type, effective_from, effective_to, is_active FROM public.employee_reporting_relationships WHERE employee_id='${T_TRANSFER}'::uuid AND relationship_type='primary'`,
    ))[0];
    assert.equal(originalRow.manager_id, EMPLOYEE_A.employeeId);
    assert.equal(originalRow.is_active, true);
    assert.equal(originalRow.effective_to, null);

    const secondTransfer = await hrClient.database.rpc("update_employee_reporting_relationship", {
      p_employee_id: T_TRANSFER,
      p_primary_manager_id: HR_EMPLOYEE_A.employeeId,
      p_secondary_manager_id: null,
    });
    assert.equal(secondTransfer.error, null, `AC5 transfer: ${messageOf(secondTransfer.error)}`);

    // History: the OLD row's own field values, not merely "a new row exists".
    const closedRow = rowsOf(runSql(
      `SELECT id, manager_id, relationship_type, effective_from, effective_to, is_active FROM public.employee_reporting_relationships WHERE id='${originalRow.id}'::uuid`,
    ))[0];
    assert.equal(closedRow.manager_id, originalRow.manager_id, "AC5: history corrupted -- old row's manager_id changed");
    assert.equal(closedRow.relationship_type, originalRow.relationship_type, "AC5: history corrupted -- old row's relationship_type changed");
    assert.equal(closedRow.effective_from, originalRow.effective_from, "AC5: history corrupted -- old row's effective_from changed");
    assert.equal(closedRow.is_active, false, "AC5: old row must be closed (is_active=false)");
    assert.equal(closedRow.effective_to?.slice(0, 10), businessDate, "AC5: old row must close on the tenant business date");

    const newRow = rowsOf(runSql(
      `SELECT manager_id, relationship_type, effective_from, effective_to, is_active FROM public.employee_reporting_relationships WHERE employee_id='${T_TRANSFER}'::uuid AND relationship_type='primary' AND is_active=true`,
    ))[0];
    assert.equal(newRow.manager_id, HR_EMPLOYEE_A.employeeId, "AC5: new active primary row must name the new manager");
    assert.equal(newRow.effective_from?.slice(0, 10), businessDate, "AC5: new row must be effective from the tenant business date");

    // Dynamic re-resolution (AC6): same is_manager_of call, same employee.a, no cache -- the
    // answer flips on the very next invocation, and the new manager gains it the same way.
    const formerLosesIt = noError(await employeeAClient.database.rpc("is_manager_of", { p_employee_id: T_TRANSFER }), "AC5/AC6 former primary re-check");
    const newGainsIt = noError(await hrClient.database.rpc("is_manager_of", { p_employee_id: T_TRANSFER }), "AC5/AC6 new primary re-check");
    assert.equal(formerLosesIt, false, "AC5/AC6: former primary must lose scope on the next check, dynamically, with no stored reassignment");
    assert.equal(newGainsIt, true, "AC5/AC6: new primary must gain scope, resolved dynamically at call time");

    // "Client Team state matches server resolution" (AC5): the shape useManagerView.tsx actually
    // queries (employees.manager_id = X, status='active') is reproduced directly and must agree
    // with the server's is_manager_of resolution for the same pair, post-transfer.
    const clientShapedQuery = rowsOf(runSql(
      `SELECT id FROM public.employees WHERE manager_id='${HR_EMPLOYEE_A.employeeId}'::uuid AND tenant_id='${COMPANY_A}'::uuid AND status='active' AND id='${T_TRANSFER}'::uuid`,
    ));
    assert.equal(clientShapedQuery.length, 1, "AC5: useManagerView.tsx-shaped employees.manager_id query must include the transferred employee under the new manager");
    console.log(`AC5/AC6 transfer: history preserved (old row id=${originalRow.id}, manager_id/relationship_type/effective_from unchanged, is_active flipped false, effective_to=${businessDate}); new row effective_from=${businessDate}; former primary (employee.a) loses scope=${!formerLosesIt}; new primary (hr-employee.a) gains scope=${newGainsIt}; client-shaped manager_id query agrees with server resolution.`);

    // ==========================================================================================
    // AC1 -- designation/unit/relationship/access independence: is_hr()/is_manager_of/
    // can_view_employee bodies reference no designation/job_title/org_unit column at all
    // (structural; an HR-sounding designation cannot perform an HR action because nothing reads
    // designation in the first place).
    // ==========================================================================================
    const independenceBodies = rowsOf(runSql(`
      SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('is_hr','is_manager_of','can_view_employee')
    `.trim()));
    for (const row of independenceBodies) {
      assert.doesNotMatch(row.def, /job_title|designation/i, `${row.proname}: must not condition on designation/job_title`);
    }
    console.log("AC1: is_hr/is_manager_of/can_view_employee reference no designation/job_title column -- an HR-sounding designation structurally cannot perform an HR action.");

    // ==========================================================================================
    // AC2/AC7 -- same-tenant, non-self, cross-tenant server enforcement on the one write path.
    // ==========================================================================================
    runSql(`INSERT INTO public.employees (id, tenant_id, full_name, email) VALUES ('${T_ACL}'::uuid, '${COMPANY_A}'::uuid, 'P1-03 ACL Target', 'p1-03-acl-target@m1m2.test')`);

    const selfManager = await hrClient.database.rpc("update_employee_reporting_relationship", {
      p_employee_id: T_ACL, p_primary_manager_id: T_ACL, p_secondary_manager_id: null,
    });
    assert.notEqual(selfManager.error, null, "AC2: an employee must not be assignable as their own primary manager");
    assert.match(selfManager.error.message ?? "", /own primary manager/i);

    const crossTenantManagerId = rowsOf(runSql(`SELECT id FROM public.employees WHERE tenant_id='${COMPANY_B}'::uuid AND user_id='${EMPLOYEE_B.userId}'::uuid`))[0]?.id;
    assert.ok(crossTenantManagerId, "employee.b employee row not found");
    const crossTenant = await hrClient.database.rpc("update_employee_reporting_relationship", {
      p_employee_id: T_ACL, p_primary_manager_id: crossTenantManagerId, p_secondary_manager_id: null,
    });
    assert.notEqual(crossTenant.error, null, "AC7: a cross-tenant manager ID must be denied");
    assert.match(crossTenant.error.message ?? "", /same tenant/i);
    console.log(`AC2/AC7 server enforcement: self-manager assignment rejected ("${selfManager.error.message}"); cross-tenant manager ID rejected ("${crossTenant.error.message}").`);

    // AC7 org-unit-overlap sub-case: no dated unit-assignment structure exists to test.
    console.log("AC7 org-unit-overlap sub-case: UNTESTED / not applicable -- employees.org_unit_id is a single current FK with no dated interval table (verified via information_schema before writing this migration), so no two overlapping unit assignments can structurally exist to test against. Not built here; see migration header S5.");

    // ==========================================================================================
    // AC7 (continued) / RLS invariant unaffected by this migration (no table-level policy touched).
    // ==========================================================================================
    const counts = {};
    for (const [label, client] of Object.entries({ "employee.a": employeeAClient, "hr-employee.a": hrClient, "employee.b": employeeBClient })) {
      const { data, error } = await withFetchRetry(
        () => client.database.from("employees").select("id").eq("tenant_id", COMPANY_A),
        `RLS invariant (${label})`,
      );
      assert.equal(error, null, `${label}: ${messageOf(error)}`);
      counts[label] = data.length;
    }
    // employee.a's own directs (T_FALLBACK legacy fallback + T_TRANSFER's now-closed history) are
    // still tenant-A employee rows, so the invariant compares against the actual live count rather
    // than asserting the original 1/2/0 while this suite's own fixtures are still present.
    console.log(`RLS invariant (fixtures present): employee.a=${counts["employee.a"]}, hr-employee.a=${counts["hr-employee.a"]}, employee.b=${counts["employee.b"]}.`);
  } finally {
    wipeTargets();
    const residue = rowsOf(runSql(`SELECT count(*) AS n FROM public.employees WHERE id IN (${ALL_TARGETS.map((t) => `'${t}'::uuid`).join(",")})`))[0];
    assert.equal(Number(residue.n), 0, "FAILED TO CLEAN UP P1-03 synthetic fixtures");
  }

  // RLS invariant re-verified AFTER cleanup, against the canonical 1/2/0 this repo's other suites
  // assert, proving cleanup actually restored a clean state rather than merely running without error.
  const postCleanupCounts = {};
  for (const [label, client] of Object.entries({ "employee.a": employeeAClient, "hr-employee.a": hrClient, "employee.b": employeeBClient })) {
    const { data, error } = await withFetchRetry(
      () => client.database.from("employees").select("id").eq("tenant_id", COMPANY_A),
      `post-cleanup RLS invariant (${label})`,
    );
    assert.equal(error, null, `${label}: ${messageOf(error)}`);
    postCleanupCounts[label] = data.length;
  }
  assert.equal(postCleanupCounts["employee.a"], 1);
  assert.equal(postCleanupCounts["hr-employee.a"], 2);
  assert.equal(postCleanupCounts["employee.b"], 0);
  console.log(`Post-cleanup RLS invariant: employee.a=${postCleanupCounts["employee.a"]}, hr-employee.a=${postCleanupCounts["hr-employee.a"]}, employee.b=${postCleanupCounts["employee.b"]} (expected 1/2/0, confirms fixtures fully removed).`);

  console.log("P1-03 dated organization placement and reporting: overload guard, AC3 (five non-primary types denied + primary positive control + legacy secondary_manager_id + mentor/legacy precedence), fallback/blocked precedence cases, AC4 (live boundary + exclusion constraint + is_active coupling), AC5/AC6 (real transfer, history, dynamic re-resolution, client-shape agreement), AC1 (structural independence), AC2/AC7 (self/cross-tenant server enforcement), RLS invariant all passed.");
});
