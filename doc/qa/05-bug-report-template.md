# Bug report template

One issue per report. Copy the block below.

The two fields that most often decide whether a bug gets fixed this week or sits unreproducible
for a month are **which account** and **what exact time**. Attendance and leave are both
time-dependent; without those two, nobody can stand where you stood.

---

```
TITLE:      <one line: what broke, not what you were doing>
CASE:       <e.g. AT-11, or "not in the plan">
MODULE:     Organisation | Attendance | Shift | Leave | Task/Project
SEVERITY:   Blocker | Major | Minor
ACCOUNT:    <the exact login you were signed in as>
WHEN:       <date and time to the minute, with timezone — e.g. 2026-08-31 09:41 IST>
BROWSER:    <e.g. Chrome 141, Windows 11 / Safari, iPhone 15>

STEPS:
1.
2.
3.

EXPECTED:   <what the test case said, or what you reasonably expected>
ACTUAL:     <what happened — exact on-screen text, copied not paraphrased>

EVIDENCE:   <screenshot, and any red text from the browser console (F12 → Console)>
```

---

## Severity

| | Meaning |
|---|---|
| **Blocker** | You cannot complete the task at all, or data is wrong in a way that would reach payroll or a payslip, or one person can see another person's private data |
| **Major** | The task can be completed but the result is wrong, or a rule that should apply does not |
| **Minor** | Confusing, awkward, or inconsistent, but the outcome is correct |

**Anything where one account sees another account's data is a Blocker**, however small it looks.
So is any wrong number in attendance hours or leave balances — those feed payroll.

---

## Before you file

1. **Check `00-README.md` §4.** Five behaviours look like bugs and are not. Roughly a third of a
   first QA round is usually spent on those five.
2. **Do it twice.** Once in the same window, once in a fresh private window. Intermittent and
   always-broken need very different fixes, and saying which you saw is genuinely useful.
3. **For anything attendance-related, note the exact minute.** "Late marking is broken" cannot be
   investigated. "Punched in at 09:40:00 and it flagged me late, when the grace runs to 09:40"
   can be fixed in an afternoon.

---

## A worked example

```
TITLE:      Late flag appears for a punch exactly on the grace boundary
CASE:       AT-11
MODULE:     Attendance
SEVERITY:   Major
ACCOUNT:    employee-qa@talentmeshsolutions.com
WHEN:       2026-09-01 09:40 IST
BROWSER:    Chrome 141, Windows 11

STEPS:
1. Signed in as employee-qa, went to /employee/punch.
2. Punched in at exactly 09:40:00 (checked against the phone clock).
3. Forced derivation for 2026-09-01 and opened /hr/attendance as hr-qa.

EXPECTED:   Status Present, NOT flagged late. The shift starts 09:30 with a 10-minute
            grace, so the late threshold is "after 09:40" and 09:40 itself is on time.
ACTUAL:     Status Present, but the row shows a late mark and the Late Marks tile
            counted it.

EVIDENCE:   screenshot-0901-latemark.png. Console clean, no errors.
```

That report is actionable because it names the boundary, the exact second, and both the employee
and HR views. Compare with "late marks are wrong sometimes", which is not.
