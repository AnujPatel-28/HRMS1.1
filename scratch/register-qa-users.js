import { createClient } from "@insforge/sdk";
import pkg from "pg";

const { Client } = pkg;

const projectUrl = "https://rq3qmu8y-jx7.ap-southeast.insforge.app";
const apiKey = "ik_48f0f767d6c40717ba3112c9dca15a3b";
const dbConnectionString = "postgresql://postgres:f24232f87c1cf2717e4d5c002417a092@rq3qmu8y-jx7.ap-southeast.database.insforge.app:5432/insforge?sslmode=require";

const tenantId = "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e";
const password = "Password@123";

const testUsers = [
  { email: "hr-qa@talentmeshsolutions.com", role: "hr", fullName: "QA HR Admin", designation: "HR Manager", department: "HR", employeeId: "e0000000-0000-0000-0000-000000000001" },
  { email: "manager-qa@talentmeshsolutions.com", role: "employee", fullName: "QA Manager", designation: "Engineering Lead", department: "Engineering", employeeId: "e0000000-0000-0000-0000-000000000002" },
  { email: "employee-qa@talentmeshsolutions.com", role: "employee", fullName: "QA Normal Employee", designation: "Software Engineer", department: "Engineering", employeeId: "e0000000-0000-0000-0000-000000000003", managerId: "e0000000-0000-0000-0000-000000000002" },
  { email: "onboarding-qa@talentmeshsolutions.com", role: "employee", fullName: "QA Incomplete Onboarding", designation: "Product Manager", department: "Product", employeeId: "e0000000-0000-0000-0000-000000000004", managerId: "e0000000-0000-0000-0000-000000000002" },
  { email: "project-qa@talentmeshsolutions.com", role: "employee", fullName: "QA Project Member", designation: "UX Designer", department: "Design", employeeId: "e0000000-0000-0000-0000-000000000005", managerId: "e0000000-0000-0000-0000-000000000002" },
  { email: "offboarding-qa@talentmeshsolutions.com", role: "employee", fullName: "QA Offboarding Case", designation: "QA Analyst", department: "Engineering", employeeId: "e0000000-0000-0000-0000-000000000006", managerId: "e0000000-0000-0000-0000-000000000002" }
];

async function main() {
  const insforge = createClient({
    baseUrl: projectUrl,
    anonKey: apiKey,
  });

  const dbClient = new Client({ connectionString: dbConnectionString });
  await dbClient.connect();

  const registeredUsers = [];

  try {
    console.log("Registering QA users via InsForge Auth API...");
    for (const u of testUsers) {
      console.log(`Signing up ${u.email}...`);
      const { data, error } = await insforge.auth.signUp({
        email: u.email,
        password: password,
        name: u.fullName
      });

      if (error) {
        console.error(`✗ Sign up failed for ${u.email}:`, error);
        process.exit(1);
      }

      console.log(`✓ SignUp called for ${u.email}. Querying User ID from database...`);
      const res = await dbClient.query(`SELECT id FROM auth.users WHERE email = $1`, [u.email]);
      if (res.rows.length === 0) {
        throw new Error(`User row not found in database for ${u.email}`);
      }

      const userId = res.rows[0].id;
      console.log(`✓ Retried User ID from DB: ${userId}`);

      registeredUsers.push({
        ...u,
        authUserId: userId
      });
    }

    // 1. Create Tenant
    console.log("Seeding tenant...");
    await dbClient.query(`
      INSERT INTO public.tenants (
        id, company_name, subdomain, plan, status, timezone, punch_in_start, punch_in_cutoff, work_hours_per_day, lunch_break_minutes, punch_out_gate_enabled, max_employees
      ) VALUES (
        $1, 'QA Testing Org', 'qa-test', 'pro', 'active', 'Asia/Kolkata', '09:00:00', '10:30:00', 8, 60, true, 9999
      ) ON CONFLICT (id) DO NOTHING;
    `, [tenantId]);

    // 2. Update auth.users email_verified and metadata
    console.log("Updating auth.users details...");
    for (const ru of registeredUsers) {
      const userMetadata = {
        role: ru.role,
        tenant_id: tenantId
      };
      await dbClient.query(`
        UPDATE auth.users
        SET email_verified = true,
            metadata = $1::jsonb
        WHERE id = $2;
      `, [JSON.stringify(userMetadata), ru.authUserId]);
      console.log(`✓ Updated auth.users metadata for ${ru.email}`);
    }

    // 3. Insert Employees
    console.log("Inserting Employees...");
    for (const ru of registeredUsers) {
      await dbClient.query(`
        INSERT INTO public.employees (
          id, user_id, tenant_id, full_name, email, role, status, designation, department, manager_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, 'active', $7, $8, $9
        ) ON CONFLICT (id) DO NOTHING;
      `, [ru.employeeId, ru.authUserId, tenantId, ru.fullName, ru.email, ru.role, ru.designation, ru.department, ru.managerId || null]);
    }
    console.log("✓ Employees inserted.");

    // 4. Create Reporting Relationships
    console.log("Inserting reporting relationships...");
    for (const ru of registeredUsers) {
      if (ru.managerId) {
        await dbClient.query(`
          INSERT INTO public.employee_reporting_relationships (
            id, tenant_id, employee_id, manager_id, relationship_type, is_active, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, 'primary', true, now(), now()
          ) ON CONFLICT (id) DO NOTHING;
        `, [`d0000000-0000-0000-0000-${ru.employeeId.slice(-12)}`, tenantId, ru.employeeId, ru.managerId]);
      }
    }

    // 5. Create Onboarding self status
    console.log("Inserting onboarding self status...");
    const onboardingEmp = registeredUsers.find(ru => ru.email.startsWith("onboarding-qa"));
    await dbClient.query(`
      INSERT INTO public.employee_onboarding_self (
        id, tenant_id, employee_id, personal_details_completed, bank_details_completed, documents_completed, emergency_contact_completed, completed_at
      ) VALUES (
        'd0000000-0000-0000-0000-000000000004',
        $1,
        $2,
        false, false, false, false, null
      ) ON CONFLICT (id) DO NOTHING;
    `, [tenantId, onboardingEmp.employeeId]);

    // 6. Create Projects & Tasks
    console.log("Inserting project & tasks...");
    const managerEmp = registeredUsers.find(ru => ru.email.startsWith("manager-qa"));
    const projectEmp = registeredUsers.find(ru => ru.email.startsWith("project-qa"));
    await dbClient.query(`
      INSERT INTO public.projects (
        id, tenant_id, name, description, status, manager_id, start_date, end_date, created_by
      ) VALUES (
        'd0000000-0000-0000-0000-000000000051',
        $1,
        'QA Verification Project',
        'Validating HRMS People Suite RLS and Org Chart quality.',
        'active',
        $2,
        current_date, current_date + 30,
        $2
      ) ON CONFLICT (id) DO NOTHING;
    `, [tenantId, managerEmp.employeeId]);

    await dbClient.query(`
      INSERT INTO public.tasks (
        id, title, description, assigned_to, assigned_by, priority, due_date, due_time, status, tenant_id, project_id
      ) VALUES (
        'd0000000-0000-0000-0000-000000000061',
        'Verify Directory Privacy & Org Chart',
        'Perform manual check of RLS policies and Needs Manager Assignment UI group.',
        $1,
        $2,
        'high',
        current_date + 1,
        '18:00:00',
        'assigned',
        $3,
        'd0000000-0000-0000-0000-000000000051'
      ) ON CONFLICT (id) DO NOTHING;
    `, [projectEmp.employeeId, managerEmp.employeeId, tenantId]);

    // 7. Create Exit Request & Clearance items
    console.log("Inserting exit requests & clearances...");
    const offboardingEmp = registeredUsers.find(ru => ru.email.startsWith("offboarding-qa"));
    await dbClient.query(`
      INSERT INTO public.exit_requests (
        id, tenant_id, employee_id, exit_type, initiated_by, initiated_by_role, last_working_date, notice_period_days, reason, status
      ) VALUES (
        'd0000000-0000-0000-0000-000000000071',
        $1,
        $2,
        'resignation',
        $2,
        'employee',
        current_date + 30,
        30,
        'Career progression opportunities.',
        'notice_period'
      ) ON CONFLICT (id) DO NOTHING;
    `, [tenantId, offboardingEmp.employeeId]);

    await dbClient.query(`
      INSERT INTO public.exit_clearances (
        id, tenant_id, exit_request_id, department, status, label
      ) VALUES
        ('d0000000-0000-0000-0000-000000000081', $1, 'd0000000-0000-0000-0000-000000000071', 'assets', 'pending', 'Asset Clearance'),
        ('d0000000-0000-0000-0000-000000000082', $1, 'd0000000-0000-0000-0000-000000000071', 'it', 'pending', 'IT / Accounts Deactivation'),
        ('d0000000-0000-0000-0000-000000000083', $1, 'd0000000-0000-0000-0000-000000000071', 'finance', 'pending', 'Finance / Final Settlement'),
        ('d0000000-0000-0000-0000-000000000084', $1, 'd0000000-0000-0000-0000-000000000071', 'hr', 'pending', 'HR Clearance & Documentation'),
        ('d0000000-0000-0000-0000-000000000085', $1, 'd0000000-0000-0000-0000-000000000071', 'admin', 'pending', 'Admin / Access Card Revocation')
      ON CONFLICT (id) DO NOTHING;
    `, [tenantId]);

    console.log("✓ All business data and relationships successfully seeded on the branched database!");

  } catch (err) {
    console.error("✗ Database seeding failed:", err);
    process.exit(1);
  } finally {
    await dbClient.end();
  }
}

main().catch(console.error);
