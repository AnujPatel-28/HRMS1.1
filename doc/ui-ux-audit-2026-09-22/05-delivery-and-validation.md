# Delivery plan and validation

## Work in slices, not a wholesale reskin

Implement one complete journey through the shared shell and components before applying its pattern elsewhere. Keep current domain operations and server-side enforcement. Every new interaction needs loading, empty, error, permission-denied and successful states.

| Order | Package | Main touchpoints | Definition of done |
|---|---|---|---|
| 0 | Establish a working branch tenant | Existing backend/frontend release process | Revision/contract recorded; role personas can sign in; selected modules known |
| 1 | Trust and module consistency | Both Dashboards, modules.ts, RequireModule, both layouts | Canonical attendance/counts; module-aware queries/cards/mobile links; recoverable unavailable states |
| 2 | No-payroll boundary | OnboardingWizard, EmployeeCreate, MyProfile, EmployeeDetail, PolicyCenter, offboarding, layouts | No required hidden finance fields or misleading salary actions; retained operational rules verified |
| 3 | Shell and shared controls | HRLayout, EmployeeLayout, sidebar, ConfirmModal, SelectDropdown, ToastContext | One content outlet; stable contexts; keyboard/focus/status behavior; consistent mobile navigation |
| 4 | Invitation and new-hire completion | UsersAccess, Login/App routes, EmployeeList, EmployeeCreate, MyTeam | Usable acceptance/recovery; intentional role choice; approved request continues to a linked employee |
| 5 | Daily employee loop | Today, PunchInOut, MyLeaves, MyTasks | Clear next action and confirmed outcome; preserved draft/context; agreed punch-out policy |
| 6 | Manager/HR decisions | Team, leave/correction/task queues, detail panels | Accurate counts, correct scope, reviewer/state visibility, stale-action recovery |
| 7 | Handoff and secondary polish | Authorized exports, settings, directory, policy documents, optional communication | Agreed month-end output; coherent secondary screens; no broken enabled journey |

Order reflects dependencies and product risk, not fixed sprint duration. Do not promise a completion date until the branch baseline and unfinished backend contracts are known. The visual changes in package 3 can be prototyped while backend completion continues; no parallel agent execution is assumed by this plan.

## Prioritized backlog

| Item | Priority | Relative size | Dependencies | Evidence |
|---|---|---|---|---|
| Replace absence arithmetic and sampled pending totals | Before pilot | Medium | Canonical attendance/count definitions | F01 |
| Gate home/mobile/data requests and complete route map | Before pilot | Medium | Enabled-module/capability contract | F02 |
| Define and implement no-payroll onboarding/settings | Before pilot | Medium–large | Agreed requirements and server completion rules | F03 |
| Finish invitation acceptance and remove raw-token workflow | Before self-service pilot | Large | Existing secure invitation backend and delivery | F04 |
| Make My Work/Team scopes explicit | Before multi-role pilot | Medium | Surface/permission rules | F05 |
| Connect approved new hire to employee draft | Before joining pilot | Medium | Request-to-employee lifecycle | F06 |
| Decide task/punch-out coupling and recovery | Before attendance pilot | Small decision; implementation varies | Product policy and server rule | F07 |
| Repair dialog/select/toast primitives | Before pilot | Medium | Shared component decisions | F08 |
| Single mounted route content | Before pilot | Medium | Responsive shell | F09 |
| Consolidate navigation/settings names | Next iteration; earlier where blocking | Medium | Proposed information architecture | F10–F12 |
| Apply calm visual system | Alongside journey delivery | Medium | Accepted prototype and tokens | F13 |
| Complete leave-document requirement UX | Before enabling affected leave types | Medium | Private file and workflow contract | F14 |
| Plain authentication copy and capability landing | Branch verification plus polish | Small–medium | Configured personas | F15 |
| Combined attendance/leave handoff | Before external customer month-end | Medium–large | Agreed export contract and permissions | Rollout plan |

Sizes are relative planning estimates, not engineering commitments. A backend dependency can dominate an apparently small frontend change.

## Prototype acceptance before broad implementation

Build representative Today, Requests, People and Attendance screens with synthetic data. Include one long employee name, no records, a failed request, a blocked action and more than ten pending items. Review at desktop and small-mobile sizes. A happy-path mockup alone will hide the hard UX work.

Use an actual working slice for the first usability session. Ask people to perform tasks without teaching them the navigation first. Do not ask only “Do you like this design?”

## Moderated usability study

Suggested first round: six to eight people spread across employees, reporting managers and company/HR administrators, including someone who rarely uses office software. This is a formative study, not statistically representative research. Include at least one keyboard-only participant or dedicated accessibility test.

Record task success, assistance, wrong turns, time, and whether the participant can explain the final state. Ask for a 1–7 ease rating after each task. Record workflow events without collecting leave reasons, documents or sensitive form contents in analytics.

| Task | What to observe | Proposed acceptance target |
|---|---|---|
| Find today's attendance and clock in | Finds action, understands permission and confirmed time | Unaided completion; action found within 10 seconds, excluding external permission/server delays |
| Request one day off and find its reviewer | Understands day count, balance and next step | Unaided completion within 90 seconds using a prepared scenario |
| Correct yesterday's missing clock-out | Distinguishes proposed time from saved attendance | Unaided submission and accurate explanation of pending state |
| Review a direct report's leave | Correct team scope and no self-approval confusion | Completes without hunting through employee detail unnecessarily |
| Submit a task returned for changes | Finds reviewer feedback and resubmits | Can explain Submitted versus Approved |
| Invite an administrator without employment | Understands chosen role and invitation outcome | No fake employee, raw token handling or accidental broad-role default |
| Continue an approved new hire | Finds pending setup after refresh | Reaches a linked draft without re-entering request details |
| Produce period handoff | Sees unresolved records and export scope | Output understood and accepted by the receiving payroll preparer |

The time limits are proposed targets, not measured current results. Revise them using baseline observations. Treat any repeated inability to locate a daily action, accidental privileged action or misunderstanding of a saved/pending result as a redesign signal.

## Branch test matrix

Every row below is **pending** until executed on a configured test tenant. Attach actual results and evidence instead of turning these checkboxes into an assumed pass.

| Area | Required cases |
|---|---|
| Roles | Employee; manager; employed HR admin; non-employee admin; owner; project-scoped and communication-scoped responsibility if advertised |
| Scope | Self, direct reports, company and explicit project/channel; wrong-tenant/deep-link denial; revoked session; combined responsibilities |
| Modules | Payroll/insurance off; attendance-only; leave-only; tasks-only; core-only; entitlement retrieval failure |
| Routes | Direct bookmark; notification link; refresh on detail; browser Back; disabled module; denied responsibility; no redirect loop |
| Attendance | Holiday, weekly off, new joiner, night shift, open prior-day session, multiple sessions, missing device sync, correction pending/approved/declined |
| Punch recovery | Offline, denied location/camera, timeout with uncertain result, repeated click, task gate, reviewer unavailable |
| Leave | Insufficient balance, overlapping dates, holiday crossing, missing approver, changed manager, cancellation, supported fraction/session cases |
| Joining | Request approved but employment pending, draft reload, duplicate email, expired/replayed invite, missing required document, hidden payroll fields |
| Work | Assign, submit, return, resubmit, approve; self-review denial; unauthorized project; simultaneous review |
| Access | Intentional role/scope preview, revoke, owner-transfer lifecycle, last-owner protection, understandable failure recovery |
| Policies | Audience preview, private document, superseded version, acknowledgement, no leakage of confidential employee files |
| Exit | Agreed last day, assigned clearances, external finance wording, permitted access removal, retained historical record |
| Handoff | Correct period/timezone/population, unresolved exceptions, reproducible totals, permitted export, later correction/replacement |

Frontend usability does not prove backend safety. Follow the existing InsForge/release instructions for integration changes and tests. Do not run fixture/reset suites blindly against the parent backend. Physical kiosk/biometric acceptance must be documented separately from simulator results.

## Responsive and accessibility checklist

- Inspect 360/390 px mobile, tablet, and 1280/1440 px desktop layouts; also check reflow at narrow widths and browser zoom.
- Verify one content instance and no duplicated data initialization/subscription when resizing.
- Keyboard focus remains visible; dialogs trap and restore focus correctly; Escape behavior is intentional.
- Inputs have persistent programmatic labels, errors identify the field, and submission status is announced.
- Menus/selects work without a mouse. Icon-only controls have meaningful names.
- Bottom navigation, drawers and toasts do not hide form controls or results. Check the onscreen keyboard and safe-area padding on a real phone.
- Long text, localization-ready dates, large counts and empty/error states do not break layout.
- Color is never the sole signal. Measure real contrast and honor reduced-motion preferences.
- Tables have usable headers and a deliberate mobile representation; scrolling a dense table does not force the entire page sideways.

Use [WCAG 2.2](https://www.w3.org/TR/WCAG22/) as the accessibility target. This checklist is not a conformance audit.

## Release decision and tracking

For each pilot gate record: **owner, frontend revision, backend branch/version, test persona, result, evidence link, unresolved issue and decision date**. Separate internal testing, customer pilot and general availability.

Release the agreed pilot only when the enabled core journeys pass, no critical access/data-integrity issue remains, users can understand pending versus completed results, and the external payroll boundary is accepted by the customer. An optional failing module may be explicitly excluded only when its dependencies and existing commitments are handled. Passing a build is not a substitute for these gates.

Suggested pilot measures: percentage completing first clock-in without support; request completion rate; corrections per 100 attendance records; approval waiting time; support contacts per active user; successful onboarding completion; time to prepare the period handoff. Compare against the customer's starting process. Do not call page views or logins proof of reduced complexity.

## Validation of this documentation change

Only audit documents were added. Application behavior was not modified, so no application build, mutating integration suite or backend diagnostic was needed to validate this writing task. Check the document links, source references and file scope. All runtime acceptance work above remains explicitly pending until the branch environment is configured.
