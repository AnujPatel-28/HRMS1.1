# What TalentMesh should learn from other HRMS products

**Research date:** 22 September 2026. **Products:** HROne, Frappe HR, Keka, Zoho People, BambooHR and HiBob. **Decision:** improve TalentMesh's daily workflows and navigation; this research does not justify a full rebuild.

This supplements the [source audit](01-findings.md) and [no-payroll launch plan](04-launch-without-payroll.md). It is a product-design study, not a vendor ranking or purchasing recommendation.

## Evidence and limits

I reviewed official workflow documentation and product pages, selected Frappe source files and public issues, and dated user feedback. I visually inspected an official BambooHR home-screen image and the clearly rendered navigation in an official Zoho mobile guide image. Those published images are references, not proof of the newest live interface. Other visual conclusions are limited to documented structure; I did not use authenticated competitor accounts or benchmark their usability.

Official descriptions establish intended functionality, not measured ease of use. Individual reviews identify useful failure scenarios, not defect prevalence. Some review text was available through search results when the review page would not render. Frappe files were read from the mutable `develop` branch, not a pinned release, and were not executed. TalentMesh's unfinished branch still needs a configured test tenant for its own walkthrough.

## The useful comparison

| Product | Useful pattern | Apply to TalentMesh | Avoid copying |
|---|---|---|---|
| HROne | A central action inbox | One place to review requests, with owner, age and next action | A mixed stream where announcements obscure decisions |
| Frappe HR | Check-in, shortcuts and personal/team requests close together | A compact daily home and consistent request cards | An unfiltered catalog containing disabled payroll features |
| Keka | Attendance, leave, balances and history grouped around personal time | Put correction and leave actions beside the records they affect | Several similar attendance actions with unexplained terminology |
| Zoho People | Explicit personal, team and organization spaces | Keep personal work separate from supervisory work | Too many navigation levels and configuration choices at first use |
| BambooHR | Clear time-off action beside balances; attention items on home | Present relevant actions before general metrics | Turning every role's home into a configurable reporting project |
| HiBob | Lifecycle tasks with owners and handoffs | Connect approved hiring requests to onboarding progress | A task system where HR cannot see the complete journey |

These are design choices to test, not proof that the products are uniformly simple or difficult.

## 1. HROne: make the next decision easy to find

**Verified strength.** HROne presents its Inbox as a common workspace for HR tasks, requests and approvals. This supports a useful principle: people should not need to visit every module to discover pending work. Its “three clicks” language is a vendor claim, not a result measured in this review. [Official Inbox description](https://hrone.cloud/inbox-for-hr/)

**Reported friction.** Historical Google Play reviews include an August 2025 report of slow startup/location acquisition and another about navigating previous attendance days after an update. These are individual reports on a historical listing, not evidence that the current app still has those defects. They suggest that attendance reliability and history deserve as much attention as dashboard styling. [HROne listing and reviews](https://play.google.com/store/apps/details?hl=en-GB&id=com.hrone.android&raii=com.hrone.android)

**TalentMesh adaptation.** Give managers a Requests view with pending, returned and completed states; show employee, request type, requested dates, waiting time and the information needed to decide. Open the full record without losing queue position. Keep announcements in a separate section. Bulk approval should be limited to suitable, sufficiently explained cases, with an explicit summary and individual failures shown.

**Do not copy:** a universal click-count target. A consequential approval may need a review step; a routine clock-in should need little effort. Measure successful completion and understanding instead.

## 2. Frappe HR: borrow the structure, study the tradeoffs

Frappe is particularly useful because its public repository lets us compare product claims with implementation. The inspected employee frontend is distinct from the broader Frappe Desk administration interface. [Repository](https://github.com/frappe/hrms)

**What the inspected code does:**

- The employee home composes a check-in panel, quick links and a request panel. Links include attendance, shifts, leave, expenses, advances and salary slips. This is a concrete daily-work structure, but its feature selection is unsuitable to copy directly into a payroll-free TalentMesh. [Home.vue](https://raw.githubusercontent.com/frappe/hrms/develop/frontend/src/views/Home.vue)
- The request panel separates **My Requests** and **Team Requests**, combining several request types while retaining their individual components. It sorts by creation date and limits the combined preview to ten. That is a preview, not proof of a complete approval queue; an older urgent item could fall outside that preview. [RequestPanel.vue](https://raw.githubusercontent.com/frappe/hrms/develop/frontend/src/components/RequestPanel.vue)
- The check-in panel shows the last recorded event and a history link, uses a confirmation dialog, and provides loading/success/error feedback. Location presentation depends on settings. Its technical geolocation error text is a reminder to translate failures into useful instructions. [CheckInPanel.vue](https://raw.githubusercontent.com/frappe/hrms/develop/frontend/src/components/CheckInPanel.vue)

**Navigation lesson.** A December 2024 issue proposed flattening HR navigation because workspace parents contained redundant information; the issue is closed. This supports removing unnecessary levels, but does not establish the exact behavior of every released version. [Flatten sidebar issue](https://github.com/frappe/hrms/issues/2521)

**Reported friction.** An April 2026 community discussion describes users struggling to discover a sidebar collapse control after an upgrade. A separate May 2026 framework issue reports missing navigation on certain deep links, with browser differences and an unresolved underlying explanation. These concern the shared Desk/framework experience, not a reproduced defect in the employee frontend. [Sidebar discussion](https://discuss.frappe.io/t/workspace-sidebar-toggle-issue/162149), [deep-link issue](https://github.com/frappe/frappe/issues/39085)

**TalentMesh adaptation.** Keep Today compact: current attendance state, the next useful action and request updates. Let employees inspect their own requests and managers inspect their team's without a global mode unexpectedly changing personal actions. Use a full, filterable queue behind any home preview. Counts must come from complete scoped data, not the visible sample—especially relevant to finding F01.

**Do not copy:** raw error codes as the main message, payroll shortcuts in an inactive module, or clever hidden navigation controls. Attendance state must also follow TalentMesh's actual shift and overnight rules; copying a frontend toggle is not a substitute for those rules.

## 3. Keka: keep time-related actions beside their context

**Verified strength.** Keka's mobile guide groups Attendance, Leave and Upcoming Holidays under personal Time. It documents clocking, logs, requests, balances, leave application and request history. This reduces the distance between “what happened?” and “what can I do about it?” [Mobile time guide](https://help.keka.com/hc/en-us/articles/39946863995153-Manage-Your-Leave-Attendance-with-the-Keka-Mobile-app)

**Design tradeoff.** The same guide exposes several attendance actions through a three-dot menu, including adjustments and regularization. Those have distinct business meanings in Keka, but importing the vocabulary without explanation would add complexity. This is a design risk inferred from the documented workflow, not a measured failure.

**Reported friction.** A search-accessible October 2025 Google Play review describes difficulty acquiring location during clock-in. It is historical anecdotal feedback, not a current performance measurement. [Keka listing and reviews](https://play.google.com/store/apps/details?id=com.keka.xhr)

**TalentMesh adaptation.** On an attendance day, show recorded events, the detected issue and a plain-language action such as **Request a correction**. Explain which policy exception is being requested inside the form. Place the resulting request and its status beside that day. On Leave, show available balance and upcoming absences before the form.

**Do not copy:** every attendance exception as a separate top-level feature. Expose only the policies enabled for that employee, and make a frequently used correction action visible rather than hiding it in overflow.

## 4. Zoho People: explicit context helps; configuration can overwhelm

**Verified strength.** Zoho documents My Space, Team Space and Organization Space, with access and enabled services influencing available areas. The mobile guide includes personal actions, team approvals and a leave preview before submission. The inspected guide image visibly separates spaces and their tabs. [Mobile guide](https://help.zoho.com/portal/en/kb/people/mobile/mobile-app-guide/articles/zoho-people-mobile-application-help-guide)

**Design tradeoff.** Spaces plus a long horizontal tab row can still leave users hunting for functions. The guide's breadth demonstrates why clear role context alone does not guarantee a simple interface. TalentMesh should use the context pattern without reproducing the entire navigation structure.

**Reported friction.** Search-accessible Capterra reviews dated August and September 2026 praise centralized HR work while describing complicated setup, settings spread across areas and extra navigation steps. These are individual experiences, not a representative study; the full page did not render during this research. [Zoho People reviews](https://www.capterra.com/p/110931/Zoho-People/)

**TalentMesh adaptation.** Continue the proposed My Work, Team and Administration structure. Give each space a short stable navigation set. For HR setup, explain dependencies in order: organization details → people and managers → work calendar/shifts → leave/attendance rules → invitations. Show what remains incomplete and which employee journey it affects.

**Do not copy:** a configuration-first employee experience. A new employee should complete their own setup, not understand the employer's policy engine. Do not add a mandatory role chooser when an obvious default and a visible context switch will suffice.

## 5. BambooHR: make the important action visually obvious

**Verified strength.** An official home-screen image places time-off balances beside a prominent request action, with attention items arranged separately. The related product update describes permission-sensitive widgets and reporting access. The useful visual lesson is action hierarchy and adjacency, not the particular green banner or card shapes. [Home redesign description and image](https://www.bamboohr.com/product-updates/introducing-insights-dashboard-and-a-redesigned-home)

**Additional pattern.** A product update describes home attention cards for requests and documents. TalentMesh can use this attention pattern without introducing an AI assistant. [Attention-card description](https://www.bamboohr.com/product-updates/bamboo-ai)

**Evidence boundary.** This research did not establish a sufficiently verified, current recurring BambooHR usability defect. That is not a clean bill of health. Rather than manufacture a weakness, the relevant design risk is our own inference: configurable widgets can create setup work and hide priorities if introduced too early.

**TalentMesh adaptation.** Show leave balance next to Request leave. Show the current attendance state next to Clock in/out. Give each role a useful default home. Keep reporting available to people who need it, without making chart configuration part of first use.

**Do not copy:** a large ornamental welcome area that pushes the daily action below the fold, or a dashboard-builder project before the underlying workflows are reliable.

## 6. HiBob: onboarding is a handoff, not just a profile form

**Verified strength.** HiBob describes lifecycle workflows with triggers, conditional routing, assignments and progress visibility across teams. Its onboarding material includes documents and IT preparation alongside employee setup. These are intended product capabilities; they were not tested here. [Workflow automation](https://www.hibob.com/platform/core/automation/), [onboarding](https://www.hibob.com/solutions/small-businesses/onboarding-software/)

**Reported friction.** A July 2025 G2 review describes tasks as spread out and asks for better oversight of assignments. This was available in search-indexed review text; the full page would not render. Review platforms contain self-selected and sometimes incentivized submissions, so this is a scenario to investigate, not proof of broad customer dissatisfaction. [HiBob reviews](https://www.g2.com/products/hibob-hris/reviews?page=8)

**TalentMesh adaptation.** After a new-hire request is approved, create or link a prefilled employee draft, preserve the originating request and show the next owner. Track invitation, employee information, documents and assigned preparation tasks in one journey. This directly strengthens finding F06: approval must not be the point at which HR loses the work.

**Do not copy:** a general workflow builder before a simple default onboarding journey works. HR should be able to answer “Who is waiting for whom?” without opening every task.

## What this changes in the TalentMesh proposal

The original recommendation stands: **a substantial redesign of the shell and key journeys, with selective reuse of existing components and domain logic.** Competitor research adds stronger support for making Requests a first-class experience.

| Priority | Concrete change | Why it belongs before cosmetic work |
|---|---|---|
| First | Fix scoped counts and enabled-module consistency | A polished home must not misstate attendance or expose unavailable work |
| First | Complete invitation, personal setup and role landing | First use determines whether the rest of the product is reachable |
| First | Build My Requests and a complete reviewer queue | People need status and ownership across modules |
| First | Make attendance capture and correction understandable | A failed or ambiguous punch affects the user's daily confidence |
| Next | Link hiring approval to onboarding | Preserve context across owners and stages |
| Next | Apply common page, form, table and feedback patterns | Visual consistency should support the now-consistent workflows |
| Later | Advanced widgets, custom workflow builders and AI assistance | These introduce scope without resolving the core launch journeys |

Requests should have common summary fields—type, subject, status, submitted date, owner and next step—but retain domain-specific detail. A leave decision needs dates and balance; an attendance correction needs recorded and requested times. A uniform card must not remove the information needed to decide.

## How this works without payroll

None of these useful patterns requires TalentMesh to calculate salaries. Position the initial product around **people records, attendance, leave, approvals and onboarding**, with enabled task workflows where they serve the intended customers.

Remove payslip/salary-run navigation and payroll-dependent onboarding requirements from the no-payroll experience. Do not remove operational absence or attendance information merely because another product uses it downstream for payroll. Explain that approved records can be handed to the organization's existing payroll process; do not imply salary calculation, statutory processing or automatic reconciliation.

The month-end journey should be: review outstanding corrections → resolve or explicitly flag exceptions → select the period and employees → preview records → export a dated handoff. Show unresolved items and the period covered. Export/reconciliation behavior is a proposed requirement, not a claim that it already exists in this branch. See the [launch plan](04-launch-without-payroll.md) for scope and gates.

## Tests to borrow from the competitors' pain points

These are proposed validation scenarios, not tests run during this study.

| Scenario | What success means |
|---|---|
| Location is denied or slow during clock-in | The user understands the state, sees policy-appropriate recovery, and cannot accidentally create duplicate punches |
| A submission times out after reaching the server | Retry or refresh reveals the recorded outcome; the UI does not silently duplicate the request |
| More than ten requests exist, including an older urgent one | The full queue exposes it; preview counts and filters remain accurate |
| A manager requests their own leave, then reviews a reportee's leave | Context and permissions are clear, with no accidental loss of personal actions |
| A user opens a copied nested URL, refreshes and presses Back | Navigation remains usable and context is preserved across supported browsers |
| HR approves a hire and another person continues onboarding | The draft, source request, owner and remaining work stay linked |
| Payroll and another optional module are disabled | Menus, shortcuts, forms and relevant data loading consistently respect the configuration |
| A new employee uses a narrow screen or keyboard only | Core actions remain discoverable, operable and understandable |

Recruit fresh employees, managers and HR operators for these tasks after the branch and test tenant are ready. Observe completion, wrong turns, requests for help and whether users can explain the resulting status. Record failed steps rather than declaring success from a subjective “looks clean” rating.

## Visual direction: a working product, not a generic dashboard

Use real employee decisions to organize the screen. Prefer a restrained green accent, readable type, compact tables where comparison matters, and a clear primary action. Give more visual weight to a pending decision than to a decorative greeting. Use calm status language and reserve strong color for meaningful exceptions.

Do not copy a competitor's full sidebar, ornamental metric cards or feature inventory. The best synthesis for TalentMesh is **HROne's action focus, Frappe's compact daily structure, Keka's contextual time workflows, Zoho's clear workspaces, BambooHR's action hierarchy and HiBob's visible handoffs**. Validate that combination with your actual roles and rules before expanding the redesign.
