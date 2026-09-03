# Policy Center — attendance tab audit against the rebuilt Attendance + Organisation modules

**Date:** 2026-09-02 · **Verified against:** live parent `rq3qmu8y` (project `0431f0f6…`), not the repo.
**Scope:** does the Policy Center work, and does its Attendance tab still agree with the B1–B8
attendance rebuild and the org module? **No code was changed by this audit.**

---

## 0. Verdict

**The Policy Center works mechanically. Its Attendance tab no longer tells the truth.**

The save path is sound — `save_attendance_policy_transaction(p_tenant_id,
p_expected_tenant_updated_at, p_expected_setting_versions, p_policy)` matches the frontend call
exactly, carries optimistic-concurrency versions per key, and `tenant_settings` is now properly
fenced (RESTRICTIVE tenant policy + HR-only writes). Nothing is broken at the plumbing level.

The problem is semantic. The attendance rebuild moved the authoritative policy surface from
`tenant_settings` to the **`shifts`** row, and the Attendance tab was never re-pointed. Of the
24 settings it saves, **7 are enforced server-side, 12 are enforced only in the browser, 3
duplicate a shift-level field that now wins, and 2 are read by nothing at all.**

---

## 1. Method

Repo greps cannot settle this — `migrations/` lags the backend (32 of 275 policies drift) and six
edge functions have no source in `functions/`. Every claim below comes from the live database:

```sql
-- which live functions read a given setting key
with keys(k) as (values ('late_mark_enabled'), ...),
     defs as (select p.proname, pg_get_functiondef(p.oid) d
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f')   -- prokind='f', or aggregates raise
select keys.k, string_agg(defs.proname, ', ')
from keys left join defs on defs.d like '%' || keys.k || '%' group by keys.k;
```

`save_attendance_policy_transaction` is the *writer*, so it appears against every key; any key whose
only hit is that function has **no server-side enforcer**.

---

## 2. The mapping

Every setting below is written by the Policy Center. Readers are live, verified.

| Setting | Server-side reader | Client reader | Verdict |
|---|---|---|---|
| `payroll_lock_date` | `punch_in_attendance` (payroll-module-gated), `punch_out_attendance`, `assert_date_range_unlocked`, `close_stale_attendance` | — | Enforced |
| `break_tracking_enabled` | `punch_out_attendance`, `hr_update_attendance` | PunchInOut | Enforced |
| `break_deduction_mode` | `punch_out_attendance`, `hr_update_attendance` | PunchInOut | Enforced |
| `short_break_limit_minutes` | `punch_out_attendance`, `end_employee_break`, `fn_auto_close_active_break` | PunchInOut | Enforced |
| `overtime_enabled` | `punch_out_attendance` | — | Enforced |
| `overtime_rate` | `punch_out_attendance` | — | Enforced |
| `tenants.lunch_break_minutes` | `punch_out_attendance` | PunchInOut | Enforced |
| `geofence_enabled` | **none** | PunchInOut:594 | Browser-only |
| `office_lat` / `office_lng` / `geofence_radius_meters` | **none** | PunchInOut:594-596 | Browser-only, **and contradicted by the UI — §3.2** |
| `geofence_mode` (`warn`/`strict`) | **none** | PunchInOut | Browser-only |
| `gps_verification_mode` | **none** | PunchInOut | Browser-only |
| `attendance_selfie_mode` | **none** | PunchInOut | Browser-only |
| `high_` / `medium_` / `low_confidence_max` | **none** | PunchInOut | Browser-only |
| `remote_work_handling` | **none** | PunchInOut:457 | Browser-only |
| `regularization_enabled` / `regularization_window_days` | **none** — `hr_approve_attendance_correction` does not check the window | PunchInOut:246-258 | Browser-only |
| `late_mark_grace_minutes` | `hr_approve_attendance_correction` **only** | PunchInOut | **Conflicts with `shifts.late_entry_grace_minutes` — §3.1** |
| `tenants.punch_in_start` | fallback anchor in `hr_approve_attendance_correction` | fallback for `shifts.start_time` | Superseded default |
| `tenants.punch_in_cutoff` | — | fallback for `shifts.half_day_cutoff_override` | Superseded default |
| `tenants.work_hours_per_day` | — | fallback for the shift span | Superseded default |
| `late_mark_threshold` | — (`calculate-late-marks` edge fn, invoked from the browser) | PunchInOut, HR Attendance, RunPayroll | Payroll-side, keep |
| `late_mark_deduction_hours` | — (same) | same | Payroll-side, keep |
| `late_mark_enabled` | **nothing, anywhere** | — | **Dead** |
| `selfie_retention_days` | **nothing** — no purge job exists | — | **Dead** |

---

## 3. Findings, ranked

### 3.1 Two late-mark engines judge the same month by different grace values

`attendance_derive_pass1` computes lateness from the **shift**:

```
v_late_entry := v_shift.enable_late_entry_marking
  AND v_calc.in_time > (v_group.shift_start
                        + make_interval(mins => v_shift.late_entry_grace_minutes));
```

`hr_approve_attendance_correction` computes it from **`tenant_settings.late_mark_grace_minutes`**
(its lines 53-55), anchored on the shift's `start_time`. Both write `attendance.is_late` **and**
`attendance.late_entry`.

**They do not overwrite each other.** `hr_approve_attendance_correction` sets `is_locked = true`
(its line 153), and Pass 1 checks that up front and `CONTINUE`s past a locked row (D5, its lines
155-170). That guard works. So this is not a race.

What it is instead: within one employee's one month, a **corrected** day is judged by
`tenant_settings.late_mark_grace_minutes` and every **derived** day by
`shifts.late_entry_grace_minutes`. `calculate-late-marks` then counts *all* `is_late = true` rows in
that month and turns the excess into a salary deduction — so a single month's deduction is computed
from two different definitions of "late", and which one applies to a given day depends only on
whether HR happened to touch it. That reaches payroll.

Worse: **`late_mark_enabled` is read by nothing.** Turning "Enable late mark tracking" **off** in
the Policy Center does not stop late marks. The real switch is `shifts.enable_late_entry_marking`,
on the Shift screen.

### 3.2 The geo-fence card makes a claim the code does not implement

The card renders, verbatim:

> **Multi-branch Geo-fencing is active.** Employees can punch in from any active office location.
> → *Manage Office Locations*

There are **three** geofence stores, and the one the UI advertises is inert:

| Store | Shape | Read by |
|---|---|---|
| `tenant_settings.office_lat` / `office_lng` / `geofence_radius_meters` | one circle per tenant | PunchInOut.tsx only |
| `office_locations` (lat, lng, radius_meters) — **3 live rows** | many circles per tenant | **nobody** — the DB function scan returns `NONE`; only its own CRUD screen touches it |
| `locations` (org module) | country / state / city / timezone — **no coordinates at all** | org screens |

A tenant with three branches configures three office locations, is told "Multi-branch Geo-fencing
is active", and is in fact fenced to a single lat/lng pair. The org module's `locations` table — the
one that actually models an organisation's sites — has no geofence columns to grow into.

Same card, last line: a hardcoded `Currently set to warn-only…` paragraph renders **even when
Strict is selected**, directly under the strict-mode warning banner.

### 3.3 Every verification setting is bypassed by device and kiosk punches

B8 added a second punch path — `device_ingest_punch`, behind the kiosk and ADMS/ZKTeco seam. Its
only policy check is:

```sql
SELECT allowed_punch_sources INTO v_allowed FROM shifts WHERE id = v_shift_id;
```

No geofence. No GPS mode. No selfie. No confidence thresholds. Those live in `PunchInOut.tsx`,
which a device punch never executes. HR sets *"Geo-fence: strict, Selfie: both"*, believes the
organisation is covered, and a kiosk punch ignores all of it. The same is true of any direct API
call — these are browser checks, not policy.

### 3.4 A tenant with no shifts gets no derivation, silently

`attendance_run_scheduled_derivation` skips a tenant entirely unless it has a shift:

```sql
FOR v_tenant IN SELECT ... FROM tenants t
WHERE tenant_has_module_for(t.id, 'attendance')
  AND EXISTS (SELECT 1 FROM shifts s
              WHERE s.tenant_id = t.id AND s.is_active AND s.enable_auto_derivation)
```

Live counts: **9 of 15 tenants have zero shifts. Only 5 have a default shift. 7 of 21 active
employees have no `employee_shifts` row.** New tenants provision empty (see
`hrms-tenant-subdomain-provisioning`).

So the common new-tenant path is: HR opens the Policy Center, configures the Attendance tab, saves
successfully — and attendance derivation never runs for that organisation. Nothing in the product
says so. The Attendance tab's "Shift Management — *N* shifts configured" line reads `0` without
comment.

### 3.5 Dead configuration on both sides of the seam

| Field | Where HR sets it | Read by |
|---|---|---|
| `late_mark_enabled` | Policy Center → Late Mark Rules | nothing |
| `selfie_retention_days` | Policy Center → Verification | nothing (no purge job) |
| `shifts.late_mark_grace_override` | **Shift Management UI** | nothing (a *third* grace value) |
| `shifts.crosses_midnight` | — | nothing (type definition only) |
| `expire_location_exceptions()` | — | never invoked — no schedule, no trigger, no caller |

`late_mark_enabled` is worse than merely unread: it is the **render gate** for the two settings
that do work. `PolicyCenter.tsx:1338` wraps the grace / threshold / deduction inputs in
`{attendancePolicy.late_mark_enabled ? … }`. So HR turning "Enable late mark tracking" **off**
hides the threshold and deduction fields, changes nothing about whether days are marked late, and
leaves the last-saved threshold and deduction **still driving payroll deductions** — invisibly,
with no way to see or edit them without turning the toggle back on.

Note there is exactly **one** schedule on the project: `attendance-derivation-hourly`
(`20 * * * *`). Anything else described as periodic is not running.

### 3.6 Corrections to standing docs

- `CLAUDE.md` §16 says `tenant_settings` has **RLS off — "a real cross-tenant leak"**. **That is
  fixed.** It now carries `tenant_active_restrictive` (RESTRICTIVE, `can_access_tenant`) plus
  HR-only INSERT/UPDATE/DELETE and a tenant-wide SELECT. Verified live via `pg_policies`.
- `PunchInOut.tsx:1140` falls back to `tenant.punch_in_cutoff` as the *shift end* label, but that
  column is the **half-day cutoff** (its other use, line 234). A shiftless employee is shown
  "Office hours: 09:00 – 10:30".

---

## 4. Recommendation

The Attendance tab should stop pretending to own per-day attendance rules. It should own
**tenant-wide money and verification policy**; the shift should own **the working day**.

The work splits cleanly into two groups. **Group A is copy and layout inside `PolicyCenter.tsx`
only** — no migration, no backend change, safe to ship on its own and it removes every false claim
the screen currently makes. **Group B is backend behaviour** and is a scoped project.

### Group A — Attendance tab only (`src/hr/PolicyCenter.tsx`)

1. **Delete the hardcoded "Currently set to warn-only" line** — it renders under the strict-mode
   warning and contradicts it (§3.2).
2. **Remove the "Multi-branch Geo-fencing is active" copy and the Office Locations link**, or gate
   them behind Group B item 3. Today the sentence is simply untrue (§3.2).
3. **Ungate the late-mark fields from `late_mark_enabled`.** Either drop the toggle entirely and
   always show threshold + deduction, or keep the toggle and make it stop hiding settings that
   still drive payroll (§3.5). Relabel the card *Late-mark payroll rules* and note that whether a
   day is marked late is set per shift.
4. **Move late-mark grace out of the tab**, replaced by a line pointing at Shift Management —
   `shifts.late_entry_grace_minutes` is the value derivation actually uses (§3.1).
5. **Relabel the "Punch Rules" card** *Default punch rules — used only for employees with no shift
   assigned*, with the live count of such employees beside it (§2, "superseded default" rows).
6. **Warn when the tenant has zero shifts**: *"No shifts configured — attendance will not be derived
   for this organisation"*, linking to Shift Management. This is the single highest-value addition
   on the screen (§3.4).
7. **Label the browser-only controls honestly** — geofence, GPS mode, selfie, confidence
   thresholds, regularization window: *"Enforced in the employee app. Device and kiosk punches are
   not checked."* (§3.3).

### Group B — backend, needs migrations

1. **Re-point `hr_approve_attendance_correction`** at `shifts.late_entry_grace_minutes` so a
   corrected day and a derived day in the same month use one definition of late (§3.1).
2. **Move geofence / GPS / selfie / regularization-window enforcement** into `punch_in_attendance`,
   `punch_out_attendance` and `device_ingest_punch`, the way `payroll_lock_date` and the break
   rules already are. Until this lands, "strict" is a suggestion (§3.3). This is the item with
   real teeth.
3. **Decide where a geofence lives.** Either teach the punch path to read `office_locations`, or
   add coordinates to the org module's `locations` table and retire `office_locations` plus the
   `office_lat`/`office_lng` settings. Do not leave three stores (§3.2).
4. **Retire or wire `shifts.late_mark_grace_override`** — do not ship a third grace field (§3.5).
5. **Either schedule `expire_location_exceptions()` or drop it**, and either implement
   `selfie_retention_days` as a purge job or remove the control (§3.5).

**Do not delete** `punch_in_start` / `punch_in_cutoff` / `work_hours_per_day` — they are the live
fallback for the 9 of 15 tenants with no shifts. Demote them in the UI, keep them in the data.

---

## 5. What this audit did not do

- Did not write migrations or change any code.
- Did not verify RLS from an employee-role session — per `hrms-rls-verification-method`, an
  HR/superadmin session cannot. The `tenant_settings` policy shapes above are read from
  `pg_policies`, which is authoritative for *what the policies are*, not for how they resolve for a
  given user.
- Did not exercise the Policy Center in a browser. "Works mechanically" means the RPC signature,
  the argument set, the concurrency tokens and the RLS grants all line up — not that a human saved
  a form.
- Checked `migrations-pending-deploy/` — it holds only the two `create_employee_transaction`
  migrations (`20260902120000`, `20260902130000`). Nothing pending addresses any finding above, so
  none of them is stale-by-one-deploy.
