-- C1 forward fix (one pre-authorized fix for 20260912192000, per package instructions).
-- Two defects found by re-measurement after the base migration was applied and live-tested:
--
-- 1. D2's premise was wrong. `employees.status` is NEVER 'pending_onboarding' while
--    OnboardingWizard.tsx is reachable: AuthContext.tsx blocks sign-in outright for
--    status IN ('draft','pending_hr_review','pending_onboarding') (both the mid-session guard
--    ~line 218 and the login guard ~line 305-320), and the app never routes to
--    /employee/onboarding based on `employees.status` at all -- EmployeeLayout.tsx ~376-388
--    gates the "Complete Onboarding" banner/route purely on
--    `employee_onboarding_self.completed_at IS NULL`. So an employee who can reach the wizard
--    is already 'active' (or 'inactive'), and the OLD.status = 'pending_onboarding' carve-out
--    in 20260912192000 never fires -- it silently broke the exact path D2 said must keep
--    working. The correct gate is completed_at, not employees.status.
--
-- 2. The same measurement pass also found OnboardingWizard.tsx writes MORE than
--    aadhaar_number/pan_number during the self-onboarding window: savePersonal() (~line 139)
--    also sends date_of_birth + gender, and saveBank() (~line 177) sends bank_name,
--    account_number, ifsc_code. D1 lists all five as HR-only and D2's heading is "Onboarding
--    keeps working" -- for the onboarding window specifically, D2 takes precedence for exactly
--    the columns the wizard actually writes; D1's steady-state allowlist for an
--    already-onboarded employee is unchanged (all seven of these become HR-only again once
--    employee_onboarding_self.completed_at is set, which is the existing acceptance-4 shape).
--
-- Body derived from pg_get_functiondef() on the live TB-M1M2 function as applied by
-- 20260912192000 (fetched immediately before writing this migration); only the carve-out
-- condition and column list change.
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

  -- D2: onboarding is "in progress" exactly when EmployeeLayout.tsx would still show the
  -- "Complete Onboarding" banner -- no employee_onboarding_self row yet, or one exists with
  -- completed_at still null. Once completed_at is set, this is false permanently.
  v_onboarding_open := NOT EXISTS (
    SELECT 1 FROM public.employee_onboarding_self eos
    WHERE eos.employee_id = OLD.id AND eos.tenant_id = OLD.tenant_id AND eos.completed_at IS NOT NULL
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

-- c1_review_new_hire_request: the NOT EXISTS(...FOR UPDATE) probe followed by a separate
-- UPDATE with no status predicate relied on the row lock surviving between the two statements
-- to stay race-free -- correct under the same transaction, but needless to reason about.
-- Collapsed into one UPDATE ... WHERE status='pending' with GET DIAGNOSTICS, so a second
-- concurrent review of the same request fails on row count instead of on lock timing.
-- Signature unchanged; body otherwise identical (pg_get_functiondef() on the live function).
CREATE OR REPLACE FUNCTION public.c1_review_new_hire_request(
  p_request_id uuid,
  p_approved boolean,
  p_reason text DEFAULT NULL::text,
  p_created_employee_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_actor uuid;
  v_status text;
  v_updated integer;
BEGIN
  v_tenant := public.get_auth_tenant_id();
  IF v_tenant IS NULL OR NOT public.is_hr() THEN
    RAISE EXCEPTION 'NEW_HIRE_REQUEST_REVIEW_DENIED' USING ERRCODE = 'P1003';
  END IF;
  v_actor := public.get_my_employee_id();

  IF p_created_employee_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.employees e WHERE e.id = p_created_employee_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'NEW_HIRE_REQUEST_EMPLOYEE_INVALID' USING ERRCODE = 'P1003';
  END IF;

  v_status := CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END;

  UPDATE public.new_hire_requests
    SET status = v_status,
        reviewed_by = v_actor,
        reviewed_at = now(),
        reason = p_reason,
        created_employee_id = CASE WHEN p_approved THEN p_created_employee_id ELSE NULL END,
        updated_at = now()
    WHERE id = p_request_id AND tenant_id = v_tenant AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'NEW_HIRE_REQUEST_NOT_PENDING' USING ERRCODE = 'P1003';
  END IF;

  RETURN jsonb_build_object('success', true, 'status', v_status);
END;
$function$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'enforce_employee_update_restrictions',
    'c1_review_new_hire_request'
  ] LOOP
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = fn) <> 1 THEN
      RAISE EXCEPTION 'C1 forward-fix function overload invariant failed: %', fn;
    END IF;
  END LOOP;
END $$;
