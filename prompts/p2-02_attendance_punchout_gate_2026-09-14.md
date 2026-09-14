# P2-02 — Attendance, corrections and exclusive punch-out gate ownership

Repo `C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`, branch
`p1-00-harness-reconciliation`, base **`d0b40d3`**.

Read first:
- `doc/execution/non-payroll-monday/contracts.md` v0.5 — §3, §4, §7, §12
- `doc/execution/non-payroll-monday/tasks.md` v0.5 — P2-02 and the v0.5 preamble
- `doc/execution/non-payroll-monday/reviews/package-review-P2-01.md` and `-P1-03.md`
- `functions/check-punch-out-gate/index.ts` — **read its header comment before touching anything**

**This is the highest-risk package in M1.** It owns a gate that has already had a client-policy hole
once, on the code path that decides whether a person can end their working day. A wrong change here
either traps employees at work or lets the gate be bypassed. Prefer a smaller correct change over a
complete one.

---

## 1. Your AC8 dependency is already resolved — do not re-litigate it

`tasks.md` lists this package as blocked on "P1-00 authoritative `check-punch-out-gate` side."
**I settled it.** Fetched the deployed source and diffed it against the repo:

```
local body 71 lines, deployed body 71 lines — IDENTICAL
```

Zero drift. The repo file is already a faithful recovered copy. You may edit it normally. Redeploying
it will not clobber anything unseen.

*(For the record, the other half of AC8 — `on-leave-reviewed` — does drift: local is a 28-line 410
deprecation stub, deployed is 124 live lines. The local stub is authoritative, because
`approve_leave_request` writes notifications itself and nothing in `src/` calls the function. That is
P2-04's problem, not yours. Do not touch it.)*

---

## 2. What actually enforces the gate — and what must not become the enforcer

`functions/check-punch-out-gate` is a **read-only UX pre-check**. Its own header says so:

> this is a UX pre-check, NOT the security boundary. The real enforcement lives in
> `punch_out_attendance()` … If this function were removed entirely, punch-out would still be
> correctly gated. Never move that rule out of the database and into here.

I verified that claim: `punch_out_attendance()` (317 lines) checks both the tasks module gate and
`punch_out_gate_enabled`. **Keep it that way.** The edge function runs as the caller and may only
ever *report*. Any new rule goes in the database. If you find yourself adding a decision to the edge
function, stop — that is the shape of the hole this package exists to prevent.

**AC6 may already pass.** The tasks-module gate is present in `punch_out_attendance`. Verify it
end-to-end with Tasks disabled rather than assuming, and if it passes, say so and change nothing.

---

## 3. The defect I measured: three copies of "what day is it"

P2-01 exists so one function owns the tenant business date. `punch_out_attendance` ignores it and
re-derives the date inline:

```sql
v_tenant_tz   := COALESCE(v_tenant.timezone, 'UTC');
v_today_in_tz := (v_now AT TIME ZONE v_tenant_tz)::date;
```

That is the same formula `tenant_business_date` uses — so it agrees **today**, and there is no live
wrong answer. It is a second source of truth that will drift the moment either side changes. The
P2-01 review already flagged per-location timezones as a likely extension; when that lands,
punch-out silently keeps the tenant-level answer while everything else moves.

**Confirmed duplicating the derivation: `punch_in_attendance`, `punch_out_attendance`,
`attendance_derive_pass1`.** I checked those three by name and did not obtain a reliable full count —
**enumerate the complete set yourself** and report it before converging anything.

Converge the ones in your allowed scope onto `tenant_business_date(tenant_id, instant)`. Where a
caller is outside your scope, report it rather than reaching for it. **Prove equivalence before and
after** on the same instants, including a DST transition — a silent one-day shift in attendance is
the worst outcome available here.

---

## 4. Things that will bite you

- **The event log is trigger-maintained.** `trg_attendance_dual_write_event → attendance_dual_write_event`
  writes `attendance_events` from `attendance`. Do **not** add manual event inserts; you will double-write.
  AC4 provenance depends on that trigger staying the only writer.
- **RLS cannot scope columns.** Employees once could write *any* column on their own attendance row;
  that was closed by restricting the write path, not by a policy. Keep employee writes going through
  a definer function with an explicit column allowlist. A policy alone cannot express this.
- **A `RAISE` rolls back the whole statement**, including counters you wanted to keep. The device
  ingest path returns rejections rather than raising, deliberately. Match that pattern where a
  rejection must still record that it happened.
- **`CREATE OR REPLACE FUNCTION` with an appended DEFAULT parameter creates a second overload**
  rather than replacing. P2-01 nearly shipped two live business-date functions this way. Replace on
  the exact existing signature, then assert `pg_proc` holds exactly one row per name.
- **`is_locked`** on attendance had no writer for a period and HR corrections were silently
  reversible. If you touch locking, prove the guard has a writer and that a locked correction
  actually fails (AC2).

---

## 5. Constraints

- Target `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`) only. **Never write to
  `0431f0f6-225f-4fb1-86b7-3fd32684c7f4`.** `npm run test:m1m2:target` before any write.
- Migration `migrations/20260912184000_m1m2-attendance-correction-consistency.sql`. Hyphens.
  Applied migrations are immutable.
- **The `attendance-derivation-hourly` schedule is repointed to the branch host and `isActive: false`.**
  It spent a day firing into production. If you need derived rows, re-enable it **explicitly**,
  re-verify `functionUrl` contains `-j9g`, and set it back to inactive when done. Never touch the
  parent's schedule. Also still unmeasured: whether `branch reset` re-arms it — if you run a reset,
  check afterwards and report.
- Every `SECURITY DEFINER` function needs its own tenant fence and a pinned `search_path`; RLS does
  not backstop a definer function. No `EXECUTE` to `anon`.
- A tenant fence must be **RESTRICTIVE**. PERMISSIVE is a grant.
- Use P1-01's shared distinct-approver predicate for AC5. Do not reimplement identity logic —
  `assert_distinct_approver` is the only approved one and returns a single denial class.
- Use P1-03's rule: only an effective `primary` relationship grants direct-report scope.

**Allowed files:** the list in `tasks.md` P2-02, unchanged. Anything else — including a fixture or an
extra test file — **stop and report**.

Personas: `npm run test:m1m2:personas`. RLS invariant **1 / 2 / 0** (Company A `employees`).
Re-run after your migration *and* after teardown; report both.

---

## 6. Acceptance criteria

`tasks.md` P2-02 AC1–AC6. Where the risk actually sits:

- **AC2** is the substance: an employee initiates a missing-OUT correction via
  `attendance.correction.request:self`; performing and approving it is a *distinct* authorized
  action; raw evidence and audit survive; a locked correction fails. Test the locked case for real.
- **AC5** must use the shared predicate and produce its denial class, including for a composed
  employee+HR persona approving their own correction.
- **AC6** — Tasks disabled, employee with an unapproved task, punch-out succeeds; re-enable and the
  documented gate behaviour returns.
- **AC3** idempotency: a replayed event changes nothing; a retried scheduled run is deterministic.
- Plus: one function copy per name, no `anon` EXECUTE, RLS 1/2/0 before and after teardown, no new
  untracked policies (50 is the deferred baseline), `npm run build` clean, and the schedule left
  inactive and branch-pointed.

---

## 7. Report back

Exact commit, files changed, **per criterion PASS / FAIL / UNTESTED**. A criterion you reasoned about
but did not execute is UNTESTED. Every package so far has been accepted partly *because* it labelled
untested criteria honestly — that is the standard, not a concession.

Evidence, not assertion, for: the full enumeration of functions re-deriving the business date; before
and after equivalence on the converged ones including a DST instant; the locked-correction failure;
AC6 with Tasks off and on; the `pg_proc` overload count; RLS 1/2/0 both times; drift count; build;
final schedule state.

If a fix requires moving a decision out of the database into the edge function, or widening an
employee's write surface, **stop and report**. Both are the failure modes this package exists to
close, and neither is worth a green criterion.
