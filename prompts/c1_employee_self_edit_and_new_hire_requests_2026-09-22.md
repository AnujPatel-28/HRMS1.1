# C1 — Employee self-edit allowlist, and manager new-hire requests

Repo `C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`, branch
`p1-00-harness-reconciliation`, base **HEAD at dispatch**.

Read first: `doc/session_context_2026-09-21-p3-complete.md` (§3 hazards, §4 rules),
`doc/session_context_2026-09-15-senior-dev-m1m2.md` §6 (traps), and
`reviews/package-review-P2-02.md` §1 — the write-denial pattern this repo uses.

---

## 1. Measured by the lead on TB-M1M2, 2026-09-22

**E1 — An employee can switch off location-based attendance for themselves.** As `employee.a`, a
PostgREST `PATCH` on their **own** `employees` row succeeded for every one of these (values restored
afterwards, `RESTORED: true`; probe `scratch/emp-self-write-probe.mjs`):

```
work_mode → "remote"          ALLOWED     holiday_calendar_id  ALLOWED
grade_id                      ALLOWED     attendance_device_id ALLOWED
kiosk_pin_hash                ALLOWED     account_number       ALLOWED
employee_code                 ALLOWED
```

`work_mode = 'remote'` makes the geofence helper skip the location check
(`migrations/20260903112531_…geofence…sql` line 77). So any employee can exempt themselves from
geofenced punching. `grade_id` slips past because the denylist names `grade` but not `grade_id`.

Cause: `employees_self_update` is `PERMISSIVE UPDATE USING user_id = auth.uid()` with no column
limit, and `enforce_employee_update_restrictions` (trigger `employees_update_restrictions_trigger`)
is a **denylist** — every column not named, including every column added in future, is
employee-writable. Writable today: `aadhaar_number, account_number, address, attendance_device_id,
bank_name, blood_group, city, date_of_birth, emergency_contact_*, employee_bio, employee_code,
employment_type, gender, grade_id, holiday_calendar_id, ifsc_code, kiosk_pin_hash, linkedin_url,
pan_number, phone, pincode, profile_photo_url, state, updated_at, work_location, work_mode`.

**E2 — Any employee can create employee records.** Policy `managers_can_create_draft_reports`
(`PERMISSIVE INSERT WITH CHECK status='draft' AND manager_id = get_my_employee_id()`) holds for
**every** employee, not only managers. `src/employee/AddTeamMemberModal.tsx:52` inserts with
`status: "inactive"`, which that policy rejects — so the screen is broken for non-HR users today.

## 2. Decisions (user, 2026-09-22) — do not redesign

**D1 — Self-edit is contact-only (allowlist).** An employee may change on their own row only:
`phone, address, city, state, pincode, emergency_contact_name, emergency_contact_phone,
emergency_contact_relation, employee_bio, linkedin_url, profile_photo_url, blood_group`.
Everything else — bank (`account_number, ifsc_code, bank_name`), identity (`pan_number,
aadhaar_number, date_of_birth, gender`), `work_mode, work_location, holiday_calendar_id, grade_id,
attendance_device_id, kiosk_pin_hash, employee_code, employment_type` — is HR-only.
Implement as an **allowlist**, so a future column is HR-only by default: rewrite the trigger (derive
from `pg_get_functiondef()`, keep the HR and system-session branches) to reject any change outside
the allowlist, **or** revoke UPDATE and move self-edit to a definer RPC with the allowlist. Either is
acceptable; the trigger rewrite is smaller. HR paths must be unaffected.

**D2 — Onboarding keeps working.** `OnboardingWizard.tsx:~248` writes `aadhaar_number` /
`pan_number` document references during onboarding. Measure the employee's `status` during that
step. Allow those two columns **only** while the employee is in an onboarding status, through a
narrow path (a definer RPC, or a status-conditioned branch in the trigger) — not a general
self-edit. Re-run the onboarding path to prove it.

**D3 — "Add team member" becomes a request.** Drop `managers_can_create_draft_reports`. New table
(e.g. `new_hire_requests`: tenant, requested_by employee, name, email, job_title_id, proposed
date_of_joining, status pending/approved/rejected, reviewed_by, reason, timestamps) with RESTRICTIVE
tenant fence; requester reads own; HR reads/reviews all. Submit via definer RPC requiring the
Manager direct-reports authority (`has_access_action('employee.basic.read','direct_reports')` or
equivalent — check the catalogue). **Approval does not auto-create the employee**; HR creates the
employee through the normal onboarding flow and marks the request approved (link the created
employee id if simple). Notify HR on submit (definer insert into `notifications`, keyed on
`employee_id` — **never set `notifications.user_id`**, see package-review-P3-02 §8). Rewrite
`AddTeamMemberModal.tsx` to submit a request; add a minimal HR list/approve/reject surface where HR
already manages employees (smallest reasonable placement — report where you put it).

## 3. Constraints

- TB-M1M2 only (`fb9a8659-…`); **never** `0431f0f6-…`. `npm run test:m1m2:target` first. CLI
  `node node_modules/@insforge/cli/dist/index.js`; `db query` chokes on aggregates.
- Migration `migrations/20260912192000_m1m2-employee-self-edit-new-hire-requests.sql`; one forward
  fix `20260912192100_…` pre-authorized. Exact signatures; one `pg_proc` row per touched name (DO
  block); DEFINERs fenced, pinned `search_path`, no `anon` EXECUTE; tenant fences RESTRICTIVE.
- Allowed files: the migration(s); `src/employee/AddTeamMemberModal.tsx`, `src/employee/MyTeam.tsx`,
  `src/employee/OnboardingWizard.tsx`, `src/employee/MyProfile.tsx`, one HR screen for requests
  (report which), `src/types/index.ts`; new `tests/m1m2/c1_employee_self_edit.mjs`.
- Disposable fixtures, `finally` teardown, RLS 1/2/0 before/after. **Re-run every
  `tests/m1m2/*.mjs`** at the end (rule from P3-02b) and report each exit code.

## 4. Acceptance — raw evidence

1. Re-run the lead's probe logic in your test: every non-allowlisted column → **denied** for
   `employee.a` on own row; every allowlisted column → allowed; values restored.
2. `work_mode` self-change denied → geofence exemption no longer self-grantable.
3. HR (`hr-employee.a`) can still change every column on an employee.
4. Onboarding: an employee in onboarding status writes Aadhaar/PAN refs; the same employee after
   onboarding cannot.
5. A plain employee (no Manager authority) cannot submit a new-hire request and cannot insert into
   `employees` at all; a manager can submit; HR sees and approves/rejects; the requester sees status;
   HR is notified once; no `employees` row is created by the request itself.
6. Hygiene: `pg_proc`, grants, drift (44 of 325 baseline), build, all suites.
