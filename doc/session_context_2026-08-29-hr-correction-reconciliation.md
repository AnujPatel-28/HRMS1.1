# Session context — 2026-08-29. HR write paths reconciled with derivation. B7b still gated.

Continues `session_context_2026-08-28-attendance-derivation-and-b7a.md`. That handoff shipped B6 and
B7a and left B7b **blocked on a Vercel account-level gate**. That gate is **still shut**, so this
session did the server-side work that is safe with a frozen client instead.

**Backend:** parent `rq3qmu8y` (`0431f0f6-225f-4fb1-86b7-3fd32684c7f4`). Applied head **`20260829100000`**.
**Frontend:** `hrms.talentmeshsolutions.com`, Vercel from GitHub `main`.
**Build:** green. **Policy drift:** 34 of 274 — unchanged (this migration adds no policies).

---

## 0. State

```
Applied head    20260829100000      (1 migration this session)
Build           green
Policy drift    34 of 274           UNCHANGED
Data            attendance 13 | attendance_events 4 | derivation_runs 0 | tenants 15
                (all three counts identical before and after — every probe rolled back)

DEPLOY   STILL NOT LIVE. Re-checked by marker string at the top of this session:
         bundle /assets/index-_OaU7Cj5.js, byte-identical to Aug 21,
         grep -c working_hours_threshold_for_absent -> 0.
         Nothing about the deploy changed. B7b and B7c remain closed.
```

**The block is a human action and nothing in the repo can clear it.** Confirmed again this session:
there is no Vercel CLI available and no Vercel auth on this machine, so the blocked deployment's
stated reason cannot even be read from here. Open
`vercel.com/talentmeshs-projects/hrms-1-1`, open the blocked deployment, and read the reason it
names. Useful discriminator: **if it clears on its own overnight it was a daily deploy-rate limit;
if it persists it is a spend/plan cap that a human has to lift.** Do not guess beyond that.

**Standing condition, not a race:** production runs the Aug-21 client against a database at
`20260829100000`. The DB is ahead of the frontend, which is the safe direction — every server change
in this session and the last was additive or corrective, never restrictive.

---

## 1. What shipped

| Migration | What |
|---|---|
| `20260829100000` | **HR write paths honour D5 and D6.** Three defects in `hr_update_attendance` and `hr_approve_attendance_correction`, plus the recovery path the fix required |

### The three defects, all latent ONLY because derivation has never run

`attendance_derivation_runs` is still 0 while **five tenants already have a shift with
`enable_auto_derivation = true`**. Every one of these fires on the first production derivation run.

1. **D6 — HR corrections moved `is_late` and never touched `late_entry`.** The known-open item from
   the cutover plan §3a. Both functions now write `late_entry` from the *same* variable as `is_late`,
   on both the INSERT and the UPDATE branch. `payroll_period_input` is untouched.

2. **D5 — `attendance.is_locked` was read by the processor and written by NOBODY.** The decision doc
   §5.2 makes `is_locked` the flag that stops a day being re-derived, and Pass 1/Pass 2 both honour
   it — but a regex scan of every function, every trigger on `attendance`, and all of `src/` found
   **zero writers**. The guard was inert: HR corrects a day, the next derivation run silently
   reverts it, no error anywhere. Same silent-wrong-value class as the `late_mark_count = 0` bug.
   Both HR paths now set `is_locked = true` and stamp `derivation_source` — `manual` for a direct
   edit, `correction` for an approved request.

3. **D-C — both functions located the row by `(tenant_id, employee_id, date)` with no `ORDER BY` and
   no `LIMIT`.** The unique key is `(tenant_id, employee_id, date, COALESCE(shift_id, zero-uuid))`,
   so once Pass 1 writes per-shift rows an employee-day legitimately holds several rows and a plpgsql
   `SELECT INTO` without `STRICT` silently takes an arbitrary one. `attendance_corrections` has **no
   `shift_id` column**, so a correction request genuinely cannot name a shift. Both paths now count
   first and raise a self-diagnosing error rather than correcting a shift nobody chose.

### The one thing added beyond the fix, and why

**`hr_unlock_attendance_day(p_tenant_id, p_employee_id, p_date)`** — clears `is_locked` and resets
`derivation_source` to NULL for one employee-day. HR-gated, payroll-lock-aware, audited as
`attendance.unlocked`, returns the row count. **Not wired to any UI.**

Locking without an unlock is a one-way door: because nothing had ever written `is_locked`, nothing
could clear it either, so a single HR punch-time tweak would have permanently excluded that
employee-day from re-derivation after a backdated event (E17) or a month replay (E45) — the two
cases the decision doc explicitly wants to keep possible. The doc locks the **lock** and says
nothing about recovery. This is the smallest change that makes the lock reversible.

---

## 2. Verification — and exactly how far it reaches

`assert_hr_for_tenant` raises `Unauthenticated` when `auth.uid()` is NULL. A migration runs as
`project_admin` with no end-user JWT, so **these two functions cannot be invoked from a migration at
all.** The migration is honest about this in its header. What was actually proven:

| | Proven |
|---|---|
| **Structural** (comment-stripped source scan, re-run independently against the live DB after apply) | Both functions write `late_entry` beside `is_late` on INSERT and UPDATE; both set `is_locked = true`; both carry the ambiguity guard; both still gate on `assert_hr_for_tenant`; exactly one overload each; ACL unchanged at `project_admin=X, authenticated=X` with no `anon` |
| **Behavioural** | A row shaped as the HR paths now write it (`is_locked`, `derivation_source = manual`) is **skipped** by the deployed `attendance_derive_pass1` — `rows_skipped = 1`, row survives unchanged. A two-row employee-day is **constructible**, so the ambiguity guard guards a real condition |
| **Population** | attendance 13 → 13, attendance_events 4 → 4, derivation_runs 0 → 0. Every probe rolled back cleanly |

**NOT proven, carried forward:** calling either RPC over HTTP with a real HR JWT and watching the
row change. This is the identical gap that leaves **C3** open, and it wants the same fixture: an HR
account in a QA tenant, signed in through the auth endpoint, calling the RPC with the returned JWT.
No HR credentials for a QA tenant were available to this session.

---

## 3. Traps learned or re-confirmed this session

**In SQL `LIKE`, `_` is a single-character wildcard.** A scan for functions referencing `is_locked`
using `LIKE '%is_locked%'` also matched the literal text **"is locked"** inside an unrelated error
message in `assert_date_range_unlocked`, which briefly looked like a third writer. Use a regex
(`~ 'is_locked'`) when the name contains an underscore, or the false positive goes into the
migration header as a fact.

**`attendance.punch_in` has `DEFAULT now()`, and probe INSERTs must name it explicitly as NULL.**
This is the phantom-event bug from 20260828100000, and it bites probes too: two probe rows for one
employee both defaulting to `now()` would emit two dual-write events at the same timestamp and
collide on the event natural key, aborting the migration. Every probe INSERT in `20260829100000`
names `punch_in` explicitly.

**The Bash tool truncates long commands.** Two attempts to write this migration with a shell
heredoc failed with `unexpected EOF while looking for matching quote` at different line numbers —
the command was being cut off mid-heredoc, not mis-quoted. Write files of this size with the file
tools, not with `cat <<EOF`.

**`assert_date_range_unlocked` reads `tenant_settings.payroll_lock_date` and `payroll_runs`, not
`attendance.is_locked`.** Two different things called "locked" on the same table's code path.

---

## 4. Do not re-litigate these

Everything in the 2026-08-28 handoff §4 still stands. Added this session:

| | Decision |
|---|---|
| **HR edits lock the day** | D5, §5.2, locked in the decision doc. Both HR paths set `is_locked`. This is what makes an HR correction survive the next derivation run |
| **The lock is reversible** | `hr_unlock_attendance_day` exists so D5 is not a one-way door. It does **not** re-derive — that stays `hr_run_attendance_derivation`'s job |
| **A correction on a multi-shift day RAISES, it does not guess** | `attendance_corrections` cannot name a shift. Surfacing beats silently correcting an arbitrary row. Costs nothing today: zero multi-shift rows exist |
| **`hr_update_attendance` falls back to `is_late`, not `late_entry`, when no punch time is supplied** | On a legacy row `late_entry` was never populated and `is_late` is the only real information, so the fallback repairs `late_entry` from `is_late`. On a derived row they are already equal |

---

## 5. What is LEFT

### 5a. Still gated on the Vercel block
- **B7b** — frontend switchover. Unchanged from the 2026-08-28 handoff §6a. `punch_in_attendance`
  deliberately does not set `is_late` or half-day status, so B7b is **not** a pure call-site swap,
  and `tenant_business_date` returns NULL when forbidden or the module is off — handle it
  explicitly and **never** fall back to a device clock.
- **B7c** — retire the direct-insert path. Highest-risk step in the programme. Only after B7b is
  marker-confirmed live.

### 5b. Unblocked, and next in line
- **B7d — the HR punch trail** (additive, independent of a–c). Design guidance in
  `doc/attendance_b7_cutover_plan.md` §4. Buildable now, but it is a UI that cannot be seen rendered
  while the deploy is blocked, over a log with 4 rows where empty states are the common case.
- **A live two-session QA pass** closing both C3 (cross-employee rejection) and the HR-JWT half of
  this session's verification. Needs an HR account in a QA tenant. This is the highest-value
  *unblocked* item because it retires two open verification gaps at once with one fixture.
- **`punch_out_attendance` still writes an `overtime_amount`** — payroll policy living in
  attendance. Attendance should emit overtime *hours*. Queued after B7c.
- **B1 (scheduler)** still unproven; `schedules list` is `[]`.

### 5c. Newly recorded, not fixed
- **`assert_date_range_unlocked` is not module-gated.** Both HR functions call it unconditionally,
  unlike `punch_in_attendance`, which gates the same payroll-lock check behind
  `tenant_has_module_for(tenant,'payroll')`. Pre-existing; low impact because an attendance-only
  tenant will not have a `payroll_lock_date` set, but it is the same module-independence seam.
- **`src/hr/Attendance.tsx` shows only the FIRST row of a multi-shift day.** Its daily view does a
  `find()` per employee, so once per-shift rows exist HR silently sees one of them. Frontend gap for
  B7d/B9.

### 5d. Unchanged open items
The Phase 3 unknown; 34 of 274 RLS policies in no migration; `diagnose advisor` returning "Access
denied"; C6 as a class (client-side dates in `Attendance.tsx`, `MyLeaves`, `MyTeam`, `Calendar`,
`RunPayroll` — read-only, mis-render at worst); B8 blocked on the hardware question; B9 depends on B7.

### 5e. Repo hygiene
GitHub's **default branch is still `updateSuggestion`**, the retired one. Production deploys from
`main`, so it is not harmful today, but a PR opened without changing the base targets the wrong
branch. One click in GitHub settings.

---

## 6. Commands

```bash
npm run build                        # tsc -b && vite build
npm run check:policy-drift           # expect: 34 of 274
npx @insforge/cli db migrations up --all
npx @insforge/cli db query "<sql>" --json     # single-line only; NOTICE is not surfaced

# VERIFY THE DEPLOY BY MARKER STRING -- never by filename or timestamp
curl -s https://hrms.talentmeshsolutions.com/ | grep -oE "/assets/index-[A-Za-z0-9_-]+\.js"
curl -s https://hrms.talentmeshsolutions.com/assets/index-XXXX.js | grep -c working_hours_threshold_for_absent
#   0 = PRE-Phase-0 (what is live now)   >0 = the new build is live

# Search server-side code, NOT comments. Use a REGEX, not LIKE, for names with underscores.
npx @insforge/cli db query "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and pg_get_functiondef(p.oid) ~ 'NAME' order by 1" --json

# QA fixtures -- exercise before shipping anything module-gated
#   QA Attendance Only / QA Attendance Payroll / QA Full Suite
# Verify RLS as a real user (superadmin and HR sessions give FALSE NEGATIVES)
#   employee-qa@talentmeshsolutions.com / Password@123     tenant da7a0000
#   quickwin089@gmail.com / RlsVerify!2026q                tenant 97da3641
# NOTE: neither of these is an HR account. The HR-JWT verification in section 2 needs one.
```

---

## 7. How this session was run

Single-threaded, no subagents. Orientation against the live database first (applied head, row
counts, deployed function bodies, ACLs, constraints, trigger definitions, frontend call sites),
then one migration, then independent re-verification of the deployed result rather than trusting
the apply. The `LIKE` wildcard false positive and the `punch_in DEFAULT now()` probe trap were both
caught in that re-verification, not in the writing.
