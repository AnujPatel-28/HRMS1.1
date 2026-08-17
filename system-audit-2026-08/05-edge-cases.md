# 05 — Edge cases: handled vs missed

Grounded in the actual RPC bodies and component code, not a generic checklist.

## ✅ Handled well

**Leave**
- Concurrent double-approval → prevented by `SELECT ... FOR UPDATE` on leave + balance rows and `status='pending'` re-check in `approve_leave_request`.
- Negative balance → blocked (`balance < requested` raises).
- Overlapping leave requests → checked in `employee_apply_leave_request` (overlap guard verified present).
- Leave spanning weekends/holidays → working-days computed from shift `working_days` + `holidays` table; zero-working-day ranges rejected.
- Notice period & probation → per-tenant (`tenant_settings.leave_min_notice_days`) and per-type (`min_notice_days`, `applicable_from_day`) enforced.
- Max consecutive days → enforced.
- Locked payroll periods → `assert_date_range_unlocked` prevents approving into a locked window.

**Attendance**
- Double punch-out → prevented (`session_status='open'` guard).
- Stale/never-closed sessions → `close_stale_attendance` + `fn_auto_close_active_break` cron.
- Corrections require HR approval (`hr_approve/reject_attendance_correction`); recent migrations hardened `attendance_corrections` RLS.

**Auth / lifecycle**
- Pre-active employees (`draft`/`pending_hr_review`/`pending_onboarding`) blocked at login **and** re-checked mid-session (`AuthContext`).
- Suspended/cancelled tenant → login blocked client-side (`isTenantLoginBlocked`) and server-side (`tenant_is_active()` in RLS).
- Expired JWT during RPC → one silent refresh-and-retry (`client.ts`).
- Cross-tenant password claim → `set_employee_password_by_hr` refuses if target already belongs to a different tenant.

**Payroll**
- Attendance anomaly (tracked days > working days) → normalized with a warning + `hasAttendanceAnomaly` flag.
- Zero working days / div-by-zero → guarded (`Math.max(..., 1)`, explicit throw).
- PF/ESI ceilings, null policy fields → defaulted (15000/21000).

## ⚠️ Missed / weak (ranked)

1. **Server-side geo-fence & work-hours are advisory only.** Punch coordinates, `location_status`, and `work_hours` come from the client and are stored as-is. A direct API caller bypasses the map entirely. Geo-fence and hours should be validated/recomputed server-side (ties to S5). *Impact: attendance/overtime fraud.*

2. **Reporting-line cycles only prevented client-side** (`utils/managerCycleValidation.ts`). No DB constraint/trigger stops an API-level write from creating A→B→A. *Impact: infinite loops in org-chart rendering, broken manager queries.* Add a trigger that rejects cycles.

3. **Payroll figures never verified server-side.** `calcPayslip` runs in the browser; stored `payslips` rows are trusted. No RPC recomputes or signs them. *Impact: no tamper-evidence on legally-significant payroll data.* (Not an employee-escalation since writes are HR-only, but weak for audit/compliance.)

4. **`tenant_settings` tamperable (via S3)** feeds the leave engine's notice rules. Until RLS is enabled, a user can alter another tenant's leave policy inputs.

5. **Timezone/DST for attendance.** `punch_out` uses `now()` (server time); client computes hours. Cross-timezone tenants or DST transitions can produce off-by-an-hour work_hours. Confirm a single canonical timezone strategy (store UTC, derive tenant-local for display).

6. **Overtime double-count risk in payroll.** `esiBase = proratedGross + overtimeAmount` — verify `overtimeAmount` isn't also captured inside attendance-derived gross for some configurations. Worth a unit test.

7. **Leave approval writes attendance rows** for each working date. If an attendance row already exists for that date (e.g., employee punched in, then leave approved retroactively), confirm the insert handles the conflict (unique on `tenant_id, employee_id, date`?) rather than erroring or duplicating.

8. **No rate-limiting on auth/login.** A `rate_limits` table and `check_rate_limit` RPC exist but aren't wired into the login path — credential-stuffing is unthrottled.

9. **Half-day / partial-day leave** appears supported in payroll (`halfDays`) but confirm the apply/approve RPCs actually persist half-day granularity (the working-day loop counts whole days).

10. **Bulk/CSV imports** (papaparse) — validate that imported rows are tenant-stamped server-side and can't inject cross-tenant `tenant_id` values (rely on RLS CHECK, not the CSV).
