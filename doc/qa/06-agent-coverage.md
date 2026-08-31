# Agent coverage — what is already tested, and what it found

Two suites. Both were **written and executed on 2026-08-31 against the live backend**; the
results below are what they actually printed, not what they were expected to print.

Their purpose is to take everything decidable by a query off the human tester's list, so a
person spends their time on the things only a person can do — a real camera, real GPS, a real
device, and judgment about whether a screen makes sense.

---

## Running them

```bash
# Fixture integrity, the attendance derivation truth table, organisation invariants.
node scratch/qa-battery-run.mjs doc/verification/qa_fixture_battery.sql

# Row-level security as each real persona. Needs the QA password.
QA_PASSWORD='<the QA password>' node scratch/qa-session-probe.mjs

# Force attendance derivation for a date range (there is no UI button for this).
QA_PASSWORD='<the QA password>' node scratch/qa-force-derivation.mjs 2026-08-31 2026-08-31
```

Both suites are **safe against the live database**. Every write happens inside a subtransaction
that is rolled back, and each then re-counts the affected tables against a baseline taken before
the run — so a rollback that failed would itself be reported as a failure. The derivation cases
work on dates in **2091**, chosen so that even a total rollback failure could not collide with a
date any person will ever look at.

### Why a third runner

`scratch/qa-battery-run.mjs` exists because neither runner beside it can carry these files:

- `apply_sql_file.mjs` passes each statement as a **command-line argument** and collapses all
  whitespace first. Windows caps a command line near 8k characters, and collapsing newlines
  without stripping `--` comments folds a whole procedural block into a single comment line.
- `apply_sql_direct.mjs` posts the whole file in one request, and the raw-SQL endpoint returns
  rows **only for a single-statement body** — anything longer comes back as `{"rows":[]}`
  whatever it actually selected. (Verified: `SELECT 1;` returns a row; `SELECT 1; SELECT 2;`
  returns none.)

A procedural block also cannot return rows, and `RAISE NOTICE` is not surfaced by any of these
paths. So each block ends by raising a deliberate report with SQLSTATE `ZZ002`, which the runner
prints as a report rather than a failure. That is the only way to get findings out of a block
that must roll its own writes back.

---

## Suite 1 — `doc/verification/qa_fixture_battery.sql`

### Part A · Fixture integrity — 7 passed, 1 finding

| | Result |
|---|---|
| A1 | QA tenant active; all seven modules under test enabled |
| A2 | 6 active employees, every one auth-backed |
| A3 | 1 HR session + 5 employee sessions, all stamped with the QA tenant |
| A4 | QA Manager has 4 direct reports, so `isManager` resolves true |
| A5 | 1 default shift, every employee assigned, every employee has a code |
| A6 | 4 leave types, complete 2026 ledger, arithmetic consistent |
| A7 | General shift 09:30–18:30 Mon–Sat, late grace 10, thresholds 2.0 / 4.0 |
| **A8** | **FINDING** — see below |

> **A8.** The General shift's `last_sync_of_events` is NULL, so derivation will **never** mark a
> day Absent, however many an employee misses. This is the fact behind test case
> [AT-09](03-attendance-tests.md), and it is the single most likely thing for a tester to file
> as a bug. It is current, deliberate behaviour: the system refuses to declare an absence when it
> may simply not have received the punches yet. If that watermark is ever set, AT-09's expected
> result changes and A7/A8 will say so.

### Part B · Attendance derivation truth table — 10 passed

Every case ran the real derivation functions against the QA tenant's own General shift.

| | Case | Result |
|---|---|---|
| B1 | 09:29 → 18:30 | present, not late, 9.02 hours |
| B2a | 09:40 in — exactly on the grace boundary | **not late** (the comparison is strictly greater) |
| B2b | 09:41 in | **late**; `late_entry` = `is_late`; status stays **present** |
| B3a | 3.00 hours worked | half_day |
| B3b | 1.00 hour worked | absent — despite a real punch pair |
| B4 | Sunday, no punches | weekly_off |
| B5a | Full-day approved leave | on_leave, and the row carries the approving `leave_id` |
| B5b | `day_fraction` 0.5 leave | half_day, not on_leave |
| B6 | Re-deriving the same day | idempotent — one row, same status |
| B7 | A day locked by an HR correction | survives re-derivation |

B2a/B2b together pin the boundary to the minute, which is why
[AT-11](03-attendance-tests.md) can state flatly that 09:40 is on time and 09:41 is not.

B7 is the guard behind [AT-18](03-attendance-tests.md): without it, every HR correction would be
silently reverted by the next hourly run.

All Part B writes rolled back, with the row counts for attendance, events, derivation runs and
leaves each restored to the baseline taken before the run. The suite prints those four numbers on
every run and raises if any of them moved, so the check is live rather than a figure recorded here
that would go stale.

### Part C · Organisation invariants — 3 passed, 3 findings

| | Question | Answer |
|---|---|---|
| **C1** | Is archiving an org unit that still holds employees blocked in the database? | **No.** Three active employees stayed attached. The `window.confirm()` dialog is the only guard, and any direct API call walks past it. |
| **C2** | Is a self-referencing `manager_id` rejected by the database? | **No.** The cycle guard lives only in the RPC the UI calls. |
| **C3** | Is a two-step reporting cycle (A → B → A) rejected by the database? | **No.** Same reason. |
| C4 | Is assigning an employee to **another tenant's** org unit rejected? | **Yes.** |
| C5 | Is the live data clean right now? | **Yes** — no cross-tenant org units, no cross-tenant managers, no self-managers. |

**What C1–C3 mean for QA.** These are *not* bugs a tester should file, and they are not
theoretical either. They are the reason [OM-07](02-organisation-tests.md), OM-09 and OM-10 are
written as *"check the dialog appears"* and *"report if it saves"* rather than *"check it is
prevented"*: the screen is the only thing standing between the product and a reporting cycle. If
a future screen, import, or integration writes to these tables without going through the same
RPC, nothing downstream will catch it. C4 passing is the reassuring half — the boundary that
actually matters for tenancy is enforced where it should be.

---

## Suite 2 — `scratch/qa-session-probe.mjs` — 16 of 16 passed

A `db query` runs as `project_admin`: RLS is bypassed and `auth.uid()` is NULL, so every
tenant-scoped policy returns the same answer whether it is correct or completely broken. Only a
real session can tell them apart — and it has to be an **employee** session, because `is_hr()`
short-circuits most policies before reaching the branch under test.

### Employee session (`employee-qa`)

| | Check | Result |
|---|---|---|
| S1 | Own employee row readable | 1 row |
| S2 | Base `employees` table exposes colleagues | 0 rows — colleague lookup goes through the view |
| S3 | `employee_directory_public` returns colleagues | 6 |
| S4 | Cross-tenant read | 0 rows |
| S5 | Own leave balances readable | 4 of 4 |
| **S6** | Employee raising their own leave balance | **refused** |
| **S7** | Employee flipping `leave_types.is_paid` | **refused** |
| **S8** | Employee writing their own attendance row | **refused** — `permission denied for table attendance` |
| S9 | Employee editing a colleague's record | refused |
| S10 | Employee renaming an org unit | refused |

S6, S7 and S8 are regression guards for holes that were real and are now closed:

- The leave tenant fence was written **PERMISSIVE**, which in Postgres *grants* rather than
  fences — any employee could set their own balance or flip a payroll-relevant flag.
- Employees held a blanket write grant on their own attendance row, and **RLS cannot restrict
  columns** — `work_hours`, `status` and `is_late` all feed payroll. The whole write surface had
  to be revoked; note S8 fails closed with a hard permission error, not a silent zero-row update.

A write is counted as refused only if it errors **or** affects zero rows. Treating only an error
as refusal would let a wide-open table pass.

### HR session (`hr-qa`)

| | Check | Result |
|---|---|---|
| H1 | Reads the whole tenant directory | 6 employees |
| H2 | Cross-tenant read | 0 rows — HR is tenant-scoped too |
| H3 | Reads shifts | 3 of 3 |
| H4 | Reads the tenant attendance register | ok |

### Manager session (`manager-qa`)

| | Check | Result |
|---|---|---|
| M1 | Direct reports visible | 4 — and this exact count is what sets `isManager` in the app |
| M2 | Editing the HR admin's record | refused — a manager is still an employee |

---

## Read, not run — the leave apply path

Not a suite result. `employee_apply_leave_request` was read on 2026-08-31 because three leave
test cases were about to assert behaviour nobody had checked. Two of the five settings HR can
configure on a leave type turn out to be inert:

| Setting on `leave_types` | Read by the apply path? |
|---|---|
| `min_notice_days` | **Yes** — and it takes the larger of this and a tenant-wide `leave_min_notice_days` |
| `max_consecutive_days` | **Yes** — counted in **working days**, not calendar days |
| `applicable_from_day` | **Yes** — this is what gates Earned Leave behind 90 days' service |
| `probation_restricted` | **No.** Written by Policy Center, read by nothing |
| `requires_document` | **No.** Same |

`probation_restricted` appears in `src/hr/PolicyCenter.tsx` only, where HR sets it. No enforcement
path reads it — not the RPC, not the employee apply screen.

This is why [LV-05](04-shift-leave-task-tests.md) tells the tester to expect Earned Leave to be
**refused** and Casual Leave probably **accepted**, rather than the obvious-looking "probation
blocks restricted types". Writing it the obvious way would have produced a false bug report on
the first run — the same shape of error the organisation-module doc audit found four of.

---

## What these suites do NOT cover

Listed plainly so nobody mistakes a green run for a tested product.

- **Everything in the browser.** No suite here renders a page. A correct database and a broken
  screen look identical from where they stand — which is the whole reason the human test plan
  exists.
- **Camera, GPS, and device flows.** Selfie capture, geofencing, and the kiosk are untestable
  without real hardware. The kiosk has still never had a real punch.
- **The punch RPCs as an employee.** `punch_in_attendance` / `punch_out_attendance` derive the
  employee from `auth.uid()` and expect real evidence; the derivation cases feed the event log
  directly instead, which exercises the derivation logic but not the punch entry point.
- **The night shift across midnight.** The truth table runs on the General shift only. SH-07 is
  left to a person on purpose — which calendar date a midnight-crossing shift lands on is a
  design question that wants a human answer before it is frozen into an assertion.
- **Leave application through the UI path.** B5 inserts an approved leave directly to test what
  *attendance* does with it. The application, approval and balance arithmetic are LV-01 to LV-10,
  and remain a human's job this round.
- **Payroll.** Not built.
- **Whether the two inert leave settings above are enforced anywhere else.** The RPC does not
  read them; a client-side check in a screen not yet read could still exist. LV-05 and LV-12
  exist to settle that from the outside.
