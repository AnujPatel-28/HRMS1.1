# 07 — Market benchmark & workflow correctness

Benchmark date: 2026-08-12. This system is clearly **India-focused** (PF, ESI, TDS, Professional Tax by state, `date_of_joining` tenure rules), so the primary comparison set is Indian SMB HRMS — **Keka, greytHR, Zoho People, Darwinbox** — with **BambooHR** as the global core-HRIS reference.

## 1. Where TalentMesh sits

| Tier | Products | TalentMesh vs them |
|---|---|---|
| Enterprise | Workday, Darwinbox, SAP SuccessFactors | Not competing — those are 500–50k+ employee, multi-entity, deep analytics/AI. |
| **SMB India (target)** | **Keka, greytHR, Zoho People, Zimyo** | **This is TalentMesh's lane.** Feature breadth is competitive; maturity/compliance depth is behind. |
| Global core HRIS | BambooHR, Rippling, Deel | TalentMesh is broader than BambooHR on attendance/payroll-India, narrower on performance/integrations. |

**Verdict:** As an SMB-India HRMS, TalentMesh has a **genuinely competitive feature footprint** — in some areas (geo/selfie attendance, built-in chat, PMS) it's *ahead* of greytHR. What separates it from Keka/Zoho is **module depth, configurability, and statutory completeness**, plus the security/testing gaps in the audit.

## 2. Feature completeness vs the standard HRMS module set

✅ = present & working, 🟠 = partial, ❌ = missing

| Module | TalentMesh | Keka/Zoho/greytHR standard |
|---|---|---|
| Core HR / employee records | ✅ | ✅ |
| Org structure + org chart | ✅ | ✅ |
| Onboarding (wizard, draft→active) | ✅ | ✅ |
| Offboarding + exit clearance | ✅ | ✅ |
| Attendance: punch, breaks, overtime | ✅ | ✅ |
| **Geo-fenced + selfie attendance** | ✅ | 🟠 (often add-on) — *TalentMesh ahead* |
| Shift management | ✅ | ✅ |
| Attendance regularization/corrections | ✅ | ✅ |
| Leave: types, balances, accrual, approval | ✅ | ✅ |
| Holidays / calendar | ✅ | ✅ |
| Payroll incl. PF/ESI/TDS/PT | ✅ (client-side calc) | ✅ (server-side, statutory-maintained) |
| Payslips | ✅ | ✅ |
| IT / tax declarations | ✅ | ✅ |
| Expenses / reimbursement | ✅ | ✅ |
| Insurance | ✅ | 🟠 (often benefits module) |
| Policy management + acknowledgment | ✅ | ✅ |
| **Internal chat / comms** | ✅ | ❌ mostly — *TalentMesh ahead* |
| **Project management (PMS)** | ✅ | ❌ mostly — *bonus* |
| Notifications | ✅ | ✅ |
| Multi-tenant / multi-company | ✅ | ✅ |
| ID cards | ✅ | 🟠 |
| **Performance mgmt (goals/OKR/appraisal/360)** | ❌ | ✅ **← biggest gap** |
| **Recruitment / ATS** | ❌ (separate product) | ✅ (Keka/Zoho bundle it) |
| **Learning & Development / LMS** | ❌ | 🟠 (Rippling/Darwinbox) |
| **Reports & analytics / custom reports** | 🟠 dashboards only | ✅ |
| **Multi-level / configurable approval workflows** | 🟠 single-level | ✅ **← notable gap** |
| Full-&-final settlement automation | 🟠 | ✅ |
| **Form 16 / statutory returns (ECR, ESI)** | ❌ | ✅ **← compliance gap** |
| Bank salary-disbursement file | ❓ verify | ✅ |
| Loans / salary advances | ❌ | 🟠 |
| Biometric device integration | ❌ (geo/selfie instead) | ✅ |
| Native mobile app | ❌ (responsive SPA) | ✅ |
| e-Signature on documents | ❌ | 🟠 |
| Employee surveys / eNPS | ❌ | 🟠 |
| Helpdesk / HR ticketing | ❌ | 🟠 |

**Takeaway:** Core operational HR (attendance, leave, payroll, lifecycle) is **fully covered and competitive**. The gaps that matter for winning SMB deals against Keka/Zoho are, in priority order:
1. **Performance management** (goals/appraisals) — the #1 expected module you don't have.
2. **Configurable multi-level approval workflows** (manager → HR chains).
3. **Statutory completeness** — Form 16, ECR/ESI return files, F&F automation.
4. **Reports & analytics** beyond dashboards.

## 3. Is the working / flow correct?

Traced from the actual code (see `03-modules.md`). Flow-by-flow:

| Flow | Correct? | Notes |
|---|---|---|
| **Auth / login** | ✅ | Role + tenant resolved from JWT, pre-active/suspended guards at login **and** mid-session. Sound. |
| **Employee lifecycle** (draft → onboarding → active → exit) | ✅ | State machine is coherent; status guards enforced; password set via guarded RPC. |
| **Leave** apply → approve | ✅ **correct & robust** | Transactional, row-locked, balance-safe, overlap/notice/tenure validated, auto-writes attendance on approval. Best-built flow. **Limitation:** single-level (HR-only) approval — no manager-approval step before HR, which larger orgs expect. |
| **Attendance** punch/break/correction | ✅ logic correct | But geo-fence + `work_hours` are **client-trusted** (S5) — a correctness/integrity gap, not a logic bug. |
| **Payroll** structure → run → payslip | ✅ math correct | LOP proration, PF/ESI ceilings, PT-by-state, anomaly normalization all correct in `payroll-calc.ts`. **But** it runs **client-side** with no server recomputation — correctness depends on the HR browser; won't scale to thousands (see scalability note). |
| **Offboarding** exit → clearance → complete | ✅ flow correct | Undermined by clearance tables having **RLS off** (S3). |
| **Chat** channels/messages | ✅ | Membership + sender identity enforced in RLS. Correct. |
| **Tasks/PMS** assign → submit → approve | ✅ | Visibility model + HR/self policies correct. |

**Bottom line on correctness:** The **business logic and workflows are correct** — genuinely well-modelled, especially leave and lifecycle. The problems are not "the flows compute the wrong thing." They are: (a) **trust boundaries** (attendance hours, payroll math, and clearance data trust the client / lack server enforcement), and (b) **workflow depth** (single-level approvals vs the configurable multi-level chains competitors offer). Fix the trust boundaries (audit S3/S5 + server-side payroll) and add manager-level approvals, and the *working* is on par with SMB-India incumbents.

## 4. Honest one-paragraph positioning

TalentMesh is a **broad, well-built SMB-India HRMS** whose day-to-day operational modules (attendance, leave, payroll, lifecycle, plus bonus chat/PMS) are feature-competitive with greytHR/Zoho and correct in their logic. It is **not yet enterprise-grade** and trails Keka/Darwinbox on **performance management, configurable workflows, statutory-filing depth, analytics, and — critically — production security hardening and automated testing**. Close the audit's S1–S4, add server-side payroll + multi-level approvals + a performance module, and it's a credible commercial product for the sub-500-employee market.

---
**Sources:** market landscape from [Keka](https://www.keka.com/best-hr-software-in-india), [HROne](https://hrone.cloud/blog/best-smb-hrms-india/), [PocketHRMS](https://www.pockethrms.com/best-hrms-software-in-india/), [TechnologyAdvice](https://technologyadvice.com/human-resources-software/), [Paylocity](https://www.paylocity.com/why-paylocity/compare/lists/best-hr-software/). Feature/flow assessment from this repo's source + live DB.
