-- B9 support: let HR see WHETHER an employee has a kiosk PIN without ever shipping the hash.
--
-- ############################################################################
-- WHY THIS RPC EXISTS RATHER THAN A PLAIN SELECT
-- ############################################################################
-- The obvious implementation of the provisioning screen is
--     db.from('employees').select('id, employee_code, kiosk_pin_hash, ...')
-- and then checking `!!kiosk_pin_hash` in the browser. That works, and it quietly hands every HR
-- session the bcrypt hash of every employee's kiosk PIN.
--
-- A kiosk PIN is 4 to 8 digits. A 4-digit PIN has TEN THOUSAND candidates. bcrypt is deliberately
-- slow, but ten thousand guesses against a hash you already hold is minutes of offline work, not
-- a meaningful barrier. The recovered PIN then lets that person punch as the employee at a
-- kiosk -- silently, with no audit trail, and with the punch looking exactly like a genuine one.
--
-- That is a real escalation, not a theoretical one, and the distinction that matters is this:
-- HR can already SET any employee's PIN via hr_set_employee_kiosk_pin, but that write is AUDITED
-- and the employee discovers it the next time their old PIN fails. Recovering the existing PIN is
-- silent and leaves the employee none the wiser. Audited reset and silent impersonation are not
-- the same capability.
--
-- Postgres RLS cannot restrict columns -- it filters rows -- so "HR may read this table but not
-- that column" is not expressible as a policy. This RPC is the fix: it returns exactly the fields
-- the provisioning screen needs, with the hash reduced to a boolean before it ever leaves the
-- database.
--
-- RESIDUAL, recorded honestly: a determined HR user can still query employees.kiosk_pin_hash
-- directly through the API, because the underlying column grant is table-wide. Closing that needs
-- either a column-scoped GRANT on employees or a view plus a revoke on the base table, both of
-- which touch a table nearly every screen reads and belong in their own change. Raising the
-- minimum PIN length would also help and is a product decision, not a migration.
--
-- Binding rules: SECURITY DEFINER with the HR fence asserted explicitly (rule 1). No
-- BEGIN/COMMIT/ROLLBACK. Read-only -- this function writes nothing at all.

CREATE OR REPLACE FUNCTION public.hr_list_kiosk_credentials(p_tenant_id uuid)
 RETURNS TABLE (
   employee_id          uuid,
   full_name            text,
   employee_code        text,
   pin_set              boolean,
   attendance_device_id text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM assert_hr_for_tenant(p_tenant_id);

  IF NOT tenant_has_module_for(p_tenant_id, 'attendance') THEN
    RAISE EXCEPTION 'MODULE_DISABLED';
  END IF;

  RETURN QUERY
  SELECT e.id,
         e.full_name,
         e.employee_code,
         -- The hash is collapsed to a boolean HERE, inside the database. It never crosses the
         -- API boundary in any form.
         (e.kiosk_pin_hash IS NOT NULL) AS pin_set,
         e.attendance_device_id
  FROM employees e
  WHERE e.tenant_id = p_tenant_id
    AND e.status = 'active'
  ORDER BY e.full_name;
END;
$function$;

COMMENT ON FUNCTION public.hr_list_kiosk_credentials(uuid) IS
'Lists active employees with the two kiosk/biometric credentials HR needs to provision a device, reducing kiosk_pin_hash to a boolean INSIDE the database so the hash never reaches a browser. A 4-digit PIN has only 10,000 candidates, so a leaked bcrypt hash is minutes of offline work away from silent impersonation at a kiosk -- unlike an HR PIN reset, which is audited and which the employee notices. Postgres RLS filters rows, not columns, so this cannot be expressed as a policy.';

REVOKE ALL ON FUNCTION public.hr_list_kiosk_credentials(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_list_kiosk_credentials(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_list_kiosk_credentials(uuid) TO authenticated;

DO $kiosk_cred_check$
DECLARE
  v_def text;
BEGIN
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g'),
           '[ \t]+', ' ', 'g')
    INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'hr_list_kiosk_credentials';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'hr_list_kiosk_credentials is missing';
  END IF;
  IF position('assert_hr_for_tenant' in v_def) = 0 THEN
    RAISE EXCEPTION 'GUARD FAILED: hr_list_kiosk_credentials does not assert HR for the tenant';
  END IF;
  -- The entire point: the hash must be reduced to a boolean, never returned.
  IF position('kiosk_pin_hash IS NOT NULL' in v_def) = 0 THEN
    RAISE EXCEPTION 'PRIVACY FAILED: pin_set is not derived from a NULL check';
  END IF;
  IF v_def ~ 'e\.kiosk_pin_hash AS|SELECT e\.kiosk_pin_hash,' THEN
    RAISE EXCEPTION 'PRIVACY FAILED: the raw kiosk_pin_hash is returned to the caller';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.hr_list_kiosk_credentials(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL FAILED: authenticated cannot execute hr_list_kiosk_credentials';
  END IF;
  IF has_function_privilege('anon', 'public.hr_list_kiosk_credentials(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL FAILED: anon can execute hr_list_kiosk_credentials';
  END IF;

  RAISE NOTICE 'hr_list_kiosk_credentials verified: HR-gated, module-gated, returns pin_set as a boolean and never the hash, authenticated-only';
END
$kiosk_cred_check$;
