# P2-01 — Shared tenant date/calendar primitive

Repo `C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`, branch
`p1-00-harness-reconciliation`, base **`3e69057`**.

Read first:
- `doc/execution/non-payroll-monday/contracts.md` v0.5 — **§12 especially**, plus §3 and §14
- `doc/execution/non-payroll-monday/tasks.md` v0.5 — the P2-01 section and the v0.5 preamble
- `doc/execution/non-payroll-monday/reviews/package-review-P1-02.md` — what "accepted" looks like here

**This is not a greenfield build.** Read §1 before planning anything.

---

## 1. The primitive already exists — you are consolidating, not creating

`tasks.md` says P2-01 "exclusively defines the tenant timezone/business-date primitive." Taken
literally that reads as *build one*. **Do not.** Three functions are already live on the branch:

```
tenant_business_date(p_tenant_id uuid, p_instant timestamptz DEFAULT now()) RETURNS date
work_calendar_holiday(p_tenant_id uuid, p_employee_id uuid, p_date date)
work_calendar_working_days(p_tenant_id uuid, p_employee_id uuid, p_start date, p_end date)
```

All three are `SECURITY DEFINER` with a pinned `search_path`, and `EXECUTE` is held by
`authenticated` and `project_admin` only — **`anon` holds none**. That part is sound; keep it.

Your job is to make this set correct, consistent and safe to depend on — because P1-03, P2-02, P2-04
and payroll are all about to consume it. Building a second resolver alongside these would be the
worst possible outcome: two sources of business date, disagreeing silently.

Before designing anything, find every caller of all three and report the list.

---

## 2. The defect that matters most

`tenant_business_date` is **gated on the `attendance` module**:

```sql
WHEN ((SELECT auth.uid()) IS NULL OR (SELECT public.can_access_tenant(p_tenant_id)))
 AND (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance'))
THEN ... ELSE NULL
```

With Attendance disabled it returns **NULL**. `work_calendar_holiday` has **no** module gate at all,
so the same primitive set is inconsistently gated.

**Why this is a real break, not a nitpick.** §12.7 requires that "Projects-only, Leave-only,
Attendance-only and communication-only fixtures work without unrelated modules." A Leave-only tenant
has Attendance off, so every business date is NULL, so leave day-counting has no date basis. Module
independence is the product's core premise — a shared date primitive must not require any one module.

**I read this from the function definition; I did not exercise it**, because all 15 tenants currently
have Attendance enabled. Confirm it yourself against a Leave-only fixture before and after your
change — that is also the AC1 evidence.

**The fix is not simply to delete the gate.** Decide and state what module gating a *shared*
primitive should have. My position, which you may argue against with evidence: a date/calendar
primitive is infrastructure, gated on nothing; the *consumers* enforce their own module state. If you
disagree, say why rather than silently picking.

---

## 3. Two more findings, lower severity

**3.1 Multi-location tenants collapse to one timezone.** `tenant_business_date` takes only
`p_tenant_id` and reads `tenants.timezone`, but `locations.timezone` exists and the product supports
office locations. A tenant with offices in two zones gets the wrong business date for some employees.

Do **not** silently redesign the signature — P1-03 and P2-02 are about to depend on it. Either extend
it additively (an optional location/employee argument, with the tenant-level behaviour unchanged when
omitted) or record it as a known limitation with an owner. Either is acceptable; choosing without
saying is not.

**3.2 `auth.uid() IS NULL` bypasses the tenant check.** This is a deliberate service-context escape
for background jobs, and it is **not** an anon hole — `anon` cannot execute the function. Leave the
behaviour, but document why it is there, because the next person will otherwise read it as a bug and
either "fix" it (breaking derivation) or copy it somewhere `anon` *can* reach.

---

## 4. Holiday resolution — do not simplify it

There are three holiday stores and they are tiers of one resolver, not duplicates:
`holidays` (tenant default), `holiday_calendars` + `holiday_calendar_days` (named calendars).
**`holidays` is not legacy — most populated tenants use it. Never drop it.** `work_calendar_holiday`
currently reads `holidays` and `holiday_calendar_days`.

If you change precedence, state the order explicitly and test all three tiers including the case
where a named calendar and the tenant default disagree on the same date.

---

## 5. The schedule — read this before you touch attendance derivation

`attendance-derivation-hourly` on `tb-m1m2` is **repointed to the branch and deactivated**. It spent
a day pointed at the production host, so it is off deliberately.

If you need derived rows, re-enable it **explicitly** and re-verify `functionUrl` resolves to
`rq3qmu8y-j9g`, never `rq3qmu8y`. Also still unanswered and worth settling: **does `branch reset`
restore T0 schedule config** and silently re-arm the wrong host? If you run a reset, re-check the
schedule afterwards and record the answer — nobody has measured it.

---

## 6. Constraints

- Target `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`) only. **Never write to
  `0431f0f6-225f-4fb1-86b7-3fd32684c7f4`.** Verify with `npm run test:m1m2:target` before any write.
- Migration: `migrations/20260912182000_m1m2-shared-work-calendar-resolver.sql`. Hyphens in the name —
  underscores are rejected by the CLI. Applied migrations are immutable; a mistake means a new
  forward migration, and you must ask before adding one outside your file list.
- Every `SECURITY DEFINER` function needs its own tenant fence and a pinned `search_path`. **RLS does
  not backstop a definer function.** Do not grant `EXECUTE` to `anon` on anything.
- A tenant fence must be **RESTRICTIVE**. A PERMISSIVE policy is a grant; it ORs with the others.
- Do not redefine the P1-01 wire shape or the `md5(tenant‖':'‖user)::uuid` membership id.
- `CREATE OR REPLACE` cannot change a signature. If you need a different one, that is a new function
  plus a migration of callers — and PostgREST treats an omitted declared argument as
  "function not found", so changing an argument list breaks every existing caller.

**Allowed files**

```
migrations/20260912182000_m1m2-shared-work-calendar-resolver.sql   (new)
tests/m1m2/p2_work_calendar_resolver.mjs                           (new)
```

Plus, only if a caller genuinely must change and you have reported it first: the specific consumer
file. Anything else — **stop and report**. A test file you think you need is still a report, not a
silent addition.

Personas: `npm run test:m1m2:personas`, password in `tests/m1m2/persona-password.local`. The RLS
invariant is **1 / 2 / 0** (Company A `employees`, as employee.a / hr-employee.a / employee.b).
Re-run after your migration; a change means you moved RLS.

---

## 7. Acceptance criteria

1. **A Leave-only tenant — Attendance disabled — resolves a correct business date**, and leave
   day-counting works. Before/after evidence against a real fixture.
2. Module gating across the whole primitive set is consistent and stated, not incidental.
3. All three holiday tiers resolve, with the precedence written down and the disagreement case tested.
4. DST and a non-UTC tenant timezone produce correct business dates across a transition — including
   the ambiguous hour, which is where naive implementations break.
5. Every consumer of the three functions is enumerated and still behaves; none has been forked or
   duplicated.
6. `anon` gains no `EXECUTE`; every definer function is tenant-fenced with a pinned `search_path`.
7. RLS invariant 1 / 2 / 0 unchanged; `node scripts/check-policy-drift.mjs` shows **no new untracked
   policies** (50 is the pre-existing deferred baseline).
8. `npm run build` passes.

---

## 8. Report back

Exact commit, files changed, and **per criterion PASS / FAIL / UNTESTED**. A criterion you reasoned
about but did not execute is UNTESTED — say so. The last two packages were accepted partly *because*
they reported untested criteria honestly rather than inferring them.

Evidence, not assertion, for at least: the Leave-only tenant before and after; the DST transition;
the enumerated caller list; the holiday precedence disagreement case; RLS 1/2/0; drift count; build.

If the contract and the code disagree, or you cannot meet a criterion without duplicating the
primitive or widening access, **stop and say so**. A blocked report beats a green one that hides a
second source of truth for what day it is.
