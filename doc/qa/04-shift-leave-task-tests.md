# Shift, Leave, and Task/Project — QA test cases

28 cases (7 shift, 13 leave, 8 task/project). These three modules get lighter coverage than Organisation and Attendance by
deliberate choice — they are the priority for this round. Depth here is the next round's work.

---

## A. Shift management — `hr-qa`, `/hr/shifts`

### SH-01 · Create a shift
Create **"QA Morning Shift"**, 07:00–15:00, Mon–Fri, late marking on with a 5-minute grace.

**Expect:** saves and appears in the list.
**Report if:** the working-days picker will not accept a Mon–Fri selection, or times are stored
in a different timezone from what you entered.

### SH-02 · An impossible shift is rejected
Try a shift whose total span plus its punch-in and punch-out windows exceeds 24 hours — for
example 00:30–23:30 with 60-minute windows either side.

**Expect:** rejected. **Report if it saves** — the punch windows would then overlap the next
day's, and no punch could be attributed correctly.

### SH-03 · Only one default shift
Set **QA Morning Shift** as the default while **QA General Shift** already is.

**Expect:** the default moves; exactly one shift is marked default afterwards.
**Report if:** both end up marked default, or neither.

### SH-04 · Reassign an employee, and see it in attendance
Assign **QA Project Member** to **QA Flexi Shift** (10:00–19:00, Mon–Fri, late marking OFF).

**Expect:** their current shift updates. Then, on a **Saturday**, force derivation and compare:
Flexi is Mon–Fri, so QA Project Member's Saturday should be **weekly off**, while the other five
(on General, Mon–Sat) treat it as a working day.
**This is the single most valuable shift test** — it proves shifts genuinely drive attendance
rather than being decoration. **Report if both employees get the same treatment.**

### SH-05 · A scheduled future change
Schedule a shift change for **QA Normal Employee** with a future effective date.

**Expect:** their *current* shift is unchanged today; the change is listed as upcoming.
**Report if:** the change takes effect immediately, or vanishes after a refresh.

### SH-06 · Deactivate a shift that has people on it
Try to deactivate **QA General Shift** while all six are assigned to it.

**Expect:** either refused, or a clear warning naming how many employees are affected.
**Report if:** it deactivates silently. Employees on no active shift stop being derived
altogether, and their attendance simply stops appearing with no error anywhere.

### SH-07 · The night shift crosses midnight
Assign someone to **QA Night Shift** (22:00–06:00) and have them punch in at 22:30 and out at
06:30 the next morning.

**Expect:** **one** attendance day, not two. Which calendar date it lands on is the question —
**record what you observe**; it is a design point the team needs confirmed from real use.
**Report if:** it produces two rows, or one row with negative hours.

---

## B. Leave management

Balances seeded per employee: **CL 12** · **SL 6** · **EL 18** · **LWP 0**. Nothing accrues over
time — see [`00-README.md`](00-README.md) §1.

### LV-01 · Apply for leave — `employee-qa`, `/employee/leaves`
Apply for **2 days of Casual Leave**, starting at least 2 days out.

**Expect:** the request is created with status **Pending**. The balance summary should show the
2 days as **pending**, and the available balance should not yet drop to 10 as though they were
already taken.
**Record what the balance shows** — pending days are tracked separately from used days, and
whether the UI distinguishes them is exactly what is being checked.

### LV-02 · The notice-period rule — *verified enforced*
Apply for Casual Leave **starting today** (CL requires 1 day's notice), then for Earned Leave
starting in 3 days (EL requires 7).

**Expect:** both rejected with *"This leave requires at least N days notice"*.
The apply path was read on 2026-08-31 and does enforce this. Note that the effective notice is
the **larger** of the leave type's own `min_notice_days` and a tenant-wide
`leave_min_notice_days` setting — so if the number in the message is bigger than the type's,
that is correct, not a bug.
**Report if:** either is accepted, or the message does not say how much notice is needed.

### LV-03 · The consecutive-days cap — *verified enforced, counted in working days*
Apply for **4 consecutive days** of Casual Leave (capped at 3).

**Expect:** rejected — *"Casual Leave allows a maximum of 3 working days per request"*.
**Choose your dates carefully.** The cap counts **working days**, not calendar days, so a
4-calendar-day range spanning a Sunday is only 3 working days and will correctly be **accepted**.
Pick four dates that are all working days (remember Saturday is one). Then apply for exactly
3 working days — that must be accepted.
**Report if:** four working days are accepted, or the message counts calendar days.

### LV-04 · Applying for more than you have
Apply for **10 days** of Sick Leave against a balance of 6.

**Expect:** rejected, naming the available balance.
**Report if it is accepted** — and check afterwards whether the balance went negative. A negative
balance is a high-priority report: nothing in the database prevents it.

### LV-05 · Probation and length-of-service restrictions — `onboarding-qa`
Sign in as `onboarding-qa`, who joined **2026-08-25** and is the only employee on probation.
Apply for **Earned Leave**, then **Casual Leave**, then **Sick Leave**.

**Expect:**
- **Earned Leave — rejected**, with *"Earned Leave is only available after 90 days of
  employment"*. This rule (`applicable_from_day`) **is** enforced by the apply path, and
  onboarding-qa is well short of 90 days.
- **Casual Leave — probably accepted.** CL is configured `probation_restricted = true`, but the
  apply path was read on 2026-08-31 and **does not read that column at all**. HR can set the
  flag in Policy Center and nothing enforces it.
- **Sick Leave — accepted.** Not restricted either way.

**What to record:** whether CL is accepted or refused, and if refused, the exact message. An
acceptance confirms a known gap — a configured setting that does nothing. A refusal means
something *else* is enforcing it, which is worth knowing.
**File this once** as "probation restriction on leave types is configurable but not enforced",
with your CL result as the evidence. Do not file it per leave type.

### LV-06 · Approval moves the balance — `hr-qa`, `/hr/leaves`
Approve the 2-day CL request from LV-01. Then re-check the employee's balance.

**Expect:** CL goes **12 → 10**, with 2 recorded as used and 0 still pending.
**Report if:** the balance does not move, moves by the wrong amount, or moves at *application*
time rather than approval time.

### LV-07 · Approved leave shows up in attendance
Force derivation for the approved leave dates, then look at `/hr/attendance` for those days.

**Expect:** status **On Leave** for each date.
**Report if:** they show Absent (the leave is not reaching attendance), or Present.

### LV-08 · Rejection leaves the balance alone
Apply for another 2 days, and reject it as HR with a reason.

**Expect:** balance returns to what it was; the employee sees the rejection **and the reason**.
**Report if:** a rejected request still consumes balance.

### LV-09 · Cancelling a pending request
Apply, then cancel it yourself as the employee before HR acts.

**Expect:** the request is cancelled and any pending days are released.
**Report if:** the days stay reserved, or an *approved* request can be cancelled by the employee
without HR involvement.

### LV-10 · Overlapping requests
Apply for CL over dates that overlap a leave already approved.

**Expect:** rejected as overlapping.
**Report if it is accepted** — that double-books the same day and will corrupt payroll later.

### LV-11 · Leave on a holiday or a Sunday
Apply for leave spanning **2026-09-07** (a holiday) or a Sunday.

**Expect:** record what happens. The correct behaviour is that non-working days are **not**
deducted from the balance — a holiday inside a leave range should not cost a leave day.
**Report if** the balance is charged for a holiday or a Sunday; note the exact days requested and
the exact deduction.

### LV-12 · Sick leave document requirement
Apply for Sick Leave, which is configured to require a document.

**Expect:** either an upload is demanded, or it is accepted and the requirement is only advisory.
**Record which** — the type is configured `requires_document = true`, so if nothing in the UI
asks for one, that configuration is not being honoured and is worth reporting.

### LV-13 · Holidays are visible to employees
As `employee-qa`, find the holiday list.

**Expect:** the six holidays from `01-accounts-and-fixture.md`, with 2026-12-24 marked as a
**half day**.
**Report if:** the list is empty, past holidays are missing, or the half day is not marked.

---

## C. Tasks and projects

### TP-01 · HR assigns a task — `hr-qa`, `/hr/tasks`
Create a task assigned to **QA Normal Employee**, with a due date three days out.

**Expect:** the task is created and appears in the HR list.
**Report if:** the assignee dropdown is empty or lists people from another company.

### TP-02 · The employee sees it
As `employee-qa`, open **My Tasks**.

**Expect:** the task from TP-01 appears with its due date. A notification would be a bonus; note
whether one arrives, but **no email will be sent** (SMTP is not configured).

### TP-03 · Submit for review
Submit the task with a note and, if the UI allows, an attachment.

**Expect:** status moves to submitted/pending review; the employee cannot then edit it out from
under the reviewer.
**Report if:** a submitted task can still be silently edited, or the attachment does not persist.

### TP-04 · Approve and reject
As `hr-qa`, approve TP-03's submission. Create and submit a second task, and reject that one with
a reason.

**Expect:** approval closes the task; rejection returns it to the employee **with the reason
visible to them**.
**Report if:** the rejection reason is not shown to the employee — they then have no idea what to
fix.

### TP-05 · Overdue handling
Create a task with a due date **in the past**.

**Expect:** it is flagged overdue somewhere the employee will see it.
**Report if:** an overdue task looks identical to an on-time one.

### TP-06 · Projects — `/hr/pms`
Create a project, add **QA Manager** and **QA Project Member** to it, and create a task inside it.

**Expect:** both members see the project; the project task appears under it, not loose in the
general task list.
**Report if:** a non-member can see the project, or a member cannot.

### TP-07 · The manager's view — `manager-qa`
As `manager-qa`, look at the team's tasks.

**Expect:** they can see tasks for their four direct reports and **not** for QA HR Admin (who
does not report to them).
**Report immediately if** a manager can see tasks belonging to someone outside their team.

### TP-08 · Task privacy between peers — `project-qa`
As `project-qa`, try to find `employee-qa`'s tasks.

**Expect:** not visible. A peer is not a manager.
**Report immediately if** one employee can read another's tasks.

---

## Quick record sheet

| Case | Pass / Fail | Notes |
|---|---|---|
| SH-01 create shift | | |
| SH-02 impossible shift | | |
| SH-03 single default | | |
| SH-04 reassign → attendance differs | | |
| SH-05 future change | | |
| SH-06 deactivate in-use shift | | |
| SH-07 night shift midnight | | which date it lands on: |
| LV-01 apply | | balance shown: |
| LV-02 notice period | | |
| LV-03 consecutive cap | | |
| LV-04 over-balance | | went negative? |
| LV-05 probation | | |
| LV-06 approval moves balance | | 12 → ? |
| LV-07 leave in attendance | | |
| LV-08 rejection | | |
| LV-09 cancel | | |
| LV-10 overlap | | |
| LV-11 holiday inside leave | | days charged: |
| LV-12 document requirement | | |
| LV-13 holiday list | | |
| TP-01 assign task | | |
| TP-02 employee sees it | | |
| TP-03 submit | | |
| TP-04 approve / reject | | |
| TP-05 overdue | | |
| TP-06 projects | | |
| TP-07 manager view | | |
| TP-08 peer privacy | | |
