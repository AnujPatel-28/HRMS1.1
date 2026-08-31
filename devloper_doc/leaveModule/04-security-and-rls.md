# 04 - Leave Module: Security & RLS

Leave is a payroll input — `is_paid`, `approved_business_days` and the balance ledger all reach money. It needs the same care as attendance.

---

## 1. The bug this module taught us: a fence written as a grant

Fixed in `20260831100000`. Worth understanding, because the mistake is easy to repeat and invisible in review.

In Postgres:

- **PERMISSIVE** policies are **OR-ed**. Access is allowed if *any* of them passes. A permissive policy **grants**.
- **RESTRICTIVE** policies are **AND-ed**. They can only ever take access away. A restrictive policy **fences**.

A tenant isolation rule is a fence. Written as `PERMISSIVE`, it stops fencing and starts granting:

```sql
-- WRONG. This does not isolate the tenant -- it hands every employee in the tenant
-- full ALL access to every row, because a PERMISSIVE policy that passes GRANTS.
CREATE POLICY tenant_isolation ON leave_types
  FOR ALL USING (tenant_id = get_auth_tenant_id());

-- RIGHT.
CREATE POLICY tenant_isolation ON leave_types
  AS RESTRICTIVE FOR ALL USING (tenant_id = get_auth_tenant_id());
```

`leave_types` and `leave_balances` both had the wrong version. Combined with `authenticated` holding `UPDATE`/`DELETE` on those tables, **any logged-in employee could:**

- set their **own** leave balance to any number — unlimited leave, self-granted;
- edit a **colleague's** balance, since a tenant-only check does not care whose row it is;
- change `leave_types.days_per_year`, or flip `is_paid` — which feeds payroll;
- `DELETE` a leave type outright.

`leaves` itself was never affected: there `tenant_isolation` was correctly RESTRICTIVE.

### The tell-tale sign

`leave_balances` also had `leave_balances_hr_all` (is_hr) and `leave_balances_self` (own row). Both were **completely redundant** — the permissive tenant policy already granted more than either.

> **If a table has carefully-scoped policies sitting next to a broad permissive one, the narrow ones are decoration.** That redundancy is the symptom. When you see it, check whether the broad policy should have been restrictive.

### How to check any table
```sql
select tablename, policyname, permissive, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = '<table>'
order by permissive desc;
```
Read it as: *"is there any PERMISSIVE policy here that grants writes without checking a role?"* If yes, every authenticated user in the tenant has that capability.

---

## 2. Current policy shape

| Table | Fence | Who can write | Who can read |
|---|---|---|---|
| `leaves` | RESTRICTIVE tenant + module | HR (`leaves_hr_all`); employees may INSERT their own | Self, their manager, HR |
| `leave_types` | RESTRICTIVE tenant + module | HR only (`leave_types_hr_all`) | Everyone in the tenant (the apply form needs the list) |
| `leave_balances` | RESTRICTIVE tenant + module | HR only (`leave_balances_hr_all`) | Own row, plus HR |

Employees can read leave types and their own balance. They cannot write either.

---

## 3. Why tightening this broke nothing

Every leave write already went through a `SECURITY DEFINER` RPC:

```text
employee_apply_leave_request      cancel_leave_request
employee_cancel_pending_leave     save_leave_type_transaction
approve_leave_request             deactivate_leave_type_transaction
fn_accrue_monthly_leaves          initialize_leave_balances_transaction
```

Definer functions run as the **owner**, so RLS does not apply to them at all — they were never relying on the permissive grant. And an exhaustive scan of `src/` found **zero** direct writes to `leave_types` or `leave_balances`.

So the blanket grant was pure attack surface: capability nobody legitimate was using.

> **The general lesson:** if every write goes through a definer RPC, the table's write policies protect nothing except against direct API abuse — which is exactly the case they must be written for.

---

## 4. `SECURITY DEFINER` bypasses RLS. Completely.

The same rule as everywhere else in this codebase. Inside a definer function there is no tenant fence, no module gate, no row filtering — unless you write it yourself:

```sql
PERFORM assert_hr_for_tenant(p_tenant_id);   -- HR operations
-- or, for employee operations, resolve the caller's own employee row
-- and compare it to the row being touched.
```

If you add a leave RPC, the ownership check is **your** job. A function that trusts a `p_employee_id` parameter without checking it belongs to the caller lets anyone apply for, cancel, or approve leave as anyone else.

---

## 5. What still needs attention

- **`leaves.status` has no trigger protecting it.** HR can `UPDATE` the table directly through the API and move a leave to `approved` **without** the balance moving with it. Nothing stops this; the RPC convention is the only protection. A trigger that rejects direct status changes would close it properly.
- **Balance arithmetic is not enforced by constraints.** There is no check that `balance = total_allocated + carried_forward - used_days - pending_days`. A bug in any RPC can silently desynchronise the ledger, and nothing will complain.
- **`fn_accrue_monthly_leaves` may not be scheduled.** See `03-setup-and-workflow.md` §1 — an accrual function that nothing calls means balances silently never grow.
