-- migration: C3 -- manager authority converges on the primary reporting relationship
-- Source: prompts/c2_c6_cleanup_packages_2026-09-22.md, C3 section, plus one lead-measured
-- scope addition (§4 below).
--
-- Measured on TB-M1M2 2026-09-23:
--   * 0 employees with manager_id set and no currently effective primary row (fallback is dead).
--   * 1 employee whose display manager_id disagrees with their active primary row (the display
--     column drifted; authority was already the relationship row). Re-synced in §1.
--   * `managers_can_view_own_draft_reports` exposed each report's FULL employees row (bank, PAN,
--     Aadhaar, DOB) to the manager through the legacy column.
--   * `managers_can_delete_own_draft_reports` let any employee delete rows of that shape.
--   * SCOPE ADDITION: `employee_reporting_relationships.tenant_isolation_policy` was PERMISSIVE
--     FOR ALL on tenant membership alone. Live proof: employee.a inserted a primary row naming
--     themself manager of hr-employee.a and `is_manager_of` flipped false -> true. Removing the
--     legacy fallback is meaningless while any employee can write the authoritative row.
--
-- No BEGIN/COMMIT here: the CLI wraps each migration in its own transaction.

-- ── 1. Removal trigger (package-review-P1-03 §3): assert no orphans, re-sync display column ───
DO $$
DECLARE
  v_orphans int;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM public.employees e
  WHERE e.manager_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.employee_reporting_relationships r
      WHERE r.employee_id = e.id
        AND r.relationship_type = 'primary'
        AND r.is_active
        AND r.effective_from <= public.tenant_business_date(e.tenant_id, now())
        AND (r.effective_to IS NULL OR r.effective_to > public.tenant_business_date(e.tenant_id, now()))
    );
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION 'C3: % employees have manager_id but no active primary relationship; migrate them first', v_orphans;
  END IF;
END $$;

-- manager_id stays as a display column; update_employee_reporting_relationship keeps it in sync
-- from here on. Bring the drifted rows back in line with the authoritative row.
UPDATE public.employees e
SET manager_id = r.manager_id,
    updated_at = now()
FROM public.employee_reporting_relationships r
WHERE r.employee_id = e.id
  AND r.relationship_type = 'primary'
  AND r.is_active
  AND r.effective_from <= public.tenant_business_date(e.tenant_id, now())
  AND (r.effective_to IS NULL OR r.effective_to > public.tenant_business_date(e.tenant_id, now()))
  AND e.manager_id IS DISTINCT FROM r.manager_id;

-- ── 2. is_manager_of: drop the legacy manager_id fallback (exact signature) ────────────────────
CREATE OR REPLACE FUNCTION public.is_manager_of(p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees target
    JOIN public.employees me
      ON me.user_id = (SELECT auth.uid())
    WHERE target.id = p_employee_id
      -- Defence in depth: tenant isolation is already enforced by the calling policy.
      AND me.tenant_id = target.tenant_id
      -- Never let a self-reference grant elevated scope.
      AND me.id <> target.id
      -- Sole source (C3): a currently effective PRIMARY relationship row. secondary_manager_id,
      -- the manager_id display column and every relationship_type other than 'primary' are
      -- contextual only and never reach here.
      AND EXISTS (
        SELECT 1
        FROM public.employee_reporting_relationships r
        WHERE r.employee_id = target.id
          AND r.manager_id = me.id
          AND r.relationship_type = 'primary'
          AND r.is_active
          AND r.effective_from <= public.tenant_business_date(me.tenant_id, now())
          AND (r.effective_to IS NULL OR r.effective_to > public.tenant_business_date(me.tenant_id, now()))
      )
  );
$function$;

-- ── 3. employees: the two legacy manager_id policies go ────────────────────────────────────────
-- Managers read reports through employee_directory_public (basic columns) and the RPC in §6.
DROP POLICY managers_can_view_own_draft_reports ON public.employees;
DROP POLICY managers_can_delete_own_draft_reports ON public.employees;

-- ── 4. employee_reporting_relationships: only HR / reporting.manage may write ─────────────────
-- Remaining after this: employee_reporting_hr_all (HR), reporting_relationships_company_admin_all
-- (reporting.manage), employee_reporting_tenant_select (org chart read). The table had no
-- RESTRICTIVE fence; add the house one.
DROP POLICY tenant_isolation_policy ON public.employee_reporting_relationships;
CREATE POLICY tenant_active_restrictive ON public.employee_reporting_relationships
  AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(employee_reporting_relationships.tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(employee_reporting_relationships.tenant_id)));
REVOKE ALL ON public.employee_reporting_relationships FROM anon;

-- ── 5. new_hire_requests: requester can cancel their own pending request ──────────────────────
-- Replaces MyTeam's "cancel" that deleted an employees row.
ALTER TABLE public.new_hire_requests DROP CONSTRAINT new_hire_requests_status_check;
ALTER TABLE public.new_hire_requests ADD CONSTRAINT new_hire_requests_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]));

CREATE OR REPLACE FUNCTION public.c1_cancel_new_hire_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_actor uuid;
BEGIN
  v_tenant := public.get_auth_tenant_id();
  v_actor := public.get_my_employee_id();
  IF v_tenant IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'NEW_HIRE_REQUEST_UNAVAILABLE' USING ERRCODE = 'P1002';
  END IF;

  UPDATE public.new_hire_requests
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_request_id AND tenant_id = v_tenant AND requested_by = v_actor AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NEW_HIRE_REQUEST_NOT_PENDING' USING ERRCODE = 'P1003';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.c1_cancel_new_hire_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.c1_cancel_new_hire_request(uuid) TO authenticated;

-- ── 6. my_direct_report_ids: the team list, from the same predicate the server enforces ───────
-- Lets MyTeam / useManagerView list reports without reading employees rows (and without
-- re-implementing the effective-window rule in the client).
CREATE OR REPLACE FUNCTION public.my_direct_report_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT target.id
  FROM public.employees target
  WHERE target.tenant_id = public.get_auth_tenant_id()
    AND public.is_manager_of(target.id);
$function$;

REVOKE ALL ON FUNCTION public.my_direct_report_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_direct_report_ids() TO authenticated;

-- ── 7. Hygiene: one pg_proc row per touched/created name ──────────────────────────────────────
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['is_manager_of', 'c1_cancel_new_hire_request', 'my_direct_report_ids'] LOOP
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = fn) <> 1 THEN
      RAISE EXCEPTION 'C3: expected exactly one pg_proc row for %', fn;
    END IF;
  END LOOP;
END $$;
