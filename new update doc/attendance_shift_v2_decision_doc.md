# Attendance & Shift Management v2 — Fixed Decision Document

**Status**: Authoritative decision record. Decisions in §3 are LOCKED and may only change via an ADR.
**Date**: 2026-08-21
**Research basis**: Frappe HR (`frappe/hrms@develop`) source + docs; live TalentMesh backend `rq3qmu8y`.

## Relationship to existing documents

| Document | Status after this doc |
|---|---|
| `attendance_shift_audit_report_v1.md` | **Immutable.** Findings F1–F8 remain valid. Still the audit of record. |
| `attendance_shift_architecture_spec_v1.md` | **Retained.** Its transactional rules (idempotency, locking, outbox, snapshots, RLS §12.1) survive intact and are assumed by this doc. |
| `attendance_shift_release_roadmap.md` | **Superseded from A2 onward.** A1 (complete, 22/22 RLS tests pass) is retained. A2–A8 were hardening the single-session model and are replaced by B1–B9 in §8. |
| `attendance_shift_management_audit_and_implementation_plan.md` v1.0 | **Superseded** as an implementation plan; retained as historical context. |

The v1 documents answer *"how do we make a punch transactional?"*. They do not answer *"how is attendance derived, and what makes it complete and correct?"* — which is what industry-grade actually means. That gap is what this document closes.

---

## 1. Why the v1 architecture could not reach industry grade

v1 assumed one shape: **an employee taps punch-in in a browser, and that tap mutates the daily attendance row directly.** Every v1 release (A2–A8) hardened that assumption — idempotent punch-in, tenant-timezone dates, snapshot-based punch-out.

The assumption itself is the ceiling. Under it:

- A biometric device that was offline for two days cannot deliver its logs, because there is nothing to deliver them *to*. The day is already closed.
- A tenant that fixes a wrong grace period cannot re-derive last month, because the inputs were never kept — only the verdict.
- There is exactly one punch pair per day, so a factory with a 45-minute unpaid lunch punch-out cannot be modelled.
- `attendance` only has rows where someone punched. Payroll reading that table cannot distinguish "absent" from "not yet processed".

Frappe solved this in 2018 by splitting the problem in two, and every mature attendance product has the same split. That split is Decision D2.

---

## 2. What Frappe actually does (verified from source, not docs)

The published docs are thin. These behaviours were read directly from `frappe/hrms@develop`.

### 2.1 The two layers

| Layer | Frappe doctype | Nature |
|---|---|---|
| Raw event | `Employee Checkin` | Immutable append-only log. One row per physical punch. Never edited by derivation. |
| Derived day | `Attendance` | One row per employee per day per shift. Computed from the log. Rebuildable. |

The link is a foreign key **on the log row** (`Employee Checkin.attendance`). Unlinked logs are the work queue: `attendance is not set` is literally the processor's filter (`shift_type.py:get_employee_checkins`).

### 2.2 The derivation processor (`shift_type.py:_process`)

```
group logs by (employee, shift_start)          # NOT by calendar date — this is what makes night shifts work
for each group:
    if holiday and not mark_auto_attendance_on_holidays: skip
    if half-holiday: halve both working-hour thresholds
    (status, hours, late, early, in, out) = get_attendance(logs, thresholds)
    mark_attendance_and_link_log(...)          # creates Attendance, stamps its id onto every log
commit
for each assigned employee (in batches of 50):
    mark_absent_for_dates_with_no_attendance(employee)
    mark_absent_for_half_day_dates(employee)
    commit
```

Two properties matter more than the code:

1. **Grouping is by `shift_start`, not by date.** A punch at 23:30 and one at 06:30 next morning share a `shift_start` and therefore produce ONE attendance row. This is the entire night-shift solution.
2. **Absent-marking is a separate second pass** over *assigned employees*, not over logs. Logs can only tell you who was present. Only the shift assignment can tell you who *should* have been.

### 2.3 Status derivation (`shift_type.py:get_attendance`)

```
hours = calculate_working_hours(logs, determine_check_in_and_check_out, working_hours_calculation_based_on)
late_entry  = enable_late_entry_marking  and in_time  > shift_start + late_entry_grace_period
early_exit  = enable_early_exit_marking  and out_time < shift_end   - early_exit_grace_period
if hours < working_hours_threshold_for_absent:    -> Absent
if hours < working_hours_threshold_for_half_day:  -> Half Day
else:                                             -> Present
```

Note the ordering: absent threshold is checked **first**, and both thresholds are **halved on a half-holiday**. `late_entry`/`early_exit` are independent flags, not statuses — an employee can be Present *and* late. TalentMesh currently conflates these (`is_late` is a column but lateness has no effect on status, and half-day is decided by a cutoff time rather than by hours worked).

### 2.4 Working-hours calculation — a 2×2 matrix (`employee_checkin.py:calculate_working_hours`)

|  | First check-in & last check-out | Every valid check-in/check-out |
|---|---|---|
| **Alternating entries as IN/OUT** | `last.time - first.time` | Sum over consecutive pairs; ignores log_type entirely |
| **Strictly by Log Type** | first IN → last OUT | Walk logs, accumulate each IN→OUT pair |

This exists because **most biometric devices do not reliably report IN vs OUT.** Cheap ZKTeco units emit an undifferentiated punch stream. "Alternating" mode is what makes those devices usable. Any design that assumes the device tells you the direction will fail on real hardware. This is a per-shift-type setting in Frappe and must be per-shift-type here too.

### 2.5 Shift resolution for a timestamp (`shift_assignment.py`)

The hard problem: given a punch at 23:30 on the 5th, which shift does it belong to?

```
get_shifts_for_date(employee, ts):
    fetch assignments where start_date <= ts+1day AND (end_date is null OR end_date >= ts-1day)
    # ±1 day because a shift plus its margins can spill into either neighbouring day
get_shift_for_time(shifts, ts):
    for each assignment: compute actual_start/actual_end (shift times ± margins)
                         drop it if the shift falls outside the assignment period
                         keep it if actual_start <= ts <= actual_end
    sort by actual_start
    _adjust_overlapping_shifts()   # trim neighbours so grace windows cannot overlap:
                                   #   next.actual_start = max(curr.end_datetime, next.actual_start)
                                   #   curr.actual_end   = min(next.actual_start, curr.actual_end)
    return first shift containing ts
```

`_adjust_overlapping_shifts` is the subtle part and the piece most reimplementations miss. Without it, a 06:00–14:00 shift with a 60-minute check-out margin and a 14:00–22:00 shift with a 60-minute check-in margin both claim 14:30, and the assignment becomes non-deterministic. Frappe resolves it by letting the *scheduled* boundary win over the *margin*.

Fallback order when no assignment matches: **Shift Assignment → Employee.default_shift → no shift** (a punch with no shift is `offshift` and is excluded from auto-attendance).

### 2.6 Guards on the derived row (`attendance.py:validate`)

Every one of these is an edge case TalentMesh does not currently handle:

| Guard | Rule |
|---|---|
| `validate_attendance_date` | Date cannot precede `date_of_joining`. |
| `validate_duplicate_record` | One row per (employee, date), scoped by shift; uses `SELECT ... FOR UPDATE`. |
| `validate_overlapping_shift_attendance` | Two rows on one date are allowed only if their shifts do not overlap in time. |
| `validate_employee_status` | No attendance for inactive employees. |
| `check_leave_record` | Approved leave on that date **overrides** the status to `On Leave`, or `Half Day` when it is a half-day leave, and back-links `leave_type` + `leave_application`. |

`check_leave_record` is the important one: leave wins over derivation, and the link is stored so payroll can trace it.

### 2.7 The watermark pair

| Field | Meaning |
|---|---|
| `process_attendance_after` | Never derive earlier than this. Protects imported/legacy history from being clobbered. |
| `last_sync_of_checkin` | Only process shifts whose `actual_end` is before this. **The safety interlock:** it prevents marking someone absent for a day whose device logs have not arrived yet. |

And a deliberate lag: absentees are marked from the shift **one day before** `last_sync_of_checkin` (`get_start_and_end_dates`), buying 24 hours for manual entries and late device syncs to land.

### 2.8 What Frappe does *worse*, and we should not copy

| Area | Frappe | Our decision |
|---|---|---|
| Overtime | `get_overtime_data` is naive: `hours - (shift_end - shift_start)`. Ignores breaks, holidays, weekly caps, and approval. | Keep our `overtime_records` approval model; add holiday/weekly-rest multipliers. |
| Geofence | `validate_distance_from_shift_location` only; no selfie, no accuracy, no spoof signals. | Keep ours — it is genuinely ahead of Frappe. |
| Regularization | `Attendance Request` is a date-range request; no per-punch correction. | Keep `attendance_corrections`, extend it to ranges. |
| Multi-tenancy | Single-company-per-site assumptions throughout. | Ours is shared-schema multi-tenant; every port needs `tenant_id` + RLS. |
| Timezone | Naive site-local datetimes (`getdate()`, `datetime.combine`). | **Porting hazard — see D9.** |

---

## 3. LOCKED DECISIONS

| ID | Decision | Rationale | Rejected alternative | Source |
|---|---|---|---|---|
| **D1** | Attendance accepts **multiple punch sources**, enabled and configured **per tenant**: app (GPS+selfie), biometric/RFID device, shared kiosk, HR manual entry, CSV/Excel import. A tenant may run several at once. | Tenants differ; a single tenant may need app for field staff and a device at the factory gate. | Single-source (app-only). | User, 2026-08-21 |
| **D2** | **Two-layer model.** Punches append to an immutable `attendance_events` log; a processor derives the `attendance` day row. | Only shape that absorbs late device logs, supports replay after a policy fix, and allows >1 punch pair/day. | Session-row mutation (current). | User, 2026-08-21 |
| **D3** | Support **day and night (cross-midnight) shifts**. Rotating rosters are an **extension point**, not v1 scope. | Cross-midnight cannot be retrofitted — it redefines which day a punch belongs to, which every downstream consumer depends on. A roster is only a *generator* of effective-dated assignments, so it is additive if the assignment table is right. | Day-only; or full rostering in v1. | Recommended, accepted 2026-08-21 |
| **D4** | **Completeness is guaranteed.** A processor writes `absent` rows for working days with no punch, skipping holidays and approved leave. Exposed **both** as a scheduled job and as a manual HR trigger over a date range. | Sparse attendance makes payroll silently under-count absence. Dual entry de-risks the scheduler, which this project has never configured. | Infer absence at report time. | Recommended, accepted 2026-08-21 |
| **D5** | Derivation is **idempotent and replayable**. Re-running over a date range must converge to the same result, and must never overwrite a row an HR user has manually locked. | Replay is the whole point of D2. | One-shot derivation. | Follows from D2 |
| **D6** | Status is derived from **hours worked against thresholds**, not from a punch-in cutoff time. `late_entry` / `early_exit` are **independent boolean flags**, never statuses. | Frappe §2.3. A late employee who works a full day is Present-and-late, not half-day. | Current cutoff-time half-day logic. | Frappe |
| **D7** | Each shift type carries a **`determine_check_in_and_check_out`** mode (`alternating` \| `strict_log_type`) and a **`working_hours_calculation_based_on`** mode (`first_last` \| `every_pair`). | Real biometric devices do not reliably report direction (§2.4). Without `alternating`, cheap devices are unusable. | Assume every event knows its direction. | Frappe |
| **D8** | **Approved leave overrides derived status**, and the attendance row stores `leave_id` back-link. Holiday overrides both unless the shift opts in. | Frappe §2.6. Payroll must be able to trace why a day was not worked. | Leave and attendance as independent tables reconciled at payroll time. | Frappe |
| **D9** | All derivation functions take an **explicit tenant IANA timezone** parameter. Instants are `timestamptz`; business dates are computed in DB from tenant timezone. **No function may call `current_date` or `now()::date`.** | Frappe's logic is naive-local. Transliterated onto `timestamptz` it silently produces UTC business dates — a punch at 02:00 IST lands on the previous day. | Implicit server timezone. | Advisor + F2 |
| **D10** | Every new table gets **RLS on day one**: RESTRICTIVE tenant isolation + `can_access_tenant()`/`is_hr()` permissive pair, per arch spec §12.1 naming. | `tenant_settings` is already a live cross-tenant leak. Do not add a second. | Add policies in a later hardening release. | Repo policy |
| **D11** | The event log is **append-only**. Corrections never edit or delete an event; they append a superseding event carrying `supersedes_event_id`. | Audit and payroll defensibility; a device log is evidence. | Allow HR to edit raw events. | Arch spec §11 |
| **D12** | Derivation runs **server-side only**. No client may supply hours, thresholds, rates, or expected shift duration. | See finding C1 — the current punch-out RPC takes overtime rate and expected hours from the browser. | Client-computed hints for performance. | Finding C1 |

---

## 4. Verified state of the current system

Read from the live migration baseline and SPA source on 2026-08-21.

### What is genuinely good and must be kept

- `punch_out_attendance` (10-arg) already locks `FOR UPDATE`, enforces the payroll lock, enforces the task gate, closes an open break, and resolves the tenant timezone in SQL.
- Geofence + selfie evidence (`attendance_selfies`, `verification_snapshot`, `attendance_location_exceptions`) is **ahead of Frappe**. Frappe has no selfie and no accuracy/confidence model.
- Break tracking (`attendance_breaks` with `over_limit_minutes`) is richer than Frappe, which has no break concept at all.
- Effective-dated `employee_shifts` is the correct substrate for both night shifts and future rosters.
- A1's RLS posture is verified: 22/22 direct-API isolation tests pass.

### Findings (new, this research pass)

| ID | Severity | Finding |
|---|---|---|
| **C1** | **P0 — payroll integrity** | `punch_out_attendance` accepts `p_overtime_enabled`, `p_overtime_rate`, `p_expected_shift_hours`, `p_lunch_minutes` **from the client** (`PunchInOut.tsx:809`), is `SECURITY DEFINER`, and is granted to `authenticated`. **Confirmed used, not vestigial** — verified in the function body (`20260814160000_baseline-untracked-functions.sql`): `IF p_overtime_enabled THEN v_overtime_hours := GREATEST(0, v_work_hours - p_expected_shift_hours)`, then `INSERT INTO overtime_records (... p_expected_shift_hours, v_overtime_hours, p_overtime_rate, ROUND(v_overtime_hours * p_overtime_rate, 2), false)`. `p_lunch_minutes` likewise drives the break deduction that produces `v_work_hours`. An employee posting `p_overtime_enabled: true, p_expected_shift_hours: 0, p_overtime_rate: 10, p_lunch_minutes: 0` writes a fabricated `overtime_amount` straight into the payroll-facing table. **Mitigating:** the row is inserted with `approved = false`, so an HR approval gate stands between this and payout — the fabricated values arrive with plausible-looking numbers in the approval queue, not in a payslip. **Not mitigating:** nothing flags them as client-asserted. Note the deduction *mode* (`v_tracking_enabled`, `v_deduction_mode`) **is** read server-side from `tenant_settings`; only the amounts are trusted from the browser. v1's F3 framed this as a *reproducibility* concern; it is a **fraud vector**. Fix by deriving all four server-side from the shift/policy snapshot. |
| **C2** | **P0 — completeness** | Nothing creates `absent` rows. `attendance` is sparse; every consumer re-derives absence and they will disagree. Resolved by D4. |
| **C3** | **P0 — ownership** | Per the note in `20260817110000`, the surviving `punch_out_attendance` still does **not verify the caller owns the attendance row**. Tracked but open. |
| **C4** | **P1 — no scheduler** | `npx @insforge/cli schedules list` returns `[]`. Zero schedules configured. `daily-incomplete-task-marker` and `insurance-expiry-check` exist as functions with nothing invoking them — they are almost certainly not running. D4's scheduled arm is a **new platform capability for this project** and must be proven in B1. |
| **C5** | ~~P1 — doc drift~~ **FIXED 2026-08-21** | `doc/database_schema.md` documented `shifts.working_days` as day-name strings (`['Monday',...]`). The live column is `integer[]` of PostgreSQL `EXTRACT(DOW)` values — `0`=Sunday … `6`=Saturday, typical value `{1,2,3,4,5,6}` (Mon–Sat) — confirmed in `hr_save_shift(p_working_days integer[])`, the `EXTRACT(DOW FROM v_date)::integer = ANY(v_working_days)` match in the function baseline, and `ShiftManagement.tsx:34-40`. **The schema doc line has been corrected.** Note `payslips.working_days` is an unrelated scalar day count and was already correct. The general lesson stands (rule 6 in §10): verify against the live backend, not the doc. |
| **C6** | **P1 — client date authority** | `PunchInOut.tsx` computes `TODAY` in the browser and queries `attendance` with it. A user whose device clock or timezone differs from the tenant's sees the wrong day. This is F2, still open. |
| **C7** | **P2 — no overlap constraint** | v1's F8 ("verify live shift overlap constraints") was never resolved. Frappe raises `OverlappingShiftError`/`MultipleShiftError`. Needs a live check and an exclusion constraint. |
| **C8** | **P2 — audit RLS off** | `attendance_audit_logs` has RLS disabled (per CLAUDE.md). The arch spec depends on it for traceability. |

*Resolved during this pass:* the legacy 7-arg `punch_out_attendance` overload — which bypassed the payroll lock, task gate, break closing, and audit — **was already dropped** in `20260817110000`. Not an open issue.

---

## 5. Target data model

### 5.1 New: `attendance_events` — the immutable log

```sql
create table public.attendance_events (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  employee_id       uuid not null references employees(id) on delete cascade,

  -- WHAT HAPPENED
  event_time        timestamptz not null,           -- the instant, always UTC
  direction         text,                           -- 'in' | 'out' | null (null = undifferentiated device punch)
  source            text not null,                  -- 'app' | 'device' | 'kiosk' | 'manual' | 'import'  (D1)
  source_ref        text,                           -- device serial, kiosk id, import batch id

  -- SHIFT RESOLUTION (stamped at ingest, recomputable)
  shift_id          uuid references shifts(id),
  shift_start       timestamptz,                    -- THE GROUPING KEY (§2.2) — night shifts depend on this
  shift_end         timestamptz,
  shift_actual_start timestamptz,                   -- incl. early-punch-in margin
  shift_actual_end   timestamptz,                   -- incl. late-punch-out margin
  offshift          boolean not null default false, -- no shift matched -> excluded from derivation

  -- DERIVATION LINK (the work queue: attendance_id IS NULL = unprocessed)
  attendance_id     uuid references attendance(id),
  skip_derivation   boolean not null default false,

  -- EVIDENCE (app/kiosk only; ours, not Frappe's)
  lat numeric, lng numeric, location_accuracy numeric,
  location_status   text,
  selfie_id         uuid references attendance_selfies(id),
  evidence          jsonb,                          -- arch spec §7 schema
  device_ip         text,

  -- APPEND-ONLY CORRECTION (D11)
  supersedes_event_id uuid references attendance_events(id),
  superseded_by_id    uuid references attendance_events(id),
  void_reason         text,

  correlation_id    uuid,
  idempotency_key   text,
  created_by        uuid references employees(id),
  created_at        timestamptz not null default now()
);

-- Idempotency: the same physical punch must never land twice, however many times a device retries.
create unique index uq_attendance_events_idem
  on attendance_events (tenant_id, idempotency_key) where idempotency_key is not null;

-- Device replay guard: same employee, same instant, same source = same punch.
create unique index uq_attendance_events_natural
  on attendance_events (tenant_id, employee_id, event_time, source)
  where superseded_by_id is null;

-- The processor's hot path.
create index ix_attendance_events_queue
  on attendance_events (tenant_id, shift_id, shift_actual_end)
  where attendance_id is null and skip_derivation = false and offshift = false;

create index ix_attendance_events_group
  on attendance_events (tenant_id, employee_id, shift_start);
```

### 5.2 Changes to `attendance` (the derived row)

| Column | Change | Why |
|---|---|---|
| `status` | Extend to `present \| absent \| half_day \| on_leave \| holiday \| weekly_off \| work_from_home` | `absent` already exists as a value — **the gap is that nothing ever writes it** (C2), which D4 fixes. The genuinely new values are `holiday` / `weekly_off` / `work_from_home`, so reports can tell a non-working day apart from an unexplained absence. |
| `derivation_source` | **new** `text` — `derived \| manual \| correction \| import \| leave` | Tells the processor what it may overwrite (D5). |
| `is_locked` | **new** `boolean` | HR manual edits and payroll-locked rows are never re-derived. |
| `late_entry` / `early_exit` | **new** booleans, replacing the overloaded `is_late` | D6 — flags, not statuses. |
| `in_time` / `out_time` | **new** `timestamptz` | The derived first-in/last-out. `punch_in`/`punch_out` stay as the app-session view. |
| `leave_id` | **new** `uuid → leaves(id)` | D8 back-link. |
| `shift_snapshot` / `policy_snapshot` | **new** `jsonb` | Arch spec §6. Makes history reproducible; kills C1. |
| `business_date_tz` | **new** `text` | D9 — record which tenant timezone produced `date`. |
| `derived_at` / `derivation_version` | **new** | Replay bookkeeping. |

Unique key becomes `(tenant_id, employee_id, date, coalesce(shift_id, '00000000-...'::uuid))` — one row per employee per day per shift (§2.6).

### 5.3 Changes to `shifts` — the policy carrier

Port Frappe's Shift Type settings (verified field list from `shift_type.json`):

| New column | Type | Default | Frappe equivalent |
|---|---|---|---|
| `begin_check_in_before_shift_start_minutes` | int | 60 | `begin_check_in_before_shift_start_time` (we have `punch_in_opens_minutes_before` — rename/reuse) |
| `allow_check_out_after_shift_end_minutes` | int | 60 | `allow_check_out_after_shift_end_time` |
| `working_hours_threshold_for_absent` | numeric | 0 | same |
| `working_hours_threshold_for_half_day` | numeric | 0 | same |
| `determine_check_in_and_check_out` | text | `alternating` | same (**D7**) |
| `working_hours_calculation_based_on` | text | `first_last` | same (**D7**) |
| `enable_late_entry_marking` / `late_entry_grace_minutes` | bool / int | true / 10 | same |
| `enable_early_exit_marking` / `early_exit_grace_minutes` | bool / int | false / 10 | same |
| `enable_auto_derivation` | bool | true | `enable_auto_attendance` |
| `mark_attendance_on_holidays` | bool | false | `mark_auto_attendance_on_holidays` |
| `process_attendance_after` | date | — | same (**watermark**, §2.7) |
| `last_sync_of_events` | timestamptz | — | `last_sync_of_checkin` (**watermark**, §2.7) |
| `holiday_calendar_id` | uuid | null | `holiday_list` — per-shift holiday override |
| `allowed_punch_sources` | text[] | all | **ours (D1)** — per-tenant/per-shift source policy |
| `crosses_midnight` | bool generated | `end_time < start_time` | derived convenience |

Validation ported from `shift_type.py:validate`: start ≠ end; and **total span including both margins must be < 1440 minutes** (`validate_circular_shift`) — otherwise a shift overlaps itself and resolution becomes undefined.

### 5.4 New: `holiday_calendars` + `holiday_calendar_days`

Today `holidays` is one flat per-tenant list. Frappe resolves **Shift → Employee → Company** precedence and supports **half-day holidays** (which halve both thresholds, §2.2). Needed for tenants operating in multiple states — in India, holiday lists genuinely differ by state.

```sql
create table holiday_calendars (id uuid pk, tenant_id uuid, name text, is_default boolean, ...);
create table holiday_calendar_days (id uuid pk, tenant_id uuid, calendar_id uuid, date date,
                                    name text, is_half_day boolean default false, ...);
```
Resolution order: `shifts.holiday_calendar_id` → `employees.holiday_calendar_id` → tenant default.

### 5.5 New: `attendance_derivation_runs`

One row per processor run: window, trigger (`schedule`/`manual`/`replay`), counts, errors, duration. Without it, a nightly job that silently stops is invisible — which is exactly what appears to have happened to `daily-incomplete-task-marker` (C4).

---

## 6. The derivation algorithm (target)

```
derive_attendance(tenant_id, shift_id, from_date, to_date, trigger):
  tz := tenant timezone                                        -- D9, never implicit
  guard: from_date >= shift.process_attendance_after
  guard: only shifts whose shift_actual_end < shift.last_sync_of_events   -- §2.7 interlock

  -- PASS 1: events -> present/half-day/absent
  for each (employee_id, shift_start) group of unprocessed, non-offshift, non-superseded events:
      if holiday(employee, date) and not shift.mark_attendance_on_holidays: continue
      thresholds := shift thresholds; if half_day_holiday: halve both      -- §2.2
      (hours, in_time, out_time) := calculate_working_hours(events, D7 modes)
      late_entry := shift.enable_late_entry_marking and in_time  > shift_start + grace
      early_exit := shift.enable_early_exit_marking and out_time < shift_end   - grace
      status := absent if hours < absent_threshold
                else half_day if hours < half_day_threshold
                else present                                                -- D6, order matters
      if approved leave covers this date: status := on_leave | half_day; set leave_id   -- D8
      upsert attendance row (skip if is_locked)                             -- D5
      stamp attendance_id onto every event in the group

  -- PASS 2: completeness (D4) — over ASSIGNED EMPLOYEES, not over events
  for each employee assigned to this shift, in batches:
      dates := working days in [max(process_attendance_after, date_of_joining),
                                min(last shift before last_sync_of_events - 1 day, relieving_date)]
               minus holidays minus dates already having attendance          -- §2.7 24h lag
      for each date: insert attendance(status='absent', derivation_source='derived')
```

**Why Pass 2 iterates employees, not events:** events can only tell you who was present. Only the shift assignment knows who *should* have been. This is the structural reason C2 exists today.

---

## 7. Edge case catalogue

The acceptance criteria. Each row is a test case.

### Time and shift boundaries
| # | Case | Required behaviour |
|---|---|---|
| E1 | Punch 23:30, night shift 22:00–06:00 | One attendance row, `date` = the shift's start date. Grouped by `shift_start`. |
| E2 | Punch 01:00 belonging to yesterday's night shift | Same row as E1. Must **not** create a row on the new calendar date. |
| E3 | Punch at 14:30 between a 06:00–14:00 and a 14:00–22:00 shift, both with 60-min margins | Deterministic. `_adjust_overlapping_shifts` trims: scheduled boundary wins over margin (§2.5). |
| E4 | Punch outside every shift window | `offshift = true`. Logged, never derived, visible to HR. |
| E5 | Shift whose span + margins ≥ 24h | Rejected at shift save (`validate_circular_shift`). |
| E6 | Employee's device clock is wrong / traveller in another timezone | Server `event_time` authoritative; business date from tenant tz (D9). |
| E7 | Tenant changes its timezone | Existing rows keep `business_date_tz`; never silently re-derived. |
| E8 | DST | **Explicitly out of scope for India (no DST).** IANA names stored so a future non-India tenant is not blocked. Documented, not silent. |

### Punch pathologies
| # | Case | Required behaviour |
|---|---|---|
| E9 | Double-tap punch-in | Idempotency key collapses to one event. |
| E10 | Missing punch-out | Hours below absent threshold → `absent`, flagged `missing_punch_out` for HR. Never an open session forever. |
| E11 | Odd number of punches, `alternating` mode | Last unpaired punch ignored for hours; row flagged. |
| E12 | Device reports no direction | `direction = null` + `alternating` mode (D7). |
| E13 | Device wrongly reports two INs in a row, `strict_log_type` | Second IN ignored per §2.4 walk; flagged. |
| E14 | Multiple punch pairs (unpaid lunch punch-out) | `every_pair` mode sums pairs (D7). |
| E15 | Device offline 3 days, then bulk-syncs | Events accepted with true timestamps; `last_sync_of_events` advances; affected days re-derived. **This is the case the current architecture cannot serve at all.** |
| E16 | Device sends the same log twice | Natural-key unique index dedupes. |
| E17 | Backdated event arrives after the day was marked absent | Re-derivation flips `absent` → `present`, unless `is_locked`. |
| E18 | Event arrives for a payroll-locked period | Event **stored** (evidence is never discarded), derivation refused, HR notified. |

### Status and policy
| # | Case | Required behaviour |
|---|---|---|
| E19 | Worked 3h against 4h half-day / 2h absent threshold | `half_day`. |
| E20 | Same, on a half-day holiday | Thresholds halved → `present` (§2.2). |
| E21 | Arrived late but worked full hours | `present` **and** `late_entry = true` (D6). |
| E22 | Approved leave + a punch on the same day | Leave wins: `on_leave`, `leave_id` set, punch retained as evidence (D8). |
| E23 | Half-day leave + half day worked | `half_day` with `leave_id`; other half from hours. |
| E24 | Holiday, employee works | `mark_attendance_on_holidays` decides; if marked, holiday overtime multiplier applies. |
| E25 | Weekly off | `weekly_off` status, not `absent`. |
| E26 | Date before `date_of_joining` | Rejected (§2.6). |
| E27 | Date after `relieving_date` | Never derived (§2.7 end-date clamp). |
| E28 | Employee inactive/terminated | No attendance (§2.6). |
| E29 | Employee has no shift assigned | `default_shift` fallback; if none, no derivation, surfaced to HR as a config gap. |
| E30 | Shift reassigned mid-month | Effective-dated resolution per punch date; history untouched. |
| E31 | HR changes a grace period retroactively | Old rows keep `policy_snapshot`; replay is explicit and audited, never silent. |
| E32 | Two overlapping shift assignments on one date | Rejected at assignment (C7 / Frappe `OverlappingShiftError`). |

### Multi-source and security (D1)
| # | Case | Required behaviour |
|---|---|---|
| E33 | Same day: app punch-in, device punch-out | Both events, one derived row. Source recorded per event. |
| E34 | Tenant disables `device` source mid-month | Existing events keep deriving; new device events rejected at ingest. |
| E35 | Kiosk punch for employee A from employee B's session | Kiosk authenticates as a *device*, not a user; employee resolved by code/biometric id, never by session. |
| E36 | Employee calls the punch-out API directly with forged overtime values | Impossible — no client-supplied policy (D12, fixes C1). |
| E37 | Employee punches out on someone else's attendance row | Rejected — ownership assertion (fixes C3). |
| E38 | CSV import of a month of legacy data | Import batch → events with `source='import'`; `process_attendance_after` protects earlier history. |
| E39 | Import with rows for another tenant | Rejected by RESTRICTIVE tenant isolation (D10). |
| E40 | GPS denied / spoofed | Evidence recorded with `location_status`; policy decides; never claimed as proof (arch spec §7). |

### Operational
| # | Case | Required behaviour |
|---|---|---|
| E41 | Processor crashes mid-run | Batched commits; unprocessed events remain queued (`attendance_id is null`). Resume, never double-count. |
| E42 | Processor runs twice concurrently | Advisory lock per (tenant, shift). |
| E43 | Scheduled job silently stops | `attendance_derivation_runs` + a staleness alert. Directly targets C4. |
| E44 | 10k employees × 30 days | Batched (Frappe uses 50/batch); aggregate summary RPC, not per-employee function calls (v1 F7). |
| E45 | Replay of a closed month | Explicit HR action, audited, refuses `is_locked` rows. |

---

## 8. Release plan (supersedes A2–A8)

Ordered so each release is independently shippable and reversible. **A1 is retained as complete.**

| ID | Release | Depends on | Exit criterion |
|---|---|---|---|
| **B1** | **Scheduler proof + observability.** Configure one InsForge schedule end-to-end; add `attendance_derivation_runs`; enable RLS on `attendance_audit_logs` (C8). | — | A schedule demonstrably fires and records a run. Resolves C4, C8. |
| **B2** | **Kill the client-policy vector.** Derive `expected_shift_hours`, `overtime_rate`, `overtime_enabled`, `lunch_minutes` server-side from shift+policy; add the ownership assertion; write `shift_snapshot`/`policy_snapshot`. | — | C1 and C3 closed. Old signature dropped. **Ship this first — it is a live payroll-fraud vector.** |
| **B3** | **`attendance_events` table + RLS + ingest RPC.** Dual-write from the existing app punch path. No derivation yet. | B2 | Every app punch produces an event; `attendance` unchanged. Zero user-visible change. |
| **B4** | **Shift policy fields + resolution engine.** §5.3 columns; port `get_shifts_for_date` / `get_shift_for_time` / `_adjust_overlapping_shifts`; stamp `shift_start`/`shift_end` at ingest. Add the overlap exclusion constraint (C7). | B3 | E1–E5, E30, E32 pass. |
| **B5** | **Holiday calendars.** §5.4 tables + precedence + half-day holidays. Migrate `holidays`. | B4 | E20, E24, E25 pass. |
| **B6** | **Derivation processor.** Pass 1 + Pass 2, watermarks, idempotent replay, batching, advisory lock. Manual HR trigger first, schedule second (D4). | B1, B4, B5 | E9–E31, E41–E45 pass. Derived output matches current production rows for a sample month. |
| **B7** | **Cutover.** `attendance` becomes read-only-derived; SPA reads derived rows; retire direct inserts and `TODAY` (C6). | B6 | F1, F2, C2, C6 closed. |
| **B8** | **Device + kiosk ingestion.** Public ingest endpoint with device auth, replay protection, bulk sync, `allowed_punch_sources` enforcement. | B7 | E15, E16, E33–E35 pass. |
| **B9** | **HR tooling.** Bulk mark, CSV import, range regularization, unmarked-days view, aggregate reporting (v1 F7). | B7 | E38, E39, E44 pass. |

Roadmap A2–A8 map in as: A2→B3, A3→B4+D9, A4→B2+B6, A5→B9, A6→B7, A7→B9, A8→B4.

---

## 9. Open questions

Isolated so they cannot contaminate §3.

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| Q1 | Rotating rosters — needed within 12 months? | Nothing in B1–B9 | Extension point only (D3). |
| Q2 | Which biometric hardware will tenants actually use? ZKTeco push is the assumed shape. | B8 only | Build the generic HTTP ingest endpoint; write vendor connectors on demand. |
| Q3 | Should overtime require approval before payroll, or auto-approve under a threshold? | B6 overtime | Keep the existing approval model. |
| Q4 | Retention for selfies and raw events? | Not blocking | Events forever; selfie objects per a documented retention policy (arch spec §11). |
| Q5 | Multiple office locations per tenant with different geofences — does `office_locations` already carry this, and should shifts bind to one? | B4 | Resolve during B4 (v1's A8). |

---

## 10. Rules for future agents

1. §3 decisions are locked. Changing one requires an ADR, not an edit.
2. Never write derivation logic in the client. D12.
3. Never call `current_date` / `now()::date` in an attendance function. D9.
4. Never edit or delete an `attendance_events` row. D11.
5. Every new table ships with RLS in the same migration. D10.
6. Verify against the live backend, not against `doc/database_schema.md` — C5 proves it drifts.
7. `npx @insforge/cli diagnose` must be clean before any attendance release is called done.
