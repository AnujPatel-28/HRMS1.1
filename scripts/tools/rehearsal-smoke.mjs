// Sign-in smoke check for a release rehearsal branch (doc/release/v0.9.0-production-promotion-runbook.md).
// Signs in as the QA tenant's HR and employee (password from the git-ignored doc/qa/CREDENTIALS.local.md)
// and runs the reads every screen needs at boot. Informational: prints one line per check, never a secret.
// Usage (repo root): M1M2_TARGET=rehearsal node scripts/tools/rehearsal-smoke.mjs <label>
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createClient } from "@insforge/sdk";
import { TB_M1M2, BASELINE_RO_PROJECT_ID } from "../../tests/m1m2/_target.mjs";

// `--production`: read-only smoke after a release step. Only honoured when the link really is the parent.
const production = process.argv.includes("--production");
if (!production && TB_M1M2.projectId === BASELINE_RO_PROJECT_ID) throw new Error("refusing the production parent");
const creds = readFileSync("doc/qa/CREDENTIALS.local.md", "utf8");
const password = creds.match(/Password \(all six\)[^`]*```\s*\n([^\n]+)\n/)?.[1]?.trim();
if (!password) throw new Error("QA password not found in doc/qa/CREDENTIALS.local.md");
const linked = JSON.parse(readFileSync(".insforge/project.json", "utf8"));
const target = production
  ? { name: "HRMS (production)", projectId: BASELINE_RO_PROJECT_ID, baseUrl: linked.oss_host, functionsUrl: "https://rq3qmu8y.function2.insforge.app" }
  : TB_M1M2;
if (linked.project_id !== target.projectId) throw new Error(`link is ${linked.project_name}, target is ${target.name}`);
const k = spawnSync(process.execPath, ["node_modules/@insforge/cli/dist/index.js", "secrets", "get", "ANON_KEY", "--json"], { encoding: "utf8" });
if (k.status !== 0) throw new Error("could not read the target anon key");
const anonKey = JSON.parse(k.stdout.slice(k.stdout.indexOf("{"))).value;

const label = process.argv.slice(2).find((a) => a !== "--production") ?? "";
let failures = 0;
const check = async (name, fn) => {
  try {
    const r = await fn();
    if (r?.error) throw new Error(r.error.message ?? JSON.stringify(r.error));
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}: ${String(e.message ?? e).slice(0, 160)}`);
  }
};

for (const email of ["hr-qa@talentmeshsolutions.com", "employee-qa@talentmeshsolutions.com"]) {
  console.log(`[${label}] ${email} @ ${target.name}`);
  const c = createClient({ baseUrl: target.baseUrl, functionsUrl: target.functionsUrl, anonKey });
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error || !s.data?.user) { failures++; console.log(`  FAIL sign-in: ${s.error?.message}`); continue; }
  console.log("  ok   sign-in");
  const uid = s.data.user.id;
  let emp;
  await check("own employee row", async () => {
    const r = await c.database.from("employees").select("id, tenant_id").eq("user_id", uid).maybeSingle();
    emp = r.data;
    if (!r.error && !emp) throw new Error("no row");
    return r;
  });
  if (!emp) continue;
  await check("tenant_business_date", () => c.database.rpc("tenant_business_date", { p_tenant_id: emp.tenant_id }));
  await check("attendance (own, recent)", () => c.database.from("attendance").select("id").eq("employee_id", emp.id).limit(5));
  await check("leave_types", () => c.database.from("leave_types").select("id").eq("tenant_id", emp.tenant_id).limit(5));
  await check("leaves (own)", () => c.database.from("leaves").select("id").eq("employee_id", emp.id).limit(5));
  await check("tenant_modules", () => c.database.from("tenant_modules").select("module_key, enabled").eq("tenant_id", emp.tenant_id));
  await check("employee_directory_public", () => c.database.from("employee_directory_public").select("id").limit(5));
}
console.log(failures ? `[${label}] ${failures} check(s) failed` : `[${label}] all checks passed`);
process.exitCode = failures ? 1 : 0;
