// Lead probe: real EXISTING legacy employee-document, opened by its real owner (Vishal, 111035ce).
// Temporary password on ONE user, original hash restored in finally (same technique as P3-03 --existing).
import { createClient } from "@insforge/sdk";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { TB_M1M2 } from "../tests/m1m2/_target.mjs";
import { verifyTarget, runSql } from "../tests/m1m2/_harness.mjs";
verifyTarget();
const rows = (s) => runSql(s).rows;
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
const tenant = "111035ce-979c-429a-a482-ddfa87dbfe6e", employee = "91eaf0ab-8ef7-4d07-80af-7d94ab88e05c";
const legacyKey = "employees/91eaf0ab-8ef7-4d07-80af-7d94ab88e05c/1780056226828_Sample.pdf";
const r = spawnSync(process.execPath, ["node_modules/@insforge/cli/dist/index.js", "secrets", "get", "ANON_KEY", "--json"], { encoding: "utf8" });
const anonKey = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).value;
const pw = readFileSync("tests/m1m2/persona-password.local", "utf8").trim();
const users = rows(`SELECT u.id,u.email,u.password FROM auth.users u JOIN public.employees e ON e.user_id=u.id WHERE e.id='${employee}' AND e.tenant_id='${tenant}'`);
assert.equal(users.length, 1); const original = users[0];
const mk = () => createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey });
try {
  runSql(`UPDATE auth.users SET password=crypt(${q(pw)},gen_salt('bf',10)) WHERE id=${q(original.id)}::uuid`);
  const v = mk(); const l = await v.auth.signInWithPassword({ email: original.email, password: pw });
  if (l.error) { console.log("UNTESTED login:", l.error.message); } else {
    const own = await v.storage.from("employee-documents").download(legacyKey);
    console.log("Vishal (owner) downloads his EXISTING legacy document:", own.error ? "DENIED " + own.error.message : `ALLOWED ${own.data.size} bytes`);
    const other = await v.storage.from("employee-documents").download("employees/736cf41d-70f0-47a2-a99e-4aa744bc1b61/1780044247284-Payslip_HR_Manager_May_2026.pdf");
    console.log("Vishal downloads another tenant's EXISTING payslip:", other.error ? "DENIED " + other.error.message : "ALLOWED");
    const rowsSeen = await v.database.from("employee_documents").select("employee_id");
    console.log("Vishal employee_documents rows visible:", JSON.stringify([...new Set((rowsSeen.data ?? []).map((x) => x.employee_id))]));
  }
  const b = mk(); await b.auth.signInWithPassword({ email: "employee.b@m1m2.test", password: pw });
  const bx = await b.storage.from("employee-documents").download(legacyKey);
  console.log("Company B employee downloads Vishal's legacy document:", bx.error ? "DENIED " + bx.error.message : "ALLOWED");
} finally {
  runSql(`UPDATE auth.users SET password=${q(original.password)} WHERE id=${q(original.id)}::uuid`);
  console.log("PASSWORD_HASH_RESTORED", JSON.stringify(rows(`SELECT password=${q(original.password)} AS restored FROM auth.users WHERE id=${q(original.id)}::uuid`)));
}
process.exit(0);
