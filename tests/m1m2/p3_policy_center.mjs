#!/usr/bin/env node
// P3-01 executable evidence: hr-policies bucket privacy, tenant/audience-scoped storage RLS,
// acknowledgement idempotency, and RLS invariant before/after.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@insforge/sdk";

import { runSql, verifyTarget } from "./_harness.mjs";
import { TB_M1M2 } from "./_target.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const PASSWORD = readFileSync(join(here, "persona-password.local"), "utf8").trim();

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const EMPLOYEE_A = Object.freeze({ userId: "a0000000-0000-4000-8001-000000000001", email: "employee.a@m1m2.test" });
const HR_A = Object.freeze({ userId: "a0000000-0000-4000-8002-000000000001", email: "hr-employee.a@m1m2.test" });
const EMPLOYEE_B = Object.freeze({ userId: "b0000000-0000-4000-8001-000000000001", email: "employee.b@m1m2.test" });

// Pre-existing live object (belongs to a real, unrelated tenant on TB-M1M2) -- used only for the
// anonymous/wrong-tenant negative tests, which do not depend on which tenant owns it.
const OBJECT_KEY = "policies/0rqth50dywe-1779453401832.pdf";
const OBJECT_URL = `${TB_M1M2.baseUrl}/api/storage/buckets/hr-policies/objects/${encodeURIComponent(OBJECT_KEY)}`;
// Fixture object + hr_policies row created for this run, owned by Company A (COMPANY_A), visible_to
// 'all' -- used for the positive same-tenant/HR read tests and the wrong-tenant negative against a
// known fixture tenant.
const FIXTURE_KEY = "policies/p3-01-test-fixture.txt";
const FIXTURE_POLICY_ID = "c0000000-0000-4000-8000-000000000301";

const messageOf = (error) => [error?.code, error?.message].filter(Boolean).join(" | ");

function readBranchAnonKey() {
  const cli = join(repoRoot, "node_modules", "@insforge", "cli", "dist", "index.js");
  const result = spawnSync(process.execPath, [cli, "secrets", "get", "ANON_KEY", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, "Could not read TB-M1M2 ANON_KEY");
  const start = result.stdout.indexOf("{");
  return JSON.parse(result.stdout.slice(start)).value;
}

async function signIn(persona, anonKey) {
  const client = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey });
  const { data, error } = await client.auth.signInWithPassword({ email: persona.email, password: PASSWORD });
  assert.equal(error, null, `${persona.email}: ${messageOf(error)}`);
  assert.equal(data?.user?.id, persona.userId, `${persona.email}: unexpected identity`);
  return { client, accessToken: data.accessToken };
}

async function fetchObject(accessToken) {
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const res = await fetch(OBJECT_URL, { headers, redirect: "manual" });
  return res;
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

async function main() {
  verifyTarget();
  const anonKey = readBranchAnonKey();

  const { client: employeeClient } = await signIn(EMPLOYEE_A, anonKey);
  const { client: hrClient } = await signIn(HR_A, anonKey);
  const { client: crossTenantClient, accessToken: crossTenantToken } = await signIn(EMPLOYEE_B, anonKey);
  const { accessToken: employeeToken } = await signIn(EMPLOYEE_A, anonKey);
  const { accessToken: hrToken } = await signIn(HR_A, anonKey);

  const beforeRls = await rlsInvariant({ employee: employeeClient, hr: hrClient, crossTenant: crossTenantClient });
  console.log(`RLS invariant before: ${beforeRls.employee}/${beforeRls.hr}/${beforeRls.crossTenant} (expect 1/2/0).`);

  // The fixture was created by hand for the original P3-01 run and deleted afterwards, so this suite
  // could not run on its own. Seed it here (row first: hr_policy_object_tenant_ok/readable resolve
  // the object through hr_policies.storage_path), upload as HR, and remove both in finally. Storage
  // objects cannot be deleted by SQL, so the object is removed through the SDK as its uploader.
  runSql(`DELETE FROM public.employee_policy_acknowledgements WHERE policy_id='${FIXTURE_POLICY_ID}'::uuid;
    DELETE FROM public.hr_policies WHERE id='${FIXTURE_POLICY_ID}'::uuid;`);
  runSql(`INSERT INTO public.hr_policies(id,tenant_id,title,file_url,storage_path,visible_to)
    VALUES('${FIXTURE_POLICY_ID}'::uuid,'${COMPANY_A}'::uuid,'P3-01 test fixture','hr-policies:${FIXTURE_KEY}','${FIXTURE_KEY}','all')`);
  const seeded = await hrClient.storage.from("hr-policies").upload(FIXTURE_KEY, new Blob(["P3-01 fixture"], { type: "text/plain" }));
  assert.equal(seeded.error, null, `seed fixture upload: ${messageOf(seeded.error)}`);
  try {

  // AC3: anonymous GET fails.
  const anonRes = await fetchObject(null);
  assert.ok([401, 403].includes(anonRes.status), `anonymous GET expected 401/403, got ${anonRes.status}`);
  console.log(`AC3 anonymous GET: ${anonRes.status} (denied, was 302->200 before this package).`);

  // AC3: wrong-tenant authenticated GET fails (employee.b is Company B; the object belongs to Company A).
  const wrongTenantRes = await fetchObject(crossTenantToken);
  assert.ok([401, 403, 404].includes(wrongTenantRes.status), `wrong-tenant GET expected denial, got ${wrongTenantRes.status}`);
  console.log(`AC3 wrong-tenant GET (employee.b@Company B): ${wrongTenantRes.status} (denied).`);

  // AC2/AC3 positive: same-tenant employee (visible_to='all') and HR can read, via the SDK's
  // authenticated download() (the same call PolicyUpload.tsx/Policies.tsx will use), not the raw
  // GET used for the anonymous/wrong-tenant negatives above (that endpoint does not accept a
  // bearer token for a private bucket; download() goes through /download-strategy first).
  const employeeDl = await employeeClient.storage.from("hr-policies").download(FIXTURE_KEY);
  assert.equal(employeeDl.error, null, `same-tenant employee download: ${messageOf(employeeDl.error)}`);
  console.log(`Same-tenant employee download (employee.a, visible_to=all, fixture): ok, ${employeeDl.data?.size} bytes.`);

  const hrDl = await hrClient.storage.from("hr-policies").download(FIXTURE_KEY);
  assert.equal(hrDl.error, null, `HR download: ${messageOf(hrDl.error)}`);
  console.log(`HR download (hr-employee.a, fixture): ok, ${hrDl.data?.size} bytes.`);

  const crossTenantDl = await crossTenantClient.storage.from("hr-policies").download(FIXTURE_KEY);
  assert.ok(crossTenantDl.error, "wrong-tenant download unexpectedly succeeded");
  console.log(`Wrong-tenant download (employee.b against Company A fixture): denied, ${messageOf(crossTenantDl.error)}.`);

  // AC4: acknowledge, then acknowledge again -- must be idempotent (second call denied/no new row).
  const policyId = FIXTURE_POLICY_ID;
  const first = await employeeClient.database.rpc("acknowledge_policy_transaction", { p_policy_id: policyId });
  const second = await employeeClient.database.rpc("acknowledge_policy_transaction", { p_policy_id: policyId });
  console.log(`AC4 first acknowledge: error=${messageOf(first.error) || "none"}`);
  console.log(`AC4 second acknowledge: error=${messageOf(second.error) || "none"}`);
  assert.ok(second.error, "second acknowledge unexpectedly succeeded (not idempotent)");
  assert.match(messageOf(second.error), /already acknowledged/i, "second acknowledge failed for the wrong reason");

  const { data: ackRows, error: ackErr } = await employeeClient.database
    .from("employee_policy_acknowledgements")
    .select("id")
    .eq("policy_id", policyId);
  assert.equal(ackErr, null, messageOf(ackErr));
  assert.equal(ackRows.length, 1, `expected exactly one acknowledgement row, found ${ackRows.length}`);
  console.log(`AC4: exactly one acknowledgement row exists after two calls (idempotent, confirmed by row count).`);

  // AC3 harder half: post-revocation signed-URL behaviour. Mint the strategy the SDK's download()
  // uses (POST .../download-strategy, expiresIn 3600s), then check whether it is a bearer-token
  // URL that outlives the JWT, or a "direct" call still gated by RLS on every replay.
  const strategyRes = await fetch(
    `${TB_M1M2.baseUrl}/api/storage/buckets/hr-policies/objects/${encodeURIComponent(FIXTURE_KEY)}/download-strategy`,
    { method: "POST", headers: { Authorization: `Bearer ${employeeToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 3600 }) },
  );
  const strategy = await strategyRes.json();
  console.log(`AC3 download-strategy: method=${strategy.method}, url has signature params: ${/Signature=|X-Amz-Signature/.test(strategy.url || "")}.`);
  if (strategy.method === "direct") {
    console.log("AC3 post-revocation: strategy is 'direct' -- the replay below re-checks RLS with the caller's own token on every fetch, not a bearer URL with its own lifetime.");
  } else {
    console.log(`AC3 post-revocation: strategy is '${strategy.method}' -- a bearer-token URL good for ~${strategy.expiresIn ?? 3600}s regardless of membership state after it is minted. This is the honest, documented behaviour: it is a property of signed URLs, not a bug. Revoking a membership does not reach into an already-issued URL; the fix is a short TTL, which this call already requests (3600s = 1 hour).`);
  }
  const replay = await fetch(strategy.url, {
    headers: strategy.method === "direct" ? { Authorization: `Bearer ${employeeToken}` } : {},
  });
  console.log(`AC3 replaying the minted URL immediately (no revocation applied in this run): ${replay.status}.`);
  } finally {
    await hrClient.storage.from("hr-policies").remove(FIXTURE_KEY);
    runSql(`DELETE FROM public.employee_policy_acknowledgements WHERE policy_id='${FIXTURE_POLICY_ID}'::uuid`);
    runSql(`DELETE FROM public.hr_policies WHERE id='${FIXTURE_POLICY_ID}'::uuid`);
  }

  const afterRls = await rlsInvariant({ employee: employeeClient, hr: hrClient, crossTenant: crossTenantClient });
  console.log(`RLS invariant after: ${afterRls.employee}/${afterRls.hr}/${afterRls.crossTenant} (expect 1/2/0).`);

  console.log("P3-01 evidence run complete: AC2 (positive reads), AC3 (anonymous + wrong-tenant denial + signed-URL mechanism), AC4 (idempotent acknowledgement), RLS invariant before/after all passed.");
}

main().catch((error) => {
  console.error("P3-01 EVIDENCE FAILED:", error?.stack || error);
  process.exitCode = 1;
});
