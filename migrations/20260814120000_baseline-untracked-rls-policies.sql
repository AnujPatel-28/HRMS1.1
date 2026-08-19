-- Baseline: capture RLS policies that exist in the live database but in no migration.
--
-- Provenance fix, NOT a behaviour change. Every statement below reproduces a policy exactly as
-- pg_policies reports it today, so applying this migration is a no-op against the live database.
-- Its purpose is to put the security model under version control (P1).
--
-- Context: 211 policies live, 100 already in migrations/, 6 in loose root scripts, and these
-- 111 in no .sql file at all. Half the access-control model could not be reviewed in a diff,
-- recreated on a new project, or diffed between environments. Three untracked policies on
-- `employees` caused a full outage on 2026-08-14 (42P17) precisely because no review could see them.
-- See system-audit-2026-08/10-policy-provenance-drift.md.
--
-- VERIFICATION: snapshot pg_policies (including qual/with_check) before and after applying this
-- migration; the diff must be empty. A non-empty diff means a reconstruction is wrong.
--
-- Deliberately NOT changed here (each is its own migration):
--   * announcements "Anyone can read active announcements" — captured as-is; the tenant/is_active
--     fix follows separately so the leak fix is reviewable on its own.
--   * the admin_bypass family (TO project_admin USING (true)) on 9 tables — consistent with how
--     InsForge admin access works; changing it is a separate decision tied to the admin key rotation.
--   * the duplicate employees_self_read / employees_self_select pair.
--   * test_log / test_mcp_sync — table drops, not policy work.
--
-- Generated from live pg_policies on 2026-08-14. Regenerate rather than hand-edit.

-- [  1] activity.Users can insert own activity
DROP POLICY IF EXISTS "Users can insert own activity" ON public.activity;
CREATE POLICY "Users can insert own activity" ON public.activity
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK ((user_id = auth.uid()));

-- [  2] activity.Users can view own activity
DROP POLICY IF EXISTS "Users can view own activity" ON public.activity;
CREATE POLICY "Users can view own activity" ON public.activity
AS PERMISSIVE
FOR SELECT
TO public
USING ((user_id = auth.uid()));

-- [  3] activity.admin_bypass
DROP POLICY IF EXISTS "admin_bypass" ON public.activity;
CREATE POLICY "admin_bypass" ON public.activity
AS PERMISSIVE
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

-- [  4] admin_users.admin_bypass_admin_users
DROP POLICY IF EXISTS "admin_bypass_admin_users" ON public.admin_users;
CREATE POLICY "admin_bypass_admin_users" ON public.admin_users
AS PERMISSIVE
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

-- [  5] admin_users.admin_users_authenticated_select
DROP POLICY IF EXISTS "admin_users_authenticated_select" ON public.admin_users;
CREATE POLICY "admin_users_authenticated_select" ON public.admin_users
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (true);

-- [  6] ai_suggestion_cache.admin_bypass_cache
DROP POLICY IF EXISTS "admin_bypass_cache" ON public.ai_suggestion_cache;
CREATE POLICY "admin_bypass_cache" ON public.ai_suggestion_cache
AS PERMISSIVE
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

-- [  7] ai_suggestion_cache.authenticated_read_cache
DROP POLICY IF EXISTS "authenticated_read_cache" ON public.ai_suggestion_cache;
CREATE POLICY "authenticated_read_cache" ON public.ai_suggestion_cache
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (true);

-- [  8] announcement_dismissals.Users can insert own dismissals
DROP POLICY IF EXISTS "Users can insert own dismissals" ON public.announcement_dismissals;
CREATE POLICY "Users can insert own dismissals" ON public.announcement_dismissals
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK ((user_id = auth.uid()));

-- [  9] announcement_dismissals.Users can read own dismissals
DROP POLICY IF EXISTS "Users can read own dismissals" ON public.announcement_dismissals;
CREATE POLICY "Users can read own dismissals" ON public.announcement_dismissals
AS PERMISSIVE
FOR SELECT
TO public
USING ((user_id = auth.uid()));

-- [ 10] announcement_dismissals.admin_bypass_dismissals
DROP POLICY IF EXISTS "admin_bypass_dismissals" ON public.announcement_dismissals;
CREATE POLICY "admin_bypass_dismissals" ON public.announcement_dismissals
AS PERMISSIVE
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

-- [ 11] announcements.Admins can manage announcements
DROP POLICY IF EXISTS "Admins can manage announcements" ON public.announcements;
CREATE POLICY "Admins can manage announcements" ON public.announcements
AS PERMISSIVE
FOR ALL
TO public
USING (is_admin());

-- [ 12] announcements.Anyone can read active announcements
DROP POLICY IF EXISTS "Anyone can read active announcements" ON public.announcements;
CREATE POLICY "Anyone can read active announcements" ON public.announcements
AS PERMISSIVE
FOR SELECT
TO public
USING (true);

-- [ 13] announcements.admin_bypass_announcements
DROP POLICY IF EXISTS "admin_bypass_announcements" ON public.announcements;
CREATE POLICY "admin_bypass_announcements" ON public.announcements
AS PERMISSIVE
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

-- [ 14] attendance_breaks.breaks_restrictive
DROP POLICY IF EXISTS "breaks_restrictive" ON public.attendance_breaks;
CREATE POLICY "breaks_restrictive" ON public.attendance_breaks
AS RESTRICTIVE
FOR ALL
TO public
USING (( SELECT can_access_tenant(attendance_breaks.tenant_id) AS can_access_tenant))
WITH CHECK (( SELECT can_access_tenant(attendance_breaks.tenant_id) AS can_access_tenant));

-- [ 15] attendance_location_exceptions.exceptions_hr_all
DROP POLICY IF EXISTS "exceptions_hr_all" ON public.attendance_location_exceptions;
CREATE POLICY "exceptions_hr_all" ON public.attendance_location_exceptions
AS PERMISSIVE
FOR ALL
TO authenticated
USING (( SELECT is_hr() AS is_hr))
WITH CHECK (( SELECT is_hr() AS is_hr));

-- [ 16] attendance_location_exceptions.exceptions_self_read
DROP POLICY IF EXISTS "exceptions_self_read" ON public.attendance_location_exceptions;
CREATE POLICY "exceptions_self_read" ON public.attendance_location_exceptions
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((employee_id = ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = auth.uid()))));

-- [ 17] attendance_location_exceptions.exceptions_tenant_active_restrictive
DROP POLICY IF EXISTS "exceptions_tenant_active_restrictive" ON public.attendance_location_exceptions;
CREATE POLICY "exceptions_tenant_active_restrictive" ON public.attendance_location_exceptions
AS RESTRICTIVE
FOR ALL
TO public
USING (( SELECT can_access_tenant(attendance_location_exceptions.tenant_id) AS can_access_tenant))
WITH CHECK (( SELECT can_access_tenant(attendance_location_exceptions.tenant_id) AS can_access_tenant));

-- [ 18] attendance_location_exceptions.exceptions_tenant_isolation
DROP POLICY IF EXISTS "exceptions_tenant_isolation" ON public.attendance_location_exceptions;
CREATE POLICY "exceptions_tenant_isolation" ON public.attendance_location_exceptions
AS PERMISSIVE
FOR ALL
TO authenticated
USING ((tenant_id = get_auth_tenant_id()))
WITH CHECK ((tenant_id = get_auth_tenant_id()));

-- [ 19] attendance_selfies.selfies_tenant_active_restrictive
DROP POLICY IF EXISTS "selfies_tenant_active_restrictive" ON public.attendance_selfies;
CREATE POLICY "selfies_tenant_active_restrictive" ON public.attendance_selfies
AS RESTRICTIVE
FOR ALL
TO public
USING (( SELECT can_access_tenant(attendance_selfies.tenant_id) AS can_access_tenant))
WITH CHECK (( SELECT can_access_tenant(attendance_selfies.tenant_id) AS can_access_tenant));

-- [ 20] audit_logs.HR can view tenant audit logs
DROP POLICY IF EXISTS "HR can view tenant audit logs" ON public.audit_logs;
CREATE POLICY "HR can view tenant audit logs" ON public.audit_logs
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (((tenant_id = get_auth_tenant_id()) AND (( SELECT employees.role
   FROM employees
  WHERE (employees.user_id = auth.uid())
 LIMIT 1) = 'hr'::user_role)));

-- [ 21] audit_logs.Superadmin can view all audit logs
DROP POLICY IF EXISTS "Superadmin can view all audit logs" ON public.audit_logs;
CREATE POLICY "Superadmin can view all audit logs" ON public.audit_logs
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (is_superadmin());

-- [ 22] audit_logs.Users can insert audit logs
DROP POLICY IF EXISTS "Users can insert audit logs" ON public.audit_logs;
CREATE POLICY "Users can insert audit logs" ON public.audit_logs
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (((tenant_id = get_auth_tenant_id()) OR is_superadmin()));

-- [ 23] audit_logs.admin_bypass
DROP POLICY IF EXISTS "admin_bypass" ON public.audit_logs;
CREATE POLICY "admin_bypass" ON public.audit_logs
AS PERMISSIVE
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

-- [ 24] calendar_events.calendar_events_hr_all
DROP POLICY IF EXISTS "calendar_events_hr_all" ON public.calendar_events;
CREATE POLICY "calendar_events_hr_all" ON public.calendar_events
AS PERMISSIVE
FOR ALL
TO authenticated
USING (( SELECT is_hr() AS is_hr))
WITH CHECK (( SELECT is_hr() AS is_hr));

-- [ 25] calendar_events.calendar_events_self_rw
DROP POLICY IF EXISTS "calendar_events_self_rw" ON public.calendar_events;
CREATE POLICY "calendar_events_self_rw" ON public.calendar_events
AS PERMISSIVE
FOR ALL
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = calendar_events.employee_id) AND (e.user_id = ( SELECT auth.uid() AS uid))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = calendar_events.employee_id) AND (e.user_id = ( SELECT auth.uid() AS uid))))));

-- [ 26] chat_channel_members.members_employee_select
DROP POLICY IF EXISTS "members_employee_select" ON public.chat_channel_members;
CREATE POLICY "members_employee_select" ON public.chat_channel_members
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.user_id = ( SELECT auth.uid() AS uid)) AND (e.id = chat_channel_members.employee_id)))));

-- [ 27] chat_channel_members.members_hr_all
DROP POLICY IF EXISTS "members_hr_all" ON public.chat_channel_members;
CREATE POLICY "members_hr_all" ON public.chat_channel_members
AS PERMISSIVE
FOR ALL
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM auth.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (COALESCE((u.metadata ->> 'role'::text), ''::text) = 'hr'::text)))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM auth.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (COALESCE((u.metadata ->> 'role'::text), ''::text) = 'hr'::text)))));

-- [ 28] chat_channel_members.members_project_admin
DROP POLICY IF EXISTS "members_project_admin" ON public.chat_channel_members;
CREATE POLICY "members_project_admin" ON public.chat_channel_members
AS PERMISSIVE
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

-- [ 29] chat_channels.channels_employee_select
DROP POLICY IF EXISTS "channels_employee_select" ON public.chat_channels;
CREATE POLICY "channels_employee_select" ON public.chat_channels
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (((type = 'global'::text) OR ((type = 'department'::text) AND (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.user_id = ( SELECT auth.uid() AS uid)) AND (e.department = ANY (chat_channels.target_departments)))))) OR ((type = 'custom'::text) AND (EXISTS ( SELECT 1
   FROM (chat_channel_members ccm
     JOIN employees e ON ((e.id = ccm.employee_id)))
  WHERE ((ccm.channel_id = chat_channels.id) AND (e.user_id = ( SELECT auth.uid() AS uid))))))));

-- [ 30] chat_channels.channels_hr_all
DROP POLICY IF EXISTS "channels_hr_all" ON public.chat_channels;
CREATE POLICY "channels_hr_all" ON public.chat_channels
AS PERMISSIVE
FOR ALL
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM auth.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (COALESCE((u.metadata ->> 'role'::text), ''::text) = 'hr'::text)))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM auth.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (COALESCE((u.metadata ->> 'role'::text), ''::text) = 'hr'::text)))));

-- [ 31] chat_channels.channels_project_admin
DROP POLICY IF EXISTS "channels_project_admin" ON public.chat_channels;
CREATE POLICY "channels_project_admin" ON public.chat_channels
AS PERMISSIVE
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

-- [ 32] chat_messages.chat_messages_employee_insert
DROP POLICY IF EXISTS "chat_messages_employee_insert" ON public.chat_messages;
CREATE POLICY "chat_messages_employee_insert" ON public.chat_messages
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.user_id = ( SELECT auth.uid() AS uid)) AND (e.id = chat_messages.sender_id)))) AND (channel <> 'announcements'::text) AND (EXISTS ( SELECT 1
   FROM chat_channels cc
  WHERE ((cc.name = chat_messages.channel) AND ((cc.type = 'global'::text) OR ((cc.type = 'department'::text) AND (EXISTS ( SELECT 1
           FROM employees e
          WHERE ((e.user_id = ( SELECT auth.uid() AS uid)) AND (e.department = ANY (cc.target_departments)))))) OR ((cc.type = 'custom'::text) AND (EXISTS ( SELECT 1
           FROM (chat_channel_members ccm
             JOIN employees e ON ((e.id = ccm.employee_id)))
          WHERE ((ccm.channel_id = cc.id) AND (e.user_id = ( SELECT auth.uid() AS uid))))))))))));

-- [ 33] chat_messages.chat_messages_hr_all
DROP POLICY IF EXISTS "chat_messages_hr_all" ON public.chat_messages;
CREATE POLICY "chat_messages_hr_all" ON public.chat_messages
AS PERMISSIVE
FOR ALL
TO authenticated
USING (( SELECT is_hr() AS is_hr))
WITH CHECK (( SELECT is_hr() AS is_hr));

-- [ 34] chat_messages.chat_messages_production_delete
DROP POLICY IF EXISTS "chat_messages_production_delete" ON public.chat_messages;
CREATE POLICY "chat_messages_production_delete" ON public.chat_messages
AS PERMISSIVE
FOR DELETE
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees current_emp
  WHERE ((current_emp.user_id = ( SELECT auth.uid() AS uid)) AND ((current_emp.id = chat_messages.sender_id) OR (current_emp.role = 'hr'::user_role))))));

-- [ 35] chat_messages.chat_messages_production_insert
DROP POLICY IF EXISTS "chat_messages_production_insert" ON public.chat_messages;
CREATE POLICY "chat_messages_production_insert" ON public.chat_messages
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees current_emp
  WHERE ((current_emp.user_id = ( SELECT auth.uid() AS uid)) AND (current_emp.id = chat_messages.sender_id) AND ((current_emp.role = 'hr'::user_role) OR (EXISTS ( SELECT 1
           FROM chat_channels cc
          WHERE ((cc.id = chat_messages.channel_id) AND (cc.is_announcement = false) AND ((cc.type = 'global'::text) OR ((cc.type = 'department'::text) AND (current_emp.department = ANY (cc.target_departments))) OR ((cc.type = 'custom'::text) AND (EXISTS ( SELECT 1
                   FROM chat_channel_members ccm
                  WHERE ((ccm.channel_id = cc.id) AND (ccm.employee_id = current_emp.id))))))))))))));

-- [ 36] chat_messages.chat_messages_production_update
DROP POLICY IF EXISTS "chat_messages_production_update" ON public.chat_messages;
CREATE POLICY "chat_messages_production_update" ON public.chat_messages
AS PERMISSIVE
FOR UPDATE
TO public
USING ((EXISTS ( SELECT 1
   FROM employees current_emp
  WHERE ((current_emp.user_id = auth.uid()) AND ((current_emp.id = chat_messages.sender_id) OR (current_emp.role = 'hr'::user_role))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees current_emp
  WHERE ((current_emp.user_id = auth.uid()) AND ((current_emp.id = chat_messages.sender_id) OR (current_emp.role = 'hr'::user_role))))));

-- [ 37] chat_messages.chat_messages_select
DROP POLICY IF EXISTS "chat_messages_select" ON public.chat_messages;
CREATE POLICY "chat_messages_select" ON public.chat_messages
AS PERMISSIVE
FOR SELECT
TO public
USING ((((is_deleted = false) OR (EXISTS ( SELECT 1
   FROM auth.users u
  WHERE ((u.id = auth.uid()) AND (COALESCE((u.metadata ->> 'role'::text), ''::text) = 'hr'::text)))) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.user_id = auth.uid()) AND (e.id = chat_messages.sender_id))))) AND ((EXISTS ( SELECT 1
   FROM auth.users u
  WHERE ((u.id = auth.uid()) AND (COALESCE((u.metadata ->> 'role'::text), ''::text) = 'hr'::text)))) OR (EXISTS ( SELECT 1
   FROM chat_channels cc
  WHERE ((cc.name = chat_messages.channel) AND ((cc.type = 'global'::text) OR ((cc.type = 'department'::text) AND (EXISTS ( SELECT 1
           FROM employees e
          WHERE ((e.user_id = auth.uid()) AND (e.department = ANY (cc.target_departments)))))) OR ((cc.type = 'custom'::text) AND (EXISTS ( SELECT 1
           FROM (chat_channel_members ccm
             JOIN employees e ON ((e.id = ccm.employee_id)))
          WHERE ((ccm.channel_id = cc.id) AND (e.user_id = auth.uid()))))))))))));

-- [ 38] chat_messages.chat_messages_self_delete
DROP POLICY IF EXISTS "chat_messages_self_delete" ON public.chat_messages;
CREATE POLICY "chat_messages_self_delete" ON public.chat_messages
AS PERMISSIVE
FOR UPDATE
TO public
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.user_id = auth.uid()) AND (e.id = chat_messages.sender_id)))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.user_id = auth.uid()) AND (e.id = chat_messages.sender_id)))));

-- [ 39] employee_onboarding.HR can manage employee_onboarding in their tenant
DROP POLICY IF EXISTS "HR can manage employee_onboarding in their tenant" ON public.employee_onboarding;
CREATE POLICY "HR can manage employee_onboarding in their tenant" ON public.employee_onboarding
AS PERMISSIVE
FOR ALL
TO authenticated
USING (can_access_tenant(tenant_id))
WITH CHECK (can_access_tenant(tenant_id));

-- [ 40] employee_onboarding_self.onboarding_self_employee
DROP POLICY IF EXISTS "onboarding_self_employee" ON public.employee_onboarding_self;
CREATE POLICY "onboarding_self_employee" ON public.employee_onboarding_self
AS PERMISSIVE
FOR ALL
TO public
USING ((employee_id = ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = auth.uid())
 LIMIT 1)));

-- [ 41] employee_onboarding_self.onboarding_self_hr_view
DROP POLICY IF EXISTS "onboarding_self_hr_view" ON public.employee_onboarding_self;
CREATE POLICY "onboarding_self_hr_view" ON public.employee_onboarding_self
AS PERMISSIVE
FOR SELECT
TO public
USING ((can_access_tenant(tenant_id) AND is_hr()));

-- [ 42] employee_reporting_relationships.tenant_isolation_policy
DROP POLICY IF EXISTS "tenant_isolation_policy" ON public.employee_reporting_relationships;
CREATE POLICY "tenant_isolation_policy" ON public.employee_reporting_relationships
AS PERMISSIVE
FOR ALL
TO public
USING ((tenant_id = ( SELECT employees.tenant_id
   FROM employees
  WHERE (employees.user_id = auth.uid())
 LIMIT 1)))
WITH CHECK ((tenant_id = ( SELECT employees.tenant_id
   FROM employees
  WHERE (employees.user_id = auth.uid())
 LIMIT 1)));

-- [ 43] exit_requests.exit_requests_employee_insert
DROP POLICY IF EXISTS "exit_requests_employee_insert" ON public.exit_requests;
CREATE POLICY "exit_requests_employee_insert" ON public.exit_requests
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK (((employee_id = ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = auth.uid())
 LIMIT 1)) AND (initiated_by_role = 'employee'::text) AND (exit_type = 'resignation'::text)));

-- [ 44] exit_requests.exit_requests_employee_own
DROP POLICY IF EXISTS "exit_requests_employee_own" ON public.exit_requests;
CREATE POLICY "exit_requests_employee_own" ON public.exit_requests
AS PERMISSIVE
FOR SELECT
TO public
USING ((employee_id = ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = auth.uid())
 LIMIT 1)));

-- [ 45] exit_requests.exit_requests_hr_all
DROP POLICY IF EXISTS "exit_requests_hr_all" ON public.exit_requests;
CREATE POLICY "exit_requests_hr_all" ON public.exit_requests
AS PERMISSIVE
FOR ALL
TO public
USING ((can_access_tenant(tenant_id) AND is_hr()));

-- [ 46] expenses.expenses_hr_select
DROP POLICY IF EXISTS "expenses_hr_select" ON public.expenses;
CREATE POLICY "expenses_hr_select" ON public.expenses
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(expenses.tenant_id) AS can_access_tenant)));

-- [ 47] expenses.expenses_hr_update
DROP POLICY IF EXISTS "expenses_hr_update" ON public.expenses;
CREATE POLICY "expenses_hr_update" ON public.expenses
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(expenses.tenant_id) AS can_access_tenant)))
WITH CHECK ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(expenses.tenant_id) AS can_access_tenant)));

-- [ 48] expenses.expenses_restrictive
DROP POLICY IF EXISTS "expenses_restrictive" ON public.expenses;
CREATE POLICY "expenses_restrictive" ON public.expenses
AS RESTRICTIVE
FOR ALL
TO public
USING (( SELECT can_access_tenant(expenses.tenant_id) AS can_access_tenant))
WITH CHECK (( SELECT can_access_tenant(expenses.tenant_id) AS can_access_tenant));

-- [ 49] expenses.expenses_self_delete
DROP POLICY IF EXISTS "expenses_self_delete" ON public.expenses;
CREATE POLICY "expenses_self_delete" ON public.expenses
AS PERMISSIVE
FOR DELETE
TO authenticated
USING (((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = expenses.employee_id) AND (e.user_id = auth.uid())))) AND (status = 'pending'::text)));

-- [ 50] expenses.expenses_self_insert
DROP POLICY IF EXISTS "expenses_self_insert" ON public.expenses;
CREATE POLICY "expenses_self_insert" ON public.expenses
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = expenses.employee_id) AND (e.user_id = auth.uid())))));

-- [ 51] expenses.expenses_self_read
DROP POLICY IF EXISTS "expenses_self_read" ON public.expenses;
CREATE POLICY "expenses_self_read" ON public.expenses
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = expenses.employee_id) AND (e.user_id = auth.uid())))));

-- [ 52] holidays.holidays_all_read
DROP POLICY IF EXISTS "holidays_all_read" ON public.holidays;
CREATE POLICY "holidays_all_read" ON public.holidays
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (true);

-- [ 53] holidays.holidays_hr_write
DROP POLICY IF EXISTS "holidays_hr_write" ON public.holidays;
CREATE POLICY "holidays_hr_write" ON public.holidays
AS PERMISSIVE
FOR ALL
TO authenticated
USING (( SELECT is_hr() AS is_hr))
WITH CHECK (( SELECT is_hr() AS is_hr));

-- [ 54] hr_policies.policies_hr_all
DROP POLICY IF EXISTS "policies_hr_all" ON public.hr_policies;
CREATE POLICY "policies_hr_all" ON public.hr_policies
AS PERMISSIVE
FOR ALL
TO authenticated
USING (( SELECT is_hr() AS is_hr))
WITH CHECK (( SELECT is_hr() AS is_hr));

-- [ 55] hr_policies.policies_visible_to_all
DROP POLICY IF EXISTS "policies_visible_to_all" ON public.hr_policies;
CREATE POLICY "policies_visible_to_all" ON public.hr_policies
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (((visible_to = 'all'::text) OR ((visible_to = 'department-specific'::text) AND (department_filter IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.user_id = ( SELECT auth.uid() AS uid)) AND (e.department = hr_policies.department_filter)))))));

-- [ 56] insurance_policies.insurance_policies_hr_all
DROP POLICY IF EXISTS "insurance_policies_hr_all" ON public.insurance_policies;
CREATE POLICY "insurance_policies_hr_all" ON public.insurance_policies
AS PERMISSIVE
FOR ALL
TO authenticated
USING ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(insurance_policies.tenant_id) AS can_access_tenant)))
WITH CHECK ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(insurance_policies.tenant_id) AS can_access_tenant)));

-- [ 57] insurance_policies.insurance_policies_restrictive
DROP POLICY IF EXISTS "insurance_policies_restrictive" ON public.insurance_policies;
CREATE POLICY "insurance_policies_restrictive" ON public.insurance_policies
AS RESTRICTIVE
FOR ALL
TO public
USING (( SELECT can_access_tenant(insurance_policies.tenant_id) AS can_access_tenant))
WITH CHECK (( SELECT can_access_tenant(insurance_policies.tenant_id) AS can_access_tenant));

-- [ 58] insurance_policies.insurance_policies_self_read
DROP POLICY IF EXISTS "insurance_policies_self_read" ON public.insurance_policies;
CREATE POLICY "insurance_policies_self_read" ON public.insurance_policies
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((employee_id = ( SELECT employees.id
   FROM employees
  WHERE (employees.user_id = auth.uid()))));

-- [ 59] it_declaration_windows.windows_hr_manage
DROP POLICY IF EXISTS "windows_hr_manage" ON public.it_declaration_windows;
CREATE POLICY "windows_hr_manage" ON public.it_declaration_windows
AS PERMISSIVE
FOR ALL
TO authenticated
USING (is_hr())
WITH CHECK (is_hr());

-- [ 60] it_declaration_windows.windows_tenant_isolation
DROP POLICY IF EXISTS "windows_tenant_isolation" ON public.it_declaration_windows;
CREATE POLICY "windows_tenant_isolation" ON public.it_declaration_windows
AS PERMISSIVE
FOR ALL
TO authenticated
USING ((tenant_id = get_auth_tenant_id()))
WITH CHECK ((tenant_id = get_auth_tenant_id()));

-- [ 61] it_declarations.declarations_hr_all
DROP POLICY IF EXISTS "declarations_hr_all" ON public.it_declarations;
CREATE POLICY "declarations_hr_all" ON public.it_declarations
AS PERMISSIVE
FOR ALL
TO authenticated
USING (is_hr())
WITH CHECK (is_hr());

-- [ 62] it_declarations.declarations_self_all
DROP POLICY IF EXISTS "declarations_self_all" ON public.it_declarations;
CREATE POLICY "declarations_self_all" ON public.it_declarations
AS PERMISSIVE
FOR ALL
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = it_declarations.employee_id) AND (e.user_id = auth.uid())))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = it_declarations.employee_id) AND (e.user_id = auth.uid())))));

-- [ 63] it_declarations.declarations_tenant_isolation
DROP POLICY IF EXISTS "declarations_tenant_isolation" ON public.it_declarations;
CREATE POLICY "declarations_tenant_isolation" ON public.it_declarations
AS PERMISSIVE
FOR ALL
TO authenticated
USING ((tenant_id = get_auth_tenant_id()))
WITH CHECK ((tenant_id = get_auth_tenant_id()));

-- [ 64] leave_balances.leave_balances_hr_all
DROP POLICY IF EXISTS "leave_balances_hr_all" ON public.leave_balances;
CREATE POLICY "leave_balances_hr_all" ON public.leave_balances
AS PERMISSIVE
FOR ALL
TO authenticated
USING (is_hr())
WITH CHECK (is_hr());

-- [ 65] leave_balances.leave_balances_self
DROP POLICY IF EXISTS "leave_balances_self" ON public.leave_balances;
CREATE POLICY "leave_balances_self" ON public.leave_balances
AS PERMISSIVE
FOR ALL
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = leave_balances.employee_id) AND (e.user_id = auth.uid())))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = leave_balances.employee_id) AND (e.user_id = auth.uid())))));

-- [ 66] leaves.leaves_hr_all
DROP POLICY IF EXISTS "leaves_hr_all" ON public.leaves;
CREATE POLICY "leaves_hr_all" ON public.leaves
AS PERMISSIVE
FOR ALL
TO authenticated
USING (( SELECT is_hr() AS is_hr))
WITH CHECK (( SELECT is_hr() AS is_hr));

-- [ 67] leaves.leaves_self_insert
DROP POLICY IF EXISTS "leaves_self_insert" ON public.leaves;
CREATE POLICY "leaves_self_insert" ON public.leaves
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = leaves.employee_id) AND (e.user_id = ( SELECT auth.uid() AS uid))))));

-- [ 68] leaves.leaves_self_read
DROP POLICY IF EXISTS "leaves_self_read" ON public.leaves;
CREATE POLICY "leaves_self_read" ON public.leaves
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = leaves.employee_id) AND (e.user_id = ( SELECT auth.uid() AS uid))))));

-- [ 69] notifications.admin_bypass
DROP POLICY IF EXISTS "admin_bypass" ON public.notifications;
CREATE POLICY "admin_bypass" ON public.notifications
AS PERMISSIVE
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

-- [ 70] notifications.notifications_hr_all
DROP POLICY IF EXISTS "notifications_hr_all" ON public.notifications;
CREATE POLICY "notifications_hr_all" ON public.notifications
AS PERMISSIVE
FOR ALL
TO authenticated
USING (( SELECT is_hr() AS is_hr))
WITH CHECK (( SELECT is_hr() AS is_hr));

-- [ 71] notifications.notifications_self_read
DROP POLICY IF EXISTS "notifications_self_read" ON public.notifications;
CREATE POLICY "notifications_self_read" ON public.notifications
AS PERMISSIVE
FOR SELECT
TO public
USING ((user_id = auth.uid()));

-- [ 72] notifications.notifications_self_rw
DROP POLICY IF EXISTS "notifications_self_rw" ON public.notifications;
CREATE POLICY "notifications_self_rw" ON public.notifications
AS PERMISSIVE
FOR ALL
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = notifications.employee_id) AND (e.user_id = ( SELECT auth.uid() AS uid))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = notifications.employee_id) AND (e.user_id = ( SELECT auth.uid() AS uid))))));

-- [ 73] notifications.notifications_self_update
DROP POLICY IF EXISTS "notifications_self_update" ON public.notifications;
CREATE POLICY "notifications_self_update" ON public.notifications
AS PERMISSIVE
FOR UPDATE
TO public
USING ((user_id = auth.uid()))
WITH CHECK ((user_id = auth.uid()));

-- [ 74] office_locations.office_locations_tenant_isolation
DROP POLICY IF EXISTS "office_locations_tenant_isolation" ON public.office_locations;
CREATE POLICY "office_locations_tenant_isolation" ON public.office_locations
AS PERMISSIVE
FOR ALL
TO public
USING ((tenant_id = get_auth_tenant_id()))
WITH CHECK ((tenant_id = get_auth_tenant_id()));

-- [ 75] overtime_records.overtime_hr_delete
DROP POLICY IF EXISTS "overtime_hr_delete" ON public.overtime_records;
CREATE POLICY "overtime_hr_delete" ON public.overtime_records
AS PERMISSIVE
FOR DELETE
TO authenticated
USING ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(overtime_records.tenant_id) AS can_access_tenant)));

-- [ 76] overtime_records.overtime_hr_insert
DROP POLICY IF EXISTS "overtime_hr_insert" ON public.overtime_records;
CREATE POLICY "overtime_hr_insert" ON public.overtime_records
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(overtime_records.tenant_id) AS can_access_tenant)));

-- [ 77] overtime_records.overtime_hr_select
DROP POLICY IF EXISTS "overtime_hr_select" ON public.overtime_records;
CREATE POLICY "overtime_hr_select" ON public.overtime_records
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(overtime_records.tenant_id) AS can_access_tenant)));

-- [ 78] overtime_records.overtime_hr_update
DROP POLICY IF EXISTS "overtime_hr_update" ON public.overtime_records;
CREATE POLICY "overtime_hr_update" ON public.overtime_records
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(overtime_records.tenant_id) AS can_access_tenant)))
WITH CHECK ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(overtime_records.tenant_id) AS can_access_tenant)));

-- [ 79] overtime_records.overtime_restrictive
DROP POLICY IF EXISTS "overtime_restrictive" ON public.overtime_records;
CREATE POLICY "overtime_restrictive" ON public.overtime_records
AS RESTRICTIVE
FOR ALL
TO public
USING (( SELECT can_access_tenant(overtime_records.tenant_id) AS can_access_tenant))
WITH CHECK (( SELECT can_access_tenant(overtime_records.tenant_id) AS can_access_tenant));

-- [ 80] overtime_records.overtime_self_read
DROP POLICY IF EXISTS "overtime_self_read" ON public.overtime_records;
CREATE POLICY "overtime_self_read" ON public.overtime_records
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = overtime_records.employee_id) AND (e.user_id = auth.uid())))));

-- [ 81] payslips.employee_own_payslips
DROP POLICY IF EXISTS "employee_own_payslips" ON public.payslips;
CREATE POLICY "employee_own_payslips" ON public.payslips
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (((( SELECT ((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text)) = 'hr'::text) OR ((( SELECT ((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text)) = 'employee'::text) AND (employee_id = ( SELECT employees.id
   FROM employees
  WHERE ((employees.user_id = ( SELECT auth.uid() AS uid)) AND (employees.tenant_id = payslips.tenant_id))
 LIMIT 1)))));

-- [ 82] payslips.payslips_hr_delete
DROP POLICY IF EXISTS "payslips_hr_delete" ON public.payslips;
CREATE POLICY "payslips_hr_delete" ON public.payslips
AS PERMISSIVE
FOR DELETE
TO authenticated
USING ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(payslips.tenant_id) AS can_access_tenant)));

-- [ 83] payslips.payslips_hr_insert
DROP POLICY IF EXISTS "payslips_hr_insert" ON public.payslips;
CREATE POLICY "payslips_hr_insert" ON public.payslips
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(payslips.tenant_id) AS can_access_tenant)));

-- [ 84] payslips.payslips_hr_select
DROP POLICY IF EXISTS "payslips_hr_select" ON public.payslips;
CREATE POLICY "payslips_hr_select" ON public.payslips
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(payslips.tenant_id) AS can_access_tenant)));

-- [ 85] payslips.payslips_hr_update
DROP POLICY IF EXISTS "payslips_hr_update" ON public.payslips;
CREATE POLICY "payslips_hr_update" ON public.payslips
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(payslips.tenant_id) AS can_access_tenant)))
WITH CHECK ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(payslips.tenant_id) AS can_access_tenant)));

-- [ 86] platform_admins.platform_admins_owner_all
DROP POLICY IF EXISTS "platform_admins_owner_all" ON public.platform_admins;
CREATE POLICY "platform_admins_owner_all" ON public.platform_admins
AS PERMISSIVE
FOR ALL
TO authenticated
USING (( SELECT is_superadmin() AS is_superadmin))
WITH CHECK (( SELECT is_superadmin() AS is_superadmin));

-- [ 87] platform_admins.platform_admins_select_self
DROP POLICY IF EXISTS "platform_admins_select_self" ON public.platform_admins;
CREATE POLICY "platform_admins_select_self" ON public.platform_admins
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((user_id = ( SELECT auth.uid() AS uid)));

-- [ 88] platform_audit_logs.platform_audit_logs_admin_read
DROP POLICY IF EXISTS "platform_audit_logs_admin_read" ON public.platform_audit_logs;
CREATE POLICY "platform_audit_logs_admin_read" ON public.platform_audit_logs
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (( SELECT is_superadmin() AS is_superadmin));

-- [ 89] platform_settings.Admins can manage platform_settings
DROP POLICY IF EXISTS "Admins can manage platform_settings" ON public.platform_settings;
CREATE POLICY "Admins can manage platform_settings" ON public.platform_settings
AS PERMISSIVE
FOR ALL
TO public
USING (is_admin())
WITH CHECK (is_admin());

-- [ 90] platform_settings.Anyone can read platform_settings
DROP POLICY IF EXISTS "Anyone can read platform_settings" ON public.platform_settings;
CREATE POLICY "Anyone can read platform_settings" ON public.platform_settings
AS PERMISSIVE
FOR SELECT
TO public
USING (true);

-- [ 91] platform_settings.admin_bypass_platform_settings
DROP POLICY IF EXISTS "admin_bypass_platform_settings" ON public.platform_settings;
CREATE POLICY "admin_bypass_platform_settings" ON public.platform_settings
AS PERMISSIVE
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

-- [ 92] profiles.admin_bypass
DROP POLICY IF EXISTS "admin_bypass" ON public.profiles;
CREATE POLICY "admin_bypass" ON public.profiles
AS PERMISSIVE
FOR ALL
TO project_admin
USING (true)
WITH CHECK (true);

-- [ 93] profiles.profiles_admin_select
DROP POLICY IF EXISTS "profiles_admin_select" ON public.profiles;
CREATE POLICY "profiles_admin_select" ON public.profiles
AS PERMISSIVE
FOR SELECT
TO public
USING ((EXISTS ( SELECT 1
   FROM admin_users
  WHERE (admin_users.user_id = auth.uid()))));

-- [ 94] profiles.profiles_select_self
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
CREATE POLICY "profiles_select_self" ON public.profiles
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((id = auth.uid()));

-- [ 95] profiles.profiles_self
DROP POLICY IF EXISTS "profiles_self" ON public.profiles;
CREATE POLICY "profiles_self" ON public.profiles
AS PERMISSIVE
FOR ALL
TO public
USING ((id = auth.uid()))
WITH CHECK ((id = auth.uid()));

-- [ 96] projects.projects_employee_read
DROP POLICY IF EXISTS "projects_employee_read" ON public.projects;
CREATE POLICY "projects_employee_read" ON public.projects
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((is_hr() OR ((tenant_id = get_auth_tenant_id()) AND (((visibility_config ->> 'type'::text) = 'all'::text) OR (((visibility_config ->> 'type'::text) = 'departments'::text) AND ((visibility_config -> 'departments'::text) ? ( SELECT employees.department
   FROM employees
  WHERE ((employees.user_id = auth.uid()) AND (employees.status = 'active'::text))
 LIMIT 1))) OR (((visibility_config ->> 'type'::text) = 'people'::text) AND ((visibility_config -> 'employee_ids'::text) ? ( SELECT (employees.id)::text AS id
   FROM employees
  WHERE ((employees.user_id = auth.uid()) AND (employees.status = 'active'::text))
 LIMIT 1))) OR (manager_id = ( SELECT employees.id
   FROM employees
  WHERE ((employees.user_id = auth.uid()) AND (employees.status = 'active'::text))
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.project_id = projects.id) AND (t.assigned_to = ( SELECT employees.id
           FROM employees
          WHERE ((employees.user_id = auth.uid()) AND (employees.status = 'active'::text))
         LIMIT 1)))))))));

-- [ 97] projects.projects_hr_all
DROP POLICY IF EXISTS "projects_hr_all" ON public.projects;
CREATE POLICY "projects_hr_all" ON public.projects
AS PERMISSIVE
FOR ALL
TO authenticated
USING (is_hr())
WITH CHECK (is_hr());

-- [ 98] salary_structures.salary_hr_delete
DROP POLICY IF EXISTS "salary_hr_delete" ON public.salary_structures;
CREATE POLICY "salary_hr_delete" ON public.salary_structures
AS PERMISSIVE
FOR DELETE
TO authenticated
USING ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(salary_structures.tenant_id) AS can_access_tenant)));

-- [ 99] salary_structures.salary_hr_insert
DROP POLICY IF EXISTS "salary_hr_insert" ON public.salary_structures;
CREATE POLICY "salary_hr_insert" ON public.salary_structures
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(salary_structures.tenant_id) AS can_access_tenant)));

-- [100] salary_structures.salary_hr_select
DROP POLICY IF EXISTS "salary_hr_select" ON public.salary_structures;
CREATE POLICY "salary_hr_select" ON public.salary_structures
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(salary_structures.tenant_id) AS can_access_tenant)));

-- [101] salary_structures.salary_hr_update
DROP POLICY IF EXISTS "salary_hr_update" ON public.salary_structures;
CREATE POLICY "salary_hr_update" ON public.salary_structures
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(salary_structures.tenant_id) AS can_access_tenant)))
WITH CHECK ((( SELECT is_hr() AS is_hr) AND ( SELECT can_access_tenant(salary_structures.tenant_id) AS can_access_tenant)));

-- [102] salary_structures.salary_self_read
DROP POLICY IF EXISTS "salary_self_read" ON public.salary_structures;
CREATE POLICY "salary_self_read" ON public.salary_structures
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = salary_structures.employee_id) AND (e.user_id = auth.uid())))));

-- [103] task_submissions.task_submissions_hr_all
DROP POLICY IF EXISTS "task_submissions_hr_all" ON public.task_submissions;
CREATE POLICY "task_submissions_hr_all" ON public.task_submissions
AS PERMISSIVE
FOR ALL
TO authenticated
USING (( SELECT is_hr() AS is_hr))
WITH CHECK (( SELECT is_hr() AS is_hr));

-- [104] task_submissions.task_submissions_self_rw
DROP POLICY IF EXISTS "task_submissions_self_rw" ON public.task_submissions;
CREATE POLICY "task_submissions_self_rw" ON public.task_submissions
AS PERMISSIVE
FOR ALL
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = task_submissions.employee_id) AND (e.user_id = ( SELECT auth.uid() AS uid))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = task_submissions.employee_id) AND (e.user_id = ( SELECT auth.uid() AS uid))))));

-- [105] tasks.tasks_hr_all
DROP POLICY IF EXISTS "tasks_hr_all" ON public.tasks;
CREATE POLICY "tasks_hr_all" ON public.tasks
AS PERMISSIVE
FOR ALL
TO authenticated
USING (( SELECT is_hr() AS is_hr))
WITH CHECK (( SELECT is_hr() AS is_hr));

-- [106] tasks.tasks_self_read
DROP POLICY IF EXISTS "tasks_self_read" ON public.tasks;
CREATE POLICY "tasks_self_read" ON public.tasks
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = tasks.assigned_to) AND (e.user_id = ( SELECT auth.uid() AS uid))))));

-- [107] tasks.tasks_self_update
DROP POLICY IF EXISTS "tasks_self_update" ON public.tasks;
CREATE POLICY "tasks_self_update" ON public.tasks
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = tasks.assigned_to) AND (e.user_id = ( SELECT auth.uid() AS uid))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = tasks.assigned_to) AND (e.user_id = ( SELECT auth.uid() AS uid))))));

-- [108] tenants.tenants_superadmin_insert
DROP POLICY IF EXISTS "tenants_superadmin_insert" ON public.tenants;
CREATE POLICY "tenants_superadmin_insert" ON public.tenants
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (( SELECT is_superadmin() AS is_superadmin));

-- [109] tenants.tenants_superadmin_select_all
DROP POLICY IF EXISTS "tenants_superadmin_select_all" ON public.tenants;
CREATE POLICY "tenants_superadmin_select_all" ON public.tenants
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (( SELECT is_superadmin() AS is_superadmin));

-- [110] tenants.tenants_superadmin_update_all
DROP POLICY IF EXISTS "tenants_superadmin_update_all" ON public.tenants;
CREATE POLICY "tenants_superadmin_update_all" ON public.tenants
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING (( SELECT is_superadmin() AS is_superadmin))
WITH CHECK (( SELECT is_superadmin() AS is_superadmin));

-- [111] tenants.tenants_update_own_hr
DROP POLICY IF EXISTS "tenants_update_own_hr" ON public.tenants;
CREATE POLICY "tenants_update_own_hr" ON public.tenants
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING (((id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id)) AND ( SELECT is_hr() AS is_hr)))
WITH CHECK (((id = ( SELECT get_auth_tenant_id() AS get_auth_tenant_id)) AND ( SELECT is_hr() AS is_hr)));
