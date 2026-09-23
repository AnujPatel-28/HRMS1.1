// Probe: which storage buckets a plain employee (employee.a on TB-M1M2) can upload into. Run from the repo root.
// Measures which buckets accept an upload from a plain employee (global storage_objects_owner_insert).
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@insforge/sdk";
import { runSql } from "../../tests/m1m2/_harness.mjs";
import { TB_M1M2 } from "../../tests/m1m2/_target.mjs";

const A = "a0000000-0000-4000-8000-000000000001";
const password = readFileSync("tests/m1m2/persona-password.local", "utf8").trim();
const r = spawnSync(process.execPath, ["node_modules/@insforge/cli/dist/index.js", "secrets", "get", "ANON_KEY", "--json"], { encoding: "utf8" });
const key = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).value;
const c = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey: key });
await c.auth.signInWithPassword({ email: "employee.a@m1m2.test", password });

const buckets = runSql(`SELECT name, public FROM storage.buckets ORDER BY name`).rows;
for (const b of buckets) {
  const k = `${A}/c6-probe-${randomUUID().slice(0, 8)}.txt`;
  const up = await c.storage.from(b.name).upload(k, new Blob(["probe"], { type: "text/plain" }));
  const exists = Number(runSql(`SELECT count(*)::int n FROM storage.objects WHERE bucket='${b.name}' AND key='${k}'`).rows[0].n) === 1;
  if (exists) await c.storage.from(b.name).remove(k);
  const left = Number(runSql(`SELECT count(*)::int n FROM storage.objects WHERE bucket='${b.name}' AND key='${k}'`).rows[0].n);
  console.log(`${b.name.padEnd(26)} public=${String(b.public).padEnd(5)} employee upload at tenant root: ${exists ? "CREATED" : "denied"}${left ? "  (CLEANUP FAILED)" : ""}`);
}
