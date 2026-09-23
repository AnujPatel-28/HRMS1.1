// C10 production check (non-mutating): a QA employee calls both leave-review RPCs with a random id.
// Expected after C10: P1003 APPROVAL_SUBJECT_UNAVAILABLE for both (before: "Leave request not found").
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@insforge/sdk";

const linked = JSON.parse(readFileSync(".insforge/project.json", "utf8"));
if (linked.project_id !== "0431f0f6-225f-4fb1-86b7-3fd32684c7f4") throw new Error(`link is ${linked.project_name}`);
const password = readFileSync("doc/qa/CREDENTIALS.local.md", "utf8").match(/Password \(all six\)[^`]*```\s*\n([^\n]+)\n/)[1].trim();
const k = spawnSync(process.execPath, ["node_modules/@insforge/cli/dist/index.js", "secrets", "get", "ANON_KEY", "--json"], { encoding: "utf8" });
const anonKey = JSON.parse(k.stdout.slice(k.stdout.indexOf("{"))).value;
const c = createClient({ baseUrl: linked.oss_host, functionsUrl: "https://rq3qmu8y.function2.insforge.app", anonKey });
const s = await c.auth.signInWithPassword({ email: "employee-qa@talentmeshsolutions.com", password });
if (s.error) throw new Error(`sign-in: ${s.error.message}`);
const id = randomUUID();
let bad = 0;
for (const [name, args] of [
  ["approve_leave_request", { p_leave_id: id, p_working_dates: null, p_approved_business_days: null }],
  ["cancel_leave_request", { p_leave_id: id, p_rejection_reason: "c10-prod-check", p_new_status: "cancelled" }],
]) {
  const r = await c.database.rpc(name, args);
  const got = r.error ? `${r.error.code} | ${r.error.message}` : "NO ERROR";
  const ok = got === "P1003 | APPROVAL_SUBJECT_UNAVAILABLE";
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}(random id): ${got}`);
}
process.exitCode = bad ? 1 : 0;
