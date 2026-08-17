-- Migration: InsForge HRMS Database Performance Tuning & Optimization
-- Date: 2026-06-23
-- Description: Creates missing foreign key and RLS column indexes concurrently and rewrites RLS policies to leverage cache-optimized (SELECT auth.uid()) subqueries.

-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- Therefore, this script is executed without a BEGIN/COMMIT block.

-- ============================================================================
-- PART 1: RLS POLICY OPTIMIZATIONS (auth.uid() -> (SELECT auth.uid()))
-- ============================================================================

-- 1. employees Table
DROP POLICY IF EXISTS employees_self_select ON public.employees;
CREATE POLICY employees_self_select ON public.employees
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS employees_self_update ON public.employees;
CREATE POLICY employees_self_update ON public.employees
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- 2. attendance Table
DROP POLICY IF EXISTS attendance_self_read ON public.attendance;
CREATE POLICY attendance_self_read ON public.attendance
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = employee_id AND e.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS attendance_self_update ON public.attendance;
CREATE POLICY attendance_self_update ON public.attendance
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = employee_id AND e.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = employee_id AND e.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS attendance_self_write ON public.attendance;
CREATE POLICY attendance_self_write ON public.attendance
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = employee_id AND e.user_id = (SELECT auth.uid())
  ));

-- 3. leaves Table
DROP POLICY IF EXISTS leaves_self_read ON public.leaves;
CREATE POLICY leaves_self_read ON public.leaves
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = employee_id AND e.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS leaves_self_insert ON public.leaves;
CREATE POLICY leaves_self_insert ON public.leaves
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = employee_id AND e.user_id = (SELECT auth.uid())
  ));

-- 4. tasks Table
DROP POLICY IF EXISTS tasks_self_read ON public.tasks;
CREATE POLICY tasks_self_read ON public.tasks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = assigned_to AND e.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS tasks_self_update ON public.tasks;
CREATE POLICY tasks_self_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = assigned_to AND e.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = assigned_to AND e.user_id = (SELECT auth.uid())
  ));

-- 5. attendance_location_exceptions Table
DROP POLICY IF EXISTS exceptions_self_read ON public.attendance_location_exceptions;
CREATE POLICY exceptions_self_read ON public.attendance_location_exceptions
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT id FROM public.employees WHERE user_id = (SELECT auth.uid())));

-- 6. attendance_selfies Table
DROP POLICY IF EXISTS selfies_self_read ON public.attendance_selfies;
CREATE POLICY selfies_self_read ON public.attendance_selfies
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT id FROM public.employees WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS selfies_self_insert ON public.attendance_selfies;
CREATE POLICY selfies_self_insert ON public.attendance_selfies
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.attendance a
    JOIN public.employees e ON e.id = a.employee_id
    WHERE a.id = attendance_selfies.attendance_id
      AND e.user_id = (SELECT auth.uid())
  ));

-- 7. attendance_breaks Table
DROP POLICY IF EXISTS breaks_self_read ON public.attendance_breaks;
CREATE POLICY breaks_self_read ON public.attendance_breaks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = employee_id AND e.user_id = (SELECT auth.uid())
  ));

-- 8. overtime_records Table
DROP POLICY IF EXISTS overtime_self_read ON public.overtime_records;
CREATE POLICY overtime_self_read ON public.overtime_records
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = overtime_records.employee_id
      AND e.user_id = (SELECT auth.uid())
  ));

-- 9. salary_structures Table
DROP POLICY IF EXISTS salary_self_read ON public.salary_structures;
CREATE POLICY salary_self_read ON public.salary_structures
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = salary_structures.employee_id
      AND e.user_id = (SELECT auth.uid())
  ));


-- ============================================================================
-- PART 2: CONCURRENT DATABASE INDEX CREATIONS (No Lockups)
-- ============================================================================

-- Tenant ID indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_submissions_tenant_id ON public.task_submissions(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_tenant_id ON public.attendance(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_events_tenant_id ON public.calendar_events(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_channel_members_tenant_id ON public.chat_channel_members(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_tenant_id ON public.chat_messages(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_tenant_id ON public.employees(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hr_policies_tenant_id ON public.hr_policies(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leaves_tenant_id ON public.leaves(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_tenant_id ON public.notifications(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_tenant_id ON public.tasks(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_tenant_id ON public.audit_logs(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_audit_logs_tenant_id ON public.attendance_audit_logs(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_office_locations_tenant_id ON public.office_locations(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employee_documents_tenant_id ON public.employee_documents(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_breaks_tenant_id ON public.attendance_breaks(tenant_id);

-- Employee ID indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_submissions_employee_id ON public.task_submissions(employee_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_salary_structures_employee_id ON public.salary_structures(employee_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payslips_employee_id ON public.payslips(employee_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employee_shifts_employee_id ON public.employee_shifts(employee_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_corrections_employee_id ON public.attendance_corrections(employee_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leave_balances_employee_id ON public.leave_balances(employee_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_overtime_records_employee_id ON public.overtime_records(employee_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employee_documents_employee_id ON public.employee_documents(employee_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_breaks_employee_id ON public.attendance_breaks(employee_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_selfies_employee_id ON public.attendance_selfies(employee_id);

-- Secondary FK / RLS filter columns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_current_break_id ON public.attendance(current_break_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leaves_leave_type_id ON public.leaves(leave_type_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_platform_audit_logs_actor_user_id ON public.platform_audit_logs(actor_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_salary_structures_created_by ON public.salary_structures(created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_runs_approved_by ON public.payroll_runs(approved_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_runs_run_by ON public.payroll_runs(run_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payslips_payroll_run_id ON public.payslips(payroll_run_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs(actor_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employee_shifts_shift_id ON public.employee_shifts(shift_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_corrections_reviewed_by ON public.attendance_corrections(reviewed_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leave_balances_leave_type_id ON public.leave_balances(leave_type_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_overtime_records_approved_by ON public.overtime_records(approved_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_overtime_records_attendance_id ON public.overtime_records(attendance_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_location_exceptions_approved_by ON public.attendance_location_exceptions(approved_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_location_exceptions_cancelled_by ON public.attendance_location_exceptions(cancelled_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_location_exceptions_requested_by ON public.attendance_location_exceptions(requested_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_candidate_profiles_primary_resume_id ON public.candidate_profiles(primary_resume_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_user_id ON public.activity(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recruiter_profiles_user_id ON public.recruiter_profiles(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_company_profiles_recruiter_id ON public.company_profiles(recruiter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_company_id ON public.jobs(company_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_alerts_candidate_id ON public.job_alerts(candidate_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nvites_candidate_id ON public.nvites(candidate_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nvites_job_id ON public.nvites(job_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nvites_recruiter_id ON public.nvites(recruiter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscription_events_recruiter_id ON public.subscription_events(recruiter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_application_events_application_id ON public.application_events(application_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_custom_proposals_recruiter_id ON public.custom_proposals(recruiter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_company_id ON public.subscriptions(company_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_resume_access_log_candidate_id ON public.resume_access_log(candidate_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
