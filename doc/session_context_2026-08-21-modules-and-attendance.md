# Session context — 2026-08-21 (evening). Modules compose; attendance rebuild started.

Continues `session_context_org_module_complete_2026-08-21.md`. That handoff closed the
organisation module. This one covers everything after it: module composition, the
inter-module contract, the Work Calendar, and attendance releases **B2, B3, B4**.

**Backend:** parent `rq3qmu8y` (`0431f0f6-225f-4fb1-86b7-3fd32684c7f4`). Applied head **`20260821230000`**.
**Frontend:** `hrms.talentmeshsolutions.com`, Vercel from GitHub `main`. Repo head **`8fac670`**, pushed.
**Working tree:** clean. **Build:** green. **DB and frontend are IN SYNC.**

---

## 0. State

```
Applied head    20260821230000        (10 migrations this session)
Repo head       8fac670               pushed, working tree clean
Build           green
Policy drift    34 of 259             untracked count UNCHANGED; the 6 new policies are all in migrations
Deploy          verified live         bundle carries no p_expected_shift_hours / p_overtime_rate

Tenants 15 (12 real + 3 QA fixtures)   Employees 16   attendance_events live
```

### ⚠️ Subagents are unavailable

The account hit its **monthly spend limit** mid-session; a research agent was terminated by it.
Two earlier agents completed successfully and their work is folded in. Until the limit is
raised, work directly — spawning just burns a round trip. The repo rule still applies: after
any agent failure, check `git status` and `npm run build` before assuming its files are clean.
It was clean this time.

---

## 1. What shipped

| Migration | What |
|---|---|
| `20260821140000` | Trigger seeds `tenant_modules` on tenant creation |
| `20260821150000` | `policy_center` → core; `tenant_has_module_for()`; punch-out task gate module-guarded |
| `20260821160000` | `payroll_period_input()` — the attendance/leave → payroll contract |
| `20260821170000` | *(number unused — see §4 note on ordering)* |
| `20260821180000` | **Work Calendar** as core infrastructure |
| `20260821190000` | Three QA tenants with different module mixes |
| `20260821200000` | **B2** — punch-out derives policy server-side + ownership assertion |
| `20260821210000` | **B2 part 2** — drop the 10-arg signature. C1 closed |
| `20260821220000` | **B3** — `attendance_events` immutable log + dual-write trigger |
| `20260821230000` | **B4** — shift resolution; fills the windows B3 left NULL |

Frontend: payroll preflight + "no attendance data" skip, per-employee working days,
anomaly banner, punch-out switched to the 6-arg RPC.

---

## 2. The finding that reframed the module work

**All 12 real tenants had all 12 modules enabled, so entitlement had never once run with a
module OFF.** Three bugs were hiding in that blind spot, two of them monetary:

| Combination | What happened |
|---|---|
| payroll ON + attendance OFF | Every employee silently treated as absent all month. **Payslips persisted at ₹0.** RLS returns `{data: [], error: null}`, so the existing error checks never fired |
| payroll ON + leave OFF | Holidays resolved empty → counted as working days → `payroll-calc.ts:266` charged each as an `unaccountedDays` deduction |
| attendance ON + tasks OFF | Punch-out permanently blocked by a task on a screen the tenant cannot see. **No self-rescue** |

All three share one root cause: **an empty result treated as a real zero.** That is now a
stated rule, and it is why `payroll_period_input` returns NO ROW rather than a row of zeros.

### The pattern behind the pattern

Shared substrate kept being packaged as a sellable module. **Three times:**

1. `policy_center` — the only home of the statutory settings payroll and attendance read.
2. `holidays` — filed under `leave`, though payroll and attendance both need the calendar.
3. The weekly-off pattern — buried in `shifts`, then ignored entirely: `getWorkingDays()`
   hardcoded Sunday as the only weekly off.

1 and 2 are fixed (both now core). 3 is fixed in the backend and **wired into payroll**.

---

## 3. Do not re-litigate these

| | Decision |
|---|---|
| **Role has TWO sources, by design** | JWT metadata answers "is this session HR"; `employee_roles` holds grants a JWT cannot carry. **Never delete the JWT branch of `is_hr()`** — four HR admins have no `employees` row, so every new tenant would be dead on arrival. **Never backfill `hr_admin`** unless `employee_roles` simultaneously becomes the *writer* for HR promotion |
| **Contract carries FACTS, not policy** | Overtime *hours* cross the seam, overtime *amounts* do not. Test: if a tenant feeding us their own CSV would have to reproduce our pay rules to fill a column, it does not belong |
| **Unknown ≠ zero** | No attendance rows = no row from the contract, and payroll refuses rather than computing |
| **Module toggles stay superadmin-only**, disabled modules **fully hidden** (user's call). Hidden must not mean silent — say so at the point of failure |
| **`policy_center` is core**, not sellable (user's call) |
| **New tenants seed ALL modules enabled** | Consistent with the backfill; avoids an empty first login. To make defaults truly à-la-carte, add `modules.default_enabled` — do NOT just flip the trigger to `false` |

Attendance D1–D4 from `attendance_shift_v2_decision_doc.md` remain locked and untouched.

---

## 4. Traps learned — these cost real time

**RLS is NOT a backstop inside a SECURITY DEFINER function.** Tables are owned by
`project_admin` with `relforcerowsecurity = false`, and Postgres exempts a table's owner from
its own RLS. So every definer RPC bypasses all 34 `module_enabled_*` policies *and* the
tenant fences. `modules.ts` claims the database is the boundary "regardless" — true for the
PostgREST table path, **false for the RPC path**. Guard each seam explicitly with
`tenant_has_module_for(tenant, key)`.
**Never "fix" this with `FORCE ROW LEVEL SECURITY`** — bypassing RLS as owner is how every
definer helper works, including the chat-outage fix. Forcing it breaks all of them.

**Check the deploy by MARKER STRING, never by filename or timestamp.** Hashes differ between
local and Vercel builds. Before dropping the 10-arg punch-out I checked the live bundle and it
still contained the old parameters — that was the *previous* build. Dropping then would have
broken punch-out for every employee.

```bash
curl -s https://hrms.talentmeshsolutions.com/ | grep -oE "/assets/index-[A-Za-z0-9_-]+\.js"
curl -s https://hrms.talentmeshsolutions.com/assets/index-XXXX.js | grep -c someNewSymbol
```

**A migration that asserts its own outcome pays for itself.** Four separate assertions failed
on first run this session, each teaching something:

- Work Calendar: `can_access_tenant()` is false with no session, making the function unusable
  from migrations/cron/service-role. Fixed with an `auth.uid() IS NULL` arm.
- `drop-employees-role`: flagged `sync_admin_users`, whose `NEW.role` is `profiles.role` — a
  false positive, but failing closed was correct. Scope trigger searches to
  `pg_trigger.tgrelid = '<table>'::regclass`.
- B3: an `in` and an `out` sharing a timestamp collided, because decision doc §5.1's replay
  index omits `direction`. The log would have silently lost a punch-out. **Deviated from the
  spec, with the reason in the file.**
- B4: a 02:00 punch resolved as `offshift` — the *test* was wrong, not the algorithm. The only
  night-shift assignment lasted one day in May, and on the hardcoded August date the employee
  was on a morning shift. **Derive test dates from the data.**

**PL/pgSQL plans each statement on first execution of THAT statement.** Calling
`fn_check_insurance_expiries()` with no expiring policies "succeeded" while never entering the
loop containing the rewritten line. To prove a loop body, manufacture a row that enters it,
inside a `DO` block ending in `RAISE EXCEPTION` so the probe rolls back.

**Migration versions must sort AFTER the applied head.** A file numbered below it is refused.
`...170000` was skipped for this reason.

---

## 5. Attendance — where the rebuild stands

Authority remains `new update doc/attendance_shift_v2_decision_doc.md`.

```
B1  NOT DONE   prove an InsForge schedule end-to-end     ← blocks B6
B2  DONE       server-derived policy + ownership          C1, C3 closed
B3  DONE       attendance_events log + dual-write
B4  DONE       shift resolution
B5+ NOT DONE   derivation processor
```

### B2 — the hole was demonstrated, not assumed

As an ordinary employee against a **colleague's** open session:

```
6-arg  -> {"success": false, "reason": "NOT_YOUR_ATTENDANCE"}
10-arg -> {"success": true, "overtime_hours": 3.01}
          with p_overtime_rate 10, p_expected_shift_hours 0 — fabricated overtime, in
          overtime_records, for someone else's session, from an ordinary account
```

Probe rows removed; both tables verified back to baseline. The 10-arg signature is **gone**.

### B3 — two properties to preserve

- **Immutability is the ABSENCE of policies.** No permissive INSERT/UPDATE/DELETE exists, so
  an authenticated caller cannot write to the log at all. Verified live: SELECT works, INSERT
  refused by RLS, UPDATE and DELETE affect zero rows. **Never add a write policy** — D11
  corrections append a superseding event.
- **Dual-write is a trigger, not a client call**, because the punch path is asymmetric: punch
  IN is a direct table INSERT, punch OUT is an RPC. The trigger also captures HR manual edits.

⚠️ **The dual-write trigger RECORDS failures to `attendance_audit_logs` instead of raising**,
because the log is not yet authoritative and a logging bug must not stop someone punching in.
**FLIP THIS TO RAISING AT B5.** A day derived from a knowingly incomplete log is worse than a
failed punch. It is stated in the migration too.

### B4 — verified across boundaries

```
22:00 on the 27th  -> night shift starting 27th 18:00
02:00 on the 28th  -> the SAME shift (cross-midnight grouping)
05:30 on the 28th  -> still that shift, via the out-margin
14:00 on the 28th  -> the employee's OTHER assignment, not the night shift
```

One stated simplification: the overlap trim compares immediate neighbours via window
functions rather than Frappe's iterative cascade. Identical for two overlapping shifts;
revisit if rotating rosters arrive (D3 defers them past v1).

---

## 6. What is LEFT

### 6a. B1 — the scheduler, and why it was not forced

`schedules list` is still `[]`; **the scheduler has never run in this project**, and B6's
auto-absent job depends on it. `schedules create` invokes a **URL**, not SQL, so proving it
needs an auth story — and the two obvious routes are both things this project deliberately
moved away from: granting an RPC to `anon` (that surface was closed on purpose), or embedding
the admin key in schedule headers (that key already leaked once).

The clean route is a schedule pointed at an **edge function**, which the platform runs with
injected service credentials. That means deploying a function and confirming how it
authenticates — real work, not a five-minute check. Guessing would either open a hole or
produce a "proof" that proves nothing. **Do it properly, first.**

### 6b. Next in attendance

- **B5** — the derivation processor. Flip the dual-write failure policy here.
- **Frontend for `attendance_events`** — nothing reads the log; HR cannot see the punch trail
  behind a derived day.

### 6c. Open, not attendance work

- **34 of 259 RLS policies are in no migration.** Unchanged for four sessions. Still the
  biggest untracked item in the repo.
- **`anon` holds INSERT/UPDATE/DELETE on `employees_public`**, which unlike
  `employee_directory_public` **is** updatable. Defended only by `security_invoker = true`
  passing `employees` RLS through — safe today, but by one flag rather than by the grant.
- **`RunPayroll` still reads raw tables** for the day buckets. It now takes `working_days`
  from the contract, but the rest of `attMap` is still built from `attendance`/`leaves`
  directly. Completing that swap is natural alongside B5.
- **`Attendance.tsx:629`** still calls the client-side `getWorkingDays()` for its overtime
  estimate — display only, but it is the last Sunday-hardcoded consumer.
- **`audit_log` / `audit_logs` duplicate pair**, 33 rows each. Determine which is live.
- **Owner grants nothing yet** — recorded, unique per tenant, seeded for 3 of 12. Deliberate:
  transfer/close/billing surfaces do not exist, and building enforcement without callers is
  the §9.5 mistake.

---

## 7. Commands

```bash
npm run build                       # tsc -b && vite build
npm run check:policy-drift          # expect: 34 of 259
npx @insforge/cli db migrations list

# Verify a deploy is REALLY live before dropping anything an old client sends
curl -s https://hrms.talentmeshsolutions.com/ | grep -oE "/assets/index-[A-Za-z0-9_-]+\.js"

# QA fixtures — exercise these before shipping anything module-gated
#   QA Attendance Only / QA Attendance Payroll / QA Full Suite
#   Their employees have user_id NULL, so they cover SQL + RLS-function behaviour but NOT
#   session-level RLS. For that, provision a user via create-employee-user.

# Verify RLS as a real user (superadmin and HR sessions give FALSE NEGATIVES)
#   employee-qa@talentmeshsolutions.com / Password@123     tenant da7a0000
#   quickwin089@gmail.com / RlsVerify!2026q                tenant 97da3641 (has chat + attendance)

# Find EVERY server-side reference to a column — bare name, not just qualified forms
npx @insforge/cli db query "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and pg_get_functiondef(p.oid) ~ '\mCOLUMN\M' order by 1"
```

---

## 8. Documentation map

| Path | What |
|---|---|
| `new update doc/attendance_shift_v2_decision_doc.md` | **The attendance authority.** D1–D12, C1–C8, E1–E45, B1–B9. §5.1's replay index is wrong — see `20260821220000` |
| `doc/architecture/06-organisation-management.md` | Organisation module. §5 COMPLETE; §9.6 corrected in place |
| `doc/session_context_org_module_complete_2026-08-21.md` | The previous handoff |
| `migrations/20260821160000_*.sql` | **Read this one.** The contract, and why facts-not-policy |
| `migrations/20260821180000_*.sql` | Work Calendar, and the three-times-repeated substrate mistake |
| `migrations/20260821210000_*.sql` | The C1 vector, demonstrated with real output |
| `migrations/20260821220000_*.sql` | Why immutability is the absence of policies; the §5.1 deviation |
| `migrations/20260821230000_*.sql` | Shift resolution, incl. the stated overlap simplification |
