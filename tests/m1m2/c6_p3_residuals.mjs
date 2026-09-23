#!/usr/bin/env node
// C6 -- P3 residuals + lead additions: expense self-approval, post moderation fields, HR-issued
// employee documents, colleague profile photos, acknowledgement self-writes, dead code.
// Conventions follow c5_half_day_leave.mjs. RLS invariant 1/2/0 before and after.
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

const A = "a0000000-0000-4000-8000-000000000001";
const employeeA = { email: "employee.a@m1m2.test", userId: "a0000000-0000-4000-8001-000000000001", employeeId: "a0000000-0000-4000-8001-000000000002" };
const hrA = { email: "hr-employee.a@m1m2.test", userId: "a0000000-0000-4000-8002-000000000001", employeeId: "a0000000-0000-4000-8002-000000000002" };
const employeeB = { email: "employee.b@m1m2.test", userId: "b0000000-0000-4000-8001-000000000001" };
const hrMembership = (() => {
  const hex = createHash("md5").update(`${A}:${hrA.userId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
})();

const TAG = `c6-${randomUUID().slice(0, 8)}`;
const POST = randomUUID();
const DOC_HR = `${A}/${employeeA.employeeId}/${TAG}-hr-issued.txt`;
const DOC_OWN = `${A}/${employeeA.employeeId}/${TAG}-own.txt`;
const PHOTO_OWN = `${A}/${employeeA.employeeId}/${TAG}-own.png`;
const PHOTO_HR = `${A}/${hrA.employeeId}/${TAG}-hr.png`;
const PHOTO_FORGED = `${A}/${hrA.employeeId}/${TAG}-forged.png`;

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
const objectExists = (bucket, key) => Number(runSql(`SELECT count(*)::int n FROM storage.objects WHERE bucket='${bucket}' AND key='${key}'`).rows[0].n) === 1;
const blob = (text, type = "text/plain") => new Blob([text], { type });

await guardedMutation("C6 disposable fixture", async () => {
  const key = anonKey();
  const clients = { employee: await signIn(employeeA, key), hr: await signIn(hrA, key), crossTenant: await signIn(employeeB, key) };
  await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });
  const emp = clients.employee, hr = clients.hr;
  const createdExpenses = [];
  let moderatorGranted = false;
  try {
    // ── 1. expenses ──
    const base = { tenant_id: A, employee_id: employeeA.employeeId, title: `${TAG} probe`, amount: 100, currency: "INR", category: "travel", expense_date: "2026-09-01" };
    await warm(emp);
    let r = await emp.database.from("expenses").insert({ ...base, status: "approved" }).select("id");
    if (!r.error) createdExpenses.push(...r.data.map((x) => x.id));
    check(!!r.error, `employee files an already-approved expense -> ${r.error ? "DENIED " + fp(r.error) : "CREATED"}`);
    r = await emp.database.from("expenses").insert({ ...base, status: "pending", reimbursed_at: new Date().toISOString() }).select("id");
    if (!r.error) createdExpenses.push(...r.data.map((x) => x.id));
    check(!!r.error, `employee files a pending expense marked reimbursed -> ${r.error ? "DENIED " + fp(r.error) : "CREATED"}`);
    r = await emp.database.from("expenses").insert({ ...base, status: "pending" }).select("id");
    if (!r.error) createdExpenses.push(...r.data.map((x) => x.id));
    check(!r.error, `employee files a normal pending expense (the app's payload) -> ${r.error ? fp(r.error) : "ALLOWED"}`);

    // ── 2. posts ──
    runSql(`INSERT INTO public.posts(id,tenant_id,author_id,content,type,is_pinned) VALUES ('${POST}','${A}','${employeeA.employeeId}','${TAG} post','general',false)`);
    const post = () => runSql(`SELECT type, is_pinned, content FROM public.posts WHERE id='${POST}'`).rows[0];
    await warm(emp);
    r = await emp.database.from("posts").update({ is_pinned: true }).eq("id", POST).select("id");
    check((!!r.error || r.data.length === 0) && post().is_pinned === false, `author pins own post -> ${r.error ? "DENIED " + fp(r.error) : r.data.length + " rows"}; pinned=${post().is_pinned}`);
    r = await emp.database.from("posts").update({ type: "announcement" }).eq("id", POST).select("id");
    check((!!r.error || r.data.length === 0) && post().type === "general", `author turns own post into an announcement -> ${r.error ? "DENIED" : r.data.length + " rows"}; type=${post().type}`);
    r = await emp.database.from("posts").update({ content: `${TAG} edited` }).eq("id", POST).select("id");
    check(!r.error && post().content === `${TAG} edited`, `author edits own post content -> ${r.error ? fp(r.error) : "ALLOWED"}`);
    r = await emp.database.from("posts").insert({ tenant_id: A, author_id: employeeA.employeeId, content: `${TAG} pinned`, type: "general", is_pinned: true }).select("id");
    if (!r.error) runSql(`DELETE FROM public.posts WHERE id IN (${r.data.map((x) => `'${x.id}'`).join(",")})`);
    check(!!r.error, `author creates an already-pinned post -> ${r.error ? "DENIED " + fp(r.error) : "CREATED"}`);
    runSql(`INSERT INTO public.membership_template_assignments(membership_id,tenant_id,template_key,is_active) VALUES ('${hrMembership}','${A}','communication_moderator',true) ON CONFLICT DO NOTHING`);
    moderatorGranted = true;
    await warm(hr);
    r = await hr.database.from("posts").update({ is_pinned: true }).eq("id", POST).select("id");
    check(!r.error && r.data.length === 1 && post().is_pinned === true, `moderator pins the post -> ${r.error ? fp(r.error) : "ALLOWED"}`);

    // ── 3. employee-documents: HR-issued file in employee.a's folder ──
    await warm(hr);
    r = await hr.storage.from("employee-documents").upload(DOC_HR, blob("hr issued"));
    assert.ok(!r.error, `HR upload into employee folder: ${fp(r.error)}`);
    await warm(emp);
    await emp.storage.from("employee-documents").remove(DOC_HR);
    check(objectExists("employee-documents", DOC_HR), `employee deletes an HR-issued document in own folder -> object ${objectExists("employee-documents", DOC_HR) ? "still present" : "DELETED"}`);
    r = await emp.storage.from("employee-documents").upload(DOC_OWN, blob("own"));
    check(!r.error, `employee still uploads own document -> ${r.error ? fp(r.error) : "ALLOWED"}`);
    await emp.storage.from("employee-documents").remove(DOC_OWN);
    check(!objectExists("employee-documents", DOC_OWN), "employee deletes a document they uploaded themself");
    await warm(hr);
    await hr.storage.from("employee-documents").remove(DOC_HR);
    check(!objectExists("employee-documents", DOC_HR), "HR deletes the HR-issued document");

    // ── 4. profile photos ──
    await warm(hr);
    r = await hr.storage.from("employee-profile-photos").upload(PHOTO_HR, blob("hr photo", "image/png"));
    assert.ok(!r.error, `HR photo upload: ${fp(r.error)}`);
    await warm(emp);
    await emp.storage.from("employee-profile-photos").remove(PHOTO_HR);
    check(objectExists("employee-profile-photos", PHOTO_HR), `employee deletes a colleague's profile photo -> ${objectExists("employee-profile-photos", PHOTO_HR) ? "still present" : "DELETED"}`);
    r = await emp.storage.from("employee-profile-photos").upload(PHOTO_FORGED, blob("forged", "image/png"));
    const forged = objectExists("employee-profile-photos", PHOTO_FORGED);
    if (forged) await emp.storage.from("employee-profile-photos").remove(PHOTO_FORGED);
    check(!forged, `employee uploads into a colleague's photo folder -> ${forged ? "CREATED" : "DENIED " + fp(r.error)}`);
    r = await emp.storage.from("employee-profile-photos").upload(PHOTO_OWN, blob("own photo", "image/png"));
    check(!r.error, `employee uploads own profile photo -> ${r.error ? fp(r.error) : "ALLOWED"}`);
    await emp.storage.from("employee-profile-photos").remove(PHOTO_OWN);
    check(!objectExists("employee-profile-photos", PHOTO_OWN), "employee deletes own profile photo");
    await warm(hr);
    await hr.storage.from("employee-profile-photos").remove(PHOTO_HR);
    check(!objectExists("employee-profile-photos", PHOTO_HR), "HR deletes its photo");

    // ── 5. acknowledgements: no employee write policy (writes only via the definer RPC) ──
    const ackWrite = runSql(`SELECT count(*)::int n FROM pg_policies WHERE tablename='employee_policy_acknowledgements' AND permissive='PERMISSIVE' AND cmd <> 'SELECT' AND position('is_hr' in coalesce(qual,'')||coalesce(with_check,''))=0`).rows[0].n;
    check(ackWrite === 0, `employee-writable acknowledgement policies: ${ackWrite}`);

    // ── 6. dead code ──
    const draft = runSql(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='create_draft_employee'`).rows[0].n;
    check(draft === 0, `create_draft_employee present: ${draft}`);
    const dead = ["src/employee/EmployeeLayout.tsx", "src/hr/HRLayout.tsx"].filter((f) => readFileSync(join(root, f), "utf8").includes('subscribe("posts")'));
    check(dead.length === 0, `posts realtime subscribes left in layouts: ${dead.join(", ") || "none"}`);
  } finally {
    if (moderatorGranted) runSql(`DELETE FROM public.membership_template_assignments WHERE membership_id='${hrMembership}' AND template_key='communication_moderator'`);
    runSql(`DELETE FROM public.posts WHERE id='${POST}' OR (tenant_id='${A}' AND content LIKE '${TAG}%')`);
    runSql(`DELETE FROM public.expenses WHERE tenant_id='${A}' AND title='${TAG} probe'`);
    for (const [client, bucket, k] of [[hr, "employee-documents", DOC_HR], [emp, "employee-documents", DOC_OWN], [hr, "employee-profile-photos", PHOTO_HR], [emp, "employee-profile-photos", PHOTO_OWN], [emp, "employee-profile-photos", PHOTO_FORGED]]) {
      if (objectExists(bucket, k)) await client.storage.from(bucket).remove(k);
    }
    const left = ["employee-documents", "employee-profile-photos"].map((b) => Number(runSql(`SELECT count(*)::int n FROM storage.objects WHERE bucket='${b}' AND key LIKE '%${TAG}%'`).rows[0].n)).reduce((a, b) => a + b, 0);
    console.log(`Storage residue for ${TAG}: ${left}`);
    for (const c of [emp, hr, clients.crossTenant]) await warm(c);
    await rlsInvariant({ employee: emp, hr, crossTenant: clients.crossTenant }, { employee: 1, hr: 2, crossTenant: 0 });
  }
  const failed = results.filter((l) => l.startsWith("FAIL"));
  console.log(`\nC6: ${results.length - failed.length}/${results.length} PASS`);
  assert.equal(failed.length, 0, `C6 failures:\n${failed.join("\n")}`);
});
