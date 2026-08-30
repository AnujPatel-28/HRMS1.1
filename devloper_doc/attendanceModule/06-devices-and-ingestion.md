# 06 - Attendance Module: Devices & Ingestion

How punches get in from something that is not the web app — a shared tablet, or a fingerprint machine on the wall.

---

## 1. The Core Decision: don't design around hardware

The tempting approach is "we support ZKTeco", and then ZKTeco-shaped logic spreads through the codebase. Then a customer buys Matrix machines and you do it all again.

Instead there is **one seam** that every device type translates into:

```text
   kiosk tablet ─┐
                 ├──► device_ingest_punch() ──► attendance_event_ingest() ──► attendance_events
  ZKTeco/eSSL ───┘         (the seam)              (already existed)
   (via ADMS)

   future: Matrix, Suprema, HID → just another adapter into the same seam
```

**The core system never learns what a ZKTeco is.** An adapter's whole job is: authenticate as a device, name an employee in whatever terms that device knows, state a time. Everything after that — direction, idempotency, source policy, lockout, the append-only write — happens once, in the seam.

Hardware becomes a **support matrix** (a list of adapters we have written) rather than an architecture decision.

> This is why B8 was small. The canonical ingest, the idempotency key, and the `kiosk`/`device` source values already existed from the event-log work. Adding devices meant adding *identity*, not a pipeline.

---

## 2. Device Identity

`attendance_devices`, one row per physical thing.

| Field | Notes |
|---|---|
| `serial` | **Globally unique, not per tenant.** A biometric device announces its serial with no tenant context, so the serial is what tells us which tenant it belongs to. |
| `secret_hash` | bcrypt. The plaintext is shown **once**, at registration, and cannot be recovered. |
| `device_type` | `kiosk` or `biometric` |
| `allow_serial_only` | See §4. Defaults to `false`. |
| `is_active`, `last_seen_at` | Operational state. |

**The tenant is always derived FROM the device, never passed in as a parameter.** That way a device can never be talked into writing into somebody else's tenant.

---

## 3. Kiosk (a shared tablet)

The cheapest option — no hardware to buy.

```text
Employee walks up  →  types employee code + PIN  →  punch
        │
        ▼
POST /kiosk-punch  { serial, secret, employee_code, pin }
        │
        ▼
device_ingest_punch()  →  attendance_events
```

- The tablet holds `serial` + `secret` in `localStorage`, entered once on a setup screen.
- The employee is resolved by `employees.employee_code` + their PIN.
- **Kiosk time is decided by the server.** A tablet clock is exactly the untrusted device clock the whole module exists to remove.

> **An employee with no `employee_code` cannot use a kiosk at all.** That is the most likely thing to block a first test.

---

## 4. ADMS (ZKTeco / eSSL biometric machines)

These machines speak a plain-text "push" protocol. `functions/adms-cdata` translates it.

```text
GET  /adms-cdata?SN=<serial>&options=all   → plain-text config block (handshake)
POST /adms-cdata?SN=<serial>&table=ATTLOG  → tab-separated punches
GET  /adms-cdata?SN=<serial>&type=getrequest → "OK" (we issue no commands)
```

An ATTLOG line looks like:
```text
102     2026-08-29 09:02:31     0     1     0     0
PIN     local date & time      status verify ...
```

### Protocol rules learned the hard way

| Rule | Why |
|---|---|
| **Always reply in plain text.** | A JSON body makes the device treat the exchange as failed and resend the same logs forever. |
| **Reply `OK` even if some rows were rejected.** | Same reason. The seam is idempotent, so acknowledging a partly-rejected batch is safe. |
| **Trust status byte `1`, do NOT trust `0`.** | `1` means check-out and no device sends it by accident. `0` nominally means check-in, but many cheap units send `0` for *every* punch — trusting it would make every event an "in" and nobody would ever punch out. `0` falls through to the seam's open-session inference, which is right for both well-behaved and lazy hardware. |
| **Device timestamps are local wall-clock with no offset.** | Resolved against the tenant timezone in **two passes**, because the offset itself depends on the instant — one pass is wrong for the hour either side of a DST change. |
| **Honour the device's own timestamp.** | This is what makes a three-day offline backlog land on the right days instead of collapsing onto the moment it reconnected. |

### The authentication problem, answered honestly

An ADMS device sends its serial and **no credential**. Most firmware only lets you configure host and port — there is often nowhere to put a secret.

Three possible responses; only one is honest:

1. Require a secret always → secure, but unusable on most of the cheap hardware this product targets.
2. Silently accept serial-only for all biometric devices → usable, and quietly makes a guessable serial the entire authentication story for a payroll input. Nobody would ever notice.
3. **Support both, default to secure, make the weak mode a deliberate per-device choice that is recorded on every event it produces.** ← this is what we did.

So `allow_serial_only`:
- is **per device**, never global, never a default;
- is CHECK-constrained to `biometric` devices only (a kiosk always has an issued secret, so it has no excuse);
- stamps `auth_mode = 'serial_only'` into every event's `evidence`, so months later a disputed punch still shows what it rested on — and the HR punch trail displays it;
- still runs through brute-force lockout, so serial-guessing sweeps trip the limiter.

**A supplied secret is always verified.** The flag relaxes the requirement to *present* one; it never makes a *wrong* one acceptable.

---

## 5. Provisioning a device (HR)

1. `/hr/devices` → **Register device** → pick kiosk or biometric, give it a name and serial.
   - Kiosk: the serial is just a name you choose (`RECEPTION-01`).
   - Biometric: it **must match the machine's real serial number**, because that is how it identifies itself.
2. **Copy the secret. It is shown once and is unrecoverable.** If it is lost, delete the device and register again.
3. Give employees their credential:
   - kiosk → set a PIN (4–8 digits)
   - biometric → enter the ID they are enrolled under on the machine (`attendance_device_id`)
4. On the tablet, open `/kiosk` and enter the serial and secret once.

---

## 6. Testing without hardware

You can exercise the whole ADMS path with `curl`:

```bash
# handshake
curl "https://<project>.function2.insforge.app/adms-cdata?SN=MY-SERIAL&options=all"

# a punch (tab-separated!)
printf '102\t2026-08-29 09:02:31\t0\t1\t0\t0\n' | \
  curl -X POST "https://<project>.function2.insforge.app/adms-cdata?SN=MY-SERIAL&table=ATTLOG" \
       --data-binary @-
```

Send the same batch twice — you should get `OK: 2` both times and **no duplicate events**. That is the idempotency key doing its job.

Re-runnable test batteries live in `doc/verification/`:
- `b8_device_ingest_battery.sql`
- `b8_lockout_battery.sql`

Both create their own fixtures and roll everything back, so they are safe to run against a live database.
