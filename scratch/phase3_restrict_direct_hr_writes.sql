-- Optional phase-3 hardening after the atomic HR RPC migration has stabilized.
-- Review every remaining frontend direct write before running this script.
--
-- Why this is not part of the live migration:
-- Some non-HR flows, especially employee attendance punch-in/out, may still need
-- direct table writes. Run this only after those paths are migrated to RPCs too.

BEGIN;

-- Force sensitive HR mutation paths through SECURITY DEFINER RPCs.
-- Keep SELECT policies/RLS in place for normal reads.
REVOKE INSERT, UPDATE, DELETE ON public.leave_requests FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.employee_shifts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.overtime_records FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attendance_corrections FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attendance_location_exceptions FROM authenticated;

-- Attendance is intentionally left out until punch-in/out and break workflows
-- are also moved behind server-side RPCs.
-- REVOKE INSERT, UPDATE, DELETE ON public.attendance FROM authenticated;

COMMIT;

-- Rollback, if needed:
-- BEGIN;
-- GRANT INSERT, UPDATE, DELETE ON public.leave_requests TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.employee_shifts TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.overtime_records TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.attendance_corrections TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.attendance_location_exceptions TO authenticated;
-- COMMIT;
