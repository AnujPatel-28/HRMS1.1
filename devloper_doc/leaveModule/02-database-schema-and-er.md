# 02 - Leave Module: Database Schema & ER

Three tables carry the whole module. Every one is tenant-scoped and fenced by RESTRICTIVE RLS.

---

## 1. The Map

```text
┌──────────────────┐
│   leave_types    │  the RULES  (per tenant)
│  Casual / Sick / │  accrual, carry-forward, notice, paid?
│  Earned / LOP    │
└────────┬─────────┘
         │
    ┌────┴──────────────────────────┐
    │                               │
┌───▼──────────────┐      ┌─────────▼─────────┐
│     leaves       │      │  leave_balances   │
│  the REQUESTS    │─────►│  the LEDGER       │
│  pending →       │      │  per employee,    │
│  approved /      │      │  per type,        │
│  rejected /      │      │  per year         │
│  cancelled       │      └───────────────────┘
└───┬──────────────┘
    │  leave_id  (attendance records WHY a day was on_leave)
    ▼
┌──────────────────┐
│   attendance     │   ← a different module. It reads; it never writes here.
└──────────────────┘
```

---

## 2. `leave_types` — the rules

One row per kind of leave the tenant offers.

| Column | Meaning |
|---|---|
| `name`, `code` | "Casual Leave", `CL` |
| `days_per_year` | The annual entitlement |
| `accrual_type` | Whether the entitlement lands at once or accrues over the year |
| `carry_forward_enabled` / `carry_forward_max_days` | Whether unused days survive into next year, and the cap |
| `encashment_enabled` | Whether unused days can be paid out |
| `applicable_from_day` | Waiting period before an employee may use it |
| `probation_restricted` | Blocked while the employee is on probation |
| `requires_document` | e.g. a medical certificate for sick leave |
| `min_notice_days` | How far ahead they must apply |
| `max_consecutive_days` | Longest single stretch allowed |
| `is_paid` | **Feeds payroll.** Unpaid leave (LOP) is still leave — it is just not paid |
| `is_active`, `sort_order` | Display and archival |

> `is_paid` is the single most payroll-relevant field in the module. An unpaid leave day is *not* an absence — the employee had permission. Do not conflate them.

---

## 3. `leaves` — the requests

One row per application, whatever its outcome.

| Column | Meaning |
|---|---|
| `employee_id` | Who applied |
| `leave_type_id` | **The FK to `leave_types`. Use this one.** |
| `leave_type` | ⚠️ Legacy `text` column — see the gotcha below |
| `start_date`, `end_date` | The requested range (inclusive) |
| `total_days` | Calendar days requested |
| `approved_business_days` | Working days actually approved, after weekends and holidays are removed |
| `day_fraction` | `numeric`, default `1.0`. `0.5` is a half day |
| `status` | `pending` \| `approved` \| `rejected` \| `cancelled` |
| `reason`, `rejection_reason` | Free text |
| `reviewed_by`, `reviewed_at`, `applied_at` | Audit trail |

### ⚠️ Two leave-type columns

`leaves` carries **both** `leave_type` (text) and `leave_type_id` (uuid FK). This is a half-finished migration from named strings to proper foreign keys — at time of writing, all rows have the text value and only some have the FK.

**Always write and read `leave_type_id`.** The application uses it exclusively. `leave_type` remains only so old rows are still readable.

> This is the same family of trap as `is_late` / `late_entry` in the attendance module: a legacy column kept alive next to its replacement. Both are safe as long as you know which one is authoritative. Neither should be "cleaned up" casually — check every consumer first, including payroll.

### `total_days` vs `approved_business_days`

Do not treat these as interchangeable.

- `total_days` — the raw span the employee asked for. A Friday-to-Monday request is 4 days.
- `approved_business_days` — what actually comes out of the balance once weekends and holidays are excluded. The same request might be 2.

**Payroll and balances care about `approved_business_days`.** `total_days` is closer to a display value.

---

## 4. `leave_balances` — the ledger

One row per **employee + leave type + year**.

| Column | Meaning |
|---|---|
| `total_allocated` | Entitlement for the year |
| `carried_forward` | Brought in from last year, subject to the type's cap |
| `used_days` | Approved and taken |
| `pending_days` | **Applied for but not yet decided** |
| `balance` | What is genuinely still available |
| `last_accrual_date` | Watermark for monthly accrual, so it cannot run twice for the same month |

### Why `pending_days` exists

Without it, an employee could apply for the same ten days three times while all three sit unapproved, and every check would pass because nothing had been "used" yet. Reserving on application closes that.

It also means **rejection and cancellation must return the days** — a status change alone leaves the balance permanently short. This is exactly why status must never be written directly.

---

## 5. Where leave touches other modules

| Table / column | Module | Direction |
|---|---|---|
| `attendance.leave_id` | Attendance | Attendance records *why* a day was `on_leave` |
| `attendance.status = 'on_leave'` | Attendance | Written by derivation after reading leave |
| `leaves.day_fraction` | Attendance | Half-day leave halves the day's hour thresholds |
| `leaves` (direct read) | Payroll | `payroll_period_input` reads leave itself, not via attendance |
| `holidays` / calendars | Work Calendar | Used to compute `approved_business_days` |

See `05-seams-with-attendance-and-payroll.md` for how each of these actually behaves.
