# 06 — Organisation Management (People module)

**The foundation module.** Every other module joins to it. Attendance needs shifts per location, Leave
needs grades for policy defaults, the approval engine needs unit heads to resolve `dept_head`, Payroll
will need effective-dated grade and structure. Getting this shape wrong makes every later module bend
around it.

**Benchmarked against** Frappe HR's org docs (Employee, Department, Designation, Branch, Employee Grade,
Employee Group, Employment Type, Organizational Chart). Studied for its model; no code ported.

**Who operates it:** the **HR Administrator** configures the organisation. This module is the main
surface where a tenant expresses "how our company works", so it is the first real test of the
configurability substrate in `04-configurability.md`.

---

## 0. The model in plain language

Read this before the rest. The sections below mix structure, history, grades, locations and RLS
together because they have to be specified together — but the underlying idea is small.

**An employee record is a card with independent dimensions:**

```
┌─────────────────────────────────┐
│             ANUJ                │
├─────────────────────────────────┤
│ Organisation: ABC Technologies  │  ← the tenant
│                                 │
│ Belongs to:  Backend Team       │  ← ORG TREE
│ Reports to:  Priya              │  ← REPORTING TREE
│ Job title:   Backend Engineer   │
│ Grade:       L3                 │
│ Employment:  Full-time          │
│ Location:    Ahmedabad Office   │
└─────────────────────────────────┘
```

**There are two separate trees, and conflating them is the classic mistake:**

| Tree | Built from | Answers |
|---|---|---|
| **Organisation** | `org_units.parent_id` | *Where does this person belong?* |
| **Reporting** | `employee_reporting_relationships` | *Who manages this person?* |

They are independent on purpose. Matrix organisations are real: you can sit in the Backend Team while
reporting to someone outside it. A model with only one tree cannot express that.

**Three clarifications that are easy to get wrong:**

1. **An employee belongs to exactly one unit, at any depth.** Not necessarily a leaf — a company with no
   teams assigns people at department level. Ancestry is derived from the materialised `path` (§7), not
   from where the person sits.
2. **The tenant names its levels; it does not invent their meaning.** A company may call its departments
   "Practices" and nest them however it likes, but every type carries a `structural_role` from a fixed
   set — `division | department | team`. That bound is what lets `dept_head` resolution, policy scoping
   and reporting keep working regardless of naming (§3.1).
3. **Job title ≠ grade ≠ location ≠ unit.** Title is *what you do*, grade is *what band you are in*
   (and where per-company defaults hang), location is *where you sit*, unit is *where you belong*. Four
   independent dimensions that companies routinely conflate.

Everything below is the specification of that picture, plus the migration to get there from a schema
that currently stores several of these facts twice.

---

## 1. Where we stand

| Frappe entity | Ours today | Verdict |
|---|---|---|
| Company | `tenants` | 1 tenant = 1 company. No multi-legal-entity — out of scope, see §9. |
| Department (tree, `is_group`) | `org_units` (`parent_id`, `unit_type`) | Tree **capability exists, is unused** — 10 units, all `unit_type='department'`, **zero** with a parent |
| Department → leave/expense approvers | — | Missing. Needed by the approval engine's `dept_head` resolver |
| Designation | `job_titles` (title, grade, level) | Comparable |
| Branch | `locations` (**0 rows, dead**) | Present but never adopted; confusingly duplicated by `office_locations` |
| Employee Grade (default leave policy + salary structure) | `employees.grade` text (**0 rows**) | **Biggest gap.** Grade-as-text is exactly why nobody used it |
| Employee Group | — | Missing; deferred (§9) |
| Employment Type | `employment_types` | Comparable |
| Employee master (sectioned) | `employees`, ~45 flat columns | No sections, no education / experience / dependents |
| Org chart (from `reports_to`) | `employee_reporting_relationships` | **Ours is better** — effective-dated, typed, secondary managers. But **no chart UI**, and only 5 of 16 employees have a manager |

**Net:** ahead of Frappe on reporting relationships, level on designation/employment type, behind on
grade, branch, groups, and employee-master depth. The bones are good; the flesh is missing and some of
it has rotted.

---

## 2. Verified defects

### 2.1 The same fact is stored twice and the copies disagree

`employees` carries text **and** FK for three facts: `department`+`org_unit_id`,
`designation`+`job_title_id`, `employment_type`+`employment_type_id`. Both `EmployeeCreate.tsx` and
`EmployeeDetail.tsx` dual-write through a `legacyValue` mapping.

Live data, 2026-08-14 (16 employees):

```
dept_contradiction     7     -- both set, different values
emptype_contradiction  6
incomplete backfill    0     -- so this is divergence, not a half-done migration
```

The drift is slug-vs-display-name: `HR`/`Hr`, `sales`/`Sales`, `dev`/`Dev`, `marketing`/`Marketing`.

### 2.2 That drifting column drives access control

`hr_policies.policies_visible_to_all`:

```sql
EXISTS (SELECT 1 FROM employees e
        WHERE e.user_id = auth.uid() AND e.department = hr_policies.department_filter)
```

An exact string match. A policy targeted at `Hr` is **invisible** to an employee whose text column says
`HR`. The same pattern appears in `projects_employee_read` and three `chat_messages` policies —
**five access-control decisions keyed on a column that is provably inconsistent.**

> ⚠️ **Correction (2026-08-18).** An earlier revision of this document said document visibility "is
> silently mis-scoped in production right now". That overstated it. Checked against live data:
>
> | | rows | department-scoped |
> |---|---|---|
> | `hr_policies` | 1 | **0** (the one policy is `visible_to = 'all'`) |
> | `projects` | 1 | **0** |
> | `chat_channels` | 7 | **0** (no `target_departments` set) |
>
> Nothing is scoped by department today, so **nothing is currently mis-scoped**. The defect is real but
> **latent**: it activates the first time an HR admin scopes a policy, project, or channel to a
> department. That is still worth fixing before it bites, and it makes the backfill in §5 completely
> safe — no existing visibility decision depends on the current text values.

### 2.3 A department name is hardcoded in application logic

```ts
// src/employee/MyTasks.tsx:191 and src/employee/pms/EmployeeProjectView.tsx:174
db.from("employees").select("id").eq("tenant_id", tenantId).eq("department", "operations")
```

This selects who gets notified when a task is submitted. A tenant with no department literally named
`operations` (lowercase) notifies **nobody**, silently. This is the hardcoding problem in its purest
form, and it is load-bearing.

### 2.4 Dead and duplicated capability

- `locations` — 0 rows. `office_locations` — 3 rows, `lat`/`lng`/`radius_meters`, used by attendance
  geo-fencing. **Two similarly-named tables, different concepts, one dead.**
- `employees.grade` — 0 rows.
- `org_units.parent_id` — never populated. The tree is a flat list.
- No DB-level guard against reporting cycles; the check is client-side only (**P5**).

---

## 3. Target design

### 3.1 Named types with a system-understood role

The core decision. A tenant names its levels; the system understands what they *mean*.

```sql
CREATE TABLE public.org_unit_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id),
  name        text NOT NULL,              -- "Practice", "Chapter", "Vertical"
  structural_role text NOT NULL CHECK (structural_role IN ('division','department','team')),
  level_order integer NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, name)
);
```

**Why this shape.** A fully generic tree (tenant invents any type) breaks every feature that must reason
about structure — `dept_head` resolution, policy scoping, headcount reporting — and pushes us straight
back to hardcoded names like §2.3. A fixed Frappe-style set forces every company into one taxonomy.
Splitting *name* from *role* gives both: the UI says "Practice", the resolver reads
`structural_role = 'department'`.

**A tenant cannot invent a structural role.** Only names and nestings of the three we support. That
bound is deliberate — it is what keeps the rest of the system buildable.

**Preseeded on tenant creation** with Division / Department / Team. A company that does not care never
opens the screen and sees exactly Frappe's fixed model.

### 3.2 Units

```sql
ALTER TABLE public.org_units
  ADD COLUMN type_id uuid REFERENCES public.org_unit_types(id),
  ADD COLUMN head_employee_id uuid REFERENCES public.employees(id),
  ADD COLUMN path text;                   -- materialised ancestry, see §7
-- unit_type text is dropped once type_id is backfilled
```

`head_employee_id` is what the approval engine's `dept_head` step resolves against — previously
unresolvable, which is part of why approvals were hardcoded to `is_hr()`.

### 3.3 Grade as a first-class entity

```sql
CREATE TABLE public.employee_grades (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name      text NOT NULL,                -- "L3", "Senior", "Band 4"
  level     integer NOT NULL,             -- sort/compare order
  default_notice_days      integer,
  default_probation_months integer,
  default_leave_policy_id  uuid,          -- FK added in Phase 1
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, name)
);

ALTER TABLE public.employees ADD COLUMN grade_id uuid REFERENCES public.employee_grades(id);
ALTER TABLE public.job_titles ADD COLUMN default_grade_id uuid REFERENCES public.employee_grades(id);
```

Grade is **not** structural — it is where per-company defaults hang. Frappe hangs default leave policy
and salary structure here; we add notice period and probation now, and salary structure at the payroll
phase. Grade-as-text carried no defaults, which is exactly why zero employees used it.

### 3.4 Branch / work location — resolve the duplication

`locations` becomes the **organisational** work location (Frappe's Branch): name, address, timezone.
`office_locations` stays the **physical geo-fence** and gains `location_id`, so one branch may have
several fenced buildings.

```sql
ALTER TABLE public.office_locations ADD COLUMN location_id uuid REFERENCES public.locations(id);
```

An employee's `location_id` is orthogonal to their `org_unit_id` — someone in Engineering can sit in
the Pune office. Frappe keeps Branch separate from Department for the same reason, and that separation
is correct.

### 3.5 Unit membership must be effective-dated

`employees.org_unit_id` is a plain mutable column. Move someone from Engineering to Sales and
February's truth is destroyed — the system cannot answer *"which department was this person in when we
ran February payroll?"* or *"headcount by department over time."*

This is **P3** (derive from immutable entries, never overwrite) applied to org membership. It is also an
inconsistency inside our own model: `employee_reporting_relationships` is already effective-dated, so
*who you report to* has history while *which unit you are in* does not. Same class of fact, two
standards.

```sql
CREATE TABLE public.employee_unit_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id),
  employee_id    uuid NOT NULL REFERENCES public.employees(id),
  org_unit_id    uuid NOT NULL REFERENCES public.org_units(id),
  effective_from date NOT NULL,
  effective_to   date,                  -- NULL = current
  reason         text,                  -- 'hire' | 'transfer' | 'restructure'
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX employee_unit_current
  ON public.employee_unit_assignments (tenant_id, employee_id) WHERE effective_to IS NULL;
```

`employees.org_unit_id` stays as a **denormalised pointer to the current row** — kept in sync by
trigger, not by application code (the dual-write in §2.1 is what application-managed sync produces).
Reads stay simple; history stays intact.

The same argument applies to `grade_id` and `location_id` — a promotion and an office move are both
events, not overwrites. Phase 5 (Lifecycle events) generalises this; the unit assignment is built here
because payroll cost allocation depends on it and it is cheap at 16 employees.

### 3.6 Employee master — sections and child tables

Keep the flat table; group the ~45 columns into **sections for the UI** (Identity, Employment, Contact,
Personal, Statutory, Exit) driven by config rather than hardcoded form layout. Add child tables Frappe
has and we lack:

```sql
employee_education      (employee_id, qualification, institution, year, level)
employee_experience     (employee_id, employer, designation, from_date, to_date)
employee_dependents     (employee_id, name, relation, date_of_birth)
```

These are genuinely one-to-many and do not belong as columns or as custom fields.

---

## 4. Workflow — how the HR Administrator configures the organisation

Setup order matters; each step depends on the one above.

```
1. Work locations      → offices/branches, timezone       (locations)
2. Unit types          → rename/nest if desired           (org_unit_types)   ← preseeded, skippable
3. Org units           → the actual tree, assign heads    (org_units)
4. Grades              → bands + defaults                 (employee_grades)
5. Job titles          → designations, default grade      (job_titles)
6. Employment types    → full-time, contract, intern      (employment_types)
7. Employees           → assign unit, title, grade, mgr   (employees)
```

Steps 1–6 are the **configuration surface**, today `OrgStructureManagement.tsx` (883 lines, 4 tabs:
org_units / job_titles / locations / employment_types). It gains two tabs (unit types, grades) and the
tree editor described in §7.

### Guardrails

The existing UI already computes usage counts before allowing deactivation — keep that and make it a
DB-level rule rather than a UI courtesy (**P5**):

| Action | Rule |
|---|---|
| Deactivate a unit with employees | Blocked — reassign first |
| Deactivate a unit with active children | Blocked — the subtree would be orphaned |
| Delete anything referenced | Blocked by FK; deactivation is the supported path |
| Change a unit's parent | Allowed; `path` recomputed for the whole subtree |
| Create a cycle | **Rejected by trigger** — see §7 |
| Change a type's `structural_role` | Blocked once units exist — it would silently re-scope policies and approvals |

That last one matters: `structural_role` is what approval routing and policy scoping key off. Letting it
change under live data is how you get a silent authorisation change.

---

## 4b. Build status (2026-08-18)

**Slice A — schema and data, shipped.** All DB-only, no frontend dependency:

| Migration | Effect |
|---|---|
| `20260818100000_align-org-text-columns-to-fk` | Backfilled the drifting text columns. **department 7 → 0, designation 1 → 0.** |
| `20260818110000_org-unit-types-and-hierarchy` | `org_unit_types` (36 rows = 3 × 12 tenants), `org_units.type_id` / `head_employee_id` / `path`, cycle guard |
| `20260818120000_org-units-resync-descendant-paths` | Fixes stale descendant paths on re-parent |
| `20260818130000_employee-grades` | `employee_grades`, `employees.grade_id`, `job_titles.default_grade_id` |
| `20260818140000_employee-unit-assignments-history` | Effective-dated membership + trigger-maintained current pointer |

Verified by exercising the real behaviour, not just applying DDL:

```
hierarchy   A>B>C paths built; descendant query returns 3
cycle       A→B→C→A            BLOCKED ("cycle detected")
self-parent B→B                BLOCKED
re-parent   move B under D     child C AND grandchild E follow (see below)
history     transfer employee  Engineering→Product, pointer auto-synced,
                               both rows retained with date ranges, revert clean
regression  7/7 dashboard · employee 1 / manager 5 / hr 6 · 0 cross-tenant
```

**A real defect was caught mid-build.** The first hierarchy migration recomputed `path` only for the
row being moved, because a row trigger sees only its own row. Moving B from A to D left its child
holding `/A/B/C/` — a path claiming a parent it no longer had. Since `path` is what descendant queries
use, and descendant queries are what `include_descendants` scopes visibility with (§9.2), that would
have silently mis-scoped documents: the old division still matching a moved sub-team, the new one
missing it. Fixed in `20260818120000`.

**Two analysis corrections from live data:**

- **`employment_type` was a false positive.** It looked like 6 more contradictions, but the text column
  is a CHECK-constrained enum (`full_time`) and `employment_types.name` is a display label
  (`Full Time`). Consistently paired — a code/label convention, not drift. Backfilling it violates the
  constraint, so it is excluded and the text column stays.
- **`org_units` has no duplicates.** `Dev`, `Hr`, `Sales` each appearing twice is one per *tenant* —
  correct multi-tenancy. The only genuine within-tenant duplicate is `job_titles` in tenant `97da3641`,
  which has both `iNTERN` (2 employees) and an unused `intern` (0).

**Slice B — blocked on a frontend deploy.** Steps 3, 5 and 6 below (RLS repoint, removing the
dual-write, dropping the text columns) all break the currently-deployed SPA, which still writes
`department` / `designation` text. Not started.

---

## 5. Migration path

> **STATUS 2026-08-21: COMPLETE.** All ten steps are applied to production (head
> `20260821130000`). Step 6 turned out to be TWO columns, not three — `employment_type` was
> retracted by §4b as a code/label convention, not drift. Step 10 landed with a correction:
> §9.6's sequence is not buildable as written and its "role now has ONE source" claim is
> false. See the rewritten §9.6 below before acting on anything in it.


Non-destructive and staged. **Sequencing is not optional** — the RLS repoint must precede the column
drop, because five policies read the text columns and they subquery `employees`, the table that caused
the 2026-08-14 outage (**P2**).

```
1. Land inside Phase 0a's baseline (the five policies are mostly untracked today anyway).
2. Backfill: UPDATE employees SET department = org_units.name  -- align the 13 drifting rows
3. Repoint the 5 RLS policies from the text column to org_unit_id:
     hr_policies.policies_visible_to_all
     projects.projects_employee_read
     chat_messages ×3
   hr_policies.department_filter becomes department_filter_unit_id uuid.
4. Fix the hardcoded "operations" in MyTasks.tsx and EmployeeProjectView.tsx —
   unit head → parent unit head → role:hr_admin  (§9.1).
5. Remove the dual-write from EmployeeCreate.tsx / EmployeeDetail.tsx.
6. ONLY THEN: ALTER TABLE employees DROP COLUMN department, designation, employment_type.
7. Backfill org_unit_types from the distinct unit_type values; set org_units.type_id.
8. Create employee_grades; leave grade text in place until a tenant populates grades, then drop.
9. Add hr_policies.include_descendants (default true) — and REVIEW existing policies before
   applying, since defaulting to true widens who can see them (§9.2).
10. Activate employee_roles, then add the 'owner' role and seed one per tenant (§9.6).
```

Steps 2–3 are worth doing **early and on their own** — they fix live document-visibility mis-scoping
regardless of everything else in this document.

16 employees and 10 units make this hand-verifiable. That is the argument for doing it now rather than
at 10,000 rows.

---

## 6. Edge cases

| Case | Handling |
|---|---|
| Employee with no org unit | Allowed — shows as "Unassigned"; policy scoping treats as no-department, never as all-departments |
| Unit head is also a member of that unit | Normal; self-approval still blocked by the approval engine |
| Unit head leaves the company | Approvals escalate to the parent unit's head |
| Unit with no head | `dept_head` step skips to the next step in the chain |
| Employee reports to someone in another unit | Allowed — matrix orgs are real; reporting is independent of unit membership |
| Reporting cycle (A→B→A) | Rejected by trigger before insert |
| Deep tree (>10 levels) | Allowed; `path` keeps queries flat |
| Two units with the same name under different parents | Allowed — uniqueness is `(tenant, parent, name)`, not global |
| Renaming a unit type after use | Allowed and cosmetic — `structural_role` is what code reads |
| Moving a unit with employees | Allowed; employees follow the unit |
| Employee in a unit of a *different* tenant | Impossible — RESTRICTIVE tenant policy |

---

## 7. Tree mechanics and scalability

Per **P7**, nothing here is justified by current load (10 units, 16 employees). The shapes chosen are
those that do not need revisiting.

**Materialised path.** `org_units.path` stores ancestry (`/div-1/dept-3/team-9/`). "All employees under
Engineering including sub-teams" becomes a single `LIKE 'path%'` prefix scan instead of a recursive CTE
in an RLS policy — which matters because policies are evaluated per query and recursive CTEs inside them
are hard to reason about after this morning. Maintained by trigger on insert and re-parent.

**Cycle guard, in the database.** Both for the unit tree and for reporting relationships — the current
client-side `managerCycleValidation.ts` does not bind anything written through the API. A cycle in
reporting would hang any recursive scope query, and `is_manager_of()` already walks relationships.

**Org chart.** Derived from `employee_reporting_relationships` (effective-dated, typed) rather than a
flat `reports_to`. It answers "who reported to whom last March", which Frappe's model cannot. No chart
UI exists today — it is a genuine gap, and it is worth noting that with 5 of 16 employees having a
manager, the chart will look broken until the data is filled in. **Data quality, not code, is the
blocker there.**

---

## 8. What this does not do

- **No multi-company / legal entity.** One tenant is one company. A group with three registered
  entities cannot model that today. Deferred — it touches every table's tenancy assumption and should
  not be bolted on speculatively.
- **No multi-organisation membership.** A user is hard-bound to one tenant: `get_auth_tenant_id()`
  reads a single `tenant_id` from JWT metadata. A consultant serving two clients, or someone moving
  between group companies, needs two accounts. Verified: no user spans tenants today. Fixing this means
  a membership table plus a tenant-switching claim in the JWT — a real change to the auth core, not a
  schema tweak. **Flagged, not scheduled** (§9.5).
- **No tenant Owner role.** `superadmin` is *TalentMesh platform staff*, not the customer's owner. So
  nobody at the customer can transfer ownership, manage billing, or delete their own organisation.
  Today HR Admin is the ceiling. This is a genuine gap — see §9.6.
- **No organisation verification flow.** `tenants.status` and `domain_status` exist, but there is no
  PENDING_VERIFICATION → documents → review → VERIFIED path. New tenants go straight to active.
- **No Employee Group.** Frappe's grouping-for-bulk-operations. Deferred until a real bulk operation
  needs it; unit + grade + employment type already cover most selection needs.
- **No position/headcount management.** Approved-position budgeting is a larger-enterprise concern.
- **No custom fields yet.** Phase 5 (`04-configurability.md` §3).
- **No org chart UI in this phase** — schema supports it; the view is a follow-up.

---

## 9. Decisions taken (2026-08-14)

All six resolved. Nothing in this module is blocked on further input.

### 9.1 Notification target replaces hardcoded `"operations"` — **unit head, walking up**

Resolution order: the submitter's own unit head → the **parent** unit's head → `role:hr_admin`.

The intermediate walk-up matters: a Backend Team with no head should reach the Engineering head, not
jump straight to HR. This is the same escalation rule §6 already applies when a unit head has left, and
it reuses the approval-engine resolvers rather than inventing a parallel notification mechanism.

### 9.2 Policy scope — **per-policy toggle, default ON**

```sql
ALTER TABLE public.hr_policies
  ADD COLUMN include_descendants boolean NOT NULL DEFAULT true;
```

Rejected the global choice both candidate designs proposed. Some policies genuinely are unit-only (a
team-specific SOP); some are unit-and-below (a division-wide leave policy). One column removes the guess
and expresses both.

> ⚠️ **Migration hazard.** Today's RLS does an exact text match, so a policy scoped to "Engineering" is
> invisible to Backend. Defaulting `include_descendants` to true means those employees **gain access to
> documents they have never seen**. This is a live access-control widening on real data and requires a
> deliberate review pass over existing policies during migration — not a silent schema change.

### 9.3 Preseeded unit types — **three types, zero units**

Division / Department / Team are created as `org_unit_types` on tenant creation. **No `org_units` are
preseeded.** Preseeding types is discoverability; preseeding units would impose a shape. A small company
sees the three available and only ever creates Departments.

### 9.4 Job title vs grade — **drop `job_titles.grade` text**

`employee_grades` is the only grade entity. `job_titles.default_grade_id` supplies a default at hire;
`employees.grade_id` is the actual grade and may differ. Keeping a `grade` text on `job_titles` would
create a third competing source — the exact duplication this module exists to remove.

### 9.5 Multi-organisation membership — **deferred, and no table built now**

**This reverses an earlier recommendation in this document**, which proposed introducing the membership
table now with one row per employee so later expansion would be data rather than migration.

The counter-evidence is in this codebase. `employee_roles` was built exactly that way — in advance, for
a future need. It has **zero rows**, `is_hr()` still resolves through JWT metadata, and it has been
inert since 2026-08-13. A membership table built "ready for later" would repeat that precisely, because
`get_auth_tenant_id()` reads the JWT rather than a table — making it load-bearing requires the auth-core
change regardless. Pre-building saves almost nothing and adds a second inert table that drifts.

Deferred properly. When a real multi-company requirement appears, design it then, JWT claim included.

### 9.6 Tenant Owner — **yes, but activate `employee_roles` first**

> ⚠️ **CORRECTED 2026-08-21, after attempting it.** The sequence below was the original plan.
> Steps 1 and 2 are **not buildable**, and step 3's claim is **false**. What shipped is different.
> Read the correction before the plan.

~~Original plan:~~

```
1. Backfill employee_roles from employees.role / auth metadata
2. Make is_hr() resolve through the table (its second branch already does — exercise it)
3. Drop employees.role   → role now has ONE source
4. Add the 'owner' role
5. Seed one owner per tenant
```

**Why steps 1–2 fail, and step 3's claim is false.** Two facts from the live backend:

1. **Four auth users carry `metadata.role = 'hr'` and have NO `employees` row at all** —
   `hr@skyinfo.com`, `hr@testcorp.com`, `hr@testcorps.com`, `nikavx28@gmail.com`. This is not stale
   data. `create-hr-admin-user` provisions a tenant's first HR admin as an auth user only; it writes
   no `employees` row. Remove the JWT branch from `is_hr()` and **every new tenant is dead on
   arrival** — the admin who just signed up cannot even create the first employee.
2. **`get_auth_tenant_id()` reads `metadata->>'tenant_id'`.** JWT is already session truth for
   tenancy, and cannot stop being so without an auth-core rewrite. "One source" was never on offer.

**What shipped instead — three sources to TWO, holding different jobs rather than duplicating:**

| Source | Answers | Written by |
|---|---|---|
| `auth.users.metadata` | is this **session** HR, and which tenant | `set_hr_user_metadata` (superadmin) |
| `employee_roles` | grants a JWT cannot carry: `owner`, scoped `manager` / `payroll_admin` | HR, via RLS |
| ~~`employees.role`~~ | *(a redundant copy of the first — dropped `20260821130000`)* | — |

`employee_is_hr(employee_id)` mirrors `is_hr()` but asks about an **employee** rather than the
session, which is what the five notification fan-outs need — JWT describes one session and cannot
answer "who in this tenant is HR". `tenant_hr_employee_ids()` is the frontend's RLS-safe equivalent.

**There is deliberately NO `hr_admin` backfill.** Nothing writes `employee_roles` on HR promotion, so
copying `'hr'` into it would create the exact drift this module exists to remove — precisely how
`employees.department` came to contradict `org_units` on 7 of 16 rows. `employee_is_hr()`'s table
branch is the forward path, not dead code: when an HR-grant UI writes those rows they compose through
the existing `OR` with no migration and no drift window. **Do not "complete" this by backfilling
`hr_admin` unless you are simultaneously making `employee_roles` the WRITER for HR promotion.**

Owner is seeded for the **3 tenants that have an identifiable HR employee**, not 12. Eight tenants
hold zero employees, and `employee_roles.employee_id` is NOT NULL with an FK to `employees` — so
"exactly one owner per tenant" is unachievable as a database constraint, and unachievable at
provisioning time for the same reason the JWT branch is load-bearing. The DB enforces the half that
is true: a partial unique index giving **at most one active owner per tenant**. Tenants with
employees but no HR are skipped deliberately — promoting an arbitrary employee to owner invents an
authority nobody granted.

Owner carries org-level rights — transfer ownership, close the account, manage billing when billing
exists — distinct from `hr_admin`'s operational rights. Constraints: **exactly one owner per tenant**,
and a transfer flow (today, an owner leaving would strand the account).

~~**Open data call:** who becomes owner for the 12 existing tenants?~~ **Resolved 2026-08-21.** All
existing data is dummy, so there was nothing to confirm. Seeded as the earliest active HR employee per
tenant (by `date_of_joining`, then `created_at`), for the 3 tenants where one exists.

### Cross-cutting duplications found while auditing this module

Not org-management defects as such, but the same "two sources of truth" pattern, and worth folding into
Phase 0a's cleanup rather than rediscovering later:

- ~~**Role is stored in three places**~~ — **RESOLVED 2026-08-21.** `employees.role` was dropped
  (`20260821130000`). Two sources remain by design, holding different facts rather than duplicating
  one: see the corrected §9.6. `employee_roles` is no longer inert — it holds the seeded tenant
  owners.
- **`audit_log` and `audit_logs` both exist, 33 rows each.** A duplicate pair, like
  `locations`/`office_locations`. Determine which is live and drop the other.
