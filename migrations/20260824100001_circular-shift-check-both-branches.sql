-- Follow-up to 20260824100000 (Phase 0). Forward-only fix for a real gap found in that
-- migration's own assertion block, not a schema change.
--
-- THE GAP: 20260824100000's Probe 3 proved shifts_circular_shift_check REJECTS an
-- oversized shift, but only via the CROSS-MIDNIGHT branch of the CASE
-- (`end_time <= start_time -> + 1440`). Its Probe 4 proved crosses_midnight = false for a
-- non-crossing shift, but never inserted a crossing shift to prove crosses_midnight = true,
-- and no probe proved the CHECK's non-crossing (ELSE) branch rejects an oversized shift on
-- its own -- only that ordinary-length non-crossing shifts pass (implicitly, via the 5
-- existing non-crossing rows surviving ALTER TABLE ADD CONSTRAINT when that migration
-- applied). Implicit survival of ordinary-length rows is not the same as an explicit assertion
-- that the ELSE branch's arithmetic rejects an oversized one, or that crosses_midnight ever
-- reads true. A future edit to that CASE could invert or drop a branch and every assertion in
-- 20260824100000 would still pass.
--
-- 20260824100000 is already applied -- migrations are forward-only (repo rule), so this adds
-- the missing coverage as its own probe rather than editing that file.
--
-- No schema change. This migration is exactly one DO block.
DO $check$
DECLARE
  v_tenant        uuid;
  v_constraint    text;
  v_crossing_id   uuid;
  v_row           record;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no tenant found to run the follow-up probes against -- investigate';
  END IF;

  -- --------------------------------------------------------------------
  -- Probe 5: a genuinely crossing shift, well inside the limit, is ACCEPTED, and
  -- crosses_midnight reads true for it -- 20260824100000's Probe 4 only ever inserted a
  -- non-crossing shift, so crosses_midnight = true was never actually observed.
  -- 18:00-05:00 mirrors the real "Night Shift" verified pre-20260824100000 (660 scheduled
  -- minutes + 60 + 60 margins = 780, well under 1440).
  -- --------------------------------------------------------------------
  BEGIN
    INSERT INTO public.shifts (tenant_id, name, start_time, end_time)
    VALUES (v_tenant, 'Cross-midnight accept probe (rolled back)', '18:00', '05:00')
    RETURNING id INTO v_crossing_id;

    SELECT * INTO v_row FROM public.shifts WHERE id = v_crossing_id;

    IF v_row.crosses_midnight IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'crosses_midnight computed % for an 18:00-05:00 shift, expected true', v_row.crosses_midnight;
    END IF;

    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    RAISE NOTICE 'Probe 5 verified: an 18:00-05:00 shift (780-minute effective span, under 1440) is ACCEPTED by shifts_circular_shift_check, and crosses_midnight = true';
  END;

  -- --------------------------------------------------------------------
  -- Probe 6: a NON-crossing shift with an oversized raw span is REJECTED by the ELSE
  -- branch of the same CASE, on its own arithmetic -- not inferred from existing rows
  -- surviving the original ALTER TABLE. 00:00-23:00 is 1380 raw minutes (non-crossing,
  -- since end_time > start_time); + the default 60/60 margins = 1500 >= 1440.
  -- --------------------------------------------------------------------
  BEGIN
    INSERT INTO public.shifts (tenant_id, name, start_time, end_time)
    VALUES (v_tenant, 'Non-crossing reject probe (rolled back)', '00:00', '23:00');

    RAISE EXCEPTION 'circular shift CHECK did not fire on the non-crossing branch: a 1500-minute effective shift (1380 scheduled + 60 + 60 margins, end_time > start_time) was accepted';
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint <> 'shifts_circular_shift_check' THEN
        RAISE EXCEPTION 'shift was rejected, but by constraint % instead of shifts_circular_shift_check', v_constraint;
      END IF;
      RAISE NOTICE 'Probe 6 verified: a non-crossing shift with a 1500-minute effective span (>= 1440) is REJECTED by shifts_circular_shift_check''s ELSE branch on its own arithmetic';
  END;

  RAISE NOTICE 'Follow-up assertions complete: both branches of shifts_circular_shift_check independently proven to accept-when-small and reject-when-oversized; crosses_midnight observed true and false.';
END
$check$;
