import { createClient } from "@insforge/sdk";
import fs from "fs";

// Load environment variables from .env
const envFile = fs.readFileSync(".env", "utf-8");
const urlMatch = envFile.match(/VITE_INSFORGE_URL=(.*)/);
const keyMatch = envFile.match(/VITE_INSFORGE_ANON_KEY=(.*)/);

const baseUrl = urlMatch[1].replace(/"/g, '').trim();
const anonKey = keyMatch[1].replace(/"/g, '').trim();

console.log("InsForge Backend URL:", baseUrl);

const employeeEmail = "employee-qa@talentmeshsolutions.com";
const hrEmail = "hr-qa@talentmeshsolutions.com";
const password = "Password@123";

const tenantId = "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e";
const hrId = "e0000000-0000-0000-0000-000000000001";
const managerId = "e0000000-0000-0000-0000-000000000002";
const employeeId = "e0000000-0000-0000-0000-000000000003";

// Dummy foreign tenant ID for cross-tenant tests
const foreignTenantId = "97da3641-d69e-4e7a-bdc9-760675be8d28";

async function main() {
  console.log("====================================================");
  console.log("    A1: FOUNDATION AUDIT AND LIVE RLS VERIFICATION  ");
  console.log("====================================================\n");

  // Initialize clients
  const empClient = createClient({ baseUrl, anonKey });
  const hrClient = createClient({ baseUrl, anonKey });

  // 1. Authenticate standard employee
  console.log(`Authenticating as standard employee: ${employeeEmail}...`);
  const empAuth = await empClient.auth.signInWithPassword({ email: employeeEmail, password });
  if (empAuth.error) {
    console.error("❌ Employee authentication failed:", empAuth.error.message);
    process.exit(1);
  }
  console.log("✅ Employee authenticated.");

  // 2. Authenticate HR user
  console.log(`Authenticating as HR: ${hrEmail}...`);
  const hrAuth = await hrClient.auth.signInWithPassword({ email: hrEmail, password });
  if (hrAuth.error) {
    console.error("❌ HR authentication failed:", hrAuth.error.message);
    process.exit(1);
  }
  console.log("✅ HR authenticated.\n");

  const empDb = empClient.database;
  const hrDb = hrClient.database;

  // Clean up any existing test records for test dates (2026-07-10 and 2026-07-11)
  console.log("Cleaning up previous test attendance data...");
  const cleanupDates = ["2026-07-10", "2026-07-11"];
  
  // Use HR client for cleanup to ensure we bypass employee RLS restrictions
  for (const date of cleanupDates) {
    await hrDb.from("attendance_corrections").delete().eq("tenant_id", tenantId).in("employee_id", [employeeId, managerId]);
    await hrDb.from("attendance_selfies").delete().eq("tenant_id", tenantId).in("employee_id", [employeeId, managerId]);
    await hrDb.from("attendance_breaks").delete().eq("tenant_id", tenantId).in("employee_id", [employeeId, managerId]);
    await hrDb.from("overtime_records").delete().eq("tenant_id", tenantId).in("employee_id", [employeeId, managerId]);
    await hrDb.from("attendance").delete().eq("tenant_id", tenantId).in("employee_id", [employeeId, managerId]);
  }
  console.log("✅ Cleanup completed.\n");

  const results = [];
  function record(testName, passed, details = "") {
    results.push({ testName, passed, details });
    console.log(`${passed ? "✅ PASS" : "❌ FAIL"}: ${testName} ${details ? `(${details})` : ""}`);
  }

  // Pre-requisite IDs
  let empAttendanceId = null;
  let mgrAttendanceId = null;

  // ==========================================================================
  // SETUP REFERENCE DATA AS HR
  // ==========================================================================
  console.log("--- Setting up manager attendance reference data (via HR client) ---");
  const { data: mgrAtt, error: mgrAttErr } = await hrDb.from("attendance").insert([{
    employee_id: managerId,
    tenant_id: tenantId,
    date: "2026-07-10",
    punch_in: new Date("2026-07-10T09:00:00Z").toISOString(),
    status: "present",
    session_status: "open"
  }]).select("id").single();

  if (mgrAttErr) {
    console.error("❌ Failed to set up manager attendance:", mgrAttErr.message);
    process.exit(1);
  }
  mgrAttendanceId = mgrAtt.id;
  console.log("Manager Attendance ID created:", mgrAttendanceId);

  // Set up manager break as HR
  const { data: mgrBreak, error: mgrBreakErr } = await hrDb.from("attendance_breaks").insert([{
    tenant_id: tenantId,
    employee_id: managerId,
    attendance_id: mgrAttendanceId,
    break_type: "lunch",
    started_at: new Date("2026-07-10T13:00:00Z").toISOString()
  }]).select("id").single();

  if (mgrBreakErr) {
    console.error("❌ Failed to set up manager break:", mgrBreakErr.message);
    process.exit(1);
  }
  const mgrBreakId = mgrBreak.id;
  console.log("Manager Break ID created:", mgrBreakId);

  // Set up manager selfie metadata as HR
  const { data: mgrSelfie, error: mgrSelfieErr } = await hrDb.from("attendance_selfies").insert([{
    tenant_id: tenantId,
    employee_id: managerId,
    attendance_id: mgrAttendanceId,
    type: "punch_in",
    storage_path: `${tenantId}/${managerId}/${mgrAttendanceId}/punch_in.jpg`
  }]).select("id").single();

  if (mgrSelfieErr) {
    console.error("❌ Failed to set up manager selfie:", mgrSelfieErr.message);
    process.exit(1);
  }
  const mgrSelfieId = mgrSelfie.id;
  console.log("Manager Selfie ID created:", mgrSelfieId);

  // Set up manager correction as HR
  const { data: mgrCorr, error: mgrCorrErr } = await hrDb.from("attendance_corrections").insert([{
    tenant_id: tenantId,
    employee_id: managerId,
    attendance_date: "2026-07-10",
    requested_punch_in: "09:00:00",
    reason: "Manager correction setup"
  }]).select("id").single();

  if (mgrCorrErr) {
    console.error("❌ Failed to set up manager correction:", mgrCorrErr.message);
    process.exit(1);
  }
  const mgrCorrId = mgrCorr.id;
  console.log("Manager Correction ID created:", mgrCorrId);
  console.log("");

  // ==========================================================================
  // EMPLOYEE SELF READ / WRITE
  // ==========================================================================
  console.log("--- Running Employee Self Read/Write Tests ---");
  
  // Test 1.1: Employee direct insert own attendance
  try {
    const { data, error } = await empDb.from("attendance").insert([{
      employee_id: employeeId,
      tenant_id: tenantId,
      date: "2026-07-11",
      punch_in: new Date("2026-07-11T09:00:00Z").toISOString(),
      status: "present",
      session_status: "open"
    }]).select("id").single();

    if (error) {
      record("Employee self insert own attendance", false, error.message);
    } else {
      empAttendanceId = data.id;
      record("Employee self insert own attendance", true, `Attendance ID: ${empAttendanceId}`);
    }
  } catch (err) {
    record("Employee self insert own attendance", false, err.message);
  }

  // Test 1.2: Employee self read own attendance
  if (empAttendanceId) {
    try {
      const { data, error } = await empDb.from("attendance").select("*").eq("id", empAttendanceId);
      if (error) {
        record("Employee self read own attendance", false, error.message);
      } else if (data && data.length > 0) {
        record("Employee self read own attendance", true, `Returned date: ${data[0].date}`);
      } else {
        record("Employee self read own attendance", false, "Returned 0 rows");
      }
    } catch (err) {
      record("Employee self read own attendance", false, err.message);
    }

    // Test 1.3: Employee self update own attendance (e.g. adding notes)
    try {
      const { data, error } = await empDb.from("attendance").update({ notes: "Adding self notes" }).eq("id", empAttendanceId).select();
      if (error) {
        record("Employee self update own attendance", false, error.message);
      } else if (data && data.length > 0 && data[0].notes === "Adding self notes") {
        record("Employee self update own attendance", true);
      } else {
        record("Employee self update own attendance", false, "No rows updated");
      }
    } catch (err) {
      record("Employee self update own attendance", false, err.message);
    }
  } else {
    record("Employee self read own attendance", false, "Skipped due to insert failure");
    record("Employee self update own attendance", false, "Skipped due to insert failure");
  }

  // Test 1.4: Employee create selfie metadata for own attendance
  let empSelfieId = null;
  if (empAttendanceId) {
    try {
      const { data, error } = await empDb.from("attendance_selfies").insert([{
        attendance_id: empAttendanceId,
        tenant_id: tenantId,
        employee_id: employeeId,
        type: "punch_in",
        storage_path: `${tenantId}/${employeeId}/${empAttendanceId}/punch_in.jpg`
      }]).select("id").single();

      if (error) {
        record("Employee create own selfie metadata", false, error.message);
      } else {
        empSelfieId = data.id;
        record("Employee create own selfie metadata", true, `Selfie ID: ${empSelfieId}`);
      }
    } catch (err) {
      record("Employee create own selfie metadata", false, err.message);
    }
  }

  // Test 1.5: Employee create correction for self (should be allowed under live policy)
  let empCorrId = null;
  try {
    const { data, error } = await empDb.from("attendance_corrections").insert([{
      tenant_id: tenantId,
      employee_id: employeeId,
      attendance_date: "2026-07-11",
      requested_punch_in: "09:05:00",
      reason: "Train was delayed"
    }]).select("id").single();

    if (error) {
      record("Employee create own correction", false, error.message);
    } else {
      empCorrId = data.id;
      record("Employee create own correction", true, `Correction ID: ${empCorrId}`);
    }
  } catch (err) {
    record("Employee create own correction", false, err.message);
  }
  console.log("");

  // ==========================================================================
  // CROSS-EMPLOYEE DIRECT API ACCESS RESTRICTIONS
  // ==========================================================================
  console.log("--- Running Cross-Employee Direct API Access Restrictions ---");

  // Test 2.1: Employee cannot read another employee attendance
  try {
    const { data, error } = await empDb.from("attendance").select("*").eq("id", mgrAttendanceId);
    if (error) {
      record("Employee cannot read another employee attendance (error returned)", true, error.message);
    } else if (data && data.length > 0) {
      record("Employee cannot read another employee attendance", false, "Security Failure: Data was returned!");
    } else {
      record("Employee cannot read another employee attendance (empty array)", true);
    }
  } catch (err) {
    record("Employee cannot read another employee attendance", false, err.message);
  }

  // Test 2.2: Employee cannot insert attendance for another employee
  try {
    const { data, error } = await empDb.from("attendance").insert([{
      employee_id: managerId,
      tenant_id: tenantId,
      date: "2026-07-11",
      punch_in: new Date("2026-07-11T09:00:00Z").toISOString(),
      status: "present",
      session_status: "open"
    }]).select("id").single();

    if (error && (error.code === "42501" || error.message.includes("violates row-level security"))) {
      record("Employee cannot insert attendance for another employee", true, "Blocked by RLS");
    } else if (data) {
      record("Employee cannot insert attendance for another employee", false, `Security Failure: Inserted ID: ${data.id}`);
    } else {
      record("Employee cannot insert attendance for another employee", false, `No error but no data: ${error?.message}`);
    }
  } catch (err) {
    record("Employee cannot insert attendance for another employee", true, `Blocked with exception: ${err.message}`);
  }

  // Test 2.3: Employee cannot update/delete another employee break
  // Update other employee break
  try {
    const { data, error } = await empDb.from("attendance_breaks").update({ break_type: "tea" }).eq("id", mgrBreakId).select();
    const blocked = (error && (error.code === "42501" || error.message.includes("violates row-level security"))) || (!error && (!data || data.length === 0));
    if (blocked) {
      record("Employee cannot update another employee break", true, error ? error.message : "0 rows updated");
    } else {
      record("Employee cannot update another employee break", false, "Security Failure: Break was updated!");
    }
  } catch (err) {
    record("Employee cannot update another employee break", false, err.message);
  }

  // Delete other employee break
  try {
    const { data, error } = await empDb.from("attendance_breaks").delete().eq("id", mgrBreakId).select();
    const blocked = (error && (error.code === "42501" || error.message.includes("violates row-level security"))) || (!error && (!data || data.length === 0));
    if (blocked) {
      record("Employee cannot delete another employee break", true, error ? error.message : "0 rows deleted");
    } else {
      record("Employee cannot delete another employee break", false, "Security Failure: Break was deleted!");
    }
  } catch (err) {
    record("Employee cannot delete another employee break", false, err.message);
  }

  // Test 2.4: Employee cannot update/delete another employee selfie metadata
  // Update other employee selfie metadata
  try {
    const { data, error } = await empDb.from("attendance_selfies").update({ type: "punch_out" }).eq("id", mgrSelfieId).select();
    const blocked = (error && (error.code === "42501" || error.message.includes("violates row-level security"))) || (!error && (!data || data.length === 0));
    if (blocked) {
      record("Employee cannot update another employee selfie metadata", true, error ? error.message : "0 rows updated");
    } else {
      record("Employee cannot update another employee selfie metadata", false, "Security Failure: Selfie updated!");
    }
  } catch (err) {
    record("Employee cannot update another employee selfie metadata", false, err.message);
  }

  // Delete other employee selfie metadata
  try {
    const { data, error } = await empDb.from("attendance_selfies").delete().eq("id", mgrSelfieId).select();
    const blocked = (error && (error.code === "42501" || error.message.includes("violates row-level security"))) || (!error && (!data || data.length === 0));
    if (blocked) {
      record("Employee cannot delete another employee selfie metadata", true, error ? error.message : "0 rows deleted");
    } else {
      record("Employee cannot delete another employee selfie metadata", false, "Security Failure: Selfie deleted!");
    }
  } catch (err) {
    record("Employee cannot delete another employee selfie metadata", false, err.message);
  }

  // Test 2.5: Employee cannot create correction for another employee
  try {
    const { data, error } = await empDb.from("attendance_corrections").insert([{
      tenant_id: tenantId,
      employee_id: managerId,
      attendance_date: "2026-07-11",
      requested_punch_in: "09:05:00",
      reason: "Try to inject correction"
    }]).select("id").single();

    if (error && (error.code === "42501" || error.message.includes("violates row-level security"))) {
      record("Employee cannot create correction for another employee", true, "Blocked by RLS");
    } else if (data) {
      record("Employee cannot create correction for another employee", false, `Security Failure: Inserted ID: ${data.id}`);
    } else {
      record("Employee cannot create correction for another employee", false, `No error but no data: ${error?.message}`);
    }
  } catch (err) {
    record("Employee cannot create correction for another employee", true, `Blocked with exception: ${err.message}`);
  }

  // Test 2.6: Employee cannot update another employee's correction
  try {
    const { data, error } = await empDb.from("attendance_corrections").update({ reason: "Hacked reason" }).eq("id", mgrCorrId).select();
    const blocked = (error && (error.code === "42501" || error.message.includes("violates row-level security"))) || (!error && (!data || data.length === 0));
    if (blocked) {
      record("Employee cannot update another employee correction", true, error ? error.message : "0 rows updated");
    } else {
      record("Employee cannot update another employee correction", false, "Security Failure: Correction was updated!");
    }
  } catch (err) {
    record("Employee cannot update another employee correction", false, err.message);
  }

  // Test 2.7: Employee cannot delete another employee's correction
  try {
    const { data, error } = await empDb.from("attendance_corrections").delete().eq("id", mgrCorrId).select();
    const blocked = (error && (error.code === "42501" || error.message.includes("violates row-level security"))) || (!error && (!data || data.length === 0));
    if (blocked) {
      record("Employee cannot delete another employee correction", true, error ? error.message : "0 rows deleted");
    } else {
      record("Employee cannot delete another employee correction", false, "Security Failure: Correction was deleted!");
    }
  } catch (err) {
    record("Employee cannot delete another employee correction", false, err.message);
  }

  // Test 2.8: Employee cannot update own correction employee_id to manager (Privilege Escalation)
  if (empCorrId) {
    try {
      const { data, error } = await empDb.from("attendance_corrections").update({ employee_id: managerId }).eq("id", empCorrId).select();
      const blocked = (error && (error.code === "42501" || error.message.includes("violates row-level security"))) || (!error && (!data || data.length === 0 || data[0].employee_id !== managerId));
      if (blocked) {
        record("Employee cannot update own correction employee_id to manager", true, error ? error.message : "Blocked or ignored");
      } else {
        record("Employee cannot update own correction employee_id to manager", false, `Security Failure: Allowed updating employee_id to ${data[0].employee_id}!`);
      }
    } catch (err) {
      record("Employee cannot update own correction employee_id to manager", true, `Blocked with exception: ${err.message}`);
    }

    // Test 2.9: Employee cannot update own correction tenant_id to foreign tenant (Privilege Escalation)
    try {
      const { data, error } = await empDb.from("attendance_corrections").update({ tenant_id: foreignTenantId }).eq("id", empCorrId).select();
      const blocked = (error && (error.code === "42501" || error.message.includes("violates row-level security"))) || (!error && (!data || data.length === 0 || data[0].tenant_id !== foreignTenantId));
      if (blocked) {
        record("Employee cannot update own correction tenant_id to foreign tenant", true, error ? error.message : "Blocked or ignored");
      } else {
        record("Employee cannot update own correction tenant_id to foreign tenant", false, `Security Failure: Allowed updating tenant_id to ${data[0].tenant_id}!`);
      }
    } catch (err) {
      record("Employee cannot update own correction tenant_id to foreign tenant", true, `Blocked with exception: ${err.message}`);
    }
  } else {
    record("Employee cannot update own correction employee_id to manager", false, "Skipped due to insert failure");
    record("Employee cannot update own correction tenant_id to foreign tenant", false, "Skipped due to insert failure");
  }
  console.log("");

  // ==========================================================================
  // HR TENANT-SCOPED ACCESS
  // ==========================================================================
  console.log("--- Running HR Tenant-Scoped Access Tests ---");

  // Test 3.1: HR can read employee attendance
  try {
    const { data, error } = await hrDb.from("attendance").select("*").eq("id", empAttendanceId);
    if (error) {
      record("HR can read employee attendance", false, error.message);
    } else if (data && data.length > 0) {
      record("HR can read employee attendance", true, `Returned ID: ${data[0].id}`);
    } else {
      record("HR can read employee attendance", false, "Returned 0 rows");
    }
  } catch (err) {
    record("HR can read employee attendance", false, err.message);
  }

  // Test 3.2: HR can create and manage breaks/selfies/corrections for employee
  try {
    const { data: hrBreak, error: hrBreakErr } = await hrDb.from("attendance_breaks").insert([{
      tenant_id: tenantId,
      employee_id: employeeId,
      attendance_id: empAttendanceId,
      break_type: "lunch",
      started_at: new Date().toISOString()
    }]).select("id").single();

    if (hrBreakErr) {
      record("HR can create break for employee", false, hrBreakErr.message);
    } else {
      record("HR can create break for employee", true, `Break ID: ${hrBreak.id}`);
      
      // HR delete that break
      const { error: delErr } = await hrDb.from("attendance_breaks").delete().eq("id", hrBreak.id);
      record("HR can delete break for employee", !delErr, delErr ? delErr.message : "");
    }
  } catch (err) {
    record("HR can manage break for employee", false, err.message);
  }
  console.log("");

  // ==========================================================================
  // CROSS-TENANT ACCESS DENIED
  // ==========================================================================
  console.log("--- Running Cross-Tenant Access Restrictions ---");

  // Test 4.1: Employee cannot insert attendance with foreign tenant_id
  try {
    const { data, error } = await empDb.from("attendance").insert([{
      employee_id: employeeId,
      tenant_id: foreignTenantId,
      date: "2026-07-11",
      punch_in: new Date().toISOString(),
      status: "present",
      session_status: "open"
    }]).select("id").single();

    const blocked = (error && (error.code === "42501" || error.message.includes("violates row-level security"))) || (!error && (!data));
    record("Employee cannot insert attendance with foreign tenant_id", blocked, error ? error.message : "Blocked (no data returned)");
  } catch (err) {
    record("Employee cannot insert attendance with foreign tenant_id", true, `Blocked with exception: ${err.message}`);
  }

  // Test 4.2: HR cannot insert attendance with foreign tenant_id
  try {
    const { data, error } = await hrDb.from("attendance").insert([{
      employee_id: employeeId,
      tenant_id: foreignTenantId,
      date: "2026-07-11",
      punch_in: new Date().toISOString(),
      status: "present",
      session_status: "open"
    }]).select("id").single();

    const blocked = (error && (error.code === "42501" || error.message.includes("violates row-level security"))) || (!error && (!data));
    record("HR cannot insert attendance with foreign tenant_id", blocked, error ? error.message : "Blocked (no data returned)");
  } catch (err) {
    record("HR cannot insert attendance with foreign tenant_id", true, `Blocked with exception: ${err.message}`);
  }

  // Test 4.3: Employee cannot read foreign tenant shifts (should return empty or error)
  try {
    // Shifts belong to our tenant should be visible, but what about shifts belonging to foreign tenant?
    // Let's query shifts with get_auth_tenant_id checking. If we filter by foreignTenantId, it should be empty.
    const { data, error } = await empDb.from("shifts").select("*").eq("tenant_id", foreignTenantId);
    if (error) {
      record("Employee cannot read foreign tenant shifts", true, error.message);
    } else if (data && data.length > 0) {
      record("Employee cannot read foreign tenant shifts", false, `Security Failure: Returned ${data.length} foreign shifts!`);
    } else {
      record("Employee cannot read foreign tenant shifts (returned empty)", true);
    }
  } catch (err) {
    record("Employee cannot read foreign tenant shifts", false, err.message);
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log("\n====================================================");
  console.log("                  VERIFICATION SUMMARY              ");
  console.log("====================================================");
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  console.log(`Total tests run: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("====================================================");

  if (failed > 0) {
    console.error("\n❌ Core verification failed. Review test logs above.");
    process.exit(1);
  } else {
    console.log("\n🎉 Verification passed successfully! Live RLS matches expectations.");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Unhandle exception in verification main:", err);
  process.exit(1);
});
