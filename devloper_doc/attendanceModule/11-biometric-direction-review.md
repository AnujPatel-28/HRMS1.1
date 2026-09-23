# 11 - Biometric Devices: Review of Doc 10 and Recommended Direction

**Reviewed:** 2026-09-23 (lead, Opus 5.5). Verifies `10-end-to-end-system-and-readiness-review.md`
against the code, evaluates the shortlisted devices, and sets the direction for the physical
attendance option. Sources: the live adapter `functions/adms-cdata/index.ts`, live
`device_ingest_punch()` on TB-M1M2, the open-source ADMS server `github.com/s0x90/zkteco-adms`
(handler/parser/adms.go), and `get.clockit.io` (zkteco, essl, pricing, one per-model guide).

---

## 1. Verdict

**Doc 10 is correct in substance, and we are building the right kind of system.** A cloud "push"
receiver (ZKTeco/eSSL ADMS, also called iclock / Cloud Server / PUSH) feeding one vendor-neutral
ingest seam is the standard way a SaaS HRMS takes punches from these terminals: the device dials out,
no static IP, no software at the customer site, many tenants on one endpoint. ClockIt itself works
exactly this way (`adms.clockit.io`, tenant routing by device serial).

What doc 10 gets right, verified in code on 2026-09-23:

| Doc 10 claim | Verified |
|---|---|
| `/iclock/cdata` gateway missing (function lives at `/adms-cdata`) | ✅ no gateway in repo |
| UTC fallback when the device/tenant timezone lookup fails | ✅ **and wider**: an *unregistered* serial also silently falls back to UTC (lines 125-136) |
| Rejected rows acknowledged with no durable quarantine | ✅ only `console.warn` |
| Status `0` treated as unknown → direction guessed from an open `attendance` row that device ingest never creates → a device sending `0` for everything makes every punch `in` | ✅ `device_ingest_punch` lines 118-128 |
| Source-policy check uses local calendar date, not the canonical shift resolver | ✅ lines 100-116 |
| Serial-only mode is explicit, per device, stamped into evidence | ✅ |
| inBio / C3 are not attendance terminals | ✅ (they are access-control panels; different SDK) |

Checked and **not** a problem: the duplicate key is `serial:employee:time:direction`
(`device_ingest_punch` line 130), so two employees punching in the same second are both kept.

## 2. What doc 10 misses (add to the device package)

1. **Handshake is the legacy form.** Our reply uses `Stamp=9999 / OpStamp=0`. Newer firmware (push
   protocol 2.x, e.g. SpeedFace) also calls **`/iclock/registry`** and expects `ATTLOGStamp` /
   `OPERLOGStamp`-style options. The open-source server handles `/iclock/registry` and simply replies
   `OK` to the GET handshake — which suggests devices tolerate a minimal reply — but this is exactly
   what the physical pilot must settle. Neither source documents what a stamp of 0 does (possible
   full-history re-upload); our idempotent ingest makes a re-upload harmless, only slow.
2. **No command channel → manual enrollment on every device.** We reply `OK` to every
   `/iclock/getrequest`, so we can never push employees to a device. Today each employee must be
   enrolled on the terminal by hand with a User ID equal to `employees.attendance_device_id`.
   Confirmed-working commands exist (`DATA UPDATE USERINFO PIN=…`, `DATA DELETE USERINFO`,
   `DATA QUERY USERINFO`, `CHECK`, `INFO`; confirmation arrives on `POST /iclock/devicecmd`; note real
   devices reject `USER ADD`). This is the biggest day-2 operational cost at scale.
3. **HTTP vs HTTPS.** Many units' ADMS client is HTTP-only or has weak TLS. InsForge functions are
   HTTPS-only, so the gateway must also accept **plain HTTP** (port 80/8081) from the device and
   forward over HTTPS. Consequence: a path/query "secret" travels in clear text — in practice
   serial-only mode (already built, explicit, audited) is the realistic mode for most units.
4. **Device clock drift.** ATTLOG timestamps are device-local wall-clock with no zone. A wrong device
   clock writes wrong punch times. Keep `received_at` next to `occurred_at` in evidence and flag
   drift > N minutes; push time sync once a command channel exists.
5. **"Device synced" signal (now used by C8).** `last_seen_at` is stamped only on an accepted punch.
   A healthy device that receives no punches does not advance it, so absence marking for that tenant
   waits for the next punch (never early — the safe direction). An authenticated heartbeat on the
   command poll would make it exact.
6. **Photos.** Face terminals may POST `table=ATTPHOTO`; we acknowledge and drop it (fine for now).

## 3. The shortlisted devices

Rule that decides compatibility: the **exact unit** must have **Menu → Comm → Cloud Server / ADMS**
(ClockIt's own rule: "If your device has a Cloud Server or ADMS option in the menu, it will work").
Same model names ship in variants with and without it — check the unit, not the brochure.

| Device | Type | Evidence it works over ADMS | Advice |
|---|---|---|---|
| ZKTeco **SpeedFace V5L** | visible-light face + palm/finger | open-source ADMS server tested on SpeedFace-V5L-RFID (ZAM180 fw); ClockIt lists it | **Pilot #1 (face)** |
| ZKTeco **MB160** / eSSL MB160 | face + fingerprint + card | ClockIt lists both | **Pilot #2 (fingerprint + face)**; good fit for Indian offices |
| ZKTeco MB20 | cheaper multi-bio | ClockIt lists it | Budget alternative to MB160 |
| eSSL **X990** | fingerprint | ClockIt lists it | Fingerprint-only candidate |
| ZKTeco iClock 680, UA300 | fingerprint | ClockIt lists both | OK if the unit has ADMS |
| eSSL uFace 302 / ZKTeco uFace 800 | older near-infrared face | ClockIt lists both | Works, but older platform; prefer SpeedFace/AI-Face |
| eSSL AI Face range (Mars, Jupiter, …) | = ZKTeco SpeedFace platform (ClockIt) | listed | Equivalent to SpeedFace for India sourcing |
| eSSL K90, A9, I9C, H5 · ZKTeco K40, F18, V3L, Horus, MB360 | various | **not confirmed** by these sources (ClockIt lists K990/F22/Horus E1, not these exact models) | Only after seeing the ADMS menu on the unit |
| eSSL **inBio 160/260/460, C3** | access-control **panels** | not attendance terminals; pull SDK over LAN | **Exclude** from the attendance option |

## 4. Direction: three lanes, one seam

```text
Lane 1 (primary)  Terminal ──ADMS push (HTTP)──► gateway /iclock/* ──HTTPS──► adms-cdata ─┐
Lane 2 (existing) Kiosk tablet ──JSON──► kiosk-punch ─────────────────────────────────────┤──► device_ingest_punch ──► attendance_events
Lane 3 (fallback) Device log file (USB/BioTime/eTimeTrack export) ──► HR import (B9) ────┘         (append-only evidence)
                                                                                                            │
                                                                        hourly derivation + C8 absence watermark ──► attendance
```

- **Lane 1 — ADMS push (build it properly):** covers every modern ZKTeco/eSSL unit with a Cloud
  Server menu. This is what we have; it needs the gateway and the fixes below.
- **Lane 2 — kiosk:** already built; for sites that want no hardware purchase.
- **Lane 3 — log import:** a CSV/Excel import of device logs (the unbuilt B9 bulk tooling) through the
  same seam. Cheap, and it rescues any device without ADMS, any LAN-only site, and any outage.
- **Not recommended:** an on-premise pull bridge for LAN-only devices (installs software at every
  customer; only if a large customer insists), and ClockIt — it is a **competing** cloud attendance
  SaaS (free / $2.99 per user per month) with its own system of record, not a connector that forwards
  punches to an HRMS.

## 5. End-to-end workflow

**Device onboarding (HR + installer, ~15 minutes per unit)**
1. HR opens *Devices → Add biometric*, enters the serial printed on the unit; the screen shows the
   server address (`attendance.<our-domain>`), port, and whether serial-only mode is needed.
2. Installer sets *Comm → Cloud Server/ADMS*: domain, port, HTTPS off/on as the unit supports,
   then reboots; the device appears as "online" in HR within a minute.
3. Enrollment: each employee is enrolled on the terminal with **User ID = employee code**
   (manual today; pushed from the HRMS once the command channel exists).
4. HR maps User IDs (automatic when User ID = employee code), makes sure the shift allows source
   `device`, does one test punch per person, and sees it on the day grid.

**Daily flow**
Punch → the device stores it → pushes the ATTLOG line within seconds (or later, after an outage) →
gateway → `adms-cdata` → `device_ingest_punch` (tenant from serial, employee from User ID, source
policy, idempotency) → `attendance_events` → hourly derivation builds the day → after the device has
synced past a day, the absence watermark (C8) marks no-punch working days `absent` → HR corrections /
leave / payroll read the day.

**Failure flow**
- Device offline: it buffers; on reconnect the backlog lands at the true punch times; derivation's
  lookback re-derives those days; absence waits for the sync (C8), so nobody is marked absent by an
  outage.
- Unknown User ID / forbidden source: row goes to **quarantine** (to build), HR sees "3 unmatched
  punches from device X", maps the employee, re-processes. Nothing is lost.
- Device silent for > N hours on a working day: HR alert.

## 6. Build plan (replaces the open parts of P2-03)

| Pkg | What | Needs hardware? |
|---|---|---|
| **D1** | Gateway (Cloudflare Worker on `attendance.<domain>`): `/iclock/cdata`, `/iclock/getrequest`, `/iclock/devicecmd`, `/iclock/registry` → `adms-cdata`; HTTP **and** HTTPS in; preserve method/query/raw body; plain-text out; size + rate limits; source-controlled | no |
| **D2** | Correctness: fail-closed timezone (unknown/unregistered device → reject before parsing, never UTC); durable **quarantine** table + HR review; per-device **direction mode** (trust status / alternate / infer) with `0,0` `0,1` retry and overnight tests; canonical shift resolver in the source check; `received_at` + clock-drift flag | no |
| **D3** | Handshake: answer `/iclock/registry`, modern option block; authenticated heartbeat on command poll → `last_contact_at` (makes C8 exact) | pilot confirms |
| **D4** | HR device UX: setup screen with URL/steps, health (last contact, last punch, quarantine count), audited serial-only toggle, User-ID mapping | no |
| **D5** | Command channel: push/delete employees to devices (`DATA UPDATE/DELETE USERINFO`), confirm via `devicecmd` | pilot confirms |
| **D6** | Lane 3: log-file import through the seam (= B9) | no |
| **P2-03** | Physical pilot on SpeedFace V5L + MB160: doc 10 §9 checklist + §11 gates (keep them as written) | **yes** |

Order: D1 → D2 → D4 can be built and simulated now; buy two pilot units in parallel; D3/D5 after the
pilot shows the real firmware's behaviour; D6 anytime.

## 7. Buying guidance

Buy **one SpeedFace V5L (or eSSL AI-Face equivalent) and one MB160**, from a seller who will:
show the ADMS/Cloud Server menu on the exact unit, state the firmware version, accept a domain name
(not IP-only), and take the unit back if the pilot fails. Do not buy inBio/C3 for attendance. Do not
buy in quantity until the P2-03 pilot passes.
