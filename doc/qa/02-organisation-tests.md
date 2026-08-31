# Organisation module — QA test cases

18 cases. Read [`00-README.md`](00-README.md) first, especially §4.

**Signed in as `hr-qa` unless a case says otherwise.** Use a private window per persona.

Where a case says *"enforced: UI only"*, that is a verified fact, not an assumption — it was
established on 2026-08-31 by attempting the same write directly against the database and
watching it succeed. Those cases are asking you to check the **dialog appears**, not that the
action is prevented.

---

## A. Structure setup — `/hr/org-structure` ("Org Setup")

### OM-01 · Build a real hierarchy
The tenant starts with four flat departments and no Division or Team. Build one level up and one
level down.

1. Create an org unit **"India Operations"**, type **Division**, no parent.
2. Edit **Engineering** and set its parent to **India Operations**.
3. Create **"Platform Team"**, type **Team**, parent **Engineering**.

**Expect:** all three save. Engineering now shows India Operations as its parent, and Platform
Team sits under Engineering. `/hr/org-chart` renders three levels.
**Report if:** any save fails, the parent dropdown omits a unit that should be selectable, or
the org chart still shows a flat list after a refresh.

### OM-02 · A unit cannot be its own parent
Edit **Engineering** and try to set its parent to **Engineering**.

**Expect:** either Engineering is absent from its own parent dropdown, or the save is rejected
with a message. Either is acceptable.
**Report if:** it saves. A unit parented to itself can hang the org chart.

### OM-03 · Deeper cycle
With OM-01 done, edit **India Operations** and set its parent to **Platform Team** (its own
grandchild).

**Expect:** rejected with a message naming the problem.
**Report if:** it saves, or the error is a raw database message rather than something a human
can act on.

### OM-04 · Duplicate name under one parent
Create a second unit named **"Platform Team"**, also parented to Engineering.

**Expect:** rejected — names must be unique within a parent.
**Note:** the same name under a *different* parent is allowed and correct. Test that too: a
"Platform Team" under Product should save.

### OM-05 · Assign a unit head
Edit **Engineering** and set its head to **QA Manager**.

**Expect:** saves; the head is shown on the unit and on the org chart.
**Report if:** the head dropdown is empty, lists employees from another company, or the head
does not persist after a refresh.

### OM-06 · Structure lookups round-trip
In **Structure Lookups**, create one of each: a job title, a grade, a location, an employment
type, an org unit type.

**Expect:** each appears immediately in the relevant dropdown on the employee form
(`/hr/employees/create`) without a page reload.
**Report if:** anything requires a manual refresh to appear, or a newly created item cannot be
selected.

### OM-07 · Archiving something still in use — *enforced: UI only*
Archive the **Engineering** org unit while three employees are still in it.

**Expect:** a confirmation dialog appears first, saying it is referenced by *N* active
employee(s) and that existing records will be unchanged. Confirming **archives it anyway**, and
the three employees stay attached to the now-archived unit.
**This is current intended behaviour.** Report only if:
- the dialog does **not** appear, or
- the count in the dialog is wrong, or
- confirming does nothing / errors, or
- cancelling archives it anyway.

Repeat for a grade, a location and an employment type that are in use — each should warn the
same way. **Then un-archive Engineering** so later cases are not run against archived data.

### OM-08 · Archived items leave the picker but stay on records
With Engineering archived (from OM-07), open `/hr/employees/create`.

**Expect:** Engineering is not offered in the department picker. Open `QA Normal Employee` —
their department still reads Engineering.
**Report if:** an archived unit still appears in the picker, or an existing employee's
department goes blank.

---

## B. People and reporting — `/hr/employees`

### OM-09 · Change a reporting line — *cycle guard: RPC only*
Open **QA Normal Employee** → change their reporting manager from QA Manager to **QA HR Admin**.

**Expect:** saves. `QA Manager` now shows three direct reports, `QA HR Admin` shows one.
Sign in as `manager-qa` and confirm QA Normal Employee has left their team list.

Then try to create a cycle: set **QA Manager**'s manager to **QA Normal Employee**, whose
manager is QA Manager.

**Expect:** rejected with a message.
**Note:** the guard lives in the save path, not in the database — it was verified on 2026-08-31
that a direct database write creates the cycle unchecked. So what you are testing is that the
screen goes through the guarded path. **Report if it saves.**

### OM-10 · A self-managing employee
Set **QA Normal Employee**'s manager to themselves.

**Expect:** rejected, or absent from their own manager dropdown.
**Report if it saves** — and mark it high priority. This one is not blocked at the database
level either, so the screen is the only thing standing in the way.

### OM-11 · Manager status is derived, not assigned
Give **QA Project Member** a direct report: open `QA Offboarding Case` and set their manager to
QA Project Member.

**Expect:** sign in as `project-qa` — Team screens (**My Team**) now appear, where before they
did not. Remove the report again and they disappear on the next sign-in.
**Report if:** the Team screens do not appear after a fresh sign-in, or appear for someone with
no reports.

### OM-12 · Create an employee end to end
`/hr/employees/create`. Create **"QA Temp Tester"**, email `qa-temp-tester@talentmeshsolutions.com`,
department Product, job title QA Analyst, grade G1, location Pune Branch, employment type Intern,
manager QA Manager, joining date today.

**Expect:** the employee is created and appears in `/hr/employees` and `/hr/directory`.
Note in your report **whether a login was created for them**, and whether the screen told you.
**Report if:** the form loses entered data when validation fails, a required field is not marked
as required, or you cannot tell from the UI whether the new person can sign in.
**Note:** no email will be sent — SMTP is not configured. That is expected.

### OM-13 · Duplicate email
Repeat OM-12 with the same email address.

**Expect:** a clear rejection naming the duplicate email.
**Report if:** you get a raw database error, or a partial employee record is created anyway
(check `/hr/employees` afterwards — a half-created record is a serious bug).

### OM-14 · Required-field validation
Submit the create form empty, then with only a name.

**Expect:** field-level messages, no submission, nothing created.
**Report if:** a browser-native popup is used instead of in-form messages, or the page appears
to succeed and creates nothing.

### OM-15 · Edit an employee's organisational placement
Open **QA Project Member** and change department to Product, grade to G3, location to Ahmedabad HQ.

**Expect:** all three save and persist across a refresh, and the directory reflects them.
**Report if:** any field silently reverts. Pay particular attention to **department** — this
system historically kept department in two places, and a value that reverts on refresh means
they have drifted apart again.

---

## C. Directory and org chart

### OM-16 · Employee-facing directory
Sign in as **`employee-qa`** → **Directory**.

**Expect:** all colleagues in QA Testing Org are listed with name, title, department, and work
contact details. **No salary, bank account, PAN, Aadhaar, or date of birth** is shown for anyone
but themselves.
**Report immediately and at the highest priority if** any personal identity or bank field is
visible for a colleague.

### OM-17 · Org chart from both sides
View `/hr/org-chart` as `hr-qa`, then `/employee/org-chart` as `employee-qa`.

**Expect:** both render the same shape — QA Manager above their four reports, QA HR Admin
separate. After OM-01, both show the Division → Department → Team levels.
**Report if:** the two disagree, the chart is empty for the employee, or an employee with no
manager is dropped from the chart entirely rather than shown at the top.

### OM-18 · Cross-tenant leakage — *high priority*
As `hr-qa`, search the directory and every dropdown (manager picker, unit head picker, employee
filters) for names that are **not** one of the six QA employees plus anyone you created.

**Expect:** nothing. Real company names such as "TalentMesh" or "sky info" must never appear.
**Report immediately if** any non-QA name appears anywhere.

---

## Quick record sheet

| Case | Pass / Fail | Notes |
|---|---|---|
| OM-01 hierarchy | | |
| OM-02 self-parent | | |
| OM-03 deeper cycle | | |
| OM-04 duplicate name | | |
| OM-05 unit head | | |
| OM-06 lookups round-trip | | |
| OM-07 archive in use (dialog) | | |
| OM-08 archived leaves picker | | |
| OM-09 reporting line + cycle | | |
| OM-10 self-manager | | |
| OM-11 derived manager status | | |
| OM-12 create employee | | |
| OM-13 duplicate email | | |
| OM-14 required fields | | |
| OM-15 edit placement | | |
| OM-16 directory privacy | | |
| OM-17 org chart | | |
| OM-18 cross-tenant leakage | | |
