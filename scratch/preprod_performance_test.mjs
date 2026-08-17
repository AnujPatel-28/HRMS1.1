import { createClient } from "@insforge/sdk";
import fs from "fs";
import pkg from "pg";
const { Client } = pkg;

// Load environment variables
const envFile = fs.readFileSync(".env", "utf-8");
const urlMatch = envFile.match(/VITE_INSFORGE_URL=(.*)/);
const keyMatch = envFile.match(/VITE_INSFORGE_ANON_KEY=(.*)/);

const baseUrl = urlMatch[1].replace(/"/g, '').trim();
const anonKey = keyMatch[1].replace(/"/g, '').trim();

const connectionString = "postgresql://postgres:f24232f87c1cf2717e4d5c002417a092@rq3qmu8y-jx7.ap-southeast.database.insforge.app:5432/insforge?sslmode=require";
const tenantId = "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e";

const employeeEmail = "employee-qa@talentmeshsolutions.com";
const password = "Password@123";

async function runPerformanceTest() {
  console.log("====================================================");
  console.log("             RUNNING PERFORMANCE TESTS              ");
  console.log("====================================================\n");

  const dbClient = new Client({ connectionString });
  await dbClient.connect();

  const seedCount = 1000;
  console.log(`[1] Seeding ${seedCount} temporary employees via batch SQL...`);

  // Generate batch insert SQL
  const values = [];
  const baseUuid = "f0000000-0000-0000-0000-";
  
  for (let i = 1; i <= seedCount; i++) {
    const hexId = i.toString(16).padStart(12, '0');
    const empId = baseUuid + hexId;
    const fullName = `Perf Test Employee ${i}`;
    const email = `perf-test-${i}@company.com`;
    const designation = i % 5 === 0 ? "Senior Engineer" : "Software Engineer";
    const department = i % 3 === 0 ? "Engineering" : (i % 3 === 1 ? "Product" : "Design");

    values.push(`('${empId}', '${tenantId}', '${fullName}', '${email}', 'employee', 'active', '${designation}', '${department}')`);
  }

  const query = `
    INSERT INTO public.employees (id, tenant_id, full_name, email, role, status, designation, department)
    VALUES ${values.join(",\n")}
    ON CONFLICT (id) DO NOTHING;
  `;

  const startTime = Date.now();
  await dbClient.query(query);
  console.log(`✅ Seeded ${seedCount} records in ${Date.now() - startTime}ms.`);

  // 2. Authenticate as standard employee
  console.log("\n[2] Authenticating standard employee via SDK...");
  const empClient = createClient({ baseUrl, anonKey });
  const { data: authData, error: authErr } = await empClient.auth.signInWithPassword({
    email: employeeEmail,
    password,
  });

  if (authErr) {
    console.error("❌ Auth failed:", authErr.message);
    await cleanup(dbClient, baseUuid);
    process.exit(1);
  }
  console.log("✅ Authenticated.");

  const empDb = empClient.database;

  // Test Directory Load
  console.log("\n[3] Measuring directory load performance...");
  const loadStart = Date.now();
  const { data: dirRows, error: dirErr } = await empDb
    .from("employee_directory_public")
    .select("*");
  const loadDuration = Date.now() - loadStart;

  if (dirErr) {
    console.error("❌ Directory load failed:", dirErr.message);
  } else {
    console.log(`✅ Directory loaded. Total rows: ${dirRows?.length}. Time taken: ${loadDuration}ms.`);
    if (loadDuration < 500) {
      console.log("   Performance Status: ⚡ EXCELLENT (< 500ms)");
    } else if (loadDuration < 1500) {
      console.log("   Performance Status: ⚠️ ACCEPTABLE (< 1500ms)");
    } else {
      console.log("   Performance Status: 🐢 SLOW (> 1500ms)");
    }
  }

  // Test Directory Search / Filter
  console.log("\n[4] Measuring directory search/filter performance...");
  const searchStart = Date.now();
  const { data: searchRows, error: searchErr } = await empDb
    .from("employee_directory_public")
    .select("*")
    .ilike("full_name", "%perf%500%");
  const searchDuration = Date.now() - searchStart;

  if (searchErr) {
    console.error("❌ Directory search failed:", searchErr.message);
  } else {
    console.log(`✅ Search result returned ${searchRows?.length} rows in ${searchDuration}ms.`);
  }

  // 3. Clean up
  await cleanup(dbClient, baseUuid);
  await dbClient.end();

  console.log("\n====================================================");
  console.log("            PERFORMANCE TEST COMPLETED              ");
  console.log("====================================================");
}

async function cleanup(dbClient, baseUuid) {
  console.log("\n[5] Cleaning up seeded performance test records...");
  const cleanStart = Date.now();
  await dbClient.query(`DELETE FROM public.employees WHERE id::text LIKE '${baseUuid}%'`);
  console.log(`✅ Cleaned up records in ${Date.now() - cleanStart}ms.`);
}

runPerformanceTest().catch(err => {
  console.error("Performance test crashed:", err);
  process.exit(1);
});
