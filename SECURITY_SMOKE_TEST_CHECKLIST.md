# Sprint 1 — Smoke Test Checklist

**Date:** 2026-06-15
**Migration:** `20260615120000_security_rls_hardening.sql`
**Rollback:** `20260615120000_security_rls_hardening_rollback.sql`
**Test users needed:** Employee A (non-HR), HR user

---

## Deployment Sequence

1. Take DB snapshot
2. Apply migration
3. Run **Employee Selfie Test first** (highest-risk path)
4. Run remaining employee tests
5. Run HR tests
6. Run security tests
7. If any failure → apply rollback

---

## Employee Tests

### 1. Attendance Selfie — ⚠️ Test First

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1a | Punch in with selfie | Login as employee → Punch In → Capture selfie → Upload | ✅ Selfie INSERT succeeds |
| 1b | Upload selfie for another attendance | Craft API request with another employee's `attendance_id` | ❌ INSERT denied (attendance ownership check) |
| 1c | View own selfie | `supabase.from('attendance_selfies').select('*')` | ✅ Returns own selfies |
| 1d | View another's selfie | `supabase.from('attendance_selfies').select('*').neq('employee_id', own)` | ❌ Empty result |
| 1e | Delete another's selfie | `supabase.from('attendance_selfies').delete().neq('employee_id', own)` | ❌ Denied |

### 2. Payslips

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 2a | View own payslip | `supabase.from('payslips').select('*').eq('employee_id', own)` | ✅ Returns own payslip |
| 2b | View another's payslip | `supabase.from('payslips').select('*').neq('employee_id', own)` | ❌ Empty result |
| 2c | Insert payslip | `supabase.from('payslips').insert({...})` | ❌ Denied |
| 2d | Update payslip | `supabase.from('payslips').update({...}).eq('id', any)` | ❌ Denied |
| 2e | Delete payslip | `supabase.from('payslips').delete().eq('id', any)` | ❌ Denied |

### 3. Salary Structures

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 3a | View own structure | `supabase.from('salary_structures').select('*').eq('employee_id', own)` | ✅ Returns own record |
| 3b | View another's structure | `supabase.from('salary_structures').select('*').neq('employee_id', own)` | ❌ Empty result |
| 3c | Insert structure | `supabase.from('salary_structures').insert({...})` | ❌ Denied |
| 3d | Update structure | `supabase.from('salary_structures').update({...}).eq('id', any)` | ❌ Denied |
| 3e | Delete structure | `supabase.from('salary_structures').delete().eq('id', any)` | ❌ Denied |

### 4. Overtime Records

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4a | View own overtime | `supabase.from('overtime_records').select('*').eq('employee_id', own)` | ✅ Returns own records |
| 4b | View another's overtime | `supabase.from('overtime_records').select('*').neq('employee_id', own)` | ❌ Empty result |
| 4c | Insert overtime for self | `supabase.from('overtime_records').insert({employee_id: own, ...})` | ❌ Denied |
| 4d | Insert overtime for another | `supabase.from('overtime_records').insert({employee_id: other, ...})` | ❌ Denied |
| 4e | Update another's overtime | `supabase.from('overtime_records').update({...}).neq('employee_id', own)` | ❌ Denied |
| 4f | Delete another's overtime | `supabase.from('overtime_records').delete().neq('employee_id', own)` | ❌ Denied |

### 5. Attendance Breaks (RPC-only)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 5a | Start own break via RPC | `supabase.rpc('start_employee_break', {...})` | ✅ Break starts successfully |
| 5b | End own break via RPC | `supabase.rpc('end_employee_break', {...})` | ✅ Break ends with duration |
| 5c | Direct INSERT break for self | `supabase.from('attendance_breaks').insert({...})` | ❌ Denied |
| 5d | Direct INSERT break for another | `supabase.from('attendance_breaks').insert({employee_id: other, ...})` | ❌ Denied |
| 5e | Direct UPDATE another's break | `supabase.from('attendance_breaks').update({...}).neq('employee_id', own)` | ❌ Denied |
| 5f | Direct DELETE another's break | `supabase.from('attendance_breaks').delete().neq('employee_id', own)` | ❌ Denied |

---

## HR Tests

### 6. Payroll Operations

| # | Test | Expected |
|---|------|----------|
| 6a | Generate payroll (RunPayroll.tsx) | ✅ Success — payslip upsert via `payslips_hr_insert/update` |
| 6b | View all payslips | ✅ Returns all payslips in tenant |
| 6c | Mark payslip as emailed | ✅ Update succeeds |
| 6d | View all salary structures | ✅ Returns all structures in tenant |
| 6e | Create salary structure (SalaryForm.tsx) | ✅ Insert succeeds |
| 6f | Update salary structure | ✅ Update succeeds |

### 7. Overtime Operations

| # | Test | Expected |
|---|------|----------|
| 7a | Approve overtime (hr_set_overtime_status RPC) | ✅ Status changes to approved |
| 7b | Update overtime amount (RunPayroll.tsx) | ✅ Update succeeds |
| 7c | View all overtime records | ✅ Returns all records in tenant |

### 8. Attendance Break Operations

| # | Test | Expected |
|---|------|----------|
| 8a | View all breaks (Attendance.tsx) | ✅ Returns all breaks in tenant |
| 8b | Modify a break record | ✅ Update succeeds (HR bypass) |

### 9. Attendance Selfie Operations

| # | Test | Expected |
|---|------|----------|
| 9a | View all selfies (Attendance.tsx) | ✅ Returns all selfies in tenant |
| 9b | Delete a selfie | ✅ Delete succeeds (HR bypass) |

---

## Security Tests (from Browser DevTools)

While logged in as a normal employee, execute in browser console:

### 10. Cross-Employee Access

```javascript
// Salary structures
await supabase.from('salary_structures').update({ ctc_annual: 99999999 }).neq('employee_id', ownId);
// Expected: { error: { code: '42501', message: 'new row violates row-level security' } }

// Payslips
await supabase.from('payslips').insert({ employee_id: otherId, net_payable: 999999, ... });
// Expected: error

// Overtime records
await supabase.from('overtime_records').update({ overtime_hours: 999 }).neq('employee_id', ownId);
// Expected: error

// Attendance breaks (direct)
await supabase.from('attendance_breaks').insert({ employee_id: otherId, break_type: 'lunch', ... });
// Expected: error
```

### 11. Verification Query

Run after all tests:

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename IN ('overtime_records','salary_structures','payslips',
                    'attendance_breaks','attendance_selfies')
ORDER BY tablename, policyname;
```

Expected policy count after migration:

| Table | Policy Count |
|-------|-------------|
| overtime_records | **6** (self_read + 4 HR + restrictive) |
| salary_structures | **6** (self_read + 4 HR + existing restrictive) |
| payslips | **6** (existing employee_own + 4 HR + existing restrictive) |
| attendance_breaks | **4** (existing breaks_hr_all + existing breaks_self_read + restrictive) |
| attendance_selfies | **5** (existing selfies_hr_all + existing selfies_self_read + self_insert + existing restrictive) |

---

## Rollback Criteria

Apply `20260615120000_security_rls_hardening_rollback.sql` if:

- Employee selfie upload fails (1a)
- HR payroll generation fails (6a)
- HR salary structure creation fails (6e)
- Any unexpected 403 error on existing screens
