// Lead probe: a channel manager (HR) must not self-add to someone else's private channel.
import { createClient } from "@insforge/sdk";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { TB_M1M2 } from "../tests/m1m2/_target.mjs";
import { verifyTarget, runSql } from "../tests/m1m2/_harness.mjs";
verifyTarget();
const r = spawnSync(process.execPath, ["node_modules/@insforge/cli/dist/index.js", "secrets", "get", "ANON_KEY", "--json"], { encoding: "utf8" });
const key = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).value;
const pw = readFileSync("tests/m1m2/persona-password.local", "utf8").trim();
const A = "a0000000-0000-4000-8000-000000000001", EA = "a0000000-0000-4000-8001-000000000002", HR = "a0000000-0000-4000-8002-000000000002";
const CH = "c3039400-0000-4000-8000-000000000001";
const c = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey: key });
await c.auth.signInWithPassword({ email: "hr-employee.a@m1m2.test", password: pw });
let own;
try {
  runSql(`INSERT INTO public.chat_channels(id,tenant_id,name,type,created_by) VALUES('${CH}','${A}','lead-selfadd-probe','custom','${EA}')`);
  runSql(`INSERT INTO public.chat_channel_members(channel_id,employee_id,tenant_id) VALUES('${CH}','${EA}','${A}')`);
  const self = await c.database.rpc("p3_set_channel_members", { p_channel_id: CH, p_employee_ids: [HR] });
  console.log("HR self-add to employee.a's private channel:", self.error ? "DENIED " + self.error.message : "ALLOWED " + JSON.stringify(self.data));
  const created = await c.database.rpc("p3_create_chat_channel", { p_name: "lead-hr-own-probe", p_type: "custom" });
  own = created.data;
  const selfOwn = await c.database.rpc("p3_set_channel_members", { p_channel_id: own, p_employee_ids: [HR, EA] });
  console.log("HR self-add to own channel:", selfOwn.error ? "DENIED " + selfOwn.error.message : "ALLOWED added=" + selfOwn.data);
} finally {
  for (const id of [CH, own].filter(Boolean)) { runSql(`DELETE FROM public.chat_channel_members WHERE channel_id='${id}'`); runSql(`DELETE FROM public.chat_channels WHERE id='${id}'`); }
  console.log("teardown done");
}
process.exit(0);
