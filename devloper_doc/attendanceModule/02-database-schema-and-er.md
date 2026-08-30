# 02 - Attendance Module: Database Schema & ER

Every table here carries `tenant_id` and is fenced by RESTRICTIVE RLS policies (see `04-security-and-rls.md`).

---

## 1. The Map

```text
                      ┌──────────────┐
                      │    shifts    │  the working-hours POLICY
                      │              │  (start, end, grace, thresholds)
                      └──────┬───────┘
                             │
                   ┌─────────┴──────────┐
                   │  employee_shifts   │  who works which shift, effective-dated
                   └─────────┬──────────┘
                             │
   ┌──────────────────┐      │       ┌──────────────────────┐
   │ attendance_      │      │       │  holiday_calendars   │
   │ devices          │      │       │  holiday_calendar_   │
   │ (kiosk / ZKTeco) │      │       │  days   +  holidays  │
   └────────┬─────────┘      │       └──────────┬───────────┘
            │                │                  │
            ▼                ▼                  │
   ┌─────────────────────────────────┐          │
   │      attendance_events          │          │
   │  APPEND-ONLY punch log          │          │
   └───────────────┬─────────────────┘          │
                   │                            │
              DERIVATION  ◄─────────────────────┘
           (pass 1 + pass 2)
                   │
                   ▼
   ┌─────────────────────────────────┐    ┌──────────────────────────┐
   │          attendance             │◄───┤ attendance_corrections   │
   │  ONE ROW PER EMPLOYEE-DAY-SHIFT │    │ (employee asks, HR rules)│
   └───────────────┬─────────────────┘    └──────────────────────────┘
                   │
       ┌───────────┴────────────┬─────────────────────┐
       ▼                        ▼                     ▼
┌──────────────┐    ┌────────────────────┐   ┌─────────────────┐
│ attendance_  │    │ attendance_selfies │   │ attendance_     │
│ breaks       │    │                    │   │ audit_logs      │
└──────────────┘    └────────────────────┘   └─────────────────┘
```

---

## 2. The Two Core Tables

### `attendance_events` — the punch log

One row per punch. **Append-only.**

| Column | Meaning |
|---|---|
| `event_time` | `timestamptz`. The true moment of the punch. For a biometric device this is the *device's* time, not when we received it. |
| `direction` | `'in'` or `'out'`, or `NULL` to let derivation work it out. |
| `source` | `app` \| `kiosk` \| `device` \| `manual` \| `import` |
| `source_ref` | The originating system's own reference (e.g. the device serial + its timestamp). |
| `idempotency_key` | Stops a replayed punch creating a second event. Critical for devices that resend batches. |
| `evidence` | `jsonb`. Selfie, geofence, device identity, how the device authenticated. |
| `attendance_id` | Filled in by derivation once the event has been folded into a daily row. `NULL` = not yet processed. |
| `skip_derivation` / `void_reason` | How a bad event is neutralised **without deleting it**. |
| `shift_id` / `shift_start` / `shift_end` | Which shift window this punch was resolved into, stamped at ingest. |

### `attendance` — the derived day

One row per **employee + date + shift**. Note the shift in that key — a person can work two shifts in one day.

| Column | Meaning |
|---|---|
| `date` | The tenant's business date. |
| `status` | `present` \| `absent` \| `half_day` \| `on_leave` \| `holiday` \| `weekly_off` \| `work_from_home` |
| `in_time` / `out_time` | **Derived** first-in and last-out. |
| `punch_in` / `punch_out` | The raw app-session times. Kept for the live "you are punched in" UI. |
| `late_entry` / `early_exit` | Derived flags. `late_entry` is the **authority** for lateness. |
| `is_late` | The older column payroll already reads. Kept **in sync** with `late_entry` by every write path. |
| `work_hours` | Hours worked after break rules. |
| `derivation_source` | `derived` \| `manual` \| `correction` \| `import` \| `leave` \| `NULL` |
| `is_locked` | **HR touched this day. Derivation must never overwrite it.** |
| `derivation_version` | Bumped each time derivation rewrites the row. |

> **Why two lateness columns?** `late_entry` is the correct, derived one. `is_late` existed first and `payroll_period_input` already reads it. Removing it would change what payroll sees, and payroll is not designed yet — so both are written with the same value until payroll is built. Do not "clean this up".

---

## 3. Supporting Tables

| Table | What it holds |
|---|---|
| `shifts` | The policy: start/end time, grace minutes, half-day and absent thresholds, `allowed_punch_sources`, `enable_auto_derivation`. |
| `employee_shifts` | Which employee is on which shift, with `effective_from` / `effective_to`. |
| `holidays` | The tenant's default holiday list. Still the primary source. |
| `holiday_calendars` + `holiday_calendar_days` | An **override layer** on top of `holidays`, so a location or shift can differ. Precedence: shift → employee → `holidays`. |
| `attendance_corrections` | An employee's request to fix a day. HR approves or rejects. **Has no `shift_id`** — see the gotcha in `07`. |
| `attendance_breaks` | Break start/end within a day. |
| `attendance_selfies` | Selfie evidence, stored in the `attendance-selfies` private bucket. |
| `attendance_derivation_runs` | One row per derivation run: window, trigger, status, error detail. This is how you tell whether the scheduler is alive. |
| `attendance_location_exceptions` | Approved remote-work exceptions (punching outside the geofence legitimately). |
| `attendance_audit_logs` | Audit trail for attendance changes. |

---

## 4. Device Tables (see `06-devices-and-ingestion.md`)

| Table | What it holds |
|---|---|
| `attendance_devices` | One row per kiosk tablet or biometric machine: `serial` (globally unique), bcrypt `secret_hash`, `device_type`, `allow_serial_only`, `is_active`, `last_seen_at`. |
| `attendance_device_auth_failures` | Brute-force counter. RLS on, **no policies at all** — internal bookkeeping nobody in the API can read. |

Two columns were also added to `employees`:
- `attendance_device_id` — the ID this person is enrolled under on a biometric machine. **Named to match Frappe HR exactly**, so a customer migrating from Frappe can import their mapping without translating anything.
- `kiosk_pin_hash` — bcrypt hash of their kiosk PIN. Never read by the app; see `05`.

---

## 5. The Unique Key That Trips People Up

```sql
UNIQUE (tenant_id, employee_id, date, COALESCE(shift_id, '00000000-...-0000'))
```

Not `(employee_id, date)`. A day can hold **several rows** — one per shift. Any code that assumes "one attendance row per person per day" is wrong now, and will silently pick an arbitrary row.

> **Real bug this caused:** replacing the old `(employee_id, date)` unique index broke `approve_leave_request`, because its `ON CONFLICT (employee_id, date)` no longer matched any index. HR leave approval failed in production. An `ON CONFLICT` clause names *no table*, so grepping for the table name will never find it — you have to grep the conflict clause itself.
