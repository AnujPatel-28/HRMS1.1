# Leave Module — Developer Documentation

| Doc | Read it when |
|---|---|
| [01 - Overview & Concepts](01-overview-and-concepts.md) | **Always first.** Includes the answer to *"isn't leave just part of attendance?"* |
| [02 - Database Schema & ER](02-database-schema-and-er.md) | You need to know which table holds what. |
| [03 - Setup & Workflow](03-setup-and-workflow.md) | You are configuring a tenant, or a request lifecycle is misbehaving. |
| [04 - Security & RLS](04-security-and-rls.md) | You are touching any write path. **Read §1 — a fence written as a grant.** |
| [05 - Seams with Attendance & Payroll](05-seams-with-attendance-and-payroll.md) | You are unsure where leave stops and another module starts. |
| [06 - Frontend & Common Queries](06-frontend-and-queries.md) | You need a working snippet right now. |

---

## Is leave part of attendance?

**No — they are peers.** The short version:

- `leave` and `attendance` are **separate first-class modules** in the registry. Either can be switched on without the other, and both combinations happen in real tenants.
- **Payroll reads leave directly**, not through attendance. If leave were a sub-part, it would have to go via attendance. It doesn't.
- Leave owns a domain attendance knows nothing about: entitlements, accrual, carry-forward, encashment, approval rules.
- The dependency is one-directional and narrow: attendance *reads* approved leave to decide a day's status. That is consumption, not containment — attendance also consumes shifts and holidays, and nobody calls those sub-parts of attendance.

**The test:** turn attendance off and leave still works. Turn leave off and attendance still works. Two things that each survive the other's removal are peers.

Full reasoning in `01`; the mechanics of the seam in `05`.

---

## The 60-second version

Three tables, three jobs:

```text
leave_types      the RULES     accrual, carry-forward, notice, paid?
leaves           the REQUESTS  pending → approved / rejected / cancelled
leave_balances   the LEDGER    allocated, carried forward, used, pending, balance
```

Three things to remember on day one:

1. **Never write `leaves.status` directly.** Every status change must move the balance with it. Use the RPCs — they are all `SECURITY DEFINER` and do both.
2. **A pending request already consumes balance** (`pending_days`), so nobody can apply for the same days twice. That also means rejection and cancellation must *return* the days.
3. **`approved_business_days`, not `total_days`,** is what comes out of the balance. A Friday-to-Monday request is 4 calendar days but often 2 working ones.

---

## ⚠️ Recently fixed, worth knowing

`leave_types` and `leave_balances` had their tenant fence written as a **PERMISSIVE** policy instead of **RESTRICTIVE**. In Postgres a permissive policy *grants*, so the "fence" handed every employee in the tenant full write access — they could set their own leave balance, edit a colleague's, or flip `is_paid` on a leave type, which feeds payroll.

Fixed in `20260831100000`. The lesson generalises to every table in this system, so it is written up in `04` §1.

---

## Where things live

```text
migrations/                            schema, policies, and the leave RPCs
src/employee/MyLeaves.tsx              apply, balances, cancel
src/hr/LeaveManagement.tsx             approve/reject, types, balances
```

Server functions (all `SECURITY DEFINER`):
```text
employee_apply_leave_request      approve_leave_request
employee_cancel_pending_leave     cancel_leave_request
save_leave_type_transaction       deactivate_leave_type_transaction
initialize_leave_balances_transaction
compute_initial_leave_balance     fn_accrue_monthly_leaves
```

## Related

- `devloper_doc/attendanceModule/` — consumes approved leave when deriving a day.
- `devloper_doc/organizationModule/` — employees, and the holidays used to compute working days.
