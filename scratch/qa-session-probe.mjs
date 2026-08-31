// QA session probe -- the half of the QA plan that SQL cannot test.
//
// A `db query` runs as project_admin: RLS is bypassed, auth.uid() is NULL, and every
// tenant-scoped policy therefore returns the same answer whether it is correct or completely
// broken. The only way to know what a real user can reach is to hold a real session. This
// script signs in as each QA persona through the SDK -- exactly as the browser does -- and
// asserts what each one can and cannot read or write.
//
// Everything here is a REGRESSION GUARD for a hole that was real:
//   - employees could write any column on their own attendance row (payroll-relevant)
//   - the leave tenant fence was written PERMISSIVE, so it granted instead of fencing
//   - a superadmin/HR session cannot verify either, which is why this runs as an employee
//
// RUN:  QA_PASSWORD='<the QA password>' node scratch/qa-session-probe.mjs
//       The password is never committed. See doc/qa/00-README.md.

import { createClient } from "@insforge/sdk";
import fs from "node:fs";

const env = fs.readFileSync(".env", "utf-8");
const baseUrl = env.match(/VITE_INSFORGE_URL=(.*)/)[1].replace(/"/g, "").trim();
const anonKey = env.match(/VITE_INSFORGE_ANON_KEY=(.*)/)[1].replace(/"/g, "").trim();

const password = process.env.QA_PASSWORD;
if (!password) {
  console.error("Set QA_PASSWORD. The QA password is deliberately not in the repo -- see doc/qa/00-README.md.");
  process.exit(2);
}

const TENANT = "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e";
const OTHER_TENANT = "97da3641-d69e-4e7a-bdc9-760675be8d28";
const HR_ID = "e0000000-0000-0000-0000-000000000001";
const MANAGER_ID = "e0000000-0000-0000-0000-000000000002";
const EMPLOYEE_ID = "e0000000-0000-0000-0000-000000000003";

let failures = 0;
let checks = 0;

function record(id, ok, detail) {
  checks += 1;
  if (ok) {
    console.log(`  PASS  ${id}  ${detail}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${id}  ${detail}`);
  }
}

async function signIn(email) {
  const client = createClient({ baseUrl, anonKey });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    console.error(`Could not sign in as ${email}: ${error.message}`);
    process.exit(1);
  }
  return client;
}

// A write is "refused" if it errors OR silently affects zero rows. RLS usually does the
// latter, so treating only an error as refusal would pass a wide-open table.
async function writeRefused(query) {
  const { data, error } = await query;
  if (error) return { refused: true, how: `error: ${error.message.slice(0, 70)}` };
  const n = Array.isArray(data) ? data.length : data ? 1 : 0;
  return { refused: n === 0, how: n === 0 ? "0 rows affected" : `${n} row(s) WRITTEN` };
}

console.log("\n=== QA session probe ===\n");

// ---------------------------------------------------------------------------
console.log("EMPLOYEE session (employee-qa) -- the only role that can verify a tenant fence");
// ---------------------------------------------------------------------------
{
  const db = (await signIn("employee-qa@talentmeshsolutions.com")).database;

  // S1. The employee can read their own row. A non-empty result is the point: a broken
  // policy and a correct one both return 0 rows for HR or superadmin, so only this session
  // can tell them apart.
  const own = await db.from("employees").select("id, full_name, employee_code").eq("id", EMPLOYEE_ID);
  record("S1", !own.error && (own.data?.length ?? 0) === 1,
    `own employees row readable: ${own.data?.length ?? 0} row(s)${own.error ? ` (${own.error.message})` : ""}`);

  // S2. Colleague lookup goes through the view, never the base table. If the base table
  // leaked colleagues, this would return more than the employee's own row.
  const others = await db.from("employees").select("id").neq("id", EMPLOYEE_ID).eq("tenant_id", TENANT);
  record("S2", (others.data?.length ?? 0) === 0,
    `base employees table exposes ${others.data?.length ?? 0} colleague row(s) (want 0 -- use employee_directory_public)`);

  const dir = await db.from("employee_directory_public").select("id, full_name").limit(20);
  record("S3", !dir.error && (dir.data?.length ?? 0) > 1,
    `employee_directory_public returns ${dir.data?.length ?? 0} colleague(s)${dir.error ? ` (${dir.error.message})` : ""}`);

  // S4. Cross-tenant read. The RESTRICTIVE fence must return nothing, not an error --
  // an error here would mean something other than the fence is refusing.
  const cross = await db.from("employees").select("id").eq("tenant_id", OTHER_TENANT);
  record("S4", (cross.data?.length ?? 0) === 0,
    `cross-tenant employees read returns ${cross.data?.length ?? 0} row(s) (want 0)`);

  // S5. Own leave balances readable -- otherwise the employee's Leave screen is blank and a
  // tester reports it as a product bug.
  const bal = await db.from("leave_balances").select("leave_type_id, balance").eq("employee_id", EMPLOYEE_ID);
  record("S5", !bal.error && (bal.data?.length ?? 0) === 4,
    `own leave balances readable: ${bal.data?.length ?? 0} of 4${bal.error ? ` (${bal.error.message})` : ""}`);

  // S6. REGRESSION GUARD (leave RLS fence was PERMISSIVE, i.e. a grant, until 20260831100000).
  // An employee editing their own balance is free leave.
  const s6 = await writeRefused(
    db.from("leave_balances").update({ balance: 999 }).eq("employee_id", EMPLOYEE_ID).select()
  );
  record("S6", s6.refused, `employee raising their own leave balance is refused -- ${s6.how}`);

  // S7. Same fence, the payroll-relevant column: is_paid on a leave TYPE is tenant-wide policy.
  const s7 = await writeRefused(
    db.from("leave_types").update({ is_paid: false }).eq("tenant_id", TENANT).select()
  );
  record("S7", s7.refused, `employee flipping leave_types.is_paid is refused -- ${s7.how}`);

  // S8. REGRESSION GUARD (employee attendance write surface revoked in 20260829140000).
  // RLS cannot restrict columns, so the whole write surface had to go: work_hours, status
  // and is_late all feed payroll.
  const s8 = await writeRefused(
    db.from("attendance").update({ work_hours: 24, status: "present" }).eq("employee_id", EMPLOYEE_ID).select()
  );
  record("S8", s8.refused, `employee writing their own attendance row is refused -- ${s8.how}`);

  // S9. Editing a colleague.
  const s9 = await writeRefused(
    db.from("employees").update({ full_name: "PROBE OVERWRITE" }).eq("id", MANAGER_ID).select()
  );
  record("S9", s9.refused, `employee editing a colleague's record is refused -- ${s9.how}`);

  // S10. Org structure is HR-managed reference data; an employee must not be able to reshape it.
  const s10 = await writeRefused(
    db.from("org_units").update({ name: "PROBE OVERWRITE" }).eq("tenant_id", TENANT).select()
  );
  record("S10", s10.refused, `employee renaming an org unit is refused -- ${s10.how}`);
}

// ---------------------------------------------------------------------------
console.log("\nHR session (hr-qa)");
// ---------------------------------------------------------------------------
{
  const db = (await signIn("hr-qa@talentmeshsolutions.com")).database;

  const all = await db.from("employees").select("id, full_name").eq("tenant_id", TENANT);
  record("H1", !all.error && (all.data?.length ?? 0) >= 6,
    `HR reads the whole tenant directory: ${all.data?.length ?? 0} employee(s)${all.error ? ` (${all.error.message})` : ""}`);

  // H2. HR is tenant-scoped too. is_hr() short-circuits most policies, so this is the one
  // place an HR session is genuinely informative: it must NOT reach across tenants.
  const cross = await db.from("employees").select("id").eq("tenant_id", OTHER_TENANT);
  record("H2", (cross.data?.length ?? 0) === 0,
    `HR cross-tenant read returns ${cross.data?.length ?? 0} row(s) (want 0)`);

  const shifts = await db.from("shifts").select("id, name").eq("tenant_id", TENANT);
  record("H3", !shifts.error && (shifts.data?.length ?? 0) === 3,
    `HR reads shifts: ${shifts.data?.length ?? 0} of 3${shifts.error ? ` (${shifts.error.message})` : ""}`);

  const att = await db.from("attendance").select("id").eq("tenant_id", TENANT).limit(5);
  record("H4", !att.error, `HR reads the tenant attendance register${att.error ? ` -- ERROR ${att.error.message}` : ""}`);
}

// ---------------------------------------------------------------------------
console.log("\nMANAGER session (manager-qa) -- role is 'employee'; manager-ness is derived");
// ---------------------------------------------------------------------------
{
  const db = (await signIn("manager-qa@talentmeshsolutions.com")).database;

  // M1. AuthContext sets isManager from this exact count. Zero here means the Team screens
  // never render, and every manager test case in doc/qa/ is unrunnable.
  const reports = await db.from("employees").select("id", { count: "exact", head: true })
    .eq("manager_id", MANAGER_ID).eq("tenant_id", TENANT);
  record("M1", (reports.count ?? 0) > 0,
    `manager sees ${reports.count ?? 0} direct report(s) -- this count is what sets isManager`);

  // M2. A manager is still an employee: no HR-only write surface.
  const m2 = await writeRefused(
    db.from("employees").update({ employee_code: "PROBE" }).eq("id", HR_ID).select()
  );
  record("M2", m2.refused, `manager editing the HR admin's record is refused -- ${m2.how}`);
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures === 0 ? 0 : 1);
