-- Follow-up: revoke EXECUTE from PUBLIC, which is how anon actually held access.
--
-- 20260817100000 revoked the explicit `anon` grant, and verification showed the hole was still open:
--
--   POST /api/database/rpc/get_user_id_by_email  (anon key, no login)  -> 200, internal auth UUID
--
-- Cause: PostgreSQL grants EXECUTE to PUBLIC on every new function by default. In pg_proc.proacl that
-- appears as a leading `=X/owner` entry with an empty grantee. `anon` inherits from PUBLIC, so
-- revoking the role-specific grant changed nothing while the PUBLIC grant remained.
--
--   before: =X/project_admin | project_admin=X/project_admin | authenticated=X/project_admin | anon=X/…
--                ^^^^ this is PUBLIC — the one that mattered
--
-- This migration revokes the PUBLIC grant on 55 SECURITY DEFINER functions and re-grants
-- EXECUTE explicitly to `authenticated` where the SPA needs it, so the surviving access is stated
-- rather than inherited.
--
-- The four RLS helpers that TO public policies depend on (can_access_tenant, is_admin, is_hr,
-- get_auth_tenant_id) keep their PUBLIC grant — see 20260817100000 for the reasoning.

-- ── Revoke from PUBLIC entirely: triggers (EXECUTE unchecked at fire time) and
--    edge-only functions (callers authenticate with ADMIN_KEY / project_admin) ──
REVOKE EXECUTE ON FUNCTION public.audit_tenant_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(p_tenant_id uuid, p_user_id uuid, p_endpoint text, p_max_requests integer, p_window_interval interval) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_auto_close_active_break() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_check_insurance_expiries() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_auth_user_details_by_email(user_email text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_auth_user_details_by_email_v2(user_email text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_application_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_chat_channel() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_chat_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_admin_users() FROM PUBLIC, anon, authenticated;

-- ── Revoke PUBLIC, grant authenticated explicitly (live SPA callers) ─────────
REVOKE EXECUTE ON FUNCTION public.acknowledge_policy_transaction(p_policy_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_policy_transaction(p_policy_id uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_leave_request(p_leave_id uuid, p_working_dates date[], p_approved_business_days integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_leave_request(p_leave_id uuid, p_working_dates date[], p_approved_business_days integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_task_request(p_task_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_task_request(p_task_id uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_date_range_unlocked(p_tenant_id uuid, p_start_date date, p_end_date date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_date_range_unlocked(p_tenant_id uuid, p_start_date date, p_end_date date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_hr_for_tenant(p_tenant_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_hr_for_tenant(p_tenant_id uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_leave_request(p_leave_id uuid, p_rejection_reason text, p_new_status text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_leave_request(p_leave_id uuid, p_rejection_reason text, p_new_status text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.check_employee_exists_by_email(user_email text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_employee_exists_by_email(user_email text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.check_employee_exists_by_email(user_email text, exclude_employee_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_employee_exists_by_email(user_email text, exclude_employee_id uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.check_onboarding_resumable(p_email text, p_tenant_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_onboarding_resumable(p_email text, p_tenant_id uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.close_stale_attendance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_stale_attendance() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_policy_notifications_transaction(p_policy_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_policy_notifications_transaction(p_policy_id uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.deactivate_leave_type_transaction(p_leave_type_id uuid, p_expected_updated_at timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_leave_type_transaction(p_leave_type_id uuid, p_expected_updated_at timestamp with time zone) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_chat_channel(channel_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_chat_channel(channel_id uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.employee_apply_leave_request(p_tenant_id uuid, p_leave_type_id uuid, p_start_date date, p_end_date date, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_apply_leave_request(p_tenant_id uuid, p_leave_type_id uuid, p_start_date date, p_end_date date, p_reason text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.employee_cancel_pending_leave(p_tenant_id uuid, p_leave_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_cancel_pending_leave(p_tenant_id uuid, p_leave_id uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.end_employee_break(p_attendance_id uuid, p_tenant_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_employee_break(p_attendance_id uuid, p_tenant_id uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_location_exceptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_location_exceptions() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_accrue_monthly_leaves() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_accrue_monthly_leaves() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_auto_redmark_tasks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_auto_redmark_tasks() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_cleanup_expired_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cleanup_expired_onboarding() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_auth_employee_id(p_tenant_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_employee_id(p_tenant_id uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_employee_visible_hr_policies(p_search text, p_limit integer, p_offset integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_visible_hr_policies(p_search text, p_limit integer, p_offset integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_hr_policy_library(p_search text, p_visibility text, p_limit integer, p_offset integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hr_policy_library(p_search text, p_visibility text, p_limit integer, p_offset integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_platform_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_platform_role() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(user_email text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(user_email text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.hr_approve_attendance_correction(p_tenant_id uuid, p_correction_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_approve_attendance_correction(p_tenant_id uuid, p_correction_id uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.hr_create_remote_exception(p_tenant_id uuid, p_employee_id uuid, p_exception_type text, p_start_date date, p_end_date date, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_create_remote_exception(p_tenant_id uuid, p_employee_id uuid, p_exception_type text, p_start_date date, p_end_date date, p_reason text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.hr_deactivate_shift(p_tenant_id uuid, p_shift_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_deactivate_shift(p_tenant_id uuid, p_shift_id uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.hr_reject_attendance_correction(p_tenant_id uuid, p_correction_id uuid, p_rejection_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_reject_attendance_correction(p_tenant_id uuid, p_correction_id uuid, p_rejection_reason text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.hr_save_shift(p_tenant_id uuid, p_shift_id uuid, p_name text, p_start_time time without time zone, p_end_time time without time zone, p_working_days integer[], p_half_day_cutoff_override time without time zone, p_punch_in_opens_minutes_before integer, p_late_mark_grace_override integer, p_is_default boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_save_shift(p_tenant_id uuid, p_shift_id uuid, p_name text, p_start_time time without time zone, p_end_time time without time zone, p_working_days integer[], p_half_day_cutoff_override time without time zone, p_punch_in_opens_minutes_before integer, p_late_mark_grace_override integer, p_is_default boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.hr_schedule_shift_change(p_tenant_id uuid, p_employee_id uuid, p_shift_id uuid, p_effective_from date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_schedule_shift_change(p_tenant_id uuid, p_employee_id uuid, p_shift_id uuid, p_effective_from date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.hr_set_overtime_status(p_tenant_id uuid, p_overtime_id uuid, p_approved boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_set_overtime_status(p_tenant_id uuid, p_overtime_id uuid, p_approved boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.hr_update_attendance(p_tenant_id uuid, p_attendance_id uuid, p_employee_id uuid, p_date date, p_punch_in time without time zone, p_punch_out time without time zone, p_status text, p_is_late boolean, p_expected_status text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_update_attendance(p_tenant_id uuid, p_attendance_id uuid, p_employee_id uuid, p_date date, p_punch_in time without time zone, p_punch_out time without time zone, p_status text, p_is_late boolean, p_expected_status text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.initialize_leave_balances_transaction(p_year integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initialize_leave_balances_transaction(p_year integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_superadmin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_superadmin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text, p_lunch_minutes integer, p_overtime_enabled boolean, p_overtime_rate numeric, p_expected_shift_hours numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text, p_lunch_minutes integer, p_overtime_enabled boolean, p_overtime_rate numeric, p_expected_shift_hours numeric) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_task_request(p_task_id uuid, p_notes text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_task_request(p_task_id uuid, p_notes text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_attendance_policy_transaction(p_tenant_id uuid, p_expected_tenant_updated_at timestamp with time zone, p_expected_setting_versions jsonb, p_policy jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_attendance_policy_transaction(p_tenant_id uuid, p_expected_tenant_updated_at timestamp with time zone, p_expected_setting_versions jsonb, p_policy jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_leave_type_transaction(p_leave_type_id uuid, p_expected_updated_at timestamp with time zone, p_payload jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_leave_type_transaction(p_leave_type_id uuid, p_expected_updated_at timestamp with time zone, p_payload jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_task_policy_transaction(p_tenant_id uuid, p_expected_tenant_updated_at timestamp with time zone, p_expected_setting_versions jsonb, p_policy jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_task_policy_transaction(p_tenant_id uuid, p_expected_tenant_updated_at timestamp with time zone, p_expected_setting_versions jsonb, p_policy jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_hr_user_metadata(user_email text, tenant_uuid uuid, user_name text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_hr_user_metadata(user_email text, tenant_uuid uuid, user_name text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.start_employee_break(p_attendance_id uuid, p_tenant_id uuid, p_break_type text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_employee_break(p_attendance_id uuid, p_tenant_id uuid, p_break_type text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_task_request(p_task_id uuid, p_employee_id uuid, p_notes text, p_attachment_url text, p_attachment_name text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_task_request(p_task_id uuid, p_employee_id uuid, p_notes text, p_attachment_url text, p_attachment_name text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_task_request(p_task_id uuid, p_notes text, p_attachment_url text, p_attachment_name text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_task_request(p_task_id uuid, p_notes text, p_attachment_url text, p_attachment_name text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.tenant_is_active(tenant_uuid uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_is_active(tenant_uuid uuid) TO authenticated;
