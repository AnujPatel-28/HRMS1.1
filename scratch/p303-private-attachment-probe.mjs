// Lead probe: can a non-member channel manager (HR) read a PRIVATE channel's attachment?
import { createClient } from "@insforge/sdk";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { TB_M1M2 } from "../tests/m1m2/_target.mjs";
import { verifyTarget, runSql } from "../tests/m1m2/_harness.mjs";
verifyTarget();
const r = spawnSync(process.execPath, ["node_modules/@insforge/cli/dist/index.js", "secrets", "get", "ANON_KEY", "--json"], { encoding: "utf8" });
const key = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).value;
const pw = readFileSync("tests/m1m2/persona-password.local", "utf8").trim();
const A = "a0000000-0000-4000-8000-000000000001", EA = "a0000000-0000-4000-8001-000000000002";
const CH = "c3039000-0000-4000-8000-000000000001", obj = `${A}/${CH}/lead-probe.txt`;
const login = async (email) => { const c = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey: key }); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error; return c; };
const ea = await login("employee.a@m1m2.test"), hr = await login("hr-employee.a@m1m2.test");
try {
  runSql(`INSERT INTO public.chat_channels(id,tenant_id,name,type,created_by) VALUES('${CH}','${A}','lead-private-probe','custom','${EA}');
          INSERT INTO public.chat_channel_members(channel_id,employee_id,tenant_id) VALUES('${CH}','${EA}','${A}');`);
  const up = await ea.storage.from("chat-attachments").upload(obj, new Blob(["private"], { type: "text/plain" }));
  console.log("member upload:", up.error ? "ERR " + up.error.message : "ok");
  const m = await ea.storage.from("chat-attachments").download(obj);
  console.log("member download:", m.error ? "DENIED " + m.error.message : "ALLOWED");
  const h = await hr.storage.from("chat-attachments").download(obj);
  console.log("HR (non-member, channel.manage) download:", h.error ? "DENIED " + h.error.message : "ALLOWED");
  const hu = await hr.storage.from("chat-attachments").upload(`${A}/${CH}/hr-write.txt`, new Blob(["x"], { type: "text/plain" }));
  console.log("HR (non-member) upload:", hu.error ? "DENIED " + hu.error.message : "ALLOWED");
} finally {
  await ea.storage.from("chat-attachments").remove(obj); await hr.storage.from("chat-attachments").remove(`${A}/${CH}/hr-write.txt`);
  runSql(`DELETE FROM public.chat_channel_members WHERE channel_id='${CH}'`); runSql(`DELETE FROM public.chat_channels WHERE id='${CH}'`);
  console.log("teardown done");
}
process.exit(0);
