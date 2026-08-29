-- CRITICAL: revoke TRUNCATE and TRIGGER from the two PostgREST API roles on every public table.
--
-- Found while verifying B7c step 3. Narrowing attendance's write surface left this grant list on
-- public.attendance for `authenticated` AND `anon`:
--
--     REFERENCES, SELECT, TRIGGER, TRUNCATE
--
-- ############################################################################
-- WHY THIS IS THE MOST SEVERE FINDING IN THE ATTENDANCE PROGRAMME SO FAR
-- ############################################################################
-- **Row Level Security does not apply to TRUNCATE.** RLS filters rows for SELECT/INSERT/UPDATE/
-- DELETE. TRUNCATE is a table-level DDL-ish operation: it is governed ONLY by the TRUNCATE
-- privilege, and it removes every row in the table regardless of any policy, any tenant fence,
-- and any USING clause. `tenant_isolation`, `can_access_tenant()` and every RESTRICTIVE policy in
-- this schema are simply not consulted.
--
-- Verified live 2026-08-29:
--     authenticated -> TRUNCATE on 50 of 68 public tables
--     anon          -> TRUNCATE on the same 50
-- including tenants, employees, attendance, attendance_events, leaves, payroll_runs, payslips and
-- salary_structures.
--
-- `anon` is the role behind the ANON KEY, which is embedded in the shipped frontend bundle BY
-- DESIGN -- the whole security model is "the anon key is safe to publish because RLS is enforced".
-- That premise does not hold for TRUNCATE. So anyone who reads the public JS bundle could issue a
-- single statement and destroy every tenant's data at once. It is not a cross-tenant READ leak
-- like the ones audited before; it is unauthenticated, irreversible, whole-database destruction.
--
-- ############################################################################
-- WHY REVOKING IS SAFE
-- ############################################################################
-- PostgREST never emits TRUNCATE -- it has no such verb in its API surface. Nothing in src/ can
-- issue one either; the SDK exposes select/insert/update/delete/rpc only. TRIGGER is likewise
-- never needed by an API role: it allows CREATE TRIGGER on the table, i.e. attaching arbitrary
-- code to another tenant's writes, which is a privilege-escalation primitive, not an app feature.
--
-- REFERENCES is deliberately LEFT ALONE. It only permits creating a foreign key referencing the
-- table; it is not a data-destruction or escalation path, and revoking it is churn without
-- benefit.
--
-- SELECT / INSERT / UPDATE / DELETE are NOT touched here. Those are the RLS-governed privileges
-- the application genuinely uses, and RLS does apply to all four.
--
-- Migration owners (project_admin) keep everything, so migrations, definer RPCs and edge
-- functions are unaffected.
--
-- ############################################################################
-- ALSO FIXES THE SOURCE, NOT JUST THE SYMPTOM
-- ############################################################################
-- These grants did not come from this repo -- no migration issues them. They come from the
-- platform's DEFAULT PRIVILEGES, which is why 50 tables share the identical grant list. Revoking
-- on existing tables alone would leave the next `create table` reintroducing it silently. So this
-- migration also alters the default privileges for future tables. The DO block below reports what
-- it changed rather than assuming it worked.
--
-- Binding rules: no BEGIN/COMMIT/ROLLBACK. No FORCE ROW LEVEL SECURITY. No policy is added or
-- dropped. No function is changed. No frontend file is touched.

DO $revoke_truncate$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    -- 'r' ordinary, 'p' partitioned, 'v' view, 'm' materialised view, 'f' foreign.
    -- Views matter: TRUNCATE is meaningless on one, but TRIGGER is not -- it permits attaching an
    -- INSTEAD OF trigger. The first run of this migration looped over 'r' only and its own
    -- assertion caught the two views (audit_log, employees_public) that were left behind.
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER ON public.%I FROM authenticated', r.relname);
    EXECUTE format('REVOKE TRUNCATE, TRIGGER ON public.%I FROM anon', r.relname);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'Revoked TRUNCATE and TRIGGER from authenticated and anon on % public relations', v_n;
END
$revoke_truncate$;

-- Stop the platform's default privileges from reintroducing this on the next created table.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER ON TABLES FROM anon;

-- ====================================================================
-- VERIFICATION
-- ====================================================================
DO $truncate_check$
DECLARE
  v_n integer;
  v_tbl text;
BEGIN
  SELECT count(*) INTO v_n
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('authenticated', 'anon')
    AND privilege_type IN ('TRUNCATE', 'TRIGGER');
  IF v_n <> 0 THEN
    SELECT string_agg(DISTINCT table_name, ', ') INTO v_tbl
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('authenticated', 'anon')
      AND privilege_type IN ('TRUNCATE', 'TRIGGER');
    RAISE EXCEPTION 'REVOKE FAILED: % TRUNCATE/TRIGGER grants survive on: %', v_n, v_tbl;
  END IF;

  -- has_table_privilege is the unambiguous check -- assert the actual capability is gone on the
  -- tables whose loss would be worst, not merely that a catalogue view lists no row.
  IF has_table_privilege('anon', 'public.tenants', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.employees', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.attendance', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.attendance', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.payslips', 'TRUNCATE') THEN
    RAISE EXCEPTION 'REVOKE FAILED: an API role can still TRUNCATE a core table';
  END IF;

  -- The privileges the application actually needs must survive untouched.
  IF NOT has_table_privilege('authenticated', 'public.attendance', 'SELECT') THEN
    RAISE EXCEPTION 'OVER-REVOKED: authenticated lost SELECT on attendance';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.leaves', 'INSERT') THEN
    RAISE EXCEPTION 'OVER-REVOKED: authenticated lost INSERT on leaves';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.chat_messages', 'INSERT') THEN
    RAISE EXCEPTION 'OVER-REVOKED: authenticated lost INSERT on chat_messages';
  END IF;

  -- attendance's own write surface must still be closed by 20260829140000.
  IF has_table_privilege('authenticated', 'public.attendance', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.attendance', 'INSERT') THEN
    RAISE EXCEPTION 'REGRESSION: B7c step 3 was undone -- authenticated can write attendance again';
  END IF;

  RAISE NOTICE 'Verified: no API role holds TRUNCATE or TRIGGER on any public table; SELECT/INSERT still intact where the app needs them; attendance write surface still closed';
END
$truncate_check$;
