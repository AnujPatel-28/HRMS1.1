# Session context — 2026-08-14 → 2026-08-18

Handoff for the next session. Covers a login failure, a production outage, the Phase 0a/0b/1 build,
and the traps found along the way.

**Backend:** parent `rq3qmu8y` (project `HRMS`, `0431f0f6-225f-4fb1-86b7-3fd32684c7f4`). Still the only
backend. **Admin key was rotated 2026-08-17** — `.insforge/project.json` is current.

---

## 1. State right now

```
RLS policies      253 live, 253 in migrations, 0 untracked
App functions      87 live,  87 in migrations, 0 untracked
Tables, RLS off     0
Tenants            12    Employees 16
tenant_modules    144 rows (12 tenants × 12 modules), all enabled
org_unit_types     36 rows (3 types × 12 tenants)
unit_assignments   12 rows (1 per employee that has a unit)
```

Guard: `npm run check:policy-drift` → green. Regression baseline (re-run after any RLS change):
7/7 HR dashboard queries · employee-qa 1 row / manager-qa 5 / hr-qa 6 · 0 cross-tenant.

Verification scripts live in the scratchpad, **not** the repo — `verify_rls.mjs` is the one worth
recreating. It mints real JWTs via `POST /api/auth/sessions` and hits
`/api/database/records/<table>`, which reproduces RLS exactly as the browser sees it.

---

## 2. What happened, in order

**Login failure (2026-08-14).** Not multi-tenancy. `scratch/seed-qa.sql:14` has a hardcoded bcrypt hash
commented `-- Password@123` — the comment is wrong and always was, so those QA logins had never worked.
Fixed in the DB for all six `*-qa@talentmeshsolutions.com` users. **`seed-qa.sql` still carries the bad
hash** — re-running it against a fresh project reintroduces the bug.

**Total outage, same day.** Every authenticated read returned `500 42P17 infinite recursion detected in
policy for relation "employees"`. Three untracked policies resolved the caller's row with an inline
subquery on `employees` from inside a policy *on* `employees`. Inline subqueries run as the invoking
role, so RLS re-entered itself. Blast radius was total — 45 policies on other tables subquery
`employees`. Fixed by routing through a `SECURITY DEFINER` helper (`get_my_employee_id()`).

Those three policies existed **only in a markdown doc**. That prompted everything below.

**Phase 0a — provenance.** 105 of 211 policies (50%) were in no `.sql` file. Baselined 111 (the 105 plus
6 from loose root scripts), verified byte-identical, shipped a drift guard. Then found the same problem
one layer down: 39 of 87 application functions untracked, **33 of them `SECURITY DEFINER`**. Baselined
those too (57 captured, definitions *and* grants byte-identical).

**Anon execution surface.** Baselining the functions exposed the grants: 57 SECURITY DEFINER functions
granted EXECUTE to `anon`, 29 with no identity check. Verified exploitable — `get_user_id_by_email` and
`get_auth_user_details_by_email` returned internal auth UUIDs to the anon key with no login. Closed.
Dropped 3 superseded overloads that took identity as a parameter. Rotated the leaked admin key.

**Phase 0b — module registry.** `modules` + `tenant_modules` + `tenant_has_module()`, one RESTRICTIVE
policy per owned table (34 tables, 11 modules), plus the frontend (`hasModule`, nav filtering, route
guard) and the superadmin toggle UI.

**Phase 1 Slice A — organisation management.** Text/FK drift backfilled, `org_unit_types` with
`structural_role`, materialised `path` + cycle guard, `employee_grades`, effective-dated
`employee_unit_assignments`.

---

## 3. Traps — read this before touching grants, RLS, or migrations

**A refused write returns `200` with an empty array, not an error.** RLS refuses by matching zero rows,
so PostgREST reports success. Any UI checking only `error` shows the action as done while the database
is unchanged. Always chain `.select()` on writes and treat an empty result as failure. This is a real
bug I shipped into `TenantModulesPanel.tsx` and had to fix.

**Revoking `anon` does nothing on its own.** Postgres grants EXECUTE to `PUBLIC` on every new function;
in `proacl` that is the leading `=X/owner` entry with an empty grantee, and `anon` inherits it. The
first revoke migration reported success while the exploit still returned 200. Always
`REVOKE ... FROM PUBLIC` and re-`GRANT` explicitly — then **re-probe**, never trust the success message.

**Four RLS helpers must keep their PUBLIC grant** — `can_access_tenant`, `is_admin`, `is_hr`,
`get_auth_tenant_id`. 26 RESTRICTIVE `TO public` policies call them on every unauthenticated read;
revoking turns empty results into `permission denied`. They leak nothing (each derives from
`auth.uid()`, NULL for anon). Correct behaviour is `GET /employees` as anon → `[]`, not an error.

**The CLI applies migrations strictly in order and refuses to skip.** A deploy-gated migration sitting
in `migrations/` blocks every later one. Gated files go in `migrations-pending-deploy/` (has a README).

**A row trigger only sees its own row.** Re-parenting an org unit left descendants with stale `path`
values — needed a second AFTER-UPDATE trigger to rewrite the subtree. `path` drives descendant queries
which scope document visibility, so this was an access-scoping bug, not cosmetic.

**`secrets rotate` needs CLI ≥ 0.2.x.** The pinned `0.1.73` has no such subcommand.

**Windows:** `execFileSync` fails on `npx` (a `.cmd` shim) with EINVAL — use `execSync` shell form.

---

## 4. Blocked on ONE thing: a frontend deploy

Pushing to GitHub does **not** deploy. Latest deployment on both hosts is **30 June**. Verified the live
bundles still run the old code.

Two workstreams are waiting on this:

**(a) `migrations-pending-deploy/20260817190000_drop-submit-task-request-identity-overload.sql`**
Drops the overload that trusts a client-supplied `p_employee_id` — any caller can submit a task as any
employee. Two call sites were fixed in the working tree (`MyTasks.tsx:170`,
`EmployeeProjectView.tsx:151`) but are **uncommitted and undeployed**. Dropping it now breaks task
submission for everyone.

*Release check — verify the live bundle, not `src/`:*
```bash
B=$(curl -s https://rq3qmu8y.insforge.site/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
curl -s "https://rq3qmu8y.insforge.site$B" | grep -oE 'submit_task_request.{0,60}'
# must show NO p_employee_id. Repeat for hrms.talentmeshsolutions.com (different bundle).
```

**(b) Phase 1 Slice B** — steps 3/5/6 of `doc/architecture/06` §5: repoint the 5 RLS policies from the
`department` text column to `org_unit_id`, remove the dual-write from `EmployeeCreate.tsx` /
`EmployeeDetail.tsx`, then drop the text columns. All break the deployed SPA, which still writes them.

**Also:** `test-admin.html` is still served on both hosts. The rotated key's 24h grace period has now
expired so it is inert, but the file should still go.

---

## 5. Corrections to earlier claims — do not re-derive these wrong

Several things I asserted earlier turned out to be wrong. They are corrected in the docs; listed here so
they are not repeated.

| Claim | Reality |
|---|---|
| `announcements` is a latent cross-tenant leak | **No `tenant_id` column** — it is platform-wide, like `platform_settings`. No tenant dimension to leak across. Real issue is smaller: predicate is `true` despite the name, so unpublished/expired rows are anon-readable. Belongs to the sister product; not ours to change. |
| `employment_type` has 6 contradictions | **False positive.** Text is a CHECK-constrained enum (`full_time`); `employment_types.name` is a display label (`Full Time`). A code/label pair, consistently applied. Backfilling violates the constraint. |
| `org_units` has duplicates (Dev/Hr/Sales twice) | One per **tenant** — correct multi-tenancy. Only genuine within-tenant duplicate is `job_titles` `iNTERN` + unused `intern` in tenant `97da3641`. |
| Document visibility "is silently mis-scoped right now" | **Latent, not live.** Nothing is department-scoped: 1 `hr_policies` row (`visible_to='all'`), 1 unscoped project, 0 of 7 `chat_channels`. Activates on the first scoped document. |
| Introduce the multi-org membership table now, so later expansion is data not migration | **Reversed.** `employee_roles` is the proof that pre-building for a future need produces an inert table — 0 rows, `is_hr()` still ignores it. Deferred properly. |
| `session_context_2026-08-13.md`: concurrent leave approvals can corrupt balances | Both approve and cancel take `FOR UPDATE`. The real defect is `fn_accrue_monthly_leaves` incrementing `balance` without `total_allocated`, so balance stops being derivable. 2 of 10 rows already drifted. |

---

## 6. Open items

**Needs the user**
1. **Deploy the frontend** — unblocks §4 entirely. Nothing else is close to this in value.
2. **Who becomes owner for the 12 existing tenants?** A data call, not design. Earliest HR user per
   tenant is the obvious default. Blocks the Owner-role work (`06` §9.6).
3. Reference-data typos in *other tenants'* records: `Hr` → `HR`, `iNTERN`, `Back-End Devloper`, unused
   `intern`. Left alone deliberately — customer data.

**Queued**
- Phase 1 UI: unit tree editor, grade management, unit heads. **Additive, not deploy-blocked** — the
  best thing to build while waiting.
- `punch_out_attendance` still does not verify the caller owns the attendance row (rest of S5).
- `check_employee_exists_by_email` unusable via PostgREST (`300 PGRST203`) until its overload pair is
  collapsed.
- Drift guard not in CI — needs the admin key as a secret.
- `employee_roles` has 0 rows and `is_hr()` still resolves via JWT metadata. Activating it is the
  prerequisite for the tenant Owner role.
- **No cron schedules exist.** `fn_accrue_monthly_leaves`, `insurance-expiry-check` and
  `daily-incomplete-task-marker` are dead code — features that look built and are not running.

**Roadmap** (`doc/architecture/README.md`): 0a ✅ → 0b ✅ → **1 Organisation Management (Slice A ✅,
Slice B blocked)** → 2 Leave + approval engine → 3 Attendance → 4 Appraisal → 5 Lifecycle events →
6 Custom fields → 7 misc → **N Payroll (last, by decision)**.

---

## 7. Where the documentation lives

| Path | What |
|---|---|
| `doc/architecture/README.md` | Phase order and the reasoning |
| `doc/architecture/01-engineering-principles.md` | 8 rules, each with the failure that motivated it |
| `doc/architecture/02-module-registry.md` | Module entitlement — **shipped end to end** |
| `doc/architecture/03-leave-module.md` | Phase 2 design (ledger) |
| `doc/architecture/04-configurability.md` | Approval chains, custom fields, rule engine |
| `doc/architecture/05-module-map.md` | Every module: built, missing, what each needs |
| `doc/architecture/06-organisation-management.md` | Phase 1 — §4b is the build status |
| `system-audit-2026-08/10-policy-provenance-drift.md` | The drift audit and its remediation |

Uncommitted at handoff: 5 Phase 1 migrations, `src/modules.ts`, `src/shared/RequireModule.tsx`,
`src/admin/TenantModulesPanel.tsx`, and edits to `TenantContext` / both layouts / `PayrollLayout` /
`AllCompanies`. **All applied migrations are already live on the backend** — the repo is what is behind,
not the database.
