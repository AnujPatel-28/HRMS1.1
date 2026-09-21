#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@insforge/sdk";
import { verifyTarget } from "./_harness.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMPANY_A_TENANT_ID = "a0000000-0000-4000-8000-000000000001";
const TARGET_BASE_URL = "https://rq3qmu8y-j9g.ap-southeast.insforge.app";

const personas = [
  {
    email: "employee.a@m1m2.test",
    userId: "a0000000-0000-4000-8001-000000000001",
    tenantId: COMPANY_A_TENANT_ID,
    expectedCompanyARows: 1,
    responsibilities: ["employee"],
  },
  {
    email: "hr-employee.a@m1m2.test",
    userId: "a0000000-0000-4000-8002-000000000001",
    tenantId: COMPANY_A_TENANT_ID,
    expectedCompanyARows: 2,
    responsibilities: ["employee", "hr_admin"],
  },
  {
    email: "employee.b@m1m2.test",
    userId: "b0000000-0000-4000-8001-000000000001",
    tenantId: "b0000000-0000-4000-8000-000000000002",
    expectedCompanyARows: 0,
    responsibilities: ["employee"],
  },
];

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
  const payload = JSON.parse(result.stdout.slice(start));
  assert.equal(payload.key, "ANON_KEY");
  assert.equal(typeof payload.value, "string");
  assert.ok(payload.value.length > 0);
  return payload.value;
}

function derivedMembershipId(tenantId, userId) {
  const hex = createHash("md5").update(`${tenantId}:${userId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertNoError(result, label) {
  assert.equal(result.error, null, `${label}: ${result.error?.message ?? "unknown error"}`);
  return result.data;
}

function errorFingerprint(error) {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(" | ");
}

function assertFrozenWire(summary, persona) {
  const expectedKeys = [
    "accessVersion",
    "contractVersion",
    "employeeId",
    "enabledModules",
    "grants",
    "issuedAt",
    "membershipId",
    "membershipStatus",
    "responsibilities",
    "tenantId",
    "unavailableReason",
  ];
  assert.deepEqual(Object.keys(summary).sort(), expectedKeys, `${persona.email}: wire keys drifted`);
  assert.equal(summary.contractVersion, "v0.5");
  assert.equal(summary.tenantId, persona.tenantId);
  assert.equal(summary.membershipId, derivedMembershipId(persona.tenantId, persona.userId));
  assert.equal(summary.membershipStatus, "active");
  assert.equal(typeof summary.employeeId, "string");
  assert.equal(Number.isInteger(summary.accessVersion), true);
  assert.deepEqual(summary.responsibilities, persona.responsibilities);
  assert.equal(summary.unavailableReason, null);
  assert.equal(Number.isNaN(Date.parse(summary.issuedAt)), false);
  // P3-02b: project/channel scopes are now advertised, but only for a current explicit
  // membership (contracts.md v0.5 §16). None of these three fixed personas holds a project or
  // channel membership, so the count stays zero here — that is still an empirical fact, just no
  // longer a blanket architectural ban. What IS still a wire-shape invariant: scopeId is present
  // if and only if the scope is project/channel (never `"scopeId": null` on a company/self/
  // direct_reports grant — that would fail AuthContext's ~99-104 validation for every user).
  const scopedGrants = summary.grants.filter((grant) => ["project", "channel"].includes(grant.scopeType));
  assert.equal(scopedGrants.length, 0, `${persona.email}: unexpected project/channel grants for a persona with no project/channel membership`);
  assert.equal(
    summary.grants.every((grant) => ["project", "channel"].includes(grant.scopeType) === Object.hasOwn(grant, "scopeId")),
    true,
    `${persona.email}: scopeId must be present iff scopeType is project/channel`,
  );
  assert.equal(summary.enabledModules.includes("payroll"), false);
  assert.equal(summary.enabledModules.includes("insurance"), false);
  assert.equal(summary.grants.some((grant) => grant.action.includes("payroll") || grant.action.includes("insurance")), false);
}

async function signIn(persona, anonKey, password) {
  const client = createClient({ baseUrl: TARGET_BASE_URL, anonKey });
  const login = await client.auth.signInWithPassword({ email: persona.email, password });
  const user = assertNoError(login, `${persona.email}: login`)?.user;
  assert.equal(user?.id, persona.userId, `${persona.email}: unexpected authenticated identity`);
  return client;
}

async function countRows(client, table, tenantId) {
  const rows = assertNoError(
    await client.database.from(table).select("id").eq("tenant_id", tenantId),
    `${table} read`,
  );
  return rows?.length ?? 0;
}

function assertStaticPresentationContract() {
  const authContext = readFileSync(join(repoRoot, "src", "contexts", "AuthContext.tsx"), "utf8");
  assert.match(authContext, /const canAccessMyWork =/);
  assert.match(authContext, /const canAccessTeam =/);
  assert.match(authContext, /const canAccessAdministration =/);

  const app = readFileSync(join(repoRoot, "src", "App.tsx"), "utf8");
  assert.match(app, /RequireTenantSurface surface="my_work"/);
  assert.match(app, /RequireTenantSurface surface="team"/);
  assert.match(app, /RequireTenantSurface surface="administration"/);

  const employeeLayout = readFileSync(join(repoRoot, "src", "employee", "EmployeeLayout.tsx"), "utf8");
  assert.match(employeeLayout, /if \(canAccessTeam\)/);
  assert.match(employeeLayout, /if \(canAccessAdministration\)/);

  const hrLayout = readFileSync(join(repoRoot, "src", "hr", "HRLayout.tsx"), "utf8");
  assert.match(hrLayout, /label: "My Work"/);
  assert.match(hrLayout, /label: "Team"/);

  const directory = readFileSync(join(repoRoot, "src", "hr", "Directory.tsx"), "utf8");
  assert.match(directory, /hasGrant\("employee\.basic\.read", "company"\)/);
  assert.match(directory, /hasGrant\("employee\.basic\.read", "direct_reports"\)/);
  const modules = readFileSync(join(repoRoot, "src", "modules.ts"), "utf8");
  for (const [routePrefix, moduleKey] of [
    ["/payroll", "payroll"],
    ["/hr/insurance", "insurance"],
    ["/employee/insurance", "insurance"],
  ]) {
    assert.ok(
      modules.includes(`["${routePrefix}", "${moduleKey}"]`),
      `missing ${moduleKey} route prefix ${routePrefix}`,
    );
  }

  for (const file of [
    join(repoRoot, "src", "hr", "HRLayout.tsx"),
    join(repoRoot, "src", "employee", "EmployeeLayout.tsx"),
    join(repoRoot, "src", "payroll", "PayrollLayout.tsx"),
    join(repoRoot, "src", "payroll", "employee", "EmployeePayrollLayout.tsx"),
  ]) {
    assert.match(readFileSync(file, "utf8"), /<RequireModule\b/);
  }

  const notifications = readFileSync(join(repoRoot, "src", "shared", "NotificationBell.tsx"), "utf8");
  assert.match(notifications, /navigate\("\/employee\/tasks"\)/);
  assert.match(notifications, /navigate\("\/employee\/leaves"\)/);

  const tenantContext = readFileSync(join(repoRoot, "src", "contexts", "TenantContext.tsx"), "utf8");
  assert.match(tenantContext, /Access temporarily unavailable\./);
  assert.match(tenantContext, />\s*Retry\s*</);
  assert.match(tenantContext, /enabledModules === null\) return false/);
}

async function main() {
  const verified = verifyTarget();
  assert.equal(verified.baseUrl, TARGET_BASE_URL);

  const anonKey = readBranchAnonKey();
  const password = readFileSync(join(repoRoot, "tests", "m1m2", "persona-password.local"), "utf8").trim();
  assert.ok(password, "persona password is missing");

  assertStaticPresentationContract();

  const results = [];
  for (const persona of personas) {
    const client = await signIn(persona, anonKey, password);
    const summary = assertNoError(
      await client.database.rpc("get_my_capability_summary"),
      `${persona.email}: capability resolver`,
    );
    assertFrozenWire(summary, persona);

    const companyARows = await countRows(client, "employees", COMPANY_A_TENANT_ID);
    assert.equal(companyARows, persona.expectedCompanyARows, `${persona.email}: Company A RLS count changed`);

    const payrollEnabled = assertNoError(
      await client.database.rpc("tenant_has_module", { p_key: "payroll" }),
      `${persona.email}: payroll entitlement`,
    );
    const insuranceEnabled = assertNoError(
      await client.database.rpc("tenant_has_module", { p_key: "insurance" }),
      `${persona.email}: insurance entitlement`,
    );
    assert.equal(payrollEnabled, false);
    assert.equal(insuranceEnabled, false);
    assert.equal(await countRows(client, "payslips", persona.tenantId), 0);
    assert.equal(await countRows(client, "payroll_runs", persona.tenantId), 0);
    assert.equal(await countRows(client, "insurance_policies", persona.tenantId), 0);

    const selfApproval = await client.database.rpc("assert_distinct_approver", {
      p_subject_user_id: persona.userId,
    });
    assert.ok(selfApproval.error, `${persona.email}: self approval unexpectedly allowed`);
    const denial = errorFingerprint(selfApproval.error);
    assert.match(denial, /P1001|SELF_APPROVAL_DENIED/);

    results.push({ persona, client, summary, companyARows, denial });
  }

  const employeeA = results[0];
  const tampered = structuredClone(employeeA.summary);
  tampered.responsibilities.push("hr_admin");
  tampered.grants.push({ action: "employee.basic.read", scopeType: "company" });
  tampered.enabledModules.push("payroll");
  const serverCompanyARows = await countRows(employeeA.client, "employees", COMPANY_A_TENANT_ID);
  const serverPayrollEnabled = assertNoError(
    await employeeA.client.database.rpc("tenant_has_module", { p_key: "payroll" }),
    "tamper check: payroll entitlement",
  );
  assert.equal(serverCompanyARows, 1);
  assert.equal(serverPayrollEnabled, false);

  const otherApproval = assertNoError(
    await results[1].client.database.rpc("assert_distinct_approver", {
      p_subject_user_id: personas[0].userId,
    }),
    "composed HR approving a distinct same-tenant subject",
  );
  assert.equal(otherApproval, true);

  console.log(`Verified target: ${verified.projectName} (${verified.projectId})`);
  for (const result of results) {
    console.log(`${result.persona.email}: Company A employees=${result.companyARows}; responsibilities=${result.summary.responsibilities.join("+")}; self-denial=${result.denial}`);
  }
  console.log(
    "AC4 tamper: locally added hr_admin + employee.basic.read:company + payroll; " +
      `server response remained Company A employees=${serverCompanyARows}, payroll enabled=${serverPayrollEnabled}.`,
  );
  console.log("P1 capability contract passed: wire, composition, scopes, exclusions, RLS counts, tamper resistance and no-self guard.");
}

main().catch((error) => {
  console.error(`P1_CAPABILITY_CONTRACT_FAILED: ${error.message}`);
  process.exitCode = 1;
});
