# TalentMesh UI and UX review

**Reviewed:** 22 September 2026  
**Branch:** `p1-00-harness-reconciliation`  
**HEAD:** `8bcb067d3c0abe3f61b698cd4a3a4dd6062626f9`, plus the existing working-tree changes  
**Scope:** Product experience, roles, workflow design and a launch without payroll. Recommendations only; application code and backend configuration were not changed.

## Recommendation

**Redesign the navigation and the most important journeys. Keep the working product foundations. A full rewrite is not justified by this review.**

TalentMesh already has more useful workflow depth than its presentation suggests: attendance corrections, shifts, leave approval, employee history, new-hire requests, task review, module controls and capability-based access. Rebuilding all of this would consume time without necessarily making the product easier to use.

The bigger problem is that the interface asks users to understand the system's structure. They encounter portals, manager mode, module groups, overview pages, policy settings and different layout styles. An employee should only need to understand their day. A manager should know what needs a decision. HR should see what needs resolving.

The design promise should be: **“Know what needs you, finish it, and know it worked.”**

## Read this pack

| Document | What it answers |
|---|---|
| [01 — Findings](01-findings.md) | What is wrong or at risk, where the evidence is, and what to preserve |
| [02 — Roles and journeys](02-roles-and-journeys.md) | How personal work, team work and administration should fit together |
| [03 — Screen and visual direction](03-screen-and-visual-direction.md) | What the screens should contain and how to avoid a generic dashboard look |
| [04 — Launch without payroll](04-launch-without-payroll.md) | What to include, what to remove, and how to hand off to an external payroll process |
| [05 — Delivery and validation](05-delivery-and-validation.md) | Priorities, acceptance criteria and realistic usability tests |
| [06 — Competitor research](06-competitor-research.md) | Lessons from HROne, Frappe HR, Keka, Zoho People, BambooHR and HiBob, with sources and evidence limits |

## What to do first

1. Agree the no-payroll product boundary, including onboarding fields and external month-end handoff.
2. Correct misleading home-screen numbers and make optional-module behavior consistent.
3. Give users one predictable shell with **My Work, Team and Administration** according to their access.
4. Finish the invitation-to-first-use journey and the new-hire-request-to-employee handoff.
5. Improve the five daily interactions: clock in/out, request leave, review a request, submit work, and resolve an attendance issue.
6. Apply a restrained visual system to those flows and test them with people who have not seen the product.

Do not begin by redesigning every module, choosing a new component library, or drawing another analytics dashboard.

## Evidence and limits

This is a **source-grounded UX audit of an unfinished branch**, with a visual inspection of the local sign-in screen. It is not a completed authenticated walkthrough, backend audit, accessibility certification or production release approval.

The user clarified during review that both frontend and backend branches remain under development and that a tenant configured for the new roles may not yet exist. Login behavior was therefore not treated as proof of a product defect. No credentials were entered, accounts created, employee records changed, punches recorded, invitations sent or backend suites run.

The route tree, both main layouts, dashboards, shared controls and critical workflow implementations were inspected. Secondary surfaces were surveyed through route declarations, headings, actions and relevant source sections; they were not all read line by line. Authenticated rendering, mobile behavior, API outcomes, notification delivery and permissions need verification against the completed branch and a test tenant.

Existing uncommitted work in employee/team screens and types was included as current source, without assuming its migrations are applied. Older documentation was used as intent, not proof of current behavior. In particular:

- The old `/select` product chooser is already gone. Do not file its removal as new work.
- My Work/Team/Administration capability checks already exist. The proposal is to complete their user experience.
- The September 21 handoff reports backend package acceptance on a test branch, with remaining work and promotion caveats. Those are historical statements, not fresh verification here.
- “No payroll Monday” is the existing workstream name. This pack does not create a new Monday deadline.

## Design approach

The repository's [Family Values design skill](../../UI%20Skill/family-values-design/SKILL.md) informed progressive disclosure and preservation of context. For this HRMS, restrained feedback and reliable controls matter more than theatrical animation. The local visual-design-master skill file was empty, so it was not used as guidance.

External references checked for this review: [NN/g on progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/), [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), and [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum). Recommendations are tailored to this source tree; no claim is made that every competing HRMS is complex or that this design has already outperformed one.
