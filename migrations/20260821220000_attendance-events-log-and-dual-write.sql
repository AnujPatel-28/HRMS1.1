-- B3 — `attendance_events`, the immutable log, plus dual-write from the existing punch path.
-- Authority: `new update doc/attendance_shift_v2_decision_doc.md` §5.1 and §8 (locked decision D2).
--
-- First real step of the two-layer rebuild: an immutable event log feeding a processor that
-- derives the daily `attendance` row. This release creates the log and starts filling it.
-- It performs NO derivation and changes nothing a user can see — `attendance` remains
-- authoritative and is written exactly as before.
--
-- ============================================================================
-- WHY THE DUAL-WRITE IS A TRIGGER, NOT A CLIENT CHANGE
-- ============================================================================
-- The punch path is asymmetric, which the release plan did not account for:
--
--   punch IN  -> a DIRECT TABLE INSERT from the browser (PunchInOut.tsx:742)
--   punch OUT -> the punch_out_attendance RPC
--
-- So there is no single server-side chokepoint to hang an ingest call on. Asking the client
-- to call an ingest RPC as well would mean two round trips that can diverge — the log would
-- silently miss every punch where the second call failed, and we would not find out until
-- the processor went live in B5 and produced wrong days from a half-populated log.
--
-- A trigger on `attendance` cannot be forgotten, captures the direct INSERT and the RPC
-- alike, and additionally captures HR's manual attendance edits — which are real attendance
-- events (D1's 'manual' source) that a client-side ingest would have missed entirely.
--
-- ============================================================================
-- IMMUTABILITY IS ENFORCED BY THE ABSENCE OF POLICIES
-- ============================================================================
-- There is deliberately NO permissive INSERT, UPDATE or DELETE policy on this table. With
-- RLS enabled, that means an ordinary `authenticated` caller cannot write to it AT ALL —
-- not through PostgREST, not by any query they can compose. The only write path is
-- attendance_event_ingest(), which is SECURITY DEFINER and therefore bypasses RLS as the
-- table owner.
--
-- That is what "immutable log" has to mean at the database level. Corrections happen by
-- appending a superseding event (D11), never by UPDATE — which is why not even the owner of
-- a row may edit it through the API.

-- ---------------------------------------------------------------------------
-- 1. The log
-- ---------------------------------------------------------------------------
-- Column-for-column as §5.1 specifies. Every FK target was verified against the live
-- backend before writing this: tenants, employees, shifts, attendance and attendance_selfies
-- all exist with uuid primary keys, and no attendance_events table existed yet.
CREATE TABLE IF NOT EXISTS public.attendance_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,

  -- WHAT HAPPENED
  event_time          timestamptz NOT NULL,
  direction           text,
  source              text NOT NULL,
  source_ref          text,

  -- SHIFT RESOLUTION. Stamped at ingest where cheaply knowable, recomputable later.
  -- ⚠️ B3 fills shift_id ONLY. shift_start/shift_end/shift_actual_* stay NULL: they are the
  -- output of the shift-resolution algorithm (§2.5), which lands in B4. Filling them here
  -- with a guess would put a second, worse implementation of that algorithm in the codebase
  -- and the processor would inherit its errors. NULL honestly means "not yet resolved".
  shift_id            uuid REFERENCES public.shifts(id),
  shift_start         timestamptz,
  shift_end           timestamptz,
  shift_actual_start  timestamptz,
  shift_actual_end    timestamptz,
  offshift            boolean NOT NULL DEFAULT false,

  -- DERIVATION LINK. attendance_id IS NULL is the work queue.
  -- During B3 the arrow points the other way from its eventual meaning: the derived row
  -- already exists and the event records it. From B5 the processor will create the row.
  attendance_id       uuid REFERENCES public.attendance(id) ON DELETE SET NULL,
  skip_derivation     boolean NOT NULL DEFAULT false,

  -- EVIDENCE
  lat                 numeric,
  lng                 numeric,
  location_accuracy   numeric,
  location_status     text,
  selfie_id           uuid REFERENCES public.attendance_selfies(id) ON DELETE SET NULL,
  evidence            jsonb,
  device_ip           text,

  -- APPEND-ONLY CORRECTION (D11)
  supersedes_event_id uuid REFERENCES public.attendance_events(id),
  superseded_by_id    uuid REFERENCES public.attendance_events(id),
  void_reason         text,

  correlation_id      uuid,
  idempotency_key     text,
  created_by          uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),

  -- D1's source vocabulary, constrained so a typo cannot create a sixth source silently.
  CONSTRAINT attendance_events_source_check
    CHECK (source = ANY (ARRAY['app', 'device', 'kiosk', 'manual', 'import'])),
  CONSTRAINT attendance_events_direction_check
    CHECK (direction IS NULL OR direction = ANY (ARRAY['in', 'out']))
);

-- Idempotency: the same physical punch must never land twice however many times a device
-- retries. Partial, so the many rows with no key do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_events_idem
  ON public.attendance_events (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Device replay guard: same employee, same instant, same source, SAME DIRECTION is the
-- same punch.
--
-- ⚠️ DELIBERATE DEVIATION FROM §5.1, which omits `direction` from this index. That omission
-- is wrong and the assertion at the foot of this migration caught it: an 'in' and an 'out'
-- carrying the same timestamp are two different events, but without `direction` the second
-- collides with the first and is silently dropped by the ingest's ON CONFLICT DO NOTHING.
-- The log would lose a punch-out and nobody would be told.
--
-- Including direction still guards what the index exists to guard — a device retrying the
-- same punch sends the same direction, so replays are still collapsed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_events_natural
  ON public.attendance_events (tenant_id, employee_id, event_time, source, direction)
  WHERE superseded_by_id IS NULL;

-- The processor's hot path (B5).
CREATE INDEX IF NOT EXISTS ix_attendance_events_queue
  ON public.attendance_events (tenant_id, shift_id, shift_actual_end)
  WHERE attendance_id IS NULL AND skip_derivation = false AND offshift = false;

CREATE INDEX IF NOT EXISTS ix_attendance_events_group
  ON public.attendance_events (tenant_id, employee_id, shift_start);

-- ---------------------------------------------------------------------------
-- 2. RLS — read mirrors `attendance`; there is no write path
-- ---------------------------------------------------------------------------
ALTER TABLE public.attendance_events ENABLE ROW LEVEL SECURITY;

-- The three RESTRICTIVE fences, copied from `attendance` so the log cannot be reachable in
-- any situation the derived row is not.
CREATE POLICY module_enabled_attendance ON public.attendance_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.tenant_has_module('attendance')))
  WITH CHECK ((SELECT public.tenant_has_module('attendance')));

CREATE POLICY tenant_isolation ON public.attendance_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.get_auth_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.get_auth_tenant_id()));

CREATE POLICY tenant_active_restrictive ON public.attendance_events
  AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.can_access_tenant(tenant_id)))
  WITH CHECK ((SELECT public.can_access_tenant(tenant_id)));

-- Reads only, mirroring attendance_select_self / _manager / _hr.
CREATE POLICY attendance_events_select_self ON public.attendance_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = attendance_events.employee_id AND e.user_id = (SELECT auth.uid())
  ));

CREATE POLICY attendance_events_select_manager ON public.attendance_events
  FOR SELECT TO authenticated
  USING ((SELECT public.can_view_employee(employee_id)));

CREATE POLICY attendance_events_select_hr ON public.attendance_events
  FOR SELECT TO authenticated
  USING ((SELECT public.is_hr()));

-- No INSERT/UPDATE/DELETE policy exists, on purpose. See the header.

-- ---------------------------------------------------------------------------
-- 3. The only write path
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can write past the deliberately write-less RLS above. It is NOT
-- granted to anon, and it fences the tenant explicitly — definer bypasses RLS, so the fence
-- the policies would have provided has to be restored by hand.
--
-- ON CONFLICT DO NOTHING on both unique indexes makes retries free: a device that sends the
-- same punch five times produces one row, which is the entire point of idempotency_key.
-- Returns the event id, or NULL when the event was a duplicate and was dropped.
CREATE OR REPLACE FUNCTION public.attendance_event_ingest(
  p_tenant_id       uuid,
  p_employee_id     uuid,
  p_event_time      timestamptz,
  p_direction       text DEFAULT NULL,
  p_source          text DEFAULT 'app',
  p_source_ref      text DEFAULT NULL,
  p_attendance_id   uuid DEFAULT NULL,
  p_lat             numeric DEFAULT NULL,
  p_lng             numeric DEFAULT NULL,
  p_location_accuracy numeric DEFAULT NULL,
  p_location_status text DEFAULT NULL,
  p_selfie_id       uuid DEFAULT NULL,
  p_evidence        jsonb DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id  uuid DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_event_id uuid;
  v_shift_id uuid;
  v_creator  uuid;
BEGIN
  -- Definer bypasses RLS; restore the tenant fence explicitly. A session-less caller is
  -- project_admin (trigger during a migration, service role) and is allowed.
  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden: tenant not accessible';
  END IF;

  -- The shift in force on the event's own date. Same effective-dated resolution the
  -- punch-out policy derivation uses, so the two cannot disagree about which shift applied.
  SELECT es.shift_id INTO v_shift_id
  FROM public.employee_shifts es
  WHERE es.tenant_id = p_tenant_id
    AND es.employee_id = p_employee_id
    AND es.effective_from <= p_event_time::date
    AND (es.effective_to IS NULL OR es.effective_to >= p_event_time::date)
  ORDER BY es.effective_from DESC
  LIMIT 1;

  SELECT id INTO v_creator FROM public.employees
   WHERE user_id = (SELECT auth.uid()) AND tenant_id = p_tenant_id;

  INSERT INTO public.attendance_events (
    tenant_id, employee_id, event_time, direction, source, source_ref,
    shift_id, attendance_id, lat, lng, location_accuracy, location_status,
    selfie_id, evidence, idempotency_key, correlation_id, created_by
  ) VALUES (
    p_tenant_id, p_employee_id, p_event_time, p_direction, p_source, p_source_ref,
    v_shift_id, p_attendance_id, p_lat, p_lng, p_location_accuracy, p_location_status,
    p_selfie_id, p_evidence, p_idempotency_key, p_correlation_id, v_creator
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.attendance_event_ingest(uuid, uuid, timestamptz, text, text, text, uuid, numeric, numeric, numeric, text, uuid, jsonb, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.attendance_event_ingest(uuid, uuid, timestamptz, text, text, text, uuid, numeric, numeric, numeric, text, uuid, jsonb, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.attendance_event_ingest(uuid, uuid, timestamptz, text, text, text, uuid, numeric, numeric, numeric, text, uuid, jsonb, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Dual-write
-- ---------------------------------------------------------------------------
-- Emits an 'in' event when an attendance row is created with a punch_in, and an 'out' event
-- when punch_out transitions from NULL to a value. Source is inferred from who is acting:
-- the employee themselves is 'app'; anyone else editing their row is 'manual' (D1).
--
-- ⚠️ FAILURE POLICY, and it is a deliberate trade-off rather than an oversight.
-- The log is NOT yet authoritative — `attendance` is. So a failure to append must not stop
-- an employee punching in; that would turn a logging bug into an outage of the flagship
-- feature. But swallowing errors silently is exactly how the leave-notification bug hid for
-- months, so the failure is RECORDED in attendance_audit_logs where HR can see it.
--
-- WHEN THE LOG BECOMES AUTHORITATIVE (B5+), THIS MUST FLIP TO RAISING. A derived day built
-- from a knowingly incomplete log is worse than a failed punch.
CREATE OR REPLACE FUNCTION public.attendance_dual_write_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_source text;
  v_actor  uuid;
BEGIN
  SELECT id INTO v_actor FROM public.employees
   WHERE user_id = auth.uid() AND tenant_id = NEW.tenant_id;

  v_source := CASE WHEN v_actor IS NOT NULL AND v_actor = NEW.employee_id
                   THEN 'app' ELSE 'manual' END;

  BEGIN
    IF TG_OP = 'INSERT' AND NEW.punch_in IS NOT NULL THEN
      PERFORM public.attendance_event_ingest(
        p_tenant_id     => NEW.tenant_id,
        p_employee_id   => NEW.employee_id,
        p_event_time    => NEW.punch_in,
        p_direction     => 'in',
        p_source        => v_source,
        p_attendance_id => NEW.id,
        p_lat           => NEW.punch_in_lat,
        p_lng           => NEW.punch_in_lng,
        p_location_status => NEW.punch_in_location_status,
        -- Deterministic from the fact itself, so a replay of the same punch is a no-op.
        p_idempotency_key => NEW.id::text || ':in'
      );
    ELSIF TG_OP = 'UPDATE' AND OLD.punch_out IS NULL AND NEW.punch_out IS NOT NULL THEN
      PERFORM public.attendance_event_ingest(
        p_tenant_id     => NEW.tenant_id,
        p_employee_id   => NEW.employee_id,
        p_event_time    => NEW.punch_out,
        p_direction     => 'out',
        p_source        => v_source,
        p_attendance_id => NEW.id,
        p_lat           => NEW.punch_out_lat,
        p_lng           => NEW.punch_out_lng,
        p_location_status => NEW.punch_out_location_status,
        p_idempotency_key => NEW.id::text || ':out'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.attendance_audit_logs (tenant_id, attendance_id, action, details)
    VALUES (NEW.tenant_id, NEW.id, 'event_dual_write_failed',
            jsonb_build_object('sqlstate', SQLSTATE, 'message', SQLERRM, 'op', TG_OP));
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_attendance_dual_write_event ON public.attendance;
CREATE TRIGGER trg_attendance_dual_write_event
  AFTER INSERT OR UPDATE OF punch_out ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.attendance_dual_write_event();

-- ---------------------------------------------------------------------------
-- 5. Prove it
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  v_writes int;
  v_tenant uuid;
  v_emp    uuid;
  v_att    uuid;
  v_events int;
BEGIN
  -- There must be NO write policy. If one is ever added the log stops being immutable.
  SELECT count(*) INTO v_writes
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'attendance_events'
    AND permissive = 'PERMISSIVE' AND cmd <> 'SELECT';

  IF v_writes <> 0 THEN
    RAISE EXCEPTION 'attendance_events has % permissive write policies — the log must be append-only via attendance_event_ingest', v_writes;
  END IF;

  -- End-to-end: a punch-in must produce exactly one event, and a replay must produce none.
  SELECT e.tenant_id, e.id INTO v_tenant, v_emp
  FROM public.employees e WHERE e.user_id IS NOT NULL LIMIT 1;

  -- Distinct timestamps, as a real shift has. The first version of this probe used now()
  -- for both and exposed the index flaw documented above.
  INSERT INTO public.attendance (tenant_id, employee_id, date, punch_in, session_status, status)
  VALUES (v_tenant, v_emp, DATE '1999-01-01', now() - interval '8 hours', 'open', 'present')
  RETURNING id INTO v_att;

  SELECT count(*) INTO v_events FROM public.attendance_events WHERE attendance_id = v_att;
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'dual-write produced % events for a punch-in, expected 1', v_events;
  END IF;

  UPDATE public.attendance SET punch_out = now() WHERE id = v_att;
  SELECT count(*) INTO v_events FROM public.attendance_events WHERE attendance_id = v_att;
  IF v_events <> 2 THEN
    RAISE EXCEPTION 'dual-write produced % events after punch-out, expected 2', v_events;
  END IF;

  -- Idempotency: re-running the same punch-out transition must not append again.
  UPDATE public.attendance SET punch_out = punch_out WHERE id = v_att;
  SELECT count(*) INTO v_events FROM public.attendance_events WHERE attendance_id = v_att;
  IF v_events <> 2 THEN
    RAISE EXCEPTION 'idempotency failed: % events after a replayed punch-out, expected 2', v_events;
  END IF;

  -- Clean up the probe entirely; this migration must leave no rows behind.
  DELETE FROM public.attendance_events WHERE attendance_id = v_att;
  DELETE FROM public.attendance WHERE id = v_att;

  RAISE NOTICE 'B3 verified: log is append-only, dual-write emits in/out exactly once, replays are no-ops';
END
$check$;
