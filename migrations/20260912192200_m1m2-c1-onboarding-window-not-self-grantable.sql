-- C1 lead forward fix (2026-09-22), authorized by the lead after reviewing 192100.
--
-- Defect 1: 192100 treats the onboarding window as OPEN whenever no COMPLETED
-- employee_onboarding_self row exists -- including when there is no row at all. Measured on
-- TB-M1M2: 15 of 17 active employees with a login have no row, so they could still self-edit
-- bank (account_number, ifsc_code, bank_name), pan_number, aadhaar_number, date_of_birth and
-- gender indefinitely -- undoing the user's contact-only decision for ~88% of employees.
-- (The C1 test had to insert a completed row for employee.a to make its D1 regression pass.)
-- Fix: the window is open only when a row EXISTS with completed_at IS NULL. No row = onboarded
-- by HR or legacy = closed. EmployeeLayout.tsx already shows the onboarding banner only when a
-- row exists and is incomplete, so this matches the product.
--
-- Defect 2: the window was self-grantable. Policy onboarding_self_employee is PERMISSIVE ALL on
-- the employee's own row, so an employee could DELETE a completed row, INSERT a fresh one, or
-- set completed_at back to NULL, reopening the window. Fix: employees may SELECT and UPDATE
-- their own row only; no INSERT/DELETE (new-hire rows are created by the definer
-- create_employee_transaction); and a trigger forbids a non-HR caller from clearing or
-- changing completed_at once set, or moving the row to another employee/tenant.

-- 1. enforce_employee_update_restrictions: body derived from pg_get_functiondef() on the live
--    function as applied by 192100; only the v_onboarding_open predicate changes.
CREATE OR REPLACE FUNCTION public.enforce_employee_update_restrictions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  -- D1: contact-only self-edit allowlist, exact list from the 2026-09-22 product decision.
  v_allowed CONSTANT text[] := ARRAY[
    'phone','address','city','state','pincode',
    'emergency_contact_name','emergency_contact_phone','emergency_contact_relation',
    'employee_bio','linkedin_url','profile_photo_url','blood_group'
  ];
  -- D2: the full set OnboardingWizard.tsx writes during self-onboarding (personal, bank,
  -- documents steps). HR-only again once onboarding is complete.
  v_onboarding_only CONSTANT text[] := ARRAY[
    'aadhaar_number','pan_number','date_of_birth','gender',
    'bank_name','account_number','ifsc_code'
  ];
  v_onboarding_open boolean;
  v_key text;
BEGIN
  -- If there is no authenticated user (e.g. system/postgres session), allow the update
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- If actor is HR, allow the update to proceed
  IF public.is_hr() THEN
    RETURN NEW;
  END IF;

  -- Otherwise, verify that the employee is only updating their own row
  IF OLD.user_id IS DISTINCT FROM auth.uid() OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: employees can only update their own profile';
  END IF;

  -- D2: onboarding is in progress only while a self-onboarding row EXISTS and is incomplete.
  v_onboarding_open := EXISTS (
    SELECT 1 FROM public.employee_onboarding_self eos
    WHERE eos.employee_id = OLD.id AND eos.tenant_id = OLD.tenant_id AND eos.completed_at IS NULL
  );

  -- D1 allowlist: every changed column must be in v_allowed, or in v_onboarding_only while
  -- onboarding is still open. Everything else is HR-only.
  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    CONTINUE WHEN v_key = ANY(v_allowed);
    CONTINUE WHEN v_key = ANY(v_onboarding_only) AND v_onboarding_open;
    IF v_old->v_key IS DISTINCT FROM v_new->v_key THEN
      RAISE EXCEPTION 'Forbidden: employees cannot modify administrative profile field "%"', v_key;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- 2. employee_onboarding_self: employees read and update their own row; no insert/delete.
DROP POLICY onboarding_self_employee ON public.employee_onboarding_self;
CREATE POLICY onboarding_self_employee_select ON public.employee_onboarding_self FOR SELECT TO authenticated
  USING (employee_id = public.get_my_employee_id() AND tenant_id = public.get_auth_tenant_id());
CREATE POLICY onboarding_self_employee_update ON public.employee_onboarding_self FOR UPDATE TO authenticated
  USING (employee_id = public.get_my_employee_id() AND tenant_id = public.get_auth_tenant_id())
  WITH CHECK (employee_id = public.get_my_employee_id() AND tenant_id = public.get_auth_tenant_id());
REVOKE INSERT, DELETE ON public.employee_onboarding_self FROM anon, authenticated;

-- 3. Once completed, only HR (or a system session) may change completed_at.
CREATE FUNCTION public.guard_onboarding_self_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_hr() THEN
    RETURN NEW;
  END IF;
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Forbidden: onboarding progress cannot be moved to another employee';
  END IF;
  IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    RAISE EXCEPTION 'Forbidden: completed onboarding can only be reopened by HR';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_onboarding_self_completion() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_onboarding_self_completion BEFORE UPDATE ON public.employee_onboarding_self
  FOR EACH ROW EXECUTE FUNCTION public.guard_onboarding_self_completion();

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['enforce_employee_update_restrictions','guard_onboarding_self_completion'] LOOP
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = fn) <> 1 THEN
      RAISE EXCEPTION 'C1 lead fix overload invariant failed: %', fn;
    END IF;
  END LOOP;
END $$;
