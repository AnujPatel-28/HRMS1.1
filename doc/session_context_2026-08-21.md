# Session context — 2026-08-20 → 2026-08-21

Handoff. The organisation module's migration path (`06-organisation-management.md` §5) is **complete
through step 9**, plus step 10's prerequisite work. Eleven migrations applied to production. Four
live production defects were found and fixed that were on nobody's list, including a **module-wide
chat outage**.

**Backend:** parent `rq3qmu8y` (`0431f0f6-225f-4fb1-86b7-3fd32684c7f4`). Applied head **`20260821100000`**.
**Frontend:** `hrms.talentmeshsolutions.com`, Vercel, from GitHub `main`. Repo head still **`eca1650`**.

---

## 0. START HERE — read this before touching anything

### ⚠️ The database is AHEAD of the deployed frontend. This is not safe to leave.

**54 files are uncommitted in the working tree, and nothing has been pushed.** The live bundle is
still `/assets/index-DJEWvrPu.js` — the same one from before this work began.

That bundle **reads `employees.department` and `employees.designation`, which no longer exist.**
Production screens that render an employee's department or job title will show blanks or misbehave
until a new build ships.

```bash
git status --short | wc -l      # expect 54
npm run build                    # expect green: tsc -b && vite build, 0 errors
```

**First decision of the next session: review the diff and ship it, or roll the DB back.** Do not
leave it in this state. Merging to `main` auto-deploys.

### Two credentials you now hold

| Account | Password | Note |
|---|---|---|
| `admin@talentmeshsolutions.com` | `Z4VPxgq5q2AfSPFB8c^_` | Superadmin. **Change it from the UI.** Verified working (real login + `get_my_platform_role() -> "owner"`) |
| `quickwin089@gmail.com` | `RlsVerify!2026q` | Employee-role, tenant `97da3641`. Rotated to run RLS verification. Reset or ignore |
| `employee-qa@` / `hr-qa@talentmeshsolutions.com` | `Password@123` | Tenant `da7a0000`. The 2026-08-14 DB-side repair is intact |

---

## 1. State

```
Applied head    20260821100000        (11 migrations this session)
Repo head       eca1650               54 files uncommitted, nothing pushed
Build           green
RLS drift       34 of 253 policies in no migration   (unchanged — not org-module work)

Tenants 12   Employees 16   org_units 10
nested 0 · unit heads 0 · grades 0 · reporting 5/16 · employee_roles 0
```

**All existing data is dummy** — the user confirmed this. It removed two things previously recorded
as blockers: the "adoption" work (no point populating throwaway tenants) and §9.6's open data call
("who becomes owner for the 12 tenants?"). Neither is a real constraint. Do not re-raise them.

---

## 2. What shipped

### 2a. Four live production defects, none of which were on the plan

| Defect | Why it mattered |
|---|---|
| **Chat was entirely broken in production** | `chat_messages`, `chat_channels`, `chat_channel_members` all returned `permission denied for table users` for **every** user. Three policies inline-read `auth.users`, which only `project_admin` may read. Fixed with `jwt_role_is_hr()`, a definer helper reproducing the predicate exactly (`20260820120000`) |
| **The task fan-out assigned to nobody and reported success** | `DEPT_OPTIONS` held lowercase slugs, `employees.department` held capitalised unit names — strict equality matched zero rows, and the toast was computed from the match count |
| **Projects and Chat let HR create records nobody could read** | RLS reads only the uuid column; the org-unit picker was optional and unvalidated |
| **Three server functions matched `department = 'operations'`** | No tenant has such a unit. Nobody notified of leave requests or hr_only policies; hr_only policies visible to nobody. In the leave function the INSERT was wrapped in `EXCEPTION WHEN OTHERS THEN NULL`, so it could not even fail loudly (`20260820170000`) |

### 2b. The eleven migrations

```
20260820110000  repoint-department-rls-to-org-units          5 policies off drifting text
20260820120000  route-chat-auth-users-checks-through-definer  the chat outage
20260820130000  repoint-channels-employee-select-to-org-units the 6th policy
20260820140000  org-unit-type-structural-role-guardrail       defect (c)
20260820150000  sync-legacy-department-text-from-unit-assign   scaffolding, later retired
20260820160000  tasks-org-unit-target-column                  tasks had no uuid twin
20260820170000  replace-hardcoded-operations-department       06 §2.3, server-side
20260820180000  assignments-are-the-only-way-to-move-a-unit   Option A
20260820190000  drop-employees-department                     §5 step 6, first half
20260820200000  fix-residual-employees-department-refs        two dependents ...190000 MISSED
20260821100000  drop-employees-designation                    §5 step 6, second half
```

### 2c. Option A — assignments are the only way to move a unit

`employee_unit_assignments` is now the single source of truth, enforced in the database.

**The guard compares against the OPEN ASSIGNMENT, not against `OLD`.** The obvious predicate —
"refuse if `org_unit_id` changed while an open assignment exists" — is **wrong and would deadlock the
system against itself**, because `sync_employee_current_unit()` exists precisely to write a *changed*
pointer after a legitimate transfer. The right question is *"does the new pointer AGREE with the
assignment record?"* Sync agrees and passes; a bypass disagrees and is refused; a hire with no history
has nothing to contradict. Opening assignments are a trigger, not an edit to
`create_employee_transaction`, so every writer is covered.

Tested both directions on live data: a direct `UPDATE` is refused with a message naming both units;
the full transfer flow succeeds and the pointer moves. Test employee was restored afterwards.

### 2d. §5 step 6 complete — and it is TWO columns, not three

06 §5 step 6 names three columns. The third, `employees.employment_type`, was **retracted by §4b**: it
is a CHECK-constrained enum (`full_time`) paired with `employment_types.name` as a display label
(`Full Time`) — a code/label convention, not drift. Backfilling it violates the constraint. It stays.

Frontend resolution lives in `src/utils/departmentLabel.ts`, `src/utils/jobTitleLabel.ts` and
`src/contexts/OrgUnitsContext.tsx` (one provider, both lookups, mounted inside `TenantProvider` in
`App.tsx`). It fetches **all** units and titles, not just active ones — someone holding a deactivated
unit or title must still render with its name rather than "—", which is why it does not reuse
`useOrgStructure()`.

**A UX change that needed a decision.** The Designation inputs were free text with a `<datalist>`: an
exact match set `job_title_id`, and anything else silently produced an employee with a designation
string and **no job title** — the same "two sources, one unmanaged" defect the module exists to
remove. They are now `<select>` over `job_titles`, with an explicit hint when a tenant has none.

**Two RPCs resolve rather than drop the write.** `create_draft_employee` and
`hr_activate_draft_employee` take `p_designation` and have no `p_job_title_id`; dropping the write
would have silently discarded the caller's input. Each resolves the text to a `job_titles` row
(case-insensitive, tenant-scoped) and stores the id. **All `p_department` / `p_designation` parameters
are KEPT** — PostgREST resolves RPCs by named argument, so removing one breaks every deployed client
the instant it applies. Retiring them is a separate, deploy-gated cleanup.

---

## 3. Traps learned — these cost real time

**A superadmin session CANNOT verify tenant-scoped RLS.** It has no `tenant_id`, so
`get_auth_tenant_id()` is NULL and the RESTRICTIVE fence returns **0 rows for every table** — identical
output whether a policy works or is completely broken. An HR session is nearly as useless: `is_hr()`
short-circuits most policies before reaching the branch under test. **Verify as an employee-role user
in a tenant that actually holds the data.** Tenant `da7a0000` has no chat or policy rows; `97da3641`
does.

**A dropped column does NOT break a PL/pgSQL function at apply time.** Bodies compile lazily, per
session, on first execution. After dropping `department`, `enforce_employee_update_restrictions` — a
trigger on `employees` — still referenced `OLD.department` and an employee UPDATE still **succeeded**.
It was a live bomb, not a broken build. "The migration applied" is never proof the dependents are clean.

**Search by COLUMN NAME across every alias, never by the aliases you expect.** An audit for
`e.department` / `employees.department` / `target.department` / `p_department` missed two dependents —
one used `OLD.`, one was cut off by CLI truncation. This finds them all:

```sql
SELECT p.proname, substring(pg_get_functiondef(p.oid) from '[A-Za-z_]+\.department[^_a-zA-Z]')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.prokind='f'
  AND pg_get_functiondef(p.oid) ~ '[A-Za-z_]+[.]department[^_a-zA-Z]';
```

**Deleting the field from the TypeScript type is the only check that proves the frontend is clean.**
Greps do not. Removing `Employee.designation` surfaced three dependencies no search had found — two
`.select(...)` lists and a derived `PayslipEmployee` type.

**Views block the drop, and the error names only ONE at a time.** There were two, not one. Find them
all up front via `pg_depend` → `pg_rewrite` → `pg_class`. `employees_public` carries
`security_invoker = true`, and that flag is the **only** thing making its tenant-unfiltered
`SELECT ... FROM employees` safe — recreating it without that option turns it into a cross-tenant read.
`employee_directory_public` is the opposite: no `security_invoker`, so it bypasses `employees` RLS and
relies on its explicit `WHERE tenant_id = get_auth_tenant_id()`. Its grants are `project_admin` only —
restore grants exactly, never widen them as a side effect.

**For large function bodies, do not retype them.** Use a `DO` block that asserts the target snippet
appears an exact number of times, then `replace()` + `EXECUTE`. It preserves the rest byte-for-byte and
refuses to rewrite a drifted function. Get the snippet's exact whitespace from the LIVE body first
(`'[' || l || ']'` over `string_to_array(pg_get_functiondef, chr(10))`) — a guessed indent fails the
assertion, as it did twice here.

**Subagent spend limits terminate agents MID-EDIT.** Three parallel sonnet sweeps were killed partway,
leaving a stray import and a broken build. Check `npm run build` immediately after any agent failure
before assuming its files are untouched. Tiering that worked: haiku for inventory (its finding that
only 6 queries needed changing reshaped the whole plan), sonnet for mechanical sweeps, opus kept for
migrations and authorisation.

---

## 4. What is LEFT

Audited against **all** of `06-organisation-management.md`, not just the §5 list. Three items remain.

### 4a. §9.6 tenant Owner — the only one that is genuinely just work

The last item in §5. **Size it before starting:**

```
employees.role    8 frontend reads · 1 RLS policy · 11 functions
```

Same shape and roughly the same size as the `department` drop, but it is the **authorisation core**.
Critically it is **close to all-or-nothing**: doing steps 1, 2, 4 and 5 without step 3 (dropping
`employees.role`) leaves three live sources of role — `auth.users.metadata`, `employees.role`,
`employee_roles` — that can now **drift**, whereas today `employee_roles` is merely inert. Half
-finishing is worse than not starting.

Fold in one correction: `can_view_employee` now has TWO overlapping unit branches —
`scope_type='org_unit' AND target.org_unit_id = r.scope_id` (the correct, pre-existing model) and
`scope_type='department' AND target.org_unit_id::text = r.scope_value` (repointed in `20260820190000`).
The second is redundant and off-model. Retire the `department` scope type and drop it from the
`employee_roles` CHECK constraint as part of this work.

### 4b. §3.4 and §3.6 — deliberately NOT built

- **§3.4** `office_locations.location_id -> locations`: column absent. `locations` still has **0 rows**;
  `office_locations` (3 rows) carries the real geo-fencing data. Still the dead table §2.4 described.
- **§3.6** `employee_education` / `employee_experience` / `employee_dependents`: tables absent.

06 §9.5 already made this call, about a different table:

> "`employee_roles` was built exactly that way — in advance, for a future need. It has **zero rows**,
> `is_hr()` still resolves through JWT metadata, and it has been inert since 2026-08-13."

Three child tables with no UI, or an FK onto a table holding zero rows, repeats that exact mistake —
and `employee_roles` is sitting right there as the proof. **§3.6 is a feature, not a migration: schema
and UI belong in the same piece of work.** Do not build either speculatively.

### 4c. Not org-module work

- **34 of 253 RLS policies are in no migration** — all RESTRICTIVE tenant fences, across 19 tables.
  Unchanged. Still the biggest open item in the repo; see `session_context_2026-08-20.md` §4.
- **`PolicyCenter`'s per-department salary templates** (`tenant_settings` key
  `salary_template_<department>`) have **zero consumers** anywhere. 06 §3.3 says per-tenant salary
  defaults belong on `employee_grades`. Needs a product decision before any code change.
- **Six `DEPT_OPTIONS` files remain** (`PolicyUpload`, `PolicyCenter`, `Chat`, `ProjectList`,
  `ProjectDetail`, `EmployeeCreate` fallback). All cosmetic now — the two that were actively broken
  (`TaskManagement`, `Calendar`) were fixed.
- **`Chat.tsx` `visibleChannels`**: the legacy `target_departments` fallback was removed; it compared
  capitalised names against lowercase slugs and could never match.

---

## 5. Commands

```bash
# Verify RLS properly — as an EMPLOYEE-role user in a tenant that HAS data (§3, first trap)
#   tenant 97da3641 has the chat/policy rows; da7a0000 does not.
#   Sign in through @insforge/sdk; x-api-key on /api/database/records returns AUTH_INVALID_API_KEY.

# Find every server-side reference to a column, across all aliases, before dropping it
npx @insforge/cli db query "select p.proname, substring(pg_get_functiondef(p.oid) from '[A-Za-z_]+\.COLUMN[^_a-zA-Z]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and pg_get_functiondef(p.oid) ~ '[A-Za-z_]+[.]COLUMN[^_a-zA-Z]'"

# Find views blocking a column drop (the ALTER names only one at a time)
npx @insforge/cli db query "select distinct c.relname from pg_depend d join pg_rewrite r on r.oid=d.objid join pg_class c on c.oid=r.ev_class join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid where d.refobjid='public.employees'::regclass and a.attname='COLUMN' and c.relname<>'employees'"

npm run build                       # tsc -b && vite build
npm run check:policy-drift          # expect: 34 of 253 until they are baselined
npx @insforge/cli db migrations list
```

---

## 6. Documentation map

| Path | What |
|---|---|
| **`doc/session_context_2026-08-20.md`** | The previous handoff, **heavily amended in place** during this session (§2b–§2l). Its §4 (34 untracked policies) and §5 (earlier traps) are still current |
| `migrations/20260820180000_*.sql` | Option A. Header explains why the guard compares against the open assignment |
| `migrations/20260820200000_*.sql` | **Read this one.** Corrects a wrong claim in `...190000` and states the alias-agnostic audit lesson |
| `migrations/20260821100000_*.sql` | The designation drop, incl. why two RPCs resolve rather than drop the write |
| `doc/20260820110000_*.NOTES.md` | §3b records that the chat outage predated the migration, with proof |
| `doc/architecture/06-organisation-management.md` | The module design. §5 step 3's `department_filter_unit_id` is **stale** — `hr_policies.org_unit_id` already exists |
| `doc/org-module-status-2026-08-19.md` | §3c defects (a) and (b) are now fixed; (c) fixed by `20260820140000` |
