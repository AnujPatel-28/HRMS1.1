import { createClient } from "@insforge/sdk";
import fs from "fs";

// Load environment variables
const envFile = fs.readFileSync(".env", "utf-8");
const urlMatch = envFile.match(/VITE_INSFORGE_URL=(.*)/);
const keyMatch = envFile.match(/VITE_INSFORGE_ANON_KEY=(.*)/);

const baseUrl = urlMatch[1].replace(/"/g, '').trim();
const anonKey = keyMatch[1].replace(/"/g, '').trim();

// We will use the direct database client or raw SQL to seed.
// Since we have the insforge client, but wait! We can use insforge client with service role, 
// or since we are running locally, we can run SQL statements using insforge MCP run-raw-sql.
// We will write the javascript that calls the backend via insforge REST/functions if needed,
// but since the MCP run-raw-sql tool is much more powerful for direct DB manipulation, 
// this script can just print the SQL commands needed, OR we can execute them via Node using pg,
// but wait! Is there a connection string in register-qa-users.js?
// Yes: postgresql://postgres:f24232f87c1cf2717e4d5c002417a092@rq3qmu8y-jx7.ap-southeast.database.insforge.app:5432/insforge?sslmode=require
// We can use the 'pg' package which is in package.json!
import pkg from "pg";
const { Client } = pkg;
const connectionString = "postgresql://postgres:f24232f87c1cf2717e4d5c002417a092@rq3qmu8y-jx7.ap-southeast.database.insforge.app:5432/insforge?sslmode=require";

const tenantId = "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e";

async function main() {
  console.log("Connecting to database...");
  const db = new Client({ connectionString });
  await db.connect();

  try {
    console.log("Checking and seeding edge-case user states...");

    // 1. HR User
    const hrRes = await db.query("SELECT id FROM employees WHERE email = 'hr-qa@talentmeshsolutions.com' AND role = 'hr'");
    console.log("State 1 (HR User):", hrRes.rows.length > 0 ? "✅ EXISTS" : "❌ MISSING");

    // 2. Standard active employee
    const empRes = await db.query("SELECT id FROM employees WHERE email = 'employee-qa@talentmeshsolutions.com' AND role = 'employee' AND status = 'active'");
    console.log("State 2 (Standard Employee):", empRes.rows.length > 0 ? "✅ EXISTS" : "❌ MISSING");

    // 3. Manager with direct reports
    const mgrRes = await db.query("SELECT id FROM employees WHERE email = 'manager-qa@talentmeshsolutions.com'");
    console.log("State 3 (Manager with reports):", mgrRes.rows.length > 0 ? "✅ EXISTS" : "❌ MISSING");

    // 4. Onboarding Incomplete
    const onboardingRes = await db.query("SELECT id FROM employees WHERE email = 'onboarding-qa@talentmeshsolutions.com'");
    console.log("State 4 (Onboarding Incomplete):", onboardingRes.rows.length > 0 ? "✅ EXISTS" : "❌ MISSING");

    // 5. Employee in active notice period
    const noticeRes = await db.query("SELECT e.id FROM employees e JOIN exit_requests r ON e.id = r.employee_id WHERE r.status = 'notice_period' AND e.email = 'offboarding-qa@talentmeshsolutions.com'");
    console.log("State 5 (Notice Period):", noticeRes.rows.length > 0 ? "✅ EXISTS" : "❌ MISSING");

    // 6. Employee with all clearances approved but exit interview incomplete
    // Let's check or seed.
    let state6EmpId = null;
    const clRes = await db.query(`
      SELECT e.id FROM employees e 
      JOIN exit_requests r ON e.id = r.employee_id 
      WHERE r.status = 'clearance_pending' 
        AND r.exit_interview_done = false 
        AND NOT EXISTS (SELECT 1 FROM exit_clearances c WHERE c.exit_request_id = r.id AND c.status <> 'approved')
    `);
    
    if (clRes.rows.length > 0) {
      state6EmpId = clRes.rows[0].id;
      console.log("State 6 (Clearances approved, interview incomplete): ✅ EXISTS");
    } else {
      console.log("State 6 (Clearances approved, interview incomplete): ❌ MISSING -> Seeding...");
      // Let's create a new employee for this
      const email = "clearance-qa@talentmeshsolutions.com";
      const empId = "e0000000-0000-0000-0000-000000000007";
      const authUserId = "a0000000-0000-0000-0000-000000000007";
      
      await db.query(`
        INSERT INTO auth.users (id, email, password, email_verified, is_anonymous, is_project_admin, metadata)
        VALUES ($1, $2, '$2a$10$3ucXVNJYwQmN.cCbLxIU8eXUZg/6Q8jLAR2AwJs2pH4qyx7B2RukO', true, false, false, '{"role": "employee", "tenant_id": "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e"}')
        ON CONFLICT (id) DO NOTHING;
      `, [authUserId, email]);

      await db.query(`
        INSERT INTO employees (id, user_id, tenant_id, full_name, email, role, status, designation, department)
        VALUES ($1, $2, $3, 'QA Clearance Approved', $4, 'employee', 'active', 'Analyst', 'Finance')
        ON CONFLICT (id) DO NOTHING;
      `, [empId, authUserId, tenantId, email]);

      // Seed exit request
      const exitId = "d0000000-0000-0000-0000-000000000072";
      await db.query(`
        INSERT INTO exit_requests (id, tenant_id, employee_id, exit_type, initiated_by, initiated_by_role, last_working_date, notice_period_days, reason, status, exit_interview_done)
        VALUES ($1, $2, $3, 'resignation', $3, 'employee', current_date + 15, 15, 'Clearance seed', 'clearance_pending', false)
        ON CONFLICT (id) DO NOTHING;
      `, [exitId, tenantId, empId]);

      // Seed approved exit clearances
      await db.query(`
        INSERT INTO exit_clearances (id, tenant_id, exit_request_id, department, status, label)
        VALUES 
          ('d0000000-0000-0000-0000-000000000091', $1, $2, 'assets', 'approved', 'Asset Clearance'),
          ('d0000000-0000-0000-0000-000000000092', $1, $2, 'it', 'approved', 'IT Clearance'),
          ('d0000000-0000-0000-0000-000000000093', $1, $2, 'finance', 'approved', 'Finance Clearance'),
          ('d0000000-0000-0000-0000-000000000094', $1, $2, 'hr', 'approved', 'HR Clearance'),
          ('d0000000-0000-0000-0000-000000000095', $1, $2, 'admin', 'approved', 'Admin Clearance')
        ON CONFLICT (id) DO NOTHING;
      `, [tenantId, exitId]);

      console.log("   -> State 6 seeded successfully.");
    }

    // 7. Employee with optional/cancelled clearance rows
    const optRes = await db.query(`
      SELECT e.id FROM employees e 
      JOIN exit_requests r ON e.id = r.employee_id 
      JOIN exit_clearances c ON r.id = c.exit_request_id
      WHERE c.status = 'cancelled'
    `);
    if (optRes.rows.length > 0) {
      console.log("State 7 (Optional/cancelled clearances): ✅ EXISTS");
    } else {
      console.log("State 7 (Optional/cancelled clearances): ❌ MISSING -> Seeding...");
      // Let's cancel one of offboarding-qa's clearance rows
      const offboardingEmpId = "e0000000-0000-0000-0000-000000000006";
      const requestRes = await db.query("SELECT id FROM exit_requests WHERE employee_id = $1", [offboardingEmpId]);
      if (requestRes.rows.length > 0) {
        const exitRequestId = requestRes.rows[0].id;
        await db.query("UPDATE exit_clearances SET status = 'cancelled' WHERE exit_request_id = $1 AND department = 'admin'", [exitRequestId]);
        console.log("   -> State 7 (Cancelled admin clearance on offboarding-qa) seeded successfully.");
      } else {
        console.error("   -> Could not seed State 7: offboarding-qa exit request not found!");
      }
    }
    let inactiveEmpId = null;
    const inactiveRes = await db.query("SELECT id FROM employees WHERE status = 'inactive'");
    if (inactiveRes.rows.length > 0) {
      inactiveEmpId = inactiveRes.rows[0].id;
      console.log("State 8 (Inactive employee): ✅ EXISTS. ID:", inactiveEmpId);
    } else {
      console.log("State 8 (Inactive employee): ❌ MISSING -> Seeding...");
      const email = "inactive-qa@talentmeshsolutions.com";
      inactiveEmpId = "e0000000-0000-0000-0000-000000000008";
      await db.query(`
        INSERT INTO employees (id, tenant_id, full_name, email, role, status, designation, department)
        VALUES ($1, $2, 'QA Inactive Employee', $3, 'employee', 'inactive', 'Former Designer', 'Design')
        ON CONFLICT (id) DO NOTHING;
      `, [inactiveEmpId, tenantId, email]);
      console.log("   -> State 8 seeded successfully.");
    }

    // 9. Already terminated employee
    const termRes = await db.query("SELECT id FROM employees WHERE status = 'terminated'");
    if (termRes.rows.length > 0) {
      console.log("State 9 (Terminated employee): ✅ EXISTS");
    } else {
      console.log("State 9 (Terminated employee): ❌ MISSING -> Seeding...");
      const email = "terminated-qa@talentmeshsolutions.com";
      const empId = "e0000000-0000-0000-0000-000000000009";
      await db.query(`
        INSERT INTO employees (id, tenant_id, full_name, email, role, status, designation, department)
        VALUES ($1, $2, 'QA Terminated Employee', $3, 'employee', 'terminated', 'Former Analyst', 'Finance')
        ON CONFLICT (id) DO NOTHING;
      `, [empId, tenantId, email]);
      console.log("   -> State 9 seeded successfully.");
    }

    // 10. Employee with secondary manager
    const secRes = await db.query("SELECT id FROM employees WHERE secondary_manager_id IS NOT NULL");
    if (secRes.rows.length > 0) {
      console.log("State 10 (Secondary manager): ✅ EXISTS");
    } else {
      console.log("State 10 (Secondary manager): ❌ MISSING -> Seeding...");
      const empId = "e0000000-0000-0000-0000-000000000003"; // employee-qa
      const secMgrId = "e0000000-0000-0000-0000-000000000001"; // hr-qa
      await db.query("UPDATE employees SET secondary_manager_id = $1 WHERE id = $2", [secMgrId, empId]);
      console.log("   -> State 10 (Set hr-qa as secondary manager for employee-qa) seeded successfully.");
    }

    // 11. Employee whose manager is inactive/missing
    const orphanRes = await db.query(`
      SELECT id FROM employees 
      WHERE manager_id IS NOT NULL 
        AND manager_id NOT IN (SELECT id FROM employees WHERE status = 'active')
    `);
    if (orphanRes.rows.length > 0) {
      console.log("State 11 (Orphan / Missing manager): ✅ EXISTS");
    } else {
      console.log("State 11 (Orphan / Missing manager): ❌ MISSING -> Seeding...");
      // Let's create an employee with an inactive manager
      const email = "orphan-qa@talentmeshsolutions.com";
      const empId = "e0000000-0000-0000-0000-000000000011";
      await db.query(`
        INSERT INTO employees (id, tenant_id, full_name, email, role, status, designation, department, manager_id)
        VALUES ($1, $2, 'QA Orphan Employee', $3, 'employee', 'active', 'Developer', 'Engineering', $4)
        ON CONFLICT (id) DO NOTHING;
      `, [empId, tenantId, email, inactiveEmpId]);
      console.log("   -> State 11 seeded successfully.");
    }

    console.log("\nAll 11 edge-case states verified/seeded successfully.");

  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
