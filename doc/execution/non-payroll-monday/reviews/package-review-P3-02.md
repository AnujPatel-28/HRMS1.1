# Package review — P3-02 projects, membership and task lifecycle

Reviewer: Opus 5 (lead), 2026-09-21. **Verdict: ACCEPTED** at `2a5870c`.

Commits: `851471d` (188000, GPT-5.6 Sol), `e14be9e` (188100 + 188200 + frontend, Sol),
`2a5870c` (188300 closure, Sonnet 5). Lead decisions: brief §7–§9 (`f0a7592`, `8d1b9d3`, `78f2312`).

## 1. Independently verified on TB-M1M2 (not taken from reports)

| Check | Result |
|---|---|
| Full suite `node tests/m1m2/p3_projects_tasks.mjs` | exit 0 |
| Self-approval PATCH as `employee.a`, after | HTTP 403 `42501 permission denied for table tasks`; stored `submitted` |
| Self-review via RPC (employee, HR) | `P1001 SELF_APPROVAL_DENIED` both |
| Open-task member removal | `P1003 PROJECT_MEMBER_HAS_OPEN_TASKS` |
| Punch in/out with Tasks disabled + due unapproved task | both `success:true` (gate untouched) |
| RLS Company A employees | 1 / 2 / 0 before and after |
| 14 task/project functions | 1 `pg_proc` row each, all DEFINER, all `search_path` pinned, no `anon` EXECUTE |
| INSERT/UPDATE/DELETE/TRUNCATE for anon/authenticated on tasks, task_submissions, projects, project_memberships | 0 rows |
| Backfill, tenant `da7a0000` project | `manager` QA Manager, `member` QA Project Member, both active |
| `npm run build` | clean |
| Policy drift | 49 / 312 (deferred baseline, reported by implementer) |

Before-change evidence (Sol, `--before-only`): PATCH HTTP 200, stored `approved`. Not re-runnable
after the migration by design.

## 2. Per criterion

| AC | Result |
|---|---|
| AC1 lifecycle via server APIs | PASS |
| AC2 reviewer scopes | PASS |
| AC3 no self-approval | PASS |
| AC4 project scope ≠ reporting scope | PASS |
| AC5 recipients + deep-link recheck | PASS |
| AC6 Projects-only + punch-out | PASS |
| AC7 | retry half PASS; availability half **N/A — no availability surface exists** (feature gap, as P2-04 AC6) |

## 3. What review caught that the suites did not

The fixture-only suite passed at `e14be9e` while existing data was broken: `project_memberships`
was created empty, so the one real project was readable by nobody and its open task was hidden
from its own assignee. Found by counting existing rows, not by reading the report. Fixed by the
188300 backfill. **Lesson for P3-03:** any package that moves authority onto a new table must be
checked against existing rows, not only fixtures.

## 4. Carried forward (no owner inside P3-02)

- **P3-02b** — advertise `project:<id>`: resolver replacement + `AuthContext.tsx` guard, one change.
  Until then the Project Manager UI does not show project actions from the capability summary.
- **Zero `project_manager` template assignments on every tenant** → nobody can create projects until
  an admin assigns one. Contract-correct; needs an operational step or onboarding default.
- **HR Admin cannot read projects** (contract §4 gives HR no `project.read`). Product question for
  the flexible-HRMS vision: should HR get read-only project visibility? Contract change if yes.
- **`visibility_config` and `projects.manager_id` are now inert columns** (kept, not dropped).
- `on-task-*` edge functions have no caller in `src/`.
- No UI yet for `p3_set_project_member` (member/manager changes are API-only).
