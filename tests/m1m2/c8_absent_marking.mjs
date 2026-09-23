#!/usr/bin/env node
// C8 -- absent-marking watermark. A disposable employee with no punches on a past working day is
// derived through the real HR path (hr_run_attendance_derivation) under each device situation.
// User decision 2026-09-23: app/kiosk -> next morning; biometric -> only after the device synced.
// Conventions follow c4_rederive_day.mjs. RLS invariant 1/2/0 before and after.
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
const employeeA = { email: "employee.a@m1m2.test", userId: "a0000000-0000-4000-8001-000000000001" };
const hrA = { email: "hr-employee.a@m1m2.test", userId: "a0000000-0000-4000-8002-000000000001" };
const employeeB = { email: "employee.b@m1m2.test", userId: "b0000000-0000-4000-8001-000000000001" };

const E = randomUUID(), S = randomUUID();
const DEV_BIO = randomUUID(), DEV_KIOSK = randomUUID();
const SERIAL = `C8-${randomUUID().slice(0, 8)}`;

const fp = (error) => [error?.code, error?.message].filter(Boolean).join(" | ");
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

const today = runSql(`SELECT public.tenant_business_date('${A}', now())::text AS d`).rows[0].d;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const D = addDays(today, -3);          // a past working day (shift works every day)
const dayRow = (d) => runSql(`SELECT status FROM public.attendance WHERE tenant_id='${A}' AND employee_id='${E}' AND date='${d}'`).rows;
const clearDays = () => runSql(`DELETE FROM public.attendance WHERE tenant_id='${A}' AND employee_id='${E}'`);
const setDevice = (sql) => runSql(sql);

function setupFixture() {
  runSql(`
    INSERT INTO public.shifts(id,tenant_id,name,start_time,end_time,working_days,working_hours_threshold_for_absent,working_hours_threshold_for_half_day)
      VALUES ('${S}','${A}','C8 fixture','09:00','18:00','{0,1,2,3,4,5,6}',2,4);
    INSERT INTO public.employees(id,tenant_id,full_name,email,status,date_of_joining)
      VALUES ('${E}','${A}','C8 Fixture Employee','c8-${E.slice(0, 8)}@m1m2.test','active','2026-01-01');
    INSERT INTO public.employee_shifts(tenant_id,employee_id,shift_id,effective_from) VALUES ('${A}','${E}','${S}','2026-01-01');
  `);
}
function teardownFixture() {
  runSql(`
    DELETE FROM public.attendance WHERE tenant_id='${A}' AND employee_id='${E}';
    DELETE FROM public.attendance_derivation_runs WHERE tenant_id='${A}' AND (shift_id='${S}' OR (shift_id IS NULL AND from_date>='${addDays(today, -4)}'));
    DELETE FROM public.attendance_devices WHERE id IN ('${DEV_BIO}','${DEV_KIOSK}');
    DELETE FROM public.employee_shifts WHERE employee_id='${E}';
    DELETE FROM public.shifts WHERE id='${S}';
    DELETE FROM public.employees WHERE id='${E}';
  `);
  const left = Number(runSql(`SELECT (SELECT count(*) FROM public.employees WHERE id='${E}') + (SELECT count(*) FROM public.attendance_devices WHERE id IN ('${DEV_BIO}','${DEV_KIOSK}')) AS n`).rows[0].n);
  assert.equal(left, 0, "C8 fixture residue");
}

await guardedMutation("C8 disposable fixture", async () => {
  const key = anonKey();
  const clients = { employee: await signIn(employeeA, key), hr: await signIn(hrA, key), crossTenant: await signIn(employeeB, key) };
  await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });
  const hr = clients.hr;
  const derive = async (from, to) => {
    await warm(hr);
    const r = await hr.database.rpc("hr_run_attendance_derivation", { p_tenant_id: A, p_from: from, p_to: to });
    assert.equal(r.error, null, `derivation: ${fp(r.error)}`);
  };
  try {
    setupFixture();
    const existingBio = Number(runSql(`SELECT count(*)::int n FROM public.attendance_devices WHERE tenant_id='${A}' AND device_type='biometric' AND is_active`).rows[0].n);
    assert.equal(existingBio, 0, "precondition: Company A has no active biometric device");

    // 1. App/kiosk-only tenant: a no-punch past working day becomes absent; today does not.
    await derive(D, today);
    check(dayRow(D)[0]?.status === "absent", `app-only tenant: no-punch day ${D} -> ${dayRow(D)[0]?.status ?? "no row"} (expected absent)`);
    check(dayRow(today).length === 0, `app-only tenant: today (${today}) not marked yet -> ${dayRow(today)[0]?.status ?? "no row"}`);

    // 2. A kiosk that has been silent for days does not hold absence back (kiosk punches are live).
    clearDays();
    setDevice(`INSERT INTO public.attendance_devices(id,tenant_id,name,device_type,serial,source,is_active,last_seen_at,secret_hash)
      VALUES ('${DEV_KIOSK}','${A}','C8 kiosk','kiosk','${SERIAL}-K','kiosk',true,now()-interval '10 days','x')`);
    await derive(D, D);
    check(dayRow(D)[0]?.status === "absent", `stale kiosk ignored -> ${dayRow(D)[0]?.status ?? "no row"}`);

    // 3. Biometric device that has never pushed: nothing can be marked absent.
    clearDays();
    setDevice(`INSERT INTO public.attendance_devices(id,tenant_id,name,device_type,serial,source,is_active,last_seen_at,secret_hash)
      VALUES ('${DEV_BIO}','${A}','C8 biometric','biometric','${SERIAL}-B','device',true,NULL,'x')`);
    await derive(D, D);
    check(dayRow(D).length === 0, `biometric never synced -> ${dayRow(D)[0]?.status ?? "no row"} (expected no row)`);

    // 4. Biometric last pushed BEFORE the day: still waiting.
    setDevice(`UPDATE public.attendance_devices SET last_seen_at = ('${addDays(D, -1)} 12:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata' WHERE id='${DEV_BIO}'`);
    await derive(D, D);
    check(dayRow(D).length === 0, `biometric last push before the day -> ${dayRow(D)[0]?.status ?? "no row"} (expected no row)`);

    // 5. Biometric synced since: the day is marked absent.
    setDevice(`UPDATE public.attendance_devices SET last_seen_at = now() WHERE id='${DEV_BIO}'`);
    await derive(D, D);
    check(dayRow(D)[0]?.status === "absent", `biometric synced now -> ${dayRow(D)[0]?.status ?? "no row"} (expected absent)`);

    // 6. An inactive stale biometric device does not block.
    clearDays();
    setDevice(`UPDATE public.attendance_devices SET last_seen_at = NULL, is_active = false WHERE id='${DEV_BIO}'`);
    await derive(D, D);
    check(dayRow(D)[0]?.status === "absent", `inactive never-synced biometric ignored -> ${dayRow(D)[0]?.status ?? "no row"}`);

    // 7. The watermark function is internal.
    await warm(clients.employee);
    const direct = await clients.employee.database.rpc("attendance_absence_watermark", { p_tenant_id: A });
    check(!!direct.error, `employee calls attendance_absence_watermark -> ${direct.error ? "DENIED " + fp(direct.error) : "ALLOWED"}`);
  } finally {
    teardownFixture();
    for (const c of Object.values(clients)) await warm(c);
    await rlsInvariant(clients, { employee: 1, hr: 2, crossTenant: 0 });
  }
  const failed = results.filter((l) => l.startsWith("FAIL"));
  console.log(`\nC8: ${results.length - failed.length}/${results.length} PASS`);
  assert.equal(failed.length, 0, `C8 failures:\n${failed.join("\n")}`);
});
