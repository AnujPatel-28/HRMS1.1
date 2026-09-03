# Navigation proposal — module-shaped UI

**Date:** 2026-09-03 · **Status:** proposal, nothing built.
**Inputs:** `doc/Roughpicture.md` (target module tree), the current `/select` screen, `HRLayout`,
`PayrollLayout`, and how Frappe HR solved the same problem.

---

## 0. The proposal in one line

**Keep one shell. Replace the chooser page with a persistent module switcher, and give each module
its own workspace.** Do not add a landing page per module — that is the specific thing Frappe built,
measured, and removed.

---

## 1. What exists today

| Piece | State |
|---|---|
| `/select` | Two cards — **HR Management** and **Payroll System** — each opening a separate portal |
| `HRLayout` | Sidebar with five sections: **People · Attendance · HR Management · Communication · Admin** |
| Module gating in the sidebar | **Already built.** Each nav item may declare `module`, items are filtered by `hasModule`, and a section that empties is dropped entirely |
| `PayrollLayout` | A second shell for `/payroll/*` |
| Policy Center tabs | Gated per module as of 2026-09-03 |

So the mechanism is in place and correct. What is wrong is the **shape**: the groupings are
functional ("HR Management", "Admin") rather than the module tree, and `/select` splits the product
on an axis the target architecture does not use.

## 2. Where today's shape disagrees with the sketch

1. **`/select` splits HR vs Payroll.** The sketch has Payroll as **one of three peers** under
   Organisation, not one half of the product. A tenant with attendance + tasks and no payroll sees a
   two-card chooser where one card is wrong and the other is "everything else".
2. **Sidebar sections are not modules.** `Leaves` and `Holidays` sit under *HR Management* while
   `Attendance` and `Shifts` sit under *Attendance*, but the sketch puts leave and holidays **inside**
   the attendance module. `Tasks` and `Projects` are under *HR Management* rather than being their own
   Task & Project module.
3. **There is no Organisation grouping.** Employees / Directory / Org Chart / Org Setup /
   Onboarding / Offboarding are the sketch's base module, spread across *People* and *Admin* today.
4. **No `organisation` module key exists.** The base is `directory` (core) + `onboarding` +
   `offboarding` as three separate catalogue keys. Naming the sketch's base is a catalogue decision,
   not a labelling one.

## 3. What Frappe learned — the reason not to build chooser pages

Frappe HR's sidebar used to nest workspaces under **HR** and **Payroll** heads: exactly the
structure a per-module chooser produces. They removed it
([frappe/hrms#2521](https://github.com/frappe/hrms/issues/2521), shipped via #2642). Two reasons
stated in the issue:

- the nested structure **"creates unnecessary landing pages"**, and
- the top-level HR & Payroll workspace content was **"mostly redundant"** — it mostly re-listed what
  the sidebar already showed.

What replaced it: a **persistent app switcher** in the desk shell, with workspaces filtered by app
in the sidebar, so context switching happens from anywhere instead of by navigating back out to a
menu. Their v16 navigation work pushes further the same way — hover-expand sidebar, flyout
submenus — all aimed at reducing clicks between modules, not adding them.

**The lesson applied here:** the instinct ("UI should be module-shaped") is right; the mechanism
("a select page, then a different UI") is the part they had to undo. A chooser is a toll booth you
pay on every context switch.

## 4. Proposed shape

### 4.1 One shell, persistent switcher

Replace `/select` with a **module switcher pinned in the app shell** (sidebar head or top bar),
listing only the modules this tenant has. Same `hasModule` source already driving the sidebar and
the Policy Center tabs — **one mechanism for routes, nav and tabs**.

```
┌────────────────────────────────────────────────────────────┐
│ [◇ TalentMesh]  [ Attendance ▾ ]              [user ▾]      │  ← switcher, always present
├────────────┬───────────────────────────────────────────────┤
│ ORGANISATION│                                              │
│  Employees  │   ← module workspace content                 │
│  Directory  │                                              │
│  Org chart  │                                              │
│  Onboarding │                                              │
│  Offboarding│                                              │
│            │                                               │
│ ATTENDANCE  │                                              │
│  Overview   │                                              │
│  Shifts     │                                              │
│  Holidays   │                                              │
│  Leaves     │                                              │
│  Devices    │                                              │
│  Corrections│                                              │
│            │                                               │
│ ⚙ Policy    │                                              │
│ 💬 Chat      │                                              │
└────────────┴───────────────────────────────────────────────┘
```

### 4.2 Sidebar sections become the module tree

Re-group the five functional sections into the sketch's tree. This is a re-grouping of existing
`NavLinkItem` entries — no new screens.

| Section | `module` gate | Items |
|---|---|---|
| **Organisation** *(base)* | core / `onboarding` / `offboarding` per item | Employees, Directory, Org Chart, Org Setup, Onboarding, Offboarding |
| **Attendance** | `attendance` (Holidays: `work_calendar`, Leaves: `leave`) | Overview, Shifts, Holidays, Leaves, Devices, Corrections, Calendar |
| **Task & Project** | `tasks` | Projects, Tasks, Goals, Workflows |
| **Payroll & Finance** | `payroll` (Expenses: `expenses`, Insurance: `insurance`) | Salaries, Run Payroll, Payslips, IT Declarations, Expenses, Insurance *(later)* |
| **Policy Center** | core | Policy Center, Policies |
| **Add-ons** | `chat` / `connect` | Chat, Connect |

Note Holidays stays gated on `work_calendar`, not `attendance` — it is core substrate that leave and
payroll also read, and gating it on the wrong module locked an attendance-only tenant out of it once
already.

### 4.3 Each module owns its workspace, and they should differ

This is the part of the request worth building. Landing on a module shows **that module's** working
surface, not a generic dashboard:

- **Attendance** — today's punch state, who is in/out, unresolved corrections, derivation health
  (last run, failures), shift coverage warnings. Time-shaped: a day/week strip.
- **Task & Project** — board or list of projects, tasks by status, overdue items, approvals waiting.
  Work-shaped: kanban, not a calendar.
- **Payroll & Finance** — the current period, run status, exceptions blocking a run, last payslip
  batch. Period-shaped: a month selector and a run pipeline.

Different layout primitives per module is correct and is the real answer to "different UI per
module". A shared chooser page in front of them is not.

### 4.4 What happens to `/select`

Two options.

| Option | Behaviour |
|---|---|
| **A — remove it** *(recommended)* | Land on the highest-priority module the tenant has; the switcher covers the rest. Matches Frappe's conclusion. |
| **B — keep it as a first-run screen only** | Show once, remember the choice, never show again. Preserves the current "what would you like to do today?" welcome without taxing every switch. |

Either way it should stop being a permanent gate, and if kept it should list **modules**, not two
hardcoded portals.

## 5. Sequencing

1. ~~Re-group the sidebar sections into the module tree.~~ **DONE 2026-09-03** (`1b6acb5`).
   Organisation / Attendance / Task & Project / Payroll & Finance / Policy Center / Add-ons.
   Also fixed a gate that disagreed with itself: the Holidays *link* was gated on `leave` while
   `modules.ts` routes `/hr/holidays` to `work_calendar`, so an attendance-only tenant was entitled
   to the holiday calendar its own derivation reads and could not see the link to it.
2. ~~Add the persistent module switcher.~~ **DONE 2026-09-03** (`807a739`) — with a correction to
   this document's premise, see §4.5.
3. ~~Decide `/select`.~~ **REMOVED 2026-09-03** (`ef01965`). It was a *product* chooser (HR /
   Payroll / Employee) and nothing was left for it to choose: role decides the portal, and Payroll
   became a sidebar section in step 1. Login now lands on the role's own portal.
4. ~~Build the per-module workspaces.~~ **Attendance and Task & Project DONE 2026-09-04**
   (`5b843e5`) — see §4.6. Payroll's waits for the payroll module.
4. **Build the per-module workspaces** one at a time, starting with Attendance (its data is the most
   complete). This is the real work.
5. **Merge `PayrollLayout` into the one shell**, so Payroll is a module workspace rather than a
   second portal — do this during the payroll build, not before.

## 6. Open decisions

- **Does an `organisation` module key get created**, or does the sketch's base stay as
  `directory` + `onboarding` + `offboarding`? Creating one is a catalogue migration and changes
  what is sellable.
- **`/select`: remove, or keep as first-run?** (§4.4)
- **Does Payroll keep a separate shell** until it is rebuilt, or move into the single shell now?
- **Leave stays its own module key** even if it is *presented* inside Attendance — merging the keys
  would make `attendance without leave` inexpressible, and that mix has a QA fixture exercising it.

---

## 4.5 Correction: a module switcher already existed, in one mode of three

Written while implementing step 2. §4.1 above proposed adding a switcher as if the shell had none.
That was wrong, and the correction is worth keeping because it changed the work.

`HRLayout` has **three** layout modes behind a toggle — `dropdown`, `double_sidebar`, `classic` —
and `double_sidebar` already renders a section rail plus a sliding panel of that section's items.
With step 1's re-grouping, that rail *is* a module switcher: the sections it lists are now the
modules.

So the real gap was never a missing widget. It was that the other two modes printed the section name
as **static breadcrumb text**, leaving no way to change module without navigating back out through
a menu — the exact shape Frappe removed, present in two thirds of this app.

**What shipped instead of a new widget:** the breadcrumb's section name *became* the switcher, in
the top bar shared by all three modes. It names the current module and opens the list of the
tenant's others, each jumping to that module's first screen. The `module / page` breadcrumb is
preserved rather than replaced, and `double_sidebar` keeps its rail — this is a second route to the
same place, not a competing concept.

It renders `sections`, already filtered by `hasModule`, so it inherits gating from the same source
as the sidebar and the Policy Center tabs rather than forming a second opinion, and it hides itself
for a tenant with one module or none.

**The lesson for the rest of this document:** §4.1's "keep one shell, add a switcher" was written
from the sketch and the `/select` screenshot without reading `HRLayout` closely. The remaining steps
(especially §4.3, per-module workspaces) should be re-checked against what the shell already does
before being built — three layout modes is a lot of existing surface to design against.

---

## 4.6 Workspaces as built — 2026-09-04

`WorkspaceShell.tsx` is the shared frame (header, stat tiles with tone, sections, empty states) so
the workspaces read as one system. Content differs per module, which is the point.

**Attendance** (`/hr/attendance/overview`) — time-shaped. Derivation health with staleness and
failure distinguished, who is punched in right now, shift coverage, corrections waiting, and devices
that have stopped reporting. A tenant with no shifts gets the "attendance is not being derived"
warning here as well as in the Policy Center, because this is where someone looks when it seems
broken.

**Task & Project** (`/hr/tasks/overview`) — board-shaped. A status pipeline across the five statuses
the database enforces, overdue work, and what is waiting on approval. No calendar, no run health:
the questions are different, so the layout is.

**Two details worth keeping:**

- **Shift coverage only counts uncovered employees when the tenant has no default shift.** A default
  covers everyone without an explicit assignment, so counting unassigned employees naively reports a
  gap that does not exist. Verified against `QA Testing Org` — 4 active shifts, 1 default, 7 active
  employees, 6 explicit assignments — which correctly reads *Complete* rather than *1 uncovered*.
- **The pipeline uses the enforced vocabulary**, not the observed one. The `tasks.status` CHECK
  allows `assigned / in_progress / submitted / approved / rejected`; only two of those appear in
  current data. Building the board from what happens to be in the table would have produced a
  pipeline that silently gains columns later.

**`Overview` is the first nav item in each module, and that is load-bearing** — the module switcher
navigates to `section.items[0].href`, so this is what "go to Attendance" now means. Both routes are
gated in `modules.ts` alongside their module, so the entitlement story stays single-sourced.

**Not built: the Payroll workspace.** Its module is deferred, its statutory settings have no
server-side reader yet, and its "working days source" switch (§7.2 of the settings inventory) does
not exist — a workspace over that would be a frame around placeholders. It belongs with the payroll
build, alongside folding `PayrollLayout` into the single shell.
