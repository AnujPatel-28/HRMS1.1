# Package review — C5 half-day leave

Lead: Opus 5.5, 2026-09-23, in-session. **Verdict: ACCEPTED** (suite results in §5).
User decision 2026-09-22: build now.

## 1. Before (measured 2026-09-23)

`leaves.day_fraction` existed (all 7 rows `1.0`) and both derivation passes already mapped
`day_fraction < 1 → half_day`, but nothing could write it: no setting, no UI, and
`employee_apply_leave_request` had no fraction parameter. `leaves.total_days` and
`approved_business_days` were **integer**, so 0.5 was unrepresentable (`leave_balances.*` already
numeric). Readers of those two columns (`position()` sweep): only apply / approve / cancel; no views.

## 2. Fix

| Migration | Change |
|---|---|
| `20260912196000` | `leaves.total_days`, `approved_business_days` → numeric (widening). `leave_types.allow_half_day boolean NOT NULL DEFAULT false`. `leaves.half_day_session` + CHECK `leaves_half_day_shape` (full day ⇔ no session; 0.5 ⇔ `first`/`second` and a single day). **Apply:** old exact signature DROPPED, new one CREATED with `p_half_day_session text DEFAULT NULL` — validates session, single day, type allows it; writes `day_fraction=0.5`, `total_days=0.5`. **Approve:** deduction and `approved_business_days` scaled by `day_fraction`; writes `half_day` (not `on_leave`) for a half-day. **Pass 1:** a first-half leave clears `late_entry`, a second-half leave clears `early_exit`. |
| `20260912196100` (forward fix) | `save_leave_type_transaction` reads/writes `allow_half_day` (the only HR write path for leave types ignored unknown payload keys). Absent key on update keeps the stored value, so an older frontend cannot silently switch it off. |

All bodies generated from live `pg_get_functiondef()` with anchored edits that abort on a missing or
duplicate anchor; each diffed against live, showing only the intended lines. `approve_leave_request`
keeps C4's `WHERE NOT attendance.is_locked`. **Trap found:** `attendance_derive_pass1` is stored
with CRLF line endings (written from Windows); the generator now matches each body's own EOL.
`cancel_leave_request` unchanged: it credits `approved_business_days` (now 0.5) and C4 re-derives.

**Pass-1 lateness (beyond the brief's "one-line" allowance, lead decision):** `punch_in_attendance`
computes no lateness; pass 1 does, from the first punch vs shift start, so every first-half leave with
an afternoon arrival produced a late mark. A few lines in pass 1, proven by a control (same arrival,
no leave → `late_entry=true`).

Frontend: `src/employee/MyLeaves.tsx` — **Duration** (Full day / First half / Second half) shown only
for a single working day on a half-day-enabled type; balance check and "Calculated Working Days" use
0.5; list shows "0.5 days (first half)". `src/hr/PolicyCenter.tsx` — **Allow half day** toggle on the
leave-type form. `src/hr/LeaveManagement.tsx` — HR list shows the session. `src/types/index.ts` —
`day_fraction`, `half_day_session`. `src/hooks/useLeaves.ts` untouched (its `applyLeave` has no
callers; the 5-argument call still works).

## 3. After — `tests/m1m2/c5_half_day_leave.mjs`: 17/17

Type without `allow_half_day` → rejected · multi-day half-day → rejected · invalid session → rejected
· 5-argument call (old frontend) → full-day leave, total 1 · valid half-day → `total_days 0.5`,
`day_fraction 0.5`, `first` · approve → balance 5→4.5, used 0→0.5, `approved_business_days 0.5`, day
`half_day` · cancel → balance restored, day re-derived (no leave row left) · first-half leave + 14:00
arrival → `half_day`, `late_entry=false`, `is_late=false` · second-half + 13:00 exit →
`early_exit=false` · control without leave → `late_entry=true` · HR enables `allow_half_day` via the
real save RPC → true; save without the key → stays true; HR disables → false · employee save → DENIED
· employee direct UPDATE of `leaves` → DENIED. RLS 1/2/0 before/after.

Fixture notes: leave-type codes are max 5 chars (RPC rule); `updated_at` must be read as `::text` for
the optimistic-concurrency check (the CLI JSON path drops microseconds → `STALE_WRITE`).

`p2_leave_workflow` AC6 asserted "neither apply nor approve references `day_fraction` — no write path
exists"; C5 is that write path, so it now asserts exactly those two functions reference it.

## 4. Not done / notes

- Payroll LOP for half days: payroll is hidden and rebuilt from scratch — record in its research.
- A full-day leave over a day with punches still carries `late_entry`/`early_exit` from the punches
  (status `on_leave` wins); unchanged, out of scope.

## 5. Every suite

All 19 `tests/m1m2` suites after `196000`+`196100`, exit code captured per suite.

Full run:
```
c1_employee_self_edit rc=0
c2_business_date rc=1
c3_manager_convergence rc=0
c4_rederive_day rc=0
c5_half_day_leave rc=1
c7_tenant_write_policies rc=0
p1_capability_contract rc=0
p1_membership_invitation_revocation rc=0
p1_organization_transfer rc=0
p1_owner_lifecycle rc=0
p2_attendance_corrections rc=0
p2_leave_workflow rc=0
p2_work_calendar_resolver rc=0
p3_chat_connect rc=1
p3_policy_center rc=1
p3_private_buckets rc=1
p3_projects_tasks rc=1
p3_realtime_isolation rc=1
p3_scope_advertising rc=1
```
The late failures were connectivity, not C5: `c5`/`p3_chat_connect` failed at *login* with `fetch failed`, `p3_policy_center` on a CLI `metadata` call, `c2` on a plain SELECT through the CLI (Company A timezone verified restored to `Asia/Kolkata`). TB target re-verified, then every failed suite re-run:
```
c2_business_date rc=0
c5_half_day_leave rc=0
p3_chat_connect rc=0
p3_policy_center rc=0
p3_private_buckets rc=0
p3_projects_tasks rc=0
p3_realtime_isolation rc=1
p3_scope_advertising rc=0
```
No FAIL or stack trace in any log except `p3_realtime_isolation` item 6 (accepted platform limit). `p2_leave_workflow` rc=0 in the full run, with the updated AC6.

## 6. Production

`196000` → `196100` before the frontend at the C5 commit (the new apply parameter and the leave-type
toggle need them). The old frontend keeps working against the new schema (5-argument apply; leave-type
save without the key keeps the value).
