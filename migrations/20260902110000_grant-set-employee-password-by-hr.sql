-- Third and final casualty of the 2026-08-17 hardening pass: `set_employee_password_by_hr` lost
-- EXECUTE and was never re-granted, so the LAST step of employee onboarding fails with
-- "permission denied for function set_employee_password_by_hr".
--
-- ############################################################################
-- Why this surfaced only now
-- ############################################################################
-- The onboarding wizard has three gates in series, and each one hid the next:
--
--   1. check_rate_limit         no EXECUTE  -> "Rate limit exceeded"    (fixed 20260902100000)
--   2. verification email       never sent  -> no OTP could ever arrive (fixed by calling
--                                              /api/auth/email/send-verification explicitly;
--                                              the admin-create path suppresses it)
--   3. set_employee_password_by_hr  no EXECUTE  -> "permission denied"  <- THIS MIGRATION
--
-- Gate 3 was unreachable until gates 1 and 2 were fixed, which is why the earlier QA run could
-- not find it: nobody had ever got far enough to hit it.
--
-- ############################################################################
-- The audit, now complete
-- ############################################################################
-- 20 functions in `public` are un-executable by `authenticated`. Cross-referencing every one
-- against actual call sites in src/ and functions/ gives six that the app calls at all, and only
-- those invoked with the CALLER's token can fail this way:
--
--   attendance_run_scheduled_derivation   ADMIN key   ok
--   device_ingest_punch (adms-cdata)      ADMIN key   ok
--   fn_check_insurance_expiries           ADMIN key   ok
--   get_auth_user_details_by_email        ADMIN key   ok  (finalize-onboarding.ts:110)
--   get_auth_user_details_by_email_v2     ADMIN key   ok  (create-employee-user.ts:48)
--   set_employee_password_by_hr           USER token  BROKEN  (set-employee-password.ts:124)
--
-- The remaining 14 are trigger functions (audit_tenant_changes, notify_*, log_*), internal
-- derivation passes, or deliberately locked (exec_sql, query_json, update_user_password,
-- fn_accrue_monthly_leaves — revoked on purpose in 20260902100000). None should be granted.
--
-- So this is the LAST one. The 2026-08-17 re-grant list is now fully reconciled.
--
-- ############################################################################
-- Why granting this is safe
-- ############################################################################
-- It is SECURITY DEFINER, so the fence must be inside the function — and it is. Verified against
-- the live body:
--
--   * `IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Unauthorized'`
--   * reads the CALLER's own role and tenant from auth.users metadata, not from any argument
--   * `IF actor_role <> 'hr' OR actor_tenant_id IS DISTINCT FROM tenant_uuid
--        THEN RAISE EXCEPTION 'Forbidden'`   -- non-HR and cross-tenant HR both refused
--   * refuses a target already belonging to a different tenant ('Employee not found for this
--     tenant'), so an HR admin cannot claim another tenant's auth user
--
-- The caller cannot spoof `actor_role`: it comes from auth.users keyed on auth.uid(), never from
-- the request. Granting EXECUTE therefore widens nothing — it only lets the fence be reached.

GRANT EXECUTE ON FUNCTION public.set_employee_password_by_hr(text, text, uuid)
  TO authenticated;

-- ############################################################################
-- Assertions
-- ############################################################################
DO $$
BEGIN
  IF NOT has_function_privilege(
       'authenticated',
       'public.set_employee_password_by_hr(text, text, uuid)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'set_employee_password_by_hr: authenticated still lacks EXECUTE';
  END IF;

  -- The grant is only safe because the function fences internally. If it ever stops being
  -- SECURITY DEFINER, this grant becomes meaningless (it would run as the caller and be blocked
  -- by RLS on auth.users instead) — and if the HR check is ever removed, it becomes dangerous.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_employee_password_by_hr'
      AND p.prosecdef
      AND p.prosrc ~ 'actor_role'
      AND p.prosrc ~ 'Forbidden'
  ) THEN
    RAISE EXCEPTION 'set_employee_password_by_hr must stay SECURITY DEFINER with its HR fence intact';
  END IF;

  -- These must NOT be reachable by authenticated. Guards against a future blanket re-grant.
  IF has_function_privilege('authenticated', 'public.exec_sql(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_accrue_monthly_leaves()', 'EXECUTE') THEN
    RAISE EXCEPTION 'exec_sql / fn_accrue_monthly_leaves must remain un-executable by authenticated';
  END IF;
END $$;
