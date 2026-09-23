#!/usr/bin/env node
// C9 -- storage write fences. The global PERMISSIVE storage_objects_owner_insert lets any
// authenticated user insert into any bucket that has no RESTRICTIVE write fence. employee.a probes
// every bucket at the tenant root; legitimate writers (employee selfie in own folder, HR company
// logo / insurance document / payslip) are exercised. Every object created is removed.
// Conventions follow c6_p3_residuals.mjs. RLS invariant 1/2/0 before and after.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const employeeA = { email: "employee.a@m1m2.test", userId: "a0000000-0000-4000-8001-000000000001", employeeId: "a0000000-0000-4000-8001-000000000002" };
const hrA = { email: "hr-employee.a@m1m2.test", userId: "a0000000-0000-4000-8002-000000000001", employeeId: "a0000000-0000-4000-8002-000000000002" };
const employeeB = { email: "employee.b@m1m2.test", userId: "b0000000-0000-4000-8001-000000000001" };
const TAG = `c9-${randomUUID().slice(0, 8)}`;

// Buckets an employee must NOT be able to write at the tenant root (measured open before C9).
const CLOSED_TO_EMPLOYEE = ["application-snapshots", "attendance-selfies", "avatars", "company-assets", "company-logos",
  "insurance-documents", "payslips", "recruiter_documents", "resumes"];

const fp = (error) => [error?.code ?? error?.statusCode, error?.message].filter(Boolean).join(" | ");
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
    const { data, error } = await client.database.from("employees").select("id").eq("tenant_id", A);
    assert.equal(error, null, `${name} employees: ${fp(error)}`);
    counts[name] = data.length;
  }
  assert.deepEqual(counts, expected);
  console.log(`RLS Company A employees (${Object.keys(counts).join(" / ")}): ${Object.values(counts).join(" / ")}`);
}
async function warm(client) {
  const { error } = await client.database.from("tenants").select("id").limit(1);
  if (error && /fetch failed/i.test(error.message ?? "")) console.log("NOTE warm-up absorbed a dropped keep-alive socket");
}
const exists = (bucket, key) => Number(runSql(`SELECT count(*)::int n FROM storage.objects WHERE bucket='${bucket}' AND key='${key}'`).rows[0].n) === 1;
const blob = (text, type = "text/plain") => new Blob([text], { type });
const created = []; // [client, bucket, key]

async function tryUpload(client, bucket, key, type) {
  await warm(client);
  const r = await client.storage.from(bucket).upload(key, blob(TAG, type));
  const made = exists(bucket, key);
  if (made) created.push([client, bucket, key]);
  return { made, error: r.error };
}

await guardedMutation("C9 disposable fixture", async () => {
  const key = anonKey();
  const clients = { employee: await signIn(employeeA, key), hr: await signIn(hrA, key), crossTenant: await signIn(employeeB, key) };
  await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });
  const emp = clients.employee, hr = clients.hr;
  try {
    // 1. employee at the tenant root of every previously-open bucket
    for (const bucket of CLOSED_TO_EMPLOYEE) {
      const r = await tryUpload(emp, bucket, `${A}/${TAG}-root.txt`);
      check(!r.made, `employee upload into ${bucket} at tenant root -> ${r.made ? "CREATED" : "DENIED " + fp(r.error)}`);
    }

    // 2. attendance selfies: own folder yes, a colleague's folder no
    const own = `${A}/${employeeA.employeeId}/${randomUUID()}/punch_in.jpg`;
    let r = await tryUpload(emp, "attendance-selfies", own, "image/jpeg");
    check(r.made, `employee selfie in own folder (PunchInOut path) -> ${r.made ? "ALLOWED" : fp(r.error)}`);
    r = await tryUpload(emp, "attendance-selfies", `${A}/${hrA.employeeId}/${randomUUID()}/punch_in.jpg`, "image/jpeg");
    check(!r.made, `employee selfie in a colleague's folder -> ${r.made ? "CREATED" : "DENIED"}`);
    if (exists("attendance-selfies", own)) {
      await warm(emp);
      await emp.storage.from("attendance-selfies").remove(own);   // PunchInOut removes its own upload on failure
      check(!exists("attendance-selfies", own), "employee removes own selfie upload");
    }

    // 3. HR writers
    for (const [bucket, k, label] of [
      ["company-assets", `${A}/logo-${TAG}.png`, "company logo (Settings / PolicyCenter)"],
      ["insurance-documents", `${A}/${employeeA.employeeId}/${TAG}.pdf`, "insurance document (HR Insurance)"],
      ["payslips", `${A}/${employeeA.employeeId}/${TAG}.pdf`, "payslip (payroll, hidden)"],
    ]) {
      r = await tryUpload(hr, bucket, k);
      check(r.made, `HR uploads ${label} -> ${r.made ? "ALLOWED" : fp(r.error)}`);
      if (r.made) {
        await warm(hr);
        await hr.storage.from(bucket).remove(k);
        check(!exists(bucket, k), `HR removes it from ${bucket}`);
      }
    }
  } finally {
    for (const [client, bucket, k] of created) {
      if (exists(bucket, k)) { await warm(client); await client.storage.from(bucket).remove(k); }
    }
    const left = Number(runSql(`SELECT count(*)::int n FROM storage.objects WHERE key LIKE '%${TAG}%'`).rows[0].n);
    console.log(`Storage residue for ${TAG}: ${left}`);
    for (const c of Object.values(clients)) await warm(c);
    await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });
  }
  const failed = results.filter((l) => l.startsWith("FAIL"));
  console.log(`\nC9: ${results.length - failed.length}/${results.length} PASS`);
  assert.equal(failed.length, 0, `C9 failures:\n${failed.join("\n")}`);
});
