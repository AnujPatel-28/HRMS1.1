#!/usr/bin/env node
// P3-04 — private personal-data buckets (employee-documents, expense-receipts,
// task-attachments). Owns its own disposable fixtures (tenant A only, plus a temporary
// second Company A employee for the within-company colleague case), `finally` teardown,
// RLS invariant 1/2/0 before and after. Mirrors the signIn/runSql/fixture patterns
// established by p3_projects_tasks.mjs and p3_chat_connect.mjs.
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

// Temporary second Company A employee — the within-company colleague case (B2). Not HR, not
// a reviewer of employee.a's tasks.
const colleague = { email: "p304-colleague.a@m1m2.test", userId: "a3040000-0000-4000-8000-000000001001", employeeId: "a3040000-0000-4000-8000-000000001002" };
const membershipId = (userId) => {
  const hex = createHash("md5").update(`${companyA}:${userId}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
colleague.membershipId = membershipId(colleague.userId);

// A task assigned to employee.a, reviewable by HR via task.review@company (p3_task_scope),
// used to prove the task-attachments reviewer-scope read rule.
const taskReview = "a3040000-0000-4000-8000-000000002001";
const submissionReview = "a3040000-0000-4000-8000-000000002002";
// A second task assigned to employee.a, used only to submit a FORGED attachment reference
// (an attachment_url naming a colleague-owned key) — proves the forged-reference class of
// bug (P3-03 Tier1 189100 lesson) cannot recur here, because authorization is derived from
// the object key itself, never from the caller-authored attachment_url text.
const taskForge = "a3040000-0000-4000-8000-000000003001";

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

function readLinked() {
  return JSON.parse(readFileSync(join(root, ".insforge", "project.json"), "utf8"));
}

async function patchBucketPublic(bucket, isPublic) {
  const linked = readLinked();
  assert.equal(linked.project_id, TB_M1M2.projectId);
  const res = await fetch(`${TB_M1M2.baseUrl}/api/storage/buckets/${bucket}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${linked.api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isPublic }),
  });
  assert.ok(res.ok, `bucket privacy PATCH ${bucket} isPublic=${isPublic} failed: HTTP ${res.status}`);
  return res.status;
}

async function anonGetStatus(bucket, key) {
  const res = await fetch(`${TB_M1M2.baseUrl}/api/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`);
  return res.status;
}

// Flips the bucket public (reproducing the measured B1 defect against a REAL object), then
// private again, asserting anon access flips from allowed to denied. Restores private either way.
async function anonBeforeAfter(bucket, key) {
  let before;
  try {
    await patchBucketPublic(bucket, true);
    before = await anonGetStatus(bucket, key);
  } finally {
    await patchBucketPublic(bucket, false);
  }
  const after = await anonGetStatus(bucket, key);
  console.log(`PASS anon ${bucket} BEFORE(public)=${before} AFTER(private)=${after}`);
  assert.ok(before === 200 || before === 302, `${bucket} BEFORE: expected public success, got ${before}`);
  assert.ok(after === 401 || after === 403 || after === 404, `${bucket} AFTER: expected denial, got ${after}`);
}

function setupFixture() {
  runSql(`
    INSERT INTO auth.users(id,email,password,email_verified,metadata) VALUES
      ('${colleague.userId}'::uuid,${q(colleague.email)},crypt(${q(password)},gen_salt('bf',10)),true,
       ${q(JSON.stringify({role:"employee",tenant_id:companyA}))}::jsonb);
    INSERT INTO public.employees(id,user_id,tenant_id,full_name,email) VALUES
      ('${colleague.employeeId}'::uuid,'${colleague.userId}'::uuid,'${companyA}'::uuid,'P3-04 Colleague',${q(colleague.email)});
    INSERT INTO public.tenant_memberships(tenant_id,user_id,employee_id,status) VALUES
      ('${companyA}'::uuid,'${colleague.userId}'::uuid,'${colleague.employeeId}'::uuid,'active');
    INSERT INTO public.membership_template_assignments(membership_id,tenant_id,template_key,is_active) VALUES
      ('${colleague.membershipId}'::uuid,'${companyA}'::uuid,'employee',true);
    INSERT INTO public.tasks(id,tenant_id,title,assigned_to,assigned_by,status) VALUES
      ('${taskReview}'::uuid,'${companyA}'::uuid,'P3-04 review fixture','${employeeA.employeeId}'::uuid,'${hrA.employeeId}'::uuid,'submitted'),
      ('${taskForge}'::uuid,'${companyA}'::uuid,'P3-04 forge fixture','${employeeA.employeeId}'::uuid,'${hrA.employeeId}'::uuid,'assigned');
    INSERT INTO public.task_submissions(id,tenant_id,task_id,employee_id,notes,status) VALUES
      ('${submissionReview}'::uuid,'${companyA}'::uuid,'${taskReview}'::uuid,'${employeeA.employeeId}'::uuid,'P3-04 fixture','pending');
  `);
}

function teardownFixture() {
  runSql(`
    DELETE FROM public.notifications WHERE tenant_id='${companyA}'::uuid AND reference_id IN ('${taskReview}'::uuid,'${taskForge}'::uuid);
    DELETE FROM public.task_submissions WHERE task_id IN ('${taskReview}'::uuid,'${taskForge}'::uuid);
    DELETE FROM public.tasks WHERE id IN ('${taskReview}'::uuid,'${taskForge}'::uuid);
    DELETE FROM public.employee_documents WHERE tenant_id='${companyA}'::uuid AND file_name LIKE 'p304-%';
    DELETE FROM public.expenses WHERE tenant_id='${companyA}'::uuid AND title LIKE 'P3-04%';
    DELETE FROM public.membership_template_assignments WHERE membership_id='${colleague.membershipId}'::uuid;
    DELETE FROM public.tenant_memberships WHERE id='${colleague.membershipId}'::uuid;
    DELETE FROM public.employees WHERE id='${colleague.employeeId}'::uuid;
    DELETE FROM auth.users WHERE id='${colleague.userId}'::uuid;
  `);
}

// Removes objects through the SDK as their uploader (DELETE FROM storage.objects fails and
// aborts the whole SQL batch through the CLI), then the caller deletes DB rows separately.
async function removeObjects(client, bucket, keys) {
  for (const key of keys) {
    if (!key) continue;
    await client.storage.from(bucket).remove(key);
  }
}

async function bucketRlsMatrix({ bucket, clients, ownerKey, colleagueKey, reviewAllowed, wrongOwnerKey }) {
  // 2. wrong-tenant logged-in user
  denied(await clients.crossTenant.storage.from(bucket).download(ownerKey), `${bucket}: employee.b cross-tenant download`);
  // 3. same-tenant colleague (B2 — the within-company case)
  denied(await clients.colleague.storage.from(bucket).download(ownerKey), `${bucket}: colleague same-tenant download`);
  denied(await clients.employee.storage.from(bucket).download(colleagueKey), `${bucket}: employee.a reading colleague's object`);
  // 4. owner allowed; authorized reviewer allowed
  allowed(await clients.employee.storage.from(bucket).download(ownerKey), `${bucket}: owner download`);
  const reviewerResult = await clients.hr.storage.from(bucket).download(ownerKey);
  if (reviewAllowed) allowed(reviewerResult, `${bucket}: HR reviewer download`);
  else denied(reviewerResult, `${bucket}: HR reviewer download`);
  // 6. upload with a key whose tenant/owner is not the caller
  denied(
    await clients.employee.storage.from(bucket).upload(wrongOwnerKey, new Blob(["forged"], { type: "text/plain" })),
    `${bucket}: employee.a upload with colleague-owned key`,
  );
}

async function fullSuite(clients, key) {
  const uploaded = { "employee-documents": [], "expense-receipts": [], "task-attachments": [] };
  await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });
  try {
    setupFixture();
    clients.colleague = await signIn(colleague, key);
    await rlsInvariant(clients, { employee: 1, hr: 3, crossTenant: 0 });

    // -----------------------------------------------------------------
    // employee-documents
    // -----------------------------------------------------------------
    {
      const bucket = "employee-documents";
      const ownerKey = `${companyA}/${employeeA.employeeId}/${randomUUID()}.txt`;
      const colleagueKey = `${companyA}/${colleague.employeeId}/${randomUUID()}.txt`;
      const wrongOwnerKey = `${companyA}/${colleague.employeeId}/${randomUUID()}.txt`;
      uploaded[bucket].push(ownerKey, colleagueKey);
      allowed(await clients.employee.storage.from(bucket).upload(ownerKey, new Blob(["owner doc"], { type: "text/plain" })), `${bucket}: owner upload`);
      allowed(await clients.colleague.storage.from(bucket).upload(colleagueKey, new Blob(["colleague doc"], { type: "text/plain" })), `${bucket}: colleague upload own key`);

      // 1. anonymous GET — before and after
      await anonBeforeAfter(bucket, ownerKey);

      await bucketRlsMatrix({ bucket, clients, ownerKey, colleagueKey, reviewAllowed: true, wrongOwnerKey });

      // 5. forged reference: employee.a writes an employee_documents row (own, valid employee_id)
      // whose file_key points at the COLLEAGUE's real object. Authorization is derived from the
      // key alone (P3-03 lesson), so this must still be denied.
      const forgeRow = allowed(
        await clients.employee.database.from("employee_documents").insert({
          tenant_id: companyA, employee_id: employeeA.employeeId,
          file_name: "p304-forged-reference.txt", file_url: `employee-documents:${colleagueKey}`,
          file_key: colleagueKey, size: 7,
        }).select("id"),
        `${bucket}: employee.a inserts forged-reference row (table write itself is legitimate — employee_id=self)`,
      );
      denied(await clients.employee.storage.from(bucket).download(colleagueKey), `${bucket}: forged-reference download still denied`);

      // Legacy shape: employees/<employee_id>/<file> — owner still in the key (part 2); tenant
      // resolved via the employees row. No pre-existing legacy row is owned by a credentialed
      // test persona (they belong to unrelated production tenants), so this proves the code
      // path with a fresh object in the legacy shape.
      const legacyKey = `employees/${employeeA.employeeId}/${randomUUID()}.txt`;
      uploaded[bucket].push(legacyKey);
      allowed(await clients.employee.storage.from(bucket).upload(legacyKey, new Blob(["legacy shape"], { type: "text/plain" })), `${bucket}: owner upload legacy-shape key`);
      allowed(await clients.employee.storage.from(bucket).download(legacyKey), `${bucket}: owner download legacy-shape key`);
      allowed(await clients.hr.storage.from(bucket).download(legacyKey), `${bucket}: HR download legacy-shape key`);
      denied(await clients.colleague.storage.from(bucket).download(legacyKey), `${bucket}: colleague download legacy-shape key`);
      denied(await clients.crossTenant.storage.from(bucket).download(legacyKey), `${bucket}: cross-tenant download legacy-shape key`);

      // employee_documents TABLE: colleague cannot read/insert/delete employee.a's row; HR can.
      const docRow = forgeRow[0].id;
      const colleagueRead = await clients.colleague.database.from("employee_documents").select("id").eq("id", docRow);
      assert.equal(colleagueRead.error, null, fp(colleagueRead.error));
      assert.equal(colleagueRead.data.length, 0, "colleague unexpectedly read employee.a's document row");
      console.log(`PASS employee_documents: colleague SELECT of employee.a's row: 0 rows (denied)`);
      denied(
        await clients.colleague.database.from("employee_documents").insert({
          tenant_id: companyA, employee_id: employeeA.employeeId, file_name: "p304-colleague-forced.txt",
          file_url: "x", file_key: "x", size: 1,
        }),
        "employee_documents: colleague insert onto employee.a's employee_id",
      );
      const colleagueDelete = await clients.colleague.database.from("employee_documents").delete().eq("id", docRow).select("id");
      assert.equal(colleagueDelete.error, null, fp(colleagueDelete.error));
      assert.equal(colleagueDelete.data.length, 0, "colleague unexpectedly deleted employee.a's document row");
      console.log(`PASS employee_documents: colleague DELETE of employee.a's row: 0 rows affected (denied)`);
      allowed(await clients.hr.database.from("employee_documents").select("id").eq("id", docRow), "employee_documents: HR SELECT of employee.a's row");
      allowed(await clients.hr.database.from("employee_documents").delete().eq("id", docRow).select("id"), "employee_documents: HR DELETE of employee.a's row");
    }

    // -----------------------------------------------------------------
    // expense-receipts
    // -----------------------------------------------------------------
    {
      const bucket = "expense-receipts";
      const ownerKey = `${companyA}/${employeeA.employeeId}/${randomUUID()}.txt`;
      const colleagueKey = `${companyA}/${colleague.employeeId}/${randomUUID()}.txt`;
      const wrongOwnerKey = `${companyA}/${colleague.employeeId}/${randomUUID()}.txt`;
      uploaded[bucket].push(ownerKey, colleagueKey);
      allowed(await clients.employee.storage.from(bucket).upload(ownerKey, new Blob(["owner receipt"], { type: "text/plain" })), `${bucket}: owner upload`);
      allowed(await clients.colleague.storage.from(bucket).upload(colleagueKey, new Blob(["colleague receipt"], { type: "text/plain" })), `${bucket}: colleague upload own key`);

      await anonBeforeAfter(bucket, ownerKey);
      await bucketRlsMatrix({ bucket, clients, ownerKey, colleagueKey, reviewAllowed: true, wrongOwnerKey });

      // forged reference: employee.a's own (legitimate) expense row pointing at the colleague's
      // real receipt key.
      const forgeExpense = allowed(
        await clients.employee.database.from("expenses").insert({
          tenant_id: companyA, employee_id: employeeA.employeeId, title: "P3-04 forged receipt",
          amount: 1, currency: "INR", category: "other", expense_date: "2026-01-01",
          receipt_url: `expense-receipts:${colleagueKey}`, status: "pending",
        }).select("id"),
        `${bucket}: employee.a inserts forged-reference expense row`,
      );
      denied(await clients.employee.storage.from(bucket).download(colleagueKey), `${bucket}: forged-reference download still denied`);
      await clients.employee.database.from("expenses").delete().eq("id", forgeExpense[0].id);
    }

    // -----------------------------------------------------------------
    // task-attachments
    // -----------------------------------------------------------------
    {
      const bucket = "task-attachments";
      const ownerKey = `${companyA}/${employeeA.employeeId}/${randomUUID()}.txt`;
      const colleagueKey = `${companyA}/${colleague.employeeId}/${randomUUID()}.txt`;
      const wrongOwnerKey = `${companyA}/${colleague.employeeId}/${randomUUID()}.txt`;
      uploaded[bucket].push(ownerKey, colleagueKey);
      allowed(await clients.employee.storage.from(bucket).upload(ownerKey, new Blob(["owner submission"], { type: "text/plain" })), `${bucket}: owner upload`);
      allowed(await clients.colleague.storage.from(bucket).upload(colleagueKey, new Blob(["colleague file"], { type: "text/plain" })), `${bucket}: colleague upload own key`);
      runSql(`UPDATE public.task_submissions SET attachment_url='task-attachments:${ownerKey}' WHERE id='${submissionReview}'::uuid`);

      await anonBeforeAfter(bucket, ownerKey);
      // reviewAllowed=true: HR holds task.review@company, so p3_task_scope(...,'read') passes —
      // this is the "authorized reviewer" per D2's task-attachments rule.
      await bucketRlsMatrix({ bucket, clients, ownerKey, colleagueKey, reviewAllowed: true, wrongOwnerKey });

      // forged reference: employee.a submits a SECOND task with p_attachment_url naming the
      // colleague's real key. submit_task_request derives employee_id from auth.uid() server-side
      // (no INSERT/UPDATE grant on task_submissions for `authenticated`), so the row itself is
      // genuine — only its attachment_url text is forged. Still denied, because authorization is
      // derived from the key, not from this text.
      const forged = allowed(
        await clients.employee.database.rpc("submit_task_request", {
          p_task_id: taskForge, p_notes: "P3-04 forged attachment", p_attachment_url: `task-attachments:${colleagueKey}`, p_attachment_name: "forged.txt",
        }),
        `${bucket}: employee.a submits task with forged attachment_url`,
      );
      assert.equal(forged.success, true);
      denied(await clients.employee.storage.from(bucket).download(colleagueKey), `${bucket}: forged submission attachment still denied`);

      // D3: the 5 pre-existing unprefixed legacy keys fail closed for everyone — no tenant/owner
      // segment in the key can ever match split_part(key,1)=get_auth_tenant_id().
      const legacy = rows(runSql(`SELECT key FROM storage.objects WHERE bucket='task-attachments' AND key NOT LIKE '%/%' LIMIT 1`));
      if (legacy.length) {
        denied(await clients.employee.storage.from(bucket).download(legacy[0].key), `${bucket}: legacy unprefixed key (owner-side) fail-closed`);
        denied(await clients.hr.storage.from(bucket).download(legacy[0].key), `${bucket}: legacy unprefixed key (HR) fail-closed`);
        console.log(`P3-04 legacy task-attachments count (fail-closed, unchanged): ${rows(runSql(`SELECT count(*)::integer AS n FROM storage.objects WHERE bucket='task-attachments' AND key NOT LIKE '%/%'`))[0].n}`);
      }
    }

  } finally {
    for (const [bucket, keys] of Object.entries(uploaded)) {
      await removeObjects(clients.employee, bucket, keys.filter((k) => k.includes(`/${employeeA.employeeId}/`)));
      if (clients.colleague) await removeObjects(clients.colleague, bucket, keys.filter((k) => k.includes(`/${colleague.employeeId}/`)));
    }
    teardownFixture();
    await rlsInvariant({ employee: clients.employee, hr: clients.hr, crossTenant: clients.crossTenant }, { employee: 1, hr: 2, crossTenant: 0 });
  }
}

await guardedMutation("P3-04 disposable fixture", async () => {
  const key = anonKey();
  const clients = {
    employee: await signIn(employeeA, key),
    hr: await signIn(hrA, key),
    crossTenant: await signIn(employeeB, key),
  };
  await fullSuite(clients, key);
});
