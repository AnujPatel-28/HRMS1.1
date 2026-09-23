# Roles, navigation and journeys

Everything below is the **proposed experience**, not a declaration that its backend or UI is complete. Preserve existing authorization contracts. A clearer label must never widen access.

## Organize around responsibilities

One account can hold several responsibilities. Employment, reporting authority, administration and ownership are different facts.

| Person | Starting point | Main questions | Keep out of their way |
|---|---|---|---|
| Employee | My Work → Today | Have I clocked in? What is due? What is happening with my request? | Company setup, device configuration, payroll placeholders |
| Reporting manager | My Work; Team available beside it | Who is away? What needs my decision? Who needs help? | Whole-company data unless separately permitted |
| HR administrator with employment | Administration; My Work always accessible | Which joins, corrections, requests or exits need action? | Switching accounts to do personal work |
| Company administrator without employment | Administration | Is setup complete? Who has access? | Fake personal attendance, leave balances and onboarding |
| Company owner | Administration | Who administers the account? Can ownership be transferred safely? | Automatic assumption that ownership grants every operational action |
| Project manager | Authorized work/project surface | Which project tasks need assignment or review? | Assuming project membership grants employee HR records |
| Communication moderator | Authorized communication surface | Which posts/channels need moderation? | Assuming moderation grants payroll or personal documents |
| Platform operator | Separate platform area | Which tenant needs provisioning or support? | Customer daily work mixed into platform administration |

The last two scoped responsibilities need landing-route tests: the current top-level guards mainly model employment, reporting and company administration. A template existing in the backend does not prove that its frontend destination is usable. Do not offer a responsibility until its supported user journey works.

## Proposed navigation

Use one shell with a persistent responsibility switcher. Show only available surfaces; do not show a switcher for a person with only one. Retain the active company name and current scope. A simple tenant-specific deployment need not add a company-switching workflow unless supported.

| Surface | Primary navigation | Secondary/contextual destinations |
|---|---|---|
| My Work | Today, Attendance, Leave, Tasks, Company | Profile/account in avatar; Directory and Policies under Company; Projects within Tasks |
| Team | Overview, Requests, People, Work | Team attendance/availability; scoped project detail; Request a new hire |
| Administration | Overview, People, Time & Leave, Work, Company settings | Joining/exits under People; shifts/calendars/devices under Time & Leave; Users & Access inside Company settings |

“Time & Leave” is a user-facing group, not a new backend entitlement. Leave-only customers retain Leave and the core work calendar; attendance-only customers retain Attendance and that same calendar. Expenses, if included in a particular pilot, gets its own plain label. No empty Finance group.

Policies and Directory should remain directly reachable through Company; frequently used links can later be pinned based on observed demand. Chat/Connect are optional destinations, not prerequisites to request leave or understand an approval.

On mobile, use four stable destinations for the common employee configuration: **Today, Attendance, Leave, More**. If a module is absent, omit it and use a supported destination such as Tasks; the order should remain stable for that tenant. Team requests need an obvious entry for managers. Keep administrative configuration in the drawer, with the current responsibility shown. Do not put separate desktop/mobile copies of the page content in the DOM.

Preserve existing URLs during incremental delivery. New request queues and query parameters below are proposed additions, not links that are already implemented. Keep redirects and bookmarked notification links working.

## Journey 1 — Company setup to first useful day

**Current pieces:** platform AddCompany, UsersAccess, organization setup, PolicyCenter, locations, shifts, holiday editor and employee creation. These are spread across destinations.

**Proposed sequence:**

1. Named owner accepts invitation; show company and granted responsibility before continuing.
2. A resumable setup checklist asks for company timezone, locations, working days/holidays and essential organization details.
3. Configure only the enabled modules: attendance schedule and capture method; leave types and approvers; task review policy if used.
4. Add a small employee group and verify primary managers. Keep access roles separate from job titles.
5. Preview one employee's applicable schedule and one request's approval path.
6. Send invitations and display per-person progress: invited, accepted, profile pending, ready.

The checklist should say what prevents use and what can wait. “Add your brand logo” must not have the same weight as “Assign a leave approver.” Do not claim a successful email send merely because an invitation record was created.

**Recovery:** expired invite → request/resend a new one; missing approver → name the authorized setup owner; partial setup → save and resume; missing employment link → explain and route to the right administrator. No repeated redirects to sign-in while already authenticated.

## Journey 2 — New hire request to active employee

**Current pieces:** manager AddTeamMemberModal submits a request; HR EmployeeList reviews it; EmployeeCreate is a separate five-step flow; employee onboarding is another flow.

**Proposed sequence:** manager requests a hire → HR reviews → approved request remains in “Setup pending” → HR opens a prefilled employment draft → employee receives invitation → employee supplies required personal information/documents → HR reviews only outstanding items → employee becomes ready.

The request is not an employee record. Creating employment is not the same as enabling login. A completed profile is not automatically employment approval. Show these milestones individually and retain a request-to-employee link.

Employee creation should start with the minimum identity/employment facts and required business configuration, then invite the employee to supply their own information. Avoid making HR coordinate the employee's OTP or choose their password as the normal experience. Existing account-recovery mechanisms need a separately designed support path.

**No payroll:** omit Banking from the default sequence and completion percentage. Collect identity documents only for an explicit company requirement, with a reason. Resume saved sections; mark optional items as optional. Changing the frontend stepper alone is insufficient if backend completion checks still require hidden fields.

## Journey 3 — Start and finish the workday

**Current pieces:** home links to PunchInOut; punch screen handles policy requirements, location/selfie, breaks, task gates and corrections.

**Proposed sequence:** Today shows business date, assigned schedule and current state → Clock in → request necessary permission with an explanation → wait for server acknowledgement → show recorded time → offer Break/Clock out according to state → final record is visible in history.

Do not ask for camera/location until the action needs it. Say why and who can access the evidence. Permission denied, low GPS accuracy, outside permitted location, server timeout and offline are distinct outcomes with distinct next steps. Do not invent offline capture if there is no supported queue and reconciliation behavior.

If the result is uncertain after a timeout, retrieve the current record before encouraging a repeated action. Keep the same authoritative business date and open-session logic across Today and Attendance, including overnight work. A person on partial leave may still work part of the day; do not reuse a whole-day leave message without checking the supported absence contract.

**Manager case:** personal attendance remains available under My Work regardless of team responsibilities. Task review should usually be a separate follow-up, as discussed in finding F07.

## Journey 4 — Correct a missing or incorrect record

Attendance history → select affected day → see recorded in/out and status → Request correction → enter proposed times and reason → preview before/after → submit → see who reviews it and its current state.

Show the permitted correction window and why an older day is unavailable. Overnight times need dates/timezone context. A locked record should identify the escalation route. Approval should show both request outcome and whether the attendance result has updated; a recalculation still in progress must not look complete.

For HR, open the original record, punch evidence and proposed correction together. Preserve the queue's date/filter/scroll position on return. Never send medical leave reasons into ordinary attendance views.

## Journey 5 — Request leave and understand the decision

Leave → Request leave → type and dates → eligible day count and balance impact → required supporting information → reviewer/path preview → submit → tracking detail.

Keep the existing useful balance and working-day previews. Improve them with clear exclusions for holidays/weekly offs, a balance timestamp and a distinction between estimate and confirmed result. Only show half-day/session choices when the end-to-end write path supports them. Do not offer an option because a database field exists.

Tracking should answer: submitted when, waiting for whom, which step, current decision, cancellation eligibility and next action. If no approver is available, show a blocked state and responsible administrator. If policy or balance changed before submission, preserve the draft and explain the new calculation.

For the approver: person, dates, leave type, duration, relevant team coverage and policy context → Approve or Decline with appropriate explanation → updated queue. No self-approval. Private supporting information appears only to authorized reviewers. An aggregated Requests page must reuse domain authorization and approval operations, not introduce a broad new approval endpoint.

## Journey 6 — Assign, submit and review work

Authorized manager assigns owner, due date and expected outcome → employee sees My Tasks → starts work → submits result/evidence → reviewer approves or returns with feedback → employee resubmits → reviewed completion is recorded.

Use **Needs changes** for a returned task if that matches the actual state; keep the stored enum unchanged initially. **Submitted** means waiting for review, not complete. Show reviewer, submitted time and feedback inline. One task detail experience should be reusable from My Tasks, a project and an approval queue. A task that is overdue can also be in progress: distinguish the time warning from the workflow state.

Project management should support this journey without requiring every employee to navigate boards, reports and timelines. Start with list/detail; add complex views only if research shows the need.

## Journey 7 — Policy publication and acknowledgement

Authorized HR chooses document/version, effective date and audience → previews exactly who can see it → publishes → employee sees required action → reads document → explicitly acknowledges → HR tracks outstanding acknowledgement.

Publishing, opening, downloading and acknowledging are different events. Do not count a view as acceptance. Replace similar “Policy Center / Policies / Policy Management” names with **Company settings** for operational rules and **Policies** for employee documents. Keep the underlying ownership intact.

## Journey 8 — Employee changes, transfers and exits

Self profile change → clear distinction between directly editable and HR-reviewed fields → save or submit → show outcome and history. Employment changes such as manager/unit transfer require effective date and impact review; a person's past attendance must not appear to change merely because the current team changed.

Exit request → HR review → confirmed last working day → assigned asset/IT/HR/external-finance clearances → accountable completion → appropriate access revocation and record retention. Separate employment end date from account access decisions. In a payroll-free product, finance clearance records an external status; it does not generate settlement figures.

## Secondary journeys

| Journey | UX requirement |
|---|---|
| Find a colleague | Search by name/team, useful work details, contact action; no sensitive HR fields in directory |
| Chat / Connect | Clear audience before posting, understandable private/project channels, meaningful delivery/error feedback; no technical RLS language |
| Kiosk/device | Administrator-only setup, last successful sync, unmapped employee queue; large employee controls and quick privacy reset after a result |
| Platform provisioning | Module selection and named owner handoff; technical DNS work belongs here, not in employee onboarding |

Device registration is not physical certification. Chat/feed should remain optional if the customer already has a good communication tool. These are source-survey recommendations pending rendered and end-to-end testing.
