# 05 - Leave Module: Seams with Attendance & Payroll

This is the document to read if you are wondering where leave stops and another module starts.

---

## 1. The shape of it

```text
                    ┌─────────────┐
                    │    LEAVE    │   owns: types, requests, balances, accrual
                    └──────┬──────┘
                           │  reads only
              ┌────────────┴────────────┐
              ▼                         ▼
      ┌───────────────┐         ┌───────────────┐
      │  ATTENDANCE   │         │    PAYROLL    │
      │ "was this day │         │ "is this day  │
      │  a leave day?"│         │  paid?"       │
      └───────────────┘         └───────────────┘
```

Both consume leave. **Neither owns it, and leave reads neither of them.** The arrows only point outward — that one-directionality is what makes leave a peer module rather than a sub-part of attendance.

---

## 2. The Attendance Seam

### What attendance asks

Exactly one question, per employee per day:

> *"Is there an approved leave covering this date, and is it a full day or a fraction?"*

Both derivation passes ask it:

- **Pass 1** (over punches): if an approved leave covers the day, it overrides the derived status → `on_leave`, and stamps `attendance.leave_id`.
- **Pass 2** (over people with no punches): a day with no punches and an approved leave becomes `on_leave` rather than `absent`. **This is the important one** — without it, everyone on leave would be marked absent, and if payroll is on, that costs them money.

### What crosses the boundary

| Field | Crosses? | Note |
|---|---|---|
| approved leave exists on date | **yes** | The core question |
| `day_fraction` | **yes** | A half day halves that day's hour thresholds, so someone working a half day is not marked absent |
| `is_paid` | **no** | Attendance does not care whether leave is paid. Payroll asks that itself |
| balance, accrual, carry-forward | **no** | Attendance has no idea these exist |
| `attendance.leave_id` | outward | Attendance recording *why* a day looked the way it did |

> **`day_fraction` is the only policy value that crosses.** Everything else attendance learns is "there is an approved leave here". Keeping the seam that narrow is deliberate — it is why either module can be switched off without breaking the other.

### The deliberate asymmetry: leave reads are NOT module-gated

Both derivation passes read `leaves` **without** checking `tenant_has_module_for(tenant, 'leave')`, even though they do check the attendance module. That looks like an oversight. It is not.

If the read were gated, a tenant who switched the leave module **off** would find every past leave day re-deriving as **absent** the next time derivation touched it. Historical, approved, legitimate leave would silently become absence — and if payroll is on, that is money taken from someone.

> **Turning off a module must not rewrite history.** The module flag governs whether *new* leave can be applied for. It does not un-happen approved leave.

If leave is off and no rows exist, the query returns nothing and derivation carries on. Attendance works fine without leave; it simply has one fewer input.

### Half-day leave, concretely

An employee with a half-day leave who works the other half:

```text
shift thresholds:   absent < 4h,  half_day < 7h      (full day)
day_fraction 0.5 →  absent < 2h,  half_day < 3.5h    (halved)

worked 3.5h  →  without the fraction: ABSENT (wrong)
                with    the fraction: PRESENT
```

Get this wrong and someone who took an approved half day and worked the rest is marked absent.

---

## 3. The Payroll Seam

**Payroll reads `leaves` directly.** `payroll_period_input` queries the table itself rather than going through attendance.

That is the strongest single piece of evidence that leave is not a sub-part of attendance: if it were, payroll would have to reach it *through* attendance. It doesn't, because leave is meaningful to payroll even for a tenant with no attendance tracking at all.

What payroll cares about that attendance does not:

| Field | Why payroll needs it |
|---|---|
| `leave_types.is_paid` | Unpaid leave (LOP) is a deduction. Paid leave is not |
| `approved_business_days` | The actual working days consumed — not `total_days` |
| `day_fraction` | A half day is half a deduction |

> ⚠️ **Payroll is the last module and its decisions are not locked.** Do not change the shape of what `payroll_period_input` reads, or the meaning of `is_paid` / `approved_business_days`, without treating it as a payroll decision. Attendance learned this the hard way with `is_late` — see the attendance module's doc 07.

---

## 4. Three modules, one day

For a single employee-day the three modules answer three different questions:

```text
LEAVE        "did they have permission to be away, and does it come out of a balance?"
ATTENDANCE   "what actually happened on the ground that day?"
PAYROLL      "what does that day cost?"
```

They are genuinely different questions. A day can be `on_leave` in attendance, deducted from a Casual Leave balance in leave, and cost nothing in payroll because the type is paid — three correct, unrelated answers.

Collapsing leave into attendance would force the middle question to also answer the first, and a tenant who wants leave management without any attendance tracking (a very common starting point) would have to enable a module they do not use.

---

## 5. If you are adding a feature, which module owns it?

| The feature is about… | Module |
|---|---|
| Entitlement, accrual, carry-forward, encashment | **Leave** |
| Approval chains and who may authorise time off | **Leave** |
| What a day's status was, and the hours behind it | **Attendance** |
| Punches, devices, geofencing | **Attendance** |
| Whether the day is paid, and how much | **Payroll** |
| "How many days off has this person taken?" | **Leave** (balances), not a count of attendance rows |

That last row catches people. It is tempting to answer it by counting `attendance` rows with `status = 'on_leave'` — but that only works if attendance is enabled, only covers days derivation has processed, and misses future approved leave entirely. **The balance ledger is the answer.**
