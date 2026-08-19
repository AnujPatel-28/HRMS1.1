-- ⚠️ DEPLOY-GATED. Do not apply until the frontend change is live.
--
-- Drops the last identity-parameter overload: submit_task_request(…, p_employee_id, …). It trusts a
-- client-supplied employee id and does not reference auth.uid(), so any caller can submit a task as
-- any employee. The surviving 4-arg form derives the submitter from auth.uid(), resolves their
-- employee row within the task's tenant, and verifies the task is actually assigned to them.
--
-- Why this is separate from 20260817110000: the deployed SPA at https://rq3qmu8y.insforge.site still
-- called the 5-arg form when that migration was written. The fix
-- (src/employee/pms/EmployeeProjectView.tsx — stop passing p_employee_id) must ship FIRST, or task
-- submission breaks for every employee.
--
-- PRECONDITION — verify before applying:
--   1. The EmployeeProjectView.tsx change is committed and deployed to production.
--   2. `grep -rn "p_employee_id" src/employee/pms/EmployeeProjectView.tsx` returns nothing.
--
-- Rollback: re-create from 20260814160000_baseline-untracked-functions.sql, which holds the exact
-- definition captured from the live database.

DROP FUNCTION IF EXISTS public.submit_task_request(p_task_id uuid, p_employee_id uuid, p_notes text, p_attachment_url text, p_attachment_name text);
