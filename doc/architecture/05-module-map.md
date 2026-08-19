# 05 — Module map

Every module: what exists, what is missing, and what each needs before it can be called done.

**Benchmarked against** Frappe HRMS (GPLv3 — studied for its *model*, no code ported; see
`hrms-product-roadmap-decisions` and `07-market-benchmark.md`), plus the usual commercial comparators.
**Excluded by decision:** recruitment/ATS — a separate product owns it (`README.md` §2).

---

## 1. Built today

| Module | State | What is missing before "done" |
|---|---|---|
| **Organisation / Directory** (core) | 🔴 More broken than it looks | 7 of 16 employees contradict themselves on department; 5 RLS policies key off that drifting text column; a department name is hardcoded in notification logic; grade and `locations` are dead. **Phase 1** — see `06-organisation-management.md`. |
| **Attendance** | 🟠 Works, model is wrong | Raw punches and the derived daily record are the same table. Geo-fence is client-computed and advisory (**P5**). Rules hardcoded → move to the rule engine. **Phase 2.** |
| **Leave** | 🟠 Good logic, wrong storage | Counter instead of ledger; half-day impossible; no leave period; dual `leave_type`/`leave_type_id`. **Phase 1** — see `03-leave-module.md`. |
| **Tasks & Projects** | 🟢 Solid | `projects.visibility_config` is the best config pattern in the codebase. Needs no rework; adopt the approval engine for submissions. |
| **Expenses** | 🟠 Thin | No advance/settlement concept. Approval hardcoded → approval chain. Receipts sit in a **public** bucket (S4). |
| **Insurance** | 🟢 Fine | Expiry checking exists here and nowhere else — generalise into Document Compliance below. |
| **Policy Center** | 🟢 Strong | Versioning, effective dates, acknowledgements, org-unit scoping already done. Files in a **public** bucket (S4). |
| **Chat** | 🟢 Strong | Most elaborate RLS in the system. Leave alone. |
| **Connect (feed)** | 🟢 Fine | — |
| **Onboarding** | 🟠 Hardcoded flow | Should become a **template + activities** checklist (Frappe's `employee_onboarding_template` + `employee_boarding_activity`). This single pattern makes it tenant-customisable without reshaping its tables. |
| **Offboarding** | 🟠 Hardcoded flow | Same template pattern. Clearance steps become configurable activities; add asset return once Assets exists. |
| **Org structure** | 🟠 Partial | `employee_reporting_relationships` is effective-dated and good. **No DB-level cycle guard** — the check is client-side only (**P5**), and any recursive scope query could hang on a cycle. |

---

## 2. Missing, in value order

### 2.1 Performance / Appraisal — **Phase 3**

The largest gap. Nothing exists today. Usually the second-most-requested enterprise module after payroll.

Frappe's model: `appraisal_cycle` → `appraisal_template` → `appraisal_kra` / `appraisal_goal`, plus
`employee_performance_feedback` and `employee_feedback_criteria` for 360° input.

Worth adopting: **cycle as a first-class entity** (an appraisal belongs to a period, exactly like a leave
period), **weighted KRAs summing to 100%**, and **templates per designation** so a company defines
"what good looks like" once per role.

Why it is Phase 3: pure greenfield, so no migration risk. That makes it the right place to prove the
configurability substrate on something new rather than fighting legacy shapes at the same time.

### 2.2 Lifecycle events — **Phase 4**

`employees.status` records *what someone is*, never *what changed and when*. There is no promotion,
transfer, or grade-change record.

Frappe: `employee_promotion`, `employee_transfer`, `employee_grade`.

**This is a payroll prerequisite.** A mid-year salary revision needs a dated event to attach to;
without it, payroll cannot answer "what was this person's structure in August?". Same effective-dating
discipline as the leave ledger and the rule engine.

### 2.3 Timesheets

Billable/project time. Feeds project costing now and payroll later (Frappe links
`salary_slip_timesheet`). Natural extension of Tasks & Projects.

### 2.4 Training & Skills

`employee_skill_map`, `designation_skill`, `expected_skill_set` — skill-gap analysis against the
designation's expected set. Pairs directly with Appraisal; build after it.

### 2.5 Travel & Advances

`employee_advance` + settlement against expense claims. Today expenses are reimbursement-only, so any
advance is tracked outside the system.

### 2.6 Assets

Who holds which laptop. Offboarding clearance already implies this exists — it currently does not, so
clearance is a manual checkbox. Small module, immediate value.

### 2.7 Document compliance

Generalise insurance expiry tracking: contracts, visas, certifications, ID documents — with expiry
alerts. Frappe: `identification_document_type`.

### 2.8 Grievance

`employee_grievance` + `grievance_type`. A compliance requirement in several jurisdictions (including
India's POSH obligations, which need a confidential channel with restricted visibility).

### 2.9 Payroll — **last**

See `README.md` §1. Statutory research plus configuration on a proven rule engine.

---

## 3. Cross-cutting gaps

Not modules, but they affect every module.

| Gap | Why it matters |
|---|---|
| **No test framework** | `06-recommendations.md` §C calls this the top structural risk, and it is still true. Vitest + an RLS policy suite. A cross-tenant assertion would have caught S3; a policy-provenance check would have caught the 2026-08-14 outage. |
| **No error monitoring** | Failures are invisible today. This morning's total outage surfaced as a toast the user had to report. |
| **No cron schedules** | Verified: `schedules list` → none. Anything "daily" or "monthly" — leave accrual, insurance expiry, incomplete-task marking — **is not running**. |
| **Reporting / analytics** | No cross-module reporting layer. Every HRMS is judged on its reports; today each screen queries its own tables. |
| **Notifications** | Table and realtime trigger exist, but delivery is in-app only. **SMTP is not configured**, so no email at all. |
| **Bulk import/export** | Onboarding a 200-person company today means 200 manual creates. This gates real customer onboarding more than any module here. |

---

## 4. Sequencing summary

```
0a  Policy baseline + org text→FK repoint  ← blocks all RLS work
0b  Module registry
1   Organisation Management                ← foundation; grades + unit heads
2   Leave + approval-chain engine          ← substrate proven on a real module
3   Attendance rebuild + rule engine       ← substrate proven on calculations
4   Performance / Appraisal                ← substrate proven on greenfield
5   Lifecycle events                       ← payroll prerequisite
6   Custom fields                          ← designed against real demand
7   Timesheets · Training · Travel · Assets · Doc compliance · Grievance
N   Payroll
```

Cross-cutting work is **not** a phase — tests land with each module, and monitoring, cron and bulk
import are pulled forward the moment a real customer needs them. Bulk import in particular may need to
jump the queue: it gates onboarding a real tenant in a way no module here does.
