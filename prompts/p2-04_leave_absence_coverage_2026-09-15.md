# P2-04 — Leave workflow and reversible absence coverage

Repo `C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`, branch
`p1-00-harness-reconciliation`, base **`7092127`**.

Read first:
- `doc/execution/non-payroll-monday/contracts.md` v0.5 — §3, §4, §7, §9, §12
- `doc/execution/non-payroll-monday/tasks.md` v0.5 — P2-04 and the v0.5 preamble
- `doc/execution/non-payroll-monday/reconciliation.md` **§13** — your `on-leave-reviewed` disposition
- `doc/execution/non-payroll-monday/reviews/package-review-P2-01.md` **§5** and `-P2-02.md`

---

## 1. You cannot test anything until you fix the fixtures — read this first

Your dependency line says "known synthetic balances." **They do not exist.** Measured today:

```
m1m2-a  leave_types: 0  leave_balances: 0
m1m2-b  leave_types: 0  leave_balances: 0
```

Zero leave types means no leave can be requested, so AC1, AC3, AC4, AC5 and AC7 are all untestable as
things stand. New tenants here are born with no leave configuration — that is the product's actual
behaviour, not a fixture bug.

`tests/m1m2/fixtures/personas.mjs` is **added to your allowed files** for this package, for the same
reason it was added to P1-02: the fixture data a package needs cannot be created from outside it.
Seed a small, deterministic set — fixed UUIDs, a couple of leave types with known entitlements, known
opening balances on the existing personas. Keep it minimal; you are not modelling a real HR policy.

**Do not invent historical balances.** Your review requirement says no ledger redesign and no
historical balance invention. Opening balances are fixture setup; anything that looks like a
reconstructed accrual history is out of scope.

---

## 2. Three inherited findings — these are the package, not discoveries you need to make

### 2.1 `on-leave-reviewed` — disposition already decided, you execute it

Settled in `reconciliation.md` §13:

```
local     28 lines — 410 "Deprecated. Leave approval is handled by the approve_leave_request SQL RPC."
deployed 124 lines — full live implementation
```

**The local stub is authoritative**, on two pieces of evidence: `approve_leave_request` writes
notifications itself, and nothing in `src/` references the function. The deployed copy is orphaned.

**Disposition: DELETE on the branch.** Do not deploy the stub over it — a 410 endpoint left standing
is a slower orphan. Deleting on `BASELINE-RO` is a separate deliberate step and **not yours**;
confirm nothing outside this repository calls it first, exactly as with the ATS functions in §11.

### 2.2 `employee_apply_leave_request` duplicates day-counting — a correctness bug today

Verified against the live function body:

```
calls work_calendar_holiday:      false
calls work_calendar_working_days: false
reads holidays directly:          true
reads holiday_calendar_days:      false
```

It reads only the tenant-default holiday tier and **never sees named calendars**. So a tenant using a
shift- or employee-assigned holiday calendar gets a different holiday answer from a leave request
than from the shared resolver — two sources of truth for whether a given day is a holiday.

Converge it onto `work_calendar_holiday` / `work_calendar_working_days`. **Prove equivalence before
and after** on a date where the tiers agree, and prove the *difference* on a date where a named
calendar and the tenant default disagree — that second case is the bug, and it is AC4's evidence.

### 2.3 Evidence preservation is AC5 and the reason this package is high-risk

`approve_leave_request` and `cancel_leave_request` both write to `attendance`, and neither touches
`attendance_events` directly. That is expected: `trg_attendance_dual_write_event` is the only writer
of the event log and must stay that way — **do not add manual event inserts, you will double-write.**

What is *not* established is whether a real punch on day D survives leave being approved over D and
then cancelled. AC5 is that exact round trip: punch on D → approve backdated leave covering D →
cancel it → the raw event and the derived punch/evidence are still readable and the day restores.

Test the round trip for real. An append-only event log makes this *likely* to work; likely is not
evidence.

---

## 3. Two things believed true that are not

- **Leave accrual is not running.** Earlier notes in this repo say accrual fires monthly and inflates
  `balance` without `total_allocated`. I checked: there are **no `pg_cron` jobs** and the only
  InsForge schedule is `attendance-derivation-hourly`, which is inactive. Nothing accrues on this
  backend. Do not write tests that assume an accrual has run, and do not "fix" a scheduler that is
  not scheduled.
- **Some leave settings are inert.** `probation_restricted` and `requires_document` are configurable
  but read by no enforcement path. If an acceptance criterion depends on one, it will pass
  vacuously. Either wire it or report it as inert — **do not report a vacuous pass as a pass.**

---

## 4. Constraints

- Target `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`) only. **Never write to
  `0431f0f6-225f-4fb1-86b7-3fd32684c7f4`.** `npm run test:m1m2:target` before any write.
- Migration `migrations/20260912186000_m1m2-leave-approval-absence-coverage.sql`. Hyphens. Applied
  migrations are immutable.
- **Use P1-01's `assert_distinct_approver` for AC2.** It is the only approved no-self predicate and
  returns one denial class. Do not reimplement identity logic.
- **Use P1-03's rule:** only an effective `primary` relationship grants direct-report scope. Every
  other relationship type must fail a manager-scope leave read.
- **Use P2-01's `tenant_business_date`** for every date boundary. Do not re-derive with
  `AT TIME ZONE` — P2-02 converged five attendance callers off exactly that pattern.
- **`CREATE OR REPLACE` with an appended DEFAULT parameter creates a second overload** rather than
  replacing. Replace on the exact existing signature, then assert `pg_proc` holds one row per name.
- Every `SECURITY DEFINER` function needs its own tenant fence and a pinned `search_path`. No
  `EXECUTE` to `anon`. A tenant fence must be **RESTRICTIVE**.
- **Prefer denying table writes over policing them.** P2-02's pattern: reads policy-scoped, writes
  revoked at both policy and GRANT level and routed through definer RPCs with an explicit column
  allowlist. Follow it if you touch leave write paths.
- The `attendance-derivation-hourly` schedule is branch-pointed and **inactive**. If you need derived
  rows, enable it explicitly, verify the URL contains `-j9g`, and set it back to inactive. Never
  touch the parent's schedule.

**Allowed files:** the `tasks.md` P2-04 list, **plus `tests/m1m2/fixtures/personas.mjs`** per §1.
Anything else — **stop and report**.

RLS invariant **1 / 2 / 0** (Company A `employees`). Report it before fixtures and after teardown.

---

## 5. Acceptance criteria

`tasks.md` P2-04 AC1–AC7. Where the risk sits:

- **AC5 is the package.** The punch/leave/cancel round trip with raw evidence intact.
- **AC3** no double debit across approve → cancel → retry. Test the retry, not just the happy path.
- **AC2** requester holding HR, Owner or Manager still cannot review their own leave, via the shared
  denial class — use the composed employee+HR persona.
- **AC6** partial sessions: exact interval tests, **or mark unsupported.** Marking unsupported is an
  acceptable outcome; a vague pass is not.
- **AC7** Leave-only and disabled-Leave fixtures both behave. Note `tenant_business_date` is no longer
  module-gated (P2-01), so a Leave-only tenant now resolves dates correctly — verify that end to end.

---

## 6. Report back

Exact commit, files changed, **per criterion PASS / FAIL / UNTESTED**. A criterion you reasoned about
but did not execute is UNTESTED, and a criterion that passed because the setting it tests is inert is
**not** a pass — say which it was.

Evidence, not assertion, for: the AC5 round trip; the holiday-tier disagreement case before and
after; no double debit across a retry; `on-leave-reviewed` deleted on the branch and confirmed gone;
`pg_proc` overload counts; RLS 1/2/0 both times; drift count (50 untracked is the deferred baseline);
build; final schedule state.

If a criterion cannot be met without inventing balance history, redesigning the ledger, or widening
an employee's write surface, **stop and report**. Every package so far has been accepted partly
because it labelled untested criteria honestly — that is the standard here, not a concession.
