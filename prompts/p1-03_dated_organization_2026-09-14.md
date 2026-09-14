# P1-03 — Dated organization placement and reporting

Repo `C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`, branch
`p1-00-harness-reconciliation`, base **`f79601b`**.

Read first:
- `doc/execution/non-payroll-monday/contracts.md` v0.5 — §3 (scopes), §9 (reporting), §4 (matrix)
- `doc/execution/non-payroll-monday/tasks.md` v0.5 — the P1-03 section and the v0.5 preamble
- `doc/execution/non-payroll-monday/reviews/package-review-P2-01.md` — the primitive you consume

---

## 1. The defect that is live right now

`is_manager_of(p_employee_id)` grants direct-report scope from **three** sources:

```sql
target.manager_id = me.id
OR target.secondary_manager_id = me.id
OR EXISTS (SELECT 1 FROM employee_reporting_relationships r
           WHERE r.employee_id = target.id AND r.manager_id = me.id
             AND r.is_active
             AND (r.effective_from IS NULL OR r.effective_from <= CURRENT_DATE)
             AND (r.effective_to   IS NULL OR r.effective_to   >= CURRENT_DATE))
```

**It never checks `relationship_type`.** Contract §3 and your AC3 say only `primary` grants
direct-report scope — `secondary`, `mentor`, `project_manager`, `reviewer` and `temporary` must each
fail manager-scope reads without another grant. Today every one of them succeeds, and so does the
legacy `secondary_manager_id` column.

**This is not hypothetical.** Measured on the branch today:

```
primary     7 rows | 6 currently effective
secondary   1 row  | 1 currently effective
```

That one effective `secondary` row confers full manager scope over its employee right now — reading
their attendance and leave as a manager. A `mentor` row would do the same.

Closing this is the package. Everything else is supporting work.

---

## 2. Two more, both measured

**2.1 Wrong day boundary.** `is_manager_of` uses `CURRENT_DATE` — the database server's date, in UTC.
P2-01 exists precisely so dated logic uses the tenant's business date. For a tenant east or west of
UTC, a relationship starting or ending today flips scope at the wrong moment.

Use `tenant_business_date(tenant_id)` — it is `STABLE SECURITY DEFINER` with a pinned `search_path`,
`anon` holds no EXECUTE, and it returns NULL for a tenant you cannot access. **Do not redefine it and
do not add an overload** — see §5.

**2.2 The overlap guard does not guard overlaps.** The only unique index is:

```sql
employee_reporting_one_active_primary ON (employee_id)
  WHERE relationship_type = 'primary' AND is_active = true AND effective_to IS NULL
```

`effective_to IS NULL` means it prevents two *open-ended* primaries and nothing else. Two primaries
with closed intervals can overlap freely, and AC4's exact boundary case — outgoing `effective_to = D`,
incoming `effective_from = D` — leaves **both** effective on D, because the existing predicates are
inclusive on both ends. Your AC4 requires exactly one to resolve on every date.

A `daterange` exclusion constraint with `GIST` is the usual shape here. Whatever you choose, state
whether intervals are half-open `[from, to)` or closed `[from, to]` and make the resolver and the
constraint agree — this is the decision the bug comes from, not the constraint syntax.

---

## 3. One thing that is *not* broken — do not "fix" it

Prior notes in this repo describe legacy manager columns drifting from the relationship table. **I
measured it today and it does not currently hold:** of 6 employees with `manager_id` set, all 6 also
have an active `primary` row. One employee has `secondary_manager_id` set.

So do not write a reconciliation backfill for a drift that is not there. What you *do* owe is
**recorded precedence**: when the legacy columns and the table disagree in future, which wins, and is
the legacy column still a write target or read-only compatibility. State it; do not leave it implied.

---

## 4. The frontend trap that has already cost this repo four files

`src/shared/pages/OrgChart.tsx`, `src/utils/orgChart.ts` and `useOrgStructure.ts` are in your list.

**A PostgREST self-referencing embed resolves backwards.** Embedding `employees` on its own
`manager_id` FK returns the employee's **children**, not their manager — silently, with no error, and
the shape looks right. This broke the Manager column in four files before. If you embed across a
self-FK, assert the direction in a test rather than eyeballing the payload.

---

## 5. Constraints

- Target `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`) only. **Never write to
  `0431f0f6-225f-4fb1-86b7-3fd32684c7f4`.** `npm run test:m1m2:target` before any write.
- Migration `migrations/20260912183000_m1m2-dated-organization-transfer.sql`. Hyphens — underscores
  are rejected by the CLI. Applied migrations are immutable.
- **`CREATE OR REPLACE FUNCTION` with an appended DEFAULT parameter creates a second overload rather
  than replacing.** P2-01 nearly shipped two live business-date functions this way. If you change
  `is_manager_of`, replace the body on its **exact existing signature**, and verify afterwards that
  `pg_proc` holds exactly one row for that name.
- Every `SECURITY DEFINER` function needs its own tenant fence and a pinned `search_path`; RLS does
  **not** backstop a definer function. No `EXECUTE` to `anon`, ever.
- A tenant fence must be **RESTRICTIVE**. PERMISSIVE is a grant; it ORs with the others.
- Do not redefine the P1-01 wire shape, the `md5(tenant‖':'‖user)::uuid` membership id, or any P2-01
  calendar primitive.
- **History is immutable.** A transfer closes an interval and opens a new one; it never rewrites a
  past row.

**Allowed files** — the list in `tasks.md` P1-03, unchanged. Anything else: **stop and report**,
including a test file you think you need.

Personas: `npm run test:m1m2:personas`; password in `tests/m1m2/persona-password.local`. RLS
invariant is **1 / 2 / 0** (Company A `employees`, as employee.a / hr-employee.a / employee.b).

You will need manager-shaped fixtures that do not exist yet. `tests/m1m2/fixtures/personas.mjs` is
**not** in your list — if you need a persona, report it and I will authorize the change rather than
you editing a shared fixture mid-package.

---

## 6. Acceptance criteria

Those in `tasks.md` P1-03 AC1–AC7. Emphasis where the risk actually is:

- **AC3 is the package.** Each of the five non-primary types must individually fail employee,
  attendance and leave manager-scope reads. Test all five by name, not a representative sample, and
  include `secondary_manager_id` — it is a separate grant path from the `secondary` row type.
- **AC4** must cover boundary date D explicitly, with exactly one primary resolving on D.
- **AC5** must show history unchanged after a transfer — assert the old row's values, not just that a
  new row exists.
- **AC6** re-resolves eligible actors dynamically; nothing is stored at assignment time.
- Plus: RLS invariant 1/2/0 unchanged, no new untracked policies (50 is the deferred baseline),
  `npm run build` passes, and exactly one `is_manager_of` in `pg_proc`.

---

## 7. Report back

Exact commit, files changed, **per criterion PASS / FAIL / UNTESTED**. A criterion you reasoned about
but did not execute is UNTESTED — say so. The last three packages were accepted partly *because* they
reported untested criteria honestly.

Evidence, not assertion, for at least: each of the five non-primary types denied by name; the
boundary-date D case; history unchanged after transfer; the `pg_proc` overload count; RLS 1/2/0;
drift count; build.

If closing AC3 breaks a caller that was relying on mentor or secondary scope, **report it** — do not
widen the resolver to keep that caller working. That caller is the bug.
