# Attendance module — completion plan (2026-08-24)

Authority: `new update doc/attendance_shift_v2_decision_doc.md`. Continues
`doc/session_context_2026-08-21-modules-and-attendance.md`.

Applied head at planning time: **`20260821230000`**. Repo head `24ea41a`, tree clean.

---

## 0. Two corrections to the handoff, verified against the live backend

**(a) The B-numbers in the handoff are wrong.** Handoff §6b says "B5 — the derivation
processor". Decision doc §8 says **B5 = holiday calendars, B6 = derivation processor**. The
decision doc is the stated authority. This plan uses the doc's numbering throughout.

**(b) B4 is marked DONE but only half shipped.** Doc §8 defines B4 as "§5.3 columns; port
`get_shifts_for_date`/`get_shift_for_time`/`_adjust_overlapping_shifts`; add the overlap
exclusion constraint (C7)". Verified live:

| B4 deliverable | State |
|---|---|
| Resolution engine (`attendance_resolve_shift`) | **shipped** |
| `employee_shifts_no_overlap_excl` (C7) | **shipped** |
| §5.3 policy columns on `shifts` | **ABSENT — 14 columns, none of them §5.3** |

`shifts` today: `id, tenant_id, name, start_time, end_time, working_days,
half_day_cutoff_override, is_default, is_active, created_at, updated_at,
punch_in_opens_minutes_before, late_mark_grace_override, punch_out_closes_minutes_after`.

The §6 derivation algorithm reads `shift.process_attendance_after`,
`shift.last_sync_of_events`, both working-hour thresholds and both D7 modes. **None exist.**
B6 cannot be built until they do. That is Phase 0.

**(c) B1 does not block B6.** Doc §8 lists it as a dependency, but D4 says derivation is
exposed "**both** as a scheduled job and as a manual HR trigger", and B6's own row says
"Manual HR trigger first, schedule second". B6 is fully buildable and testable on the manual
trigger. `attendance_derivation_runs` (§5.5) is built as part of B6 because the processor
writes it. Schedule wiring stays a separate small piece after B6 is proven — handoff §6a's
analysis of why it needs a real edge-function auth story still stands.

---

## 1. Two schema blockers that must land before any derivation code

Both are trivial DDL and both fail **silently until runtime** if missed. An agent that hits
them mid-Pass-1 will narrow the algorithm instead of widening the schema.

| Blocker | Live state | Why it breaks derivation |
|---|---|---|
| `attendance_employee_id_date_key UNIQUE (employee_id, date)` | live | §5.2 requires one row per employee per day **per shift**. Pass 1's upsert cannot write a second shift's row on one date. |
| `attendance_status_check` allows only `present, absent, half_day, on_leave` | live | Pass 2 writes `weekly_off` and `holiday` (E25, E24). Every such insert fails the CHECK. |

Both go in Phase 0, with assertions that prove a two-shift-same-day insert and a
`weekly_off` insert now succeed.

---

## 2. Scope, and what is deliberately left out

**In scope:** Phase 0 (B4 completion) → B5 → B6. Ends with derivation working, proven by
the E-case battery, with **nothing user-visible changed**.

**Next gate, not this one — B7 (cutover).** `attendance` becomes read-only-derived, the SPA
reads derived rows, C6's client-side `TODAY` is retired. That touches `PunchInOut.tsx`
(1552 lines) and `Attendance.tsx` (2493 lines) and it is the only phase where a wrong step
is visible in production. It gets its own approval after B6 is proven.

**Deferred with reasons already in the doc:** B8 (device/kiosk ingestion) — Q2, which
hardware tenants will actually use, is unanswered; building vendor connectors blind is the
§9.5 mistake. B9 (HR tooling) — depends on B7.

**On B6's stated exit criterion.** The doc asks that "derived output matches current
production rows for a sample month". Live counts: `attendance` **13 rows**,
`attendance_events` **0**. That comparison is nearly vacuous here. The real exit criterion
is the E-case battery. Stated so no one builds a reconciliation harness against 13 rows.

---

## 3. Phases

Each phase = one migration that **asserts its own outcome** (the habit that paid for itself
four times last session), plus its frontend piece where one exists. Migration versions are
**assigned here**, not chosen by the executing agent — two agents picking the same number is
how `...170000` was lost.

### Phase 0 — `20260824100000_shift-policy-fields-and-attendance-headroom.sql`

Completes B4's policy carrier and clears the two blockers.

1. **§5.3 columns on `shifts`**, Frappe-verified names:
   `working_hours_threshold_for_absent`, `working_hours_threshold_for_half_day`,
   `determine_check_in_and_check_out` (`alternating`|`strict_log_type`, default
   `alternating` — D7, real biometric devices do not report direction),
   `working_hours_calculation_based_on` (`first_last`|`every_pair`, default `first_last`),
   `enable_late_entry_marking`/`late_entry_grace_minutes` (true/10),
   `enable_early_exit_marking`/`early_exit_grace_minutes` (false/10),
   `enable_auto_derivation` (true), `mark_attendance_on_holidays` (false),
   `process_attendance_after` (date), `last_sync_of_events` (timestamptz),
   `allowed_punch_sources` (text[], D1), `crosses_midnight` (generated, `end_time <= start_time`).
   `holiday_calendar_id` lands in Phase 1 with the table it references.
2. **`validate_circular_shift` as a CHECK** (E5): scheduled span + both margins < 1440 min.
   Without it a shift overlaps itself and resolution is undefined.
3. **`attendance.shift_id`** + replace the unique key with
   `(tenant_id, employee_id, date, coalesce(shift_id, '0000…'::uuid))`.
4. **Extend `attendance_status_check`** to `present|absent|half_day|on_leave|holiday|weekly_off|work_from_home`.
5. **`hr_save_shift` extended** to accept and persist the new fields, and
   **`ShiftManagement.tsx`** grows a policy section — otherwise the carrier is dead config
   HR cannot reach.

**Module ownership, settled here not later:** the thresholds live on `shifts`, which is
`attendance`-gated (`module_enabled_attendance`). `holidays` is already `work_calendar`
(core). So a tenant with attendance OFF has no shift policy — which is correct, and is why
every definer function below must read the calendar, not the shift, for the working-day
denominator. This is the same blind spot that produced the ₹0 payslips.

**Assertions:** two shifts on one date for one employee both insert; a `weekly_off` row
inserts; a 25-hour effective span is rejected.

### Phase 1 — `20260824110000_holiday-calendars.sql` (B5)

**Stated deviation from §5.4, with the reason.** §5.4 says "Migrate `holidays`". `holidays`
has **10 frontend call sites across 6 files** — including `insert`, `delete` and `upsert` in
`LeaveManagement.tsx` — plus **4 server functions** (`approve_leave_request`,
`employee_apply_leave_request`, `payroll_period_input`, `work_calendar_working_days`).
Replacing it with a view + INSTEAD OF triggers is a large blast radius for no derivation
benefit.

Instead: **`holidays` remains the physical storage of each tenant's default calendar.** The
new tables carry *additional* calendars only, and precedence resolves
**shift calendar → employee calendar → `holidays`**. Zero churn on existing writers, and
E20/E24/E25 all still land.

1. `holiday_calendars` + `holiday_calendar_days` (with `is_half_day`), **RLS in the same
   migration** (D10): RESTRICTIVE tenant isolation + `can_access_tenant()`/`is_hr()` pair +
   the `work_calendar` module gate, matching `holidays`.
2. `holidays.is_half_day boolean default false` — one additive column, no consumer breaks,
   gives the default calendar half-day support (§2.2 halves both thresholds).
3. `shifts.holiday_calendar_id`, `employees.holiday_calendar_id`.
4. `work_calendar_holiday(tenant, employee, date)` → `(is_holiday, is_half_day, source)`,
   definer, with the tenant fence restored explicitly and the `auth.uid() IS NULL` arm.
5. `work_calendar_working_days` updated to consult the resolver rather than `holidays` alone.

**Assertions:** a shift-level calendar overrides an employee-level one, which overrides
`holidays`; a half-day holiday reports `is_half_day`; the pre-existing working-day counts
for the current shifts are unchanged (the no-op proof, as in `20260821180000`).

### Phase 2 — `20260824120000_attendance-derivation-pass1.sql` (B6, part 1)

1. **§5.2 columns on `attendance`:** `derivation_source`, `is_locked`, `late_entry`,
   `early_exit`, `in_time`, `out_time`, `leave_id`, `shift_snapshot`, `policy_snapshot`,
   `business_date_tz`, `derived_at`, `derivation_version`.
2. **`attendance_derivation_runs`** (§5.5) + RLS. Without it a job that silently stops is
   invisible — which is what appears to have happened to `daily-incomplete-task-marker`.
3. **`attendance_calculate_working_hours`** — the §2.4 2×2 matrix, both D7 modes.
4. **`attendance_derive_pass1(tenant, shift, from, to)`** — group by
   `(employee_id, shift_start)` **not by date** (that grouping IS the night-shift solution);
   halve both thresholds on a half-day holiday; status by D6 ordering (absent threshold
   **first**); `late_entry`/`early_exit` as independent flags; approved leave overrides and
   sets `leave_id` (D8); upsert skipping `is_locked` (D5); stamp `attendance_id` onto every
   event in the group. Advisory lock per (tenant, shift) (E42). Batched commits (E41).

### Phase 3 — `20260824130000_attendance-derivation-pass2-and-trigger.sql` (B6, part 2)

1. **Pass 2 over ASSIGNED EMPLOYEES, not over events** — events only tell you who was
   present; only the assignment knows who should have been. This is the structural reason C2
   exists. Writes `absent` / `weekly_off` / `holiday`.
2. **Watermarks:** never before `process_attendance_after`; only shifts whose
   `shift_actual_end < last_sync_of_events`; absentees from the shift **one day before**
   that watermark (§2.7's deliberate 24h lag).
3. **Clamps:** `date_of_joining` (E26), `relieving_date` (E27), inactive employees (E28).
4. **`hr_run_attendance_derivation(tenant, from, to)`** — the manual HR trigger (D4), writes
   an `attendance_derivation_runs` row.
5. **Flip the B3 dual-write trigger from RECORDING failures to RAISING.** Stated in
   `20260821220000` itself and in handoff §5: a day derived from a knowingly incomplete log
   is worse than a failed punch. This is the release where the log becomes authoritative.

### Phase 4 — verification (no migration)

E-case battery as `DO` blocks ending in `RAISE EXCEPTION` so probes roll back, with test
dates **derived from the data**, not hardcoded (the B4 lesson — a hardcoded August date made
a correct algorithm look wrong):

E1, E2, E3 (already proven in B4, re-run as regression), E9–E14, E17, E19–E28, E30, E41, E42.

Then: `npm run build`, `npm run check:policy-drift` (expect **34 of 259** — every new policy
in this plan ships inside its migration, so the untracked count must not move),
`npx @insforge/cli diagnose` clean (doc §10 rule 7).

---

## 4. Rules handed to every executing agent, verbatim

1. **`SECURITY DEFINER` bypasses RLS entirely.** Tables are owned by `project_admin` with
   `relforcerowsecurity = false`, and Postgres exempts an owner from its own table's RLS. So
   every definer RPC bypasses all 34 `module_enabled_*` policies **and** the tenant fences.
   The processor reads `shifts`, `employee_shifts`, `holidays`, `leaves` and writes
   `attendance` — guard **every** seam with an explicit `can_access_tenant(p_tenant_id)` and,
   where a module is involved, `tenant_has_module_for(p_tenant_id, '<key>')`. Include the
   `auth.uid() IS NULL` arm so it stays callable from a migration, cron, or service-role
   context (the `work_calendar_working_days` precedent).
   **Never "fix" this with `FORCE ROW LEVEL SECURITY`** — that breaks every definer helper
   in the project, including the chat-outage fix.
2. **No `current_date` / `now()::date` in any attendance function** (D9). Business dates come
   from the tenant's IANA timezone, passed explicitly.
3. **Never write derivation logic in the client** (D12).
4. **Never edit or delete an `attendance_events` row** (D11); never add a write policy to it
   — its immutability is the *absence* of policies.
5. **Every new table ships RLS in the same migration** (D10).
6. **Verify against the live backend, not `doc/database_schema.md`** — C5 proves it drifts.
7. **PL/pgSQL plans each statement on first execution of that statement.** To prove a loop
   body, manufacture a row that enters it.
8. Use the **assigned** migration version. Versions must sort after the applied head.

---

## 5. Execution

Phases are **serially dependent** — Phase 0's columns feed everything; Phase 1's calendar
precedence feeds Phase 2's threshold halving. One Sonnet 5 agent per phase, sequential, with
the assertion output verified before the next spawn. Between every phase: `git status` and
`npm run build`, per the repo rule that follows an agent failure.

---

# STATUS — 2026-08-28

Applied head **`20260828100000`**. Build green. Policy drift **34 of 274** (untracked count
unchanged throughout). Repo head still `24ea41a` — **six migrations are applied to production
but uncommitted.**

| Phase | Migration | State |
|---|---|---|
| 0 | `20260824100000` + `100001` | DONE |
| 0 fix | `20260824100002` | DONE — repaired a production break Phase 0 caused |
| 1 (B5) | `20260824110000` | DONE |
| 2 (B6 p1) | `20260825100000` | DONE |
| 3 (B6 p2) | `20260828100000` | **APPLIED; final verification cut short** |

## Verified independently (not from agent reports)

- **Night shift (E1/E2):** events at 22:00 and 02:00 next day → **one** attendance row dated the
  shift's start date, 4h, `present`. Cross-midnight attribution works.
- **Phantom-event fix:** Pass 1 creates its row emitting **no** spurious `in` event (2 events in,
  2 events after). See the bug note below.
- **Punch-in and punch-out both still work through the flipped trigger**, each writing its event.
- `hr_run_attendance_derivation` refuses an unauthenticated caller (`Unauthenticated`).
- Grants: `attendance_derive_pass1` / `pass2` are **`project_admin` only**;
  `hr_run_attendance_derivation` is the sole `authenticated` entry point.
- No probe residue: attendance 13, events 3, runs 0, shifts 6, leaves 3.

## The bug Phase 3 found in Phase 2

`attendance.punch_in` has `DEFAULT now()`. Pass 1's INSERT did not name `punch_in`, so every
Pass-1-created row got `punch_in = now()` — which the dual-write trigger's
`INSERT ... NEW.punch_in IS NOT NULL` branch could not distinguish from a real app punch.
**Pass 1 was silently writing phantom `in` events into the supposedly immutable log.**

Pass 1's own header claimed the opposite, and its E3 probe filtered `WHERE id IN (v_ev1, v_ev2)`
— a query that structurally cannot see an unexpected *third* event, so it passed. Fixed in
`20260828100000` by naming `punch_in` explicitly as NULL. Verified above.

**The lesson:** a probe that only inspects the rows it created cannot detect rows it did not
expect. Count the population, not just the sample.

## Dual-write flip — earned, not assumed

Flipped from RECORDING failures to RAISING. Justified because `attendance_audit_logs` holds
**zero** dual-write failures since B3, and both punch paths were proven to work after the flip.
The exception handler is gone, so an ingest failure now aborts the punch.

## Open

- **E-case battery: VERIFIED (2026-08-28).** Phase 3's F0-F10 assertions were extracted to
  `tests.sql` and re-run against the live database, each `DO` block executed separately (10 of
  the 12 blocks isolate cleanly; the battery is written so a pass exits normally and a failure
  raises). Every block exited clean, and row counts were **identical before and after** —
  attendance 13, events 3, runs 0, shifts 6, employee_shifts 9, leaves 3, inactive employees 0
  — so the probes cleaned up after themselves and left no residue in production tables. This
  closes the concern that Pass 2's absent / weekly_off / holiday branches and the watermark
  interlock had never been exercised. **B6's assertions are proven.**
- **STILL UNKNOWN — do not treat as dismissed:** the Phase 3 agent was killed by the spend limit
  while investigating something it intended to fix in a follow-up migration. A passing battery
  does **not** retire this. The battery only runs the assertions that agent *wrote*; whatever it
  found afterward is by definition something those assertions do not cover. Reasoning "the known
  checks pass, therefore the unknown finding was nothing" is backwards. Treat it as an open
  thread to re-derive during B7, not as closed.
- `approve_leave_request` still deducts whole days and ignores `leaves.day_fraction` (default
  `1.0`, so behaviour is unchanged). Making balance deduction fraction-aware is a separate
  release.
- `hr_update_attendance` / `hr_approve_attendance_correction` still look up attendance by
  `(employee_id, date)` assuming one row — ambiguous now that Pass 1 can write per-shift rows.
- **B7 (cutover) is the next gate**, then the overtime-amount retirement (attendance should emit
  overtime *hours*; `punch_out_attendance` still writes an `overtime_amount`, which is payroll
  policy living in attendance — and payroll is being designed last).
