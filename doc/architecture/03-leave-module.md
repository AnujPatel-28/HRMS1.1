# 03 — Leave module (Phase 1, first module rebuilt)

**Inspiration:** Frappe HRMS `leave_ledger_entry` / `leave_allocation` / `leave_period` /
`leave_policy_assignment`. We studied the *model*; the code is Python/Frappe and irrelevant to us. No
code is copied.

---

## 1. Why Leave is first

- It has a **verified live defect** (§2.1), not a suspected one.
- It is **self-contained** — no other module writes its tables.
- It establishes the **ledger pattern** (P3) that Payroll needs at the end.
- It is Payroll's input (LOP days). Rebuilding Payroll first means building on numbers we know are wrong.

> **Ships together with the approval-chain engine** (`04-configurability.md` §2). Leave approval is the
> archetypal HR workflow, so it is the engine's first consumer. Building the ledger now and re-plumbing
> approval later is rework we can simply decline to book. Concretely: §5's *Approve* step is driven by a
> configured chain rather than a hardcoded `is_hr()` check, and the migration seeds every existing tenant
> with a single-step `role:hr_admin` chain so **behaviour is identical on day one**.

The existing implementation is *not* bad — `system-audit-2026-08/03-modules.md` calls it
"best-in-codebase", and that is fair: the RPCs are transactional, row-locked, overlap-checked, and
notice-validated. **We are not rebuilding it because it is sloppy.** We are rebuilding the *storage
model* because a stored counter cannot support audit, correction, or mid-year policy change. The
workflow logic largely survives.

---

## 2. What is actually wrong today

### 2.1 `balance` has already drifted in production — verified

`fn_accrue_monthly_leaves` does:

```sql
UPDATE public.leave_balances
SET balance = balance + (v_rec.days_per_year / 12.0),
    last_accrual_date = CURRENT_DATE
WHERE id = v_rec.id;
```

It increments `balance` but never `total_allocated`. So `balance` stops equalling
`total_allocated + carried_forward - used_days`. Live check, 2026-08-14:

```
total_rows  balance_not_derivable  accrued_rows
10          2                      2
```

Both drifted rows are exactly the accrued ones. There is no way to reconstruct the correct value,
because nothing recorded *why* the number changed.

### 2.2 It is **not** a concurrency bug — correcting the record

`session_context_2026-08-13.md` states concurrent approvals can corrupt balances. **That is wrong.**
`approve_leave_request` and `cancel_leave_request` both take `FOR UPDATE` before mutating. The bare
increment in `fn_accrue_monthly_leaves` is a single atomic statement and is not lost-update-prone
either.

The problem is **auditability and reconstructability**, not races. Designing for concurrency would have
fixed nothing. (P4.)

### 2.3 Half-day leave is impossible

`leaves.total_days` and `leaves.approved_business_days` are **`integer`**. `leave_balances` columns are
`numeric`. Attendance already supports `half_day` status with a `half_day_cutoff_override` per shift —
so an employee can be marked half-day present but cannot *apply* for half-day leave. This is the single
most commonly requested leave feature in an Indian HRMS and the schema forbids it.

### 2.4 Dual representation of leave type

`leaves` carries both `leave_type text` (legacy enum: `casual | sick | earned | ...`) and
`leave_type_id uuid` → `leave_types`. Two sources of truth for the same fact.

### 2.5 No leave period

`leave_balances.year` is an `integer`. That hardcodes a calendar-year cycle, cannot express an
April–March financial year (the Indian norm), and makes mid-year policy changes and carry-forward
awkward.

---

## 3. Target design

**One idea:** a balance is a `SUM` over immutable entries. Nothing ever updates a balance.

```
leave_periods        — the cycle (e.g. FY 2026-27, Apr 1 – Mar 31)
leave_types          — unchanged, already good
leave_allocations    — "you were granted N days of type T for period P"
leave_ledger_entries — append-only: every +/- with a reason and a source
leaves               — the application/workflow record (unchanged in spirit)
```

`leave_balances` becomes a **view**, not a table.

### Why a ledger

| Question | Counter | Ledger |
|---|---|---|
| "Why is my balance 12.5?" | unanswerable | list the entries |
| Reverse a wrongly-approved leave | subtract and hope | append a reversing entry |
| Mid-year policy change | rewrite balances | new allocation, old entries stand |
| Did accrual run twice? | invisible | duplicate entries, visible |
| Audit / dispute | no history | complete history |

---

## 4. Schema

```sql
CREATE TABLE public.leave_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id),
  name       text NOT NULL,                 -- 'FY 2026-27'
  start_date date NOT NULL,
  end_date   date NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  CONSTRAINT leave_periods_range CHECK (end_date > start_date)
);

CREATE TABLE public.leave_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id),
  employee_id   uuid NOT NULL REFERENCES public.employees(id),
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id),
  period_id     uuid NOT NULL REFERENCES public.leave_periods(id),
  total_days    numeric(6,2) NOT NULL,
  is_carry_forward boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, leave_type_id, period_id, is_carry_forward)
);

-- The core. Append-only. Never UPDATE, never DELETE.
CREATE TABLE public.leave_ledger_entries (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id),
  employee_id   uuid NOT NULL REFERENCES public.employees(id),
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id),
  period_id     uuid NOT NULL REFERENCES public.leave_periods(id),
  days          numeric(6,2) NOT NULL,      -- +granted / -consumed
  entry_type    text NOT NULL CHECK (entry_type IN
                  ('allocation','accrual','consumption','reversal',
                   'carry_forward','encashment','lapse','adjustment')),
  source_table  text,                       -- 'leaves'
  source_id     uuid,                       -- the application it came from
  reversal_of   bigint REFERENCES public.leave_ledger_entries(id),
  note          text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_days_nonzero CHECK (days <> 0)
);

CREATE INDEX leave_ledger_balance_idx
  ON public.leave_ledger_entries (tenant_id, employee_id, leave_type_id, period_id)
  INCLUDE (days);
```

Immutability is enforced, not merely intended:

```sql
CREATE TRIGGER leave_ledger_append_only
BEFORE UPDATE OR DELETE ON public.leave_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
```

### The balance becomes a view

```sql
CREATE VIEW public.leave_balances_v AS
SELECT tenant_id, employee_id, leave_type_id, period_id,
       SUM(days)                                        AS balance,
       SUM(days) FILTER (WHERE days > 0)                AS credited,
       -SUM(days) FILTER (WHERE days < 0)               AS consumed
FROM public.leave_ledger_entries
GROUP BY tenant_id, employee_id, leave_type_id, period_id;
```

Pending applications are **not** ledger entries — a pending request has not consumed anything. Pending
days are computed from `leaves WHERE status='pending'` and shown separately, which removes the
`pending_days` counter and the "pending got stuck" class of bug entirely.

### Fixes to `leaves`

```sql
ALTER TABLE public.leaves
  ALTER COLUMN total_days             TYPE numeric(5,2),
  ALTER COLUMN approved_business_days TYPE numeric(5,2),
  ADD COLUMN start_session text CHECK (start_session IN ('full','first_half','second_half')),
  ADD COLUMN end_session   text CHECK (end_session   IN ('full','first_half','second_half'));
-- legacy `leave_type text` is dropped once backfilled into leave_type_id
```

---

## 5. Workflow

### Apply
```
employee → employee_apply_leave_request(...)
  validate: overlap, notice days, max consecutive, probation, document
  compute business days from holidays + weekly-off + sessions
  INSERT leaves (status='pending')
  ── no ledger entry ──
```

### Approve
```
approver → approve_leave_request(leave_id, days)
  re-check status = 'pending'                      (idempotency)
  verify caller is the resolved approver for the
    current open step in approval_requests         (not a hardcoded is_hr())
  mark that step approved
  IF more steps remain:
     open the next step, resolve its approver, STOP  -- leave stays 'pending'
  ELSE:
     balance := SELECT balance FROM leave_balances_v ...
     IF balance < days AND leave_type.is_paid THEN reject
     INSERT leave_ledger_entries (days = -days, entry_type='consumption',
                                  source_table='leaves', source_id=leave_id)
     UPDATE leaves SET status='approved'
     generate attendance rows
```
The ledger entry is written **only on final approval**, never per step — an intermediate approval must
not consume balance. Multi-step chains are why the balance check belongs at the last step: checking
earlier would reserve days that a later rejection would have to release.
No `FOR UPDATE` on a balance row is needed — there is no row to lock. Correctness comes from the
insert-only model plus the status re-check, which is what actually prevents double-approval.

### Cancel an approved leave
```
HR/employee → cancel_leave_request(leave_id)
  find the consumption entry for this leave
  INSERT reversal (days = +days, entry_type='reversal', reversal_of=<id>)
  UPDATE leaves SET status='cancelled'
```
The original entry is never touched. The history reads: granted, consumed, reversed.

### Accrual
```
monthly → fn_accrue_monthly_leaves()
  for each active allocation with accrual_type='monthly':
    skip if an 'accrual' entry already exists for this month  ← idempotent
    INSERT (days = +days_per_year/12, entry_type='accrual')
```
The duplicate guard is what the current counter version cannot express — running twice today silently
double-credits.

> **Note:** there are **no cron schedules configured** on this project. `fn_accrue_monthly_leaves` is
> not running. Accrual must be wired to a schedule when this ships, or balances simply never grow.

### Period rollover
```
year end → close period P, open P+1
  lapse:         INSERT (days = -remaining, entry_type='lapse')      -- if no carry-forward
  carry forward: INSERT (days = -moved,     entry_type='carry_forward') in P
                 INSERT (days = +moved,     entry_type='carry_forward') in P+1
                 capped by leave_types.carry_forward_max_days
```
Both sides recorded, so the two periods reconcile.

---

## 6. Migration path

Non-destructive, reversible, no downtime. `leave_balances` is kept until the view is proven.

1. Create `leave_periods`, `leave_allocations`, `leave_ledger_entries` + the append-only trigger.
2. Seed one period per tenant from existing `leave_balances.year`.
3. **Backfill** — for each of the 10 existing rows, emit an opening-balance entry:
   `(days = total_allocated + carried_forward, entry_type='allocation', note='migrated opening balance')`
   and `(days = -used_days, entry_type='consumption', note='migrated')`.
   For the 2 drifted rows, emit an explicit `adjustment` entry carrying the difference, with a note
   naming the accrual drift. **The drift is recorded, not silently absorbed** — that is the whole point.
4. Create `leave_balances_v`. Assert it equals `leave_balances.balance` for all 10 rows *except* the 2
   known-drifted, where it equals the reconstructed value.
5. Rewrite the RPCs to write ledger entries.
6. Point the UI at the view.
7. Drop `leave_balances` in a **later** migration, only after a period of both being live.

10 rows makes this trivially verifiable by hand — which is the best possible time to do it. At 10,000
rows this becomes a project.

---

## 7. Edge cases this must handle

Explicitly listed because "many edge cases" was the original concern. Each needs a test.

| Case | Handling |
|---|---|
| Half-day at start/end of range | `start_session`/`end_session`, `numeric(5,2)` days |
| Leave spanning a holiday or weekly-off | business-day computation excludes both |
| Leave spanning a period boundary | split into two applications; ledger entries land in their own periods |
| Approve twice (double-click / retry) | status re-checked inside the RPC; second call is a no-op |
| Cancel an already-cancelled leave | status re-check; no second reversal |
| Cancel a *partially elapsed* leave | reverse only future days — **decision needed**, see §9 |
| Accrual runs twice in a month | duplicate guard on `(employee, type, period, month)` |
| Accrual for a mid-month joiner | pro-rate from `date_of_joining` |
| Employee exits mid-period | encashment or lapse entry at settlement |
| Unpaid leave | `leave_types.is_paid = false` → no balance check, still ledgered for LOP |
| Balance goes negative | permitted only where the type allows it; otherwise blocked at approval |
| Backdated application | allowed for HR, blocked for employees past `min_notice_days` |
| Leave type deactivated mid-period | existing entries stand; no new applications |
| Probation restriction | `probation_restricted` checked against `employees.probation_status` |

---

## 8. Scalability

Per **P7** this is not a performance problem today — 3 leaves, 10 balance rows. The ledger is chosen for
correctness. What keeps it from becoming one later:

- Balance is an aggregate over a covering index
  (`tenant_id, employee_id, leave_type_id, period_id` `INCLUDE (days)`). Entries per employee per type
  per period are bounded by roughly `12 accruals + N applications` — tens, not thousands.
- Periods bound growth naturally: old periods are never re-summed for a current balance.
- If aggregate cost ever matters, add a materialized snapshot **per closed period**. Do not add a
  cached current balance — that reintroduces exactly the counter this design removes.

---

## 9. Open decisions — needed before implementation

1. **Cancelling a partially-elapsed leave.** If 5 days were approved and 2 are taken, does cancelling
   return 5 or 3? Frappe returns unused days only. Recommend matching that, but it is a policy call.
2. **Leave period basis.** Calendar year (current, implied by `year integer`) or April–March financial
   year? Affects every tenant's rollover. Recommend FY, configurable per tenant.
3. **Negative balances.** Permit for any type, only for specific types, or never?
4. **Who may adjust.** `entry_type='adjustment'` is a manual correction. HR, or platform admin only?

These are genuinely business decisions, not engineering ones. Implementation should not start until 1
and 2 are answered — they change the schema's semantics, not just its behaviour.
