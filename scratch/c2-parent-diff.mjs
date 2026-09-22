// Lead verification of C2: compare each changed function's body on the PARENT (pre-C2, read-only)
// with TB (post-C2). Only date expressions may differ.
import { spawnSync } from "node:child_process";
const CLI = "node_modules/@insforge/cli/dist/index.js";
const fns = ["create_employee_transaction","employee_apply_leave_request","hr_schedule_shift_change","open_initial_unit_assignment","attendance_evaluate_location","expire_location_exceptions","fn_accrue_monthly_leaves"];
const sql = `SELECT proname, prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (${fns.map((f) => `'${f}'`).join(",")})`;
function fetch(cwd) {
  const r = spawnSync(process.execPath, [process.cwd() + "/" + CLI, "db", "query", sql, "--json"], { cwd, encoding: "utf8", maxBuffer: 64e6 });
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  const rows = j.rows ?? j.data ?? j;
  return Object.fromEntries(rows.map((x) => [x.proname, x.prosrc.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("--"))]));
}
const parent = fetch(process.env.PARENT_DIR), tb = fetch(process.cwd());
for (const f of fns) {
  const a = parent[f] ?? [], b = tb[f] ?? [];
  const sa = new Set(a), sb = new Set(b);
  const gone = a.filter((l) => !sb.has(l)), added = b.filter((l) => !sa.has(l));
  console.log(`\n## ${f}  parent=${a.length} lines, TB=${b.length} lines`);
  gone.forEach((l) => console.log("  - " + l.slice(0, 130)));
  added.forEach((l) => console.log("  + " + l.slice(0, 130)));
}
