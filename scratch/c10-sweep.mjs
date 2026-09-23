// C10 sweep (read-only, TB): SECURITY DEFINER functions that RAISE on a row's status before any
// authorization call. Prints: function, line of first status-raise, line of first auth call.
import { runSql } from "../tests/m1m2/_harness.mjs";

const AUTH = /(assert_leave_reviewer|assert_[a-z_]*(reviewer|approver|hr|tenant|caller|capability|access|manager|owner|admin)[a-z_]*\(|is_hr\(|can_access_tenant\(|has_capability|caller_has_|is_manager_of\(|resolve_capability|assert_can_|Forbidden)/i;
const r = runSql(`select p.proname, pg_get_functiondef(p.oid) as def
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
   and position('RAISE' in upper(pg_get_functiondef(p.oid))) > 0
   and (position('status' in lower(pg_get_functiondef(p.oid))) > 0)`);
const rows = r.rows ?? r;
console.log(`definer functions with RAISE + status: ${rows.length}`);
let hits = 0;
for (const { proname, def } of rows) {
  const lines = def.replace(/\r\n/g, "\n").split("\n");
  const statusRaise = lines.findIndex((l) => /raise\s+exception/i.test(l) && /(pending|status|no longer|already)/i.test(l));
  if (statusRaise < 0) continue;
  const auth = lines.findIndex((l) => AUTH.test(l) && !/^\s*--/.test(l));
  const authName = auth < 0 ? "NONE" : (lines[auth].match(AUTH) || [""])[0];
  if (auth < 0 || auth > statusRaise) {
    hits++;
    console.log(`${proname}: status-raise line ${statusRaise + 1}: ${lines[statusRaise].trim().slice(0, 90)} | first auth line ${auth < 0 ? "NONE" : auth + 1} ${authName}`);
  }
}
console.log(`candidates: ${hits}`);
