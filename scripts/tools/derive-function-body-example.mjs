// EXAMPLE of the "derive, never rewrite" pattern (C5, 2026-09-23). It produced migration
// 20260912196000 from LIVE function bodies; that migration is applied and immutable, so the output
// now goes to scratch/. Copy this file for a new package and change the anchors.
// Every edit is an exact, once-only anchor replacement; a missing/duplicate anchor aborts.
import { runSql } from "../../tests/m1m2/_harness.mjs";
import { writeFileSync } from "node:fs";

const def = (sig) => runSql(`select pg_get_functiondef('public.${sig}'::regprocedure) d`).rows[0].d.trimEnd();
function sub(body, from, to, label) {
  // Some live bodies are stored with CRLF (pass1 was written from Windows); match the body's own EOL.
  if (body.includes("\r\n")) { from = from.replace(/\r?\n/g, "\r\n"); to = to.replace(/\r?\n/g, "\r\n"); }
  const n = body.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: anchor found ${n} times`);
  return body.replace(from, to);
}

// ── employee_apply_leave_request: new signature (+ p_half_day_session) ─────────────────────────
let apply = def("employee_apply_leave_request(uuid,uuid,date,date,text)");
apply = sub(apply,
  "employee_apply_leave_request(p_tenant_id uuid, p_leave_type_id uuid, p_start_date date, p_end_date date, p_reason text)",
  "employee_apply_leave_request(p_tenant_id uuid, p_leave_type_id uuid, p_start_date date, p_end_date date, p_reason text, p_half_day_session text DEFAULT NULL::text)",
  "apply signature");
apply = sub(apply, "  v_total_days integer := 0;", "  v_total_days numeric := 0;\n  v_day_fraction numeric := 1;", "apply decl");
apply = sub(apply,
  "  IF v_total_days = 0 THEN\n    RAISE EXCEPTION 'The selected date range contains no working days';\n  END IF;",
  `  IF v_total_days = 0 THEN
    RAISE EXCEPTION 'The selected date range contains no working days';
  END IF;

  -- C5: half-day leave -- one working day, a type that allows it, and a named half.
  IF p_half_day_session IS NOT NULL THEN
    IF p_half_day_session NOT IN ('first', 'second') THEN
      RAISE EXCEPTION 'Half-day session must be first or second';
    END IF;
    IF p_start_date <> p_end_date THEN
      RAISE EXCEPTION 'A half-day leave must be a single day';
    END IF;
    IF NOT COALESCE(v_leave_type.allow_half_day, false) THEN
      RAISE EXCEPTION '% does not allow half-day leave', v_leave_type.name;
    END IF;
    v_day_fraction := 0.5;
    v_total_days := 0.5;
  END IF;`, "apply half-day block");
apply = sub(apply,
  "    tenant_id, employee_id, leave_type_id, leave_type, start_date,\n    end_date, total_days, reason, status\n  )",
  "    tenant_id, employee_id, leave_type_id, leave_type, start_date,\n    end_date, total_days, reason, status, day_fraction, half_day_session\n  )",
  "apply insert cols");
apply = sub(apply,
  "    p_start_date, p_end_date, v_total_days, trim(p_reason), 'pending'\n  )",
  "    p_start_date, p_end_date, v_total_days, trim(p_reason), 'pending', v_day_fraction, p_half_day_session\n  )",
  "apply insert values");

// ── approve_leave_request: same signature; half-day deducts day_fraction, marks half_day ────────
let approve = def("approve_leave_request(uuid,date[],integer)");
approve = sub(approve, "  v_approved_business_days integer := 0;", "  v_approved_business_days numeric := 0;", "approve decl");
approve = sub(approve,
  "  IF v_approved_business_days = 0 THEN\n    RAISE EXCEPTION 'The selected leave range contains no working days';\n  END IF;",
  `  IF v_approved_business_days = 0 THEN
    RAISE EXCEPTION 'The selected leave range contains no working days';
  END IF;

  -- C5: a half-day leave deducts and records its fraction (0.5), not a whole day.
  IF v_leave.day_fraction < 1 THEN
    v_approved_business_days := v_approved_business_days * v_leave.day_fraction;
  END IF;`, "approve scale");
approve = sub(approve,
  "VALUES (v_leave.tenant_id, v_leave.employee_id, v_date, v_shift_id, NULL, 'on_leave', true, 'closed', p_leave_id, 'leave')",
  "VALUES (v_leave.tenant_id, v_leave.employee_id, v_date, v_shift_id, NULL, CASE WHEN v_leave.day_fraction < 1 THEN 'half_day' ELSE 'on_leave' END, true, 'closed', p_leave_id, 'leave')",
  "approve values");
approve = sub(approve, "    DO UPDATE SET status = 'on_leave',", "    DO UPDATE SET status = EXCLUDED.status,", "approve on conflict");

// ── attendance_derive_pass1: the leave half excuses late entry / early exit ─────────────────────
let pass1 = def("attendance_derive_pass1(uuid,uuid,date,date,uuid)");
pass1 = sub(pass1, "  v_leave_day_fraction    numeric;", "  v_leave_day_fraction    numeric;\n  v_leave_session         text;", "pass1 decl");
pass1 = sub(pass1,
  "    v_leave_day_fraction := NULL;\n    SELECT l.id, l.day_fraction INTO v_leave_id, v_leave_day_fraction",
  "    v_leave_day_fraction := NULL;\n    v_leave_session := NULL;\n    SELECT l.id, l.day_fraction, l.half_day_session INTO v_leave_id, v_leave_day_fraction, v_leave_session",
  "pass1 leave select");
pass1 = sub(pass1,
  "    IF v_leave_id IS NOT NULL THEN\n      v_status := CASE WHEN v_leave_day_fraction < 1 THEN 'half_day' ELSE 'on_leave' END;\n    END IF;",
  `    IF v_leave_id IS NOT NULL THEN
      v_status := CASE WHEN v_leave_day_fraction < 1 THEN 'half_day' ELSE 'on_leave' END;
    END IF;

    -- C5: a first-half leave explains a late arrival, a second-half leave an early exit.
    IF v_leave_session = 'first' THEN
      v_late_entry := false;
    ELSIF v_leave_session = 'second' THEN
      v_early_exit := false;
    END IF;`, "pass1 flags");

const sql = `-- migration: C5 -- half-day leave
-- Source: prompts/c2_c6_cleanup_packages_2026-09-22.md, C5 section (user decision 2026-09-22).
--
-- Measured 2026-09-23: leaves.day_fraction exists (all 7 rows = 1.0) and both derivation passes
-- already map day_fraction < 1 -> 'half_day', but nothing could write it. leaves.total_days and
-- approved_business_days were INTEGER (0.5 impossible); leave_balances.* already numeric. Readers
-- of those two columns (pg_proc sweep): only apply/approve/cancel; no views; frontend displays only.
--
-- 1. leaves.total_days / approved_business_days -> numeric (widening; existing integers unchanged).
-- 2. leave_types.allow_half_day (HR-configurable, default off).
-- 3. leaves.half_day_session ('first'|'second') + a shape CHECK tying it to day_fraction.
-- 4. employee_apply_leave_request: NEW signature (+ p_half_day_session DEFAULT NULL). Old exact
--    signature DROPPED first (no overload); the DEFAULT keeps 5-argument callers working.
-- 5. approve_leave_request: deducts/records day_fraction, writes 'half_day' for a half-day leave.
-- 6. attendance_derive_pass1: first-half leave clears late_entry, second-half clears early_exit
--    (otherwise every half-day leave produced a false late mark / early exit).
-- cancel_leave_request needs no change: it credits approved_business_days (now 0.5) and C4
-- re-derives the day. All bodies are live pg_get_functiondef() output with anchored edits only.
-- No BEGIN/COMMIT: the CLI wraps each migration in its own transaction.

ALTER TABLE public.leaves ALTER COLUMN total_days TYPE numeric USING total_days::numeric;
ALTER TABLE public.leaves ALTER COLUMN approved_business_days TYPE numeric USING approved_business_days::numeric;

ALTER TABLE public.leave_types ADD COLUMN allow_half_day boolean NOT NULL DEFAULT false;

ALTER TABLE public.leaves ADD COLUMN half_day_session text;
ALTER TABLE public.leaves ADD CONSTRAINT leaves_half_day_shape CHECK (
  (day_fraction = 1 AND half_day_session IS NULL)
  OR (day_fraction = 0.5 AND half_day_session IN ('first', 'second') AND start_date = end_date)
);

DROP FUNCTION public.employee_apply_leave_request(uuid, uuid, date, date, text);
${apply};
REVOKE ALL ON FUNCTION public.employee_apply_leave_request(uuid, uuid, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_apply_leave_request(uuid, uuid, date, date, text, text) TO authenticated;

${approve};

${pass1};

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['employee_apply_leave_request', 'approve_leave_request', 'attendance_derive_pass1'] LOOP
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = fn) <> 1 THEN
      RAISE EXCEPTION 'C5: expected exactly one pg_proc row for %', fn;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.employee_apply_leave_request(uuid,uuid,date,date,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'C5: anon must not execute employee_apply_leave_request';
  END IF;
END $$;
`;
writeFileSync("scratch/derived-migration.sql", sql);
console.log("written", sql.length, "bytes");
