-- ============================================================================
-- QA fixture enrichment for tenant `QA Testing Org` (da7a0000-7e57-4bca-95ba-c4ea7a6eca5e).
--
-- WHY: this tenant already carries the expensive half of a QA fixture -- six auth-backed
-- users with verified passwords and a working manager chain -- and none of the cheap half.
-- Verified 2026-08-31: 0 locations, 0 employment types, 0 grades, 0 shifts, 0 leave types,
-- 0 leave balances, 0 holiday calendars, and every `employee_code` NULL. Attendance cannot
-- derive without a shift, leave cannot be applied without a type and a balance, and the
-- kiosk rejects an employee with no code. This migration seeds exactly those prerequisites.
--
-- WHAT IT DELIBERATELY DOES NOT SEED: org units beyond the four that already exist,
-- reporting changes, attendance rows, leave requests, tasks, projects, kiosk PINs, devices.
-- Those are the things under test. Seeding them would test the seed, not the product.
--
-- IDEMPOTENCY: fixed UUIDs with ON CONFLICT (id), except leave_balances and
-- employee_shifts which use their verified natural-key unique constraints.
--
-- SCOPE FENCE: every statement is filtered on the QA tenant id. Nothing here can reach a
-- real tenant. The assertion block at the end fails the migration if the fixture is
-- incomplete -- a seed that silently half-applies is worse than one that fails, because QA
-- then reports the gap as a product bug.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Guard: the tenant and its six employees must already exist.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  v_emp_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e') THEN
    RAISE EXCEPTION 'QA fixture: tenant da7a0000-... does not exist; refusing to seed';
  END IF;

  SELECT count(*) INTO v_emp_count
  FROM public.employees
  WHERE tenant_id = 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e'
    AND id IN (
      'e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',
      'e0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000004',
      'e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000006'
    );
  IF v_emp_count <> 6 THEN
    RAISE EXCEPTION 'QA fixture: expected 6 seeded employees, found %', v_emp_count;
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. Locations. Three, because the office-locations screen and any location filter
--    need more than one to be meaningfully exercised.
-- ---------------------------------------------------------------------------
INSERT INTO public.locations (id, tenant_id, name, country, state, city, timezone, is_active) VALUES
  ('da7a0000-0000-0000-0001-000000000001','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','Ahmedabad HQ','India','Gujarat','Ahmedabad','Asia/Kolkata', true),
  ('da7a0000-0000-0000-0001-000000000002','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','Pune Branch','India','Maharashtra','Pune','Asia/Kolkata', true),
  ('da7a0000-0000-0000-0001-000000000003','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','Remote - India','India',NULL,NULL,'Asia/Kolkata', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, country = EXCLUDED.country, state = EXCLUDED.state,
  city = EXCLUDED.city, timezone = EXCLUDED.timezone, is_active = EXCLUDED.is_active,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Employment types.
-- ---------------------------------------------------------------------------
INSERT INTO public.employment_types (id, tenant_id, name, code, is_active) VALUES
  ('da7a0000-0000-0000-0002-000000000001','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','Full Time','FT', true),
  ('da7a0000-0000-0000-0002-000000000002','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','Intern','INT', true),
  ('da7a0000-0000-0000-0002-000000000003','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','Contract','CON', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, code = EXCLUDED.code, is_active = EXCLUDED.is_active, updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Grades. Probation months differ per grade on purpose -- the probation_end_date on the
--    recent joiner (section 9) is exactly three months after joining, matching G1's
--    default_probation_months, so a tester can check the two against each other.
-- ---------------------------------------------------------------------------
INSERT INTO public.employee_grades (id, tenant_id, name, level, default_notice_days, default_probation_months, is_active) VALUES
  ('da7a0000-0000-0000-0003-000000000001','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','G1 Associate',        1, 30, 3, true),
  ('da7a0000-0000-0000-0003-000000000002','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','G2 Senior Associate', 2, 30, 3, true),
  ('da7a0000-0000-0000-0003-000000000003','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','G3 Lead',             3, 60, 6, true),
  ('da7a0000-0000-0000-0003-000000000004','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','G4 Manager',          4, 90, 6, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, level = EXCLUDED.level,
  default_notice_days = EXCLUDED.default_notice_days,
  default_probation_months = EXCLUDED.default_probation_months,
  is_active = EXCLUDED.is_active, updated_at = now();

-- ---------------------------------------------------------------------------
-- 4. Holiday calendar. One holiday in the recent past (so derivation over a back-dated
--    range can be checked against it) and one in the near future (so the employee-facing
--    holiday list is not empty). The two fabricated dates are named "(not real)" so nobody
--    mistakes the fixture for an accurate Indian holiday list.
-- ---------------------------------------------------------------------------
INSERT INTO public.holiday_calendars (id, tenant_id, name, is_default) VALUES
  ('da7a0000-0000-0000-0005-000000000001','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','QA India Calendar 2026', true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_default = EXCLUDED.is_default;

INSERT INTO public.holiday_calendar_days (id, tenant_id, calendar_id, date, name, is_half_day) VALUES
  ('da7a0000-0000-0000-0055-000000000001','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','da7a0000-0000-0000-0005-000000000001', DATE '2026-01-26','Republic Day',               false),
  ('da7a0000-0000-0000-0055-000000000002','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','da7a0000-0000-0000-0005-000000000001', DATE '2026-08-15','Independence Day',           false),
  ('da7a0000-0000-0000-0055-000000000003','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','da7a0000-0000-0000-0005-000000000001', DATE '2026-09-07','QA Test Holiday (not real)', false),
  ('da7a0000-0000-0000-0055-000000000004','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','da7a0000-0000-0000-0005-000000000001', DATE '2026-10-02','Gandhi Jayanti',             false),
  ('da7a0000-0000-0000-0055-000000000005','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','da7a0000-0000-0000-0005-000000000001', DATE '2026-12-24','QA Half Day (not real)',     true),
  ('da7a0000-0000-0000-0055-000000000006','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','da7a0000-0000-0000-0005-000000000001', DATE '2026-12-25','Christmas',                  false)
ON CONFLICT (id) DO UPDATE SET
  date = EXCLUDED.date, name = EXCLUDED.name, is_half_day = EXCLUDED.is_half_day, updated_at = now();

-- ---------------------------------------------------------------------------
-- 5. Shifts. Three, chosen so the branches a tester can actually reach are all reachable:
--      General -- the default; Mon-Sat; late-entry marking ON with a 10-minute grace, so a
--                 09:41 punch is late and a 09:39 punch is not.
--      Night   -- end_time < start_time, so `crosses_midnight` (a GENERATED column, not
--                 settable) resolves true and the business-date rule becomes observable.
--      Flexi   -- Mon-Fri only and late marking OFF, so the same Saturday derives as a
--                 non-working day for one employee and a working day for the other five.
--    `shifts` has NO unique index beyond the primary key, so ON CONFLICT (id) is the only
--    idempotent form available here -- there is nothing else to infer.
-- ---------------------------------------------------------------------------
INSERT INTO public.shifts (
  id, tenant_id, name, start_time, end_time, working_days, is_default, is_active,
  punch_in_opens_minutes_before, punch_out_closes_minutes_after,
  working_hours_threshold_for_absent, working_hours_threshold_for_half_day,
  determine_check_in_and_check_out, working_hours_calculation_based_on,
  enable_late_entry_marking, late_entry_grace_minutes,
  enable_early_exit_marking, early_exit_grace_minutes,
  enable_auto_derivation, mark_attendance_on_holidays,
  allowed_punch_sources, holiday_calendar_id
) VALUES
  ('da7a0000-0000-0000-0004-000000000001','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','QA General Shift (09:30-18:30)',
   TIME '09:30', TIME '18:30', ARRAY[1,2,3,4,5,6], true, true,
   60, 60, 2.0, 4.0, 'alternating', 'first_last',
   true, 10, true, 10, true, false,
   ARRAY['app','device','kiosk','manual','import'], 'da7a0000-0000-0000-0005-000000000001'),

  ('da7a0000-0000-0000-0004-000000000002','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','QA Night Shift (22:00-06:00)',
   TIME '22:00', TIME '06:00', ARRAY[1,2,3,4,5], false, true,
   60, 60, 2.0, 4.0, 'alternating', 'first_last',
   true, 15, false, 10, true, false,
   ARRAY['app','device','kiosk','manual','import'], 'da7a0000-0000-0000-0005-000000000001'),

  ('da7a0000-0000-0000-0004-000000000003','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','QA Flexi Shift (10:00-19:00, Mon-Fri)',
   TIME '10:00', TIME '19:00', ARRAY[1,2,3,4,5], false, true,
   60, 60, 2.0, 4.0, 'alternating', 'first_last',
   false, 10, false, 10, true, false,
   ARRAY['app','device','kiosk','manual','import'], 'da7a0000-0000-0000-0005-000000000001')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
  working_days = EXCLUDED.working_days, is_default = EXCLUDED.is_default, is_active = EXCLUDED.is_active,
  punch_in_opens_minutes_before = EXCLUDED.punch_in_opens_minutes_before,
  punch_out_closes_minutes_after = EXCLUDED.punch_out_closes_minutes_after,
  working_hours_threshold_for_absent = EXCLUDED.working_hours_threshold_for_absent,
  working_hours_threshold_for_half_day = EXCLUDED.working_hours_threshold_for_half_day,
  enable_late_entry_marking = EXCLUDED.enable_late_entry_marking,
  late_entry_grace_minutes = EXCLUDED.late_entry_grace_minutes,
  enable_early_exit_marking = EXCLUDED.enable_early_exit_marking,
  early_exit_grace_minutes = EXCLUDED.early_exit_grace_minutes,
  enable_auto_derivation = EXCLUDED.enable_auto_derivation,
  mark_attendance_on_holidays = EXCLUDED.mark_attendance_on_holidays,
  allowed_punch_sources = EXCLUDED.allowed_punch_sources,
  holiday_calendar_id = EXCLUDED.holiday_calendar_id,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 6. Shift assignments. All six on the General shift from 2026-01-01. QA reassigns one to
--    Flexi or Night as a test step; the fixture must not pre-empt that.
--    Conflict target is the verified unique index on (tenant_id, employee_id, effective_from).
-- ---------------------------------------------------------------------------
INSERT INTO public.employee_shifts (tenant_id, employee_id, shift_id, effective_from, effective_to)
SELECT
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e',
  e.id,
  'da7a0000-0000-0000-0004-000000000001',
  DATE '2026-01-01',
  NULL
FROM public.employees e
WHERE e.tenant_id = 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e'
  AND e.id IN (
    'e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',
    'e0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000004',
    'e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000006'
  )
ON CONFLICT (tenant_id, employee_id, effective_from) DO UPDATE SET
  shift_id = EXCLUDED.shift_id, effective_to = EXCLUDED.effective_to;

-- ---------------------------------------------------------------------------
-- 7. Leave types. Four, covering the four behaviours a tester can distinguish: monthly
--    accrual, lump sum, carry-forward + encashment, and unpaid.
--
--    NOTE: `fn_accrue_monthly_leaves` exists but is NOT scheduled -- verified 2026-08-31,
--    `schedules list` returns exactly one schedule (attendance-derivation-hourly).
--    `accrual_type='monthly'` therefore describes intent, not observed behaviour: these
--    balances do not grow on their own. Section 8 seeds them at a usable level instead, and
--    the QA docs tell testers not to expect accrual.
-- ---------------------------------------------------------------------------
INSERT INTO public.leave_types (
  id, tenant_id, name, code, days_per_year, accrual_type,
  carry_forward_enabled, carry_forward_max_days, encashment_enabled,
  applicable_from_day, probation_restricted, requires_document,
  min_notice_days, max_consecutive_days, is_active, sort_order, is_paid
) VALUES
  ('da7a0000-0000-0000-0006-000000000001','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','Casual Leave','CL',
   12, 'monthly',  false,  0, false,  0, true,  false, 1,    3, true, 1, true),
  ('da7a0000-0000-0000-0006-000000000002','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','Sick Leave','SL',
    6, 'lump_sum', false,  0, false,  0, false, true,  0,    5, true, 2, true),
  ('da7a0000-0000-0000-0006-000000000003','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','Earned Leave','EL',
   15, 'monthly',  true,  10, true,  90, true,  false, 7,   15, true, 3, true),
  ('da7a0000-0000-0000-0006-000000000004','da7a0000-7e57-4bca-95ba-c4ea7a6eca5e','Leave Without Pay','LWP',
    0, 'lump_sum', false,  0, false,  0, false, false, 0, NULL, true, 4, false)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, code = EXCLUDED.code, days_per_year = EXCLUDED.days_per_year,
  accrual_type = EXCLUDED.accrual_type,
  carry_forward_enabled = EXCLUDED.carry_forward_enabled,
  carry_forward_max_days = EXCLUDED.carry_forward_max_days,
  encashment_enabled = EXCLUDED.encashment_enabled,
  applicable_from_day = EXCLUDED.applicable_from_day,
  probation_restricted = EXCLUDED.probation_restricted,
  requires_document = EXCLUDED.requires_document,
  min_notice_days = EXCLUDED.min_notice_days,
  max_consecutive_days = EXCLUDED.max_consecutive_days,
  is_active = EXCLUDED.is_active, sort_order = EXCLUDED.sort_order,
  is_paid = EXCLUDED.is_paid, updated_at = now();

-- ---------------------------------------------------------------------------
-- 8. Leave balances for 2026 -- six employees x four types = 24 rows.
--    `balance` is written as total_allocated + carried_forward - used_days so the seeded
--    ledger is internally consistent from the start. Nothing in the schema enforces that
--    identity, so getting it right here is the only thing keeping the fixture honest.
--    used_days is deliberately 0: a QA leave application is what puts the first number in
--    that column, and a tester needs to watch it move.
-- ---------------------------------------------------------------------------
INSERT INTO public.leave_balances (
  tenant_id, employee_id, leave_type_id, year,
  total_allocated, carried_forward, used_days, pending_days, balance, last_accrual_date
)
SELECT
  'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e', e.id, lt.id, 2026,
  lt.allocated, lt.carried, 0, 0, lt.allocated + lt.carried, NULL
FROM public.employees e
CROSS JOIN (VALUES
  ('da7a0000-0000-0000-0006-000000000001'::uuid, 12.0::numeric, 0.0::numeric),
  ('da7a0000-0000-0000-0006-000000000002'::uuid,  6.0,          0.0),
  ('da7a0000-0000-0000-0006-000000000003'::uuid, 15.0,          3.0),
  ('da7a0000-0000-0000-0006-000000000004'::uuid,  0.0,          0.0)
) AS lt(id, allocated, carried)
WHERE e.tenant_id = 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e'
  AND e.id IN (
    'e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',
    'e0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000004',
    'e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000006'
  )
ON CONFLICT (tenant_id, employee_id, leave_type_id, year) DO UPDATE SET
  total_allocated = EXCLUDED.total_allocated,
  carried_forward = EXCLUDED.carried_forward,
  -- Re-running must not resurrect days a QA test already consumed, so the existing
  -- used_days is subtracted rather than reset.
  balance = EXCLUDED.total_allocated + EXCLUDED.carried_forward - leave_balances.used_days,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 9. Employee profile completion.
--    `employees.employee_code` is unique GLOBALLY, not per tenant (employees_employee_code_key
--    is a plain btree on the column alone) -- hence the QA- prefix, checked against the
--    QA-A-1..QA-C-2 codes the module-mix fixture tenants already hold.
--    date_of_joining is staggered on purpose: a tenure column, a probation banner, and any
--    "joined this month" filter all need employees who differ.
-- ---------------------------------------------------------------------------
UPDATE public.employees e SET
  employee_code       = v.code,
  date_of_joining     = v.doj,
  location_id         = v.location_id,
  employment_type_id  = v.emp_type_id,
  grade_id            = v.grade_id,
  job_title_id        = v.job_title_id,
  holiday_calendar_id = 'da7a0000-0000-0000-0005-000000000001',
  work_mode           = v.work_mode,
  probation_status    = v.probation_status,
  probation_end_date  = v.probation_end,
  updated_at          = now()
FROM (VALUES
  -- HR Admin, Ahmedabad HQ, Full Time, G4, HR Manager
  ('e0000000-0000-0000-0000-000000000001'::uuid, 'QA-HR-001',  DATE '2024-04-01',
   'da7a0000-0000-0000-0001-000000000001'::uuid, 'da7a0000-0000-0000-0002-000000000001'::uuid,
   'da7a0000-0000-0000-0003-000000000004'::uuid, '700d5b9c-3da1-4132-8581-691658e6d38f'::uuid,
   'office', 'confirmed', NULL::date),

  -- Manager (five direct reports), Ahmedabad HQ, Full Time, G4, Engineering Lead
  ('e0000000-0000-0000-0000-000000000002'::uuid, 'QA-MGR-002', DATE '2024-06-15',
   'da7a0000-0000-0000-0001-000000000001'::uuid, 'da7a0000-0000-0000-0002-000000000001'::uuid,
   'da7a0000-0000-0000-0003-000000000004'::uuid, '6207896a-ec8c-4505-867d-8dc05eae69b9'::uuid,
   'hybrid', 'confirmed', NULL::date),

  -- The plain employee every RLS check runs as. Ahmedabad HQ, Full Time, G2, Software Engineer
  ('e0000000-0000-0000-0000-000000000003'::uuid, 'QA-EMP-003', DATE '2025-01-06',
   'da7a0000-0000-0000-0001-000000000001'::uuid, 'da7a0000-0000-0000-0002-000000000001'::uuid,
   'da7a0000-0000-0000-0003-000000000002'::uuid, '7158f83d-45a7-42d8-8620-6d2de79cebf1'::uuid,
   'office', 'confirmed', NULL::date),

  -- The only employee still on probation. G1's default_probation_months is 3, and the end
  -- date below is exactly three months after joining, so the two can be checked against
  -- each other. Also the only Intern, so probation_restricted leave types have a subject.
  ('e0000000-0000-0000-0000-000000000004'::uuid, 'QA-ONB-004', DATE '2026-08-25',
   'da7a0000-0000-0000-0001-000000000002'::uuid, 'da7a0000-0000-0000-0002-000000000002'::uuid,
   'da7a0000-0000-0000-0003-000000000001'::uuid, '3436ff85-1d5a-4efd-b99d-7c4580ac0a68'::uuid,
   'office', 'on_probation', DATE '2026-11-25'),

  -- The only remote worker, so a geofence exception has a subject. Design, Contract, G2.
  ('e0000000-0000-0000-0000-000000000005'::uuid, 'QA-PRJ-005', DATE '2025-03-10',
   'da7a0000-0000-0000-0001-000000000003'::uuid, 'da7a0000-0000-0000-0002-000000000003'::uuid,
   'da7a0000-0000-0000-0003-000000000002'::uuid, '1be65317-81a3-4e97-ad83-fa695fcc3b81'::uuid,
   'remote', 'confirmed', NULL::date),

  -- Longest tenure, so notice-period and exit arithmetic has a subject. Pune, G3, QA Analyst.
  ('e0000000-0000-0000-0000-000000000006'::uuid, 'QA-OFF-006', DATE '2023-11-20',
   'da7a0000-0000-0000-0001-000000000002'::uuid, 'da7a0000-0000-0000-0002-000000000001'::uuid,
   'da7a0000-0000-0000-0003-000000000003'::uuid, 'a22b1573-4fd9-4f6f-b8a8-079aa6b497fd'::uuid,
   'office', 'confirmed', NULL::date)
) AS v(emp_id, code, doj, location_id, emp_type_id, grade_id, job_title_id,
       work_mode, probation_status, probation_end)
WHERE e.id = v.emp_id
  AND e.tenant_id = 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e';

-- ---------------------------------------------------------------------------
-- 10. Assertions.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  t uuid := 'da7a0000-7e57-4bca-95ba-c4ea7a6eca5e';
  v_locations     integer;
  v_emptypes      integer;
  v_grades        integer;
  v_shifts        integer;
  v_assigned      integer;
  v_ltypes        integer;
  v_balances      integer;
  v_holidays      integer;
  v_no_code       integer;
  v_no_doj        integer;
  v_bad_balance   integer;
  v_default_shift integer;
  v_unprofiled    integer;
BEGIN
  SELECT count(*) INTO v_locations FROM public.locations            WHERE tenant_id = t AND is_active;
  SELECT count(*) INTO v_emptypes  FROM public.employment_types     WHERE tenant_id = t AND is_active;
  SELECT count(*) INTO v_grades    FROM public.employee_grades      WHERE tenant_id = t AND is_active;
  SELECT count(*) INTO v_shifts    FROM public.shifts               WHERE tenant_id = t AND is_active;
  SELECT count(*) INTO v_assigned  FROM public.employee_shifts      WHERE tenant_id = t;
  SELECT count(*) INTO v_ltypes    FROM public.leave_types          WHERE tenant_id = t AND is_active;
  SELECT count(*) INTO v_balances  FROM public.leave_balances       WHERE tenant_id = t AND year = 2026;
  SELECT count(*) INTO v_holidays  FROM public.holiday_calendar_days WHERE tenant_id = t;

  SELECT count(*) INTO v_no_code FROM public.employees
   WHERE tenant_id = t AND status = 'active' AND (employee_code IS NULL OR employee_code = '');
  SELECT count(*) INTO v_no_doj FROM public.employees
   WHERE tenant_id = t AND status = 'active' AND date_of_joining IS NULL;
  SELECT count(*) INTO v_unprofiled FROM public.employees
   WHERE tenant_id = t AND status = 'active'
     AND (location_id IS NULL OR employment_type_id IS NULL OR grade_id IS NULL
          OR job_title_id IS NULL OR holiday_calendar_id IS NULL);

  -- The ledger identity nothing in the schema enforces.
  SELECT count(*) INTO v_bad_balance FROM public.leave_balances
   WHERE tenant_id = t AND year = 2026
     AND balance <> (total_allocated + carried_forward - used_days);

  SELECT count(*) INTO v_default_shift FROM public.shifts WHERE tenant_id = t AND is_default AND is_active;

  IF v_locations   <  3 THEN RAISE EXCEPTION 'QA fixture: expected >= 3 locations, got %', v_locations; END IF;
  IF v_emptypes    <  3 THEN RAISE EXCEPTION 'QA fixture: expected >= 3 employment types, got %', v_emptypes; END IF;
  IF v_grades      <  4 THEN RAISE EXCEPTION 'QA fixture: expected >= 4 grades, got %', v_grades; END IF;
  IF v_shifts      <  3 THEN RAISE EXCEPTION 'QA fixture: expected >= 3 shifts, got %', v_shifts; END IF;
  IF v_assigned    <  6 THEN RAISE EXCEPTION 'QA fixture: expected >= 6 shift assignments, got %', v_assigned; END IF;
  IF v_ltypes      <  4 THEN RAISE EXCEPTION 'QA fixture: expected >= 4 leave types, got %', v_ltypes; END IF;
  IF v_balances   <> 24 THEN RAISE EXCEPTION 'QA fixture: expected 24 leave balances (6 x 4), got %', v_balances; END IF;
  IF v_holidays    <  6 THEN RAISE EXCEPTION 'QA fixture: expected >= 6 holiday days, got %', v_holidays; END IF;
  IF v_no_code    <> 0 THEN RAISE EXCEPTION 'QA fixture: % active employees still have no employee_code (the kiosk would reject them)', v_no_code; END IF;
  IF v_no_doj     <> 0 THEN RAISE EXCEPTION 'QA fixture: % active employees still have no date_of_joining', v_no_doj; END IF;
  IF v_unprofiled <> 0 THEN RAISE EXCEPTION 'QA fixture: % active employees are missing a location, employment type, grade, job title or holiday calendar', v_unprofiled; END IF;
  IF v_bad_balance <> 0 THEN RAISE EXCEPTION 'QA fixture: % leave balances violate allocated + carried - used = balance', v_bad_balance; END IF;
  IF v_default_shift <> 1 THEN RAISE EXCEPTION 'QA fixture: expected exactly 1 active default shift, got %', v_default_shift; END IF;

  RAISE NOTICE 'QA fixture verified: % locations, % employment types, % grades, % shifts (% assignments), % leave types, % balances, % holiday days; 0 employees missing code, DOJ or profile links',
    v_locations, v_emptypes, v_grades, v_shifts, v_assigned, v_ltypes, v_balances, v_holidays;
END
$verify$;
