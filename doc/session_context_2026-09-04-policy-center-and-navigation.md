# Session context — 2026-09-03/04. Policy Center audited and repaired, geofence moved server-side, navigation re-shaped by module.

Read this first. Then `doc/policy_center_settings_inventory_2026-09-03.md` (§9–§10 are the work
log) and `doc/navigation_proposal_2026-09-03.md`.

```
DB head        20260903170557          12 migrations, all applied and verified
Repo           main, pushed, in sync   13 commits (151c993 .. 3dc6b2d)
Build          green (tsc + vite)
Deploy         Vercel from main
```

---

## 0. THE VISION — what this product is trying to be

*Stated by the product owner across this session. Everything below serves this; when a decision here
conflicts with a detail elsewhere in the docs, this section wins.*

**TalentMesh HRMS is a flexible HR system that adapts to how a company actually works, rather than
forcing a company to work the way the software does.** Different organisation structures, different
working cultures, different modes of work — the product bends to fit.

**Every module can run independently.** A company that wants only attendance can use it and keep
their own payroll. A company that wants only our payroll can use that and keep their own attendance.
Any combination is a supported product, not an accident.

### The module tree (`doc/Roughpicture.md`)

```
                      ORGANISATION MODULE  ← the base everything builds on
                      Directory · Hierarchy · Onboarding
                      Offboarding · Roles / Teams
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   ATTENDANCE            TASK & PROJECT          PAYROLL & FINANCE
   Shifts · Holidays     Projects · Tasks        Salary · Payroll
   Leave · Timesheet     Goals · Workflows       Deductions · Tax
   Overtime · Device                                     │
                                                         ▼
                                                    INSURANCE (later)

              POLICY CENTER  —  company-specific rules controlling each module
              Optional add-ons: CHAT / COMMUNICATION, CONNECT
```

### The commitments that follow from it

1. **The Policy Center is the HR admin's customisation surface** — where they bend each module to
   their own working culture and mode of work. It is not a settings dump. A control that does not
   actually change behaviour is worse than no control, because the admin walks away believing their
   culture is configured when it is not. **This session existed because that had happened at scale.**
2. **Payroll is built LAST**, after attendance, task & project, and the policy center. Its research
   and decision-locking are still open; do not treat its current shape as settled.
3. **Payroll must be usable three ways**: standalone, with the organisation module, and with the
   full attendance system. See §5 — the answer is that it needs the *employee master*, never the
   *org chart*, and the missing piece is a "working days source" switch.
4. **A React Native client comes after the policy center and before payroll**, for punch GPS. Note
   the real win is anti-spoofing, not accuracy — see `hrms-react-native-for-punch-accuracy`.
5. **Module-shaped UI**: navigation, workspaces and settings all grouped by module, with each module
   showing a genuinely different working surface.
6. **Work in a token-efficient way** — cheaper models for mechanical work, stronger ones for review
   and decisions.

---

## 1. Why this session happened

An audit of the Policy Center's attendance tab against the rebuilt attendance and organisation
modules. The finding, in one line:

> **The Policy Center worked. It did not tell the truth.** Of 42 controls, 12 did anything.

The attendance rebuild had moved the authoritative policy surface to the **`shifts`** row, and the
tab was never re-pointed. Beyond that, 13 controls were enforced only in the browser, so a kiosk, a
device or a direct API call skipped every one of them.

That is a direct violation of vision commitment (1), which is why the whole session followed from it.

---

## 2. What shipped

### Policy Center
- **Tabs gated by the module that OWNS their settings** (`salary → payroll`, `task → tasks`). It had
  **zero** module gating; a grep for `module` across 1920 lines returned nothing.
- **Six dead controls removed**, including `late_mark_enabled` — which was also the render gate for
  the two late-mark settings that *do* drive payroll, so turning it off hid live settings while
  changing nothing.
- **A "what is in force right now" panel** — derivation health, shift coverage, geofence reach,
  selfie enforcement boundary. This is the thing that would have made the audit unnecessary.
- The geofence card stops claiming multi-branch fencing it did not do.

### Attendance backend
- **One definition of "late"**: `hr_approve_attendance_correction` now takes grace *and*
  `enable_late_entry_marking` from the shift, matching derivation. Previously a corrected day and a
  derived day in the same month were judged by different grace values, and both feed a salary
  deduction.
- **Multi-branch geofence, server-enforced** — `attendance_evaluate_location()` over
  `office_locations`, each branch with its own radius, wired into both punch RPCs. The client no
  longer decides; `PunchInOut` captures GPS and reports facts.
- **Impossible-travel detection** — flags a punch whose implied speed from the previous located
  punch is physically impossible. Client-agnostic, so it works against the app, a kiosk or a script.
- **Selfie reconciliation** — detects selfies that were required and never arrived.
- **`expire_location_exceptions()` got a runner.** It had none — no trigger, no schedule, no caller.
- **Device-derived days are labelled `device_verified`.**
- `shifts.late_mark_grace_override` (a third grace value, read by nothing) dropped.

### Navigation
- Sidebar **re-grouped into the module tree** above.
- **Module switcher in the top bar**, reachable from every layout mode.
- **`/select` removed** — it chose between *products*, and nothing was left to choose.
- **`classic` layout removed** from both portals; layout preference scoped per user.
- **Attendance and Task & Project workspaces**: module-shaped landing surfaces.

---

## 3. Traps learned this session

- **Never hand-write `CREATE OR REPLACE` for an existing function.** A reconstruction from a partial
  read lost six statements including an employee notification. Derive from `pg_get_functiondef()`
  and edit the derived text. Now a memory: `sql-derive-function-bodies-never-rewrite`.
- **Count `enabled`, not rows.** `tenant_modules` holds a row per catalogue module for every tenant;
  counting rows makes every tenant look fully entitled and produced a wrong conclusion about the QA
  fixtures being fictional. They are intact.
- **PostgREST resolves an RPC by its exact named-argument set.** Dropping a parameter needs three
  steps: give it a DEFAULT, deploy the frontend that stops sending it, then drop it. And Postgres
  requires every parameter *after* a defaulted one to have a default too.
- **A correct verdict can carry wrong evidence.** The geofence allowed and blocked correctly in every
  test while naming the wrong branch — an employee 11m from HQ was recorded as matched to an annexe
  1.1km away. Only running it found that; a review asking "does it fence correctly?" would have
  passed it.
- **One column, two kinds of verdict.** `location_status` carries both a *location* verdict and
  `selfie_missing`. Making the server authoritative silently erased the selfie flag. The rule now:
  the server's verdict wins, except the caller may flag `selfie_missing` — safe because it can only
  make a record worse.
- **A gate can disagree with itself.** Holidays was gated on `leave` in the nav while `modules.ts`
  routed it to `work_calendar`, so an attendance-only tenant was entitled to a screen it could not
  see a link to.

---

## 4. Open items

**Payroll module** (last, per the vision):
- The **"working days source"** switch — `Attendance module / Leave module / Fixed (26 or calendar) /
  Imported CSV`, plus *treat unmarked days as*. This is what makes payroll independently sellable.
  Half exists inert as `lop_calculation_method`. See settings inventory §7.2.
- `salary_template_<dept>` is read by **nothing** — the department template editor writes to a store
  no calculation reads. Remove it during the payroll build.
- Fold `PayrollLayout` into the single shell; build the Payroll workspace then, not before.

**Attendance:**
- **Two-phase selfie binding** — with the React Native client. Must be *fresh and single-use*, or one
  selfie is replayed forever. Native also allows camera-source enforcement.
- **Bind a device to a fenced site.** `attendance_devices.location_id` references `locations` (org
  module, no coordinates) while the fence lives in `office_locations`. Converging those two tables is
  still open.
- `mark_attendance_selfie_missing` still clobbers `location_status`; it should adopt the reconciler's
  rule.

**Product / platform:**
- **`seed_tenant_modules()` grants every module to every new tenant.** For a product sold as
  composable modules, "fully entitled by default" is the opposite default. A real decision, not a bug.
- **`src/hr/Settings.tsx`** — 669 lines, unrouted, writes overlapping keys via a raw upsert that
  bypasses the concurrency guard. Delete it.
- **Is there an `organisation` module key?** The vision's base module is currently `directory` (core)
  + `onboarding` + `offboarding` as three separate catalogue keys. Naming it is a catalogue decision.
- **shadcn/ui** — recommended *not* now. There is no Radix and no `components.json`; adopting it for
  a few components buys a second design vocabulary and none of the benefit. If wanted, do it as its
  own piece of work starting with **tokens, not components** — ideally before the React Native move,
  since a token layer is what lets two clients share a visual language.

⚠️ **Do not fold `leave` into `attendance` as one module KEY.** The vision groups them, and that is
right for *packaging* — but `QA Attendance Only` is *attendance without leave*, a mix that stops
being expressible if the keys merge. Sell them as one SKU; keep two keys.

---

## 5. The payroll independence answer (asked directly, worth not re-deriving)

"Payroll independent of the organisation module" is **two questions**:

| | Can payroll live without it? |
|---|---|
| **Employee master** (`employees`) | **No — and no product does this.** Zoho Payroll ships its own Employees module even standalone; Frappe roots payroll on the Employee doctype. |
| **Org chart** (`org_units`, `job_titles`, `locations`, `employment_types`) | **Yes — it never reads any of it.** `salary_structures` keys on `employee_id` alone: no department, grade, location or job title. |

So payroll-without-the-org-chart **already works**. Keep `directory` core. The axis that actually
needs building is the working-days source switch (§4).

---

## 6. How to verify the attendance backend quickly

```sql
-- the hourly job does three things now; all three report in its payload
select attendance_run_scheduled_derivation(1);
-- => {"success": true, "tenants_processed": 6,
--     "location_exceptions_expired": 1,
--     "selfie_reconciliation": {"rows_flagged": 0, ...}, "runs": [...]}

-- the geofence, without needing a session
select * from attendance_evaluate_location('<tenant>','<employee>', 23.0226, 72.5714, 20, current_date);
```

Module-gated behaviour is checked against the QA fixtures through `tenant_has_module_for()` — the
same predicate the RPCs use — which needs no login. `QA Attendance Only` is attendance + core;
`QA Attendance Payroll` adds leave and payroll.
