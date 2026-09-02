// BUG-07 verification: does dropping the self-referencing embed restore manager_id?
// Runs the OLD query and the NEW query as hr-qa and compares.
import { createClient } from "@insforge/sdk";
import fs from "node:fs";

const env = fs.readFileSync(".env", "utf-8");
const baseUrl = env.match(/VITE_INSFORGE_URL=(.*)/)[1].replace(/"/g, "").trim();
const anonKey = env.match(/VITE_INSFORGE_ANON_KEY=(.*)/)[1].replace(/"/g, "").trim();
const TENANT = "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e";

const c = createClient({ baseUrl, anonKey });
const { error } = await c.auth.signInWithPassword({
  email: "hr-qa@talentmeshsolutions.com",
  password: process.env.QA_PASSWORD,
});
if (error) { console.error("login failed:", error.message); process.exit(1); }

// OLD — the embed that shipped
const oldRes = await c.database.from("employees")
  .select("*, manager:employees!manager_id(full_name)")
  .eq("tenant_id", TENANT).order("created_at", { ascending: false });

// NEW — plain select, name resolved locally
const newRes = await c.database.from("employees")
  .select("*").eq("tenant_id", TENANT).order("created_at", { ascending: false });

// The real defect is NOT that manager_id comes back null (it does not). PostgREST resolves the
// self-FK in the REVERSE direction, so `manager` is an ARRAY of the employee's DIRECT REPORTS.
// `.full_name` on an array is undefined, so the old code rendered null for every row.
const oldNamed = (oldRes.data ?? []).filter(r => r.manager?.full_name).length;
const oldWithMgr = (oldRes.data ?? []).filter(r => r.manager_id).length;
const rows = newRes.data ?? [];
const nameById = new Map(rows.map(e => [e.id, e.full_name]));
const mapped = rows.map(e => ({ ...e, manager_name: e.manager_id ? nameById.get(e.manager_id) ?? null : null }));
const newWithMgr = mapped.filter(r => r.manager_id).length;
const named = mapped.filter(r => r.manager_name).length;

console.log(`OLD query (embed):  ${oldRes.data?.length ?? 0} rows, ${oldWithMgr} with a non-null manager_id`);
console.log(`NEW query (plain):  ${rows.length} rows, ${newWithMgr} with a non-null manager_id, ${named} with a resolved manager_name`);
console.log("\nNEW per-row:");
mapped.forEach(r => console.log("  " + String(r.full_name).padEnd(26) +
  " manager_id=" + (r.manager_id ? String(r.manager_id).slice(-4) : "null") +
  "  manager_name=" + JSON.stringify(r.manager_name)));

console.log(`
OLD resolved ${oldNamed} manager name(s); NEW resolves ${named} of ${newWithMgr} employees who have a manager.`);
console.log(oldNamed === 0 && named === newWithMgr && newWithMgr > 0
  ? `RESULT: CONFIRMED — the embed resolved 0 names (it returns direct reports, not the manager); the local lookup resolves all ${named}.`
  : `RESULT: INCONCLUSIVE — oldNamed=${oldNamed}, named=${named}, withMgr=${newWithMgr}.`);
