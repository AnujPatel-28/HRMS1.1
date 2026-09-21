# P3-02 — Projects, membership and task lifecycle

Repo `C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`, branch
`p1-00-harness-reconciliation`, base **`ca42d17`**.

Read first:
- `doc/execution/non-payroll-monday/contracts.md` v0.5 — **§3 (scopes), §4 (matrix), §7 (no-self-approval)**
- `doc/execution/non-payroll-monday/tasks.md` v0.5 — P3-02 and the v0.5 preamble
- `doc/execution/non-payroll-monday/reviews/package-review-P2-02.md` §1 — the write-denial pattern to copy
- `doc/session_context_2026-09-15-senior-dev-m1m2.md` §6 — the traps this repo keeps re-teaching

---

## 1. An employee can approve their own work today

`tasks` carries a PERMISSIVE UPDATE policy, `tasks_self_update`, whose entire predicate is
"this task is assigned to me":

```
USING      : EXISTS (SELECT 1 FROM employees e
                     WHERE e.id = tasks.assigned_to AND e.user_id = auth.uid())
WITH CHECK : (identical)
```

**No column restriction.** RLS cannot express one. So the assigned employee can `PATCH` their own
task row through PostgREST and set `status = 'approved'` — self-approving their own submission and
bypassing review entirely.

That is §7's central invariant ("the submission owner cannot approve… their own controlled request"),
and it is the same class as the attendance hole already closed: *employees could write any column on
their own attendance row.*

**Scope of my evidence, stated honestly:** I read the live policy definition and the grants. I did
**not** execute the self-approval, because no task fixture exists for the personas. Executing it —
before and after your change — is your AC2 evidence, and the first thing to do.

### The fix is already established here, do not invent a new one

P2-02 and P2-04 both used the same shape, and it is the only thing that works given RLS cannot scope
columns:

- reads stay policy-scoped,
- `INSERT, UPDATE, DELETE` revoked from `anon` **and** `authenticated` at the **GRANT** level,
- mutations go through `SECURITY DEFINER` RPCs with an **explicit column allowlist**,
- state transitions call **`assert_distinct_approver`** — P1-01's shared predicate, the only approved
  one, returning a single denial class.

Related hygiene you will see while doing this: `anon` currently holds `INSERT, UPDATE, DELETE, SELECT`
on `tasks`. It is fenced by the RESTRICTIVE `tenant_isolation` policy (anon resolves no tenant, so
every row is denied) and is therefore not exploitable — but it should not survive your migration.

---

## 2. Project membership does not exist — you are what makes `project:<id>` real

Measured: exactly **one** project-related table, `projects`, with a nullable `manager_id`. There is
**no project members table at all**.

`contracts.md` §3 says `project:<id>` "is unavailable and must not be advertised until P3-02 provides
and enforces project membership." That is honoured today — P1-01's resolver filters `project` and
`channel` grants out at emit time, even though the template catalogue contains them. Employee holds
18 catalogue rows and the live summary returns 14.

**You create the membership table and the enforcement. Only then may the scope be advertised**, and
advertising it means the resolver stops filtering `project` — which is a change in P1-01's territory.
If you conclude the resolver must change, **report it**; do not edit it yourself.

Contract shape to honour (§3, §4): `project:<id>` is "one explicit current project membership and
project role", resolved as a **server membership check**, never a caller-supplied id or a cached
array. Project Manager holds `project.read`, `project.manage`, `project.members.manage`,
`task.assign`, `task.review` at `project` scope, plus `org.read` at company. Employee holds
`project.read` and `task.submit` at project scope.

---

## 3. `tasks.project_id` is nullable, and that is load-bearing

A task may exist with no project. So project scope cannot be the only path to task authority, and a
null `project_id` must not fail open into "everyone can see it" or closed into "nobody can."

The §4 matrix already resolves this: HR Admin holds `task.assign`/`task.review` at **company**,
Manager at **direct_reports**, Project Manager at **project**. A project-less task is reachable
through the first two. Make sure your policies and RPCs express that, and test a null-`project_id`
task explicitly.

---

## 4. Constraints

- Target `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`) only. **Never write to
  `0431f0f6-225f-4fb1-86b7-3fd32684c7f4`.** `npm run test:m1m2:target` before any write.
- Migration `migrations/20260912188000_m1m2-project-members-task-lifecycle.sql`. **Hyphens** —
  underscores are rejected by the CLI. Applied migrations are immutable.
- **You may test the punch-out gate but may not alter it or its migration.** P2-02 owns it
  exclusively. Disabling Tasks must not trap an employee at punch-out — run that regression, do not
  change the gate.
- Use **P1-03's rule**: only an effective `primary` relationship grants direct-report scope. Mentor,
  reviewer, secondary and the rest must fail a manager-scope task read.
- Use **`tenant_business_date`** for any date boundary. Do not re-derive with `AT TIME ZONE` or
  `CURRENT_DATE`.
- Every `SECURITY DEFINER`: own tenant fence, pinned `search_path`, no `anon` EXECUTE. RLS does not
  backstop a definer function.
- A tenant fence must be **RESTRICTIVE**. PERMISSIVE is a grant.
- **`CREATE OR REPLACE` with an appended DEFAULT parameter creates a second overload** rather than
  replacing. Replace on the exact signature, then assert `pg_proc` holds one row per name.
- **Dropping a unique index orphans every `ON CONFLICT` that inferred it** — this recurred in P2-04
  and silently inserted phantom rows. If you drop or replace an index, grep for inference clauses.

**Allowed files:** the `tasks.md` P3-02 list. Need a fixture — a project, a membership row, a task?
**Report it** and it will be authorized, as it was for P1-02 and P2-04. Do not edit a shared fixture
unannounced.

RLS invariant **1 / 2 / 0** (Company A `employees`). Report it before fixtures and after teardown.

---

## 5. Acceptance criteria

`tasks.md` P3-02 AC1–AC7. Where the risk is:

- **AC2 is the package.** Employee-associated HR Admin, Manager for a direct report, and explicit
  Project Manager can review **only at their §4 scopes** and are denied out of scope — and the
  submitter cannot approve their own work, via the shared denial class.
- **The self-approval regression** in §1: prove it is possible before your change and impossible
  after.
- **Null-`project_id` tasks** behave per §3 of this brief.
- **Punch-out regression** with Tasks disabled — consumer test only, no gate change.
- Plus: one function copy per name, no `anon` EXECUTE or write grants left on `tasks`, RLS 1/2/0 both
  times, policy drift (**50 untracked is the deferred baseline** — report the real
  `check-policy-drift` number, not a `git status` count), `npm run build` clean.

---

## 6. Report back

Exact commit, files changed, **per criterion PASS / FAIL / UNTESTED**. A criterion you reasoned about
but did not execute is UNTESTED; one that passed because the thing it tests is inert or absent is
**not** a pass. Every package so far was accepted partly because it labelled gaps honestly — that is
the standard, not a concession.

Evidence, not assertion, for:
- **the self-approval attempt, before and after** — the single most important line in your report
- each out-of-scope reviewer denied by name (HR out of company, Manager for a non-direct-report,
  Project Manager for another project)
- a null-`project_id` task reachable by the right actors and no one else
- punch-out still works with Tasks disabled
- `pg_proc` overload counts; grants on `tasks`; RLS 1/2/0 both times; drift; build

If advertising `project:<id>` requires changing P1-01's resolver, or any fix needs a file outside
your list, **stop and report**. That is a scoping decision, not something to solve by widening your
own file list.

---

## 7. Lead decisions, 2026-09-21 (answers to the first stop-and-report)

The first attempt stopped correctly at HEAD `8fb7f62`, with two blockers: Company A has zero tasks,
and advertising `project:<id>` needs the resolver (`has_access_action`, `scope_type NOT IN
('project','channel')`) **and** `AuthContext.tsx` (which rejects the whole summary if a project
grant appears). Both decisions below are made. Resume.

### D1 — Fixtures: authorized, disposable, owned by your test file

- **All P3-02 fixtures live in `tests/m1m2/p3_projects_tasks.mjs`** (already on your list), created
  at setup and removed in a `finally` teardown, the way `p2_leave_workflow.mjs` does it. Use
  deterministic ids with a recognisable prefix so teardown is exact.
- **Do not edit `personas.mjs`, `seed.mjs` or `reset.mjs`.** You may *import* their helpers.
- You may create, for the duration of the run only: projects, project membership rows, tasks and
  submissions in Company A and Company B, and **two temporary Company A personas** — a reporting
  manager with an effective `primary` relationship over `employee.a`, and a project manager who is a
  member of project A1 only. Give the project manager a **non-primary** relationship (e.g. `mentor`)
  to `employee.a` so the P1-03 rule is tested: it must fail a manager-scope read.
- Minimum task set: a project-A1 task assigned to `employee.a` in a submitted state; a project-A2
  task (PM not a member); a `project_id IS NULL` task assigned to `employee.a`; a Company B task.
- **Why disposable and not persistent:** persistent extra Company A employees would change the 1/2/0
  invariant every other package reports. Report 1/2/0 before setup and after teardown; the mid-run
  count will differ and that is expected.
- **Order of operations for the before-evidence:** run setup → execute the self-approval PATCH as
  `employee.a` against the unchanged schema → record the raw response and the row's status after →
  teardown → only then apply migration `20260912188000`. Give the script a mode flag for this
  (e.g. `--before-only`) so the "before" line is reproducible.

### D2 — Project scope: enforce now, advertise later. The resolver and AuthContext stay untouched

- P3-02 **enforces** project membership. It does **not** advertise `project:<id>`. Do not edit
  `has_access_action`, `get_my_capability_summary`, migration `181000`, or `AuthContext.tsx`.
- Consequence you must design for: `has_access_action(..., 'project', <id>)` returns **false by
  design** today. Do **not** route project authority through it. Write your own definer helper (e.g.
  `is_project_member(p_project_id uuid, p_role text)`) that is a **server membership check** against
  your new membership table — current, same tenant, active employee — and use it in the RLS policies
  and the review/assign RPCs. That matches §3 of `contracts.md`: "one explicit current project
  membership and project role", never a caller-supplied array.
- Company and direct-reports authority (HR Admin, Manager) keep going through the existing seams
  (`has_access_action` at `company`, P1-03's primary-relationship rule at `direct_reports`).
- **Advertising becomes P3-02b**, a small follow-up the lead dispatches after P3-02 is accepted: one
  new migration replacing the resolver on its exact signature, plus the `AuthContext.tsx` guard,
  shipped together — shipping either alone breaks every user's capability summary. It is ordered
  after P3-02 on purpose: a scope must be enforced and verified before the UI is told it exists.
- Report the frontend consequence honestly: until P3-02b, a Project Manager's UI will not *show*
  project actions from the capability summary, even though the server allows them. Say which of
  your listed screens that affects; do not work around it client-side.

---

## 8. Lead decisions, 2026-09-21 (second stop-and-report, at `851471d`)

AC3 is accepted in principle (before: HTTP 200 → `approved`; after: 403 → `submitted`). I will
re-verify it independently at acceptance. The AC5 failure was diagnosed by the lead before this
decision, and **it is a migration defect, not a fixture gap. Do not "fix" it by seeding a
`profiles` row.**

Measured on TB-M1M2:
- `notifications.user_id` → FK `profiles(id)`. `profiles` is a legacy table: **10 of the 17**
  employees that have a `user_id` have no `profiles` row.
- **Every existing notification writer omits `user_id`.** All 41 live notifications have
  `user_id IS NULL`, keyed on `employee_id` (`functions/on-task-approved.ts`, `MyTasks.tsx`).
- `20260912188000` introduced `user_id` into three `INSERT INTO public.notifications` statements
  (lines ~239, ~312, ~376). That would break review for most real employees, not just the fixture.

### D3 — Forward migration authorized

- **`migrations/20260912188100_m1m2-task-notification-recipient.sql`** — fix: drop `user_id` from
  the three inserts and key on `employee_id`, like every other writer. **Derive each function body
  from `pg_get_functiondef()`**, change only that column list, replace on the exact signature,
  assert one `pg_proc` row per name afterwards. Nothing else goes in this file.
- If the rerun of AC1/AC2/AC5–AC7 exposes a further *database* defect,
  **`20260912188200_m1m2-task-lifecycle-followup.sql`** is pre-authorized for it. Name each defect
  in the report with the evidence that found it. Beyond 188200, stop and report.
- `20260912188000` stays immutable.

### D4 — Two things you will meet moving the frontend onto the RPCs

1. **No duplicate notifications (AC7).** `MyTasks.tsx` (lines ~218/254/283) inserts notifications
   from the client. Where your RPC now writes the same notification, remove the client insert —
   otherwise every submit/review notifies twice. Do not touch client notification inserts in files
   outside your list (e.g. `Expenses.tsx`, `AddTeamMemberModal.tsx`); those are P3-03 territory.
2. **Preserve the `calendar_events` side effect.** On approval, `TaskManagement.tsx:206` and
   `MyTasks.tsx:248` write a `calendar_events` row that `Calendar.tsx` displays. Your RPCs do not
   write it. Moving callers must not silently drop it: keep it working (in the RPC, idempotent on
   the existing `tenant_id,employee_id,date` conflict target, is preferred — the approval and its
   calendar mark then commit together) and show a before/after `calendar_events` row as evidence.
   The `on-task-*` edge functions have **no caller in `src/`**; say so in the report rather than
   wiring them up.
