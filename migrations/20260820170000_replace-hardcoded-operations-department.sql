-- Removes the last three server-side uses of a hardcoded department NAME as a stand-in for "the HR
-- team". This is 06 §2.3 — the hardcoding defect in its purest form — living in SQL rather than in
-- the SPA, where the two frontend copies were already fixed.
--
-- ── The defect ───────────────────────────────────────────────────────────────
-- Three functions decide who to notify (or who may read) with:
--
--   AND e.department = 'operations'
--
-- 06 §2.3 on the identical frontend pattern: "A tenant with no department literally named
-- `operations` (lowercase) notifies NOBODY, silently."
--
-- That is no longer hypothetical. `employees.department` was realigned to the org unit's NAME by
-- 20260818100000 and is now kept there by 20260820150000's trigger. Live values are `Sales`, `Dev`,
-- `Hr`, `Design`, `Product`, `Marketing` — capitalised unit names, and **not one tenant of the twelve
-- has a unit named `operations`**. So all three predicates currently match ZERO rows:
--
--   * employee_apply_leave_request            — nobody is notified of a new leave request
--   * create_policy_notifications_transaction — nobody is notified of an hr_only policy
--   * get_hr_policy_library                   — nobody can see hr_only policies
--
-- In employee_apply_leave_request the INSERT is wrapped in `EXCEPTION WHEN OTHERS THEN NULL`, so
-- even a hard failure there would be swallowed. It fails silently by construction.
--
-- ── The fix ──────────────────────────────────────────────────────────────────
-- `e.role = 'hr'::user_role`, which is what the predicate was always trying to express. This is the
-- resolver already established server-side: submit_task_request's final fallback (20260820090000) is
-- "every active `role = 'hr'` employee in the tenant". Live data: 3 active hr, 11 active employee.
--
-- Not `is_hr()`: that reads the CALLER's identity from the JWT. These predicates select a SET OF
-- RECIPIENTS by row, which is a different question — is_hr() would be wrong here, not merely stricter.
--
-- ── Authorisation delta a reviewer must accept ───────────────────────────────
-- get_hr_policy_library is a VISIBILITY function, so this is a real access-control change:
-- `visible_to = 'hr_only'` policies become readable by role-hr employees. Today they are readable by
-- nobody, so this is a widening from an empty set — but it is a widening, and it is the documented
-- intent of the `hr_only` setting. The other two are notification fan-out only.
--
-- ── Why a scripted replacement instead of CREATE OR REPLACE ──────────────────
-- These three bodies total ~12KB. Re-typing them to change one predicate each risks a silent
-- behavioural change somewhere in the other 12KB — the exact failure mode this module exists to stop.
-- The DO block below instead takes each function's CURRENT definition, asserts the target literal
-- appears EXACTLY ONCE, swaps only that literal, and re-executes. Everything else is preserved
-- byte-for-byte, and a drifted or already-fixed function raises instead of being silently rewritten.
-- Replay-safe: on a fresh project the earlier migrations create these functions with the literal
-- still present, so this converges there too.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Re-run the same block with the two literals swapped (search 'hr'::user_role, replace with the
-- department test). Or replay migrations/20260814160000 and /20260813081600 for the original bodies.

DO $do$
DECLARE
  target_fn   text;
  fn_oid      oid;
  fn_def      text;
  new_def     text;
  hit_count   integer;
  old_literal text := 'e.department = ''operations''';
  new_literal text := 'e.role = ''hr''::user_role';
BEGIN
  FOREACH target_fn IN ARRAY ARRAY[
    'employee_apply_leave_request',
    'create_policy_notifications_transaction',
    'get_hr_policy_library'
  ] LOOP
    -- prokind='f' excludes aggregates, on which pg_get_functiondef() errors.
    SELECT p.oid INTO fn_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = target_fn;

    IF fn_oid IS NULL THEN
      RAISE EXCEPTION 'Expected function public.%() not found — refusing to continue.', target_fn;
    END IF;

    fn_def := pg_get_functiondef(fn_oid);

    hit_count := (length(fn_def) - length(replace(fn_def, old_literal, ''))) / length(old_literal);
    IF hit_count <> 1 THEN
      RAISE EXCEPTION
        'public.%() contains the literal % time(s), expected exactly 1. The function has drifted from what this migration was written against — review it by hand rather than letting this rewrite it.',
        target_fn, hit_count;
    END IF;

    new_def := replace(fn_def, old_literal, new_literal);
    EXECUTE new_def;

    RAISE NOTICE 'Repointed public.%() from department=''operations'' to role=''hr''.', target_fn;
  END LOOP;
END
$do$;

-- ── Verify after applying ────────────────────────────────────────────────────
--   -- must be ZERO rows:
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prokind = 'f'
--     AND pg_get_functiondef(p.oid) LIKE '%department = ''operations''%';
--
--   -- and all three must now carry the role test (expect 3 rows):
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prokind = 'f'
--     AND pg_get_functiondef(p.oid) LIKE '%role = ''hr''::user_role%';
