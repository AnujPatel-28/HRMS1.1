# Attendance module — QA test cases

22 cases. Read [`00-README.md`](00-README.md) first — §4 items 1 and 2 in particular, because
they will otherwise cost you an hour each.

---

## How attendance actually works — read once, saves ten reports

Punching does **not** write your attendance record. It writes an **event**. A separate
**derivation** pass reads the events for a day, applies your shift's rules, and writes the day's
attendance row. Two consequences:

1. **There is a delay.** Derivation runs hourly at **:20 past**, over the previous two days.
   Punch at 10:05, and your day may not appear until 11:20. Force it with
   `QA_PASSWORD='…' node scratch/qa-force-derivation.mjs <from> <to>` — there is no button.
2. **The status is computed, never typed in.** You cannot "set" a day to Present. You produce
   punches; the system decides.

### The rules your fixture runs under (QA General Shift, 09:30–18:30, Mon–Sat)

| What | Rule | Boundary, exactly |
|---|---|---|
| Late entry | in-time **later than** 09:30 + 10 min grace | 09:40 is **on time**; 09:41 is **late** |
| Early exit | out-time **earlier than** 18:30 − 10 min grace | 18:20 is fine; 18:19 is an early exit |
| Absent | worked hours **below 2.0** | 1 h 59 m → Absent, even though you punched |
| Half day | worked hours **2.0 up to but not including 4.0** | 3 h 59 m → Half Day |
| Present | worked hours **4.0 or more** | |
| Weekly off | the day is not in the shift's working days | Sunday only — **Saturday is a working day** |
| Holiday | the date is in the holiday calendar | Half-day holidays **halve both hour thresholds** |
| On leave | an approved leave covers the date | Full day → On Leave; half day → Half Day |
| No punches, working day | **no row is produced at all** | See §4.1 of the README — Absent is *not* marked |

**Lateness is a flag, not a status.** A late full day is `Present` **and** flagged late. If you
see status "Late" replacing "Present", report it.

**Precedence, highest first:** weekly off → holiday → approved leave → hours worked.

---

## A. The employee punch journey — `employee-qa`, `/employee/punch`

These are the cases no automated test can reach: a real camera, real GPS, a real browser
permission prompt.

### AT-01 · First punch in of the day
Sign in as `employee-qa` on a **working day (Mon–Sat)** during working hours. Punch in.

**Expect:** the browser asks for camera and location permission. After allowing both, the punch
succeeds and the screen changes to **"You are clocked in"** with your punch-in time.
**Record:** the exact time you punched, to the minute. Every later case depends on it.
**Report if:** it succeeds *without* asking for camera or location, the recorded time is wrong,
or the screen still says "Ready to start your day?" after a refresh.

### AT-02 · Denying camera permission
Fresh private window, deny the camera prompt, try to punch in.

**Expect:** a clear message explaining a selfie is required. **Report if** it punches you in
anyway with no selfie — that silently breaks the evidence trail — or if the failure is silent.

### AT-03 · Denying location permission
Same, denying location instead.

**Expect:** either a clear refusal, or the punch is accepted and marked as having no/poor
location. Both are defensible; **record which one you see** — it is a policy question the team
needs an answer to.
**Report if:** the app hangs, or claims a location it cannot have.

### AT-04 · Double punch-in
While clocked in, try to punch in again (refresh first, then look for the button).

**Expect:** not offered, or refused with a message. **Report if** a second punch-in is accepted —
that produces two open sessions for one day.

### AT-05 · Punch out and the day total
Punch out at least four hours after AT-01.

**Expect:** the screen shows **"Day Complete!"** and the hours you worked. The number should
match your own arithmetic to within a minute or two.
**Report if:** the hours are wrong, negative, or wildly large.

### AT-06 · Breaks
Punch in, start a break, wait two full minutes, end it, then punch out.

**Expect:** the break appears in the break tracker; the day's worked hours **exclude** the break.
**Report if:** break time is counted as worked time, a break can be started while clocked out, or
two breaks can run at once.

### AT-07 · Punching outside the shift window
On the General shift, punch-in opens 60 minutes before start (08:30) and punch-out closes
60 minutes after end (19:30). Try punching in well before 08:30.

**Expect:** refused with a message naming the window.
**Report if:** it is accepted, or the message does not say when punching opens.

### AT-08 · Punch on a Sunday
Sign in on a Sunday (or ask for a shift change to Flexi, then try a Saturday — see
[SH-04](04-shift-leave-task-tests.md)).

**Expect:** the screen says **"Today is not a working day for your shift."**
**Report if:** you can punch normally on a non-working day with no indication at all.

### AT-09 · A working day with no punches — *expect nothing, not "Absent"*
Pick a past working day where `employee-qa` did not punch. Force derivation for it, then look at
`/employee/punch` history and `/hr/attendance`.

**Expect:** **no attendance row for that day.** Not "Absent". This is deliberate: the system
refuses to declare an absence when it may simply not have received the punches yet
(absent-marking is gated behind a per-shift watermark that is currently unset).
**Report only if:** the day shows **Absent** (the gate has been turned on without the docs being
updated), or a day you *did* punch shows nothing.

### AT-10 · A short day is Absent
Punch in and punch out **less than two hours** later. Force derivation.

**Expect:** status **Absent**, with your real punch times still recorded on the row.
**Report if:** it shows Present or Half Day, or the punch times are lost.

### AT-11 · A late arrival
Punch in **after 09:41**. Force derivation.

**Expect:** status **Present**, with a late flag/late-mark shown. Not "Late" instead of Present.
**Report if:** the status becomes "Late", or the late flag is missing, or a punch at exactly
**09:40** is flagged late (that boundary is verified correct in the database — a wrong flag here
is a UI bug worth reporting).

### AT-12 · Remote worker geofence — `project-qa`
Sign in as `project-qa` (work mode **remote**) and punch in.

**Expect:** the punch succeeds. A remote employee should not be blocked by an office geofence.
**Report if:** they are blocked, or if their punch is silently marked as an out-of-bounds
location with no explanation.

---

## B. Kiosk — needs a real second screen

The kiosk lets several employees punch from one shared device using a code and a PIN. Nothing
here has ever been exercised by a real person.

### AT-13 · Register a kiosk — `hr-qa`, `/hr/devices`
Register a new kiosk device.

**Expect:** you are shown a **secret, once only**. **Copy it before leaving the page.**
**Report if:** the secret is shown again later on the same page after a refresh (it should not
be), or you are never shown it at all (then the kiosk cannot be set up).

### AT-14 · Set a kiosk PIN
On the same screen, set a PIN for **QA Normal Employee**.

**Expect:** accepted and confirmed.
**Record whether a 4-digit PIN is accepted.** It currently is — there is no policy beyond
length. Note it once as a security observation; do not file it per employee.

### AT-15 · Punch at the kiosk
Open `/kiosk`, enter the serial and secret from AT-13, then punch as `QA-EMP-003` with the PIN.

**Expect:** the punch is accepted and the employee's name is confirmed on screen.
**Report if:** the kiosk accepts an unknown code, accepts a wrong PIN, or shows one employee's
name for another's code.

### AT-16 · Kiosk rejects bad credentials
Try, in order: a wrong PIN, an unknown employee code, a wrong device secret.

**Expect:** each is refused. Repeated wrong PINs should eventually lock the attempt out.
**Report if:** any is accepted, or the error message reveals whether the *code* or the *PIN* was
the wrong one (that helps an attacker).

---

## C. HR-side attendance — `hr-qa`, `/hr/attendance`

### AT-17 · The register shows what the employee did
After AT-01/AT-05, open `/hr/attendance` and find that date.

**Expect:** the employee's row shows the punch-in and punch-out times, the hours, and the status
you expected from the rules table. Employee code and name are correct.
**Report if:** HR sees different times or hours from what the employee saw. That is the highest-
value bug in this module.

### AT-18 · Correct a day, and check it survives
Correct `employee-qa`'s attendance for a past date — change the punch-out time and the status.

**Expect:** the change saves and is visible to the employee.
**Then force derivation again for that same date and re-check.** The correction must **still be
there**. HR corrections lock the day against being overwritten by the next derivation pass.
**Report immediately if the correction disappears** — that means every HR correction is being
silently reverted every hour.

### AT-19 · Correction requests from the employee
As `employee-qa`, raise a correction request for a past day. Then as `hr-qa`, find it under
**Attendance Corrections** and approve it. Repeat with a second request and reject it.

**Expect:** approval updates the day; rejection leaves it unchanged and the employee sees the
rejection with its reason.
**Report if:** a rejected request changes the day anyway, or an approved one does not, or the
employee is never told the outcome.

### AT-20 · Selfie and location evidence
On a day punched in AT-01, open the attendance verification details for that row.

**Expect:** the selfie taken at punch-in, GPS coordinates, and accuracy/confidence.
**Report if:** the selfie is missing for a punch that took one, another employee's selfie is
shown, or the coordinates are obviously wrong (a different city).

### AT-21 · Filters and the summary counts
Use the date range and employee filters. Compare the summary tiles (Days Present, Days Absent,
Days On Leave, Late Marks, Avg Work Hours) with the rows shown.

**Expect:** the tiles agree with the rows beneath them for the same filter.
**Report if:** a tile counts rows outside the current filter, or the counts double when you
change a filter and change back.

### AT-22 · QA Offboarding Case has no recent attendance — *this is correct*
Look for `QA-OFF-006` in the register for any date after **2026-08-02**.

**Expect:** nothing. They have an open exit request with a last working day of 2026-08-02, and
derivation deliberately stops producing attendance past an employee's relieving date.
**Report only if:** attendance *is* produced for them after that date, or if a date **before**
2026-08-02 is also missing.

---

## Quick record sheet

| Case | Pass / Fail | Notes (include exact times) |
|---|---|---|
| AT-01 first punch in | | punched at: |
| AT-02 camera denied | | |
| AT-03 location denied | | which behaviour: |
| AT-04 double punch-in | | |
| AT-05 punch out + total | | punched out at: hours shown: |
| AT-06 breaks | | |
| AT-07 outside shift window | | |
| AT-08 non-working day | | |
| AT-09 no punches → no row | | |
| AT-10 short day → Absent | | |
| AT-11 late arrival | | punched at: |
| AT-12 remote geofence | | |
| AT-13 register kiosk | | |
| AT-14 kiosk PIN | | 4-digit accepted? |
| AT-15 kiosk punch | | |
| AT-16 kiosk bad credentials | | |
| AT-17 HR register matches | | |
| AT-18 correction survives re-derivation | | |
| AT-19 correction requests | | |
| AT-20 selfie / location evidence | | |
| AT-21 filters and tiles | | |
| AT-22 offboarded employee | | |
