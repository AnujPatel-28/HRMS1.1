-- 06-organisation-management.md §9.6, step 2 — but NOT as §9.6 wrote it.
--
-- §9.6 says "make is_hr() resolve through the table" and step 3 claims dropping
-- employees.role then leaves role with ONE source. That is not buildable, and the claim
-- is false. Two facts from the live backend:
--
--   1. FOUR auth users carry metadata role='hr' and have NO employees row at all
--      (hr@skyinfo.com, hr@testcorp.com, hr@testcorps.com, nikavx28@gmail.com). They are
--      not stale data: create-hr-admin-user provisions a tenant's first HR admin as an
--      auth user only. Remove the JWT branch from is_hr() and every NEW TENANT is dead on
--      arrival — the admin who just signed up cannot even create the first employee.
--   2. get_auth_tenant_id() reads metadata->>'tenant_id'. JWT is already session truth for
--      tenancy and cannot stop being so without an auth-core rewrite.
--
-- So the achievable and correct target is THREE sources -> TWO, with the two holding
-- different jobs rather than duplicating each other:
--
--   auth.users.metadata  = session identity. Which tenant, and is this session HR.
--                          Bootstrap path; set by set_hr_user_metadata (superadmin-only).
--   employee_roles       = explicit grants attached to a PERSON. Makes HR discoverable as
--                          employees (notification fan-out), and carries scoped grants.
--   employees.role       = a redundant third copy of the first. This is what gets dropped.
--
-- DO NOT "finish" this later by deleting the JWT branch. It is load-bearing.
-- The OR between the two branches also fails in the safe direction: a disagreement widens
-- access rather than locking someone out.
--
-- This migration changes NO schema. It introduces employee_is_hr() and repoints five
-- functions and three RLS policies off employees.role, so the column becomes unreferenced
-- server-side. The drop is a separate migration, gated on the frontend deploying first.

-- ---------------------------------------------------------------------------
-- 1. employee_is_hr(employee_id) — the mirror of is_hr()
-- ---------------------------------------------------------------------------
-- is_hr() asks "is THIS SESSION HR". Five call sites need the other question: "is this
-- EMPLOYEE HR", to enumerate a tenant's HR staff for notification fan-out. JWT cannot
-- answer that (it describes one session), which is exactly why employees.role existed.
--
-- SECURITY DEFINER is not optional. Reading auth.users inline is what caused the
-- 2026-08-20 module-wide chat outage: only project_admin may read that table, so an
-- invoker-rights predicate returns "permission denied for table users" for every user.
--
-- Both branches, in the same order and with the same OR, as is_hr(). Today the JWT branch
-- alone reproduces employees.role='hr' exactly — all 13 employees with a user_id agree
-- with their metadata, and all 3 HR employees have a user_id — so this is behaviour-
-- preserving on live data before any backfill runs.
CREATE OR REPLACE FUNCTION public.employee_is_hr(p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.employees e
      JOIN auth.users u ON u.id = e.user_id
      WHERE e.id = p_employee_id
        AND u.metadata->>'role' = 'hr'
    )
    OR EXISTS (
      SELECT 1
      FROM public.employee_roles r
      WHERE r.employee_id = p_employee_id
        AND r.role = 'hr_admin'
        AND r.is_active
    );
$function$;

REVOKE EXECUTE ON FUNCTION public.employee_is_hr(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.employee_is_hr(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.employee_is_hr(uuid) TO authenticated;

-- tenant_hr_employee_ids() — the same question for the frontend, which has four call sites
-- that today do .from("employees").eq("role","hr"). They cannot query employee_roles
-- directly: employee_roles_self_select lets an employee read only their OWN grants, so a
-- non-HR user asking "who is HR" gets an empty set. A definer RPC is the only RLS-safe
-- answer. Scoped to the caller's own tenant; it can leak nothing across one.
CREATE OR REPLACE FUNCTION public.tenant_hr_employee_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT e.id
  FROM public.employees e
  WHERE e.tenant_id = (SELECT public.get_auth_tenant_id())
    AND e.status = 'active'
    AND (SELECT public.employee_is_hr(e.id));
$function$;

REVOKE EXECUTE ON FUNCTION public.tenant_hr_employee_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_hr_employee_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.tenant_hr_employee_ids() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Repoint the five server-side readers of employees.role
-- ---------------------------------------------------------------------------
-- Rewritten by asserting the exact snippet appears exactly once, then replace() +
-- EXECUTE on the live pg_get_functiondef. Retyping bodies this large loses comments and
-- silently reverts drift; this preserves every other byte and REFUSES to run if the
-- function has moved on from what was audited.
--
-- fn_check_insurance_expiries was missed by the audit that found the other four: its
-- predicate is an UNQUALIFIED `AND role = 'hr'`, with no table alias for a
-- `[A-Za-z_]+\.role` regex to match. Search for the bare column name too, not only
-- qualified forms.
DO $mig$
DECLARE
  v_targets CONSTANT text[][] := ARRAY[
    ['create_policy_notifications_transaction',
     '        OR (v_visible_to = ''hr_only'' AND e.role = ''hr''::user_role)',
     '        OR (v_visible_to = ''hr_only'' AND public.employee_is_hr(e.id))'],
    ['employee_apply_leave_request',
     '      AND e.role = ''hr''::user_role',
     '      AND public.employee_is_hr(e.id)'],
    ['get_hr_policy_library',
     '            OR (fp.visible_to = ''hr_only'' AND e.role = ''hr''::user_role)',
     '            OR (fp.visible_to = ''hr_only'' AND public.employee_is_hr(e.id))'],
    ['submit_task_request',
     '        AND h.role::text = ''hr''',
     '        AND public.employee_is_hr(h.id)'],
    ['fn_check_insurance_expiries',
     '              AND role = ''hr''',
     '              AND public.employee_is_hr(id)']
  ];
  v_name text;
  v_old  text;
  v_new  text;
  v_def  text;
  v_hits int;
  i      int;
BEGIN
  FOR i IN 1 .. array_length(v_targets, 1) LOOP
    v_name := v_targets[i][1];
    v_old  := v_targets[i][2];
    v_new  := v_targets[i][3];

    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name AND p.prokind IN ('f', 'p');

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'employees.role repoint: % not found (or overloaded)', v_name;
    END IF;

    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'employees.role repoint: expected exactly 1 occurrence in %, found % — the function has drifted from the audited body, refusing to rewrite it', v_name, v_hits;
    END IF;

    EXECUTE replace(v_def, v_old, v_new);
  END LOOP;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 3. Repoint the three RLS policies
-- ---------------------------------------------------------------------------
-- Each swaps an inline employees.role read for is_hr(). Two of the three are on
-- chat_messages — the table whose policies caused the 2026-08-20 outage — so the
-- permissive/role/command attributes are restated verbatim below rather than assumed:
-- production_delete is DELETE TO authenticated, production_update is UPDATE TO public,
-- and the latter carries the predicate in BOTH using and with check.
--
-- Deliberate, small widening, stated rather than left to look accidental: the old
-- predicate required an employees row, so the four orphan HR users always failed it.
-- Under is_hr() they now pass. Effect in practice is nil — three of their four tenants
-- hold zero employees and none hold chat messages — and it is the correct outcome:
-- they ARE their tenant's HR admin. Note also that chat_messages_hr_all (ALL, is_hr())
-- already grants HR these two commands, so the branch was redundant for HR either way.

DROP POLICY IF EXISTS "HR can view tenant audit logs" ON public.audit_logs;
CREATE POLICY "HR can view tenant audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_auth_tenant_id()) AND (SELECT public.is_hr()));

DROP POLICY IF EXISTS chat_messages_production_delete ON public.chat_messages;
CREATE POLICY chat_messages_production_delete ON public.chat_messages
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees ce
      WHERE ce.user_id = (SELECT auth.uid()) AND ce.id = chat_messages.sender_id
    )
    OR (SELECT public.is_hr())
  );

DROP POLICY IF EXISTS chat_messages_production_update ON public.chat_messages;
CREATE POLICY chat_messages_production_update ON public.chat_messages
  FOR UPDATE TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.employees ce
      WHERE ce.user_id = (SELECT auth.uid()) AND ce.id = chat_messages.sender_id
    )
    OR (SELECT public.is_hr())
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees ce
      WHERE ce.user_id = (SELECT auth.uid()) AND ce.id = chat_messages.sender_id
    )
    OR (SELECT public.is_hr())
  );

-- ---------------------------------------------------------------------------
-- 4. Assert the column is now unreferenced server-side
-- ---------------------------------------------------------------------------
-- A dropped column does NOT break a PL/pgSQL function at apply time — bodies compile
-- lazily, per session, on first execution. After the 2026-08-20 department drop, a
-- trigger still referencing OLD.department kept succeeding: a live bomb, not a broken
-- build. So the audit runs HERE, while the column still exists and the check is cheap.
-- Both qualified (e.role) and unqualified (role) forms, since the latter is what hid
-- fn_check_insurance_expiries.
--
-- enforce_employee_update_restrictions is the one legitimate remaining reference: it is
-- the trigger that stops a non-HR employee editing their own role, and it is handled in
-- the drop migration, not here.
DO $audit$
DECLARE
  v_fns text;
  v_pol text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_fns
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f', 'p')
    AND p.proname <> 'enforce_employee_update_restrictions'
    AND pg_get_functiondef(p.oid) ~ '\mrole\M\s*(::text\s*)?=\s*''hr''';

  IF v_fns IS NOT NULL THEN
    RAISE EXCEPTION 'employees.role still read by: %', v_fns;
  END IF;

  SELECT string_agg(tablename || '.' || policyname, ', ') INTO v_pol
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '\mrole\M\s*=\s*''hr''';

  IF v_pol IS NOT NULL THEN
    RAISE EXCEPTION 'employees.role still read by policies: %', v_pol;
  END IF;
END
$audit$;
