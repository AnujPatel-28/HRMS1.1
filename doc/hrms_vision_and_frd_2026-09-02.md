# TalentMesh HRMS — Vision, Module Architecture & FRD

**Written:** 2026-09-02 · **Status:** decision document, for discussion
**Method:** every claim marked ✅ was verified against the **live parent backend** `rq3qmu8y`
on 2026-09-02, not read from a doc. Claims marked 📄 come from repo docs and are labelled where
the live backend contradicts them.

> **What this file is for.** You asked for four things: a vision, an FRD, a validation of the
> existing docs against reality, and a triage of the QA run. They are sections 1–4, 6, 7 and 9.
> It is written to be re-opened in a later session as the single entry point — so it repeats the
> evidence rather than pointing at it.

---

## 0. Status at a glance — what is actually built

Verified live, 2026-09-02. "Rebuilt" means rebuilt on the module/contract substrate, not merely
present.

| Module | Entitlement key | State | Evidence |
|---|---|---|---|
| Organisation / People | `directory` (core) | ✅ **Rebuilt** (Phase 1) | `org_units` 16, `employee_grades` 4, `job_titles`, `locations`, `employment_types`, `org_unit_types`, `employee_unit_assignments`, `employee_reporting_relationships` all live |
| Attendance / Time | `attendance` | ✅ **Rebuilt** (two-layer) | `attendance_events` (append-only) + `attendance` (derived); `attendance_derivation_runs` 80+ scheduled runs, 0 failures; device ingest seam live |
| Work Calendar | `work_calendar` (core) | ✅ **Built**, ⚠️ **not consumed** | 3-tier resolver `work_calendar_holiday()` exists and is correct; only attendance calls it — §6.1 |
| Leave | `leave` | ❌ **NOT rebuilt** | `leave_balances` is still a mutable counter (`total_allocated, carried_forward, used_days, pending_days, balance`). No ledger table exists |
| Tasks / Projects | `tasks` | ❌ **NOT rebuilt** | RLS has no manager branch — §6.4 |
| Payroll | `payroll` | ❌ **Not started** (last, by decision) | `salary_structures` is still fixed columns (`ctc_annual, basic_percent, hra_percent, special_allowance, …`), not a component model |
| Onboarding | `onboarding` | ⚠️ **Broken in production** | Employee creation is hard-blocked — §6.3 |
| Offboarding | `offboarding` | Present, untested | `exit_requests`, `exit_clearances`, `exit_clearance_templates` |
| Policy Center | `policy_center` (core) | Present | `hr_policies`, `employee_policy_acknowledgements` |
| Expenses / Insurance | `expenses`, `insurance` | Present, untested | |
| Chat / Connect | `chat`, `connect` | Present | the only realtime consumers |
| **Approval-chain engine** | — | ❌ **Does not exist** | no approval/workflow tables among the 73 public tables |
| **Performance** | — | ❌ **Does not exist** | no appraisal/goal tables |
| **Custom fields** | — | ❌ **Does not exist** | |

**Live scale:** 15 tenants (only **5 have any employees**), 22 employees, 31 attendance rows,
7 leaves, 4 payslips. ✅ This is a pre-launch dataset — design for growth, do not optimise for it.

---

## 1. The vision, in one page

**TalentMesh is an HRMS where a company's *shape* is data, not code.**

Three commitments follow, and everything downstream in this document derives from them.

### 1.1 Every module runs alone, and runs better together

A company can buy Attendance alone and keep their existing payroll. They can buy Payroll alone
and feed it a CSV from their existing biometric system. Nothing degrades silently when a module
is off.

This is **already enforced in the database**, not aspirational: `tenant_has_module()` is a
RESTRICTIVE RLS predicate on 34 tables. ✅ A disabled module's tables are unreadable through the
API regardless of what the UI does.

> **The market research sharpens this into a specific, defensible claim** — and narrows it from
> what I first wrote. The split is regional, not universal (full evidence in §9):
>
> - **The Indian vendors bundle payroll from the entry tier.** factoHR's cheapest paid tier
>   ("Core") already includes attendance **and** payroll; HROne's "Basic" does the same; Keka
>   ships payroll in *every* tier; Darwinbox's typical floor is Core HR + Payroll. None of them
>   sells attendance-without-payroll as a real SKU.
> - **The global vendors unbundle it.** BambooHR sells Time & Attendance as an add-on that does
>   **not** require Payroll. Zoho goes furthest — Payroll is a separate *product*, reconnected to
>   Zoho People through one explicit, named, toggleable sync.
>
> So the honest positioning is: **genuine per-module independence is the global pattern, and it is
> missing from the Indian market we sell into.** That is a real differentiator here, and it is
> validated rather than speculative — the unbundled model is what the largest vendors converge on
> once they scale. Do not claim nobody does it; claim nobody here does it.

### 1.2 Modules never read each other's tables — they read a contract

The one non-negotiable engineering rule. A module that reaches into another module's tables
becomes impossible to turn off, because its correctness now depends on rows that may not exist.

Two contracts exist today and both were built for exactly this reason:

- **`payroll_period_input(tenant, start, end)`** — the attendance/leave → payroll seam ✅
- **`work_calendar_holiday(tenant, employee, date)`** — the "is this a working day" seam ✅

**The single biggest correctness problem in the system right now is that the second contract is
bypassed by everything except attendance.** That is §6.1, and it is the true root cause behind
the QA run's worst finding.

### 1.3 Unknown is never zero

The rule that has already prevented two money bugs. An employee with no attendance rows gets
**no row**, never a row of zeros — because "the module is off", "nobody punched yet" and "they
were absent" are three different facts and only one of them costs someone money.

Attendance honours this in the database ✅ (verified: a derivation run covered three unpunched
working days and correctly produced zero rows). **The HR Daily screen violates it in the UI** —
§6.9.

---

## 2. The two taxonomies, reconciled

There are two lists of "modules" in this project and they do not match. Until this is settled,
every future session will talk past it.

- `public.modules` — **13 keys**, 3 of them core. This is what RLS enforces ✅
- `doc/module_architecture.md` — **10 modules** (People, Time, Leave, Payroll, Claims, Work,
  Performance, Policies, Connect, Settings). This is a navigation proposal 📄

**Decision proposed: the entitlement keys are canonical.** They are what a tenant buys and what
RLS enforces on 34 tables. The 10 are a **navigation grouping** layered on top — presentation,
not data.

| Navigation group (what HR sees) | Entitlement keys inside it (what a tenant buys) |
|---|---|
| **People** | `directory` (core) + `onboarding` + `offboarding` |
| **Time** | `attendance` + `work_calendar` (core) |
| **Leave** | `leave` |
| **Payroll** | `payroll` |
| **Claims & Benefits** | `expenses` + `insurance` |
| **Work** | `tasks` |
| **Policies** | `policy_center` (core) |
| **Connect** | `chat` + `connect` |
| **Settings** | — (core, never sellable) |
| **Performance** | — *(key does not exist yet)* |

Two consequences worth stating:

1. **A navigation group can contain both core and sellable keys.** "Time" is the case: the
   holiday calendar is core (every module needs to know what a working day is) while punch
   capture is sellable. The nav must never gate a whole group on one key.
2. **Shared substrate is never a sellable module.** This has been got wrong twice already —
   `policy_center` (holds the statutory settings payroll reads) and `work_calendar` (holds
   holidays) were both once sellable and are now core. The test: *if turning it off makes another
   module silently **wrong** rather than merely **absent**, it is core.*

### 2.1 A live defect this reconciliation exposes ✅

`src/modules.ts` knows **12** module keys and **2** core modules. The database has **13** and
**3**. The frontend has never been told `work_calendar` exists.

Concretely, all verified live:

- Tenant **`QA Attendance Only` (`11111111…`)** has `leave = false`, `attendance = true`,
  2 employees, and **1 holiday row in `holidays`** ✅
- `src/modules.ts` maps `/hr/holidays` → `leave` ✅
- Therefore `RequireModule` redirects that tenant away from the holiday screen. **An
  attendance-only tenant cannot manage the holiday calendar their own attendance derivation
  depends on.**

That is the flagship "modules work independently" promise failing inside the exact fixture built
to test it. The fix is small: remap `/hr/holidays` → `work_calendar`, and add `work_calendar` to
both `MODULE_KEYS` and `CORE_MODULES`.

Also verified: `work_calendar` has **no `tenant_modules` row for 12 of the 15 tenants** ✅.
Harmless today because `tenant_has_module()` short-circuits on `is_core` — but the frontend's
`hasModule()` reads the `tenant_modules` set plus its own `CORE_MODULES` list, so the first route
gated on `work_calendar` will fail closed for 12 tenants until both are fixed.

---

## 3. The end-to-end employee lifecycle

The lifecycle is what makes ten modules feel like one product. Today it is implicit — each module
owns a stage and nothing owns the arc.

> Market note: **HROne makes the lifecycle a named module** ("Workforce — hire to retire"), while
> **factoHR treats it as a narrative** spread across product pages. HROne's model is the better
> one for us: it gives the employee record a single status timeline instead of scattered forms.

| # | Stage | Owning module | State today |
|---|---|---|---|
| 1 | **Hire** (offer, candidate) | — *out of scope* | Deliberately not built — the sister ATS product owns this |
| 2 | **Create** (employee record + login) | `onboarding` | ❌ **BROKEN** — §6.3 |
| 3 | **Onboard** (documents, checklist, assets) | `onboarding` | Partial. `employee_onboarding` exists; **no onboarding templates** — offboarding has `exit_clearance_templates`, onboarding has no equivalent |
| 4 | **Place** (org unit, grade, manager, shift, location) | `directory` (core) | ✅ Rebuilt and solid |
| 5 | **Work — daily** (punch, breaks) | `attendance` | ✅ Rebuilt |
| 6 | **Work — occasional** (leave, corrections, expenses, tasks) | `leave`, `attendance`, `expenses`, `tasks` | Present; leave not rebuilt |
| 7 | **Be paid** | `payroll` | Not started, by decision |
| 8 | **Grow** (goals, appraisal, promotion) | — | ❌ **Does not exist.** The largest whole-module gap |
| 9 | **Change** (transfer, promotion, grade change) | — | ❌ **Not modelled as events.** `manager_id` and grade are edited in place, so history is lost |
| 10 | **Exit** (resignation, clearance, F&F) | `offboarding` | Present, untested. F&F settlement needs payroll |

### 3.1 The two gaps in the arc that matter most

**Stage 9 — lifecycle events — is a hard payroll prerequisite, not a nice-to-have.** A mid-year
salary or grade change has nothing to attach itself to today. When payroll is built, *"what was
their grade in March?"* must be answerable or arrears and disputes cannot be computed. It is
Phase 5 in the existing plan; it needs to move **before** payroll, not merely earlier than it.

**Stage 2 is broken, so the lifecycle currently has no entrance.** See §6.3. An end-to-end
lifecycle FRD that does not open with this would be decorative.

---

## 4. How modules compose — the contract layer

This is the FRD's core mechanism and the part most worth fixing before more modules are built.

```text
        ┌──────────────────────────────────────────────────────────┐
        │  CORE  (never sellable, always on)                        │
        │  directory · work_calendar · policy_center · tenancy/RLS  │
        └───────────────┬──────────────────────────────────────────┘
                        │  serves facts to every module
        ┌───────────────┴──────────────────────────────────────────┐
        │                                                          │
   ┌────▼─────┐  ┌──────────┐  ┌────────┐  ┌──────────┐  ┌─────────▼─┐
   │attendance│  │  leave   │  │ tasks  │  │ expenses │  │  payroll  │
   └────┬─────┘  └────┬─────┘  └────────┘  └────┬─────┘  └─────▲─────┘
        │             │                         │              │
        └─────────────┴─────────────────────────┴──────────────┘
                  via CONTRACTS, never direct table reads
```

### 4.1 The contracts that exist

| Contract | Direction | Rule it enforces | Live status |
|---|---|---|---|
| `work_calendar_holiday(tenant, employee, date)` | core → everyone | *"Is this a working day for **this person**?"* Resolves **shift calendar → employee calendar → tenant default**, in that order | ✅ Correct. **Bypassed by leave, payroll and all 10 frontend call sites** — §6.1 |
| `work_calendar_working_days(tenant, employee, from, to)` | core → payroll | Per-employee expected working days, honouring effective-dated shift changes | ✅ Correct, and used by `payroll_period_input` |
| `payroll_period_input(tenant, start, end)` | attendance + leave → payroll | **Facts, not policy.** Hours and counts cross; rates and thresholds do not | ✅ Exists. ⚠️ Internally inconsistent — §6.1 |

### 4.2 The two rules that must not erode

**Rule 1 — facts, not policy.** Overtime *hours* and late-mark *counts* cross the seam; amounts,
thresholds and rates do not. Otherwise a tenant feeding us their own attendance CSV would have to
reproduce our pay rules just to fill in the columns.

> Market validation: factoHR's **"Submit Attendance"** screen is exactly this contract — a named,
> savable artifact freezing full days / half days / week-offs / leaves / holidays / late counts /
> LOP for a period, which payroll then reads. Two ideas worth taking: (a) make the handoff an
> **explicit, reviewable, saved artifact** rather than a live query, and (b) copy factoHR's
> documented **manual-upload fallback** for customers not using their attendance capture — which
> is precisely our CSV-import story, and proves the pattern sells.

**Rule 2 — unknown is never zero.** The `hasModule` preflight stays *in front of* the contract
function, because a query cannot distinguish "module disabled" from "no data" and those need
different messages. `RunPayroll.tsx:169` does this correctly today ✅.

### 4.3 The contracts that still need to exist

| Needed contract | Between | Why |
|---|---|---|
| **Approval-chain engine** | everyone → everyone | Leave, expenses, corrections, tasks and later appraisals each re-implement approval today. §7 |
| **Lifecycle events** (`employee_events`) | directory → payroll + everyone | Effective-dated transfer / promotion / grade change. Payroll cannot compute arrears without it |
| **Period-summary import** | external system → payroll | The "use your own attendance, our payroll" path. Its columns are already shaped by `payroll_period_input` |

---

## 5. What "rebuild" means, module by module

Organisation and Attendance are done. This section is the FRD for the rest — what each remaining
module must look like once it is rebuilt on the substrate above.

### 5.1 Leave — the next module, and the one carrying the most defects

**Verified current shape** ✅: `leave_balances` holds mutable counters —
`total_allocated, carried_forward, used_days, pending_days, balance`. There is no ledger table.
Nine leave RPCs exist (`employee_apply_leave_request`, `approve_leave_request`,
`cancel_leave_request`, `employee_cancel_pending_leave`, `fn_accrue_monthly_leaves`, …).

**Required for "rebuilt":**

1. **Balances become a ledger, not a counter.** Immutable `leave_ledger_entries` rows (allocation,
   accrual, consumption, carry-forward, encashment, adjustment), balance derived by summing.
   *Why it is urgent, with live proof:* ✅ I re-ran the identity check today —
   **14 of 34 leave-balance rows break `total_allocated + carried_forward − used_days = balance`.
   That is 41% of every balance row in the database.** (The QA run reported 12; it has grown
   since.) The counter has **already** desynchronised, and nothing in the schema can detect it.
   A ledger makes that arithmetically impossible, and answers *"why do I have 3.5 days?"* for
   free.
2. **Every non-working-day question goes through `work_calendar_holiday()`.** §6.1.
3. **The inert policy flags become enforced, or are removed.** `probation_restricted` and
   `requires_document` are configurable in the UI and read by **no enforcement path** — a setting
   that does nothing is worse than an absent one, because HR believes it is protected.
   `min_notice_days` and `max_consecutive_days` *are* enforced ✅.
4. **Approval moves onto the approval-chain engine**, off the hardcoded HR-only path.
5. **`leaves.status` gets a trigger or a state-machine RPC.** A direct UPDATE moves status today
   without moving the balance.
6. **Accrual is fixed and re-homed** — §6.2.

### 5.2 Tasks / Work — smallest rebuild, clearest boundary

Do not compete with Jira/Linear. The defensible value is the **attendance and payroll link** —
submissions gating punch-out, tasks tied to attendance lock dates.

Required: a **manager branch in RLS** (§6.4), a **submitted-state freeze** (§6.5), and moving
approval onto the approval engine. Everything else can wait.

### 5.3 Onboarding / Offboarding — make the lifecycle real

- **Unblock employee creation** (§6.3). Nothing else in this module matters until then.
- **Onboarding templates**, mirroring the `exit_clearance_templates` pattern that already exists
  for offboarding. Checklists differ by role; today there is no template concept at all.
- **A single employee timeline** — HROne's "Workforce" idea. One screen showing
  hire → confirm → transfer → promote → exit, reading from lifecycle events.

### 5.4 Lifecycle events — new, and a payroll prerequisite

`employee_events`: effective-dated rows for transfer, promotion, grade change, confirmation,
resignation. The employee record keeps its current-value columns for speed; the events table is
the history. Payroll reads the events to answer *"what was true on this date?"*.

### 5.5 Performance — the largest whole-module gap

Follow the **cycle-as-container** pattern: `appraisal_cycle` as a first-class object with
`appraisal`, `appraisal_kra`, `goal` and feedback hanging off it, so "H1 2026 review" is a thing
you open, track completion on, and close. Start minimal — cycles + goals + self-review + manager
review. Skip 360°, calibration and nine-box until a customer asks.

> Both factoHR and HROne put Performance in their **top tier only** (factoHR "Ultimate", HROne
> "Enterprise"). It is a deal-winning module, not a daily one — build it minimal, price it high.

### 5.6 Payroll — last, and why that is still right

Two independent reasons, both about de-risking rather than deferring:

1. **It needs statutory research, not engineering.** Still open: PF employer split into
   EPS 8.33% / EPF 3.67%, ECR filing, TDS actually consuming the `it_declarations` we already
   collect, LWF, gratuity accrual, mid-month structure changes and arrears, F&F settlement.
   Seeded PT rates still need CA sign-off.
2. **Its hardest dependency is the rule engine, not the tax rules.** "Every company calculates
   differently" is what a formula engine solves. Prove that engine on overtime, late marks and
   leave accrual first; payroll then reduces to *statutory research plus configuration*.

**Verified prerequisite state** ✅: `salary_structures` is still fixed columns — the component
model has not been built. Payroll is also a *function of* leave and attendance; rebuilding it on
inputs we already know are wrong (§6.1, §6.2) means doing it twice.

---

## 6. Validation — the QA run and the docs, checked against the live backend

I re-derived each QA finding from the database and the source rather than taking the report at
face value. **Seven of the nine are confirmed as written. One is materially mis-diagnosed — and
its correct diagnosis is both cheaper to fix and more architecturally important.**

### 6.1 BUG-02 — re-diagnosed. This is the most important item in the document

**The QA report says:** there are two holiday stores, `holidays` is "legacy" and empty, and the
fix is to make `holiday_calendars` canonical and repoint everything at it.

**That diagnosis is wrong, and acting on it would destroy live data.** ✅

`work_calendar_holiday()` is not a table read — it is a **three-tier resolver**. Read live from
its body:

```
shift calendar  →  employee calendar  →  tenant default (public.holidays)
```

`holidays` is **not legacy**. It is the tenant-default tier, and it is the tier actually in use:

| Tenant | employees | rows in `holidays` | rows in `holiday_calendar_days` |
|---|---|---|---|
| `QA Testing Org` (da7a0000) | 6 | **0** | **6** |
| `QA Attendance Only` (11111111) | 2 | **1** | 0 |
| `QA Attendance Payroll` (22222222) | 2 | **1** | 0 |
| `QA Full Suite` (33333333) | 2 | **1** | 0 |
| `testtest` (97da3641) | 5 | **1** | 0 |

✅ **Four of the five populated tenants use `holidays`.** Only the QA Testing Org uses calendars —
which is exactly why the bug reproduced there and looked like "the legacy table is empty".

**The real defect is that the resolver is bypassed.** Verified by scanning every function body:

| Consumer | Calls `work_calendar_holiday()` | Reads `holidays` directly |
|---|---|---|
| `attendance_derive_pass1` | ✅ | — |
| `attendance_derive_pass2` | ✅ | — |
| `work_calendar_working_days` | ✅ | — |
| `employee_apply_leave_request` | ❌ | ✅ |
| `approve_leave_request` | ❌ | ✅ |
| `payroll_period_input` | ❌ | ✅ |
| 10 frontend call sites | ❌ | ✅ |

And `payroll_period_input` **contradicts itself inside one function** ✅: its `working_days`
column goes through `work_calendar_working_days()` (resolver-aware, per-employee) while its
`holidays_in_period` column comes from an internal `count(*) FROM public.holidays`. One function,
two different truths about what a holiday is.

**So the fix is not a migration — it is a rule.** Every consumer calls the resolver; nobody
queries either table directly. That is the same composition-contract principle as
`payroll_period_input`, which makes this a **principle to enforce, not a patch to apply**:

- Add a set-returning sibling, `work_calendar_holidays(tenant, employee, from, to)`, so screens
  and RPCs that need a *range* have something to call.
- Repoint `employee_apply_leave_request`, `approve_leave_request` and the per-employee frontend
  sites at it.
- **`payroll_period_input.holidays_in_period` should be dropped, not repointed** ✅ — see §6.1.1.
- HR's holiday **write** path (`hr/LeaveManagement.tsx:231/247/302`) writes to `holidays` —
  which is correct, since that is the tenant-default tier. Leave it, but move the screen out of
  the Leave module (§2.1).
- **Do not drop `holidays`.** It holds live data for four tenants.

### 6.1.1 Two design questions this fix must answer first

Both were discovered while specifying the fix. Neither has an obvious answer, and Phase 2a
(§7) will stall on them if they are not settled up front.

**(a) `holidays_in_period` has no consumer, and a period-level holiday count is meaningless.** ✅
Verified: `grep -rn "holidays_in_period\|holiday_count" src/ functions/` returns **nothing**.
Nobody reads it. And it *cannot* be made correct — holidays resolve **per employee** (shift
calendar → employee calendar → tenant default), so a single scalar for the whole period is
ill-defined the moment two employees are on different calendars. The per-employee holiday effect
is already correctly folded into `working_days`.
**Recommendation: drop the column.** It is a wrong answer to a question that should not be asked.

**(b) Tenant-wide holiday screens have no employee in scope.** Of the ten frontend call sites,
several are company-wide views with no single employee: `hr/Calendar.tsx:62`,
`hr/LeaveManagement.tsx:70/215` (the HR holiday list), `hr/Attendance.tsx:618` (overtime
working-days). `work_calendar_holiday()` is inherently per-employee, so a per-employee resolver
cannot serve them. *"Show the company holiday list"* has no well-defined answer once employees
sit on different calendars.
**Recommendation: these screens show the tenant-default tier (`holidays`) and say so in the UI** —
labelled "Company default calendar", with a note where a shift or employee overrides it. That is
honest, matches what HR actually edits on that screen, and avoids inventing a union across
calendars that would be true for nobody. **This is a UX call as much as a technical one — flagging
it rather than deciding it alone.**

*Severity confirmed as Blocker.* It charges employees a leave day for a company holiday, and it
will corrupt payroll the moment payroll exists.

### 6.2 BUG-01 — confirmed, and the security half is worse than the balance half

✅ Verified live: `fn_accrue_monthly_leaves` has ACL
`project_admin=X/project_admin ; authenticated=X/project_admin` — **every authenticated employee
can execute it**. It is SECURITY DEFINER and loops over `leave_balances` for **every tenant in
the database**.

Blast radius is limited by the `last_accrual_date < date_trunc('month', CURRENT_DATE)` guard,
which makes it idempotent within a month, so it cannot be looped to inflate a balance. But an
ordinary employee of one tenant can fire a cross-tenant balance mutation, and that guard is the
only thing standing between the grant and unbounded self-service leave.

Three fixes, in order:

1. **Revoke `authenticated` EXECUTE.** One line, no downside.
2. **Make it allocate, not inflate.** It adds to `balance` without touching `total_allocated`,
   breaking the ledger identity on its first run. The ledger rebuild (§5.1) makes this class of
   bug impossible.
3. **Find the `cron.job` row.** It fires monthly and is registered in **no migration** — created
   out of band, not in version control. `project_admin` cannot read schema `cron` (403), so this
   needs database-owner access. *Until it is found, it fires again on 2026-10-01.*

📄 **Doc correction:** `doc/qa/00-README.md` §1 and the attendance handoff both say accrual "may
not be scheduled" and that "balances never grow on their own". It **is** scheduled and they
**do**. Both docs need fixing.

### 6.3 BUG-06 — confirmed. The employee lifecycle has no entrance

✅ Verified live: `check_rate_limit` ACL is `project_admin=X/project_admin` — **`authenticated`
has no EXECUTE**. Two migrations on 2026-08-17 revoked it and neither re-granted it.

So `create-employee-user` receives a *permission* error, collapses it into a 429, and HR reads
**"Rate limit exceeded"** on their very first attempt. **HR has not been able to create an
employee since 2026-08-17.**

Note that the same migration pair produced both this (under-granted) and §6.2 (over-granted).
**The whole re-grant list needs an audit, not just this one line.**

Two fixes are needed, and the second is the harder one:

1. `GRANT EXECUTE ON FUNCTION public.check_rate_limit(uuid, uuid, text, integer, interval) TO authenticated;`
   — and stop reporting a permission failure as a rate limit.
2. **The wizard still needs a 6-digit OTP emailed to the new employee, and SMTP is not
   configured.** The code is not stored anywhere HR can read. Even with the grant fixed, creation
   stays blocked. Configure SMTP, or show the code to HR on screen — **this is a decision for
   you, §8.**

### 6.4 BUG-04 — confirmed at the policy level, not just by testing

✅ The live policies on `tasks`:

```
tasks_hr_all        PERMISSIVE  ALL     is_hr()
tasks_self_read     PERMISSIVE  SELECT  employee owns the row
tasks_self_update   PERMISSIVE  UPDATE  employee owns the row
+ 3 RESTRICTIVE fences (tenant, active-tenant, module)
```

**There is no manager branch.** A manager's Team Tasks tab runs a valid query, RLS matches zero
rows, and the tab renders empty forever with no error. The policy is too *tight*, not too loose —
nothing leaks, and peer privacy passes.

### 6.5 BUG-03 — confirmed, and structurally rather than incidentally

✅ `tasks_self_update` is `FOR UPDATE` with **no status predicate**, and RLS cannot restrict
columns. So an employee can rewrite `title` / `description` / `due_date` on a task sitting at
`submitted`, and the reviewer approves something other than what was submitted. The submission's
own notes and attachment are safe in `task_submissions`; the task text is not.

This is the *same class* as the attendance hole already fixed in August ("employees could write
any column on their own attendance row"). The fix is the same shape: **revoke the direct write
surface and route the write through an RPC that checks state.**

### 6.6 BUG-07, BUG-08, BUG-09 — all three confirmed in source ✅

| Bug | Confirmed at | What it is |
|---|---|---|
| **BUG-07** manager name blank | `EmployeeList.tsx:38`, `EmployeeDetail.tsx:749`, `Directory.tsx:67`, `hooks/useEmployee.ts:23` | **Root cause corrected 2026-09-02 — see §6.6.1.** PostgREST resolves the self-FK in the **reverse** direction: the embed returns an **array of the employee's direct reports**, not their manager |
| **BUG-08** no shift can be edited | `ShiftManagement.tsx:95-98 → :114 → :559` | `formatTimeValue()` returns the display placeholder `"--:--"` for null, that seeds the edit form, and `"--:--"` is truthy so the `|| null` guard never fires. Postgres rejects it (22007). Create works because it seeds `""`; edit never does |
| **BUG-09** invented absences | `src/hr/Attendance.tsx:~488` | A synthetic row is built for every employee with no record, hard-coding `status: "absent"` |

#### 6.6.1 BUG-07's root cause was wrong in the QA report — and in my first pass ✅

The QA report says *"the list request returns `manager_id: null` for all six"*, and my first read
of this document repeated it after inspecting the code. **Both were wrong.** Proven by running the
old and new queries side by side as `hr-qa` (`scratch/qa-employeelist-fix-check.mjs`):

```
OLD  select("*, manager:employees!manager_id(full_name)")
       6 rows, 4 with a NON-NULL manager_id, 0 manager names resolved
       QA Manager    manager = [ 4 objects ]   <- these are her DIRECT REPORTS
       everyone else manager = [ ]
NEW  select("*") + local lookup
       6 rows, 4 with a non-null manager_id, 4 names resolved
```

**`manager_id` was never nulled.** PostgREST resolves the self-referencing FK on `employees` in
the **reverse** direction, so the embed returns an **array of the employee's direct reports**.
`.full_name` on an array is `undefined`, so `|| null` fired for every row and the column rendered
`"—"`. `QA Manager`'s array holding exactly her four reports is the proof.

The `!employees_manager_id_fkey` constraint hint does **not** fix it — PostgREST answers
*"Could not find a relationship between 'employees' and 'employees' in the schema cache"*. So the
embed cannot be repaired by syntax and must be replaced by explicit resolution.

**The same broken embed existed in four files**, which is why both halves of BUG-07 (the Manager
column *and* the blank "Reports To") appeared: `EmployeeList.tsx`, `EmployeeDetail.tsx`,
`Directory.tsx`, `hooks/useEmployee.ts`. All four are fixed — list screens resolve the name from
the rows they already fetched (no extra query), single-record screens read `full_name` from
`employee_directory_public`.

**The lesson worth keeping:** a self-referencing PostgREST embed silently resolves the wrong way
and returns a plausible-looking value. It produced no error at any layer. Do not use one — resolve
the parent explicitly.

**BUG-09 is the one to read twice.** It is not cosmetic — it is the *"unknown is never zero"* rule
(§1.3) being broken on the default landing screen. HR's Daily tab defaults to today, so every
morning HR sees a full roster of false absences before anyone has punched. The QA follow-up probes
proved the fabrication ignores, in order: whether the date has even happened (four weeks in the
future still shows all six Absent), the holiday calendar, the shift's working days, and the
employee's relieving date. On one Sunday where five real `weekly_off` rows existed, those five
rendered correctly and the sixth employee — the one with no row — was fabricated as Absent. That
is a controlled proof on a single screen.

### 6.7 BUG-05 — confirmed, and it points at a rule

Attendance rows written by `approve_leave_request` carry `leave_id = NULL` and
`derivation_source = NULL`, while rows written by derivation carry both. Two writers, two shapes.

Minor on its own, but the general rule is worth adopting: **a derived table gets exactly one
writer.** Leave approval should record the leave and let derivation produce the attendance row,
rather than writing the row itself.

### 6.8 The developer docs — audited

**`devloper_doc/attendanceModule/` — accurate** ✅. I verified §2's column lists against
`information_schema`: every column it names exists on `attendance` and `attendance_events`.
Notably §3 describes the holiday model **correctly** — *"`holidays`: the tenant's default holiday
list, still the primary source"*, and *"precedence: shift → employee → `holidays`"*. **The
developer doc was right and the QA report was wrong.** The docs earned their keep here.

**`devloper_doc/organizationModule/` — already audited** in the 2026-08-31 session; four errors
found and fixed. The most valuable one is a pattern worth applying everywhere: a guardrail
described as "enforced in the database" that was actually a `window.confirm()`. **Docs must say
*where* a rule is enforced** — database, RPC, or UI-only — because only the first two survive a
direct API call.

**One gap in that audit, now closed** ✅. Both module sets' `05-frontend-and-api-integration.md`
files were edited on 2026-08-31 at 22:52 and 22:54 — *nine hours after* the audit session's
handoff. They were therefore never audited, and they cover exactly the layer BUG-07 and BUG-09
live in. I checked them specifically:

- `organizationModule/05` does **not** mention the broken `manager:employees!manager_id` embed
  anywhere — so it is not teaching BUG-07. It covers components, the RLS silent-failure trap,
  materialised-path and effective-dated queries, write guardrails, and tree rendering.
- `attendanceModule/05` does **not** describe the synthetic-absent pattern — so it is not
  teaching BUG-09. Its one adjacent line (`:99`) is about derivation, and is correct.

**Both are clean.** Worth adding the fix to `organizationModule/05` when BUG-07 is fixed: reading
a manager's name should go through `employee_directory_public`, and the doc should say so.

**`devloper_doc/leaveModule/` — not yet audited against the backend.** Given §6.1 and §6.2, treat
its claims about holidays and accrual as suspect until checked.

**One repo-wide correction:** the older note that *"`RunPayroll.tsx` has NOT been wired to
`work_calendar_working_days`"* is **out of date** ✅ — `RunPayroll.tsx:186` calls
`payroll_period_input` and uses the per-employee `working_days` from it, keeping the old
Sunday-hardcoded `getWorkingDays()` only as a fallback (`:344`). The remaining exposure is
narrower than the note claims: the fallback and the holiday deduction still read `holidays`
directly at `:193`.

### 6.9 Triage — what to fix, in what order

| Order | Item | Cost | Why here |
|---|---|---|---|
| 1 | **BUG-06** grant + honest error | 1 line | Removes the hard block on employee creation. ⚠️ Does **not** on its own re-enable OM-12/13/15 — the OTP wall (§6.3 fix 2) still stands |
| 2 | **BUG-08** `"--:--"` → `null` | 1 line | Unblocks all shift editing and 3 QA cases |
| 3 | **BUG-01** revoke `authenticated` EXECUTE | 1 line | Cross-tenant mutation reachable by any employee |
| 4 | **BUG-09** stop fabricating Absent | small | Breaks a core rule on the default screen |
| 5 | **BUG-07** read the directory view | small | Manager name renders nowhere |
| 6 | **BUG-02** route everything through the resolver | medium | The architectural one. Blocks correct payroll |
| 7 | **§2.1** teach `modules.ts` about `work_calendar` | small | The independence promise is broken today |
| 8 | **BUG-03 + BUG-04** task RLS | medium | Do together, with the tasks rebuild |
| 9 | **BUG-01** accrual arithmetic + the `cron.job` row | medium | Needs DB-owner access. **Fires again 2026-10-01** |
| 10 | **BUG-05** single writer for derived rows | small | Do with the leave rebuild |

Items 1–5 are roughly a day's work. **They clear SH-02 and SH-03 (BUG-08); they do NOT clear
OM-12, OM-13 or OM-15** — those also need the OTP decision, which is V1 item 2 and not part of
this sprint. Item 6 is the one that must land before payroll.

> **Status: items 1–5 and 7 were applied on 2026-09-02.** Migration
> `20260902100000_v1-stabilisation-grants.sql` is applied to the live parent and its three
> assertions pass; the frontend fixes build green and BUG-07 is verified against the live backend.
> ⚠️ `functions/create-employee-user.ts` is edited but **NOT yet deployed** — the honest-error
> half of BUG-06 takes effect only after the edge function is redeployed.

---

## 7. The build order, and what changed

The governing plan in `doc/architecture/README.md` was: 0a baseline RLS → 0b module registry →
1 Organisation → 2 Leave + approval engine → 3 Attendance → 4 Performance → 5 Lifecycle events →
6 Custom fields → 7 the long tail → **N Payroll**.

**Phases 0a, 0b and 1 are done. Phase 3 (Attendance) was built early, out of order.** So Leave is
next by the existing plan — and the QA run's worst defects are all in Leave. That converges, so
the plan does not need rewriting. It needs three deltas.

### Delta 1 — insert a stabilisation sprint before anything else

Five of the ten triage items in §6.9 are one-line or near-one-line fixes, and between them they
unblock the employee lifecycle, all shift editing, and roughly nine blocked QA cases. Doing them
first means the next module is built and tested on a system that works.

### Delta 2 — Work Calendar consumption comes *before* the Leave rebuild

BUG-02 (§6.1) must be fixed **before** Leave is rebuilt, not during. If the leave rebuild starts
while `employee_apply_leave_request` still reads `holidays` directly, the bypass gets rewritten
into the new code rather than removed from the old.

### Delta 3 — Lifecycle events move up, from Phase 5 to Phase 3

Effective-dated transfer/promotion/grade events are a hard payroll prerequisite (§3.1) and they
are small. Building them before Performance means the Performance module can attach appraisal
outcomes to a real promotion event instead of inventing its own.

### The resulting order

| # | Phase | Contains | Exit criterion |
|---|---|---|---|
| **S** | **Stabilisation** *(days)* | §6.9 items 1–5 and 7 | The nine QA cases blocked by BUG-06 / BUG-08 all run |
| **2a** | **Work Calendar consumption** *(small)* | Settle the two design questions in §6.1.1 first. Then: `work_calendar_holidays()` range function; repoint the leave RPCs and per-employee frontend sites; **drop** `payroll_period_input.holidays_in_period`; move `/hr/holidays` to `work_calendar` | No consumer queries `holidays` or `holiday_calendar_days` directly. A holiday inside a leave range is not charged, in **both** tenant shapes |
| **2b** | **Leave rebuild + approval-chain engine** *(the big one)* | Ledger; enforced policy flags; state-machine RPC; accrual fixed; approval engine with Leave as its first consumer | `allocated + carried − used = balance` becomes derivable, not assertable. A tenant can configure a 2-level approval chain without a code change |
| **2c** | **Tasks minimal** *(small, rides on 2b)* | Manager RLS branch; submitted-state freeze; approval via the engine | Team Tasks renders for a manager; a submitted task cannot be edited |
| **3** | **Lifecycle events** | `employee_events`, effective-dated; employee timeline screen | *"What was their grade in March?"* is answerable |
| **4** | **Performance** *(greenfield)* | Cycles + goals + self-review + manager review | The configurability substrate is proven on something new, not legacy |
| **5** | **Custom fields + rule-engine hardening** | JSONB custom fields; the AST rule engine proven on overtime, late marks and accrual | A tenant changes an accrual rule without a migration |
| **6** | The long tail | Timesheets, training, travel, assets, doc compliance, grievance | — |
| **N** | **Payroll** | Component model; statutory research; F&F | Dual-run gate: 3 months through both engines, **zero net-pay variance** |

### Two cross-cutting tracks that do not fit the phase list

**Employee portal, mobile-first.** Geofenced punch with a selfie is inherently a phone activity.
If the employee portal is not mobile-first, the flagship feature is awkward to use. This is its
own project and it can run in parallel with any phase. *It should probably jump the queue if your
first customers are deskless.*

**Navigation.** A persistent module rail beats a 9-dot launcher grid at ~10 modules — a grid adds
a click and hides what exists. But do the rail **after** §2's taxonomy is settled, or it gets
built twice. The cheap win available immediately is a **command palette (Ctrl+K)**: it sits on
top of existing routes with no restructuring, and for HR staff doing the same six things daily it
is transformative.

---

## 8. Decisions I need from you

Everything above is a recommendation I can defend. These seven are genuinely yours.

| # | Decision | Why it is yours, and my recommendation |
|---|---|---|
| **1** | **The OTP wall on employee creation.** Even with the BUG-06 grant fixed, the wizard needs a 6-digit code emailed to the new employee, and SMTP is not configured. | Product call, not technical. **My recommendation: show the code to HR on screen** and keep email as an optional channel. HR is already trusted to create the account; making them wait on an email they cannot see is friction with no security gain. Configuring SMTP is the alternative and is also fine — but it must be *decided*, because the lifecycle has no entrance until it is |
| **2** | **Is genuine per-module independence a pricing story, or only an architectural one?** | The research says factoHR and HROne both market modularity and sell additive tiers — nobody offers attendance-without-payroll. **We can.** If that becomes a pricing story it changes the module boundaries we defend and what the CSV import/export seam is worth building. If it is only architectural, the seam can wait |
| **3** | **Does Performance come before or after Lifecycle Events?** | I moved Lifecycle Events ahead (§7, Delta 3) because it is a payroll prerequisite. But Performance is the module every buyer asks about, and both competitors gate it behind their top tier. **If you are selling now, Performance first is defensible** |
| **4** | **The leave ledger — rebuild now or after payroll?** | I recommend **now**. It only gets harder as real balances accumulate, and the counter has already desynchronised on 12 live rows. But it is the largest single piece of work outside payroll, and deferring it is a legitimate choice if launch timing matters more |
| **5** | **What happens to the 10 empty tenants?** | 15 tenants exist and only 5 have employees ✅. The rest are test/demo residue. They inflate every cross-tenant query and every "affects all tenants" risk assessment. Delete, or mark them non-production? |
| **6** | **The `cron.job` row behind accrual needs database-owner access** (§6.2) — `project_admin` gets 403 on schema `cron`. | Only you can get that access or open it with InsForge. **It fires again on 2026-10-01**, so this has a deadline |
| **7** | **Confirm the leaked production admin key was actually rotated.** | `CLAUDE.md` says the key served at `/test-admin.html` is "still valid and unrotated"; a later session memory says it was rotated. **The two disagree and I did not test it** — testing a live admin key is not something I should do unprompted. Please confirm, because everything else in this document assumes the backend is not publicly writable |

### Verified good news worth recording

Two items that older docs list as open are now **closed**, confirmed live today:

- **Every table in `public` has RLS enabled** ✅. `CLAUDE.md`'s "4 tables still have RLS off"
  (`tenant_settings`, `attendance_audit_logs`, `test_log`, `test_mcp_sync`) is stale — the first
  two now have RLS and the two junk tables have been dropped entirely. 275 policies, 84 of them
  RESTRICTIVE.
- **`RunPayroll` is wired to the composition contract** ✅ (§6.8) — the old note saying it was not
  is out of date.

---

## 9. Competitor research — six products, and what it changes

Researched 2026-09-02 across **factoHR**, **HROne**, **Zoho People**, **Keka**, **Darwinbox** and
**BambooHR**. Frappe HR was already benchmarked in `doc/module_architecture.md` and is not
repeated here.

> **Sourcing caveat, stated honestly.** factoHR, HROne, Zoho, Darwinbox and BambooHR pages were
> read directly. **Keka's site and help centre blocked every fetch**, so Keka's details rest on
> search-engine synthesis and third-party reviews — treat them as indicative, not confirmed.
> Rippling also blocked fetching, so BambooHR stands in as the non-India contrast.
>
> Full reports: `doc/competitor_research_india_2026-09-02.md` (factoHR, HROne) and
> `doc/competitor_research_global_2026-09-02.md` (Zoho People, Keka, Darwinbox, BambooHR).

### 9.1 The finding that matters most: how vendors decide what becomes its own product

This is the question you are effectively asking about our own module boundaries, and the market
gives a clear answer with a clear split.

| Vendor | Is Payroll bundled? | Can you buy attendance without payroll? |
|---|---|---|
| **factoHR** | Bundled from the cheapest paid tier ("Core") | **No** |
| **HROne** | Bundled from "Basic" | **No** |
| **Keka** | In **every** tier, including entry | **No** |
| **Darwinbox** | Core HR + Payroll is the typical floor | Not stated; quote-only pricing |
| **BambooHR** | **Add-on** on any tier, never bundled | **Yes** |
| **Zoho** | A **separate product** (Zoho Payroll) | **Yes** |

**What predicts the split:** regulatory weight. Payroll's compliance surface differs enough from
HR that Zoho isolated it entirely. The India-market vendors do the opposite and treat statutory
payroll as the suite's anchor, because Indian statutory compliance *is* the reason a company buys
an HRMS at all.

**What every vendor agrees on:** Performance, Recruitment and LMS are gated first — top tier or
paid add-on, in all six. That is a strong sequencing signal for §5.5: build Performance minimal,
price it high, and do not treat it as a daily-use module.

### 9.2 Direct validation of decisions we already made

Three of our existing architectural choices show up in the market as the mature pattern. That is
reassuring rather than novel, and worth recording so they are not re-litigated:

| Our decision | Market evidence |
|---|---|
| **`payroll_period_input` as a named contract** (§4.1) | **Zoho's People→Payroll integration is exactly this** — an explicit, named, toggleable **"Allow LOP Sync from Zoho People"** that pushes Loss-of-Pay days into a Payroll pay schedule, one-directionally. Payroll never reads People's tables. Confirmed on Zoho's own KB page |
| **A named, savable attendance→payroll artifact** | factoHR's **"Submit Attendance"** screen prepares full days / half days / week-offs / leaves / holidays / late counts / LOP for a period and freezes it; salary is then calculated from it |
| **CSV import for tenants using their own attendance** | factoHR documents the same fallback: if biometric/mobile attendance is not integrated, the time-keeper uploads monthly Present/LOP counts. Ours is not a workaround — it is how the category handles it |

### 9.3 Ideas worth taking, ranked by value to us

1. **Zoho's "LOP Sync" as a UI object, not just an RPC.** Our contract exists in the database but
   is invisible to HR. Making it a *screen* — "here is what Payroll will read for September;
   review and confirm" — turns a correctness mechanism into a trust feature, and gives us
   factoHR's "Submit Attendance" checkpoint at the same time. **This is the highest-value idea in
   the research.**
2. **Keka's system-calculated LOP with a manual override that requires a comment.** The clean
   answer for when attendance and payroll disagree. It preserves "unknown is never zero" — the
   override is a recorded human decision, not a silent default.
3. **HROne's pre-payroll exception list** — and **we have already half-built it** ✅.
   `payroll_period_input` returns a `has_attendance_anomaly` column, computed as
   *"counted days (present + absent + half + paid leave + unpaid leave) exceeds working_days"*.
   **Nothing in `src/` or `functions/` reads it.** So the detector exists and the screen does not.
   Surfacing it in the payroll run is close to free, and it is exactly the safety net HROne markets
   as a headline feature.
4. **Keka's conditional approval builder** — triggers on department / job title / location /
   salary range / job type with is/is-not operators, generalised across modules rather than
   reimplemented per module. This is a concrete spec for our approval-chain engine (§4.3), and it
   confirms the arbitrary-graph design we already rejected was rightly rejected: conditions on a
   linear chain, not a free-form graph.
5. **Zoho's four-level entity hierarchy** — Legal Entity → Business Unit → Division → Department.
   Our `org_units` + `org_unit_types` can already express this; what we lack is the **legal
   entity** level, which payroll will need for multi-entity tenants (separate PF/PT
   registrations). Worth confirming before payroll starts.
6. **HROne's "Workforce" module owning the lifecycle** (§3). One status timeline per employee
   beats scattered per-event forms.
7. **factoHR's "Performance-Linked Payroll"** — an explicitly named bridge from review scores to
   incentive calculation. Most vendors leave this implicit. If we build Performance before
   Payroll, designing this seam early is nearly free.
8. **Published biometric compatibility lists.** factoHR and HROne both name their supported
   devices (ESSL, ZKTeco, Suprema, Matrix, BioMax, Secureye) on marketing pages as a trust
   signal. Our device ingest seam already supports this shape — once a second device type is
   proven, publish the list.
9. **HROne's WhatsApp punch-in.** A genuinely distinctive channel for deskless and field staff.
   Our device seam means this is an adapter, not an architecture change — which is exactly the
   payoff of the "don't design around hardware" decision.
10. **BambooHR's bundle discount for combining specific add-ons** (Payroll + Benefits, 15%).
    A pricing lever that rewards cross-module adoption directly rather than through tier upsells —
    relevant if decision **#2** in §8 goes the "independence is a pricing story" way.

### 9.4 Where we are genuinely ahead, and where we are behind

**Ahead:** geofenced punch with selfie capture as the *primary* channel rather than a biometric
fallback; true database-enforced per-module entitlement; the two-layer attendance model
(append-only events + derived day) which none of these vendors describe publicly.

**Behind:** no Performance module (all six have one); no formula/rule engine yet (factoHR markets
a "Flexible Rule Engine" for both payroll and attendance policy as a headline feature); no
multi-entity legal hierarchy; no published integration/API story; no roster grid.

**The roster grid deserves a specific note.** Every one of the six has shift scheduling, and
several sell it as a paid add-on (Keka's "Scheduler", Zoho's separate "Shifts" product). We have
shift *assignment* but no visual weekly roster. In shift-based businesses — retail, hospitality,
clinics, manufacturing — this is the screen the buyer evaluates first, and it is the one place
where a custom-built drag-to-assign interaction genuinely beats a generic table.

---

## 10. How to use this document in the next session

Open with §0 (what is built) and §8 (the seven decisions). Those two sections carry the state.

- If the decision is **"what do we fix now"** → §6.9, the ten-item triage.
- If the decision is **"what do we build next"** → §7, the phase table.
- If the decision is **"how should modules relate"** → §2 and §4, the taxonomy and the contracts.
- If the decision is **"what does the market expect"** → §9.

**Companion documents:**

- `doc/hrms_target_state_frd_2026-09-02.md` — **the target state each module is built toward**,
  written for future agents: the per-module contract table (owns / needs / publishes / when OFF /
  when a dependency is OFF), the seam inventory, and the tenant-provisioning + superadmin audit.
  Its §6 adds decisions **8–12** to the seven in §8 here.
- `doc/competitor_research_india_2026-09-02.md` and `..._global_...` — the raw vendor research.

**Three things in this document that older repo docs contradict**, all verified live today, so
trust this file over them:

1. `holidays` is **not** a dead legacy table — it is the tenant-default tier of a working
   resolver, and four of five populated tenants depend on it (§6.1).
2. Monthly leave accrual **is** scheduled and balances **do** grow on their own (§6.2).
3. Every table in `public` now has RLS enabled, and `RunPayroll` **is** wired to the composition
   contract (§8, "verified good news").
