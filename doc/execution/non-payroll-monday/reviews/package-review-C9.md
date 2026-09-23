# Package review — C9 storage write fences

Lead: Opus 5.5, 2026-09-23, in-session. **Verdict: ACCEPTED** (suite results in §4).
Found during C6 acceptance (`scratch/c6-bucket-probe.mjs`).

## 1. Before (live, TB-M1M2) — `tests/m1m2/c9_storage_write_fences.mjs` pre-migration: 8/18

A plain employee created objects at the tenant root of **9 buckets** — `application-snapshots`,
`attendance-selfies`, `avatars`, `company-assets`, `company-logos`, `insurance-documents`,
`payslips`, `recruiter_documents`, `resumes` — and **uploaded a selfie into a colleague's folder**
(forged punch evidence at a predictable key). Cause: the global PERMISSIVE
`storage_objects_owner_insert` (WITH CHECK `uploaded_by = me`) ORs with every bucket's policies, so
only a RESTRICTIVE fence can narrow writes. Legitimate writers all worked. Probe objects removed.

## 2. Fix — `20260912198000_m1m2-storage-write-fences.sql`

`c9_storage_write_allowed(bucket, key)` + RESTRICTIVE INSERT / UPDATE / DELETE fences on
`storage.objects`:

| Bucket | Allowed writer (from the real call sites) |
|---|---|
| `attendance-selfies` | the employee in `<tenant>/<own employee id>/…` (PunchInOut), or HR |
| `company-assets` | HR of the tenant (Settings, PolicyCenter logo) |
| `insurance-documents` | HR of the tenant (HR Insurance) |
| `payslips` | HR of the tenant (payroll hidden; rebuilt later) |
| `avatars`, `company-logos`, `resumes`, `recruiter_documents`, `application-snapshots` | no client — no code references them and TB holds 0 objects in each; admin key only |
| every other bucket | unchanged (their own fences already apply) |

Reads unchanged. No frontend change. Edge functions write with the admin key (unaffected); none
writes these buckets from a user token (grep of `functions/`).

## 3. After — 18/18

All 9 tenant-root uploads → 403 · own-folder selfie → allowed, own removal → allowed · selfie into a
colleague's folder → denied · HR company logo / insurance document / payslip → upload + remove
allowed. Storage residue 0; RLS 1/2/0 before/after. **All-bucket probe re-run: 0 of 15 buckets
accept an employee upload at the tenant root** (was 9). Policy drift 39 (unchanged).

## 4. Every suite

All 21 `tests/m1m2` suites after `198000`, exit code captured per suite:

```
c1_employee_self_edit rc=0
c2_business_date rc=0
c3_manager_convergence rc=0
c4_rederive_day rc=1
c5_half_day_leave rc=0
c6_p3_residuals rc=0
c7_tenant_write_policies rc=0
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

`c4_rederive_day` rc=1 was `fetch failed` in its closing RLS check (TB idle-socket flake, not a C4/C9 defect); the suite now warms its clients before that check (same pattern as C6/C9) and re-ran **17/17, rc=0**. `p3_realtime_isolation` rc=1 = item 6 only (accepted platform limit). No other FAIL or stack trace in any log.

## 5. Notes

- The global `storage_objects_owner_insert` itself stays: replacing it with per-bucket insert policies
  is cleaner but touches every bucket's working upload path; the fences give the same guarantee.
  A new bucket will be writable by any user until it gets a fence — add one with the bucket.
- Production: `198000` in step (c) of `doc/session_context_2026-09-21-p3-complete.md` §2.
