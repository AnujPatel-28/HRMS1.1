// Force attendance derivation for a date range in the QA tenant.
//
// Attendance derivation runs on a schedule -- once an hour at :20, over a two-day lookback --
// and NOTHING in the product triggers it on demand (verified 2026-08-31: no HR screen calls
// hr_run_attendance_derivation). A tester who punches at 10:05 and looks at the attendance
// screen at 10:06 sees nothing, and has no way to make it appear.
//
// This exists so QA does not have to wait up to an hour between a punch and its result.
//
// hr_run_attendance_derivation opens with assert_hr_for_tenant, which raises when auth.uid()
// is NULL -- so this must run as a real HR SESSION, not through the admin key.
//
// RUN:  QA_PASSWORD='<the QA password>' node scratch/qa-force-derivation.mjs [from] [to]
//       Dates are YYYY-MM-DD and default to today.

import { createClient } from "@insforge/sdk";
import fs from "node:fs";

const env = fs.readFileSync(".env", "utf-8");
const baseUrl = env.match(/VITE_INSFORGE_URL=(.*)/)[1].replace(/"/g, "").trim();
const anonKey = env.match(/VITE_INSFORGE_ANON_KEY=(.*)/)[1].replace(/"/g, "").trim();

const password = process.env.QA_PASSWORD;
if (!password) {
  console.error("Set QA_PASSWORD -- see doc/qa/00-README.md.");
  process.exit(2);
}

const TENANT = "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e";
const today = new Date().toISOString().slice(0, 10);
const from = process.argv[2] ?? today;
const to = process.argv[3] ?? from;

if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  console.error(`Dates must be YYYY-MM-DD. Got from=${from} to=${to}`);
  process.exit(2);
}

const client = createClient({ baseUrl, anonKey });
const { error: authErr } = await client.auth.signInWithPassword({
  email: "hr-qa@talentmeshsolutions.com",
  password,
});
if (authErr) {
  console.error(`Sign-in failed: ${authErr.message}`);
  process.exit(1);
}

const { data, error } = await client.database.rpc("hr_run_attendance_derivation", {
  p_tenant_id: TENANT,
  p_from: from,
  p_to: to,
});

if (error) {
  console.error(`Derivation failed for ${from}..${to}: ${error.message}`);
  process.exit(1);
}

console.log(`Derivation run for ${from}..${to}:`);
console.log(JSON.stringify(data, null, 2));
console.log("\nRefresh the attendance screen -- the range above is now derived.");
