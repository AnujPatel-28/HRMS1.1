-- migration: C8 -- absent-marking watermark (absence was never marked for any tenant)
-- Source: prompts/c2_c6_cleanup_packages_2026-09-22.md, C8 section. User decision 2026-09-23:
-- mark absent the next morning for app/kiosk punches; for biometric devices only after the device
-- has actually synced (never past its last successful push).
--
-- Measured 2026-09-23: attendance_derive_pass2 writes 'absent' only for dates up to
-- tenant_business_date(shifts.last_sync_of_events) - 1, and NOTHING writes last_sync_of_events
-- (pass2 is its only reference; all 10 TB shifts NULL) -> no tenant ever got an automatic absent
-- day; no-punch working days stayed blank.
--
-- Signal for "device synced": attendance_devices.last_seen_at, stamped by device_ingest_punch on
-- every accepted punch. Known limit: a device that is online but receives no punches does not
-- advance it, so absence for that tenant waits for the next punch (it never marks early).
-- Kiosks are excluded: a kiosk punch is a live server call, like the app.
-- pass2: exact live pg_get_functiondef() body; only the watermark block changes.
-- No BEGIN/COMMIT: the CLI wraps each migration in its own transaction.

CREATE OR REPLACE FUNCTION public.attendance_absence_watermark(p_tenant_id uuid)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.attendance_devices d
      WHERE d.tenant_id = p_tenant_id AND d.device_type = 'biometric' AND d.is_active
    ) THEN now()
    WHEN EXISTS (
      SELECT 1 FROM public.attendance_devices d
      WHERE d.tenant_id = p_tenant_id AND d.device_type = 'biometric' AND d.is_active AND d.last_seen_at IS NULL
    ) THEN NULL
    ELSE (
      SELECT min(d.last_seen_at) FROM public.attendance_devices d
      WHERE d.tenant_id = p_tenant_id AND d.device_type = 'biometric' AND d.is_active
    )
  END;
$function$;
-- Internal: read by the derivation passes (definer, same owner) only.
REVOKE ALL ON FUNCTION public.attendance_absence_watermark(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.attendance_derive_pass2(p_tenant_id uuid, p_shift_id uuid, p_from date, p_to date, p_run_id uuid)
 RETURNS TABLE(employees_processed integer, rows_created integer, rows_skipped_watermark integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tz                     text;
  v_shift                  public.shifts%ROWTYPE;
  v_assign                 record;
  v_relieving_date         date;
  v_from_clamped           date;
  v_to_clamped             date;
  v_absent_watermark_date  date;
  v_sync_watermark         timestamptz;
  v_date                   date;
  v_holiday                record;
  v_leave_id               uuid;
  v_leave_day_fraction     numeric;
  v_status                 text;
  v_employees_processed    integer := 0;
  v_rows_created           integer := 0;
  v_rows_skipped_watermark integer := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_shift_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_run_id IS NULL THEN
    RAISE EXCEPTION 'attendance_derive_pass2: all five parameters are required';
  END IF;

  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden: tenant not accessible';
  END IF;

  IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance')) THEN
    RAISE EXCEPTION 'attendance module not enabled for tenant %', p_tenant_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text), hashtext(p_shift_id::text));

  SELECT * INTO v_shift FROM public.shifts s WHERE s.id = p_shift_id AND s.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift % not found for tenant %', p_shift_id, p_tenant_id;
  END IF;

  SELECT COALESCE(t.timezone, 'Asia/Kolkata') INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'tenant % not found', p_tenant_id;
  END IF;

  -- §2.7: absent-marking watermark. C8: computed by attendance_absence_watermark() -- now() for a
  -- tenant with no active biometric device (app/kiosk punches are live), else the OLDEST last
  -- successful push among its active biometric devices (NULL if one never pushed). Nothing ever
  -- wrote shifts.last_sync_of_events; when set it still caps the watermark.
  -- NULL -> no absent row can be justified (the safe reading; see the header note).
  v_sync_watermark := public.attendance_absence_watermark(p_tenant_id);
  IF v_sync_watermark IS NOT NULL AND v_shift.last_sync_of_events IS NOT NULL THEN
    v_sync_watermark := LEAST(v_sync_watermark, v_shift.last_sync_of_events);
  END IF;
  v_absent_watermark_date := CASE
    WHEN v_sync_watermark IS NULL THEN NULL
    ELSE public.tenant_business_date(p_tenant_id, v_sync_watermark) - 1
  END;

  FOR v_assign IN
    SELECT es.employee_id, es.effective_from, es.effective_to,
           e.date_of_joining, e.status AS emp_status
    FROM public.employee_shifts es
    JOIN public.employees e ON e.id = es.employee_id AND e.tenant_id = es.tenant_id
    WHERE es.tenant_id = p_tenant_id
      AND es.shift_id = p_shift_id
      AND es.effective_from <= p_to
      AND (es.effective_to IS NULL OR es.effective_to >= p_from)
  LOOP
    IF v_assign.emp_status <> 'active' THEN
      -- E28: inactive/terminated/draft/etc employees are never derived for.
      CONTINUE;
    END IF;

    v_employees_processed := v_employees_processed + 1;

    -- E27: earliest still-relevant exit_requests.last_working_date (see header note on why
    -- withdrawn/rejected are excluded).
    v_relieving_date := NULL;
    SELECT er.last_working_date INTO v_relieving_date
    FROM public.exit_requests er
    WHERE er.tenant_id = p_tenant_id
      AND er.employee_id = v_assign.employee_id
      AND er.status <> ALL (ARRAY['withdrawn', 'rejected'])
      AND er.last_working_date IS NOT NULL
    ORDER BY er.last_working_date ASC
    LIMIT 1;

    -- E26 (date_of_joining) + this assignment's own effective_from + process_attendance_after
    -- (self-enforced here too, not only by the caller -- see header) bound the START.
    -- effective_to + the E27 relieving date bound the END.
    v_from_clamped := GREATEST(
      p_from, v_assign.effective_from,
      COALESCE(v_assign.date_of_joining, p_from),
      COALESCE(v_shift.process_attendance_after, p_from)
    );
    v_to_clamped := LEAST(
      p_to, COALESCE(v_assign.effective_to, p_to), COALESCE(v_relieving_date, p_to)
    );

    v_date := v_from_clamped;
    WHILE v_date <= v_to_clamped LOOP
      -- Existence check is NOT scoped by shift_id -- see header. Any row on this date, from
      -- any source (punch, HR edit, leave approval, an earlier Pass 1/Pass 2 run), means
      -- there is nothing for completeness to fill in, and an is_locked row is protected for
      -- free by never being a candidate here at all.
      IF EXISTS (
        SELECT 1 FROM public.attendance a
        WHERE a.tenant_id = p_tenant_id AND a.employee_id = v_assign.employee_id AND a.date = v_date
      ) THEN
        v_date := v_date + 1;
        CONTINUE;
      END IF;

      v_leave_id := NULL;
      v_leave_day_fraction := NULL;
      v_status := NULL;

      IF NOT (EXTRACT(DOW FROM v_date)::int = ANY (v_shift.working_days)) THEN
        -- E25
        v_status := 'weekly_off';
      ELSE
        SELECT * INTO v_holiday
        FROM public.work_calendar_holiday(p_tenant_id, v_assign.employee_id, v_date);

        IF v_holiday.is_holiday THEN
          -- E24 (completeness reading -- see Pass 1 for the mark_attendance_on_holidays
          -- opt-in, which only matters when there ARE events to consider).
          v_status := 'holiday';
        ELSE
          SELECT l.id, l.day_fraction INTO v_leave_id, v_leave_day_fraction
          FROM public.leaves l
          WHERE l.tenant_id = p_tenant_id
            AND l.employee_id = v_assign.employee_id
            AND l.status = 'approved'
            AND v_date BETWEEN l.start_date AND l.end_date
          ORDER BY l.start_date DESC
          LIMIT 1;

          IF v_leave_id IS NOT NULL THEN
            -- E22 / E23
            v_status := CASE WHEN v_leave_day_fraction < 1 THEN 'half_day' ELSE 'on_leave' END;
          ELSIF v_absent_watermark_date IS NOT NULL AND v_date <= v_absent_watermark_date THEN
            v_status := 'absent';
          ELSE
            -- The watermark interlock: no evidence either way, and it is not yet safe to
            -- infer absence. Write nothing -- an honest gap, not a guess.
            v_rows_skipped_watermark := v_rows_skipped_watermark + 1;
            v_date := v_date + 1;
            CONTINUE;
          END IF;
        END IF;
      END IF;

      -- punch_in named explicitly as NULL for the same reason as the Pass 1 fix above: the
      -- column DEFAULT now() would otherwise fire the dual-write trigger's INSERT branch and
      -- append a phantom 'in' event for a row that has no punch evidence at all.
      INSERT INTO public.attendance (
        tenant_id, employee_id, date, shift_id, status, derivation_source,
        punch_in, leave_id, business_date_tz, derived_at, derivation_version, session_status
      ) VALUES (
        p_tenant_id, v_assign.employee_id, v_date, p_shift_id, v_status, 'derived',
        NULL, v_leave_id, v_tz, now(), 1, 'closed'
      );
      v_rows_created := v_rows_created + 1;

      v_date := v_date + 1;
    END LOOP;
  END LOOP;

  UPDATE public.attendance_derivation_runs AS r
  SET rows_created = COALESCE(r.rows_created, 0) + v_rows_created,
      rows_skipped = COALESCE(r.rows_skipped, 0) + v_rows_skipped_watermark,
      finished_at  = now(),
      status       = 'completed'
  WHERE r.id = p_run_id AND r.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendance_derivation_runs row % not found for tenant % -- caller must INSERT the run row before calling attendance_derive_pass2', p_run_id, p_tenant_id;
  END IF;

  RETURN QUERY SELECT v_employees_processed, v_rows_created, v_rows_skipped_watermark;
END;
$function$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['attendance_absence_watermark', 'attendance_derive_pass2'] LOOP
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = fn) <> 1 THEN
      RAISE EXCEPTION 'C8: expected exactly one pg_proc row for %', fn;
    END IF;
  END LOOP;
END $$;
