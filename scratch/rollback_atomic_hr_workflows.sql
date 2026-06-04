-- Manual rollback helper for migrations/20260602120000_atomic_hr_workflows.sql.
-- Do not run this during normal deployment. Use it only if you need to reverse
-- the additive RPC hardening pass after applying that migration.

DROP FUNCTION IF EXISTS public.employee_cancel_pending_leave(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_apply_leave_request(uuid, uuid, date, date, text);
DROP FUNCTION IF EXISTS public.hr_update_attendance(uuid, uuid, uuid, date, time, time, text, boolean);
DROP FUNCTION IF EXISTS public.hr_reject_attendance_correction(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.hr_approve_attendance_correction(uuid, uuid);
DROP FUNCTION IF EXISTS public.hr_create_remote_exception(uuid, uuid, text, date, date, text);
DROP FUNCTION IF EXISTS public.hr_set_overtime_status(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.hr_schedule_shift_change(uuid, uuid, uuid, date);
DROP FUNCTION IF EXISTS public.hr_deactivate_shift(uuid, uuid);
DROP FUNCTION IF EXISTS public.hr_save_shift(uuid, uuid, text, time, time, integer[], time, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.assert_date_range_unlocked(uuid, date, date);
DROP FUNCTION IF EXISTS public.assert_hr_for_tenant(uuid);
DROP FUNCTION IF EXISTS public.get_auth_employee_id(uuid);

DROP INDEX IF EXISTS public.uq_pending_attendance_correction;
DROP INDEX IF EXISTS public.uq_overtime_attendance;
DROP INDEX IF EXISTS public.uq_employee_shifts_effective_from;

-- The migration also replaces approve_leave_request and cancel_leave_request
-- with safer versions. If you need to restore the older implementations, re-run:
--   update-approve-leave-request-rpc.sql
--   update-cancel-leave-request-rpc.sql
