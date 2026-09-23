#!/usr/bin/env node
// C10 executable evidence: approve_leave_request / cancel_leave_request must authorize the caller
// BEFORE revealing anything about the leave. Found by the v0.9.0 rehearsal: a signed-in user of
// another tenant holding a leave id was told "no longer pending (current status: approved)" /
// "already cancelled" / "not found" instead of a denial.
//
// Outsider (employee.b, Company B) x {pending, approved, cancelled, nonexistent} x {approve, cancel}
// -> one identical denial (P1003 APPROVAL_SUBJECT_UNAVAILABLE) and no row change.
// Positive control: Company A HR still gets the real state message for its own tenant's leaves.
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
const EMPLOYEE_A = { userId: "a0000000-0000-4000-8001-000000000001", employeeId: "a0000000-0000-4000-8001-000000000002", email: "employee.a@m1m2.test" };
const HR_A = { userId: "a0000000-0000-4000-8002-000000000001", email: "hr-employee.a@m1m2.test" };
const EMPLOYEE_B = { userId: "b0000000-0000-4000-8001-000000000001", email: "employee.b@m1m2.test" };
const LEAVE_TYPE_CL = "a0000000-0000-4000-8006-000000000001";
const TAG = "c10-acceptance";

// Fixed test-only ids under a2a00000-... (clear of P2's a2200000/a2400000 namespaces).
const LEAVES = {
  pending: "a2a00000-0000-4000-8000-000000000001",
  approved: "a2a00000-0000-4000-8000-000000000002",
  cancelled: "a2a00000-0000-4000-8000-000000000003",
};
const NONEXISTENT = "a2a00000-0000-4000-8000-0000000000ff";
const DENIAL = /^P1003 \| APPROVAL_SUBJECT_UNAVAILABLE$/;

const messageOf = (e) => (e ? [e.code, e.message].filter(Boolean).join(" | ") : "none");

function anonKey() {
  const cli = join(repoRoot, "node_modules", "@insforge", "cli", "dist", "index.js");
  const r = spawnSync(process.execPath, [cli, "secrets", "get", "ANON_KEY", "--json"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(r.status, 0, "Could not read the target anon key; raw CLI output suppressed");
  return JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).value;
}

async function signIn(persona, key) {
  const client = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey: key });
  const { data, error } = await client.auth.signInWithPassword({ email: persona.email, password: PASSWORD });
  assert.equal(error, null, `${persona.email}: ${messageOf(error)}`);
  assert.equal(data?.user?.id, persona.userId, `${persona.email}: unexpected identity`);
  return client;
}

// One transport retry for the known idle-socket "fetch failed" (never on an application error).
async function rpc(client, name, args) {
  let r = await client.database.rpc(name, args);
  if (/fetch failed/i.test(r?.error?.message ?? "")) r = await client.database.rpc(name, args);
  return r;
}

const rowsState = () =>
  (runSql(`SELECT id::text, row_to_json(l)::text AS row FROM public.leaves l WHERE id IN ('${Object.values(LEAVES).join("','")}') ORDER BY id`).rows ?? []);

const cleanup = () => runSql(`DELETE FROM public.leaves WHERE id IN ('${Object.values(LEAVES).join("','")}')`);

await guardedMutation("C10 leave review order", async () => {
  cleanup();
  runSql(`
    INSERT INTO public.leaves (id, tenant_id, employee_id, leave_type_id, leave_type, start_date, end_date, total_days, reason, status) VALUES
    ('${LEAVES.pending}', '${COMPANY_A}', '${EMPLOYEE_A.employeeId}', '${LEAVE_TYPE_CL}', 'casual', '2026-11-16', '2026-11-16', 1, '${TAG} pending', 'pending'),
    ('${LEAVES.approved}', '${COMPANY_A}', '${EMPLOYEE_A.employeeId}', '${LEAVE_TYPE_CL}', 'casual', '2026-11-17', '2026-11-17', 1, '${TAG} approved', 'approved'),
    ('${LEAVES.cancelled}', '${COMPANY_A}', '${EMPLOYEE_A.employeeId}', '${LEAVE_TYPE_CL}', 'casual', '2026-11-18', '2026-11-18', 1, '${TAG} cancelled', 'cancelled')`);
  const before = rowsState();
  assert.equal(before.length, 3, "fixture leaves not inserted");

  const key = anonKey();
  const outsider = await signIn(EMPLOYEE_B, key);
  const hr = await signIn(HR_A, key);
  const failures = [];

  const calls = {
    approve: (id) => ({ name: "approve_leave_request", args: { p_leave_id: id, p_working_dates: null, p_approved_business_days: null } }),
    cancel: (id) => ({ name: "cancel_leave_request", args: { p_leave_id: id, p_rejection_reason: TAG, p_new_status: "cancelled" } }),
  };
  const targets = { ...LEAVES, nonexistent: NONEXISTENT };

  try {
    for (const [op, make] of Object.entries(calls)) {
      for (const [state, id] of Object.entries(targets)) {
        const { name, args } = make(id);
        const r = await rpc(outsider, name, args);
        const got = messageOf(r.error);
        const ok = !!r.error && DENIAL.test(got);
        console.log(`${ok ? "PASS" : "FAIL"} outsider ${op} ${state}: ${got}`);
        if (!ok) failures.push(`outsider ${op} ${state}: ${got}`);
      }
    }

    const after = rowsState();
    const unchanged = JSON.stringify(after) === JSON.stringify(before);
    console.log(`${unchanged ? "PASS" : "FAIL"} no fixture row changed by outsider calls`);
    if (!unchanged) failures.push("fixture rows changed");

    // Positive control: the authorized reviewer still learns the real state.
    const pos = [
      ["approve", "approved", /no longer pending \(current status: approved\)/],
      ["cancel", "cancelled", /already cancelled/],
    ];
    for (const [op, state, want] of pos) {
      const { name, args } = calls[op](LEAVES[state]);
      const got = messageOf((await rpc(hr, name, args)).error);
      const ok = want.test(got);
      console.log(`${ok ? "PASS" : "FAIL"} HR A ${op} ${state} (control): ${got}`);
      if (!ok) failures.push(`HR control ${op} ${state}: ${got}`);
    }
  } finally {
    cleanup();
  }

  assert.deepEqual(failures, [], `C10 failures:\n${failures.join("\n")}`);
  console.log("C10: all checks passed");
});
