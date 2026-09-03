-- Step 1 of 3 in retiring shifts.late_mark_grace_override. NOTHING is dropped here.
--
-- The column is read by nothing -- late_entry_grace_minutes is the grace that actually decides
-- lateness, on both the derivation and the correction path -- but it cannot simply be dropped,
-- because PostgREST resolves an RPC by its EXACT named-argument set:
--
--   * the DEPLOYED frontend sends p_late_mark_grace_override, so removing the parameter now would
--     break every shift save until the next deploy; and
--   * the parameter has NO DEFAULT, so a frontend that omits it fails with what reads as
--     "function not found" -- which is why the new build cannot ship first either.
--
-- Giving the parameter a DEFAULT breaks the deadlock: from here BOTH argument sets resolve. The
-- frontend that stops sending it deploys next, and step 3 then drops the parameter and the column
-- once no caller references either.
--
-- Postgres requires every parameter AFTER a defaulted one to have a default too, so p_is_default
-- necessarily gains one as well. `false` is the column's own default and the frontend always sends
-- the value explicitly, so no caller's behaviour changes.
--
-- Signature and body derived from pg_get_functiondef(); the only edits are the two defaults.

CREATE OR REPLACE FUNCTION public.hr_save_shift(p_tenant_id uuid, p_shift_id uuid, p_name text, p_start_time time without time zone, p_end_time time without time zone, p_working_days integer[], p_half_day_cutoff_override time without time zone, p_punch_in_opens_minutes_before integer, p_late_mark_grace_override integer DEFAULT NULL, p_is_default boolean DEFAULT false, p_working_hours_threshold_for_absent numeric DEFAULT 0, p_working_hours_threshold_for_half_day numeric DEFAULT 0, p_determine_check_in_and_check_out text DEFAULT 'alternating'::text, p_working_hours_calculation_based_on text DEFAULT 'first_last'::text, p_enable_late_entry_marking boolean DEFAULT true, p_late_entry_grace_minutes integer DEFAULT 10, p_enable_early_exit_marking boolean DEFAULT false, p_early_exit_grace_minutes integer DEFAULT 10, p_enable_auto_derivation boolean DEFAULT true, p_mark_attendance_on_holidays boolean DEFAULT false, p_allowed_punch_sources text[] DEFAULT ARRAY['app'::text, 'device'::text, 'kiosk'::text, 'manual'::text, 'import'::text])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hr_employee_id uuid;
  v_shift_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  v_hr_employee_id := assert_hr_for_tenant(p_tenant_id);

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Shift name is required';
  END IF;

  IF p_working_days IS NULL OR array_length(p_working_days, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one working day';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_working_days) AS day_value WHERE day_value < 0 OR day_value > 6) THEN
    RAISE EXCEPTION 'Working days must be between 0 and 6';
  END IF;

  IF p_determine_check_in_and_check_out IS NOT NULL
     AND p_determine_check_in_and_check_out NOT IN ('alternating', 'strict_log_type') THEN
    RAISE EXCEPTION 'determine_check_in_and_check_out must be alternating or strict_log_type';
  END IF;

  IF p_working_hours_calculation_based_on IS NOT NULL
     AND p_working_hours_calculation_based_on NOT IN ('first_last', 'every_pair') THEN
    RAISE EXCEPTION 'working_hours_calculation_based_on must be first_last or every_pair';
  END IF;

  PERFORM 1 FROM shifts WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF p_is_default THEN
    UPDATE shifts
    SET is_default = false,
        updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND is_default = true
      AND (p_shift_id IS NULL OR id <> p_shift_id);
  END IF;

  IF p_shift_id IS NULL THEN
    INSERT INTO shifts (
      tenant_id, name, start_time, end_time, working_days,
      half_day_cutoff_override, punch_in_opens_minutes_before,
      late_mark_grace_override, is_default, is_active, created_at, updated_at,
      working_hours_threshold_for_absent, working_hours_threshold_for_half_day,
      determine_check_in_and_check_out, working_hours_calculation_based_on,
      enable_late_entry_marking, late_entry_grace_minutes,
      enable_early_exit_marking, early_exit_grace_minutes,
      enable_auto_derivation, mark_attendance_on_holidays, allowed_punch_sources
    )
    VALUES (
      p_tenant_id, trim(p_name), p_start_time, p_end_time, p_working_days,
      p_half_day_cutoff_override, COALESCE(p_punch_in_opens_minutes_before, 60),
      p_late_mark_grace_override, COALESCE(p_is_default, false), true, now(), now(),
      COALESCE(p_working_hours_threshold_for_absent, 0),
      COALESCE(p_working_hours_threshold_for_half_day, 0),
      COALESCE(p_determine_check_in_and_check_out, 'alternating'),
      COALESCE(p_working_hours_calculation_based_on, 'first_last'),
      COALESCE(p_enable_late_entry_marking, true),
      COALESCE(p_late_entry_grace_minutes, 10),
      COALESCE(p_enable_early_exit_marking, false),
      COALESCE(p_early_exit_grace_minutes, 10),
      COALESCE(p_enable_auto_derivation, true),
      COALESCE(p_mark_attendance_on_holidays, false),
      COALESCE(p_allowed_punch_sources, ARRAY['app','device','kiosk','manual','import'])
    )
    RETURNING id INTO v_shift_id;
  ELSE
    UPDATE shifts
    SET name = trim(p_name),
        start_time = p_start_time,
        end_time = p_end_time,
        working_days = p_working_days,
        half_day_cutoff_override = p_half_day_cutoff_override,
        punch_in_opens_minutes_before = COALESCE(p_punch_in_opens_minutes_before, 60),
        late_mark_grace_override = p_late_mark_grace_override,
        is_default = COALESCE(p_is_default, false),
        is_active = true,
        updated_at = now(),
        working_hours_threshold_for_absent = COALESCE(p_working_hours_threshold_for_absent, 0),
        working_hours_threshold_for_half_day = COALESCE(p_working_hours_threshold_for_half_day, 0),
        determine_check_in_and_check_out = COALESCE(p_determine_check_in_and_check_out, 'alternating'),
        working_hours_calculation_based_on = COALESCE(p_working_hours_calculation_based_on, 'first_last'),
        enable_late_entry_marking = COALESCE(p_enable_late_entry_marking, true),
        late_entry_grace_minutes = COALESCE(p_late_entry_grace_minutes, 10),
        enable_early_exit_marking = COALESCE(p_enable_early_exit_marking, false),
        early_exit_grace_minutes = COALESCE(p_early_exit_grace_minutes, 10),
        enable_auto_derivation = COALESCE(p_enable_auto_derivation, true),
        mark_attendance_on_holidays = COALESCE(p_mark_attendance_on_holidays, false),
        allowed_punch_sources = COALESCE(p_allowed_punch_sources, ARRAY['app','device','kiosk','manual','import'])
    WHERE tenant_id = p_tenant_id
      AND id = p_shift_id
    RETURNING id INTO v_shift_id;

    IF v_shift_id IS NULL THEN
      RAISE EXCEPTION 'Shift not found';
    END IF;
  END IF;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
  VALUES (
    p_tenant_id, v_hr_employee_id, 'hr', 'shift.saved', 'shifts', v_shift_id,
    jsonb_build_object('name', trim(p_name), 'is_default', COALESCE(p_is_default, false), 'correlation_id', v_correlation_id)
  );

  RETURN v_shift_id;
END;
$function$;

-- ---------------------------------------------------------------------------
DO $assert$
DECLARE v_args text;
BEGIN
  SELECT pg_get_function_arguments(oid) INTO v_args
  FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='hr_save_shift';

  IF v_args !~ 'p_is_default boolean DEFAULT false' THEN
    RAISE EXCEPTION 'assertion: p_is_default has no default, so the signature will not compile';
  END IF;
  IF v_args !~ 'p_late_mark_grace_override integer DEFAULT NULL' THEN
    RAISE EXCEPTION 'assertion: the parameter is still required, so a caller omitting it would fail';
  END IF;
  -- the parameters that DO matter must be untouched
  IF v_args !~ 'p_late_entry_grace_minutes' OR v_args !~ 'p_enable_late_entry_marking' THEN
    RAISE EXCEPTION 'assertion: a real shift-policy parameter was lost';
  END IF;
END;
$assert$;
