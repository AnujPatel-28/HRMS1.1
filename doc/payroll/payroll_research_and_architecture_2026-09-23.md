# Payroll for India: research, conclusion and system architecture

**Date:** 2026-09-23 · **Author role:** senior system design architect (research session)
**Status:** RESEARCH COMPLETE → *proposal for decision lock* (§11). No code or schema was changed.
**Read this first if you are building payroll.** It replaces the unresearched design in `doc/payroll_generation.md`.

> **One-paragraph conclusion.**
> Build payroll as a **separate, self-contained "pay engine" module**. It owns its own payroll profile per employee,
> its own versioned rule library, and an immutable run/payslip ledger. It gets attendance and leave **only through
> one input gateway**, which accepts our attendance module, a third-party system, a CSV or manual entry, all in the
> same way. Every statutory number (PF ceiling, ESI rate, PT slab, tax slab) is **effective-dated data, never
> code**, because Indian payroll law changes mid-year and even mid-month (the EPF ceiling moved ₹15,000 → ₹25,000 on
> **17 Sep 2026**, splitting September). The engine calculates on the **server**, per employee, over **date segments**.
> It snapshots everything it used, and it never edits a locked payslip: corrections flow forward as arrears. We
> copy Frappe's *component / structure / assignment / additional-salary* model and its *monthly TDS re-projection*.
> We deliberately depart from Frappe in five places: Python-eval formulas, no statutory wage base, no segments,
> no ECR/ESI output, and editable history.

---

## Contents
1. [Why a company needs payroll (and what life without it looks like)](#1-why-payroll-is-needed)
2. [How Indian payroll actually works: the anatomy](#2-anatomy-of-indian-payroll)
3. [What changed in 2025-26, and why it drives the design](#3-what-changed-in-2025-26)
4. [Study: Frappe HR payroll (what to copy, what to avoid)](#4-study-frappe-hr-payroll)
5. [Study: industry practice (Zoho, Keka, greytHR, HROne, factoHR)](#5-industry-practice)
6. [Lessons from our own first payroll attempt](#6-lessons-from-our-first-attempt)
7. [Architecture](#7-architecture)
8. [The calculation pipeline](#8-the-calculation-pipeline)
9. [Independence: the four ways a customer can use us](#9-independence-modes)
10. [Build phases](#10-build-phases)
11. [Decision-lock table](#11-decision-lock-table)
12. [Unverified items and sources](#12-unverified-items-and-sources)

---

## 1. Why payroll is needed

Payroll is the monthly process that turns *"what we agreed to pay"* (the CTC in the offer letter) plus
*"what actually happened"* (days worked, leave, overtime, bonus) into **four legally separate outcomes**:

| Outcome | Who receives it | What goes wrong if it's wrong |
|---|---|---|
| **Net salary** in the bank | Employee | Trust, attrition. Late payment violates the Code on Wages (monthly wages are due by the 7th of the following month). |
| **Statutory deductions + employer contributions** (PF, ESI, PT, LWF) | EPFO, ESIC, state governments | Interest + damages. Retrospective PF dues found on inspection. |
| **Income tax withheld (TDS)** | Income Tax Department | Employer is liable for short deduction, plus interest and penalty. Employee gets a wrong annual certificate. |
| **Accounting entries** | The company's books | Salary expense, liabilities and the bank don't reconcile. |

**How Indian SMEs handle it without payroll software today (the problem we solve):**
an Excel sheet maintained by HR or an accountant. Attendance is copied in by hand from a biometric export,
formulas are copied row to row, the CA re-computes TDS every quarter, and PF/ESI returns are typed into
government portals. The failure modes are predictable: a copied formula silently breaks, the rate from last year
stays in a cell, a mid-month joiner is paid for the full month, nobody knows *why* last March's figure was what it
was, and a law change (like the one on 17 Sep 2026) is applied late or not at all.

**What a payroll system must add over Excel:** (1) rules held once and applied the same way to everyone,
(2) a frozen, explainable record of every payslip, (3) the government files generated rather than retyped, and
(4) law changes applied on the right date, including recalculating the months they affect.

---

## 2. Anatomy of Indian payroll

```
CTC (annual, agreed)
 └─ split by a SALARY STRUCTURE into monthly components
      Earnings:  Basic, DA, HRA, Special allowance, Conveyance, LTA, …
      Employer contributions (in CTC, NOT on the payslip as pay): Employer PF, Employer ESI, Gratuity provision, …
 × payable days / basis days            ← proration from attendance/leave (LOP = loss of pay)
 + one-time items                       ← bonus, incentive, arrears, reimbursement, leave encashment
 = GROSS EARNINGS
 − statutory deductions                 ← Employee PF, Employee ESI, Professional Tax, LWF
 − TDS                                  ← income tax projected for the whole year, spread over the remaining months
 − other recoveries                     ← loan EMI, advance, notice-pay recovery
 = NET PAY  → bank transfer file
```

### 2.1 Statutory parameters (as of 2026-09-23; **every one is effective-dated data in the design**)

| Item | Current value | Notes for the engine |
|---|---|---|
| **EPF** (employee 12%, employer 12% = 3.67% EPF + 8.33% EPS) | Wage ceiling **₹25,000/month from 17 Sep 2026** (was ₹15,000). Max EPS ≈ ₹2,083 | September 2026 is a **split month**: 1–16 at ₹15k, 17–30 at ₹25k. Employer may contribute on actual wages above the ceiling (a per-employee option). EDLI and admin charges are employer-only. |
| **ESI** | Employee **0.75%**, employer **3.25%**; eligibility ≤ **₹21,000** gross/month (₹25,000 for persons with disability) | Two contribution periods a year (Apr–Sep, Oct–Mar). An employee who crosses ₹21k mid-period **stays covered until the period ends**. |
| **Professional Tax** | State-specific slabs; constitutional cap ₹2,500/yr | Some states charge a different amount in one month (e.g. Maharashtra's February). Some states have no PT. Driven by the employee's **work state**. |
| **Labour Welfare Fund** | State-specific, monthly/half-yearly/annual | Driven by work state and a deduction calendar. |
| **Income tax: new regime (default)** | 0–4L nil · 4–8L 5% · 8–12L 10% · 12–16L 15% · 16–20L 20% · 20–24L 25% · >24L 30%; standard deduction ₹75,000; rebate up to ₹60,000 if taxable income ≤ ₹12L; + 4% cess | Salary up to ₹12.75L → zero tax. Marginal relief just above ₹12L must be modelled. |
| **Income tax: old regime (opt-in)** | Slabs with ₹2.5L exemption; standard deduction ₹50,000; HRA, 80C-equivalent, home-loan interest, etc. | Needs declarations (start of year) and proofs (year end). |
| **Income-tax Act 2025** (in force 1 Apr 2026) | Salary TDS is now **s.392** (was 192). Annual certificate **Form 130** (was Form 16). Quarterly salary TDS return has a new form number (sources disagree: 138 vs 143, **verify**) | Section and form numbers are **labels in the rule library**, not in code. FY 2025-26 slips still reference the 1961 Act. |
| **Statutory bonus** | Now under the Code on Wages. 8.33%–20%; the eligibility threshold under the new rules is **not yet notified** | Don't hardcode ₹21,000. Treat it as a pending rule version. |
| **Gratuity** | 15/26 × last wage × years. Fixed-term employees are eligible after **1 year** (permanent: 5) | Payable within **30 days** of exit. The wage base is the Code wage (§3). |
| **Full & final settlement** | All wages due within **2 working days** of exit (Code on Wages s.17(2)) | Gratuity is excluded (30-day rule). This forces **off-cycle runs** (§7.5). |
| **Minimum wage** | State and category specific, plus a national floor wage | The engine should **warn** (not block) when the basic rate falls below the configured minimum. |

---

## 3. What changed in 2025-26

Three changes in twelve months, each of which would have broken a naive design:

1. **Labour Codes in force (21 Nov 2025; central rules notified 8 May 2026; state rules still arriving).**
   The new definition of *"wages"* (Code on Wages s.2(y)) includes Basic + DA + retaining allowance and excludes
   a fixed list of heads: HRA, conveyance, employer PF contribution, statutory bonus, overtime, commission,
   amenities, gratuity and so on. **If the excluded heads exceed 50% of total remuneration, the excess is added back to
   wages.** PF, gratuity, bonus and overtime are computed on this *statutory wage*, not on "Basic".
   → **Design consequence:** every pay component must declare its **wage classification**, and the engine
   computes a **statutory wage base** with the 50% add-back *before* any PF/gratuity/bonus math. Frappe has no
   such concept. Its formulas reference `BS` (basic) directly, which is now legally wrong for many structures.

   *Worked example:* Basic ₹15,000, HRA ₹20,000, conveyance ₹5,000 → total ₹40,000. Exclusions = ₹25,000 (62.5%).
   The limit is 50% = ₹20,000, so the excess ₹5,000 is added back. **Statutory wage = ₹20,000**, not ₹15,000.

2. **Income-tax Act 2025 (1 Apr 2026).** Same economics, new section and form numbers. A payslip must record
   *which Act and which rule version* produced its TDS.

3. **EPF ceiling ₹15k → ₹25k on 17 Sep 2026 (a Thursday, mid-month).** September is computed on a split basis.
   → **Design consequence:** rules are versioned with `effective_from` **dates** (not months), and the engine
   calculates over **date segments** within a period. The same mechanism also handles a mid-month salary revision,
   a mid-month joiner or leaver, and an inter-state transfer (PT state changes).

   *Split example (method: verify against the EPFO circular):* wage ₹30,000, September. PF wage =
   15,000 × 16/30 + 25,000 × 14/30 = 8,000 + 11,667 = **₹19,667** → employee PF ≈ ₹2,360.

**General lesson:** in India, *the law is a time series.* Any design that stores "the PF rate" instead of
"the PF rule valid from date X, per notification Y" will produce wrong payslips within a year.

---

## 4. Study: Frappe HR payroll

Source: `frappe/hrms` docs + DeepWiki code walkthrough (see §12; studied from docs and a code summary, not a
line-by-line read of the repo).

### 4.1 Its model
| Entity | Kind | Role |
|---|---|---|
| Salary Component | master | Earning / Deduction / Employer Contribution. Flags: `depends_on_payment_days`, `is_tax_applicable`, `statistical_component`, `do_not_include_in_total`, `arrear_component`, `is_flexible_benefit`, `variable_based_on_taxable_salary` (= the TDS line), GL account per company |
| Salary Structure | master (template) | Rows of components, each fixed / formula / condition (Python expressions over `base`, component abbreviations, `payment_days`, …) |
| **Salary Structure Assignment** | **effective-dated** | Employee + structure + `base`/`variable` + Income Tax Slab, from a date; opening YTD balances |
| Income Tax Slab | effective-dated, submitted | Rate table + conditions + cess; **old vs new regime = two slab documents** |
| Payroll Period | master | The tax year that TDS is projected over |
| Payroll Entry | batch transaction | Get employees → create slips → submit (accrual JE) → bank entry |
| Salary Slip | transaction | Per employee per period: working days, payment days, LOP, earnings, deductions, tax |
| **Additional Salary** | transaction | One-off/recurring amount on a component for a payroll date. **Everything funnels through it**: benefit claims, gratuity, arrears, incentives |
| Arrear | transaction | Diffs submitted slips against a new structure → creates Additional Salary |
| Tax Exemption Declaration / Proof | transaction | Feeds old-regime exemptions |
| Salary Withholding | transaction | Hold pay; release later |
| Gratuity, Full & Final Statement | transaction | Exit settlement: payables vs receivables → journal entry |

**Payroll Settings** (the "working days source" switch we already noted in 2026-09-03):
`payroll_based_on` = Attendance | Leave Application · `consider_unmarked_attendance_as` ·
`include_holidays_in_total_working_days` · `daily_wages_fraction_for_half_day` · opening balances ·
password-encrypted emailed payslips.

**TDS logic (worth copying exactly):** annualise this month's taxable earnings over the remaining months,
add YTD taxable earnings from submitted slips (+ opening balance), subtract exemptions and standard deduction,
compute tax on the slab, subtract tax already deducted, divide by remaining months. One-time items can be
flagged **"deduct full tax this month"** (e.g. bonus) rather than being spread.

### 4.2 Copy vs avoid
| ✅ Copy | ❌ Avoid / improve |
|---|---|
| Component → Structure → **effective-dated Assignment** layering | **Python `eval` formulas.** Use a small, safe expression language with a dependency graph |
| **Additional Salary** as the single funnel for all one-time money | Formulas referencing Basic directly for PF. Use a computed **statutory wage base** (§3) |
| Monthly **TDS re-projection** with YTD + remaining months | Whole-period calculation (**unverified** whether Frappe splits within a period). We need **date segments** |
| Explicit working-days settings (`based_on`, unmarked-as, include-holidays, half-day fraction) | Cancel = **delete slips and reverse**. We keep locked history and correct forward |
| Arrears computed as a *diff* of locked slips vs new rules | ECR / ESI return / PT challan not native in core (reports only; India Compliance app territory, **unverified**) |
| Opening YTD balances for mid-year migration | Regime modelled implicitly as "which slab doc is linked". We make **regime per employee per FY** first-class |
| Salary withholding as a first-class state | Payroll permissions on generic HR roles (**unverified**). We use payroll capabilities |
| Password-protected payslip delivery | Statutory values entered by each company. We ship a **platform-maintained rule library** |

---

## 5. Industry practice

What Indian vendors (Zoho Payroll, Keka, greytHR, HROne, factoHR, RazorpayX) converge on:

1. **A frozen "payroll inputs" artifact before the run.** factoHR's *Submit Attendance* prepares full days,
   half days, week-offs, leaves, holidays, late counts and LOP for the period, and **saves** it. Payroll reads only that.
   Attendance is *locked after cut-off.* A manual upload of Present/LOP days is the fallback when their attendance
   isn't used. → our **Input Batch** (§7.3).
2. **A pre-payroll exception list / variance report.** HROne compares the run with last month, and ±5% per employee on gross is a
   common review threshold. Missing PAN/bank, a new joiner, a leaver, a revision and a negative net are all flagged
   before approval. → our **Review** state (§7.4).
3. **Pay run types:** regular, **off-cycle** (new-joiner arrears, LOP reversal, bonus, F&F), with post-payroll
   actions (payslip release, bank file, statutory files, JV). → one Run model with a `run_type` (§7.5).
4. **Arrears are computed, not typed.** Upload a revised CTC with a back date and the system diffs past months, re-applies
   the PF ceiling and re-projects TDS.
5. **Compliance calendar:** TDS deposit by the 7th, PF/ESI by the 15th, quarterly TDS returns, the annual certificate,
   PT and LWF per state.
6. **Output files are the product:** bank transfer file, PF ECR, ESI monthly contribution file, PT/LWF challan
   data, TDS return data, annual tax certificate, accounting JV (Excel/CSV/Tally).
7. **Modularity is marketed but not sold.** Neither factoHR nor HROne offers attendance-without-payroll as a real
   SKU (our 2026-09-02 competitor research). **True independence is our differentiator**, and it's only
   real if the architecture enforces it (§9).

---

## 6. Lessons from our first attempt

From `system-audit-2026-08/09-payroll-correctness-and-devices.md` and the 2026-09 memories. The old code
(`src/payroll/*`, `payroll_runs`, `salary_structures`, `payslips`, …) is **not** a foundation (owner decision
2026-09-23). Its failures become requirements:

| Old failure | Requirement it creates |
|---|---|
| Sunday-only weekly-off hardcode → under-pays 5-day-week staff | Working days come from the **work calendar / input batch**, never a local function |
| No DOJ/LWD → joiners over-paid in calendar mode (unit mismatch) | **Employment window** is step 1 of the pipeline; basis and payable days are in the same unit |
| Client-side calculation | **Server-side** engine; the browser only displays |
| TDS = a static number on the structure | Real **annual projection** engine with regime + declarations |
| PT = flat ₹200 map for 6 states | **State slab rule sets**, month-aware |
| No F&F, arrears, bonus, loans, reimbursement | **One-time item funnel** + off-cycle runs |
| Empty attendance treated as zero → everyone paid ₹0 when a module was OFF | Keep the contract rule: **"unknown is not zero"**. Missing inputs block the employee with an exception |
| Payroll enabled on 14/15 tenants while unfinished | Payroll stays **OFF** until trust bar T1–T7 is met and a **parallel-run month** reconciles |

`payroll_period_input` (migration `20260821160000`) keeps its two rules, *facts not policy* and *unknown is
not zero*. But it returns **period aggregates only**, with no DOJ/LWD and no per-day status, so it cannot drive
segmented calculation. §7.3 defines its successor.

---

## 7. Architecture

### 7.1 Principles (non-negotiable)
1. **Law is data.** Rates, ceilings, slabs, section/form labels, due dates → versioned `statutory_rules`,
   `effective_from` **date**, source notification reference. Code holds *mechanisms* only.
2. **Payroll is a bounded context.** It reads the outside world only through the **Input Gateway** and the
   core employee master. It never reads attendance/leave tables directly.
3. **Deterministic and explainable.** Same inputs + same rule versions → same payslip, byte-for-byte. Every
   line carries a calculation trace ("why is PF ₹2,360?").
4. **Immutable after lock; correct forward.** Like forward-only migrations: a locked payslip is never edited.
   Mistakes become arrears or reversal lines in a later run.
5. **Money is integer paise.** Rounding is an explicit, configured step, never an accident of floating point.
6. **Unknown blocks, never defaults to zero.** An employee with missing inputs is an *exception*, not a ₹0 slip.
7. **Maker-checker on money movement.** Whoever prepares a run cannot approve it or release the bank file.

### 7.2 Component map

```
               ┌──────────────── PLATFORM (TalentMesh-maintained) ────────────────┐
               │  Statutory Rule Library  (EPF, ESI, PT/LWF per state, tax regimes,│
               │  bonus, gratuity, min wage, form/section labels, due dates)       │
               └────────────────────────────┬─────────────────────────────────────┘
                                            │ versioned, effective-dated
┌───────────── TENANT: PAYROLL MODULE ──────▼───────────────────────────────────────┐
│                                                                                    │
│  Pay Configuration          Payroll Profile           Input Gateway                │
│  · components (+wage class) · per employee: PAN, UAN, · Input Batch per period     │
│  · structures (versioned)   │ ESIC IP, bank, regime/FY│  ← our attendance/leave    │
│  · pay groups (cycle,       │ work state, PF options, │  ← 3rd-party API / CSV     │
│    cut-off, days basis)     │ DOJ/LWD mirror          │  ← manual entry            │
│  · employee pay assignment  │ (effective-dated)       │  status: draft→submitted→  │
│    (effective-dated CTC)    │                         │          locked            │
│  · one-time items           │  Tax Declarations/Proofs│                            │
│          │                  │           │             │           │                │
│          └──────────────────┴─────┬─────┴─────────────┴───────────┘                │
│                                   ▼                                                │
│                     PAY ENGINE (pure, server-side)                                 │
│        segments → components → statutory wage → PF/ESI/PT/LWF → TDS → net          │
│                                   ▼                                                │
│            Run Manager: draft → computed → in_review → approved → locked → paid    │
│                                   ▼                                                │
│   Payslip Ledger (immutable, snapshot + trace)  ·  YTD ledger per employee per FY  │
│                                   ▼                                                │
│   Outputs: payslip PDF · bank file · ECR · ESI file · PT/LWF data · TDS return     │
│            data · annual certificate (Form 130) · JV/Tally export · registers      │
└────────────────────────────────────────────────────────────────────────────────────┘
        ▲ only dependency on the rest of HRMS: core employee master (identity)
```

### 7.3 Input Gateway (successor to `payroll_period_input`)

**Recommendation: two accepted shapes, one frozen artifact.**

| Shape | Who produces it | Precision |
|---|---|---|
| **Day facts**: one row per employee per date: `day_type` (working / weekly_off / holiday), `status` (present / absent / half_day / paid_leave / unpaid_leave / unknown), `ot_hours`, `late_mark` | Our attendance + leave modules (and any integrator that can do it) | Exact segment splits |
| **Period summary**: per employee per period: `payable_days` or `lop_days`, `ot_hours`, optional `arrear_lop_days` for last month | CSV / third-party HRMS / manual entry | Segments prorated evenly; **payslip is flagged "summary-input"** |

Both land in an **Input Batch** (`draft → submitted → locked`) that HR reviews and submits, factoHR-style.
A run reads *only* a locked batch, and the batch is snapshotted into each payslip. Rules carried over:
**facts not policy** (hours and counts cross, never amounts), and **unknown is not zero** (no row = exception).
Late corrections to a locked batch go into next month's batch as `arrear_lop_days` / LOP reversal, the
standard Indian practice.

### 7.4 Run lifecycle

```
 draft ──compute──▶ computed ──submit──▶ in_review ──approve──▶ approved ──lock──▶ locked ──mark paid──▶ paid
   ▲                    │                    │ (maker ≠ checker)                    │
   └──── recompute ─────┘◀─── reject ────────┘                                    └─▶ corrections ONLY via a
                                                                                      later arrear/off-cycle run
```
- **in_review** shows the exception list: missing PAN/bank/UAN, new joiners, leavers, revisions, >±5% gross
  variance vs last month, negative net, below-minimum-wage, summary-input employees, withheld salaries.
- **lock** freezes payslips, advances the YTD ledger, and makes outputs available.
- **Salary hold:** an employee can be *withheld* inside a locked run and released later without re-computation.

### 7.5 Run types (one model, four uses)
| `run_type` | Trigger | Why it must exist |
|---|---|---|
| `regular` | Monthly per pay group | The normal cycle |
| `off_cycle` | Any time: bonus, missed joiner, LOP reversal, correction | Fixes without reopening a locked month |
| `final_settlement` | Employee exit | **Law: 2 working days.** Leave encashment, notice pay/recovery, pro-rata bonus, loan recovery; gratuity (30 days) as its own item |
| `arrear` | Back-dated revision **or a retroactive rule change** | Diffs locked slips vs recomputation under new inputs/rules; emits one-time items, never edits history |

### 7.6 Data model sketch (new tables; prefix `pay_` to keep them apart from the legacy payroll tables)

| Table | Scope | Key points |
|---|---|---|
| `pay_statutory_rules` | **platform** (read-only to tenants) | `rule_type`, `jurisdiction` (IN / state code), `effective_from`, `effective_to`, `params jsonb`, `source_ref`, `approved_by` |
| `pay_establishments` | tenant | legal entity / establishment: TAN, PF establishment code, ESIC code, PT & LWF registration **per state**. Pay groups and profiles point to one. **All statutory outputs are generated per establishment (TDS per TAN)**, which is how a multi-company, multi-branch tenant stays correct |
| `pay_components` | tenant | `kind` (earning / deduction / employer_contribution / reimbursement / statistical), **`wage_class`** (wage / excl_hra / excl_conveyance / excl_bonus / excl_ot / …), taxability, `prorate`, ESI-applicable, GL code, payslip visibility |
| `pay_structures`, `pay_structure_versions`, `pay_structure_lines` | tenant | line = component + method (fixed / % of X / expression / **balancing**) + condition + order. One **balancing component** (usually special allowance) = CTC − all other lines − employer contributions, which keeps the old "Auto Balance" mode; manual mode validates that CTC matches within a tolerance |
| `pay_groups` | tenant | frequency, cut-off day, pay day, **days basis** (calendar / fixed 26 / fixed 30 / working days), unmarked-as, include-holidays, half-day fraction |
| `pay_assignments` | tenant | employee + structure version + annual CTC + overrides, **daterange with no-overlap exclusion constraint** |
| `pay_profiles` | tenant | PAN, UAN, ESIC IP, bank (masked; changes are maker-checker and notify the employee), work state, PF on actual/ceiling, EPS eligibility, DOJ/LWD mirror; effective-dated where it matters |
| `pay_tax_elections`, `pay_tax_declarations`, `pay_tax_proofs`, `pay_prior_employment` | tenant | regime **per employee per FY**; declarations → proofs; previous-employer income/TDS for mid-year joiners |
| `pay_input_batches`, `pay_input_day_facts`, `pay_input_summaries` | tenant | §7.3 |
| `pay_one_time_items` | tenant | Frappe's Additional Salary: component, amount, payroll date, `tax_this_month`, source (bonus / arrear / loan / reimbursement / F&F / manual) |
| `pay_runs` | tenant | type, pay group, period, status, maker, checker, timestamps |
| `pay_slips`, `pay_slip_lines` | tenant | **immutable after lock**; `inputs_snapshot`, `rule_version_ids`, `structure_version_id`, `trace jsonb`, engine version |
| `pay_opening_balances` | tenant | per employee per FY: taxable earnings, TDS, PF, ESI, PT already processed **by the customer's previous payroll system** this FY. Imported and locked like an input batch. **Required for every mid-year go-live**, which will be the first pilot's case |
| `pay_ytd` | tenant | per employee per FY = **opening balance + locked slips** (never slips alone) |
| `pay_outputs` | tenant | generated files (bank / ECR / ESI / PT / TDS / certificate / JV) with checksum and generator version |
| `pay_loans`, `pay_advances` | tenant | phase 2 |

Storage: payslip PDFs and output files in a **private** bucket, fenced per tenant, served by signed URL
(see memory: *new bucket needs a fence*).

### 7.7 Where the engine runs
- **Pay engine = a pure TypeScript library** (no I/O): `compute(inputs, rules, config) → payslip + trace`.
  It is testable offline with golden cases, and the same code runs everywhere.
- **Executed server-side** in an InsForge **edge function** (Deno). It loads data via definer RPCs and writes results
  through a single `pay_commit_run` RPC that enforces state transitions and immutability in Postgres.
  For very large tenants, the same library can move to Custom Compute without changes.
- **Formulas:** a restricted expression language (arithmetic, `min/max/round/if`, component codes, `payable_days`,
  `basis_days`, `statutory_wage`), evaluated in a **topologically sorted dependency graph**. There is no `eval`,
  and cycles are rejected when the structure is saved.

### 7.8 Access and privacy
- Payroll gets **its own capabilities** through the permission resolver decided on 2026-09-09
  (`payroll.prepare`, `payroll.approve`, `payroll.release_payment`, `payroll.view_all`, `payroll.config`), **not**
  `is_hr()`. A general HR admin should not automatically see everyone's salary.
- Employees see only their own locked payslips, declarations and tax sheet. Managers see nothing by default.
- Platform admin has **no** access to tenant pay data. The rule library is the only platform-owned payroll table.
- Salary, PAN and bank details are sensitive personal data under DPDP: mask them in lists, log every export, and
  apply retention rules (tax records must be kept for statutory periods).

### 7.9 Operating the rule library (a process, not just a table)
1. The TalentMesh compliance owner watches notifications (EPFO/ESIC circulars, CBDT, state PT/LWF gazettes).
2. A new rule version is added with its `effective_from` date and `source_ref`. It is **reviewed by a CA** before activation.
3. If `effective_from` falls inside an already-locked period, the system lists affected runs and **proposes an
   arrear run** per tenant. HR approves it; history is never rewritten.
4. Golden test cases are added for the new rule before release (e.g. the September 2026 EPF split).

---

## 8. The calculation pipeline

For one employee, one run:

1. **Employment window** = `[max(period_start, DOJ), min(period_end, LWD)]`. No window → not in run.
2. **Segments**: split the window at every boundary of *pay assignment*, *profile* (work state, regime),
   and *statutory rule versions*. Most months have 1 segment; September 2026 has 2 for PF.
3. **Days per segment**: `basis_days` (per pay-group basis: calendar / 26 / 30 / working days from the calendar)
   and `payable_days` (from the input batch: basis − LOP − absent + half-day fraction; unknown ⇒ exception).
4. **Components**: evaluate the structure's **monthly rate** under the segment's assignment. Where `prorate = true`:
   **`amount_seg = monthly_rate × payable_days_seg ÷ basis_days_period`**. The divisor is the **whole period's** basis
   (calendar days, 26, 30 or working days), never a per-segment basis, so the segments sum to exactly one month when
   nothing is lost. Sum across segments.
   *Fixed-26/30 basis across segments:* payable days are counted in the basis's own unit (for fixed-26, working days
   excluding weekly offs), and a full month is capped at the basis (26/26), never 27/26.
   *Golden case:* revision on the 11th under fixed-26 → old rate × payable days 1–10 ÷ 26 + new rate × payable days 11–end ÷ 26.
   ⚠️ **The statutory ceiling split is a different thing.** The Sep-2026 EPF ceiling splits by **calendar-day share**
   (16/30 vs 14/30) per the EPFO method, independent of the pay-proration basis. Don't reuse one for the other.
5. **One-time items** for this payroll date (bonus, arrears, reimbursement, recoveries).
6. **Statutory wage base** per segment (Code on Wages 50% add-back, §3).
7. **EPF** on `min(statutory wage, segment ceiling)` or on actual, per profile option. EPS/EDLI/admin split.
8. **ESI**: eligibility fixed at the start of the contribution period; contribution on ESI-applicable gross.
9. **PT / LWF** from the work state's slab and calendar for this month (registration from the employee's establishment).
   *Policy deductions* (e.g. late-mark deduction: the old `late_mark_threshold` / `late_mark_deduction_hours`) are
   **payroll-side pay-group rules applied to the late-mark COUNT** from the input batch. Counts cross the seam; the
   rupee rule lives in payroll.
10. **TDS**: projected annual taxable income (YTD incl. **opening balance** + this month + remaining months projection + prior employer),
    minus regime deductions and exemptions, tax + cess − rebate (with marginal relief), minus tax already
    deducted, ÷ remaining months, plus full tax on `tax_this_month` items. No PAN → higher-rate rule (verify the
    new-Act section).
11. **Other recoveries** (loan EMI, advance, notice recovery).
12. **Net** = earnings − deductions. If negative: net = 0 and the shortfall becomes a **carried recovery** item.
13. **Rounding** per component rule, then net rounding.
14. **Checks**: below min wage, variance vs last month, missing identifiers → exception list.
15. **Emit** payslip + trace + snapshot references.

---

## 9. Independence modes

This answers *"how do we work with and without our payroll"* for both directions:

| Mode | HRMS (attendance, leave) | Payroll | How it works |
|---|---|---|---|
| **A. Full suite** | ours | ours | Our attendance + leave emit **day facts** into an Input Batch automatically |
| **B. HRMS without our payroll** | ours | theirs (CA, Tally, Keka, …) | We generate and lock the same Input Batch and **export** it (CSV/Excel + generic API). Their payroll imports LOP days, OT hours and late counts. Our payroll module stays OFF |
| **C. Our payroll without our HRMS** | theirs | ours | Payroll profile + assignments + **FY opening balances** imported (CSV/API). Inputs arrive as **period summaries** (or day facts via API). Only the **core employee master** is required, not the org chart, attendance or leave |
| **D. Payroll only, no attendance at all** | none | ours | HR types LOP days per employee into the Input Batch (factoHR's manual fallback) |

All four hit **the same engine** through **the same Input Batch**, so there is one code path and one set of tests.
The `hasModule` preflight stays in front: "attendance module is off" and "attendance has no data" produce
different messages, never zeros.

---

## 10. Build phases

Payroll remains the **last module** (owner decision). When it starts:

| Phase | Scope | Exit criterion |
|---|---|---|
| **P0: Engine core** | Rule library schema + current Indian rules, components with wage class, structures, pay groups, assignments, profiles, establishments, **opening-balance import**, Input Batch (both shapes), pay engine with segments, EPF/ESI, PT for the **first 1-2 states**, TDS (both regimes, declarations but not proofs yet), regular run lifecycle, payslip PDF, generic bank CSV, salary register | **Golden suite passes**: ≥30 CA-verified payslips incl. mid-month joiner, leaver, revision under fixed-26, Sep-2026 EPF split, mid-FY go-live with opening balances, ESI cusp, new-regime rebate edge, old-regime HRA |
| **P1: India compliance outputs** | ECR file, ESI monthly file, PT challan data, JV/Tally export, off-cycle + arrear runs, F&F run, tax proofs, withholding | One pilot tenant **parallel-runs a full month** and reconciles with their existing payroll to the paisa |
| **P2: Breadth** | Quarterly TDS return data, annual certificate (Form 130), LWF, gratuity, statutory bonus, loans/advances, reimbursements from the expenses module (via one-time items), more states, multiple pay groups | Second parallel-run tenant; compliance calendar + reminders |
| **P3: Integrations** | Bank host-to-host / payouts API, accounting integrations, public payroll API for mode C | By customer demand |

**Legacy payroll:** keep it hidden (as now). Don't migrate its tables. When P0 ships, decide separately whether to
drop them (ask the owner first, per the existing memory).

---

## 11. Decision-lock table

| # | Decision | Options | **Recommendation** |
|---|---|---|---|
| D1 | Where statutory values live | code constants · tenant settings · **platform rule library** | Platform rule library, effective-dated by date, CA-reviewed |
| D2 | Calculation granularity | whole month · **date segments** | Segments (forced by the Sep-2026 EPF split, revisions, joiners/leavers) |
| D3 | Input contract | aggregates only · day facts only · **both into one Input Batch** | Both; flag summary-input slips |
| D4 | Wage base for PF/gratuity/bonus | Basic · **Code-wage with 50% add-back** | Code-wage, driven by component `wage_class` |
| D5 | Where the engine runs | browser · plpgsql · **pure TS in edge function + Postgres state machine** | Pure TS library, server-side; Postgres enforces lock/immutability |
| D6 | Corrections | edit/cancel slips · **forward-only arrears/off-cycle** | Forward-only |
| D7 | Payroll profile ownership | on `employees` · **separate `pay_profiles`** | Separate, so mode C works and payroll PII stays payroll-scoped |
| D8 | Permissions | `is_hr()` · **payroll capabilities via the resolver** | Capabilities, maker-checker on approve and bank release |
| D9 | Tax regime storage | implied by slab · **per employee per FY** | Per employee per FY |
| D10 | First states for PT/LWF | *owner to choose* | The states of the first pilot customer only |
| D13 | Statutory registration level | tenant · **establishment (entity × state)** | Establishment; outputs per establishment/TAN |
| D14 | Mid-year go-live | start fresh · **opening-balance import** | Opening balances, mandatory before the first run in a mid-FY tenant |
| D11 | Legacy payroll tables | extend · **leave hidden, build `pay_*` fresh** | Build fresh; drop decision later |
| D12 | Go-live gate | feature-complete · **golden suite + 1-month parallel run** | Golden suite + parallel run (trust bar) |

---

## 12. Unverified items and sources

**Verify before build (all marked in the text):**
- The quarterly salary TDS return form number under the Income-tax Rules 2026 (sources say 138 and 143).
- The exact EPFO split-month method for September 2026, and EPS eligibility for members above the ceiling.
- Whether the Code-wage (with add-back) or Basic+DA is the PF base under each state's practice. Get a CA opinion.
- The statutory bonus eligibility threshold under the Code on Wages rules (not yet notified).
- The higher-TDS-without-PAN section under the 2025 Act.
- Frappe: the exact Payroll Period schema, whether newer versions added an explicit regime field, and the internals of
  Retention Bonus / Employee Incentive. They were studied from docs and DeepWiki, not by reading the repo line by line.

**Sources**
- Frappe HR docs: [Payroll Settings](https://docs.frappe.io/hr/payroll-settings), [Salary Component](https://docs.frappe.io/hr/salary-component), [Payroll Entry](https://docs.frappe.io/hr/payroll-entry), [Salary Structure Assignment](https://docs.frappe.io/hr/salary-structure-assignment), [Income Tax Slab](https://docs.frappe.io/hr/income-tax-slab), [Gratuity](https://docs.frappe.io/hr/gratuity), [Full and Final Statement](https://docs.frappe.io/hr/full-and-final-statement)
- DeepWiki `frappe/hrms`: [salary slip processing](https://deepwiki.com/frappe/hrms/2.1.1-salary-slip-processing-and-benefits), [payroll entry](https://deepwiki.com/frappe/hrms/2.1.2-payroll-entry-and-batch-processing), [components & structures](https://deepwiki.com/frappe/hrms/2.1.3-salary-components-and-structure-configuration); repo [github.com/frappe/hrms](https://github.com/frappe/hrms)
- Labour Codes: [MoLE FAQs (16.03.2026)](https://www.labour.gov.in/static/uploads/2026/03/a4ccf4c6d97c4f1f36a6d83f8c64213d.pdf), [Kredily](https://kredily.com/new-labour-codes/), [ELP Law on wage definition](https://elplaw.in/leadership/impact-of-the-new-wage-definition-in-the-labour-codes-changes-ambiguities-and-compliance-measures/), [Aparajitha](https://www.aparajitha.com/lets-talk-compliance-wages-under-code-on-wages/), [Acuity Law FAQ](https://acuitylaw.co.in/faqs/faqs-on-code-on-wages-2019-and-the-code-on-wages-central-rules-2026/)
- F&F 2-day rule: [Patron Accounting](https://www.patronaccounting.com/blog/full-final-settlement-2-day-rule-labour-code), [TaxGuru](https://taxguru.in/corporate-law/labour-code.html), [Karma (bonus)](https://www.karmamgmt.com/index.php/blog/new-labour-codes-statutory-bonus-rules-2025)
- EPF ₹25k ceiling: [Gupta Consultants](https://www.guptaconsultants.com/epf-wage-ceiling-increased-from-%E2%82%B915000-to-%E2%82%B925000-with-effect-from-17-september-2026/), [SGCMS](https://www.sgcms.com/regulatory-updates/epfo-wage-ceiling-increased-from-15000-to-25000/), [CiteHR](https://www.citehr.com/thread/epf-wage-ceiling-amendments-in-code-on-social-security-17-september-2026), [calcguru](https://calcguru.in/epf-wage-ceiling-25000/)
- ESI: [INDPayroll](https://www.indpayroll.com/blog/esic-new-rules-2026-salary-limit-eligibility-contribution-rates-payroll-compliance-guide), [SalaryBox](https://salarybox.in/blog/esi-contribution-rate-2026-eligibility-calculation-benefits-compliance-checklist/)
- Income-tax Act 2025: [ClearTax s.392](https://cleartax.in/s/section-392-income-tax-act-2025), [ClearTax TDS changes](https://cleartax.in/s/tds-and-tcs-changes-from-april-2026), [SalaryBox Form 130](https://salarybox.in/tds-on-salary-in-india-2026-new-section-392-form-130-slabs-calculation-employer-compliance-guide/), [calcguru s.392/393](https://calcguru.in/section-392-393-salary-tds-194-series/)
- Tax slabs FY 2026-27: [Axis Max Life](https://www.axismaxlife.com/blog/tax-savings/income-tax-slab-2026-27), [Tax Garden](https://taxgarden.in/blog/standard-deduction-75000-new-tax-regime-ay-2026-27)
- Industry practice: [Zoho Payroll pay runs](https://www.zoho.com/in/payroll/help/employer/pay-runs/), [Keka off-cycle](https://help.keka.com/hc/en-us/articles/39946785501073-Post-Payroll-Actions-for-Off-Cycle-Runs), [Keka processing guide](https://www.keka.com/payroll-processing-guide), [teamed (variance)](https://www.teamed.global/insights/how-to-achieve-payroll-processing-accuracy-guide); competitor detail in `doc/competitor_research_india_2026-09-02.md`
- Internal: `system-audit-2026-08/09-payroll-correctness-and-devices.md`, `migrations/20260821160000_payroll-period-input-contract.sql`, `doc/policy_center_settings_inventory_2026-09-03.md` §7
