-- Close the unauthenticated execution surface on SECURITY DEFINER functions.
--
-- SECURITY DEFINER functions run as their owner and bypass RLS entirely. `anon` is the key shipped
-- in the JavaScript bundle, so any function granting EXECUTE to anon is reachable by anyone on the
-- internet. 57 SECURITY DEFINER functions were in that state.
--
-- VERIFIED EXPLOITABLE before this migration (anon key, no login):
--   POST /api/database/rpc/get_user_id_by_email {"user_email":"…"}       -> 200, internal auth UUID
--   POST /api/database/rpc/get_auth_user_details_by_email {"user_email"} -> 200, id + created_at
-- i.e. unauthenticated user enumeration. 06-recommendations.md §A prescribed revoking exactly this
-- on 2026-08-12; it was never applied.
--
-- CLASSIFICATION (every caller in src/ and functions/ was enumerated):
--
--   KEEP anon (4) — called by RESTRICTIVE policies that are TO public, so anon evaluates them
--       on every unauthenticated read. Revoking would turn an empty result into "permission denied".
--       They leak nothing: each derives from auth.uid(), which is NULL for anon.
--         can_access_tenant
--         get_auth_tenant_id
--         is_admin
--         is_hr
--
--   REVOKE anon, KEEP authenticated (41) — called by logged-in users from the SPA.
--
--   REVOKE anon AND authenticated (12) — trigger functions (EXECUTE is not checked when a
--       trigger fires) and functions called only by edge functions, which authenticate with ADMIN_KEY.
--       project_admin retains EXECUTE by ownership, so edge functions are unaffected.
--
-- Grants to project_admin are never touched.

-- ── Revoke from anon and authenticated ───────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.audit_tenant_changes() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(p_tenant_id uuid, p_user_id uuid, p_endpoint text, p_max_requests integer, p_window_interval interval) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_auto_close_active_break() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_check_insurance_expiries() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_auth_user_details_by_email(user_email text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_auth_user_details_by_email_v2(user_email text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_application_status_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_chat_channel() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_chat_message() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_employee_notification() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_employee_password_by_hr(target_email text, target_password_hash text, tenant_uuid uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_admin_users() FROM anon, authenticated;

-- ── Revoke from anon only (authenticated retained: live SPA callers) ─────────
REVOKE EXECUTE ON FUNCTION public.approve_leave_request(p_leave_id uuid, p_working_dates date[], p_approved_business_days integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_task_request(p_task_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_task_request(p_task_id uuid, p_hr_employee_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_date_range_unlocked(p_tenant_id uuid, p_start_date date, p_end_date date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_hr_for_tenant(p_tenant_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_leave_request(p_leave_id uuid, p_rejection_reason text, p_new_status text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_employee_exists_by_email(user_email text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_employee_exists_by_email(user_email text, exclude_employee_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_onboarding_resumable(p_email text, p_tenant_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.close_stale_attendance() FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_chat_channel(channel_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.employee_apply_leave_request(p_tenant_id uuid, p_leave_type_id uuid, p_start_date date, p_end_date date, p_reason text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.employee_cancel_pending_leave(p_tenant_id uuid, p_leave_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.end_employee_break(p_attendance_id uuid, p_tenant_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_location_exceptions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_accrue_monthly_leaves() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_auto_redmark_tasks() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_cleanup_expired_onboarding() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_auth_employee_id(p_tenant_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_platform_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(user_email text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hr_approve_attendance_correction(p_tenant_id uuid, p_correction_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hr_create_remote_exception(p_tenant_id uuid, p_employee_id uuid, p_exception_type text, p_start_date date, p_end_date date, p_reason text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hr_deactivate_shift(p_tenant_id uuid, p_shift_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hr_reject_attendance_correction(p_tenant_id uuid, p_correction_id uuid, p_rejection_reason text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hr_save_shift(p_tenant_id uuid, p_shift_id uuid, p_name text, p_start_time time without time zone, p_end_time time without time zone, p_working_days integer[], p_half_day_cutoff_override time without time zone, p_punch_in_opens_minutes_before integer, p_late_mark_grace_override integer, p_is_default boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hr_schedule_shift_change(p_tenant_id uuid, p_employee_id uuid, p_shift_id uuid, p_effective_from date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hr_set_overtime_status(p_tenant_id uuid, p_overtime_id uuid, p_approved boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hr_update_attendance(p_tenant_id uuid, p_attendance_id uuid, p_employee_id uuid, p_date date, p_punch_in time without time zone, p_punch_out time without time zone, p_status text, p_is_late boolean, p_expected_status text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_announcement_dismiss(ann_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_announcement_view(ann_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_superadmin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text, p_lunch_minutes integer, p_overtime_enabled boolean, p_overtime_rate numeric, p_expected_shift_hours numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_work_hours numeric, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_task_request(p_task_id uuid, p_hr_employee_id uuid, p_notes text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_task_request(p_task_id uuid, p_notes text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_hr_user_metadata(user_email text, tenant_uuid uuid, user_name text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.start_employee_break(p_attendance_id uuid, p_tenant_id uuid, p_break_type text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_task_request(p_task_id uuid, p_employee_id uuid, p_notes text, p_attachment_url text, p_attachment_name text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_task_request(p_task_id uuid, p_notes text, p_attachment_url text, p_attachment_name text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.tenant_is_active(tenant_uuid uuid) FROM anon;
