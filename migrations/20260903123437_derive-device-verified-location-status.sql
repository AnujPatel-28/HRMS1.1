-- Labels device- and kiosk-derived days 'device_verified'.
--
-- The audit said device punches "bypass every verification setting". That is the wrong frame, and
-- this migration records the right one. A fixed biometric terminal has no GPS to fence and no
-- camera prompt to answer -- its physical presence at a site IS the verification. Forcing the app's
-- checks onto it would simply break the kiosk.
--
-- What was actually missing is that such a day was indistinguishable from an unverified one:
-- device_ingest_punch writes an attendance EVENT and derivation creates the row, so location_status
-- was never set at all on a device-only day. Now Pass 1 sets it, and HR can tell the two apart.
--
-- A MIXED day -- some events from a device, some from the app -- is deliberately left NULL rather
-- than claimed as either. `sources <@ ARRAY['device','kiosk']` is true only when every event in the
-- group came from a terminal.
--
-- COALESCE(v_loc_status, location_status) on the update branch means a re-derivation never erases a
-- status the punch path established for an app day.
--
-- The remaining honest gap: nothing binds a device to a FENCED site. attendance_devices.location_id
-- references `locations`, the org-module table, which has no coordinates -- the geofence lives in
-- office_locations. Converging those two tables is still open.

CREATE OR REPLACE FUNCTION public.attendance_derive_pass1(p_tenant_id uuid, p_shift_id uuid, p_from date, p_to date, p_run_id uuid)
 RETURNS TABLE(groups_processed integer, rows_created integer, rows_updated integer, rows_skipped integer, events_processed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_loc_status            text;
  v_tz                  text;
  v_shift                public.shifts%ROWTYPE;
  v_group                record;
  v_calc                 record;
  v_holiday               record;
  v_absent_threshold      numeric;
  v_half_day_threshold    numeric;
  v_local_date            date;
  v_status                text;
  v_late_entry            boolean;
  v_early_exit            boolean;
  v_leave_id              uuid;
  v_leave_day_fraction    numeric;
  v_shift_snapshot        jsonb;
  v_policy_snapshot       jsonb;
  v_existing_id           uuid;
  v_existing_locked       boolean;
  v_existing_version      integer;
  v_att_id                uuid;
  v_groups_processed      integer := 0;
  v_rows_created          integer := 0;
  v_rows_updated          integer := 0;
  v_rows_skipped          integer := 0;
  v_events_processed      integer := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_shift_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_run_id IS NULL THEN
    RAISE EXCEPTION 'attendance_derive_pass1: all five parameters are required';
  END IF;

  -- Binding rule 1: definer bypasses RLS; restore the tenant fence and the module gate by hand.
  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden: tenant not accessible';
  END IF;

  IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance')) THEN
    RAISE EXCEPTION 'attendance module not enabled for tenant %', p_tenant_id;
  END IF;

  -- E42: advisory lock per (tenant, shift), auto-released at transaction end.
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text), hashtext(p_shift_id::text));

  SELECT * INTO v_shift FROM public.shifts s WHERE s.id = p_shift_id AND s.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift % not found for tenant %', p_shift_id, p_tenant_id;
  END IF;

  SELECT COALESCE(t.timezone, 'Asia/Kolkata') INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'tenant % not found', p_tenant_id;
  END IF;

  v_shift_snapshot := to_jsonb(v_shift);

  FOR v_group IN
    SELECT e.employee_id,
           e.shift_start,
           MIN(e.shift_end) AS shift_end,
           jsonb_agg(jsonb_build_object('event_time', e.event_time, 'direction', e.direction) ORDER BY e.event_time) AS events,
           array_agg(e.id) AS event_ids,
           array_agg(DISTINCT e.source) AS sources
    FROM public.attendance_events e
    WHERE e.tenant_id = p_tenant_id
      AND e.shift_id = p_shift_id
      AND e.attendance_id IS NULL
      AND e.skip_derivation = false
      AND e.offshift = false
      AND e.superseded_by_id IS NULL
      AND e.shift_start IS NOT NULL
      AND (e.shift_start AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to
    GROUP BY e.employee_id, e.shift_start
  LOOP
    v_groups_processed := v_groups_processed + 1;
    v_events_processed := v_events_processed + COALESCE(array_length(v_group.event_ids, 1), 0);
    v_local_date := (v_group.shift_start AT TIME ZONE v_tz)::date;

    SELECT * INTO v_holiday
    FROM public.work_calendar_holiday(p_tenant_id, v_group.employee_id, v_local_date);

    -- Holiday overrides derivation entirely unless the shift opts in (§2.6 / §7 E24). Events
    -- stay queued (attendance_id untouched) for a human or a future opt-in to resolve.
    IF v_holiday.is_holiday AND NOT v_shift.mark_attendance_on_holidays THEN
      v_rows_skipped := v_rows_skipped + 1;
      CONTINUE;
    END IF;

    -- §2.2: a half-day holiday halves BOTH thresholds.
    v_absent_threshold   := v_shift.working_hours_threshold_for_absent;
    v_half_day_threshold := v_shift.working_hours_threshold_for_half_day;
    IF v_holiday.is_holiday AND v_holiday.is_half_day THEN
      v_absent_threshold   := v_absent_threshold / 2;
      v_half_day_threshold := v_half_day_threshold / 2;
    END IF;

    SELECT * INTO v_calc
    FROM public.attendance_calculate_working_hours(
      v_group.events, v_shift.determine_check_in_and_check_out, v_shift.working_hours_calculation_based_on
    );

    -- D6: late_entry/early_exit are independent flags, never statuses.
    v_late_entry := v_shift.enable_late_entry_marking
      AND v_calc.in_time IS NOT NULL
      AND v_calc.in_time > (v_group.shift_start + make_interval(mins => v_shift.late_entry_grace_minutes));
    v_early_exit := v_shift.enable_early_exit_marking
      AND v_calc.out_time IS NOT NULL
      AND v_calc.out_time < (v_group.shift_end - make_interval(mins => v_shift.early_exit_grace_minutes));

    -- D6: absent threshold checked FIRST.
    IF v_calc.hours < v_absent_threshold THEN
      v_status := 'absent';
    ELSIF v_calc.hours < v_half_day_threshold THEN
      v_status := 'half_day';
    ELSE
      v_status := 'present';
    END IF;

    -- D8: approved leave overrides the derived status. E23 (fixed here): a leave with
    -- day_fraction < 1 yields half_day, not on_leave; a full-day leave (day_fraction = 1,
    -- the default) still yields on_leave exactly as before this migration.
    v_leave_id := NULL;
    v_leave_day_fraction := NULL;
    SELECT l.id, l.day_fraction INTO v_leave_id, v_leave_day_fraction
    FROM public.leaves l
    WHERE l.tenant_id = p_tenant_id
      AND l.employee_id = v_group.employee_id
      AND l.status = 'approved'
      AND v_local_date BETWEEN l.start_date AND l.end_date
    ORDER BY l.start_date DESC
    LIMIT 1;

    IF v_leave_id IS NOT NULL THEN
      v_status := CASE WHEN v_leave_day_fraction < 1 THEN 'half_day' ELSE 'on_leave' END;
    END IF;

    v_policy_snapshot := jsonb_build_object(
      'absent_threshold', v_absent_threshold,
      'half_day_threshold', v_half_day_threshold,
      'determine_check_in_and_check_out', v_shift.determine_check_in_and_check_out,
      'working_hours_calculation_based_on', v_shift.working_hours_calculation_based_on,
      'enable_late_entry_marking', v_shift.enable_late_entry_marking,
      'late_entry_grace_minutes', v_shift.late_entry_grace_minutes,
      'enable_early_exit_marking', v_shift.enable_early_exit_marking,
      'early_exit_grace_minutes', v_shift.early_exit_grace_minutes,
      'holiday', to_jsonb(v_holiday),
      'calc_flags', v_calc.flags,
      'derivation_version', 1
    );

    -- A day assembled entirely from a fixed terminal or kiosk is location-verified BY THE DEVICE:
    -- it has no GPS to fence, and its physical presence at a site is the evidence. Recording that
    -- as 'office_verified' would be indistinguishable from a GPS-checked app punch in the audit
    -- trail, which is why 'device_verified' exists (20260903105835). A mixed day -- some events
    -- from a device, some from the app -- is deliberately left alone rather than claimed as either.
    IF v_group.sources <@ ARRAY['device', 'kiosk']::text[] THEN
      v_loc_status := 'device_verified';
    ELSE
      v_loc_status := NULL;
    END IF;

    -- D5: an is_locked row is never overwritten by derivation. Checked up front (not via
    -- ON CONFLICT) so the events for a locked day stay untouched and queued for a human --
    -- the advisory lock above already serializes the only concurrent writer this phase has
    -- (another Pass 1 call on the same tenant+shift), so a plain SELECT-then-branch is safe.
    SELECT id, is_locked, derivation_version
      INTO v_existing_id, v_existing_locked, v_existing_version
    FROM public.attendance
    WHERE tenant_id = p_tenant_id
      AND employee_id = v_group.employee_id
      AND date = v_local_date
      AND shift_id = p_shift_id;

    IF FOUND AND v_existing_locked THEN
      v_rows_skipped := v_rows_skipped + 1;
      CONTINUE;
    END IF;

    IF FOUND THEN
      UPDATE public.attendance SET
        status              = v_status,
        derivation_source   = 'derived',
        late_entry          = v_late_entry,
        is_late             = v_late_entry,
        early_exit          = v_early_exit,
        in_time             = v_calc.in_time,
        out_time            = v_calc.out_time,
        work_hours          = v_calc.hours,
        leave_id            = v_leave_id,
        shift_snapshot      = v_shift_snapshot,
        policy_snapshot     = v_policy_snapshot,
        business_date_tz    = v_tz,
        derived_at          = now(),
        derivation_version  = COALESCE(v_existing_version, 0) + 1,
        location_status     = COALESCE(v_loc_status, location_status),
        session_status      = 'closed'
      WHERE id = v_existing_id
      RETURNING id INTO v_att_id;
      v_rows_updated := v_rows_updated + 1;
    ELSE
      -- FIX (see header): punch_in named explicitly as NULL. Without it, the column's own
      -- DEFAULT now() applies, NEW.punch_in IS NOT NULL becomes true, and the dual-write
      -- trigger's INSERT branch appends a phantom 'in' event that never happened.
      INSERT INTO public.attendance (
        tenant_id, employee_id, date, shift_id, status, derivation_source,
        punch_in, late_entry, is_late, early_exit, in_time, out_time, work_hours, leave_id,
        shift_snapshot, policy_snapshot, business_date_tz, derived_at, derivation_version,
        location_status, session_status
      ) VALUES (
        p_tenant_id, v_group.employee_id, v_local_date, p_shift_id, v_status, 'derived',
        NULL, v_late_entry, v_late_entry, v_early_exit, v_calc.in_time, v_calc.out_time, v_calc.hours, v_leave_id,
        v_shift_snapshot, v_policy_snapshot, v_tz, now(), 1,
        v_loc_status, 'closed'
      )
      RETURNING id INTO v_att_id;
      v_rows_created := v_rows_created + 1;
    END IF;

    -- Stamp attendance_id onto every event in the group -- the one permitted mutation of an
    -- append-only row (D11), and it happens here inside a definer function that bypasses RLS
    -- by ownership, not via any write policy (there is none, on purpose).
    UPDATE public.attendance_events
    SET attendance_id = v_att_id
    WHERE id = ANY (v_group.event_ids);
  END LOOP;

  -- Table alias `r` is required here, not decoration: this function's own RETURNS TABLE
  -- column names (rows_created, rows_updated, rows_skipped, events_processed) are implicitly
  -- declared as PL/pgSQL OUT variables in this function's namespace, and they collide with the
  -- identically-named columns on attendance_derivation_runs. Without the alias, `COALESCE(
  -- events_processed, 0)` on the right-hand side is ambiguous between the OUT variable and the
  -- table column -- caught by 20260825100000's own apply attempt (Postgres error 42702).
  UPDATE public.attendance_derivation_runs AS r
  SET events_processed = COALESCE(r.events_processed, 0) + v_events_processed,
      rows_created     = COALESCE(r.rows_created, 0) + v_rows_created,
      rows_updated     = COALESCE(r.rows_updated, 0) + v_rows_updated,
      rows_skipped     = COALESCE(r.rows_skipped, 0) + v_rows_skipped,
      finished_at      = now(),
      status           = 'completed'
  WHERE r.id = p_run_id AND r.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendance_derivation_runs row % not found for tenant % -- caller must INSERT the run row before calling attendance_derive_pass1', p_run_id, p_tenant_id;
  END IF;

  RETURN QUERY SELECT v_groups_processed, v_rows_created, v_rows_updated, v_rows_skipped, v_events_processed;
END;
$function$;

-- ---------------------------------------------------------------------------
DO $assert$
DECLARE v_body text;
BEGIN
  SELECT regexp_replace(regexp_replace(pg_get_functiondef(oid),'--[^'||chr(10)||']*','','g'),'\s+',' ','g')
    INTO v_body FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='attendance_derive_pass1';

  IF v_body !~ 'device_verified' THEN
    RAISE EXCEPTION 'assertion: pass 1 does not label device-derived days';
  END IF;
  IF v_body !~ 'COALESCE\(v_loc_status, location_status\)' THEN
    RAISE EXCEPTION 'assertion: re-derivation could erase an existing location_status';
  END IF;
  -- invariants from earlier work
  IF v_body !~ 'IF FOUND AND v_existing_locked THEN' THEN
    RAISE EXCEPTION 'assertion: the D5 is_locked guard was lost';
  END IF;
  IF v_body !~ 'enable_late_entry_marking' OR v_body !~ 'late_entry_grace_minutes' THEN
    RAISE EXCEPTION 'assertion: shift-based lateness was lost';
  END IF;
  IF v_body !~ 'mark_attendance_on_holidays' THEN
    RAISE EXCEPTION 'assertion: holiday handling was lost';
  END IF;
END;
$assert$;
