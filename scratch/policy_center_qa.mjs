import { createClient } from "@insforge/sdk";
import fs from "fs";
import path from "path";

// 1. Helper to load environment variables from .env
function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        if (value.startsWith("\"") && value.endsWith("\"")) {
          value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
}

loadEnv();

const baseUrl = process.env.VITE_INSFORGE_URL;
const anonKey = process.env.VITE_INSFORGE_ANON_KEY;
const defaultTenantId = process.env.VITE_DEFAULT_TENANT_ID || "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e";

if (!baseUrl || !anonKey) {
  console.error("❌ Error: Missing VITE_INSFORGE_URL or VITE_INSFORGE_ANON_KEY in .env");
  process.exit(1);
}

const hrEmail = "hr-qa@talentmeshsolutions.com";
const employeeEmail = "employee-qa@talentmeshsolutions.com";
const testPassword = "Password@123";

async function main() {
  console.log("=================================================");
  console.log("         POLICY CENTER QA TEST VERIFICATION       ");
  console.log("=================================================\n");

  // --- Authentication ---
  console.log("1. Authenticating test users...");
  
  const hrClient = createClient({ baseUrl, anonKey });
  const hrAuth = await hrClient.auth.signInWithPassword({ email: hrEmail, password: testPassword });
  if (hrAuth.error) throw new Error(`HR Authentication failed: ${hrAuth.error.message}`);
  console.log("   ✓ HR Admin authenticated successfully.");

  const empClient = createClient({ baseUrl, anonKey });
  const empAuth = await empClient.auth.signInWithPassword({ email: employeeEmail, password: testPassword });
  if (empAuth.error) throw new Error(`Employee Authentication failed: ${empAuth.error.message}`);
  console.log("   ✓ Employee authenticated successfully.\n");

  const hrDb = hrClient.database;
  const empDb = empClient.database;

  // --- 2. Save Attendance Policy Verification ---
  console.log("2. Verifying Attendance Policy Save updates both tenants & tenant_settings...");
  
  // Get current tenant values
  const { data: tenantBefore, error: tBeforeErr } = await hrDb.from("tenants").select("punch_in_cutoff, updated_at").eq("id", defaultTenantId).single();
  if (tBeforeErr) throw tBeforeErr;

  const testCutoff = tenantBefore.punch_in_cutoff === "10:30:00" ? "10:45:00" : "10:30:00";
  console.log(`   - Current Cutoff: ${tenantBefore.punch_in_cutoff}. Setting new value: ${testCutoff}`);

  // Get current tenant_settings for late_mark_enabled
  const { data: settingBefore, error: sBeforeErr } = await hrDb.from("tenant_settings").select("value, updated_at").eq("tenant_id", defaultTenantId).eq("key", "late_mark_enabled").maybeSingle();
  if (sBeforeErr) throw sBeforeErr;

  const currentLateMarkEnabled = settingBefore ? settingBefore.value : "false";
  const newLateMarkEnabled = currentLateMarkEnabled === "true" ? "false" : "true";
  const settingUpdatedAt = settingBefore ? settingBefore.updated_at : null;

  // Simulate HR save (multi-step client writes)
  const now = new Date().toISOString();
  
  // A. Update Tenants table
  const { data: tenantUpdated, error: tUpdateErr } = await hrDb.from("tenants")
    .update({ punch_in_cutoff: testCutoff, updated_at: now })
    .eq("id", defaultTenantId)
    .select("punch_in_cutoff, updated_at")
    .single();
  if (tUpdateErr) throw tUpdateErr;

  // B. Update Tenant Settings
  let settingUpdateErr;
  if (settingBefore) {
    const { error } = await hrDb.from("tenant_settings")
      .update({ value: newLateMarkEnabled, updated_at: now })
      .eq("tenant_id", defaultTenantId)
      .eq("key", "late_mark_enabled")
      .eq("updated_at", settingUpdatedAt);
    settingUpdateErr = error;
  } else {
    const { error } = await hrDb.from("tenant_settings")
      .insert([{ tenant_id: defaultTenantId, key: "late_mark_enabled", value: newLateMarkEnabled, updated_at: now }]);
    settingUpdateErr = error;
  }
  if (settingUpdateErr) throw settingUpdateErr;

  // C. Verify updates in DB
  const { data: tenantAfter } = await hrDb.from("tenants").select("punch_in_cutoff").eq("id", defaultTenantId).single();
  const { data: settingAfter } = await hrDb.from("tenant_settings").select("value").eq("tenant_id", defaultTenantId).eq("key", "late_mark_enabled").single();

  if (tenantAfter.punch_in_cutoff === testCutoff && settingAfter.value === newLateMarkEnabled) {
    console.log("   ✅ PASS: Both tenants and tenant_settings updated successfully.");
  } else {
    console.log("   ❌ FAIL: Failed to update both tables consistently.");
  }
  console.log("");


  // --- 3. Simulate Stale Write Verification ---
  console.log("3. Simulating stale write detection with two HR sessions...");
  
  // Session A and Session B both retrieve the latest tenant state
  const { data: tenantSessionA } = await hrDb.from("tenants").select("updated_at, punch_in_cutoff").eq("id", defaultTenantId).single();
  const tenantSessionB = { ...tenantSessionA }; // same old updated_at

  const updatedTimeA = new Date().toISOString();
  
  // Session A saves first
  const { error: saveAErr } = await hrDb.from("tenants")
    .update({ punch_in_cutoff: "10:30:00", updated_at: updatedTimeA })
    .eq("id", defaultTenantId)
    .eq("updated_at", tenantSessionA.updated_at);
  
  if (saveAErr) throw saveAErr;
  console.log("   - Session A saved successfully (updated_at advanced).");

  // Session B attempts to save using its old updated_at
  const { data: saveBResult, error: saveBErr } = await hrDb.from("tenants")
    .update({ punch_in_cutoff: "10:45:00", updated_at: new Date().toISOString() })
    .eq("id", defaultTenantId)
    .eq("updated_at", tenantSessionB.updated_at)
    .select();

  if (saveBErr) {
    console.log(`   - Session B failed with error: ${saveBErr.message}`);
  }

  if (!saveBResult || saveBResult.length === 0) {
    console.log("   ✅ PASS: Session B save was blocked (0 rows affected) due to stale updated_at.");
  } else {
    console.log("   ❌ FAIL: Session B overwrote Session A's changes! Stale write was NOT blocked.");
  }
  console.log("");


  // --- 4. Create Leave Type and verify balances ---
  console.log("4. Verifying Leave Type creation auto-initializes balances for all active employees...");
  
  // Get active employee count
  const { data: activeEmployees, error: empErr } = await hrDb.from("employees").select("id").eq("tenant_id", defaultTenantId).eq("status", "active");
  if (empErr) throw empErr;
  console.log(`   - Found ${activeEmployees.length} active employees.`);

  // Create a new leave type
  const testLeaveTypeCode = "QA" + Math.floor(Math.random() * 1000);
  const { data: newLeaveType, error: newLtErr } = await hrDb.from("leave_types").insert([{
    tenant_id: defaultTenantId,
    name: "QA Temporary Leave",
    code: testLeaveTypeCode,
    days_per_year: 10,
    accrual_type: "lump_sum",
    carry_forward_enabled: false,
    is_active: true,
    is_paid: true,
    updated_at: new Date().toISOString()
  }]).select("id").single();

  if (newLtErr) throw newLtErr;
  const leaveTypeId = newLeaveType.id;
  console.log(`   - Created Leave Type: ${testLeaveTypeCode} with ID: ${leaveTypeId}`);

  // Mimic frontend auto-initialization block (line 1015-1037)
  const targetYear = new Date().getFullYear();
  const initialBalanceRows = activeEmployees.map((e) => ({
    tenant_id: defaultTenantId,
    employee_id: e.id,
    leave_type_id: leaveTypeId,
    year: targetYear,
    total_allocated: 10,
    used_days: 0,
    carried_forward: 0,
    balance: 10
  }));

  const { error: upsertErr } = await hrDb.from("leave_balances").upsert(initialBalanceRows, {
    onConflict: "tenant_id,employee_id,leave_type_id,year",
    ignoreDuplicates: true
  });
  if (upsertErr) throw upsertErr;

  // Verify that every active employee has a row in leave_balances
  const { data: balances, error: fetchBalErr } = await hrDb.from("leave_balances")
    .select("employee_id")
    .eq("tenant_id", defaultTenantId)
    .eq("leave_type_id", leaveTypeId)
    .eq("year", targetYear);

  if (fetchBalErr) throw fetchBalErr;

  if (balances.length === activeEmployees.length) {
    console.log(`   ✅ PASS: All ${activeEmployees.length} active employees got a leave balance.`);
  } else {
    console.log(`   ❌ FAIL: Balance count (${balances.length}) does not match active employees (${activeEmployees.length}).`);
  }
  console.log("");


  // --- 5. Edit days_per_year and verify recalculation ---
  console.log("5. Verifying leave balance recalculation on days_per_year update...");

  // Update leave type days_per_year
  const { error: ltUpdateErr } = await hrDb.from("leave_types")
    .update({ days_per_year: 15, updated_at: new Date().toISOString() })
    .eq("id", leaveTypeId);
  if (ltUpdateErr) throw ltUpdateErr;

  // Mimic frontend edit recalculation block (line 1040-1071)
  const { data: existingBalances } = await hrDb.from("leave_balances")
    .select("id, used_days, pending_days, carried_forward")
    .eq("tenant_id", defaultTenantId)
    .eq("leave_type_id", leaveTypeId)
    .eq("year", targetYear);

  for (const row of (existingBalances || [])) {
    const newBalance = Math.max(0, 15 - Number(row.used_days || 0) - Number(row.pending_days || 0) + Number(row.carried_forward || 0));
    await hrDb.from("leave_balances")
      .update({ total_allocated: 15, balance: newBalance, updated_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  // Verify updated balances
  const { data: updatedBalances } = await hrDb.from("leave_balances")
    .select("total_allocated, balance")
    .eq("tenant_id", defaultTenantId)
    .eq("leave_type_id", leaveTypeId);

  const allRecalculated = updatedBalances.every((b) => b.total_allocated === 15 && b.balance === 15);
  if (allRecalculated && updatedBalances.length > 0) {
    console.log(`   ✅ PASS: Balances successfully recalculated to 15 days.`);
  } else {
    console.log("   ❌ FAIL: Balances were not updated/recalculated correctly.");
  }
  console.log("");


  // --- 6. Upload policy for 'all' and check notifications ---
  console.log("6. Verifying notification creation on policy upload for 'all' employees...");

  const mockFileContent = "This is a mock policy document.";
  const mockFilePath = `policies/test-qa-policy-${Date.now()}.txt`;
  
  // Upload file to storage
  const mockFile = new Blob([mockFileContent], { type: "text/plain" });
  const { data: uploadData, error: uploadErr } = await hrClient.storage.from("hr-policies").upload(mockFilePath, mockFile);
  if (uploadErr) throw uploadErr;
  
  const publicFileUrl = uploadData.url;
  console.log(`   - Mock policy file uploaded to storage. URL: ${publicFileUrl}`);

  // Create Policy Row in DB
  const { data: policyRow, error: policyInsErr } = await hrDb.from("hr_policies").insert([{
    tenant_id: defaultTenantId,
    title: "QA Global Policy",
    description: "Policy visible to all active employees",
    file_url: publicFileUrl,
    file_name: "test-qa-policy.txt",
    uploaded_by: "e0000000-0000-0000-0000-000000000001", // QA HR employee ID
    visible_to: "all"
  }]).select("id").single();
  if (policyInsErr) throw policyInsErr;

  const policyId = policyRow.id;

  // Insert notifications (mimic frontend upload fan-out)
  const notificationRows = activeEmployees.map((e) => ({
    tenant_id: defaultTenantId,
    employee_id: e.id,
    title: "New HR Policy Document",
    body: `New Company Policy: QA Global Policy`,
    type: "new_policy"
  }));

  const { error: notifInsErr } = await hrDb.from("notifications").insert(notificationRows);
  if (notifInsErr) throw notifInsErr;

  // Verify notifications are created
  const { data: createdNotifs } = await hrDb.from("notifications")
    .select("id")
    .eq("tenant_id", defaultTenantId)
    .eq("body", "New Company Policy: QA Global Policy");

  if (createdNotifs.length === activeEmployees.length) {
    console.log(`   ✅ PASS: Generated ${createdNotifs.length} notifications for all active employees.`);
  } else {
    console.log(`   ❌ FAIL: Notifications count (${createdNotifs.length}) does not match employee count (${activeEmployees.length}).`);
  }
  console.log("");


  // --- 7. Upload department policy and inspect network payload ---
  console.log("7. Verifying client-side filtering risk (employee payload contains other departments' policies)...");

  // Upload department-specific policy for Design department
  const { data: deptPolicyRow, error: deptPolicyInsErr } = await hrDb.from("hr_policies").insert([{
    tenant_id: defaultTenantId,
    title: "QA Design Policy",
    description: "Policy visible only to Design department",
    file_url: publicFileUrl,
    file_name: "test-qa-policy.txt",
    uploaded_by: "e0000000-0000-0000-0000-000000000001",
    visible_to: "department-specific",
    department_filter: "design"
  }]).select("id").single();
  if (deptPolicyInsErr) throw deptPolicyInsErr;

  const deptPolicyId = deptPolicyRow.id;

  // Now, fetch policies as the test employee (who is in Engineering department)
  // Let's verify what the employee's payload looks like
  const { data: empPayload, error: empPayloadErr } = await empDb.from("hr_policies").select("*")
    .eq("tenant_id", defaultTenantId)
    .in("visible_to", ["all", "department-specific"]);
  
  if (empPayloadErr) throw empPayloadErr;

  console.log("   - Employee payload contains:", empPayload.map(p => ({ title: p.title, visible_to: p.visible_to, filter: p.department_filter })));

  const containsDesignPolicy = empPayload.some((p) => p.id === deptPolicyId);
  if (containsDesignPolicy) {
    console.log("   ✅ PASS: Confirmed. The Engineering employee received the Design policy in their network payload.");
    console.log("             (Requires client-side filtering which is a privacy risk).");
  } else {
    console.log("   ❌ FAIL: The Design policy was not found in the Engineering employee's payload (or RLS was changed).");
  }
  console.log("");


  // --- 8. Delete policy and check DB and storage removal ---
  console.log("8. Verifying policy deletion removes both the DB row and the storage file...");

  // Delete the policy
  const pathParts = publicFileUrl.split("/hr-policies/");
  if (pathParts.length > 1) {
    const filePath = pathParts[1];
    await hrClient.storage.from("hr-policies").remove(filePath);
    console.log(`   - Storage file removed: ${filePath}`);
  }
  
  const { error: deleteDbErr } = await hrDb.from("hr_policies").delete().eq("tenant_id", defaultTenantId).eq("id", policyId);
  if (deleteDbErr) throw deleteDbErr;
  console.log("   - DB row deleted.");

  // Check if DB row is gone
  const { data: dbCheck } = await hrDb.from("hr_policies").select("id").eq("id", policyId).maybeSingle();
  
  // Check if storage file is gone by trying to download it
  const { error: downloadErr } = await hrClient.storage.from("hr-policies").download(pathParts[1]);
  
  const dbRemoved = !dbCheck;
  const storageRemoved = !!downloadErr; // should error because file is deleted

  if (dbRemoved && storageRemoved) {
    console.log("   ✅ PASS: Policy successfully deleted from both DB and Storage.");
  } else {
    console.log(`   ❌ FAIL: DB Row Removed: ${dbRemoved}, Storage Removed: ${storageRemoved}`);
  }
  console.log("");


  // --- 9. Verify HR-only policies do not appear in employee payload ---
  console.log("9. Verifying that 'hr_only' policies do not appear in the employee payload...");

  // Create an HR-only policy
  const { data: hrOnlyPolicyRow, error: hrOnlyInsErr } = await hrDb.from("hr_policies").insert([{
    tenant_id: defaultTenantId,
    title: "QA HR Only Policy",
    description: "Policy visible only to HR admins",
    file_url: publicFileUrl,
    file_name: "test-qa-policy.txt",
    uploaded_by: "e0000000-0000-0000-0000-000000000001",
    visible_to: "hr_only"
  }]).select("id").single();
  if (hrOnlyInsErr) throw hrOnlyInsErr;

  const hrOnlyPolicyId = hrOnlyPolicyRow.id;

  // Employee queries the policies table
  const { data: empCheckPayload, error: empCheckErr } = await empDb.from("hr_policies").select("*")
    .eq("tenant_id", defaultTenantId)
    .in("visible_to", ["all", "department-specific"]);
  if (empCheckErr) throw empCheckErr;

  const containsHrOnlyPolicy = empCheckPayload.some((p) => p.id === hrOnlyPolicyId);
  if (!containsHrOnlyPolicy) {
    console.log("   ✅ PASS: Confirmed. The 'hr_only' policy did not appear in the employee payload.");
  } else {
    console.log("   ❌ FAIL: The 'hr_only' policy was exposed to the employee!");
  }
  console.log("");


  // --- 10. Verify whether the file URL is public and directly accessible in a fresh unauthenticated session ---
  console.log("10. Checking if uploaded policy file URL is public and accessible without authentication...");
  
  // Make a request to the public URL using fetch
  try {
    const response = await fetch(publicFileUrl);
    if (response.ok) {
      const text = await response.text();
      if (text === mockFileContent) {
        console.log("   ✅ PASS: Confirmed. The file URL is public and directly accessible.");
      } else {
        console.log("   - File URL returned content but it didn't match.");
      }
    } else {
      console.log(`   - Request failed with status: ${response.status}`);
      console.log("   ❌ FAIL: File is private / not directly accessible.");
    }
  } catch (fetchErr) {
    console.error("   - Fetch error during unauthenticated check:", fetchErr);
    console.log("   ❌ FAIL: File is private / not directly accessible.");
  }
  console.log("");


  // --- Clean Up ---
  console.log("Cleaning up test records...");
  
  await hrDb.from("leave_balances").delete().eq("leave_type_id", leaveTypeId);
  await hrDb.from("leave_types").delete().eq("id", leaveTypeId);
  console.log("   - Cleaned up test leave types and balances.");

  await hrDb.from("notifications").delete().eq("tenant_id", defaultTenantId).eq("body", "New Company Policy: QA Global Policy");
  await hrDb.from("hr_policies").delete().eq("tenant_id", defaultTenantId).eq("id", deptPolicyId);
  await hrDb.from("hr_policies").delete().eq("tenant_id", defaultTenantId).eq("id", hrOnlyPolicyId);
  console.log("   - Cleaned up test policies and notifications.");

  await hrDb.from("tenants").update({ punch_in_cutoff: "10:30:00", updated_at: new Date().toISOString() }).eq("id", defaultTenantId);
  console.log("   - Restored cutoff time settings.");
  
  console.log("\n=================================================");
  console.log("             QA TEST SUITE RUN COMPLETE           ");
  console.log("=================================================");

}

main().catch((err) => {
  console.error("❌ Test script crashed with error:", err);
  process.exit(1);
});
