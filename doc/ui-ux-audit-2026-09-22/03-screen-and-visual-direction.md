# Screen and visual direction

## A calm operational product

Keep TalentMesh's green identity. Build recognition through consistent typography, clear language and useful details rather than a new decorative style on each page. The product should feel like someone understood an employee's working day.

The sign-in page is already reasonably restrained. The authenticated source suggests greater inconsistency: oversized shadows, colored cards, illustrative banners, background art and two shell styles. Those choices are not individually wrong; together they spend attention before the user reaches their task.

This is a proposed specification. It does not claim that authenticated screenshots were reviewed.

## Screen 1 — Employee Today

The first screen should answer “What do I need to do now?”

```text
TalentMesh / Company name           My Work       Notifications   Account

Today                              Tuesday, 22 September

Attendance
Not clocked in · Shift 09:30–18:30 · Office
[Clock in]                         View attendance

Needs your attention
Task returned: Update the hiring brief                 [Open]
Policy acknowledgement due Friday                     [Read]

Your requests
Leave · 25 September · Waiting for your manager        [View]

Tasks due today                                        [View all]
Hiring brief                    Due 16:00 · Needs changes
```

All names, dates and counts in design examples are illustrative. Do not ship seeded “activity” as real data.

Keep a primary attendance action near the top when attendance is enabled. Show another relevant next action when it is not. Balance and monthly summaries are secondary, not four equal competing hero tiles. Completed work can collapse into a quiet history row. Do not add productivity scores or employee rankings from attendance/task totals.

## Screen 2 — Team overview and Requests

Team overview: scope label, who's away, who needs help, and pending decisions. Directory is a supporting destination, not the whole manager workspace.

Requests should start as a shared navigation/queue experience over existing domain workflows. Suggested filters: **Needs your decision, Waiting on others, Completed**; then type and date. Show requester, request, submitted time/age, current step and reviewer. The count must equal the authorized filtered queue, not a recent-item sample.

Open a short review in a side panel on desktop and a dedicated screen on mobile. Display enough evidence to decide without repeatedly opening employee detail. For complex changes, use a full detail page. Avoid nested modal chains.

Approve/decline controls must describe the specific action. Recheck permission and record state at submission. If another reviewer acted first, show the updated result and remove stale actions. Do not blindly offer Undo for a decision with dependent effects; provide the actual reversal/cancellation workflow if supported.

## Screen 3 — Administration overview

Replace the decorative welcome banner as the dominant content with a prioritized list:

```text
Administration                           Company name

Needs attention
Joining profiles ready for review                           [Review]
Attendance corrections awaiting decision                    [Review]
Approved hires awaiting employee setup                      [Continue]

Today's attendance        Updated 10:12 · Company timezone
Present / On leave / Not yet clocked in / Needs review

Upcoming
Joining this week · Probation decisions · Confirmed exits

Setup status              Only shown when there is work to finish
Assign a default schedule                                   [Configure]
```

Headcount can stay as a compact summary. A non-employee administrator should see their actual account identity, not “HR Manager” as an assumed employment role. Device/system health belongs in a secondary operational section unless it is preventing work right now.

## Screen 4 — People list and employee detail

People list: name/code, job title, team, manager, employment status, joining date, and next required action. Search first; a compact filter row; advanced filters in a disclosure. Use a table on desktop and deliberate summary rows on mobile. Keep columns aligned and avoid a card grid for administrative comparisons.

Separate the onboarding progress filter from employment status so “Pending review” is not confused with “Inactive.” Preserve the search/filter/page when returning from detail. Empty search results should offer **Clear filters**, not **Add employee** as the only action.

Detail: Overview, Employment, Documents, Time & Leave, Work, History, filtered by permissions/modules. Put sensitive identity/bank data behind purposeful access and separate it from ordinary identity display. Show manager/team/effective dates in one place. Profile completeness must reflect required non-payroll information, not penalize users for fields the company does not use.

## Screen 5 — Attendance operations

Keep operational density. HR often needs to compare many people on a date, not open a large card per person.

- Date/range, scope, timezone and update time at the top.
- Tabs such as Daily records, Corrections and Exceptions; counts and filters carry into the queue.
- Distinguish Not scheduled, Not yet clocked in, Missing record, On leave, Late and confirmed Absent.
- Put evidence and before/after correction in a detail panel; preserve the selected row.
- “Review corrections” should open the relevant tab/filter directly. Current overview links point to the general attendance page.
- Hide device configuration behind setup/management; show a sync warning prominently only when it affects record confidence.

Use precise messages: “Records last updated at 10:12” is better than a general green “healthy” chip with no explanation.

## Screen 6 — Company settings and Users & Access

Settings should be grouped by the question being answered: Working days & holidays; Attendance rules; Leave rules; Organization; Users & Access. Only expose payroll settings when the payroll product is genuinely available.

For complex changes, show **current rule → proposed rule → affected population/date → save**. Use plain examples where helpful, but do not show salary-deduction examples in a payroll-free tenant. Preserve a useful advanced section for experts. Progressive disclosure should defer rare controls, not hide daily actions. [Reference: NN/g](https://www.nngroup.com/articles/progressive-disclosure/).

Users & Access should show readable role summaries, people, status and scope. Place owner transfer/revocation in an explicit review flow identifying the person and effect. Backend safeguards remain mandatory; a confirmation dialog does not provide authorization.

## Proposed visual rules

| Element | Direction |
|---|---|
| Canvas | Plain warm or cool off-white; one consistent choice. No background artwork behind working tables/forms |
| Brand | Keep green; reserve strong brand fill for primary actions and active navigation |
| Typography | One dependable UI family; 14–16 px body, 12–13 px secondary metadata, 24–28 px page titles as starting design targets |
| Density | Comfortable employee mobile screens; compact but readable administrative rows. Avoid tiny essential labels |
| Spacing | Consistent 4/8/12/16/24/32 px scale; related information grouped tightly, unrelated sections separated |
| Containers | Mostly borders and flat surfaces; modest corner radius; shadows for elevation such as menus/dialogs |
| Status | Neutral for information, amber for needs attention, red for failure/critical issues, green for successful completion; always include words |
| Icons | Use the existing Lucide family consistently, accompanied by text for unfamiliar actions |
| Motion | Short state transitions where useful; no permanently bouncing cards or pulsing routine CTAs; honor reduced motion |
| Tables | Aligned columns, clear headers, visible sort state, pagination/counts where needed; avoid whole-page horizontal scrolling |
| Forms | Persistent labels, sensible defaults, inline validation, explain disabled actions, retain values on recoverable failure |

These are design targets, not measured compliance results. Measure contrast for the actual foreground/background pairs, including the green buttons and muted text; do not assume a brand token is accessible because it looks good.

For touch, target roughly 44–48 px controls in important mobile flows as a usability preference. WCAG 2.2 AA's minimum target-size criterion is 24×24 CSS px or qualifying spacing/exceptions, not a universal 44 px requirement. Fixed headers/footers must not completely obscure keyboard focus. [Target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), [focus guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum).

## Product language

| Current wording | Proposed wording/context |
|---|---|
| Dashboard | Today for employees; Overview for administration |
| Punch In/Out and Clocked In | Pick Clock in / Clock out consistently; retain Punch terminology only where device context needs it |
| Request Regularization | Request attendance correction |
| My Leaves | Leave |
| Rejected task | Needs changes, when resubmission is the intended next step |
| Derivation | Attendance processing; technical detail in administrator diagnostics |
| access.manage at company scope | You need permission to manage company access |
| No employee association | Administrator account — no employee record linked |
| Banking & Final Settlement Info | Omit from default non-payroll onboarding; name the actual purpose if separately enabled |

Error example: “We couldn't save your correction. Your entries are still here. Try again.” If the request may already have succeeded, say the result is being checked instead of encouraging duplicate submission.

Success example: “Leave request sent. Waiting for your manager.” Only name the actual reviewer if the system knows it. Avoid “HR has been notified” unless notification delivery/enqueue semantics justify that promise.

## How to avoid a generic AI-generated appearance

Use real workflow detail: business dates, next reviewer, elapsed waiting time, recorded-versus-requested times and a meaningful next action. Do not pad screens with decorative graphs, repeated welcome copy, random accent colors, fake metrics or a card for every field.

A warm greeting can be one line. Employee milestones can get a quiet human message. Accuracy, legibility and saved progress create more confidence here than confetti. Avoid celebratory language for exit decisions, rejected requests or access revocation.

Build a small shared set first: PageHeader, ActionButton, StatusBadge, Field/Error, EmptyState, ErrorState, Dialog/Drawer, DataTable, FilterBar and RequestTimeline. Reuse existing components where suitable. Keep Tailwind 3.4; a framework migration is not needed for this design direction.
