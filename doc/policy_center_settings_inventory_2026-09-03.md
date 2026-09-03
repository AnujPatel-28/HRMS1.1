# Policy Center — full settings inventory and target shape under module independence

**Date:** 2026-09-03 · **Verified against:** live parent `rq3qmu8y`.
**Companion to:** `policy_center_attendance_audit_2026-09-02.md` (which covers the Attendance tab
in depth). This document covers **all five tabs** and answers two questions: how many settings are
actually needed now, and whether the screen should be rebuilt.

---

## 0. Answers

**How many? The Policy Center exposes 42 controls. 12 of them work today.**

| | Count | |
|---|---:|---|
| **Working — enforced server-side** | **9** | keep as-is |
| **Company identity** | **3** | keep as-is |
| Real, but enforced **only in the browser** | 13 | keep the control, fix the enforcement (backend work) |
| **Payroll-owned — defer with the module** | 7 | gate on `payroll`, park until the payroll build |
| Superseded by the **shift**, still a live fallback | 4 | demote in the UI, keep in the data |
| **Dead** — no reader anywhere | 6 | delete |

**Should you rebuild it? No.** The plumbing is the good part —
`save_attendance_policy_transaction` and `save_task_policy_transaction` have verified signatures,
per-key optimistic concurrency that actually works, and correct RLS. A rebuild throws that away.

What is wrong is **taxonomy, not construction**. The tabs are named after *concepts*
(Attendance / Leave / Salary / Task) with no relationship to which module owns or reads a setting,
and **`PolicyCenter.tsx` contains zero module gating** — a grep for `module` in all 1920 lines
returns nothing. A tenant that bought attendance only still sees, and can save into, the Salary and
Leave tabs. That is a **re-tab plus a gate**, roughly one file, not a rebuild.

**The window is now.** Only **1–2 of 15 tenants have ever saved any setting at all** (33 rows in
`tenant_settings`, most against a single tenant). There is essentially nothing to migrate. Doing
the restructure before real customers configure around the current shape costs almost nothing;
doing it after costs a migration and a support story.

---

## 1. The gating asymmetry (this is the core problem)

**The backend already honours module independence. The settings screen does not.**

`punch_out_attendance` is the model to copy — it gates both of its cross-module reads:

```sql
IF public.tenant_has_module_for(p_tenant_id, 'payroll')  THEN  -- payroll lock
IF v_tenant.punch_out_gate_enabled
   AND public.tenant_has_module_for(p_tenant_id, 'tasks')  THEN  -- task gate
```

But `tenant_settings` RLS carries **no module check** — it is `can_access_tenant()` plus `is_hr()`
and nothing else (verified in `pg_policies`). So unlike the 34 module-gated tables, the database
will **not** do this for you here. Gating the Policy Center is necessarily UI work, and it is the
single change that makes the screen honest about independent modules.

`policy_center` and `work_calendar` are correctly `is_core = true` in the live `modules` catalogue —
the settings substrate cannot itself be sellable. That decision holds; nothing here changes it.

### 1a. The QA fixtures are intact, and the gating verifies against them

**Count rows in `tenant_modules` and every tenant looks fully entitled — that is a counting error.**
The fixture migration deliberately guarantees *a row per catalogue module* for each fixture tenant
and then sets `enabled = false` on the ones it does not want, so all 13 rows exist for every tenant
and only the `enabled` flag distinguishes them. Filtering on `enabled` gives the real picture:

| Tenant | Modules actually ON |
|---|---|
| `QA Attendance Only` `[11111111]` | attendance + directory, policy_center, work_calendar (core) |
| `QA Attendance Payroll` `[22222222]` | attendance, leave, payroll + core |
| `QA Full Suite` `[33333333]` | all 13 |
| the 12 real tenants | all 13 |

Both restricted fixtures are exactly as `20260821190000` intended, and that migration is recorded
applied in `system.custom_migrations`.

**Verification of the tab gating.** Evaluated by the database itself, through
`tenant_has_module_for()` — the same predicate the backend RPCs use — against the tab→module map
added below:

```
QA Attendance Only    -> [Attendance, Company]
QA Attendance Payroll -> [Attendance, Company, Leave, Salary]
QA Full Suite         -> [Attendance, Company, Leave, Salary, Task]
```

That is the intended behaviour in all three cases: attendance-only HR sees two tabs, and the
attendance+payroll tenant sees no Task tab. `tenant_modules_self_read` scopes SELECT to
`get_auth_tenant_id()`, and `TenantContext` filters `.eq("enabled", true)`, so an HR session's
`hasModule()` resolves to the same answer as `tenant_has_module_for()`.

**Limit of this verification:** it exercises the entitlement data and the predicate, not the React
render. The fixture tenants' employees have `user_id` NULL, so no browser session was driven as an
HR user of `QA Attendance Only`. The mapping and the data are confirmed; the component behaviour is
reasoned from them.

### 1b. Separately: every new tenant is born fully entitled

Not a fixture problem, but worth a product decision. `seed_tenant_modules()`, bound as
`trg_seed_tenant_modules` on `tenants`, grants **every row of the catalogue** to each new tenant
with `enabled = true`:

```sql
INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, enabled_at)
SELECT NEW.id, m.key, true, now() FROM public.modules m ON CONFLICT DO NOTHING;
```

So all 12 real tenants have all 13 modules on, and nothing ever revokes. For a product whose
premise is that modules are sold and composed independently, "fully entitled by default" is the
opposite default — a tenant that bought attendance still gets Payroll, Chat and Insurance. Whether
that is provisioning policy or an oversight is a decision for you, not a bug this audit fixes.

---

## 2. Full inventory by owning module

Legend — **✅ enforced** server-side · **🌐 browser-only** · **🟡 demote** · **💤 defer to payroll** ·
**❌ dead**

### Core / identity — 3 controls, all fine
| Control | Store | Reader | |
|---|---|---|---|
| `company_name`, `logo_url`, `timezone` | `tenants` | app-wide; `timezone` drives every business-date calc | ✅ |

### Attendance module — 24 controls
| Control | Reader | |
|---|---|---|
| `payroll_lock_date` | `punch_in_attendance` (payroll-gated), `punch_out_attendance`, `assert_date_range_unlocked`, `close_stale_attendance` | ✅ |
| `break_tracking_enabled`, `break_deduction_mode` | `punch_out_attendance`, `hr_update_attendance` | ✅ |
| `short_break_limit_minutes` | `punch_out_attendance`, `end_employee_break`, `fn_auto_close_active_break` (trigger `trg_auto_close_active_break` — **verified bound**) | ✅ |
| `overtime_enabled`, `overtime_rate` | `punch_out_attendance` | ✅ |
| `tenants.lunch_break_minutes` | `punch_out_attendance` | ✅ |
| `geofence_enabled`, `office_lat`, `office_lng`, `geofence_radius_meters`, `geofence_mode` | `PunchInOut.tsx` only | 🌐 |
| `gps_verification_mode`, `attendance_selfie_mode`, `high_`/`medium_`/`low_confidence_max` | `PunchInOut.tsx` only | 🌐 |
| `remote_work_handling` | `PunchInOut.tsx` only | 🌐 |
| `regularization_enabled`, `regularization_window_days` | `PunchInOut.tsx` only — `hr_approve_attendance_correction` does **not** check the window | 🌐 |
| `tenants.punch_in_start`, `punch_in_cutoff`, `work_hours_per_day` | shift fallback for the 9-of-15 tenants with no shifts | 🟡 |
| `late_mark_grace_minutes` | `hr_approve_attendance_correction` only — derivation uses `shifts.late_entry_grace_minutes` | 🟡 |
| `late_mark_enabled` | **nothing** — and it is the render gate for the two below | ❌ |
| `selfie_retention_days` | **nothing** — no purge job | ❌ |

### Payroll module — 7 controls, all deferrable
| Control | Reader | |
|---|---|---|
| `late_mark_threshold`, `late_mark_deduction_hours` | `calculate-late-marks` edge fn, invoked from the browser | 💤 |
| `lop_calculation_method` | `RunPayroll.tsx` only — **no server-side reader** | 💤 |
| `pf_wage_ceiling`, `esi_gross_ceiling` | `RunPayroll.tsx` only | 💤 |
| `professional_tax_state`, `professional_tax_manual_amount` | `RunPayroll.tsx`, `payroll-calc.ts` | 💤 |
| `salary_template_<dept>` | **nothing, anywhere** — the template editor writes to a store no calculation reads | ❌ |

Every one of these is client-side only. That is *why* they are safely deferrable: gating the
Salary tab on `payroll` cannot break a server path, because there is no server path.
`payroll.payslip_template` (note the namespaced key — a different convention from every other key)
is read only by `Payslips.tsx`.

### Leave module — 2 controls
| Control | Reader | |
|---|---|---|
| `leave_min_notice_days` | `employee_apply_leave_request` | ✅ |
| `leave_carry_forward` | **nothing** — `leave_types.carry_forward_enabled` is the real per-type switch | ❌ |

Leave-type CRUD and balance initialisation on this tab go through
`save_leave_type_transaction` / `deactivate_leave_type_transaction` /
`initialize_leave_balances_transaction` and are fine. Note `probation_restricted` and
`requires_document` on a leave type remain inert (see `hrms-leave-settings-inert`) — unchanged by
this audit.

### Tasks module — 3 controls, 2 dead
| Control | Reader | |
|---|---|---|
| `tenants.punch_out_gate_enabled` | `punch_out_attendance`, `approve_task_request`, `close_stale_attendance` — correctly gated on `tasks` | ✅ |
| `task_eod_redmark_time` | `fn_auto_redmark_tasks` — **which has no trigger, no schedule, and no caller** | ❌ |
| `task_grace_period_minutes` | same | ❌ |

The redmark check, verified live:

```sql
select t.tgname, c.relname, p.proname from pg_trigger t
join pg_proc p on p.oid = t.tgfoid join pg_class c on c.oid = t.tgrelid
where p.proname in ('fn_auto_redmark_tasks','fn_auto_close_active_break') and not t.tgisinternal;
-- → only trg_auto_close_active_break on attendance. fn_auto_redmark_tasks is unbound.
```

`daily-incomplete-task-marker` is deployed as an edge function but **unscheduled** — the project has
exactly one schedule, `attendance-derivation-hourly`. So EOD red-marking does not happen, and the
two settings that configure it are dead. **The Task tab is 2 of 3 dead.**

---

## 3. Target shape

Re-tab by **owning module**, gate each tab on that module, and split "policy" from "defaults".

| Tab | Gate | Contains |
|---|---|---|
| **Organisation** | core | company name, logo, timezone · *link to* Org Structure, Locations, Shifts, Holidays |
| **Attendance** | `attendance` | breaks, overtime, verification (geofence/GPS/selfie/confidence), remote-work handling, regularization window · **Default punch rules** (shiftless fallback) in a clearly-labelled subsection |
| **Leave** | `leave` | minimum notice · leave types · balance initialisation |
| **Tasks** | `tasks` | punch-out gate *(see §4)* |
| **Payroll** | `payroll` | statutory ceilings, PT, LOP method, late-mark threshold + deduction, payslip template — **built during the payroll module, not before** |

Rules that fall out of this:

1. **A tab whose module is off is not rendered.** Not disabled — absent. A tenant on attendance
   only should never see a Salary tab.
2. **A setting belongs to the module that *reads* it, not the one it sounds like.** `late_mark_threshold`
   sounds like attendance; it is a salary deduction and belongs to payroll.
3. **A setting the shift owns does not appear here at all** — link to Shift Management instead.
   One value, one screen.
4. **Label the enforcement boundary on every browser-only control.** Until §Group B of the
   companion doc lands, "strict" is a suggestion and the screen should say so.

---

## 4. Two decisions for you, not for me

**(a) Where does `punch_out_gate_enabled` live?** It is a `tenants` column, it currently sits on the
Task tab, it gates an **attendance** action, and the backend gates it on the **tasks** module. It is
also duplicated in the frontend form state — it appears in *both* `TenantForm` and `TaskPolicyForm`.
Two defensible readings:

- **Tasks tab** — the gate only exists because tasks exist; with tasks off it is meaningless.
- **Attendance tab** — it changes what punch-out does, and an HR admin looking for "why can't people
  punch out" will look under Attendance.

I lean **Attendance, gated on `tasks`** (visible only when both modules are on), because that is
where the symptom appears. But it is a product call.

**(b) How aggressive is "delete"?** The 6 dead controls have no readers, but deleting a control is
visible to the 1–2 tenants that saved values. My read is that at this scale it is free — but you
may prefer to hide first and drop the keys later.

---

## 5. Also found — not changed

**`src/hr/Settings.tsx` is a second, parallel settings screen.** 669 lines, five tabs (Company
Profile / Attendance Rules / Leave Policy / Notifications / Audit Log), **completely unrouted and
unreferenced** — it does not appear in `App.tsx` at all. It matters for two reasons:

- It writes overlapping keys (`leave_carry_forward`, `leave_min_notice_days`) via a **raw
  `tenant_settings` upsert**, bypassing the RPC and its optimistic-concurrency guard. If anyone
  ever routes it, it silently clobbers concurrent Policy Center saves.
- Its other keys — `leave_casual_per_year`, `leave_sick_per_year`, `leave_earned_per_year`,
  `email_on_punch_in`, `hr_notification_email` — appear in **none** of the 33 live keys. It encodes
  a pre-`leave_types` design.

Per CLAUDE.md §3 I have not deleted it. It is the obvious candidate to remove alongside the re-tab,
and it should be resolved before anyone mistakes it for the screen to edit.

---

## 6. Sequencing

1. **Gate the five tabs on their modules** — ✅ **done 2026-09-03**, `src/hr/PolicyCenter.tsx` only.
   Each tab now declares the module that *owns* its settings (`salary → payroll`, `task → tasks`);
   a tab whose module is off is not rendered. The active tab is **derived**, not corrected in an
   effect, so a disabled module's panel never flashes before being hidden. `company` is core, so
   the tab list is never empty. Typecheck and build green, verified against the QA fixtures — §1a.
2. **Delete the 6 dead controls** and demote the 4 shift-superseded ones (Group A of the companion
   doc). Still `PolicyCenter.tsx` only.
3. **Move the 13 browser-only checks into the punch RPCs and `device_ingest_punch`** (Group B).
   This is the one with real security value and it needs migrations.
4. **Payroll tab last**, built with the payroll module. Until then it is gated off and the 7
   deferred controls sit untouched — safe precisely because none of them has a server-side reader.

---

## 7. Can Payroll run independently of the Organisation module?

Asked 2026-09-03. Short answer: **yes, and structurally it already can — but "the organisation
module" is two different things and only one of them is optional.**

### 7.1 Split the question

| | What it is | Can payroll live without it? |
|---|---|---|
| **Employee master** (`employees`) | the person, their ID, their status | **No — and it should not try.** |
| **Org structure** (`org_units`, `job_titles`, `locations`, `employment_types`, reporting lines) | the org chart | **Yes — payroll never reads any of it.** |

Verified: `salary_structures` keys on `employee_id` and carries `effective_from`, `ctc_annual`,
`basic_percent`, `hra_percent`, `special_allowance`, `pf_applicable`, `esi_applicable`,
`tds_monthly`, `other_allowances` — **no department, no grade, no location, no job title.**
`org_units`, `job_titles` and `employees` carry no module-gated policy at all (38 other tables do),
because `directory` is `is_core = true`. So "payroll without the org chart" is already the case;
"payroll without an employee master" is not a thing any payroll system does.

That matches both reference products:

- **Zoho** sells Payroll as a **separate product with its own pricing**, and it ships its own
  Employees module — basic details, tax details, payment details — because a standalone payroll
  still needs an employee master. Zoho People is an **optional** integration that syncs the employee
  database and pushes **Loss-of-Pay data** into Payroll. The employee master exists either way; what
  the HR product adds is *facts about days*.
- **Frappe HR** builds Payroll on the **Employee doctype** as a hard dependency, with Salary
  Component → Salary Structure → Salary Structure Assignment → Payroll Entry. Modules are Python
  packages coupled only through document-event hooks — separable in code, but all rooted on Employee.

**Conclusion:** keep `directory` core. Do not try to make payroll runnable without an employee
master; make it runnable without the **org chart**, which it already is.

### 7.2 The axis that actually needs a decision: where do working days come from?

This is the real "independent payroll" question, and Frappe answers it with one explicit setting —
`Calculate Payroll Working Days Based On`, whose options are **Leave Application** or
**Attendance**, plus two companions:

- `Consider Unmarked Attendance As` (Present / Absent) — appears only when the source is Attendance.
- `Include holidays in Total no. of Working Days` — changes the per-day divisor, so 10 holidays in a
  30-day month means 30 working days or 20 depending on the checkbox.

**We already have the seam; we do not have the switch.** `payroll_period_input(tenant, start, end)`
is the one contract between attendance/leave and payroll, and its two rules — *facts not policy*,
and *unknown is never zero* — are correct and should not be eroded. But which source a tenant is
using is **implicit**. Frappe makes the admin declare it; we infer it.

Note the two products differ on the unknown case, and Frappe's is friendlier:
`Consider Unmarked Attendance As` lets the admin say "treat unmarked as Present, I'll only mark
absences". Our rule refuses to guess and emits no row — which is right as a *default* (it is what
stopped payroll paying everyone ₹0 when attendance was off) but is unusable as the *only* behaviour
for a tenant that does not run our attendance module.

**Recommendation — one control, on the deferred Payroll tab:**

> **Working days source:** `Attendance module` · `Leave module` · `Fixed (26 / calendar days)` ·
> `Imported CSV`
> and, when the source is Attendance: **Treat unmarked days as** `Present` · `Absent` · `Refuse to
> run` (today's behaviour).

Half of this already exists and is inert: `lop_calculation_method` is already
`{calendar, fixed_26, working_days}` but is read only in `RunPayroll.tsx`. It is the natural place
to grow this control rather than adding a fourth concept.

That single setting is what makes payroll genuinely sellable on its own: a company using their own
attendance system picks *Fixed* or *Imported CSV*, one using ours picks *Attendance module*, and
nothing about the org chart enters into it.

### 7.3 One caution on the module taxonomy

The working model groups **leave inside attendance**. The live catalogue keeps `attendance`,
`leave` and `work_calendar` separate, and so do both reference products. That separation is load-
bearing here: `QA Attendance Payroll` is precisely *attendance + leave + payroll without tasks*,
and `QA Attendance Only` is *attendance without leave* — a combination that stops existing if leave
is folded in. `work_calendar` is already core for the same reason (attendance measures against it,
leave deducts from it, payroll divides by it).

Folding leave into attendance is defensible as **packaging** — sell them as one SKU — but it should
not become one *module key*, or the attendance-without-leave mix is no longer expressible.

---

## 8. Group A — applied 2026-09-03

`src/hr/PolicyCenter.tsx` + `src/utils/policyValidation.ts`. Typecheck and build green.

**Dead controls removed** (5 of the 6; salary templates deliberately left — §6 parks them with the
payroll build): `late_mark_enabled`, `selfie_retention_days`, `leave_carry_forward`,
`task_eod_redmark_time`, `task_grace_period_minutes`. `validateTaskPolicy` became empty and was
removed with its call site.

**The geofence was not merely mis-labelled — it was unusable.** `office_lat` / `office_lng` had
**no input anywhere in the app**, while both the client validator and
`save_attendance_policy_transaction` refuse the save when the toggle is on without them
(`INVALID_POLICY_VALUE: Geofence is enabled but office lat/lng are missing`). Turning the geofence
on was therefore impossible. Group A adds the two coordinate inputs.

> ⚠️ **This makes a dead control live.** Once coordinates are saved, `PunchInOut` enforces the
> fence immediately — in `strict` mode if that is what is stored, which blocks punch-in for anyone
> outside the radius. Previously the toggle was unreachable and so harmless. There is still no
> server-side counterpart, so kiosk and device punches remain unchecked (§3.3 of the companion doc).

**Honest labelling added:** the Verification card and the geofence card now state that their checks
run in the employee app only and that kiosk/device punches bypass them; the regularization window
says HR approval does not re-check it; the "Multi-branch Geo-fencing is active" claim and the
hardcoded "Currently set to warn-only" line are gone.

**Re-pointed to the shift:** *Punch Rules* is now *Default punch rules*, labelled as the fallback
for employees with no shift. A zero-shift tenant gets a warning that attendance will not be derived
at all, with a link to Shift Management. The late-mark card states that whether a day is late is a
shift setting, and its grace field is labelled for what it actually drives — HR correction approval.

**Deliberately NOT removed — `late_mark_grace_minutes`.** Group B item 1 must re-point
`hr_approve_attendance_correction` at `shifts.late_entry_grace_minutes` first. Removing the control
before then would freeze the stored value with no way for HR to correct it.

**Two consequences worth recording:**

1. Both save RPCs loop over a *server-side* key array writing `coalesce(p_policy->>key, '')`, so the
   next save blanks the removed keys. Harmless — nothing reads them — but the blanking is real.
2. The task tab now passes `p_expected_setting_versions: null`, since it no longer owns any
   `tenant_settings` key. **It therefore no longer performs a stale-write check.** Acceptable while
   its only field is a `tenants` column (still covered by `p_expected_tenant_updated_at`), but it is
   a deliberate loss of a guard, not an oversight.

**Correction to §2 while applying this:** `leave_carry_forward` was removed as dead, and
`fn_accrue_monthly_leaves` was checked to confirm it reads neither that key nor
`leave_types.carry_forward_enabled`. **Per-type carry-forward is equally unenforced** — no process
applies it anywhere in the app. The replacement copy on the Leave tab says so rather than pointing
HR at a second inert control.

---

## 9. Group B — started 2026-09-03

**B-1 — one definition of "late". Migration written and reviewed; NOT YET APPLIED.**

`migrations/20260903102438_repoint-correction-grace-to-shift.sql`

`hr_approve_attendance_correction` now takes the grace period **and** the
`enable_late_entry_marking` switch from the same shift row it already resolves `start_time` from,
matching `attendance_derive_pass1`. `tenant_settings.late_mark_grace_minutes` survives only in the
no-shift fallback arm — the same branch in which `start_time` already falls back to
`tenants.punch_in_start`, and in which the scheduled derivation does not run at all.

**How the body was produced, and why it matters.** The first attempt reconstructed the function
from memory of a partial read. Diffing that against the deployed definition found **six** silent
divergences: `derivation_source` written as `'hr_correction'` instead of `'correction'`, extra
`created_at`/`updated_at` columns, a changed `session_status` branch, a rewritten audit payload
(wrong action name, wrong target type, a non-existent `status` column), a **dropped employee
notification**, and a different return shape. The migration was rebuilt by taking
`pg_get_functiondef()` of the live function and applying four textual edits to it, so every other
statement is byte-identical. Assertions in the migration re-check the three most damaging of those
(`derivation_source = 'correction'`, `INSERT INTO notifications`, the audit action name) so a future
edit cannot quietly lose them.

> **Rule worth keeping:** never hand-write a `CREATE OR REPLACE` for an existing function. Derive it
> from `pg_get_functiondef()` and edit the derived text.

**Not applied.** Applying it is a production DDL write and was refused by the sandbox's permission
layer. To apply:
> `npx @insforge/cli db migrations up 20260903102438`

then confirm with the queries in §9.1 below.

### 9.1 Post-apply verification

```sql
-- 1. the shift is now the source, and the fallback is the only tenant_settings read
select pg_get_functiondef(oid) ~ 'late_entry_grace_minutes' as reads_shift_grace,
       pg_get_functiondef(oid) ~ 'enable_late_entry_marking' as honours_shift_switch
from pg_proc where proname = 'hr_approve_attendance_correction';

-- 2. derivation and correction now agree for a shifted employee
--    (QA Attendance Only [11111111] has a shift; approve a correction and compare
--     attendance.is_late against what pass 1 would produce for the same in-time)
```

The migration's own `DO $assert$` block covers (1) at apply time and rolls the whole migration back
if it fails, so a failed apply leaves nothing half-changed.

### 9.2 Remaining Group B items, unstarted

2. Move geofence / GPS / selfie / regularization-window enforcement into `punch_in_attendance`,
   `punch_out_attendance` and `device_ingest_punch`. **Now more urgent than when it was written:**
   Group A made the geofence configurable for the first time, so a tenant can now switch on a
   `strict` fence that the employee app enforces and the device seam ignores entirely.
3. Decide where a geofence lives — `office_locations` (3 rows, read by nobody) vs coordinates on the
   org module's `locations`.
4. Retire or wire `shifts.late_mark_grace_override` (a third grace value, editable in the Shift UI,
   read by nothing).
5. Schedule or drop `expire_location_exceptions()`.
6. Then, and only then, remove the grace field from the Policy Center — B-1 must be applied first or
   the stored value freezes with no way for HR to correct it.

**Branch rehearsal was not possible.** CLAUDE.md rule 5 asks for a branch; `branch list` returns
`Insufficient permissions` on this account, consistent with the retired-branch history. The
compensations are: derive-don't-write the body, assert the invariants inside the migration, and keep
the change to a single function.

### 9.3 B-1 applied and verified — 2026-09-03

Applied. `system.custom_migrations` head is now `20260903102438`. All six in-migration assertions
passed at apply time and were re-checked against the live body afterwards:

```
reads shift grace: true | honours switch: true | fallback arm present: true
derivation_source correct: true | notification kept: true | audit action kept: true
```

**What actually changed, per tenant.** Resolving the grace the correction path will now use against
the value it used before:

| Tenant | Active employees | Shift grace (new) | Old `tenant_settings` grace | Employees affected |
|---|---:|---:|---|---:|
| QA Attendance Only | 2 | 10 | unset → 0 | 2 |
| QA Attendance Payroll | 2 | 10 | unset → 0 | 2 |
| QA Full Suite | 2 | 10 | unset → 0 | 2 |
| QA Testing Org | 7 | 10 | unset → 0 | 7 |
| TalentMesh | 3 | 10 | unset → 0 | 3 |
| **testtest** | 4 | **10** | **30** | 2 |
| Testcorps | 1 | **no shift** | unset | 0 — uses the fallback arm, unchanged |

Two distinct outcomes, both correct:

1. **Five tenants had the setting unset**, so corrections were being judged with **zero** grace while
   derivation used the shift's 10 minutes. Those 16 employees now get the same 10 minutes on both
   paths — corrections become *more lenient* and, more importantly, consistent.
2. **`testtest` had 30 minutes stored** against a shift grace of 10 — the exact discrepancy this
   migration exists to remove. Corrections there now use 10. ⚠️ **This is stricter than before**: a
   punch 20 minutes late that a correction would previously have cleared is now a late mark, and late
   marks feed `calculate-late-marks` and therefore a salary deduction. Intended, but it is a
   money-affecting change and `testtest` should be told which value is the real policy.
3. **`Testcorps` has no shift at all**, so it takes the `tenant_settings` fallback arm exactly as
   designed — and derivation does not run for it either, so nothing is inconsistent.

**Blast radius on existing data: none.** `attendance_corrections` holds **0 rows** (0 pending, 0
approved), so nothing is retroactively re-judged and no pending approval changes outcome. The
function only computes lateness at approval time.

**Still not verifiable from here:** `hr_approve_attendance_correction` calls
`assert_hr_for_tenant()`, which raises when `auth.uid()` is NULL, so a CLI/`project_admin` session
cannot invoke it. The grace *resolution* above is verified against live data with the same query
shape the function now uses; an end-to-end approval needs an HR session
(see `hrms-rls-verification-method`).

**Group A item 4 is now unblocked** — the Policy Center's grace field can be removed, since the
shift is authoritative for every tenant that has one and the field only reaches the no-shift
fallback.

### 9.4 B-2 — multi-branch geofence, server-enforced. Written; NOT YET APPLIED.

Product decision: the fence is **multi-branch from the start**, built on `public.office_locations`.

**Two migrations, in order.**

`20260903105835_attendance-multi-branch-geofence-helper.sql` — additive, nothing calls it yet.
Adds `attendance_evaluate_location(tenant, employee, lat, lng, accuracy, business_date)` returning
`(allowed, loc_status, confidence, matched_location_id, distance_meters, remote_exception_id,
block_reason)`, plus `device_verified` as a new allowed `location_status`.

`20260903110429_enforce-geofence-server-side.sql` — wires it into `punch_in_attendance`,
`punch_out_attendance`, and re-points the config guard in `save_attendance_policy_transaction`.

**Design points worth keeping.**

- **Inside ANY branch's own radius**, evaluated as `min(distance - radius) <= 0` — not "within the
  radius of the nearest branch". A close branch with a tight radius must not mask a farther branch
  with a generous one. The branch that actually matched is returned, not the nearest.
- **`p_loc_status`, `p_confidence` and `p_remote_exception_id` become advisory.** They stay in both
  signatures deliberately — a punch-RPC signature change without a simultaneous frontend deploy
  broke punch-in for four days once — but the persisted values are the server's. `p_lat` / `p_lng` /
  `p_acc` are still the caller's, because those are raw sensor facts rather than policy.
- **Fail open at runtime, guard at config time.** If the fence is on but no active branch exists,
  the evaluator allows the punch and marks it, rather than locking a company out. The real guard
  moved to `save_attendance_policy_transaction`, which now refuses to enable a geofence with no
  active `office_locations` row — replacing the old "office lat/lng are missing" check.
- **`geofence_enabled` becomes real.** It was read by **nothing** — 0 references in
  `PunchInOut.tsx`, which always required a fence unless remote handling relaxed it. ⚠️ **This is a
  behaviour change:** with the toggle off there is now no fence, so punches previously recorded
  `outside_geofence` by the browser will record `office_verified`. That is what the toggle's label
  promises, but it does discard a signal the client was recording unasked.
- **Devices are out of scope, deliberately.** `device_ingest_punch` writes an attendance *event*;
  derivation creates the row. Labelling device punches `device_verified` therefore belongs in
  `attendance_derive_pass1`, not the seam. A fixed terminal has no GPS to fence — its physical
  presence is the verification, and `allowed_punch_sources` per shift remains the right control.

**Blast radius: nil.** Exactly one tenant has any geofence setting at all (`testtest`), and its
`geofence_enabled` is `false`. No tenant has the fence on, and no tenant has an active
`office_locations` row, so applying both migrations changes no punch outcome today.

**Frontend, applied in the same pass.** The Policy Center geofence card drops the single
lat/lng inputs added by Group A (superseded), restores the **Manage Office Locations** link — now
true rather than false — shows the count of branches being fenced against, and warns when there are
none. `office_lat`, `office_lng` and `geofence_radius_meters` are removed from the form, the
payload and the validator; the client validator's "Valid office latitude is required" rule would
otherwise have blocked enabling the fence under the new model.

**Still duplicated, next step:** `PunchInOut.tsx` continues to run its own fence check against the
old single `office_lat`/`office_lng`. It cannot block today — it only blocks when
`gps_verification_mode = 'strict'`, and no tenant is strict — but it should be reduced to capturing
GPS and surfacing the server's `GEOFENCE_BLOCKED` (P0012), so there is one implementation rather
than two.

**To apply:**
> `npx @insforge/cli db migrations up --all`

### 9.5 B-2 applied, tested — and the test found a bug

Both migrations applied; head `20260903110429`. Wiring verified live:

```
punch_in_attendance                : evaluates=true  enforces=true  old single-point guard gone=true
punch_out_attendance               : evaluates=true  enforces=true  old single-point guard gone=true
save_attendance_policy_transaction : old single-point guard gone=true
```

**Functional test.** Two synthetic branches on `QA Attendance Only`, chosen to discriminate correct
multi-branch logic from the "nearest branch" bug: `ZZ TEST HQ (tight)` r=100m and
`ZZ TEST Annexe (generous)` r=2000m, 1.1km apart, with `geofence_enabled=true`,
`gps_verification_mode=strict`.

| Case | Result |
|---|---|
| **A** — 11m from the tight HQ | allowed ✅ · **matched = Annexe, dist = 1100.8m** ❌ |
| **B** — 222m outside HQ, inside the Annexe | allowed ✅ · matched = Annexe ✅ |
| **C** — Mumbai, 441km away | blocked ✅ · "You are 439089m outside the nearest office area." ✅ |

**B is the case that matters** and it passes: a punch outside the nearest branch's tight radius but
inside a farther branch's generous one is allowed. A "nearest branch" implementation would have
blocked it. Per-branch radius works.

**A is a bug I introduced, and only testing found it.** `ORDER BY (dist - radius) ASC` picks the
branch with the *most spare radius*, which gives the right verdict but names the wrong branch
whenever the punch is inside more than one fence. An employee standing 11m from HQ was recorded as
matched to an annexe 1.1km away — and `matched_location_id` / `distance_meters` are persisted as
evidence HR reads.

Fix in `20260903112531_geofence-report-the-branch-you-are-actually-at.sql`: prefer branches you are
inside, nearest first, falling through to nearest-by-distance when outside all of them (which is
also what the block message claims to measure).

```sql
ORDER BY ((d.dist - o.radius_meters) <= 0) DESC, d.dist ASC
```

> **Lesson:** the allow/deny verdict was correct in all three cases, so a review that only asked
> "does it fence correctly?" would have passed this. The defect was in the evidence, not the
> decision.

### 9.6 Test fixture — REMOVED 2026-09-03

Left in place only long enough to prove `20260903112531` against identical conditions, then removed:

```sql
DELETE FROM office_locations
 WHERE tenant_id = '11111111-1111-4111-8111-000000000001' AND name LIKE 'ZZ TEST %';

DELETE FROM tenant_settings
 WHERE tenant_id = '11111111-1111-4111-8111-000000000001'
   AND key IN ('geofence_enabled', 'gps_verification_mode');
```

`QA Attendance Only` had neither setting before this test, so deleting the rows restored it exactly.
Confirmed after cleanup: `office_locations = 0`, `tenant_settings = 0` for that tenant, no `ZZ TEST`
rows anywhere, and `office_locations` back to the 3 pre-existing rows. No `attendance` row was
created at any point — the tests called `attendance_evaluate_location()` directly, which is `STABLE`
and writes nothing; `punch_in_attendance` / `punch_out_attendance` were never invoked.

### 9.7 B-2 verified end to end — 2026-09-03

`20260903112531` applied; head `20260903112531`. The same three cases, re-run:

| Case | Before the fix | After |
|---|---|---|
| **A** — 11m from the tight HQ | matched **Annexe**, 1100.8m ❌ | matched **HQ, 11.1m** ✅ |
| **B** — 222m outside HQ, inside the Annexe | matched Annexe ✅ | matched Annexe, 889.6m ✅ |
| **C** — Mumbai, 441km | blocked ✅ | blocked, nearest-by-distance 439979.8m ✅ |

The remaining code paths were exercised on the same fixture before cleanup:

| Path | Result |
|---|---|
| strict + no coordinates | **blocked** — "Location is required in strict mode but no coordinates were supplied." |
| warn + far outside | allowed, `outside_geofence` |
| `geofence_enabled = false` + far outside | allowed, `office_verified` — **the toggle is real now** |
| confidence banding | accuracy 20 → `high`; accuracy 400 → `very_low` (bands 50 / 150 / 300) |

Every branch of the evaluator is now covered by an observed result rather than by reading the code.

### 9.8 PunchInOut simplified — one fence, server-side

`src/employee/PunchInOut.tsx`, −41 lines net. Build green.

The screen now **captures GPS and reports facts**; it no longer decides. Removed: the
`office_lat` / `office_lng` / `geofence_radius_meters` reads, the `checkGeofence()` call, both
`strict`-mode early returns that blocked the punch client-side, and the whole `location_status`
derivation — `punch_in_attendance` / `punch_out_attendance` overwrite it regardless. The
`verification_snapshot` stops recording the retired single-point fence (`office_lat`, `office_lng`,
`geofence_radius`) and keeps the facts that are still true: accuracy, confidence, work mode, GPS
mode, selfie state, exception, and whether GPS was captured at all.

A blocked punch now surfaces the server's own reason: `GEOFENCE_BLOCKED` (P0012) carries the
distance and cause in `DETAIL`, which the catch shows instead of "Failed to complete punch."

`checkGeofence` and `toast` became unused here and were dropped from the imports/destructure.
Note `src/utils/geolocation.ts` also exports a **`checkMultiGeofence`** that nothing has ever
called — written for the multi-branch model, never wired. It is now genuinely redundant, since the
fence lives in the database.

**A regression of mine, found by doing this and fixed in
`20260903115418_preserve-selfie-missing-over-location-verdict.sql`.** `20260903110429` stopped
persisting the caller's `p_loc_status` — right for a *location* verdict, since a client must never
be able to assert `office_verified`. But `selfie_missing` is not a location verdict; it shares the
column, and the client sets it when a required selfie was never captured. The server's evaluator
knows nothing about selfies, so it was overwriting the flag.

The rule is now: **the server's verdict wins, except that the caller may flag `selfie_missing`.**
That asymmetry is safe by construction — the flag can only make a record worse, never claim a
verification that did not happen, which is exactly the property that made trusting `p_loc_status`
unacceptable. (The other selfie path was never affected: `mark_attendance_selfie_missing` is a
separate RPC called when a selfie *upload* fails after the punch.)

> **Lesson, again:** moving a decision server-side is not one change. The column carried two
> different kinds of verdict, and only one of them belonged to the server.

**To apply:**
> `npx @insforge/cli db migrations up --all`

⚠️ **Deploy the frontend in the same pass.** Until `20260903115418` is applied, a required-but-
missing selfie is recorded as `office_verified`. And until this `PunchInOut` build ships, the old
bundle still runs its own fence against the retired single point — harmless only because no tenant
is in `strict` mode (`hrms-frontend-backend-deploy-skew`).

### 9.9 Impossible-travel check — applied and verified

`20260903121818` adds `attendance_check_impossible_travel(tenant, employee, lat, lng, at)`;
`20260903121907` calls it from both punch paths and merges the result into
`verification_snapshot.server_travel_check`.

**Why this rather than waiting for better GPS.** Browser geolocation can be set to arbitrary
coordinates from devtools in seconds — no accuracy improvement addresses that, and a native client
is what finally allows mock-provider detection. This check needs no client cooperation at all: it
compares two coordinates the server already stored, so it works against the web app, a kiosk, or a
direct API call equally.

**It flags; it does not block.** The inputs are noisy — a GPS glitch can jump hundreds of metres,
and a genuine long-haul flight between two punches is legitimate. Blocking on a heuristic would lock
real employees out of their own attendance, the exact failure mode this workstream keeps removing.

**Threshold: 900 km/h, and only past 1km of separation** — above commercial cruise speed, so a flag
means "no vehicle did this", not "this looked fast". A tighter, more useful threshold (a 30km hop in
10 minutes is implausible on the ground but only 180 km/h) would have to become a tenant policy, and
adding an inert setting is the pattern this audit exists to remove. Hardcoded until someone tunes it.

**Verified** against a real prior punch (Surat, 2026-08-29):

| Probe | Result |
|---|---|
| Same office, 1 min later | `within_noise_floor`, not flagged |
| **London, 1 min later** | **`implausible: true`**, 612,699 km/h |
| London, 3 days later | `implausible: false`, 97.4 km/h |

Same distance, opposite verdicts — the elapsed time is doing the work, which is the property that
makes it a spoof detector rather than a travel ban. Both safe paths also confirmed: no coordinates
and no previous located punch each return `checked: false` rather than erroring.

### 9.10 Policy Center — Group A item 4 closed

The late-mark grace field now renders **only when the tenant has zero shifts**, labelled as the
no-shift fallback. B-1 made the shift authoritative wherever one exists, so for 6 of 15 tenants the
field was pure confusion; for the 9 with no shifts it is still the live value
`hr_approve_attendance_correction` reads. Removing it outright would have frozen it at 0 for exactly
the tenants that need it.

---

## 10. Status panel + remaining Group B — 2026-09-03 (PARTIALLY VERIFIED)

**Applied, built and deployed 2026-09-03** — database head `20260903123437`, commit `19c7744`.
(This section was written during a tooling outage and briefly carried a "not applied" warning; that
warning is resolved. Verification is recorded in §10.6.)

### 10.1 Applied and verified (unchanged from §9)

Database head is `20260903121907`. Everything through the impossible-travel check is applied,
verified and deployed (commit `6a8fa9b`).

### 10.2 Written, NOT applied

| Migration | What |
|---|---|
| `20260903123252_attendance-hourly-housekeeping.sql` | Gives `expire_location_exceptions()` a runner |
| `20260903123437_derive-device-verified-location-status.sql` | Pass 1 labels device-only days `device_verified` |

**`expire_location_exceptions()` had no runner at all** — no trigger, no schedule, no caller — so
approved WFH exceptions never expired. `attendance-derivation-hourly` is the *only* schedule this
project has (pg_cron is installed but `project_admin` has no `USAGE` on the `cron` schema), so the
hourly run is the only place a periodic job can live without new infrastructure. The call is wrapped
in its own `EXCEPTION WHEN OTHERS` so housekeeping can never fail a derivation run that already did
its work; the outcome is reported as `location_exceptions_expired` (1 ran, -1 raised).

**`device_verified` corrects the framing of an earlier finding.** The audit said device punches
"bypass every verification setting". A fixed terminal has no GPS to fence and no camera to prompt —
its physical presence *is* the verification, and forcing the app's checks onto it would break the
kiosk. What was genuinely missing is that such a day was **indistinguishable from an unverified
one**: `device_ingest_punch` writes an *event*, derivation creates the row, and `location_status`
was never set at all. Pass 1 now sets it when **every** event in the group came from a device or
kiosk (`sources <@ ARRAY['device','kiosk']`). A mixed day is deliberately left NULL rather than
claimed as either, and `COALESCE(v_loc_status, location_status)` means re-derivation never erases a
status the punch path established.

### 10.3 Frontend written, NOT typechecked or built

**The live status panel** (`LivePolicyStatus` in `PolicyCenter.tsx`) — the thing that would have
made this entire audit unnecessary. It renders above the tabs, gated on the `attendance` module, and
reports **what is in force** rather than what is configured:

| Row | Sourced from |
|---|---|
| Derivation | last `attendance_derivation_runs` row — never run / last run *N*h ago / failed with *N* errors, and "no shifts, never derived" when `shiftCount = 0` |
| Shift coverage | active employees with no `employee_shifts` row, **only when the tenant has no default shift** (a default covers everyone) |
| Geo-fence | on/off, branch count, strict vs warn, and that devices are not location-checked. Flags **enabled with zero branches** as a fail-open |
| Selfie | mode, and that it is asked for in the employee app only |

`attendance_derivation_runs` is fetched but its error is **deliberately not thrown** — the panel is
diagnostic, and a tenant that cannot read run history must still be able to edit its policies. Known
limitation: an RLS failure there is currently indistinguishable from "never run".

**`shifts.late_mark_grace_override` retired from the UI.** Nothing ever read the column; the grace
that decides lateness is `late_entry_grace_minutes`, used by both `attendance_derive_pass1` and (as
of `20260903102438`) HR correction approval. Offering a third grace field that silently did nothing
is the exact pattern this audit exists to remove. `p_late_mark_grace_override` is still sent to
`hr_save_shift` as an explicit **null** rather than dropped — the parameter is still DECLARED, and
omitting a declared parameter reads as "function not found" through PostgREST.

### 10.4 Not started

- **Dropping the `late_mark_grace_override` column**, and removing the parameter from
  `hr_save_shift`. Per the column-drop playbook this must come *after* the frontend above is
  deployed, not with it.
- **Server-side selfie enforcement.** Worth stating plainly: it is not achievable in the current
  shape. The selfie uploads *after* the punch, so at punch time the server has only the client's
  claim — and a client that can lie about `selfie_captured` can lie about anything. Real enforcement
  needs a two-phase flow (upload first, pass the returned id into the punch RPC). What *is* buildable
  now is reconciliation: mark rows `selfie_missing` where policy required one and no
  `attendance_selfies` row exists after a grace window, run from the same hourly job. That is
  detection, not enforcement, and should be described as such.
- **Binding a device to a fenced site.** `attendance_devices.location_id` references `locations`
  (the org-module table, no coordinates) while the fence lives in `office_locations`. This is the
  same table-convergence decision left open in §9.2 item 3.

### 10.5 To resume

```
npx tsc --noEmit -p tsconfig.app.json && npm run build
npx @insforge/cli db migrations up --all
git add -A src migrations doc && git commit && git push origin main
```

Then verify: the hourly run's next payload should carry `location_exceptions_expired`, and a
device-sourced day should derive with `location_status = 'device_verified'`.

### 10.6 Verified after apply — 2026-09-03

Head `20260903123437`. Typecheck and build clean; deployed as `19c7744`.

```
attendance_run_scheduled_derivation: expires exceptions=true isolated=true passes intact=true
attendance_derive_pass1            : device_verified=true no-clobber=true D5 guard=true
```

**The hourly job was run end-to-end rather than only inspected:**

```json
{"success": true, "tenants_processed": 6, "lookback_days": 1,
 "location_exceptions_expired": 1, "runs": [ ...6 runs, "errors": 0 each... ]}
```

`location_exceptions_expired: 1` is the housekeeping firing for the first time — the function had
existed with no caller since it was written. Six tenants derived with zero errors, so adding the
call did not disturb the run it hangs off.

### 10.7 What is still open

- **Drop the `late_mark_grace_override` column** and remove the parameter from `hr_save_shift`. The
  frontend that stopped writing it is now deployed, which is the precondition the column-drop
  playbook requires. `src/types/index.ts` and `useEmployeeShift.ts` still *read* the column; they
  must be cleaned in the same change as the drop.
- **Selfie: reconciliation, not enforcement.** Enforcement is not achievable in the current shape —
  the selfie uploads after the punch, so at punch time the server has only the client's claim, and a
  client that can lie about `selfie_captured` can lie about anything. Real enforcement needs a
  two-phase flow (upload first, pass the returned id into the punch RPC). Buildable now: mark rows
  `selfie_missing` where policy required one and no `attendance_selfies` row exists after a grace
  window, from the same hourly job. Describe it as detection.
- **Bind a device to a fenced site.** `attendance_devices.location_id` references `locations` (no
  coordinates) while the fence lives in `office_locations` — the convergence decision from §9.2.
- **Payroll tab**, with the payroll module: the seven deferred controls, the dead
  `salary_template_<dept>` editor, and the "working days source" switch from §7.2.
- **`Settings.tsx`** — 669 lines, unrouted, raw upserts bypassing the concurrency guard. Remove it
  with the navigation re-tab.

### 10.8 Selfie reconciliation — applied and verified

`20260903170557_reconcile-missing-selfies.sql`. Runs from the hourly job alongside
`expire_location_exceptions()`.

**This is detection, not enforcement, and the UI should say so.** A selfie cannot be enforced at
punch time in the current shape: it uploads *after* the punch, so the server has only the client's
claim that one was taken — and a client that can lie about `selfie_captured` can lie about anything.
Real enforcement needs a two-phase flow: upload first, pass the returned id into the punch RPC, and
require it to be **fresh and single-use** — without single-use, one selfie is replayed forever, and
that is the detail that decides whether two-phase is worth anything. That belongs with the native
client, where camera-source can also be enforced.

What this closes is the blind spot: HR turns selfies on, believes they are being collected, and has
no way to see that they are not.

**It does not repeat the bug in `mark_attendance_selfie_missing`**, which overwrites
`location_status` unconditionally and so destroys the location verdict on the same row. Here the
finding always lands in `verification_snapshot.server_selfie_check`, and `location_status` is only
overwritten when it currently holds a *clean* verdict (`office_verified`, `remote_approved`,
`device_verified`, or NULL) — never over `outside_geofence` or `gps_unavailable`, which are the more
serious signals and must survive.

**Verified on two rows that differ only in their existing status:**

| Row (before) | After |
|---|---|
| `outside_geofence`, no selfie | **status unchanged**, finding recorded in the snapshot |
| `office_verified`, no selfie | **`selfie_missing`**, finding also in the snapshot |

Idempotent — a second run flagged `0`. Skips `is_locked` rows so an HR correction is never
re-flagged. All test state was restored afterwards: `server_selfie_check` rows = 0,
`selfie_missing` rows = 0, test setting removed.

The hourly job now returns all three outcomes together:

```json
{"success": true, "tenants_processed": 6,
 "location_exceptions_expired": 1,
 "selfie_reconciliation": {"rows_flagged": 0, "tenants_affected": 0,
                           "lookback_days": 2, "grace_minutes": 15}}
```

**Follow-up worth doing:** `mark_attendance_selfie_missing` still clobbers `location_status`. It is
the employee-app path for a failed *upload*, and it should adopt the same rule as the reconciler.
