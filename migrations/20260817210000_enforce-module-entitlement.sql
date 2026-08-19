-- Phase 0b, part 2 of 2: enforce module entitlement in RLS.
--
-- Adds one RESTRICTIVE policy per module-owned table (34 tables across 11 modules).
-- A module disabled for a tenant becomes unreadable and unwritable through the API — not merely
-- hidden in the nav. Design: doc/architecture/02-module-registry.md §3.
--
-- NO BEHAVIOUR CHANGE ON APPLY: 20260817200000 backfilled every existing tenant with every module
-- enabled, so tenant_has_module() returns true everywhere today. This migration only makes the
-- switch *effective* for when a superadmin turns something off.
--
-- Two deliberate choices:
--
--   RESTRICTIVE, not PERMISSIVE. Permissive policies OR together, so a permissive entitlement check
--   would WIDEN access rather than gate it. RESTRICTIVE ANDs onto every other policy, which is the
--   semantics we want. This mirrors the existing tenant_active_restrictive.
--
--   Wrapped in (SELECT ...). Postgres evaluates a scalar subquery once per query as an InitPlan
--   rather than once per row. tenant_active_restrictive already uses this form; match it.
--
-- TO authenticated, not TO public: anon has no tenant, so tenant_has_module() would be false for it
-- anyway, and anon already cannot read these tables. Restricting to authenticated avoids adding a
-- policy anon must evaluate on every request.
--
-- `directory` (employees, org_units, job_titles, locations, employment_types) is CORE and is
-- deliberately NOT gated — every other module joins to employees, so gating it would make the
-- product inoperable rather than reduced.

-- attendance
DROP POLICY IF EXISTS module_enabled_attendance ON public.attendance;
CREATE POLICY module_enabled_attendance ON public.attendance
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('attendance')))
WITH CHECK ((SELECT public.tenant_has_module('attendance')));
DROP POLICY IF EXISTS module_enabled_attendance ON public.attendance_breaks;
CREATE POLICY module_enabled_attendance ON public.attendance_breaks
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('attendance')))
WITH CHECK ((SELECT public.tenant_has_module('attendance')));
DROP POLICY IF EXISTS module_enabled_attendance ON public.attendance_selfies;
CREATE POLICY module_enabled_attendance ON public.attendance_selfies
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('attendance')))
WITH CHECK ((SELECT public.tenant_has_module('attendance')));
DROP POLICY IF EXISTS module_enabled_attendance ON public.attendance_corrections;
CREATE POLICY module_enabled_attendance ON public.attendance_corrections
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('attendance')))
WITH CHECK ((SELECT public.tenant_has_module('attendance')));
DROP POLICY IF EXISTS module_enabled_attendance ON public.attendance_location_exceptions;
CREATE POLICY module_enabled_attendance ON public.attendance_location_exceptions
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('attendance')))
WITH CHECK ((SELECT public.tenant_has_module('attendance')));
DROP POLICY IF EXISTS module_enabled_attendance ON public.overtime_records;
CREATE POLICY module_enabled_attendance ON public.overtime_records
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('attendance')))
WITH CHECK ((SELECT public.tenant_has_module('attendance')));
DROP POLICY IF EXISTS module_enabled_attendance ON public.shifts;
CREATE POLICY module_enabled_attendance ON public.shifts
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('attendance')))
WITH CHECK ((SELECT public.tenant_has_module('attendance')));
DROP POLICY IF EXISTS module_enabled_attendance ON public.employee_shifts;
CREATE POLICY module_enabled_attendance ON public.employee_shifts
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('attendance')))
WITH CHECK ((SELECT public.tenant_has_module('attendance')));

-- leave
DROP POLICY IF EXISTS module_enabled_leave ON public.leaves;
CREATE POLICY module_enabled_leave ON public.leaves
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('leave')))
WITH CHECK ((SELECT public.tenant_has_module('leave')));
DROP POLICY IF EXISTS module_enabled_leave ON public.leave_types;
CREATE POLICY module_enabled_leave ON public.leave_types
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('leave')))
WITH CHECK ((SELECT public.tenant_has_module('leave')));
DROP POLICY IF EXISTS module_enabled_leave ON public.leave_balances;
CREATE POLICY module_enabled_leave ON public.leave_balances
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('leave')))
WITH CHECK ((SELECT public.tenant_has_module('leave')));
DROP POLICY IF EXISTS module_enabled_leave ON public.holidays;
CREATE POLICY module_enabled_leave ON public.holidays
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('leave')))
WITH CHECK ((SELECT public.tenant_has_module('leave')));

-- payroll
DROP POLICY IF EXISTS module_enabled_payroll ON public.salary_structures;
CREATE POLICY module_enabled_payroll ON public.salary_structures
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('payroll')))
WITH CHECK ((SELECT public.tenant_has_module('payroll')));
DROP POLICY IF EXISTS module_enabled_payroll ON public.payroll_runs;
CREATE POLICY module_enabled_payroll ON public.payroll_runs
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('payroll')))
WITH CHECK ((SELECT public.tenant_has_module('payroll')));
DROP POLICY IF EXISTS module_enabled_payroll ON public.payslips;
CREATE POLICY module_enabled_payroll ON public.payslips
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('payroll')))
WITH CHECK ((SELECT public.tenant_has_module('payroll')));
DROP POLICY IF EXISTS module_enabled_payroll ON public.it_declarations;
CREATE POLICY module_enabled_payroll ON public.it_declarations
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('payroll')))
WITH CHECK ((SELECT public.tenant_has_module('payroll')));
DROP POLICY IF EXISTS module_enabled_payroll ON public.it_declaration_windows;
CREATE POLICY module_enabled_payroll ON public.it_declaration_windows
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('payroll')))
WITH CHECK ((SELECT public.tenant_has_module('payroll')));

-- tasks
DROP POLICY IF EXISTS module_enabled_tasks ON public.tasks;
CREATE POLICY module_enabled_tasks ON public.tasks
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('tasks')))
WITH CHECK ((SELECT public.tenant_has_module('tasks')));
DROP POLICY IF EXISTS module_enabled_tasks ON public.task_submissions;
CREATE POLICY module_enabled_tasks ON public.task_submissions
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('tasks')))
WITH CHECK ((SELECT public.tenant_has_module('tasks')));
DROP POLICY IF EXISTS module_enabled_tasks ON public.projects;
CREATE POLICY module_enabled_tasks ON public.projects
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('tasks')))
WITH CHECK ((SELECT public.tenant_has_module('tasks')));

-- expenses
DROP POLICY IF EXISTS module_enabled_expenses ON public.expenses;
CREATE POLICY module_enabled_expenses ON public.expenses
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('expenses')))
WITH CHECK ((SELECT public.tenant_has_module('expenses')));

-- insurance
DROP POLICY IF EXISTS module_enabled_insurance ON public.insurance_policies;
CREATE POLICY module_enabled_insurance ON public.insurance_policies
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('insurance')))
WITH CHECK ((SELECT public.tenant_has_module('insurance')));

-- policy_center
DROP POLICY IF EXISTS module_enabled_policy_center ON public.hr_policies;
CREATE POLICY module_enabled_policy_center ON public.hr_policies
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('policy_center')))
WITH CHECK ((SELECT public.tenant_has_module('policy_center')));
DROP POLICY IF EXISTS module_enabled_policy_center ON public.employee_policy_acknowledgements;
CREATE POLICY module_enabled_policy_center ON public.employee_policy_acknowledgements
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('policy_center')))
WITH CHECK ((SELECT public.tenant_has_module('policy_center')));

-- chat
DROP POLICY IF EXISTS module_enabled_chat ON public.chat_channels;
CREATE POLICY module_enabled_chat ON public.chat_channels
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('chat')))
WITH CHECK ((SELECT public.tenant_has_module('chat')));
DROP POLICY IF EXISTS module_enabled_chat ON public.chat_channel_members;
CREATE POLICY module_enabled_chat ON public.chat_channel_members
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('chat')))
WITH CHECK ((SELECT public.tenant_has_module('chat')));
DROP POLICY IF EXISTS module_enabled_chat ON public.chat_messages;
CREATE POLICY module_enabled_chat ON public.chat_messages
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('chat')))
WITH CHECK ((SELECT public.tenant_has_module('chat')));

-- connect
DROP POLICY IF EXISTS module_enabled_connect ON public.posts;
CREATE POLICY module_enabled_connect ON public.posts
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('connect')))
WITH CHECK ((SELECT public.tenant_has_module('connect')));
DROP POLICY IF EXISTS module_enabled_connect ON public.post_reactions;
CREATE POLICY module_enabled_connect ON public.post_reactions
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('connect')))
WITH CHECK ((SELECT public.tenant_has_module('connect')));

-- onboarding
DROP POLICY IF EXISTS module_enabled_onboarding ON public.employee_onboarding;
CREATE POLICY module_enabled_onboarding ON public.employee_onboarding
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('onboarding')))
WITH CHECK ((SELECT public.tenant_has_module('onboarding')));
DROP POLICY IF EXISTS module_enabled_onboarding ON public.employee_onboarding_self;
CREATE POLICY module_enabled_onboarding ON public.employee_onboarding_self
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('onboarding')))
WITH CHECK ((SELECT public.tenant_has_module('onboarding')));

-- offboarding
DROP POLICY IF EXISTS module_enabled_offboarding ON public.exit_requests;
CREATE POLICY module_enabled_offboarding ON public.exit_requests
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('offboarding')))
WITH CHECK ((SELECT public.tenant_has_module('offboarding')));
DROP POLICY IF EXISTS module_enabled_offboarding ON public.exit_clearances;
CREATE POLICY module_enabled_offboarding ON public.exit_clearances
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('offboarding')))
WITH CHECK ((SELECT public.tenant_has_module('offboarding')));
DROP POLICY IF EXISTS module_enabled_offboarding ON public.exit_clearance_templates;
CREATE POLICY module_enabled_offboarding ON public.exit_clearance_templates
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT public.tenant_has_module('offboarding')))
WITH CHECK ((SELECT public.tenant_has_module('offboarding')));
