# 04 - Attendance Module: Security & RLS

Attendance data becomes payroll input. A fake punch is a fake payslip. This module is therefore locked down harder than most.

---

## 1. The Big One: the browser cannot write to `attendance`

Originally the punch screen inserted straight into the `attendance` table, and an RLS policy let an employee update **their own row**. That sounds safe. It was not.

> **Postgres RLS filters ROWS. It cannot restrict COLUMNS.**

The policy said "you may update your own attendance row". It could not say "…but only the punch columns". So an employee with their normal login could open the browser console and set `work_hours = 12`, `status = 'present'`, `is_late = false`, or `is_locked = true` on their own row. Three of those feed payroll directly.

**Current state — every write goes through a function:**

```text
authenticated role on public.attendance:  SELECT only
```

```text
Employee punch      → punch_in_attendance()  / punch_out_attendance()
Selfie failed       → mark_attendance_selfie_missing()
HR edit             → hr_update_attendance()
HR approves fix     → hr_approve_attendance_correction()
HR unlocks a day    → hr_unlock_attendance_day()
Derivation          → attendance_derive_pass1 / pass2
Device / kiosk      → device_ingest_punch()
```

Each is `SECURITY DEFINER`, so it runs as the owner and is unaffected by the revoke. If you need a new attendance write, **add an RPC** — do not re-open the table grant.

---

## 2. `SECURITY DEFINER` bypasses RLS. Completely.

This is the single most misunderstood thing in this codebase.

A `SECURITY DEFINER` function runs as its **owner**, so every RLS policy, every tenant fence, every `USING` clause is skipped. Inside such a function you are effectively a superuser over these tables.

Therefore **every definer function re-asserts the fence by hand**:

```sql
-- the tenant fence, restored explicitly
IF (SELECT auth.uid()) IS NOT NULL
   AND NOT (SELECT public.can_access_tenant(p_tenant_id)) THEN
  RAISE EXCEPTION 'TENANT_FORBIDDEN';
END IF;

-- the module gate, unconditional
IF NOT (SELECT public.tenant_has_module_for(p_tenant_id, 'attendance')) THEN
  RAISE EXCEPTION 'MODULE_DISABLED';
END IF;
```

Note the `auth.uid() IS NOT NULL` part: a session-less caller (a migration, or the scheduler) is already trusted, so it passes the fence — but the **module gate still applies to everyone**.

> **Never use `FORCE ROW LEVEL SECURITY` to try to fix this.** It is a standing prohibition in this project. It does not do what people expect and it breaks the definer functions the whole module depends on.

---

## 3. RLS does not cover `TRUNCATE` either

Related lesson, found while tightening the above. Both API roles held `TRUNCATE` on 50 of 68 tables — including `tenants`, `employees` and `payslips`.

`TRUNCATE` is governed **only** by the privilege. It ignores every policy and every tenant fence, and it empties the whole table. And `anon` is the role behind the public key that ships inside the JavaScript bundle by design.

Both `TRUNCATE` and `TRIGGER` are now revoked from `anon` and `authenticated` everywhere, and the default privileges are changed so new tables do not inherit them again.

**Takeaway for reviews:** "RLS is enabled" tells you nothing about `TRUNCATE`, `TRIGGER`, or column-level access. Check the grants separately.

---

## 4. Who can read what

| Table | Employee | Manager | HR |
|---|---|---|---|
| `attendance` | own rows | their team | all |
| `attendance_events` | own | their team | all |
| `attendance_devices` | ✗ | ✗ | all (HR-only policy) |
| `attendance_device_auth_failures` | ✗ | ✗ | **✗ — nobody** |

That last row is deliberate. The brute-force ledger has RLS on with **no policies at all**, so no API role can read it. Even HR is excluded: the table records which employee codes are being probed, which is exactly the kind of thing that should not be browsable.

---

## 5. Never send a password hash to the browser

The device provisioning screen needs to show whether an employee has a kiosk PIN. The obvious way is to select `kiosk_pin_hash` and check it in JavaScript.

**Don't.** A kiosk PIN is 4–8 digits. A 4-digit PIN has **10,000** possible values. bcrypt is slow, but 10,000 guesses against a hash you already hold is minutes of offline work — after which you can punch as that person at a kiosk, silently.

Because RLS cannot restrict columns, the fix is an RPC that collapses the hash to a boolean *inside the database*:

```sql
(e.kiosk_pin_hash IS NOT NULL) AS pin_set
```

`hr_list_kiosk_credentials()` does exactly that, and the hash never crosses the API boundary.

> **Known residual, written down honestly:** a determined HR user could still query the column directly, because the grant is table-wide. Closing it properly needs a column-scoped grant or a view, on a table nearly every screen reads.

---

## 6. Brute-force lockout, and a Postgres trap worth remembering

The kiosk endpoint takes no login — the device credentials *are* the authentication. So it needs an attempt limit.

The trap: **a `RAISE` rolls back the transaction, including the failure counter you just wrote.** If a rejection raises, the counter is undone with it and the lockout counts to one forever. Postgres has no autonomous transactions to escape this.

So `device_ingest_punch` **returns** a failure envelope instead of raising:

```json
{ "success": false, "error": "DEVICE_AUTH_FAILED" }
```

The transaction commits, the counter survives, the lockout works. If you ever "tidy this up" into a `RAISE`, you silently disable brute-force protection — there is a migration assertion specifically guarding against that.

Policy: **5 failures in 15 minutes locks that key for 15 minutes.** Two separate keys — one for the device secret, one per employee — so one person mistyping their PIN cannot lock the kiosk for everybody.
