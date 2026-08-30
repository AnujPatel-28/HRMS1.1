# 05 - Attendance Module: Frontend & API Integration

---

## 1. The Screens

| Route | File | Who | What |
|---|---|---|---|
| `/employee/punch` | `src/employee/PunchInOut.tsx` | Employee | Punch in / out, today's status, last 7 days |
| `/hr/attendance` | `src/hr/Attendance.tsx` | HR | Daily grid, edits, corrections, **punch trail** |
| `/hr/shifts` | `src/hr/ShiftManagement.tsx` | HR | Shift policy |
| `/hr/devices` | `src/hr/AttendanceDevices.tsx` | HR | Register devices, set kiosk PINs |
| `/kiosk` | `src/kiosk/Kiosk.tsx` | Shared tablet | **No login.** The device is the authenticated thing |

Note `/kiosk` sits **outside every auth provider** in `App.tsx`. That is deliberate — it must not be behind a login gate, because no employee is logged in on a shared tablet.

---

## 2. The RPC Contracts

### Punch in
```typescript
const { data, error } = await db.rpc("punch_in_attendance", {
  p_tenant_id: tenantId,
  p_employee_id: employee.id,
  p_lat: lat, p_lng: lng, p_acc: accuracy, p_loc_status: status,
  p_ip: null,
  p_confidence: confidence,
  p_remote_exception_id: remoteExceptionId,
  p_verification_snapshot: verificationSnapshot,
});
// success → { success: true,  attendance_id, date }
// failure → { success: false, reason, errcode }
```

**It returns a failure envelope, it does not always throw.** `error` being null does **not** mean the punch worked — you must also check `data.success`. Getting this wrong shows the employee a success screen for a punch that never happened.

It deliberately does **not** write `is_late` or a half-day status. Lateness is derived.

### Punch out
```typescript
await db.rpc("punch_out_attendance", {
  p_attendance_id: attendance.id,
  p_tenant_id: tenantId,
  p_lat, p_lng, p_acc, p_loc_status,
  p_confidence, p_remote_exception_id, p_verification_snapshot,
});
```

### The server's "today"
```typescript
const { data: businessDate } = await db.rpc("tenant_business_date", {
  p_tenant_id: tenantId,
});
```

**Returns `NULL` if the caller is not allowed or the module is off.** Handle that explicitly and render an unavailable state.

> **Never fall back to `new Date()`.** That is exactly the bug this call exists to remove. A device clock that is wrong — or deliberately changed — must never be able to decide which day a punch belongs to.

### HR editing a day
```typescript
await db.rpc("hr_update_attendance", {
  p_tenant_id, p_attendance_id: row.id || null,
  p_employee_id, p_date, p_punch_in, p_punch_out,
  p_status, p_is_late, p_expected_status: row.status,
});
```
`p_expected_status` is an optimistic-concurrency check — if someone else changed the row first you get `CONCURRENCY_ERROR` instead of silently clobbering them.

Any HR edit **locks** the day (`is_locked = true`).

---

## 3. Reading Derived Columns Safely

Derived columns are only populated once derivation has run over that day. On older rows they are empty. So read them with a fallback:

```typescript
const inAt   = record.in_time  ?? record.punch_in;
const outAt  = record.out_time ?? record.punch_out;
const isLate = record.late_entry || record.is_late;
```

> **Watch the operator.** `late_entry` is `boolean NOT NULL DEFAULT false` — it is *never* null, so `late_entry ?? is_late` never falls through and always returns `false`. You need `||`. `in_time` / `out_time` genuinely are nullable, so `??` is correct there. This exact mistake shipped once and made a genuinely late day display as on time.

---

## 4. The Punch Trail (B7d)

`src/hr/components/PunchTrailTray.tsx`. HR clicks **Trail** on any day and sees the punches behind it — source, time, geolocation, device, and whether an event was excluded from derivation.

Design notes worth keeping if you touch it:

- **A tray, not a page.** The daily row is the destination; its evidence is a detail. The table stays underneath so HR does not lose their place.
- **Events stagger in.** That is earned *because HR opens this rarely.* The same animation on the punch screen — used by every employee twice a day — would be an irritation. Frequent screens get micro-interactions; rare screens can afford a moment.
- **The empty state is the common case**, so it explains *why* it is empty and distinguishes two very different situations:
  - no `derivation_source` → this day predates the event log entirely
  - derived but no events → genuinely no punches (holiday, leave, or absent)

  Showing a blank panel would let HR read "no punches" as "did not come in", which is the wrong conclusion in the first case.

---

## 5. Error Codes You Will See

| Code | Meaning | Show the user |
|---|---|---|
| `TENANT_FORBIDDEN` | Wrong tenant | Generic failure |
| `MODULE_DISABLED` | Attendance is off for this tenant | "Attendance is not enabled" |
| `EMPLOYEE_NOT_RESOLVED` | No matching employee / wrong PIN | "Code or PIN is incorrect" |
| `NOT_YOUR_ATTENDANCE` | Ownership check failed | Generic failure |
| `ALREADY_PUNCHED_IN` | Open session exists | "You are already punched in" |
| `PAYROLL_LOCKED` | Period is locked (payroll tenants only) | "This period is locked" |
| `DEVICE_AUTH_FAILED` | Unknown serial **or** wrong secret | "This kiosk is not recognised" |
| `LOCKED_OUT` | Too many failed attempts | "Please wait a few minutes" |
| `SOURCE_NOT_ALLOWED` | Shift forbids this punch source | "Not allowed for your shift" |

Two deliberate rules about these messages:

1. **Unknown serial and wrong secret return the same code.** Otherwise an attacker can enumerate valid device serials by watching which error comes back.
2. **`LOCKED_OUT` never says which key was locked or when it clears.** Telling someone the countdown hands them the schedule for their next attempt.
