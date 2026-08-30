# 01 - Attendance Module: Overview & Concepts

**The Evidence Module.** Attendance is where the product records *facts about what happened* — someone arrived, someone left, someone was on leave. Almost every number that later shows up in payroll starts life here.

That makes one rule more important than anything else in this module:

> **Attendance records facts. It never decides money.**

Attendance says "worked 7.5 hours, arrived late". It does **not** say "therefore deduct ₹400". Payroll is a separate module, it is built last, and a tenant may run attendance **without** payroll at all. If you ever find yourself writing a rupee amount inside an attendance function, stop — you are in the wrong module.

---

## 1. Core Philosophy: Two Layers, Not One

The most important idea in this module. Older versions of this system had **one** table: the app wrote a row into `attendance` when you punched, and that row *was* the truth. That design has a fatal flaw — if a punch arrives late, or arrives wrong, or arrives from a machine that was offline for three days, there is nothing to recompute from. The damage is already baked into the row.

So attendance is split into two layers:

```text
┌──────────────────────────────────────────────────────────┐
│  LAYER 1 — attendance_events   (what actually happened)   │
│                                                           │
│  "Employee 42 punched IN at 09:03:17 from the Kiosk"     │
│  "Employee 42 punched OUT at 18:11:04 from the Kiosk"    │
│                                                           │
│  APPEND-ONLY. Never edited. Never deleted.                │
└───────────────────────────┬───────────────────────────────┘
                            │
                     DERIVATION (a scheduled job)
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│  LAYER 2 — attendance      (what it MEANS)                │
│                                                           │
│  date = 2026-08-29, status = present, hours = 7.5,        │
│  late_entry = true, in_time = 09:03, out_time = 18:11     │
│                                                           │
│  REBUILDABLE. Safe to recompute at any time.              │
└──────────────────────────────────────────────────────────┘
```

### Why this matters (the case that proves it)

A biometric machine at a branch office loses internet on Monday. It keeps recording punches locally. On Thursday it reconnects and uploads three days of backlog.

- **Old single-layer design:** those punches arrive on Thursday, so they look like Thursday's punches. Monday is permanently wrong and there is no way to fix it except by hand.
- **Two-layer design:** the events are stored with their *true* Monday timestamps. Derivation re-runs, sees Monday now has punches, and rebuilds Monday's row correctly. Nothing special happens. Nobody notices.

That is the whole point. **Events are the truth; the daily row is just a conclusion you can always redraw.**

---

## 2. The Golden Rules

These are not style preferences. Breaking any of them causes a real bug that is hard to detect.

| # | Rule | Why |
|---|---|---|
| 1 | **Never edit or delete a row in `attendance_events`.** | It is the evidence. If you can edit evidence, you cannot trust any conclusion drawn from it. Wrong events are *excluded* (`skip_derivation` + a `void_reason`), never removed. |
| 2 | **Never let the client decide the date or the lateness.** | A phone's clock can be wrong or deliberately changed. The server derives the business date from the tenant's timezone. |
| 3 | **Attendance emits facts, never money.** | Module independence. Payroll is a separate, later module. |
| 4 | **Derivation must be safe to re-run.** | It runs on a schedule, repeatedly, over the same days. Running it twice must produce the same result as running it once. |
| 5 | **Every write goes through a database function (RPC).** | The browser cannot write to the `attendance` table at all any more. See `04-security-and-rls.md`. |

---

## 3. The Vocabulary

You will see these words constantly. They are not interchangeable.

- **Event** — one punch. A single moment in time. Lives in `attendance_events`.
- **Derivation** — the job that reads events and writes daily rows. Two passes (see below).
- **Business date** — *the tenant's* calendar day, not the server's. A punch at 00:30 in India is a different date than the same instant in UTC. Always resolved with `tenant_business_date()`.
- **Shift** — the working-hours policy: start time, end time, grace period, thresholds for half-day and absent.
- **Derived row** — a row in `attendance` that derivation produced (`derivation_source = 'derived'`).
- **Locked row** — a row HR manually corrected (`is_locked = true`). Derivation **skips** it forever, so an HR correction is never silently overwritten.

---

## 4. Derivation: Two Passes

Derivation runs in two passes because it has two different questions to answer.

**Pass 1 — "What do the punches say?"**
Runs over *events*. Groups them by shift, calculates hours, decides present / half-day / absent from the hours, flags late arrival and early exit.

**Pass 2 — "Who has no punches at all?"**
Runs over *assigned employees*, not events. Pass 1 can only ever see people who punched. Someone who never showed up produces no events, so Pass 1 is blind to them. Pass 2 fills in those days: weekly off, holiday, approved leave, or absent.

> **Junior dev note:** this is the classic mistake in attendance systems — building only Pass 1 and then wondering why absent days never appear. You cannot detect an absence by looking at punches. You detect it by looking at who was *expected* and finding nothing.

---

## 5. Module Independence

A tenant can switch attendance on and payroll off, or vice versa. This is a product promise, and the code honours it:

- Every attendance table is gated by a `tenant_has_module_for(tenant, 'attendance')` check.
- The punch functions check the payroll period lock **only if the payroll module is on**.
- No attendance code reads a payroll table.

If you add a feature here, ask: *"does this still work for a tenant who does not use payroll?"* If the answer is no, the design is wrong.

*(Continue to `02-database-schema-and-er.md` for the tables.)*
