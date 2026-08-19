# 10 — RLS policy provenance & migration drift

**Date:** 2026-08-14
**Scope:** Not *what* the policies say (that is `02-database-and-rls.md` and `04-security-findings.md`) but
**where they came from** — whether the live security model exists anywhere in version control.
**Method:** live `pg_policies` on parent `rq3qmu8y`, name-matched against every `.sql` file in the repo
(`migrations/`, `migration-archive/`, root-level scripts).

---

## 1. Headline

| | count |
|---|---|
| RLS policies live in the database | **211** across 58 tables |
| Defined in `migrations/` | **100** (47%) |
| Only in a loose non-migration `.sql` script | **6** (3%) |
| **Defined in no `.sql` file anywhere in the repo** | **105 (50%)** |

**Half of the security model exists only in the running database.** It cannot be reviewed in a diff,
cannot be recreated on a new project, and cannot be diffed between environments. A fresh
`db migrations up --all` against an empty project reproduces **47%** of the access-control rules.

This is the CLAUDE.md rule-2 failure mode ("schema changes go through migrations, never ad hoc
dashboard edits"), measured.

---

## 2. This already caused a production outage

On 2026-08-14 every authenticated read returned `500 42P17 infinite recursion detected in policy for
relation "employees"`. Cause: three untracked policies —
`managers_can_view_own_draft_reports`, `managers_can_create_draft_reports`,
`managers_can_delete_own_draft_reports` — resolved the caller's row with an inline subquery on
`employees` from inside a policy *on* `employees`. Inline subqueries in a policy run as the invoking
role, so RLS re-entered itself.

Blast radius was total, not local: **45 policies on other tables** (`leaves`, `attendance`,
`notifications`, `tasks`, `payslips`, `expenses`, …) subquery `employees` for self-access, so all of
them failed too. Only `shifts` and `employee_shifts` — the two that never touch `employees` — kept
working.

Those three policies existed **only** in `new update doc/onboarding.md`. No migration contained them,
so no review could have caught them. Fixed in
`migrations/20260814060000_fix-employees-policy-recursion.sql`.

**The drift is not a tidiness problem. It is the direct cause of the only full outage this system has had.**

---

## 3. Notable untracked policies

### 3.1 `announcements` — ⚠️ correction: not a cross-tenant leak

**This finding was originally recorded as a "latent cross-tenant leak". That was wrong**, and the
correction matters because it changes what the fix should be.

```
policy : "Anyone can read active announcements"
cmd    : SELECT   roles: {public}   using: true
```

`public` does include `anon`, and an anon-key request does return `200`. But `announcements` has **no
`tenant_id` column** — its columns are `id, title, message, type, is_active, show_as_banner,
target_roles, scheduled_at, expires_at, view_count, dismiss_count, created_at, updated_at, image_url`.
It is a **platform-wide** table, like `platform_settings`, not a tenant-scoped one. There is no tenant
dimension to leak across, so no cross-tenant exposure exists or could exist.

Also corrected: the sibling policy `"Admins can manage announcements"` is `FOR ALL TO public
USING (is_admin())`, which looked alarming. `is_admin()` begins
`IF auth.uid() IS NULL THEN RETURN FALSE`, so anon is refused. It is safe.

**What remains is genuinely smaller:** the policy is named "…read **active** announcements" but its
predicate is `true` — no `is_active` check, and no `scheduled_at` / `expires_at` window. An
unpublished, scheduled-for-later, or expired announcement is readable by anyone with the anon key. On a
platform-wide banner table that is a disclosure-before-publication issue, not a tenancy issue.

**Not fixed here, deliberately.** This table belongs to the sister product — zero references in `src/`
or `functions/`, and the HRMS never reads or writes it (see `doc/architecture/README.md` §2). Narrowing
its policy would change another product's behaviour. Flagged for that product's owner to decide.

### 3.2 `employees` — duplicate SELECT policies

`employees_self_read` (`user_id = auth.uid() AND tenant_id = get_auth_tenant_id()`) and
`employees_self_select` (`user_id = auth.uid()`) both exist. Neither is in a migration. The second is
strictly broader; since PERMISSIVE policies OR together, the first one's tenant condition is dead
weight. Harmless today, but it is two rules where the reader expects one.

### 3.3 The `admin_bypass` family — 9 tables

`activity`, `admin_users`, `ai_suggestion_cache`, `announcement_dismissals`, `announcements`,
`audit_logs`, `notifications`, `platform_settings`, `profiles` each carry a
`FOR ALL TO project_admin USING (true)` policy. `project_admin` is the admin-key role, so this is
consistent with how InsForge admin access already works — but it is worth stating explicitly given the
production admin key `ik_aaf7c33…` was published at `/test-admin.html` and **is still unrotated**.

### 3.4 `platform_settings` — anon-readable, probably intentional

Readable with the anon key. Contents verified benign: `platformName`, `tagline`, `supportEmail`,
`feature_flags`, `maintenance`. Flagged as a **question, not a finding** — public-by-design is
plausible for a marketing surface.

### 3.5 Loose scripts (6 policies)

`platform_admins`, `platform_audit_logs`, and three `tenants_superadmin_*` policies live only in
`insforge-enterprise-02-functions-policies.sql` at the repo root — a hand-run script, not a migration.

---

## 4. What has improved since 2026-08-12

`04-security-findings.md` S3 listed **10 tables with RLS disabled**. Now only **2** remain, and both are
the disposable ones: `test_log`, `test_mcp_sync`. `tenant_settings`, `attendance_audit_logs`,
`exit_clearances`, `org_units`, `job_titles`, `locations`, `employment_types` are all covered.
S1/S2 (`exec_sql`, `query_json`, `update_user_password`) have had `anon` EXECUTE revoked.

The content-level hardening worked. Provenance is the layer that was never addressed.

---

## 5. Remediation — baseline the 105

> ### ✅ Steps 1, 2 and 5 completed 2026-08-14
>
> `migrations/20260814120000_baseline-untracked-rls-policies.sql` captures **111 policies** — the 105
> untracked plus the 6 that lived only in `insforge-enterprise-02-functions-policies.sql`.
>
> **Verified as a true no-op.** `pg_policies` was snapshotted before and after — including `qual` and
> `with_check`, not just names — and diffed on `(permissive, roles, cmd, qual, with_check)`:
>
> ```
> policies before : 211      missing after : 0
> policies after  : 211      newly added   : 0
> altered         : 0
> RESULT: PASS — byte-identical.
> ```
>
> Functional smoke test after the change matched the pre-change baseline exactly: 7/7 HR dashboard
> queries, employee-qa sees 1 employee row, manager-qa 5, hr-qa 6, zero cross-tenant rows for any role.
>
> **Drift is now 211/211 tracked, 0 untracked.**
>
> **Guard shipped:** `scripts/check-policy-drift.mjs` (`npm run check:policy-drift`). Checks provenance
> by **name**, not text equivalence — a later migration legitimately supersedes an earlier one's body, so
> comparing text would produce false failures. Verified in both directions: a deliberately-created
> out-of-band policy made it exit 1 and name the offender; removing it returned exit 0.
>
> Wiring it into CI still needs the InsForge admin key available as a secret.
>
> ### ✅ Step 3 completed 2026-08-14 (partial — see §3.1)
>
> `20260814130000_collapse-duplicate-employees-self-policies.sql` — dropped `employees_self_read`,
> keeping the broader `employees_self_select`. Behaviour-preserving: permissive policies OR together so
> the broader one already decided the outcome, and tenant isolation is enforced independently by the
> RESTRICTIVE `tenant_active_restrictive`. Keeping the *narrower* one would have **removed** self-access
> from employees whose `auth.users.metadata.tenant_id` is unpopulated. Verified after: employee-qa 1
> row, manager-qa 5, hr-qa 6, zero cross-tenant — identical to before.
>
> `20260814140000_drop-test-artifact-tables.sql` — dropped `test_log` (1 debug row) and `test_mcp_sync`
> (0 rows). No FK referenced either; no code referenced either.
> **Every table in `public` now has RLS enabled** — the S3 finding is fully closed.
>
> The `announcements` half of step 3 was **not** done, and the finding itself was corrected — it is not
> a cross-tenant leak, and the table belongs to the sister product. See §3.1.
>
> Live policy count is now **210** (was 211), all tracked. Guard green.
>
> Remaining: **step 4**'s cleanup of the now-redundant root scripts.

Reconciliation is mechanical and carries **no behaviour change**, which is what makes it safe to do
first:

1. Generate `CREATE POLICY` statements from live `pg_policies` for the 105 untracked policies.
2. Land them as one baseline migration, written to be idempotent (`DROP POLICY IF EXISTS` + `CREATE`)
   so applying it to the live project is a no-op that simply records reality.
3. Fold in the two real fixes while doing it — scope `announcements` to its tenant and add the
   `is_active` filter its name promises; collapse the duplicate `employees_self_*` pair.
4. Adopt the loose-script policies from §3.5 into the same baseline and delete the root scripts.
5. Add a CI guard that fails when a policy exists in `pg_policies` but in no migration — this is the
   check that stops drift returning, and it is the same shape as the RLS guard already recommended in
   `06-recommendations.md` §C.

**Why this must come before any new module work:** a per-tenant module entitlement check is an RLS
predicate. Adding one consistently to a policy layer where half the policies exist in no file means
reverse-engineering each from `pg_policies` by hand, one at a time. Baselining first turns that into a
reviewable diff.

---

## 5b. The same drift exists one layer down: FUNCTIONS

Found 2026-08-14 while checking whether the root `.sql` scripts were safe to delete. They were not —
`insforge-enterprise-02-functions-policies.sql` also defines `set_hr_user_metadata` and
`audit_tenant_changes`, and deleting it would remove their only source-controlled definition.

That prompted the same provenance audit for functions. **Extension-owned functions excluded** (pgvector,
pgcrypto, btree_gist, http account for 315 of the raw 402 and are installed by extensions, not by us):

| | count |
|---|---|
| Application functions in `public` | **87** |
| Defined in `migrations/` | 35 |
| Only in a loose root `.sql` | 13 |
| **In no `.sql` file anywhere** | **39 — of which 33 are `SECURITY DEFINER`** |

**This is worse than the policy drift was**, because `SECURITY DEFINER` functions run as their owner and
bypass RLS entirely. 33 of them exist only inside the running database.

They are not obscure helpers. They are the business logic:

```
employee_apply_leave_request      hr_approve_attendance_correction   fn_accrue_monthly_leaves
employee_cancel_pending_leave     hr_reject_attendance_correction    fn_check_insurance_expiries
create_draft_employee             hr_save_shift                      fn_cleanup_expired_onboarding
hr_activate_draft_employee        hr_schedule_shift_change           start/end_employee_break
check_rate_limit                  hr_set_overtime_status             notify_chat_message
get_auth_user_details_by_email    hr_create_remote_exception         sync_admin_users
```

`approve_leave_request`, `cancel_leave_request` and `punch_out_attendance` are in the root-only group —
present in the repo, but not under migration control.

**Direct consequence for the roadmap.** Phase 1 (Leave) rewrites `employee_apply_leave_request`,
`approve_leave_request` and `cancel_leave_request` to write ledger entries. Two of those three are not in
any migration, so "edit the migration that created it" is not currently possible — the same position we
were in with the three `employees` policies that caused the outage.

**Not fixed here.** Baselining functions is a larger job than baselining policies: `pg_get_functiondef()`
round-trips cleanly, but 39 functions is a much bigger diff to review than 111 policy statements, and
several are duplicated overloads that should be resolved rather than captured
(`06-recommendations.md` §E). It needs its own decision — see §7.

---

## 5c. 🔴 Surfaced by the function baseline: anon can call SECURITY DEFINER functions

Capturing the functions made their grants visible for the first time. **This is a live finding, not a
provenance one**, and it is the most serious thing in this document.

| | count |
|---|---|
| Application functions that are `SECURITY DEFINER` | 57 with `EXECUTE` granted to **`anon`** |
| …of those, containing any caller-identity gate (`auth.uid()`, `is_hr()`, `assert_hr_for_tenant`, …) | 28 |
| …of those, **no identity gate at all** | **29** |

`SECURITY DEFINER` runs as the function owner and bypasses RLS. `anon` is the key shipped in the
JavaScript bundle.

### Verified exploitable — anon key only, no login

```
POST /api/database/rpc/get_user_id_by_email        {"user_email":"hr-qa@…"}
  → 200  "a0000000-0000-0000-0000-000000000001"

POST /api/database/rpc/get_auth_user_details_by_email  {"user_email":"hr-qa@…"}
  → 200  [{"id":"a0000000-0000-0000-0000-000000000001","created_at":"2026-07-03T…"}]
```

Unauthenticated user enumeration: confirm whether any email is registered, and retrieve its internal
auth UUID. The UUID matters because several other ungated functions accept user/employee IDs **as
parameters**.

`06-recommendations.md` §A already prescribed
`REVOKE ALL ON FUNCTION public.get_auth_user_details_by_email(text) FROM anon, authenticated, public`
on 2026-08-12. **It was never applied.**

### The duplicate overloads are the mechanism, not a coincidence

The ungated set is dominated by *older* overloads that take identity **as a parameter** instead of
deriving it server-side:

```
approve_task_request(p_task_id, p_hr_employee_id)          ← caller asserts who they are
reject_task_request (p_task_id, p_hr_employee_id, p_notes)
submit_task_request (p_task_id, p_employee_id, …)
punch_out_attendance(…, p_work_hours, …)                   ← S5, client-supplied hours
```

Each has a newer sibling that derives the caller from `auth.uid()`. **Someone fixed these by adding a
new signature and never dropped the old one** — so the vulnerable version is still callable. This is
why "resolve the duplicate overloads" is a security task, not housekeeping.

The duplicates also cause a *functional* break: `check_employee_exists_by_email` returns
`300 PGRST203 "Could not choose the best candidate function"` — PostgREST cannot resolve the overload,
so the function is unusable through the API.

**Not tested:** the state-changing ungated functions (`approve_task_request`, `submit_task_request`,
`punch_out_attendance`). Confirming those would mutate production data. They are *plausibly* exploitable
by the same route, but that is inference, not a verified result.

### Not fixed here — deliberately

The baseline was scoped as mechanical capture with no behaviour change. Revoking grants is a behaviour
change and belongs in its own reviewed migration, alongside dropping the superseded overloads.

---

## 6. Reproducing this audit

```sql
-- live policies
SELECT tablename, policyname, cmd, permissive FROM pg_policies
WHERE schemaname='public' ORDER BY tablename, policyname;

-- blast-radius probe: which tables' policies depend on employees?
SELECT tablename, policyname FROM pg_policies
WHERE schemaname='public' AND (qual ~ 'FROM employees' OR with_check ~ 'FROM employees');

-- tables with RLS off
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
```

Name-match each `policyname` against the `.sql` files in `migrations/`. Anything unmatched is drift.

---

## 7. Phase 0a status

| Step | State |
|---|---|
| Baseline the 111 untracked policies | ✅ done, verified byte-identical |
| Drift guard (`npm run check:policy-drift`) | ✅ done, verified in both directions |
| Collapse duplicate `employees_self_*` | ✅ done, behaviour-preserving |
| Drop `test_log` / `test_mcp_sync` | ✅ done — every `public` table now has RLS enabled |
| `announcements` policy | ⏸️ finding corrected (§3.1); not ours to change |
| Baseline untracked functions | ✅ done — 57 captured, definitions **and** grants byte-identical |
| Delete redundant root `.sql` scripts | ✅ unblocked — their functions are now in migrations |
| Org text→FK RLS repoint | ⏭️ deferred to its own migration (see `doc/architecture/06` §5) |
| Revoke `anon` EXECUTE + drop superseded overloads | 🔴 **next** — see §5c |

**Phase 0a is complete.** Provenance is closed on both layers:

```
RLS policies      : 210 live, 210 in migrations, 0 untracked
App functions     :  87 live,  87 in migrations, 0 untracked
Tables with RLS off: 0
```

Both baselines were verified as true no-ops by before/after snapshot diffs — policies on
`(permissive, roles, cmd, qual, with_check)`, functions on `pg_get_functiondef()` **and** `proacl`.
The functions migration was piloted on a single function first, because 92 of 93 bodies contain
semicolons inside dollar quotes.

**The next work is no longer provenance — it is §5c**, the live grants finding that baselining exposed.

---

## 8. §5c remediation — completed 2026-08-17

### What was applied

| Migration | Effect |
|---|---|
| `20260817100000_revoke-anon-execute-on-secdef-functions` | Revoked the role-specific `anon` grant on 53 of 57 functions |
| `20260817110000_drop-superseded-identity-parameter-overloads` | Dropped 3 overloads that trusted caller-supplied identity |
| `20260817130000_revoke-public-execute-on-secdef-functions` | **The one that actually closed it** — revoked the `PUBLIC` grant on 55 functions |
| `20260817190000_drop-submit-task-request-identity-overload` | ⏸️ **staged, deploy-gated** — see below |

### The first revoke did not work, and the verification is why we know

After `20260817100000`, the exploit probe still returned:

```
OPEN  get_user_id_by_email            200  "a0000000-0000-0000-0000-000000000001"
OPEN  get_auth_user_details_by_email  200  [{"id":"a0000000-…","created_at":"…"}]
```

**Cause:** PostgreSQL grants `EXECUTE` to `PUBLIC` on every new function by default. In `pg_proc.proacl`
that is the leading `=X/owner` entry with an empty grantee. `anon` inherits from `PUBLIC`, so revoking
the role-specific grant changed nothing:

```
=X/project_admin | project_admin=X/… | authenticated=X/… | anon=X/…
     ^^^^ PUBLIC — the grant that actually mattered
```

Had the migration been trusted without re-probing, the hole would have been recorded as fixed while
remaining wide open. `20260817130000` revokes `PUBLIC` and re-grants `authenticated` explicitly, so
surviving access is *stated* rather than inherited.

### Verified closed

```
=== ANON KEY, NO LOGIN ===
BLOCKED 401  get_user_id_by_email                permission denied for function
BLOCKED 401  get_auth_user_details_by_email      permission denied for function
BLOCKED 401  get_auth_user_details_by_email_v2   permission denied for function
BLOCKED 401  check_onboarding_resumable          permission denied for function
BLOCKED 401  increment_announcement_view         permission denied for function
BLOCKED 401  fn_accrue_monthly_leaves            permission denied for function
BLOCKED 401  set_hr_user_metadata                permission denied for function
BLOCKED 401  check_rate_limit                    permission denied for function

blocked: 8   still open: 0
```

### No regression

7/7 HR dashboard queries; employee-qa 1 row, manager-qa 5, hr-qa 6; zero cross-tenant. Authenticated
RPCs (`get_my_platform_role`, `get_hr_policy_library`) return 200, not permission-denied.
`npm run build` passes.

Anon reads still **resolve** rather than error — `GET /employees` as anon returns `[]`, not
`permission denied`. That confirms keeping the PUBLIC grant on the four RLS helpers
(`can_access_tenant`, `is_admin`, `is_hr`, `get_auth_tenant_id`) was necessary: 26 RESTRICTIVE
`TO public` policies call them on every unauthenticated read.

### Overloads

Dropped: `approve_task_request(p_task_id, p_hr_employee_id)`,
`reject_task_request(p_task_id, p_hr_employee_id, p_notes)`,
`punch_out_attendance(…, p_work_hours, …)`. Each was verified to lack `auth.uid()` while its surviving
sibling derives the caller, and every call site in `src/` and `functions/` was checked first.

`submit_task_request(…, p_employee_id, …)` is **staged but not applied**. The deployed SPA at
`https://rq3qmu8y.insforge.site` still calls it; dropping it before the frontend ships would break task
submission for every employee. `src/employee/pms/EmployeeProjectView.tsx` was changed to call the
4-arg form — **apply `20260817190000` only after that is deployed.**

Left alone deliberately: `hr_activate_draft_employee` (both overloads derive from `auth.uid()`, both
uncalled) and `check_employee_exists_by_email` (second parameter is a filter, not an identity claim —
though the pair still breaks PostgREST with `300 PGRST203`).

### 🔑 Admin key rotated

The leaked key `ik_aaf7c339…` was **confirmed still live** — and worse, still being *served*:
`https://rq3qmu8y.insforge.site/test-admin.html` returned 200 with the key in the body. The file was
deleted from the repo but the deployed build still contains it.

Rotated to a new `ik_…` key; `.insforge/project.json` updated and verified working. `.insforge/` is
gitignored and the new key appears in no tracked file.

> ⚠️ **The old key remains valid until 18/8/2026 16:31 (24h grace period)**, and the deployed page is
> still serving it. **Redeploy the frontend before then** to remove `test-admin.html`. After the grace
> period the exposed key is inert, but the file should still go.

### Still open

- `punch_out_attendance` (surviving form) computes hours server-side but does **not** verify the caller
  owns the attendance row — the remainder of finding S5.
- `check_employee_exists_by_email` is unusable via PostgREST until its overload pair is collapsed.
- The drift guard is not yet wired into CI (needs the admin key as a secret).
