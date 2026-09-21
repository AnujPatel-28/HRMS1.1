// Lead verification of P3-03 Tier 1 on the NEW topic shapes. No data rows written.
import { createClient } from "@insforge/sdk";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { TB_M1M2 } from "../tests/m1m2/_target.mjs";
import { verifyTarget, runSql } from "../tests/m1m2/_harness.mjs";
verifyTarget();
const r = spawnSync(process.execPath, ["node_modules/@insforge/cli/dist/index.js", "secrets", "get", "ANON_KEY", "--json"], { encoding: "utf8" });
const key = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).value;
const pw = readFileSync("tests/m1m2/persona-password.local", "utf8").trim();
const mk = () => createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey: key });
const A = "a0000000-0000-4000-8000-000000000001", empA = "a0000000-0000-4000-8001-000000000002";
const T1 = "111035ce-979c-429a-a482-ddfa87dbfe6e", CH1 = "d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29";
const tA = "a0000000-0000-4000-8000-000000000001";
const topics = [`chat:${T1}:${CH1}`, `chat-channels:${T1}`, `notifications:${tA}:${empA}`];
const actors = { companyB: "employee.b@m1m2.test", colleagueA: "hr-employee.a@m1m2.test", anon: null, self: "employee.a@m1m2.test" };
const got = {};
for (const [name, email] of Object.entries(actors)) {
  const c = mk(); got[name] = [];
  if (email) { const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error; }
  await c.realtime.connect();
  for (const t of topics) { const res = await c.realtime.subscribe(t); console.log(`${name.padEnd(10)} ${t.slice(0, 40).padEnd(40)} ok=${res.ok} ${res.error?.code ?? ""}`); }
  for (const ev of ["INSERT_message", "INSERT_channel", "INSERT_notification"]) c.realtime.on(ev, (p) => got[name].push(ev));
  const pub = await c.realtime.publish(topics[2], "INSERT_notification", { spoof: true }).then(() => "sent-no-error", (e) => "error:" + e.message);
  console.log(`${name.padEnd(10)} publish attempt -> ${pub}`);
  actors[name] = c;
}
await new Promise((s) => setTimeout(s, 1500));
runSql(`SELECT realtime.publish('${topics[0]}','INSERT_message','{"probe":1}'::jsonb); SELECT realtime.publish('${topics[1]}','INSERT_channel','{"probe":1}'::jsonb); SELECT realtime.publish('${topics[2]}','INSERT_notification','{"probe":1}'::jsonb);`);
await new Promise((s) => setTimeout(s, 4000));
for (const n of Object.keys(got)) console.log(`RECEIVED ${n}: ${JSON.stringify(got[n])}`);
process.exit(0);
