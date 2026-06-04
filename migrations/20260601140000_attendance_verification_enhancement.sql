-- Migration: Attendance Verification Enhancement
-- Date: 2026-06-01

-- 1. Add work_mode to employees
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'office' CHECK (work_mode IN ('office', 'remote', 'hybrid'));

-- 2. Add verification fields to attendance
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS location_accuracy numeric;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS location_confidence text CHECK (location_confidence IN ('high', 'medium', 'low', 'very_low'));
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS location_status text CHECK (location_status IN ('office_verified', 'remote_approved', 'outside_geofence', 'gps_low_confidence', 'gps_denied', 'gps_unavailable', 'manual_override', 'selfie_missing'));
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS remote_exception_id uuid;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS verification_snapshot jsonb;

-- 3. Create Remote Exceptions Table with Audit Fields and Date Range Check
CREATE TABLE IF NOT EXISTS public.attendance_location_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  exception_type text NOT NULL CHECK (exception_type IN ('work_from_home', 'client_visit', 'business_travel', 'field_work', 'other')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  requested_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  approved_at timestamp with time zone,
  cancelled_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  cancelled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chk_exception_dates CHECK (end_date >= start_date)
);

-- Indices for rapid date lookup
CREATE INDEX IF NOT EXISTS idx_exceptions_dates ON public.attendance_location_exceptions(employee_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_exceptions_tenant ON public.attendance_location_exceptions(tenant_id);

-- 4. Create Attendance Selfies Table
CREATE TABLE IF NOT EXISTS public.attendance_selfies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid NOT NULL REFERENCES public.attendance(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('punch_in', 'punch_out')),
  storage_path text NOT NULL,
  captured_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Unique index to prevent duplicate selfies per punch direction
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_selfie_direction ON public.attendance_selfies(attendance_id, type);
CREATE INDEX IF NOT EXISTS idx_selfies_attendance ON public.attendance_selfies(attendance_id);
CREATE INDEX IF NOT EXISTS idx_selfies_tenant ON public.attendance_selfies(tenant_id);

-- RLS Enablement
ALTER TABLE public.attendance_location_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_selfies ENABLE ROW LEVEL SECURITY;

-- 5. Multi-Tenant Security Policies
-- Exceptions Policies
DROP POLICY IF EXISTS exceptions_tenant_isolation ON public.attendance_location_exceptions;
CREATE POLICY exceptions_tenant_isolation ON public.attendance_location_exceptions 
  FOR ALL TO authenticated 
  USING (tenant_id = get_auth_tenant_id()) 
  WITH CHECK (tenant_id = get_auth_tenant_id());

DROP POLICY IF EXISTS exceptions_tenant_active_restrictive ON public.attendance_location_exceptions;
CREATE POLICY exceptions_tenant_active_restrictive ON public.attendance_location_exceptions 
  AS RESTRICTIVE FOR ALL TO public 
  USING ((SELECT can_access_tenant(tenant_id))) 
  WITH CHECK ((SELECT can_access_tenant(tenant_id)));

DROP POLICY IF EXISTS exceptions_hr_all ON public.attendance_location_exceptions;
CREATE POLICY exceptions_hr_all ON public.attendance_location_exceptions 
  FOR ALL TO authenticated 
  USING ((SELECT is_hr())) 
  WITH CHECK ((SELECT is_hr()));

DROP POLICY IF EXISTS exceptions_self_read ON public.attendance_location_exceptions;
CREATE POLICY exceptions_self_read ON public.attendance_location_exceptions 
  FOR SELECT TO authenticated 
  USING (employee_id = (SELECT id FROM public.employees WHERE user_id = auth.uid()));

-- Selfies Policies
DROP POLICY IF EXISTS selfies_tenant_isolation ON public.attendance_selfies;
CREATE POLICY selfies_tenant_isolation ON public.attendance_selfies 
  FOR ALL TO authenticated 
  USING (tenant_id = get_auth_tenant_id()) 
  WITH CHECK (tenant_id = get_auth_tenant_id());

DROP POLICY IF EXISTS selfies_tenant_active_restrictive ON public.attendance_selfies;
CREATE POLICY selfies_tenant_active_restrictive ON public.attendance_selfies 
  AS RESTRICTIVE FOR ALL TO public 
  USING ((SELECT can_access_tenant(tenant_id))) 
  WITH CHECK ((SELECT can_access_tenant(tenant_id)));

DROP POLICY IF EXISTS selfies_hr_all ON public.attendance_selfies;
CREATE POLICY selfies_hr_all ON public.attendance_selfies 
  FOR ALL TO authenticated 
  USING ((SELECT is_hr())) 
  WITH CHECK ((SELECT is_hr()));

DROP POLICY IF EXISTS selfies_self_read ON public.attendance_selfies;
CREATE POLICY selfies_self_read ON public.attendance_selfies 
  FOR SELECT TO authenticated 
  USING (employee_id = (SELECT id FROM public.employees WHERE user_id = auth.uid()));

-- 6. Background Expiry Logic & Cron Job
CREATE OR REPLACE FUNCTION public.expire_location_exceptions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN 
    UPDATE public.attendance_location_exceptions
    SET status = 'expired',
        updated_at = now()
    WHERE status = 'approved' AND end_date < CURRENT_DATE
    RETURNING id, tenant_id, employee_id
  LOOP
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, target_type, target_id, details)
    VALUES (v_rec.tenant_id, NULL, 'system', 'attendance.remote_exception_expired', 'attendance_location_exceptions', v_rec.id, jsonb_build_object('employee_id', v_rec.employee_id));
  END LOOP;
END;
$$;

-- Schedule job to run daily at midnight
DO $$
BEGIN
  PERFORM cron.unschedule('attendance-exception-expiry');
EXCEPTION WHEN OTHERS THEN
END $$;

SELECT cron.schedule('attendance-exception-expiry', '0 0 * * *', $$SELECT public.expire_location_exceptions()$$);
