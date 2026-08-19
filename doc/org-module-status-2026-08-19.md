# Organisation module — status and next moves (2026-08-19)

> **RESOLVED SAME DAY — the deploy gate is gone.** `main` was merged and pushed
> (`d0beb81..e26a2f0`) and Vercel deployed in ~100s. Verified on the live bundle
> `/assets/index-B1JvTIBb.js`: `functionsUrl` present, `function2.insforge.app` present, baseUrl
> `https://rq3qmu8y.ap-southeast.insforge.app`. Bundle grew 1,726,525 → 2,443,702 bytes — six weeks of
> unshipped work, including the org chart, went live.
> Sections 2b/2c/3 below are kept as the diagnosis; read them as history, not current state.
>
> **Edge functions verified reachable by slug, not inferred from the bundle string.** A bundle grep only
> proves the host is configured; it does not prove the functions were ever redeployed to it — which
> matters because six of the 17 exist only on the backend with no source in `functions/`. Probed against
> a control slug to separate "not deployed" from "reached":
>
> ```
> definitely-not-a-real-function  404   ← control: routing IS per-slug
> auth-session                    401   reached, needs auth
> create-employee-user            405   reached, wants POST
> admin-auth-login                405   reached          (no repo source)
> on-task-assigned                500   reached, GET without a body
> check-punch-out-gate            500   reached          (no repo source)
> daily-incomplete-task-marker    200   reached and ran  (no repo source)
> ```
>
> Every real slug answers; only the control 404s. **Edge functions are restored in production.**
>
> **Correction to the handoff doc:** `test-admin.html` is **not** served on production. It returns 200
> only because `vercel.json` rewrites `/(.*)` → `/index.html`; the body is the SPA and contains no key.
> Checking the status code alone is what produced the earlier claim. It **is** still real on the stray
> InsForge host — see §2d, now a live item rather than a tidy-up.

Answers two questions: **is the organisation module done?** (no — the schema is, the product isn't)
and **what's next?**

---

## 1. Is it complete? No. Schema shipped, product not built.

`doc/architecture/06-organisation-management.md` §4b says "Slice A shipped". That is accurate about the
database and misleading about the module. Verified by grep over `src/` on 2026-08-19:

| Slice A object | Rows live | Referenced anywhere in `src/` |
|---|---|---|
| `org_unit_types` (name, `structural_role`, `level_order`) | 36 | **no** |
| `org_units.type_id` | — | **no** |
| `org_units.head_employee_id` | — | **no** |
| `org_units.path` (materialised ancestry) | — | **no** |
| `employee_grades` / `employees.grade_id` / `job_titles.default_grade_id` | 0 | **no** |
| `employee_unit_assignments` (effective-dated membership) | 12 | **no** |

Six migrations' worth of schema that no user can reach. `OrgStructureManagement.tsx` (883 lines) still
drives the org tab off the **old** `unit_type` text column and a `parent_id` select — it does build a
roots/children map (`:365-371`), so hierarchy *display* exists, but it is keyed on the column Slice A
replaced, not on `type_id` / `structural_role` / `path`.

**Completion by piece:**

| Piece | State |
|---|---|
| Slice A — schema + data | ✅ live on `rq3qmu8y` |
| Slice B — RLS repoint → drop dual-write → drop text columns | ❌ not started, **deploy-gated** |
| Config UI — unit types, grades, tree editor, unit heads | ❌ not started |
| Transfer / assignment-history UI | ❌ not started |
| §9.1 — replace hardcoded notification target | ✅ built 2026-08-19, unshipped — see §5 |
| Org chart UI | ✅ **already built** (6 July), routed, never deployed — see below |
| `hr_policies.include_descendants` (§9.2) | ❌ not started |

**Correction to the roadmap's own status.** §8 of `06` lists "No org chart UI in this phase" and the
handoff doc repeats it. That is out of date: `src/shared/pages/OrgChart.tsx` (1,148 lines) plus
`src/shared/components/OrgChartNode.tsx` and `src/utils/orgChart.ts` exist on `updateSuggestion`, are
routed at `App.tsx:168` and `:224`, and read `employee_reporting_relationships` — exactly the
effective-dated source §7 specifies. It has simply never reached production, because `main` has not
moved since 4 June. The gap §7 names is real but it is **data, not code**: only 5 of 16 employees have
a manager, so the chart renders sparse.

Call it **schema complete, module ~35% complete** — with the caveat that "not built" and "built but
unshipped" have been conflated throughout the older docs.

---

## 2. Two findings the handoff doc does not record

**(a) The `"operations"` hardcode is 4× larger than §2.3 says.** §2.3 names two call sites. The actual
hardcoded department enum — `sales / dev / marketing / operations / design / other` — is duplicated
across **eight** files:

```
src/employee/MyTasks.tsx:191              .eq("department","operations")   ← notification target
src/employee/pms/EmployeeProjectView.tsx:174  .eq("department","operations")   ← notification target
src/hr/Calendar.tsx:9                     DEPT_OPTIONS
src/hr/Directory.tsx:121                  inline list
src/hr/EmployeeCreate.tsx:333             inline list
src/hr/EmployeeDetail.tsx:165             inline list (+ legacyValue dual-write)
src/hr/EmployeeList.tsx:102               inline list
src/hr/pms/ProjectDetail.tsx:37           DEPT_OPTIONS
src/hr/pms/ProjectList.tsx:12             DEPT_OPTIONS
src/hr/PolicyCenter.tsx:144               departments
```

This raises the cost of Slice B step 6. `employees.department` cannot be dropped while eight files
present a fixed six-value department list that no tenant's `org_units` necessarily matches. Step 6 is
not "drop three columns" — it is "make ten screens read `org_units` first".

**(b) The InsForge deploy was a mistake; production is the user's own Vercel project.**
Confirmed by the user 2026-08-19. `rq3qmu8y.insforge.site` is a stray `deployments deploy` from
2026-06-30. Real production is `hrms.talentmeshsolutions.com`, on their Vercel account, deployed from
GitHub. Consequence: `npx @insforge/cli deployments deploy` is **not** the release path and must not be
treated as one.

```
                              index chunk   insforge SDK chunk
hrms.talentmeshsolutions.com    1,726,525    insforge-CiA_j-4E.js   ← REAL production, oldest build
rq3qmu8y.insforge.site          2,363,738    insforge-CiA_j-4E.js   ← stray InsForge deploy, newer
local working tree (fresh)      2,474,540    insforge-CiA_j-4E.js   ← green, 0 TS errors
```

The customer-facing host is the *most* stale of the three. `test-admin.html` returns **200 on both**.

**Root cause of "pushing to GitHub does not deploy": nothing is wrong with the deploy. `main` has not
moved since 4 June.**

```
origin/main            d0beb81  2026-06-04     ← production branch, 5 commits behind
origin/updateSuggestion 707b79e 2026-08-17     ← all the work, pushed, preview-only
git rev-list --count origin/main...origin/updateSuggestion  →  0  5   (clean fast-forward)
local main             514c86e  (UNPUSHED)     ← the functionsUrl fix, see §2c
```

Work has been pushed to `updateSuggestion` for six weeks. Vercel builds production from `main`, so
every one of those pushes produced a preview deployment and nothing else. The release action is a
**merge to `main`**, not a deploy command.

---

## 2c. Production edge functions are down, and have been for weeks

Not a status question — a live outage found while checking the above. Probed 2026-08-19:

| Functions host | root | `POST /auth-session` | |
|---|---|---|---|
| `rq3qmu8y.function.insforge.app` | `000` | `000` | dead (deploy-classic, sunset 2026-07-20) |
| `rq3qmu8y.functions.insforge.app` | **404** | **404** | **← what production resolves to** |
| `rq3qmu8y.function2.insforge.app` | 200 | 500 | live (500 = reached, no auth body) |

The SDK falls back to `deriveSubhostingUrl()` → `https://{app-key}.functions.insforge.app` when
`createClient` is not given an explicit `functionsUrl`. Neither live bundle passes one — grepped both
`index-*.js` chunks for the `functionsUrl` key, absent in both. So every edge-function call in
production goes to a host that 404s.

Confirmed, not inferred, by three independent checks on the bytes actually being served:

1. Vite inlines `VITE_INSFORGE_URL` at build time, and the literal in production's index chunk is
   `https://rq3qmu8y.ap-southeast.insforge.app`. It ends in `.insforge.app`, so the
   `hostname.endsWith('.insforge.app')` branch of `deriveSubhostingUrl` fires — the fallback is
   reached, not skipped.
2. The SDK chunk is **md5-identical** (`09860795fda1032627d0b135a40257cf`) across production, the stray
   host, and a fresh local build. The derivation logic quoted above is provably the logic running in
   production, not a version-drift guess.
3. `functionsUrl` does not appear as an object key in either live index chunk. Rolldown does not mangle
   property names, so if `client.ts` had passed it, it would be there.

That is **all 17 deployed functions**: employee onboarding (`create-employee-user`,
`set-employee-password`, `verify-employee-code`, `finalize-onboarding`), auth (`admin-auth-login`,
`auth-signup`, `auth-verify`, `auth-session`), the four task/leave notification functions,
`calculate-late-marks`, `check-punch-out-gate`, `insurance-expiry-check`.

**The fix is already written and has never shipped.** `src/insforge/client.ts` derives
`.function2.insforge.app` and passes it as `functionsUrl` — commit `514c86e` on local `main`
(unpushed), and equivalently present on `updateSuggestion`. `origin/main`'s `client.ts` has no
`functionsUrl` at all.

This raises the priority of the merge above everything else in this document. It is not "unblock Slice
B" — it is "onboarding and notifications are broken in production right now".

*Caveat needing the Vercel dashboard to close:* that production builds from `main` is inferred from
bundle sizes and branch dates, not read from Vercel. Confirm the project's production branch before
merging.

---

## 2d. The stray InsForge host points at the dead backend branch

Same grep, run on both hosts' inlined `VITE_INSFORGE_URL`:

```
hrms.talentmeshsolutions.com  →  https://rq3qmu8y.ap-southeast.insforge.app       ← correct parent
rq3qmu8y.insforge.site        →  https://rq3qmu8y-jx7.ap-southeast.insforge.app   ← DEAD branch
```

`rq3qmu8y-jx7` is the retired `updateSuggestion` backend branch — 502, unrecoverable, retired per
`CLAUDE.md` §16. So the stray deployment is not merely a stale copy of the app; it is a **publicly
reachable, fully broken copy pointed at a backend that no longer exists**, and it serves
`test-admin.html`.

**It is also the only place `test-admin.html` is still real.** Verified 2026-08-19 after the production
deploy:

```
hrms.talentmeshsolutions.com/test-admin.html  →  SPA index.html (vercel rewrite), 0 secrets
rq3qmu8y.insforge.site/test-admin.html        →  the real file, admin key + Password123! present
```

The admin key it carries was rotated 2026-08-17 and its grace period has expired, so that credential is
inert. **The password is not** — `admin@talentmeshsolutions.com` / `Password123!` is published in
plaintext on a public URL and is only inert if that account's password has since been changed.

**Resolved 2026-08-19 — with a caveat about what "delete" was actually possible.**

The CLI **cannot delete a deployment.** `deployments` offers only `deploy | list | status | cancel |
env`, and `cancel` on a READY deployment fails with `deployment_not_canceled` (it is for in-flight
builds). True removal needs the InsForge dashboard.

What was done instead: the site was **overwritten with a static decommission placeholder**, which
removes every file the old build published. First attempt failed — the Vercel project has `vite build`
pinned, so a bare HTML directory exits 127; a `vercel.json` with `buildCommand` + `outputDirectory`
overrides it. Verified after:

```
/                        decommission placeholder
/test-admin.html         404, 0 secrets      (was: the real file, key + password)
/assets/index-BFfY_BEv.js 404                (old app bundle gone)
```

The URL still resolves and the deployment record still exists — **ask InsForge support or use the
dashboard to remove it properly.**

❗ **Still open, and the real remaining risk: the password.**
`admin@talentmeshsolutions.com` is **superadmin**, not an HR admin — user id
`92142722-7cb8-4198-95e7-c2aa5da80b22`. `Password123!` was publicly readable for weeks and must be
assumed known. Reset it with the admin key:

```bash
curl -X POST "https://rq3qmu8y.ap-southeast.insforge.app/api/database/rpc/update_user_password" \
  -H "Authorization: Bearer $(node -e "console.log(require('./.insforge/project.json').api_key)")" \
  -H "Content-Type: application/json" \
  -d '{"p_user_id":"92142722-7cb8-4198-95e7-c2aa5da80b22","p_password":"<NEW_PASSWORD>"}'
```

⚠️ **The response is not a success signal.** Probed with a nonexistent uuid, it returns `true` / HTTP
200 anyway — the function reports success regardless of rows affected. **Verify by logging in.**

Also present and worth a look: `corrupted_old_admin@talentmeshsolutions.com`, also `superadmin`
(`940e174c-6f80-40c7-bf9c-313a0070590a`). Left alone — deleting or disabling accounts is the user's
call.

---

## 2e. The merge is not a fast-forward — expect a conflict in `client.ts`

`origin/main...origin/updateSuggestion` is `0 / 5`, which reads like a clean fast-forward. It is not,
because **local `main` carries `514c86e`, which is on `main` only**. Both branches fixed the
`functionsUrl` problem, by different commits touching the same file:

```
main             514c86e  "route edge-function calls to new function2 host"  (+19 lines, client.ts)
updateSuggestion 707b79e  equivalent fix present in src/insforge/client.ts   (different commit)
```

So `--ff-only` will refuse, and merging will conflict in `src/insforge/client.ts`. Resolve toward the
`updateSuggestion` version (it carries the `VITE_INSFORGE_FUNCTIONS_URL` override and the derivation
comment) and verify the merged file still passes `functionsUrl` before building.

**Sequencing, non-negotiable:** commit the agent output on `updateSuggestion` first. Do not check out
or merge while agents are editing the working tree.

---

## 3. What's next — the critical path

```
        ┌─ (needs user) DEPLOY FRONTEND ─┐
        │   both hosts, from a green      │  ← gate
        │   build of the working tree     │
        └────────────┬────────────────────┘
                     │ unblocks
   ┌─────────────────┼───────────────────────────┐
   │                 │                           │
apply pending    Slice B steps 3/5/6        drop test-admin.html
migration        (RLS repoint, dual-write,
(task-submit     column drop)
 identity fix)

  ── independent of the gate, buildable now ──
   • §9.1 notification resolver (kills the load-bearing "operations" hardcode)
   • Org config UI: unit types + grades + tree editor + unit heads
   • Transfer / assignment-history UI on EmployeeDetail
   • Slice B migrations *authored* into migrations-pending-deploy/ (not applied)
```

**Rule for everything below the gate:** author, never apply. The CLI applies migrations strictly in
order and refuses to skip, so a single unapplied file left in `migrations/` blocks every later
migration. Deploy-gated SQL goes in `migrations-pending-deploy/`.

---

## 3b. Slice B is bigger than §5 step 3 describes (found 2026-08-19 while authoring it)

Authored, **not applied**, as
`migrations-pending-deploy/20260819120000_repoint-department-rls-to-org-units.sql` + `.NOTES.md`.

**All five policy baselines were located** in `migrations/20260814120000_baseline-untracked-rls-policies.sql`
— entries [55] `hr_policies.policies_visible_to_all`, [96] `projects.projects_employee_read`, [32] [35]
[37] on `chat_messages`. Rewrites route every `employees` lookup through SECURITY DEFINER helpers, so
no `employees` reference remains in any of the five bodies (**P2**).

Three things change the shape of Slice B:

**(a) 06 §5 step 3 is out of date. `hr_policies.department_filter_unit_id` should not be created.**
`migrations/20260813081500_policy-center-org-unit-targeting.sql` already added `hr_policies.org_unit_id`,
indexed it, and `get_employee_visible_hr_policies()` already implements the target semantics against it.
`src/hr/PolicyUpload.tsx:139` already writes it. Adding the column §5 names would leave `hr_policies`
with **three** columns for one fact, and point the row-level gate and the employee-facing RPC at
different ones. §5 predates that migration. Update §5.

**(b) Repointing only the employee side fixes nothing — the target side is text too.**
`chat_channels.target_departments` and `projects.visibility_config->'departments'` are written by the
SPA from the hardcoded six-slug list (§2a). Comparing them to `org_units.name` is still a text match
between strings that do not match the reference rows. So the migration also adds
`chat_channels.target_org_unit_ids uuid[]` and a `visibility_config.org_unit_ids` key, backfilled
case-insensitively and tenant-scoped (the drift *is* case).

**(c) Which makes the gate bigger than "deploy the frontend".** `hr_policies.org_unit_id` has a write
path; `target_org_unit_ids` and `visibility_config.org_unit_ids` **have none, in any branch — nobody
has authored them.** Applying before those ship means newly created department channels and
department-scoped projects grant access to nobody. It fails closed and existing rows are backfilled, so
it is a functional regression rather than a leak — but it means Slice B needs a *second* frontend change
shipped before apply, not just the dual-write removal §5 step 5 names.

**Open decision — a sixth policy has the identical defect.** `[29] chat_channels.channels_employee_select`
still matches `e.department = ANY (target_departments)`. Left out because it was outside the enumerated
five. Consequence of leaving it: channel visibility keys off drifting text while message visibility keys
off `org_unit_id`, so a user can list a channel whose messages they cannot read, or the reverse.

---

## 3c. Known defects shipped in the 2026-08-19 deploy

Both were caught and reported during the build, judged non-blocking, and shipped deliberately. Recording
them so they are not rediscovered as mysteries.

**(a) `EmployeeDetail` can contradict itself after a legacy save.** `saveChanges` still writes
`employees.org_unit_id` straight from the Department select without creating an
`employee_unit_assignments` row. After such a save the Department field shows the **new** unit while the
assignment history's "Current" row shows the **old** one — same screen, same load. `handleConfirmPassword`
has the same shape on draft activation. Closing this is 06 §5 step 5 (remove the dual-write), which is
now unblocked by the deploy. **Do this early — it is user-visible today.**

**(b) A Division or Team unit will vanish from department dropdowns.** The unit form writes the legacy
`unit_type` text as the chosen type's `structural_role`. Four screens filter `unit_type === "department"`
— `Directory.tsx:111`, `EmployeeList.tsx:92`, `EmployeeCreate.tsx:356`, `EmployeeDetail.tsx:171` — so the
first Division- or Team-role unit an HR admin creates will not appear in them. This is semantically
correct (a Division is not a Department) and the alternative was worse: writing a constant
`'department'` would let a Division masquerade as one. But it is user-visible the moment someone uses
the new Unit Types tab as intended.

**(c) The `structural_role` guardrail is client-side only (P5).** An update simply omits the column once
units reference the type, so it cannot be changed through the UI — but no DB constraint enforces it, and
`usageCounts` is a load-time snapshot, so a unit created by another HR user after the tab loaded leaves
the lock stale-false. A CHECK/trigger belongs in the Slice B migration set.

**(d) `notifications` INSERT is refused for employee-role submitters — pre-existing, now visible.**
`notifications_self_rw` permits inserting only where the row's `employee_id` is your own, so an employee
can never notify their unit head, parent unit head, or HR. The new resolver picks the right recipient
and the insert returns 200 + `[]`. This predates the change — the `manager_id` branch has always failed
the same way and `submit_task_request` inserts no notification server-side — but the new `.select()`
guard makes it loud instead of silent. Fix needs either a tenant-scoped INSERT policy on `notifications`
or a SECURITY DEFINER fan-out RPC. **Not authored.** `src/employee/Expenses.tsx:172-177` is the identical
twin and still unguarded.

---

## 4. Not in this module, but larger than anything in it

**No cron schedules exist.** `fn_accrue_monthly_leaves`, `insurance-expiry-check` and
`daily-incomplete-task-marker` are written, deployed and never invoked — features that look built and
are not running. Do **not** simply schedule the accrual: it increments `balance` without
`total_allocated`, so balance stops being derivable, and 2 of 10 rows have already drifted. Fix the
function, then schedule it.
