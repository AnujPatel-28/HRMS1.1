-- Migration: Tenant isolation for attendance_audit_logs (append-only)
-- Created: 2026-08-13
-- Target: public.attendance_audit_logs
--
-- This table had RLS off with zero policies, so any authenticated user of any tenant could read
-- every tenant's attendance audit trail — and, worse, modify or delete it. An audit log an employee
-- can edit is not an audit log.
--
-- Access model:
--   SELECT -> HR, within their own tenant
--   WRITE  -> nobody directly
--
-- The only writer is close_stale_attendance(), which is SECURITY DEFINER and therefore runs as the
-- table owner and bypasses RLS. Granting no write privilege to `authenticated` makes the trail
-- tamper-proof from the application while leaving that function working.

ALTER TABLE public.attendance_audit_logs ENABLE ROW LEVEL SECURITY;

-- Append-only from the application's point of view: read for HR, no direct writes for anyone.
REVOKE INSERT, UPDATE, DELETE ON public.attendance_audit_logs FROM authenticated, anon;
GRANT SELECT ON public.attendance_audit_logs TO authenticated;

DROP POLICY IF EXISTS attendance_audit_logs_hr_select ON public.attendance_audit_logs;
CREATE POLICY attendance_audit_logs_hr_select ON public.attendance_audit_logs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_access_tenant(tenant_id) AND is_hr());
