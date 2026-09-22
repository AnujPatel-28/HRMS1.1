import { runSql, verifyTarget } from "../tests/m1m2/_harness.mjs";
verifyTarget();
for (const r of runSql(`SELECT proname, pg_get_function_identity_arguments(oid) a, prosecdef::text d, prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('attendance_derive_pass1','attendance_derive_pass2')`).rows) {
  console.log(`\n## ${r.proname}(${r.a}) definer=${r.d}`);
  r.prosrc.split("\n").map((l, i) => [i + 1, l.trim()]).filter(([, l]) => /attendance_id|is_locked|UPDATE|INSERT|WHERE .*IS NULL|day_fraction|leave/i.test(l)).slice(0, 22).forEach(([n, l]) => console.log(`  ${n}: ${l.slice(0, 140)}`));
}
const callers = runSql(`SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosrc ~ 'attendance_derive_pass' AND proname !~ '^attendance_derive_pass'`).rows.map((x) => x.proname);
console.log("\ncallers:", callers.join(", "));
