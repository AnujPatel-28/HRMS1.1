-- ############################################################################
-- B7c STEP 3 -- NOT YET A MIGRATION. DO NOT APPLY YET.
-- ############################################################################
--
-- This file lives in doc/pending_migrations/ ON PURPOSE. If it sat in migrations/ the next
-- `db migrations up --all` -- run by anyone, including an agent doing something unrelated --
-- would apply it silently, out of order, and break punch for every employee.
--
-- TO SHIP IT:
--   1. Push `main` and let Vercel deploy.
--   2. MARKER-VERIFY the new bundle is actually live. Not the filename, not the timestamp:
--        B=$(curl -s https://hrms.talentmeshsolutions.com/ | grep -oE "/assets/index-[A-Za-z0-9_-]+\.js")
--        curl -s "https://hrms.talentmeshsolutions.com$B" | grep -c punch_in_attendance
--      Must be >= 1. If it is 0, the client still writes attendance directly and this file
--      WILL take punch down. Stop.
--   3. Punch in and punch out once on the live site as a real employee.
--   4. Only then: move this file to migrations/<next-version>_revoke-employee-attendance-writes.sql
--      and run `npx @insforge/cli db migrations up --all`.
--
-- ############################################################################
-- WHAT THIS CLOSES
-- ############################################################################
-- Verified live 2026-08-29:
--
--   table grants   authenticated -> SELECT, INSERT, UPDATE, DELETE on public.attendance
--                  (blanket -- no column list)
--   RLS policy     attendance_update_self  PERMISSIVE UPDATE {authenticated}
--                  USING/CHECK: EXISTS (select 1 from employees e
--                                       where e.id = attendance.employee_id
--                                         and e.user_id = auth.uid())
--   RLS policy     attendance_insert_self  PERMISSIVE INSERT {authenticated}  (same shape)
--
-- **Postgres RLS cannot restrict columns.** Column scoping requires GRANT UPDATE (col, ...), and
-- the grant here is blanket. So an authenticated employee can today write ANY column on their own
-- attendance row straight from a browser console: work_hours, status, is_late, late_entry,
-- in_time/out_time, derivation_source, and is_locked. work_hours, status and is_late all feed
-- payroll_period_input, so this is a payroll vector, not a data-quality nit.
--
-- is_locked deserves its own mention: 20260829100000 made that flag load-bearing (a locked row is
-- never re-derived), so this hole also lets an employee permanently freeze their own day against
-- derivation. Making the flag meaningful RAISED the value of the hole.
--
-- ############################################################################
-- WHY IT IS SAFE TO REVOKE (all verified live, not assumed)
-- ############################################################################
-- 1. NO live client path writes attendance any more. An exhaustive scan of every .ts/.tsx in src/
--    for `.from("attendance")` followed by .update/.insert/.delete/.upsert returns ZERO hits.
--    (It returned two before, both in src/hooks/useAttendance.ts -- a hook with no importers that
--    still held the old direct insert+update. It was deleted rather than documented around: it is
--    precisely the path this file retires, and leaving it would have meant shipping code that
--    cannot work the moment this applies.)
--    Every write now goes through an RPC:
--      punch_in_attendance             (20260828110000, extended 20260829110000)
--      punch_out_attendance            (extended 20260829120000, gated 20260829130000)
--      mark_attendance_selfie_missing  (20260829130000)
--      hr_update_attendance / hr_approve_attendance_correction / hr_unlock_attendance_day
--      attendance_derive_pass1 / pass2
-- 2. Revoking a TABLE grant from `authenticated` does not affect any of them. Every function that
--    writes attendance is SECURITY DEFINER and therefore runs as the owner. Verified: a scan for
--    SECURITY INVOKER functions containing an INSERT/UPDATE/DELETE against attendance returns
--    ZERO rows.
-- 3. HR is also `authenticated`, and HR loses nothing -- every HR write is a definer RPC. The
--    same scan covers HR paths.
-- 4. Edge functions use the service credentials (project_admin), not `authenticated`.
--
-- The two _self policies are dropped as well as the grant. They exist ONLY to permit the direct
-- employee write being retired; leaving them behind would suggest a capability that no longer
-- exists. The HR policies are LEFT ALONE deliberately -- they are moot for writes once the grant
-- is gone, and dropping them buys nothing while risking a path this scan did not model.
--
-- Binding rules: no BEGIN/COMMIT/ROLLBACK. No FORCE ROW LEVEL SECURITY (standing prohibition).
-- Nothing here touches attendance_events (D11) or any derivation function.

REVOKE INSERT, UPDATE, DELETE ON public.attendance FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attendance FROM anon;

DROP POLICY IF EXISTS attendance_insert_self ON public.attendance;
DROP POLICY IF EXISTS attendance_update_self ON public.attendance;

-- ====================================================================
-- VERIFICATION
-- ====================================================================
DO $revoke_check$
DECLARE
  v_n integer;
BEGIN
  -- authenticated must keep SELECT and lose every write privilege.
  SELECT count(*) INTO v_n
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'attendance'
    AND grantee = 'authenticated' AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'REVOKE FAILED: authenticated still holds % write privileges on attendance', v_n;
  END IF;

  -- has_table_privilege, NOT a count over role_table_grants: that view can return more than one
  -- row for the same privilege (one per grantor) and is filtered by what the current role can
  -- see, so `<> 1` would abort on a false negative -- AFTER the revokes above have already run in
  -- this transaction. Same class as the whitespace-exact assertion that misfired in
  -- 20260829130000: an assertion that is wrong about its own query shape, not about the schema.
  IF NOT has_table_privilege('authenticated', 'public.attendance', 'SELECT') THEN
    RAISE EXCEPTION 'OVER-REVOKED: authenticated can no longer SELECT attendance -- the whole app is blind';
  END IF;

  SELECT count(*) INTO v_n
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'attendance'
    AND grantee = 'anon' AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'REVOKE FAILED: anon still holds write privileges on attendance';
  END IF;

  -- The self-write policies must be gone.
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'attendance'
    AND policyname IN ('attendance_insert_self', 'attendance_update_self');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'POLICY FAILED: % self-write policies survive', v_n;
  END IF;

  -- Employees must still be able to READ their own rows, or the punch screen goes blank.
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'attendance'
    AND policyname = 'attendance_select_self';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'OVER-REVOKED: attendance_select_self is gone -- employees cannot read their own attendance';
  END IF;

  -- Every write path must still exist and be callable by authenticated.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('punch_in_attendance', 'punch_out_attendance',
                      'mark_attendance_selfie_missing', 'hr_update_attendance',
                      'hr_approve_attendance_correction', 'hr_unlock_attendance_day')
    AND p.prosecdef
    AND array_to_string(p.proacl, ' ') LIKE '%authenticated=X%';
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'ENTRY POINT FAILED: expected 6 definer RPCs executable by authenticated, got %', v_n;
  END IF;

  -- Nothing that writes attendance may be SECURITY INVOKER, or the revoke just broke it.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f','p') AND NOT p.prosecdef
    AND regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
        ~ '(INSERT INTO|UPDATE|DELETE FROM)[[:space:]]+(public\.)?attendance\M';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'BROKEN: % SECURITY INVOKER function(s) write attendance and just lost the grant', v_n;
  END IF;

  RAISE NOTICE 'B7c step 3 verified: employees can read attendance but no longer write any column of it; all 6 definer RPCs intact; no invoker writer was orphaned';
END
$revoke_check$;
