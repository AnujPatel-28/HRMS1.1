import { createClient } from "@insforge/sdk";
import fs from "fs";
import path from "path";

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
const employeeEmail = "employee-qa@talentmeshsolutions.com"; // Engineering department
const testPassword = "Password@123";

async function main() {
  console.log("=================================================");
  console.log("       P1 POLICY DOCUMENT PRIVACY VERIFICATION   ");
  console.log("=================================================\n");

  const hrClient = createClient({ baseUrl, anonKey });
  const hrAuth = await hrClient.auth.signInWithPassword({ email: hrEmail, password: testPassword });
  if (hrAuth.error) throw new Error(`HR Authentication failed: ${hrAuth.error.message}`);
  console.log("✓ HR Admin authenticated successfully.");

  const empClient = createClient({ baseUrl, anonKey });
  const empAuth = await empClient.auth.signInWithPassword({ email: employeeEmail, password: testPassword });
  if (empAuth.error) throw new Error(`Employee Authentication failed: ${empAuth.error.message}`);
  console.log("✓ Employee authenticated successfully.\n");

  const hrDb = hrClient.database;
  const empDb = empClient.database;

  // Verify employee's department
  const { data: currentEmpRow } = await empDb.from("employees").select("id, department").eq("user_id", empAuth.data.user.id).single();
  console.log(`Employee department is: ${currentEmpRow?.department || "NULL"}\n`);

  console.log("--- Test 1: Uploading a policy for ALL employees (HR) ---");
  const qaFileContent = "This is a mock global policy for P1 QA.";
  const qaFileName = `p1-qa-global-${Date.now()}.txt`;
  const qaFilePath = `policies/${qaFileName}`;
  
  const mockFile = new Blob([qaFileContent], { type: "text/plain" });
  const { data: uploadData, error: uploadErr } = await hrClient.storage.from("hr-policies").upload(qaFilePath, mockFile);
  if (uploadErr) throw uploadErr;
  
  console.log(`✓ Uploaded global policy file. Path: ${qaFilePath}`);

  const { data: globalPolicyRow, error: globalPolicyErr } = await hrDb.from("hr_policies").insert([{
    tenant_id: defaultTenantId,
    title: "QA P1 Global Policy",
    description: "Policy visible to all active employees",
    file_url: uploadData.url,
    file_name: qaFileName,
    uploaded_by: currentEmpRow?.id, // Use employee ID
    visible_to: "all",
    storage_path: qaFilePath
  }]).select("*").single();

  if (globalPolicyErr) throw globalPolicyErr;
  console.log(`✓ Inserted global policy row with storage_path: ${globalPolicyRow.storage_path}\n`);


  console.log("--- Test 2: Uploading a department-specific policy (design department) (HR) ---");
  const deptFileName = `p1-qa-design-${Date.now()}.txt`;
  const deptFilePath = `policies/${deptFileName}`;
  
  const { data: uploadDataDept, error: uploadErrDept } = await hrClient.storage.from("hr-policies").upload(deptFilePath, mockFile);
  if (uploadErrDept) throw uploadErrDept;

  const { data: designPolicyRow, error: designPolicyErr } = await hrDb.from("hr_policies").insert([{
    tenant_id: defaultTenantId,
    title: "QA P1 Design Policy",
    description: "Policy visible only to Design department",
    file_url: uploadDataDept.url,
    file_name: deptFileName,
    uploaded_by: currentEmpRow?.id,
    visible_to: "department-specific",
    department_filter: "design",
    storage_path: deptFilePath
  }]).select("*").single();

  if (designPolicyErr) throw designPolicyErr;
  console.log(`✓ Inserted design policy row with storage_path: ${designPolicyRow.storage_path}\n`);


  console.log("--- Test 3: Uploading an HR Only policy (HR) ---");
  const hrOnlyFileName = `p1-qa-hrony-${Date.now()}.txt`;
  const hrOnlyFilePath = `policies/${hrOnlyFileName}`;
  
  const { data: uploadDataHR, error: uploadErrHR } = await hrClient.storage.from("hr-policies").upload(hrOnlyFilePath, mockFile);
  if (uploadErrHR) throw uploadErrHR;

  const { data: hrOnlyPolicyRow, error: hrOnlyPolicyErr } = await hrDb.from("hr_policies").insert([{
    tenant_id: defaultTenantId,
    title: "QA P1 HR Only Policy",
    description: "Policy visible only to HR admins",
    file_url: uploadDataHR.url,
    file_name: hrOnlyFileName,
    uploaded_by: currentEmpRow?.id,
    visible_to: "hr_only",
    storage_path: hrOnlyFilePath
  }]).select("*").single();

  if (hrOnlyPolicyErr) throw hrOnlyPolicyErr;
  console.log(`✓ Inserted HR-only policy row with storage_path: ${hrOnlyPolicyRow.storage_path}\n`);


  console.log("--- Test 4: Querying visible policies as Employee via get_employee_visible_hr_policies RPC ---");
  const { data: empVisiblePolicies, error: rpcErr } = await empDb.rpc("get_employee_visible_hr_policies");
  if (rpcErr) throw rpcErr;

  console.log(`✓ Employee visible policies count: ${empVisiblePolicies?.length || 0}`);
  
  const hasGlobal = empVisiblePolicies.some(p => p.id === globalPolicyRow.id);
  const hasDesign = empVisiblePolicies.some(p => p.id === designPolicyRow.id);
  const hasHrOnly = empVisiblePolicies.some(p => p.id === hrOnlyPolicyRow.id);

  console.log(`  - Contains Global Policy: ${hasGlobal ? "✅ YES (Expected)" : "❌ NO"}`);
  console.log(`  - Contains Design Policy: ${hasDesign ? "❌ YES" : "✅ NO (Expected - Employee is Engineering, not Design)"}`);
  console.log(`  - Contains HR Only Policy: ${hasHrOnly ? "❌ YES" : "✅ NO (Expected)"}`);

  if (hasGlobal && !hasDesign && !hasHrOnly) {
    console.log("\n✅ PASS: Employee RPC returned exactly the expected visible policies and secure metadata.");
  } else {
    console.log("\n❌ FAIL: Employee RPC did not filter policies securely.");
  }

  // Inspect payload fields
  const firstRow = empVisiblePolicies.find(p => p.id === globalPolicyRow.id);
  if (firstRow) {
    console.log("\n  Returned Columns:");
    Object.keys(firstRow).forEach(key => {
      console.log(`    - ${key}: ${firstRow[key]}`);
    });
  }


  console.log("\n--- Test 5: Deleting policies using storage_path (HR) ---");
  
  // Clean up global policy
  await hrClient.storage.from("hr-policies").remove(globalPolicyRow.storage_path);
  await hrDb.from("hr_policies").delete().eq("tenant_id", defaultTenantId).eq("id", globalPolicyRow.id);
  console.log("✓ Global policy deleted from storage and DB.");

  // Clean up design policy
  await hrClient.storage.from("hr-policies").remove(designPolicyRow.storage_path);
  await hrDb.from("hr_policies").delete().eq("tenant_id", defaultTenantId).eq("id", designPolicyRow.id);
  console.log("✓ Design policy deleted from storage and DB.");

  // Clean up HR-only policy
  await hrClient.storage.from("hr-policies").remove(hrOnlyPolicyRow.storage_path);
  await hrDb.from("hr_policies").delete().eq("tenant_id", defaultTenantId).eq("id", hrOnlyPolicyRow.id);
  console.log("✓ HR-only policy deleted from storage and DB.");

  console.log("\n=================================================");
  console.log("             VERIFICATION RUN COMPLETE            ");
  console.log("=================================================");
}

main().catch(err => {
  console.error("❌ Test script crashed:", err);
  process.exit(1);
});
