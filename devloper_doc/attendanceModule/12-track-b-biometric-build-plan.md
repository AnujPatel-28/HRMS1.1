# 12 - Track B: Biometric Device Lane, Build Plan and Handoff

**Written:** 2026-09-23 by the lead (Opus 5.5) · **For:** the engineer who owns Track B · **Reviewer:** the lead

This is the working plan for the biometric lane. It turns the direction in
[11 - Biometric Direction Review](11-biometric-direction-review.md) into packages you can build, each
with a done-definition. Read doc 11 first, then [10 - End-to-End Readiness Review](10-end-to-end-system-and-readiness-review.md)
(§9 has the pilot checklist and §11 the go-live gates), then [06 - Devices and Ingestion](06-devices-and-ingestion.md).

---

## 0. Scope and boundaries

**In scope:** getting punches from ZKTeco/eSSL terminals (ADMS push) and from device log files into
`attendance_events` correctly, safely and observably, plus the HR screens needed to run devices.

**Out of scope:** payroll (built last, from scratch, by a separate track), the kiosk lane (already
built), on-premise pull bridges, eSSL inBio/C3 access panels, ClockIt or any other attendance SaaS.

**Fixed architecture. Change it only through a written decision with the lead:**
- Every lane converges on **one seam**, `device_ingest_punch()` → `attendance_event_ingest()` →
  `attendance_events` (append-only evidence). The derived `attendance` day is rebuilt from evidence by
  the derivation and the C8 absence watermark. **A device never writes `attendance` directly.**
- The device protocol stops at a thin adapter (`functions/adms-cdata`). Tenant, employee, source policy
  and idempotency are decided in the database.
- Every table is tenant-scoped under RLS. Every new DEFINER function has an explicit tenant fence (RLS is
  not a backstop inside DEFINER functions).

## 1. Packages, in build order

| Pkg | Needs hardware? | Needs a DB branch? | Depends on |
|---|---|---|---|
| D1 Gateway | no | no (TB for the end-to-end test) | owner: domain + Cloudflare account |
| D2 Correctness | no | **yes** | — |
| D4 HR device UX | no | yes | D2 (quarantine, direction mode) |
| D6 Log-file import | no | yes | D2 (quarantine) |
| P2-03 Pilot | **yes** | yes | D1, D2 |
| D3 Modern handshake + heartbeat | pilot confirms | yes | pilot |
| D5 Command channel (push employees) | pilot confirms | yes | D3 |

### D1: `/iclock/*` gateway

**Why:** firmware calls `/iclock/cdata` (plus `getrequest`, `devicecmd`, `registry`), often over plain
HTTP. InsForge serves the adapter only at `https://<host>.function2.insforge.app/adms-cdata`, over HTTPS.

**Build:** a Cloudflare Worker on `attendance.<our-domain>`, source-controlled at `gateway/adms-worker/`
(`wrangler.jsonc`, `src/index.ts`, `test/`).
- It routes `/iclock/cdata`, `/iclock/getrequest`, `/iclock/devicecmd` and `/iclock/registry` (with or
  without the `.aspx` suffix some firmware adds) → `adms-cdata`. It preserves the **method, the query string
  exactly, and the raw body byte-for-byte**, and passes a `X-Adms-Path` header so the adapter knows which
  endpoint was called.
- It accepts **HTTP and HTTPS**. In Cloudflare: turn *Always Use HTTPS* **off** for this hostname only, and
  don't redirect 80→443. Document ports 80 and 443. Devices that need 8081 get a documented alternative:
  Cloudflare proxies only certain ports, so check its list and record the decision.
- Its replies are `text/plain`, pass-through status, no HTML error pages. An upstream failure returns
  `5xx` so that the **device retries**; never `200 OK`, because that tells the device to discard the buffer.
- Limits: body ≤ 1 MB (a device backlog after an outage can be large; measure it in the pilot), a
  per-serial rate limit, and `SN` required (reject before forwarding).
- It holds no secrets and no tenant logic. Logs carry serial, path, status and latency, never the body.

**Done means:** Worker unit tests pass (method/query/body preserved, `.aspx` variants, 5xx on upstream
failure, oversize rejected). `curl` over **http://** and https:// against the deployed Worker produces an
event on TB for a registered test device. It is deployed from the repo with `wrangler deploy`, and the
deploy steps are written into `06-devices-and-ingestion.md`.

### D2: Correctness in the ingest seam

Each item needs **a failing test first** (see §3). Each item that exists today was verified in code by
doc 11.

1. **Timezone fails closed.** An unknown or unregistered serial, or a device/tenant with no timezone, is
   rejected **before** parsing. Never fall back to UTC (today: `adms-cdata/index.ts` around lines 125–136).
2. **Durable quarantine.** New table `attendance_device_quarantine` holds tenant (nullable for unknown
   serials), serial, raw line, reason code, `received_at`, resolution status, `resolved_by`, and the
   resulting event id. Every rejected ATTLOG row lands there, not in `console.warn`. An HR RPC lists it,
   maps the employee, and re-processes it through the **same** seam (idempotent). RLS: HR of that tenant
   only. Unknown-serial rows are visible only to the platform admin.
3. **Per-device direction mode:** a column `direction_mode` on `attendance_devices` with the values
   `trust_status` | `alternate` | `infer`. Today, status `0` for every punch makes every punch `in`
   (`device_ingest_punch` around lines 118–128). Tests: `0,0`, `0,1`, retry of the same line, an overnight
   shift crossing midnight, and two employees punching in the same second (both kept: the idempotency key
   is `serial:employee:time:direction`).
4. **Canonical shift resolver** in the source-policy check, replacing the local calendar date (lines
   100–116). Use the same resolver as the derivation, so a night-shift punch after midnight is checked
   against the right shift.
5. **`received_at` + clock drift.** Store `received_at` next to `occurred_at` in the evidence, and flag drift
   of more than N minutes. N is a tenant setting with a default of 10, surfaced in D4.

**Done means:** a new suite `tests/m1m2/d2_device_ingest.mjs` covers every item with a before-run log that
fails for the intended reason and an after-run that passes. All other suites still pass.
`check:policy-drift` shows only the new, intended policies.

### D4: HR device UX (`src/hr/AttendanceDevices.tsx`)

- An **Add biometric device** wizard: serial → the server address/port to type on the device, step by
  step for SpeedFace and MB160 menus, and whether serial-only mode applies.
- **Health per device:** last contact, last punch, quarantine count, drift flag, and "silent for more than
  N hours on a working day".
- A **serial-only toggle** that is explicit and audited (it already exists in the DB; the UI must show
  what it means).
- A **User-ID mapping** screen: device User ID ↔ employee. Default rule: User ID = employee code. The
  quarantine review from D2 lives here.
- Follow the UI direction in `doc/ui-ux-audit-2026-09-22/` (restrained, task-first). Mobile width must
  work. Payroll must not appear anywhere.

**Done means:** HR can register a device, see it go online from a simulated punch, resolve a quarantined
row, and the employee's day updates. The owner reviews screenshots of each state (empty, online, silent,
quarantine).

### D6: Device log-file import (Lane 3, the unbuilt B9)

- Import CSV/Excel exported from BioTime, eTimeTrack, or the USB export. A column-mapping step, a
  preview with counts (matched / unmatched / duplicates), then commit through the **same seam** with
  `source='import'` and a batch id. Unmatched rows go to quarantine. Re-importing the same file is harmless.
- CSV safety: never evaluate formulas, and strip a leading `= + - @` in anything echoed back.

**Done means:** a suite imports a fixture file twice (the second run adds 0 events), unmatched rows appear
in quarantine, and derived days are correct.

### P2-03: Physical pilot (after D1 + D2)

The owner buys one **ZKTeco SpeedFace V5L** (or the eSSL AI-Face equivalent) and one **MB160**, from a
seller who will show the Cloud Server/ADMS menu on the exact unit, state the firmware version, accept a
domain name (not IP-only), and take the unit back if it fails. Run doc 10 §9 as written. In addition,
record the following in `devloper_doc/attendanceModule/13-pilot-results.md`:
- the firmware version, whether it calls `/iclock/registry`, the handshake it expects, and HTTP vs HTTPS
- what status codes it sends for in/out, and which `direction_mode` is right for it
- the backlog after 1 hour offline plus a reboot: count, arrival order, duplicates (must be 0 new events)
- the effect of `Stamp=9999 / OpStamp=0` (does it re-upload full history?)
- whether `ATTPHOTO` is sent, and at what size

**Go/no-go:** doc 10 §11 gates. Don't let anyone buy devices in quantity until the pilot passes.

### D3 / D5: after the pilot

- **D3:** answer `/iclock/registry` and the modern option block the pilot observed. Add an authenticated
  heartbeat on the command poll → `last_contact_at`. Point the C8 absence watermark at `last_contact_at`
  instead of `last_seen_at`, so that absence marking becomes exact for silent-but-healthy devices.
- **D5:** a command queue table plus `getrequest` replies: `DATA UPDATE USERINFO PIN=…`,
  `DATA DELETE USERINFO`, `DATA QUERY USERINFO`, `CHECK`, `INFO`, and time sync. Confirmations arrive on
  `POST /iclock/devicecmd`. Real devices reject `USER ADD`. The push-employee action comes from HR onboarding
  and offboarding. **Offboarding must delete the user from every device.**

## 2. Working agreement

- **Git:** branch off `main` *after* v0.9.0 is merged. One branch per package
  (`feat/biometric-d1-gateway`, `feat/biometric-d2-ingest`, …), one PR each, reviewed by the lead.
  Conventional commits (`feat:`, `fix:`, `db:`, `docs:`, `test:`). Never push to `main` directly: it
  deploys production.
- **Migrations:** Track B **owns the version range `20260914000000`–`20260914999999`**. The lead and
  Track A keep `20260912200000`+. Forward-only: a mistake gets a new `…100` fix, never an edit. The first
  time you apply a Track B migration *after* a lower-numbered lead migration exists on the same backend,
  check that `db migrations up <version>` accepts out-of-order versions, and tell the lead the result.
  Track B migrations ship in **their own release** (a `1.x` minor), never mixed into the Track A promotion.
- **Derive, don't rewrite:** to change a live function, generate the new body from live
  `pg_get_functiondef()` with anchored, once-only replacements that abort on a missing anchor, then diff
  against live (pattern: `scratch/c5-gen.mjs`). A hand-rewritten function body once dropped six statements.
  The repo migration files are **not** the schema source.
- **Backend:**
  - Until the Track A rehearsal branch is deleted, the parent has **no free branch slot** (quota 2).
    Build D1 and the D4 UI shell without a DB branch.
  - After that, create your own branch `tb-biometric` (`branch create tb-biometric --mode full` from
    the parent). Don't share TB-M1M2: its suites and `branch reset` wipe each other's state.
  - Add your branch as a target in `tests/m1m2/_target.mjs` the way TB is recorded, so the
    harness guard protects you.
  - **Never write to the parent** `0431f0f6-…`.
- **Every new storage bucket** (e.g. `ATTPHOTO`) needs a branch in `c9_storage_write_allowed()`. Otherwise
  a global permissive policy makes it writable by everyone.
- **RLS:** a tenant check written PERMISSIVE is a *grant*. Write fences as RESTRICTIVE and grants as
  PERMISSIVE with a role check.
- **Acceptance** (what the lead checks): before and after logs, **all** suites run with exit codes captured
  as `node $f > log 2>&1; rc=$?`, a grep of every log for `AssertionError|HarnessBlocked|^FAIL`, a
  package review note in `doc/execution/…/reviews/`, and the relevant `devloper_doc/attendanceModule/` doc
  updated **in the same PR**.
- Environment traps (CLI eats regex backslashes, CRLF function bodies, dropped microseconds, idle-socket
  `fetch failed`) are in `doc/session_context_2026-09-23-cleanup-complete.md` §5. Read them before your first
  SQL.

## 3. Test lab without hardware

A simulated device is just HTTP. Keep these as fixtures in `tests/fixtures/adms/`:
```text
GET  /iclock/cdata?SN=TESTSN001&options=all&pushver=2.4.1            -> handshake
POST /iclock/cdata?SN=TESTSN001&table=ATTLOG&Stamp=1                 body: "1001\t2026-09-24 09:02:11\t0\t1\t0\t0\n"
GET  /iclock/getrequest?SN=TESTSN001                                 -> "OK"
POST /iclock/devicecmd?SN=TESTSN001                                  body: "ID=1&Return=0&CMD=DATA"
```
Cases to cover: unknown serial, no timezone, status 0 for everything, midnight crossing, a duplicate line,
a 5,000-line backlog, CRLF vs LF bodies, `.aspx` paths, and plain HTTP.

## 4. Decisions the owner must make (blocking where marked)

| # | Decision | Blocks |
|---|---|---|
| O1 | Gateway hostname (proposal: `attendance.talentmeshsolutions.com`) and whether that DNS zone is on Cloudflare | **D1** |
| O2 | Cloudflare account and who holds deploy access | **D1** |
| O3 | Team access for the Track B engineer: GitHub (repo is private), InsForge org member, Cloudflare | **start** |
| O4 | Buy the two pilot units (SpeedFace V5L + MB160), returnable | **P2-03** |
| O5 | Default drift threshold (proposal: 10 min) and the "silent device" alert window (proposal: 4 h on a working day) | D2/D4 (defaults usable) |
| O6 | Whether punch photos (`ATTPHOTO`) are stored at all; the recommendation is **no** for v1 (privacy + storage cost) | D3 |

## 5. Definition of done for Track B as a whole

- A SpeedFace V5L and an MB160 each pass doc 10 §11 through the production gateway.
- Every rejected punch is visible to HR and recoverable. A silent device alerts.
- An HR person with no engineering help can set a new device up in under 15 minutes by following the
  in-app steps.
- Every Track B suite and every existing suite passes, and the docs are updated. Released as its own `1.x`
  minor with a CHANGELOG entry.
