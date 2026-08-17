# Module Architecture — Proposal

**Drafted:** 2026-08-13. Payroll is parked pending CA answers (see `decisions_and_judgment_calls.md`).
Researched against [Frappe HR](https://github.com/frappe/hrms) (GPLv3 — logic studied, no code copied),
OrangeHRM, and Odoo HR.

---

## 1. The one thing to get right first

**Modules are for HR admins. Employees should never see a module.**

This is the most important call in this document, and it's easy to get wrong.

An HR admin uses ~14 feature areas, configures them, and needs them organised. Modularisation genuinely
helps them. An employee does six things — punch in, apply for leave, check a payslip, submit an expense,
finish a task, read a policy — and does most of them *from a phone, in under a minute*. Making them
choose "which app am I in?" first is pure friction added for the sake of architectural tidiness.

So:

| | HR / Admin portal | Employee portal |
|---|---|---|
| Structure | Modular — app switcher, contextual sidebar | **Flat** — one task list, no module concept |
| Primary device | Desktop | **Mobile** |
| Navigation | L1 module → L2 section → L3 tabs | Home + bottom tab bar |
| Mental model | "I'm configuring the leave system" | "I want Thursday off" |

Your geolocation punch-in with selfie capture is inherently a phone activity — nobody punches in from a
laptop at the office door. If the employee portal isn't mobile-first, the flagship feature is
awkward to use. That's a bigger strategic call than any navigation pattern.

**Recommendation:** design them as two distinct products sharing one backend. Do not force one
navigation model across both.

---

## 2. Proposed modules

Boundaries follow **workflows** (what someone does in one sitting), not tables. The most common
modelling mistake is splitting modules by data model, which produces modules nobody has a reason to
visit.

| # | Module | Contains | Primary user |
|---|---|---|---|
| 1 | **People** | Directory, profiles, org chart, org structure, onboarding, offboarding, documents, ID cards | HR |
| 2 | **Time** | Punch, attendance, corrections, shifts, rosters, office locations/geofencing, overtime | HR + employee daily |
| 3 | **Leave** | Leave types, policies, balances, requests, approvals, holidays, calendar | HR + employee |
| 4 | **Payroll** ⏸️ | Salary structures, runs, payslips, tax declarations | Payroll admin |
| 5 | **Claims & Benefits** | Expenses, advances, insurance | Employee + HR |
| 6 | **Work** | Projects, tasks, submissions | Managers + employee |
| 7 | **Performance** 🆕 | Goals, KRAs, appraisal cycles, feedback | Everyone, periodically |
| 8 | **Policies** | Policy library, acknowledgements, compliance | HR publishes, employee reads |
| 9 | **Connect** | Chat, social feed, announcements | Everyone |
| 10 | **Settings** | Tenant config, module toggles, roles | HR admin |
| — | **Platform** | Company provisioning, plans, tenant monitoring | Superadmin (separate portal) |

### Boundary calls worth defending

**Leave separate from Time.** Tempting to merge — both are "when people are present". Keep them
apart: different approval chains, different configuration surfaces, different rhythms (attendance is
daily and passive, leave is occasional and deliberate). Frappe separates them too. But **cross-link
heavily** — a leave approver needs to see the attendance calendar without leaving the flow.

**Expenses out of Payroll, into Claims.** Expenses are submitted by employees continuously; payroll is
run by one admin monthly. Different users, different frequency. They only meet at the reimbursement
hand-off. Keeping expenses inside Payroll would bury an employee-facing feature inside an admin module.

**Insurance with Claims, not People.** It's a benefit an employee consumes and claims against, not
personnel data HR maintains.

**Overtime in Time, not Payroll.** It's captured and approved as an attendance event; payroll only
consumes the total.

---

## 3. Per module: what you have, what's missing, UX notes

Gaps below come from comparing against Frappe's entity list. Not all are worth building — flagged where
I'd skip.

### 1. People
**Have:** directory, profiles, org chart/structure, onboarding (self-service), offboarding with
clearance templates, exit interviews, documents, ID cards.
**Missing worth adding:**
- **Employee transfer / promotion as recorded events.** You change `manager_id` and designation in
  place, so history is lost. Frappe models these as documents with an effective date. Matters for
  audit and for "what was their designation in March?" during payroll disputes.
- **Onboarding templates.** You have `exit_clearance_templates` for offboarding but nothing equivalent
  for onboarding — checklists differ by role. Mirror the pattern you already built.
- **Employee grievance.** A formal, confidential complaint channel. Genuinely important for HR
  compliance and completely absent.
**Skip for now:** skills matrix, training, referrals.
**UX:** the directory is the most-visited HR screen. It deserves saved filters and bulk actions
(bulk-assign shift, bulk-add to org unit) more than it needs new fields.

### 2. Time
**Have:** geofenced punch with selfie, breaks, corrections with approval, shifts, employee shift
assignment, location exceptions, overtime records, audit log.
This is your **strongest module** and ahead of Frappe, which leans on biometric devices.
**Missing worth adding:**
- **Employee-initiated attendance/shift requests.** Frappe has `attendance_request` and
  `shift_request`. Today corrections are the only path; there's no "I'll be working from the Pune
  office on Thursday" before the fact.
- **Shift schedule/roster view.** You have shift assignment but no visual weekly roster. This is the
  #1 request in shift-based businesses (retail, hospitality, clinics).
**Per-tenant biometric option** (as you suggested): model it as an *ingestion source* feeding
`attendance`, so selfie/geo and biometric are two providers behind one interface. Don't fork the module.
**UX:** roster needs to be a grid (people × days) with drag-to-assign. This is the one screen where a
custom-built interaction genuinely beats a generic table.

### 3. Leave
**Have:** leave types with accrual/carry-forward/encashment flags, balances, requests, approvals,
holidays, calendar.
**Missing — and one is important:**
- 🔴 **Leave balances should be a ledger, not a running total.** Today `leave_balances` holds mutable
  `used_days` / `pending_days` / `balance` columns. Frappe uses `leave_ledger_entry` — immutable rows,
  balance derived by summing.
  **Why it matters:** two approvals landing at once can race and corrupt the total; there's no record
  of *why* a balance is what it is; backdated corrections are near-impossible to reason about; and
  when an employee asks "why do I have 3.5 days?" nobody can answer. This is the highest-value data
  model change outside payroll, and it gets harder to change the longer real balances accumulate.
- **Leave policies as assignable objects.** Frappe has `leave_policy` + `leave_policy_assignment`, so
  you attach a policy to a grade or department instead of configuring per employee.
- **Compensatory off** — earned by working a holiday. Common in Indian companies; entirely absent.
- **Leave encashment** — `leave_types.encashment_enabled` exists but nothing implements it. Stubbed.
**UX:** the balance widget should show *derived* numbers with a "how was this calculated?" expander.
Once it's a ledger, that expander is free.

### 4. Payroll ⏸️ *parked*
Blocked on CA answers. Design work already done in `salary_component_model_design.md`.
Worth noting one Frappe idea now: they isolate country-specific statutory logic in a `regional/`
directory. Given how much India-specific logic you carry (PF, ESI, PT, TDS), doing the same — a
clear boundary between "payroll engine" and "Indian statutory rules" — is what makes a second country
possible later without a rewrite. Cheap to do during the component refactor, expensive after.

### 5. Claims & Benefits
**Have:** expense claims with receipts, HR approval, payroll integration; insurance policies.
**Missing worth adding:**
- **Employee advance.** Money paid before it's earned, recovered from later payroll. Frappe treats
  this as first-class. Common in Indian companies, and it needs payroll to recover it — so design it
  alongside the component refactor.
- **Expense categories/types as data** — likely hardcoded today; same "config not columns" argument as
  salary components.
**Skip:** travel requests, per-diem, unless customers ask.

### 6. Work (PMS)
**Have:** projects, tasks, submissions, approvals.
**Honest assessment:** this is the module most likely to lose to a dedicated tool. Companies using
Jira/Linear/Asana won't switch. Its real value is the **attendance and payroll link** — tasks tied to
attendance lock dates, submissions gating punch-out. Lean into that integration rather than competing
on project management features.
**Missing:** timesheets (hours against project) — only worth it if customers bill clients by the hour.

### 7. Performance 🆕 *does not exist*
Your largest whole-module gap. Every buyer asks about it.
Frappe's structure is worth following: `appraisal_cycle` as a first-class object with `appraisal`,
`appraisal_kra`, `goal`, and `employee_performance_feedback` hanging off it. The cycle-as-container
pattern is the key idea — it makes "H1 2026 review" a thing you can open, track completion on, and
close.
**Start minimal:** cycles + goals + self-review + manager review. Skip 360°, calibration and
nine-box until someone asks.

### 8. Policies
**Have:** policy library, versioning, acknowledgements, org-unit targeting, privacy controls. Solid.
**Missing:** scheduled re-acknowledgement (annual re-sign of the code of conduct) — small addition,
real compliance value.

### 9. Connect
**Have:** chat channels, DMs, social feed, reactions, announcements.
**Note:** this competes with Slack/Teams and will usually lose. Its defensible use is
**HR-to-everyone broadcast with read receipts** — announcements you can prove people saw. That ties
to Policies. I'd frame it that way rather than as a chat product.

### 10. Settings
**Have:** `tenant_settings` key/value store (now properly secured).
**Missing:** a coherent settings *home*. Config is currently spread across PolicyCenter, Settings,
OfficeLocations and OrgStructure. Your UX doc's "unified settings hub" instinct is right — one gear
icon, vertical tabs grouped by module.

---

## 4. Navigation — concrete recommendation

Your UX doc proposes a 9-dot app-switcher grid. Worth knowing there's a second pattern:

- **App-switcher grid** (Google/Rippling): modules behind a launcher. Good with many modules; costs a
  click and hides what exists.
- **Persistent module rail + top submenu** (OrangeHRM): thin left rail of module icons always visible;
  selecting one fills a top bar with its sections. Nothing is hidden, switching is one click.

**My recommendation: the rail, not the grid.** With ~10 modules a grid adds a click and conceals
options; a rail keeps everything one click away and always visible. Reserve the 9-dot grid for when
you exceed ~15 modules.

**Phasing** — highest value per unit of risk:

1. **Command palette (Ctrl+K)** — biggest win per effort. Sits on top of existing routes, no
   restructuring. For HR staff doing the same six things daily, transformative.
2. **Slide-over drawers** for cross-module peeks. Your payroll→attendance example is the most common
   real workflow.
3. **Breadcrumbs.**
4. **Module rail + contextual sidebar** — the real restructure. Do it *after* boundaries settle, or
   you'll do it twice.
5. **Employee portal mobile-first rebuild** — arguably should jump the queue if customers are
   deskless.

**On per-module colour coding:** be careful. Colour is already how you signal status
(approved/pending/rejected). If green means both "Payroll" and "approved", both signals weaken. Use
colour for **state**, and something quieter — an icon, a left border — for **module identity**.

---

## 5. Suggested build order

Payroll parked, security done. What I'd do next:

1. **Leave ledger refactor** — highest-value data fix outside payroll, and it only gets harder as real
   balances accumulate.
2. **Command palette + breadcrumbs** — cheap, immediately felt.
3. **Performance module (minimal)** — biggest functional gap; wins deals.
4. **Employee transfer/promotion events** — small, unblocks accurate history.
5. **Shift roster grid** — if you're targeting shift-based businesses.
6. **Employee portal mobile-first** — sized as its own project.

Payroll rejoins at the top once the CA answers land.
