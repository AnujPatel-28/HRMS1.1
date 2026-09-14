# P6 PACKAGE REVIEW — P2-01

Reviewer: Opus 5, PACKAGE mode (independent of the implementer)
Date: 2026-09-14 IST
Under review: commit `caf9ec6`, base `3e69057`
Target: `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`). No parent writes.

**VERDICT: ACCEPT.** All eight criteria hold under independent check. One forward finding confirmed
and handed to P2-04.

---

## 1. Verified independently

| Check | Result |
|---|---|
| **Exactly one function per name — no overloads** | ✅ all three at 1, signatures unchanged |
| Module gate removed from `tenant_business_date` | ✅ no `tenant_has_module_for` / `tenant_modules` reference |
| Tenant fence retained | ✅ `can_access_tenant` still present |
| `search_path` still pinned | ✅ `SET search_path TO ''` |
| Scope | ✅ `caf9ec6` touches exactly its two allowed files |
| **Fixtures restored after the Attendance-off test** | ✅ both tenants back to 11 modules, attendance on, payroll/insurance off |
| `anon` EXECUTE | ✅ denied (401, no token) |
| Own-tenant call | ✅ `"2026-09-14"` |
| **Cross-tenant call** (employee.b → Company A) | ✅ `null` — fence holds, no data and no error leak |
| RLS invariant | ✅ **1 / 2 / 0** unchanged |
| Policy drift | ✅ 50 of 311 — unchanged, no new untracked policies |
| `npm run build` | ✅ clean |
| Schedule | ✅ still branch host, still `isActive: false` |

The change itself is as surgical as it should be: one `AND tenant_has_module_for(...)` clause
removed, everything else byte-identical. Nothing else in the function moved.

---

## 2. The finding that justified the package

The implementer discovered empirically — with a throwaway probe, not from documentation — that
`CREATE OR REPLACE FUNCTION` **with an appended DEFAULT parameter does not replace a function; it
creates a second overload.** Their first draft added an optional `p_employee_id` that way, which
would have left the attendance-gated 2-argument function live alongside a new ungated 3-argument one:
**two live sources of business date, disagreeing silently, with resolution depending on how each
caller happened to bind its arguments.**

They caught it before applying and rewrote as a body-only replace on the exact existing signature.
I confirmed the outcome: one function per name.

This is precisely the failure the brief was written to prevent, and it was found by running a probe
rather than by reasoning. Worth recording as a repository-level trap — it will recur the next time
any lane wants to extend a shared function's arguments.

---

## 3. Decision recorded: module gating of shared primitives

The implementer took the position the brief proposed and documented it in the database via
`COMMENT ON FUNCTION` on all three: **a date/calendar primitive is infrastructure, gated on tenant
access only, never on module entitlement. Consumers enforce their own module state.**

The structural guarantee is that none of the three now references `tenant_has_module_for` or
`tenant_modules` at all — verified. `work_calendar` remains a real module key; it gates the
Shift/Calendar/Holiday **UI screens**, not the DB primitive, which is consistent.

§12.7 ("Leave-only … fixtures work without unrelated modules") is now satisfiable for the date basis.

---

## 4. Honest gaps, accepted as stated

- **AC1 partially exercised.** `tenant_business_date` went `null` → `2026-09-14` with Attendance
  disabled, which is the fix. The full `employee_apply_leave_request` workflow was not run: Company A
  has no `leave_types` seeded, and that function does not call this resolver anyway (see §5).
- **AC5 partly UNTESTED.** `attendance_derive_pass1`/`pass2`/`attendance_run_scheduled_derivation`
  were not executed, because running them mutates attendance state and the hourly schedule is
  deliberately deactivated. Compatibility argued structurally (unchanged signatures, one function
  each). Reasonable, and correctly labelled rather than inferred.
- **`branch reset` vs. T0 schedule config remains unmeasured.** Still owed by whichever lane first
  runs a reset.

---

## 5. Forward finding — confirmed, owned by P2-04

`employee_apply_leave_request` **duplicates day-counting**. Verified directly against the live
function body:

```
calls work_calendar_holiday:       false
calls work_calendar_working_days:  false
reads holidays directly:           true
reads holiday_calendar_days:       false
```

So it reads only the tenant-default holiday tier and never sees named calendars. A tenant using a
shift- or employee-assigned holiday calendar gets **a different holiday answer from a leave request
than from the shared resolver** — a second source of truth for the same question, which is the exact
class of defect P2-01 existed to remove.

P2-04 owns converging it. This is a correctness bug today, not a refactor.

---

## 6. Status

P2-01 accepted. Next in the ordering is **P1-03** (`20260912183000`, dated organization transfer),
which consumes this primitive — it must call `tenant_business_date`, not re-derive dates.

Carry forward for any lane touching attendance: the `attendance-derivation-hourly` schedule is
repointed to the branch host and **inactive**. Re-enable deliberately, re-verify the host, and
measure whether `branch reset` re-arms it.
