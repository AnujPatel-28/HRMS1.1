# P6 PACKAGE REVIEW — P1-03

Reviewer: Opus 5, PACKAGE mode (independent of the implementer)
Date: 2026-09-14 IST
Under review: commit `93b4e03`, base `f79601b`
Target: `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`). No parent writes.

**VERDICT: ACCEPT.** AC1–AC6 PASS, AC7 PARTIAL and correctly so. One observation added that the
implementer did not make.

---

## 1. Verified independently

| Check | Result |
|---|---|
| Scope | ✅ exactly the two allowed files |
| `is_manager_of` — only `primary` grants scope | ✅ `relationship_type = 'primary'` required; `secondary_manager_id` gone from the grant path |
| Dated comparison uses P2-01's primitive | ✅ `tenant_business_date(me.tenant_id, now())`, not `CURRENT_DATE` |
| **Interval semantics match the constraint** | ✅ resolver is `from <= D AND (to IS NULL OR to > D)`; constraint is `daterange(..., '[)')` — both half-open |
| Overlap guard | ✅ GIST `EXCLUDE ... daterange(effective_from, effective_to, '[)') WITH &&` scoped to active primaries |
| Old weak index removed | ✅ `employee_reporting_one_active_primary` gone |
| **Overload count** | ✅ exactly 1 each for `is_manager_of`, `update_employee_reporting_relationship`, `tenant_business_date` |
| `anon` EXECUTE | ✅ none on any of the three |
| CHECK constraint | ✅ now permits all six contract types |
| No policy DDL in the migration | ✅ zero `CREATE/ALTER/DROP POLICY`; drift unchanged at 50 of 311 |
| Suite run by the reviewer | ✅ exit 0 |
| **RLS invariant after teardown** | ✅ **1 / 2 / 0**, relationship rows back to 8 |
| `npm run build` | ✅ clean |

A note on method: mid-suite I measured 4 / 9 / 0 and did **not** record it as a regression — the
suite was still running and creating fixtures. Re-measured after completion: 1 / 2 / 0, row count
back to its starting 8. Teardown is genuinely clean, which is the part a hurried package gets wrong.

---

## 2. The defect that justified the package

`is_manager_of` never checked `relationship_type`. Measured before the change: 7 `primary` rows with
6 effective, and **1 `secondary` row currently effective** — so a secondary manager held full
direct-report scope over their employee, reading attendance and leave as a manager. A `mentor` or
`reviewer` row would have done the same. That is closed.

The interval fix is the part worth understanding. The old guard was a unique index predicated on
`effective_to IS NULL`, which prevents two *open-ended* primaries and nothing else; closed intervals
could overlap freely. AC4's boundary case — outgoing `effective_to = D`, incoming `effective_from = D`
— left both effective on D because the resolver's predicates were inclusive at both ends. The fix is
not the constraint syntax but the **decision to make intervals half-open and to change the resolver
to match**. Constraint and resolver now agree, which is what makes exactly one manager resolve on D.

---

## 3. Observation the implementer did not make

**The legacy `manager_id` fallback is currently dead code.** Measured:

```
employees with manager_id set and no primary-type row: 0
```

Every employee with `manager_id` already has a `primary` row, so the fallback branch is unreachable
today, on every tenant. That makes it safe — but it is an untested branch that grants direct-report
scope from something other than a `primary` row, which is the exact shape AC3 exists to forbid.

Not blocking, and I would not remove it inside this package. It needs a **removal trigger**: once a
migration asserts that no employee has `manager_id` without a matching `primary` row, the branch
should go. Recorded for whichever package next touches employee creation.

---

## 4. AC7 PARTIAL — correct, not a shortfall

The cross-tenant half passes (manager and unit IDs from another tenant are rejected server-side). The
org-unit-overlap half is **structurally untestable**: `employees.org_unit_id` is a single current FK
and no dated unit-assignment table exists, so two overlapping unit assignments cannot be represented.

The implementer verified this against `information_schema` before writing the migration and declined
to build a dated unit-assignment table, on the grounds that it is new product surface rather than the
measured defect. That is the right call — the v0.5 preamble says packages address measured defects,
and inventing a table to satisfy a sub-clause is scope invention.

If dated org-unit placement is wanted, it is its own package with its own contract review.

---

## 5. Deferred, and agreed

`create_employee_transaction` still sources its initial primary row's `effective_from` from
`CURRENT_DATE` rather than `tenant_business_date`. Real, minor, and left alone deliberately: it keeps
the legacy column and the relationship table in sync regardless, and that function has broken
onboarding twice before from unrelated edits. Recorded in the migration header.

**Do not fix this as a drive-by.** It belongs in a small deliberate package with an onboarding smoke
test either side, exactly as the four limiter edits were handled.

---

## 6. Status

P1-03 accepted. P1 is complete: P1-00 closed at reduced scope, P1-01, P1-02 and P1-03 all accepted.

Next in the ordering is **P2-02** (`20260912184000`, attendance/correction consistency and exclusive
punch-out gate ownership) — the highest-risk remaining package, since it owns a gate that has already
had a client-policy hole once.

Standing items for any attendance lane: `attendance-derivation-hourly` is repointed to the branch host
and **inactive**; re-enable deliberately and re-verify the host. Whether `branch reset` re-arms it is
still unmeasured.
