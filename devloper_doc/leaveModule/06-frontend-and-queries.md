# 06 - Leave Module: Frontend & Common Queries

---

## 1. The Screens

| Route | File | Who | What |
|---|---|---|---|
| `/employee/leaves` | `src/employee/MyLeaves.tsx` | Employee | Apply, see balances, cancel a pending request |
| `/hr/leaves` | `src/hr/LeaveManagement.tsx` | HR | Approve/reject, manage types, manage balances |

---

## 2. Writing: always through an RPC

**Never write `leaves`, `leave_types` or `leave_balances` with `.insert()` / `.update()`.** A status change without the matching balance movement corrupts every future application, and since `20260831100000` the RLS will refuse most of these anyway.

### Apply for leave
```typescript
const { data, error } = await db.rpc("employee_apply_leave_request", {
  p_tenant_id: tenantId,
  p_employee_id: employee.id,
  p_leave_type_id: form.leave_type_id,   // the UUID, never the legacy text column
  p_start_date: form.start_date,
  p_end_date: form.end_date,
  p_reason: form.reason,
});
```
Validates notice period, consecutive-day cap, probation restriction and available balance, then reserves `pending_days`.

### Approve / reject (HR)
```typescript
await db.rpc("approve_leave_request", { /* … */ });
```
Moves `pending_days → used_days`, sets the status, **and writes the attendance rows** for the covered days.

### Cancel
```typescript
await db.rpc("employee_cancel_pending_leave", { /* … */ }); // employee, own pending request
await db.rpc("cancel_leave_request",          { /* … */ }); // HR, incl. already-approved
```
Both return the reserved or used days to the balance.

> Check parameter names against the live signature before wiring a new call:
> ```bash
> npx @insforge/cli db query "select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname like '%leave%'" --json
> ```

---

## 3. Reading

### My balances this year
```typescript
const year = new Date().getFullYear();
const { data } = await db
  .from("leave_balances")
  .select("id, leave_type_id, total_allocated, carried_forward, used_days, pending_days, balance")
  .eq("tenant_id", tenantId)
  .eq("employee_id", employee.id)
  .eq("year", year);
```
Show `balance` as "available". Showing `total_allocated - used_days` is wrong — it ignores `pending_days` and lets someone apply for days already spoken for.

### The types an employee may pick
```typescript
const { data } = await db
  .from("leave_types")
  .select("id, name, code, days_per_year, is_paid, requires_document, min_notice_days, max_consecutive_days")
  .eq("tenant_id", tenantId)
  .eq("is_active", true)
  .order("sort_order");
```

### My leave history
```typescript
const { data } = await db
  .from("leaves")
  .select("id, start_date, end_date, total_days, approved_business_days, day_fraction, status, reason, rejection_reason, leave_type:leave_type_id (name, code, is_paid)")
  .eq("tenant_id", tenantId)
  .eq("employee_id", employee.id)
  .order("start_date", { ascending: false });
```

### Pending requests for HR
```typescript
const { data } = await db
  .from("leaves")
  .select("*, employee:employee_id (id, full_name, employee_code), leave_type:leave_type_id (name, is_paid)")
  .eq("tenant_id", tenantId)
  .eq("status", "pending")
  .order("applied_at");
```

---

## 4. Diagnostics

### "The employee can't apply"
Run these in order — one is nearly always the answer.
```sql
-- 1. is there a balance row at all for this year? (most common cause)
select * from leave_balances
where employee_id = '<emp>' and year = extract(year from now())::int;

-- 2. what does the type actually require?
select name, min_notice_days, max_consecutive_days, probation_restricted,
       applicable_from_day, is_active
from leave_types where id = '<type>';

-- 3. is the balance already spoken for by pending requests?
select total_allocated, carried_forward, used_days, pending_days, balance
from leave_balances where employee_id = '<emp>' and leave_type_id = '<type>';

-- 4. is the module even on?
select tenant_has_module_for('<tenant>', 'leave');
```

### Ledger consistency check
There is no database constraint enforcing this, so it is worth running after any change to the leave RPCs:
```sql
select employee_id, leave_type_id, year,
       total_allocated, carried_forward, used_days, pending_days, balance,
       (total_allocated + carried_forward - used_days - pending_days) as expected
from leave_balances
where balance is distinct from (total_allocated + carried_forward - used_days - pending_days);
-- any row returned = a desynchronised ledger
```

### Approved leave not showing as `on_leave` in attendance
```sql
-- is the leave actually approved and covering that date?
select id, status, start_date, end_date, day_fraction
from leaves
where employee_id = '<emp>' and '<date>' between start_date and end_date;

-- has derivation run over that day since the approval?
select from_date, to_date, status, started_at
from attendance_derivation_runs
order by started_at desc limit 5;
```
Approving leave writes the attendance row immediately, but a **later** derivation run re-derives the day. If the day is `is_locked` (an HR correction), derivation will skip it and the leave will not appear — that is intentional.

### Snapshot
```sql
select
  (select count(*) from leave_types  where is_active)      as active_types,
  (select count(*) from leaves where status = 'pending')   as pending_requests,
  (select count(*) from leaves where status = 'approved')  as approved,
  (select count(*) from leave_balances)                    as balance_rows,
  (select count(*) from leave_balances where balance < 0)  as negative_balances;
```
`negative_balances > 0` means something wrote a balance without going through the RPCs.
