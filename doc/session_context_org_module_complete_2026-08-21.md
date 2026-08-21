# Session context — 2026-08-21 (afternoon). The organisation module is COMPLETE.

Continues `session_context_2026-08-21.md`. That handoff left production degraded and §9.6 open.
Both are closed. **`06-organisation-management.md` §5 is done, all ten steps.**

**Backend:** parent `rq3qmu8y` (`0431f0f6-225f-4fb1-86b7-3fd32684c7f4`). Applied head **`20260821130000`**.
**Frontend:** `hrms.talentmeshsolutions.com`, Vercel from GitHub `main`. Repo head **`c7a078e`**, pushed.
**Working tree:** clean. **Build:** green. **DB and frontend are IN SYNC.**

---

## 0. State

```
Applied head    20260821130000        (3 migrations this session)
Repo head       c7a078e               pushed, working tree clean
Build           green
Policy drift    34 of 253             UNCHANGED — the 3 policy rewrites are in migrations
Deploy          verified live         bundle contains tenant_hr_employee_ids, no .eq("role","hr")

Tenants 12   Employees 16   org_units 10   employee_roles 3 (owners)
```

---

## 1. What closed the divergence

The previous session dropped `employees.department` and `employees.designation` while the deployed
bundle still read both. 62 files were uncommitted. Reviewed and shipped in three commits
(`43624a7`, `ff13219`, `3260164`), plus one real bug found in review: `ShiftManagement.tsx`'s
`filteredAssignmentRows` called `deptLabel` without listing it as a `useMemo` dependency, so
department search silently matched nothing until the unit lookup happened to reload.

**The order was then reversed for `employees.role`**: frontend committed, pushed, and the deploy
*verified live* before the drop migration was applied. That is the rule going forward — a column drop
follows a confirmed deploy, never precedes one.

---

## 2. §9.6 — what shipped, and why it differs from the plan

The design doc's §9.6 has been **corrected in place**. Read it there; the short version:

§9.6 said "make `is_hr()` resolve through `employee_roles`, then drop `employees.role` → role now has
ONE source". **Steps 1–2 are not buildable and the claim is false.**

| Evidence | Consequence |
|---|---|
| **4 auth users have `metadata.role='hr'` and NO `employees` row** — `create-hr-admin-user` provisions a tenant's first HR admin as an auth user only | Remove the JWT branch and **every new tenant is dead on arrival**; the admin who just signed up cannot create the first employee |
| `get_auth_tenant_id()` reads `metadata->>'tenant_id'` | JWT is already session truth for tenancy. "One source" was never on offer |

**Shipped instead: three sources → TWO, doing different jobs.** JWT metadata answers *"is this session
HR, and which tenant"*; `employee_roles` holds grants a JWT cannot carry (`owner`, scoped
`manager`/`payroll_admin`). `employees.role` was a redundant copy of the first, and is gone.

**There is deliberately no `hr_admin` backfill.** Nothing writes `employee_roles` on HR promotion
(`set_hr_user_metadata` updates auth metadata only), so copying `'hr'` into it would manufacture the
exact drift this module exists to remove. Do not "finish" this by backfilling unless you
simultaneously make `employee_roles` the *writer* for HR promotion.

### The three migrations

```
20260821110000  resolve-hr-identity-without-employees-role   employee_is_hr() + tenant_hr_employee_ids();
                                                             5 functions + 3 policies repointed. No schema change.
20260821120000  tenant-owner-and-retire-department-scope     'owner' role, at-most-one index, 3 owners seeded,
                                                             'department' scope_type retired
20260821130000  drop-employees-role                          trigger guard rewritten, view recreated, column dropped
```

---

## 3. Traps learned this session

**The audit regex from the last session has a hole, and it cost a real miss.**
`[A-Za-z_]+[.]role[^_a-zA-Z]` requires a qualifier dot, so it cannot see an **unqualified** column
reference. `fn_check_insurance_expiries` reads `AND role = 'hr'` with no alias — a fifth HR fan-out
site that the "search by column name across every alias" rule still missed, because that rule was
about *aliases*, not about *no alias at all*. Search `\mrole\M` with no dot, and eyeball the hits.

**A too-broad audit is a feature, not a nuisance — if it fails closed.** The drop migration's
post-check flagged `sync_admin_users` and rolled the whole thing back. That was a false positive
(`NEW.role` there is `profiles.role`, a different table), but the migration refusing to proceed was
the correct behaviour. Scope such a check to `pg_trigger.tgrelid = 'public.employees'::regclass`
rather than searching the whole schema.

**PL/pgSQL plans each statement on first execution of THAT statement, not on first call.** Calling
`fn_check_insurance_expiries()` with no expiring policies "succeeded" while never entering the loop
whose body contained the rewritten line. To prove a loop body, **manufacture a row that enters it**,
inside a `DO` block that ends in `RAISE EXCEPTION` so the whole probe rolls back:

```sql
DO $p$ DECLARE v_before int; v_after int; BEGIN
  INSERT INTO ... ;                                  -- force the loop to have work
  SELECT count(*) INTO v_before FROM notifications;
  PERFORM public.fn_check_insurance_expiries();
  SELECT count(*) INTO v_after FROM notifications;
  RAISE EXCEPTION 'PROBE: % -> % (rolled back)', v_before, v_after;
END $p$;
```
It reported 17 → 19 (employee + HR recipient), then rolled back to 17 with no trace.

**An employee cannot query `employee_roles` for anyone but themselves,** and it fails *silently* —
`employee_roles_self_select` returns zero rows, not an error. Any "who is HR" question from a non-HR
session must go through a SECURITY DEFINER RPC (`tenant_hr_employee_ids()`). Verified as employee-role
users in two different tenants, each correctly resolving its own tenant's HR.

**`employee_directory_public`'s grants were NOT "project_admin only"** as the previous handoff
recorded. `anon` and `authenticated` hold SELECT/INSERT/UPDATE/DELETE. Provably inert — the view joins
`employees` to itself twice, so `information_schema.views` reports `is_updatable = NO` and
`is_insertable_into = NO`, and it has no INSTEAD OF triggers; `anon` SELECT also returns zero rows
because `get_auth_tenant_id()` is NULL without a session. Restored exactly rather than narrowed, so
the migration's diff stays about the one column. **Verify grants before restoring them; do not trust a
prior note.**

---

## 4. What is LEFT

### 4a. Not org-module work, still open

- **34 of 253 RLS policies are in no migration.** Unchanged all session. Still the biggest open item
  in the repo. See `session_context_2026-08-20.md` §4.
- **`anon` holds INSERT/UPDATE/DELETE on `employees_public`,** which unlike
  `employee_directory_public` **is** updatable. It is defended only by `security_invoker = true`
  passing `employees` RLS through to the anon caller — so it is currently safe, but by one flag rather
  than by the grant. Worth revoking as defence in depth. **Not touched this session.**
- **`PolicyCenter`'s per-department salary templates** (`tenant_settings` key
  `salary_template_<department>`) still have zero consumers. Needs a product decision.
- **Six `DEPT_OPTIONS` files remain** — all cosmetic.
- **`audit_log` / `audit_logs` duplicate pair**, 33 rows each. Determine which is live, drop the other.

### 4b. Still deliberately NOT built

§3.4 (`office_locations.location_id`) and §3.6 (`employee_education` / `_experience` / `_dependents`).
Unchanged reasoning: a table with no UI repeats the `employee_roles` mistake. Schema and UI belong in
the same piece of work.

### 4c. Owner has no enforcement yet — on purpose

`owner` is recorded, unique per tenant, and seeded. It grants **nothing** today: transfer-ownership,
close-account and billing surfaces do not exist, and building enforcement for capabilities with no
caller is exactly what left `employee_roles` inert for a week (§9.5). When those surfaces are built,
the role is already there and correct.

Two things a future owner feature must handle, both currently absent:
- **A transfer flow.** An owner leaving today strands the account.
- **9 of 12 tenants have no owner**, and cannot get one until they have an HR employee. Tenant
  provisioning should seed one at the moment it first creates an employee.

---

## 5. Commands

```bash
npm run build                       # tsc -b && vite build
npm run check:policy-drift          # expect: 34 of 253
npx @insforge/cli db migrations list

# Confirm a deploy is REALLY live before applying a drop — hashes differ between local and Vercel
# builds, so compare a marker string, not the filename.
curl -s https://hrms.talentmeshsolutions.com/ | grep -oE "/assets/index-[A-Za-z0-9_-]+\.js"
curl -s https://hrms.talentmeshsolutions.com/assets/index-XXXX.js | grep -c tenant_hr_employee_ids

# Find EVERY server-side reference to a column — bare name, not just qualified forms
npx @insforge/cli db query "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and pg_get_functiondef(p.oid) ~ '\mCOLUMN\M' order by 1"

# Verify RLS as a real user (superadmin and HR sessions both give false negatives)
#   employee-qa@talentmeshsolutions.com / Password@123      tenant da7a0000
#   quickwin089@gmail.com / RlsVerify!2026q                 tenant 97da3641 (HAS chat + policy rows)
```

---

## 6. Documentation map

| Path | What |
|---|---|
| `doc/architecture/06-organisation-management.md` | The module design. **§5 marked COMPLETE; §9.6 corrected in place** with the evidence that broke its plan |
| `doc/session_context_2026-08-21.md` | The previous handoff. Its §3 traps are still current; its §4a sizing of §9.6 was wrong (3 policies not 1, ~6 functions not 11) |
| `migrations/20260821110000_*.sql` | **Read this one.** The header carries the full argument for two sources rather than one |
| `migrations/20260821120000_*.sql` | Why there is no `hr_admin` backfill, and why owner is at-most-one rather than exactly-one |
| `migrations/20260821130000_*.sql` | The drop. Why `employee_directory_public` must NOT get `security_invoker`, and why its grants were restored rather than narrowed |
