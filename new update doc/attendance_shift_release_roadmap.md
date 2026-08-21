# Attendance and Shift Management Release Roadmap

**Status**: Living implementation roadmap  
**Architecture baseline**: `attendance_shift_architecture_spec_v1.md`  
**Audit baseline**: `attendance_shift_audit_report_v1.md`  
**Branch**: `updateSuggestion`  
**Backend**: `https://rq3qmu8y.ap-southeast.insforge.app` (parent `rq3qmu8y` — the former `-jx7` branch preview is dead and retired)

> **⚠️ SUPERSEDED FROM A2 ONWARD — see [`attendance_shift_v2_decision_doc.md`](attendance_shift_v2_decision_doc.md).**
> A1 below is retained as complete and remains the RLS verification of record.
> A2–A8 hardened the single-session-row model, which decision **D2** (two-layer immutable event log
> + derived day) replaces. Their intent is carried forward as releases **B1–B9** in v2 §8.
> Do not start an A2–A8 item. Use the v2 release plan.

---

## Release Status Summary

| Release | Name | Status | Purpose |
|---|---|---|---|
| A1 | Foundation Audit and Live RLS Verification | Complete | Verify live backend security and schema state |
| A2 | Idempotent Transactional Punch-In RPC | Superseded → v2 §8 | Replace direct punch-in insert |
| A3 | Tenant-Timezone Date Standardization | Superseded → v2 §8 | Make DB authoritative for attendance date |
| A4 | Snapshot-Based Punch-Out and Overtime | Superseded → v2 §8 | Use immutable shift/policy/evidence snapshots |
| A5 | Attendance Corrections Transaction | Superseded → v2 §8 | Replace direct correction upsert |
| A6 | Attendance RLS and Direct Write Restriction | Superseded → v2 §8 | Make RPCs the only sensitive write path |
| A7 | HR Attendance Scale and Reporting | Superseded → v2 §8 | Replace per-employee summary calculations |
| A8 | Office Location and People Suite Alignment | Superseded → v2 §8 | Align geofence with normalized locations |

---

## A1: Foundation Audit and Live RLS Verification

### Goal

Verify the live `updateSuggestion` backend before changing attendance logic.

### Scope

1. Create `scratch/attendance_shift_a1_verify.mjs`.
2. Verify live schema, grants, and RLS policies for:
   - `attendance`
   - `attendance_breaks`
   - `attendance_selfies`
   - `attendance_corrections`
   - `overtime_records`
   - `shifts`
   - `employee_shifts`
3. Test standard employee direct API access:
   - cannot read another employee attendance
   - cannot insert attendance for another employee
   - cannot update/delete another employee break
   - cannot update/delete another employee selfie metadata
   - cannot create correction for another employee
4. Test HR tenant-scoped access.
5. Document results in this roadmap.

### Exit Criteria

| Check | Required Result | Status |
|---|---|---|
| Employee self read | Allowed | ✅ Pass |
| Employee cross-employee read/write | Denied or empty | ✅ Pass |
| HR tenant access | Allowed | ✅ Pass |
| Cross-tenant access | Denied | ✅ Pass |
| Build | Passes | ✅ Pass |
| Verification script | Passes and output documented | ✅ Pass |

### Status & Outputs

- **Status**: Complete
- **Migration File**: [20260712180000_attendance_corrections_rls_hardening.sql](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/migrations/20260712180000_attendance_corrections_rls_hardening.sql)
- **Verification Script**: [attendance_shift_a1_verify.mjs](file:///c:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions/scratch/attendance_shift_a1_verify.mjs)

#### Verification Output Summary

```text
InsForge Backend URL: https://rq3qmu8y-jx7.ap-southeast.insforge.app
====================================================
    A1: FOUNDATION AUDIT AND LIVE RLS VERIFICATION  
====================================================

Authenticating as standard employee: employee-qa@talentmeshsolutions.com...
✅ Employee authenticated.
Authenticating as HR: hr-qa@talentmeshsolutions.com...
✅ HR authenticated.

Cleaning up previous test attendance data...
✅ Cleanup completed.

--- Setting up manager attendance reference data (via HR client) ---
Manager Attendance ID created: 282b0957-2537-44b9-8946-c94b730f2a81
Manager Break ID created: 99777902-1060-44c8-8c1b-ffd6acbbf65e
Manager Selfie ID created: 6c297b44-9861-4fd4-9617-c6725415e41b
Manager Correction ID created: 4aad716a-fd2f-4639-b686-885669d55b19

--- Running Employee Self Read/Write Tests ---
✅ PASS: Employee self insert own attendance (Attendance ID: 22cea823-8c82-4b0a-bebc-1f03d5aadb89)
✅ PASS: Employee self read own attendance (Returned date: 2026-07-11)
✅ PASS: Employee self update own attendance 
✅ PASS: Employee create own selfie metadata (Selfie ID: 46eeb4df-e901-4eec-86c1-d05ceb63f89d)
✅ PASS: Employee create own correction (Correction ID: 40595b3b-f3db-4ca5-beff-df5bd71c0b6e)

--- Running Cross-Employee Direct API Access Restrictions ---
✅ PASS: Employee cannot read another employee attendance (empty array) 
✅ PASS: Employee cannot insert attendance for another employee (Blocked by RLS)
✅ PASS: Employee cannot update another employee break (0 rows updated)
✅ PASS: Employee cannot delete another employee break (0 rows deleted)
✅ PASS: Employee cannot update another employee selfie metadata (0 rows updated)
✅ PASS: Employee cannot delete another employee selfie metadata (0 rows deleted)
✅ PASS: Employee cannot create correction for another employee (Blocked by RLS)
✅ PASS: Employee cannot update another employee correction (0 rows updated)
✅ PASS: Employee cannot delete another employee correction (0 rows deleted)
✅ PASS: Employee cannot update own correction employee_id to manager (new row violates row-level security policy for table "attendance_corrections")
✅ PASS: Employee cannot update own correction tenant_id to foreign tenant (new row violates row-level security policy "tenant_isolation" for table "attendance_corrections")

--- Running HR Tenant-Scoped Access Tests ---
✅ PASS: HR can read employee attendance (Returned ID: 22cea823-8c82-4b0a-bebc-1f03d5aadb89)
✅ PASS: HR can create break for employee (Break ID: 23a2fa6b-8022-4b12-bc5a-9ea8e6208cdb)
✅ PASS: HR can delete break for employee 

--- Running Cross-Tenant Access Restrictions ---
✅ PASS: Employee cannot insert attendance with foreign tenant_id (new row violates row-level security policy "tenant_active_restrictive" for table "attendance")
✅ PASS: HR cannot insert attendance with foreign tenant_id (new row violates row-level security policy "tenant_active_restrictive" for table "attendance")
✅ PASS: Employee cannot read foreign tenant shifts (returned empty) 

====================================================
                  VERIFICATION SUMMARY              
====================================================
Total tests run: 22
Passed: 22
Failed: 0
====================================================

🎉 Verification passed successfully! Live RLS matches expectations.
```

---

## A2: Idempotent Transactional Punch-In RPC

### Goal

Replace direct frontend `attendance` insert with `punch_in_attendance_transaction`.

### Scope

1. Add migration for idempotent punch-in RPC.
2. Add required columns if needed:
   - idempotency key
   - correlation id
   - shift snapshot/version
   - policy snapshot/version
   - evidence snapshot/version
3. Update `src/employee/PunchInOut.tsx` to call RPC.
4. Add `attach_attendance_selfie_transaction`.
5. Keep storage upload outside SQL transaction.
6. Add verification script.

### Exit Criteria

| Check | Required Result |
|---|---|
| Normal punch-in | One open session |
| Double tap | One session only |
| Same idempotency retry | Same attendance id returned |
| Selfie upload failure | Recoverable verification state |
| Inactive employee | Rejected |
| Payroll locked date | Rejected |

---

## A3: Tenant-Timezone Date Standardization

### Goal

Make the database authoritative for attendance business dates.

### Scope

1. Add or use helper `get_tenant_business_date`.
2. Update punch-in and punch-out RPCs to derive date from tenant timezone.
3. Use DB-returned attendance date in UI.
4. Test DST timezone, UTC tenant, IST tenant, browser timezone mismatch, and cross-midnight shifts.

### Exit Criteria

| Check | Required Result |
|---|---|
| Browser timezone mismatch | Tenant date remains correct |
| Night shift | One session closes correctly |
| DST timezone | No duplicate/missing date bug |

---

## A4: Snapshot-Based Punch-Out and Overtime

### Goal

Use stored snapshots for punch-out, work-hour, break, and overtime calculation.

### Scope

1. Update `punch_out_attendance`.
2. Lock attendance row with `FOR UPDATE`.
3. Use snapshot expected hours and break policy.
4. Auto-close active break if present.
5. Store punch-out evidence snapshot.
6. Insert audit log and optional outbox event.

### Exit Criteria

| Check | Required Result |
|---|---|
| Shift changed after punch-in | Punch-out uses original shift snapshot |
| Policy changed after punch-in | Punch-out uses original policy snapshot |
| Active break at punch-out | Auto-closed and audited |
| Overtime | Server-calculated from snapshot |

---

## A5: Attendance Corrections Transaction

### Goal

Replace direct `attendance_corrections` upsert with RPC.

### Scope

1. Add `submit_attendance_correction_transaction`.
2. Enforce employee ownership.
3. Enforce regularization window.
4. Enforce payroll lock.
5. Prevent duplicate pending correction drift.
6. Update employee UI.

### Exit Criteria

| Check | Required Result |
|---|---|
| Own correction | Allowed |
| Other employee correction | Denied |
| Outside window | Rejected |
| Payroll locked date | Rejected |
| Duplicate pending | Idempotent or clear conflict |

---

## A6: Attendance RLS and Direct Write Restriction

### Goal

Make RPCs the only write path for sensitive attendance operations.

### Prerequisite

A2 and A5 must be complete and verified.

### Scope

1. Revoke direct employee writes where RPCs exist.
2. Keep self-read policies.
3. Keep HR tenant-scoped policies.
4. Review every `SECURITY DEFINER` function:
   - tenant assertion
   - role assertion
   - `SET search_path TO public`
   - no caller-controlled SQL identifiers
   - safe audit logging

### Exit Criteria

| Check | Required Result |
|---|---|
| Employee direct insert/update | Denied |
| UI punch/correction | Works through RPC |
| HR attendance | Works |
| Cross-tenant access | Denied |

---

## A7: HR Attendance Scale and Reporting

### Goal

Make HR attendance summary reliable for 1k+ employees.

### Scope

1. Add aggregate RPC or materialized summary:
   - present days
   - absent days
   - leave days
   - half days
   - late count
   - overtime hours
   - pending corrections
2. Replace per-employee late-mark function calls.
3. Add indexes if missing.
4. Performance test at 1k+ seeded employees.

### Exit Criteria

| Dataset | Target |
|---|---|
| 1k employees, 1 month | Under 2 seconds on preview |
| 5k employees, 1 month | Under 5 seconds with indexes |
| 10k employees | Uses aggregate/materialized strategy |

---

## A8: Office Location and People Suite Alignment

### Goal

Align Attendance geofence locations with normalized People Suite locations.

### Scope

1. Decide whether office geofence rows should reference `locations.id`.
2. Resolve allowed geofence by employee `location_id`, work mode, and remote exceptions.
3. Update Office Locations and Policy Center wording.
4. Test office, remote, hybrid, and no-location employees.

### Exit Criteria

| Case | Required Result |
|---|---|
| Office employee | Uses assigned office/location policy |
| Remote employee | Uses remote policy/exception |
| Hybrid employee | Allows office or approved exception |
| Missing location | Follows documented tenant fallback |

---

## Roadmap Update Rules

After each release:

1. Mark status as `Complete`, `Blocked`, or `Deferred`.
2. Link migration file.
3. Link verification script.
4. Paste verification output summary.
5. Update remaining risks.
6. Do not edit immutable audit findings unless correcting facts.
7. Use ADRs for architecture changes.

