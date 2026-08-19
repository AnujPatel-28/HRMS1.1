-- ✅ ADDITIVE. Applicable on its own, immediately. NOT deploy-gated.
--    Signature, return type, volatility, security and ACL are all unchanged, so the currently
--    deployed SPA keeps working byte-for-byte. See "Additive, and why" below for the one window
--    a reviewer should still know about.
--
-- Closes doc/org-module-status-2026-08-19.md §3c(d) — "`notifications` INSERT is refused for
-- employee-role submitters".
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- ── What is actually wrong (the §3c(d) inventory is half right) ──────────────
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- §3c(d) lists six employee-role notification inserts as "refused today". Verified against the
-- live database on 2026-08-20, only TWO of the six are refused. The other four fail earlier, for
-- reasons no notification mechanism can fix:
--
--   src/employee/MyTasks.tsx:188                REFUSED.  employee → manager / unit-head chain / HR.
--   src/employee/pms/EmployeeProjectView.tsx:169 REFUSED.  same event, same flow, same reason.
--       Both are the `notifications_self_rw` WITH CHECK failing: the row's employee_id is not the
--       caller's own employee row.
--
--   src/employee/Expenses.tsx:188               UNREACHABLE, not refused. The block is guarded by
--       `if (hrEmployees && hrEmployees.length > 0)`, and `hrEmployees` comes from
--       `db.from("employees").select("id").eq("role","hr")`. Live `employees` policies are
--       employees_hr_all (is_hr), employees_self_select (user_id = auth.uid()) and
--       managers_can_view_own_draft_reports (manager_id = get_my_employee_id()). An employee-role
--       caller therefore reads back `[]` and the insert is never attempted.
--
--   src/employee/MyTasks.tsx:238                UNREACHABLE, not refused. `tasks` carries no
--       permissive INSERT policy other than tasks_hr_all (is_hr). The preceding
--       `db.from("tasks").insert(...)` is what fails; the notification is downstream of a task row
--       that was never created.
--
--   src/employee/MyTasks.tsx:274                UNREACHABLE or PERMITTED — never refused.
--   src/employee/MyTasks.tsx:303                approve_task_request / reject_task_request both
--       `RAISE EXCEPTION 'Insufficient role: HR privileges required'` unless
--       auth.users.metadata->>'role' = 'hr'. For a non-HR caller the RPC throws before the insert
--       runs. For an HR caller `is_hr()` is true, so notifications_hr_all permits the insert.
--
-- So the whole of the genuinely-refused surface is ONE event — task submission — reached through
-- ONE function, `submit_task_request`, from two screens.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- ── Why the fix goes inside submit_task_request ──────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Three mechanisms were considered.
--
--  (a) Widen the notifications INSERT policy to "any employee in my tenant".
--      Rejected. Tenant scope is already enforced — `tenant_active_restrictive` (RESTRICTIVE / ALL /
--      TO public / can_access_tenant(tenant_id)) and `tenant_isolation` (RESTRICTIVE / ALL /
--      TO authenticated / tenant_id = get_auth_tenant_id()) are ANDed onto every command on this
--      table including INSERT. So (a) is not "add a tenant fence", it is purely "let any employee
--      write an arbitrary title/body to any colleague". `notifications` has no sender column, so
--      such a row is UNATTRIBUTABLE and renders in the bell as if the system sent it. That is a
--      strictly worse primitive than chat, where `chat_messages_employee_insert` forces
--      `sender_id = get_my_employee_id()`. It would also need a new helper reachable from a policy
--      on a table that carries four `TO public`/`TO authenticated` RESTRICTIVE+PERMISSIVE policies —
--      exactly the PUBLIC-grant trap in doc/session_context_2026-08-18.md §3.
--
--  (b) A SECURITY DEFINER fan-out RPC taking a recipient list plus title/body.
--      Rejected as ceremony, which is the honest answer to "does (b) actually reduce the attack
--      surface versus (a)". It does not. If the RPC accepts a recipient array and free text, the
--      caller retains precisely the capability (a) grants — arbitrary text to any same-tenant
--      colleague — and pays a frontend migration for it. The only thing (b) adds over (a) is a
--      choke point to tighten later, and a trigger or a helper could give (a) the same thing.
--      The discriminator is that every one of the six recipients is SERVER-DERIVABLE. Once that is
--      true, passing a recipient list at all is the defect, not the interface.
--
--  (c) Fold the insert into the SECURITY DEFINER RPC that already performs the state change.  ← CHOSEN
--      The prompt's objection to (c) was "touches many RPCs and does not cover non-RPC flows like
--      expenses". Both halves dissolve against the evidence above: it touches ONE RPC, and expenses
--      is broken for an unrelated reason (see the four defects listed below) that no notification
--      mechanism addresses.
--      Concretely (c) wins on:
--        * Attack surface — it does not widen anything. The caller cannot fabricate a notification
--          at all; they can only cause the one notification that a real, authorised state change
--          warrants. submit_task_request already proves `auth.uid()` resolves to an employee of the
--          task's tenant AND that the task is assigned to them (steps 0/2/3, unchanged below).
--        * Grants — NO new grants, at all. CREATE OR REPLACE preserves the existing ACL when the
--          signature is unchanged, and this function's ACL is already
--          `{project_admin=X/project_admin,authenticated=X/project_admin}` — PUBLIC and anon
--          revoked by 20260817100000 / 20260817130000. Nothing new becomes reachable.
--        * Atomicity — submission and notification are one transaction. A client that dies between
--          two round trips can no longer produce a submitted task nobody was told about.
--        * House pattern — this IS the established shape here. employee_apply_leave_request inserts
--          the HR notification server-side; approve_leave_request / cancel_leave_request notify the
--          employee; fn_check_insurance_expiries fans out to the tenant's active HR. The task module
--          is the outlier, not the precedent.
--
--  A HYBRID (c + a widened INSERT policy) is rejected explicitly: it would create write surface no
--  working flow needs. The four unreachable sites stay broken with or without it.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- ── P2: RLS, helpers and inline subqueries ───────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- P2 forbids an inline subquery on `employees` inside an RLS POLICY, because a policy expression
-- runs as the invoking role and re-enters RLS (the 2026-08-14 42P17 outage). It does not apply here:
-- this migration creates no policy and changes none. The queries below live in a SECURITY DEFINER
-- FUNCTION body, which runs as its owner.
--
-- Owner check, verified live rather than assumed:
--     notifications.relowner = project_admin, relforcerowsecurity = false
--     submit_task_request.proowner = project_admin
-- A table's owner is exempt from its own RLS unless FORCE ROW LEVEL SECURITY is set, and it is not.
-- So the INSERT below writes as project_admin and bypasses the notifications policies entirely —
-- the same mechanism that already makes employee_apply_leave_request's HR notification work.
--
-- No helper is introduced. get_my_employee_id() is deliberately NOT called: the function has already
-- resolved the caller to `v_employee_id` scoped to the TASK's tenant (step 2), which is strictly
-- stronger than the helper's unscoped `user_id = auth.uid() LIMIT 1`. get_my_active_employee_id()
-- is NOT called either — it exists only in migrations-pending-deploy/20260819120000 and is NOT
-- APPLIED. Nothing here depends on it.
--
-- ── Grant matrix ─────────────────────────────────────────────────────────────
--   object                                  new? grant                          reached from
--   public.submit_task_request(uuid,text,    no   authenticated  (ACL preserved   PostgREST RPC,
--     text,text)                                   by CREATE OR REPLACE)          not from any policy
--   -- no other function is created, called, or re-granted by this file.
-- The REVOKE/GRANT pair is re-asserted below anyway. It is idempotent and free, and
-- "revoking anon does nothing on its own" is a documented trap in this project
-- (doc/session_context_2026-08-18.md §3) — restating the PUBLIC revoke costs one line.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- ── The employee_id / user_id duplication ────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Asked, and answered from live data on 2026-08-20:
--
--     SELECT count(*), count(user_id), count(*) FILTER (WHERE employee_id IS NULL)
--       FROM public.notifications;
--     -->  17          0                0
--
-- `employee_id` is authoritative, and it is not close:
--   * employee_id is NOT NULL; user_id is nullable and is NULL on 17 of 17 rows.
--   * Every writer sets employee_id only — all six SECURITY DEFINER functions that insert
--     notifications, and every one of the 18 client call sites.
--   * The read path keys on it: NotificationBell.tsx:78 `.eq("employee_id", employee.id)`.
--   * The realtime trigger keys on it: notify_employee_notification() publishes to
--     `'notifications:' || NEW.employee_id`, which is the channel the bell subscribes to.
--
-- Consequence for the policies, which is worth stating plainly: [71] notifications_self_read and
-- [73] notifications_self_update are keyed on user_id and therefore match ZERO rows today. They are
-- dead. Every self-read and every mark-as-read in production is carried by [72]
-- notifications_self_rw, which is FOR ALL and keyed on employee_id.
--
-- This migration sets BOTH columns on the rows it writes, deriving user_id server-side from
-- employees.user_id for the recipient. That is visibility-neutral: [71]'s predicate
-- (`user_id = auth.uid()`) resolves the same human as [72]'s (`employees.id = employee_id AND
-- employees.user_id = auth.uid()`), so no row becomes visible to anyone new.
--   One asymmetry a reviewer should accept: if the recipient's `employees` row is later DELETED,
--   [72] stops matching but [71] would still match on the surviving auth user id. A notification
--   that used to become invisible now stays visible — to the same person, and only to them.
--
-- NOT DONE, deliberately: the 17 existing rows are not backfilled, and [71]/[73] are not repaired,
-- dropped, or repointed. The backfill has no observable effect (see above), and rewriting policies
-- this migration does not need is exactly the unrequested widening this project keeps getting hurt
-- by. Flagged for a follow-up, not smuggled in here.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- ── Deliberate deltas (authorisation- or behaviour-visible; not refactors) ───
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  D1. Recipient resolution moves from the browser to the server, and is reproduced EXACTLY as
--      shipped — including its own inconsistencies. The shipped order is
--      `employee.manager_id ? [manager_id] : resolveTaskNotificationTargets(...)`
--      (MyTasks.tsx:181-183, EmployeeProjectView.tsx:162-164), i.e.
--        1. manager_id, raw and unvalidated
--        2. else own org unit head, if active, in-tenant, and not the submitter
--        3. else parent unit head, same filters
--        4. else every active `role = 'hr'` employee in the tenant
--      NOTE A SPEC DISCREPANCY, not resolved here: src/utils/notificationTargets.ts's docstring
--      cites 06 §9.1 as "own unit head → parent unit head → HR" with no manager step at all, while
--      the code it documents puts manager_id first. Preserved as coded, because behaviour-preserving
--      is the reviewable choice; §9.1 and the code should be reconciled separately.
--
--  D2. `notified` is added to the returned jsonb. Existing callers read nothing from the return
--      (both check only `rpcErr`), so this breaks nobody, and it gives the migrated frontend a real
--      failure signal instead of an assumption. See the .FRONTEND-SPEC.md next to this file.
--
--  D3. The INSERT adds `AND r.tenant_id = v_tenant_id` to the recipient lookup. The browser could
--      not enforce this (it supplied the ids). `employees.manager_id` has no same-tenant constraint,
--      so a mis-parented manager row would otherwise produce a notification carrying the task's
--      tenant_id and a foreign employee_id. Can only ever narrow; on correct data it is a no-op.
--
--  D4. Title/body are composed server-side and now branch on `tasks.project_id` to reproduce BOTH
--      shipped strings — 'Task Submitted' vs 'Project Task Submitted' — from the row rather than
--      from which screen called. This is why the two screens can share one code path.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- ── Additive, and why — plus the one window ──────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- ADDITIVE. Nothing is dropped, no policy changes, no column changes, the signature is unchanged.
-- The deployed SPA still calls the 4-arg form with the same arguments and still ignores the return.
-- Its client-side notification insert keeps failing exactly as it does today (see below) — a
-- duplicate console.error, not a duplicate notification.
--
-- The theoretical double-notify window: any caller whose client-side insert SUCCEEDS today (i.e.
-- `is_hr()`) would get two notifications until the frontend deletion ships. Sized against the app:
-- both call sites live under `/employee/*`, which App.tsx:67-77 gates on `currentRole === 'employee'`,
-- so an HR-role user cannot reach either screen in the SPA. The window is therefore empty in
-- practice and reachable only by a hand-built request with an HR token. It is cosmetic and
-- self-limiting; no dedupe logic is added for it.
--
-- ── A premise correction that changes the frontend guidance ──────────────────
-- §3c(d) says the refused insert "returns 200 + []". That is true of UPDATE and DELETE, which RLS
-- refuses by matching zero rows. It is NOT true of INSERT: a WITH CHECK violation raises
-- `42501 new row violates row-level security policy`, which PostgREST returns as 403 with an error
-- body. The silence at 16 of the 18 call sites comes from DISCARDING the returned `error` object,
-- not from a 200. The remedy is unchanged — check `error` AND treat an empty `.select()` as failure —
-- but the wording in §3c(d) should be corrected so the next reader does not design around a 200.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Re-run the 4-arg definition captured byte-identical from the live database in
-- migrations/20260814160000_baseline-untracked-functions.sql, entry [55] (lines 2909-2969). It was
-- re-verified against pg_get_functiondef on 2026-08-20 and still matches. Notification rows already
-- written are ordinary rows and need no cleanup.
--
-- ── Preconditions — verify before applying ───────────────────────────────────
--  1. Exactly one submit_task_request overload exists (the 5-arg identity form was dropped by
--     20260819190000). Confirm: PGRST203 "ambiguous" must not be returned by a probe call.
--       SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--        WHERE n.nspname = 'public' AND p.proname = 'submit_task_request';
--  2. The live body still matches baseline entry [55] — steps 0-5 below are reproduced verbatim and
--     will overwrite whatever is there.
--       SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--        WHERE n.nspname='public' AND p.proname='submit_task_request';
--       -- expected 2026-08-20: a72d69a0502eb6906f1fea21c0b6e720   (length 1543)
--  3. The ACL is preserved, not reset. Re-check after applying:
--       SELECT proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--        WHERE n.nspname='public' AND p.proname='submit_task_request';
--       -- expected: {project_admin=X/project_admin,authenticated=X/project_admin}
--  4. Smoke test with a real employee JWT (the technique in P4 / session_context §1): submit a task
--     as employee-qa, then confirm a notifications row exists with the correct employee_id AND a
--     non-null user_id, and that the RPC returned "notified" >= 1.
--
-- ── Data shape at time of authoring (2026-08-20) ─────────────────────────────
--     employees 16 · with manager_id 5 · with org_unit_id 12 · active role='hr' 3
--     org_units 10 · with head_employee_id 0        ← branch 2/3 below resolves for NOBODY today
--     notifications 17 rows across 2 tenants, user_id NULL on all 17
-- So in production right now this notifies the manager for 5 employees and the 3 HR admins for the
-- rest; the unit-head chain is live code with no data behind it until 06's unit-head UI ships.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- ── What this migration does NOT fix (P8) ────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════
-- Each of the four sites above is a separate authorisation decision and none is smuggled in here:
--   * Expenses → HR: needs the HR lookup moved off `employees` (employee_directory_public, or a
--     server-side fan-out mirroring this one). Widening `employees` SELECT is not the answer.
--   * Peer task assignment (MyTasks.tsx:238): needs a `tasks` INSERT path for a manager. Today only
--     HR can create a task, so the entire peer-assignment UI is inert, notification or not.
--   * Peer approve / reject (MyTasks.tsx:274/303): needs approve_task_request / reject_task_request
--     to accept "the assignee's manager" as well as HR. Both currently hard-require
--     auth.users.metadata->>'role' = 'hr'.
-- Also not touched, and found while verifying:
--   * `notifications.tenant_id` carries a hardcoded DEFAULT of one specific tenant uuid
--     ('c3816de9-…'). Any insert omitting tenant_id is stamped with that tenant. It fails closed
--     (tenant_isolation then rejects it for everyone else) but the default is a landmine.
--   * `notifications` policies `tenant_active_restrictive` and `tenant_isolation` are LIVE but exist
--     in no migration. `npm run check:policy-drift` passes anyway because it matches policy NAME
--     against the concatenated text of all migrations, and both names appear there for OTHER tables.
--     The guard should key on (tablename, policyname).
--   * submit_task_request has no `SET search_path` (proconfig IS NULL) despite being SECURITY
--     DEFINER — unlike the P2 helpers. Not added here: it is an unrequested hardening change to a
--     function this migration is otherwise reproducing verbatim.
--   * type is written as 'general', matching both shipped call sites. NotificationBell.tsx:152
--     routes on `notif.type?.includes("task")`, so clicking a submission notification navigates
--     nowhere. Pre-existing; changing it is a UX decision, not this migration's.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Steps 0-5 are reproduced VERBATIM from migrations/20260814160000 entry [55].
-- Step 6 and the DECLARE block additions are the whole of this change.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.submit_task_request(p_task_id uuid, p_notes text, p_attachment_url text, p_attachment_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_task RECORD;
  v_tenant_id UUID;
  v_submission_id UUID;
  v_caller_uid UUID;
  v_employee_id UUID;
  -- added 20260820090000 — server-side submission notification
  v_submitter_name TEXT;
  v_manager_id     UUID;
  v_unit_id        UUID;
  v_head_id        UUID;
  v_recipients     UUID[] := '{}'::uuid[];
  v_project_name   TEXT;
  v_title          TEXT;
  v_body           TEXT;
  v_notified       INTEGER := 0;
BEGIN
  -- 0. Derive submitter identity from auth context — do NOT trust caller-supplied ID.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  -- 1. Fetch and lock task
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  v_tenant_id := v_task.tenant_id;

  -- 2. Resolve the employee record for this caller within this tenant.
  SELECT id INTO v_employee_id
  FROM public.employees
  WHERE user_id = v_caller_uid
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caller is not an employee of this tenant';
  END IF;

  -- 3. Confirm the task is actually assigned to this employee.
  IF v_task.assigned_to != v_employee_id THEN
    RAISE EXCEPTION 'Task not found or not assigned to this employee';
  END IF;

  -- 4. Insert new submission
  INSERT INTO public.task_submissions (
    task_id, tenant_id, employee_id, notes, attachment_url, attachment_name, status, submitted_at
  ) VALUES (
    p_task_id, v_tenant_id, v_employee_id, p_notes, p_attachment_url, p_attachment_name, 'pending', NOW()
  ) RETURNING id INTO v_submission_id;

  -- 5. Update task status
  UPDATE public.tasks
  SET status = 'submitted', updated_at = NOW()
  WHERE id = p_task_id;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- 6. Notify the reviewer. Added 20260820090000; everything above is unchanged.
  --
  -- Steps 0/2/3 have already established that the caller is an authenticated employee of this
  -- tenant AND the task's assignee. That is the entire authorisation basis for writing this row:
  -- the caller supplies no recipient, no tenant, and no text, so there is nothing here to forge.
  -- ─────────────────────────────────────────────────────────────────────────────

  SELECT e.full_name, e.manager_id, e.org_unit_id
    INTO v_submitter_name, v_manager_id, v_unit_id
  FROM public.employees e
  WHERE e.id = v_employee_id;

  IF v_manager_id IS NOT NULL THEN
    -- Branch 1: the shipped code uses manager_id raw, with no active/tenant filter. Preserved as
    -- coded (D1); D3's tenant fence on the INSERT is what stops a mis-parented manager landing a
    -- cross-tenant row.
    v_recipients := ARRAY[v_manager_id];
  ELSE
    -- Branches 2 and 3: own unit head, else parent unit head. `ORDER BY step LIMIT 1` reproduces
    -- the frontend's `for (const head of [ownHead, parentHead]) if (valid) return [head]`.
    -- A head that is the submitter, inactive, out-of-tenant, or absent is skipped — 06 §6 escalates
    -- to the parent unit when a unit head has left, and self-notification is a no-op.
    -- v_unit_id NULL simply yields no rows, which falls through to branch 4, matching the
    -- frontend's `if (orgUnitId) { ... }`.
    SELECT c.head INTO v_head_id
    FROM (
      SELECT ou.head_employee_id AS head, 1 AS step
        FROM public.org_units ou
       WHERE ou.id = v_unit_id
         AND ou.tenant_id = v_tenant_id
      UNION ALL
      SELECT parent.head_employee_id, 2
        FROM public.org_units ou
        JOIN public.org_units parent
          ON parent.id = ou.parent_id
         AND parent.tenant_id = v_tenant_id
       WHERE ou.id = v_unit_id
         AND ou.tenant_id = v_tenant_id
    ) c
    WHERE c.head IS NOT NULL
      AND c.head <> v_employee_id
      AND EXISTS (
        SELECT 1
        FROM public.employees h
        WHERE h.id = c.head
          AND h.tenant_id = v_tenant_id
          AND h.status = 'active'
      )
    ORDER BY c.step
    LIMIT 1;

    IF v_head_id IS NOT NULL THEN
      v_recipients := ARRAY[v_head_id];
    ELSE
      -- Branch 4: every active HR employee in the tenant. Same source as fn_check_insurance_expiries
      -- and as the frontend's employee_directory_public filter. The submitter is NOT excluded here —
      -- the shipped resolver excludes self only in the unit-head branches, and that asymmetry is
      -- preserved rather than quietly corrected (D1).
      SELECT coalesce(array_agg(h.id), '{}'::uuid[])
        INTO v_recipients
      FROM public.employees h
      WHERE h.tenant_id = v_tenant_id
        AND h.role::text = 'hr'
        AND h.status = 'active';
    END IF;
  END IF;

  -- array_length on an empty array returns NULL, and IF treats NULL as false — no recipients means
  -- no insert, and `notified` stays 0 so the caller can tell the difference.
  IF array_length(v_recipients, 1) > 0 THEN
    IF v_task.project_id IS NOT NULL THEN
      SELECT pr.name INTO v_project_name
      FROM public.projects pr
      WHERE pr.id = v_task.project_id
        AND pr.tenant_id = v_tenant_id;
    END IF;

    IF v_project_name IS NOT NULL THEN
      -- reproduces EmployeeProjectView.tsx:173-175
      v_title := 'Project Task Submitted';
      v_body  := v_submitter_name || ' submitted task: "' || v_task.title || '" in project "' || v_project_name || '"';
    ELSE
      -- reproduces MyTasks.tsx:192-193
      v_title := 'Task Submitted';
      v_body  := v_submitter_name || ' submitted task: "' || v_task.title || '"';
    END IF;

    -- user_id is set from the recipient's own employees row so that [71] notifications_self_read and
    -- [73] notifications_self_update agree with [72] notifications_self_rw on these rows. Joining
    -- through employees also drops any recipient id with no employee row, and D3's tenant_id
    -- predicate drops any recipient outside this tenant.
    INSERT INTO public.notifications (
      tenant_id, employee_id, user_id, title, body, type, reference_id
    )
    SELECT v_tenant_id, r.id, r.user_id, v_title, v_body, 'general', p_task_id
    FROM public.employees r
    WHERE r.id = ANY (v_recipients)
      AND r.tenant_id = v_tenant_id;

    GET DIAGNOSTICS v_notified = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'submission_id', v_submission_id,
    'notified', v_notified
  );
END;
$function$;

-- Re-assert the grant. CREATE OR REPLACE preserves the ACL, so this changes nothing — it is here
-- because "REVOKE FROM anon" alone is a documented no-op in this project (Postgres grants EXECUTE to
-- PUBLIC on every new function, and anon inherits it), and because a future reader copying this file
-- as a template should copy the correct pair.
REVOKE EXECUTE ON FUNCTION public.submit_task_request(p_task_id uuid, p_notes text, p_attachment_url text, p_attachment_name text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.submit_task_request(p_task_id uuid, p_notes text, p_attachment_url text, p_attachment_name text) TO authenticated;
