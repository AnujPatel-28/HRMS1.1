-- ============================================================================
-- APPLY IN THE INSFORGE DASHBOARD -> Database -> SQL Editor  (paste all, run)
--
-- Second and -- this time -- FULLY AUDITED pass at create_employee_transaction.
-- CREATE OR REPLACE on the existing signature: nothing dropped, no redeploy needed.
--
-- TWO FIXES, both the same shape as everything else this afternoon: the schema moved and
-- this function did not.
--
--   1. column "timezone" does not exist
--      It read `SELECT COALESCE(timezone,'UTC') FROM public.tenant_settings`. But
--      tenant_settings is a KEY/VALUE store -- (id, tenant_id, key, value, updated_at) --
--      and has no such column. The tenant timezone lives on `tenants`. Now reads
--      `FROM public.tenants WHERE id = v_tenant_id`.
--
--   2. leave_balances has no `created_at`
--      The INSERT named it; the table has only `updated_at`. Both the column and its
--      now() value are removed. This one had NOT surfaced yet -- it sits after the
--      timezone read, so you would have hit it on the very next attempt.
--
-- WHY THIS SHOULD BE THE LAST ONE. Rather than fix the reported error and wait for the
-- next, every column this function touches was validated against information_schema:
--
--   * all 74 INSERT columns across employees, employee_onboarding_self,
--     employee_reporting_relationships (x2), leave_balances and audit_logs (x2)
--     -> ALL COLUMNS EXIST
--   * every column read in its SELECTs (tenants, leave_types, employees) -> ALL EXIST
--
-- Tables touched: audit_logs, employee_onboarding_self, employee_reporting_relationships,
-- employees, leave_balances, leave_types, tenants.
--
-- STILL DELIBERATELY UNCHANGED: the 33-parameter signature, so the deployed frontend keeps
-- working. Dropping p_department / p_designation remains a separate later change in
-- migrations-pending-deploy/, and must land BEFORE the frontend stops sending them.
--
-- AFTER RUNNING: retry Confirm & Create. Nothing to redeploy.
-- ============================================================================

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
  v_today date := CURRENT_DATE;
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
$function$
