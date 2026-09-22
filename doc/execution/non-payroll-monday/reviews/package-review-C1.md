# Package review — C1 employee self-edit allowlist and new-hire requests

Reviewer: Opus 5 (lead), 2026-09-22. **Verdict: ACCEPTED** with one lead forward fix.

Commits: `cc694cc` (Sonnet 5: migrations `192000`, `192100`, frontend, `c1_employee_self_edit.mjs`);
lead: `192200`, `p3_policy_center.mjs` self-seeding, this review.

## 1. What was wrong before C1 (lead probe, `scratch/emp-self-write-probe.mjs`)

An employee could PATCH their own `employees` row: `work_mode → remote` (geofence skips the location
check), `holiday_calendar_id`, `grade_id`, `attendance_device_id`, `kiosk_pin_hash`,
`account_number`, `employee_code` — all ALLOWED. The trigger was a denylist. Any employee could also
insert draft employee rows.

## 2. Implementer's work — sound, with a real catch of its own

Allowlist trigger diffs `to_jsonb(OLD/NEW)`, so future columns are HR-only by default. `192100`
correctly found that the brief's "onboarding status" premise was false (the wizard is gated on
`employee_onboarding_self.completed_at`, never on `employees.status`) and that the wizard writes seven
columns, not two. New-hire requests: RESTRICTIVE fence, writes revoked at GRANT, submit requires
Manager direct-reports authority, HR notified on `employee_id` only, approval never creates an employee.

## 3. Lead forward fix `192200` — the onboarding window was open for 88% of employees

`192100` treated "no completed onboarding row" as open. **15 of 17** active employees with logins
have **no row at all**, so they kept self-edit on bank, PAN, Aadhaar, DOB and gender — undoing the
contact-only decision. (The implementer flagged this as a residual; its test inserted a completed row
for `employee.a` to make the D1 regression pass.) And the window was **self-grantable**: employees
held `ALL` on their own onboarding row, so they could delete it, insert a new one, or clear
`completed_at`.

Fix: open only when a row **exists** with `completed_at IS NULL`; employees get SELECT/UPDATE on their
own row, no INSERT/DELETE; a trigger forbids a non-HR caller from changing `completed_at` once set.
Lead probe `scratch/c1-onboarding-gate-probe.mjs`:

```
NO ROW   -> employee.a writes own account_number : DENIED
employee.a inserts own onboarding row (reopen)   : DENIED permission denied
employee.a clears own completed_at               : DENIED only HR can reopen
employee.a deletes own completed row             : DENIED permission denied
OPEN ROW -> employee.a writes own account_number : ALLOWED (onboarding window)
RESTORED: true
```

Consequence, accepted: the wizard's defensive "create row if missing" insert now fails for an
employee with no row — correct, since the layout never shows them the wizard.

## 4. Other findings

- **`p3_policy_center.mjs` could never run on its own**: P3-01's fixture was made by hand and deleted
  (p3-01-report "Housekeeping"). Now seeds its own `hr_policies` row + object and removes both; passes.
  (An interim alarm that the `hr-policies` bucket was empty was the lead's own failed query — the real
  object is intact. Re-measured before recording.)
- **Two legacy `manager_id` policies survive** — `managers_can_view_own_draft_reports` exposes every
  report's full row (bank/PAN/Aadhaar) to their manager; `managers_can_delete_own_draft_reports` can
  delete exited reports' rows. Both removed in **C3** (brief updated), because `MyTeam.tsx` lists the
  team through the first one.
- `anon` still holds INSERT/UPDATE/DELETE grants on `employees` (project default-ACL artifact, fenced by
  RLS) — P1-00 criterion 5 territory.

## 5. Verification

Lead full run after `192200`: **all 15 suites green** — `c1_employee_self_edit`, all four `p1_*`, all three `p2_*`, `p3_chat_connect`, `p3_policy_center` (now self-seeding), `p3_private_buckets`, `p3_projects_tasks`, `p3_scope_advertising` exit 0; `p3_realtime_isolation` only the accepted item-6 FAIL. Build clean; drift 44 of 328 (baseline 44); personas 5/5 intact.
