# 03 - Attendance Module: Setup & Workflow

The order matters. Each step depends on the one before it. Skipping a step usually does not throw an error — it just makes attendance quietly do nothing, which is worse.

---

## 1. The Configuration Sequence

### Step 1 — Locations and employees exist
Attendance is not the foundation module. Before anything here works you need locations, employees, and the tenant timezone set correctly.

> **The timezone is not cosmetic.** Every business date in this module is computed from `tenants.timezone`. Get it wrong and every punch lands on the wrong day.

### Step 2 — Create Shifts (`/hr/shifts` → `ShiftManagement.tsx`)
A shift is the working-hours **policy**, not just a time range:

| Field | What it does |
|---|---|
| `start_time` / `end_time` | The window. If end < start it is an overnight shift, and that is handled. |
| `late_entry_grace_minutes` | How late is still "on time". |
| `working_hours_threshold_for_absent` | Below this many hours → `absent`. |
| `working_hours_threshold_for_half_day` | Below this → `half_day`. |
| `working_days` | Which weekdays are working days. Everything else becomes `weekly_off`. |
| `allowed_punch_sources` | Which sources may record a punch for this shift (`app`, `kiosk`, `device`, …). |
| `enable_auto_derivation` | **If this is off, the scheduler ignores this shift entirely.** |
| `process_attendance_after` | Optional cut-off date. Derivation never looks before it. |

> **Most common "attendance isn't working" cause:** `enable_auto_derivation` is off, or `process_attendance_after` is set to a date in the future. The scheduler runs, reports success, and derives nothing.

### Step 3 — Assign employees to shifts (`employee_shifts`)
Effective-dated. An employee with **no shift assignment covering a date** is invisible to Pass 2 for that date — no absent row will ever be created for them.

### Step 4 — Holidays
`holidays` is the tenant's default list and works on its own. The `holiday_calendars` tables are an **override layer** for when one location or shift differs. Precedence:

```text
shift calendar   →   employee calendar   →   tenant `holidays`
(most specific)                              (fallback)
```

### Step 5 — Devices, only if you use them (`/hr/devices`)
Needed for kiosk or biometric punching. Not needed if everyone punches in the web app. See `06-devices-and-ingestion.md`.

### Step 6 — Confirm the scheduler is alive
```bash
npx @insforge/cli schedules list
```
You should see `attendance-derivation-hourly`. If this list is empty, **nothing is deriving** and every day will stay in whatever state the app happened to write.

---

## 2. What Happens Day To Day

```text
09:03  Employee punches in
       → punch_in_attendance() writes an `attendance` row (session)
       → a trigger also writes an `attendance_events` row (evidence)

18:11  Employee punches out
       → punch_out_attendance() closes the session

:20 past every hour
       → the scheduler calls run-attendance-derivation
       → attendance_run_scheduled_derivation() walks every tenant
       → Pass 1 turns events into a derived day
       → Pass 2 fills in anyone with no punches at all
       → one row per tenant lands in attendance_derivation_runs
```

### Why the scheduler re-derives the last 2 days, not just today
Because events arrive late. A device that was offline uploads yesterday's punches today. If derivation only ever looked at today, yesterday would stay wrong forever. Re-running is safe: Pass 1 is idempotent, and it skips locked rows.

---

## 3. Corrections: who can change a day, and how

```text
Employee spots a wrong day
        │
        ▼
  attendance_corrections  (a request, not a change)
        │
        ▼
HR approves ──► hr_approve_attendance_correction()
                  • fixes the day
                  • sets is_locked = true
                  • stamps derivation_source = 'correction'
```

Once `is_locked` is true, **derivation will never touch that day again**. That is intentional — an HR decision must not be silently undone by the next scheduled run.

If HR needs to hand the day back to the system, `hr_unlock_attendance_day()` clears the lock. Note it is **day-scoped, not row-scoped**: on a multi-shift day it unlocks every row for that employee-day.

---

## 4. Guardrails

| Action | System behaviour |
|---|---|
| Employee tries to write to `attendance` directly | **Blocked.** The browser has no INSERT/UPDATE/DELETE on that table at all. |
| Client tries to set `is_late` | **Blocked by design.** Lateness is derived server-side only. |
| Client sends its own date | **Ignored.** The server derives the business date from the tenant timezone. |
| Derivation meets an HR-corrected row | **Skipped** (`is_locked`), counted as `rows_skipped`. |
| The same device punch is uploaded twice | **Collapsed** into one event by the idempotency key. |
| A punch arrives for a payroll-locked period | **Refused** — but only if the tenant actually uses payroll. |
| A shift's `allowed_punch_sources` excludes kiosks | Kiosk punches for that employee are **refused at the ingest seam**. |
| Deriving a day nobody was assigned to | Nothing happens. No shift assignment = no expectation = no absence. |
