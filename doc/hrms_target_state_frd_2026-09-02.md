# TalentMesh HRMS — Target-State FRD

**Written:** 2026-09-02 · **Audience: future AI agents and developers.**
This describes **what the system is being built toward**, so an agent picking up any module knows
the goal without re-deriving it.

> **Three docs, three jobs — read the right one.**
>
> | Doc | Answers |
> |---|---|
> | `doc/hrms_vision_and_frd_2026-09-02.md` | **Where we are and why** — live-verified status, QA triage, open decisions |
> | `doc/architecture/` (README + 01–06) | **The phase plan** — sequencing and the reasoning behind it |
> | **this file** | **Where each module is going** — the target contract every module is built to satisfy |
>
> Where they disagree, the vision doc's live-verified (✅) facts win, then this file, then
> `architecture/`. `doc/module_architecture.md` (2026-08-13) is **superseded** by §2 of the vision
> doc on module taxonomy; its per-module gap analysis is still useful.

**Evidence marking:** ✅ = verified against live parent `rq3qmu8y` on 2026-09-02. Everything else
is design intent.

---

## 1. The shape of the system

One sentence: **a core that knows the company's shape, a set of modules that each own one
workflow, and a small number of named contracts between them.**

```text
                         ┌──────────────────────────────────────┐
   the company's shape → │  CORE — always on, never sellable    │
                         │                                      │
                         │  directory      who exists, where    │
                         │                 they sit, who they   │
                         │                 report to            │
                         │  work_calendar  what a working day   │
                         │                 is, per employee     │
                         │  policy_center  the settings other   │
                         │                 modules read         │
                         │  tenancy + RLS  who may see what     │
                         └───────────────┬──────────────────────┘
                                         │  facts, via contracts
      ┌──────────┬───────────┬───────────┼───────────┬───────────┬──────────┐
      ▼          ▼           ▼           ▼           ▼           ▼          ▼
 ┌────────┐ ┌────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ ┌────────┐
 │attend- │ │ leave  │ │  tasks  │ │expenses │ │insurance│ │ chat + │ │onboard │
 │ ance   │ │        │ │         │ │         │ │         │ │connect │ │offboard│
 └───┬────┘ └───┬────┘ └────┬────┘ └────┬────┘ └─────────┘ └────────┘ └────────┘
     │          │           │           │
     └──────────┴───────────┴───────────┴──────────────┐
                  payroll_period_input                 ▼
                  (facts, not policy)             ┌─────────┐
                                                  │ payroll │
                                                  └─────────┘
```

**Three properties this shape must always have.** Every design decision is checked against these.

1. **Turning a module off removes a capability. It never produces a wrong number.**
2. **Every module can be replaced by the customer's existing system**, because what crosses the
   boundary is facts on a documented contract, not internal state.
3. **The core is never sellable.** If turning something off makes another module silently *wrong*
   rather than merely *absent*, it belongs in the core.

---

## 2. The module contract table

**This is the spine of the FRD.** Every module — existing or new — must have all five columns
filled in. The last two are the ones that make "modules work independently" checkable instead of
aspirational, and they are the ones no existing doc has.

A new module is not designed until this row is written.

| Module | Owns (tables) | Needs from core | Publishes (contract) | When this module is OFF | When a dependency is OFF |
|---|---|---|---|---|---|
| **directory** `core` | `employees`, `org_units`, `org_unit_types`, `job_titles`, `locations`, `employment_types`, `employee_grades`, `employee_unit_assignments`, `employee_reporting_relationships`, `employee_directory_public` | — (it *is* core) | Identity, placement, reporting line. Read via `employee_directory_public`, never `employees` | **Cannot be off** | — |
| **work_calendar** `core` | `holidays`, `holiday_calendars`, `holiday_calendar_days` | `directory` (which employee), `attendance.shifts` (shift calendar tier) | `work_calendar_holiday(tenant, employee, date)`, `work_calendar_working_days(tenant, employee, from, to)` | **Cannot be off** | If `attendance` is off there are no shifts, so tier 1 is skipped and resolution falls to employee → tenant default. Still correct |
| **policy_center** `core` | `hr_policies`, `employee_policy_acknowledgements`, `tenant_settings` | `directory` | Statutory + operational settings (PF/ESI ceilings, PT state, late-mark and regularisation rules) | **Cannot be off.** Gated off, payroll and attendance fall back to hardcoded defaults with no UI to correct them — this is exactly why it was made core | — |
| **attendance** | `attendance_events`, `attendance`, `attendance_breaks`, `attendance_selfies`, `attendance_corrections`, `attendance_derivation_runs`, `attendance_devices`, `attendance_location_exceptions`, `shifts`, `employee_shifts`, `overtime_records` | `directory`, `work_calendar` | Days present/absent/half, late-mark counts, overtime hours — via `payroll_period_input` | No punch capture, no derived days. **Payroll must refuse to run**, not assume zero ✅ (`RunPayroll.tsx:169`) | If `leave` is off, derivation still reads `leaves` **deliberately ungated** — otherwise past leave days would re-derive as *absent* for a tenant who later switched Leave off. Turning off a module must never rewrite history |
| **leave** | `leaves`, `leave_types`, `leave_balances` *(→ ledger)* | `directory`, `work_calendar` | Approved leave dates + `day_fraction`; unpaid-leave days → `payroll_period_input` | No requests, no balances. Attendance still derives; a day with no punch simply has no leave reason | If `attendance` is off, leave still works standalone — it needs the calendar, not the punch log |
| **tasks** | `tasks`, `task_submissions`, `projects` | `directory` (assignee, manager chain) | Optional punch-out gate signal to attendance | No tasks. Punch-out gate must default to **open**, never blocked | If `attendance` is off, the punch-out gate is simply not applied |
| **expenses** | `expenses` | `directory`, `policy_center` | Approved reimbursement totals → payroll | No claims. Payroll runs with no reimbursement line | — |
| **insurance** | `insurance_policies` | `directory` | Nothing today | No insurance screens | — |
| **onboarding** | `employee_onboarding`, `employee_onboarding_self` | `directory` | New `employees` rows | **Employees cannot be created through the wizard** — the only path becomes direct/import. See §4 | — |
| **offboarding** | `exit_requests`, `exit_clearances`, `exit_clearance_templates` | `directory` | Relieving date → attendance stops deriving; F&F trigger → payroll | No exit workflow; `employees.status` edited directly | If `payroll` is off, F&F is manual |
| **payroll** | `salary_structures`, `payroll_runs`, `payslips`, `it_declarations`, `it_declaration_windows` | `directory`, `work_calendar`, `policy_center` | Payslips (terminal — publishes to nobody) | No payroll. Every other module unaffected | **Refuses to run** without `attendance`, with a message naming the reason ✅. Must never treat missing input as zero |
| **chat** | `chat_channels`, `chat_messages`, `chat_channel_members` | `directory` | Nothing | No chat | — |
| **connect** | `posts`, `post_reactions` | `directory` | Nothing | No feed | — |
| **performance** *(not built)* | `appraisal_cycles`, `appraisals`, `appraisal_kras`, `goals`, feedback | `directory` (grade, manager) | Review outcome → promotion event; optionally → payroll incentive | No appraisals | If lifecycle events are absent, a promotion outcome has nothing to attach to |

### 2.1 The two rules the last two columns encode

**Rule A — a module that is off is silent, never wrong.** The failure mode this prevents is
already documented: attendance disabled once made payroll read an empty set and pay every employee
₹0. The correct behaviour is a **preflight that blocks with a named reason**, in front of the
contract, because a query cannot distinguish "module disabled" from "no data".

**Rule B — turning a module off must not rewrite history.** Attendance derivation reads `leaves`
without a leave-module gate, deliberately. Gating it would make past leave days re-derive as
*absent* for a tenant who later switched Leave off. **Entitlement controls access to a module's
surface; it must not retroactively change facts already recorded.**

---

## 3. The seam inventory

Every cross-module read goes through one of these. **A direct table read across a module boundary
is a defect, not a shortcut** — that rule is the whole reason the holiday bug exists (vision doc
§6.1).

### 3.1 Contracts that exist

```
work_calendar_holiday(tenant uuid, employee uuid, date date)
  → (is_holiday bool, is_half_day bool, holiday_name text, source text)
  Resolves: shift calendar → employee calendar → tenant default (`holidays`).
  `source` names which tier answered — always surface it in debugging.
```
```
work_calendar_working_days(tenant uuid, employee uuid, from date, to date)
  → integer
  PER EMPLOYEE. Resolves the effective-dated `employee_shifts` row per day, so a mid-month
  roster change is counted correctly on each side. Never recompute this locally.
```
```
payroll_period_input(tenant uuid, period_start date, period_end date)
  → TABLE(tenant_id, employee_id, period_start, period_end, days_in_period, working_days,
          holidays_in_period, days_present, days_absent, half_days, paid_leave_days,
          unpaid_leave_days, late_mark_count, overtime_hours, overtime_regular_hours,
          has_attendance_anomaly, source)
  An employee with no attendance data gets NO ROW — never a row of zeros.
```

**Acceptance criteria, applied to every seam:**

| Criterion | Meaning |
|---|---|
| **Facts, not policy** | Hours and counts cross. Rates, thresholds and amounts do not. Test: could a customer feeding us their own CSV fill in every column without knowing our pay rules? If not, the seam leaks policy |
| **Unknown is never zero** | No row rather than a zero row. The `hasModule` preflight sits *in front of* the call |
| **One writer per derived table** | `attendance` is written by derivation. Leave approval records the leave; it does **not** write the attendance row itself (this is currently violated — vision doc §6.7) |
| **Named source** | Every derived row records what produced it (`derivation_source`, `source`). A row whose origin is unknown cannot be reconciled |

### 3.2 Contracts still to build

```
work_calendar_holidays(tenant, employee, from, to)   → SETOF holiday rows
  The range sibling. Needed by every screen and RPC that shows a period rather than a day.
  ⚠️ Per-employee by nature — see vision doc §6.1.1(b) for the tenant-wide screen problem.
```
```
approval_request(tenant, subject_type, subject_id, requester) → chain resolution
  ONE engine for leave, expenses, attendance corrections, tasks and later appraisals.
  Design: conditional rules on a LINEAR chain (trigger on department / job title / location /
  grade / amount), NOT an arbitrary graph — a graph is misconfigurable into deadlock.
```
```
employee_events(tenant, employee, event_type, effective_from, payload)
  Effective-dated transfer / promotion / grade change / confirmation / resignation.
  Answers "what was true on this date?" — a hard payroll prerequisite for arrears.
```
```
attendance_period_summary_import(tenant, period, rows)
  The "use your own attendance, our payroll" path. Its columns are already shaped by
  payroll_period_input — an imported summary satisfies payroll's preflight in place of the module.
```

---

## 4. Audit — how a tenant is created today

All findings ✅ verified live 2026-09-02.

### 4.1 The flow as it actually runs

```
Super Admin Console  →  /admin/add-company   (src/admin/AddCompany.tsx)
   1. slugify company name → subdomain, validated client-side
      (src/utils/domain.ts: 3–30 chars, lowercase, no `--`, 47 reserved labels)
   2. SELECT tenants WHERE subdomain = ?      ← application-level uniqueness check
   3. INSERT INTO tenants (company_name, subdomain, plan, status, max_employees)
        └─ trigger trg_seed_tenant_modules → INSERT one tenant_modules row per public.modules
        └─ trigger tenants_platform_audit  → platform_audit_logs
   4. edge fn create-hr-admin-user
        └─ POST /api/auth/users  (autoConfirm, metadata {role:"hr", tenant_id})
        └─ rpc set_hr_user_metadata
        └─ on failure: best-effort DELETE of the tenant row
   5. Screen shows the temp password ONCE + two MANUAL steps:
        · add the subdomain as a domain in Vercel
        · add a CNAME in GoDaddy → cname.vercel-dns.com
```

Runtime resolution: `TenantContext.getSubdomain()` parses the hostname
(`acme.hrms.talentmeshsolutions.com` → `acme`), looks the tenant up by subdomain, then enforces
`role !== "superadmin" && authTenantId !== tenant.id` → **"Wrong company portal."**

### 4.2 What works, and is worth not breaking

| ✅ | Finding |
|---|---|
| **Suspension is real, not cosmetic** | `can_access_tenant()` → `tenant_is_active()` → `status IN ('trial','active')`. Because nearly every RLS policy calls `can_access_tenant`, suspending a tenant **cuts off API access at the database**, not just in React. The billing lever genuinely works |
| **The subdomain is not the security boundary — the JWT is** | The tenant is resolved from the host, but access is decided by `get_auth_tenant_id()` from the token. Guessing a subdomain gets you "Wrong company portal", not data |
| **`tenant_modules` is properly fenced** | `tenant_modules_platform_all` requires `get_my_platform_role() IS NOT NULL`; tenants get read-only `tenant_modules_self_read` on their own row. An HR admin cannot self-grant a module |
| **Reserved subdomains are enforced twice** | In `domain.ts` **and** in the `tenants_subdomain_shape_check` constraint. Belt and braces, correctly done |
| **Deleting a tenant with data is blocked in the database** | `tenants_prevent_nonempty_delete` |
| **Tenant changes are audited** | `tenants_platform_audit` → `platform_audit_logs` |

### 4.3 The two findings that matter

#### F1 — Adding a module to the catalogue does not give it to existing tenants

`trg_seed_tenant_modules` fires **on INSERT of a tenant only**. Adding a row to `public.modules`
seeds nothing. Proven by the data ✅:

| Tenants created | `tenant_modules` rows each |
|---|---|
| 12 tenants created **before 2026-08-21** | **12** |
| 3 tenants created **on/after 2026-08-21** | **13** |

`work_calendar` was added to `modules` on 2026-08-21 and never backfilled. This is the exact
mechanism behind the frontend gap in vision doc §2.1 — and it will silently repeat for every
future module.

> **Target-state rule — make this mandatory.**
> **Adding a row to `public.modules` requires, in the same change:**
> 1. a **backfill migration** inserting `tenant_modules` rows for every existing tenant, and
> 2. an update to `src/modules.ts` — `MODULE_KEYS`, and `CORE_MODULES` if core, and `ROUTE_MODULES`.
>
> One rule closes the whole class. Consider a drift check alongside `npm run check:policy-drift`
> that fails when `modules × tenants ≠ count(tenant_modules)` or when `MODULE_KEYS` and
> `public.modules` disagree.

#### F2 — "Create tenant" does not produce a working tenant

✅ Verified across all 15 tenants: **every one was created with 0 leave types, 0 shifts, 0 org
units, 0 holidays.** Whatever exists today was made by hand afterwards. There is no first-run
setup wizard.

That matters because the core modules need this data to function at all:

- **Attendance derivation needs a shift** — no shift means no working-day pattern, so no derived
  days.
- **Leave needs leave types** — with none, the apply screen has an empty dropdown.
- **The work calendar needs holidays** — with none, every public holiday is charged as a working
  day.

So a freshly provisioned tenant is inert until someone populates it manually. **This is a decision
to make, not a bug to fix** — three options, in §6.

### 4.4 The scaling ceiling: manual DNS

There is no wildcard domain, so **every tenant needs hand work in two consoles** (Vercel domain +
GoDaddy CNAME). The console surfaces both steps honestly rather than hiding them, and marks the
tenant **Pending** until done. But this rules out self-serve signup entirely, and it is a
per-customer manual cost that grows linearly.

`src/utils/domain.ts` is already structured for the fix — `VERCEL_CNAME_TARGET`, `dnsRecordName()`
and `rootDomain()` all exist. **Target state: a wildcard CNAME (`*.hrms` → `cname.vercel-dns.com`)
plus a wildcard domain in Vercel, after which step 5 disappears entirely.**
⚠️ **Verify wildcard domains are available on the current Vercel plan before planning around
this** — I have not checked, and it is the one thing the whole fix depends on.

### 4.5 Minor findings

| Finding | Target state |
|---|---|
| **Creation is not atomic.** `tenants.insert` then `create-hr-admin-user` are separate; failure triggers a best-effort rollback that the code itself admits may fail | Move provisioning into one edge function that owns both steps, or make the rollback a database-side transaction. The current handling is thoughtful — it checks `count` because an RLS denial deletes zero rows without erroring — but it is still compensation, not atomicity |
| **Subdomain uniqueness is checked in app code**, then relies on the constraint | Harmless — `tenants_subdomain_unique` is the real guard. Just ensure the constraint violation is reported as "already taken", not as a raw Postgres error (the same failure the org module has on duplicate unit names) |
| **Two identical UNIQUE constraints** on `subdomain` (`tenants_subdomain_key`, `tenants_subdomain_unique`) | Drop one. A redundant index maintained on every write |
| **`tenants_subdomain_shape_check` is `NOT VALID`** | Existing rows were never checked. Run `VALIDATE CONSTRAINT` once the legacy tenants are cleaned up (§6) |
| **`domain_status` is not maintained** | `Test Corp` and `sky info` read `live` with 0 employees. It is set by a manual superadmin button (`AllCompanies.tsx:493`) with no verification behind it. Target: verify the CNAME resolves before allowing `live` |
| **The login page cannot be tenant-branded** | `tenants` has **no anon policy**, so nothing is readable before auth. Anon visitors are safe — they are redirected to `Login`, which sits *outside* `TenantProvider` — but they see a generic form at `acme.hrms…`. If branded login is wanted it needs a **deliberate anon-readable projection of `company_name`, `logo_url`, `subdomain` only** — never `plan`, `status` or `max_employees`. Do not open `tenants` to anon wholesale |
| **HR admins have no `employees` row** | `create-hr-admin-user` creates an auth user with `metadata.role = "hr"` and nothing else. `is_hr()` reads the JWT so login works, but the HR admin is invisible to the directory, org chart, leave and attendance. This is defensible (an administrator is not an employee) but it is **undocumented**, and it is why the org chart's orphan classifier misbehaves (vision doc §6.6). Decide it explicitly and write it down |

### 4.6 Not a provisioning finding — a QA one

✅ The three module-mix fixture tenants (`QA Attendance Only`, `QA Attendance Payroll`,
`QA Full Suite`) each have **2 employees with 0 logins**. They cannot be used for persona testing
as they stand, and the module-mix QA program depends on them. Cross-referenced to `doc/qa/`;
it belongs on the QA backlog, not the provisioning one.

---

## 5. Audit — the superadmin surface

One active platform admin ✅ (`platform_admins`, role `owner`). `is_superadmin()` requires
`is_active = true` and a role in `owner | support_admin | billing_admin`.

| Action | Where | Guard | Enforced where |
|---|---|---|---|
| Create tenant | `AddCompany.tsx` | `tenants_superadmin_insert` | **Database** |
| Suspend / reactivate | `AllCompanies.tsx:505,514` | `tenants_superadmin_update_all` | **Database** — and suspension actually cuts API access (§4.2) |
| Cancel | `AllCompanies.tsx:380` | same | **Database** |
| Change plan | `AllCompanies.tsx` | same | **Database** |
| Delete tenant | `AllCompanies.tsx:263` | `tenants_superadmin_delete` **+** `tenants_prevent_nonempty_delete` | **Database**, both layers |
| Mark domain live | `AllCompanies.tsx:493` | none — a manual flag | **UI only.** No CNAME verification |
| Toggle modules | `TenantModulesPanel.tsx` | `tenant_modules_platform_all` (`get_my_platform_role() IS NOT NULL`) | **Database** |
| **Enter any tenant's portal** | `TenantContext:159` | `role !== "superadmin"` bypasses the wrong-tenant fence | **Deliberate.** See below |

### 5.1 The one thing to decide about superadmin

**A superadmin can open any tenant's portal by URL**, because the `wrongTenant` guard exempts
them. That is presumably intentional support impersonation and it is a reasonable capability.

But: `tenants_platform_audit` logs **row changes, not reads**. So there is no record of a
superadmin viewing a tenant's employee data, payslips or chat. With one `owner` account today
that is a small risk; it becomes a compliance question the moment a support team exists.

**Target state:** log portal entry as an explicit event (`platform_audit_logs`, action
`tenant_portal_entered`), and consider showing a persistent banner inside an impersonated
session so it is visible rather than silent.

---

## 6. Decisions this audit adds

These extend the seven in vision doc §8. Numbering continues from there.

| # | Decision | Options and my recommendation |
|---|---|---|
| **8** | **What does a newly created tenant start with?** (§4.2 F2) | **(a) Trigger-seeded India defaults** — one general shift Mon–Sat, CL/SL/EL leave types, national holidays. Fastest, works immediately, wrong for some customers. **(b) A first-run setup wizard** — HR answers six questions on first login. More work, always correct, and it doubles as onboarding. **(c) Industry presets** — the HR admin picks "IT services / manufacturing / retail / clinic" and gets a matching starting shape. **My recommendation: (a) now, (c) later.** Defaults that can be edited beat an empty system, and presets are the natural evolution once you know what real customers pick. (b) alone risks a tenant sitting half-configured. **This is the decision that most directly expresses the "flexible for every company" thesis — worth your time** |
| **9** | **Wildcard domain, or keep manual DNS?** (§4.4) | Manual DNS caps you at hand-provisioned customers and rules out self-serve trials. **Recommendation: confirm wildcard availability on the Vercel plan first**, then do it — `domain.ts` is already shaped for it. If wildcards are unavailable, the fallback is scripting the two console steps via the Vercel and GoDaddy APIs |
| **10** | **Should the login page be tenant-branded?** (§4.5) | Requires a deliberate anon-readable projection of three columns. **Recommendation: yes, but via a dedicated view or RPC** exposing only `company_name`, `logo_url`, `subdomain` — never the `tenants` table itself. If branding does not matter yet, do nothing; the current state is safe |
| **11** | **Is an HR admin an employee?** (§4.5) | Today they are not, and it is undocumented. **Recommendation: create an `employees` row for them, flagged as non-payroll**, so the directory and org chart are complete and the orphan-classifier bug loses its cause. The alternative — keep them separate — is fine but must then be handled explicitly everywhere the org chart currently guesses |
| **12** | **What happens to the 10 empty tenants?** (also vision doc §8 #5) | They also block `VALIDATE CONSTRAINT` on the subdomain shape check. **Recommendation: delete them** — `tenants_prevent_nonempty_delete` makes this safe by construction, since anything with real data will refuse |

---

---

## 8. Who this is for — and what that changes

**Added 2026-09-02. Corrected the same day** — the first draft of this section narrowed the market
to on-site businesses and treated geofenced punch as inherently on-site. **That was wrong**, and
the correction matters because it widens V1's addressable market at zero build cost.

### 8.0 Work mode is already configurable — lead with it, don't design around it

✅ Verified live. Attendance already adapts to how a company works, at **two** levels:

| Lever | Where | Values | Live example |
|---|---|---|---|
| `remote_work_handling` | tenant setting, UI in PolicyCenter | `disabled` / `hr_approved_exceptions` / `always_allowed` | `hr_approved_exceptions` |
| `geofence_enabled` | tenant setting | on / off | **`false`** on a live tenant |
| `geofence_mode` | tenant setting | `warn` / blocking | `warn` — advisory, not enforced |
| `employees.work_mode` | per employee, CHECK-constrained | `office` / `remote` / `hybrid` | all three in use |

And **work-from-home on request is implemented end to end**:
`attendance_location_exceptions` carries a dated approval workflow (`requested_by`, `approved_by`,
`cancelled_by`, `status`, `start_date`/`end_date`, `reason`), raised via
`hr_create_remote_exception` and cleaned up by `expire_location_exceptions`.
`src/employee/PunchInOut.tsx:460-480` resolves it: `work_mode = 'remote'` drops the geofence
entirely; `hybrid` and `office` drop it **only on dates with an approved exception**.

So one tenant can be configured as any of:

- **Fully remote** — `geofence_enabled = false`, or `remote_work_handling = always_allowed`
- **Hybrid** — `work_mode = hybrid`, plus dated exceptions for approved WFH days
- **Strict on-site** — geofence on, `remote_work_handling = disabled`
- **Advisory** — `geofence_mode = warn`, captured but never blocking

> ⚠️ **Built, but never exercised.** `attendance_location_exceptions` has **0 rows** ✅ and
> `work_from_home` has never appeared as an attendance status in live data (live statuses are
> `present, absent, half_day, on_leave, weekly_off`). The code path is real; the workflow has
> never been run by a person. **This belongs in V1 item 7 — test it with the punch testing.**

### 8.1 What this means for the buyer

The product is **not** limited to on-site businesses. The segmentation that survives is about
**which gaps hurt which buyer**, not about who can use it:

| | Remote / hybrid company | On-site business (factory, retail, clinic) |
|---|---|---|
| Attendance config | `always_allowed`, or geofence `warn` | Geofence enforced, kiosk/biometric |
| What they need most | Leave, WFH approvals, a clean monthly export | Shifts, non-Sunday weekly offs, overtime, **bulk month-end tooling** |
| Blocking gap for them | None in V1 | **G1 (bulk tooling)**, then G2 (registers) |
| Buys because | Payroll is with a CA and attendance is manual | Same, plus statutory pressure |

**Both are V1 buyers.** The on-site buyer needs G1 before they can operate at scale; the
remote/hybrid buyer does not, which makes them the **faster first customer** — fewer blockers
between today and a live company.

> **Positioning:** not "attendance for factories". It is **"attendance that matches how your
> company actually works — office, remote, hybrid, or a mix — with a monthly export your CA can
> use."** The configurability *is* the pitch, and it is already built.

### 8.2 The five gaps, and who each one blocks

These are gaps in the **plan**, not bugs. None of them appears in any roadmap in this repo.

| # | Gap | Why it decides a deal |
|---|---|---|
| **G1** | **Bulk attendance tooling does not exist** (B9). No unmarked-days view, no bulk mark, no range regularisation, no aggregate report ✅ | At 150 employees HR does dozens of month-end corrections. One at a time is not slow, it is **unusable**. This is the single biggest functional gap for the target buyer |
| **G2** | **No statutory registers.** No report/register screens exist at all ✅ | Indian factories and shops are legally required to keep muster rolls and wage registers. Their absence is a reason the buyer *cannot* switch, regardless of how good the rest is |
| **G3** | **No roster grid.** Shift *assignment* exists; a people × days grid does not | Every competitor has scheduling; Keka and Zoho sell it as a paid add-on. It is the screen a shift business evaluates you on |
| **G4** | **No comp-off, no salary advance** | Both near-universal in Indian SMBs. Work a holiday, expect a day back — its absence reads as the product not understanding the country |
| **G5** | **No legal-entity level.** `org_units` cannot express "two registered entities under one owner" | Common at this size, and it means separate PF/PT registration. A payroll blocker later, an org-structure blocker now |

**Who each blocks:** G1 blocks any buyer over ~100 people, on-site or not. G2, G3 and G4 are
on-site-specific. G5 is a payroll-era problem. **A remote/hybrid buyer under 100 people is
blocked by none of them** — which is why they are the fastest route to a live customer.

**Sequencing consequence:** G1 and G2 should come **before** the Leave ledger rebuild. The ledger
is the better engineering decision; G1 and G2 decide whether a 150-person company can run on this
at all. Today the product records attendance beautifully for one person and cannot help HR manage
it for a hundred.

---

## 9. Version 1 — the fastest honest launch

**Constraint: launch as fast as possible.** So V1 is defined by what can be *cut*, not what can be
added.

### 9.1 What V1 is

> **"Attendance and leave your CA can actually use."**
> One sentence, and it is the whole product. Not an HRMS suite — an attendance system with a clean
> monthly hand-off to whoever runs payroll.

This is sellable **because** payroll is missing, not despite it. The target buyer already has a CA.
factoHR, HROne, Keka and Darwinbox all bundle payroll from their entry tier and **cannot** sell
this configuration.

### 9.2 The V1 build list — nothing else ships

| # | Item | Size | Why it is non-negotiable |
|---|---|---|---|
| 1 | Stabilisation sprint — vision doc §6.9 items 1–5, 7 | ~1 day | Employee creation, shift editing and the fabricated-absence screen are all broken |
| 2 | **Employee creation end to end**, incl. the OTP decision | small | Recommend **showing the code on screen** — fastest path, no SMTP dependency (vision doc §8 #1) |
| 3 | **Tenant seeding defaults** — one Mon–Sat shift, CL/SL/EL, national holidays | small | Otherwise every new customer is handed an inert system (§4.3 F2) |
| 4 | **BUG-02** — route leave and the frontend through the holiday resolver | small–medium | Leave charges employees for company holidays |
| 5 | **G1 minimum: unmarked-days view + bulk mark + range regularise** | medium | The month-end workflow. Without it HR cannot operate at 100+ people |
| 6 | **Monthly CSV export of `payroll_period_input`** | small | **This is the product's reason to exist for a CA-served buyer.** Without it, attendance-only is a subset, not an offering |
| 7 | **Human test of punch / selfie / GPS on real phones, and one real kiosk punch** | ~1 day | The flagship feature has never been exercised by a person. Not optional |

### 9.3 What V1 deliberately does not include

Cut, with the reason each is safe to cut:

| Cut | Why it is safe for V1 |
|---|---|
| **Leave ledger rebuild** | The counter works at small scale if balances are watched. Revisit before the customer count makes manual reconciliation impossible. **Track it — it gets harder every month** |
| **Approval-chain engine** | HR-only approval is acceptable at 50–250 people with one HR person |
| **Statutory registers (G2)** | The first customers' CA will accept a CSV. **This becomes V1.1 and it is the first thing after launch** |
| **Roster grid (G3)** | Costs you shift-heavy buyers. Accept that and target single-shift or simple-shift businesses first |
| **Performance, lifecycle events, custom fields, comp-off, advance, multi-entity** | None blocks a first customer |
| **Payroll** | Already decided. It also keeps you out of a fight you would lose today |
| **Tasks / Projects, Chat, Connect** | Already built — leave them on, but do not sell on them. They lose to Jira and Slack |
| **Wildcard DNS automation** | **Manual DNS is fine for the first 10–20 customers.** At that scale you want to talk to every customer anyway. Do not build automation for scale you do not have |

### 9.4 The V1 exit criterion

One real company, 50+ people, runs one **full month** of attendance on it and their CA accepts the
export without a phone call. That single month will surface more than the 29 unrun QA cases.

---

## 10. UI and UX for V1

**The user's instinct is right and worth stating as policy: do not do original UX research for V1.**
Mature HRMS products have already paid for it, and their conventions are what your buyer's HR
person has already learned.

### 10.1 What to take, and what not to

| Take freely | Do not take |
|---|---|
| Information architecture — what lives on which screen | Their literal visual design, CSS, icons or assets |
| Workflow sequence — the order of steps in applying for leave, running a correction | Screenshots reproduced pixel-for-pixel |
| Field sets and terminology — what an Indian HR person expects a leave form to ask | Brand, colour identity, illustrations, copy |
| Navigation patterns and table/filter conventions | Anything that makes you look like a clone rather than an alternative |

This is the **same stance already decided for Frappe** in this repo — study the logic, reimplement
in our own stack, do not port the source. Extend it to UI: study the flow, rebuild the screen.

### 10.2 Where to actually spend design effort

Only two flows earn custom design in V1. Everything else gets a conventional layout and a
component library, and that is the correct trade.

1. **The mobile punch flow.** Used daily by every employee, and it is the flagship. It must work
   one-handed, in bad light, on cheap Android phones, on poor connectivity, in under five seconds.
   This is where a better interaction genuinely wins the deal — and where a copied desktop-first
   layout would lose it.
2. **HR's month-end attendance review** (G1). The screen where HR sees unmarked days, fixes a
   range, and exports. It is HR's hardest hour of the month and no competitor screenshot will
   solve it for you, because it depends on our own two-layer model.

Existing assets in this repo: `UI Skill/` (Apple HIG, Material Design 3, visual-design references)
and `doc/UiAndUxSuggestion.md` (three-tier navigation, slide-over drawers, Ctrl+K command palette,
module "app store"). **Most of that is post-V1.** The one idea worth pulling forward is the
**command palette** — it sits on top of existing routes with no restructuring and is transformative
for an HR user doing the same six things daily.

**Do not rebuild navigation for V1.** The module rail restructure should wait until the §2 taxonomy
is settled, or it gets built twice.

---

## 11. Rules for whoever builds the next module

The short version, for an agent starting cold.

1. **Fill in the §2 row before writing any code.** All five columns. If you cannot answer "when a
   dependency is OFF", the design is not finished.
2. **Never read another module's tables.** Add a contract function, or use the existing one. A
   direct cross-module read is a defect.
3. **Unknown is never zero.** No row beats a zero row. Put the `hasModule` preflight in front of
   the contract, and give the block a message that names the reason.
4. **Adding to `public.modules` means a backfill migration + `src/modules.ts` in the same change.**
   (§4.3 F1)
5. **Say where a rule is enforced** — database, RPC, or UI-only. Only the first two survive a
   direct API call. A doc that says "enforced" without saying where has already been wrong once.
6. **RLS is not the whole boundary.** Check grants and the `permissive` column separately: RLS does
   not cover `TRUNCATE`, does not restrict columns, and a policy written PERMISSIVE *grants*
   instead of fencing. All three have bitten this codebase.
7. **A write refused by RLS returns `200` with an empty array**, not an error. Chain `.select()`
   on every write and treat an empty result as failure.
8. **Verify against the live backend, not against a doc** — including this one. Every doc in this
   repo has been wrong about something, and the ones that were caught were caught by a query.
