# 10 - Attendance System: End-to-End Working and Readiness Review

**Reviewed:** 2026-09-19  
**Repository:** `HRMS-Talentmesh-Solutions`  
**Backend inspected:** `TB-M1M2` (the isolated branch, not the parent HRMS project)  
**Purpose:** explain how attendance works today, how every punch path reaches the database, what is already strong, and what must be completed before production.

---

## 1. Executive verdict

The attendance architecture is going in the right direction. Its strongest decision is the separation between immutable punch evidence (`attendance_events`) and rebuildable daily conclusions (`attendance`). Device-specific protocols stop at a thin adapter, while tenant checks, employee resolution, source policy, idempotency and event creation converge in database functions.

The application and database paths are substantially implemented, and the P2-02 attendance/correction package passed independent review. The device lane is **not production-ready yet**. P2-03 remains correctly blocked on physical hardware, the test backend has no registered attendance device, the conventional ADMS route expected by common ZKTeco/eSSL firmware is not deployed, and several device-specific correctness/recovery gaps still need tests or fixes.

| Area | Current status |
|---|---|
| Employee web punch | Implemented; server-authoritative write path |
| HR attendance grid/corrections | Implemented; P2-02 independently accepted |
| Evidence log and two-pass derivation | Implemented |
| Kiosk UI and adapter | Implemented in code; physical tablet acceptance test not completed |
| ZKTeco/eSSL ADMS adapter | Implemented/simulated; real model/firmware/path test not completed |
| ADMS `/iclock/cdata` public gateway | **Missing from this repository** |
| Automatic derivation on `TB-M1M2` | Function deployed, but schedule currently inactive |
| Production readiness | **No-go until the gates in §11 pass** |

---

## 2. The system in one picture

```text
Employee web app ── JWT + GPS/selfie ──► punch_in_attendance / punch_out_attendance ─┐
                                                                                     │
Shared kiosk ─ serial + secret + code + PIN ─► kiosk-punch ─► device_ingest_punch ───┤
                                                                                     ├─► attendance_event_ingest
Biometric ─ ADMS /iclock/cdata ─► public gateway ─► adms-cdata ─► device_ingest_punch ┘          │
                                                                                                ▼
                                                                                       attendance_events
                                                                                         immutable evidence
                                                                                                │
                                                                        scheduled derivation: pass 1 + pass 2
                                                                                                │
                                                                                                ▼
                                                                                          attendance
                                                                                      rebuildable daily result
                                                                                                │
                                                                                HR review / correction / leave
                                                                                                │
                                                                                                ▼
                                                                                     payroll consumes facts later
```

The edge functions are doorways and protocol translators. Attendance rules belong in SQL/database functions. Browser, kiosk and biometric punches therefore share the same invariants.

---

## 3. Ways an employee can punch

### 3.1 Employee web/app punch

Route: `/employee/punch` (`src/employee/PunchInOut.tsx`).

1. The authenticated employee loads the tenant business date, active attendance row, shift/policy settings, tasks and recent attendance.
2. The UI determines whether GPS and/or a selfie must be requested. It gathers evidence but does not decide the final location verdict.
3. Punch-in calls `punch_in_attendance(...)`; punch-out calls `punch_out_attendance(...)`.
4. The database re-resolves the employee, tenant, module, shift, location/geofence status and punch-out gate.
5. The punch is persisted and appended into `attendance_events`.
6. A selfie, when present, is uploaded to the private `attendance-selfies` bucket and linked in `attendance_selfies`.

Important behavior:

- The client clock does not choose the business date.
- The client-provided location label is not authoritative; the database derives the verdict.
- The punch-out UI pre-check is convenience only. `punch_out_attendance()` is the enforcement boundary.
- With Tasks disabled, the task gate must not trap punch-out. P2-02 independently verified this contract.

### 3.2 Shared kiosk punch

Routes/files: `/kiosk`, `src/kiosk/Kiosk.tsx`, `functions/kiosk-punch/index.ts`.

1. HR registers a kiosk and receives a one-time random secret.
2. The tablet stores its serial and secret locally.
3. An employee enters `employee_code` and a 4–8 digit PIN.
4. `kiosk-punch` invokes the project-admin-only `device_ingest_punch()` RPC.
5. The RPC authenticates the device, resolves the employee, checks lockouts and allowed punch sources, derives the tenant from the device row, and appends an event.
6. Kiosk time is server time; the tablet clock is ignored.

The kiosk distinguishes wrong credentials, lockout and offline/server failure without revealing which credential check failed.

### 3.3 Biometric device punch (ZKTeco/eSSL ADMS)

Files: `functions/adms-cdata/index.ts`, `migrations/20260829180000_adms-serial-only-auth-mode.sql`.

Typical devices initiate calls to the conventional paths:

```text
GET  /iclock/cdata?SN=<serial>&options=all
POST /iclock/cdata?SN=<serial>&table=ATTLOG
GET  /iclock/getrequest?SN=<serial>
```

The repository currently deploys the InsForge function at `/adms-cdata`, not `/iclock/cdata`. The intended production shape is therefore:

```text
device
  → https://attendance.<company-domain>/iclock/cdata
  → gateway rewrites path and preserves method/query/raw body
  → https://<branch-app-key>.function2.insforge.app/adms-cdata
```

That gateway does not exist in this repository today. A Cloudflare Worker or equivalent reverse proxy is required unless the exact device firmware can configure the full custom path `/adms-cdata`. Do not call a model “fully compatible” until this is proven with the purchased firmware.

The adapter parses ATTLOG rows, converts the device's local wall-clock timestamp using the tenant timezone, and sends them through `device_ingest_punch()`. Offline backlogs therefore retain the device occurrence time rather than the later upload time.

### 3.4 HR edits and employee correction requests

- Employees request a correction through `request_attendance_correction()`; they cannot write the correction table directly.
- HR/direct-report reviewers read only the rows their current capability scope permits.
- Approval/rejection goes through definer RPCs with a shared no-self-approval guard.
- Approval locks the resulting day so scheduled derivation cannot silently undo the human decision.
- Raw events are never deleted. A bad event is excluded with `skip_derivation` and a reason.

---

## 4. Database model and ownership

| Object | Responsibility | Write owner |
|---|---|---|
| `attendance_events` | Append-only punch evidence, source, device/evidence data, resolved shift window, idempotency | Ingest/dual-write functions only |
| `attendance` | One rebuildable conclusion per tenant + employee + business date + shift | Punch RPCs, derivation and controlled HR RPCs |
| `shifts` | Working-time policy, thresholds, derivation modes and allowed sources | HR shift RPCs |
| `employee_shifts` | Effective-dated employee-to-shift assignments | HR scheduling RPCs |
| `attendance_corrections` | Employee correction workflow | Request/review RPCs only |
| `attendance_devices` | Device identity, hashed secret, active state and last-seen time | Registration plus HR administration |
| `attendance_device_auth_failures` | Device/PIN brute-force ledger | `device_ingest_punch()` only; no API read policy |
| `attendance_derivation_runs` | Run status and error evidence | Derivation orchestrator |
| `attendance_selfies` | Metadata linking private selfie objects to attendance | Authenticated evidence workflow |
| `holidays`, `holiday_calendars`, `holiday_calendar_days` | Default and override holiday tiers | HR calendar workflows |

The attendance unique key includes the shift. A person may legitimately have multiple attendance rows on one business date. Never call `.single()` on employee + date unless a shift is also specified.

---

## 5. Derivation: how evidence becomes a day

Derivation is intentionally repeatable and has two passes.

### Pass 1 — employees with punch events

Events are grouped by employee and resolved shift window. The function calculates first/last or paired working time according to the shift policy, then derives status, late entry, early exit and anomaly flags. It updates the event rows with the resulting `attendance_id`.

### Pass 2 — employees with no events

Absence cannot be found by querying punches. Pass 2 starts from effective shift assignments and fills the missing population with weekly-off, holiday, approved leave or absent outcomes.

### Locking and reprocessing

- Derived rows are safe to rebuild.
- HR-corrected rows have `is_locked = true` and are skipped.
- Late device uploads are handled by a lookback window; the scheduled trigger defaults to two days.
- `hr_unlock_attendance_day()` returns a day to derivation, although it currently unlocks every shift row for that employee-day.

The scheduler calls the thin `run-attendance-derivation` edge function, which authenticates a shared trigger header and invokes `attendance_run_scheduled_derivation()` with the admin key. The linked `TB-M1M2` schedule is pointed at the branch host but is currently **inactive**, so automatic processing is not happening there.

---

## 6. Database and edge-function boundary

| Boundary | Authentication | Responsibility |
|---|---|---|
| `punch_in_attendance`, `punch_out_attendance` | User JWT + explicit guards | Employee punch rules |
| `kiosk-punch` | Public HTTP; serial + secret + employee PIN become credentials | JSON transport only |
| `adms-cdata` | Public protocol endpoint; device secret where possible, explicit serial-only exception otherwise | ADMS handshake/parsing/timestamp transport |
| `device_ingest_punch` | Project admin only | Shared device auth, tenant/employee resolution, source policy, direction, idempotency and event append |
| `run-attendance-derivation` | Shared schedule token + admin key | Scheduled trigger only |
| `check-punch-out-gate` | Caller JWT | Read-only UX pre-check |
| `attendance_run_scheduled_derivation` | Project admin only | Cross-tenant scheduled orchestration |

`SECURITY DEFINER` functions bypass RLS. Every such function must re-establish tenant, module, identity, ownership and capability checks inside its transaction and pin `search_path`. This project generally follows that rule and also revokes direct attendance/correction writes at both policy and GRANT level.

---

## 7. Good practices already present

1. **Evidence/conclusion split.** Raw events survive shift-rule changes, derivation changes, corrections and late sync.
2. **Server-authoritative business date and geofence.** Browser time and client verdicts are not trusted.
3. **Vendor-neutral ingest seam.** New hardware requires an adapter, not another attendance core.
4. **Tenant derived from device identity.** A device request does not choose its tenant.
5. **Secrets are hashed and issued once.** The browser does not fetch device or PIN hashes.
6. **Idempotent event ingestion.** Replayed batches collapse instead of duplicating payroll evidence.
7. **Weak ADMS auth is explicit.** Serial-only mode is per-device, biometric-only, off by default and stamped into event evidence.
8. **Brute-force protection commits failures.** Rejections return an envelope instead of raising and rolling the counter back.
9. **Direct writes are closed.** Attendance and correction mutations use narrow RPCs; employees cannot set payroll-relevant columns from the browser.
10. **No-self-approval is shared.** Attendance corrections reuse the common reviewer guard.
11. **Module independence.** Attendance produces facts and does not calculate money; shared calendar primitives are tenant-fenced but not attendance-entitlement-gated.
12. **Physical evidence is not overstated.** The execution plan labels simulated and real-hardware verification separately.

---

## 8. Review findings that remain open

### Blocker A — conventional ADMS route is not deployed

The adapter comments and docs show `/adms-cdata`, while typical devices call `/iclock/cdata`. No path-rewriting gateway or Worker exists in the repository. Build and deploy the gateway, or prove the exact firmware supports a configurable full URL path.

### Blocker B — no physical device evidence

`attendance_devices` currently has zero rows on `TB-M1M2`; P2-03 is blocked on hardware. Kiosk and biometric claims are code/simulation claims, not field acceptance.

### Operational gate — the derivation schedule is inactive

The hourly schedule targets the isolated branch correctly but is disabled. That is safe during review, but production must enable it deliberately and verify recent successful run rows and schedule logs.

### High — all-zero ADMS status can produce all `in` directions

The adapter treats status `0` as unknown, then `device_ingest_punch()` infers direction by checking for an open row in `attendance`. Device ingestion only appends an event; it does not create an open daily row. A cheap unit that sends `0` for every punch can therefore label successive punches as `in`. Alternating derivation may still calculate by position, but `strict_log_type` shifts can be wrong.

**Required correction/test:** infer from the employee/shift event stream (or store an explicit per-device direction mode), then test `0,0`, `0,1`, retries and overnight sequences.

### High — timezone lookup fails open to UTC

`adms-cdata` defaults to UTC when its device/tenant timezone lookup fails. If the later ingest RPC succeeds, a registered device can write a valid punch at the wrong instant and possibly the wrong business date.

**Required correction/test:** a known device with an unresolved timezone must be rejected/quarantined, never silently converted as UTC. Conversion should preferably use one shared database primitive.

### High — rejected ADMS rows are acknowledged without a durable quarantine

The adapter replies `OK` even when individual rows fail, which prevents infinite whole-batch retries. That is reasonable only if rejected rows are kept elsewhere. Today they are console warnings; an unmapped employee ID or forbidden source can be lost after log retention expires.

**Required correction/test:** persist a deduplicated rejection/quarantine record containing device, raw-line hash, occurred-at, reason and retry/reconciliation status before acknowledging the batch.

### Medium — source-policy check re-derives a shift differently from canonical resolution

`device_ingest_punch()` selects an assignment by local calendar date to check `allowed_punch_sources`, then `attendance_event_ingest()` separately calls `attendance_resolve_shift()` to stamp the actual shift window. On an overnight boundary those two answers can differ.

**Required correction/test:** use the canonical resolved shift for both authorization and event stamping; include a 02:00 punch across an effective-dated assignment change.

### Medium — serial-only activation has no controlled HR workflow

The UI displays `allow_serial_only` but cannot enable or disable it. This avoids an accidental weak-mode click, but it makes the operational path an undocumented manual database change with no dedicated server audit.

**Required correction/test:** add a protected RPC with warning/confirmation, capability check and server-written audit, or explicitly document an admin-only runbook.

### Medium — some device administration still uses direct table updates

Device active state and `employees.attendance_device_id` are updated directly from `AttendanceDevices.tsx`. RLS restricts the rows, but a narrow audited RPC would provide stronger field control and a durable security trail.

### Documentation drift corrected by this review

`tenant_business_date()` is a shared tenant-fenced calendar primitive after P2-01; it no longer returns `NULL` merely because Attendance is disabled. Older docs that said otherwise were stale. The existing device guide also described direct `/adms-cdata` testing without making the production `/iclock/cdata` gateway requirement prominent.

---

## 9. Hardware recommendation: how to use the external research

The supplied research makes the ZKTeco MB160 a reasonable **pilot candidate**, with MB20 as a lower-cost candidate and eSSL X990 as a fingerprint-only candidate. It should not yet be treated as a final high-confidence compatibility decision because several matrix entries are inferred from related devices or third-party integrations rather than proven against the exact unit, firmware and TalentMesh endpoint.

Before buying more than one unit, require the seller to demonstrate:

1. The exact unit has an ADMS/iClock or Cloud Server menu.
2. Domain-name mode works; it is not IP-only.
3. HTTPS works with the installed firmware and public certificate chain.
4. The device calls the expected `/iclock/cdata` and command-poll paths.
5. It sends the actual enrolled user ID in ATTLOG.
6. Its check-in/check-out status values are captured from real packets.
7. Offline punches survive reboot/network loss and upload later.
8. The unit reconnects automatically and replay does not duplicate events.
9. The return policy allows rejection when any of these checks fail.

Avoid treating access-control panels such as eSSL inBio/C3 as drop-in attendance terminals. They belong to a different integration category and may require vendor middleware or a local polling bridge.

---

## 10. Developer runbook

### Provision a kiosk

1. Create/activate the employee and ensure `employee_code` exists.
2. Create and assign an effective shift whose `allowed_punch_sources` includes `kiosk`.
3. Register a `kiosk` in `/hr/devices` and save the one-time secret.
4. Set the employee's kiosk PIN.
5. Open `/kiosk` on the tablet and enter serial + secret once.
6. Punch IN and OUT; verify two event rows, one derived day after the job runs, and no plaintext/hash exposure.

### Provision a biometric pilot

1. Deploy the `/iclock/cdata` gateway to the correct isolated backend.
2. Register the exact hardware serial as `biometric`.
3. Map the device enrollment ID to `employees.attendance_device_id`.
4. Keep secret auth enabled if the firmware can transmit it. If not, use the explicit serial-only process and record the risk acceptance.
5. Ensure the shift allows source `device`.
6. Run the acceptance battery in §11 before enabling production use.

### Diagnose a missing punch

1. Check the device's `last_seen_at`.
2. Check edge-function logs for parse/auth/rejection warnings.
3. Look for an `attendance_events` row by employee, device and true event time.
4. If there is no event, diagnose the adapter/device mapping. If there is an event with no `attendance_id`, diagnose the derivation window/run.
5. Check `attendance_derivation_runs` and schedule logs.
6. Check `skip_derivation`, `void_reason`, resolved shift window and allowed source.

Never repair a missing day by deleting or editing raw events.

---

## 11. Production acceptance gates

All of these are required for a production “go”:

- [ ] Deploy and source-control the `/iclock/cdata` gateway; preserve raw body, query string, method and plain-text response.
- [ ] Verify the gateway cannot be redirected to another backend/tenant and has request-size/rate limits.
- [ ] Complete a physical kiosk test: setup, IN, OUT, wrong PIN, lockout, disabled device, offline error and replay.
- [ ] Complete a physical biometric test on the exact model and firmware: handshake, IN/OUT status capture, offline backlog, reboot/reconnect and duplicate replay.
- [ ] Fix/test all-zero status direction inference.
- [ ] Replace UTC fallback with fail-closed/quarantine behavior.
- [ ] Add durable rejected-row quarantine and reconciliation.
- [ ] Converge device source authorization on the canonical shift resolver.
- [ ] Keep serial-only off by default; add a controlled audited activation process if the pilot needs it.
- [ ] Enable the production derivation schedule and verify at least two consecutive successful runs.
- [ ] Verify the schedule URL points to the production app key, not a test branch or parent by accident.
- [ ] Test day shift, overnight shift, DST-capable timezone, late backlog and assignment-change boundary.
- [ ] Test app, kiosk and biometric events together for one employee without duplicate or direction corruption.
- [ ] Test an attendance-only tenant with Payroll and Tasks disabled.
- [ ] Verify HR correction, no-self-approval, locked row, unlock/re-derive and backdated leave preservation.
- [ ] Run `npm run build`, the P2 attendance suite, device batteries, policy drift and InsForge diagnostics.
- [ ] Document monitoring: schedule failures, adapter 4xx/5xx, rejection count, devices not seen, unprocessed events and derivation lag.

Until these pass, the correct release label is **internal test candidate with device support incomplete**, not production attendance.

---

## 12. Source map

| Concern | Source |
|---|---|
| Overview/index | `devloper_doc/attendanceModule/00-README.md` |
| Database model | `devloper_doc/attendanceModule/02-database-schema-and-er.md` |
| Security rules | `devloper_doc/attendanceModule/04-security-and-rls.md` |
| Frontend/RPC contracts | `devloper_doc/attendanceModule/05-frontend-and-api-integration.md` |
| Existing device guide | `devloper_doc/attendanceModule/06-devices-and-ingestion.md` |
| Historical decisions/gotchas | `devloper_doc/attendanceModule/07-decisions-and-gotchas.md` |
| Edge functions | `devloper_doc/attendanceModule/09-edge-functions.md` |
| Device schema and ingest | `migrations/20260829160000_b8-device-identity-and-kiosk-ingest.sql` |
| Device lockout | `migrations/20260829170000_kiosk-pin-lockout.sql` |
| Serial-only mode | `migrations/20260829180000_adms-serial-only-auth-mode.sql` |
| Latest correction hardening | `migrations/20260912184000_m1m2-attendance-correction-consistency.sql` |
| Device package gate | `doc/execution/non-payroll-monday/tasks.md` → P2-03 |
| Accepted attendance review | `doc/execution/non-payroll-monday/reviews/package-review-P2-02.md` |
