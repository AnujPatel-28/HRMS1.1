import { createClient } from "@insforge/sdk";
import fs from "fs";

// Load environment variables
const envFile = fs.readFileSync(".env", "utf-8");
const urlMatch = envFile.match(/VITE_INSFORGE_URL=(.*)/);
const keyMatch = envFile.match(/VITE_INSFORGE_ANON_KEY=(.*)/);

const baseUrl = urlMatch[1].replace(/"/g, '').trim();
const anonKey = keyMatch[1].replace(/"/g, '').trim();

const client = createClient({ baseUrl, anonKey });

const employeeEmail = "employee-qa@talentmeshsolutions.com";
const hrEmail = "hr-qa@talentmeshsolutions.com";
const password = "Password@123";

// Employee ID constants (tenant da7a0000-7e57-4bca-95ba-c4ea7a6eca5e)
const hrId = "e0000000-0000-0000-0000-000000000001";
const managerId = "e0000000-0000-0000-0000-000000000002";
const employeeId = "e0000000-0000-0000-0000-000000000003";

async function verifyRLS() {
  console.log("====================================================");
  console.log("      RUNNING DIRECT RLS AND PRIVILEGE TESTS        ");
  console.log("====================================================\n");

  // Sign in as Standard Employee
  console.log(`[1] Authenticating as standard employee: ${employeeEmail}...`);
  const empClient = createClient({ baseUrl, anonKey });
  const { data: empSession, error: empAuthError } = await empClient.auth.signInWithPassword({
    email: employeeEmail,
    password,
  });

  if (empAuthError) {
    console.error("❌ Employee authentication failed:", empAuthError.message);
    process.exit(1);
  }
  console.log("✅ Authenticated successfully.\n");

  const empDb = empClient.database;

  // Test 1: Query own row from base employees table
  console.log("--- Test 1.1: Query own row from base 'employees' table ---");
  const { data: ownRow, error: ownRowErr } = await empDb
    .from("employees")
    .select("id, full_name, email, role, aadhaar_number, pan_number, bank_name, account_number, ifsc_code")
    .eq("id", employeeId);

  if (ownRowErr) {
    console.error("❌ Failed to query own row:", ownRowErr.message);
  } else if (ownRow && ownRow.length > 0) {
    console.log("✅ Successfully queried own row. Full Name:", ownRow[0].full_name);
    console.log("   Verify sensitive info present:", ownRow[0].pan_number ? "Yes" : "No/Null");
  } else {
    console.error("❌ Own row not returned!");
  }

  // Test 2: Query another employee's row from base employees table
  console.log("\n--- Test 1.2: Query another employee's row from base 'employees' table (Manager's row) ---");
  const { data: otherRow, error: otherRowErr } = await empDb
    .from("employees")
    .select("id, full_name, email")
    .eq("id", managerId);

  if (otherRowErr) {
    console.log("✅ RLS successfully blocked query of other employee's row (error received):", otherRowErr.message);
  } else if (otherRow && otherRow.length > 0) {
    console.error("❌ SECURITY FAILURE: Query of another employee's base row was allowed!", otherRow);
  } else {
    console.log("✅ RLS successfully blocked query of other employee's row (returned 0 rows).");
  }

  // Test 3: Query employee_directory_public view for active colleagues
  console.log("\n--- Test 1.3: Query public directory view for active colleagues ---");
  const { data: directoryRows, error: dirErr } = await empDb
    .from("employee_directory_public")
    .select("*");

  if (dirErr) {
    console.error("❌ Failed to query directory view:", dirErr.message);
  } else if (directoryRows && directoryRows.length > 0) {
    console.log(`✅ Successfully queried directory. Returned ${directoryRows.length} rows.`);
    const firstRow = directoryRows[0];
    const containsPrivateFields = firstRow.aadhaar_number || firstRow.pan_number || firstRow.bank_name || firstRow.account_number || firstRow.ifsc_code || firstRow.address;
    if (containsPrivateFields) {
      console.error("❌ SECURITY FAILURE: Public directory view contains private fields!", firstRow);
    } else {
      console.log("   Verify no private fields returned (Aadhaar, PAN, Bank, Address): ✅ All clean.");
    }
  } else {
    console.error("❌ Directory view returned 0 rows!");
  }

  // Test 4: Attempt direct update on another employee's base employees row
  console.log("\n--- Test 1.4: Attempt update on another employee's base row ---");
  const { data: updateOtherResult, error: updateOtherErr } = await empDb
    .from("employees")
    .update({ full_name: "Hacked Manager Name" })
    .eq("id", managerId)
    .select();

  if (updateOtherErr) {
    console.log("✅ RLS successfully blocked update on another employee's row (error received):", updateOtherErr.message);
  } else if (updateOtherResult && updateOtherResult.length > 0) {
    console.error("❌ SECURITY FAILURE: Allowed updating another employee's row!", updateOtherResult);
  } else {
    console.log("✅ RLS successfully blocked update on another employee's row (0 rows updated).");
  }

  // Test 5: Attempt update to own self-service fields
  console.log("\n--- Test 1.5: Attempt update to own self-service fields (phone, pincode) ---");
  const uniquePhone = "+1555" + Math.floor(1000000 + Math.random() * 9000000);
  const { data: updateSelfResult, error: updateSelfErr } = await empDb
    .from("employees")
    .update({ phone: uniquePhone, pincode: "123456" })
    .eq("id", employeeId)
    .select();

  if (updateSelfErr) {
    console.error("❌ Failed to update own self-service fields:", updateSelfErr.message);
  } else if (updateSelfResult && updateSelfResult.length > 0) {
    console.log("✅ Successfully updated own self-service fields. New phone:", updateSelfResult[0].phone);
  } else {
    console.error("❌ Update own self-service fields returned 0 rows updated!");
  }

  // Test 6: Attempt update to own non-self-service fields (role, manager_id, grade)
  console.log("\n--- Test 1.6: Attempt update to own non-self-service fields (role, tenant_id) ---");
  // The database triggers may restrict or RLS policies check update permissions
  const { data: updateEscResult, error: updateEscErr } = await empDb
    .from("employees")
    .update({ role: "hr" })
    .eq("id", employeeId)
    .select();

  if (updateEscErr) {
    console.log("✅ Escalate role update failed as expected (error received):", updateEscErr.message);
  } else if (updateEscResult && updateEscResult.length > 0) {
    if (updateEscResult[0].role === "hr") {
      console.error("❌ SECURITY FAILURE: Standard employee successfully escalated role to HR!");
    } else {
      console.log("✅ Escalate role did not apply (value unchanged).");
    }
  } else {
    console.log("✅ Escalate role update returned 0 rows updated.");
  }


  // --- HR FLOWS & VALIDATION ---
  console.log("\n====================================================");
  console.log("      RUNNING HR RPC & VALIDATION TESTS             ");
  console.log("====================================================\n");

  console.log(`[2] Authenticating as HR specialist: ${hrEmail}...`);
  const hrClient = createClient({ baseUrl, anonKey });
  const { data: hrSession, error: hrAuthError } = await hrClient.auth.signInWithPassword({
    email: hrEmail,
    password,
  });

  if (hrAuthError) {
    console.error("❌ HR authentication failed:", hrAuthError.message);
    process.exit(1);
  }
  console.log("✅ Authenticated successfully.\n");

  const hrDb = hrClient.database;

  // Test 7: Circular manager assignment validation
  console.log("--- Test 2.1: Test circular manager assignment rejection ---");
  console.log(`Invoking update_employee_reporting_relationship: employee=${managerId}, primary_manager=${employeeId}...`);
  const { error: circErr } = await hrDb.rpc("update_employee_reporting_relationship", {
    p_employee_id: managerId,
    p_primary_manager_id: employeeId,
    p_secondary_manager_id: null,
  });

  if (circErr) {
    console.log("✅ Successfully rejected circular reporting line:", circErr.message);
  } else {
    console.error("❌ failure: Circular reporting relationship was allowed!");
  }

  // Test 8: Self manager assignment validation
  console.log("\n--- Test 2.2: Test self manager assignment rejection ---");
  console.log(`Invoking update_employee_reporting_relationship: employee=${employeeId}, primary_manager=${employeeId}...`);
  const { error: selfErr } = await hrDb.rpc("update_employee_reporting_relationship", {
    p_employee_id: employeeId,
    p_primary_manager_id: employeeId,
    p_secondary_manager_id: null,
  });

  if (selfErr) {
    console.log("✅ Successfully rejected self manager reporting line:", selfErr.message);
  } else {
    console.error("❌ failure: Self manager reporting relationship was allowed!");
  }

  console.log("\n====================================================");
  console.log("                RLS AUDIT COMPLETED                 ");
  console.log("====================================================");
}

verifyRLS().catch(err => {
  console.error("Verification crashed:", err);
  process.exit(1);
});
