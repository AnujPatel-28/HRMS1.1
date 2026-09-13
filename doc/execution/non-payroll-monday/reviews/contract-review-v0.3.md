# P6 CONTRACT RE-REVIEW — v0.3

Reviewer: independent senior engineer (Opus 5), CONTRACT mode
Date: 2026-09-12 IST
Under review: `contracts.md` v0.3, `tasks.md` v0.3
Reviewed against: `baseline.md`; `reviews/contract-review.md` (v0.1); `reviews/contract-review-v0.2.md` (v0.2); the five corrective changes that review required
Repository state inspected: `main` / `7214f8e3abeaef797d45122c7bc1129f0663cc43`

**VERDICT: CHANGES REQUIRED — IMPLEMENTATION REMAINS BLOCKED**

Nothing was implemented. No code, migration, backend, database, credential, user or deployment was created or modified. No runtime verification was performed.

---

## 0. Summary

v0.3 is a strong revision. Four of the five required corrections are fully and concretely made: the dependency cycle is broken with sole ownership stated and the ordering steps corrected; the wire shape has an unambiguous owner; the non-employee Company Admin now has an enumerated action row, a stated interaction with the four `is_hr()`-gated configuration tables, a bootstrap authority bound, and a falsifiable acceptance criterion; and the database-function reproducibility gap is closed with a migration-only rebuild as the bar.

The fifth correction — the template × action matrix — is where the revision falls short, and it falls short in a way that creates a new, decidable authorization contradiction. The matrix was written against the action vocabulary rather than against the workflows each package is required to pass. I verified five instances where an action a P2 or P3 acceptance criterion **requires to succeed** is absent from the template that must perform it, while §4 states every absent action is **denied** and P1-02 AC4 tests exactly that. Those acceptance criteria cannot both pass.

Two smaller but mechanical items also block: the migration reservation order was not updated when the P1-03/P2-01 dependency was reversed, and the database-function capture lacks the intended/stale classification step its policy counterpart has.

Three blockers, all P1, all editable without backend access. No P0.

---

## 1. Blockers

### B1 — The §4 matrix was not reconciled against the workflows each package must pass; five verified actions required by acceptance criteria are denied by the matrix
- **Severity: P1 — authorization contradiction with mutually exclusive acceptance criteria**
- **Object:** `contracts.md` §4 template × action matrix and the sentence "Every action absent from a template row is denied unless another assigned template independently grants it"; `tasks.md` P1-02 AC4 ("each action present in the §4 matrix is permitted only at its stated scope, **every absent action is denied**") against P3-02 AC1/AC2 and P2-02 AC2.
- **Verified instances** (existing M1 workflows, each exercised by committed source):

  | # | Action and scope the workflow needs | Matrix says | Evidence | AC that must pass |
  |---|---|---|---|---|
  | 1 | HR Admin `task.review` + `task.assign` at `company` | HR Admin row has **no** `task.*` or `project.*` | `src/hr/TaskManagement.tsx:199` (`approve_task_request`), `:232` (`reject_task_request`) — the HR task list, not a project screen | P3-02 AC1 (assignment, review), AC2 ("HR Admin … can review in scope") |
  | 2 | Manager `task.review` + `task.assign` at `direct_reports` | Manager row has **no** `task.*` | `src/employee/MyTasks.tsx:241,277` under `isManagerMode` with `directReportIds`; `:325-342` renders "Team Tasks — Delegate and review tasks for your team" | P3-02 AC1/AC4 |
  | 3 | Employee `task.submit` for a **non-project** task | Employee `task.submit` is granted only at `project:<id>` | `tasks.project_id` is nullable — `migrations/20260820090000_...:415` (`IF v_task.project_id IS NOT NULL`), `src/hr/TaskManagement.tsx:557` (`task.project_id ? …`); submit at `src/employee/MyTasks.tsx:172` | P3-02 AC1 |
  | 4 | Employee-initiated attendance correction request | Employee row has no `attendance.correct`, and the §4 vocabulary has no `attendance.correct_request` at all | `src/employee/PunchInOut.tsx:282, 906, 934` write `attendance_corrections` | P2-02 AC2 ("Missing OUT correction enters the supported correction flow") |
  | 5 | Manager leave approval affordance | Manager has `leave.read` only; §9 says leave approval is HR-only | `src/employee/MyLeaves.tsx:161` calls `approve_leave_request` from the employee surface | Contract is self-consistent here; see the note below |

- **Scenario:** P1-02 implements the matrix and AC4 passes — every absent action denied. P3-02 then runs and AC1/AC2 fail, because HR Admin and Manager hold no `task.*` grant and an employee holds `task.submit` only at project scope while most tasks have `project_id IS NULL`. P2-02 AC2 fails for the same reason on corrections. Conversely, if the implementer grants what the workflows need, P1-02 AC4 is no longer the criterion that was reviewed.
- **Impact:** This is the one thing the matrix existed to prevent — authorization behaviour left for an implementation agent to invent. Worse than v0.2's missing matrix, because an agent now has a document that is affirmatively wrong and a criterion (AC4) that rewards enforcing it. Instance 4 additionally reveals a vocabulary gap, not just a missing cell: there is no action for *requesting* a correction as distinct from *performing* one, so no cell can be added without extending §4's action list.
- **Note on instance 5, which is different in kind:** here the contract is internally consistent — §9 says HR-only, the matrix withholds `leave.approve` from Manager, and `approve_leave_request`'s `assert_hr_for_tenant` would reject a non-HR manager today. The defect is that `src/employee/MyLeaves.tsx` carries a live manager approval affordance that the contract says must not work; the file is in P2-04's allowed list but no acceptance criterion covers removing or gating it. Lower severity; listed for completeness.
- **This list is a lower bound.** I checked tasks, attendance corrections and leave. I did not sweep policy, expenses, offboarding, onboarding or the device surfaces. The finding is that the matrix was not derived from the workflows, not that these five are the complete set.
- **Minimal corrective direction:** Reconcile the matrix against the acceptance criteria each package must pass, and add the missing actions: HR Admin `task.assign`/`task.review` at `company`; Manager `task.assign`/`task.review` at `direct_reports`; Employee `task.submit` at `self` in addition to `project:<id>`; and a correction-request action in §4's vocabulary with an Employee `self` cell. Then state in §4 that the matrix is normative over the workflow surfaces named in the P2/P3 acceptance criteria, so a future mismatch is a contract change rather than an implementation choice.
- **Test required:** Already specified — P1-02 AC4 plus P3-02 AC1/AC2 and P2-02 AC2. Once the matrix is corrected these become consistent; no new test is needed, which is the point.

### B2 — The migration reservation order was not updated when the P1-03 / P2-01 dependency was reversed
- **Severity: P1**
- **Object:** `tasks.md` migration reservation table — `migrations/20260912182000_…` owned by P1-03, `migrations/20260912183000_…` owned by P2-01; against P1-03 Status/Dependencies ("BLOCKED on … **P2-01 tenant-date primitive**", "consumes the P2-01-owned tenant timezone/business-date primitive") and ordering steps 6 → 7 (P2-01 freezes the primitive, **then** P1-03 consumes it).
- **Scenario:** The corrected dependency makes P2-01 run **before** P1-03, but P2-01's reserved version (`183000`) sorts **after** P1-03's (`182000`). P1-03's migration is the one that must resolve dated organizational facts "for an explicit `asOf` in tenant time" (§10.1) — i.e. against P2-01's primitive. If P1-03's migration references that primitive at the SQL level, it is numbered below the migration that creates it.
- **Impact:** The reserved path for P1-03 will need renumbering above the then-current head mid-flight. That directly contradicts two statements in the same document: "These paths are reserved" and "Only the lead creates/applies migrations … Applied migrations are immutable." A reserved-path renumber is also the one migration-sequencing hazard this repository has already documented — see `migrations-pending-deploy/README.md`, which describes the strict-order constraint and the renumber-above-head procedure. I am citing that README as the source; I did not verify the CLI's behaviour directly, and the finding does not depend on it: needing to renumber a reserved path is itself a contract violation.
- **Minimal corrective direction:** Swap the two reservations — P2-01 takes `20260912182000`, P1-03 takes `20260912183000` — or state explicitly in P1-03's row that its migration must not reference the P2-01 primitive at the SQL level and consumes it only above the database.
- **Test required:** None; sequencing correction. The rebuild in P1-00 AC11 would surface it, but only after both files exist.

### B3 — The database-function capture has no intended/stale classification, unlike its policy counterpart, and the set is larger than the four named
- **Severity: P1**
- **Object:** `contracts.md` §14.2; `tasks.md` P1-00 AC11 against AC5.
- **The asymmetry, which is the finding.** AC5 requires that live-only **policies** be "classified intended/stale; only reviewed intended definitions enter the forward migration." AC11 requires that the four **functions** be "captured into `20260912179500`" and that their definitions "match `BASELINE-RO`" — a copy-forward with no classification step and no review gate. §14.2 mirrors this: policies get comparison, functions get capture.
- **Why that matters concretely.** Beyond the four named, at least four more database functions are granted in `migrations/` but created nowhere in it: `close_stale_attendance`, `exec_sql`, `query_json`, `update_user_password`. The last three are the SECURITY DEFINER SQL-execution and password-setting RPCs that `CLAUDE.md` §16 records as still callable by `project_admin`; `close_stale_attendance` is called directly from the browser (`src/employee/PunchInOut.tsx:703`). A copy-forward capture enshrines all of them into a permanent, immutable forward migration with no clause requiring anyone to decide whether they belong on `TB-M1M2` at all.
- **What v0.3 got right, and should keep.** AC11's rebuild condition — "a clean `TB-M1M2` rebuild from `migrations/` alone, with no root-level SQL, applies successfully" — is genuinely self-correcting: it fails until every missing definition is present, so the enumeration being incomplete cannot silently pass. That is good design and the count is supporting evidence, not the defect.
- **Evidence and its limits:** comparing GRANT/REVOKE targets against `CREATE … FUNCTION` names within `migrations/` yields the four above. This is a **lower bound on both sides**: `get_auth_tenant_id` and `can_access_tenant` do not appear in it at all, because they are referenced inside policy bodies rather than granted. The true set is at least eight and is discovered by the rebuild, not by enumeration.
- **Minimal corrective direction:** Give AC11 the same classification step as AC5 — each missing function body is classified intended/stale and only reviewed intended definitions enter `20260912179500` — and state that the set is whatever the migration-only rebuild requires, not a fixed list of four. Update §14.2 to say "comparison and classification", not "captured".
- **Test required:** The rebuild in AC11, plus a review record naming the disposition of each captured function, specifically `exec_sql`, `query_json` and `update_user_password`.

---

## 2. Verification of the five required corrections

### 2.1 P1-03 ↔ P2-01 dependency cycle — **RESOLVED**

- **Acyclic: yes.** Full graph, as stated in the artifacts: P1-00 (root) → P1-01 → {P1-02, P2-01}; P1-03 → {P1-00, P1-01, P1-02, P2-01}; P2-02 and P2-04 → {P1-00, P1-01, P1-03, P2-01}; P2-03 → {P1-00, P2-01, P2-02}; P3-01 → {P1-00, P1-01, P1-02}; P3-02 → {P1-00, P1-01, P1-02, P1-03, P2-01, P2-04}; P3-03 → {P1-00, P1-02} plus the P1-01 handoff. No cycle.
- **P2-01 sole owner: yes, explicitly.** P2-01 Dependencies: "P2-01 **exclusively defines** the tenant timezone/business-date primitive consumed by P1-03 and other lanes." Its Status no longer references P1-03.
- **P1-03 consumes without a new cycle: yes.** Dependencies: "consumes the P2-01-owned tenant timezone/business-date primitive **without redefining it**"; Status lists "P2-01 tenant-date primitive". P2-01 acquires no P1-03 edge.
- **Ordering corrected: yes.** Step 6 is P2-01 freezing the primitive "without depending on P1-03"; step 7 is P1-03 consuming it. Consistent with the dependency direction.
- One consequence was missed: the migration reservations were not reordered — **B2**.

### 2.2 Capability wire-shape ownership — **RESOLVED**

- **P1-01 authoritative: yes.** §6: "P1-01 freezes the concrete field names and serialization in its owned access type/contract". P1-01 Dependencies: "P1-01 owns and freezes the §6 concrete wire shape in `src/types/access.ts`". P1-01 owns that file exclusively.
- **P1-02 implements without redefining: yes.** §6 and P1-01's dependency line both state it; ordering step 4 repeats it; P1-01's Review requirements add "A later package changing the wire shape requires renewed contract review, not silent adaptation."
- **No task depends on an artifact no task produces:** the v0.2 defect is fixed — §14.1's P1-00 duty list no longer includes the wire shape, so P1-01's precondition is satisfiable. I swept the remaining dependency lines: "accepted template mapping" (P1-02) is now §4; "accepted calendar contract" (P2-01) is §11; "recorded precedence/synchronization for legacy manager fields" (P1-03) is §9's final bullet. One residual, non-blocking: P3-01 depends on "selected supported settings" and no task or contract clause enumerates which Policy Center settings are supported in M1, while P3-01 AC5 asserts "unsupported controls absent". P2 — narrow, not authorization-relevant, listed in §5 below.

### 2.3 Non-employee Company Admin — **RESOLVED**

- **Concrete actions and scopes: yes.** §2.4 enumerates access administration plus configuration on organization units, designations, locations/employment and reporting. §4's matrix gives the exact row at `company` scope: `membership.read`, `membership.invite`, `membership.revoke`, `membership.employee_associate`, `access.manage`, `org.read`, `org.manage`, `reporting.manage`, `designation.manage`.
- **Consistent across both provisioning paths: yes.** §2.4 states these writes "use the same narrow server capability path as other per-action grants and **never require or confer legacy `is_hr()`**". §2.11 binds the bootstrap principal to "Owner plus the exact Company Admin action row in §4". §2.5 closes the gap I raised as R2: "A Company Admin without an employee association receives the same association-required denial if it attempts an action outside its enumerated Company Admin row."
- **Bootstrap cannot grant legacy operational HR: stated.** §2.11: "bootstrap metadata must not make that principal satisfy legacy operational `is_hr()` or grant HR Admin actions." This is achievable against the verified mechanism — `get_auth_tenant_id()` reads `metadata->>'tenant_id'` while `is_hr()`'s metadata branch additionally requires `metadata->>'role' = 'hr'`, so tenant identity can be established without satisfying `is_hr()`.
- **Falsifiable: yes.** P1-02 AC13 tests both paths, both denied leave approval and every other HR Admin action, bootstrap metadata not satisfying `is_hr()`, and out-of-row actions producing a deterministic denial rather than a 500. §4's closing mapping paragraph names the four `is_hr()`-gated tables explicitly so the test has concrete targets.
- Two non-blocking ownership loose ends follow from this and are listed in §5: which reserved migration carries the new configuration-table policies, and who owns `employee_reporting_relationships` policy text given Company Admin holds `reporting.manage` while P1-03 owns that table's dated semantics.

### 2.4 Reproducibility / database functions — **PARTIALLY RESOLVED**

- **P1-00 now covers database functions: yes.** §14.2 covers policies in `public`/`storage`/`realtime` "**and database-function definitions**". The reservation table's purpose for `20260912179500` reads "policy and database-function baseline".
- **The four primitives explicitly covered: yes.** §14.2 and P1-00 AC11 both name `get_auth_tenant_id`, `can_access_tenant`, `is_superadmin`, `tenant_is_active`.
- **Reproducible only after a migration-only rebuild: yes.** §14.2: "`TB-M1M2` is not reproducible until a clean rebuild succeeds from `migrations/` alone, without root-level ad-hoc SQL, and those four bodies match the read-only baseline." AC11 restates it as a test.
- **Owned and in acceptance criteria: yes** — P1-00, AC11, with `20260912179500` in its allowed files.
- **Not resolved:** the classification step and the fixed-list framing — **B3**.

### 2.5 Template × action matrix — **PARTIALLY RESOLVED**

- **All six templates have explicit rows and scopes: yes.** Five scope columns; every template present.
- **Exclusions testable: yes.** "Every action absent from a template row is denied unless another assigned template independently grants it. Each populated cell is limited to its stated scope; no column or scope is inherited across rows." P1-02 AC4 tests both directions.
- **Agrees with the rest of `contracts.md` on Owner: yes.** "`owner.transfer` belongs only to the separately protected Owner authority in §5, not to any template", consistent with §4's prose and §5.1/§5.10.
- **Agrees on Manager and leave: yes.** The matrix withholds `leave.approve` from Manager, matching §9's "Leave approval remains HR-only unless a reviewed P2 change explicitly implements a manager approval action." This was a place v0.3 could easily have contradicted itself and did not.
- **Agrees on the M1/M2 boundary for project/channel scopes: yes.** §3 defers advertising `project:<id>`/`channel:<id>` until P3-02/P3-03; P1-01 AC3 omits them from the summary until then. Project Manager and Communication Moderator consequently grant nothing until P3 lands, which is coherent though unstated (R5, below).
- **Does not agree with the workflows the packages must pass — B1.** One further internal asymmetry worth a clause: the matrix grants Manager `attendance.approve` at `direct_reports`, a capability with no existing manager enforcement path (the only manager grant on `attendance` today is `attendance_select_manager`, SELECT only, `migrations/20260813183901_...:69-72`). §9 gave leave approval exactly the clause this needs — "HR-only unless a reviewed P2 change explicitly implements it" — and attendance approval got none, so whether manager attendance approval is an M1 deliverable is undecided. P2 severity, in §5.

---

## 3. Disposition of C1–C22 and R1–R6

| ID | Disposition in v0.3 | Basis |
|---|---|---|
| C1 | **RESOLVED** (was PARTIALLY) | §2.4 + §2.5 final sentence + §4 matrix row + mapping paragraph + P1-02 AC13. The RLS half I flagged in v0.2 is now enumerated and testable. |
| C2 | RESOLVED | Unchanged — P1-00 owns `package.json`, harness, target guard, fixtures; AC1 reviewer-observed mis-target denial. |
| C3 | RESOLVED | §5.10 unchanged; P1-02 AC9. |
| C4 | RESOLVED | §5.8/§5.9 unchanged; P1-02 AC10. |
| C5 | RESOLVED | §5.3/§5.4 unchanged; P1-02 AC3. |
| C6 | DEFERRED WITH ACCEPTABLE M1/M2 BOUNDARY | §2.10, §8.8; now reinforced by §2.11's bootstrap authority bound. |
| C7 | RESOLVED | §9 six types; P1-03 AC3 names all five non-primary. |
| C8 | PARTIALLY RESOLVED | P1-00 AC10 records the erratum in `reconciliation.md`. `baseline.md:167` still reads "constrain relationship type to `primary` or `secondary`". §15 states `baseline.md` was deliberately not edited. Acceptable mitigation; not a blocker. |
| C9 | RESOLVED | §10.2 boundary-day clause; P1-03 AC4. |
| C10 | RESOLVED | P1-01 no longer depends on P1-02; see 2.2. |
| C11 | RESOLVED | §7.1; P1-01 AC6 delivers, P2-02 AC5 / P2-04 AC2 / P3-02 AC3 consume the shared denial class. |
| C12 | RESOLVED | §5.5/§5.6; `useAuditLog.ts` owned by P1-02; AC8. |
| C13 | RESOLVED | Both payroll layouts owned by P1-01; §12.4 + AC5. |
| C14 | RESOLVED | Eleven reservations with owner and purpose. Ordering defect is B2, not completeness. |
| C15 | RESOLVED | P1-00 AC6 names both pending files exactly. |
| C16 | **REGRESSED in effect** | P3-02 AC2 still says "raw metadata is not the task-review authority" and requires HR Admin to review — but the §4 matrix grants HR Admin no `task.review`, so the fix now has no granting cell. This is the same defect as B1 instance 1; recorded here so the C16 resolution is not assumed to still hold. |
| C17 | RESOLVED | P2-02 "sole owner"; §12.6; P3-02 AC6 "may not change gate logic". |
| C18 | RESOLVED | P1-00 owns the drift script; AC4 three schemas; AC5 classification. |
| C19 | RESOLVED | §11.5; P2-04 AC5 round trip. |
| C20 | RESOLVED | §9 dynamic eligibility, no stored approver claimed; §10.5; P1-03 AC6. |
| C21 | RESOLVED | `NotificationBell.tsx` and `Directory.tsx` owned by P1-01; AC7. |
| C22 | RESOLVED | P1-03 AC1 HR-sounding designation denial. |
| R1 | RESOLVED | See 2.1. |
| R1b | RESOLVED | See 2.2. |
| R2 | RESOLVED | See 2.3. |
| R3 | PARTIALLY RESOLVED | See 2.4 and B3. |
| R4 | PARTIALLY RESOLVED | Matrix exists and is mostly self-consistent, but contradicts the workflows — B1. |
| R5 | NOT APPLIED — **acceptable** | The two P3-gated templates are not marked conditional in §4, but §3's deferral plus P1-01 AC3's omission rule make the behaviour unambiguous. No contract or security inconsistency. |
| R6 | NOT APPLIED — **acceptable** | `/hr/declarations` sits under the `/hr` layout's `RequireModule` and is mapped to payroll in `src/modules.ts:69`, so it is gated today; the `/employee/payslips` entry is dead code. No security inconsistency. |

**Tally:** 19 RESOLVED · 1 DEFERRED WITH ACCEPTABLE M1/M2 BOUNDARY · 4 PARTIALLY RESOLVED (C8, R3, R4, plus C16's dependency on B1) · 2 NOT APPLIED and confirmed harmless · 0 NOT RESOLVED.

---

## 4. Other checks requested

| Area | Result |
|---|---|
| Task dependency graph | **Acyclic** — verified edge by edge in 2.1. |
| Shared-file ownership | **Clean.** Five files appear in two tasks, each marked sequential handoff and each consistent with the run order: `App.tsx` and `HRLayout.tsx` (P1-01→P1-02), `AuthContext.tsx` (P1-01→P1-03), `NotificationBell.tsx` (P1-01→P3-03), the four captured auth functions (P1-00→P1-02). P2-01 touches none of the handed-off files, so inserting it between P1-02 and P1-03 introduces no conflict. |
| Migration reservation ownership | Eleven versions, one owner each, each cited in its task's allowed files, no collision with `migrations/` (head `20260904120000`) or `migrations-pending-deploy/`. **Ordering defect: B2.** Two ownership purposes are under-specified — see §5. |
| M1/M2 boundaries | **Explicit and internally consistent.** Deferred with a specific clause: general non-employee operational actors (§2.5), metadata retirement and single resolver (§2.10, §8.8), stored approver assignment (§9, §10.5), legacy `manager_id` retirement (§9), ledger migration (§11.6), custom roles and arbitrary scopes (§3.6). |
| Acceptance-test completeness | Every task has acceptance tests. The gap is not coverage but **consistency** — B1. |
| Authorization contradictions | **One, B1.** |
| Tenant isolation | Contract layer sound (§1, §3.4, §3.5, §10.8). The reproducibility of its primitives is B3's subject. |
| Bootstrap authority | **Bounded** — §2.11 plus P1-02 AC13; the bound is achievable against the verified `is_hr()` / `get_auth_tenant_id()` mechanism. |
| Scope semantics | Sound. §3 five scopes, §3.1 no cross-action widening, §3.3 primary-only `direct_reports`, §4 "no column or scope is inherited across rows". |
| No-self-approval | Sound and single-owned — §7, P1-01 AC6, three consumers. |
| Audit ownership | Sound — §5.5/§5.6, P1-02 owns `useAuditLog.ts`, AC8. |
| Payroll / Insurance exclusions | Sound — §12.4/§12.5, both payroll layouts owned by P1-01, P1-01 AC5. |
| Dated reporting semantics | Sound — §9, §10.1–§10.8, P1-03 AC3/AC4/AC5/AC6. |
| Backend reproducibility | Correct bar (migration-only rebuild), incomplete process — B3. |

---

## 5. Optional improvements — not blockers

1. **Name the owner of the new configuration-table policies.** P1-02 AC13 requires Company Admin writes on `org_units`, `job_titles`, `locations` and `employment_types`, which needs new policies alongside the existing `*_hr_all` ones (`migrations/20260813070000_close-anon-sql-and-rls-gaps.sql:47-89`). Reservation `20260912181000`'s purpose reads "Membership, grants, invite, audit and owner lifecycle" and does not mention them, so an authorization-critical change would look out of scope to a PACKAGE reviewer. One phrase in the purpose column.
2. **Name a single owner for `employee_reporting_relationships` policy text.** Company Admin holds `reporting.manage:company` (P1-02, migration `181000`) while P1-03 owns that table's dated semantics (migration `182000`). Two migrations, one object — the C17 pattern at smaller scale.
3. **Give Manager `attendance.approve` a §9-style clause** stating whether manager attendance approval is an M1 deliverable or deferred, as was done for leave.
4. **Enumerate the supported Policy Center settings** somewhere, or restate P3-01 AC5 against something that exists.
5. **Add an acceptance criterion covering the manager leave-approval affordance** in `src/employee/MyLeaves.tsx:161` (B1 instance 5), which §9 says must not work.
6. **Refresh §15.** It is still headed "P6 v0.1 finding dispositions" with a "v0.2 disposition" column and carries no R1–R6 rows. Documentation only — I dispositioned against the artifacts, not against this table.
7. **Consider extending the drift script to database functions,** so future function drift is detected rather than only the one-time capture in AC11.

---

## 6. Runtime NEEDS VERIFICATION — carried forward, unchanged

No runtime verification was performed in this review, and nothing below is asserted as failing or passing. v0.3 correctly preserves each as a gate rather than claiming resolution.

| Item | Gate that must satisfy it |
|---|---|
| N1 — realtime cross-tenant payload delivery (global `chat_messages`/`chat_channels` topics; `'chat:' \|\| channel` name collision; `notifications:<employee_id>`) | P3-03 AC2, AC3, AC4 — raw socket capture across two tenants sharing a channel name |
| N2 — bucket publicity and anonymous attachment access | P3-01 AC3; P3-03 AC5 |
| N3 — disposition of the 32 live-only public policies | P1-00 AC5 |
| N4 — the four uncommitted limiter edits | P1-02 AC12, before and after |
| N5 — `check-punch-out-gate` and `on-leave-reviewed` drift | P1-00 AC8 |
| N6 — whether `attendance_events` retains punches | P2-04 dependency; P2-04 AC5 |
| N7 — the five deployed-only function bodies | P1-00 AC7 |
| N8 — credential rotation | P1-00 AC3, AC9 |
| New — migration-only rebuild of `TB-M1M2` | P1-00 AC11 |
| New — revocation freshness on every enabled surface | §8.3; P1-02 AC7; any unproven surface must be disabled and labelled incomplete |

---

## 7. Minimum corrective changes for the next revision

Three edits, all to `contracts.md` / `tasks.md`, none requiring backend access:

1. **B1** — Reconcile the §4 matrix with the workflows the P2/P3 acceptance criteria must pass. Concretely: add HR Admin `task.assign`/`task.review` at `company`; Manager `task.assign`/`task.review` at `direct_reports`; Employee `task.submit` at `self` as well as `project:<id>`; add a correction-request action to §4's vocabulary with an Employee `self` cell. Then state that the matrix is normative over those surfaces, so a future mismatch is a contract change rather than an implementation choice.
2. **B2** — Swap the P1-03 and P2-01 migration reservations (P2-01 → `20260912182000`, P1-03 → `20260912183000`), or state in P1-03's row that its migration must not reference the P2-01 primitive at the SQL level.
3. **B3** — Give P1-00 AC11 the intended/stale classification step AC5 has, and state that the captured set is whatever the migration-only rebuild requires rather than a fixed list of four. Record a disposition for `exec_sql`, `query_json` and `update_user_password` specifically. Update §14.2 from "captured" to "compared and classified".

The seven items in §5 are optional and may be deferred without re-review.

---

## 8. Scope of this review

**Reviewed statically:** `contracts.md` v0.3 §1–§15 in full; `tasks.md` v0.3 in full — all eleven task blocks, execution controls, the reservation table, the ordering section and the deadline assessment; the dependency graph edge by edge; shared-file ownership and handoff order; the five required corrections individually; and every C/R disposition checked against the artifact that is supposed to discharge it rather than against §15's self-report.

**Verified against the repository** (static source inspection only): migration collision for all eleven reserved versions; GRANT-only database functions in `migrations/`; `baseline.md:167`; the `*_hr_all` policy bodies on the four configuration tables; `is_hr()` and `get_auth_tenant_id()` mechanics; `tasks.project_id` nullability; the HR, manager-mode and employee task call sites; the employee attendance-correction writes; the two leave-approval surfaces; `attendance_select_manager`'s SELECT-only grant; `src/modules.ts` route mappings.

**Not reviewed:** any runtime behaviour. No backend was contacted. Source inspection here establishes what the artifacts and committed code say, not that any runtime security property currently holds. The v0.1 NEEDS VERIFICATION items remain unverified by me and are carried forward in §6.

---

## Verdict

**CHANGES REQUIRED — IMPLEMENTATION REMAINS BLOCKED**

v0.3 resolves nineteen of the twenty-eight tracked findings outright, defers one on an acceptable and explicitly stated M1/M2 boundary, and fully delivers four of the five corrections the v0.2 review required. The dependency cycle, the wire-shape ownership and the non-employee Company Admin — the three substantive blockers from the last pass — are properly closed, and the Company Admin work in particular is precise, enumerated and falsifiable. This is close.

It cannot be accepted because the fifth correction introduced an authorization contradiction rather than removing one. The §4 matrix denies five actions that P2-02 and P3-02 acceptance criteria require to succeed, and P1-02 AC4 rewards enforcing the denial, so those criteria are mutually exclusive (**B1**); the migration reservations still assume the dependency order that v0.3 reversed, so a reserved path will need a mid-flight renumber the same document forbids (**B2**); and the database-function capture lacks the classification gate its policy counterpart has, which would copy `exec_sql`, `query_json` and `update_user_password` forward into an immutable migration unreviewed (**B3**).

All three are decidable from the artifacts and the committed source, and all three are editable without backend access. The existing gate — **HOLD P1/P2/P3 IMPLEMENTATION** — should stand until they are made and re-reviewed.

Reviewer acceptance of a future revision is not deployment authorization, and nothing in this review is evidence that any runtime security property currently holds.
