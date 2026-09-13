# P6 CONTRACT RE-REVIEW — v0.2

Reviewer: independent senior engineer (Opus 5), CONTRACT mode
Date: 2026-09-12 IST
Under review: `contracts.md` v0.2, `tasks.md` v0.2
Against: `reviews/contract-review.md` (P6 v0.1 CONTRACT review)
Repository state inspected: same working tree, `main` / `7214f8e3abeaef797d45122c7bc1129f0663cc43`

**VERDICT: CHANGES REQUIRED — IMPLEMENTATION REMAINS BLOCKED**

Nothing was implemented. No code, migration, backend, database, credential or deployment was modified.

---

## 0. Numbering note

The v0.1 review issued findings **C1–C22**, not C1–C20: C20 (approval routing / stored approver) and C21 (composed-session role branching) were added late, and the designation finding moved to C22. This re-review dispositions all twenty-two. Where the request says "C1–C20", rows C20–C22 below are the three that shifted.

## 1. Overall assessment

v0.2 is a substantial and largely honest revision. Sixteen of twenty-two findings are genuinely resolved with a concrete contract clause, a named owner, a file, and a testable acceptance criterion — not intent. The M1/M2 boundary is now stated in most places it needed to be, the migration reservation table is populated and collision-free, P1-00 exists and owns most of what it must, and the deadline section carries the magnitudes it previously lacked.

Four things block. One is mechanical and decisive: **P1-03 and P2-01 are blocked on each other**, so the dependency graph is not acyclic and two tasks cannot start. The other three are places where v0.2's own compatibility decisions create obligations the artifacts do not discharge.

---

## 2. Disposition of P6 v0.1 findings C1–C22

| ID | Subject | Disposition | Basis |
|---|---|---|---|
| C1 | Non-employee admin vs. `assert_hr_for_tenant` | **PARTIALLY RESOLVED** | §2.5 + P1-02 AC2 correctly cover the RPC half (association-required denial, no 500, no fake employee). The RLS half is not covered — see **R2**. |
| C2 | No test-harness owner | **RESOLVED** | P1-00 created; owns `package.json`, `_harness.mjs`, `_target.mjs`, `fixtures/seed.mjs`, `fixtures/reset.mjs`; AC1 is the deliberate mis-target denial, observed by a reviewer. |
| C3 | §5.7 two-phase owner transfer vs. unique index | **RESOLVED** | §5.10 replaces the second owner row with a pending-transfer artifact; "exactly one active owner at every committed read"; P1-02 AC9 tests intermediate state, abandon and replay. |
| C4 | §5.6 last-owner invariant with no baseline | **RESOLVED** | §5.8 restated as at-most-one; ownerless is an explicit provisioning defect; §5.9 forbids silent backfill from title or HR metadata; P1-02 AC10 requires an ownerless fixture. |
| C5 | `employee_roles_hr_all` self-escalation | **RESOLVED** | §5.3/§5.4 keep `is_hr()` intact and add a narrower predicate for `employee_roles`/membership writes; §5.3 explicitly forbids the partial 68-policy rewrite; P1-02 AC3 tests both halves. |
| C6 | §2.9 single writer vs. load-bearing metadata branch | **DEFERRED WITH ACCEPTABLE M1/M2 BOUNDARY** | §2.10 names metadata as the bootstrap writer, membership as the writer for subsequent grants, and defers convergence to M2 Remaining. §8.8 repeats it without waiving revocation. Caveat at **R3**. |
| C7 | Six relationship types vs. two-type contract | **RESOLVED** | §9 enumerates all six; only `primary` yields `direct_reports`; P1-03 AC3 names `secondary`, `mentor`, `project_manager`, `reviewer`, `temporary` individually. |
| C8 | `baseline.md` §5 erratum | **PARTIALLY RESOLVED** | P1-00 AC10 records the erratum in `reconciliation.md` — a reasonable mitigation. But `baseline.md:167` still reads "constrain relationship type to `primary` or `secondary`", and `baseline.md` is the artifact lanes are told to trust. Not a blocker. |
| C9 | §10.2 overlap not enforced by the index | **RESOLVED** | §10.2 restated as "no two active primary relationships may overlap on any date" with the boundary case named; P1-03 AC4 tests `outgoing.effective_to=D` / `incoming.effective_from=D`. |
| C10 | P1-01 ↔ P1-02 circular dependency | **RESOLVED** | P1-01 dependencies now state "It does not depend on P1-02 inventing an interface; P1-02 must implement the frozen shape." A *different* cycle exists — see **R1**. |
| C11 | No-self-approval unowned across three lanes | **RESOLVED** | §7.1 one P1-owned predicate and common denial class; delivered by P1-01 AC6; consumed by P2-02 AC5, P2-04 AC2, P3-02 AC3, each naming "the shared denial class". |
| C12 | Client-authored, forgeable audit | **RESOLVED** | §5.5 names `useAuditLog` as insufficient and denies client `access.*` inserts; `src/hooks/useAuditLog.ts` added to P1-02's files; AC8 requires exactly one server-written row. §5.6 handles the ipify decision. |
| C13 | P1-01 AC5 unachievable in its file list | **RESOLVED** | `src/payroll/PayrollLayout.tsx` and `src/payroll/employee/EmployeePayrollLayout.tsx` added to P1-01; §12.4 and AC5 name all four direct routes plus corresponding APIs/jobs. Minor gap at **R6**. |
| C14 | Empty migration reservation table | **RESOLVED** | Eleven rows with version, owner and purpose; verified complete and collision-free in §4 below. |
| C15 | `migrations-pending-deploy/` absent from reconciliation | **RESOLVED** | P1-00 AC6 names `20260812140000`, both pending files by exact filename, and the untracked-applied `20260904120000`, each requiring an apply/defer/supersede/immutable decision. |
| C16 | `approve_task_request` metadata-only authority | **RESOLVED** | P3-02 AC2: "raw metadata is not the task-review authority"; employee-associated HR Admin via the legacy-compatible seam and explicit Project Manager both tested in and out of scope. |
| C17 | Punch-out gate owned by two lanes | **RESOLVED** | P2-02 titled "exclusive punch-out gate ownership", "sole owner"; §12.6 and P3-02 AC6 restrict P3 to consumer regression; ordering step 7 repeats it. |
| C18 | Drift gate covers only `public` | **RESOLVED** | P1-00 owns `scripts/check-policy-drift.mjs`; AC4 covers `public`, `storage`, `realtime`; AC5 requires classification of all 32 public live-only policies plus storage/realtime policies before the forward migration. Scope hole at **R4**. |
| C19 | Backdated leave nulls `punch_in` | **RESOLVED** | §11.5 forbids nulling evidence columns including punch timestamps and requires reversibility; P2-04 AC5 is the punch-then-backdate-then-cancel round trip; P2-04 dependencies carry the N6 `attendance_events` verification. |
| C20 | §9 manager approval routing / fictional stored reassignment | **RESOLVED** | §9 states leave approval remains HR-only absent a reviewed P2 change, that eligibility is dynamic, and that no stored approver or reassignment is claimed; §10.5 and P1-03 AC6 test the blocked state instead. Residual at **R5**. |
| C21 | Composed-session role branching in unowned files | **RESOLVED** | `src/shared/NotificationBell.tsx` and `src/hr/Directory.tsx` added to P1-01; AC7 tests deep-link correctness in a composed session. |
| C22 | Designation confers no authority — untested | **RESOLVED** | P1-03 AC1: "an HR-sounding designation cannot perform an HR action". |

**Tally:** 16 RESOLVED · 1 DEFERRED WITH ACCEPTABLE M1/M2 BOUNDARY (C6) · 3 PARTIALLY RESOLVED (C1, C8, plus C18's scope hole) · 0 NOT RESOLVED · 2 resolved-but-with-a-named-residual (C13, C20).

No previously accepted finding regressed.

---

## 3. Structural verifications requested

### 3.1 Does P1-00 own all required prerequisites? — **NO, one gap**

Owned and adequate: guarded harness and mis-target denial (AC1), synthetic fixtures and reset (AC2), secret hygiene (AC3), three-schema drift (AC4), 32-policy + storage/realtime classification (AC5), migration reconciliation naming both pending files (AC6), deployed-only function capture (AC7), the two function drifts with an authoritative side (AC8), rotation evidence without values (AC9), the C8 erratum (AC10). The entrypoint-extension caveat in its dependencies is a good catch by the lead.

**Gap 1 — database functions are outside the reproducibility scope.** See **R4**. AC4/AC5 cover *policies*; AC7 covers *edge functions*. Nothing covers *database* functions, and four of them are the tenant-isolation primitives.

**Gap 2 — the §6 wire-shape freeze has no file and no AC.** See **R1b**.

### 3.2 Are task dependencies acyclic? — **NO**

**P1-03 ↔ P2-01 is a cycle.** See **R1**. Every other edge is acyclic: P1-00 → P1-01 → P1-02 → P1-03 → {P2-01} → {P2-02, P2-04} → P2-03; P3-01 → P3-02 → P3-03, all rooted at P1-00/P1-01/P1-02. Shared-file handoffs (`App.tsx`, `HRLayout.tsx` P1-01→P1-02; `AuthContext.tsx` P1-01→P1-03; `NotificationBell.tsx` P1-01→P3-03; the four auth functions P1-00→P1-02) are each marked sequential and are consistent with the ordering section.

### 3.3 Does every task have owner, model, file scope, backend target, acceptance tests, review requirement? — **YES**

All eleven tasks (P1-00…P1-03, P2-01…P2-04, P3-01…P3-03) carry all six fields. Verified individually.

### 3.4 Are the 11 migration reservations complete and non-conflicting? — **YES**

Eleven rows: `20260912179500`, `180000`, `181000`, `182000`, `183000`, `184000`, `185000`, `186000`, `187000`, `188000`, `189000`. Each maps to exactly one owning task, and every task's allowed-file list cites the version the table assigns it. I checked each against `migrations/` — **no collision**; the local head is `20260904120000`. All eleven sort above the head. `20260912179500` correctly sorts below `180000`, giving P1-00 the reproducibility baseline before the capability seam. P2-03's is properly conditional.

One sequencing note, not a defect: both `migrations-pending-deploy/` files (`20260902120000`, `20260902130000`) sort **below** all eleven. Per `migrations-pending-deploy/README.md` the CLI applies strictly in order and refuses to skip, so if P1-00 AC6 decides "apply", the file must be renumbered above the then-current head. The reservation paragraph's instruction to recheck `migrations-pending-deploy/` immediately before each file creation covers this adequately.

### 3.5 Is the M1/M2 boundary explicit and internally consistent? — **Explicit; one inconsistency**

Explicitly deferred to M2 Remaining, each in a specific clause: general non-employee operational actors (§2.5), metadata-branch retirement and single resolver (§2.10, §8.8), stored approver assignment and reassignment (§9), legacy `manager_id` retirement (§9), substantial ledger migration (§11.6), custom roles and arbitrary org scopes (§3.6). §15 maps every v0.1 finding to a disposition. This is good work.

The inconsistency is **R2**: §2.5's association-required boundary is drawn around RPC-mediated workflows only, while the same M1 compatibility decision leaves RLS-mediated configuration tables on the other side of a line the contract never draws.

---

## 4. New findings

### R1 — P1-03 and P2-01 are blocked on each other; the graph is not acyclic
- **Severity: P0 (blocks two tasks from starting)**
- **Object:** `tasks.md` P1-03 Dependencies ("P2-01 tenant-date interface definition"); P2-01 Status ("BLOCKED on P1-00, **P1-03 interface** and `TB-M1M2`") and P2-01 Dependencies ("**P1-03 dated semantics**").
- **Scenario:** P1-03 cannot begin until P2-01 defines tenant-date semantics; P2-01 cannot begin until P1-03 defines dated semantics. Ordering step 6 says "P1-03 freezes…" and step 7 says "P2-01 freezes calendar", implying P1-03 first — which directly contradicts P1-03's own dependency line.
- **Impact:** The P1 lane stalls at P1-03, and every P2 task plus P3-02 transitively stalls behind P2-01. This is the same defect class as v0.1 C10, in a different pair. It was present in v0.1 and **not raised in that review** — it is newly identified here, not a regression.
- **Evidence:** the three dependency/status lines as cited.
- **Minimal corrective direction:** Assign tenant-date semantics (timezone, business date) to exactly one task. P2-01 is the natural owner — it already owns the calendar resolver migration — in which case P1-03's dependency becomes "consumes P2-01's tenant-date primitive" and P2-01 drops its P1-03 dependency, or P1-03 runs first with tenant-date as an input it defines. Either resolution is one edit; leaving both edges is not.
- **Test required:** None; sequencing correction.

### R1b — Contract §6 assigns the wire-shape freeze to P1-00; `tasks.md` assigns it to P1-01
- **Severity: P2**
- **Object:** `contracts.md` §6 ("**P1-00** freezes the concrete field names/serialization before P1-01 or P1-02 begins"); `tasks.md` ordering step 4 ("**P1-01** freezes/implements the capability seam"); P1-01 owns `src/types/access.ts`; P1-01 Dependencies cite "frozen §6 v0.2 wire shape" as a precondition.
- **Scenario:** P1-00 has no file in which a wire shape could be frozen and no acceptance criterion covering it (AC1–AC10 are harness, hygiene, drift and reconciliation). So P1-01's stated precondition is unsatisfiable as written, and P1-01 will freeze the shape itself — which is what `tasks.md` says and what its file list supports.
- **Impact:** Low in practice, but it is the exact defect v0.1 C10 was about: a task depending on an artifact no task produces. Left as-is, P1-01's "blocked on a frozen shape" reads as satisfied by nothing.
- **Minimal corrective direction:** One line — change §6 to "P1-01 freezes the concrete field names/serialization; P1-02 implements it and may not redefine it", matching `tasks.md`. (Or give P1-00 a file and an AC for it; the former is simpler and consistent with P1-01 owning `src/types/access.ts`.)

### R2 — The association-required boundary covers RPC workflows but not RLS-gated configuration; Company Admin's authority is undefined in both provisioning paths
- **Severity: P1**
- **Object:** `contracts.md` §2.5 (association-required list excludes Company Admin), §4 (Company Admin = "Company configuration", exclusion "no operational HR approval"), §2.10/§2.11 (metadata bootstrap); `public.is_hr()` metadata branch — `migrations/20260813190500_explicit-roles-and-scopes.sql:118-126`; `public.get_auth_tenant_id()` — `insforge-enterprise-01-core.sql:77-87`; policies `org_units_hr_all`, `job_titles_hr_all`, `locations_hr_all`, `employment_types_hr_all` — `migrations/20260813070000_close-anon-sql-and-rls-gaps.sql:47-89`.
- **Verified facts:** Every company-configuration table is `FOR ALL TO authenticated USING (can_access_tenant(tenant_id) AND is_hr())`. `get_auth_tenant_id()` reads `auth.users.metadata->>'tenant_id'` and **requires no `employees` row**. Therefore `is_hr()`'s metadata branch resolves fully for a non-employee. `assert_hr_for_tenant`, by contrast, requires `is_hr()` **and** an active `employees` row.
- **Scenario — the two paths diverge, and neither matches the contract:**
  - A non-employee Company Admin provisioned through the **new membership model** is not `is_hr()`. Every write to `org_units`, `job_titles`, `locations`, `employment_types` is denied by RLS. §2.5 defines association-required denial for HR Admin, Manager, Employee, Project Manager and Communication Moderator — **Company Admin is deliberately excluded from that list**, so this denial has no defined user-facing behaviour. "Company configuration" is the template's stated purpose and it cannot perform it.
  - A non-employee Company Admin provisioned through the **metadata bootstrap** (§2.10/§2.11) *does* satisfy `is_hr()` and therefore obtains the full legacy operational-HR surface across ~68 policy bodies — which §4 explicitly excludes for this template. §2.11 says the bootstrap path is "narrow"; that describes the path, not the authority it confers, and no acceptance criterion bounds the resulting authority.
- **Impact:** The headline M1 capability is underdetermined in exactly the way v0.1 C1 warned about, one layer down. P1-02 AC1 ("Named non-employee Owner/Company Admin works without an employee row") can be reported as passing by whichever path the implementer chooses, with opposite security outcomes.
- **Minimal corrective direction:** Two sentences. (a) §2.5 or §4 must state which concrete actions a non-employee Company Admin holds in M1 and what happens on the `is_hr()`-gated configuration tables — either Company Admin joins the association-required list for those actions, or the configuration tables get the same narrow access-management predicate as `employee_roles`. (b) §2.11 must bound the bootstrap principal's authority, not only the path, with a P1-02 acceptance criterion.
- **Test required:** A non-employee Company Admin created through each provisioning path attempts `org_units` / `job_titles` / `locations` / `employment_types` writes and a leave approval; all four outcomes are the documented ones, and the bootstrap path does not confer operational HR authority.

### R3 — Reproducibility excludes database functions, and the four tenant-isolation primitives are outside migration control
- **Severity: P1**
- **Object:** `tasks.md` P1-00 AC4/AC5 (policies) and AC7 (edge functions); `contracts.md` §14.2 ("Drift comparison covers `public`, `storage` and `realtime`" — policies only).
- **Verified facts, with the search scope stated:** I grepped `--include=*.sql` across the whole repository, not only `migrations/`.
  - `public.get_auth_tenant_id()` and `public.can_access_tenant(uuid)` have **no `CREATE` in any of the 110 files in `migrations/`**. They are referenced **204** and **93** times respectively, across **62** migration files.
  - `public.is_superadmin()` and `public.tenant_is_active(uuid)` are likewise never created in `migrations/` — they appear there only in `GRANT`/`REVOKE` statements (`migrations/20260817100000_...:77,86`; `20260817130000_...:103-104,123-124`).
  - All four are defined only in root-level ad-hoc files outside migration control: `insforge-enterprise-01-core.sql:77,90,104` and `insforge-superadmin-setup.sql:99,114`. I compared the duplicate definitions — they are **identical**, so there is no conflicting-definition problem, only an uncontrolled-source one.
- **Impact:** A `TB-M1M2` rebuilt from `migrations/` alone fails at the first `GRANT EXECUTE ON FUNCTION public.is_superadmin()` — the function does not exist. If instead the environment is seeded by running the root-level files first, that step is in no task's scope and under no drift gate, so the test backend's tenant-isolation semantics are established by an unreviewed artifact. Worse for the review: **P1-00 AC4 ("check-policy-drift passes on reproduced `TB-M1M2` state") can pass while these definitions differ**, because the drift checker compares `pg_policies`, not `pg_proc`. Every downstream negative test — cross-tenant denial in particular — then runs against isolation primitives nobody verified match production.
- **Minimal corrective direction:** Extend P1-00's reproducibility scope from policies + edge functions to **database functions**, and add an acceptance criterion naming `get_auth_tenant_id`, `can_access_tenant`, `is_superadmin` and `tenant_is_active` specifically: their live definitions are captured into the `20260912179500` reproducibility baseline, and `TB-M1M2` is not declared reproducible until a rebuild from `migrations/` alone succeeds. Extend §14.2 correspondingly.
- **Test required:** Rebuild `TB-M1M2` from `migrations/` only, with no root-level SQL, and confirm it applies clean; then diff the four function bodies against `BASELINE-RO`.

### R4 — No template carries an enumerated action set, so P1-02 AC4 has nothing to test against
- **Severity: P1**
- **Object:** `contracts.md` §4 (the six-row template table gives Required intent / Default scope / employee requirement and exclusions, and separately a flat list of ~40 "minimum distinct actions"); `tasks.md` P1-02 AC4 ("Fixed templates grant only documented action/scope").
- **Scenario:** §4 never maps templates to actions. Does Company Admin hold `org.manage`? `policy.configure`? `shift.manage`? Does Manager hold `leave.approve` — which §9 says is HR-only in M1? Does HR Admin hold `attendance.correct` and `employee.sensitive.read`, or only the former? The table answers none of these; it gives intent prose and exclusions. P1-02 will therefore invent the matrix, and the P6 PACKAGE reviewer will have no document to check it against — which is precisely the failure mode the contract-freeze step exists to prevent.
- **Impact:** The fixed-template model is the core of the M1 authorization story. AC4 is currently unfalsifiable. This was present in v0.1 and **not raised in that review** — newly identified, not a regression.
- **Minimal corrective direction:** Add a template × action matrix to §4 — six rows, the actions already listed, a scope per cell, blanks where the template has none. It is a table, not a redesign, and it makes AC4 testable as written.
- **Test required:** For each template, every action **not** in its row is denied, and every action in its row is permitted only at its stated scope.

### R5 — Two of six templates are scope-gated on packages that run after the task that provisions them
- **Severity: P3**
- **Object:** §3 (`project:<id>` unavailable until P3-02; `channel:<id>` unavailable until P3-03); §4 (Project Manager default scope `project:<id>`; Communication Moderator default scope `channel:<id>`); P1-02 AC4; P1-01 AC3.
- **Scenario:** P1-02 provisions all six templates. The only scopes Project Manager and Communication Moderator carry are, by §3, not to be advertised until P3-02 and P3-03 pass — both of which run after P1-02. P1-01 AC3 ("capability summaries omit project/channel scopes until their backing packages pass") handles the *presentation* correctly, so these two templates simply grant nothing until P3 lands.
- **Impact:** Low and already largely mitigated. Worth one clause so a reviewer does not read an empty Project Manager template as a P1-02 defect.
- **Minimal corrective direction:** Mark both rows in §4 as conditionally available pending P3-02 / P3-03.

### R6 — `/hr/declarations` and the stale `/employee/payslips` mapping are outside the named exclusion set
- **Severity: P3**
- **Object:** §12.4 and P1-01 AC5 name four routes; `src/modules.ts:68` maps `/employee/payslips` → payroll, but `src/App.tsx` has no such route (the real one is `/payroll/employee/payslips`); `src/modules.ts:69` maps `/hr/declarations` → payroll.
- **Assessment:** Not a security gap. `/hr/declarations` sits under the `/hr` layout, which is wrapped in `RequireModule`, so it is gated today. The `/employee/payslips` entry is simply dead. `src/modules.ts` is already in P1-01's allowed files.
- **Minimal corrective direction:** Add `/hr/declarations` to the AC5 list and delete the dead mapping while P1-01 is in that file.

---

## 5. The attention list

| Item | Status |
|---|---|
| Non-employee Owner / Company Admin | **Partially addressed** — RPC half resolved (C1, §2.5, P1-02 AC2); RLS-gated configuration half undefined for both provisioning paths (**R2**) |
| `access.manage` vs. legacy `is_hr()` | **Resolved** — §5.3/§5.4, P1-02 AC3; the 68-policy rewrite is explicitly forbidden |
| Owner transfer | **Resolved** — §5.10 pending artifact + atomic swap; P1-02 AC9 covers intermediate state, abandon, replay |
| Ownerless tenants | **Resolved** — §5.8/§5.9; P1-02 AC10 requires an ownerless fixture and a protected repair path |
| All six relationship types | **Resolved** — §9; P1-03 AC3 names each non-primary type individually |
| Dated primary overlap | **Resolved** — §10.2; P1-03 AC4 tests the boundary day D |
| No-self-approval | **Resolved** — §7.1 single P1-owned predicate; consumed by P2-02/P2-04/P3-02 with a shared denial class |
| Server-side auditing | **Resolved** — §5.5/§5.6; `useAuditLog.ts` owned by P1-02; AC8 denies client `access.*` inserts |
| Payroll / Insurance direct routes | **Resolved** — both payroll layouts owned by P1-01; §12.4 + AC5; minor completeness at **R6** |
| Backdated leave evidence preservation | **Resolved** — §11.5; P2-04 AC5 round trip; N6 carried as a P2-04 dependency |
| Harness / backend-target guard | **Resolved** — P1-00 AC1, reviewer-observed mis-target denial; `_target.mjs` holds identifiers only |
| Storage / realtime policy drift | **Resolved for policies** — P1-00 AC4/AC5; **database functions not covered** (**R3**) |
| Pending / deployed-only migration and function reconciliation | **Resolved** — P1-00 AC6/AC7/AC8, both pending files named exactly |
| Credential rotation evidence | **Resolved** — P1-00 AC3/AC9, recorded without values; task Status and Dependencies both gate on it |

---

## 6. Minimum changes required before another review

Five edits. None requires backend access, and none is a redesign.

1. **Break the P1-03 ↔ P2-01 cycle** (**R1**). Assign tenant-date semantics to exactly one task and delete the opposing dependency edge.
2. **Fix the wire-shape freeze owner** (**R1b**). Change §6 from "P1-00 freezes" to "P1-01 freezes", matching `tasks.md` step 4 and P1-01's ownership of `src/types/access.ts`.
3. **Define non-employee Company Admin behaviour on `is_hr()`-gated configuration tables, and bound the bootstrap principal's authority** (**R2**). Two sentences in §2.5/§2.11 or §4, plus one P1-02 acceptance criterion.
4. **Extend P1-00's reproducibility scope to database functions** (**R3**), with an acceptance criterion naming `get_auth_tenant_id`, `can_access_tenant`, `is_superadmin` and `tenant_is_active`, and a clean rebuild from `migrations/` alone as the reproducibility bar. Update §14.2 to match.
5. **Add the template × action matrix to §4** (**R4**), or restate P1-02 AC4 against something that exists.

Optional, cheap, non-blocking: correct `baseline.md:167` (C8); mark the two P3-gated templates conditional (**R5**); add `/hr/declarations` and drop the dead `/employee/payslips` mapping (**R6**).

---

## 7. Scope and limits of this re-review

Reviewed: `contracts.md` v0.2 §1–§15 in full; `tasks.md` v0.2 in full including all eleven task blocks, the reservation table, the ordering section and the deadline assessment; the dependency graph; shared-file ownership and handoffs; and every disposition claim in §15 checked against the artifact that is supposed to discharge it.

Verified against the repository: migration collision for all eleven reserved versions; `baseline.md:167`; the `_hr_all` policy bodies on the four configuration tables; `get_auth_tenant_id` / `can_access_tenant` / `is_superadmin` / `tenant_is_active` definition sites across the whole repository, not only `migrations/`; the duplicate helper definitions compared for divergence; `src/modules.ts` route mappings.

Not reviewed: any runtime behaviour. No backend was contacted. The v0.1 NEEDS VERIFICATION items (N1–N8) remain unverified by me; v0.2 correctly preserves them as gates in P1-00 and the consuming packages rather than claiming them resolved, and I have not treated any of them as evidence in either direction. Source inspection in this review establishes what the artifacts and committed SQL say, not that any runtime security property currently holds.

---

## Verdict

**CHANGES REQUIRED — IMPLEMENTATION REMAINS BLOCKED**

v0.2 resolves sixteen of twenty-two prior findings with concrete contracts, owners and testable criteria, and defers a further one on an acceptable, explicitly stated M1/M2 boundary. That is real progress and the revision deserves credit for it.

It cannot be accepted as-is for one mechanical reason and three substantive ones: the dependency graph contains a cycle that prevents P1-03 and P2-01 from starting at all (**R1**); the non-employee Company Admin — the milestone's headline capability — has undefined behaviour on the configuration tables its template exists to administer, with two provisioning paths giving opposite authority (**R2**); the reproducible test backend that every acceptance criterion depends on cannot be rebuilt from the repository, because the four tenant-isolation primitives are granted in migrations but defined nowhere in them (**R3**); and no template carries an action set, leaving P1-02 AC4 untestable (**R4**).

All four are decidable from the artifacts and the committed SQL, and all five minimum changes are editable this weekend without backend access. The existing gate — **HOLD P1/P2/P3 IMPLEMENTATION** — should stand until they are made and re-reviewed.

Reviewer acceptance of a future revision is not deployment authorization, and nothing in this review is evidence that any runtime security property currently holds.
