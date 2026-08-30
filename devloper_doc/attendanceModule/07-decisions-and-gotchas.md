# 07 - Attendance Module: Decisions & Gotchas

Everything here was decided deliberately, usually after something broke. **Please read before changing this module.** If a decision looks wrong, the reason is written down — argue with the reason, don't quietly undo it.

---

## 1. Locked Decisions (do not re-litigate)

| Decision | Why |
|---|---|
| **`attendance_events` is append-only.** Never edit, never delete. | It is evidence. A bad event is *excluded* with `skip_derivation` + a `void_reason`, so the record of what happened survives. |
| **`late_entry` is the authority; `is_late` is kept in sync.** | `payroll_period_input` already reads `is_late`. Payroll is not designed yet, so changing what it sees would be changing an undesigned contract. Both columns get the same value until payroll is built. |
| **An HR edit locks the day (`is_locked`).** | Otherwise the next scheduled derivation silently reverts HR's decision. |
| **The lock is reversible (`hr_unlock_attendance_day`).** | Without it, one punch-time tweak would permanently exclude that day from re-derivation — including after a backdated punch arrives. |
| **A correction on a multi-shift day raises instead of guessing.** | `attendance_corrections` has no `shift_id`, so the request genuinely cannot say which shift it means. Surfacing beats silently correcting an arbitrary row. |
| **Half-day holidays do not change the working-day divisor.** | Only the thresholds halve. Changing the divisor moves money. |
| **`leaves.day_fraction` is numeric, not boolean.** | Covers half days without ruling out quarter days, and payroll can consume a fraction directly. |
| **Kiosk time is server-decided; biometric time comes from the device.** | A tablet clock is the untrusted client clock. A biometric timestamp must be honoured or offline backlogs land on the wrong day. |
| **Attendance emits facts, never money.** | Module independence. |

---

## 2. Gotchas That Have Actually Bitten Us

### `SECURITY DEFINER` bypasses RLS entirely
Not "mostly". Not "except the fence". Entirely. Every definer function must re-assert the tenant fence and module gate by hand. See `04-security-and-rls.md`.

### A `RAISE` rolls back the counter you just wrote
Postgres has no autonomous transactions. If a function writes a brute-force counter and then raises, the counter is rolled back with everything else. This is why `device_ingest_punch` **returns** failures instead of raising. There is a migration assertion guarding it.

### `attendance.punch_in` has `DEFAULT now()`
Any `INSERT` that does not name `punch_in` gets the current time, which the dual-write trigger cannot tell from a real punch — so it writes a **phantom event** into the immutable log. Always name `punch_in` explicitly (usually `NULL`) in any insert that is not a genuine punch. This shipped once and was only found later.

### Comments are part of `pg_get_functiondef`
Any check that greps a function body must strip comments first:
```sql
regexp_replace(def, '--[^\n]*', '', 'g')
```
Otherwise your assertion matches its own explanatory comment and proves nothing. This bit us twice — once in a migration assertion, once in an audit that produced a **false claim in a migration header**.

Also **collapse whitespace** before matching: a column-aligned `SET` clause (`location_confidence   = p_confidence`) will not match a single-spaced pattern, and the assertion reports a regression that does not exist.

### In SQL `LIKE`, `_` is a wildcard
`LIKE '%is_locked%'` also matches the plain English words "is locked". That false positive once got recorded as "this function reads the column" when it only mentioned it in an error message. Use a regex (`~`) for snake_case names.

### Dropping a unique index orphans every `ON CONFLICT` that inferred it
An `ON CONFLICT (a, b)` clause names **no table**, so grepping the table name will never find it. Search the conflict clause. This broke HR leave approval in production.

### `CREATE OR REPLACE` with new trailing parameters creates a **second overload**
It does not replace. You get two functions, and a stale client calling the old arity is a landmine. Use `DROP` + `CREATE`, and **re-issue the grants** — `DROP` does not preserve an ACL. (A same-signature `CREATE OR REPLACE` *does* keep its grants.)

### One pass proving something says nothing about the other
Pass 1 runs over *events*; Pass 2 runs over *assigned employees*. They can see different row shapes. A test against Pass 1 tells you nothing about the "no punches at all" case that only Pass 2 handles. Name the pass in every claim.

### pg_cron is installed but unusable
`project_admin` has no `USAGE` on the `cron` schema — `permission denied for schema cron`. The extension being present is exactly what makes this a trap. Scheduling goes through InsForge `schedules` calling an edge function.

---

## 3. Why Derivation Cannot Be Called By a Schedule Directly

`hr_run_attendance_derivation()` starts with `assert_hr_for_tenant()`, which raises when `auth.uid()` is `NULL`. A scheduled call has no user JWT, so it can never satisfy that.

That is why `attendance_run_scheduled_derivation()` exists: the same orchestration **without** the HR fence, callable only by `project_admin`, granted to no API role, and reached by an edge function holding the admin key.

The same limitation is why you cannot test HR functions from the CLI — a migration has no JWT either, so `assert_hr_for_tenant` always fails there. HR paths need a real logged-in session to verify end to end.

---

## 4. How to Verify a Change Here

1. **Assert against a population baseline, not your own rows.** Count the whole table before and after. A probe that only inspects the rows it created cannot see a row it did not expect — that is precisely how the phantom-event bug survived both an author's assertions and a review.
2. **Strip comments and collapse whitespace** before matching function source.
3. **Roll back your probes.** The batteries in `doc/verification/` use a `RAISE ... USING ERRCODE = 'ZZ001'` wrapper for this, then assert the population is restored.
4. **Check module independence.** Does it still work with payroll off?
5. **Re-verify against the live database after applying** — do not trust the apply output alone.

---

## 5. Current Gaps (honest list)

- **B9 HR bulk tooling is not built.** Bulk mark, CSV import, range regularization, unmarked-days view, aggregate reporting — none of these exist. Device provisioning exists; that is really B8 support.
- **No PIN policy beyond length.** A 4-digit PIN is permitted; a longer minimum would be safer.
- **`hr_unlock_attendance_day` is day-scoped, not row-scoped.** On a multi-shift day it unlocks every row for that employee-day.
- **`employees.kiosk_pin_hash` is still readable by HR directly**, even though the app never fetches it.
- **Client-side dates remain in read-only screens** (`MyLeaves`, `MyTeam`, `Calendar`, `RunPayroll`). They mis-render at worst; they cannot write a wrong day.
- **34 RLS policies exist in no migration**, so they cannot be recreated on a fresh project. Long-standing, not attendance-specific.
- **Nothing has been exercised by a real user yet.** In particular the kiosk has never had a real punch through it.
