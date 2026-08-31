# 01 - Leave Module: Overview & Concepts

---

## 1. "Isn't leave just part of attendance?"

This question comes up constantly and the answer is **no** — but the reason is worth understanding, because it explains the shape of the whole module.

It is easy to see why the question arises. Attendance already has an `on_leave` status, and a day off obviously affects attendance. So why isn't leave a folder inside the attendance module?

### The evidence that they are peers, not parent and child

**1. The system already treats them as separate modules.**
```text
attendance   chat   connect   directory   expenses   insurance
leave        offboarding   onboarding   payroll   policy_center
tasks        work_calendar
```
`leave` and `attendance` are two of thirteen first-class entries in the module registry. A tenant can switch either on **independently** — and both combinations happen in the real world. Plenty of companies adopt leave management first and never buy biometric attendance at all. Others track attendance on a factory floor with no formal leave system.

**2. Payroll reads leave directly, not through attendance.**
`payroll_period_input` queries the `leaves` table itself. If leave were a sub-part of attendance, payroll would have to go through attendance to reach it. It doesn't — because leave is meaningful to payroll whether or not attendance exists.

**3. Leave owns a domain attendance knows nothing about.**
Look at what `leave_types` actually stores: accrual type, carry-forward rules and caps, encashment, probation restrictions, document requirements, minimum notice, maximum consecutive days, paid vs unpaid. Then `leave_balances`: allocation, carry-forward, used, pending, last accrual date.

None of that is attendance's business. Attendance never asks "how many days does this person have left?" or "does this leave type carry forward?"

### So what IS the relationship?

**Attendance *consumes* leave. That is a dependency, not containment.**

```text
   shifts ─────┐
   holidays ───┼──► ATTENDANCE DERIVATION ──► a day's status
   leave ──────┘
```

Attendance also consumes shifts, holidays, and org structure. Nobody would call those sub-parts of attendance either. Leave sits in exactly the same position: an input.

The seam is narrow and one-directional — attendance asks leave a single question:

> *"On this date, does this employee have an approved leave, and is it a full day or a fraction?"*

That is the whole conversation. Attendance never writes to leave, never approves anything, never touches a balance.

### The one place it feels blurry

`attendance.status` can be `on_leave`, and `attendance.leave_id` points back at the leave record. That is the *result* of the conversation being written down — attendance recording why a day looked the way it did. It is a foreign key, not ownership.

> **Practical test:** if you turned attendance off tomorrow, would leave still work? Yes — applications, approvals, balances, accruals all continue. If you turned leave off, would attendance still work? Yes — days derive from punches, holidays and shifts. Two things that each survive the other's removal are peers.

---

## 2. Core Philosophy: a request, then a decision, then a balance

Leave has three moving parts, and keeping them separate is the whole design.

```text
┌──────────────────────────────────────────────────────────┐
│  leave_types    "what kinds of leave exist, and the rules"│
│  Casual, Sick, Earned… accrual, carry-forward, notice     │
└───────────────────────────┬──────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────┐
│  leaves         "someone asked, someone decided"          │
│  pending → approved / rejected / cancelled                │
└───────────────────────────┬──────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────┐
│  leave_balances "how much is left, per person per year"   │
│  allocated, carried forward, used, pending, balance       │
└──────────────────────────────────────────────────────────┘
```

The important subtlety: **a pending request already consumes balance.** `leave_balances.pending_days` exists so that someone cannot apply for the same ten days three times over while approvals are outstanding. Balance is not just "used" — it is "used *or* spoken for".

---

## 3. The Golden Rules

| # | Rule | Why |
|---|---|---|
| 1 | **Never write `leaves.status` directly.** | Approval, rejection and cancellation each have to move balances too. Use the RPCs. |
| 2 | **Balance changes and status changes happen together.** | A status change without a balance change silently corrupts every future application. |
| 3 | **`day_fraction` is a number, not a boolean.** | Half days exist; so might quarter days. Payroll consumes the fraction directly. |
| 4 | **Attendance reads leave; leave never reads attendance.** | Keeps the dependency one-directional. |
| 5 | **Approved leave in the past stays approved.** | Turning the leave module off must never retroactively convert leave days into absences. |

---

## 4. Rule 5 deserves a longer note

The attendance derivation passes read the `leaves` table **without** checking whether the leave module is enabled. That looks like a module-independence violation, and it is deliberately not one.

Consider a tenant who used leave for a year and then switched the module off. Their history still contains approved leave. If derivation gated its read on the module flag, re-deriving any past day would stop seeing that leave and mark the employee **absent** — and if payroll is on, that absence costs them money.

> **Turning off a module must not rewrite history.** An approved leave record is a fact that happened. The module flag controls whether new leave can be *applied for*, not whether past decisions still count.

If leave is off and no leave rows exist, the query simply returns nothing and derivation proceeds normally. Attendance works perfectly well without the leave module — it just has one fewer input.

*(Continue to `02-database-schema-and-er.md`.)*
