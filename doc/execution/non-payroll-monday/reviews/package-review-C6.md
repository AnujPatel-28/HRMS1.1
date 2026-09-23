# Package review — C6 P3 residuals + lead additions

Lead: Opus 5.5, 2026-09-23, in-session. **Verdict: ACCEPTED** (suite results in §5).

## 1. Before (live, TB-M1M2) — `tests/m1m2/c6_p3_residuals.mjs` pre-migration: 9/20

As plain `employee.a`: filed an already-**approved** expense and a "reimbursed" one (money path);
pinned own post, turned it into an **announcement**, created an already-pinned post; **deleted an
HR-issued document** from own folder; **deleted a colleague's profile photo** and uploaded into a
colleague's photo folder. Structural: acknowledgements self policy `FOR ALL` (employee could delete
their own acknowledgement), `create_draft_employee` present (dead, wrote `manager_id` without a
relationship row), `posts` realtime subscribes in both layouts. All legitimate paths worked.

## 2. Fix

| Migration | Change |
|---|---|
| `20260912197000` | `expenses_self_insert` WITH CHECK adds `status='pending'` and null `reviewed_by/reviewed_at/rejection_reason/payroll_run_id/reimbursed_at`; REVOKE ALL on `expenses` from anon. **posts:** BEFORE INSERT/UPDATE guard trigger `posts_guard_moderated_fields` — without `feed.moderate@company`, no pinned insert and no `type`/`is_pinned` change (server writers with no `auth.uid()` unaffected). **employee-documents** delete: `employee.sensitive.read@company` only (the owner still deletes files they uploaded via `storage_objects_owner_delete`). **Profile photos** insert/update/delete: own folder or HR. **Acknowledgements:** self `FOR ALL` → self `SELECT` (writes only via `acknowledge_policy_transaction`, definer). `DROP FUNCTION create_draft_employee`. |
| `20260912197100` (forward fix) | RESTRICTIVE insert/update/delete fences on `employee-profile-photos`. 197000's narrowed PERMISSIVE policies were ORed with the global `storage_objects_owner_insert` (`uploaded_by = me`), so a colleague-folder upload still succeeded. |

**Design deviation from the brief (posts):** the brief proposed revoking UPDATE and adding
`p3_edit_post` + a moderator RPC. A guard trigger gives the same guarantee on every path (REST, SDK,
any future screen), needs no `Connect.tsx` change (its only update is the moderator pin toggle),
and also closes the pinned-*insert* hole the brief did not list.

Frontend: dead `realtime.subscribe("posts")` + its INSERT handler removed from
`src/employee/EmployeeLayout.tsx` and `src/hr/HRLayout.tsx` (refused since P3-03; the unread
Connect badge still loads on navigation; `realtime.connect()` kept). `Connect.tsx` unchanged.
`tests/m1m2/p1_membership_invitation_revocation.mjs`: stale log text updated.

## 3. After — 20/20 (two consecutive runs)

Approved / reimbursed self-expense → `42501`; normal pending expense (the app's payload) → allowed ·
author pin / announcement / pinned insert → `POST_MODERATION_REQUIRED`; author content edit → allowed;
moderator pin (temporary `communication_moderator` template on HR, removed in `finally`) → allowed ·
employee delete of HR-issued doc → object still present; own upload + own delete → allowed; HR delete →
allowed · colleague photo delete → still present; colleague-folder upload → 403; own photo upload/delete
→ allowed; HR delete → allowed · acknowledgement write policies: 0 · `create_draft_employee`: gone ·
layouts: no `posts` subscribe. Storage residue 0; RLS 1/2/0 before/after. Policy drift 42 → 39.

## 4. Found → C9 (briefed)

`scratch/c6-bucket-probe.mjs`: a plain employee can upload into **9 buckets** that lack a
RESTRICTIVE write fence — `company-logos`, `company-assets`, `avatars` (public), and
`attendance-selfies`, `payslips`, `insurance-documents`, `resumes`, `recruiter_documents`,
`application-snapshots` — all through the global owner-insert policy. Probe objects removed.

## 5. Every suite

All 20 `tests/m1m2` suites after `197000`+`197100`, one run, exit code captured per suite:

```
c1_employee_self_edit rc=0
c2_business_date rc=0
c3_manager_convergence rc=0
c4_rederive_day rc=0
c5_half_day_leave rc=0
c6_p3_residuals rc=0
c7_tenant_write_policies rc=0
p1_capability_contract rc=0
p1_membership_invitation_revocation rc=0
p1_organization_transfer rc=0
p1_owner_lifecycle rc=0
p2_attendance_corrections rc=0
p2_leave_workflow rc=0
p2_work_calendar_resolver rc=0
p3_chat_connect rc=0
p3_policy_center rc=0
p3_private_buckets rc=0
p3_projects_tasks rc=0
p3_realtime_isolation rc=1
p3_scope_advertising rc=0
```

19/20 rc=0; `p3_realtime_isolation` rc=1 = item 6 only (accepted platform limit). No other FAIL or stack trace in any log.

## 6. Production

`197000` → `197100`; the layout change is independent (it only removes refused calls). Apply with the
other cleanup migrations in step (c) of `doc/session_context_2026-09-21-p3-complete.md` §2.
