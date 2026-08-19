-- Drop the superseded function overloads that take caller identity as a PARAMETER.
--
-- Each of these has a newer sibling that derives the caller from auth.uid(). Someone fixed the
-- vulnerability by adding a new signature and never dropped the old one, so the version that trusts
-- a client-supplied identity stayed callable. Verified: none of the four below reference auth.uid();
-- every surviving sibling does (except punch_out_attendance — see the note at the bottom).
--
-- Impact if left in place: a caller could act as any employee by passing their id —
-- submit another employee's task, or approve one as an arbitrary HR employee.
--
-- CALLER VERIFICATION (every call site in src/ and functions/ was checked before dropping):
--   approve_task_request  — SPA calls the 1-arg form (ProjectDetail.tsx:362)          -> safe to drop 2-arg
--   reject_task_request   — SPA calls (p_task_id, p_notes) (ProjectDetail.tsx:411)    -> safe to drop 3-arg
--   punch_out_attendance  — SPA calls the 10-arg form (PunchInOut.tsx:809)            -> safe to drop 7-arg
--
-- submit_task_request is NOT dropped here. The deployed production SPA
-- (https://rq3qmu8y.insforge.site) still calls the 5-arg form; dropping it now would break task
-- submission for every employee until a redeploy. The fix to EmployeeProjectView.tsx is in the
-- working tree, so the drop is staged separately in
-- 20260817190000_drop-submit-task-request-identity-overload.sql — apply that ONLY after the
-- frontend change is deployed. It is numbered last so it stays pending without blocking other
-- migrations (the CLI applies strictly in order).
--
-- The overloads also broke PostgREST resolution: ambiguous signatures return
-- 300 PGRST203 "Could not choose the best candidate function", which is why
-- check_employee_exists_by_email is currently unusable through the API.

DROP FUNCTION IF EXISTS public.approve_task_request(p_task_id uuid, p_hr_employee_id uuid);

DROP FUNCTION IF EXISTS public.reject_task_request(p_task_id uuid, p_hr_employee_id uuid, p_notes text);

-- The 7-arg form accepted p_work_hours from the client and wrote it straight to the attendance row
-- (finding S5). The surviving 10-arg form computes hours server-side from the punch timestamps.
DROP FUNCTION IF EXISTS public.punch_out_attendance(p_attendance_id uuid, p_tenant_id uuid, p_work_hours numeric, p_lat numeric, p_lng numeric, p_acc numeric, p_loc_status text);

-- NOT dropped here, deliberately:
--
--   hr_activate_draft_employee — two overloads, but BOTH derive identity from auth.uid() and neither
--       is called from src/ or functions/. Not an identity-parameter vulnerability; removing dead
--       code is a separate cleanup.
--
--   check_employee_exists_by_email — the second parameter is `exclude_employee_id`, a legitimate
--       filter, not an identity claim. The pair still breaks PostgREST resolution (300 PGRST203) and
--       should be collapsed, but choosing which signature survives is an API change, not a security fix.
--
-- STILL OPEN after this migration: the surviving punch_out_attendance derives work hours server-side
-- but does NOT verify that the caller owns the attendance row (the rest of finding S5). Tracked
-- separately — this migration removes the client-supplied-hours vector, not the ownership gap.
