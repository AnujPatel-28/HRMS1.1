#!/usr/bin/env node
// C1 — employee self-edit allowlist (D1/D2) and manager new-hire requests (D3).
// Reuses scratch/emp-self-write-probe.mjs's restore-and-assert pattern and the
// signIn/anonKey/runSql/rlsInvariant fixture conventions established by p3_private_buckets.mjs
// and p3_projects_tasks.mjs. Disposable fixtures only, `finally` teardown, RLS invariant 1/2/0
// before and after.
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

// Disposable manager persona: holds the 'manager' template (employee.basic.read/direct_reports),
// used to prove D3's authority check and to exercise the requester-sees-status path.
const manager = { email: `c1-manager-${randomUUID().slice(0, 8)}@m1m2.test`, userId: randomUUID(), employeeId: randomUUID() };
manager.membershipId = membershipId(manager.userId);

// Disposable mid-onboarding employee: no manager grant, used only for D2's status-window proof.
const onboarding = { email: `c1-onboarding-${randomUUID().slice(0, 8)}@m1m2.test`, userId: randomUUID(), employeeId: randomUUID() };
onboarding.membershipId = membershipId(onboarding.userId);

const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
const fp = (error) => [error?.code, error?.message, error?.details].filter(Boolean).join(" | ");
const rows = (result) => result?.rows ?? result?.data?.rows ?? [];

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

async function signIn(persona, key) {
  const client = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey: key });
  const { data, error } = await client.auth.signInWithPassword({ email: persona.email, password });
  assert.equal(error, null, `${persona.email} login: ${fp(error)}`);
  assert.equal(data?.user?.id, persona.userId);
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

// D1: HR-only under the allowlist (bank, identity, and the named admin columns). These are
// exactly the columns the 2026-09-22 decision names as HR-only, plus employee_code/work_location
// which the lead's probe and D1 both call out. Excludes aadhaar_number/pan_number/date_of_birth/
// gender/bank_name/account_number/ifsc_code, which are D2's onboarding-window carve-out and are
// tested separately against the disposable `onboarding` fixture.
// grade_id/holiday_calendar_id use a fabricated (non-existent) uuid: the BEFORE UPDATE trigger
// must reject the change before any FK constraint is even checked, so the fabricated value is
// only ever compared for IS DISTINCT FROM, never actually persisted.
const HR_ONLY_STEADY_STATE = {
  work_mode: "remote",
  work_location: "Remote HQ",
  holiday_calendar_id: "11111111-1111-4111-8111-111111111111",
  grade_id: "11111111-1111-4111-8111-111111111111",
  attendance_device_id: "c1-probe-device",
  kiosk_pin_hash: "c1-probe-hash",
  employee_code: "C1-PROBE",
  employment_type: "contract",
};
// D2: allowed only while onboarding is open (employee_onboarding_self.completed_at IS NULL),
// HR-only afterward.
const ONBOARDING_WINDOW_COLUMNS = {
  aadhaar_number: "c1-probe-aadhaar",
  pan_number: "c1-probe-pan",
  date_of_birth: "1995-01-01",
  gender: "other",
  bank_name: "C1 Probe Bank",
  account_number: "c1-probe-account",
  ifsc_code: "C1PB0000001",
};
// D1: the contact-only self-edit allowlist, exact list from the decision.
const CONTACT_ALLOWLIST = {
  phone: "9999999001",
  address: "221B Probe Street",
  city: "Probeville",
  state: "Probe State",
  pincode: "999999",
  emergency_contact_name: "C1 Probe Contact",
  emergency_contact_phone: "9999999002",
  emergency_contact_relation: "friend",
  employee_bio: "C1 probe bio",
  linkedin_url: "https://linkedin.com/in/c1-probe",
  profile_photo_url: "https://example.test/c1-probe.png",
  blood_group: "O+",
};

function setupFixture() {
  runSql(`
    INSERT INTO auth.users(id,email,password,email_verified,metadata) VALUES
      ('${manager.userId}'::uuid,${q(manager.email)},crypt(${q(password)},gen_salt('bf',10)),true,
       ${q(JSON.stringify({ role: "employee", tenant_id: companyA }))}::jsonb),
      ('${onboarding.userId}'::uuid,${q(onboarding.email)},crypt(${q(password)},gen_salt('bf',10)),true,
       ${q(JSON.stringify({ role: "employee", tenant_id: companyA }))}::jsonb);
    INSERT INTO public.employees(id,user_id,tenant_id,full_name,email,status) VALUES
      ('${manager.employeeId}'::uuid,'${manager.userId}'::uuid,'${companyA}'::uuid,'C1 Manager Fixture',${q(manager.email)},'active'),
      ('${onboarding.employeeId}'::uuid,'${onboarding.userId}'::uuid,'${companyA}'::uuid,'C1 Onboarding Fixture',${q(onboarding.email)},'active');
    INSERT INTO public.tenant_memberships(tenant_id,user_id,employee_id,status) VALUES
      ('${companyA}'::uuid,'${manager.userId}'::uuid,'${manager.employeeId}'::uuid,'active'),
      ('${companyA}'::uuid,'${onboarding.userId}'::uuid,'${onboarding.employeeId}'::uuid,'active');
    INSERT INTO public.membership_template_assignments(membership_id,tenant_id,template_key,is_active) VALUES
      ('${manager.membershipId}'::uuid,'${companyA}'::uuid,'employee',true),
      ('${manager.membershipId}'::uuid,'${companyA}'::uuid,'manager',true),
      ('${onboarding.membershipId}'::uuid,'${companyA}'::uuid,'employee',true);
    -- Onboarding fixture starts with an OPEN progress row (completed_at NULL), matching what
    -- OnboardingWizard.tsx's fetchProgressAndEmployee() creates on first visit.
    INSERT INTO public.employee_onboarding_self(tenant_id,employee_id,section_personal,section_bank,section_documents,section_emergency) VALUES
      ('${companyA}'::uuid,'${onboarding.employeeId}'::uuid,false,false,false,false);
  `);
}

function teardownFixture(requestIds) {
  const idList = requestIds.filter(Boolean).map((id) => `'${id}'::uuid`).join(",");
  runSql(`
    ${idList ? `DELETE FROM public.notifications WHERE tenant_id='${companyA}'::uuid AND reference_id IN (${idList});` : ""}
    ${idList ? `DELETE FROM public.new_hire_requests WHERE id IN (${idList});` : ""}
    DELETE FROM public.new_hire_requests WHERE tenant_id='${companyA}'::uuid AND requested_by IN ('${manager.employeeId}'::uuid,'${onboarding.employeeId}'::uuid);
    DELETE FROM public.employee_onboarding_self WHERE employee_id IN ('${manager.employeeId}'::uuid,'${onboarding.employeeId}'::uuid);
    DELETE FROM public.membership_template_assignments WHERE membership_id IN ('${manager.membershipId}'::uuid,'${onboarding.membershipId}'::uuid);
    DELETE FROM public.tenant_memberships WHERE id IN ('${manager.membershipId}'::uuid,'${onboarding.membershipId}'::uuid);
    DELETE FROM public.employees WHERE id IN ('${manager.employeeId}'::uuid,'${onboarding.employeeId}'::uuid);
    DELETE FROM auth.users WHERE id IN ('${manager.userId}'::uuid,'${onboarding.userId}'::uuid);
  `);
}

// --- D1/D2 probes against employee.a's own row (restore-and-assert, per the lead's probe) ---

async function probeSteadyState(employeeClient) {
  // employee.a is a steady-state active employee (not mid onboarding). Give it a CLOSED
  // onboarding record for the duration of this probe so the D2 window carve-out cannot mask a
  // D1 regression -- employee.a had no employee_onboarding_self row at all before this test
  // (measured live), so the whole row is inserted here and deleted in `finally`, restoring
  // employee.a to exactly its original state.
  runSql(`
    INSERT INTO public.employee_onboarding_self(tenant_id,employee_id,section_personal,section_bank,section_documents,section_emergency,completed_at)
      VALUES ('${companyA}'::uuid,'${employeeA.employeeId}'::uuid,true,true,true,true,now())
      ON CONFLICT (tenant_id,employee_id) DO UPDATE SET completed_at = now();
  `);
  try {
    const hrOnlyCols = Object.keys({ ...HR_ONLY_STEADY_STATE, ...ONBOARDING_WINDOW_COLUMNS });
    const before = runSql(`SELECT ${hrOnlyCols.join(",")} FROM public.employees WHERE id='${employeeA.employeeId}'`).rows[0];
    try {
      for (const [col, val] of Object.entries({ ...HR_ONLY_STEADY_STATE, ...ONBOARDING_WINDOW_COLUMNS })) {
        const res = await employeeClient.database.from("employees").update({ [col]: val }).eq("id", employeeA.employeeId).select(col);
        denied(res, `employee.a self-write HR-only column "${col}"`);
      }
    } finally {
      const sets = hrOnlyCols.map((k) => `${k}=${before[k] === null ? "NULL" : q(before[k])}`).join(",");
      runSql(`UPDATE public.employees SET ${sets} WHERE id='${employeeA.employeeId}'`);
      const after = runSql(`SELECT ${hrOnlyCols.join(",")} FROM public.employees WHERE id='${employeeA.employeeId}'`).rows[0];
      assert.deepEqual(after, before, "employee.a HR-only columns not restored");
      console.log(`RESTORED (HR-only columns): ${JSON.stringify(after) === JSON.stringify(before)}`);
    }

    const contactCols = Object.keys(CONTACT_ALLOWLIST);
    const beforeContact = runSql(`SELECT ${contactCols.join(",")} FROM public.employees WHERE id='${employeeA.employeeId}'`).rows[0];
    try {
      for (const [col, val] of Object.entries(CONTACT_ALLOWLIST)) {
        const res = await employeeClient.database.from("employees").update({ [col]: val }).eq("id", employeeA.employeeId).select(col);
        const data = allowed(res, `employee.a self-write allowlisted column "${col}"`);
        assert.equal(data?.[0]?.[col], val);
      }
    } finally {
      const sets = contactCols.map((k) => `${k}=${beforeContact[k] === null ? "NULL" : q(beforeContact[k])}`).join(",");
      runSql(`UPDATE public.employees SET ${sets} WHERE id='${employeeA.employeeId}'`);
      const afterContact = runSql(`SELECT ${contactCols.join(",")} FROM public.employees WHERE id='${employeeA.employeeId}'`).rows[0];
      assert.deepEqual(afterContact, beforeContact, "employee.a contact columns not restored");
      console.log(`RESTORED (contact columns): ${JSON.stringify(afterContact) === JSON.stringify(beforeContact)}`);
    }
  } finally {
    // Restore employee.a to its measured original state: no employee_onboarding_self row.
    runSql(`DELETE FROM public.employee_onboarding_self WHERE employee_id='${employeeA.employeeId}'::uuid`);
  }
}

async function probeHrUnaffected(hrClient) {
  const cols = ["work_mode", "grade_id", "account_number"];
  const values = { work_mode: "remote", grade_id: null, account_number: "c1-hr-probe-account_number" };
  const before = runSql(`SELECT ${cols.join(",")} FROM public.employees WHERE id='${employeeA.employeeId}'`).rows[0];
  try {
    for (const col of cols) {
      const res = await hrClient.database.from("employees").update({ [col]: values[col] }).eq("id", employeeA.employeeId).select(col);
      allowed(res, `HR writes ${col} on employee.a`);
    }
  } finally {
    const sets = cols.map((k) => `${k}=${before[k] === null ? "NULL" : q(before[k])}`).join(",");
    runSql(`UPDATE public.employees SET ${sets} WHERE id='${employeeA.employeeId}'`);
    const after = runSql(`SELECT ${cols.join(",")} FROM public.employees WHERE id='${employeeA.employeeId}'`).rows[0];
    assert.deepEqual(after, before, "HR probe columns not restored");
    console.log(`RESTORED (HR probe columns): ${JSON.stringify(after) === JSON.stringify(before)}`);
  }
}

// D2: while employee_onboarding_self.completed_at IS NULL, the onboarding-window columns are
// writable by the employee; once completed_at is set, they revert to HR-only.
async function probeOnboardingWindow(onboardingClient) {
  const measuredStatus = runSql(`SELECT status FROM public.employees WHERE id='${onboarding.employeeId}'`).rows[0].status;
  console.log(`Onboarding fixture employees.status while mid-onboarding: ${measuredStatus}`);

  for (const [col, val] of Object.entries(ONBOARDING_WINDOW_COLUMNS)) {
    const res = await onboardingClient.database.from("employees").update({ [col]: val }).eq("id", onboarding.employeeId).select(col);
    const data = allowed(res, `onboarding-open employee self-writes "${col}"`);
    assert.equal(data?.[0]?.[col], val);
  }

  // Contact allowlist columns remain unconditionally writable during onboarding too.
  const contactRes = await onboardingClient.database.from("employees").update({ phone: "9999999003" }).eq("id", onboarding.employeeId).select("phone");
  allowed(contactRes, "onboarding-open employee self-writes contact column phone");

  // Complete onboarding (mirrors OnboardingWizard.tsx saveEmergencyAndFinish()).
  runSql(`UPDATE public.employee_onboarding_self SET completed_at = now() WHERE employee_id='${onboarding.employeeId}'::uuid`);

  for (const [col, val] of Object.entries(ONBOARDING_WINDOW_COLUMNS)) {
    // A value of the right type but different from what was just written, so the trigger's
    // own Forbidden check is what rejects it -- not an incidental type-cast error.
    const postVal = col === "date_of_birth" ? "2000-01-01" : `${val}-post`;
    const res = await onboardingClient.database.from("employees").update({ [col]: postVal }).eq("id", onboarding.employeeId).select(col);
    denied(res, `post-onboarding employee self-write "${col}" now denied`);
  }
}

// D3: new-hire requests.
async function probeNewHireRequests(clients) {
  const requestIds = [];
  try {
    // A plain employee (no manager grant) cannot submit, and cannot insert into employees at all.
    denied(
      await clients.employee.database.rpc("c1_submit_new_hire_request", { p_name: "C1 Denied Hire", p_email: "c1-denied@example.test" }),
      "plain employee.a submits new hire request",
    );
    denied(
      await clients.employee.database.from("employees").insert({
        tenant_id: companyA, full_name: "C1 Direct Insert", email: "c1-direct-insert@example.test", status: "inactive",
      }),
      "plain employee.a inserts directly into employees",
    );

    // A manager can submit.
    const submitRes = allowed(
      await clients.manager.database.rpc("c1_submit_new_hire_request", {
        p_name: "C1 New Hire Approve", p_email: "c1-approve@example.test", p_proposed_date_of_joining: "2026-10-01",
      }),
      "manager submits new hire request",
    );
    const requestId = submitRes;
    assert.ok(requestId, "submit did not return a request id");
    requestIds.push(requestId);

    // HR was notified exactly once, keyed on employee_id (never user_id).
    const notifs = rows(runSql(`SELECT employee_id, user_id FROM public.notifications WHERE reference_id='${requestId}'::uuid`));
    assert.equal(notifs.length, 1, `expected exactly one HR notification, got ${notifs.length}`);
    assert.equal(notifs[0].employee_id, hrA.employeeId);
    assert.equal(notifs[0].user_id, null, "notifications.user_id must never be set");
    console.log(`PASS HR notified once, keyed on employee_id: ${JSON.stringify(notifs[0])}`);

    // The requester sees its own request (RLS select-own); a bystander employee does not.
    const ownRead = allowed(
      await clients.manager.database.from("new_hire_requests").select("status").eq("id", requestId),
      "manager reads own new hire request",
    );
    assert.equal(ownRead[0]?.status, "pending");
    const bystanderRead = await clients.employee.database.from("new_hire_requests").select("id").eq("id", requestId);
    assert.equal(bystanderRead.error, null, fp(bystanderRead.error));
    assert.equal(bystanderRead.data.length, 0, "employee.a unexpectedly read another employee's new hire request");
    console.log("PASS new_hire_requests: employee.a SELECT of manager's request: 0 rows (denied)");

    // A plain employee cannot review, HR-only.
    denied(
      await clients.employee.database.rpc("c1_review_new_hire_request", { p_request_id: requestId, p_approved: true }),
      "plain employee.a reviews new hire request",
    );

    // HR approves. Approval does NOT create the employee.
    const empCountBefore = rows(runSql(`SELECT count(*)::integer AS n FROM public.employees WHERE tenant_id='${companyA}'::uuid`))[0].n;
    allowed(
      await clients.hr.database.rpc("c1_review_new_hire_request", { p_request_id: requestId, p_approved: true }),
      "HR approves new hire request",
    );
    const empCountAfter = rows(runSql(`SELECT count(*)::integer AS n FROM public.employees WHERE tenant_id='${companyA}'::uuid`))[0].n;
    assert.equal(empCountAfter, empCountBefore, "approval must not create an employees row by itself");
    console.log(`PASS approval does not auto-create an employee (count unchanged at ${empCountAfter})`);

    const approvedRow = rows(runSql(`SELECT status, reviewed_by FROM public.new_hire_requests WHERE id='${requestId}'::uuid`))[0];
    assert.equal(approvedRow.status, "approved");
    assert.equal(approvedRow.reviewed_by, hrA.employeeId);

    // The requester sees the updated status.
    const ownReadAfter = allowed(
      await clients.manager.database.from("new_hire_requests").select("status").eq("id", requestId),
      "manager reads own request after approval",
    );
    assert.equal(ownReadAfter[0]?.status, "approved");

    // A second review of an already-decided request fails (race/idempotency guard).
    denied(
      await clients.hr.database.rpc("c1_review_new_hire_request", { p_request_id: requestId, p_approved: false }),
      "HR re-reviews an already-approved request",
    );

    // Reject path, with a reason recorded and visible to the requester.
    const rejectSubmit = allowed(
      await clients.manager.database.rpc("c1_submit_new_hire_request", { p_name: "C1 New Hire Reject", p_email: "c1-reject@example.test" }),
      "manager submits second new hire request",
    );
    const rejectId = rejectSubmit;
    requestIds.push(rejectId);
    allowed(
      await clients.hr.database.rpc("c1_review_new_hire_request", { p_request_id: rejectId, p_approved: false, p_reason: "Headcount frozen" }),
      "HR rejects second new hire request",
    );
    const rejectedRow = rows(runSql(`SELECT status, reason FROM public.new_hire_requests WHERE id='${rejectId}'::uuid`))[0];
    assert.equal(rejectedRow.status, "rejected");
    assert.equal(rejectedRow.reason, "Headcount frozen");
    console.log("PASS reject path records reason and status");
  } finally {
    return requestIds;
  }
}

await guardedMutation("C1 disposable fixture", async () => {
  const key = anonKey();
  const clients = {
    employee: await signIn(employeeA, key),
    hr: await signIn(hrA, key),
    crossTenant: await signIn(employeeB, key),
  };

  await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });

  let requestIds = [];
  try {
    setupFixture();
    clients.manager = await signIn(manager, key);
    clients.onboarding = await signIn(onboarding, key);
    await rlsInvariant(clients, { employee: 1, hr: 4, crossTenant: 0 });

    await probeSteadyState(clients.employee);
    await probeHrUnaffected(clients.hr);
    await probeOnboardingWindow(clients.onboarding);
    requestIds = await probeNewHireRequests(clients);
  } finally {
    teardownFixture(requestIds);
    await rlsInvariant({ employee: clients.employee, hr: clients.hr, crossTenant: clients.crossTenant }, { employee: 1, hr: 2, crossTenant: 0 });
  }
});
