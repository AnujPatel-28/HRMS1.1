# Salary Component Data Model — Design Sketch

**Status:** proposal, not implemented. Drafted 2026-08-13.
**Goal:** move salary structure from fixed columns to configurable components, without losing the
correctness work already in `src/payroll/hr/payroll-calc.ts`.

---

## 1. Why change

Today a salary structure is a fixed shape:

```
salary_structures(ctc_annual, basic_percent, hra_percent, special_allowance,
                  other_allowances, pf_applicable, esi_applicable, tds_monthly)
payslips(basic_monthly, hra_monthly, special_allowance, other_allowances,
         pf_employee, pf_employer, esi_employee, esi_employer, tds, other_deductions, ...)
```

That works for one payroll policy. It breaks the moment a tenant wants a component we didn't
anticipate — a conveyance allowance, a shift allowance, a canteen deduction, a salary-advance
recovery. Each one is a schema migration plus a UI change plus a payslip-PDF change, applied to
**every** tenant whether they want it or not. In a multi-tenant product this is the wrong axis of
flexibility.

Two secondary problems the current shape causes:

- **Net pay is computed in three places.** `calcPayslip()` returns a `netPayable`, then
  `RunPayroll.tsx:348` recomputes it with expenses added, then `:421` recomputes again with
  overtime. These agree today, but nothing enforces that. Overtime and expense reimbursement are
  effectively components that live outside the component system.
- **The payslip can't explain itself.** `other_deductions` is a single number that currently means
  "professional tax". When it later means "professional tax + canteen + advance recovery", the
  employee has no way to see the breakdown and HR has no audit trail.

## 2. What to keep

The existing engine gets several hard things right, and the new model must preserve all of them:

- **`policy_snapshot` on the payslip.** Immutable record of the rules used at run time
  (`snapshot_version`, LOP method, PF/ESI ceilings, PT state). This is the single best thing in the
  current design — a reprint of a 2024 payslip must not pick up 2026 rules. Keep it, extend it.
- **LOP divisor as policy** (`calendar` / `fixed_26` / `working_days`).
- **PF wage-ceiling proration** against the LOP ratio.
- **ESI eligibility judged on full monthly gross, but deducted on prorated gross + overtime.**
  That distinction is correct and easy to lose in a refactor.
- **Attendance anomaly normalization** — the clamp when tracked days exceed working days.

---

## 3. Proposed tables

### 3.1 `salary_components` — the catalogue

One row per component a tenant can use. Seeded with system defaults on tenant creation.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid | null = global system default, visible to all tenants |
| `code` | text | stable machine key: `BASIC`, `HRA`, `PF_EE`, `PT`. Unique per tenant |
| `name` | text | display label, tenant-editable |
| `component_type` | enum | `earning` \| `deduction` \| `employer_contribution` \| `reimbursement` \| `informational` |
| `calculation_type` | enum | `flat` \| `percent_of` \| `slab` \| `statutory` \| `formula` |
| `depends_on` | text | for `percent_of`: `CTC_MONTHLY`, `BASIC`, `GROSS`, or another component code |
| `default_rate` | numeric | percent when `percent_of`, amount when `flat` |
| `is_taxable` | bool | counts toward taxable income for TDS |
| `counts_toward_pf` | bool | included in PF wage base |
| `counts_toward_esi` | bool | included in ESI base |
| `prorate_on_lop` | bool | false for things like a fixed reimbursement |
| `is_statutory` | bool | system-managed; tenant may toggle applicability but not the maths |
| `display_order` | int | payslip ordering |
| `is_active` | bool | soft delete — never hard-delete, payslips reference these |

`employer_contribution` matters: PF employer and ESI employer are **cost to company, not deductions**.
Modelling them as a distinct type stops them being accidentally subtracted from net pay — a classic
payroll bug.

### 3.2 `salary_structure_components` — per-employee assignment

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `salary_structure_id` | uuid fk | |
| `component_id` | uuid fk | |
| `value` | numeric | overrides `default_rate` for this employee |
| `is_enabled` | bool | turn a component off for one employee |

The existing `salary_structures` row keeps `ctc_annual` and `effective_from`, and **loses** the
per-component columns once migrated.

### 3.3 `payslip_lines` — the itemised breakdown

This is the main win. One row per component per payslip.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `payslip_id` | uuid fk | |
| `component_id` | uuid fk | nullable — component may later be deactivated |
| `component_code` | text | **denormalised**, frozen at run time |
| `component_name` | text | **denormalised**, frozen at run time |
| `component_type` | enum | frozen |
| `amount` | numeric | final, post-proration |
| `base_amount` | numeric | what the calc was applied to |
| `calc_note` | text | human-readable: `12% of ₹15,000 (PF ceiling, prorated 0.87)` |
| `sequence` | int | display order frozen at run time |

Denormalising code/name/type is deliberate. A payslip is a legal document; renaming a component in
2027 must not alter a payslip issued in 2026.

**Keep the existing summary columns** on `payslips` (`gross_salary`, `total_deductions`,
`net_payable`, and the statutory ones for compliance reports). They become derived roll-ups of the
lines — fast for list views, and existing UI keeps working during migration.

### 3.4 `salary_slabs` + `salary_slab_rows` — PT and income tax

Professional Tax today is a flat per-state number in `DEFAULT_PROFESSIONAL_TAX_BY_STATE`. Real PT is
slab-based on gross, and this is a live correctness gap (see §5).

```
salary_slabs(id, tenant_id, slab_type, state, regime, effective_from, effective_to)
   slab_type: 'professional_tax' | 'income_tax'
   regime:    'old' | 'new' | null

salary_slab_rows(id, slab_id, from_amount, to_amount, rate_percent, flat_amount, month_override)
```

`month_override` handles Maharashtra's ₹300 in February. `to_amount` null = open-ended top slab.
The same two tables serve income-tax slabs for real TDS computation.

### 3.5 `additional_salaries` — bonus, arrears, off-cycle

| column | notes |
|---|---|
| `employee_id`, `component_id`, `amount` | |
| `payroll_month`, `payroll_year` | which run picks it up |
| `is_recurring`, `recur_until` | |
| `reason`, `created_by`, `approved_by` | |

Covers bonus, incentive, arrears from a backdated revision, and one-off deductions — all currently
impossible without editing the structure.

### 3.6 `statutory_configs` — typed, not formula-driven

```
statutory_configs(tenant_id, statutory_type, effective_from, config jsonb)
   statutory_type: 'PF' | 'ESI' | 'PT' | 'LWF' | 'GRATUITY'
```

**Deliberate design choice:** PF and ESI are *not* expressed as generic formulas. Their real rules —
wage ceilings, the EPS/EPF employer split, contribution-period lock-in — cannot be safely encoded as
`percent × base`. Trying to force them into a formula engine is how payroll products get compliance
wrong. Keep them as typed config consumed by purpose-built code, and reserve `formula` for genuinely
simple tenant-specific components.

---

## 4. Migration path (additive, no big-bang)

1. Create the new tables. Seed `salary_components` with system defaults matching today's fixed set.
2. Backfill: for each existing `salary_structures` row, write `salary_structure_components`
   (`BASIC` = `basic_percent` of `CTC_MONTHLY`, `HRA` = `hra_percent` of `BASIC`, `SPECIAL`/`OTHER`
   flat, `TDS` flat from `tds_monthly`).
3. Rewrite `calcPayslip()` to walk components and emit lines. Statutory components still route to
   the existing PF/ESI/PT code paths — **the maths does not change in this step.**
4. **Verification gate:** re-run the last 3 months of payroll for every tenant through both engines
   and diff. Zero variance on net pay, or the refactor doesn't ship. This is the whole safety net —
   don't skip it.
5. Move overtime and expense reimbursement into components, collapsing the three net-pay
   computations into one.
6. Only then drop the old columns.

---

## 5. Edge cases and compliance gaps found while reviewing the current engine

Ordered by how likely they are to produce a wrong number.

1. ~~**ESI contribution-period lock-in — non-compliant today.**~~ **FIXED 2026-08-13.** ESI runs
   Apr–Sep and Oct–Mar; an employee covered at any point in a period stays covered to the end of it.
   `calcPayslip` now accepts `opts.esiCoveredEarlierInPeriod`, and `RunPayroll` derives it by looking
   for earlier payslips in the current period with `esi_employee > 0`. Helper:
   `getEsiContributionPeriod(year, month)`.
2. ~~**Professional Tax is flat per state.**~~ **FIXED 2026-08-13.** Replaced the flat
   `DEFAULT_PROFESSIONAL_TAX_BY_STATE` map with `PROFESSIONAL_TAX_RULES` — real slabs, Maharashtra's
   February top-up, and Tamil Nadu's half-yearly basis (collected in September and March only).
   Exposed as `resolveProfessionalTax()`. PT is assessed on **full monthly gross**, not the prorated
   figure, so a part-paid month doesn't drop an employee into a lower slab. A tenant's
   `professional_tax_manual_amount` still overrides everything.
   ⚠️ **The seeded rates need finance/CA sign-off before a live run** — sources disagree on
   Karnataka's middle band (the ₹150 band for 15,001–25,000 predates the 2025 amendment; we use the
   post-amendment ≤₹25,000 = nil).
   Both fixes are covered by `scratch/payroll_pt_esi_verify.ts` (24 checks) and bump the payslip
   policy snapshot to **v3** (`professionalTaxSlabsApplied`, `esiContributionPeriodLockIn`), so
   existing v2 payslips reprint unchanged.
3. **PF employer contribution isn't split.** 12% employer is really EPS 8.33% (capped at ₹15,000
   wage) + EPF 3.67%. Without the split you cannot generate an ECR file. EDLI (0.5%) and admin
   charges (0.5%) are also absent.
4. **TDS is a manual monthly number.** `it_declarations` and `it_declaration_windows` exist and
   collect declarations, but nothing consumes them — `struct.tds_monthly` is typed by HR. The
   collection half is built; the computation half (projected annual income → slab → declarations →
   monthly TDS) is not. This is the single biggest functional gap in payroll.
5. **No mid-month structure change / arrears.** A revision effective the 15th applies to the whole
   month. `effective_from` exists but only one structure is selected per run.
6. **PF ceiling proration is hardcoded policy.** `pfWageCeiling × lopRatio` is one legitimate reading;
   many employers don't prorate the ceiling. Should be a tenant policy flag, not a constant.
7. **Statutory rounding.** ESI is rounded up to the next rupee by rule; the code uses 2-decimal
   `roundCurrency` throughout.
8. **No LWF** (state Labour Welfare Fund) — small amounts, but statutory in Karnataka, Maharashtra,
   Tamil Nadu and others.
9. **No gratuity accrual** — 4.81% of basic is the usual monthly provision.
10. **No full-and-final settlement.** The offboarding flow exists but doesn't produce an F&F payslip
    (leave encashment, notice recovery, gratuity payout).

Items 1–3 are correctness bugs against Indian statute and are worth fixing **independently of** the
component refactor. Item 4 is the biggest feature gap.

---

## 6. What we're borrowing, and the licence boundary

Frappe HR (GPLv3) is the reference for the *shape* of this model — components as data, slabs as
data, additional-salary as a first-class entity, immutable payslip lines. Those are design ideas and
statutory rules; ideas aren't copyrightable and Indian payroll rules are facts of law.

**The boundary:** study the logic, reimplement it in TypeScript/SQL. Do not port Python source,
copy structure and comments verbatim, or vendor any part of the repo. Our implementation is an
independent expression targeting a different stack, which keeps it outside GPL obligations.

---

## 7. Deferred / out of scope

- **Recruitment / ATS** — covered by a separate company product; integrate later rather than build.
- **Biometric device integration** — offer as a per-tenant option alongside the existing
  selfie + geolocation flow, not a replacement.
- **Per-tenant AI assistant (MCP endpoint + WhatsApp/Telegram bot)** — parked until the core HRMS is
  end-to-end complete. See the memory note for scope.
