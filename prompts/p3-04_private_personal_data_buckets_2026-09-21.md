# P3-04 — Private personal-data buckets

Repo `C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`, branch
`p1-00-harness-reconciliation`, base **HEAD at dispatch** (after `a959f36`).

Read first:
- `doc/execution/non-payroll-monday/reviews/package-review-P3-03-tier1.md` and `-tier2.md` —
  **the chat-attachments implementation is your template** (`migrations/20260912189000`,
  `189100`, `189300`; `src/shared/Chat.tsx` `downloadAttachment`). Copy its shape.
- `doc/session_context_2026-09-15-senior-dev-m1m2.md` §6 — traps.
- `doc/execution/non-payroll-monday/reviews/package-review-P3-02.md` §3 — test existing rows.

---

## 1. What is broken — measured by the lead on TB-M1M2, 2026-09-21

**B1 — Anyone on the internet can download personal files.** `employee-documents`,
`expense-receipts`, `task-attachments` are **public** buckets. An anonymous `curl` with no auth
header downloaded a payslip PDF from `employee-documents` (HTTP 302 → 200, 231 KB, `%PDF-`).

**B2 — Inside a company, every employee can read every colleague's documents.** The four storage
policies on `employee-documents` check only `can_access_tenant(split_part(key,'/',1))` — same
company, any owner. Making the bucket private does **not** close this.

**B3 — `employee_documents` (the table) is fenced by a PERMISSIVE same-company policy.**
`tenant_isolation` is `PERMISSIVE ALL USING can_access_tenant(tenant_id)` — a grant, not a fence.
Any employee can read/insert/update/delete any colleague's document rows.

**B4 — Two buckets have keys with no owner.** `expense-receipts` and `task-attachments` upload with
`uploadAuto` (random key, no tenant/owner), store the **public URL** in `expenses.receipt_url` /
`task_submissions.attachment_url`, and open it with a plain `<a href>`. Privacy breaks every link
unless the screens change.

Existing data (count before and after — package-review-P3-02 §3):
| Bucket | Objects | Key shape | Referencing rows |
|---|---|---|---|
| `employee-documents` | 15 | 13 legacy `employees/<employee_id>/…`, 2 `<tenant>/<employee>/…` | `employee_documents`: 6 rows (`file_key`, `file_url`) |
| `task-attachments` | 5 | legacy, **no prefix** | `task_submissions.attachment_url`: 3 rows |
| `expense-receipts` | 0 | — | `expenses.receipt_url`: 0 rows |

---

## 2. Decisions (lead) — do not redesign

**D1 — Key shape `<tenant_id>/<owner_employee_id>/<uuid>.<ext>` for every new upload** in all three
buckets. Replace `uploadAuto` with `upload(key, file)`. Store a **key reference**, not a public URL,
in `receipt_url` / `attachment_url` — use the chat convention `"<bucket>:<key>"`.

**D2 — Authorization keys on the owner encoded in the key, never on a caller-written reference.**
Tier 1 of P3-03 found (189100) that trusting a message row's URL let a user forge access to another
tenant's file. So: the **write** check requires `split_part(key,'/',1) = get_auth_tenant_id()` and
`split_part(key,'/',2) = get_my_employee_id()` (or, for HR uploading onto an employee's record, the
HR rule below). The **read** check derives tenant + owner from the key, then applies the business
rule for that owner:

| Bucket | Read allowed when (same tenant always) |
|---|---|
| `employee-documents` | owner = caller, **or** caller holds HR document authority |
| `expense-receipts` | owner = caller, **or** caller satisfies the `expenses` table's HR read rule (`is_hr()` today — mirror the table; the one-resolver rewrite comes later) |
| `task-attachments` | owner = caller, **or** a `task_submissions` row whose `employee_id` = key owner references this key **and** `p3_task_scope(t.tenant_id, t.assigned_to, t.project_id, 'read')` passes (reviewers: HR/company, manager/direct reports, project manager) |

"HR document authority": use `has_access_action('employee.sensitive.read','company')` if the
`hr_admin` template holds it — **check the catalogue first**; if it does not, use the same legacy
seam the rest of `employee-documents` code relies on (`is_hr()`) and say which in the report. HR
must keep full access to employee documents on employee records.

Helpers: INVOKER where they delegate to table RLS, DEFINER where they must read across RLS — each
DEFINER with tenant fence, pinned `search_path`, no `anon` EXECUTE. Beware the P3-03 lesson
(`reviews/package-review-P3-03-tier2.md` §1): if a helper keys on "can the caller see row X", check
who else can see row X.

**D3 — Legacy keys.**
- `employee-documents` `employees/<employee_id>/…` (13): the owner is in the key; support it (tenant
  from `employees`). Do not move objects.
- `task-attachments` unprefixed (5): **fail closed.** All data is dummy; the product is not launched.
  Record the count in the report. Do not build a legacy mapping.

**D4 — Buckets private via the API**, exactly as P3-03 did:
`PATCH /api/storage/buckets/<name> {"isPublic":false}`. SQL cannot set it. Record it — a
migration-only rebuild comes back public (reconciliation.md debt; P3-01 and P3-03 found the same).

**D5 — Replace the four `employee-documents` storage policies** (B2) and fix **`employee_documents`
table** RLS (B3): RESTRICTIVE tenant fence; read = own rows or HR authority; insert = own rows
(onboarding) or HR; update/delete = HR (and owner delete only if a current screen does it — check).
Drop the PERMISSIVE `tenant_isolation`.

**D6 — Screens open files through the logged-in SDK**, like `Chat.tsx`'s `downloadAttachment`: a
button that downloads via `storage.from(bucket).download(key)`, not an `<a href>` to a stored URL.
Old rows holding a full public URL: parse the key out of it (as `Chat.tsx` does) so
`employee-documents` legacy rows keep working.

---

## 3. Constraints

- `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`) only. **Never write to
  `0431f0f6-225f-4fb1-86b7-3fd32684c7f4`** — no bucket, policy or schema change there.
  `npm run test:m1m2:target` before any write. CLI `node node_modules/@insforge/cli/dist/index.js`.
- Migration `migrations/20260912190000_m1m2-private-personal-data-buckets.sql` (hyphens).
  `20260912190100_…` pre-authorized for **one** forward fix, named with evidence. Beyond: stop.
- **Storage objects cannot be deleted by SQL** (`DELETE FROM storage.objects` fails through the CLI
  and aborts the whole batch). Test teardown must remove objects through the SDK as their uploader,
  then delete rows. The lead's `scratch/p303-private-attachment-probe.mjs` shows the pattern.
- Allowed files: `src/employee/Expenses.tsx`, `src/hr/Expenses.tsx`, `src/employee/MyTasks.tsx`,
  `src/employee/pms/EmployeeProjectView.tsx`, `src/hr/TaskManagement.tsx`,
  `src/hr/pms/ProjectDetail.tsx`, `src/hr/EmployeeDetail.tsx`, `src/hr/EmployeeCreate.tsx`,
  `src/employee/OnboardingWizard.tsx`, `src/types/index.ts`, the migration(s), and a new
  `tests/m1m2/p3_private_buckets.mjs`. Anything else → stop and report.
- Do not touch `chat-attachments`, `hr-policies`, `payslips` or any P3-03 function.
- Every DEFINER: tenant fence, pinned `search_path`, no `anon` EXECUTE; one `pg_proc` row per name
  (assert it in a DO block). Tenant fences RESTRICTIVE.
- Disposable fixtures in the test file, `finally` teardown, RLS 1/2/0 before and after.
- Re-run `tests/m1m2/p3_projects_tasks.mjs` (task submission path changes) — must still exit 0.

## 4. Acceptance — evidence, raw lines

For **each** of the three buckets:
1. Anonymous GET of an existing object URL (the old public URL) → denied. **Before and after.**
2. Wrong-tenant logged-in user (`employee.b`) → denied.
3. **Same-tenant colleague** (`hr-employee.a` acting as a non-HR peer is not possible — use
   `employee.a` against a fixture owned by another Company A employee, or a temporary second
   employee created in the fixture) → denied. This is B2 — the within-company case.
4. Owner → allowed. The authorized reviewer/HR per D2 → allowed.
5. Forged reference: a user writes a row referencing another owner's key → still denied.
6. Upload with a key whose tenant/owner is not the caller → denied.

Plus: `employee_documents` table — colleague cannot read/insert/delete another's row, HR can;
existing `employee-documents` legacy objects still open for their owner and HR (use existing rows);
previously issued URL behavior recorded; the 5 legacy task attachments reported as fail-closed;
bucket flags `Public: No` for all three; hygiene (grants, `pg_proc`, drift number vs 49 baseline,
build); `p3_projects_tasks.mjs` exit 0.

## 5. Report

Commit hash, files, per item PASS / FAIL / UNTESTED with the raw line. Reasoned-not-executed =
UNTESTED. State anything you could not enforce.
