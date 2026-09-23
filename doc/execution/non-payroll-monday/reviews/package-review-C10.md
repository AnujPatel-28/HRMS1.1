# Package review: C10 leave review authorizes before it reveals

Lead: Opus 5.5, 2026-09-23, in-session. **Verdict: ACCEPTED.** All 23 `tests/m1m2` suites pass on the first run (22 existing plus the new
`c10_leave_review_order`). The only exception is the accepted `p3_realtime_isolation` item 6
(PLATFORM_LIMIT). No failure markers in any other log. Policy drift is 39, the baseline. Applied to
TB only.
Found by the v0.9.0 rehearsal (`doc/release/v0.9.0-rehearsal-report.md`, Finding).

## 1. Before: `tests/m1m2/c10_leave_review_order.mjs` pre-migration, 6/11

A signed-in user of **Company B** (`employee.b`) called both leave-review RPCs with Company A leave ids:

| Outsider call | Answer before |
|---|---|
| approve · pending | `P1003 APPROVAL_SUBJECT_UNAVAILABLE` (a denial) |
| approve · approved | `Leave request is no longer pending (current status: approved)` **leak** |
| approve · cancelled | `… (current status: cancelled)` **leak** |
| approve · nonexistent id | `Leave request not found` **leak** (existence) |
| cancel · pending / approved | `P1003` (a denial) |
| cancel · cancelled | `Leave request is already cancelled` **leak** |
| cancel · nonexistent id | `Leave request not found` **leak** |

No row was ever changed: the unchanged-row check and the HR positive controls passed. The cause is the
same in both functions. The row is read and its status checked **before** `assert_leave_reviewer()`.
The rehearsal report said `cancel_leave_request` "authorizes first and is fine". **That was wrong.**
It has the same ordering for its `rejected/cancelled` branch, and the test proves it.

## 2. Fix: `20260923162654_c10-leave-review-authorize-first.sql`

Both bodies are derived from live `pg_get_functiondef()` by `scratch/c10-gen.mjs` (anchored, once-only
edits). The diff against live shows only the intended lines:
- a missing leave raises `P1003 APPROVAL_SUBJECT_UNAVAILABLE`, the same answer another tenant's
  leave gets from `assert_leave_reviewer()`
- the status check moves to **after** `assert_leave_reviewer()`

`CREATE OR REPLACE` keeps grants. The frontend shows the RPC message as-is and matches no text
(`src/hr/LeaveManagement.tsx`, `src/employee/MyLeaves.tsx`), so authorized users see no change.

This is the first migration created with `db migrations new` (a real UTC timestamp), as doc 12 now
prescribes.

## 3. After: 11/11

- All 8 outsider calls give the identical `P1003 | APPROVAL_SUBJECT_UNAVAILABLE`.
- No fixture row changed.
- HR A still gets `no longer pending (current status: approved)` and `already cancelled` on its own
  tenant's leaves.

## 4. Sweep: same shape elsewhere

A scan of every SECURITY DEFINER function with a status-type `RAISE` found 12 candidates. It was
positive-controlled: the first version of the scan missed `approve_leave_request`, so the permission
pattern was tightened until it caught it. Each candidate was read by hand:

| Function | Verdict |
|---|---|
| `approve_leave_request`, `cancel_leave_request` | **fixed here** |
| `c1_review_new_hire_request`, `c1_cancel_new_hire_request`, `save_leave_type_transaction`, `manage_tenant_access` | authorize first; fine (the scan pattern didn't know their permission helper) |
| `accept_tenant_invitation` | the token is the credential; the status answer goes only to the token holder; fine |
| `bootstrap_first_tenant_admin`, `assert_date_range_unlocked` | not a caller-facing lookup; fine |
| `accept_owner_transfer` | answers `OWNER_TRANSFER_NOT_FOUND` vs `OWNER_TRANSFER_TARGET_REQUIRED`: existence of a transfer id leaks to any signed-in user. **Low** (random UUIDs, no state). Not fixed |
| `hr_activate_draft_employee` (both overloads) | `Employee profile not found` before the HR check: existence of an employee id leaks. **Low**. It also still reads the role from JWT metadata, and a 9-argument legacy overload is still deployed. Not fixed |

The two low items are recorded for a later hygiene package. Neither reveals data or changes anything.

## 5. Notes / production

- The `FOR UPDATE` row lock still happens before authorization. An outsider's call raises and rolls
  back, so the lock lives only for that failing call. Accepted.
- `p1_membership_invitation_revocation`'s comment is updated: its cross-tenant check no longer depends
  on QA leave `83f1421d…` staying pending. It is the check that exposed this in the rehearsal.
- **Production:** apply `20260923162654`. It has no frontend dependency and no bucket or function steps.
  Take a backup first, then run the C10 suite against a branch of production, or accept the TB run, as
  the owner decides.
