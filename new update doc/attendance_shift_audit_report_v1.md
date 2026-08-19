# Attendance and Shift Management Audit Report v1.0

**Status**: Immutable audit report  
**Branch**: `updateSuggestion`  
**Backend preview**: `https://rq3qmu8y-jx7.ap-southeast.insforge.app`  
**Source rule**: Use only `new update doc` for this audit context. Do not use the old `doc` folder as authority.

---

## Purpose

This audit captures the observed current state, risks, evidence, and recommendations for Attendance and Shift Management before implementation of the hardened architecture.

Once published, this audit should not be rewritten except for factual correction. Implementation progress belongs in:

- `attendance_shift_release_roadmap.md`
- `attendance_shift_architecture_spec_v1.md`
- future ADR files

---

## Current System Summary

| Area | Observed Current State | Audit Verdict |
|---|---|---|
| Employee punch-in | Direct frontend insert into `attendance` from `PunchInOut.tsx` | Needs hardening |
| Employee punch-out | Uses `punch_out_attendance` RPC | Good foundation |
| Break tracking | Uses `start_employee_break` and `end_employee_break` RPCs | Good foundation |
| Attendance corrections | Employee flow upserts `attendance_corrections` directly | Needs hardening |
| Shift save/deactivate/schedule | Uses HR RPCs | Strong foundation |
| Shift history | Future-effective assignments and soft deactivation pattern | Good |
| HR attendance edit | Uses `hr_update_attendance` RPC | Good foundation |
| Payroll lock | Checked in HR UI and DB RPCs | Good, verify comprehensively |
| Timezone handling | Mixed browser-local and tenant-timezone behavior | Needs standardization |
| Snapshotting | No clear immutable attendance shift/policy snapshot in punch flow | Needs hardening |
| Reporting scale | HR summary invokes per-employee late-mark logic | Needs scale pass |

---

## Evidence Reviewed

Primary files reviewed:

| File | Purpose |
|---|---|
| `src/employee/PunchInOut.tsx` | Employee punch, break, correction, selfie, geofence flow |
| `src/hooks/useEmployeeShift.ts` | Employee active/default shift resolution |
| `src/hr/ShiftManagement.tsx` | HR shift CRUD and assignment UI |
| `src/hr/Attendance.tsx` | HR attendance dashboard, edits, corrections, summaries |
| `src/utils/date.ts` | Business date helpers |
| `migrations/20260706200000_policy-center-rule-settings-rpcs.sql` | Transactional Policy Center attendance/task settings |
| `insforge-task-policy-hardening.sql` | Punch-out/task gate hardening |
| `update-hr-update-attendance-rpc.sql` | HR attendance edit RPC |

---

## Findings

### F1: Punch-in is not transactional or idempotent

**Severity**: P0  
**Evidence**: `PunchInOut.tsx` inserts directly into `attendance`.

**Risk**:

| Scenario | Failure Mode |
|---|---|
| Double tap | Duplicate or conflicting open session |
| Network timeout after success | Retry ambiguity |
| Selfie upload failure | Attendance created but verification incomplete |
| Direct API use | Possible bypass if RLS is not strict |

**Recommendation**: Replace direct punch-in insert with idempotent `punch_in_attendance_transaction`.

---

### F2: Business date authority is inconsistent

**Severity**: P0  
**Evidence**: Employee punch and shift hooks use browser-local date helpers; punch-out RPC uses tenant timezone.

**Risk**:

| Scenario | Failure Mode |
|---|---|
| Employee travels | Attendance may land on wrong tenant business date |
| Midnight punch | Browser and tenant dates can differ |
| Night shift | Shift date and attendance date can drift |

**Recommendation**: Database should compute authoritative attendance business date using tenant timezone.

---

### F3: Attendance history is not fully reproducible

**Severity**: P0  
**Evidence**: Punch-out receives expected shift hours from client and no clear immutable shift/policy snapshot was observed.

**Risk**:

| Change After Attendance | Historical Risk |
|---|---|
| HR edits shift | Old attendance may be interpreted differently |
| Policy changes | Overtime/break/late marks may recalculate incorrectly |
| Office geofence changes | Location decision may not be reproducible |

**Recommendation**: Snapshot only business-critical shift, policy, geofence, work-mode, remote exception, and evidence facts.

---

### F4: Attendance sub-table RLS requires live verification

**Severity**: P0  
**Evidence**: Existing repo security notes mention previous attendance RLS concerns; current flows still touch sensitive attendance sub-tables.

**Risk tables**:

| Table | Risk to Verify |
|---|---|
| `attendance` | Cross-employee read/write |
| `attendance_breaks` | Cross-employee write/tamper |
| `attendance_selfies` | Cross-employee metadata tamper |
| `attendance_corrections` | Cross-employee request tamper |
| `overtime_records` | Payroll-related tamper |

**Recommendation**: Release A1 must start with live RLS/direct API tests.

---

### F5: Geofence is evidence-based, not proof-based

**Severity**: P1  
**Evidence**: Client collects GPS and sends status/evidence.

**Risk**: Backend cannot prove physical GPS truth, especially from browser clients.

**Recommendation**: Backend should validate evidence structure, enforce policy, reject impossible values, store immutable evidence, and audit the server decision. Do not claim absolute GPS verification.

---

### F6: Correction flow should be transactional

**Severity**: P1  
**Evidence**: Employee correction request uses direct upsert.

**Risk**:

| Scenario | Failure Mode |
|---|---|
| Payroll locked date | Client-only guard can be bypassed |
| Duplicate pending correction | Inconsistent queue |
| Another employee id | Requires strict RLS to block |

**Recommendation**: Add `submit_attendance_correction_transaction`.

---

### F7: HR summary may not scale

**Severity**: P1  
**Evidence**: Summary view invokes per-employee late-mark calculation.

**Risk**:

| Scale | Failure Mode |
|---|---|
| 1k employees | Slow summary |
| 10k employees | Function invocation bottleneck |
| 50k employees | Requires aggregate/materialized reporting design |

**Recommendation**: Add aggregate monthly attendance summary RPC/materialized view.

---

### F8: Shift management is strong but still needs live constraint verification

**Severity**: P2  
**Evidence**: HR shift actions use RPCs, future-effective assignment, and soft deactivation patterns.

**Risk**: Direct DB/API writes could still create overlap if live constraints are missing.

**Recommendation**: Verify live unique/exclusion constraints and keep shift assignment RPC-only.

---

## Audit Recommendation

Proceed with implementation, starting with:

**Release A1: Attendance Foundation Audit and Live RLS Verification**

Do not start punch-in/punch-out rewrites until A1 confirms the current live backend policy state.

