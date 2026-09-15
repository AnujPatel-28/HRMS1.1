# TalentMesh: non-payroll implementation and testing roadmap

Date: 2026-09-12. Updated after the user accepted a combined M1 + essential M2 target. Planning target: Monday, 2026-09-14, end of day IST. Status: agreed planning scope, not completed implementation or deployment authorization. Payroll and Insurance are excluded. Copy-ready worker and senior-reviewer prompts: [execution prompt pack](../prompts/non_payroll_m1_m2_agent_prompts_2026-09-12.md).

## 1. Delivery decision

Aim for a controlled internal testing release on Monday, not a claim that every module and every working culture is production-complete. Full completion of Company Administration, new access management, advanced scheduling, leave redesign, hardware certification, and communication security is not a credible unconditional two-day commitment.

Monday is conditional on a working isolated backend, prompt access to test accounts, a known device protocol, and no unresolved identity/tenant-isolation defect. Use synthetic employees initially. A simulator passing is not a physical-device pass. If common access controls fail, hold the whole candidate. If an optional module fails, disable it server-side and label its tests blocked; do not call the requested full scope complete.

Revised milestones (supersede the original M2-after-Monday sequence):

| Milestone | Outcome | Planning window, not a guarantee |
|---|---|---|
| M1 + M2 Essential | One internal test candidate with existing module journeys plus named administration, fixed permission templates, non-employee admin, secure invitation/revocation and basic organization transfer | Sep 14 EOD, ambitious and conditional |
| M2 Remaining | Advanced scopes, any substantial leave-ledger migration, advanced work cultures and unfinished essential items explicitly carried forward | Approximately 1–2 working weeks after Monday, re-estimate after baseline |
| M3 | Pilot hardening, real-device soak, recovery and customer acceptance | Approximately 1–2 additional weeks; hardware dependencies may extend |

These estimates assume one human integration owner and up to three bounded implementation lanes. More models do not remove dependencies or hardware elapsed time. Freeze feature additions before Monday's regression window.

### Accepted M2 Essential scope

Monday targets all of the following, not just renamed navigation: individual admin accounts; My Work/Team/Administration for multiple responsibilities; a non-employee administrator with no fictitious employment row; fixed role templates; self/direct-report/company/explicit project and channel scopes; one complete secure invitation flow; revocation with existing-session checks; Organization/reporting/designation separation; basic effective-dated transfer behavior; existing Attendance/Leave/Shift/Policy/Project/Task/Chat/Connect journeys; and physical kiosk testing. Biometric testing remains conditional on compatible hardware.

W2 must include owner-transfer/last-owner protection before ownership lifecycle is labelled complete. If it cannot pass by Monday, report that portion incomplete; do not hide it behind a Company Admin label. Missing essential capabilities mean a reduced M1 testing candidate, not successful M1 + M2 Essential delivery.

Outside Monday's commitment: custom-role builder; arbitrary combined unit/location scopes; automatic rotation and split shifts; universal flexible working; multiple biometric adapters; substantial ledger migration/reconciliation; production certification and prolonged device soak. Existing supported variants may be tested without promising new ones.

Opus 5 is the preferred independent senior-engineer checker. It reviews frozen contracts before shared security implementation, reviews each high-risk package, and issues a final candidate verdict. Fallback: GPT-6 Astra, then GPT-5.6 Sol high. Worker completion is not reviewer acceptance; reviewer acceptance is not deployment or physical-device certification. See the prompt pack for exact assignments, review rubric and handoff format.

## 2. Evidence and current-system baseline

Reviewed the September 9 company direction, product validation and role map; Organization architecture; Attendance/Leave developer docs; shift, device and communication docs; current selected source and migration filenames. No full current live audit or full test suite was completed for this plan. September 9 live observations are historical until rechecked.

Fresh read-only metadata succeeded on September 12 after the sandbox initially blocked npm access. It reports SMTP enabled (delivery not tested), zero registered attendance devices, 10 attendance events, 49 attendance rows and 1,821 derivation-run records. These counts establish existing infrastructure, not correct/recent processing. Realtime metadata lists enabled generic chat channels and returns empty subscribe/publish policy arrays: inspect actual authorization definitions and test socket payloads before drawing a security conclusion. Do not carry forward the old 'SMTP not configured' claim. Deployed/local function parity, grants, schedules and end-to-end workflows still require W0 verification.

| Area | Evidence available now | Next action |
|---|---|---|
| React/Vite/TypeScript | Existing application; Tailwind 3.4; build, lint and workflow scripts in package.json | Capture fresh build/lint baseline; keep Tailwind on 3.4 |
| Access | AuthContext still extracts exclusive hr/employee metadata roles; TenantContext explicitly fails open on entitlement load error | Introduce authoritative capability summary and explicit unavailable state |
| Onboarding | Four function files already have uncommitted edits. create-employee-user and set-employee-password locally call limiter with serverClient | Preserve edits; review deployed/local parity and recovery authorization, then test; do not redo old fix blindly |
| Employee provisioning | Local functions/create-hr-admin-user/index.js exists, contrary to the dated role-map note that local source was absent | Compare with deployed code before planning changes |
| Attendance | Events/derivation/device work exists; current Attendance.tsx has no_record rendering | Regression-test current implementation; do not implement the historical fabricated-absence fix again |
| Shift | Current ShiftManagement.tsx calls normalizeTimeInput for nullable cutoff | Verify edit/default/reassignment journey; old QA failure is not proof of a current defect |
| Leave | Operational module and prior transactional work exist; ledger target and counter descriptions conflict across documents | Inspect live schema and approval/accrual definitions; reconcile numbers before deciding migration scope |
| Device | AttendanceDevices.tsx, kiosk-punch, adms-cdata and B8 migrations exist | Verify actual protocol route, authentication, mapping and physical handshake |
| Policy Center | Existing settings/privacy/targeting migrations and UI | Verify private file access and effective operational rules |
| Projects/tasks | Existing project/task screens and hooks | Verify actual submit/approve/reject APIs and scope, not direct-table substitutes |
| Chat/Connect | Chat subscribes to chat_messages/channels/members; Connect subscribes to posts/reactions | Inspect actual channel authorization and received payloads; generic names alone do not prove a leak |
| Connect automation | auto-birthday-posts.ts still references emp.role | Verify deployed schema/function; repair stale role dependency or disable that automation in the test candidate |
| QA | Existing scripts and September 2 results; fixtures were mutated by earlier runs | Inspect before running; use resettable isolated fixtures; old counts are not fresh evidence |

Existing local changes are user work. Do not discard them or edit applied migrations. A file present locally is not proof it was deployed. RLS-enabled tables alone do not prove confidentiality.

Implementation baseline must record: git revision plus working diff, backend ID, applied migrations, deployed function versions/hashes, module keys, grants/RLS, storage policies, realtime policies, schedules, and test fixture version. Keep credentials out of the report.

## 3. Contracts to freeze before parallel implementation

### Foundation and identities

Company foundation owns tenant membership, employee identity, org units, reporting relationships, designation, grade, location and employment dates. Company Administration is a workspace. It does not own every module's records.

Identity must support a named non-employee owner/admin with no fake employee row. Membership is tenant-specific; role assignments attach to membership rather than requiring employment. Existing metadata and employee_roles may be composed during migration, with one documented writer for each fact. Do not drop current provisioning authority before the replacement works.

The server-derived access summary should contain active tenant membership, optional employee ID, action/scope grants, enabled modules and an access version. Client display uses it; database/RPC/edge/storage/realtime independently enforce authorization. Never trust a client-submitted summary. Current sessions must lose revoked access on the next protected operation; long-lived subscriptions require reauthorization/disconnection. Previously downloaded data cannot be recalled.

Keep Organization tree, primary reporting tree, secondary relationships and project membership separate. Designation and grade never grant access automatically. Secondary managers gain only explicitly defined actions, not every primary-manager approval.

### Module boundaries

| Owner | Contract |
|---|---|
| Foundation | Employee and company context effective on a specified date |
| Basic calendars/scheduling | Applicable schedule, business date, timezone, working intervals, weekly off and holiday; one authoritative resolver |
| Attendance | Immutable punch evidence plus controlled corrections and derived results |
| Leave | Eligibility, balance effects, request state, approval and approved absence coverage |
| Policy Center | Policy administration and documents; each operational module remains authoritative for applying its rules |
| Projects/tasks | Project membership, assignments, task states and work submissions |
| Chat/Connect | Conversations/feed content and audience rules, independent of attendance and leave |

Initially expose the existing schedule resolver through a stable contract. Do not physically move all calendar tables over the weekend. Leave-only customers need a basic calendar without purchasing Attendance or advanced Rostering.

Approved absence coverage includes date/shift reference, fraction and session/interval; no medical reason or attachment crosses to Attendance or project availability. Module deactivation blocks defined new operations without invalidating approved history or already-approved future leave. Historical internal reads remain narrowly authorized.

### Permission and approval contracts

Allow = active membership AND module permission AND action/scope match AND record-state eligibility AND workflow eligibility. Tenant isolation, revoked status and no-self-approval rules cannot be bypassed by combining roles. Pair every action with its own scope; never union all scopes across unrelated actions.

V1 scopes: self, direct reports, company, explicit project/channel membership. Add selected org-unit scope only after every applicable read/write/export/file/subscription path enforces it. Include-descendants is explicit. Do not advertise unsupported scope selectors.

Templates: Company Admin, HR Admin, Manager, Employee, Project Manager and Communication Moderator; account Owner is separately recorded. Users/access management, sensitive field access, exports, corrections and policy configuration are distinct permissions. Fixed templates first; custom role builder later.

Each request snapshots its workflow version and decision context. Approval execution rechecks current authority. Manager changes trigger explicit pending-request reassignment; historical approver identity stays intact. Missing approvers use a configured eligible fallback or an actionable blocked state, never silent success. Required steps cannot be skipped because no head exists.

## 4. Implementation work packages

Each package ends with a small reviewed diff, tests/results, deployment status and remaining limitations. Effort bands below are rough focused engineer/agent-plus-review hours, not elapsed completion guarantees. Re-estimate after W0; packages overlap and must not be summed as a promise for Monday.

| ID | Work package | Depends on | Rough effort | Monday boundary |
|---|---|---|---|---|
| W0 | Baseline, isolated test environment, reproducible fixtures | — | 3–5h | Required |
| W1 | Access contract, entitlement failure behavior, payroll/insurance exclusion | W0 | 6–12h | Required minimal safe contract |
| W2 | Named membership, invitations, access grants/revocation/ownership | W1 | 12–24h | Essential named admin/invite/revocation targeted; label any unpassed ownership lifecycle incomplete |
| W3 | Organization placement/history and reporting consistency | W1 | 4–8h | Existing structures and primary reporting |
| W4 | Schedules, attendance and correction consistency | W1,W3 | 8–16h | Fixed/day/night existing workflows |
| W5 | Device adapter verification and physical test | W0,W4 | 4–12h plus hardware waits | One known device model only |
| W6 | Leave workflow and attendance coverage | W1,W3,W4 calendar contract | 8–16h | Existing supported policies; substantial ledger redesign in M2 Remaining |
| W7 | Policy Center privacy/settings/targeting | W1 | 4–8h | Existing publish/read/acknowledge and operational settings |
| W8 | Project/task lifecycle and permission isolation | W1,W3 | 4–8h | Existing lifecycle, no advanced project suite |
| W9 | Chat/Connect membership, content and realtime isolation | W1 | 6–12h | Existing text/feed workflows; unsafe optional features disabled |
| W10 | Integrated security, culture/device regression, candidate release | All enabled packages | 8–12h plus soak | Required; cannot replace with build success |

### W0 — establish reality

Read backend metadata, migration history, selected function definitions, schedules and diagnostics using InsForge CLI/MCP. Use a backend branch or separate test environment for risky changes. A schema branch is not automatically a complete test environment: verify auth fixtures, storage, deployed functions and schedules separately. Disable real notifications in fixtures.

Run npm run build and capture npm run lint baseline. Inspect existing test scripts for credentials and writes before execution. Make fixture setup repeatable, explicitly targeted to the test backend; reject any reset against the parent. Fresh docs are mandatory before InsForge integration edits under AGENTS.md. If required MCP docs tools are unavailable, record the tooling prerequisite instead of silently ignoring it.

Exit: reproducible baseline, deploy manifest, two isolated tenant fixtures, and no ambiguity about which backend each tool targets.

### W1/W2 — company access and named administration

Touchpoints: src/contexts/AuthContext.tsx, src/contexts/TenantContext.tsx, src/App.tsx and route/layout guards, src/types, functions/create-hr-admin-user/index.js, the four onboarding functions, and new forward-only migrations.

W1: replace exclusive employee/admin presentation with My Work, Team and Administration based on actual access. Non-employee admin has no personal attendance/leave. Entitlement fetch failure shows unavailable/retry; new tenants receive intentional module selections. Payroll and Insurance must be off in frontend, APIs and relevant jobs for test tenants; retain historical data.

W2: introduce membership-based role grants with controlled assignment; named expiring single-use invitations; safe retries and provisioning recovery; ownership transfer and last-owner guard; revocation; audit. Verify reset/set-password cannot become cross-tenant account takeover. Do not restore broad check_rate_limit grants as a shortcut. Capture the existing HR/owner mapping explicitly and validate that migration grants no new authority accidentally.

Monday target includes the essential W2 lifecycle described above. Fallback, only if it misses its gates: restricted named test accounts and minimal verified templates. This permits reduced M1 testing but DOES NOT complete M2 Essential or the September 9 invitation/ownership lifecycle. Record every deferred W2 acceptance criterion explicitly.

Exit tests: admin+employee can punch/apply leave; non-employee admin cannot; revoked user denied with old session; role assignment cannot self-escalate; owner transfer cannot orphan tenant; invite replay/expiry rejected; wrong tenant denied; optional modules unavailable on failed entitlement fetch.

### W3 — Organization

Use existing employee/unit/reporting structures. Verify manager display against canonical server output; primary versus secondary authority; cycle and cross-tenant constraints; archived lookups; transfers. Record effective dates for changes and retain past decision context. A transfer must not rewrite old attendance. Historical context does not preserve old manager access.

Exit: employee transfers unit and manager on a date; new manager receives appropriate scope, former manager loses current scope, pending approvals are handled explicitly, and past results remain unchanged.

### W4 — schedules and attendance

Touchpoints: ShiftManagement.tsx, Attendance.tsx, useEmployeeShift.ts, attendance functions and resolver/derivation migrations. Retain existing evidence and derivation architecture.

Verify nullable shift edit, one default, effective assignments, overlap rejection, overnight business date, holiday/weekly-off precedence, grace and breaks, actual versus received device time. Resolve schedule as published date assignment (when supported), dated employee assignment, configured default, otherwise configuration gap. Do not invent a schedule.

Preserve current no_record behavior. Distinguish in-progress/no evidence/missing punch from confirmed absence. Review actual end-of-day absence policy before changing derivation: earlier docs conflict. Any changed locked attendance decision needs an explicit decision record.

Corrections require permission, reason and audit; raw evidence remains. Late events update only eligible results; locked results surface reconciliation. Scheduler success must be observable through run records and freshness alerts, not just a cron entry.

Exit: app IN/OUT; missing OUT correction; duplicate replay; overnight shift; weekly off; holiday; joining/exit boundary; effective shift change; correction preserved across replay; Attendance-only tenant works.

### W5 — physical devices

Touchpoints: AttendanceDevices.tsx, functions/kiosk-punch/index.ts, functions/adms-cdata/index.ts, device_ingest_punch and attendance_event_ingest definitions.

Obtain manufacturer/model, firmware, transport (push/poll/export), actual URL path requirements, port/TLS capability, timezone, punch direction encoding, sample payload and reachable test network. Do not assume a device can target an arbitrary function URL: verify native /iclock-style paths and whether an authenticated gateway is needed. Polling hardware may require a local bridge and cannot be promised as an existing ADMS integration.

Register one test device; map enrolled IDs unambiguously; retain device identity and source event ID; deduplicate retries; record event time and received time separately. Unmapped users and rejected rows need a visible reconciliation queue. Never acknowledge transiently failed rows as permanently accepted unless they are durably queued for retry. Audit the older documentation's blanket 'OK for partial rejection' rule against actual implementation.

Prefer authenticated transport/gateway. Serial-only evidence is weak identity, even if rate limited; do not silently enable it to pass a test. Use existing explicitly configured test mode only with its limitations recorded. Disable/rotate credentials without deleting historical device identity.

Physical acceptance: actual IN/OUT; repeated upload no duplicates; disconnect/reconnect backlog; wrong credential; unmapped ID; disabled device; invalid/cross-tenant mapping; mixed app/device punches; night shift. Compare machine export/log count, accepted/rejected count, canonical events and derived rows. Run a real overnight cycle and at least a 24-hour observation where feasible; extend beyond Monday if needed. Simulated backlog validates logic, not prolonged real-device reliability.

### W6 — Leave

Touchpoints: LeaveManagement.tsx, MyLeaves.tsx, useLeaves.ts, leave RPCs, calendar resolver, on-leave-reviewed.ts.

Reconcile current allocation/used/pending/balance values and accrual idempotency first. Validate actual application, approve, reject and cancel RPCs. A direct table update is not a passing workflow test. Enforce no self-approval, explicit eligible approver and atomic decision/balance effects.

For M2 Remaining, if ledger absent, design new ledger entries and independently reconcile opening balances; do not invent historical entries. Preserve provenance and quarantine unexplained discrepancies. Pending reservations reduce request availability without being posted approved consumption. Reversal entries handle cancellation; retries must not double consume or restore.

Cover full-day and supported partial sessions, holiday/non-working-day charging, insufficient balance, overlaps, accrual retry, manager transfer, missing approver, cancellation after approval and Leave-only use. Do not claim partial-session or flexible-calendar support before it passes. Leave/punch conflict remains visible; attendance does not silently cancel leave.

### W7 — Policy Center

Touchpoints: PolicyCenter.tsx, PolicyUpload.tsx, policyValidation.ts, existing privacy/transaction/targeting migrations.

Keep document publication/acknowledgement distinct from operational policy configuration. Reading a PDF is not proof its grace-period rule is applied. Verify a setting change saves atomically, validates supported values, has an effective version and changes only intended future computations. Show which rule applies and why.

Test company and selected unit/descendant targeting, unassigned employees, transfer effects, version-specific acknowledgement, archival, private file access via signed links, unauthorized direct download, and explicit conflict resolution for multiple applicable rules. Preserve old policy provenance. No public confidential attachment URLs.

### W8 — Projects and tasks

Touchpoints: TaskWorkspace.tsx, TaskManagement.tsx, hr/pms/ProjectList.tsx and ProjectDetail.tsx, employee/MyTasks.tsx and pms/EmployeeProjectView.tsx, useTasks.ts, task notification functions.

Verify create project, add/remove members, create/assign task, submit, approve/reject with reason, resubmit and archive. Use explicit project authority; HR manager and project manager are independent. Remove hardcoded department routing if still present. Notifications must resolve eligible recipients and survive duplicate triggers without duplicate effects.

Task completion must not determine attendance by default. Any existing punch-out/task gate must be explicit, module-aware and have a clear permitted exception path; disabling Tasks cannot trap punch-out. Projects-only fixture must complete its workflow without Attendance/Leave. Project availability receives minimal absence intervals, not medical details. Advanced timesheets, costing, dependencies and portfolio planning remain later scope.

### W9 — Chat and Connect

Touchpoints: shared/Chat.tsx, hooks/useChat.ts, shared/pages/Connect.tsx, realtime authorization, file policies and auto-birthday-posts.ts.

Chat acceptance: permitted channels visible; private channel non-member denied; send/reload/reconnect consistent; membership removal blocks further reads, writes and socket delivery; attachments authorized; author/moderator edit/delete rules enforced. A company admin is not automatically a private-conversation reader.

Connect acceptance: permitted feed audience, post/reaction lifecycle, author/moderator controls, duplicate reaction handling, disabled module denies mutations, tenant isolation and revoked-session behavior. Inspect actual birthday automation dependency on the removed employee role field; enable automated posts only after eligibility/privacy and duplicate-run checks pass.

Notifications contain minimum necessary information and deep links recheck access. On reconnect, fetch authorized durable state. Client-side event filtering cannot fix a leaked websocket payload. If attachments or automation fail, disable those capabilities and mark the module partially complete. Voice/video, federation, bots and enterprise retention tooling are not Monday scope.

## 5. Monday execution schedule and stop rules

| Window (IST) | Focus | Gate |
|---|---|---|
| Sat Sep 12, remaining work window | W0; device identification; contract decisions; preserve existing edits | Environment and baseline known |
| Sun Sep 13, first work block | W1/W2 essential named access/invitation/revocation and onboarding blockers; independent W4/W5 investigation and W7/W8/W9 bounded work | Opus contract review; one owner for shared access |
| Sun Sep 13, second work block | Integrate W2 essential flows and W3 basic transfers; W4/W6 happy paths; physical kiosk/available biometric handshake | Opus package reviews; unstable access means reduced internal QA |
| Sun Sep 13, evening checkpoint | Select enabled candidate modules; freeze new features; start overnight device scenario if ready | Hardware unknown: physical test blocked, simulator only |
| Mon Sep 14, morning | W10 security and culture tests; actual device results; targeted repairs | No new schema architecture |
| Mon Sep 14, afternoon | Rerun affected tests, integration regression, diagnose, publish test evidence and known limitations | All enabled P0/security checks pass |
| Mon Sep 14, EOD | Controlled testing begins for passing scope | Exact tested/blocked/deferred matrix delivered |

Reserve at least the last third of available time for integration and validation. Failed isolation, account recovery, self-escalation or corrupt leave/attendance results cannot be waived to meet a date. W2 work that misses a gate must be labelled incomplete M2 Essential; substantial ledger work belongs to M2 Remaining. Neither goes into an unreviewed Sunday-night migration. The revised target does not extend Sunday's feature freeze.

## 6. Working-culture and module-independence test matrix

Use at least two tenant IDs for negative tests, plus reusable configurations below. One employee fixture should be HR+employee, one non-employee admin, one primary manager, one secondary manager without blanket approvals, one unrelated peer, one project manager, one revoked account and one exited employee.

| Configuration | Required scenario | Monday expectation |
|---|---|---|
| Five-day office | Mon–Fri, holiday, basic fixed schedule | Target pass |
| Six-day operations | Saturday working, different weekly off | Target pass |
| Night operation | 22:00–06:00, after-midnight punches, leave alignment | Target pass with evidence |
| Hybrid worker | Approved work location/remote exception, app+device evidence | Supported existing policy only |
| Rotating shift | Effective dated day/night changes | Manual dated assignment; advanced auto-rotation M2 Remaining |
| Leave-only company | Applications, balances, holidays without Attendance | Target pass |
| Attendance-only company | Punch/derive/correct with Leave, Tasks, Payroll, Insurance off | Target pass |
| Projects-only company | Assign/submit/review without time modules | Target pass |
| Chat/Connect-only company | Member/employee identities with time modules off | Target pass |
| Matrix organization | Different unit head, primary manager and project manager | Distinct scopes; no title-based privileges |
| Flexible hours | Required hours without fixed arrival, optional core hours | Gap assessment; M2 Remaining unless already supported and tested |
| Split shifts / global DST | Multiple shifts same date, ambiguous/missing local times | Explicitly deferred unless verified capability already exists |

Use controlled dated fixtures rather than waiting for Sunday or changing the production clock. Real physical overnight behavior still needs elapsed-time evidence. Do not infer that passing these configurations proves compliance with every jurisdiction or every working culture.

Cross-cutting tests: other tenant ID; peer record; own approval; non-member project/channel; disabled module direct API; suspended tenant with old session/socket; sensitive field/export/attachment; duplicate request; missing approver; transfer; offboarding; entitlement failure; notification duplicate; background job outage and recovery.

## 7. Model routing and alternatives

These assignments are engineering recommendations, not measured HRMS benchmarks. Actual account quotas, credit multipliers and tool access must be checked in the provider used. API price is not the same as subscription credit consumption. No automatic router, subscription change or new model task was installed by this document.

Naming: the available Codex names here are GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra and GPT-5.6 Luna. The requested 'GPT-5.6 Astra' is not the exposed identifier; verify the intended selection rather than inventing one. 'Chat' is an interface, not a sufficiently specific model. Other providers require their own connected environment. Meta's official page documents max reasoning; do not assume a host's 'xhigh' equals that setting.

| Task class | Primary | Alternative order | Effort and review |
|---|---|---|---|
| File inventory, test-result summary, documentation synchronization | Luna | Terra → Sonnet 5 | Low/medium; concise bounded input |
| Small UI fix, loading/error states, permission-aware rendering using a fixed contract | Terra | Sonnet 5 → Muse Spark 1.3 → Sol | Medium; build plus targeted UI check |
| Multi-file module workflow and integration | Sonnet 5 or Sol, based on available quota | Muse Spark 1.3 → Terra for isolated pieces | Medium initially, high for demonstrated complexity |
| Auth/membership/RLS, recovery, realtime confidentiality | Sol high | Opus 5 → Astra → Muse high/max with independent review | Independent reviewer mandatory; no lowest-tier-only migration |
| Attendance derivation, overnight matching, leave reconciliation | Sol high | Opus 5 → Astra → Muse high/max | Fixed invariants and adversarial test cases |
| Known device parser/adapter implementation | Sonnet 5 | Muse Spark 1.3 → Sol | Medium; captured protocol fixtures and physical checks |
| Architecture deadlock or failed complex repair | Astra high | Opus 5 high → Sol high | Narrow question plus current evidence, not whole-repo rewrite |
| Independent senior review | Opus 5 | Astra → Sol high | Contract, package and final reviews; inspect evidence; no self-approval |
| Running known tests and collecting evidence | Terra or Luna | Sonnet 5 | Tool execution; escalate diagnosis only if needed |

If Sonnet quota is exhausted, switch the SAME bounded task to Muse using a handoff, not a fresh architecture prompt. First confirm it has shell/files/docs/test tools and passes a small representative repository task. Availability fallback is different from reasoning failure: quota exhaustion needs transfer; two failed focused repairs need escalation and better evidence. Do not spend time rotating across every model.

Credit controls:

1. Use one integration lead, at most two implementation workers plus one reviewer when useful. More concurrent writers usually increase integration cost here.
2. Budget by completed accepted task, including retries, review and test time. Record start/end provider usage when available. Set a user-approved spending cap before paid unattended execution; no dollar saving estimate is established here.
3. Suggested task allocation, not spend prediction: about 55% bounded work on Luna/Terra; 35% implementation on Sonnet/Sol/Muse; 10% high-risk design/review on Astra/Opus. Adjust using measured rework.
4. Default to medium for implementation. Use xhigh/max only on a named unresolved problem; do not run every task at maximum reasoning.
5. Give each worker exact files, input/output contract and acceptance checks. No repeated whole-repository audits. Summarize long logs and avoid secrets in handoffs.
6. Maximum two focused repair attempts before a documented escalation. Stop when the acceptance checks pass; no duplicate premium review of cosmetic work.
7. Reserve approximately 20% of the chosen total budget for integration/rework. Do not spend the entire allocation generating code.

Handoff template:

```text
Task ID and exact objective:
Base revision / working diff / permitted files:
Backend target (no credentials):
Frozen contracts and exclusions:
What changed and why:
Tests passed, failed and not run:
Exact remaining failure and relevant log excerpt:
Migration/deployment status:
Next bounded action:
```

Suggested execution lanes once implementation is started: lead owns W0/W1/W2 and migration ordering; time lane owns W4/W5/W6 against fixed contracts; collaboration lane owns W7/W8/W9; reviewer checks high-risk diffs and W10. W3 changes touching identity are integrated by the lead. Shared contexts, route guards and SQL authorization helpers have one writer. Use isolated worktrees and a reviewed baseline; do not concurrently migrate one shared backend from several agents. Provider fallbacks retain the same lane and file ownership.

## 8. Definition of done and release evidence

A module is test-ready only when its intended user journey passes in UI and actual APIs, its authorization negatives pass, required jobs work, and errors are actionable. 'Implemented', 'deployed', 'tested' and 'physical-device verified' are separate fields.

For each W package record: owner/model, source revision, deployed artifact, tested tenant configuration, test IDs/results, screenshots or sanitized API evidence, unresolved issues and fallback/deactivation behavior.

Release gates:

- Build passes; no new unexplained lint/type failures. Existing baseline failures are enumerated, not silently ignored.
- No cross-tenant/private-channel/sensitive-file leak or unauthorized action in enabled scope.
- No self-escalation, self-approval or account recovery bypass.
- Attendance evidence survives replay; supported leave balance operations reconcile.
- Disabled Payroll and Insurance produce no relevant user workflows or test-tenant jobs; other modules still work.
- Background derivation and other enabled schedules have observed successful runs; failures are visible.
- InsForge diagnose findings are reviewed and repaired. If Advisor access is denied, say unavailable; do not claim a clean scan.
- Physical-device status explicitly lists model/firmware/network/transport and tests passed; never 'all biometric devices supported'.
- Deployment order and recovery rehearsed: compatibility migration → backend functions → frontend → scheduled jobs. Adapt order to actual dependencies; keep old interface until consumers migrate. Forward-only DB repairs; never roll back by destroying newly recorded events.
- A failing optional module can be disabled with audit and preserved history; shared authorization failure stops the release.

## 9. Completing the original company direction after Monday

M2 Remaining finishes explicitly deferred W2 criteria, adds genuinely enforced organizational scopes as required, completes substantial leave ledger reconciliation if absent, extends policy/schedule history beyond the essential cases and validates more complex manager-transfer lifecycles. Basic dated transfer and current-access revocation remain Monday targets. Extend scheduling only for named customer cultures. Avoid custom-role builders until fixed templates and their backend enforcement are reliable.

M3 adds the measured pilot fixes: physical-device soak and reconnect/retry tests, permission revocation under long-lived sockets, private storage link expiry, observed task/approval notification delivery, realistic data-volume checks, audited recovery and admin onboarding usability. Accept each module individually, then repeat composition tests.

Payroll and Insurance remain excluded throughout this plan. Their later implementation is a separate scoped decision.

## 10. Concrete test lab agreed for planning

The user will try to create the recommended conditions. No particular biometric hardware or firmware has been identified. Start with existing equipment; no hardware purchase is required for the first test stage.

Equipment: one laptop for administration; one spare tablet or phone running the existing /kiosk page; a separate employee phone for app camera/GPS tests where supported; two browser profiles for simultaneous users; Wi-Fi with a controlled way to disconnect only the test device. Use synthetic people, test accounts and a test backend. Configure Asia/Kolkata initially; do not change the production clock.

Create Company A with all included modules and Company B as the isolation control. Use repeatable configuration snapshots to run Attendance-only, Leave-only, Projects-only and communication-only combinations. Payroll and Insurance remain disabled in every configuration.

Create eight personas in Company A: non-employee Owner/Company Admin; HR+employee; primary manager; project manager in another org unit; ordinary employee; night-shift employee; unrelated peer; revoked/exited test employee. Company B needs an admin and employee with deliberately similar display names to catch name-based routing. Give each person unique employee IDs and individual credentials. Designations must not confer permissions.

Seed Engineering and Operations units with child teams, Pune and Ahmedabad locations, one cross-unit reporting relationship, a five-day 09:00–18:00 schedule with explicitly configured break, a six-day schedule, and a 22:00–06:00 schedule. Add one test holiday and explicit weekly offs. Give test employees small known leave allocations, one private project and one private chat channel. Record fixture IDs rather than relying on names or changing total counts.

Run in this order:

1. Admin+employee self-service and cross-tenant/peer denials, before any hardware experiment.
2. Employee phone/app punch and laptop attendance result, followed by correction and manager approval.
3. Physical tablet kiosk: register, enter issued credentials, map employee code/PIN, actual IN/OUT, wrong PIN and disabled-device denial. This proves kiosk hardware use, not biometric compatibility. Do not assume offline kiosk queueing exists.
4. Leave application/approval/cancellation and supported half-session result, plus project task submit/reject/resubmit and private-channel checks.
5. Controlled adapter payload fixtures: retry, unmapped user, out-of-order timestamps, mixed sources and offline backlog. Label these simulated ingestion tests.
6. Real night shift and following-morning verification; use synthetic dated events separately for deterministic regression.
7. When a biometric machine is available, record exact model/firmware and inspect manufacturer documentation for push/poll/export, required URL paths and credential support. Select its adapter only then. Repeat real punch/reconnect tests and compare the device's own logs.

If borrowing hardware, prefer a unit whose documented protocol matches the existing adapter, subject to verification. A CSV export can validate import/reconciliation only; it is not a live connection. A LAN-poll-only device needs a bridge work package. No vendor or model is certified by this plan.

Each run records expected event count, accepted/rejected count, resulting hours/status, acting user, screenshot/API evidence, and pass/fail/blocked. Stop and preserve logs on a mismatch. Do not keep re-enrolling people or changing mappings until the failed evidence is captured.

## 11. References

Repository: doc/company_administration_roles_direction_2026-09-09.md; doc/product_validation_2026-09-09.md; doc/role_permission_map_2026-09-09.md; doc/qa/RESULTS-2026-09-02.md; doc/architecture/06-organisation-management.md; devloper_doc/attendanceModule; devloper_doc/leaveModule; doc/shift_rostering.md. Treat dates and implementation claims explicitly.

Provider guidance checked Sep 12: [OpenAI models](https://developers.openai.com/api/docs/models) describes Astra/Sol/Terra/Luna positioning; [Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5) and [Opus 5](https://www.anthropic.com/news/claude-opus-5) are official model references; [Meta Muse Spark 1.3](https://research.meta.ai/blog/introducing-muse-spark-1-3) documents agentic/coding focus and max reasoning. Routing above is a recommendation based on task risk, not a claim of measured interchangeability or cheapest account-specific credits.
