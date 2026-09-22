// Lead probe for 192200: no onboarding row => window closed; employees cannot reopen it.
import { createClient } from "@insforge/sdk";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { TB_M1M2 } from "../tests/m1m2/_target.mjs";
import { verifyTarget, runSql } from "../tests/m1m2/_harness.mjs";
verifyTarget();
const r = spawnSync(process.execPath, ["node_modules/@insforge/cli/dist/index.js", "secrets", "get", "ANON_KEY", "--json"], { encoding: "utf8" });
const key = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).value;
const pw = readFileSync("tests/m1m2/persona-password.local", "utf8").trim();
const EA = "a0000000-0000-4000-8001-000000000002", A = "a0000000-0000-4000-8000-000000000001";
const orig = runSql(`SELECT account_number FROM public.employees WHERE id='${EA}'`).rows[0].account_number;
const hadRow = runSql(`SELECT count(*)::int n FROM public.employee_onboarding_self WHERE employee_id='${EA}'`).rows[0].n;
console.log("employee.a has onboarding row:", hadRow);
const c = createClient({ baseUrl: TB_M1M2.baseUrl, functionsUrl: TB_M1M2.functionsUrl, anonKey: key });
await c.auth.signInWithPassword({ email: "employee.a@m1m2.test", password: pw });
try {
  let x = await c.database.from("employees").update({ account_number: "p-lead-192200" }).eq("id", EA).select("account_number");
  console.log("NO ROW -> employee.a writes own account_number:", x.error ? "DENIED " + x.error.message.slice(0, 70) : "ALLOWED");
  x = await c.database.from("employee_onboarding_self").insert([{ tenant_id: A, employee_id: EA }]).select("employee_id");
  console.log("employee.a inserts own onboarding row (to reopen):", x.error ? "DENIED " + x.error.message.slice(0, 70) : "ALLOWED");
  runSql(`INSERT INTO public.employee_onboarding_self(tenant_id,employee_id,completed_at) VALUES('${A}','${EA}',now())`);
  x = await c.database.from("employee_onboarding_self").update({ completed_at: null }).eq("employee_id", EA).select("completed_at");
  console.log("employee.a clears own completed_at:", x.error ? "DENIED " + x.error.message.slice(0, 70) : "ALLOWED " + JSON.stringify(x.data));
  x = await c.database.from("employee_onboarding_self").delete().eq("employee_id", EA).select("employee_id");
  console.log("employee.a deletes own completed row:", x.error ? "DENIED " + x.error.message.slice(0, 70) : `rows=${x.data?.length}`);
  runSql(`UPDATE public.employee_onboarding_self SET completed_at=NULL WHERE employee_id='${EA}'`);
  x = await c.database.from("employees").update({ account_number: "p-lead-192200" }).eq("id", EA).select("account_number");
  console.log("OPEN ROW -> employee.a writes own account_number:", x.error ? "DENIED" : "ALLOWED (onboarding window)");
} finally {
  runSql(`DELETE FROM public.employee_onboarding_self WHERE employee_id='${EA}'`);
  runSql(`UPDATE public.employees SET account_number=${orig === null ? "NULL" : `'${orig}'`} WHERE id='${EA}'`);
  console.log("RESTORED:", runSql(`SELECT count(*)::int n FROM public.employee_onboarding_self WHERE employee_id='${EA}'`).rows[0].n === hadRow);
}
process.exit(0);
