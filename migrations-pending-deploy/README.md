# Migrations blocked on a frontend deploy

Migrations in this folder are **written and reviewed but must not be applied yet** — each one removes
something the *currently deployed* frontend still depends on. Applying one early breaks production.

They live here rather than in `migrations/` for a mechanical reason: the InsForge CLI applies
migrations strictly in order and refuses to skip a pending one, so a deploy-gated file sitting in
`migrations/` blocks every later migration from being applied.

## How to release one

1. Deploy the frontend change named in the migration's header.
2. Verify the **live bundle** no longer uses the old call — not just the source:
   ```bash
   curl -s https://rq3qmu8y.insforge.site/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'
   curl -s https://rq3qmu8y.insforge.site/assets/index-<hash>.js | grep -oE '<rpc_name>.{0,120}'
   ```
   Checking `src/` is not sufficient — the deployed bundle is what production actually runs.
3. Move the file into `migrations/`, renumbering it above the current head if needed.
4. `npx @insforge/cli db migrations up <version>`.

## Currently pending

### `20260817190000_drop-submit-task-request-identity-overload.sql`

Drops `submit_task_request(p_task_id, p_employee_id, p_notes, p_attachment_url, p_attachment_name)`,
which trusts a client-supplied employee id and never calls `auth.uid()` — any caller can submit a task
as any employee. The surviving 4-arg form derives the submitter from `auth.uid()`.

**Blocked on:** two call sites, both already fixed in the working tree but not deployed —
- `src/employee/MyTasks.tsx:170`
- `src/employee/pms/EmployeeProjectView.tsx:151`

**Release check:** the live bundle must contain no `p_employee_id` next to `submit_task_request`.
As of 2026-08-17 it still did, in both call sites.
