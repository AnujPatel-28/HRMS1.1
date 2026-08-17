# TalentMesh HRMS — Architecture & Decision Record

**Status:** active — this is the document the rest of the system is expected to follow.
**Created:** 2026-08-14
**Supersedes nothing.** Complements `system-audit-2026-08/` (findings) and
`doc/decisions_and_judgment_calls.md` (payroll/compliance judgment calls).

---

## Read this first

| # | Document | What it settles |
|---|---|---|
| — | **this file** | What we are building, where we start, and why |
| 01 | [`01-engineering-principles.md`](01-engineering-principles.md) | The rules every module must follow, and the evidence for each |
| 02 | [`02-module-registry.md`](02-module-registry.md) | Module model, entitlement schema, superadmin workflow |
| 03 | [`03-leave-module.md`](03-leave-module.md) | The first module rebuilt: design, schema, workflow, migration |
| 04 | [`04-configurability.md`](04-configurability.md) | How tenants differ without forking: approvals, fields, calculations |
| 05 | [`05-module-map.md`](05-module-map.md) | Every module — built, missing, and what each one needs |
| 06 | [`06-organisation-management.md`](06-organisation-management.md) | People/org module: units, grades, locations, the employee master |

---

## 1. The decision

**Payroll is last. Every other module is completed and documented first, on a substrate that lets
tenants differ without forking the code.**

| Phase | Work | Why it is in this position |
|---|---|---|
| **0a** | Baseline the 105 untracked RLS policies into migrations | Module entitlement **is** an RLS predicate. It cannot be applied consistently to a policy layer where half the policies exist in no file. Hard prerequisite. **Also carries the org text→FK RLS repoint** (`06` §5), since those five policies are untracked today anyway. |
| **0b** | Module registry + `tenant_has_module()` | Defines the contract every later module slots into. Small. Retrofitting it across 60 tables later is the expensive path. |
| **1** | **Organisation Management** | The foundation every other module joins to. Leave needs grades for policy defaults; the approval engine needs unit heads to resolve `dept_head`; Payroll will need effective-dated grade. Building Leave first would mean building its defaults against a grade entity that does not exist. See `06`. |
| 2 | **Leave + approval-chain engine, together** | Leave approval *is* the archetypal workflow. Building the ledger now and re-plumbing approval later is booked rework. Leave is the engine's first consumer. |
| 3 | Attendance — split raw punches from the derived record | Payroll's other input. Currently conflated, which is why geo-fence status is only advisory. Rules move to the engine. |
| 4 | Performance / Appraisal | Biggest missing module and pure greenfield — no migration risk, so it is where the configurability substrate gets proven on something new rather than something legacy. |
| 5 | Lifecycle events (promotion / transfer / grade) | Effective-dated. A hard payroll prerequisite: a mid-year salary change needs a dated event to attach to. |
| 6 | Custom fields | Deliberately *after* several modules ship — designed against fields tenants actually asked for, not imagined ones. |
| 7… | Timesheets, Training & Skills, Travel & Advances, Assets, Document compliance, Grievance | Ordered by demand; each is small once the substrate exists. |
| **N** | **Payroll** | Last. See below. |

**Why Organisation Management moved to Phase 1.** It was originally folded into "Directory — solid, no
work needed". That was wrong: auditing it found 7 of 16 employee records contradicting themselves on
department, five RLS policies keying access control off the drifting text column, and a department name
hardcoded in notification logic. It is both the foundation and the module with the most live defects.

### Why Payroll is last

Two independent reasons, and both are about de-risking rather than deferring:

1. **It needs statutory research, not engineering.** Still open per `doc/decisions_and_judgment_calls.md`:
   PF employer split into EPS 8.33% / EPF 3.67%, ECR filing, TDS actually consuming `it_declarations`,
   LWF, gratuity accrual, mid-month structure changes and arrears, full-and-final settlement. Seeded PT
   rates still need CA sign-off. That work is research-bound, not code-bound, and it should not be
   rushed to fit a build order.
2. **Its hardest technical dependency is the rule engine, not the tax rules.** "Every company calculates
   differently" is exactly what a formula engine solves. Building that engine now — with overtime, late
   marks and leave accrual as its proving ground — means payroll inherits something already proven in
   production. Payroll then reduces to *statutory research plus configuration*.

Payroll is also a *function of* leave and attendance. Rebuilding it on inputs we already know are wrong
(see §03 for the verified leave-balance drift) means doing it twice.

### Why not the module registry first

It was tempting — the superadmin story is the visible ask. But an entitlement check is a policy
predicate, and §0a is what makes policy changes reviewable. Registry-before-baseline means
hand-reverse-engineering 105 policies from `pg_policies`. Baseline first and it is a diff.

### The organising principle

Shipping ten more modules with hardcoded rules would leave ten hardcoded workflows to retrofit — the
same trap the RLS drift already sprung once, at a larger scale. So each module is built **on** the
configurability substrate in `04-configurability.md`, never around it.

---

## 2. Scope decision: HRMS only

The database currently contains tables belonging to the sister product: `profiles` (20 rows),
`admin_users`, `activity`, `ai_suggestion_cache`, `announcements`, `announcement_dismissals`,
`platform_settings`, `platform_admins`.

**Verified:** grep across `src/` and `functions/` returns **zero** references to any of them. They are
not part of this application.

**Decision:** the module registry governs **HRMS domains only**. No ATS concepts enter this schema, this
registry, or this UI. Module keys are plain (`leave`, `attendance`, `payroll`) — no product namespace,
because there is only one product here.

> ⚠️ **Do not drop those tables yet.** They are unused *by this app*, but the sister product may be
> pointed at this same InsForge project — `profiles` holding 20 rows suggests something is writing to
> them. Confirm what owns them before removing anything. Until then they are out of scope, not condemned.
> One of them, `announcements`, carries a live `TO public USING (true)` policy that must be fixed in §0a
> regardless of who owns the table.

---

## 3. Scale: design for growth, do not pretend we have it

Live volumes as of 2026-08-14:

| tenants | employees | attendance | leaves | leave_balances | payslips |
|---|---|---|---|---|---|
| 12 | 16 | 13 | 3 | 10 | 4 |

This is a **pre-launch dataset**. Nothing here is slow, and nothing here will be slow for a long time.

That has a direct consequence for how we make decisions: **we do not optimise for throughput.** Every
scalability argument in these documents is about *not having to rewrite later* — choosing a shape that
stays correct as volume grows — never about current performance. Where a simpler design would serve
10,000 employees fine, we take the simpler design.

The one place this bites is the ledger in §03: an append-only ledger is *more* rows than a counter,
deliberately. It is chosen for correctness and auditability, and it stays fast with the right index.
That is the trade being made, and it is made with eyes open.

---

## 4. Where the evidence comes from

Every claim in these documents is traceable to something checked against the live parent project
`rq3qmu8y`, not inferred from the repo docs. Where a repo document turned out to be wrong, the
correction is stated inline rather than quietly worked around. Two examples that shaped this plan:

- `session_context_2026-08-13.md` says concurrent leave approvals can corrupt balances. **They cannot** —
  both approve and cancel take `FOR UPDATE`. The real defect is different and is documented in §03.
- `scratch/seed-qa.sql` claims its hash is `Password@123`. **It is not**, and never was, which is why
  QA click-through had never actually been performed.

If you find a claim here that the database contradicts, the database wins — fix the document.
