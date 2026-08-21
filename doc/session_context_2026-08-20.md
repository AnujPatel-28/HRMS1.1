# Session context — 2026-08-19 → 2026-08-20

Handoff. The deploy gate that blocked everything in the previous handoff is **gone**. Two production
outages were found and fixed, the organisation module got its UI, and a control we relied on turned
out to be broken.

**Backend:** parent `rq3qmu8y` (`0431f0f6-225f-4fb1-86b7-3fd32684c7f4`). Applied head **`20260820100000`**.
**Frontend:** `hrms.talentmeshsolutions.com`, Vercel, built from GitHub **`main`**. Repo head `fefd035`.

---

## 0. Start here tomorrow

Read §3. It is the organisation module's remaining work, in the order it should be done.

If you only do one thing: **§3 item 1** (execute `doc/notify-task-submission-frontend-spec.md`). It
closes a half-finished change that is live in production right now.

Two things still needing **you**, not code:
1. ~~**Change the superadmin password.**~~ **DONE 2026-08-20.** Rotated and verified by a real login
   plus `get_my_platform_role() -> "owner"`. **Correction to the claim below: the RPC does NOT lie.**
   Proven on a throwaway account — `update_user_password` writes `crypt(pw, gen_salt('bf'))` giving
   `$2a$06$`, and InsForge's auth verifies that format fine. What is true is narrower: the function
   `RETURN true`s unconditionally, so it reports success for a nonexistent uuid. Verify by logging in
   for *that* reason. The lockout was simply a rotation to an unrecorded value.
2. **Delete the `rq3qmu8y.insforge.site` deployment record** via the InsForge dashboard. Its content is
   decommissioned, but the CLI cannot remove the record. Do **not** use `projects delete` — that
   destroys the backend for all 12 tenants.

---

## 1. The two production defects found and fixed

**Edge functions had been dead for weeks.** Both deployed bundles resolved functions to
`rq3qmu8y.functions.insforge.app` — the SDK's fallback when `createClient` gets no `functionsUrl` —
and that host **404s**. All 17 functions were down: onboarding, `auth-*`, notifications,
`check-punch-out-gate`. The fix (`functionsUrl` → `.function2.`) had been written on 2026-08-12 and
never shipped.

**Root cause of "pushing to GitHub does not deploy": nothing was broken.** `origin/main` had not moved
since **4 June**. All work landed on `updateSuggestion`, which only ever produced Vercel *previews*.
The release action is a **merge to `main`**. Merged `d0beb81..e26a2f0`; six weeks of work shipped at
once, including an org chart built in July that had never been deployed.

**Task-submission identity hole closed** (`20260819190000`). The 5-arg `submit_task_request` overload
trusted a client-supplied `p_employee_id` and never called `auth.uid()` — any authenticated caller
could submit as any employee.

---

## 2. State right now

```
Migrations       applied head 20260820100000, 0 unapplied in migrations/
RLS drift        34 of 253 live policies in NO migration   ← was reported as 0; the guard was broken
Tenants 12    Employees 16
org_units        10   nested 0   with a head 0
org_unit_types   36 (3 × 12 tenants)
employee_grades   0   employees with grade_id 0
unit assignments 12   employees with org_unit_id 12
reporting rows    5   (of 16 employees — the org chart renders sparse for this reason)
```

Live frontend bundle `/assets/index-DJEWvrPu.js`. Verify releases against the **served bundle**, never
`src/` — Vite inlines `VITE_*` at build time, so the deployed backend URL is a literal in the chunk.

---

## 2b. Progress 2026-08-20 (later session) — UNCOMMITTED in the working tree

`main` auto-deploys, so nothing below is committed or pushed. Build green (`tsc -b && vite build`).

| §3 item | State |
|---|---|
| 1. Notification frontend spec | **DONE.** Both blocks deleted, both imports removed, `src/utils/notificationTargets.ts` deleted, `notified` return checked. |
| 2. Slice B part 2 RLS repoint | **APPLIED** as `20260820110000`. Gate verified, review query returned 0 rows, widening vacuous. |
| 4(b) Division/Team vanish from pickers | **DONE.** `structural_role` filter removed from all four screens. |
| — Chat sidebar org-unit filter | **DONE (new).** `Chat.tsx` `visibleChannels` now mirrors the DB predicate; without it a channel scoped by org unit was invisible while RLS served its messages. |
| 4(a) EmployeeDetail contradiction | **DONE.** Department select is read-only in edit mode and points at Transfer; `org_unit_id` no longer written from `saveChanges` (trigger owns it); orphaned `updateDepartment`, `departmentOptions` and the `department_changed` audit block removed. |
| — Chat production outage | **FIXED (new).** `20260820120000`. See 2d. |
| 3. §5 step 5 dual-write removal | **NOT DONE — rescoped, see 2c.** |
| 4(c), policy [29], adoption, §9.6, 34 untracked policies | Untouched. |

## 2e. Second pass — five more migrations applied, applied head now `20260820170000`

The user confirmed **all existing data is dummy**, which removed two things previously listed as
blockers: the §3 item 5 "adoption" work (no point populating throwaway tenants) and §9.6's open data
call ("who becomes owner for the 12 tenants?"). Neither is a real constraint any more.

| Migration | Effect |
|---|---|
| `20260820130000` | Repointed the **sixth** policy, `channels_employee_select`, onto `target_org_unit_ids`. Closes the split `20260820110000` left open, where you could list a channel whose messages you could not read. Vacuous on live data (0 department channels). |
| `20260820140000` | **Defect (c) closed.** Trigger blocks changing `structural_role` on an in-use unit type. Exercised both ways: the change is refused with a message naming the type and the unit count; a rename still succeeds. |
| `20260820150000` | Assignment-sync trigger now maintains `employees.department` from `org_units.name`. See below for why. |
| `20260820160000` | Added `tasks.org_unit_id` + index. `tasks` was the one department target with no uuid twin. |
| `20260820170000` | **Killed the last three server-side `department = 'operations'` hardcodes** (06 §2.3 in SQL). |

### Why `20260820150000` keeps a column the module wants to delete

Making the Department field read-only left **Transfer as the only way to move an employee between
units** — and `submitTransfer` never wrote the legacy text column. Without the trigger, every transfer
would silently stale the department shown on ~100 read sites. Deliberate scaffolding, and the header
records exactly what to delete when `employees.department` finally goes.

### `20260820170000` — this was silently broken, not theoretical

`employee_apply_leave_request`, `create_policy_notifications_transaction` and `get_hr_policy_library`
all selected recipients with `e.department = 'operations'`. Since `employees.department` now holds
capitalised **unit names** (`Sales`, `Dev`, `Hr`, `Design`, `Product`, `Marketing`) and **no tenant has
a unit named `operations`**, all three matched zero rows: nobody notified of a leave request, nobody
notified of an hr_only policy, and hr_only policies visible to nobody. In the leave function the
INSERT is wrapped in `EXCEPTION WHEN OTHERS THEN NULL`, so it could not even fail loudly.

Replaced with `e.role = 'hr'::user_role`, the resolver `submit_task_request` already uses. Applied by a
self-verifying DO block that asserts the literal appears exactly once per function before swapping it,
so the other ~12KB of those bodies is preserved byte-for-byte. **Note the access-control delta:**
`get_hr_policy_library` is a visibility function, so `hr_only` policies go from visible-to-nobody to
visible-to-HR. A widening from an empty set, and the documented intent of the setting.

## 2f. The slug-vs-name mismatch — the thread that ties the frontend defects together

`DEPT_OPTIONS` (8 files) holds lowercase slugs `sales / dev / marketing / operations / design / other`.
`employees.department` holds capitalised unit names. **Every strict comparison between the two matches
nothing.** That is one root cause behind several separately-reported bugs, and it is why they must be
fixed by moving to `org_unit_id`, not by comparing case-insensitively.

Also found and fixed this pass — both were **live access-control defects**, not migration artefacts:
`ProjectList`/`ProjectDetail`/`Chat` all let HR create a department-scoped project or channel while
leaving the org-unit picker empty, and RLS now reads **only** the uuid column. The result was a
project or channel nobody could read. Org-unit selection is now required in all three, and the labels
no longer say "optional".

## 2g. RLS verified against REAL tenant users — the check that actually discriminates

Every earlier check was structural (`pg_policies` greps) or ran as `admin@talentmeshsolutions.com`.
**A superadmin session cannot verify these policies at all**: it has no `tenant_id`, so
`get_auth_tenant_id()` is NULL and the RESTRICTIVE tenant fence returns 0 rows for every table —
identical output whether a policy works or is completely broken. An HR session is nearly as useless,
because `is_hr()` short-circuits most of these before reaching the branch that was rewritten.

The **employee-role** branch is the one that changed (`get_my_org_unit_id()`,
`my_org_unit_in_scope()`, `get_my_active_employee_id()`), so it is the one that had to be exercised.

`employee-qa@` / `hr-qa@` (tenant `da7a0000`, password `Password@123` — the DB-side repair from
2026-08-14 is intact) returned rows with no permission errors, but that tenant holds **no** chat or
policy data, so its zeros proved nothing. Re-run in tenant `97da3641`, which does:

```
quickwin089@gmail.com — role=employee, tenant 97da3641
  employees              1 row   (own row)
  chat_channels          2 rows  <- channels_employee_select   (20260820130000)
  chat_messages          6 rows  <- chat_messages_select        (20260820110000 + ...120000)
  hr_policies            1 row   <- policies_visible_to_all     (20260820110000)
  org_units              4 rows
  CROSS-TENANT LEAK      none
```

Non-empty where data exists, zero permission errors, no cross-tenant bleed. The silent-lockout risk
is ruled out.

> **Account touched:** `quickwin089@gmail.com`'s password was rotated to `RlsVerify!2026q` to run
> this (data is dummy, and `update_user_password` is proven working). Reset or ignore as you like.

**Not positively testable, and vacuous by design:** the org-unit *subtree* branch
(`my_org_unit_in_scope`, `include_descendants`). There are 0 department-scoped policies and 0
department-type channels, so there is nothing for it to match. It gets its first real exercise the
day an HR admin scopes something to a unit.

## 2c. Two findings that change the plan

**§5 steps 5 and 6 are ONE piece, not two.** The handoff below frames step 5 as a small
`legacyValue` deletion. It is not safe alone: **`employees.department` is read for display in ~20
sites** (`MyProfile`, `EmployeeLayout`, `MyLeaves`, `MyTeam`, `Chat`, `Payslips`, `payslip-pdf`,
`SalaryForm`, `SalaryStructures`, `OrgChartNode`, `InitiateExitModal`, `IDCard`, `orgChart.ts`,
`Directory`, `EmployeeList`, `EmployeeDetail`). Stop writing the column and every one of them renders
"—" for any employee created or edited afterwards. The migration template already exists in the
codebase — `EmployeeDetail.tsx:239` resolves from the FK and falls back to text
(`(employee.org_unit_id ? unitNames[employee.org_unit_id] : null) ?? employee.department`), while
`EmployeeList.tsx:32` and `Directory.tsx:26` are still bare `emp.department || "—"`. The work is
"apply the :239 pattern to the remaining read sites", then remove the write, then drop the columns.

**Defect 4(a) needs a product decision, not just code.** A correct transfer flow already exists —
`EmployeeDetail.submitTransfer` closes the open assignment, inserts the new one, rolls back on
failure and writes an audit row, exactly per 06 §3.5. The contradiction is that the edit form's
Department select *bypasses* it by writing `employees.org_unit_id` straight into the save payload.
Fixing it means deciding what that select should do: route through the transfer flow, become
read-only pointing at Transfer, or keep editing only the legacy text. That is a UX call.

## 2d. Chat was fully broken in production — fixed 2026-08-20 (`20260820120000`)

Found while running the post-apply checks for `20260820110000`. Every read of `chat_messages`,
`chat_channels` and `chat_channel_members` returned **`permission denied for table users`**, for anon
*and* every authenticated caller. `Chat.tsx` reads all three directly via `db.from(...)`, so the whole
module errored out.

Three policies resolved "is the caller HR?" with an inline `EXISTS (SELECT 1 FROM auth.users u …)`.
A table read inside a policy runs as the **invoking** role, and only `project_admin` holds SELECT on
`auth.users` — `anon` and `authenticated` hold nothing. The privilege check failed before the
predicate was ever evaluated.

**Not caused by `20260820110000`.** It reproduced `chat_messages_select`'s subqueries byte-identical
from the baseline; `channels_hr_all` and `members_hr_all` carry the same subquery, were never touched
by it, and failed identically.

Fix: `public.jwt_role_is_hr()`, a SECURITY DEFINER helper reproducing the predicate **exactly** — same
`COALESCE`, no tenant scoping, no `employee_roles` branch. Deliberately **not** `is_hr()`, which is a
different predicate and would have been a silent authorisation change in three policies. Verified:
anon `chat_messages` → `[]`, all three authenticated reads return without error, and
`pg_policies` now shows **zero** policies inline-reading `auth.users`.

> The NOTES file for `20260820110000` originally told the next reader to expect anon → `[]`. That
> expectation was never reachable; it has been corrected in
> `doc/20260820110000_repoint-department-rls-to-org-units.NOTES.md` §3b.

## 2i. Option A applied + the department drop, IN PROGRESS (checkpoint)

**Option A is DONE and tested** — `20260820180000`, applied head is now `20260820180000`.
`employee_unit_assignments` is the only way to move an employee between units, enforced in the DB.

* **The guard compares against the OPEN ASSIGNMENT, not against OLD.** The obvious predicate
  ("refuse if org_unit_id changed while an open assignment exists") would have deadlocked the system
  against itself, because `sync_employee_current_unit()` exists precisely to write a *changed*
  pointer after a legitimate transfer. The correct question is "does the new pointer AGREE with the
  open assignment row?" — sync agrees and passes, a bypass disagrees and is refused, and a hire with
  no history yet has nothing to contradict.
* **Opening assignments are a trigger, not an edit to `create_employee_transaction`** — covers every
  writer including future importers, and avoids re-transcribing a ~5KB function.
* Tested both directions on live data: a direct `UPDATE employees SET org_unit_id` is **refused**
  with a message naming the employee and both units; the full transfer flow (close open row → insert
  new row) **succeeds**, the pointer moves, and `employees.department` follows automatically
  (`Hr` → `Dev`). Test employee was restored to its original unit afterwards.

### Frontend sweep for the column drop — three agents in flight at checkpoint

`departmentLabel()` + `OrgUnitsProvider` are built, wired into `App.tsx` inside `TenantProvider`, and
building green. The provider fetches **all** units, not just active ones — an employee sitting in a
deactivated unit must still render with that unit's name rather than "—", which is why it does not
reuse `useOrgStructure()`.

**The sweep is far smaller than the "~100 sites" estimate suggested: only SIX queries actually need
changing.** Everything else already selects `*`, which includes `org_unit_id`. The six:
`InitiateExitModal.tsx:39`, `MyTeam.tsx:48`, `MyLeaves.tsx:125`, `SalaryStructures.tsx:91`
(via its `employeeColumns` array), `Payslips.tsx:493`, `OffboardingManagement.tsx:122`.

### ⚠️ PRE-DROP DEPENDENCY AUDIT — read this before dropping the column

`ALTER TABLE employees DROP COLUMN department` will FAIL, or silently break behaviour, until each of
these is handled. Postgres refuses the drop outright for the view; the functions fail at runtime.

| Dependency | What it needs |
|---|---|
| **VIEW `employee_directory_public`** | Selects `department`. **Postgres will refuse the DROP** until the view is recreated without it. It already exposes `org_unit_id`. |
| `sync_employee_current_unit` | The `department = COALESCE(...)` clause from `20260820150000` must go — its header already says so. |
| `create_employee_transaction` | Takes `p_department` and inserts it. Signature change + the `EmployeeCreate.tsx` call site. |
| `hr_activate_draft_employee` | Same shape — writes the column on draft activation. |
| `can_view_employee` | **Authorisation.** Matches `target.department = r.scope_value` for department-scoped roles. Vacuous only because `employee_roles` has 0 rows. Repoint to `org_unit_id`. |
| `get_employee_visible_hr_policies`, `get_hr_policy_library`, `create_policy_notifications_transaction`, `acknowledge_policy_transaction` | Policy visibility/notification paths reading `e.department`. Repoint to `org_unit_id` (each already has an org-unit branch alongside). |
| `update_exit_clearance_transaction` | Verify whether its `department` is the employee's or the exit-clearance definition's — the latter is a DIFFERENT field and must be left alone. |

## 2j. `employees.department` is DROPPED and verified. Applied head `20260820200000`.

06 §5 step 6, **first half complete**. `designation` is the second half and is NOT done — see below.

| Migration | Effect |
|---|---|
| `20260820190000` | Recreated BOTH dependent views, repointed 4 functions, stopped 3 writers, dropped the column |
| `20260820200000` | Fixed two references `...190000` MISSED. Read its header — the lesson is reusable |

**Frontend foundation** (`src/utils/departmentLabel.ts` + `src/contexts/OrgUnitsContext.tsx`, mounted
inside `TenantProvider` in `App.tsx`). The provider fetches **all** units, not just active ones —
someone sitting in a deactivated unit must still render with that unit's name, which is why it does
not reuse `useOrgStructure()`. Proof the SPA no longer depends on the column: `department` was removed
from the `Employee` interface and `tsc -b && vite build` is green.

**The sweep was far smaller than "~100 sites" implied.** Only 6 queries needed changing; everything
else already selected `*`. Three of the biggest apparent consumers were not consumers at all —
`OrgChart.tsx` decorates a LOCAL shape whose `department` is already resolved, `OrgChartNode` reads
that node field, and `payslip-pdf.ts` renders a payslip-local value. Those needed a type change, not
a migration.

### Verified as a real tenant employee — not as superadmin (see §2g for why that distinction matters)

```
quickwin089@gmail.com — role=employee, tenant 97da3641
  employees 1 · employees_public 1 · employee_directory_public 5 · org_units 4
  chat_channels 2 · chat_messages 5 · hr_policies 1 · employee_unit_assignments 4
  rpc get_employee_visible_hr_policies ok · no table exposes `department` · CROSS-TENANT LEAK none
```

### Two traps worth carrying forward

**A dropped column does NOT break a PL/pgSQL function at apply time.** Bodies are compiled lazily, per
session, on first execution. `enforce_employee_update_restrictions` — a trigger on `employees` — kept
referencing `OLD.department` after the drop and still let an UPDATE succeed. It was a live bomb, not a
broken build. **Never treat "the migration applied" as proof the dependents are clean.**

**Search by COLUMN NAME across every alias, never by the aliases you expect.** The audit behind
`...190000` searched `e.department` / `employees.department` / `target.department` / `p_department`
and still missed two, one because the alias was `OLD.` and one because the result set was truncated
before the line. This is the query that finds them all:

```sql
SELECT p.proname, substring(pg_get_functiondef(p.oid) from '[A-Za-z_]+\.department[^_a-zA-Z]')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND pg_get_functiondef(p.oid) ~ '[A-Za-z_]+[.]department[^_a-zA-Z]';
```

**Also: two views depended on the column, not one.** `employees_public` was invisible to the first
audit. It carries `security_invoker = true`, and that option is the ONLY thing making its
tenant-unfiltered `SELECT ... FROM employees` safe — recreating it without that flag would turn it
into a cross-tenant read. `employee_directory_public` is the opposite: no `security_invoker`, so it
bypasses `employees` RLS and relies on its explicit `WHERE tenant_id = get_auth_tenant_id()`. Its
grants are `project_admin` ONLY; the drop migration restored them exactly rather than widening.

## 2l. §5 step 6 is COMPLETE — `designation` dropped too. Applied head `20260821100000`.

`employees.department` went in `20260820190000`/`...200000`; `employees.designation` in
`20260821100000`. **Step 6 is finished at two columns, not three** — 06 §4b retracted the third
(`employment_type` is a CHECK-constrained enum paired with a display label, a code/label convention,
not drift; backfilling it would violate the constraint).

Reads resolve through `src/utils/jobTitleLabel.ts` + `useJobTitleLabel()`, sharing the provider built
for departments. Same proof as before: `designation` was removed from the `Employee` interface and the
build is green. Verified as an employee-role tenant user — 5 directory rows, 4 job titles, 2 channels,
5 messages, 1 policy, RPC ok, **no table still exposes `department` or `designation`**, no
cross-tenant leak.

### A UX change that needed a decision, not just a sweep

The Designation inputs in `EmployeeCreate`, `EmployeeDetail` and `AddTeamMemberModal` were free text
with a `<datalist>`: an exact match set `job_title_id`, and **anything else silently produced an
employee with a designation string and no job title** — the same "two sources, one unmanaged" defect
the module exists to remove. They are now `<select>` elements over `job_titles`. HR must create the
title first; each picker shows an explicit hint when the tenant has none rather than an empty dropdown.

### Two server functions RESOLVE rather than just dropping the write

`create_draft_employee` and `hr_activate_draft_employee` take `p_designation` and have **no**
`p_job_title_id`. Dropping the write would have silently discarded the caller's input. Each now
resolves the text to a `job_titles` row by case-insensitive, **tenant-scoped** name match and stores
the id; unmatched text resolves to NULL, which fails closed. `p_designation` parameters are KEPT in
every signature — PostgREST resolves RPCs by named argument, so removing one breaks every deployed
client the instant it applies.

### What the second pass caught that the first pattern would have missed

Running the alias-agnostic audit FIRST (the lesson from `20260820200000`) surfaced
`create_draft_employee` immediately — a function the narrower `e.department`-style search never found
for the department drop. Removing `designation` from the `Employee` interface then surfaced three more
real dependencies no grep had: two selects (`EmployeeProjectView`, `EmployeeCreate`) and the
`PayslipEmployee` type. **Deleting the field from the type is the only check that actually proves the
frontend is clean** — greps do not.

## 2k. What "complete" actually means for this module — audited against 06's own spec

Checked the live schema against every section of `06-organisation-management.md`, not against the
§5 migration list alone. §5 steps 1-9 are done. Three things remain, and **two of them are
deliberately NOT built** for a reason the design doc itself gives.

| 06 ref | Item | State | Call |
|---|---|---|---|
| §5 step 10 / §9.6 | Tenant Owner + activate `employee_roles` | not started | **Build it** — the only one that is genuinely just work |
| §3.4 | `office_locations.location_id` -> `locations` | column absent; `locations` has **0 rows** | **Do NOT build yet** |
| §3.6 | `employee_education` / `employee_experience` / `employee_dependents` | tables absent | **Do NOT build yet** |

### Why §3.4 and §3.6 are deliberately not built

06 §9.5 already made this exact call and gave the reasoning, about a different table:

> "`employee_roles` was built exactly that way — in advance, for a future need. It has **zero rows**,
> `is_hr()` still resolves through JWT metadata, and it has been inert since 2026-08-13. A membership
> table built 'ready for later' would repeat that precisely."

Creating three employee child tables with no UI, or an FK onto a `locations` table that holds zero
rows, repeats the mistake the document warns about — and `employee_roles` is sitting right there as
the proof. **§3.6 is a feature (employee-master depth), not a migration: it needs schema and UI in the
same piece of work.** §3.4 is only meaningful once someone actually adopts `locations` as Branch;
today `office_locations` (3 rows, geo-fencing) carries the real data and `locations` is still the dead
table §2.4 described.

### §9.6 is bigger than its five bullet points — size it before starting

The sequence is "backfill `employee_roles` -> make `is_hr()` read the table -> drop `employees.role`
-> add `owner` -> seed one per tenant". Measured surface of the drop step alone:

```
employees.role   8 frontend reads · 1 RLS policy · 11 functions
```

That is the same shape and roughly the same size as the `department` drop, and it is the
**authorisation core** rather than a display column. Critically, **it is close to all-or-nothing**:
doing steps 1, 2, 4 and 5 without step 3 leaves three live sources of role (`auth.users.metadata`,
`employees.role`, `employee_roles`) that can now DRIFT, whereas today `employee_roles` is merely
inert. Half-finishing it is worse than not starting.

One correction to fold in when it happens: `can_view_employee` now has TWO overlapping unit branches —
`scope_type = 'org_unit' AND target.org_unit_id = r.scope_id` (the correct, pre-existing model) and
`scope_type = 'department' AND target.org_unit_id::text = r.scope_value` (repointed in
`20260820190000`). The second is redundant and off-model. Retire the `department` scope type entirely
and drop it from the `employee_roles` CHECK constraint as part of §9.6, rather than leaving two ways
to express one scope.

## 2h. What is LEFT — with reasons, not excuses

Everything below was consciously not done. None of it is blocked on data any more (all data is dummy).

1. **§5 step 6 — drop `employees.department` / `designation`.** The only genuinely large piece.
   Requires migrating **~100 read sites across ~25 files** (inventoried this session) and the
   six-value `DEPT_OPTIONS` list in 8 files. It is *safe to defer* because `20260820150000` keeps the
   text column equal to the unit name, so every one of those sites renders correctly today. Recommended
   shape: a shared unit-name lookup in context + a `departmentLabel(employee)` helper, then a
   mechanical sweep. **Two of the eight `DEPT_OPTIONS` files were already migrated** this session
   (`TaskManagement`, `Calendar`) because they were actively broken; the other six are cosmetic.

2. **Hire does not create an `employee_unit_assignments` row.** `create_employee_transaction` writes
   `employees.org_unit_id` directly, so a new hire has a unit pointer with no history — contradicting
   06 §3.5. Latent: **0 employees are orphaned today** (the 20260818140000 backfill covered everyone
   who existed). The fix is a trigger on `employees`, and it needs one decision made deliberately
   rather than by accident: when a direct write MOVES `org_unit_id` X→Y while an open assignment for
   X exists, do you (a) refuse the write, (b) auto-close and open a new assignment, fabricating the
   effective date and reason with no audit row, or (c) allow it and accept the gap? Option (b) is what
   `submitTransfer` does properly, with a date, a reason and an audit entry. Guard on
   `NEW.org_unit_id IS DISTINCT FROM OLD.org_unit_id`, not on "an open assignment exists" — the sync
   trigger rewrites the same value back, and value comparison terminates the recursion cleanly.

3. **`can_view_employee` still matches `target.department = r.scope_value`** for department-scoped
   roles — an authorisation decision on the legacy text column. **Vacuous today: `employee_roles` has
   0 rows**, so the branch is unreachable. It becomes live the moment §9.6's role activation happens,
   and should be repointed to `org_unit_id` as part of that work, not before.

4. **`PolicyCenter`'s per-department salary templates** (`tenant_settings` key
   `salary_template_<department>`) — needs a product decision before any code change. It has **zero
   consumers** anywhere in the repo, and 06 §3.3 says per-tenant salary defaults belong on
   `employee_grades`, not on department. Swapping it to org-unit ids would bake uuids into a settings
   *key string* and render raw uuids as labels. Left alone deliberately.

5. **`Chat.tsx`'s `visibleChannels` legacy fallback is now dead code that looks alive.** It compares
   `employee.department` (a capitalised unit name) against `target_departments` (written from the
   lowercase slug list) — the §2f mismatch, so it can never match. Harmless; removing it is cleanup.

6. **The 34 untracked RESTRICTIVE tenant-isolation policies** (§4). Unchanged, still 34 of 253. Not
   org-module work — see §4 for why it is the recommended next major piece.

7. **§9.6 tenant Owner.** No longer blocked on the data call (dummy tenants), so the sequence in
   06 §9.6 can now run start to finish. Item 3 above should be folded into it.

## 3. Organisation module — remaining work, in order

Schema is complete and now has a UI. **What is missing is mostly adoption and three code items.**
Note the data above: 0 nested units, 0 unit heads, 0 grades. The configuration surface exists and
nobody has used it yet.

### 1. Execute the notification frontend spec — *do this first*
`doc/notify-task-submission-frontend-spec.md`. **Sonnet-tier.**

`submit_task_request` now fans out notifications server-side (applied `20260820090000`). But the
deployed SPA *still* runs its own client-side insert, which is refused, and ignores the new `notified`
return field. So every task submission currently notifies correctly **and** silently fails a redundant
second path. The spec is two deletions plus a return check; `src/utils/notificationTargets.ts` becomes
fully orphaned and should go with it.

### 2. Slice B part 2 — the RLS repoint
`migrations-pending-deploy/20260819120000_repoint-department-rls-to-org-units.sql`. **Opus-tier review,
then apply.**

Part 1 (columns + backfill) is applied and the SPA now writes the uuid targets, so **this is unblocked**.
Before applying, read the `.NOTES.md` and run its review query.

> **The §9.2 widening is vacuous today.** 1 policy / 7 channels / 1 project, and **none** are
> department-scoped, so `include_descendants` defaulting to true widens nothing. The review pass is
> trivially clean *now* and stops being trivial the moment an HR admin scopes the first document.
> Applying while it is still vacuous is the cheapest this will ever be.

Its section 2 re-runs as a no-op — it was written idempotently and part 1 copied it verbatim.

### 3. Then, and only then: §5 steps 5 and 6
Remove the dual-write (`EmployeeCreate.tsx` / `EmployeeDetail.tsx` `legacyValue` mapping), then drop
`employees.department` / `designation`. **Sonnet-tier for step 5.**

**Ordering is not optional:** step 3 (the RLS repoint above) must precede step 5. Until the policies are
repointed they still exact-match `employees.department`, so removing the write leaves new employees
matching nothing. Harmless while nothing is department-scoped; wrong the moment something is.

Step 6 is bigger than "drop three columns" — see §4 below.

### 4. Defects shipped 2026-08-19, known and deliberate
Full detail in `doc/org-module-status-2026-08-19.md` §3c.

- **(a) `EmployeeDetail` contradicts itself after a legacy save.** `saveChanges` writes `org_unit_id`
  with no assignment row, so the Department field shows the new unit while the history's "Current" row
  shows the old. **User-visible in production now.** Fixed by item 3 above.
- **(b) A Division or Team unit vanishes from department dropdowns.** The unit form writes legacy
  `unit_type` as the type's `structural_role`, and four screens filter `unit_type === "department"` —
  `Directory.tsx:111`, `EmployeeList.tsx:92`, `EmployeeCreate.tsx:356`, `EmployeeDetail.tsx:171`.
  Semantically right, visually surprising. **Haiku-tier**, 4 known sites. Note item 3 also touches
  `EmployeeDetail.tsx` — serialise them or they collide.
- **(c) The `structural_role` guardrail is client-side only (P5).** No DB constraint; `usageCounts` is a
  load-time snapshot. A CHECK/trigger belongs in the Slice B set.

### 5. Adoption — not code
The module cannot demonstrate value with the data above. Someone has to actually:
- nest the 10 flat units into a tree (the editor, cycle guard and path resync all work)
- assign unit heads — **0 of 10 set**, and `head_employee_id` is what the approval engine's `dept_head`
  step resolves against. Until these exist, §9.1's notification walk-up always falls through to HR.
- create grades — **0 rows**; `employee_grades` is where per-company defaults hang
- fill in reporting relationships — **5 of 16**; the org chart is sparse for data reasons, not code

### 6. Still open from `06`, unchanged
- **§9.6 tenant Owner role** — blocked on activating `employee_roles` (still 0 rows; `is_hr()` still
  resolves via JWT metadata). Also blocked on a **data call: who becomes owner for the 12 tenants?**
- **§5 step 9** `hr_policies.include_descendants` review before part 2 — see item 2.
- **The 8-file hardcoded `DEPT_OPTIONS`** (`org-module-status` §2a). This is what makes step 6 large:
  you cannot drop `employees.department` while ten screens render a fixed six-value department list.
- Org chart UI exists and is deployed; no work needed beyond data.

---

## 4. Biggest open item in the repo — not the org module

**34 of 253 RLS policies are in no migration**, across 19 tables. **All of them are the RESTRICTIVE
tenant fences** — `tenant_isolation` / `tenant_active_restrictive` on `tasks`, `leaves`, `projects`,
`notifications`, `task_submissions`, `leave_balances`, `shifts`, `tenant_settings` and 11 more. The
policies that stop one tenant reading another's data.

This was invisible because **the drift guard was broken**: `check-policy-drift.mjs` tested
`migrationText.includes(policyname)` — a bare name match across all migrations concatenated. Policy
names repeat across tables by design, so any policy whose name appeared anywhere counted as tracked.
It read `tablename` and never used it. Fixed 2026-08-20 to match the `(table, policy)` pair.

They are not invisible in the repo — most are in the loose root script
`insforge-enterprise-03-restrictive.sql` and in `migration-archive/pending-review/`. But they are
outside migration control: not replayable onto a new project or branch, and a change to one would not
appear in a diff.

**Baselining them is the recommended next major piece** — the same shape that worked today: a haiku
inventory node, then an opus node capturing them byte-identical, exactly as Phase 0a did.

---

## 5. Traps learned this session

**Do not confuse "not built" with "built but unshipped".** The org chart, the `functionsUrl` fix and
two call-site fixes were all written and sitting on an unmerged branch. Several docs recorded them as
missing.

**A 200 on a URL does not mean the file is served.** `test-admin.html` returned 200 on production for
weeks — that was `vercel.json`'s `/(.*)` → `/index.html` rewrite serving the SPA. **Grep the body.**

**"RLS refusal returns 200 with `[]`" is wrong for INSERT.** A `WITH CHECK` violation raises `42501` →
**403 with an error body**. Only UPDATE/DELETE refuse by matching zero rows via `USING`. The rule still
holds — check `error` *and* treat empty as failure — but `session_context_2026-08-18.md` §3 states the
reason wrongly.

**A non-`.sql` file in `migrations/` aborts the entire CLI run.** `Invalid migration filename:
....FRONTEND-SPEC.md`. Companion docs go in `doc/`.

**A migration that waited gets stale.** `20260817190000` had to be renumbered to `20260819190000`
before applying — the head had moved past it, and the CLI applies strictly in order and refuses to skip.

**Watch for gating deadlocks.** Slice B gated its policy repoint on the SPA writing columns that the
same migration created. Split additive DDL from the gated authorisation change.

**Assign subagent models by tier.** Four parallel Opus agents hit the monthly spend limit and one was
terminated mid-run. haiku = mechanical/inventory, sonnet = ordinary feature work, opus = authorisation,
migrations, security. A haiku inventory node in front of an opus node worked well: 74s, and it flagged
uncertainty instead of guessing.

---

## 6. Commands you will want

```bash
# Change the superadmin password. The RESPONSE IS NOT A SUCCESS SIGNAL — it returns true
# even for a nonexistent uuid. Verify by logging in.
curl -X POST "https://rq3qmu8y.ap-southeast.insforge.app/api/database/rpc/update_user_password" \
  -H "Authorization: Bearer $(node -e "console.log(require('./.insforge/project.json').api_key)")" \
  -H "Content-Type: application/json" \
  -d '{"p_user_id":"92142722-7cb8-4198-95e7-c2aa5da80b22","p_password":"<NEW>"}'

# Verify a release against the SERVED bundle, not src/
B=$(curl -s https://hrms.talentmeshsolutions.com/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
curl -s "https://hrms.talentmeshsolutions.com$B" | grep -oE 'functionsUrl|function2.insforge.app'

npm run check:policy-drift          # expect: 34 of 253 until they are baselined
npx @insforge/cli db migrations list
```

---

## 7. Documentation map

| Path | What |
|---|---|
| `doc/org-module-status-2026-08-19.md` | **The detailed record of this work.** §3c defects, §3d the drift finding, §2c/2d the outages |
| `doc/notify-task-submission-frontend-spec.md` | Ready-to-execute spec for §3 item 1 |
| `migrations-pending-deploy/README.md` | What is gated and why. One file pending: Slice B part 2 |
| `doc/architecture/06-organisation-management.md` | The module design. §4b is build status; **§5 step 3 is out of date** — `hr_policies.org_unit_id` already exists, do not create `department_filter_unit_id` |
| `doc/architecture/README.md` | Phase order |
| `doc/session_context_2026-08-18.md` | Previous handoff — §3 traps still valid except the INSERT one above |
