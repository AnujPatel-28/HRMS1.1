# 03 - Leave Module: Setup & Workflow

---

## 1. Configuration Sequence

### Step 1 — Employees and the work calendar exist
Leave depends on the organisation module (who the employees are) and on holidays, because `approved_business_days` is computed by removing weekends and holidays from the requested range. Wrong holidays → wrong balance deductions.

### Step 2 — Define leave types (`/hr/leaves` → `LeaveManagement.tsx`)
One per kind of leave. The fields are listed in `02-database-schema-and-er.md` §2. The two with the widest blast radius:

- **`is_paid`** — feeds payroll. Unpaid leave is still leave, just unpaid.
- **`days_per_year` + `accrual_type`** — decides whether the whole entitlement lands on day one or accrues monthly.

Saving a type goes through `save_leave_type_transaction()`, not a plain insert, because creating a type may also need to seed balances.

### Step 3 — Initialise balances
`initialize_leave_balances_transaction()` creates the per-employee, per-type, per-year ledger rows. `compute_initial_leave_balance()` works out the opening figure, including any pro-rating for someone who joined mid-year.

> **A missing balance row is the most common cause of "the employee can't apply".** No ledger row means no balance to check against.

### Step 4 — Accrual runs over time
`fn_accrue_monthly_leaves()` tops up balances for types that accrue monthly. `leave_balances.last_accrual_date` is the watermark that stops the same month being credited twice.

⚠️ **Check whether anything actually calls this.** Accrual only happens if something invokes it on a schedule. If no schedule exists, balances stay at their opening value forever — and nobody notices until an employee runs out of leave they should have earned. This is the same class of gap that left attendance derivation unscheduled for several months.

---

## 2. The Request Lifecycle

```text
   EMPLOYEE                        HR                          BALANCE
   ─────────                       ──                          ───────
   applies
   employee_apply_leave_request()                              pending_days +N
        │
        ├──► status = pending
        │
        │                    approve_leave_request()           pending_days −N
        │                    ────────────────────►             used_days   +N
        │                                                      balance     −N
        │                    status = approved
        │
        │                    (or) reject                       pending_days −N
        │                                                      balance restored
        │
   employee_cancel_pending_leave()                             pending_days −N
   cancel_leave_request()                                      balance restored
```

**Every transition moves the ledger.** That is why none of these are plain `UPDATE`s.

### The RPCs

| Function | Who | What it does |
|---|---|---|
| `employee_apply_leave_request()` | Employee | Validates against the type's rules, reserves `pending_days` |
| `employee_cancel_pending_leave()` | Employee | Withdraws their own *pending* request, releases the reservation |
| `approve_leave_request()` | HR | Approves, moves pending → used, **and writes the attendance day** |
| `cancel_leave_request()` | HR | Cancels an approved leave, returns the days |
| `save_leave_type_transaction()` | HR | Creates/updates a type |
| `deactivate_leave_type_transaction()` | HR | Archives a type |
| `initialize_leave_balances_transaction()` | HR | Seeds the ledger |
| `compute_initial_leave_balance()` | internal | Opening balance, pro-rated |
| `fn_accrue_monthly_leaves()` | scheduled | Monthly top-up |

### What `approve_leave_request` validates

Approval is where the type's rules are actually enforced — notice period, maximum consecutive days, probation restriction, document requirement, and sufficient balance. An application that slipped past the UI still gets caught here.

> **A note on where this bit us:** `approve_leave_request` writes an attendance row for each approved day using `ON CONFLICT`. When the attendance module replaced its unique index with a shift-aware one, that conflict clause no longer matched any index and **HR leave approval broke in production**. An `ON CONFLICT` clause names no table, so searching for "attendance" would never have found it. If you change a unique index anywhere, grep the *conflict clauses*, not the table names.

---

## 3. Guardrails

| Action | Enforced by | What happens |
|---|---|---|
| Apply for more days than the balance | RPC | Rejected |
| Apply with less than `min_notice_days` notice | RPC | Rejected |
| Apply for more than `max_consecutive_days` | RPC | Rejected |
| Apply for a probation-restricted type while on probation | RPC | Rejected |
| Apply twice for the same days | `pending_days` reservation | The second application sees the reduced balance |
| Cancel someone else's leave | RPC ownership check | Rejected |
| Write `leaves.status` directly | ⚠️ **Nothing stops you** | The balance silently desynchronises. **Always use the RPCs.** |

That last row is the one to remember. There is no trigger protecting `leaves.status`. The protection is a convention, and conventions only hold if you know about them.

---

## 4. Half Days

`leaves.day_fraction` is `numeric` and defaults to `1.0`. A half day is `0.5`.

It was made a number rather than a boolean deliberately: quarter days exist in some policies, and payroll can consume a fraction directly without a translation table.

The fraction crosses into attendance — a half-day leave halves that day's hour thresholds, so the employee is not marked absent for working half a day. See `05-seams-with-attendance-and-payroll.md`.
