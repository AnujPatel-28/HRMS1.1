-- Release 6B: Revoke Broad employees SELECT for Standard Employees
--
-- Live RLS audit (2026-07-06) found these policies on public.employees:
--   1. employees_hr_all       - PERMISSIVE ALL for authenticated - is_hr() → KEEP (HR access)
--   2. employees_self_read    - PERMISSIVE SELECT for public     - user_id = auth.uid() + tenant → KEEP
--   3. employees_self_select  - PERMISSIVE SELECT for authenticated - user_id = auth.uid() → KEEP (duplicate self-read, harmless)
--   4. employees_self_update  - PERMISSIVE UPDATE for authenticated - user_id = auth.uid() → KEEP
--   5. tenant_active_restrictive - RESTRICTIVE ALL for public - can_access_tenant() → KEEP (tenant fence)
--   6. tenant_isolation       - PERMISSIVE ALL for authenticated - can_access_tenant() → DROP (this is the broad policy)
--
-- After this migration:
--   Standard employee → can only read their own row (employees_self_read / employees_self_select)
--   HR user           → can read all tenant employees (employees_hr_all)
--   External / wrong tenant → blocked by tenant_active_restrictive
--
-- Employee portal screens were audited and use employee_directory_public for colleague data.
-- This migration is safe to apply after Release 6A completes and employee portal QA passes.

DROP POLICY IF EXISTS tenant_isolation ON public.employees;
