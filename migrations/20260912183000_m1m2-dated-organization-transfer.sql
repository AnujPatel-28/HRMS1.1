-- migration: P1-03 -- dated organization placement and reporting
-- Source: prompts/p1-03_dated_organization_2026-09-14.md
--
-- ============================================================================================
-- 1. THE DEFECT THAT IS LIVE RIGHT NOW
-- ============================================================================================
-- is_manager_of(p_employee_id) grants direct-report scope from THREE sources today:
--   target.manager_id = me.id                              (legacy column, unconditional)
--   target.secondary_manager_id = me.id                     (legacy column, unconditional)
--   EXISTS (... employee_reporting_relationships ... )      (ANY relationship_type, not just primary)
--
-- Contract v0.5 S3.3/S9 and tasks.md P1-03 AC3: only `primary` yields direct_reports scope.
-- Measured live on this branch before this migration: 7 primary rows (6 currently effective),
-- 1 secondary row (currently effective) -- that secondary row grants full manager scope over its
-- employee today (employee/attendance/leave manager-scope reads all funnel through
-- can_view_employee(), which calls is_manager_of() -- see attendance_select_manager,
-- attendance_events_select_manager and leaves_select_manager, all PERMISSIVE policies whose qual
-- is exactly can_view_employee(employee_id)). A mentor row would do the same. This migration
-- closes that: only an effective `primary` relationship-table row, or legacy manager_id acting as
-- its not-yet-migrated compatibility stand-in, grants scope. secondary_manager_id never has.
--
-- ============================================================================================
-- 2. RECORDED PRECEDENCE (brief S3) -- legacy manager_id vs. the relationship table
-- ============================================================================================
-- Both live writers of employees.manager_id (create_employee_transaction at employee creation,
-- update_employee_reporting_relationship on transfer) already insert/close a matching
-- relationship_type='primary' row in the same transaction -- verified by reading both function
-- bodies. So "not-yet-migrated" in practice means only pre-existing data from before this table
-- existed, or the legacy fixture tenants (`testtest`, `QA Testing Org`) if they were never routed
-- through either writer.
--
-- Decision, implemented in is_manager_of below: legacy `employees.manager_id` is a READ fallback,
-- not a competing authority. It grants scope ONLY when the target employee has NO `primary`-type
-- row in employee_reporting_relationships at all (any effective_from/effective_to/is_active) --
-- i.e. never migrated. The moment a single primary row exists for that employee, the relationship
-- table is authoritative and legacy manager_id is ignored for scope purposes, even if that primary
-- row is currently closed with no replacement (empty current eligible set reads as blocked, per
-- contract S9, not as "fall back to legacy"). The check is scoped to relationship_type='primary'
-- specifically (not "any row of any type") so that an employee whose only relationship-table row
-- is e.g. `mentor` -- who is therefore not migrated with respect to their PRIMARY relationship --
-- still falls back correctly to their legacy manager_id.
--
-- employees.manager_id/secondary_manager_id remain WRITE targets: both writer functions keep them
-- in sync with the relationship table today, and this migration does not change that (the frontend
-- reads manager_id directly in a few places -- e.g. useManagerView.tsx's direct-report count --
-- and stays correct exactly because both writers keep the two in sync; verified no other writer
-- of employees.manager_id exists in src/ or public.* function bodies). Retiring the legacy columns
-- as a write target is M2 Remaining per contract S9.
--
-- The four new relationship_type values legalized below (mentor, project_manager, reviewer,
-- temporary) have NO application writer today -- neither frontend form nor
-- update_employee_reporting_relationship/create_employee_transaction inserts them. This migration
-- only legalizes storing them (the CHECK constraint previously rejected all four, which made it
-- impossible to even test that they fail to grant scope, per AC3) and denies them read authority.
-- It does not add a UI or RPC to assign them; that is machinery with no writer today, recorded
-- deliberately rather than left implicit.
--
-- ============================================================================================
-- 3. DAY BOUNDARY: half-open [effective_from, effective_to) -- brief S2.1/S2.2
-- ============================================================================================
-- Chosen interval semantics: effective_from is INCLUSIVE, effective_to is EXCLUSIVE. A relationship
-- is effective on date D iff effective_from <= D AND (effective_to IS NULL OR effective_to > D).
-- This is a read-side-only change (the live resolver used effective_to >= CURRENT_DATE, inclusive
-- on both ends) chosen specifically because it requires NO change to how
-- update_employee_reporting_relationship already WRITES the boundary: closing the outgoing primary
-- sets effective_to = v_today and opening the incoming primary sets effective_from = v_today, and
-- under half-open semantics that already yields "outgoing effective through yesterday, incoming
-- effective from today" -- exactly one resolves on the transfer date, with no write-side change.
-- Measured before applying: zero currently-active rows have effective_to set (the only closed row
-- is already is_active=false), so this reinterpretation changes zero rows' live resolution today.
--
-- Also switches CURRENT_DATE (server/UTC date) to tenant_business_date(tenant_id, now()) --
-- P2-01's shared primitive, not re-derived -- in both is_manager_of and
-- update_employee_reporting_relationship, so a relationship's effective boundary is evaluated in
-- the tenant's business day, not UTC.
--
-- ============================================================================================
-- 4. OVERLAP GUARD -- brief S2.2
-- ============================================================================================
-- The only existing guard, employee_reporting_one_active_primary, is a partial unique index on
-- (employee_id) WHERE relationship_type='primary' AND is_active AND effective_to IS NULL: it only
-- prevents two *open-ended* primaries and does nothing for two closed-interval primaries that
-- overlap. Replaced with a GIST exclusion constraint over the actual date range (btree_gist is
-- already installed on this database -- verified via pg_extension before writing this). The
-- exclusion's WHERE filter (relationship_type='primary' AND is_active) intentionally matches
-- is_manager_of's own is_active requirement: two primaries may freely overlap in the table if one
-- of them is_active=false (a superseded/reversed row kept for history), because the resolver never
-- considers an inactive row anyway. If that coupling is ever broken by changing one side without
-- the other, "exactly one primary resolves on every date" (AC4) silently stops holding -- keep them
-- in agreement.
--
-- Verified before dropping the old index: no ON CONFLICT clause anywhere in this database's
-- function bodies or this repository's SQL/TS infers employee_reporting_one_active_primary (the
-- one ON CONFLICT that does mention employee_reporting_relationships in the same function body,
-- inside create_employee_transaction, targets an unrelated table -- leave_balances(tenant_id,
-- employee_id, leave_type_id, year) -- and is unaffected).
--
-- ============================================================================================
-- 5. NOT TOUCHED, DELIBERATELY
-- ============================================================================================
-- create_employee_transaction also uses CURRENT_DATE (for the new employee's initial primary
-- row's effective_from, defaulted from date_of_joining). Not changed here: it is not named in the
-- live defect this package exists to close, it already inserts a matching primary row in the same
-- transaction as the legacy column write (so the precedence rule above is unaffected either way),
-- and this function has broken onboarding twice before from unrelated edits (see
-- hrms-hardening-migration-broke-employee-create.md) -- touching it is out of proportion to a
-- one-day date-source inconsistency on a write path. Recorded as a known limitation for whichever
-- lane next touches employee creation, not fixed here.
--
-- No dated org-unit-assignment history table exists (employees.org_unit_id is a single current
-- FK, not an interval table) -- AC7's "overlapping unit assignments fail" sub-case has no
-- structure to test and is not built here; building one would be new product surface, not the
-- measured defect this package closes. The cross-tenant half of AC7 (manager/unit/designation IDs)
-- is already server-enforced by update_employee_reporting_relationship and is exercised by the
-- test instead.
--
-- No BEGIN/COMMIT here: the CLI wraps each migration in its own transaction.

-- --------------------------------------------------------------------------------------------
-- Legalize the four relationship types the contract requires the model to be able to hold.
-- --------------------------------------------------------------------------------------------
ALTER TABLE public.employee_reporting_relationships
  DROP CONSTRAINT employee_reporting_relationships_relationship_type_check;

ALTER TABLE public.employee_reporting_relationships
  ADD CONSTRAINT employee_reporting_relationships_relationship_type_check
  CHECK (relationship_type = ANY (ARRAY['primary'::text, 'secondary'::text, 'mentor'::text, 'project_manager'::text, 'reviewer'::text, 'temporary'::text]));

-- --------------------------------------------------------------------------------------------
-- Replace the partial-unique-index overlap guard with a real date-range exclusion constraint.
-- --------------------------------------------------------------------------------------------
DROP INDEX public.employee_reporting_one_active_primary;

ALTER TABLE public.employee_reporting_relationships
  ADD CONSTRAINT employee_reporting_primary_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
  WHERE (relationship_type = 'primary' AND is_active);

-- --------------------------------------------------------------------------------------------
-- is_manager_of -- body-only CREATE OR REPLACE on the exact existing (uuid) signature. Verify
-- afterwards (see test) that pg_proc holds exactly one row for this name.
-- --------------------------------------------------------------------------------------------
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
      AND (
        -- Authoritative source: a currently effective PRIMARY relationship row. secondary_manager_id
        -- and every relationship_type other than 'primary' are contextual only and never reach here.
        EXISTS (
          SELECT 1
          FROM public.employee_reporting_relationships r
          WHERE r.employee_id = target.id
            AND r.manager_id = me.id
            AND r.relationship_type = 'primary'
            AND r.is_active
            AND r.effective_from <= public.tenant_business_date(me.tenant_id, now())
            AND (r.effective_to IS NULL OR r.effective_to > public.tenant_business_date(me.tenant_id, now()))
        )
        OR (
          -- Legacy compatibility fallback: only for an employee with NO primary-type row at all
          -- (never migrated). The moment a primary row exists -- even a closed one with no
          -- replacement -- the relationship table is authoritative and this fallback does not apply.
          target.manager_id = me.id
          AND NOT EXISTS (
            SELECT 1
            FROM public.employee_reporting_relationships r2
            WHERE r2.employee_id = target.id
              AND r2.relationship_type = 'primary'
          )
        )
      )
  );
$function$;

COMMENT ON FUNCTION public.is_manager_of(uuid) IS
  'P1-03: grants direct-report scope from exactly one authoritative source -- a currently '
  'effective relationship_type=''primary'' row in employee_reporting_relationships (dated via '
  'tenant_business_date, half-open [effective_from, effective_to)) -- with legacy '
  'employees.manager_id as a read-only fallback used ONLY when the target has no primary-type row '
  'at all (not-yet-migrated). secondary_manager_id and every relationship_type other than primary '
  '(secondary, mentor, project_manager, reviewer, temporary) are contextual-only per contract S9 '
  'and never reach this predicate. See migration header 20260912183000 for the full precedence '
  'rationale and the measured evidence it rests on.';

-- --------------------------------------------------------------------------------------------
-- update_employee_reporting_relationship -- body-only CREATE OR REPLACE on the exact existing
-- (uuid, uuid, uuid) signature. Single targeted change from the live body: v_today now resolves
-- via tenant_business_date(v_tenant_id, now()) instead of CURRENT_DATE, computed once the tenant
-- is known. Every other statement is byte-identical to the live function.
-- --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_employee_reporting_relationship(p_employee_id uuid, p_primary_manager_id uuid, p_secondary_manager_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_employee_id uuid;
  v_tenant_id uuid;
  v_old_primary_manager_id uuid;
  v_old_secondary_manager_id uuid;
  v_today date;
BEGIN
  -- Security check: user must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Security check: user must be HR
  IF NOT public.is_hr() THEN
    RAISE EXCEPTION 'Forbidden: only HR can update reporting relationships';
  END IF;

  -- Resolve tenant ID and check matching tenant scope
  SELECT tenant_id, manager_id, secondary_manager_id
  INTO v_tenant_id, v_old_primary_manager_id, v_old_secondary_manager_id
  FROM public.employees
  WHERE id = p_employee_id
    AND tenant_id = public.get_auth_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- P1-03: tenant business date, not server/UTC CURRENT_DATE (P2-01 shared primitive).
  v_today := public.tenant_business_date(v_tenant_id, now());

  -- Get active employee ID of the actor (HR specialist)
  SELECT id
  INTO v_actor_employee_id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND tenant_id = v_tenant_id
  LIMIT 1;

  -- Basic self-reports validations:
  IF p_primary_manager_id = p_employee_id THEN
    RAISE EXCEPTION 'An employee cannot be their own primary manager';
  END IF;

  IF p_secondary_manager_id = p_employee_id THEN
    RAISE EXCEPTION 'An employee cannot be their own secondary manager';
  END IF;

  IF p_primary_manager_id IS NOT NULL AND p_secondary_manager_id IS NOT NULL AND p_primary_manager_id = p_secondary_manager_id THEN
    RAISE EXCEPTION 'Primary and secondary managers cannot be the same person';
  END IF;

  -- Verify manager tenants
  IF p_primary_manager_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_primary_manager_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Primary manager must belong to the same tenant';
    END IF;
  END IF;

  IF p_secondary_manager_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_secondary_manager_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Secondary manager must belong to the same tenant';
    END IF;
  END IF;

  -- Cycle check for primary manager
  IF p_primary_manager_id IS NOT NULL THEN
    DECLARE
      current_id uuid := p_primary_manager_id;
      visited uuid[] := ARRAY[p_employee_id];
      mgr_id uuid;
    BEGIN
      WHILE current_id IS NOT NULL LOOP
        IF current_id = p_employee_id THEN
          RAISE EXCEPTION 'Circular reporting line detected for primary manager';
        END IF;

        IF current_id = any(visited) THEN
          EXIT;
        END IF;

        visited := array_append(visited, current_id);

        SELECT manager_id INTO mgr_id
        FROM public.employees
        WHERE id = current_id;

        current_id := mgr_id;
      END LOOP;
    END;
  END IF;

  -- Cycle check for secondary manager
  IF p_secondary_manager_id IS NOT NULL THEN
    DECLARE
      current_id uuid := p_secondary_manager_id;
      visited uuid[] := ARRAY[p_employee_id];
      mgr_id uuid;
    BEGIN
      WHILE current_id IS NOT NULL LOOP
        IF current_id = p_employee_id THEN
          RAISE EXCEPTION 'Circular reporting line detected for secondary manager';
        END IF;

        IF current_id = any(visited) THEN
          EXIT;
        END IF;

        visited := array_append(visited, current_id);

        SELECT manager_id INTO mgr_id
        FROM public.employees
        WHERE id = current_id;

        current_id := mgr_id;
      END LOOP;
    END;
  END IF;

  -- Perform update on employees table
  UPDATE public.employees
  SET manager_id = p_primary_manager_id,
      secondary_manager_id = p_secondary_manager_id,
      updated_at = now()
  WHERE id = p_employee_id;

  -- Sync primary relationships in employee_reporting_relationships
  IF COALESCE(p_primary_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(v_old_primary_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    IF v_old_primary_manager_id IS NOT NULL THEN
      UPDATE public.employee_reporting_relationships
      SET is_active = false,
          effective_to = v_today,
          updated_at = now()
      WHERE employee_id = p_employee_id
        AND manager_id = v_old_primary_manager_id
        AND relationship_type = 'primary'
        AND is_active = true;
    END IF;

    IF p_primary_manager_id IS NOT NULL THEN
      INSERT INTO public.employee_reporting_relationships (
        tenant_id,
        employee_id,
        manager_id,
        relationship_type,
        effective_from,
        is_active
      )
      VALUES (
        v_tenant_id,
        p_employee_id,
        p_primary_manager_id,
        'primary',
        v_today,
        true
      );
    END IF;

    INSERT INTO public.audit_logs (
      tenant_id, actor_id, actor_role, action, target_type, target_id, details, status
    )
    VALUES (
      v_tenant_id,
      v_actor_employee_id,
      'hr',
      'employee.manager_changed',
      'employees',
      p_employee_id,
      jsonb_build_object(
        'from', v_old_primary_manager_id,
        'to', p_primary_manager_id,
        'relationship_type', 'primary'
      ),
      'success'
    );
  END IF;

  -- Sync secondary relationships in employee_reporting_relationships
  IF COALESCE(p_secondary_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(v_old_secondary_manager_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    IF v_old_secondary_manager_id IS NOT NULL THEN
      UPDATE public.employee_reporting_relationships
      SET is_active = false,
          effective_to = v_today,
          updated_at = now()
      WHERE employee_id = p_employee_id
        AND manager_id = v_old_secondary_manager_id
        AND relationship_type = 'secondary'
        AND is_active = true;
    END IF;

    IF p_secondary_manager_id IS NOT NULL THEN
      INSERT INTO public.employee_reporting_relationships (
        tenant_id,
        employee_id,
        manager_id,
        relationship_type,
        effective_from,
        is_active
      )
      VALUES (
        v_tenant_id,
        p_employee_id,
        p_secondary_manager_id,
        'secondary',
        v_today,
        true
      );
    END IF;

    INSERT INTO public.audit_logs (
      tenant_id, actor_id, actor_role, action, target_type, target_id, details, status
    )
    VALUES (
      v_tenant_id,
      v_actor_employee_id,
      'hr',
      'employee.manager_changed',
      'employees',
      p_employee_id,
      jsonb_build_object(
        'from', v_old_secondary_manager_id,
        'to', p_secondary_manager_id,
        'relationship_type', 'secondary'
      ),
      'success'
    );
  END IF;

END;
$function$;

COMMENT ON FUNCTION public.update_employee_reporting_relationship(uuid, uuid, uuid) IS
  'P1-03: single targeted change from the pre-20260912183000 body -- v_today resolves via '
  'tenant_business_date(v_tenant_id, now()) instead of server/UTC CURRENT_DATE. Every other '
  'statement, including the effective_to=v_today / effective_from=v_today boundary write, is '
  'unchanged: half-open [effective_from, effective_to) read semantics (see is_manager_of comment) '
  'make that existing write already correct -- outgoing effective through the day before v_today, '
  'incoming effective from v_today -- with no write-side change needed. Not extended to accept '
  'mentor/project_manager/reviewer/temporary or a future effective date; still primary/secondary '
  'only, still always-effective-today. known limitation, not fixed here: create_employee_transaction '
  'still resolves its initial primary row''s effective_from via CURRENT_DATE -- see migration '
  '20260912183000 header S5.';
