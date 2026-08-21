-- ⚠️ ACCESS-CONTROL WIDENING. Notes: doc/20260820110000_repoint-department-rls-to-org-units.NOTES.md
--    `include_descendants` defaults to true. The §9.2 review query in that file MUST be re-run
--    before any replay of this migration onto another project or branch.
--
-- GATE CLEARED 2026-08-20. Renumbered from 20260819120000 (applied head had moved past it; the CLI
-- applies strictly in order and refuses to skip). At apply time:
--   * both target-side write paths shipped (commit c7e2e29) and were verified present in the SERVED
--     production bundle /assets/index-DJEWvrPu.js, not just in src/ — preconditions 2 and 3 below.
--     Value shape checked, not just the identifier: both write string[] of org_units.id, which is
--     what chat_channels.target_org_unit_ids (uuid[]) and the jsonb `?` test against
--     (get_my_org_unit_id())::text both require, and matches the backfills' ou.id::text;
--   * rq3qmu8y.insforge.site serves a "Decommissioned" page, so hrms.talentmeshsolutions.com is the
--     only live host and the two-host check in the NOTES collapses to one;
--   * the §9.2 review query returned ZERO ROWS. hr_policies: 1 row, visible_to='all'. chat_channels:
--     7 rows, 0 of type 'department', 0 with target_departments. projects: 1 row, type='all'.
--     All three backfills below were therefore no-ops and the widening granted nobody anything.
--
-- Phase 1 Slice B, step 3 of doc/architecture/06-organisation-management.md §5, plus §9.2.
--
-- ── What is wrong ────────────────────────────────────────────────────────────
-- Five RLS policies decide access by exact-string-matching `employees.department`, a denormalised
-- text column that provably drifts from the `org_units` row it duplicates (06 §2.1: `HR`/`Hr`,
-- `sales`/`Sales`, `dev`/`Dev`, `marketing`/`Marketing`; 7 of 16 employees contradicted before
-- 20260818100000 realigned them). An exact match on a column that drifts is an access-control
-- decision that silently returns the wrong answer. This migration moves all five onto
-- `employees.org_unit_id`, the FK that points at a managed reference row.
--
-- Latent, not live: hr_policies has 1 row (`visible_to = 'all'`), projects 1 row (unscoped), and 0 of
-- 7 chat_channels sets target_departments. No existing visibility decision depends on the text values,
-- which is what makes the backfills below safe. The defect activates on the first scoped document.
--
-- ── P2: no inline subqueries on `employees` ──────────────────────────────────
-- All five policies resolved the caller with `SELECT ... FROM employees WHERE user_id = auth.uid()`
-- inline. An inline subquery in a policy expression runs as the INVOKING role, so `employees` RLS is
-- re-entered. That is what produced `42P17 infinite recursion` on 2026-08-14 and took every
-- authenticated read down. Every `employees` lookup here now goes through a SECURITY DEFINER helper.
--
-- ── PRECONDITIONS — verify each before applying ──────────────────────────────
--  1. hr_policies: already satisfied. src/hr/PolicyUpload.tsx:139 writes `org_unit_id` today.
--  2. chat_channels: SATISFIED 2026-08-20. src/shared/Chat.tsx:493 writes `target_org_unit_ids`.
--  3. projects: SATISFIED 2026-08-20. src/hr/pms/ProjectList.tsx:239 and ProjectDetail.tsx:297 write
--     `visibility_config.org_unit_ids`.
--  4. Run the §9.2 review query in the NOTES file and sign off on every row it returns.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Every prior policy definition is captured byte-identical in
-- migrations/20260814120000_baseline-untracked-rls-policies.sql, entries [32], [35], [37], [55], [96].
-- Re-running those five blocks restores the previous behaviour. The added columns are additive and
-- can be left in place.
--
-- ── Deliberate semantic deltas (NOT byte-preserving rewrites) ────────────────
-- Listed here because each is an authorisation change a reviewer must accept, not a refactor:
--
--  D1. hr_policies targets `org_unit_id`, NOT a new `department_filter_unit_id`.
--      06 §5 step 3 names `department_filter_unit_id`, but `hr_policies.org_unit_id` ALREADY EXISTS —
--      added by migrations/20260813081500_policy-center-org-unit-targeting.sql:6, indexed there, read
--      by get_employee_visible_hr_policies() with the exact target semantics, and written by
--      src/hr/PolicyUpload.tsx:139. Adding a second uuid column would make the RLS gate and the
--      employee-facing policy list key off different columns, and would leave hr_policies with THREE
--      columns for one fact in the module whose purpose is removing the second. If a reviewer wants
--      the new column anyway, the change is mechanical: add it, backfill it identically, and swap
--      `org_unit_id` for it in policy [55] below.
--
--  D2. RESOLVED — projects_employee_read KEEPS `employees.status = 'active'`.
--      All four of its inline subqueries filtered `status = 'active'`, and neither
--      get_my_employee_id() nor get_my_org_unit_id() carries that filter. Substituting them would
--      have let a deactivated employee who can still authenticate regain read on projects they
--      manage, hold a task on, or are named in by employee_ids — a silent widening, which is the
--      class of change this module exists to remove. get_my_active_employee_id() below preserves the
--      filter exactly, so the rewrite of [96] is authorisation-NEUTRAL. Verified against the
--      baseline: [96] is the ONLY one of the five that carried a status filter (4 occurrences);
--      [32], [35], [37] and [55] contain the word `status` zero times, so their rewrites lose
--      nothing.
--
--  D3. chat_messages_production_insert: `current_emp.role = 'hr'::user_role` becomes `public.is_hr()`.
--      The role column cannot be read without an inline `employees` subquery. is_hr() is the intended
--      source (06 §9.6 retires employees.role), the two agree in live data, and the branch is already
--      redundant — chat_messages_hr_all is PERMISSIVE / FOR ALL / TO authenticated / USING is_hr().
--
--  D4. get_my_employee_id() gains an explicit PUBLIC execute grant (see the grant block below).
--
--  D5. Any `visible_to = 'department-specific'` hr_policies row whose department_filter does not
--      name-match an org_unit in its tenant ends up with org_unit_id NULL and becomes visible to
--      NOBODY except HR. Fails closed. The review query in the NOTES file lists these rows.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Helpers (P2). Both are STABLE / SECURITY DEFINER / SET search_path TO ''.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ⚠️ TWO EMPLOYEE-IDENTITY HELPERS EXIST ON PURPOSE. DO NOT COLLAPSE THEM.
--   get_my_employee_id()        — no status filter. Used by the chat policies, whose baselines
--                                 ([32], [35], [37]) never filtered on status.
--   get_my_active_employee_id() — filters status = 'active'. Used ONLY by [96]
--                                 projects_employee_read, whose baseline filtered status in all
--                                 four of its subqueries.
-- "Simplifying" the second into the first silently restores project read access to deactivated
-- employees. That is D2, and it is the reason this comment is here.

-- The caller's own employee row, restricted to an ACTIVE employee. Same shape as
-- get_my_employee_id(), plus the status filter that [96] carried inline.
CREATE OR REPLACE FUNCTION public.get_my_active_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT id
  FROM public.employees
  WHERE user_id = (SELECT auth.uid())
    AND status = 'active'
  LIMIT 1
$$;

-- The caller's own org unit. Mirrors get_my_employee_id() exactly — no status filter, because its
-- chat call sites never had one. [96] pairs it with an explicit active check instead; see there.
CREATE OR REPLACE FUNCTION public.get_my_org_unit_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$ SELECT org_unit_id FROM public.employees WHERE user_id = (SELECT auth.uid()) LIMIT 1 $$;

-- "Is the caller's unit inside p_unit_id?" — the unit itself, plus its whole subtree when
-- p_include_descendants. Subtree matching is a prefix scan on the materialised org_units.path
-- (`/uuid/uuid/`, maintained by org_units_maintain_path / org_units_resync_descendant_paths), not a
-- recursive CTE inside a policy. Path segments are uuids, so they contain no LIKE wildcards.
--
-- Returns false when the caller has no unit: 06 §6 requires "no unit" to mean no-department, NEVER
-- all-departments. Reading org_units inside the definer also keeps org_units RLS from applying as
-- the invoking role.
CREATE OR REPLACE FUNCTION public.my_org_unit_in_scope(p_unit_id uuid, p_include_descendants boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN p_unit_id IS NULL THEN false
    -- coalesce, not a bare comparison: get_my_org_unit_id() is NULL for a caller with no unit, and
    -- `uuid = NULL` is NULL, not false. A policy treats NULL as deny either way, but this helper is
    -- callable directly and must not answer "unknown" to an authorisation question.
    WHEN p_include_descendants IS NOT TRUE THEN coalesce(p_unit_id = public.get_my_org_unit_id(), false)
    ELSE EXISTS (
      SELECT 1
      FROM public.org_units mine, public.org_units tgt
      WHERE mine.id = public.get_my_org_unit_id()
        AND tgt.id = p_unit_id
        AND mine.path LIKE tgt.path || '%'
    )
  END;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- get_my_org_unit_id() and get_my_employee_id() are called from chat_messages_select, which is
-- `TO public`. A `TO public` policy IS evaluated for anon, so revoking PUBLIC turns an anon
-- `GET /chat_messages` from `[]` into `permission denied for function ...` — the trap already
-- documented for can_access_tenant / is_admin / is_hr / get_auth_tenant_id in
-- doc/session_context_2026-08-18.md §3. Both derive from auth.uid(), which is NULL for anon, so both
-- return NULL to an unauthenticated caller and leak nothing. This deliberately widens
-- get_my_employee_id()'s grant, which 20260814060000 had revoked from PUBLIC (D4).
GRANT EXECUTE ON FUNCTION public.get_my_org_unit_id() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_employee_id() TO PUBLIC;

-- my_org_unit_in_scope() and get_my_active_employee_id() are only reached from `TO authenticated`
-- policies ([55] and [96]), so they keep the P2 default.
REVOKE EXECUTE ON FUNCTION public.my_org_unit_in_scope(uuid, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.my_org_unit_in_scope(uuid, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_active_employee_id() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_active_employee_id() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Target-side columns and backfills
--
-- Repointing the EMPLOYEE side onto org_unit_id is only half the fix: the TARGET side of each of the
-- three features still stores department NAMES. chat_channels.target_departments and
-- projects.visibility_config->'departments' are written by the SPA from a hardcoded six-value list
-- (`sales / dev / marketing / operations / design / other`, duplicated across 8 files — see
-- doc/org-module-status-2026-08-19.md §2a), so comparing them to org_units.name would still be a
-- text match against slugs that do not match the reference rows. uuid on both sides or nothing.
--
-- Every backfill is case-insensitive and tenant-scoped. Case-insensitive because the documented drift
-- IS case (`HR`/`Hr`); an exact match would miss precisely the rows that motivated this work.
-- Tenant-scoped because a cross-tenant name match baked into a migration is a tenancy breach.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 06 §9.2: per-policy subtree toggle. Some policies are unit-only (a team SOP), some unit-and-below
-- (a division leave policy). Defaulting to true is the widening flagged in the NOTES file.
ALTER TABLE public.hr_policies
  ADD COLUMN IF NOT EXISTS include_descendants boolean NOT NULL DEFAULT true;

ALTER TABLE public.chat_channels
  ADD COLUMN IF NOT EXISTS target_org_unit_ids uuid[];

-- hr_policies.department_filter is INTENTIONALLY KEPT. Dropping it is 06 §5 step 6 and is separately
-- deploy-gated behind the ten screens that still render the hardcoded department list.
UPDATE public.hr_policies p
SET org_unit_id = ou.id
FROM public.org_units ou
WHERE p.org_unit_id IS NULL
  AND p.department_filter IS NOT NULL
  AND ou.tenant_id = p.tenant_id
  AND lower(ou.name) = lower(p.department_filter);

UPDATE public.chat_channels cc
SET target_org_unit_ids = m.ids
FROM (
  SELECT c.id, array_agg(DISTINCT ou.id) AS ids
  FROM public.chat_channels c
  CROSS JOIN LATERAL unnest(c.target_departments) AS d(name)
  JOIN public.org_units ou
    ON ou.tenant_id = c.tenant_id
   AND lower(ou.name) = lower(d.name)
  WHERE c.target_departments IS NOT NULL
  GROUP BY c.id
) m
WHERE cc.id = m.id
  AND cc.target_org_unit_ids IS NULL;

-- projects needs no DDL: visibility_config already carries uuid text in 'employee_ids', so
-- 'org_unit_ids' follows the shape the table already uses.
UPDATE public.projects p
SET visibility_config = jsonb_set(
      p.visibility_config,
      '{org_unit_ids}',
      coalesce((
        SELECT jsonb_agg(DISTINCT ou.id::text)
        FROM jsonb_array_elements_text(p.visibility_config -> 'departments') AS d(name)
        JOIN public.org_units ou
          ON ou.tenant_id = p.tenant_id
         AND lower(ou.name) = lower(d.name)
      ), '[]'::jsonb)
    )
WHERE p.visibility_config ->> 'type' = 'departments'
  AND jsonb_typeof(p.visibility_config -> 'departments') = 'array'
  AND NOT (p.visibility_config ? 'org_unit_ids');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. The five policies
--
-- Each is reproduced from migrations/20260814120000_baseline-untracked-rls-policies.sql with the
-- prior definition quoted above it. AS PERMISSIVE, FOR <cmd> and TO <role> are preserved exactly —
-- nothing here changes which command or which role a policy applies to.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── [55] hr_policies.policies_visible_to_all ─────────────────────────────────
-- WAS:
--   USING (((visible_to = 'all'::text) OR ((visible_to = 'department-specific'::text)
--     AND (department_filter IS NOT NULL) AND (EXISTS ( SELECT 1
--        FROM employees e
--       WHERE ((e.user_id = ( SELECT auth.uid() AS uid))
--         AND (e.department = hr_policies.department_filter)))))));
-- NOW: matches the policy's org_unit_id against the caller's unit, and — when include_descendants —
-- everything below that unit. A policy scoped to Engineering now reaches Backend, which is exactly
-- the §9.2 widening under review.
DROP POLICY IF EXISTS "policies_visible_to_all" ON public.hr_policies;
CREATE POLICY "policies_visible_to_all" ON public.hr_policies
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  (visible_to = 'all'::text)
  OR (
    visible_to = 'department-specific'::text
    AND org_unit_id IS NOT NULL
    AND public.my_org_unit_in_scope(org_unit_id, include_descendants)
  )
);

-- ── [96] projects.projects_employee_read ─────────────────────────────────────
-- WAS:
--   USING ((is_hr() OR ((tenant_id = get_auth_tenant_id()) AND (((visibility_config ->> 'type'::text) = 'all'::text)
--     OR (((visibility_config ->> 'type'::text) = 'departments'::text) AND ((visibility_config -> 'departments'::text) ? ( SELECT employees.department
--        FROM employees
--       WHERE ((employees.user_id = auth.uid()) AND (employees.status = 'active'::text))
--      LIMIT 1)))
--     OR (((visibility_config ->> 'type'::text) = 'people'::text) AND ((visibility_config -> 'employee_ids'::text) ? ( SELECT (employees.id)::text AS id
--        FROM employees
--       WHERE ((employees.user_id = auth.uid()) AND (employees.status = 'active'::text))
--      LIMIT 1)))
--     OR (manager_id = ( SELECT employees.id
--        FROM employees
--       WHERE ((employees.user_id = auth.uid()) AND (employees.status = 'active'::text))
--      LIMIT 1))
--     OR (EXISTS ( SELECT 1
--        FROM tasks t
--       WHERE ((t.project_id = projects.id) AND (t.assigned_to = ( SELECT employees.id
--                FROM employees
--               WHERE ((employees.user_id = auth.uid()) AND (employees.status = 'active'::text))
--              LIMIT 1)))))))));
-- NOW: the 'departments' branch reads visibility_config->'org_unit_ids' against the caller's unit;
-- the other three inline employees subqueries become get_my_active_employee_id().
--
-- The `status = 'active'` filter is PRESERVED in all four places (D2):
--   * people / manager_id / tasks — get_my_active_employee_id() returns NULL for a non-active
--     caller, so `? NULL`, `manager_id = NULL` and `assigned_to = NULL` are all false, exactly as
--     the original subqueries were when they matched no row.
--   * departments — get_my_org_unit_id() deliberately has no status filter (it is shared with the
--     chat policies, which never had one), so the branch carries the active check explicitly. Both
--     helpers resolve the SAME single employee row (`user_id = auth.uid() LIMIT 1`), so
--     "get_my_active_employee_id() IS NOT NULL" is precisely "that row is active".
DROP POLICY IF EXISTS "projects_employee_read" ON public.projects;
CREATE POLICY "projects_employee_read" ON public.projects
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  public.is_hr()
  OR (
    tenant_id = public.get_auth_tenant_id()
    AND (
      ((visibility_config ->> 'type'::text) = 'all'::text)
      OR (
        (visibility_config ->> 'type'::text) = 'departments'::text
        AND public.get_my_active_employee_id() IS NOT NULL
        AND (visibility_config -> 'org_unit_ids'::text) ? (public.get_my_org_unit_id())::text
      )
      OR (
        (visibility_config ->> 'type'::text) = 'people'::text
        AND (visibility_config -> 'employee_ids'::text) ? (public.get_my_active_employee_id())::text
      )
      OR (manager_id = public.get_my_active_employee_id())
      OR EXISTS (
        SELECT 1
        FROM public.tasks t
        WHERE t.project_id = projects.id
          AND t.assigned_to = public.get_my_active_employee_id()
      )
    )
  )
);

-- ── [32] chat_messages.chat_messages_employee_insert ─────────────────────────
-- WAS:
--   WITH CHECK (((EXISTS ( SELECT 1
--      FROM employees e
--     WHERE ((e.user_id = ( SELECT auth.uid() AS uid)) AND (e.id = chat_messages.sender_id))))
--     AND (channel <> 'announcements'::text) AND (EXISTS ( SELECT 1
--      FROM chat_channels cc
--     WHERE ((cc.name = chat_messages.channel) AND ((cc.type = 'global'::text)
--       OR ((cc.type = 'department'::text) AND (EXISTS ( SELECT 1
--              FROM employees e
--             WHERE ((e.user_id = ( SELECT auth.uid() AS uid)) AND (e.department = ANY (cc.target_departments))))))
--       OR ((cc.type = 'custom'::text) AND (EXISTS ( SELECT 1
--              FROM (chat_channel_members ccm
--                JOIN employees e ON ((e.id = ccm.employee_id)))
--             WHERE ((ccm.channel_id = cc.id) AND (e.user_id = ( SELECT auth.uid() AS uid))))))))))));
-- NOW: department membership is cc.target_org_unit_ids vs the caller's unit; the two identity
-- lookups become get_my_employee_id(). Otherwise identical.
DROP POLICY IF EXISTS "chat_messages_employee_insert" ON public.chat_messages;
CREATE POLICY "chat_messages_employee_insert" ON public.chat_messages
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (
  chat_messages.sender_id = public.get_my_employee_id()
  AND (channel <> 'announcements'::text)
  AND EXISTS (
    SELECT 1
    FROM public.chat_channels cc
    WHERE cc.name = chat_messages.channel
      AND (
        (cc.type = 'global'::text)
        OR ((cc.type = 'department'::text) AND public.get_my_org_unit_id() = ANY (cc.target_org_unit_ids))
        OR ((cc.type = 'custom'::text) AND EXISTS (
              SELECT 1
              FROM public.chat_channel_members ccm
              WHERE ccm.channel_id = cc.id
                AND ccm.employee_id = public.get_my_employee_id()
            ))
      )
  )
);

-- ── [35] chat_messages.chat_messages_production_insert ───────────────────────
-- WAS:
--   WITH CHECK ((EXISTS ( SELECT 1
--      FROM employees current_emp
--     WHERE ((current_emp.user_id = ( SELECT auth.uid() AS uid)) AND (current_emp.id = chat_messages.sender_id)
--       AND ((current_emp.role = 'hr'::user_role) OR (EXISTS ( SELECT 1
--              FROM chat_channels cc
--             WHERE ((cc.id = chat_messages.channel_id) AND (cc.is_announcement = false)
--               AND ((cc.type = 'global'::text)
--                 OR ((cc.type = 'department'::text) AND (current_emp.department = ANY (cc.target_departments)))
--                 OR ((cc.type = 'custom'::text) AND (EXISTS ( SELECT 1
--                        FROM chat_channel_members ccm
--                       WHERE ((ccm.channel_id = cc.id) AND (ccm.employee_id = current_emp.id))))))))))))));
-- NOW: same shape with the employees row resolved by helper. See D3 — the HR branch is is_hr().
DROP POLICY IF EXISTS "chat_messages_production_insert" ON public.chat_messages;
CREATE POLICY "chat_messages_production_insert" ON public.chat_messages
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (
  chat_messages.sender_id = public.get_my_employee_id()
  AND (
    public.is_hr()
    OR EXISTS (
      SELECT 1
      FROM public.chat_channels cc
      WHERE cc.id = chat_messages.channel_id
        AND cc.is_announcement = false
        AND (
          (cc.type = 'global'::text)
          OR ((cc.type = 'department'::text) AND public.get_my_org_unit_id() = ANY (cc.target_org_unit_ids))
          OR ((cc.type = 'custom'::text) AND EXISTS (
                SELECT 1
                FROM public.chat_channel_members ccm
                WHERE ccm.channel_id = cc.id
                  AND ccm.employee_id = public.get_my_employee_id()
              ))
        )
    )
  )
);

-- ── [37] chat_messages.chat_messages_select ──────────────────────────────────
-- WAS:
--   USING ((((is_deleted = false) OR (EXISTS ( SELECT 1
--      FROM auth.users u
--     WHERE ((u.id = auth.uid()) AND (COALESCE((u.metadata ->> 'role'::text), ''::text) = 'hr'::text))))
--     OR (EXISTS ( SELECT 1
--      FROM employees e
--     WHERE ((e.user_id = auth.uid()) AND (e.id = chat_messages.sender_id)))))
--     AND ((EXISTS ( SELECT 1
--      FROM auth.users u
--     WHERE ((u.id = auth.uid()) AND (COALESCE((u.metadata ->> 'role'::text), ''::text) = 'hr'::text))))
--     OR (EXISTS ( SELECT 1
--      FROM chat_channels cc
--     WHERE ((cc.name = chat_messages.channel) AND ((cc.type = 'global'::text)
--       OR ((cc.type = 'department'::text) AND (EXISTS ( SELECT 1
--              FROM employees e
--             WHERE ((e.user_id = auth.uid()) AND (e.department = ANY (cc.target_departments))))))
--       OR ((cc.type = 'custom'::text) AND (EXISTS ( SELECT 1
--              FROM (chat_channel_members ccm
--                JOIN employees e ON ((e.id = ccm.employee_id)))
--             WHERE ((ccm.channel_id = cc.id) AND (e.user_id = auth.uid()))))))))))));
-- NOW: employees lookups routed through helpers, department membership via target_org_unit_ids. The
-- two auth.users metadata checks are reproduced verbatim — they are not employees lookups, and
-- substituting is_hr() here would change which source of truth the HR branch reads. This policy is
-- `TO public`, which is what forces the PUBLIC execute grants above.
DROP POLICY IF EXISTS "chat_messages_select" ON public.chat_messages;
CREATE POLICY "chat_messages_select" ON public.chat_messages
AS PERMISSIVE
FOR SELECT
TO public
USING (
  (
    (is_deleted = false)
    OR EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
        AND COALESCE((u.metadata ->> 'role'::text), ''::text) = 'hr'::text
    )
    OR (chat_messages.sender_id = public.get_my_employee_id())
  )
  AND (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
        AND COALESCE((u.metadata ->> 'role'::text), ''::text) = 'hr'::text
    )
    OR EXISTS (
      SELECT 1
      FROM public.chat_channels cc
      WHERE cc.name = chat_messages.channel
        AND (
          (cc.type = 'global'::text)
          OR ((cc.type = 'department'::text) AND public.get_my_org_unit_id() = ANY (cc.target_org_unit_ids))
          OR ((cc.type = 'custom'::text) AND EXISTS (
                SELECT 1
                FROM public.chat_channel_members ccm
                WHERE ccm.channel_id = cc.id
                  AND ccm.employee_id = public.get_my_employee_id()
              ))
        )
    )
  )
);

-- ── NOT CHANGED, and deliberately so ─────────────────────────────────────────
-- [29] chat_channels.channels_employee_select carries the identical defect:
--   ... (type = 'department'::text) AND (EXISTS ( SELECT 1 FROM employees e
--        WHERE ((e.user_id = ( SELECT auth.uid() AS uid))
--          AND (e.department = ANY (chat_channels.target_departments))))) ...
-- It is outside the five this step enumerates, and an unrequested policy rewrite is not something to
-- slip into an authorisation migration. Consequence a reviewer must weigh: after this file, the
-- CHANNEL visibility gate keys off drifting text while the MESSAGE gate keys off org_unit_id, so the
-- two can disagree — a user may list a channel whose messages they cannot read, or the reverse.
-- Widening this migration to six policies is a reviewer's call.
