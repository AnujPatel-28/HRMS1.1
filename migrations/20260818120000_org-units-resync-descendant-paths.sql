-- Fix: re-parenting an org unit left its DESCENDANTS' materialised paths stale.
--
-- 20260818110000 added a BEFORE trigger that recomputes `path` for the row being moved, but a trigger
-- only sees its own row. Moving B from A to D produced:
--
--     ZZb  /D/B/          <- correct
--     ZZc  /A/B/C/        <- STALE: still claims to live under A
--
-- That is not cosmetic. `path` is what descendant queries use, and descendant queries are what
-- `hr_policies.include_descendants` scopes visibility with (06-organisation-management.md §9.2). A
-- stale path means a policy scoped to a division silently misses a moved sub-team, and the old
-- division still matches it — the wrong people see the document, and the right people do not.
--
-- Fix: after a parent change, rewrite the old path prefix to the new one across the whole subtree.
--
-- The trigger is scoped to `UPDATE OF parent_id`, so the descendant rewrite below (which touches only
-- `path`) cannot re-fire it — one statement resyncs the subtree with no recursion.

CREATE OR REPLACE FUNCTION public.org_units_resync_descendant_paths()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF OLD.path IS DISTINCT FROM NEW.path AND OLD.path IS NOT NULL THEN
    UPDATE public.org_units
    SET path = NEW.path || substring(path FROM length(OLD.path) + 1)
    WHERE path LIKE OLD.path || '_%'
      AND id <> NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS org_units_resync_paths ON public.org_units;
CREATE TRIGGER org_units_resync_paths
AFTER UPDATE OF parent_id ON public.org_units
FOR EACH ROW EXECUTE FUNCTION public.org_units_resync_descendant_paths();
