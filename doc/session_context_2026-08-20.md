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
1. **Change the superadmin password.** `admin@talentmeshsolutions.com` (`92142722-7cb8-4198-95e7-c2aa5da80b22`)
   was published as `Password123!` for weeks. Command in §6. **Its response lies — verify by logging in.**
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
