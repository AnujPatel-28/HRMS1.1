-- Seeding Leave Types for Tenant 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e'
INSERT INTO public.leave_types (
  id, tenant_id, name, code, days_per_year, accrual_type, carry_forward_enabled, carry_forward_max_days, encashment_enabled, applicable_from_day, probation_restricted, requires_document, min_notice_days, max_consecutive_days, is_active, sort_order, is_paid
) VALUES 
  ('c0000000-0000-0000-0000-000000000001', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'Casual Leave', 'CL', 12, 'lump_sum', false, 0, false, 0, false, false, 0, null, true, 1, true),
  ('c0000000-0000-0000-0000-000000000002', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'Sick Leave', 'SL', 12, 'lump_sum', false, 0, false, 0, false, false, 0, null, true, 2, true),
  ('c0000000-0000-0000-0000-000000000003', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'Earned Leave', 'EL', 15, 'lump_sum', true, 10, true, 90, true, false, 7, null, true, 3, true)
ON CONFLICT (id) DO NOTHING;

-- Seeding Leave Balances for 2026
-- employee-qa (e0000000-0000-0000-0000-000000000003)
INSERT INTO public.leave_balances (
  id, tenant_id, employee_id, leave_type_id, year, total_allocated, carried_forward, used_days, pending_days, balance
) VALUES
  ('b0000000-0000-0000-0000-000000000011', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 2026, 12, 0, 0, 0, 12),
  ('b0000000-0000-0000-0000-000000000012', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 2026, 12, 0, 0, 0, 12),
  ('b0000000-0000-0000-0000-000000000013', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 2026, 15, 0, 0, 0, 15)
ON CONFLICT (id) DO NOTHING;

-- project-qa (e0000000-0000-0000-0000-000000000005)
INSERT INTO public.leave_balances (
  id, tenant_id, employee_id, leave_type_id, year, total_allocated, carried_forward, used_days, pending_days, balance
) VALUES
  ('b0000000-0000-0000-0000-000000000021', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'e0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001', 2026, 12, 0, 0, 0, 12),
  ('b0000000-0000-0000-0000-000000000022', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'e0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000002', 2026, 12, 0, 0, 0, 12),
  ('b0000000-0000-0000-0000-000000000023', 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', 'e0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000003', 2026, 15, 0, 0, 0, 15)
ON CONFLICT (id) DO NOTHING;

-- Seeding Leaves
-- Request 1: Pending Sick Leave for employee-qa from tomorrow to tomorrow + 1
INSERT INTO public.leaves (
  id, tenant_id, employee_id, leave_type_id, leave_type, start_date, end_date, total_days, reason, status, applied_at
) VALUES (
  'f0000000-0000-0000-0000-000000000001',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'e0000000-0000-0000-0000-000000000003',
  'c0000000-0000-0000-0000-000000000002',
  'sick',
  current_date + 1,
  current_date + 2,
  2,
  'Recovering from seasonal flu.',
  'pending',
  now()
) ON CONFLICT (id) DO NOTHING;

-- Request 2: Approved Casual Leave for employee-qa from last week (3 days)
INSERT INTO public.leaves (
  id, tenant_id, employee_id, leave_type_id, leave_type, start_date, end_date, total_days, reason, status, applied_at, reviewed_by, reviewed_at
) VALUES (
  'f0000000-0000-0000-0000-000000000002',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'e0000000-0000-0000-0000-000000000003',
  'c0000000-0000-0000-0000-000000000001',
  'casual',
  current_date - 10,
  current_date - 8,
  3,
  'Family function at hometown.',
  'approved',
  now() - interval '12 days',
  'e0000000-0000-0000-0000-000000000002', -- reviewed by manager-qa
  now() - interval '11 days'
) ON CONFLICT (id) DO NOTHING;

-- Request 3: Pending Casual Leave for project-qa from next week (2 days)
INSERT INTO public.leaves (
  id, tenant_id, employee_id, leave_type_id, leave_type, start_date, end_date, total_days, reason, status, applied_at
) VALUES (
  'f0000000-0000-0000-0000-000000000003',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'e0000000-0000-0000-0000-000000000005',
  'c0000000-0000-0000-0000-000000000001',
  'casual',
  current_date + 7,
  current_date + 8,
  2,
  'Personal business and documentation work.',
  'pending',
  now()
) ON CONFLICT (id) DO NOTHING;

-- Seeding Extra Task for Project d0000000-0000-0000-0000-000000000051
-- assigned to employee-qa (e0000000-0000-0000-0000-000000000003)
INSERT INTO public.tasks (
  id, tenant_id, project_id, title, description, assigned_to, assigned_by, priority, due_date, due_time, status
) VALUES (
  'd0000000-0000-0000-0000-000000000062',
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  'd0000000-0000-0000-0000-000000000051',
  'Document API Schema',
  'Verify RLS filters and document database schema models.',
  'e0000000-0000-0000-0000-000000000003',
  'e0000000-0000-0000-0000-000000000002',
  'medium',
  current_date + 5,
  '18:00:00',
  'assigned'
) ON CONFLICT (id) DO NOTHING;
