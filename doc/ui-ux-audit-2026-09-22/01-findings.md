# Findings and evidence

**Evidence labels:** S = confirmed source pattern; V = visible in the local browser; H = usability hypothesis requiring observation with users. Source line numbers are anchors for this branch snapshot and may move. Priority means recommended product work, not a claim that an unfinished branch should already have passed it.

## Keep these foundations

- Capability-based personal/team/administration access in `src/App.tsx` and `src/contexts/AuthContext.tsx`.
- Module-filtered desktop navigation, route ownership in `src/modules.ts`, and the retry state in `src/shared/RequireModule.tsx`.
- Attendance correction history and recovery paths in `src/employee/PunchInOut.tsx`.
- Attendance and task workspaces that already surface pending work, rather than only charts.
- New-hire requests separated from actual employee creation in the current working changes.
- Employee creation draft recovery and missing-field explanations. These already exist; improve them instead of claiming they are absent.
- Separate employee records, organization structure, reporting relationships and account access. Simplify their presentation without collapsing their meaning.

## Before a customer pilot

### F01 — Home-screen numbers can misrepresent attendance and workload [S, high]

**Evidence:** `src/employee/Dashboard.tsx:47` calculates absence as calendar day-of-month minus one, minus present and leave rows. This does not account for scheduled workdays, holidays, joining date or unknown attendance. Lines 33–34 fetch only five recent tasks/leaves, then calculate pending counts from those samples. `src/hr/Dashboard.tsx:177` subtracts attendance row count from active employee count and labels it “Absent / No Punch.”

**Impact:** Someone can see an alarming absence total on a non-working day, or believe they have fewer outstanding tasks than they actually do. Multiple attendance sessions also make row-count subtraction a poor headcount measure. Exact rendered outcomes depend on data; the problematic formulas are present in source.

**Change:** Use the same canonical attendance result and business-date rules as the operational attendance workflow. Show **Not clocked in**, **Day off**, **On leave**, **Missing record**, and **Absent** as distinct states. Count the complete authorized pending set separately from recent activity. Display unavailable data as unavailable, never zero.

**Acceptance:** Home and attendance agree for a holiday, new joiner, night shift, incomplete device sync and multiple sessions. Six or more pending items produce an accurate count.

### F02 — Optional modules are hidden in some places but still advertised elsewhere [S, high]

**Evidence:** Desktop links are filtered, but employee mobile links to Punch and Tasks are unconditional (`src/employee/EmployeeLayout.tsx:909,918`); HR mobile attendance is also unconditional (`src/hr/HRLayout.tsx:934`). Both dashboards query and display attendance/leave/task information without consulting `hasModule`. `src/shared/RequireModule.tsx` silently redirects disabled modules. `/hr/devices` is registered in `App.tsx` and gated in desktop navigation, but is missing from `ROUTE_MODULES` in `src/modules.ts`.

**Impact:** A user sees a link, opens it, and appears to return home without explanation. A disabled dependency can make a dashboard fail or look empty. The route-map omission is a presentation inconsistency; it does not establish an API authorization bypass.

**Change:** Use one capability/module-derived navigation model for desktop, mobile, home cards and deep links. Gate data requests as well as widgets. Add an explicit “This feature is not available for your company” state for an old bookmark, with a safe way back. Distinguish that from a permissions lookup failure, which needs Retry.

**Acceptance:** Test attendance-only, leave-only, tasks-only and directory-only tenants, plus failed capability loading. No disabled feature appears as a working action or misleading empty panel.

### F03 — The no-payroll boundary does not yet reach the whole experience [S, high]

**Evidence:** `src/employee/OnboardingWizard.tsx:324,490` always includes Banking and “Banking & Final Settlement Info.” `src/hr/EmployeeCreate.tsx:226` requires Aadhaar and PAN to proceed through its identity step. Employee profile/detail contain banking sections. `src/hr/PolicyCenter.tsx:1448,1662` includes salary-deduction and payroll-lock language within Attendance, even though the separate Salary tab is module-gated. `src/hr/HRLayout.tsx:85` retains a “Payroll & Finance” section if Expenses is enabled. Offboarding includes “Finance / Final Settlement.”

**Impact:** Disabling Payroll can still leave users completing financial setup and expecting salary calculations.

**Change:** Define onboarding requirements by the purpose and enabled workflow. Banking must not be a default prerequisite for this release. Do not blanket-remove identity documents if a customer has a justified onboarding requirement; explain purpose, audience and retention. Keep attendance record locking if required, with accurate operational wording. Track external finance clearance explicitly without suggesting TalentMesh calculates a settlement.

**Acceptance:** A new employee can become ready for the supported non-payroll workflows without unexplained banking/tax requirements. Frontend and backend completion rules agree.

### F04 — Access administration exposes engineering scaffolding [S, high]

**Evidence:** `src/hr/UsersAccess.tsx:106–143` shows RPC/edge-function status cards, package implementation messages and a raw one-time acceptance token. Member rows show employee UUIDs and access-version numbers. The selected invitation template defaults to `company_admin` at line 49. `src/App.tsx` registers no invitation-acceptance page, and a source search found no acceptance UI in `src`.

**Impact:** A company owner is asked to understand internal architecture instead of being guided through inviting a colleague. The broad default increases the chance of an unintended role choice. Backend invitation operations may exist; this finding concerns the frontend handoff.

**Change:** Require an intentional role choice with a plain-language permission preview. Provide an invitation link/email journey, expiry, resend/revoke and acceptance feedback. Show name, email, role, scope and account status. Move implementation diagnostics to an internal support surface. Retain honest operational limitations where they affect the customer's action.

**Acceptance:** A named non-employee administrator can accept an invitation and reach Administration without a fake employee record. Expired/replayed invitations give a recovery path. No one handles a raw token as a normal setup task.

### F05 — Team navigation and manager mode describe different contexts [S/H, high]

**Evidence:** `src/employee/EmployeeLayout.tsx:435` sends administrators' Team link to the company directory; other managers go to My Team. `src/hr/HRLayout.tsx:489` also maps Team to directory. `src/hooks/useManagerView.tsx` persists a global manager mode. `src/employee/PunchInOut.tsx:1023` replaces personal punching with “Manager Mode Active.” Leave and task pages also change meaning with that mode.

**Impact:** The same navigation label can mean company discovery or management of direct reports. A manager's own daily action can become unavailable because of a mode selected elsewhere.

**Change:** Keep persistent My Work / Team / Administration context. My Work always means self; Team means the actual permitted team. Make scope visible and derive it from authorization. Do not use a remembered mode to reinterpret a personal route.

**Acceptance:** A person who is both employee and HR admin can clock out, review a direct report's leave and return to their own request without a role toggle or company-wide scope surprise.

### F06 — New-hire approval stops before the next actionable step [S, high]

**Evidence:** Working-tree `src/hr/EmployeeList.tsx:52–64` approves a new-hire request, shows a toast telling HR to use Add Employee, then reloads a panel queried for pending requests only. It does not navigate to a prefilled employee flow. The request may be approved successfully; that is distinct from an employee being created.

**Impact:** The request disappears from the working queue and HR must carry information manually into another flow.

**Change:** Keep an **Approved — employee setup pending** queue with “Continue employee setup,” linked to a prefilled, resumable draft. Distinguish **Request approved**, **Employee created**, **Invite sent**, **Profile submitted**, **Ready to start**. Make retries avoid duplicate employees.

**Acceptance:** Refresh after approval, abandon midway, then resume; the same request remains linked to one eventual employee. Managers see truthful progress.

### F07 — Punch-out can depend on task approval [S/H, high]

**Evidence:** `src/employee/PunchInOut.tsx:1121` applies `tenant.punch_out_gate_enabled` to unapproved tasks. The UI at lines 1212–1245 says HR approval is needed before punching out.

**Impact:** A person trying to record when they stopped working may be blocked by another person's availability. This is a product-policy concern even if the configured gate is technically correct.

**Change:** Recommend a warning and separate pending-work follow-up as the default. If the business explicitly retains a hard gate, show the policy before the end of the shift, identify the blocking items and responsible reviewer, and provide an authorized exception path. Do not silently bypass the server rule or claim the punch was saved.

**Acceptance:** Pending review, absent reviewer and disabled Tasks have an explicit, agreed behavior. A pending submission is never displayed as an approved task.

### F08 — Shared controls need keyboard and status-message work [S, high]

**Evidence:** `src/shared/ConfirmModal.tsx` lacks dialog semantics, focus management and Escape handling; backdrop/close still call `onClose` during submission. `src/shared/components/SelectDropdown.tsx` uses buttons without a complete select/listbox keyboard model. `src/shared/ToastContext.tsx` removes every message after five seconds and has no live-region semantics. Several icon-only controls lack accessible names.

**Change:** Standardize accessible dialog, select and feedback primitives. Keep form failures inline until resolved, focus the first invalid field, announce action results, return focus when a dialog closes and make pending-save dismissal behavior intentional. Native select is appropriate where custom behavior adds no value.

**Acceptance:** Complete leave, attendance correction and access confirmation using keyboard only. Screen reader announces the dialog name, input errors and final result. These are source findings, not a claim that every rendered page fails accessibility.

## Next product iteration

### F09 — Two route outlets mount each page twice [S, medium; investigate runtime impact]

Both layouts render separate desktop and mobile `<Outlet>` instances hidden by CSS (`HRLayout.tsx:865,872`; `EmployeeLayout.tsx:847,868`). CSS hiding does not unmount React components. Duplicate fetches, subscriptions, element IDs and side-effectful initialization are possible; their runtime volume was not measured.

Use one mounted content outlet and responsive surrounding navigation. Verify a single page initialization and no duplicate event subscription before/after resizing.

### F10 — Navigation offers too many competing mechanisms [S/H, medium]

Both layouts support `dropdown` and `double_sidebar`, section navigation, topbar page selection and mobile drawers; labels still say HR Portal and Employee Portal. Maintain one predictable expanded navigation pattern initially. Keep optional density preferences for later. Nested employee/project routes should retain parent highlighting and a meaningful Back destination; exact href comparisons in layouts make this worth testing.

### F11 — Similar destinations have unclear distinctions [S/H, medium]

Examples: Employees vs Directory; Policy Center vs Policies; Attendance Overview vs Attendance; Holidays vs Calendar vs a Holidays tab inside Leave Management. These destinations can have legitimate different purposes. Clarify them: **People** administers employment; **Directory** finds colleagues; **Company settings** configures rules; **Policies** contains readable documents. Prefer one holiday editor with contextual links.

### F12 — Workflows vary in vocabulary and failure recovery [S, medium]

Punch pages mix Punch, Clock and Regularization; task states use Rejected where the next action can be revision; leave rejection reasons are required in the manager UI and optional in the HR UI. Chat contains an error mentioning legacy department lists and RLS. New-hire request load failure is console-only and can resemble an empty queue. Standardize words and response handling without changing the underlying workflow rules accidentally.

### F13 — Visual emphasis is spent on nearly everything [S/H, medium]

Employee home uses repeated `shadow-xl`, lifted cards, multicolored tiles and pulsing indicators (`Dashboard.tsx:82–174`). Both shells use decorative backgrounds; HR home adds an illustrated banner. This can compete with urgent actions. Retain the green identity, simplify operational backgrounds, reduce shadows and give color a consistent state meaning. Actual full-screen balance still needs authenticated visual QA.

### F14 — Leave asks for a document without giving a clear submission path [S, medium]

`src/employee/MyLeaves.tsx:498` calls a supporting document “required,” then says HR may ask for it and to keep it ready. The inspected apply form has no attachment field. Agree the real requirement with the backend contract: either provide a private upload and submission status, or state accurately when/how HR requests the document. Never encourage uploading sensitive documents to a public feed or ordinary chat.

### F15 — Authentication language is behind the role direction [V/S, low]

The rendered sign-in screen is compact, with a clear main action and password recovery. “Use your HR or employee credentials” is unnecessary role jargon. Prefer “Sign in with your work email.” Source routing remains based on a legacy role while downstream guards use capabilities; verify landing/recovery behavior once the branch tenant is ready. The observed sign-in error is not classified as a login defect.

## Evidence coverage

| Area | Reviewed evidence | Remaining verification |
|---|---|---|
| Sign-in and recovery | Login source, rendered desktop sign-in | Actual sign-in, OTP, recovery and invitation acceptance |
| Navigation and roles | App, AuthContext, TenantContext, both layouts, module map, manager provider | Role combinations, revocation, deep links, mobile navigation |
| Home | Both dashboard implementations | Correct figures against canonical test records |
| People and onboarding | EmployeeList changes, EmployeeCreate validation/drafts, onboarding wizard, profile/detail sections, new-hire modal/MyTeam | Complete create/review/activation/transfer sequence |
| Attendance and leave | Punch workflow, correction states, AttendanceWorkspace, leave forms/review, policy sections | Server outcomes, night shifts, half days, missing approvers, offline recovery |
| Work | MyTasks actions/states, TaskWorkspace, project list/detail sections | End-to-end submit/return/resubmit/review and project scope |
| Administration | UsersAccess, organization setup sections, policy center and policy document surfaces | Invite completion, owner transfer, effective settings, private document access |
| Secondary surfaces | Directory, offboarding, Chat, Connect, devices/kiosk and platform provisioning source sections | Rendered UX and each write journey; physical device testing |
| Excluded modules | Payroll route ownership and visible references; expense/insurance navigation | Full expense, insurance and payroll workflows intentionally not audited |

No aggregate “UX score” is assigned. Without observed task completion, a numerical score would imply evidence this review does not have.
