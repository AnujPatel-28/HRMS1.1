# Launching TalentMesh without payroll

## The product can stand on its own

**Yes, TalentMesh can launch without payroll** if it delivers a dependable people-operations loop and makes the external payroll handoff explicit. That is a product recommendation, not evidence that this branch is ready today.

Proposed positioning: **“Employee records, attendance, leave and everyday approvals in one clear workspace.”** Add work/tasks to the promise for pilots that actually need it. Avoid advertising a complete payroll or statutory-processing suite.

The initial customer hypothesis is a small or growing organization that already uses an accountant or payroll tool but struggles with employee records, attendance corrections and scattered requests. Validate this with pilot customers; company size alone does not establish demand. Customers looking primarily for salary calculation and filings are a poor fit for this first release.

There is no need to call the product “HRMS Lite” or fill the sidebar with unavailable Payroll cards. A focused scope should feel complete for the jobs it promises.

## Proposed release boundary

| Area | First pilot recommendation | Condition |
|---|---|---|
| Company/account foundation | Include | Named users, correct tenant context and recoverable access |
| Employee records and directory | Include | Necessary fields, clear employment/account states, safe sensitive-data access |
| Joining/onboarding | Include | Invitation-to-first-use complete; no unexplained finance prerequisites |
| Calendar, attendance, corrections | Include for time-tracking pilots | Agreed schedules, reliable records, clear exceptions |
| Leave | Include | Approvers, balance/day calculation and cancellation verified |
| Company policy documents | Include | Audience, private file access and acknowledgements verified |
| Tasks/projects | Include for the existing non-payroll workstream if needed and verified | Keep secondary in employee home; no accidental attendance dependency when disabled |
| Exits | Include a bounded workflow | Clearances and access lifecycle; finance handled externally |
| Chat/Connect | Optional | Do not make them necessary for core approvals; isolate audiences correctly |
| Expenses | Optional separate scope decision | Claim/approval behavior and external reimbursement ownership clearly stated |
| Kiosk/biometric devices | Conditional | Only the specific tested path/device; no unsupported hardware promise |
| Payroll, payslips, salary setup, tax declarations | Exclude | No actions or promises implying calculation/payment |
| Insurance | Exclude for consistency with the existing no-payroll roadmap | Reassess separately after the pilot |

This is a recommended customer-facing package. It does not silently reduce the accepted M1/M2 engineering scope. If an optional module is deferred or disabled, record that decision and its unpassed acceptance criteria in the existing workstream.

## What “payroll off” must mean

Turning off sidebar links is only one part of the work.

1. **Entitlements and routes:** payroll and insurance disabled for pilot tenants; direct URLs and API operations behave consistently. Keep history intact. This review did not inspect live entitlements.
2. **Navigation and home:** no Payroll & Finance label left above an Expenses-only group; no payslip/tax cards or empty salary summaries.
3. **Onboarding:** banking is not a universal step. Identity requirements are purposeful and agreed, rather than copied from a payroll checklist.
4. **Profile readiness:** completeness and activation rules do not require hidden payroll fields. Retain existing confidential values securely; hiding fields is not a data migration.
5. **Attendance policies:** late arrival/working-time rules remain operational. Salary deduction controls are absent. If record locking is still required for a reviewed period, explain it as record locking and preserve the real enforcement semantics.
6. **Leave:** paid/unpaid can describe a company leave category without calculating pay. Do not promise a rupee deduction or net salary impact.
7. **Overtime:** record and review hours where supported; do not imply overtime payment has been calculated or made.
8. **Exits:** rename the finance stage to “External finance clearance” where applicable and show its owner. An HR checkmark is not a calculated or paid settlement.
9. **Jobs and notifications:** no automatic payslip generation, salary reminders or payroll messages in this package. Check actual jobs before rollout, rather than assuming UI gating affects them.
10. **Commercial and support language:** onboarding material, demos and support scripts describe the same boundary. Be direct before signup about the customer's external payroll responsibility.

All server changes remain implementation work subject to the repository's InsForge documentation, migration and verification rules. This pack does not change backend configuration.

## Month-end handoff to the customer's current process

Without a dependable handoff, removing payroll can simply move complexity into spreadsheets. Define an **Attendance and leave handoff** for the person preparing payroll elsewhere.

Proposed journey:

```text
Choose period and employee scope
    → inspect missing records and pending corrections
    → review unresolved items with named owners
    → reconcile period totals
    → export a dated/versioned handoff
    → external accountant/payroll tool processes pay
```

The combined handoff is a proposed capability; the existence of individual CSV exports does not prove this workflow is complete.

Minimum agreed export fields: stable employee code; employee name; period and company timezone; joining/leaving dates where relevant; scheduled working days; canonical attendance categories; approved leave days/fractions by agreed category; reviewed overtime hours if in scope; unresolved exception count; generated timestamp and export version. Do not include medical reasons, unnecessary documents or bank details in a routine attendance export.

Do not add a “payable days” or deduction formula until the receiving payroll process and calculation ownership are explicitly agreed. Correctly handling weekly offs, holidays and partial leave must come from the canonical rules, not a new client-side spreadsheet calculation.

Show a preview and a clear scope count before export. An authorized user should be able to explain what each column means. Prevent spreadsheet formula execution from user-controlled strings when implementing CSV export. Apply export permissions independently from ordinary directory access.

If a correction arrives after handoff, generate a clearly identified replacement/delta according to the agreed process. Keep the original export traceable. Do not silently change an already-issued file or claim that an external payroll tool has synchronized when the process is manual.

Suggested copy: **“Attendance and leave records for your payroll team. Salary calculation and payment are handled outside TalentMesh.”** Put this at handoff and in product scope material, not as a warning repeated throughout employee screens.

## Rollout sequence

### 1. Complete the branch baseline

Identify the intended frontend revision and backend branch, provision a tenant with the new-role configuration, and establish named test personas. Compare frontend capabilities with the deployed contract. Do not infer applied migrations from local filenames. Keep the existing engineering release process and reviewer acceptance requirements.

### 2. Run an internal end-to-end candidate

Use synthetic people. Complete company setup, invitation, onboarding, daily attendance, leave, review, correction, task submission and exit scenarios. Include non-employee admin and multi-responsibility users. Treat hardware coverage separately.

### 3. Pilot with a small named cohort

Suggested starting experiment: two or three organizations with a clearly supported working pattern and an existing payroll process. Choose by fit and support capacity, not this document's arbitrary company-size threshold. Agree scope, support owner, baseline process and exit criteria before collecting real operational data.

Observe at least one full attendance/leave handoff cycle before broader rollout. A polished demo is insufficient evidence of month-end usability.

### 4. Expand only after the core loop is reliable

Add more teams, work patterns or devices one at a time. Keep feature flags for optional modules. If a shared access or data-integrity problem appears, stop expansion; hiding a feature does not remedy compromised records. Preserve audit/history and the customer's prior operational process during rollback.

## Scope decisions to record before implementation

- Are Expenses included in the first customer pilot, and who records reimbursement outside TalentMesh?
- Which onboarding documents are actually necessary, for which employee types, and why?
- Is the task-to-punch-out gate being changed to a warning, or kept with a supported exception process?
- Which shifts, leave fractions and physical devices have a complete tested journey?
- What exact columns and corrections process does the first customer's payroll preparer need?

These decisions can be made with product owners during implementation. They are not reasons to postpone the source audit or a request for approval of changes that have not been built.
