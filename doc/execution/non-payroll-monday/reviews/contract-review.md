# P6 CONTRACT review — M1 + M2 Essential

Reviewer: independent senior engineer (Opus 5), CONTRACT mode
Date: 2026-09-12 IST
Target under review: `baseline.md`, `contracts.md` v0.1 (proposed freeze), `tasks.md`, `doc/non_payroll_implementation_roadmap_2026-09-12.md`
Repository revision inspected: working tree at `main` / `7214f8e3abeaef797d45122c7bc1129f0663cc43` plus the 4 uncommitted function edits and 1 untracked migration recorded in `baseline.md` §2
Delivery target reviewed against: controlled internal testing, 2026-09-14 EOD IST, Payroll and Insurance excluded

**VERDICT: CHANGES REQUIRED**

No code was modified. No migration, deployment, backend write, user creation or mutating test was performed. No production change was made.

---

## 0. Method, and the evidence rule applied throughout

I read the three execution artifacts and the roadmap, then independently inspected the current implementation rather than accepting the lead's summary. Source inspected: `src/App.tsx`, `src/contexts/AuthContext.tsx`, `src/contexts/TenantContext.tsx`, `src/shared/RequireModule.tsx`, `src/modules.ts`, `src/hooks/useAuth.ts`, `src/hooks/useChat.ts`, `src/hooks/useAuditLog.ts`, `src/shared/NotificationBell.tsx`, `src/shared/pages/Connect.tsx`, `package.json`, `scripts/check-policy-drift.mjs`, `migrations/` (110 files), `migrations-pending-deploy/`, the `functions/` layout, and the uncommitted diff.

**Two evidence classes are kept strictly apart in this review:**

- **CONFIRMED DEFECTS** — decidable from the artifacts themselves: contract text, `tasks.md` structure, committed migration SQL, committed frontend source. These need no backend to establish and no backend to refute.
- **NEEDS VERIFICATION** — claims about the *running* system (realtime delivery, bucket publicity, live policy set, deployed function bodies). Source inspection is not proof that a runtime security property holds or fails. Where these appear, the evidence cited is `baseline.md`'s live observation, and I state plainly that I did not run a runtime test.

`baseline.md` §5 records 32 live public-schema policies present in no migration. Anything asserted about live authorization from migration files alone is therefore provisional, and is marked as such.

---

## 1. What was reviewed

- Contract §1–§14 in full, against the current schema and frontend.
- Task decomposition P1-01…P1-03, P2-01…P2-04, P3-01…P3-03: allowed-file lists, dependency edges, shared-file ownership, acceptance criteria.
- The ten review areas requested (membership, authorization, approval security, revocation, organization, module boundaries, backend security, migration safety, task boundaries, deadline feasibility).
- Every `Exact allowed files` path in `tasks.md` was checked for existence. **All paths resolve correctly**; the only two that do not exist (`src/types/access.ts`, `src/hr/UsersAccess.tsx`) are both marked `(new)`. The function paths — the mix of `functions/<name>.ts` and `functions/<name>/index.ts` — match the repository exactly.
- Reserved migration versions `20260912180000`–`20260912189000` were checked against `migrations/` (head is `20260904120000`) and `migrations-pending-deploy/`. **No collision.**

## 2. What was NOT reviewed

- Any runtime behaviour. No backend was contacted; `BASELINE-RO` was not queried, and no isolated backend exists to query.
- Live RLS policy set, live storage policies and bucket publicity, live realtime channel/message policies, live grants. Migration files were my only source, and `baseline.md` states they are incomplete.
- Deployed function bodies, and therefore the two reported drifts (`check-punch-out-gate`, `on-leave-reviewed`) and the five deployed-only functions.
- Email/OAuth delivery, invitation delivery, password reset.
- Device/kiosk hardware behaviour (P2-03) beyond reading the task's own preconditions.
- Payroll and Insurance implementation internals (excluded from scope), except where their route gating bears on contract §12.
- The QA scratch scripts were not executed, consistent with `baseline.md` §6.

---

## CONFIRMED DEFECTS

### C1 — Non-employee administration is structurally unreachable: `assert_hr_for_tenant` hard-requires an employees row, and no task owns it
- **Severity: P0**
- **Object:** `public.assert_hr_for_tenant(uuid)` — `migrations/20260814160000_baseline-untracked-functions.sql:389-418`; contract §2.4, §4 (HR Admin template), `tasks.md` P1-02 AC1.
- **Scenario:** P1-02 provisions a named non-employee HR Admin per contract §2.4. That account opens Administration → Leave and approves a pending request. `approve_leave_request` calls `assert_hr_for_tenant`, which runs `SELECT id FROM employees WHERE user_id = auth.uid() AND tenant_id = ... AND status='active'` and raises `HR privileges required` when that row is absent. The same applies to `hr_schedule_shift_change` and every other RPC using this helper — **26 call sites across `migrations/`**.
- **Impact:** Contract §2.4 (a non-employee admin exists) and contract §4 (the HR Admin template carries company-scoped attendance/leave operations) are mutually unreachable. The flagship M2 Essential capability ships as navigation only: the admin sees Administration and every write fails. Worse, the natural fix under deadline pressure is to synthesise an employees row — which is precisely what contract §2.3 forbids.
- **Evidence:** function body as cited; `grep -c "assert_hr_for_tenant("` over `migrations/*.sql`, excluding the definition and GRANT/REVOKE lines, = 26.
- **Minimal corrective direction:** The contract must state whether a non-employee HR Admin may execute HR workflow RPCs in this milestone. If yes, `assert_hr_for_tenant` becomes a shared P1-owned object (it must return an actor identity that is not an employee id) and every consumer's `reviewed_by`/actor column must accept it — assign that to P1-02 explicitly. If no, contract §4 must state that the HR Admin template requires an employee association, and P1-02 AC1 must narrow to Company Admin only.
- **Test required:** A non-employee Company Admin and a non-employee HR Admin each attempt leave approval, task review, shift change and attendance correction; the result is a documented deny or a documented success with a non-employee actor recorded — not a 500.

### C2 — No task owns the test harness, yet every task delivers tests into it
- **Severity: P0**
- **Object:** `tests/` (does not exist), the `scripts` block in `package.json`, and all eleven `tests/m1m2/*.mjs` entries in `tasks.md`.
- **Scenario:** P1-01 completes and writes `tests/m1m2/p1_capability_contract.mjs`. There is no runner, no npm script, no fixture provisioning, no `TB-M1M2` project-id guard and no synthetic-tenant seeding utility. `package.json` appears in **no** task's allowed-file list, so no lane may add a script. The reviewer receives eleven orphan `.mjs` files and no way to run them.
- **Impact:** Every acceptance criterion in every task becomes unevidenceable. `tasks.md` "Execution controls" requires the runner to "fail hard if the project ID differs" — that guard has no owner and no file. Since acceptance evidence is the whole basis on which a candidate would be labelled testable, this blocks the programme, not one task.
- **Evidence:** `ls tests` → no such directory. `package.json` scripts are `dev, build, lint, preview, test:hrms-workflows, check:policy-drift`; `test:hrms-workflows` runs `scratch/test-exceptions.js` and `scratch/test-leave-approval.js`, which `baseline.md` §6 classifies NOT RUN — UNSAFE. `package.json` is absent from all allowed-file lists in `tasks.md`.
- **Minimal corrective direction:** Add a P1-00 (or fold it into the lead's W0) owning `tests/m1m2/_harness.mjs`, `tests/m1m2/fixtures/`, the `package.json` script and the hard project-id guard, with `package.json` as its exclusive file. Make it a dependency of every other task.
- **Test required:** The harness refuses to run when `npx @insforge/cli current --json` reports any project id other than the recorded `TB-M1M2`, verified by a deliberate mis-target.

### C3 — Contract §5.7's two-phase owner transfer cannot be implemented against the existing one-active-owner index
- **Severity: P1**
- **Object:** `employee_roles_one_active_owner_per_tenant` — `migrations/20260821120000_tenant-owner-and-retire-department-scope.sql:72-74`; contract §5.7.
- **Scenario:** §5.7 requires that "the target must be eligible and acknowledge/complete the required flow **before** the source loses ownership". Ownership is a row in `employee_roles` with `role='owner' AND is_active`. A partial unique index on `(tenant_id)` under exactly that predicate makes two simultaneously-active owner rows impossible. An implementer following §5.7 literally inserts the target's owner row, hits a unique violation, and then either drops the index (destroying the last-owner guarantee) or silently reverses the order (breaking §5.7).
- **Impact:** The contract prescribes a state the schema forbids. Whichever way the implementer resolves it under deadline pressure, one accepted criterion is silently violated, and `tasks.md` P1-02 AC9 ("Owner transfer is atomic/idempotent and last-owner removal/demotion is impossible") would be reported as passing either way.
- **Evidence:** index definition as cited; `employee_roles.employee_id` is `NOT NULL` with an FK to `employees` (`migrations/20260813190500_explicit-roles-and-scopes.sql:37`).
- **Minimal corrective direction:** Reword §5.7 so acceptance is recorded in a **pending-transfer artifact** (its own table/state), not as a second owner row, and the owner swap is a single atomic statement at completion. Keep the index.
- **Test required:** Initiate transfer → target acknowledges → verify exactly one active owner at every intermediate read; replay the completion call and confirm idempotence; abandon a pending transfer and confirm the source retains ownership.

### C4 — Contract §5.6's last-owner invariant has no baseline to protect, and no task owns the backfill
- **Severity: P1**
- **Object:** contract §5.6; the `employee_roles` seed block — `migrations/20260821120000_...:130-140`; `baseline.md` §5 ("Only three active role rows were observed, all `owner` rows across three tenants"; 15 tenants).
- **Scenario:** §5.6 says a tenant can never be left "without exactly one active Owner". Twelve of fifteen tenants currently have zero owner rows. The seed in `20260821120000` deliberately skips tenants with no HR employee. The migration's own comment states exactly-one "is unachievable as a constraint". No task in `tasks.md` creates owners for ownerless tenants, and no synthetic fixture requirement names it.
- **Impact:** "Last-owner protection" passes trivially on a fixture built with an owner and is untested for the real majority state. Any tenant reaching internal test without an owner has no protected authority at all — every access decision falls back to `is_hr()`, which is the self-escalation surface (see C5).
- **Evidence:** as cited; the migration comment at `:65-71` states the constraint is at-most-one, not exactly-one, and gives the reason.
- **Minimal corrective direction:** §5.6 should read "at most one active Owner; a tenant with zero owners is an explicit provisioning defect surfaced to platform admin", and P1-02 must own either an owner backfill or a documented ownerless-tenant state.
- **Test required:** A fixture tenant with **no** owner row; verify the product surfaces the gap rather than granting implicit authority, and that owner assignment from that state is a protected operation.

### C5 — `employee_roles_hr_all` is an unrestricted self-escalation grant, and narrowing it has a fan-out no task has sized
- **Severity: P1**
- **Object:** policy `employee_roles_hr_all` — `migrations/20260813190500_explicit-roles-and-scopes.sql:79-83`; `public.is_hr()` at `:113-140`; contract §5.2, §5.3.
- **Scenario:** The policy is `FOR ALL TO authenticated USING (can_access_tenant(tenant_id) AND is_hr()) WITH CHECK (same)`. Any principal for whom `is_hr()` is true may `INSERT` an `hr_admin` or `owner` row for themselves. `is_hr()` is true for anyone whose `auth.users.metadata->>'role'='hr'` for their tenant. Contract §5.2 ("HR Admin does not imply `access.manage`") and §5.3 ("no assignment can make the caller more privileged") are both violated by the current policy.
- **Impact:** This is the single most load-bearing change P1-02 must make, and the one with the largest blast radius. Fixing it means `employee_roles` writes must be gated on `access.manage` instead of `is_hr()`, while `is_hr()` remains the gate for nearly everything else.
- **Evidence — the fan-out, counted rather than estimated.** The defensible live figure is **~68 policy bodies** (occurrences of `is_hr()` inside a `CREATE POLICY` block, within three lines of the policy header) plus **26 `assert_hr_for_tenant` call sites** (which itself requires `is_hr()`, see C1). This is corroborated independently by the 2026-08-13 migration's own comment: "63 existing policies depend on is_hr()". The raw total is 225 references across 48 migration files, but that count includes superseded `CREATE OR REPLACE` history and should not be used as the live surface.
- **Minimal corrective direction:** Contract §5 must state explicitly that for M1, `is_hr()` is **retained unchanged** as the legacy HR gate and `access.manage` is layered as a **separate, narrower** predicate governing `employee_roles` writes only. Do not attempt to make one resolver authoritative in this milestone — see the deadline section.
- **Test required:** An HR principal without `access.manage` attempts to insert and update `employee_roles` (own row and another's) and is denied; the same principal's existing HR workflows still pass.

### C6 — Contract §2.9 / §14 demand a single authoritative writer; the `is_hr()` JWT branch is deliberately load-bearing and cannot be retired in this milestone
- **Severity: P1**
- **Object:** contract §2.9 ("cannot leave two independently editable sources of truth"), §9 ("legacy `manager_id`/`secondary_manager_id` ... cannot remain competing authoritative writers"); the `public.is_hr()` metadata branch — `migrations/20260813190500_...:118-126`; `migrations/20260821120000_...:65-71`.
- **Scenario:** The metadata branch exists because a new tenant's first HR admin has no `employees` row to attach a grant to. Removing it breaks tenant provisioning; retaining it leaves two independently editable sources, which §2.9 forbids. `tasks.md` P1-02 lists "documented compatibility mapping from metadata/`employee_roles`" as a dependency, but no acceptance criterion asserts single-writer, and no task retires the metadata branch.
- **Impact:** The contract states an invariant the milestone will not achieve. At review time the implementer will either be failed for a condition that was never scheduled, or the criterion will be quietly declared satisfied. Both are worse than an explicit deferral.
- **Evidence:** as cited. `src/contexts/AuthContext.tsx:38-42` (`extractRole`) reads `metadata.role ?? profile.role`, so the frontend depends on the metadata branch too.
- **Minimal corrective direction:** Rewrite §2.9 as: "For M1, metadata remains the bootstrap writer for the first tenant admin; membership/`employee_roles` is the writer for every subsequent grant. Retiring the metadata branch is M2 Remaining." Apply the same treatment to the legacy `manager_id` clause in §9.
- **Test required:** Provision a brand-new tenant end to end and confirm the first admin obtains authority without any pre-existing `employees` row.

### C7 — Contract §9 models two relationship types; the schema permits six, and `is_manager_of()` honours all of them
- **Severity: P1**
- **Object:** the `employee_reporting_relationships.relationship_type` CHECK — `migrations/20260813080000_offboarding-safety-foundations.sql:106-114`; `public.is_manager_of(uuid)` — `migrations/20260813183901_manager-team-read-scope.sql:26-58`; contract §9; `tasks.md` P1-03 AC5.
- **Scenario:** The CHECK admits `primary, secondary, mentor, project_manager, reviewer, temporary`. `is_manager_of()` matches **any** active, in-date row regardless of type, plus `employees.manager_id` and `employees.secondary_manager_id`. A person recorded as someone's *mentor* or *reviewer* therefore receives manager read scope on `attendance` and `leaves` (policies `attendance_select_manager`, `leaves_select_manager`, same file `:69-78`) and passes `can_view_employee()`.
- **Impact:** §9 disciplines only `secondary`. P1-03 AC5 tests only that "secondary manager receives no blanket scope". An implementer can satisfy the contract and the acceptance criterion exactly while `mentor`, `reviewer`, `project_manager` and `temporary` continue to grant blanket manager scope. Contract §4's explicit exclusion "Project Manager … is not a reporting manager" is contradicted by a `relationship_type='project_manager'` row granting precisely that.
- **Evidence:** CHECK constraint and function body as cited.
- **Minimal corrective direction:** §9 must enumerate all six types and state that only `primary` yields `direct_reports`; P1-03 AC5 must name all five non-primary types.
- **Test required:** For each of the five non-primary types, the holder reads the subject's `attendance`, `leaves` and employee record and is denied.

### C8 — `baseline.md` §5 misstates the reporting-relationship constraint
- **Severity: P2**
- **Object:** `doc/execution/non-payroll-monday/baseline.md` §5 — "Reporting relationships are effective-dated and constrain relationship type to `primary` or `secondary`".
- **Scenario:** The statement is false against the committed schema (see C7). A lane treating the baseline as ground truth will scope its work to two types and miss four.
- **Impact:** The baseline is the artifact every lane is told to trust. One verified error in it justifies re-checking its other schema assertions before they are used as design inputs.
- **Evidence:** `migrations/20260813080000_offboarding-safety-foundations.sql:106-114` lists six permitted values.
- **Minimal corrective direction:** Correct the sentence and re-verify the other `VERIFIED access/schema facts` bullets in §5 against migration source.
- **Test required:** None (documentation correction); C7's test covers the behaviour.

### C9 — Contract §10.2's overlap rejection is not enforced by the existing index, and a dated transfer is exactly the case it misses
- **Severity: P1**
- **Object:** `employee_reporting_one_active_primary` — `migrations/20260813080000_...:116-118`; contract §10.2; `tasks.md` P1-03 AC2, AC7.
- **Scenario:** The index is `UNIQUE (employee_id) WHERE relationship_type='primary' AND is_active=true AND effective_to IS NULL`. A dated transfer sets the outgoing row's `effective_to` and inserts an incoming row with `effective_from`. The outgoing row now has a non-null `effective_to`, so it leaves the index predicate entirely. If its `effective_to >= effective_from` of the new row, **two rows are simultaneously current** and `is_manager_of()` returns true for both managers — the exact failure P1-03 AC4 ("former primary loses it on the next operation") is meant to exclude.
- **Impact:** The contract asserts an invariant the schema does not hold, and the acceptance criterion that would catch it (AC2, "at most one current primary") passes against the index while the real overlap exists.
- **Evidence:** index predicate as cited; `is_manager_of` matches `r.is_active AND (effective_from IS NULL OR <= CURRENT_DATE) AND (effective_to IS NULL OR >= CURRENT_DATE)`, so a closed row with `effective_to = CURRENT_DATE` still matches.
- **Minimal corrective direction:** P1-03's migration must add a date-range exclusion constraint on `(employee_id)` for `relationship_type='primary' AND is_active`; §10.2 should say "no two primary relationships may overlap on any date", not "overlapping active assignments are rejected".
- **Test required:** Transfer on date D with outgoing `effective_to = D` and incoming `effective_from = D`; assert the write is rejected, or that exactly one manager resolves on D.

### C10 — P1-01 and P1-02 declare each other as dependencies
- **Severity: P1**
- **Object:** `tasks.md` P1-01 Dependencies ("P1-02 backend capability endpoint/interface agreed before client finalization") vs. P1-02 Status ("BLOCKED on P1-01 interface") and "Integrated ordering" step 4 ("Run P1-01, then P1-02").
- **Scenario:** Neither task can start. In practice the lane will start P1-01, invent a capability-summary shape, and P1-02 will conform — which is workable, but it is not what the artifact says, and P1-01's Review requirements state "P1-02 integration invalidates acceptance if the server summary changes", guaranteeing rework.
- **Impact:** On a two-day schedule, a guaranteed re-review of the highest-risk package is not affordable.
- **Evidence:** the two dependency lines as cited.
- **Minimal corrective direction:** Freeze the capability-summary wire shape (contract §6) as a lead-owned artifact *before* either task starts; P1-01 then depends only on that frozen shape.
- **Test required:** None; it is a sequencing correction.

### C11 — "No self-approval" is a cross-cutting contract rule with no single owner; three lanes implement it in three migrations
- **Severity: P1**
- **Object:** contract §7; `tasks.md` P2-02 AC5, P2-04 AC2, P3-02 AC3, with migrations `20260912184000`, `20260912186000` and `20260912188000` in three different lanes.
- **Scenario:** §7.3 requires the actor, subject, action/scope, module state and record status to be re-derived **inside the server transaction**. Three lanes will write three predicates. Divergence is near-certain: the leave path derives the actor through `assert_hr_for_tenant`, the task path through an inline `auth.users.metadata->>'role'='hr'` check (`migrations/20260814160000_...:221-227`), and the attendance-correction path through a third route.
- **Impact:** A rule whose entire value is uniformity is delivered non-uniformly, and a gap in any one path defeats it. Contract §14 assigns "shared capability/guard/types" to P1, but `tasks.md` gives P1 no no-self-approval deliverable.
- **Evidence:** the three acceptance criteria and three distinct migration slots; the two differing actor-derivation paths cited above.
- **Minimal corrective direction:** P1-01's migration (`20260912180000`) owns one shared predicate — e.g. `assert_distinct_approver(p_subject_employee_id uuid)` — and P2/P3 call it rather than reimplementing.
- **Test required:** The same human holding employee + HR + Manager + Project Manager attempts self-approval on leave, task submission and attendance correction; all three deny with the same error class.

### C12 — Audit is browser-authored and forgeable, no task owns it, and three contract clauses depend on it
- **Severity: P1**
- **Object:** `src/hooks/useAuditLog.ts:70-80`; contract §5.4, §8.7, §10.4.
- **Scenario:** `logAction` inserts directly into `audit_logs` from the browser with client-supplied `tenant_id`, `actor_id`, `actor_role`, `action`, `target_type`, `target_id`, `details` and `ip_address`, and swallows all errors (`:81-84`). An authenticated user can write arbitrary audit rows, or simply not write one. Contract §5.4 requires access mutations to be "server-side, tenant-derived, atomic and audited with actor, subject, prior state, new state, reason/correlation and timestamp" — none of which this provides. `src/hooks/useAuditLog.ts` appears in **no** task's allowed-file list.
- **Impact:** "Access changes are audited without secrets" (P1-02 AC10) can be marked passing by calling the existing client hook, which satisfies none of §5.4's properties. Separately, `actor_id` resolves via `employees.user_id` (`:61-63`) and is therefore `null` for exactly the non-employee administrator this milestone introduces — the actor most in need of an audit trail.
- **Evidence:** hook source as cited.
- **Minimal corrective direction:** P1-02 owns a server-side audit write inside the membership/grant mutation transaction (its migration slot already exists). Either add `src/hooks/useAuditLog.ts` to P1-02's allowed files, or state explicitly that it is out of scope and not the mechanism satisfying §5.4.
- **Test required:** An access mutation produces exactly one audit row written by the server; a client attempting to insert an `access.*` audit row directly is denied.

### C13 — P1-01 AC5 (Payroll/Insurance unavailable on direct route) cannot be satisfied inside P1-01's allowed files
- **Severity: P1**
- **Object:** `src/App.tsx:205-212`; `src/payroll/employee/EmployeePayrollLayout.tsx` (no `RequireModule`); `src/modules.ts:68`; `tasks.md` P1-01 AC5 and allowed-file list.
- **Scenario:** `/payroll` is gated because `src/payroll/PayrollLayout.tsx:179` wraps its outlet in `RequireModule`. `/payroll/employee` is **not** — `EmployeePayrollLayout.tsx` contains no `RequireModule`, `moduleForPath` or `hasModule` reference. A direct GET of `/payroll/employee/payslips` renders for a tenant with payroll disabled. Neither payroll layout file is in P1-01's allowed list; only `src/App.tsx` is, so the only in-scope fix is deleting or gating the route there.
- **Impact:** The task's own acceptance criterion is unachievable as scoped; the implementer either exceeds their file list or reports a pass on navigation alone.
- **Evidence:** `grep -n "RequireModule\|moduleForPath\|hasModule" src/payroll/employee/EmployeePayrollLayout.tsx` → no match. `src/modules.ts:68` maps `/employee/payslips` → payroll, but no such route exists in `App.tsx`; the real route is `/payroll/employee/payslips`, which matches only via the broader `/payroll` prefix entry.
- **Minimal corrective direction:** Either add the two payroll layout files to P1-01's list, or restate AC5 as "route removed in `App.tsx` for candidate tenants" and fix the stale `/employee/payslips` mapping in `src/modules.ts`.
- **Test required:** Direct GET of `/payroll/employee/payslips`, `/payroll/hr/run`, `/hr/insurance` and `/employee/insurance` on a payroll-and-insurance-disabled tenant, plus the corresponding direct API/RPC calls.

### C14 — `tasks.md` "Migration reservations" section contains no reservations
- **Severity: P1**
- **Object:** `tasks.md`, "### Migration reservations" — the heading, its paragraph, then immediately "### Ownership and models".
- **Scenario:** The section states "The following are reserved exact paths" and lists nothing. The ten reserved versions appear only scattered inside individual task bodies. The lead is instructed to "recheck that each version is unused" against a list that does not exist.
- **Impact:** Migration sequencing is the one activity `tasks.md` says only the lead may perform, and its control table is empty. Two lanes reserving adjacent versions, or a version colliding with the two unapplied files in `migrations-pending-deploy/`, would not be caught by the stated procedure.
- **Evidence:** the section as written.
- **Minimal corrective direction:** Populate the table with all ten reserved versions, their owning task and purpose.
- **Test required:** None; documentation completion. (I verified independently that none of the ten collide: `migrations/` head is `20260904120000`.)

### C15 — `migrations-pending-deploy/` is absent from the reconciliation step
- **Severity: P2**
- **Object:** `migrations-pending-deploy/20260902120000_*.sql` and `20260902130000_*.sql`; `tasks.md` "Integrated ordering" step 3.
- **Scenario:** Step 3 names the remote-only migration, the live-only policies, the deployed-only functions and the two function drifts — but not the two written-and-reviewed migrations deliberately withheld pending a frontend deploy. Both alter `create_employee_transaction`'s signature and columns, which is exactly the employee-provisioning surface P1-02 rewrites.
- **Impact:** P1-02 may change provisioning without knowing two signature-correcting migrations are queued against the same object, and `TB-M1M2` will be stood up without them, so it will not match the schema P1-02's successor work assumes.
- **Evidence:** `migrations-pending-deploy/README.md` describes the hold and the renumber-on-release procedure; `baseline.md` §5 notes the two versions are unapplied, but `tasks.md` step 3 omits them.
- **Minimal corrective direction:** Add them to step 3 with an explicit apply/defer/supersede decision before P1-02 starts.
- **Test required:** Employee creation end to end on `TB-M1M2` after whichever disposition is chosen.

### C16 — `approve_task_request` honours only the metadata HR branch, so contract §4's HR Admin and Project Manager task-review rights are unreachable
- **Severity: P2**
- **Object:** `public.approve_task_request(uuid)` — `migrations/20260814160000_baseline-untracked-functions.sql:221-227`; contract §4 (`task.review`); `tasks.md` P3-02 AC1/AC2.
- **Scenario:** The function requires `EXISTS (SELECT 1 FROM auth.users WHERE id = v_caller_uid AND metadata->>'role' = 'hr')` — it does **not** call `is_hr()`, so an `employee_roles`-granted `hr_admin` is refused, and a Project Manager has no path at all. The metadata check also omits a tenant comparison (unlike `is_hr()`, which compares `metadata->>'tenant_id'`), though the preceding `employees` lookup does fence the tenant.
- **Impact:** Two fixed templates that contract §4 says carry `task.review` cannot execute it. P3-02 AC2 ("Project Manager authority is project-scoped") has no server mechanism today.
- **Evidence:** function body as cited.
- **Minimal corrective direction:** P3-02's migration re-points the role check at the P1 capability predicate rather than raw metadata.
- **Test required:** An `hr_admin`-granted (non-metadata) HR user and a Project Manager each review a submission in scope, and are denied out of scope.

### C17 — The "disabling Tasks cannot trap punch-out" invariant is owned by two lanes with two migrations
- **Severity: P2**
- **Object:** `tasks.md` P2-02 AC6 (migration `20260912184000`, `functions/check-punch-out-gate/index.ts`) and P3-02 AC5 (migration `20260912188000`, task lifecycle); `public.approve_task_request` writes `attendance.punch_out_allowed` (`migrations/20260814160000_...:248-267`).
- **Scenario:** The gate spans both lanes: the tenant flag `punch_out_gate_enabled`, the edge function, and the unlock side-effect inside the task-approval RPC. Two lanes may change the same behaviour in two migrations applied four versions apart, in either order.
- **Impact:** Conflicting or duplicated changes to a safety-critical path (an employee unable to punch out), with each lane's test passing against its own change.
- **Evidence:** the two acceptance criteria and the RPC's `UPDATE public.attendance SET punch_out_allowed = true` block.
- **Minimal corrective direction:** Assign the gate to P2-02 alone; P3-02 AC5 becomes a consumer regression test with no migration authority over it.
- **Test required:** Tasks module disabled; an employee with an unapproved task punches out successfully; re-enable and confirm the gate resumes.

### C18 — The policy-drift gate covers only `schemaname='public'`, so storage and realtime policies are outside it
- **Severity: P2**
- **Object:** `scripts/check-policy-drift.mjs:27-28`; `baseline.md` §6 ("32 of 275 live policies are untracked").
- **Scenario:** The query is `SELECT tablename, policyname FROM pg_policies WHERE schemaname='public'`. `storage.objects` and `realtime.*` policies are never examined. Separately, **no migration in `migrations/` creates any `storage.objects` or `storage.buckets` policy at all** — `grep -rn "storage.objects\|storage.buckets" migrations/*.sql` over 110 files returns nothing.
- **Impact:** "32 untracked of 275" understates the reproducibility risk: the entire storage and realtime authorization surface is unrepresented in the repository and invisible to the gate. `TB-M1M2` therefore **cannot be stood up with storage or realtime security equivalent to `BASELINE-RO` from the repository**, which is a precondition `tasks.md` step 2 assumes is achievable.
- **Evidence:** script line as cited; the empty grep result.
- **Minimal corrective direction:** Extend the drift script to the `storage` and `realtime` schemas, and make "export live storage + realtime policies into a forward migration" an explicit `TB-M1M2` setup deliverable owned by the lead before P3-01/P3-03 begin.
- **Test required:** The drift check passes on `TB-M1M2` across all three schemas after fixture setup.

### C19 — `approve_leave_request` nulls `punch_in` on the derived attendance row
- **Severity: P2**
- **Object:** `public.approve_leave_request` — `migrations/20260824100002_repoint-leave-approval-onconflict-to-new-attendance-key.sql:155-160`; contract §11.7; `tasks.md` P2-04 AC5.
- **Scenario:** For each working date the function runs `INSERT INTO attendance (...) ... ON CONFLICT (...) DO UPDATE SET status='on_leave', punch_in=NULL, punch_out_allowed=true, session_status='closed'`. Approving backdated leave over a day the employee actually punched in clears `punch_in` on the derived row.
- **Impact:** Contract §11.7 says "a leave row must not erase evidence"; P2-04 AC5 says "Attendance receives approved coverage without erasing raw evidence". The **derived** row is overwritten. Whether *raw* evidence survives depends on `attendance_events` retaining the punch — which I did **not** verify (see N6). If it does, this is a reversibility and display defect; if it does not, it is data destruction. Severity is set on the verified half only.
- **Minimal corrective direction:** P2-04's migration should preserve `punch_in` and represent leave coverage as an additional attribute rather than a replacement; the contract should say "derived state may change; evidence columns may not be nulled".
- **Test required:** Punch in on date D, approve backdated leave covering D, assert the punch is still readable in both the event log and the derived row, then cancel the leave and assert the day restores.

### C20 — Contract §9's manager approval routing does not exist, and §10.5 / P1-03 AC6 describe reassigning a pending approver that is never stored
- **Severity: P1**
- **Object:** contract §9 ("Primary manager: ... default operational approval routing and pending-request reassignment"), §10.5, `tasks.md` P1-03 AC6; `public.approve_leave_request` — `migrations/20260824100002_...:85` (`v_hr_employee_id := assert_hr_for_tenant(...)`); policies `leaves_select_manager` — `migrations/20260813183901_...:73` and `migrations/20260813190500_...:198`.
- **Scenario, part 1 — routing does not exist.** Leave approval derives its approver through `assert_hr_for_tenant`, i.e. **HR only**. The only manager-facing grant on `leaves` anywhere in `migrations/` is `SELECT`; there is no manager `UPDATE` policy and no manager-approval RPC (`grep -rln "manager.*approve\|approve.*manager" migrations/*.sql` → no match). A primary manager without an HR grant cannot approve their own direct report's leave today. Contract §9 asserts a routing mechanism that is not implemented, and no task in `tasks.md` builds one.
- **Scenario, part 2 — there is nothing to reassign.** §10.5 requires pending approvals to be "explicitly reassigned to the new eligible approver or placed in a visible blocked state", and P1-03 AC6 makes that an acceptance criterion. No table carries a stored approver: `grep -rn "approver\|assigned_approver\|pending_with" migrations/*.sql` returns **nothing** across all 110 files. Approvers are resolved dynamically at approval time. "Reassignment" therefore describes an operation on state that does not exist — it is unimplementable as written, not merely unowned.
- **Impact:** Two contract clauses and one acceptance criterion rest on a routing/assignment model the system does not have. An implementer will either build a pending-approver table under deadline pressure (unreviewed new schema on the critical path, which the roadmap's Monday stop rules forbid) or will report AC6 as passing because "approvals resolve dynamically, so nothing was lost" — which is true and completely misses the intent.
- **Evidence:** the three greps as cited; `approve_leave_request`'s actor derivation; the manager policies being `FOR SELECT` only.
- **Minimal corrective direction:** For M1, restate §9 and §10.5 as: approvals resolve dynamically against current authority, so a manager transfer changes the eligible approver with no stored assignment to migrate; the required behaviour is that a pending request whose eligible approver set becomes empty enters a visible blocked state. Defer stored approver assignment and true reassignment to M2 Remaining. Restate P1-03 AC6 to test the blocked state, not a reassignment.
- **Test required:** Transfer an employee mid-request and confirm the new primary manager (or HR) resolves as eligible on the next read and the old one does not; remove every eligible approver and confirm the request is visibly blocked rather than auto-approved or silently orphaned.

### C21 — Composed-session support is reachable in P1-01's file list, but two unowned files still branch on the exclusive role
- **Severity: P2**
- **Object:** `src/hr/Directory.tsx:32`, `src/shared/NotificationBell.tsx:150`; `tasks.md` P1-01 AC2 and allowed-file list.
- **Scenario:** I checked whether P1-01 AC2 ("HR+employee sees My Work, Team and Administration in one session") shares C13's file-list problem. It largely does not: `grep -rn 'role === "employee"\|role !== "employee"\|role === "hr"\|role !== "hr"' src/employee/ src/hr/ src/shared/` returns only four hits, none of which gates a `src/employee/*` page. Route composition is achievable through `App.tsx`, `EmployeeLayout.tsx` and `HRLayout.tsx`, all of which P1-01 owns. **AC2 is reachable within the allowed files.**
- **Residual defect:** `NotificationBell.tsx:150` computes deep links as `role === "hr" ? "/hr" : "/employee"`, so in a composed session every notification deep-links into one half regardless of which surface the item belongs to; `Directory.tsx:32` derives `isHr` the same way. Neither file is in any task's allowed-file list (`NotificationBell.tsx` is the same unowned file noted in N1).
- **Impact:** Low and cosmetic-to-confusing, not an authorization defect — but it is the visible symptom of AC2 in the surface users touch most.
- **Evidence:** the grep result as cited.
- **Minimal corrective direction:** Add `src/shared/NotificationBell.tsx` and `src/hr/Directory.tsx` to P1-01's allowed files, or note explicitly that deep-link composition is deferred.
- **Test required:** In a composed HR+employee session, a task notification and a leave notification each deep-link to the surface that owns the record.

### C22 — Designation-confers-no-authority has no negative test
- **Severity: P3**
- **Object:** contract §4 (`designation.manage`), §10.6 ("Designation/title never confers authority"); `tasks.md` P1-03 AC1.
- **Scenario:** P1-03 AC1 asserts designation remains independent of access, but structurally rather than behaviourally. The roadmap's matrix-organization requirement explicitly calls for "no title-based privileges", and nothing tests it.
- **Impact:** Low — the invariant is likely already true (nothing in the migrations reads `job_titles` for authorization) — but it is unevidenced.
- **Minimal corrective direction:** Add one negative assertion to P1-03 AC1.
- **Test required:** An employee whose designation is an HR-sounding title attempts an HR action and is denied.

---

## NEEDS VERIFICATION

These concern the running system. I executed no runtime test. The evidence cited is `baseline.md`'s live observation plus committed source that makes the failure plausible; neither establishes the runtime property.

### N1 — Realtime cross-tenant payload delivery
- **Severity: P0 if confirmed**
- **Object:** `public.notify_chat_message()` and `public.notify_chat_channel()` — `migrations/20260814160000_baseline-untracked-functions.sql:2338-2373`; `public.notify_employee_notification()` — `:2375-2389`; `src/hooks/useChat.ts:41-50`; `src/shared/NotificationBell.tsx:89-128`.
- **Why it is plausible:** Both chat triggers publish `row_to_json(NEW)::jsonb` — the **full row** — to the global topics `chat_messages` and `chat_channels`, which carry no tenant in the topic name. The per-room topic is `'chat:' || NEW.channel`, built from a **text channel name, not an id**, so two tenants with a channel called `general` resolve to the same topic. `baseline.md` §5 records `realtime.channels` and `realtime.messages` with RLS disabled and zero policies, and empty permission arrays. Both clients filter after receipt (`useChat.ts:43-44`: `if (payload.tenant_id === tenantId) handler()`; `NotificationBell.tsx:99`), which is a display filter, not an authorization control.
- **Impact if confirmed:** Cross-tenant message-body disclosure over websockets — a release blocker for Chat/Connect. Separately, `notifications:<employee_id>` is a guessable-uuid topic and employee ids are visible to colleagues through the directory.
- **Evidence still required:** Two synthetic tenants, each with an identically named channel; capture raw socket frames on tenant B while tenant A posts. Packet evidence, not channel names.
- **Ownership gap (this part is CONFIRMED, not pending):** `src/shared/NotificationBell.tsx` and `notify_employee_notification()` appear in **no** task's allowed-file list, and P3-03's acceptance criteria say nothing about the notification topic. Notification realtime isolation currently has no owner.
- **Test required:** Negative socket-payload capture across two tenants for chat, channels and notifications — before and after reconnect, and after membership revocation.

### N2 — Bucket publicity and anonymous attachment access
- **Severity: P0 if confirmed**
- **Object:** buckets `chat-attachments`, `task-attachments`, `employee-documents`, `hr-policies`, `expense-receipts`; contract §12; `tasks.md` P3-01 AC3, P3-03 AC4.
- **Why it is plausible:** `baseline.md` §5 records nine public buckets including all of the above, and notes storage policies permit broad same-tenant employee-document operations. `CLAUDE.md` §16 independently lists the same buckets as public.
- **Evidence still required:** Fetch an object URL from each bucket with no credentials from a clean client, and record the HTTP status.
- **Related confirmed item:** C18 — no storage policy exists in any migration, so whatever protection is live cannot be reproduced on `TB-M1M2` from the repository.
- **Test required:** Anonymous GET per bucket; wrong-tenant authenticated GET; non-member authenticated GET; post-revocation GET on a previously issued signed URL.

### N3 — Disposition of the 32 untracked live public-schema policies
- **Severity: P1**
- **Evidence still required:** Enumerate all 32, classify each as intended-but-untracked or stale, and land the intended ones as a forward migration before `TB-M1M2` is seeded. Until then `npm run check:policy-drift` fails and no lane can distinguish "my change broke it" from pre-existing drift. `tasks.md` step 3 names this but assigns it no acceptance criterion and no owner beyond "the lead".

### N4 — The four uncommitted limiter edits are unverified at runtime
- **Severity: P1**
- **Object:** `functions/create-employee-user.ts`, `finalize-onboarding.ts`, `set-employee-password.ts`, `verify-employee-code.ts`; `tasks.md` P1-02 dependencies and Review requirements.
- **Why it matters:** The diff moves `check_rate_limit` onto a server/admin client because `migrations/20260904120000_harden-definer-tenant-fences.sql:15` revoked `EXECUTE` from `authenticated`. This is the **second** time that revoke broke onboarding. `tasks.md` correctly requires the edits be preserved and reviewed — but **no acceptance criterion requires a post-change employee-creation smoke test**, and P1-02 is the task that rewrites provisioning on top of them.
- **Evidence still required:** Run `create-employee-user` and `set-employee-password` end to end on `TB-M1M2` against the deployed versions of these files before P1-02 changes anything, to establish they work; then again after.
- **Test required:** Add to P1-02 — "the four preserved limiter edits pass an employee-create and set-password smoke test both before and after this package."

### N5 — Local/deployed drift on `check-punch-out-gate` and `on-leave-reviewed`
- **Severity: P1**
- **Object:** `baseline.md` §4 parity table; `tasks.md` P2-02 and P2-04 dependencies.
- **Why it matters:** Both tasks list "explicit decision/reconciliation" for the drift as a dependency, but neither says which side is authoritative or who decides. If the deployed body is ahead, editing the local file silently reverts a production fix on deploy.
- **Evidence still required:** `functions code <slug>` for both, a diff, and a recorded decision naming the authoritative side.

### N6 — Whether `attendance_events` preserves the punch that C19 nulls
- **Severity: P2**
- **Evidence still required:** Confirm the event log retains the raw punch after `approve_leave_request` overwrites the derived row. This determines whether C19 is a display/reversibility defect or evidence destruction.

### N7 — The five deployed-only functions
- **Severity: P2**
- **Object:** `auth-signup`, `auth-session`, `auth-verify`, `admin-auth-login`, `daily-incomplete-task-marker` (`baseline.md` §4).
- **Why it matters:** P1-02 changes authentication and membership. Four of the five are auth functions with no local source. They cannot be reproduced on `TB-M1M2` and could contain authority paths that bypass the new membership model entirely.
- **Evidence still required:** Fetch each body, commit it, and assess whether any grants tenant access outside membership/`employee_roles`.

### N8 — Credential exposure and rotation
- **Severity: P1**
- **Object:** `baseline.md` §4 ("The CLI emitted privileged credential material"), §8 item 2; `CLAUDE.md` §16 records a production admin key served publicly and "still valid and unrotated".
- **Evidence still required:** Confirmation that the affected keys were rotated, that no key reaches `TB-M1M2` fixtures as a literal, and that the embedded credentials in `scratch/*.mjs` are removed before any harness reuses them.

---

## CHECKED, NOT A DEFECT

Recorded so the next reader does not re-raise them.

1. **Caller-supplied actor overloads `approve_task_request(uuid, uuid)` and `reject_task_request(uuid, uuid, text)`** — these are SECURITY DEFINER with no authorization check whatsoever at `migrations/20260814160000_...:274` and `:2640`, but they were **dropped** by `migrations/20260817110000_drop-superseded-identity-parameter-overloads.sql:28-30`. Not a live finding.
2. **All `Exact allowed files` paths in `tasks.md` resolve**, including the irregular `functions/<name>.ts` vs `functions/<name>/index.ts` split and `create-hr-admin-user/index.js` being `.js` where its siblings are `.ts`. Only the two `(new)` paths are absent, correctly.
3. **Reserved migration versions `20260912180000`–`20260912189000` do not collide** with `migrations/` (head `20260904120000`) or `migrations-pending-deploy/`.
4. **`is_manager_of()` does contain a self-reference guard** (`me.id <> target.id`) and a tenant equality check; the defect in C7 is the breadth of relationship types, not the fence.
5. **`employee_reporting_relationships` has a `no_self` CHECK.** Cycle prevention, however, exists only in `src/utils/managerCycleValidation.ts` (client-side) — in scope for P1-03 AC2 and correctly assigned.
6. **`RequireModule` is honestly documented as presentation-only** (`src/shared/RequireModule.tsx:9-14`); the baseline's characterisation is accurate.
7. **`TenantContext` fail-open is deliberate and commented** (`src/contexts/TenantContext.tsx:187-190`, `:206`). It is a real defect against contract §12.7, and P1-01 AC4 correctly targets it; I confirm the lead's finding rather than adding one.

---

## SUGGESTIONS

- **S1 — Name the fail-closed transition's consumers.** P1-01 changes `hasModule` from fail-open to fail-closed with an `unavailableReason`. `src/hr/PolicyCenter.tsx:671`, `:1348` and `src/payroll/hr/RunPayroll.tsx:169` call `hasModule` and will silently take the new deny branch. Add "consumers of `hasModule` render the unavailable state, not an empty screen" to P3-01's acceptance criteria.
- **S2 — `useAuditLog` fetches `https://api.ipify.org` on every logged action** (`src/hooks/useAuditLog.ts:36-38`), disclosing each user's IP to a third party and adding a network hop to every audit write. Out of scope for Monday; worth a decision record.
- **S3 — Contract §3 lists `project:<id>` and `channel:<id>` as supported scopes, but `project_members` does not exist** (`baseline.md` §5 confirms; P3-02's migration creates it). §3 should note that `project:<id>` is unavailable until P3-02 lands, so P1-01's capability summary does not advertise a scope with no backing table.
- **S4 — Add a contract-version field to the body of `contracts.md`.** §14 requires accepted changes to receive a contract version; v0.1 appears only in the status line.
- **S5 — `AuthContext.isManager` counts `employees.manager_id` only** (`src/contexts/AuthContext.tsx:137-143`), while `is_manager_of()` accepts three sources. The UI's Team surface and the server's manager scope therefore disagree. P1-03 owns `useManagerView.tsx` but not `AuthContext.tsx` (P1-01 does); worth one line of coordination.

---

## Deadline feasibility — 2026-09-14 EOD IST

`tasks.md` §"Deadline assessment" is broadly honest. Two corrections and one recommendation.

**The lead's list is right about what is at risk.** W2 membership/invitation/revocation/ownership, cross-service revocation, realtime isolation, physical device evidence and schema reproducibility are all genuinely at risk.

**It understates two items, and both have the same magnitude.**

*The authorization rewrite* is not "absent foundation, therefore slow" — it is "present foundation with a large live fan-out, therefore dangerous". The live surface is ~68 policy bodies referencing `is_hr()` plus 26 `assert_hr_for_tenant` call sites, corroborated by the 2026-08-13 migration's own "63 existing policies" comment. A weekend rewrite of that surface is not credible, and a partial rewrite is worse than none, because it leaves two disagreeing gates.

*Revocation is arguably the larger of the two, and `tasks.md` gives it no magnitude at all.* Contract §8.1–§8.2 require an access version consulted on the next protected operation across database, RPC, function, storage **and** realtime. At the database layer that is the same ~68 policy bodies, since every one of them must AND in a freshness check — delivered from P1-02's single migration slot, alongside membership, invitation and ownership. Add the realtime layer, which has no policies at all today (C18, N1), and P1-02 AC7 ("revocation denies the old authenticated session on its next database/RPC/function/storage/realtime operation") is the single least likely acceptance criterion in the programme to be met by Monday.

**Genuine release blockers** — the candidate must not be labelled testable without these:

1. C2 — no test harness; nothing else can be evidenced.
2. C1 — non-employee administration writes nothing; the milestone's headline capability is cosmetic until this decision is made.
3. N1 — realtime payload isolation, verified by packet capture across two tenants.
4. N2 with C18 — private attachment access, plus storage policies existing in a migration so the test backend is reproducible.
5. `TB-M1M2` existing at all, and N8 credential rotation.

**Optional improvements, not blockers:** C16, C17, C19, C20 and every item under SUGGESTIONS.

**Realistic recommendation.** Take C5's corrective direction: keep `is_hr()` intact as the legacy gate and layer `access.manage` narrowly over `employee_roles` writes only. That is a small, reviewable migration that closes the self-escalation hole — the single highest-value security fix available this weekend — without touching 68 policies. Deliver named membership, invitation and revocation against that seam, and label the single-resolver work M2 Remaining explicitly. The alternative, pursuing contract §2.9's single authoritative writer by Monday, will either not land or will land unreviewed.

---

## Blockers, by category

**Contract blockers** — contract text must change before implementation:
C1 (non-employee admin vs. `assert_hr_for_tenant`), C3 (§5.7 two-phase transfer), C4 (§5.6 last-owner baseline), C6 (§2.9 single writer), C7 (§9 relationship types), C9 (§10.2 overlap), C20 (§9 approval routing and §10.5 reassignment of an approver that is never stored).

**Task / dependency blockers:**
C2 (no harness owner; `package.json` unowned), C10 (P1-01↔P1-02 circular), C11 (no-self-approval unowned), C12 (audit unowned), C13 (P1-01 AC5 outside its file list), C14 (empty reservation table), C17 (punch-out gate dual ownership), and N1's ownership half (`NotificationBell.tsx` and `notify_employee_notification` unowned). C21 is the same class but P2, not blocking.

**Security blockers:**
C5 (`employee_roles_hr_all` self-escalation), C18 (storage/realtime outside the drift gate and absent from migrations), N1 (realtime payload isolation), N2 (public buckets), N8 (credential rotation). Plus the environment blocker `baseline.md` §8 already records: no isolated write target exists.

**Evidence still required:**
N1 two-tenant socket capture; N2 anonymous bucket fetch per bucket; N3 disposition of the 32 untracked policies; N4 pre- and post-change onboarding smoke test; N5 both function-drift diffs with a recorded authoritative side; N6 `attendance_events` retention; N7 the five deployed-only function bodies; N8 rotation confirmation; and a named `TB-M1M2` project id with reproduced schema, functions, buckets, realtime and schedules.

---

## Verdict

**CHANGES REQUIRED**

The contracts are well-shaped and unusually candid; this is not a rejection of the approach. But **seven** contract clauses assert states the current schema forbids or the milestone will not reach (C1, C3, C4, C6, C7, C9, C20), and **eight** task-boundary defects would leave shared work unowned or unevidenceable (C2, C10, C11, C12, C13, C14, C17, plus the notification-realtime ownership gap). All fifteen are decidable from the artifacts alone and must be corrected in `contracts.md` and `tasks.md` before P1/P2/P3 implementation begins.

The absent isolated backend and the unverified runtime security properties are recorded above as security blockers and outstanding evidence. They are not the reason for this verdict — the contract and task defects are, and they are fixable this weekend without any backend access.

`tasks.md`'s existing gate decision — **HOLD P1/P2/P3 IMPLEMENTATION** — should stand until the contract blockers are addressed and re-reviewed.

Reviewer acceptance of a revised contract is not deployment authorization, and no finding in this review constitutes evidence that any runtime security property currently holds.
