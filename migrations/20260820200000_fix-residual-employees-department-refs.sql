-- Corrects two references to `employees.department` that 20260820190000 MISSED before dropping the
-- column. Both are latent runtime failures, not compile errors: PL/pgSQL does not resolve record
-- fields or query columns until the statement actually executes, so a function referencing a dropped
-- column stays installable and fails only when that code path is first reached.
--
-- ── Correction to 20260820190000's header ────────────────────────────────────
-- That migration states create_policy_notifications_transaction "reads hr_policies.department_filter
-- for a title string; it never reads employees.department". **That is wrong.** It does both: the
-- title uses the policy's own column, but its recipient query also carries the legacy
-- `e.department = v_department_filter` branch. The claim came from a grep that only looked at the
-- first few matching lines. Migrations are forward-only, so the error is corrected here rather than
-- by editing the applied file.
--
-- ── What was missed and why ──────────────────────────────────────────────────
-- The audit that drove 20260820190000 searched for `e.department`, `employees.department`,
-- `target.department` and `p_department`. It found neither of these:
--
--   1. enforce_employee_update_restrictions — uses `OLD.department` / `NEW.department`. A TRIGGER on
--      `employees`, so this one would have fired on an ordinary employee UPDATE. It survived the
--      drop only because PL/pgSQL compiles a row expression lazily, per session, on first execution.
--   2. create_policy_notifications_transaction — the alias is `e`, but the audit's own results were
--      truncated before this line, so it was recorded as clean.
--
-- The lasting lesson, and the query that would have caught both:
--
--   SELECT p.proname, substring(pg_get_functiondef(p.oid) from '[A-Za-z_]+\.department[^_a-zA-Z]')
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prokind = 'f'
--     AND pg_get_functiondef(p.oid) ~ '[A-Za-z_]+[.]department[^_a-zA-Z]';
--
-- Search by COLUMN NAME across every alias, never by the aliases you happen to expect. Run it before
-- dropping any column, and again after.
--
-- ── The two fixes ────────────────────────────────────────────────────────────
-- 1. enforce_employee_update_restrictions guards a list of fields an employee may not self-edit.
--    `department` is simply removed from that list — no protection is lost, because `org_unit_id`
--    (the column that actually holds unit membership now) is already guarded two lines above it, and
--    since 20260820180000 it cannot be changed by a direct write at all.
-- 2. create_policy_notifications_transaction loses its legacy name-matching recipient branch, exactly
--    as its three sibling policy functions did in 20260820190000. Consequence: a policy targeted by
--    department NAME rather than by `org_unit_id` notifies nobody — it fails CLOSED. Vacuous today
--    (`hr_policies` holds 1 row, `visible_to = 'all'`).
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Meaningless in isolation: the column these referenced no longer exists. Restoring them requires
-- rolling back 20260820190000 first.

DO $do$
DECLARE
  spec       record;
  fn         record;
  fn_def     text;
  hits       integer;
  total_hits integer;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('enforce_employee_update_restrictions',
       E'     OLD.department IS DISTINCT FROM NEW.department OR\n',
       ''),
      ('create_policy_notifications_transaction',
       '(v_org_unit_id IS NULL AND v_department_filter IS NOT NULL AND e.department = v_department_filter)',
       '(false)')
    ) AS t(fn_name, old_snip, new_snip)
  LOOP
    total_hits := 0;

    FOR fn IN
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = spec.fn_name
    LOOP
      fn_def := pg_get_functiondef(fn.oid);
      hits := (length(fn_def) - length(replace(fn_def, spec.old_snip, ''))) / length(spec.old_snip);

      IF hits <> 1 THEN
        RAISE EXCEPTION
          'public.%() contains its target snippet % time(s), expected 1. Review by hand rather than letting this rewrite it. Snippet: %',
          spec.fn_name, hits, left(spec.old_snip, 80);
      END IF;

      EXECUTE replace(fn_def, spec.old_snip, spec.new_snip);
      total_hits := total_hits + hits;
    END LOOP;

    IF total_hits = 0 THEN
      RAISE EXCEPTION 'No function named public.%() was found — refusing to continue.', spec.fn_name;
    END IF;

    RAISE NOTICE 'public.%(): replaced % occurrence(s).', spec.fn_name, total_hits;
  END LOOP;
END
$do$;

-- ── Verify after applying ────────────────────────────────────────────────────
--   -- expect ONLY seed_exit_clearances (t.department = the exit-clearance stage, unrelated):
--   SELECT p.proname, substring(pg_get_functiondef(p.oid) from '[A-Za-z_]+\.department[^_a-zA-Z]')
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prokind = 'f'
--     AND pg_get_functiondef(p.oid) ~ '[A-Za-z_]+[.]department[^_a-zA-Z]';
--
--   -- and the trigger path must survive a real employee UPDATE:
--   UPDATE employees SET updated_at = now() WHERE id = (SELECT id FROM employees LIMIT 1);
