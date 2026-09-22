import { runSql, verifyTarget } from "../tests/m1m2/_harness.mjs";
verifyTarget();
const rows = runSql(`SELECT proname, prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosrc ILIKE '%current_date%' ORDER BY 1`).rows;
for (const r of rows) {
  const lines = r.prosrc.split("\n").map((l, i) => [i + 1, l.trim()]).filter(([, l]) => /current_date/i.test(l));
  console.log(`\n## ${r.proname}`); for (const [n, l] of lines) console.log(`  ${n}: ${l.slice(0, 150)}`);
}
