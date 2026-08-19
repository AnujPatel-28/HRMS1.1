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

### `20260819120000_repoint-department-rls-to-org-units.sql`

Phase 1 Slice B step 3 (`doc/architecture/06` §5) plus §9.2. Repoints the five RLS policies that
exact-string-match `employees.department` onto `employees.org_unit_id`:
`hr_policies.policies_visible_to_all`, `projects.projects_employee_read`, and three on
`chat_messages`. Adds `hr_policies.include_descendants` and the uuid target columns the channel and
project sides need.

**Blocked on:** more than a deploy. `hr_policies.org_unit_id` is already written by
`PolicyUpload.tsx`, but `chat_channels.target_org_unit_ids` and
`projects.visibility_config.org_unit_ids` have **no write path in `src/` yet** — those frontend
changes are unauthored.

**Also gated on a human review pass.** `include_descendants` defaults to true, which widens who can
read existing department-scoped policy documents. Read
`20260819120000_repoint-department-rls-to-org-units.NOTES.md` and run its review query before
applying.
