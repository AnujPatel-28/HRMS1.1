# P6 CONTRACT RE-REVIEW — v0.4

Reviewer: independent senior engineer (Opus 5), CONTRACT mode
Date: 2026-09-12 IST
Under review: `contracts.md` v0.4, `tasks.md` v0.4
Reviewed against: `reviews/contract-review-v0.3.md` blockers B1–B3, and the full C1–C22 / R1–R6 history
Repository state inspected: `main` / `7214f8e3abeaef797d45122c7bc1129f0663cc43`

**VERDICT: ACCEPT — IMPLEMENTATION MAY UNBLOCK**

**The CONTRACT gate is passed.** `contracts.md` v0.4 and `tasks.md` v0.4 are internally consistent, and every shared authority, file, migration and acceptance criterion that P1/P2/P3 depend on has a named owner and a falsifiable test.

Nothing was implemented. No code, migration, backend, database, credential, user or deployment was created or modified. No runtime verification was performed.

---

## 1. The three v0.3 blockers

### B1 — Template × action matrix vs. the workflows each package must pass — **RESOLVED**

Fixed in both directions, which is what was needed. The matrix gained the missing cells, the action vocabulary gained the missing verb, and the P2/P3 acceptance criteria were rewritten to reference the matrix rather than restate authority independently.

| v0.3 instance | v0.4 resolution |
|---|---|
| HR Admin `task.review`/`task.assign` absent | HR Admin `company` cell now ends `…, task.assign, task.review` |
| Manager `task.review`/`task.assign` absent | Manager `direct_reports` cell now `employee.basic.read, attendance.read, attendance.approve, leave.read, task.assign, task.review` |
| Employee `task.submit` project-scoped only, while `tasks.project_id` is nullable | Employee `self` cell now includes `task.submit`, retained at `project:<id>` as well |
| No action existed for an employee-initiated correction | New `attendance.correction.request` in §4's vocabulary, defined as "the employee's self-scoped request action; it is distinct from performing or approving a correction", present in the Employee `self` cell |
| P3-02 AC2 required HR review with no granting cell | P3-02 AC2 now reads "Employee-associated HR Admin through the legacy-compatible seam, **Manager for a direct report** and explicit Project Manager can review **only at their §4 matrix scopes** and are denied out of scope" |
| P2-02 AC2 required a correction flow with no granting cell | P2-02 AC2 now reads "An Employee uses `attendance.correction.request:self` to initiate the supported missing-OUT correction flow; performing/approving the correction remains a distinct authorized action…" |

The structural fix matters more than the cells. §4 now carries:

> This matrix is normative for every workflow surface named by P2/P3 acceptance criteria. If a required workflow action or scope is absent or contradictory, implementation remains blocked until a reviewed contract revision changes the matrix or the workflow acceptance criterion; an implementation agent may not invent or broaden authorization.

My v0.3 finding was explicitly a lower bound — I had swept tasks, corrections and leave, not policy, expenses, onboarding, offboarding or devices. This clause is the correct answer to a lower-bound finding: an unswept gap now *blocks and escalates* instead of letting an agent invent authorization. I therefore do not need an exhaustive sweep to clear the gate. For what it is worth, I did check the Policy Center surface against the matrix and it is complete (HR Admin holds `policy.read`/`policy.publish`/`policy.configure`; Employee holds `policy.read` and `policy.acknowledge`; Manager holds `policy.read`), so P3-01's acceptance criteria have their granting cells.

### B2 — Migration reservation order vs. the reversed P1-03/P2-01 dependency — **RESOLVED**

The two reservations are swapped, and consistently:

- Reservation table: `20260912182000_m1m2_shared_work_calendar_resolver.sql` → **P2-01**; `20260912183000_m1m2_dated_organization_transfer.sql` → **P1-03**.
- Both task bodies cite the new versions (`tasks.md:196` for P2-01, `tasks.md:166` for P1-03). No stale reference to the old numbering survives anywhere in either document.
- Ordering steps 6 → 7 remain correct (P2-01 freezes the primitive, then P1-03 consumes it).

I verified the stronger property this was really about: **ascending migration version order is now a valid topological order of the task dependency graph.** 179500 (P1-00) → 180000 (P1-01) → 181000 (P1-02) → 182000 (P2-01) → 183000 (P1-03) → 184000 (P2-02) → 185000 (P2-03) → 186000 (P2-04) → 187000 (P3-01) → 188000 (P3-02) → 189000 (P3-03). Every dependency edge points from a lower version to a higher one, so no reserved path can require a mid-flight renumber. Eleven reservations, one owner each, no collision with `migrations/` (head `20260904120000`) or `migrations-pending-deploy/`.

### B3 — Database-function capture without a classification gate — **RESOLVED, and better than requested**

P1-00 AC11 and §14.2 now both require discovery plus classification rather than a fixed-list copy-forward:

> Identify every database function required by a migration-only `TB-M1M2` rebuild; compare each with `BASELINE-RO` and repository definitions; classify each as `intended`, `stale` or another explicit disposition; record every discovered function and disposition; and allow only reviewed `intended` definitions into `20260912179500`. Explicitly disposition `exec_sql`, `query_json`, `update_user_password`, `close_stale_attendance`, `get_auth_tenant_id`, `can_access_tenant`, `is_superadmin` and `tenant_is_active`. **Do not blindly copy SECURITY DEFINER, SQL-execution or password-setting functions.** A clean rebuild from `migrations/` alone, with no root-level SQL, must then apply successfully and every included body must match its reviewed intended definition.

This addresses all three parts of the finding: the asymmetry with AC5's policy classification is gone; the framing is discovery-driven rather than a fixed four, so my lower-bound caveat is handled; and all eight functions I identified — including the four found only via the GRANT-only sweep — are named for explicit disposition, with the three dangerous ones singled out. §14.2 mirrors it in the contract layer.

---

## 2. New contradictions introduced by v0.4

**None found.** I checked the expanded matrix against every clause it could collide with:

| Check | Result |
|---|---|
| §2.4 / §2.5 vs. the Company Admin row | Unchanged and still exactly congruent — the row is still access administration plus `org.read`/`org.manage`/`reporting.manage`/`designation.manage`, which is what §2.4 enumerates |
| §3.1 "one action and one scope" vs. Employee `task.submit` in two cells | Consistent — these are two (action, scope) grants, and §4's "no column or scope is inherited across rows" prevents widening |
| §7 no-self-approval vs. Manager `task.review` and HR Admin `task.review` | Consistent — §7.2/§7.3 are unconditional and §7.7 tests the composed human |
| §9 leave-approval HR-only vs. Manager row | Consistent — the matrix withholds `leave.approve` from Manager |
| §4's HR Admin exclusion "no project management" vs. new `task.assign`/`task.review` | Consistent — HR Admin holds no `project.*` action |
| Manager `attendance.approve:direct_reports` (no existing enforcement path) | Owned by P2-02's migration and tested by P2-02 AC5's scope enforcement; not a contradiction |
| `attendance.correction.request` granted only to Employee/self | Coherent — an HR person who is also an employee obtains it through the Employee template per §4's "unless another assigned template independently grants it", and §7 still blocks self-approval |
| Dependency graph after the swap | Unchanged and acyclic; verified edge by edge from the Status and Dependencies lines |
| Shared-file ownership | Unchanged and clean — five files in two tasks each, all marked sequential handoff, all consistent with the run order; P2-01 touches none of the handed-off files |
| §6 wire-shape version label | Correctly updated to `v0.4` in both the prose and the `contractVersion` field |
| Payroll/Insurance exclusions | Unchanged — §12.4/§12.5, both payroll layouts owned by P1-01, P1-01 AC5 |

---

## 3. Full finding history — final state

| Group | State |
|---|---|
| C1, C3, C5, C7, C9, C10, C11, C12, C13, C14, C15, C17, C18, C19, C20, C21, C22 | **RESOLVED** (carried forward from v0.2/v0.3, re-verified unchanged) |
| C2 | **RESOLVED** — P1-00 owns `package.json`, harness, target guard, fixtures |
| C4 | **RESOLVED** — §5.8/§5.9, P1-02 AC10 ownerless fixture |
| C6 | **DEFERRED WITH ACCEPTABLE M1/M2 BOUNDARY** — §2.10, §2.11, §8.8 |
| C8 | **PARTIALLY RESOLVED** — `baseline.md:167` still misstates the relationship-type constraint; mitigated by P1-00 AC10 recording the erratum in `reconciliation.md`. Documentation only |
| C16 | **RESOLVED** — HR Admin now holds `task.review`, so P3-02 AC2 has its granting cell (this was the row that regressed in v0.3) |
| R1, R1b, R2 | **RESOLVED** |
| R3 | **RESOLVED** — via B3 |
| R4 | **RESOLVED** — via B1 |
| R5, R6 | **NOT APPLIED — confirmed harmless.** §3's deferral plus P1-01 AC3's omission rule make the two P3-gated templates unambiguous; `/hr/declarations` is already gated under the `/hr` layout's `RequireModule` and the `/employee/payslips` mapping is dead code |
| B1, B2, B3 | **RESOLVED** |

No finding is NOT RESOLVED or REGRESSED.

---

## 4. Optional improvements — deliberately not blocking

None of these is an inconsistency between criteria; each is a labelling or hygiene item that implementation cannot get silently wrong, because §4's normativity clause blocks and escalates rather than permitting invention.

1. **Two candidate owners for `employee_reporting_relationships` policy text.** Company Admin holds `reporting.manage:company` (P1-02, migration `181000`) while P1-03 owns that table's dated semantics and overlap constraint (migration `183000`). Both migrations are lead-created, serialized and PACKAGE-reviewed, so the risk is managed — but this is the one item I would have the lead settle in the P1-02 handoff rather than discover during review.
2. **Reservation `181000`'s purpose does not mention the configuration-table policies** that P1-02 AC13 requires on `org_units`, `job_titles`, `locations` and `employment_types`. A PACKAGE reviewer could read them as out of scope. One phrase in the purpose column.
3. **Three registry modules have no template actions and no scope statement** — `expenses`, `onboarding`, `offboarding` are in `src/modules.ts` `MODULE_KEYS` with live routes, but §4 grants no actions for them and §12.5 disables only Payroll and Insurance. No acceptance criterion depends on them, so there is no contradiction; the gap is that their M1 status is unstated. One sentence in §12 would close it.
4. **Manager `attendance.approve` lacks the §9-style clause** that leave approval got, stating whether manager attendance approval is an M1 deliverable. P2-02 AC5 covers the scope enforcement, so this is wording only.
5. **§15 is stale.** Still headed "P6 v0.1 finding dispositions" with a "v0.2 disposition" column, and its C10–C14 row says "Frozen v0.2 wire contract" while §6 normatively says v0.4. It carries no R1–R6 or B1–B3 rows. §6 and P1-01 are the normative clauses an implementer reads, so this is a traceability gap, not a functional one — but it should be refreshed so the document's own changelog matches its contents.
6. **Correct `baseline.md:167`** (C8), or add a one-line erratum note at that bullet pointing at `reconciliation.md`.

---

## 5. Remaining gates before M1 + M2 Essential can be declared complete

The CONTRACT gate is passed. These are the runtime gates, and none of them was verified in any of the four CONTRACT reviews — no backend was ever contacted. Contract acceptance is not evidence that any of these holds.

**Environment preconditions, before any lane writes code:**

| Gate | Owner |
|---|---|
| `TB-M1M2` authorized, recorded, and the harness fails hard on a mis-target (reviewer-observed) | P1-00 AC1 |
| Credential rotation confirmed without values; `scratch/*` embedded credentials not reused | P1-00 AC3, AC9 |
| Migration-only rebuild of `TB-M1M2` applies clean with no root-level SQL, every included function body classified and reviewed | P1-00 AC11 |
| 32 live-only public policies plus all storage/realtime policies classified intended/stale | P1-00 AC5 |
| Remote-only migration, both `migrations-pending-deploy` files and the untracked-applied `20260904120000` dispositioned | P1-00 AC6 |
| Five deployed-only function bodies captured and assessed for membership/tenant bypass | P1-00 AC7 |
| `check-punch-out-gate` and `on-leave-reviewed` drift — authoritative side named before P2 edits | P1-00 AC8 |

**Runtime security properties that remain unproven (v0.1 N1–N8, carried forward):**

| Property | Gate |
|---|---|
| Realtime cross-tenant payload isolation — global `chat_messages`/`chat_channels` topics, `'chat:' \|\| channel` name collision, `notifications:<employee_id>` | P3-03 AC2, AC3, AC4 — raw socket capture across two tenants sharing a channel name; client filtering is explicitly not evidence |
| Private attachment access — anonymous, wrong-tenant, non-member, post-revocation | P3-01 AC3; P3-03 AC5 |
| Revocation freshness on every enabled surface (DB/RPC, function, storage, realtime) | §8.3 and P1-02 AC7 — any surface without proof must be **disabled and labelled incomplete** |
| The four uncommitted limiter edits still work | P1-02 AC12, before and after the package |
| `attendance_events` retains punches when leave projection overwrites the derived row | P2-04 dependency; P2-04 AC5 round trip |
| Non-employee Company Admin behaves identically through both provisioning paths, and bootstrap metadata does not satisfy `is_hr()` | P1-02 AC13 |
| Physical kiosk and overnight evidence; biometric | P2-03 — no hardware, no physical pass |

**Standing labelling rule that must survive to the end:** §14.8 and the deadline section require any unmet Essential criterion to be labelled incomplete rather than hidden behind navigation or a reduced template. Acceptance of these contracts does not soften that.

---

## 6. Scope of this review

**Reviewed statically:** `contracts.md` v0.4 §1–§15 and `tasks.md` v0.4 in full; the three v0.3 blockers individually; the expanded matrix against §2.4, §2.5, §3, §4's own prose, §7, §9, §12 and §14; the dependency graph edge by edge; migration reservations against the dependency order and against `migrations/`; shared-file ownership and handoff order; the ordering section; the wire-shape version label; and every version cross-reference in both documents.

**Verified against the repository** (static source inspection only): migration collision and head; `MODULE_KEYS` in `src/modules.ts`; `baseline.md:167`. Earlier reviews' repository verification — `tasks.project_id` nullability, the HR/manager-mode/employee task call sites, the employee correction writes, the two leave-approval surfaces, `attendance_select_manager`'s SELECT-only grant, the `*_hr_all` configuration policies, `is_hr()` / `get_auth_tenant_id()` mechanics, and the GRANT-only function sweep — stands unchanged and is not re-litigated here.

**Not reviewed:** any runtime behaviour. No backend was contacted in this or any prior CONTRACT review. Source inspection establishes what the artifacts and committed code say, not that any runtime security property currently holds.

---

## Verdict

**ACCEPT — IMPLEMENTATION MAY UNBLOCK**

The CONTRACT gate is passed. All three v0.3 blockers are resolved, no finding across C1–C22, R1–R6 and B1–B3 remains unresolved or regressed, and v0.4 introduces no new contradiction that I can find. Every shared authority — the capability wire shape, the no-self-approval predicate, the template × action matrix, the punch-out gate, the tenant-date primitive, server-side audit, migration sequencing and the test harness — has exactly one owner, a file, a dependency edge and a falsifiable acceptance criterion.

Two things earn particular credit. The §4 normativity clause converts any authorization gap I did not sweep from "an agent invents authority" into "implementation blocks pending contract revision", which is the right structural answer rather than a longer list. And P1-00 AC11 went beyond the correction requested: discovery-driven rather than a fixed list, with an explicit prohibition on copying SECURITY DEFINER, SQL-execution and password-setting functions forward.

Implementation may begin in the order `tasks.md` specifies, starting with P1-00. The six optional items in §4 above may be folded into any later revision without re-review; I would have the lead settle item 1 (the `employee_reporting_relationships` policy owner) in the P1-02 handoff.

Contract acceptance is not deployment authorization, is not a runtime security claim, and does not permit any Essential criterion listed in §5 to be reported as met without its own evidence. Each package still requires its P6 PACKAGE review, and the integrated candidate still requires P6 FINAL review.
