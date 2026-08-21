-- Defect (c) from doc/org-module-status-2026-08-19.md §3c: the `structural_role` guardrail is
-- client-side only. Makes it a database rule (P5).
--
-- ── Why this matters ─────────────────────────────────────────────────────────
-- 06 §3.1: a tenant names its levels but cannot invent their meaning. Every org_unit_type carries a
-- `structural_role` from a fixed set — division | department | team — and that bound is what lets
-- `dept_head` approval routing, policy scoping and headcount reporting keep working regardless of
-- what the tenant calls things. 06 §4's guardrail table therefore says:
--
--   "Change a type's structural_role | Blocked once units exist — it would silently re-scope
--    policies and approvals."
--
-- Today nothing enforces that. The UI omits the column from the update once `usageCounts` shows the
-- type in use, but `usageCounts` is a LOAD-TIME SNAPSHOT: a unit created by another HR user after the
-- tab loaded leaves the lock stale-false. And anything writing through the API — the SDK, a script,
-- a future screen — bypasses the check entirely. A silent re-scope of approvals and document
-- visibility is exactly the class of change this module exists to prevent.
--
-- ── Why a trigger and not a CHECK ────────────────────────────────────────────
-- A CHECK constraint sees only the row being written. The rule is "may this row change GIVEN that
-- other rows reference it", which needs a lookup into org_units. That is a trigger.
--
-- ── Scope: deliberately narrow ───────────────────────────────────────────────
-- Blocks exactly one thing: changing `structural_role` on a type that units already reference.
--   * renaming a type stays ALLOWED and cosmetic — 06 §6 says so explicitly, because code reads
--     structural_role, not name;
--   * setting structural_role on a type with NO units stays allowed — nothing is scoped by it yet;
--   * an UPDATE that leaves structural_role unchanged is untouched, so ordinary edits
--     (name, level_order, is_active) still work on a type that is in use.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
--   DROP TRIGGER IF EXISTS org_unit_types_structural_role_guard ON public.org_unit_types;
--   DROP FUNCTION IF EXISTS public.guard_org_unit_type_structural_role();

CREATE OR REPLACE FUNCTION public.guard_org_unit_type_structural_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  unit_count integer;
BEGIN
  -- Only a genuine change to structural_role is gated. IS DISTINCT FROM, not <>, so a NULL on either
  -- side compares correctly rather than yielding NULL and skipping the guard.
  IF NEW.structural_role IS NOT DISTINCT FROM OLD.structural_role THEN
    RETURN NEW;
  END IF;

  -- SECURITY DEFINER so the count is the TRUE count. Read as the invoking role, org_units RLS would
  -- hide rows the caller cannot see and the guard would pass on a type that is in fact in use.
  SELECT count(*) INTO unit_count
  FROM public.org_units
  WHERE type_id = OLD.id;

  IF unit_count > 0 THEN
    RAISE EXCEPTION
      'Cannot change structural_role of org_unit_type % from % to %: % org unit(s) reference it. Approval routing and document scoping key off structural_role, so changing it under live units silently re-scopes them. Reassign or delete those units first.',
      OLD.name, OLD.structural_role, NEW.structural_role, unit_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_unit_types_structural_role_guard ON public.org_unit_types;
CREATE TRIGGER org_unit_types_structural_role_guard
  BEFORE UPDATE ON public.org_unit_types
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_org_unit_type_structural_role();

-- ── Verify after applying ────────────────────────────────────────────────────
-- Live data at author time: 36 org_unit_types (3 per tenant × 12), 10 org_units. Only types that
-- actually have units attached are gated, so most types remain freely editable.
--
--   -- must FAIL, if any type has units:
--   UPDATE org_unit_types SET structural_role = 'team'
--   WHERE id = (SELECT type_id FROM org_units WHERE type_id IS NOT NULL LIMIT 1);
--
--   -- must SUCCEED (rename is cosmetic, even while in use):
--   UPDATE org_unit_types SET name = name WHERE id = (SELECT id FROM org_unit_types LIMIT 1);
