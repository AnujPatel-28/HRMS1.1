-- QA regression fixtures: three tenants with DIFFERENT module mixes.
--
-- ============================================================================
-- WHY THIS EXISTS
-- ============================================================================
-- All 12 real tenants hold all 12 (now 13) catalogue modules enabled, so the
-- module-entitlement system has never actually run with a module OFF. Three real
-- bugs hid there: payroll paying everyone zero when attendance was off, employees
-- locked out of punch-out when tasks was off (fixed 20260821150000), and holidays
-- disappearing when leave was off (fixed 20260821180000). These fixtures exist so
-- the next such bug is caught by a test tenant, not by a customer.
--
-- HOW TO IDENTIFY THESE ROWS: every fixture's `tenants.company_name` starts with
-- "QA ", every employee's email lives under a `qa-*.test` domain, and every other
-- row references one of the three fixed tenant_ids below. Safe to `DELETE FROM
-- tenants WHERE company_name LIKE 'QA %'` (cascades) if these ever need removing.
--
-- ============================================================================
-- FILENAME / VERSION DEVIATION FROM THE REQUEST
-- ============================================================================
-- Requested path was migrations/20260821170000_qa-module-mix-test-tenants.sql.
-- That version cannot be used: 20260821180000_work-calendar-core-infrastructure
-- is ALREADY APPLIED on this project (confirmed via `system.custom_migrations`),
-- so a 170000-versioned file would sort and target BEFORE the current remote
-- head — `db migrations up` requires the target to be the next pending version
-- after the remote head. This file is versioned 20260821190000 instead, one step
-- after the applied head, so it can actually be applied when you're ready.
--
-- ============================================================================
-- SCHEMA HAS MOVED SINCE THE BRIEF WAS WRITTEN
-- ============================================================================
-- The brief says "directory and policy_center are is_core=true" and describes
-- holidays as belonging to the `leave` module. Both are now stale:
--   * The catalogue is 13 keys, not 12: `work_calendar` was added by
--     20260821180000 as a THIRD core module (directory, policy_center,
--     work_calendar are all is_core=true).
--   * `holidays` is now gated by `module_enabled_work_calendar`, not
--     `module_enabled_leave` — it is core infrastructure (attendance measures
--     against it, leave deducts from it, payroll divides by it), available
--     regardless of a tenant's module mix.
-- Deliberate consequence: tenant A ("attendance only") gets ONE holiday row
-- too, even though the brief only asked for holidays on B/C. This is not scope
-- creep — a holiday row costs nothing and is what makes
-- work_calendar_working_days() (and therefore attendance's day-count math)
-- testable for A. Tenant A still gets NO leave_type and NO salary_structure,
-- which is what actually makes "attendance only" mean something.
--
-- Everything below reads `public.modules` rather than hardcoding "13 keys" or
-- "3 core keys", so it keeps working if the catalogue changes again.
--
-- ============================================================================
-- THE SEEDING TRIGGER
-- ============================================================================
-- 20260821140000 added an AFTER INSERT trigger on `tenants`
-- (trg_seed_tenant_modules) that inserts a tenant_modules row for EVERY
-- catalogue module, enabled=true, the moment a tenant is created. So inserting
-- the three tenants below does NOT leave them moduleless — it leaves them with
-- everything ON, same as every other tenant. This migration's job is to insert
-- the tenants, then explicitly UPDATE tenant_modules down to each fixture's
-- intended mix. An explicit tenant_modules backfill (step 2) is also run before
-- that update, so this migration does not silently depend on the trigger having
-- fired — it is correct whether the trigger ran, didn't run, or a module was
-- added to the catalogue after the trigger last ran.
--
-- ============================================================================
-- AUTH-USER LIMITATION
-- ============================================================================
-- Employees below are created with user_id = NULL. Auth users cannot be created
-- from SQL in this system (auth.users is InsForge-managed and password hashing
-- happens through the auth service, not plain SQL). To actually log in as one of
-- these employees for manual QA, use the HR-driven onboarding edge functions
-- (create-employee-user / set-employee-password) against the fixture's
-- employee row, the same path real employee accounts are provisioned through.
--
-- ============================================================================
-- IDEMPOTENCY
-- ============================================================================
-- Every row uses a fixed UUID (scheme: tenant-marker prefix `11111111-1111-
-- 4111-8111-`, `22222222-2222-4222-8222-`, `33333333-3333-4333-8333-`, then a
-- 12-hex-digit row-type code as the last group: 000000000001 = tenant,
-- ...002 = org unit, ...003 = job title, ...004 = shift, ...005 = holiday,
-- ...006 = leave type, ...011/012 = employees, ...021/022 = employee_shifts,
-- ...031/032 = salary_structures). Every INSERT is ON CONFLICT DO NOTHING
-- keyed on that fixed id, and the tenant_modules UPDATEs are plain idempotent
-- UPDATEs, so re-running this file is a no-op the second time.

-- ---------------------------------------------------------------------------
-- Fixture A: "QA Attendance Only" — enabled: attendance (+ core). Nothing else.
-- Fixture B: "QA Attendance Payroll" — enabled: attendance, leave, payroll (+ core).
-- Fixture C: "QA Full Suite" — every catalogue module enabled.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Tenants
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, company_name, subdomain)
VALUES
  ('11111111-1111-4111-8111-000000000001', 'QA Attendance Only',     'qa-attendance-only'),
  ('22222222-2222-4222-8222-000000000001', 'QA Attendance Payroll',  'qa-attendance-payroll'),
  ('33333333-3333-4333-8333-000000000001', 'QA Full Suite',          'qa-full-suite')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Explicit tenant_modules backfill
-- ---------------------------------------------------------------------------
-- Guarantees a row per catalogue module for these three tenants regardless of
-- whether trg_seed_tenant_modules fired (it won't fire on a re-run once the
-- tenant already exists) and regardless of catalogue changes since. Mirrors the
-- backfill pattern in 20260821140000.
INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, enabled_at)
SELECT t.id, m.key, true, now()
FROM public.tenants t
CROSS JOIN public.modules m
WHERE t.id IN (
  '11111111-1111-4111-8111-000000000001',
  '22222222-2222-4222-8222-000000000001',
  '33333333-3333-4333-8333-000000000001'
)
AND NOT EXISTS (
  SELECT 1 FROM public.tenant_modules tm
  WHERE tm.tenant_id = t.id AND tm.module_key = m.key
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Cut each tenant down to its intended module mix
-- ---------------------------------------------------------------------------
-- Core modules are read from public.modules at apply time rather than
-- hardcoded, so this stays correct if a module is reclassified core later.

-- A: attendance only (+ whatever is core).
UPDATE public.tenant_modules tm
SET enabled = (
      tm.module_key = 'attendance'
      OR EXISTS (SELECT 1 FROM public.modules m WHERE m.key = tm.module_key AND m.is_core)
    ),
    enabled_at = now()
WHERE tm.tenant_id = '11111111-1111-4111-8111-000000000001';

-- B: attendance + leave + payroll (+ core).
UPDATE public.tenant_modules tm
SET enabled = (
      tm.module_key IN ('attendance', 'leave', 'payroll')
      OR EXISTS (SELECT 1 FROM public.modules m WHERE m.key = tm.module_key AND m.is_core)
    ),
    enabled_at = now()
WHERE tm.tenant_id = '22222222-2222-4222-8222-000000000001';

-- C: everything on.
UPDATE public.tenant_modules tm
SET enabled = true,
    enabled_at = now()
WHERE tm.tenant_id = '33333333-3333-4333-8333-000000000001';

-- ---------------------------------------------------------------------------
-- 4. Org units (one root unit per tenant)
-- ---------------------------------------------------------------------------
INSERT INTO public.org_units (id, tenant_id, name, unit_type)
VALUES
  ('11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000001', 'QA Operations', 'department'),
  ('22222222-2222-4222-8222-000000000002', '22222222-2222-4222-8222-000000000001', 'QA Operations', 'department'),
  ('33333333-3333-4333-8333-000000000002', '33333333-3333-4333-8333-000000000001', 'QA Operations', 'department')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Job titles
-- ---------------------------------------------------------------------------
INSERT INTO public.job_titles (id, tenant_id, title)
VALUES
  ('11111111-1111-4111-8111-000000000003', '11111111-1111-4111-8111-000000000001', 'QA Associate'),
  ('22222222-2222-4222-8222-000000000003', '22222222-2222-4222-8222-000000000001', 'QA Associate'),
  ('33333333-3333-4333-8333-000000000003', '33333333-3333-4333-8333-000000000001', 'QA Associate')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Shifts
-- ---------------------------------------------------------------------------
INSERT INTO public.shifts (id, tenant_id, name, start_time, end_time, is_default)
VALUES
  ('11111111-1111-4111-8111-000000000004', '11111111-1111-4111-8111-000000000001', 'QA Day Shift', '09:00:00', '18:00:00', true),
  ('22222222-2222-4222-8222-000000000004', '22222222-2222-4222-8222-000000000001', 'QA Day Shift', '09:00:00', '18:00:00', true),
  ('33333333-3333-4333-8333-000000000004', '33333333-3333-4333-8333-000000000001', 'QA Day Shift', '09:00:00', '18:00:00', true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Holidays — one per tenant (work_calendar is core; see header)
-- ---------------------------------------------------------------------------
INSERT INTO public.holidays (id, tenant_id, name, date, type)
VALUES
  ('11111111-1111-4111-8111-000000000005', '11111111-1111-4111-8111-000000000001', 'QA Test Holiday', '2026-01-26', 'national'),
  ('22222222-2222-4222-8222-000000000005', '22222222-2222-4222-8222-000000000001', 'QA Test Holiday', '2026-01-26', 'national'),
  ('33333333-3333-4333-8333-000000000005', '33333333-3333-4333-8333-000000000001', 'QA Test Holiday', '2026-01-26', 'national')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. Leave types — B and C only (A has no leave module)
-- ---------------------------------------------------------------------------
INSERT INTO public.leave_types (id, tenant_id, name, code, days_per_year)
VALUES
  ('22222222-2222-4222-8222-000000000006', '22222222-2222-4222-8222-000000000001', 'QA Casual Leave', 'QA-CL', 12),
  ('33333333-3333-4333-8333-000000000006', '33333333-3333-4333-8333-000000000001', 'QA Casual Leave', 'QA-CL', 12)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. Employees — 2 per tenant, user_id NULL (see auth-user limitation above)
-- ---------------------------------------------------------------------------
INSERT INTO public.employees
  (id, tenant_id, full_name, email, employee_code, status, date_of_joining, org_unit_id, job_title_id)
VALUES
  ('11111111-1111-4111-8111-000000000011', '11111111-1111-4111-8111-000000000001',
   'QA Employee 1 (Attendance Only)', 'employee1@qa-attendance-only.test', 'QA-A-1',
   'active', '2026-01-06', '11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000003'),
  ('11111111-1111-4111-8111-000000000012', '11111111-1111-4111-8111-000000000001',
   'QA Employee 2 (Attendance Only)', 'employee2@qa-attendance-only.test', 'QA-A-2',
   'active', '2026-01-06', '11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000003'),

  ('22222222-2222-4222-8222-000000000011', '22222222-2222-4222-8222-000000000001',
   'QA Employee 1 (Attendance + Payroll)', 'employee1@qa-attendance-payroll.test', 'QA-B-1',
   'active', '2026-01-06', '22222222-2222-4222-8222-000000000002', '22222222-2222-4222-8222-000000000003'),
  ('22222222-2222-4222-8222-000000000012', '22222222-2222-4222-8222-000000000001',
   'QA Employee 2 (Attendance + Payroll)', 'employee2@qa-attendance-payroll.test', 'QA-B-2',
   'active', '2026-01-06', '22222222-2222-4222-8222-000000000002', '22222222-2222-4222-8222-000000000003'),

  ('33333333-3333-4333-8333-000000000011', '33333333-3333-4333-8333-000000000001',
   'QA Employee 1 (Full Suite)', 'employee1@qa-full-suite.test', 'QA-C-1',
   'active', '2026-01-06', '33333333-3333-4333-8333-000000000002', '33333333-3333-4333-8333-000000000003'),
  ('33333333-3333-4333-8333-000000000012', '33333333-3333-4333-8333-000000000001',
   'QA Employee 2 (Full Suite)', 'employee2@qa-full-suite.test', 'QA-C-2',
   'active', '2026-01-06', '33333333-3333-4333-8333-000000000002', '33333333-3333-4333-8333-000000000003')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 10. Employee shifts
-- ---------------------------------------------------------------------------
-- Bare ON CONFLICT DO NOTHING: employee_shifts carries a GiST EXCLUDE
-- constraint alongside its unique keys, so the untargeted form (which covers
-- both unique and exclusion violations) is used rather than naming one index.
INSERT INTO public.employee_shifts (id, tenant_id, employee_id, shift_id, effective_from)
VALUES
  ('11111111-1111-4111-8111-000000000021', '11111111-1111-4111-8111-000000000001', '11111111-1111-4111-8111-000000000011', '11111111-1111-4111-8111-000000000004', '2026-01-06'),
  ('11111111-1111-4111-8111-000000000022', '11111111-1111-4111-8111-000000000001', '11111111-1111-4111-8111-000000000012', '11111111-1111-4111-8111-000000000004', '2026-01-06'),

  ('22222222-2222-4222-8222-000000000021', '22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000011', '22222222-2222-4222-8222-000000000004', '2026-01-06'),
  ('22222222-2222-4222-8222-000000000022', '22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000012', '22222222-2222-4222-8222-000000000004', '2026-01-06'),

  ('33333333-3333-4333-8333-000000000021', '33333333-3333-4333-8333-000000000001', '33333333-3333-4333-8333-000000000011', '33333333-3333-4333-8333-000000000004', '2026-01-06'),
  ('33333333-3333-4333-8333-000000000022', '33333333-3333-4333-8333-000000000001', '33333333-3333-4333-8333-000000000012', '33333333-3333-4333-8333-000000000004', '2026-01-06')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. Salary structures — B and C only (A has no payroll module)
-- ---------------------------------------------------------------------------
INSERT INTO public.salary_structures (id, tenant_id, employee_id, effective_from, ctc_annual)
VALUES
  ('22222222-2222-4222-8222-000000000031', '22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000011', '2026-01-06', 600000),
  ('22222222-2222-4222-8222-000000000032', '22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000012', '2026-01-06', 600000),

  ('33333333-3333-4333-8333-000000000031', '33333333-3333-4333-8333-000000000001', '33333333-3333-4333-8333-000000000011', '2026-01-06', 600000),
  ('33333333-3333-4333-8333-000000000032', '33333333-3333-4333-8333-000000000001', '33333333-3333-4333-8333-000000000012', '2026-01-06', 600000)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12. Prove each tenant ended up with EXACTLY its intended enabled-module set
-- ---------------------------------------------------------------------------
-- Uses tenant_has_module_for(), the same function RLS and server-side module
-- gates use, rather than reading tenant_modules.enabled directly — so this
-- checks the product-visible outcome (core-or-enabled), not just the row
-- state. If the seeding trigger's defaults change, a module is added to (or
-- removed from) the catalogue, or a core flag flips unexpectedly, this fails
-- loudly naming the tenant and the exact diff.
DO $check$
DECLARE
  v_all_keys text[];
  v_expected text[];
  v_actual   text[];
  v_missing  text[];
  v_extra    text[];
  rec        record;
BEGIN
  SELECT array_agg(key ORDER BY key) INTO v_all_keys FROM public.modules;

  FOR rec IN
    SELECT * FROM (VALUES
      ('11111111-1111-4111-8111-000000000001'::uuid, 'QA Attendance Only'::text,    ARRAY['attendance']::text[]),
      ('22222222-2222-4222-8222-000000000001'::uuid, 'QA Attendance Payroll'::text, ARRAY['attendance', 'leave', 'payroll']::text[])
    ) AS t(tenant_id, label, extra_enabled)
  LOOP
    SELECT array_agg(DISTINCT u.k ORDER BY u.k)
      INTO v_expected
    FROM unnest(
      (SELECT array_agg(key) FROM public.modules WHERE is_core) || rec.extra_enabled
    ) AS u(k);

    SELECT array_agg(m.key ORDER BY m.key)
      INTO v_actual
    FROM public.modules m
    WHERE public.tenant_has_module_for(rec.tenant_id, m.key);

    v_missing := ARRAY(SELECT unnest(v_expected) EXCEPT SELECT unnest(COALESCE(v_actual, ARRAY[]::text[])));
    v_extra   := ARRAY(SELECT unnest(COALESCE(v_actual, ARRAY[]::text[])) EXCEPT SELECT unnest(v_expected));

    IF array_length(v_missing, 1) IS NOT NULL OR array_length(v_extra, 1) IS NOT NULL THEN
      RAISE EXCEPTION 'tenant % (%) module mix wrong: expected=% actual=% missing=% extra=%',
        rec.label, rec.tenant_id, v_expected, v_actual, v_missing, v_extra;
    END IF;
  END LOOP;

  -- Tenant C: full suite, every catalogue module must be enabled.
  SELECT array_agg(m.key ORDER BY m.key)
    INTO v_actual
  FROM public.modules m
  WHERE public.tenant_has_module_for('33333333-3333-4333-8333-000000000001'::uuid, m.key);

  v_missing := ARRAY(SELECT unnest(v_all_keys) EXCEPT SELECT unnest(COALESCE(v_actual, ARRAY[]::text[])));

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'tenant QA Full Suite module mix wrong: expected=% actual=% missing=%',
      v_all_keys, v_actual, v_missing;
  END IF;

  RAISE NOTICE 'QA module-mix fixtures verified: A=attendance-only, B=attendance+leave+payroll, C=full-suite (% catalogue modules)', array_length(v_all_keys, 1);
END
$check$;
