-- Option A. Makes `employee_unit_assignments` the ONLY source of truth for unit membership, in the
-- database rather than by convention. Two triggers:
--
--   1. employees_org_unit_assignment_guard   — refuses a direct move that bypasses the transfer flow
--   2. employees_open_unit_assignment        — opens the initial assignment automatically at hire
--
-- ── The gap being closed ─────────────────────────────────────────────────────
-- 06 §3.5: `employees.org_unit_id` is "a denormalised pointer to the current row — kept in sync by
-- trigger, not by application code". The trigger half shipped in 20260818140000. The other half never
-- did: nothing STOPPED application code writing the pointer directly, and two paths still do —
-- `create_employee_transaction` at hire and `handleActivate` on draft activation. A direct write moves
-- the pointer while the assignment history's "Current" row still names the old unit. That is defect
-- (a) from doc/org-module-status-2026-08-19.md §3c, which was closed in the edit form this session and
-- is now closed at the database instead, where every writer is covered.
--
-- ── 1. Why the guard compares against the OPEN ASSIGNMENT, not against OLD ────
-- The obvious predicate — "refuse if org_unit_id changed while an open assignment exists" — is WRONG,
-- and would deadlock the system against itself. `sync_employee_current_unit()` (20260820150000) exists
-- precisely to write a CHANGED org_unit_id onto employees after a legitimate transfer, and an open
-- assignment exists at that moment by construction. That predicate would refuse the transfer flow.
--
-- The correct question is not "did it change?" but "does it AGREE with the assignment record?":
--
--     refuse when an open assignment exists AND the new pointer disagrees with it
--
--   * sync trigger writing Y, open assignment is Y      -> agrees   -> ALLOWED
--   * direct write to Z, open assignment is X           -> disagrees -> REFUSED
--   * hire / draft with no open assignment yet          -> nothing to disagree with -> ALLOWED
--   * any UPDATE that does not touch org_unit_id        -> unchanged -> ALLOWED
--
-- This also means the guard is self-maintaining: it never needs to know WHICH code path is writing,
-- only whether the result is consistent with the audit trail.
--
-- ── 2. Why the opening assignment is a trigger, not an edit to the RPC ───────
-- `create_employee_transaction` is ~5KB and is not the only INSERT into `employees` (recovery flows
-- and any future importer also write it). A trigger covers every writer, present and future, and
-- avoids re-transcribing a large function to add four lines — the same argument as 20260820170000.
--
-- Termination: opening an assignment fires `employee_unit_assignment_sync`, which UPDATEs
-- `employees.org_unit_id` to the SAME value. That update re-enters the guard (agrees -> allowed) and
-- re-enters this trigger's UPDATE branch, which finds an open assignment and does nothing. Depth 2,
-- terminating on a value comparison rather than on a flag.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
--   DROP TRIGGER IF EXISTS employees_org_unit_assignment_guard ON public.employees;
--   DROP TRIGGER IF EXISTS employees_open_unit_assignment ON public.employees;
--   DROP FUNCTION IF EXISTS public.guard_employee_org_unit_write();
--   DROP FUNCTION IF EXISTS public.open_initial_unit_assignment();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. The guard
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_employee_org_unit_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  open_unit    uuid;
  has_open_row boolean;
BEGIN
  IF NEW.org_unit_id IS NOT DISTINCT FROM OLD.org_unit_id THEN
    RETURN NEW;
  END IF;

  -- SECURITY DEFINER: read the TRUE assignment state. Under the invoking role,
  -- employee_unit_assignments RLS could hide the open row, the guard would conclude "no assignment
  -- exists" and wave through exactly the write it is meant to refuse.
  SELECT a.org_unit_id, true
    INTO open_unit, has_open_row
  FROM public.employee_unit_assignments a
  WHERE a.employee_id = NEW.id
    AND a.effective_to IS NULL
  ORDER BY a.effective_from DESC
  LIMIT 1;

  IF NOT COALESCE(has_open_row, false) THEN
    -- No assignment history yet (hire, or a draft never assigned). Nothing to contradict.
    RETURN NEW;
  END IF;

  IF NEW.org_unit_id IS DISTINCT FROM open_unit THEN
    RAISE EXCEPTION
      'Direct change of employees.org_unit_id is not allowed while an open unit assignment exists. Record a transfer against employee_unit_assignments instead — it captures the effective date, the reason and an audit entry, and the pointer is then synced automatically. (employee=%, attempted=%, open assignment=%)',
      NEW.id, NEW.org_unit_id, open_unit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_org_unit_assignment_guard ON public.employees;
CREATE TRIGGER employees_org_unit_assignment_guard
  BEFORE UPDATE OF org_unit_id ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_employee_org_unit_write();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. The opening assignment
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.open_initial_unit_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.org_unit_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only ever OPENS a first assignment. It never closes or rewrites one, so it cannot fabricate a
  -- transfer: a genuine move still has to go through the transfer flow and be refused by the guard
  -- above if it does not.
  IF EXISTS (
    SELECT 1 FROM public.employee_unit_assignments a
    WHERE a.employee_id = NEW.id AND a.effective_to IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.employee_unit_assignments
    (tenant_id, employee_id, org_unit_id, effective_from, reason)
  VALUES
    (NEW.tenant_id, NEW.id, NEW.org_unit_id,
     -- date_of_joining is the truthful start of membership when it is known and not in the future;
     -- the trigger keys on `effective_to IS NULL`, not on the date, so a future date would still take
     -- effect immediately and misreport history. CURRENT_DATE otherwise.
     LEAST(COALESCE(NEW.date_of_joining, CURRENT_DATE), CURRENT_DATE),
     CASE WHEN TG_OP = 'INSERT' THEN 'hire' ELSE 'initial' END);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_open_unit_assignment ON public.employees;
CREATE TRIGGER employees_open_unit_assignment
  AFTER INSERT OR UPDATE OF org_unit_id ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.open_initial_unit_assignment();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Backfill: anyone holding a pointer with no assignment history
-- Live data at author time: 0 such employees, so this is a no-op today. Written so a replay onto a
-- project that HAS them converges, and so the guard cannot start refusing writes for an employee
-- whose history was never created.
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO public.employee_unit_assignments
  (tenant_id, employee_id, org_unit_id, effective_from, reason)
SELECT e.tenant_id, e.id, e.org_unit_id,
       LEAST(COALESCE(e.date_of_joining, CURRENT_DATE), CURRENT_DATE),
       'backfill'
FROM public.employees e
WHERE e.org_unit_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.employee_unit_assignments a
    WHERE a.employee_id = e.id AND a.effective_to IS NULL
  );

-- ── Verify after applying ────────────────────────────────────────────────────
--   -- every employee with a unit must now have exactly one open assignment (expect 0):
--   SELECT count(*) FROM employees e WHERE e.org_unit_id IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM employee_unit_assignments a
--                     WHERE a.employee_id = e.id AND a.effective_to IS NULL);
--
--   -- a direct move must be REFUSED:
--   UPDATE employees SET org_unit_id = (SELECT id FROM org_units WHERE id <> employees.org_unit_id
--                                       AND tenant_id = employees.tenant_id LIMIT 1)
--   WHERE org_unit_id IS NOT NULL LIMIT 1;      -- expect check_violation
--
--   -- the transfer flow must still SUCCEED (close the open row, then insert a new one).
