# Package review — P3-04 private personal-data buckets

Reviewer: Opus 5 (lead), 2026-09-21. **Verdict: ACCEPTED** at `1a10646` (Sonnet 5).
Migration `20260912190000`; no forward fix needed. Bucket flags set by API PATCH (not
reconstructible from SQL — reconciliation.md debt, third instance after P3-01 and P3-03).

## 1. Independently verified on TB-M1M2

| Check | Result |
|---|---|
| The lead's survey attack: anonymous `curl` of the existing payslip | **before** HTTP 200, 231 KB `%PDF-` → **after** HTTP 401 |
| `employee-documents`, `expense-receipts`, `task-attachments` | `Public: No` (re-checked after the suite, which flips them transiently) |
| **Real existing legacy document, real owner** (Vishal, tenant `111035ce`, temp password, hash restored `true`) | owner download ALLOWED 10,820 bytes; another tenant's existing payslip DENIED; sees only his own `employee_documents` rows; Company B DENIED his file |
| All 15 existing `employee-documents` keys | every one resolves to a real employee → every legacy object has a defined owner |
| Suites | see §3 |

Design review: tenant and owner are derived from the **object key**, never from a caller-written
row, so the P3-03 forged-reference class is closed structurally. Writes require
`<own tenant>/<own employee>/`. `task-attachments` reviewer read goes through `p3_task_scope`
and requires the referencing submission's `employee_id` to equal the key owner. The PERMISSIVE
`employee_documents.tenant_isolation` grant is gone.

## 2. Residuals (accepted, recorded)

- **Owner can delete/overwrite objects in their own folder**, including HR-issued documents
  (payslips). The `employee_documents` row delete is HR-only, so the result is an orphaned row
  pointing at a missing file. Integrity, not confidentiality. Fix: owner write only on insert.
- `employee_documents` HR **writes** are authorized by `employee.sensitive.read` — a read-named
  action. Only `hr_admin` holds it; naming wart for the one-resolver rewrite.
- 5 legacy unprefixed `task-attachments` objects now fail closed (by decision D3; dummy data).
- Expense receipt HR read uses `is_hr()`, mirroring the `expenses` table (one-resolver later).
- The acceptance test makes the three buckets **public for a few seconds** to capture before
  evidence, restoring in `finally`. A crash mid-run would leave them public on TB. Re-check flags
  after any aborted run.

## 3. Hygiene

Lead run: `p3_private_buckets` exit 0 (RLS 1/2/0 → 1/3/0 mid-fixture → 1/2/0), `p3_projects_tasks` exit 0, `p3_chat_connect` exit 0; build clean; policy drift **44 of 325** — below the 49 baseline, because the 5 previously untracked policies P3-04 replaced are now migration-defined.
