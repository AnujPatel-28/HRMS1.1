# P6 PACKAGE REVIEW — P2-02 (high-risk)

Reviewer: Opus 5, PACKAGE mode (independent of the implementer)
Date: 2026-09-15 IST
Under review: commit `98aff7a`, base `fed661e`
Target: `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`). No parent writes.

**VERDICT: ACCEPT.** AC1–AC6 PASS under independent re-verification. The policy change flagged in the
implementer's report as "net removal of two policies" is correct hardening, not a regression — and it
is stronger than the report claims.

---

## 1. The line that needed checking first

The report says: *"total policies changed from 311 to 309 due to the intentional net removal of two
policies."* On the attendance path that is exactly the sentence a reviewer must not skim.

It is correct, and it is a **strengthening**. The migration drops five policies on
`attendance_corrections` and creates three:

```
dropped: _self, _insert_hr, _update_hr, _delete_hr, _select_hr
created: _select_self, _select_company_reviewer, _select_direct_report_reviewer
```

Final state, verified live:

| | |
|---|---|
| RLS enabled | ✅ |
| RESTRICTIVE policies | **2** — `tenant_isolation`, `module_enabled_attendance` (both fences intact) |
| PERMISSIVE policies | 3, **all SELECT** |
| INSERT / UPDATE / DELETE policies | **none — writes denied by default** |

So reads are policy-scoped and writes are forced through definer RPCs. That is the direct answer to
"RLS cannot scope columns," which is the lesson from the old hole where employees could write any
column on their own attendance row.

**Stronger than reported:** writes are also revoked at the GRANT level. `authenticated` now holds only
`SELECT, REFERENCES` on `attendance_corrections`. An employee attempting a direct insert gets
`42501 permission denied for table` — a privilege denial, not a policy denial. Even a later
mistakenly-permissive INSERT policy could not open the path. I confirmed this by attempting the write
as `employee.a`.

---

## 2. Verified independently

| Check | Result |
|---|---|
| Scope | ✅ exactly three files, all on the allowed list |
| **Edge pre-check untouched** | ✅ `functions/` has no diff — the enforcement boundary stayed in the database |
| Correction RPCs | ✅ all four `SECURITY DEFINER`, pinned `search_path`, no `anon` EXECUTE |
| Direct table write by an employee | ✅ denied, `42501` |
| Overload guard | ✅ nine named functions, exactly one copy each |
| Business-date convergence | ✅ `punch_in_attendance`, `punch_out_attendance`, `attendance_derive_pass1`, `attendance_derive_pass2` all use the primitive and no longer re-derive |
| Suite run by the reviewer | ✅ exit 0 |
| RLS invariant | ✅ **1 / 2 / 0** before fixtures and after teardown |
| Policy drift | ✅ 50 untracked of 309 — baseline unchanged, every new policy tracked |
| Schedule | ✅ branch host, `isActive: false` |
| `npm run build` | ✅ clean |

**`attendance_resolve_shift` still contains `AT TIME ZONE`, and that is correct.** Its business date
comes from `tenant_business_date` (line 20); the remaining conversions build shift *bounds* from
local wall-clock (`shift_date + start_time`) into instants. That is the opposite direction from
business-date derivation, and the primitive does not replace it. Not a leftover.

---

## 3. Scope discipline

Every file in `98aff7a` is on the allowed list, and the implementer correctly **reported rather than
reached** for two out-of-scope callers still re-deriving the business date:
`device_ingest_punch` (P2-03) and `fn_auto_redmark_tasks` (P3-02). Those are now known, owned, and
should be converged by their packages.

Three of five converged callers were beyond what the brief named — the brief listed
`punch_in_attendance`, `punch_out_attendance` and `attendance_derive_pass1` and explicitly said the
full enumeration was the implementer's first deliverable, because I could not obtain a reliable
count. That enumeration was done and is the right answer.

---

## 4. Outstanding, unchanged

- **`anon` holds `SELECT, REFERENCES` on `attendance_corrections`.** Pre-existing, not introduced
  here, and currently harmless — the RESTRICTIVE `tenant_isolation` policy denies every row to a
  principal with no tenant. It belongs to the deferred P1-00 criterion 5 grant/policy cleanup, not
  to this package.
- **Whether `branch reset` re-arms the schedule is still unmeasured.** No lane has run a reset yet.
- P6 independent review of this package is this document.

---

## 5. Status

P2-02 accepted. P2-03 remains blocked on hardware.

Next actionable is **P2-04** (`20260912186000`, leave approval and absence coverage), which inherits
three things already established:

1. **`on-leave-reviewed` disposition** — the local 410 stub is authoritative; the deployed 124-line
   copy is orphaned and marked DELETE (`reconciliation.md` §13). P2-04 owns executing that.
2. **`employee_apply_leave_request` duplicates day-counting** — it reads `holidays` directly and
   calls neither shared resolver, so it never sees named calendars (`reviews/package-review-P2-01.md`
   §5). A correctness bug today, not a refactor.
3. **`attendance_events` must survive leave projection** overwriting a derived attendance row — the
   evidence-preservation round trip.
