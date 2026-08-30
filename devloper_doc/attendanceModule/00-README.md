# Attendance Module — Developer Documentation

Start here. Read `01` first; the rest can be read in any order.

| Doc | Read it when |
|---|---|
| [01 - Overview & Concepts](01-overview-and-concepts.md) | **Always first.** The two-layer design and why it exists. Nothing else makes sense without it. |
| [02 - Database Schema & ER](02-database-schema-and-er.md) | You need to know which table holds what. |
| [03 - Setup & Workflow](03-setup-and-workflow.md) | You are configuring a tenant, or attendance "isn't working". |
| [04 - Security & RLS](04-security-and-rls.md) | You are touching any write path. **Read before adding an RPC.** |
| [05 - Frontend & API Integration](05-frontend-and-api-integration.md) | You are building UI or calling the RPCs. |
| [06 - Devices & Ingestion](06-devices-and-ingestion.md) | Kiosk tablets or ZKTeco/eSSL biometric machines. |
| [07 - Decisions & Gotchas](07-decisions-and-gotchas.md) | **Read before changing anything.** Every entry is here because something broke. |
| [08 - Common Queries Cheatsheet](08-common-queries-cheatsheet.md) | You need a working snippet right now. |
| [09 - Edge Functions](09-edge-functions.md) | You are writing, deploying or debugging an edge function. **Read §2 before choosing an auth pattern.** |

---

## The 60-second version

Attendance has **two layers**. `attendance_events` is an append-only log of punches — the evidence. A scheduled job called **derivation** reads those events and writes `attendance`, one row per employee-day-shift — the conclusion.

That split is the whole design. It means a punch that arrives three days late still lands on the correct day, because the daily row is rebuilt from evidence rather than written once and frozen.

Three rules to remember on day one:

1. **Never edit or delete an event.** Bad ones are excluded, not removed.
2. **The client never decides the date or the lateness.** The server does, from the tenant's timezone.
3. **The browser cannot write to `attendance` at all.** Every write goes through a database function.

---

## Where things live

```text
migrations/                        the schema and every server function
functions/kiosk-punch/             kiosk HTTP boundary
functions/adms-cdata/              ZKTeco / eSSL protocol translator
functions/run-attendance-derivation/   the scheduled trigger
functions/check-punch-out-gate/    punch-out pre-check (recovered orphan)
functions/calculate-late-marks.ts  late-mark count vs the tenant threshold
src/employee/PunchInOut.tsx        employee punch screen
src/hr/Attendance.tsx              HR daily grid + punch trail
src/hr/AttendanceDevices.tsx       device provisioning
src/kiosk/Kiosk.tsx                shared-tablet punch screen
doc/verification/                  re-runnable test batteries
```

## Deeper background

These developer docs are the practical guide. The reasoning behind the architecture lives in:

- `new update doc/attendance_shift_v2_decision_doc.md` — the authority. Numbered decisions (D1–D12) and edge cases (E1–E45) referenced throughout these docs.
- `doc/attendance_b7_cutover_plan.md` — how the cutover from the old single-layer design was staged.
- `doc/session_context_2026-08-29-*.md` — the running build log.
