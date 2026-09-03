-- Step 3 of 3: shifts.late_mark_grace_override is gone.
--
-- A third grace value, editable in the Shift form, written by hr_save_shift, and read by NOTHING.
-- The grace that decides lateness is late_entry_grace_minutes -- used by attendance_derive_pass1
-- and, since 20260903102438, by HR correction approval as well.
--
-- Sequenced so no caller ever breaks (PostgREST resolves an RPC by its exact named-argument set):
--   1. 20260903125726 gave the parameter a DEFAULT, so both argument sets resolved.
--   2. f733fa4 deployed a frontend that neither sends the parameter nor selects the column.
--   3. this migration drops the parameter and then the column.
--
-- The old signature must be dropped explicitly: CREATE OR REPLACE cannot remove a parameter, it
-- would create an OVERLOAD, and two candidates make every call ambiguous.
--
-- Residual risk, accepted: a browser still running the pre-f733fa4 bundle sends the parameter and
-- will fail shift saves until it reloads. There are no production users on this system.

DROP FUNCTION IF EXISTS public.hr_save_shift(uuid, uuid, text, time without time zone, time without time zone, integer[], time without time zone, integer, integer, boolean, numeric, numeric, text, text, boolean, integer, boolean, integer, boolean, boolean, text[]);

CREATE OR REPLACE FUNCTION public.hr_save_shift(p_tenant_id uuid, p_shift_id uuid, p_name text, p_start_time time without time zone, p_end_time time without time zone, p_working_days integer[], p_half_day_cutoff_override time without time zone, p_punch_in_opens_minutes_before integer, p_is_default boolean DEFAULT false, p_working_hours_threshold_for_absent numeric DEFAULT 0, p_working_hours_threshold_for_half_day numeric DEFAULT 0, p_determine_check_in_and_check_out text DEFAULT 'alternating'::text, p_working_hours_calculation_based_on text DEFAULT 'first_last'::text, p_enable_late_entry_marking boolean DEFAULT true, p_late_entry_grace_minutes integer DEFAULT 10, p_enable_early_exit_marking boolean DEFAULT false, p_early_exit_grace_minutes integer DEFAULT 10, p_enable_auto_derivation boolean DEFAULT true, p_mark_attendance_on_holidays boolean DEFAULT false, p_allowed_punch_sources text[] DEFAULT ARRAY['app'::text, 'device'::text, 'kiosk'::text, 'manual'::text, 'import'::text])
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
      is_default, is_active, created_at, updated_at,
      working_hours_threshold_for_absent, working_hours_threshold_for_half_day,
      determine_check_in_and_check_out, working_hours_calculation_based_on,
      enable_late_entry_marking, late_entry_grace_minutes,
      enable_early_exit_marking, early_exit_grace_minutes,
      enable_auto_derivation, mark_attendance_on_holidays, allowed_punch_sources
    )
    VALUES (
      p_tenant_id, trim(p_name), p_start_time, p_end_time, p_working_days,
      p_half_day_cutoff_override, COALESCE(p_punch_in_opens_minutes_before, 60),
      COALESCE(p_is_default, false), true, now(), now(),
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

ALTER TABLE public.shifts DROP COLUMN IF EXISTS late_mark_grace_override;

-- ---------------------------------------------------------------------------
DO $assert$
DECLARE v_args text; v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='hr_save_shift';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'assertion: expected exactly one hr_save_shift, found % (an overload makes every call ambiguous)', v_n;
  END IF;

  SELECT pg_get_function_arguments(oid) INTO v_args FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='hr_save_shift';
  IF v_args ~ 'late_mark_grace_override' THEN
    RAISE EXCEPTION 'assertion: the parameter survived';
  END IF;
  IF v_args !~ 'p_late_entry_grace_minutes' OR v_args !~ 'p_allowed_punch_sources' THEN
    RAISE EXCEPTION 'assertion: a real shift parameter was lost with it';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='shifts'
                AND column_name='late_mark_grace_override') THEN
    RAISE EXCEPTION 'assertion: the column survived';
  END IF;

  -- nothing anywhere may still reference it
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
               AND p.prokind='f' AND pg_get_functiondef(p.oid) ~ 'late_mark_grace_override') THEN
    RAISE EXCEPTION 'assertion: a function still references the dropped column';
  END IF;
END;
$assert$;
