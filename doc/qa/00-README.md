# QA testing — start here

**Prepared 2026-08-31.** Target: the **Organisation** and **Attendance** modules, with lighter
coverage of **Shift**, **Leave**, and **Task/Project**.

Everything in these documents was checked against the live backend on the date above. Where a
behaviour was surprising it is called out, because the alternative — a tester filing correct
behaviour as a bug — costs more than the paragraph does.

---

## 1. What you are testing, and what you are not

**UI and UX are explicitly NOT under test.** A redesign is planned as the last piece of work.
Do not file "this looks dated", "spacing is inconsistent", "this needs a better empty state".
Do file anything that stops you *completing a task*: a button that does nothing, a form that
cannot be submitted, a number that is wrong, a screen that never loads.

### Out of scope — known to be missing, do not report

| Area | Status |
|---|---|
| **Payroll** | Not finished. Research and design decisions are still open; it is deliberately the last module. Any payroll screen may be incomplete or wrong. |
| **Bulk attendance tooling** | Does not exist. No bulk marking, no CSV import, no range regularisation, no unmarked-days view, no aggregate reporting. Attendance is operable one employee at a time; its HR bulk tooling was never built. |
| **Leave accrual** | `fn_accrue_monthly_leaves` exists but **is not scheduled**. Balances never grow on their own. A leave type marked "monthly accrual" describes intent, not behaviour. Your fixture balances are seeded at a usable level instead. |
| **Email** | SMTP is not configured. No verification mail, no password reset mail, no notification mail will ever arrive. Employee onboarding runs through HR-driven screens instead. |
| **Absent marking** | See §4 — the system will *not* mark an unpunched day Absent in the QA tenant. This is current correct behaviour, not a bug. |

---

## 2. Who tests what

Roughly: **if it needs a real browser, a camera, GPS, a device, or human judgment, it is
yours. If it can be decided by a query, an agent already did it.**

### Already covered by automated agent tests — do not re-test by hand

Both suites were written and **executed on 2026-08-31; every check passed.** Results are in
[`06-agent-coverage.md`](06-agent-coverage.md).

| Suite | Covers |
|---|---|
| `doc/verification/qa_fixture_battery.sql` | Fixture integrity; the full attendance derivation truth table (late-mark grace boundary to the minute, hour thresholds, weekly off, holiday, leave precedence, idempotency, HR-correction locking); organisation invariants |
| `scratch/qa-session-probe.mjs` | Row-level security as each real persona — what an employee, an HR admin, and a manager can and cannot read or write, including cross-tenant reads |

You may still see these behaviours while testing something else. If one of them looks wrong on
screen, **do report it** — a passing database check and a wrong screen is exactly the gap worth
finding.

### Yours

- Everything reachable only by clicking: forms, validation messages, navigation, filters,
  sorting, search, modals, confirmation dialogs.
- Punch in / punch out with a **real camera selfie and real GPS**. No agent can do this.
- The **kiosk** flow end to end on a real screen.
- Whether a number shown on screen matches the number the system holds — the agent suites
  prove the database is right; only you can see what the UI renders.
- Anything where the expected result in these documents does not match what you observe.

---

## 3. Setup

1. **URL:** `https://qa-test.hrms.talentmeshsolutions.com`

   > **This host must be published before testing can start.** Verified 2026-08-31: it does not
   > resolve yet (`NXDOMAIN`). There is no wildcard domain — every tenant subdomain is added by
   > hand in Vercel and GoDaddy. See §7.
   >
   > **Do not use `hrms.talentmeshsolutions.com`.** That is the super-admin/landing host. The app
   > reads the tenant from the subdomain, and the bare host deliberately resolves to *no* tenant,
   > so you would get a "not found" screen no matter which account you signed in with.

2. **Accounts and password:** see [`01-accounts-and-fixture.md`](01-accounts-and-fixture.md).
   The password is **not** in this repository — ask the project owner for
   `doc/qa/CREDENTIALS.local.md`, which is deliberately git-ignored.
3. Use a **private/incognito window per persona**. Two personas in one browser share a session
   and you will get confusing results.
4. Everything you do happens in the tenant **QA Testing Org**, which is isolated from real
   customer data. You cannot damage a real company from these accounts.

> **Do not test with any account outside the six QA logins.** The other tenants in this backend
> hold real data.

---

## 4. Five things that will look like bugs and are not

Read these before you start. Each has already cost someone an afternoon.

**1. An unpunched working day does not become "Absent".**
Absent-marking is gated behind a per-shift watermark (`last_sync_of_events`) which is currently
unset. With it unset, the system deliberately produces *no row at all* rather than guessing that
an employee was absent when it may simply have not received their punches yet. Expect a blank
day, not "Absent". Report only if a day shows Absent that shouldn't, or if a day you *did* punch
shows nothing.

**2. Attendance does not update the instant you punch.**
Punching writes an event. A separate derivation pass turns those events into the day's
attendance record, and it runs **once an hour, at 20 minutes past**, over the last two days. If
you punch at 10:05 and check the attendance screen at 10:06, the day may not have been derived
yet.

**There is no button anywhere in the product to run derivation on demand** — verified
2026-08-31, the HR screens never call it. So you have two options: wait for the next :20, or ask
whoever is running the agent suites to force it:

```bash
QA_PASSWORD='<the QA password>' node scratch/qa-force-derivation.mjs 2026-08-31 2026-08-31
```

Not having that button is itself worth noting as a gap — but file it once, as a missing feature,
not once per test case.

**3. "Manager" is not a role you can assign.**
There are exactly three roles in the app: `superadmin`, `hr`, `employee`. Being a manager is
*derived* — you are a manager if at least one employee reports to you. `QA Manager` sees Team
screens because four people have them as their manager, not because anyone ticked a box.
A separate `employee_roles` table exists with `owner` / `manager` / `payroll_admin` values; the
app does not read it. Do not report the missing role picker.

**4. Archiving an org unit that still has employees is allowed.**
You get a confirmation dialog and, if you confirm, it archives anyway with the employees still
attached. This was verified on 2026-08-31: nothing in the database prevents it. Report it if the
*dialog* is missing; do not report the archive succeeding.

**5. Leave balances never increase on their own.**
See §1. Balances only move when leave is applied, approved, or cancelled.

---

## 5. How to report

One issue per report, using the template in [`05-bug-report-template.md`](05-bug-report-template.md).
The two fields that decide whether a bug gets fixed this week or next month are **which account
you were signed in as** and **the exact date/time you did it** — attendance and leave are both
time-dependent, and without those two nobody can reproduce you.

---

## 6. The documents

| File | What it is |
|---|---|
| [`01-accounts-and-fixture.md`](01-accounts-and-fixture.md) | The six accounts, what each is for, and every piece of data seeded for you |
| [`02-organisation-tests.md`](02-organisation-tests.md) | Organisation module — 18 cases with expected results |
| [`03-attendance-tests.md`](03-attendance-tests.md) | Attendance module — 22 cases with expected results |
| [`04-shift-leave-task-tests.md`](04-shift-leave-task-tests.md) | Shift, Leave, and Task/Project — 28 cases |
| [`05-bug-report-template.md`](05-bug-report-template.md) | The report format, and one worked example |
| [`06-agent-coverage.md`](06-agent-coverage.md) | What the automated suites already proved, and their results |

---

## 7. Publishing the QA subdomain — for whoever sets this up, not the tester

The tenant row already carries the subdomain **`qa-test`**. Two steps remain, the same two the
Super Admin Console prints after creating any company:

1. **Vercel** → Project → Settings → Domains → Add: `qa-test.hrms.talentmeshsolutions.com`
2. **GoDaddy** → DNS for `talentmeshsolutions.com` → Add record:

   | Field | Value |
   |---|---|
   | Type | `CNAME` |
   | Name | `qa-test.hrms` |
   | Value | `cname.vercel-dns.com` |
   | TTL | 1 hour (default) |

Confirm with `nslookup qa-test.hrms.talentmeshsolutions.com` before handing the URL to a tester.

**Why not test locally instead.** A dev server would avoid the DNS step, but it cannot test the
part of this module that matters most. Camera and GPS need a **secure context**: `localhost` gets
a browser exception, but a phone reaching your machine over the LAN at `http://192.168.x.x:5173`
does **not** — so `getUserMedia` and `geolocation` are blocked outright, and the entire punch-in
flow with selfie and location becomes untestable on a phone. Attendance is a mobile feature.
Local testing also runs Vite's dev server rather than the built bundle Vercel actually serves,
and points at the same live backend regardless, so it isolates nothing.

Local development still works for a developer reproducing something: run `npm run dev` and use
`http://qa-test.localhost:5173` (Chrome resolves `*.localhost` on its own), or plain
`http://localhost:5173` with `VITE_DEFAULT_TENANT_ID=da7a0000-7e57-4bca-95ba-c4ea7a6eca5e` —
that env var is read **only** on localhost, by design, so the super-admin host can never quietly
serve one tenant's portal.
