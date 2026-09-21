// Lead probe (read-only on data): does a Company B employee / anon client receive Company A topics?
import { createClient } from "@insforge/sdk";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { TB_M1M2 } from "../tests/m1m2/_target.mjs";
import { verifyTarget, runSql } from "../tests/m1m2/_harness.mjs";
import { COMPANY_A_EMPLOYEE, COMPANY_B_EMPLOYEE } from "../tests/m1m2/fixtures/personas.mjs";
verifyTarget();
const cli = "node_modules/@insforge/cli/dist/index.js";
const r = spawnSync(process.execPath, [cli, "secrets", "get", "ANON_KEY", "--json"], { encoding: "utf8" });
const key = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).value;
const password = readFileSync("tests/m1m2/persona-password.local", "utf8").trim();
const mk = () => createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey: key });
const b = mk(); const s = await b.auth.signInWithPassword({ email: COMPANY_B_EMPLOYEE.email, password });
if (s.error) throw s.error;
const anon = mk();
const topics = ["chat_messages", "chat_channels", "chat:general", `notifications:${COMPANY_A_EMPLOYEE.employeeId}`];
const got = { b: [], anon: [] };
for (const [name, c] of [["b", b], ["anon", anon]]) {
  try { await c.realtime.connect(); } catch (e) { console.log(name, "connect error:", e.message); continue; }
  for (const t of topics) {
    const res = await c.realtime.subscribe(t).catch((e) => ({ ok: false, error: e.message }));
    console.log(`${name} subscribe ${t}:`, JSON.stringify(res));
  }
  for (const ev of ["INSERT", "INSERT_message", "INSERT_channel", "INSERT_notification"])
    c.realtime.on(ev, (p) => got[name].push({ ev, marker: p?.probe ?? p?.payload?.probe ?? JSON.stringify(p).slice(0, 120) }));
}
await new Promise((res) => setTimeout(res, 1500));
const marker = "p303-probe-" + Date.now();
const sql = `SELECT realtime.publish('chat_messages','INSERT','{"probe":"${marker}","tenant_id":"a0000000-company-A"}'::jsonb);
SELECT realtime.publish('chat_channels','INSERT_channel','{"probe":"${marker}"}'::jsonb);
SELECT realtime.publish('chat:general','INSERT_message','{"probe":"${marker}"}'::jsonb);
SELECT realtime.publish('notifications:${COMPANY_A_EMPLOYEE.employeeId}','INSERT_notification','{"probe":"${marker}"}'::jsonb);`;
runSql(sql);
await new Promise((res) => setTimeout(res, 4000));
console.log("RECEIVED by Company B employee:", JSON.stringify(got.b));
console.log("RECEIVED by anon:", JSON.stringify(got.anon));
b.realtime.disconnect(); anon.realtime.disconnect(); process.exit(0);
