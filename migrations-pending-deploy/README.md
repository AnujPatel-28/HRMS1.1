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

> **Release-check URL note.** Step 2 above cites `rq3qmu8y.insforge.site`. That host was a mistaken
> deploy and was decommissioned on 2026-08-19. **Production is `hrms.talentmeshsolutions.com`**, built
> from GitHub `main` on the user's own Vercel — check that host.

## Released

### ~~`20260817190000_drop-submit-task-request-identity-overload.sql`~~ — APPLIED 2026-08-19

Released as `migrations/20260819190000_drop-submit-task-request-identity-overload.sql`. Renumbered
because the applied head had moved to `20260818140000` while it waited, so the original number would
have sorted behind applied work. Live bundle was verified to pass no `p_employee_id`, and the applied
result was verified as `P0001 Unauthenticated` rather than `PGRST202`/`PGRST203`.

## Currently pending

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

## 20260902120000_create-employee-transaction-drop-vestigial-params.sql

**Why it is parked here:** the InsForge CLI refuses it — `db migrations up` returns
*"Query could not be parsed and was rejected for security reasons."* Ruled out by bisection:
it is not the `DROP` (removing it still fails), not the dollar-quoting (4 tags, balanced,
named), not CRLF (converted to LF, still fails), and there is no dynamic SQL in the body.
Other migrations in this repo create SECURITY DEFINER functions and drop overloads happily,
so the trigger is specific to this file and was not worth more launch time to isolate.

**What it does:** drops `p_department` and `p_designation` from
`create_employee_transaction`. Both columns were dropped in the org rebuild (06 §5 step 6)
and the function body references neither — they are dead parameters kept only in the
signature. The body in this file is byte-identical to the deployed one.

**Why it matters:** PostgREST resolves an RPC by its exact NAMED ARGUMENT SET. The frontend
had stopped sending those two names, so the call matched no overload and failed with
*"Could not find the function … in the schema cache"* — which reads as a missing function
rather than a signature mismatch. That was the last blocker on employee creation.

**Interim fix, already shipped:** `EmployeeCreate.tsx` now sends `p_department: null` and
`p_designation: null`. Safe because the body ignores both.

**To apply:** paste this file into the InsForge dashboard SQL Editor (Database → SQL Editor).
Then delete the two `p_department` / `p_designation` lines from `EmployeeCreate.tsx` — they
are commented with a pointer to this file — and redeploy. Order matters: apply the SQL
FIRST, deploy the frontend SECOND, or creation breaks in the gap.
