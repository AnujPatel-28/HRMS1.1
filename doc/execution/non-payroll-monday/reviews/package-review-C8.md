# Package review — C8 absent-marking watermark

Lead: Opus 5.5, 2026-09-23, in-session. **Verdict: ACCEPTED.**
User decision 2026-09-23: absent the next morning for app/kiosk punches; for biometric devices only
after the device has actually synced (never past its last successful push).

## 1. Before — `tests/m1m2/c8_absent_marking.mjs` pre-migration: 4/8

A no-punch past working day produced **no row** in every situation. Pass 2 marks `absent` only up to
`tenant_business_date(shifts.last_sync_of_events) - 1`, and nothing ever wrote that column (pass 2 is
its only reference; all 10 TB shifts NULL). The 4 passing checks were "expect no row" cases that
passed for the wrong reason.

## 2. Fix — `20260912199000_m1m2-absence-watermark.sql`

- `attendance_absence_watermark(tenant)` (definer, internal): `now()` when the tenant has no active
  biometric device; else the **oldest** `last_seen_at` among its active biometric devices; `NULL`
  (mark nothing) if any active biometric device has never pushed. Kiosks are excluded (live, like the
  app).
- `attendance_derive_pass2`: exact live body; only the watermark block changes. A set
  `shifts.last_sync_of_events` still caps it (`LEAST`). Covers every caller (scheduled run, HR run,
  C4 re-derive) with one change.

## 3. After — 8/8

App-only tenant: no-punch day 3 days ago → `absent`; today → not yet · stale kiosk → ignored, `absent` ·
biometric never synced → no row · biometric last push before the day → no row · biometric synced now
→ `absent` · inactive never-synced biometric → ignored, `absent` · employee call to the watermark
function → `42501`.

## 4. Notes / production

- `last_seen_at` advances only on an accepted punch, so a healthy-but-quiet device delays absence for
  its tenant until the next punch (never early). An authenticated heartbeat (device plan D3) makes it
  exact.
- **Before enabling the production derivation schedule:** every active employee with a shift and no
  punches will now be marked `absent`. Confirm per tenant that attendance is really in use (punching)
  — a tenant with the attendance module on but not punching would get mass absences.
- The derivation schedule itself is still inactive on TB (release gate, doc 10 §11).
- Production: `199000` in step (c) of `doc/session_context_2026-09-21-p3-complete.md` §2.

## 5. Every suite

```
c1_employee_self_edit rc=0
c2_business_date rc=0
c3_manager_convergence rc=0
c4_rederive_day rc=0
c5_half_day_leave rc=1
c6_p3_residuals rc=0
c7_tenant_write_policies rc=0
c8_absent_marking rc=0
c9_storage_write_fences rc=0
p1_capability_contract rc=0
p1_membership_invitation_revocation rc=0
p1_organization_transfer rc=0
p1_owner_lifecycle rc=0
p2_attendance_corrections rc=0
p2_leave_workflow rc=0
p2_work_calendar_resolver rc=0
p3_chat_connect rc=0
p3_policy_center rc=0
p3_private_buckets rc=0
p3_projects_tasks rc=0
p3_realtime_isolation rc=1
p3_scope_advertising rc=0
```
`c5_half_day_leave` rc=1 was a CLI `HarnessBlockedError` on a plain balance SELECT (flaky CLI path,
before any derivation step); re-ran **17/17, rc=0**. `p3_realtime_isolation` rc=1 = item 6 only. No
other FAIL or stack trace in any log.
