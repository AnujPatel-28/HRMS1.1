-- Closes the last drift pathway into `employees.department` by making the existing assignment-sync
-- trigger maintain the legacy text column alongside the FK pointer it already maintains.
--
-- ── The gap this closes ──────────────────────────────────────────────────────
-- `sync_employee_current_unit()` keeps `employees.org_unit_id` pointing at the open
-- `employee_unit_assignments` row. It does NOT touch `employees.department`, the legacy text copy of
-- the same fact. So every transfer moved the FK and left the text stale — reintroducing exactly the
-- drift that 20260818100000 backfilled away (06 §2.1: 7 of 16 employees contradicted).
--
-- That was survivable while the edit form also wrote the text column. It is not any more: the
-- Department select in EmployeeDetail became read-only in this same session (06 §3.5 — unit
-- membership is effective-dated, the pointer is trigger-owned), so **Transfer is now the only way to
-- change an employee's unit**. Without this migration the drift would be guaranteed rather than
-- occasional.
--
-- ── Why that matters more than it looks ──────────────────────────────────────
-- `employees.department` is still READ in roughly 100 places across ~25 files — every employee card,
-- badge, directory row, payslip PDF, org-chart node, shift table and payroll filter in the product.
-- A stale text column does not fail loudly; it renders the employee's OLD department everywhere,
-- indefinitely. Migrating those ~100 sites onto `org_unit_id` is 06 §5 steps 5-6 and is a large piece
-- of frontend work (it is also gated behind the six-value `DEPT_OPTIONS` list hardcoded in 8 files).
-- This trigger keeps every one of them CORRECT in the meantime, with no frontend change at all.
--
-- ── Why the database and not the client ──────────────────────────────────────
-- 06 §3.5, verbatim: "kept in sync by trigger, not by application code (the dual-write in §2.1 is
-- what application-managed sync produces)". Putting this in submitTransfer would be a new dual-write
-- in the module whose purpose is removing dual-writes, and it would miss every other writer.
--
-- ── Explicitly temporary ─────────────────────────────────────────────────────
-- This is scaffolding for a column that is scheduled to be dropped (06 §5 step 6). When
-- `employees.department` is dropped, drop the `department = COALESCE(...)` clause from the UPDATE
-- below; the trailing backfill becomes moot at the same time. Nothing else in this file needs
-- unwinding — it is deliberately additive so removal is a clean revert.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Re-run the CREATE OR REPLACE FUNCTION block from
-- migrations/20260818140000_employee-unit-assignments-history.sql. The trigger itself is unchanged.

-- Live data at author time: 12 of 16 employees have an org_unit_id and 0 are misaligned with their
-- unit's name, so the backfill at the end of this file is a no-op today. It is written anyway so a
-- replay onto a project that HAS drifted converges.

CREATE OR REPLACE FUNCTION public.sync_employee_current_unit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  target_employee uuid;
  current_unit    uuid;
BEGIN
  target_employee := CASE WHEN TG_OP = 'DELETE' THEN OLD.employee_id ELSE NEW.employee_id END;

  -- An UPDATE that closes a row (sets effective_to) must not move the pointer — 20260818140000's
  -- shape, preserved: only the open row decides. Resolving through a variable keeps the DELETE and
  -- INSERT/UPDATE paths on one code path and, unlike `UPDATE ... FROM (subquery)`, still runs the
  -- UPDATE when there is no open row left (leaving a dangling pointer is the bug that shape causes).
  IF TG_OP <> 'DELETE' AND NEW.effective_to IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.org_unit_id INTO current_unit
  FROM public.employee_unit_assignments a
  WHERE a.employee_id = target_employee
    AND a.effective_to IS NULL
  ORDER BY a.effective_from DESC
  LIMIT 1;

  UPDATE public.employees e
  SET org_unit_id = current_unit,
      -- Both columns derive from the SAME resolved unit, so they cannot disagree. COALESCE keeps the
      -- last known text when there is no open assignment: the pointer truthfully goes NULL, but
      -- blanking the text would empty the department label on ~100 read sites.
      department = COALESCE(
        (SELECT ou.name FROM public.org_units ou WHERE ou.id = current_unit),
        e.department
      )
  WHERE e.id = target_employee;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- Converge any row whose text already drifted from its unit. Case-preserving: the unit name is the
-- source of truth, so the text becomes the unit's name exactly.
UPDATE public.employees e
SET department = ou.name
FROM public.org_units ou
WHERE ou.id = e.org_unit_id
  AND e.department IS DISTINCT FROM ou.name;

-- ── Verify after applying ────────────────────────────────────────────────────
--   -- must be 0:
--   SELECT count(*) FROM employees e JOIN org_units ou ON ou.id = e.org_unit_id
--   WHERE e.department IS DISTINCT FROM ou.name;
--
--   -- and after a transfer through the UI, the text must follow the pointer:
--   SELECT e.department, ou.name FROM employees e JOIN org_units ou ON ou.id = e.org_unit_id
--   WHERE e.id = '<transferred employee>';
