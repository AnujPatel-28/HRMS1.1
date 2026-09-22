-- migration: C2 -- business date everywhere (server-UTC CURRENT_DATE removal)
-- Source: prompts/c2_c6_cleanup_packages_2026-09-22.md, C2 section.
--
-- Measured 2026-09-22: `prosrc ILIKE '%current_date%'` on this database matches 11 functions.
-- Two are comment-only (`punch_in_attendance`, `update_employee_reporting_relationship`) and are
-- left untouched. Of the 9 real uses, 7 are fixed here by routing through the shared P2-01
-- primitive `public.tenant_business_date(tenant_id, timestamptz)` instead of the server's UTC
-- CURRENT_DATE, which is still "yesterday" in IST until 05:30. Two are deliberately left as
-- server-UTC and are documented below rather than changed.
--
-- Every function CREATE OR REPLACE below is the exact live `pg_get_functiondef()` output for that
-- name, with only the CURRENT_DATE expressions (and the minimum surrounding restructuring needed
-- to make the tenant available before it is used) changed. Signatures, LANGUAGE, SECURITY and
-- search_path attributes are unchanged from the live database.
--
-- Left unchanged (reported, not fixed):
--   * `fn_check_insurance_expiries` -- insurance is an excluded product for this cleanup pass.
--   * `attendance_reconcile_missing_selfies` -- a lookback WINDOW (`date >= current_date -
--     p_lookback_days`); being a day off either way only widens or narrows the scan window by one
--     day and cannot produce a wrong-day result, per the brief ("harmless").
--
-- No BEGIN/COMMIT here: the CLI wraps each migration in its own transaction.

-- ── 1. employee_apply_leave_request -- minimum notice + days-since-joining eligibility ────────
CREATE OR REPLACE FUNCTION public.employee_apply_leave_request(p_tenant_id uuid, p_leave_type_id uuid, p_start_date date, p_end_date date, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_employee employees%ROWTYPE;
  v_leave_type leave_types%ROWTYPE;
  v_global_notice_days integer := 0;
  v_working_days integer[];
  v_date date;
  v_total_days integer := 0;
  v_balance numeric;
  v_effective_notice integer;
  v_notice_given integer;
  v_notice_days_reason text;
  v_days_since_joining integer;
  v_leave_id uuid;
  v_leave_type_enum text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  IF NOT can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied';
  END IF;

  IF NOT tenant_has_module_for(p_tenant_id, 'leave') THEN
    RAISE EXCEPTION 'MODULE_DISABLED' USING ERRCODE = 'P0007';
  END IF;

  SELECT * INTO v_employee
  FROM employees
  WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  SELECT * INTO v_leave_type
  FROM leave_types
  WHERE tenant_id = p_tenant_id
    AND id = p_leave_type_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave type not found';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  SELECT COALESCE(NULLIF(value, '')::integer, 0)
  INTO v_global_notice_days
  FROM tenant_settings
  WHERE tenant_id = p_tenant_id
    AND key = 'leave_min_notice_days';
  v_global_notice_days := COALESCE(v_global_notice_days, 0);

  v_effective_notice := GREATEST(COALESCE(v_global_notice_days, 0), COALESCE(v_leave_type.min_notice_days, 0));
  -- C2: tenant business date, not server/UTC CURRENT_DATE (P2-01 shared primitive).
  v_notice_given := p_start_date - tenant_business_date(p_tenant_id, now());
  IF v_notice_given < v_effective_notice THEN
    RAISE EXCEPTION 'This leave requires at least % days notice', v_effective_notice;
  END IF;

  IF COALESCE(v_leave_type.applicable_from_day, 0) > 0 AND v_employee.date_of_joining IS NOT NULL THEN
    -- C2: tenant business date, not server/UTC CURRENT_DATE (P2-01 shared primitive).
    v_days_since_joining := tenant_business_date(p_tenant_id, now()) - v_employee.date_of_joining;
    IF v_days_since_joining < v_leave_type.applicable_from_day THEN
      RAISE EXCEPTION '% is only available after % days of employment', v_leave_type.name, v_leave_type.applicable_from_day;
    END IF;
  END IF;

  v_date := p_start_date;
  WHILE v_date <= p_end_date LOOP
    SELECT s.working_days INTO v_working_days
    FROM employee_shifts es
    JOIN shifts s ON s.id = es.shift_id
    WHERE es.tenant_id = p_tenant_id
      AND es.employee_id = v_employee.id
      AND es.effective_from <= v_date
      AND (es.effective_to IS NULL OR es.effective_to >= v_date)
    ORDER BY es.effective_from DESC
    LIMIT 1;

    IF v_working_days IS NULL THEN
      SELECT working_days INTO v_working_days
      FROM shifts
      WHERE tenant_id = p_tenant_id
        AND is_default = true
        AND is_active IS NOT FALSE
      LIMIT 1;
    END IF;
    v_working_days := COALESCE(v_working_days, ARRAY[1,2,3,4,5,6]);

    IF EXTRACT(DOW FROM v_date)::integer = ANY(v_working_days)
      AND NOT COALESCE((SELECT h.is_holiday FROM work_calendar_holiday(p_tenant_id, v_employee.id, v_date) h), false) THEN
      v_total_days := v_total_days + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  IF v_total_days = 0 THEN
    RAISE EXCEPTION 'The selected date range contains no working days';
  END IF;

  IF v_leave_type.max_consecutive_days IS NOT NULL AND v_total_days > v_leave_type.max_consecutive_days THEN
    RAISE EXCEPTION '% allows a maximum of % working days per request', v_leave_type.name, v_leave_type.max_consecutive_days;
  END IF;

  SELECT balance INTO v_balance
  FROM leave_balances
  WHERE tenant_id = p_tenant_id
    AND employee_id = v_employee.id
    AND leave_type_id = p_leave_type_id
    AND year = EXTRACT(YEAR FROM p_start_date)
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Leave balance not found';
  END IF;

  IF v_total_days > v_balance THEN
    RAISE EXCEPTION 'Insufficient balance. Available: %, requested: %', v_balance, v_total_days;
  END IF;

  IF EXISTS (
    SELECT 1 FROM leaves
    WHERE tenant_id = p_tenant_id
      AND employee_id = v_employee.id
      AND status IN ('pending', 'approved')
      AND start_date <= p_end_date
      AND end_date >= p_start_date
  ) THEN
    RAISE EXCEPTION 'An existing pending or approved leave overlaps these dates';
  END IF;

  v_leave_type_enum := CASE upper(v_leave_type.code)
    WHEN 'CL' THEN 'casual'
    WHEN 'SL' THEN 'sick'
    WHEN 'EL' THEN 'earned'
    WHEN 'UL' THEN 'unpaid'
    WHEN 'ML' THEN 'maternity'
    WHEN 'PL' THEN 'paternity'
    ELSE 'other'
  END;

  INSERT INTO leaves (
    tenant_id, employee_id, leave_type_id, leave_type, start_date,
    end_date, total_days, reason, status
  )
  VALUES (
    p_tenant_id, v_employee.id, p_leave_type_id, v_leave_type_enum,
    p_start_date, p_end_date, v_total_days, trim(p_reason), 'pending'
  )
  RETURNING id INTO v_leave_id;

  BEGIN
    INSERT INTO notifications (tenant_id, employee_id, title, body, type, reference_id)
    SELECT p_tenant_id, e.id, 'New Leave Request',
           v_employee.full_name || ' has requested ' || v_leave_type.name || ' from ' || p_start_date || ' to ' || p_end_date || '.',
           'general', v_leave_id
    FROM employees e
    WHERE e.tenant_id = p_tenant_id
      AND public.employee_is_hr(e.id)
      AND e.status = 'active';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_leave_id;
END;
$function$;

-- ── 2. hr_schedule_shift_change -- default "tomorrow" + future-effective guard ─────────────────
CREATE OR REPLACE FUNCTION public.hr_schedule_shift_change(p_tenant_id uuid, p_employee_id uuid, p_shift_id uuid, p_effective_from date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  -- C2: tenant business date, not server/UTC CURRENT_DATE (P2-01 shared primitive).
  v_effective_from date := COALESCE(p_effective_from, tenant_business_date(p_tenant_id, now()) + 1);
  v_effective_to date;
  v_assignment_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);
  v_effective_to := v_effective_from - 1;

  -- C2: tenant business date, not server/UTC CURRENT_DATE (P2-01 shared primitive).
  IF v_effective_from <= tenant_business_date(p_tenant_id, now()) THEN
    RAISE EXCEPTION 'Shift changes must be effective in the future';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = p_employee_id
      AND tenant_id = p_tenant_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Employee not found or inactive';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM shifts
    WHERE id = p_shift_id
      AND tenant_id = p_tenant_id
      AND is_active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'Shift not found or inactive';
  END IF;

  PERFORM 1
  FROM employee_shifts
  WHERE tenant_id = p_tenant_id
    AND employee_id = p_employee_id
    AND effective_from <= v_effective_to
    AND (effective_to IS NULL OR effective_to >= v_effective_to)
  FOR UPDATE;

  UPDATE employee_shifts
  SET effective_to = v_effective_to
  WHERE tenant_id = p_tenant_id
    AND employee_id = p_employee_id
    AND effective_from <= v_effective_to
    AND (effective_to IS NULL OR effective_to >= v_effective_to);

  DELETE FROM employee_shifts
  WHERE tenant_id = p_tenant_id
    AND employee_id = p_employee_id
    AND effective_from = v_effective_from;

  INSERT INTO employee_shifts (tenant_id, employee_id, shift_id, effective_from)
  VALUES (p_tenant_id, p_employee_id, p_shift_id, v_effective_from)
  RETURNING id INTO v_assignment_id;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'shift.assignment', 'employee_shifts', v_assignment_id,
    jsonb_build_object('employee_id', p_employee_id, 'shift_id', p_shift_id, 'effective_from', v_effective_from, 'correlation_id', v_correlation_id)
  );

  RETURN v_assignment_id;
END;
$function$;

-- ── 3. create_employee_transaction -- v_today used as fallback effective_from for the initial ──
--       primary/secondary reporting relationship rows. v_tenant_id is not known until after the
--       auth/tenant-context checks run, so the assignment moves from the DECLARE default (which
--       would evaluate against NULL) to right after v_tenant_id is resolved. No other statement
--       changed.
CREATE OR REPLACE FUNCTION public.create_employee_transaction(p_user_id uuid, p_full_name text, p_email text, p_phone text, p_date_of_birth date, p_gender text, p_address text, p_city text, p_state text, p_pincode text, p_department text, p_org_unit_id uuid, p_designation text, p_job_title_id uuid, p_employee_code text, p_date_of_joining date, p_employment_type text, p_employment_type_id uuid, p_aadhaar_number text, p_pan_number text, p_bank_name text, p_account_number text, p_ifsc_code text, p_emergency_contact_name text, p_emergency_contact_phone text, p_emergency_contact_relation text, p_work_mode text, p_grade text, p_work_location text, p_location_id uuid, p_manager_id uuid, p_secondary_manager_id uuid, p_probation_period integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_new_id uuid;
  v_tenant_id uuid;
  v_actor_employee_id uuid;
  v_today date;
  v_calculated_probation_end_date date := NULL;
  v_probation_status text := 'not_applicable';
  v_tz text;
  v_tenant_now timestamp;
  v_target_year integer;
  v_current_year integer;
  v_elapsed_months integer;
  v_lt RECORD;
  v_initial_balance numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'Forbidden: only HR can create employees';
  END IF;

  v_tenant_id := public.get_auth_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid tenant context';
  END IF;

  -- C2: tenant business date, not server/UTC CURRENT_DATE (P2-01 shared primitive). Moved here
  -- (was the DECLARE default) because it needs v_tenant_id, resolved just above.
  v_today := public.tenant_business_date(v_tenant_id, now());

  SELECT id
  INTO v_actor_employee_id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND tenant_id = v_tenant_id
  LIMIT 1;

  IF EXISTS (
    SELECT 1
    FROM public.employees
    WHERE tenant_id = v_tenant_id
      AND lower(email) = lower(trim(p_email))
  ) THEN
    RAISE EXCEPTION 'Email % is already registered in the system', trim(p_email);
  END IF;

  IF p_employee_code IS NOT NULL AND trim(p_employee_code) <> '' THEN
    IF EXISTS (
      SELECT 1
      FROM public.employees
      WHERE tenant_id = v_tenant_id
        AND lower(employee_code) = lower(trim(p_employee_code))
    ) THEN
      RAISE EXCEPTION 'Employee Code % is already in use', trim(p_employee_code);
    END IF;
  END IF;

  IF p_manager_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_manager_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Primary manager must belong to the same tenant';
    END IF;
  END IF;

  IF p_secondary_manager_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_secondary_manager_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Secondary manager must belong to the same tenant';
    END IF;
  END IF;

  IF p_manager_id IS NOT NULL AND p_secondary_manager_id IS NOT NULL AND p_manager_id = p_secondary_manager_id THEN
    RAISE EXCEPTION 'Primary and secondary managers cannot be the same person';
  END IF;

  IF p_probation_period IS NOT NULL AND p_probation_period > 0 THEN
    v_probation_status := 'on_probation';
    IF p_date_of_joining IS NOT NULL THEN
      v_calculated_probation_end_date := p_date_of_joining + p_probation_period;
    END IF;
  END IF;

  INSERT INTO public.employees (
    user_id,
    tenant_id,
    full_name,
    email,
    phone,
    date_of_birth,
    gender,
    address,
    city,
    state,
    pincode,
    org_unit_id,
    job_title_id,
    employee_code,
    date_of_joining,
    employment_type,
    employment_type_id,
    aadhaar_number,
    pan_number,
    bank_name,
    account_number,
    ifsc_code,
    emergency_contact_name,
    emergency_contact_phone,
    emergency_contact_relation,
    status,
    work_mode,
    grade,
    work_location,
    location_id,
    manager_id,
    secondary_manager_id,
    probation_status,
    probation_end_date,
    created_at,
    updated_at
  )
  VALUES (
    p_user_id,
    v_tenant_id,
    trim(p_full_name),
    lower(trim(p_email)),
    trim(p_phone),
    p_date_of_birth,
    p_gender,
    trim(p_address),
    trim(p_city),
    trim(p_state),
    trim(p_pincode),
    p_org_unit_id,
    p_job_title_id,
    trim(p_employee_code),
    p_date_of_joining,
    p_employment_type,
    p_employment_type_id,
    trim(p_aadhaar_number),
    trim(p_pan_number),
    trim(p_bank_name),
    trim(p_account_number),
    trim(p_ifsc_code),
    trim(p_emergency_contact_name),
    trim(p_emergency_contact_phone),
    trim(p_emergency_contact_relation),
    'active',
    p_work_mode,
    trim(p_grade),
    p_work_location,
    p_location_id,
    p_manager_id,
    p_secondary_manager_id,
    v_probation_status,
    v_calculated_probation_end_date,
    now(),
    now()
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.employee_onboarding_self (
    tenant_id,
    employee_id,
    created_at,
    updated_at
  )
  VALUES (
    v_tenant_id,
    v_new_id,
    now(),
    now()
  );

  IF p_manager_id IS NOT NULL THEN
    INSERT INTO public.employee_reporting_relationships (
      tenant_id,
      employee_id,
      manager_id,
      relationship_type,
      effective_from,
      is_active,
      created_at,
      updated_at
    )
    VALUES (
      v_tenant_id,
      v_new_id,
      p_manager_id,
      'primary',
      COALESCE(p_date_of_joining, v_today),
      true,
      now(),
      now()
    );
  END IF;

  IF p_secondary_manager_id IS NOT NULL THEN
    INSERT INTO public.employee_reporting_relationships (
      tenant_id,
      employee_id,
      manager_id,
      relationship_type,
      effective_from,
      is_active,
      created_at,
      updated_at
    )
    VALUES (
      v_tenant_id,
      v_new_id,
      p_secondary_manager_id,
      'secondary',
      COALESCE(p_date_of_joining, v_today),
      true,
      now(),
      now()
    );
  END IF;

  -- `tenant_settings` is a KEY/VALUE store (id, tenant_id, key, value, updated_at) and has no
  -- `timezone` column; the tenant timezone lives on `tenants`. Reading the wrong table failed
  -- with: column "timezone" does not exist.
  SELECT COALESCE(timezone, 'UTC')
  INTO v_tz
  FROM public.tenants
  WHERE id = v_tenant_id;

  IF NOT FOUND THEN
    v_tz := 'UTC';
  END IF;

  v_tenant_now := timezone(v_tz, now());
  v_target_year := date_part('year', v_tenant_now)::integer;
  v_current_year := date_part('year', now())::integer;
  v_elapsed_months := date_part('month', now())::integer;

  FOR v_lt IN
    SELECT id, days_per_year, accrual_type
    FROM public.leave_types
    WHERE tenant_id = v_tenant_id
      AND is_active = true
  LOOP
    v_initial_balance := v_lt.days_per_year;

    IF v_lt.accrual_type = 'monthly' THEN
      IF v_target_year = v_current_year THEN
        v_initial_balance := round(((v_lt.days_per_year::numeric / 12.0) * v_elapsed_months::numeric), 2);
      ELSIF v_target_year > v_current_year THEN
        v_initial_balance := 0;
      END IF;
    END IF;

    INSERT INTO public.leave_balances (
      tenant_id,
      employee_id,
      leave_type_id,
      year,
      total_allocated,
      used_days,
      carried_forward,
      balance,
      -- no `created_at` on leave_balances -- the table has only `updated_at`
      updated_at
    )
    VALUES (
      v_tenant_id,
      v_new_id,
      v_lt.id,
      v_target_year,
      v_lt.days_per_year,
      0,
      0,
      v_initial_balance,
      now()
    )
    ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
    DO NOTHING;
  END LOOP;

  INSERT INTO public.audit_logs (
    tenant_id, actor_id, actor_role, action, target_type, target_id, details, status
  )
  VALUES (
    v_tenant_id,
    v_actor_employee_id,
    'hr',
    'employee.created',
    'employees',
    v_new_id,
    jsonb_build_object('full_name', p_full_name, 'email', p_email),
    'success'
  );

  IF p_manager_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      tenant_id, actor_id, actor_role, action, target_type, target_id, details, status
    )
    VALUES (
      v_tenant_id,
      v_actor_employee_id,
      'hr',
      'employee.manager_changed',
      'employees',
      v_new_id,
      jsonb_build_object(
        'from', NULL,
        'to', p_manager_id,
        'relationship_type', 'primary'
      ),
      'success'
    );
  END IF;

  RETURN v_new_id;
END;
$function$;

-- ── 4. open_initial_unit_assignment (trigger on employees, AFTER INSERT OR UPDATE OF org_unit_id) ─
--       NEW.tenant_id is set (employees.tenant_id is NOT NULL) by the time this fires.
CREATE OR REPLACE FUNCTION public.open_initial_unit_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.org_unit_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only ever OPENS a first assignment. It never closes or rewrites one, so it cannot fabricate a
  -- transfer: a genuine move still has to go through the transfer flow and be refused by the guard
  -- above if it does not.
  IF EXISTS (
    SELECT 1 FROM public.employee_unit_assignments a
    WHERE a.employee_id = NEW.id AND a.effective_to IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.employee_unit_assignments
    (tenant_id, employee_id, org_unit_id, effective_from, reason)
  VALUES
    (NEW.tenant_id, NEW.id, NEW.org_unit_id,
     -- date_of_joining is the truthful start of membership when it is known and not in the future;
     -- the trigger keys on `effective_to IS NULL`, not on the date, so a future date would still take
     -- effect immediately and misreport history. C2: tenant business date otherwise, not
     -- server/UTC CURRENT_DATE (P2-01 shared primitive).
     LEAST(COALESCE(NEW.date_of_joining, public.tenant_business_date(NEW.tenant_id, now())), public.tenant_business_date(NEW.tenant_id, now())),
     CASE WHEN TG_OP = 'INSERT' THEN 'hire' ELSE 'initial' END);

  RETURN NEW;
END;
$function$;

-- ── 5. attendance_evaluate_location -- fallback when the caller passes no p_business_date ──────
CREATE OR REPLACE FUNCTION public.attendance_evaluate_location(p_tenant_id uuid, p_employee_id uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_business_date date)
 RETURNS TABLE(allowed boolean, loc_status text, confidence text, matched_location_id uuid, distance_meters numeric, remote_exception_id uuid, block_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_geofence_enabled  boolean;
  v_gps_mode          text;
  v_remote_handling   text;
  v_high              numeric;
  v_medium            numeric;
  v_low               numeric;
  v_work_mode         text;
  v_exception_id      uuid;
  v_geofence_required boolean := true;
  v_confidence        text;
  v_branch_count      integer;
  v_match             record;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'attendance_evaluate_location: p_tenant_id is required';
  END IF;

  -- ── settings, with the same defaults PunchInOut.tsx used ──────────────────────────────────
  SELECT lower(coalesce(nullif(value, ''), 'false')) = 'true' INTO v_geofence_enabled
    FROM tenant_settings WHERE tenant_id = p_tenant_id AND key = 'geofence_enabled';
  v_geofence_enabled := coalesce(v_geofence_enabled, false);

  SELECT nullif(value, '') INTO v_gps_mode
    FROM tenant_settings WHERE tenant_id = p_tenant_id AND key = 'gps_verification_mode';
  v_gps_mode := coalesce(v_gps_mode, 'warn');

  SELECT nullif(value, '') INTO v_remote_handling
    FROM tenant_settings WHERE tenant_id = p_tenant_id AND key = 'remote_work_handling';
  v_remote_handling := coalesce(v_remote_handling, 'hr_approved_exceptions');

  SELECT nullif(value, '')::numeric INTO v_high
    FROM tenant_settings WHERE tenant_id = p_tenant_id AND key = 'high_confidence_max';
  SELECT nullif(value, '')::numeric INTO v_medium
    FROM tenant_settings WHERE tenant_id = p_tenant_id AND key = 'medium_confidence_max';
  SELECT nullif(value, '')::numeric INTO v_low
    FROM tenant_settings WHERE tenant_id = p_tenant_id AND key = 'low_confidence_max';
  v_high   := coalesce(v_high, 50);
  v_medium := coalesce(v_medium, 150);
  v_low    := coalesce(v_low, 300);

  -- ── confidence band from GPS accuracy (mirrors the client) ────────────────────────────────
  IF p_accuracy IS NULL THEN
    v_confidence := NULL;
  ELSIF p_accuracy <= v_high   THEN v_confidence := 'high';
  ELSIF p_accuracy <= v_medium THEN v_confidence := 'medium';
  ELSIF p_accuracy <= v_low    THEN v_confidence := 'low';
  ELSE                              v_confidence := 'very_low';
  END IF;

  -- ── is a fence required for THIS employee today? ──────────────────────────────────────────
  IF NOT v_geofence_enabled THEN
    v_geofence_required := false;
  ELSIF v_remote_handling = 'always_allowed' THEN
    v_geofence_required := false;
  ELSIF v_remote_handling = 'hr_approved_exceptions' THEN
    SELECT e.work_mode INTO v_work_mode FROM employees e WHERE e.id = p_employee_id;
    IF coalesce(v_work_mode, 'office') = 'remote' THEN
      v_geofence_required := false;
    ELSE
      -- C2: tenant business date fallback, not server/UTC CURRENT_DATE (P2-01 shared primitive).
      SELECT x.id INTO v_exception_id
      FROM attendance_location_exceptions x
      WHERE x.tenant_id = p_tenant_id
        AND x.employee_id = p_employee_id
        AND x.status = 'approved'
        AND x.start_date <= coalesce(p_business_date, tenant_business_date(p_tenant_id, now()))
        AND x.end_date   >= coalesce(p_business_date, tenant_business_date(p_tenant_id, now()))
      LIMIT 1;
      IF v_exception_id IS NOT NULL THEN
        v_geofence_required := false;
      END IF;
    END IF;
  END IF;

  IF NOT v_geofence_required THEN
    RETURN QUERY SELECT true,
      CASE WHEN v_exception_id IS NOT NULL OR coalesce(v_work_mode, 'office') = 'remote'
             OR v_remote_handling = 'always_allowed'
           THEN 'remote_approved'::text ELSE 'office_verified'::text END,
      v_confidence, NULL::uuid, NULL::numeric, v_exception_id, NULL::text;
    RETURN;
  END IF;

  IF v_gps_mode = 'disabled' THEN
    RETURN QUERY SELECT true, 'office_verified'::text, v_confidence, NULL::uuid, NULL::numeric, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- ── no coordinates supplied ───────────────────────────────────────────────────────────────
  IF p_lat IS NULL OR p_lng IS NULL THEN
    IF v_gps_mode = 'strict' THEN
      RETURN QUERY SELECT false, 'gps_unavailable'::text, v_confidence, NULL::uuid, NULL::numeric, NULL::uuid,
        'Location is required in strict mode but no coordinates were supplied.'::text;
    ELSE
      RETURN QUERY SELECT true, 'gps_unavailable'::text, v_confidence, NULL::uuid, NULL::numeric, NULL::uuid, NULL::text;
    END IF;
    RETURN;
  END IF;

  -- ── fail open when the fence is enabled but no branch is configured ───────────────────────
  SELECT count(*) INTO v_branch_count
  FROM office_locations o WHERE o.tenant_id = p_tenant_id AND o.is_active;

  IF v_branch_count = 0 THEN
    RETURN QUERY SELECT true, 'gps_unavailable'::text, v_confidence, NULL::uuid, NULL::numeric, NULL::uuid,
      'Geofence is enabled but no active office location is configured.'::text;
    RETURN;
  END IF;

  -- ── nearest branch by its OWN radius, Haversine on a 6371km sphere ────────────────────────
  SELECT o.id, d.dist, (d.dist - o.radius_meters) AS slack
    INTO v_match
  FROM office_locations o
  CROSS JOIN LATERAL (
    SELECT 2 * 6371000 * asin(sqrt(
             power(sin(radians(o.lat::double precision - p_lat::double precision) / 2), 2)
           + cos(radians(p_lat::double precision)) * cos(radians(o.lat::double precision))
           * power(sin(radians(o.lng::double precision - p_lng::double precision) / 2), 2)
           ))::numeric AS dist
  ) d
  WHERE o.tenant_id = p_tenant_id AND o.is_active
  -- Prefer a branch you are actually INSIDE, and among those the NEAREST one. Ordering purely by
  -- slack (dist - radius) still returns the right allow/deny verdict, but it names the branch with
  -- the most spare radius as the match -- so an employee standing 11m from a tight-radius HQ was
  -- reported as matched to an annexe 1.1km away, and that value is stored as evidence HR reads.
  -- When outside every branch, fall through to the nearest by distance so the block message
  -- ("Xm outside the nearest office area") matches what it claims to measure.
  ORDER BY ((d.dist - o.radius_meters) <= 0) DESC, d.dist ASC
  LIMIT 1;

  IF v_match.slack <= 0 THEN
    RETURN QUERY SELECT true, 'office_verified'::text, v_confidence, v_match.id, round(v_match.dist, 1), NULL::uuid, NULL::text;
  ELSIF v_gps_mode = 'strict' THEN
    RETURN QUERY SELECT false, 'outside_geofence'::text, v_confidence, NULL::uuid, round(v_match.dist, 1), NULL::uuid,
      format('You are %sm outside the nearest office area.', round(v_match.slack, 0));
  ELSE
    RETURN QUERY SELECT true, 'outside_geofence'::text, v_confidence, NULL::uuid, round(v_match.dist, 1), NULL::uuid, NULL::text;
  END IF;
END;
$function$;

-- ── 6. expire_location_exceptions -- cross-tenant batch job; per-row tenant business date ──────
--       No SET search_path on this function live; left as-is per the hard rule to keep
--       SECURITY/search_path attributes exactly as they are live. The function already fully
--       qualifies every table it touches, so the new call is fully qualified too.
CREATE OR REPLACE FUNCTION public.expire_location_exceptions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    UPDATE public.attendance_location_exceptions
    SET status = 'expired',
        updated_at = now()
    WHERE status = 'approved' AND end_date < public.tenant_business_date(tenant_id, now())
    RETURNING id, tenant_id, employee_id
  LOOP
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
    VALUES (v_rec.tenant_id, NULL, 'system', 'attendance.remote_exception_expired', 'attendance_location_exceptions', v_rec.id, jsonb_build_object('employee_id', v_rec.employee_id));
  END LOOP;
END;
$function$;

-- ── 7. fn_accrue_monthly_leaves -- cross-tenant batch job; per-row tenant business date ─────────
--       v_target_year / v_month_start were computed once from server CURRENT_DATE and applied to
--       every tenant, so accrual could fire a day early/late (or drift a whole month) per tenant.
--       Fixed by resolving the tenant's business date per row instead of once globally;
--       v_target_year/v_month_start become unused by this change and are dropped.
CREATE OR REPLACE FUNCTION public.fn_accrue_monthly_leaves()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_rec RECORD;
BEGIN
    FOR v_rec IN
        SELECT lb.id, lt.days_per_year,
               public.tenant_business_date(lb.tenant_id, now()) AS v_business_date
        FROM public.leave_balances lb
        JOIN public.leave_types lt ON lb.leave_type_id = lt.id
        WHERE lt.accrual_type = 'monthly'
          AND lt.is_active = true
          AND lb.year = EXTRACT(YEAR FROM public.tenant_business_date(lb.tenant_id, now()))
          AND (lb.last_accrual_date IS NULL OR lb.last_accrual_date < DATE_TRUNC('month', public.tenant_business_date(lb.tenant_id, now()))::date)
    LOOP
        UPDATE public.leave_balances
        SET balance = balance + (v_rec.days_per_year / 12.0),
            last_accrual_date = v_rec.v_business_date,
            updated_at = NOW()
        WHERE id = v_rec.id;
    END LOOP;
END;
$function$;

-- ── invariant: exactly one pg_proc row per touched name (CREATE OR REPLACE must replace, never ──
--    add an overload; see hrms-column-drop-playbook / P2-01's own migration for why this matters) ─
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'employee_apply_leave_request',
    'hr_schedule_shift_change',
    'create_employee_transaction',
    'open_initial_unit_assignment',
    'attendance_evaluate_location',
    'expire_location_exceptions',
    'fn_accrue_monthly_leaves'
  ] LOOP
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = fn) <> 1 THEN
      RAISE EXCEPTION 'C2 function overload invariant failed: %', fn;
    END IF;
  END LOOP;
END $$;
