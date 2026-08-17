-- 1. Create Tenant
INSERT INTO public.tenants (
  id, company_name, subdomain, plan, status, timezone, punch_in_start, punch_in_cutoff, work_hours_per_day, lunch_break_minutes, punch_out_gate_enabled, max_employees
) VALUES (
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'QA Testing Org', 'qa-test', 'pro', 'active', 'Asia/Kolkata', '09:00:00', '10:30:00', 8, 60, true, 9999
) ON CONFLICT (id) DO NOTHING;

-- 2. Create Auth Users
-- HR Admin
INSERT INTO auth.users (id, email, password, email_verified, is_anonymous, is_project_admin, metadata)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'hr-qa@talentmeshsolutions.com',
  '$2a$10$3ucXVNJYwQmN.cCbLxIU8eXUZg/6Q8jLAR2AwJs2pH4qyx7B2RukO', -- Password@123
  true, false, false,
  '{"role": "hr", "tenant_id": "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e"}'::jsonb
) ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata;

-- Manager
INSERT INTO auth.users (id, email, password, email_verified, is_anonymous, is_project_admin, metadata)
VALUES (
  'a0000000-0000-0000-0000-000000000002',
  'manager-qa@talentmeshsolutions.com',
  '$2a$10$3ucXVNJYwQmN.cCbLxIU8eXUZg/6Q8jLAR2AwJs2pH4qyx7B2RukO',
  true, false, false,
  '{"role": "employee", "tenant_id": "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e"}'::jsonb
) ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata;

-- Normal Employee
INSERT INTO auth.users (id, email, password, email_verified, is_anonymous, is_project_admin, metadata)
VALUES (
  'a0000000-0000-0000-0000-000000000003',
  'employee-qa@talentmeshsolutions.com',
  '$2a$10$3ucXVNJYwQmN.cCbLxIU8eXUZg/6Q8jLAR2AwJs2pH4qyx7B2RukO',
  true, false, false,
  '{"role": "employee", "tenant_id": "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e"}'::jsonb
) ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata;

-- Onboarding Incomplete
INSERT INTO auth.users (id, email, password, email_verified, is_anonymous, is_project_admin, metadata)
VALUES (
  'a0000000-0000-0000-0000-000000000004',
  'onboarding-qa@talentmeshsolutions.com',
  '$2a$10$3ucXVNJYwQmN.cCbLxIU8eXUZg/6Q8jLAR2AwJs2pH4qyx7B2RukO',
  true, false, false,
  '{"role": "employee", "tenant_id": "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e"}'::jsonb
) ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata;

-- Project member
INSERT INTO auth.users (id, email, password, email_verified, is_anonymous, is_project_admin, metadata)
VALUES (
  'a0000000-0000-0000-0000-000000000005',
  'project-qa@talentmeshsolutions.com',
  '$2a$10$3ucXVNJYwQmN.cCbLxIU8eXUZg/6Q8jLAR2AwJs2pH4qyx7B2RukO',
  true, false, false,
  '{"role": "employee", "tenant_id": "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e"}'::jsonb
) ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata;

-- Offboarding case
INSERT INTO auth.users (id, email, password, email_verified, is_anonymous, is_project_admin, metadata)
VALUES (
  'a0000000-0000-0000-0000-000000000006',
  'offboarding-qa@talentmeshsolutions.com',
  '$2a$10$3ucXVNJYwQmN.cCbLxIU8eXUZg/6Q8jLAR2AwJs2pH4qyx7B2RukO',
  true, false, false,
  '{"role": "employee", "tenant_id": "da7a0000-7e57-4bca-95ba-c4ea7a6eca5e"}'::jsonb
) ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata;

-- 3. Create Employees in DB
-- HR Employee
INSERT INTO public.employees (
  id, user_id, tenant_id, full_name, email, role, status, designation, department
) VALUES (
  'e0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'QA HR Admin',
  'hr-qa@talentmeshsolutions.com',
  'hr',
  'active',
  'HR Manager',
  'HR'
) ON CONFLICT (id) DO NOTHING;

-- Manager Employee
INSERT INTO public.employees (
  id, user_id, tenant_id, full_name, email, role, status, designation, department
) VALUES (
  'e0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000002',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'QA Manager',
  'manager-qa@talentmeshsolutions.com',
  'employee',
  'active',
  'Engineering Lead',
  'Engineering'
) ON CONFLICT (id) DO NOTHING;

-- Normal Employee
INSERT INTO public.employees (
  id, user_id, tenant_id, full_name, email, role, status, designation, department, manager_id
) VALUES (
  'e0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000003',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'QA Normal Employee',
  'employee-qa@talentmeshsolutions.com',
  'employee',
  'active',
  'Software Engineer',
  'Engineering',
  'e0000000-0000-0000-0000-000000000002'
) ON CONFLICT (id) DO NOTHING;

-- Onboarding Incomplete Employee
INSERT INTO public.employees (
  id, user_id, tenant_id, full_name, email, role, status, designation, department, manager_id
) VALUES (
  'e0000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000004',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'QA Incomplete Onboarding',
  'onboarding-qa@talentmeshsolutions.com',
  'employee',
  'active',
  'Product Manager',
  'Product',
  'e0000000-0000-0000-0000-000000000002'
) ON CONFLICT (id) DO NOTHING;

-- Project Member Employee
INSERT INTO public.employees (
  id, user_id, tenant_id, full_name, email, role, status, designation, department, manager_id
) VALUES (
  'e0000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000005',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'QA Project Member',
  'project-qa@talentmeshsolutions.com',
  'employee',
  'active',
  'UX Designer',
  'Design',
  'e0000000-0000-0000-0000-000000000002'
) ON CONFLICT (id) DO NOTHING;

-- Offboarding Case Employee
INSERT INTO public.employees (
  id, user_id, tenant_id, full_name, email, role, status, designation, department, manager_id
) VALUES (
  'e0000000-0000-0000-0000-000000000006',
  'a0000000-0000-0000-0000-000000000006',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'QA Offboarding Case',
  'offboarding-qa@talentmeshsolutions.com',
  'employee',
  'active',
  'QA Analyst',
  'Engineering',
  'e0000000-0000-0000-0000-000000000002'
) ON CONFLICT (id) DO NOTHING;

-- 4. Create Reporting Relationships
INSERT INTO public.employee_reporting_relationships (
  id, tenant_id, employee_id, manager_id, relationship_type, is_active, created_at, updated_at
) VALUES (
  'd0000000-0000-0000-0000-000000000003',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'e0000000-0000-0000-0000-000000000003',
  'e0000000-0000-0000-0000-000000000002',
  'primary',
  true, now(), now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.employee_reporting_relationships (
  id, tenant_id, employee_id, manager_id, relationship_type, is_active, created_at, updated_at
) VALUES (
  'd0000000-0000-0000-0000-000000000004',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'e0000000-0000-0000-0000-000000000004',
  'e0000000-0000-0000-0000-000000000002',
  'primary',
  true, now(), now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.employee_reporting_relationships (
  id, tenant_id, employee_id, manager_id, relationship_type, is_active, created_at, updated_at
) VALUES (
  'd0000000-0000-0000-0000-000000000005',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'e0000000-0000-0000-0000-000000000005',
  'e0000000-0000-0000-0000-000000000002',
  'primary',
  true, now(), now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.employee_reporting_relationships (
  id, tenant_id, employee_id, manager_id, relationship_type, is_active, created_at, updated_at
) VALUES (
  'd0000000-0000-0000-0000-000000000006',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'e0000000-0000-0000-0000-000000000006',
  'e0000000-0000-0000-0000-000000000002',
  'primary',
  true, now(), now()
) ON CONFLICT (id) DO NOTHING;

-- 5. Create Onboarding self status
INSERT INTO public.employee_onboarding_self (
  id, tenant_id, employee_id, personal_details_completed, bank_details_completed, documents_completed, emergency_contact_completed, completed_at
) VALUES (
  'd0000000-0000-0000-0000-000000000004',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'e0000000-0000-0000-0000-000000000004',
  false, false, false, false, null
) ON CONFLICT (id) DO NOTHING;

-- 6. Create Projects & Tasks
INSERT INTO public.projects (
  id, tenant_id, name, description, status, manager_id, start_date, end_date, created_by
) VALUES (
  'd0000000-0000-0000-0000-000000000051',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'QA Verification Project',
  'Validating HRMS People Suite RLS and Org Chart quality.',
  'active',
  'e0000000-0000-0000-0000-000000000002',
  current_date, current_date + 30,
  'e0000000-0000-0000-0000-000000000002'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tasks (
  id, title, description, assigned_to, assigned_by, priority, due_date, due_time, status, tenant_id, project_id
) VALUES (
  'd0000000-0000-0000-0000-000000000061',
  'Verify Directory Privacy & Org Chart',
  'Perform manual check of RLS policies and Needs Manager Assignment UI group.',
  'e0000000-0000-0000-0000-000000000005',
  'e0000000-0000-0000-0000-000000000002',
  'high',
  current_date + 1,
  '18:00:00',
  'assigned',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'd0000000-0000-0000-0000-000000000051'
) ON CONFLICT (id) DO NOTHING;

-- 7. Create Exit Request & Clearance items
INSERT INTO public.exit_requests (
  id, tenant_id, employee_id, exit_type, initiated_by, initiated_by_role, last_working_date, notice_period_days, reason, status
) VALUES (
  'd0000000-0000-0000-0000-000000000071',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'e0000000-0000-0000-0000-000000000006',
  'resignation',
  'e0000000-0000-0000-0000-000000000006',
  'employee',
  current_date + 30,
  30,
  'Career progression opportunities.',
  'notice_period'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.exit_clearances (
  id, tenant_id, exit_request_id, department, status, label
) VALUES
  ('d0000000-0000-0000-0000-000000000081', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'd0000000-0000-0000-0000-000000000071', 'assets', 'pending', 'Asset Clearance'),
  ('d0000000-0000-0000-0000-000000000082', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'd0000000-0000-0000-0000-000000000071', 'it', 'pending', 'IT / Accounts Deactivation'),
  ('d0000000-0000-0000-0000-000000000083', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'd0000000-0000-0000-0000-000000000071', 'finance', 'pending', 'Finance / Final Settlement'),
  ('d0000000-0000-0000-0000-000000000084', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'd0000000-0000-0000-0000-000000000071', 'hr', 'pending', 'HR Clearance & Documentation'),
  ('d0000000-0000-0000-0000-000000000085', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'd0000000-0000-0000-0000-000000000071', 'admin', 'pending', 'Admin / Access Card Revocation')
ON CONFLICT (id) DO NOTHING;
