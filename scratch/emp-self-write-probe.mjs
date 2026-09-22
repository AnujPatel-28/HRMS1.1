// Lead probe: which administrative columns can an employee write on their OWN employees row?
import { createClient } from "@insforge/sdk";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { TB_M1M2 } from "../tests/m1m2/_target.mjs";
import { verifyTarget, runSql } from "../tests/m1m2/_harness.mjs";
verifyTarget();
const r = spawnSync(process.execPath, ["node_modules/@insforge/cli/dist/index.js", "secrets", "get", "ANON_KEY", "--json"], { encoding: "utf8" });
const key = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).value;
const pw = readFileSync("tests/m1m2/persona-password.local", "utf8").trim();
const EA = "a0000000-0000-4000-8001-000000000002";
const cols = ["work_mode", "holiday_calendar_id", "grade_id", "attendance_device_id", "kiosk_pin_hash", "account_number", "employee_code"];
const before = runSql(`SELECT ${cols.join(",")} FROM public.employees WHERE id='${EA}'`).rows[0];
const c = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey: key });
await c.auth.signInWithPassword({ email: "employee.a@m1m2.test", password: pw });
const probe = { work_mode: "remote", holiday_calendar_id: null, grade_id: null, attendance_device_id: "p-lead-probe", kiosk_pin_hash: "p-lead-probe", account_number: "p-lead-probe", employee_code: "p-lead-probe" };
try {
  for (const col of cols) {
    const res = await c.database.from("employees").update({ [col]: probe[col] }).eq("id", EA).select(col);
    console.log(`employee.a writes own ${col}:`, res.error ? "DENIED " + res.error.message.slice(0, 80) : `ALLOWED -> ${JSON.stringify(res.data?.[0]?.[col])}`);
  }
} finally {
  const sets = cols.map((k) => `${k}=${before[k] === null ? "NULL" : `'${String(before[k]).replaceAll("'", "''")}'`}`).join(",");
  runSql(`UPDATE public.employees SET ${sets} WHERE id='${EA}'`);
  const after = runSql(`SELECT ${cols.join(",")} FROM public.employees WHERE id='${EA}'`).rows[0];
  console.log("RESTORED:", JSON.stringify(after) === JSON.stringify(before));
}
process.exit(0);
