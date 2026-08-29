# B7 — Cutover plan (drafted 2026-08-28)

Authority: `new update doc/attendance_shift_v2_decision_doc.md` §8 (B7), plus
`doc/attendance_completion_plan_2026-08-24.md` for Phases 0–3, which are **DONE and committed**
(`197ead7`, `310fa2a`; applied head `20260828100000`).

B7's exit criteria per the decision doc: **F1, F2, C2, C6 closed.**

---

## 0. The fact that shapes the whole plan

**The live production bundle is PRE-Phase-0.** Checked by marker string, not by filename:

```
bundle: /assets/index-_OaU7Cj5.js   (2,506,508 bytes)
grep -c working_hours_threshold_for_absent  -> 0
grep -c enable_auto_derivation              -> 0
```

Commits `197ead7` / `310fa2a` are on `main` but Vercel has **not** rebuilt from them yet (or the
build is still in flight). So the client running for every employee right now predates all four
phases.

That is survivable today only because Phase 0's `hr_save_shift` change kept the leading 10
parameters identical and defaulted the 11 new ones — verified. **It is not a licence to assume
the next server change is equally forgiving.** Every B7 step must be planned against "the live
client may be the old one."

**First action of B7, before any code:** re-run the marker check and confirm the deploy state.
Never infer it from a filename or a timestamp — hashes differ between local and Vercel builds,
and that mistake nearly broke punch-out once already.

---

## 1. B7 ships as four releases, not one

The decision doc's B7 row bundles four things with very different risk. Bundled, one bad step
takes punch-in down for every employee. `PunchInOut.tsx` is the most-used screen in the product.

| | Release | Risk | Removes anything? |
|---|---|---|---|
| **B7a** | Server-authoritative punch-in + business date | additive | **No** |
| **B7b** | Frontend switches to the new path | medium | No |
| **B7c** | Retire the old direct-insert path | **highest** | **Yes** |
| **B7d** | HR punch trail over `attendance_events` | additive | No |

**B7a → deploy → verify by marker → B7b → deploy → verify by marker → watch a day → B7c.**
B7d is independent of a–c and may run in parallel or last.

Exit criteria are met at the end of **B7c**. B7d closes handoff §6b (nothing reads the log), which
the decision doc does not track as part of B7 but which is a real gap.

---

## 2. What B7 actually changes

Verified live in `src/employee/PunchInOut.tsx` (1552 lines):

| Line | What | Finding |
|---|---|---|
| 19 | `const TODAY = formatLocalDate(new Date())` | **C6.** Client decides the business date; used in ~8 queries |
| 742 | `db.from("attendance").insert([...])` | **F1.** Punch-in writes the table directly |
| 766 | `.update({ is_late: true })` | **D12/D6.** Client decides lateness |
| 799 | `db.rpc("punch_out_attendance", ...)` | already server-authoritative (B2) |

### B7a — additive server work
- **`punch_in_attendance` RPC**, mirroring what B2 did for punch-out: server-derived business
  date from the tenant's IANA timezone (D9), ownership assertion, payroll-lock check, geofence
  evidence recorded, `SECURITY DEFINER` with the tenant fence restored explicitly and the module
  guard on `attendance`.
- **A server-authoritative "today" for the tenant** the SPA can read, so no screen has to compute
  a business date from a device clock.
- **Change nothing else.** The direct-insert path keeps working throughout.

### B7b — frontend switchover
`PunchInOut.tsx` calls the RPC, drops `TODAY`, stops writing `is_late`, and reads the derived
columns (`late_entry`, `early_exit`, `in_time`, `out_time`) instead of the session columns.

### B7c — retire the old path
Revoke/remove the direct-insert route and the client `is_late` write. **Only after B7b is
confirmed live by marker string.** This is the step the marker rule exists for.

### B7d — the HR punch trail
Nothing in the product reads `attendance_events`. HR can see a derived day but not the evidence
behind it. This is the release where the design philosophy applies (§4).

---

## 3. Two decisions B7 must make explicitly

### 3a. `is_late` vs `late_entry` — and it touches payroll

Phase 0 deliberately left `late_mark_grace_override` beside the new `late_entry_grace_minutes`,
deferring reconciliation "until B7". There are now two live lateness models on one row.

Blast radius, verified:

- **`src/`**: 11 references across `PunchInOut.tsx` and `Attendance.tsx`
- **server**: `hr_update_attendance`, `hr_approve_attendance_correction`, and **`payroll_period_input`**

`payroll_period_input` is the attendance→payroll contract. **Payroll is the last module to be
built and its design is not locked**, so B7 should *not* quietly change what that contract emits.

**Recommended:** `late_entry` becomes the derived authority; `is_late` is kept in sync by
derivation for the duration of B7 so the contract's output is unchanged; the contract keeps
emitting the same field. Retiring `is_late` is then a payroll-era decision, made when payroll is
actually designed, rather than a side effect of a frontend cutover. State it; do not drift into it.

**DECIDED AND SHIPPED (2026-08-28, `20260828120000`).** Implemented exactly as recommended.
Investigating it surfaced a **live latent bug**: `attendance_derive_pass1` wrote `late_entry` and
never `is_late`, while `payroll_period_input` counts late marks as
`WHERE a.is_late AND a.status NOT IN ('absent','half_day')`. Every derived row would therefore
have contributed **0** to `late_mark_count` however late the employee was — silently, no error.
Same class as the ₹0 payslips: a value that should be N reads as 0. Latent only because
derivation had not yet been run in production. Pass 1 now writes both, on the INSERT and the
UPDATE path; `payroll_period_input` is byte-identical and untouched.

**CLOSED (2026-08-29, `20260829100000`).** `hr_update_attendance` and
`hr_approve_attendance_correction` wrote `is_late` from their **own** cutoff-time calculation
(`shift.start_time` + `tenant_settings.late_mark_grace_minutes`) and never touched `late_entry`,
so an HR correction on a derived row left `late_entry` stale while `is_late` moved — the same
two-sources-of-truth split, just relocated. Both now write `late_entry` from the *same* variable
as `is_late`, on both the INSERT and the UPDATE branch. All four write paths (Pass 1, Pass 2, and
the two HR paths) now agree, so the row is self-consistent whichever column a consumer reads.
`payroll_period_input` is byte-identical and untouched.

Investigating it surfaced **two further defects in the same two functions**, both latent only
because derivation has never run in production (`attendance_derivation_runs` = 0, while five
tenants already have `enable_auto_derivation` on):

- **`attendance.is_locked` was read by the processor and written by NOBODY.** D5 (§5.2, E17, E45)
  makes `is_locked` the flag that stops a day being re-derived, and Pass 1/Pass 2 both honour it —
  but nothing in the database, in any trigger, or in `src/` ever set it. HR corrects a day, the
  next derivation run silently reverts the correction, no error anywhere. Both HR paths now set
  `is_locked = true` and stamp `derivation_source` (`manual` for a direct edit, `correction` for an
  approved request). **`hr_unlock_attendance_day` was added in the same migration** because a lock
  with no unlock is a one-way door: without it a single HR punch-time tweak would permanently
  exclude that employee-day from re-derivation after a backdated event (E17) or a month replay
  (E45), the two cases the decision doc explicitly wants to keep possible.
- **Both functions located the row by `(tenant_id, employee_id, date)` with no `ORDER BY` and no
  `LIMIT`.** Once Pass 1 writes per-shift rows the unique key
  `(tenant_id, employee_id, date, COALESCE(shift_id, zero-uuid))` legitimately allows several rows
  per employee-day, and a plpgsql `SELECT INTO` without `STRICT` silently takes an arbitrary one.
  `attendance_corrections` has no `shift_id` column, so a correction request genuinely cannot name
  a shift. Both paths now count first and raise a self-diagnosing error instead of correcting a
  shift nobody chose.

**Verification reach:** `assert_hr_for_tenant` refuses a NULL `auth.uid()`, so a migration running
as `project_admin` cannot invoke either function. The migration's checks are structural for the two
HR functions (comment-stripped source scan) and behavioural for the consequence — an HR-shaped
locked row is proven to be skipped by the deployed `attendance_derive_pass1`, and a two-row
employee-day is proven constructible so the ambiguity guard guards a real condition. **The
end-to-end half — calling these RPCs over HTTP with a real HR JWT — is NOT covered and is carried
as an open QA item alongside C3.**

### 3b. C6 is a class of bug, not one line

`TODAY` in `PunchInOut.tsx` is the dangerous instance — it is the one where a wrong day **writes
data**. But client-side date computation also appears in `Attendance.tsx:451`, `MyLeaves.tsx`,
`MyTeam.tsx`, `Calendar.tsx`, and `RunPayroll.tsx`.

**Recommended scope for B7: the punch path only.** The others are read-only and mis-render at
worst. Fixing them is a follow-up, listed here so it is a decision rather than an oversight.

---

## 4. B7d and the design philosophy

Apply `UI Skill/family-values-design` to **B7d only**. B7a–c are correctness work on an existing
screen; the skill's own rule is *polish before delight*, and a punch screen that can write the
wrong day is the dirty bathroom.

For the punch trail specifically:

- **Simplicity — trays, not a new page.** A derived day is the destination; its punch trail is a
  transient detail. Tapping a day opens a tray over the attendance table, preserving context.
  One concept per tray: the event list. A second tray (different height) for a single event's
  evidence — selfie, geofence, source, device.
- **Fluidity — shared-element continuity.** The day row is on screen and persists into the tray;
  it should *travel*, not vanish and reappear. The status pill and date move; the event list
  arrives beneath them.
- **Delight — read the curve.** HR opens a punch trail **rarely**, so this is where a little
  theatre is earned: events can stagger in along the timeline. Punch-in is **daily** for
  employees, so B7b gets micro-interactions only — no confetti on a punch.
- **Polish the states.** `attendance_events` currently holds 3 rows, so empty and sparse states
  are the *common* case at launch, not the edge case. An empty trail must explain why it is empty
  (derived before the log existed, vs genuinely no punches) rather than showing a blank panel.

---

## 5. Rules carried forward

1. **`SECURITY DEFINER` bypasses RLS entirely** — guard every seam with `can_access_tenant()` and
   `tenant_has_module_for(tenant,'attendance')`, plus the `auth.uid() IS NULL` arm. Never
   `FORCE ROW LEVEL SECURITY`.
2. **No `current_date` / `now()::date`** in attendance functions (D9).
3. **Never write derivation logic in the client** (D12) — B7b is *removing* the last of it.
4. **Never edit or delete an `attendance_events` row**; never add a write policy (D11). B7d is
   read-only over the log.
5. **Module independence:** the punch path must work with payroll OFF. No money in attendance —
   and note `punch_out_attendance` still writes an `overtime_amount`, which is payroll policy
   living in attendance. Retiring that is queued after B7c.
6. **Verify the deploy by MARKER STRING**, never by filename or timestamp.
7. **Assert the population, not the sample.** Every probe compares a total count against a
   baseline. This is precisely how the phantom-event bug survived both an agent's assertions and
   a review pass: the probe inspected the two events it created and could not see a third it did
   not expect.

---

## 6. Open thread inherited from Phase 3

The Phase 3 agent was killed while verifying a structural claim about the deployed dual-write
trigger, intending a follow-up migration. Bounded re-derivation, done at the top of B7a:

- `attendance_dual_write_event` — **checked; matches its stated behaviour.** The exception handler
  is gone, so an ingest failure aborts the punch. The only `attendance_audit_logs` reference left
  is inside a comment.
- `attendance_derive_pass1` — **checked behaviourally; the phantom-event fix holds** (2 events in,
  2 events after a Pass 1 run on a probe shift).

Both deployed functions agree with what `20260828100000` claims. The intended follow-up is
**still not identified**, and a passing battery does not retire it. Carry it as open until
something concrete contradicts or explains it.
