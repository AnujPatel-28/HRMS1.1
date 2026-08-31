# QA accounts and the seeded fixture

Tenant: **QA Testing Org** · `da7a0000-7e57-4bca-95ba-c4ea7a6eca5e` · status `active`, plan `pro`.
All twelve modules are enabled, so every screen in the product is reachable from these logins.

---

## 1. The six accounts

All six share one password. **It is not in this repository** — the repo is public, and the
previous QA password (`Password@123`) is in its git history, which is why it was rotated on
2026-08-31. Ask the project owner for `doc/qa/CREDENTIALS.local.md`.

| # | Login | Sees the app as | Employee code | Exists to test |
|---|---|---|---|---|
| 1 | `hr-qa@talentmeshsolutions.com` | **HR** | QA-HR-001 | Everything HR-side: org setup, employee records, attendance corrections, shifts, leave approval, tasks |
| 2 | `manager-qa@talentmeshsolutions.com` | Employee **+ manager** | QA-MGR-002 | Team screens, approving their reports' work. Four people report to them |
| 3 | `employee-qa@talentmeshsolutions.com` | Employee | QA-EMP-003 | The ordinary employee journey — punch, leave, tasks, profile |
| 4 | `onboarding-qa@talentmeshsolutions.com` | Employee | QA-ONB-004 | The newest joiner: **on probation**, an **Intern**, joined 2026-08-25 |
| 5 | `project-qa@talentmeshsolutions.com` | Employee | QA-PRJ-005 | The **remote** worker — geofence exceptions, work-mode handling. Contract, Design |
| 6 | `offboarding-qa@talentmeshsolutions.com` | Employee | QA-OFF-006 | Longest tenure (joined 2023-11-20) — resignation, notice period, exit clearance |

> **Two roles, not three.** #2 signs in with the same role as #3 — the app has only
> `superadmin` / `hr` / `employee`. What makes #2 a manager is that four employees list them as
> their manager. If you ever want to *remove* someone's manager status, clear their reports; there
> is no switch.

### The reporting line

```
QA HR Admin  (QA-HR-001, HR)          — no manager
QA Manager   (QA-MGR-002)             — no manager
   ├── QA Normal Employee     (QA-EMP-003)
   ├── QA Incomplete Onboarding (QA-ONB-004)
   ├── QA Project Member      (QA-PRJ-005)
   └── QA Offboarding Case    (QA-OFF-006)
```

---

## 2. Employee profiles as seeded

| Employee | Dept | Joined | Grade | Employment | Location | Work mode | Probation |
|---|---|---|---|---|---|---|---|
| QA HR Admin | Hr | 2024-04-01 | G4 Manager | Full Time | Ahmedabad HQ | office | confirmed |
| QA Manager | Engineering | 2024-06-15 | G4 Manager | Full Time | Ahmedabad HQ | hybrid | confirmed |
| QA Normal Employee | Engineering | 2025-01-06 | G2 Senior Associate | Full Time | Ahmedabad HQ | office | confirmed |
| QA Incomplete Onboarding | Product | **2026-08-25** | G1 Associate | **Intern** | Pune Branch | office | **on_probation, ends 2026-11-25** |
| QA Project Member | Design | 2025-03-10 | G2 Senior Associate | Contract | **Remote - India** | **remote** | confirmed |
| QA Offboarding Case | Engineering | **2023-11-20** | G3 Lead | Full Time | Pune Branch | office | confirmed |

The probation end date is exactly three months after joining, matching grade G1's
`default_probation_months = 3`. If the UI ever computes a different date, that is worth a report.

---

## 3. Reference data seeded for you

Created by migration `20260831200000_qa-fixture-enrichment.sql`.

**Org units** (4, all flat departments at the top level — creating a deeper hierarchy is
[test OM-01](02-organisation-tests.md)): Engineering · Product · Design · Hr
**Org unit types** (3): Division (level 1) · Department (level 2) · Team (level 3)
**Job titles** (6): Engineering Lead · HR Manager · Product Manager · QA Analyst · Software Engineer · UX Designer
**Locations** (3): Ahmedabad HQ · Pune Branch · Remote - India
**Employment types** (3): Full Time (FT) · Intern (INT) · Contract (CON)
**Grades** (4): G1 Associate · G2 Senior Associate · G3 Lead · G4 Manager

### Shifts (3)

| Shift | Hours | Working days | Late marking | Early-exit marking | Notes |
|---|---|---|---|---|---|
| **QA General Shift** *(default — everyone starts here)* | 09:30 – 18:30 | Mon–**Sat** | ON, 10-min grace | ON, 10-min grace | Absent below 2.0 h; half day below 4.0 h |
| QA Night Shift | 22:00 – 06:00 | Mon–Fri | ON, 15-min grace | OFF | Crosses midnight |
| QA Flexi Shift | 10:00 – 19:00 | Mon–**Fri** | **OFF** | OFF | Use it to see Saturday behave differently for one person |

All six employees are on **QA General Shift** from 2026-01-01. Reassigning someone is a test
step ([SH-04](04-shift-leave-task-tests.md)), so nobody has been moved for you.

> **Saturday is a working day** on the default shift. A blank Saturday is a missing day, not a
> weekend.

### Holidays — "QA India Calendar 2026" (default)

| Date | Name | |
|---|---|---|
| 2026-01-26 | Republic Day | past |
| 2026-08-15 | Independence Day | past — use this one to test back-dated derivation |
| **2026-09-07** | QA Test Holiday (not real) | **upcoming** |
| 2026-10-02 | Gandhi Jayanti | |
| 2026-12-24 | QA Half Day (not real) | **half day** — halves both hour thresholds |
| 2026-12-25 | Christmas | |

The two "(not real)" entries are fabricated for testing. Do not report them as wrong holidays.

### Leave types (4) and balances

| Type | Code | Days/yr | Notes | Balance seeded for everyone |
|---|---|---|---|---|
| Casual Leave | CL | 12 | Max 3 working days per request; 1 day notice; flagged probation-restricted † | **12.0** |
| Sick Leave | SL | 6 | Max 5 working days per request; flagged as requiring a document † | **6.0** |
| Earned Leave | EL | 15 | 7 days notice; **only after 90 days' service** (enforced); carry-forward up to 10; encashable | **18.0** (15 + 3 carried forward) |
| Leave Without Pay | LWP | 0 | **Unpaid** | 0.0 |

Every balance is `2026`, with `used_days = 0` — you will be the first to move those numbers.
**Balances do not grow over time** (see `00-README.md` §1).

† **Two of these settings are configured but not enforced.** The leave apply path was read on
2026-08-31: it enforces `min_notice_days`, `max_consecutive_days` (counted in **working days**,
not calendar days) and `applicable_from_day`, and it never reads `probation_restricted` or
`requires_document` at all. HR can set either flag in Policy Center and nothing will act on it.
[LV-05](04-shift-leave-task-tests.md) and LV-12 are written to confirm that from the UI side.

`QA Incomplete Onboarding` joined 2026-08-25, so they are both the only employee on probation
**and** the only one inside the 90-day window that gates Earned Leave — which makes them the one
account where the enforced rule and the inert one can be told apart.

---

## 4. Deliberately NOT seeded — these are the tests

Nothing below exists yet. Finding it empty is the starting state, not a bug.

- **Punches.** The tenant holds 7 attendance rows and nothing else: 2 stale `present` rows from
  an earlier session (2026-08-28 and 08-29), and 5 `weekly_off` rows for Sunday **2026-08-30**
  that appeared when derivation was force-run over 2026-08-28..08-31 while preparing this plan.
  No employee here has ever punched. Sunday rows with no punch times are normal
- Kiosk PINs, and any registered attendance device
- Leave requests
- Tasks and projects (1 stale row of each)
- Any org unit below the four departments; any Division or Team
- Any change to a reporting line
- Office locations with a geofence

---

## 5. Other fixtures in this backend — leave them alone

Three tenants named `QA Attendance Only`, `QA Attendance Payroll` and `QA Full Suite` exist to
test what happens when a module is switched **off**. Their employees have **no login at all**
and cannot be signed in as. They are exercised by SQL, not by hand. Ignore them.

---

## 6. If the fixture looks wrong

Before filing anything, an agent can re-check the whole fixture in one command:

```bash
node scratch/qa-battery-run.mjs doc/verification/qa_fixture_battery.sql
```

Part A of that suite asserts every count and every setting listed on this page. If Part A passes
and a screen still looks empty, the gap is in the product, and that is worth reporting.
