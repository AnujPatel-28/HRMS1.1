# Competitor HRMS Research — Zoho People, Keka, Darwinbox, BambooHR

*Sourcing key: **(V)** = confirmed from a vendor page fetched directly. **(V-search)** = vendor content seen only via search-engine synthesis, not fetched directly. **(3P)** = third-party review/aggregator. help.keka.com and rippling.com blocked every direct fetch (cert error / 403), so the non-India section uses **BambooHR** instead of Rippling, per the task's "whichever you can verify better."*

## Zoho People

**1. Module taxonomy.** Zoho sells this as genuinely separate branded products: **Zoho People** (core HR/attendance/leave), **Zoho Payroll**, **Zoho Recruit**, **Zoho Expense**, plus **Zoho Cliq** (chat), **Zoho Connect** (intranet), **Zoho Vault** (passwords), and a distinct **Zoho Shifts** scheduling product. They are recombined only inside a bundle called **Zoho People Plus**, whose own tiers are Essential HR / Workforce / Talent / Enterprise (V, zoho.com/peopleplus/plan-comparison.html). Standalone Zoho People has its own separate tier ladder: Free / Essential HR / Professional / Premium / Enterprise (V, zoho.com/people/zohopeople-pricing.html).

**2. Modularity & pricing.** Attendance/timesheets/shift management appear starting at the Professional tier of standalone Zoho People — no payroll required (V). Zoho Payroll is a fully separate product with its own edition ladder (Free / Standard / Professional / Premium, ₹-denominated) (3P, zoho.com/in/payroll/pricing-comparison — figures not independently confirmed by direct fetch). Per-user pricing for Zoho People itself was not displayed on the vendor pricing page (V) — third-party aggregators report $1.50–$5/user/month across tiers with a reported 5-user paid minimum (3P) — not confirmed on a vendor page.

**3. Employee lifecycle.** Not a single named screen; it's built as connected modules. Onboarding has its own product page (pre-boarding portal, e-signed offer/policy docs, day-one checklists) (V-search, zoho.com/people/onboarding-software.html). Offboarding is a distinct "exit pipeline": resignation self-service, clearance forms, exit interviews, relieving/experience letter generation (V-search, help.zoho.com offboarding article).

**4. Cross-module seams.** Confirmed directly: the People→Payroll integration has an explicit **"Allow LOP Sync from Zoho People"** toggle that pushes Loss-of-Pay days and employee details into a selected Payroll pay schedule (V, zoho.com/in/payroll/kb/.../connect-people.html). The flow is one-directional (People → Payroll); a secondary marketing page independently states payroll-side edits don't flow back (V-search). A widely-repeated third-party claim that Payroll integration is *mutually exclusive* with People's own Leave & Attendance module could **not be confirmed** on either of two vendor pages fetched directly — treat as unverified, not fact.

**5. Configurability.** Per-form **Approval Process** configuration (choose approver, email template, approve/reject) (V-search, help.zoho.com). Custom field builder includes **Formula fields** (numeric/text/date computed types) (V-search, Zoho developer docs).

**Shifts/rosters:** Multiple rosters by department/designation/location, custom shifts, an automated shift-rotation scheduler, break management (V-search, zoho.com/people/employee-shift-management-software.html) — plus a wholly separate **Zoho Shifts** product for scheduling.
**Performance:** bundled inside People (Premium tier) or inside People Plus's "Talent" tier (OKRs, evaluations, LMS) — gated by tier, not its own SKU like Payroll.
**Multi-entity:** a named **Organization Structure** hierarchy — Legal Entity → Business Unit → Division → Department — supports multiple legal entities in one account, plus a separate "multi-org" mode for fully independent orgs under one login (V-search, help.zoho.com).

## Keka

**1. Module taxonomy.** Named modules: Core HR, Payroll, Time & Attendance, Performance Management, **Hire** (ATS/recruitment), Expense & Travel, Projects & Timesheets. Plan names: **Foundation / Strength / Growth**, sold as flat monthly bands covering up to 100 employees rather than pure per-seat pricing (3P; keka.com/pricing itself could not be fetched — TLS cert error every attempt).

**2. Modularity & pricing.** Unlike Zoho, **payroll ships in every tier**, including entry-level Foundation — not split into its own product (3P, consistent across aggregators). Reported figures disagree by source/currency and are unverified: one aggregator gives $9/$16/$22 PEPM, India blogs give ₹6,999–15,999/month flat bands (3P) — inconsistent with each other, neither confirmed against keka.com. Add-ons reported separately: Advanced Shift/Scheduler, Keka Hire (per recruiter), Keka Learn, and a Performance add-on below Growth tier (3P).

**3. Employee lifecycle.** Marketed explicitly as lifecycle-first: "manage the full employee lifecycle from onboarding to exit," with per-role-stage checklists (onboarding, role change, exit) auto-assigning tasks to HR/IT/manager/finance/legal owners (V-search, keka.com onboarding/offboarding pages).

**4. Cross-module seams.** **Loss of Pay (LOP)** is Keka's named intermediate object, analogous to Zoho's: system pre-calculates LOP days per employee for the pay run, with a manual "LOP Adjustment" override, bulk Excel import, and month reversal (V-search — help.keka.com blocked every direct fetch with 403). One result claimed the API supports pulling LOP-tagged leave requests but not LOP reversal (manual UI only) — also unverified directly.

**5. Configurability.** Rule-based **conditional approval chains**: trigger on department/job title/location/salary range/job type with "is/is not" operators, configurable per module (Goals, Payroll, Requisitions, Timesheets) and per expense category (V-search, help.keka.com — not directly fetchable).

**Shifts/rosters:** an add-on **Scheduler** with **Shift Board** (assign to pre-built shifts) and **Shift Rotation** (auto-rotating assignment), filterable by department/location/business unit — cited multi-location case study (a clinic chain) (V-search, keka.com/shift-management-software).
**Performance:** gated to the Growth tier or a paid add-on below it (3P).
**Multi-entity:** Business Unit and Location filtering confirmed in scheduling; a formal legal-entity hierarchy like Zoho's was **not found**.

## Darwinbox

**1. Module taxonomy.** Verbatim product pages exist for: Core HR, Payroll, Time and Attendance, Performance Management, Talent Acquisition, Talent Management (incl. Succession Planning), People Analytics, Compensation Management, Skills Management, Employee Onboarding, Workforce Management (V-search, darwinbox.com/en-us/products/*). Darwinbox's own content groups these into five marketing categories: **Core, Strategic, Intelligence, Experience, Compliance & Governance** (V-search, darwinbox.com/en-us/blog/top-hr-modules).

**2. Modularity & pricing.** No published pricing anywhere — fully custom, quote-only, no free trial (3P, multiple sources agree). Third-party analysis describes Core HR + Payroll as the typical purchase floor, with Recruitment/Performance/LMS/Darwin AI as adders (3P) — **not** vendor-confirmed, and I found no vendor statement on whether attendance/time can be bought without payroll.

**3. Employee lifecycle.** Marketed heavily as "hire to retire" on one platform, but I found no evidence of a single dedicated lifecycle *screen* — it reads as a narrative frame over connected modules, same pattern as Zoho and Keka.

**4. Cross-module seams.** Directly confirmed by fetch: attendance (mobile/geo-tag/biometric capture) has shift and overtime rules "applied automatically, and the result flows directly into native payroll **without a separate export**," because attendance and payroll "share one data model" — a roster change or approved OT entry "reaches the pay run the same way it was recorded" (V, darwinbox.com/blog/payroll-automation-process-from-attendance-to-payslips). No named intermediate object (no Zoho-style "LOP sync," no Keka-style "LOP Adjustment tab") appears in anything fetched directly — a search-engine answer asserted an "attendance summary" object holding present days/LOP/OT/comp-off, but two direct fetches of the likely source pages did not contain that language, so it's excluded as unconfirmed. External payroll: a named partnership with **Neeyamo** (global payroll, 160+ countries) extends Darwinbox into markets outside its native footprint (India, 6 GCC countries, Indonesia, Philippines, Thailand, plus announced Singapore/Malaysia) (3P) — a vendor-to-vendor partnership, not a documented generic third-party-payroll export API.

**5. Configurability.** Described (not confirmed by direct fetch) as offering configurable workflows, custom fields/policies, role-based permissions, and custom approval workflows for "manpower budgeting and position management" (3P/V-search). No formula-builder or conditional-rule-engine name as explicit as Zoho's Formula Fields or Keka's conditional chains was found — **not found**.

**Shifts/rosters:** a Time and Attendance product page exists; shift/OT rules are applied automatically ahead of payroll (see #4) — no distinctly named roster product (like Keka's Scheduler) was found.
**Performance:** its own named product/module, addable to the core suite — not spun off as a fully separate branded product the way Zoho splits Payroll.
**Multi-entity:** the strongest multi-country story of the three India-origin vendors — native payroll in India, 6 GCC countries, Indonesia, Philippines, Thailand, and (announced) Singapore/Malaysia, extended to 160+ countries via the Neeyamo partnership (3P).

## BambooHR

**1. Module taxonomy.** BambooHR's own platform page calls its modules **"Native Apps"**: HR Data & Reporting, Payroll, Benefits Administration, Time & Attendance, Applicant Tracking, Onboarding, Performance Management, Recognition & Rewards, Employee Experience, Compensation, Compliance, Global Employment (V, bamboohr.com/platform/). The page explicitly frames these as spanning "the full employee lifecycle" and states changes in one app "are reflected in the others instantly" via a "unified people data foundation" (V).

**2. Modularity & pricing.** Confirmed directly: three core tiers — **Core** ($10/employee/month: records, hiring with 5 job openings, unlimited time-off policies, 1 compliance course, basic AI assistant), **Pro** ($17: adds 360° review cycles, recognition, 25 job openings, 15 compliance courses), **Elite** ($25: adds compensation planning/benchmarking, 50 job openings, 300+ compliance courses) (V, bamboohr.com/pricing/). **Payroll, Benefits Administration, Time & Attendance, and Global Employment (via Remote) are separate add-on modules on top of any core tier**, with a stated **15% bundle discount for combining Payroll + Benefits** (V) — i.e., Time & Attendance can be bought without Payroll, and Payroll is not bundled by default into any tier.

**3. Employee lifecycle.** Explicitly named on the vendor site: "From hiring to offboarding, AI-powered solutions reduce friction at every stage" (V) — same narrative-frame pattern as the India vendors, not a single dedicated screen.

**4. Cross-module seams.** Vendor language is generic — "seamlessly syncing employee records, PTO, location changes, and benefits data with payroll," tracked project hours "flow directly into payroll" (V, bamboohr.com/payroll/) — **no named intermediate object** (no LOP-equivalent) found on the fetched page. External time-tracking feeding BambooHR Payroll is **not addressed** there; 150+ prebuilt integrations are advertised generally (V) but payroll-specific compatibility is unconfirmed.

**5. Configurability.** Custom fields support per-role visibility and can drive **custom approval workflows** (e.g. a custom "Bonus" field with its own approval chain), paths divertible by requester/approver role (3P, not directly fetched). A separate third-party source says custom fields **cannot trigger workflow automations** and customization is "limited to pre-built templates with minimal conditional logic" (3P) — less deep than Keka's condition-operator builder.

**Shifts/rosters:** a dedicated **Time & Attendance → Scheduling** feature: one-time/recurring shifts, multi-schedule support by team/location, early-clock-in prevention, self-service views (3P/V-search).
**Performance:** its own Native App, priced separately from Core (same pattern as everyone else).
**Multi-entity:** reviewer commentary flags that "franchise and multi-brand operators should assess whether BambooHR's multi-entity and location workflows fit their operational complexity" (3P) — real but possibly shallow; no named entity hierarchy like Zoho's was found.

## The "separate product vs module" pattern

Zoho draws the product boundary around **payroll specifically**: Zoho Payroll is a distinct SKU with its own pricing ladder and statutory-compliance surface (PF/ESI/PT/TDS), reconnected to Zoho People only via an explicit named sync (LOP push) — a customer can adopt or reject Payroll independently of HR. Keka and Darwinbox do the opposite — Keka bundles payroll into every tier from the entry plan up, Darwinbox treats Core HR + Payroll as the typical purchase floor — while peeling off the *newer, more discretionary* capabilities (Performance, Hire, LMS, advanced Scheduler) into gated tiers or paid add-ons. BambooHR draws the line differently again: nothing beyond a thin Core tier is bundled — Payroll, Benefits, Time & Attendance, and Global Employment are all separate add-ons on top of Core/Pro/Elite, unified only by the shared data model, with a discount for combining Payroll + Benefits rather than for HR + Payroll.

What predicts the split: (a) **regulatory weight** — payroll's audit surface differs enough from HR that Zoho isolated it, while India-market Keka/Darwinbox treat statutory payroll as the anchor justifying the whole suite; (b) **perceived discretionariness** — Performance, LMS, and Recruit are consistently the first things gated or sold as add-ons across all four vendors, because a typical SMB doesn't need them day one; (c) **where the moat sits** — BambooHR leans hardest on "unified data foundation" precisely because its module list is the most unbundled, so the sync layer, not the bundle, is the pitch.

## Notable ideas worth stealing

1. Zoho's People→Payroll sync exposes one explicit, named, toggleable object ("LOP Sync") rather than letting Payroll read attendance/leave tables directly — worth copying as the seam contract between attendance and any future payroll module.
2. Keka's reported LOP-Adjustment pattern — a system-calculated value shown next to a manual override with a mandatory comment — is a clean UX answer for the moment payroll and attendance disagree (unverified in detail, but the shape is worth designing toward regardless).
3. Zoho's four-level **Legal Entity → Business Unit → Division → Department** hierarchy is a reusable, off-the-shelf model for multi-entity tenants rather than inventing a bespoke org tree.
4. BambooHR's explicit **bundle discount for combining specific add-ons** (Payroll + Benefits) is a pricing mechanic worth considering once this HRMS has more than one paid module — reward cross-module adoption directly rather than only via tier upsells.
5. Darwinbox's partnership-based external-payroll story (Neeyamo) shows a credible template for "use our attendance/HR, plug in someone else's payroll" that matches this HRMS's own stated goal of letting modules work independently.
6. Keka's condition-operator approval builder (trigger on department/location/job title/salary range with is/is-not operators) is more flexible than a hardcoded manager-chain approval and generalizes across modules (Goals, Payroll, Expense, Timesheets) rather than being reimplemented per module.
7. Every vendor treats Performance/LMS/Recruit as the first things gated or sold separately while keeping core HR + attendance (and, for three of the four, payroll) as the mandatory floor — useful market validation for sequencing which modules to harden first versus which can stay optional longest.
8. BambooHR's onboarding tier structure (5 → 25 → 50 open job requisitions per tier) shows a usage-based lever besides seat count for gating tiers — worth considering alongside pure per-employee pricing.

---
*Limitations: keka.com/help.keka.com and rippling.com blocked every direct fetch attempted (cert error / 403 on 4+ URLs each), hence BambooHR over Rippling for the contrast section. (V-search)/(3P) marks reflect search-synthesized or third-party content, not a directly-confirmed quote.*
