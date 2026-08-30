# 08 - Attendance Module: Common Queries Cheatsheet

Copy-paste patterns for the things developers actually need. TypeScript uses the InsForge SDK; SQL is for the CLI (`npx @insforge/cli db query "<sql>"`).

---

## 1. Reading a Day

### One employee's day
```typescript
const { data } = await db
  .from("attendance")
  .select("*")
  .eq("tenant_id", tenantId)
  .eq("employee_id", employeeId)
  .eq("date", businessDate);
// NOTE: this can return MORE THAN ONE ROW -- one per shift. Do not .single().
```

### The whole tenant for one day
```typescript
const { data } = await db
  .from("attendance")
  .select("*, employee:employee_id (id, full_name, employee_code)")
  .eq("tenant_id", tenantId)
  .eq("date", businessDate)
  .order("date", { ascending: false });
```

### Displaying times and lateness safely
```typescript
const inAt   = row.in_time  ?? row.punch_in;    // ?? is right: both are nullable
const outAt  = row.out_time ?? row.punch_out;
const isLate = row.late_entry || row.is_late;   // || is right: late_entry is NOT NULL
```

---

## 2. The Punch Trail

### Events behind one employee-day
```typescript
const from = new Date(`${date}T00:00:00`); from.setDate(from.getDate() - 1);
const to   = new Date(`${date}T00:00:00`); to.setDate(to.getDate() + 2);

const { data } = await db
  .from("attendance_events")
  .select("id, event_time, direction, source, source_ref, attendance_id, skip_derivation, void_reason, evidence")
  .eq("tenant_id", tenantId)
  .eq("employee_id", employeeId)
  .gte("event_time", from.toISOString())
  .lt("event_time", to.toISOString())
  .order("event_time", { ascending: true });
```
The ±1 day window is intentional: a night shift's punches fall outside the calendar day they belong to.

### Events not yet folded into a day
```sql
select employee_id, event_time, source, skip_derivation, void_reason
from attendance_events
where attendance_id is null
order by event_time;
```
`attendance_id IS NULL` means "derivation has not processed this". Before panicking, check whether it is outside the derivation window or deliberately excluded (`skip_derivation`).

---

## 3. Derivation Health

### Is the scheduler alive?
```bash
npx @insforge/cli schedules list
npx @insforge/cli schedules logs <id>
```

### Recent runs
```sql
select tenant_id, from_date, to_date, trigger, status, error_count, started_at, finished_at
from attendance_derivation_runs
order by started_at desc
limit 20;
```

### Runs that failed, with the reason
```sql
select tenant_id, from_date, to_date, error_count, error_detail
from attendance_derivation_runs
where status = 'failed'
order by started_at desc;
```

### Trigger a run manually (HR session, from the app)
```typescript
await db.rpc("hr_run_attendance_derivation", {
  p_tenant_id: tenantId,
  p_from: "2026-08-01",
  p_to:   "2026-08-31",
});
```

### Why is derivation producing nothing?
Run these four in order — one of them is nearly always the answer.
```sql
-- 1. any shift set to auto-derive?
select id, name, enable_auto_derivation, is_active, process_attendance_after
from shifts where tenant_id = '<tenant>';

-- 2. anyone assigned to it, covering the date?
select employee_id, shift_id, effective_from, effective_to
from employee_shifts where tenant_id = '<tenant>';

-- 3. any events in range, and are they excluded?
select count(*) filter (where skip_derivation) as excluded, count(*) as total
from attendance_events
where tenant_id = '<tenant>' and event_time >= now() - interval '7 days';

-- 4. is the module even on?
select tenant_has_module_for('<tenant>', 'attendance');
```

---

## 4. Devices

### Devices and when they last reported
```typescript
const { data } = await db
  .from("attendance_devices")
  .select("id, name, device_type, serial, is_active, allow_serial_only, last_seen_at")
  .eq("tenant_id", tenantId)
  .order("created_at", { ascending: false });
// never select secret_hash
```

### Employees who cannot use a kiosk yet
```sql
select id, full_name, employee_code, kiosk_pin_hash is not null as pin_set
from employees
where tenant_id = '<tenant>' and status = 'active'
  and (employee_code is null or kiosk_pin_hash is null);
```
From the app use `hr_list_kiosk_credentials()` instead — it never returns the hash.

### Register a device (returns the secret ONCE)
```typescript
const { data } = await db.rpc("hr_register_attendance_device", {
  p_tenant_id: tenantId,
  p_name: "Reception tablet",
  p_device_type: "kiosk",     // or 'biometric'
  p_serial: "RECEPTION-01",
  p_location_id: null,
});
// data = { device_id, serial, secret }  <-- show `secret` now or it is gone forever
```

### Is a device locked out right now?
```sql
select device_serial, employee_ref, failed_count, locked_until
from attendance_device_auth_failures
where locked_until > now();
```
(CLI only — no API role can read this table.)

---

## 5. Useful Server Functions

| Function | Use it for |
|---|---|
| `tenant_business_date(tenant, instant)` | The tenant's "today". Returns `NULL` if forbidden or module off. |
| `attendance_resolve_shift(...)` | Which shift a punch at time T belongs to. |
| `attendance_calculate_working_hours(...)` | Hours, honouring break rules. |
| `work_calendar_holiday(tenant, employee, date)` | Is this a holiday for *this* employee (with calendar precedence)? |
| `work_calendar_working_days(...)` | Working days in a range — the payroll divisor. |
| `close_stale_attendance()` | Closes sessions left open from a previous day. |

---

## 6. Quick Sanity Snapshot

```sql
select
  (select count(*) from attendance)                                   as attendance_rows,
  (select count(*) from attendance where derivation_source='derived') as derived_rows,
  (select count(*) from attendance where is_locked)                   as hr_locked_rows,
  (select count(*) from attendance_events)                            as events,
  (select count(*) from attendance_events where attendance_id is null) as unprocessed_events,
  (select count(*) from attendance_derivation_runs)                   as runs,
  (select count(*) from attendance_devices)                           as devices;
```

Read it like this:
- `derived_rows = 0` → derivation has never successfully run.
- `unprocessed_events` high → check the four questions in §3.
- `runs = 0` → the scheduler has never fired.
