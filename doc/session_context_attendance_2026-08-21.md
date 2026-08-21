# Session context — Attendance module — 2026-08-21

Handoff for the **attendance & shift module only**. This was a **research and design session.
No code, no migrations, no backend changes were made.** The output is a decision document that
replaces the previous attendance implementation plan.

**Backend:** parent `rq3qmu8y` (`0431f0f6-225f-4fb1-86b7-3fd32684c7f4`). Untouched this session.
**Frontend:** repo head still `eca1650`, branch `main`. Untouched this session.

> Not to be confused with `session_context_2026-08-21.md`, which is the **organisation module**
> handoff from the same day. Both are live. Read that one's §0 first — see below.

---

## 0. START HERE

### ⚠️ Inherited blocker, not from this session: the DB is still AHEAD of the deployed frontend

The organisation-module session ended with production DB migrations applied through
`20260821100000` and **nothing committed or pushed**. That is still true — the count was **62
uncommitted files** when this was written (up from 54 — this session added 7 doc files, listed
in §2, including this one). Expect it to have drifted; the point is that **none of it is pushed**.

The live bundle still reads `employees.department` and `employees.designation`, columns that no
longer exist. **Resolve that before starting attendance work**, or you are stacking a rebuild on
top of an unshipped breaking change. Full detail in `doc/session_context_2026-08-21.md` §0.

```bash
git status --short | wc -l      # ~62, and climbing — none of it pushed
git log --oneline -1            # expect eca1650
```

### What changed for attendance, in one line

The module is being rebuilt on a **two-layer model** — an immutable event log plus a derived daily
row — and the old A2–A8 release plan is dead. Authority is
**`new update doc/attendance_shift_v2_decision_doc.md`**.

### Do not re-litigate these

Four questions were put to the user and answered on 2026-08-21. They are locked as D1–D4.
Do not reopen them without an ADR.

| | Decision |
|---|---|
| **D1** | All punch sources: app (GPS+selfie), biometric/RFID, kiosk, HR manual, CSV import — **configurable per tenant**, several usable at once. User's words: *"flexible for the tenant as per their needs."* |
| **D2** | **Two-layer**: `attendance_events` (immutable log) → processor → `attendance` (derived day). User chose this over keeping the session-row model. |
| **D3** | Day **and night (cross-midnight)** shifts. Rotating rosters are an extension point, not v1. *Recommended by assistant, user accepted — the user said they had no strong view on shift management and asked for a recommendation.* |
| **D4** | Completeness guaranteed: auto-mark Absent, exposed **both** as a scheduled job and a manual HR trigger. *Recommended by assistant, user accepted.* |

---

## 1. State

```
Attendance backend      unchanged. No new tables, no new RPCs, no migrations.
Attendance frontend     unchanged. PunchInOut.tsx / Attendance.tsx / ShiftManagement.tsx as before.
Applied migration head  20260821100000  (org module; nothing from this session)
Releases complete       A1 only (RLS verification, 22/22 — still valid, still the RLS record)
Releases live           B1–B9, all NOT STARTED
```

**Nothing in the v2 design has been validated against the live backend.** The schema in §5 of the
decision doc is a design, not a verified artifact. First implementation step should confirm it
against `metadata` before writing a migration.

---

## 2. What this session produced

| File | Status |
|---|---|
| `new update doc/attendance_shift_v2_decision_doc.md` | **NEW — the authority.** 12 locked decisions, 8 findings (C1–C8), 45 edge cases (E1–E45), 9 releases (B1–B9) |
| `new update doc/attendance_shift_release_roadmap.md` | Banner added; A2–A8 marked `Superseded → v2 §8` |
| `new update doc/attendance_shift_architecture_spec_v1.md` | Banner added; still current for transactional rules |
| `new update doc/attendance_shift_audit_report_v1.md` | Banner added; F1–F8 still stand |
| `new update doc/attendance_shift_management_audit_and_implementation_plan.md` | Banner added; **do not execute its §7 release plan** |
| `doc/database_schema.md` | One line fixed — `shifts.working_days` (finding C5) |

Also: the dead branch URL `rq3qmu8y-jx7` was retired from all four attendance doc headers. It
survives at `attendance_shift_release_roadmap.md:78` **on purpose** — that is inside the A1
verification output, which is historical evidence of what actually ran.

---

## 3. Findings — C1 is the one that matters

Full table in the decision doc §4. The urgent one:

### C1 — P0, live payroll-fraud vector

`punch_out_attendance` (10-arg, `SECURITY DEFINER`, granted to `authenticated`) takes
`p_overtime_enabled`, `p_overtime_rate`, `p_expected_shift_hours`, `p_lunch_minutes` **from the
browser** (`PunchInOut.tsx:809`). Verified in the function body — the parameters are used, not
vestigial:

```sql
IF p_overtime_enabled THEN
  v_overtime_hours := ROUND(GREATEST(0, v_work_hours - p_expected_shift_hours), 2);
  INSERT INTO overtime_records (... p_expected_shift_hours, v_overtime_hours,
                                p_overtime_rate, ROUND(v_overtime_hours * p_overtime_rate, 2), false);
```

Post `p_expected_shift_hours: 0, p_overtime_rate: 10, p_lunch_minutes: 0` and a fabricated
`overtime_amount` lands in the payroll table.

- **Mitigating:** inserted with `approved = false`, so HR approval stands before payout.
- **Not mitigating:** nothing marks the numbers as client-asserted; they look ordinary in the queue.
- **Nuance:** the deduction *mode* (`v_tracking_enabled`, `v_deduction_mode`) **is** read
  server-side from `tenant_settings`. Only the amounts are trusted from the client.

Also still open (from `migrations/20260817110000`'s own closing note): the function **does not
verify the caller owns the attendance row** (finding C3).

### The rest, briefly

`C2` nothing writes Absent · `C3` ownership gap · `C4` zero InsForge schedules configured
(`schedules list` → `[]`) · `C5` **fixed** · `C6` browser-computed `TODAY` · `C7` no shift-overlap
constraint · `C8` `attendance_audit_logs` has RLS off.

---

## 4. Where to start

**Ship B2 first.** It is small, independent of the rebuild, and closes a live P0.

| | Release | Why this order |
|---|---|---|
| 1 | **B2** — derive overtime/hours/lunch server-side from shift+policy; add ownership assertion; write `shift_snapshot`/`policy_snapshot` | Closes C1 + C3. Does not depend on any v2 table. Shippable this week. |
| 2 | **B1** — prove one InsForge schedule end-to-end; add `attendance_derivation_runs`; RLS on `attendance_audit_logs` | Closes C4 + C8. B6 depends on the scheduler working, and it has **never been used in this project** — prove it in isolation first. |
| 3 | **B3** — `attendance_events` table + RLS + ingest RPC, dual-write from the existing punch path | First step of the rebuild. Zero user-visible change if done right. |

Then B4 → B5 → B6 → B7 → B8 → B9 as sequenced in the decision doc §8.

---

## 5. Research artifacts — ⚠️ these are gone, re-fetch them

The Frappe HR source was downloaded to the **session scratchpad, which does not persist.**
The published Frappe docs are near-useless for logic (the auto-attendance page does not even name
the threshold fields), so **read the source, not the docs.**

```bash
B=https://raw.githubusercontent.com/frappe/hrms/develop/hrms
for f in hr/doctype/shift_type/shift_type.py \
         hr/doctype/shift_type/shift_type.json \
         hr/doctype/employee_checkin/employee_checkin.py \
         hr/doctype/attendance/attendance.py \
         hr/doctype/shift_assignment/shift_assignment.py \
         hr/doctype/attendance_request/attendance_request.py ; do
  curl -sS "$B/$f" -o "$(echo $f | tr '/' '_')"
done
```

The parts that carry the design, with what each one gave us:

| Where | What it is |
|---|---|
| `shift_type.py:_process` | The processor. **Groups by `(employee, shift_start)`, not by date** — this one line is the entire night-shift solution |
| `shift_type.py:get_attendance` | Status derivation. Absent threshold checked **before** half-day; both **halved on a half-holiday** |
| `shift_type.py:mark_absent_for_dates_with_no_attendance` | Pass 2. Iterates **assigned employees**, not logs — logs can only say who *was* there |
| `shift_type.py:get_start_and_end_dates` | The watermark pair, and the deliberate **24-hour lag** before marking absent |
| `employee_checkin.py:calculate_working_hours` | The 2×2 matrix. `alternating` mode exists because **cheap biometric devices do not report IN vs OUT** |
| `shift_assignment.py:_adjust_overlapping_shifts` | Trims adjacent grace windows so they cannot both claim a timestamp. The piece most reimplementations miss |
| `shift_assignment.py:get_shifts_for_date` | The **±1 day** fetch window — a shift plus margins spills into both neighbouring days |
| `attendance.py:validate` | The guard list: joining date, duplicate, overlapping shift, inactive employee, **leave overrides status** |
| `shift_type.json` | Exhaustive settings checklist, ported into decision doc §5.3 |

---

## 6. Traps from this session

1. **A large heredoc through the Bash tool fails with `ENAMETOOLONG: uv_spawn`.** Writing a
   ~470-line markdown file that way does not work. Use the Write tool for files of that size.
2. **`doc/database_schema.md` drifts.** It claimed `shifts.working_days` held day-name strings; the
   live column is `integer[]` of `EXTRACT(DOW)` values (`0`=Sunday … `6`=Saturday, typical
   `{1,2,3,4,5,6}`). Verify against the live backend, not that file.
3. **`working_days` is two unrelated columns.** `shifts.working_days` is an integer array of
   weekdays; `payslips.working_days` is a scalar count of expected working days in a month.
4. **Do not infer a finding from a function signature.** C1 was nearly filed as P0 on the signature
   alone. It only became defensible after reading the body and confirming the parameters were used
   and reached `overtime_records`. Read the body.
5. **The 1268-line implementation plan is the file an agent grepping "Release A2" will land in.**
   It now carries a banner. Do not execute its §7.

---

## 7. Commands

```bash
# Confirm the scheduler situation (C4) — expect []
npx @insforge/cli schedules list --json

# Read live state before writing any attendance migration
npx @insforge/cli metadata --json

# The A1 RLS verification script — still valid, still passes, useful as a harness template
node scratch/attendance_shift_a1_verify.mjs

# Inspect the punch-out function body (C1) in the local baseline
sed -n '2410,2620p' migrations/20260814160000_baseline-untracked-functions.sql

# Required before calling any attendance release done
npx @insforge/cli diagnose
```

---

## 8. Documentation map

```
new update doc/
  attendance_shift_v2_decision_doc.md ............ ★ AUTHORITY. Decisions, findings, edge cases, B1–B9
  attendance_shift_architecture_spec_v1.md ....... transactional rules — still current, assumed by v2
  attendance_shift_audit_report_v1.md ............ F1–F8 — immutable, still valid
  attendance_shift_release_roadmap.md ............ A1 result only; A2–A8 superseded
  attendance_shift_management_audit_and_implementation_plan.md ... history; DO NOT execute its §7

doc/
  session_context_attendance_2026-08-21.md ....... this file
  session_context_2026-08-21.md .................. organisation module — read its §0, blocker is live
  database_schema.md ............................. attendance tables §3; treat as hint, verify live
  attendance_geofencing.md / shift_rostering.md .. pre-v2, not reconciled with the v2 design
```

**Reading order for a fresh session:** this file → decision doc §3 (decisions) → §4 (findings) →
§8 (releases). §2 of the decision doc is the Frappe research and can be read when implementing.
