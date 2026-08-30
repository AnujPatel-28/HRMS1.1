# Session context — 2026-08-29. HR write paths reconciled. Deploy unblocked. B7b built.

> **Read §8 first.** §0–§7 were written in the morning, while the Vercel deploy was still blocked.
> The block cleared later the same day and B7b was built; §8 is the current state and supersedes
> every "deploy is not live" statement below.

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

DEPLOY   SUPERSEDED -- see §8. As of the morning it was still blocked (bundle
         /assets/index-_OaU7Cj5.js, marker count 0). It was UNBLOCKED later the same
         day; live bundle is now index-CiQbhTAP.js with marker count 1, and B7b is
         built and committed. Applied head is now 20260829110000, not ...100000.
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

⚠️ **It is day-scoped, not row-scoped.** On a multi-shift day it unlocks *every* row for that
employee-day, including rows locked by a different HR action than the one being undone. Nothing
calls it yet so nothing is at risk today, but whoever wires a control to it should either surface
that blast radius or add a shift-scoped variant.

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
| **Behavioural, Pass 1 only** | A row shaped as the HR paths now write it (`is_locked`, `derivation_source = manual`) is **skipped** by the deployed `attendance_derive_pass1` — `rows_skipped = 1`, row survives unchanged. A two-row employee-day is **constructible**, so the ambiguity guard guards a real condition |
| **Source-level, Pass 2** | See the correction below. `attendance_derive_pass2` never updates an `attendance` row at all |
| **Population** | attendance 13 → 13, attendance_events 4 → 4, derivation_runs 0 → 0. Every probe rolled back cleanly |

### ⚠️ Correction to the migration header — `attendance_derive_pass2` and `is_locked`

`20260829100000`'s header states that Pass 1 and Pass 2 both reference `is_locked` "purely as a
skip-guard." **That is wrong about Pass 2, and it is wrong because of this repo's own most-repeated
trap: the scan that produced it was not comment-stripped.** `attendance_derive_pass2` mentions
`is_locked` only in a *comment*; the executable body never reads it. The migration is applied and
forward-only, so the file is left exactly as applied and the correction lives here.

**The conclusion the migration acted on is unchanged and still correct** — nothing wrote
`is_locked`, and the fix stands. But the reason an HR row is safe from Pass 2 is different from the
reason it is safe from Pass 1, and the next session needs the real one:

- **Pass 1** consults `is_locked` explicitly: `IF FOUND AND v_existing_locked THEN CONTINUE`.
- **Pass 2 has exactly two write statements** (verified on the comment-stripped deployed body): one
  `INSERT INTO public.attendance`, guarded by `IF EXISTS (… tenant_id, employee_id, date …) THEN
  CONTINUE`, and one `UPDATE public.attendance_derivation_runs`. **It never UPDATEs or DELETEs an
  `attendance` row.** So an HR-written row is protected from Pass 2 by the existence check, not by
  the lock — including the common HR shape Pass 1 can never see (absent/on_leave, no punch times,
  no events, so no event group exists to group).

Two consequences worth carrying: Pass 2's existence check **ignores `shift_id`**, so once any row
exists for an employee-day it creates no per-shift completeness rows for that day either; and if
Pass 2 ever gains an UPDATE path, it will need the `is_locked` arm that its comment already implies
it has.

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

**The comment trap bites audits, not just assertions — and it bit this session.** The repo already
knows "comments are part of `pg_get_functiondef`," but that rule was only ever applied to migration
*assertions*. The scan that surveyed which functions reference `is_locked` was **not**
comment-stripped, so `attendance_derive_pass2` was recorded as a skip-guard when it only mentions
the column in a comment. The wrong claim reached a committed migration header before review caught
it. **Strip comments in every scan whose output you will state as a fact, not only in assertions.**

**"Proven for one pass" is not "proven for the processor."** Pass 1 and Pass 2 have different
shapes — Pass 1 runs over event groups, Pass 2 over assigned employees — so the row shapes they can
even see are different. A probe against Pass 1 says nothing about the HR shape (no punch, no events)
that only Pass 2 encounters. Name the pass in every claim.

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

---

## 8. Second half of 2026-08-29 — deploy unblocked, B7b built

**The Vercel block cleared** when the GitHub repo was made public. Verified by marker string:
bundle `index-CiQbhTAP.js`, `working_hours_threshold_for_absent` count **1** (0 for eight days).
Frontend releases ship again, so restrictive server changes are safe once more.

⚠️ **Public repo = exposed credentials.** The three `ik_...` keys in tracked files are DEAD (live
admin key is `ik_99bf...3b76`, matches none of them). But two REAL passwords are now world-readable,
in tracked files *and in git history*: `admin@talentmeshsolutions.com` / `Password123!` and
`quickwin089@gmail.com` / `RlsVerify!2026q`. **Rotate them** — deleting files does not help once the
history is public. `.env` is correctly gitignored. `CLAUDE.md`'s claim that the leaked admin key is
"still valid and unrotated" is stale.

### Applied this half

| Migration | What |
|---|---|
| `20260829110000` | `punch_in_attendance` persists the four punch-in evidence columns |

`punch_in_attendance` did not write `punch_in_ip`, `location_confidence`, `remote_exception_id` or
`verification_snapshot`, all of which the client insert B7b removes used to write. Without
`remote_exception_id` an approved remote punch looks like an unjustified out-of-geofence punch;
without `verification_snapshot` punch-in has no evidence trail while punch-out still has one.

**DROP + CREATE, not CREATE OR REPLACE** — the four new parameters are trailing and defaulted, so a
replace would have added a second overload. Grants re-issued (DROP does not preserve an ACL).
Safe only because the function had **no callers**: zero database functions referenced it
(comment-stripped scan) and the deployed bundle predates B7b. **That window is now closed.**

### B7b is BUILT and committed, NOT pushed

`src/employee/PunchInOut.tsx` calls `punch_in_attendance`, drops `const TODAY` for
`tenant_business_date`, stops writing `is_late`, and renders an explicit "Attendance unavailable"
state when the server date is NULL — it never falls back to a device clock.

Two corrections were needed on top of the agent's work, both caught in review:

1. **Derived reads had to fall back.** Reading `in_time`/`out_time`/`late_entry` alone would have
   blanked every history row and shown the one genuinely late day as on-time — derivation has never
   run, so `in_time` is NULL on 0-of-13 rows and `late_entry` is true on **zero** rows while
   `is_late` is true on one. Now `in_time ?? punch_in`, `out_time ?? punch_out`,
   `late_entry || is_late`.
2. **The lateness fallback first used `??`, which was dead code.** `late_entry` is
   `boolean NOT NULL DEFAULT false`, so it is never NULL and `??` never took the right branch — the
   fallback did not fire at all. Fixed to `||`. The TS type said `boolean | null`, which is why the
   compiler accepted it; the type now matches the column. `in_time`/`out_time` genuinely are
   nullable, so `??` is correct there.

### ⚠️ The biggest finding of the day — B7c is bigger than it looked

Employees can write **any column on their own attendance row**. Blanket `GRANT UPDATE` to
`authenticated` plus a column-blind `attendance_update_self` policy, and **Postgres RLS cannot
restrict columns**. `work_hours`, `status` and `is_late` all feed `payroll_period_input`, and
`is_locked` — which `20260829100000` just made load-bearing — can be set by the employee too.
Full brief and the mandatory ordering are in `doc/attendance_b7_cutover_plan.md` §2 under B7c.
**Do not revoke before moving punch-out's evidence write into the RPC**, or punch-out breaks for
every employee.

### B1 was killed by the monthly spend limit

It applied **nothing** — head was `20260829100000` and the tree was clean when it died; its only
artifact is an untracked `functions/run-attendance-derivation.ts` draft. **B1 is deferred, not
abandoned:** it is not on B7's critical path, because B6 runs fine on the manual HR trigger. The
design problem it was working on is real and still open — a scheduled run has no HR JWT, so it
cannot use `hr_run_attendance_derivation` and must go through the `project_admin` pass functions.

### Next, in order

1. **Push** — four commits: `df54dc2`, `8833840`, `63522d4`, plus this doc. Then **marker-verify**.
2. Watch a day of real punches.
3. **B7c** per the brief above — punch-out evidence into the RPC, ship, verify, *then* narrow the
   write surface.
4. B7d, B1, B9. B8 still blocked on which device/kiosk hardware tenants will use.

---

## 9. B7c step 1 — no client path writes `attendance` any more

Applied head is now **`20260829130000`**.

| Migration | What |
|---|---|
| `20260829120000` | `punch_out_attendance` persists the evidence columns; client `.update()` after punch-out deleted |
| `20260829130000` | punch-out payroll lock gated behind the payroll module; `search_path` pinned; `mark_attendance_selfie_missing` replaces the last client write |

**Module-independence bug found and fixed.** `punch_out_attendance` read
`tenant_settings.payroll_lock_date` **unconditionally**, while `punch_in_attendance` gates the same
check behind `tenant_has_module_for(tenant,'payroll')`. An attendance-only tenant carrying a stray
`payroll_lock_date` could punch IN and then never punch OUT. ⚠️ **A coarse "does the body mention
`tenant_has_module_for`" check says yes and is WRONG** — the deployed body already mentioned it, for
the *tasks* gate at a different line. The call has to be read in place.

**The last client write was not in either punch path.** `handleSelfieUpload` wrote
`location_status` directly, from a helper shared by both punch directions, so neither punch RPC
could ever cover it — and it fires only on a storage failure whose handler already just
`console.error`s, so it would have broken silently under step 3.
`mark_attendance_selfie_missing` replaces it: one column, one constant, on a row the caller must
own, with ownership/tenant/module asserted in code because `SECURITY DEFINER` bypasses RLS.

**`punch_out_attendance` had no fixed `search_path`** despite being `SECURITY DEFINER` and
executable by every authenticated user. Now pinned to `public` — every unqualified name in it
already resolved there, so this pins behaviour rather than changing it.

### A probe of mine failed correctly, and the lesson generalises
The first apply of `20260829130000` **failed on its own assertion**: `REGRESSION: an evidence column
write was lost`. Nothing was lost — the SET clause is *column-aligned*, so `location_confidence   =
p_confidence` did not match a whitespace-exact `location_confidence = p_confidence`. Assertions
against a function body must **collapse whitespace as well as strip comments**. Two ways to write a
false assertion about the same body, now both known.

### Dead code found, deliberately not deleted
`src/hooks/useAttendance.ts` still contains the old direct `insert` + `update` on `attendance`.
It has **zero importers** — dead. Left in place per the repo rule on unrelated dead code, but it is
a trap: it is the exact pattern B7c retires, and a future dev copying from it would reintroduce the
hole. Worth deleting as a deliberate one-line decision.

## 10. B7c step 3 is WRITTEN but NOT APPLIED — and not in `migrations/`

`doc/pending_migrations/B7c_step3_revoke_employee_attendance_writes.sql` revokes
`INSERT, UPDATE, DELETE` on `attendance` from `authenticated` and `anon` and drops
`attendance_insert_self` / `attendance_update_self`.

**It is deliberately NOT in `migrations/`.** Sitting there, the next `db migrations up --all` — run
by anyone, for any unrelated reason — would apply it silently and take punch down for every
employee, because the deployed bundle still predates B7b. The file carries its own ship checklist.

Safety was verified, not assumed:
- An exhaustive scan of every `.ts`/`.tsx` in `src/` for `.from("attendance")` followed by a write
  verb returns exactly **two** hits, both in the dead `useAttendance.ts`.
- A scan for `SECURITY INVOKER` functions writing `attendance` returns **zero** — every writer is
  `SECURITY DEFINER` and runs as the owner, so a table-grant revoke cannot break one.
- HR is also `authenticated` and loses nothing: every HR write is a definer RPC.

**Ship order: push → marker-verify (`grep -c punch_in_attendance` on the live bundle, must be ≥ 1)
→ punch once on the live site → then move the file into `migrations/` and apply.**

---

## 11. B7c step 3 APPLIED, and a critical finding it exposed

Applied head **`20260829150000`**. Policy drift now **34 of 272** (two self-write policies dropped;
untracked count unmoved).

| Migration | What |
|---|---|
| `20260829140000` | B7c step 3 — employee write surface on `attendance` revoked |
| `20260829150000` | **CRITICAL** — `TRUNCATE`/`TRIGGER` revoked from `authenticated` and `anon` on every public relation |

**Step 3 was applied BEFORE the frontend push**, at the user's explicit direction. The deployed
bundle predates B7b, so the live site's punch is broken until `main` ships. Accepted trade: the
tenants are test fixtures, and the team validates locally where the new RPC client runs. Recorded
in the migration header so it is not mistaken for the recommended order.

### RLS does not apply to TRUNCATE

Narrowing attendance's grants exposed what was left behind on the table:
`REFERENCES, SELECT, TRIGGER, TRUNCATE` — for **both** `authenticated` and `anon`, on **50 of 68
public tables**, including `tenants`, `employees`, `payslips`, `payroll_runs`, `salary_structures`.

Policies filter rows for SELECT/INSERT/UPDATE/DELETE. **`TRUNCATE` is governed solely by the
privilege** and ignores every policy, tenant fence and `USING` clause. `anon` is the role behind the
anon key, which ships in the public JS bundle *by design*, on the premise that RLS makes that safe.
That premise did not hold here: anyone reading the bundle could have destroyed every tenant's data
with one statement. Unauthenticated, irreversible, whole-database.

The grants came from the **platform's default privileges**, not from any migration in this repo —
which is why 50 tables shared one grant list. So the fix revokes on every relation *and* alters the
default privileges, or the next `create table` silently reinherits it.

Two lessons worth carrying:
- **"RLS is on" says nothing about `TRUNCATE` or `TRIGGER`.** Audit
  `information_schema.role_table_grants` for both, held by `anon`/`authenticated`. `TRIGGER` is an
  escalation primitive — it permits attaching a trigger to another tenant's writes.
- **Loop over `relkind IN ('r','p','v','m','f')`, not `'r'`.** The first run missed two views and
  its own assertion caught it. TRUNCATE is meaningless on a view; TRIGGER is not.

### Attendance write surface, final state
`authenticated` on `public.attendance`: `SELECT` only. Every write — employee, HR, and derivation —
goes through a `SECURITY DEFINER` RPC.

---

## 12. B8 — device ingest. Kiosk shipped, ADMS next.

Applied head **`20260829160000`**. `kiosk-punch` **deployed** to
`https://rq3qmu8y.function2.insforge.app`. Frontend committed, not pushed.

### The insight that made B8 small
**The canonical ingest already existed.** `attendance_event_ingest` already takes event_time,
direction, source, source_ref, evidence, lat/lng, selfie_id, correlation_id **and an
idempotency_key**; `attendance_events.source` already permitted `'kiosk'` and `'device'`; and
`shifts.allowed_punch_sources` already existed. So B8 was never "build an ingestion pipeline" — it
was "give a device an identity, resolve an employee from what that device can say, enforce the
source policy, hand off". Check what B3 already built before designing anything else here.

```
        kiosk tablet ─┐
                      ├─► device_ingest_punch() ─► attendance_event_ingest() ─► attendance_events
  ZKTeco/eSSL ADMS ───┘        (B8, new)              (B3, already existed)
```

### Design decisions worth not re-litigating
| | Decision |
|---|---|
| **`serial` is globally unique, not per-tenant** | An ADMS device posts its serial with no tenant context, so the serial is what resolves the tenant. Per-tenant uniqueness makes that ambiguous the first time two tenants own the same model |
| **Tenant is derived FROM the device, never a parameter** | A device cannot be talked into writing into another tenant |
| **Unknown serial and wrong secret raise the SAME error** | Otherwise serials are enumerable |
| **Kiosk time is server-decided; biometric time is the device's** | A tablet clock is exactly the untrusted device clock B7b removed. A biometric unit's timestamp must be honoured or a three-day-late offline sync collapses onto the reconnect moment instead of landing on its true day (E15) |
| **`device_ingest_punch` is `project_admin` only** | An adapter needs service credentials AND a valid device secret — two independent layers |
| **`employees.attendance_device_id` uses Frappe HR's exact field name** | A tenant migrating from Frappe imports their mapping with no translation step |

### Proven live
`doc/verification/b8_device_ingest_battery.sql` (re-runnable, rolls itself back): wrong secret,
unknown serial and wrong PIN are all rejected **and write nothing**; kiosk resolves by
`employee_code` + PIN; biometric resolves by `attendance_device_id` and **keeps its own
timestamp**; replaying an identical device log **collapses to one event** (E16). Population
verified restored afterwards.

Then against the **deployed** function: a bad-serial POST returned
`{"success":false,"error":"This kiosk is not recognized. Please contact HR."}` — which settles the
open question of whether the RPC's raised code survives InsForge's error normalization as a
matchable string. It does. Counts unchanged (events 8, devices 0).

### ⚠️ Follow-ups before this faces real employees
- **No PIN brute-force protection.** `kiosk-punch` requires no caller auth by design, and a kiosk
  PIN is 4–8 digits with no attempt limit or lockout. The device secret gates it — but that secret
  lives in the tablet's `localStorage`, so a stolen or borrowed tablet reduces impersonating a
  colleague to at most 10,000 tries. That is **buddy-punching, the exact thing an attendance system
  exists to prevent.** Needs an attempt counter per (device, employee_code) with backoff, and
  ideally rate limiting at the function.
- **`hr_set_employee_kiosk_pin` is HR-gated**, so PINs cannot be seeded from the CLI — same
  C3-shaped gap. Set one from the HR UI to test the kiosk end to end.
- The HR screens to register a device and set a PIN **do not exist yet** — the RPCs do. That is the
  next small piece of B9.

### Next: ADMS
Now a pure wire-format translator: parse ZKTeco/eSSL `key=value` bodies at `/iclock/cdata` and call
the same seam. No attendance logic in it at all.

---

## 13. B8 complete — lockout, ADMS, and the kiosk design pass

Applied head **`20260829180000`**. Deployed functions: `kiosk-punch`, `adms-cdata`.

| Migration | What |
|---|---|
| `20260829170000` | Brute-force lockout on the device seam |
| `20260829180000` | `allow_serial_only`, the honest answer to ADMS authentication |

### The lockout, and the constraint that shaped it
**A `RAISE` rolls back the transaction — including the failure counter written in the same call.**
The seam signalled every rejection with `RAISE EXCEPTION`, so a naive lockout would have counted to
one forever, and Postgres has no autonomous transactions to escape it. **Every rejection path now
RETURNS `{success:false,error:CODE}` instead of raising.** `kiosk-punch` needed no change — it
already branched on both `rpcError` and `data.success === false`.

Two independent keys — `(serial,'')` for device-secret failures, `(serial,employee_ref)` for PIN
failures — so one person mistyping cannot lock a shared kiosk for everyone. 5 failures in 15 minutes
locks that key for 15 minutes; a success clears both. An unknown serial is rejected **without** being
recorded, so nobody can inflate the table. The ledger has RLS on with **no policies**: unreachable
from any API role, and deliberately invisible to HR too, since it would otherwise leak which
employee codes are being probed.

`doc/verification/b8_lockout_battery.sql` proves it live, including the assertion that catches a
regression to raise-on-reject: **a rejection must leave its counter behind.**

### ADMS: the authentication problem, answered explicitly
A ZKTeco/eSSL push unit sends its serial and **no credential** — most firmware exposes only host and
port. Rather than silently trusting a serial for every biometric device, `allow_serial_only` is
per-device, defaults to **false**, is CHECK-constrained to biometric devices only (a kiosk has an
issued secret, so it has no excuse), and stamps `auth_mode='serial_only'` onto every event it
produces so the weaker provenance survives into any later dispute. A supplied secret is still always
verified — the flag relaxes the requirement to *present* one, never makes a wrong one acceptable.

**`functions/adms-cdata` is a wire-format translator and nothing else.** Protocol decisions:
- **Plain-text responses.** A JSON body makes the device treat the exchange as failed and resend the
  same logs forever.
- **A partially-rejected batch still returns `OK`** — same reason, and the seam is idempotent.
- **Status byte 1 is trusted; 0 is NOT.** Many cheap units emit 0 for *every* punch, so trusting it
  would make every event an "in" and nobody would ever punch out. 0 falls through to the seam's
  open-session inference, which is right for both well-behaved and lazy hardware.
- Device timestamps are local wall clock with no offset, resolved against the tenant timezone in
  **two passes** so the hour either side of a DST transition is not off by one.

Proven against the deployed function with a simulated device: handshake returns the config block; an
unknown serial is acknowledged and ingests nothing; a two-row ATTLOG batch landed at exactly
`09:02:31` and `18:11:04` Asia/Kolkata; status 0 inferred `in` and status 1 gave `out`; both stamped
`auth_mode=serial_only`; and **replaying the identical batch created no duplicates** (10 events
before and after).

⚠️ Two 2099-dated probe events remain in the log — `attendance_events` is append-only (D11), and a
far-future date on the probe tenant cannot affect any real derivation.

### The kiosk design pass
Both design references converge on **restraint**: impeccable puts a kiosk in **Operate** mode
(scanability, native expectations, precise details), and the Delight-Impact Curve makes punching the
**highest-frequency action in the product**, so it earns micro-interactions and nothing theatrical.

The real work was **polish, not motion** — the "dirty bathroom" rule, and the states were the weak
part:
- A **lockout rendered identically to a wrong PIN**, though they demand opposite reactions (wait vs
  retype). Now four distinct kinds with their own icon, palette and hint.
- A **dropped connection was indistinguishable from a server error.** A kiosk loses wifi routinely,
  and "your punch was NOT recorded" is the one thing that person needs to know.
- **Identity now leads the success card** — the thing to verify at a glance is that *your* punch
  registered, not the previous person's. `line-clamp-2` + `break-words` for long names (Harden gate).
- **The auto-reset was invisible**, so a queue would prod at the tablet. A bar drains over exactly
  the reset delay — the only motion added, and it carries information.

### What is left in attendance
- **B7d** — the HR punch trail over `attendance_events`. Nothing in the product reads the log yet.
- **B9** — HR tooling, including the screens to register a device and set a kiosk PIN. Those RPCs
  exist and have no UI, so a kiosk cannot be provisioned from the app yet.
- **B1** — scheduler. **`pg_cron` is installed**, which is very likely simpler than the edge-function
  auth story that killed the earlier attempt: `attendance_derive_pass1/pass2` already run as
  `project_admin` with no JWT problem.

---

## 14. B1 and B7d — and an honest read on what "attendance is finished" means

Applied head **`20260829200000`**. Policy drift **34 of 273**.

### B1 — derivation has now RUN IN PRODUCTION
First real run: **5 tenants, 0 errors, 5 completed run rows, 8 derived attendance rows.**
`schedules list` is no longer empty, which was C4's symptom. C8 was already satisfied.

**Correction to something I told you earlier: pg_cron is NOT usable.** It is installed, which is
exactly what makes it a trap — `project_admin` has no USAGE on the `cron` schema and a direct probe
returns `permission denied for schema cron`. Scheduling goes through InsForge `schedules`.

**The wall B1 actually sat behind** was never the scheduler; it was auth.
`hr_run_attendance_derivation` opens with `assert_hr_for_tenant`, which raises when `auth.uid()` is
NULL, so a scheduled call could never reach it. `attendance_run_scheduled_derivation` is the same
orchestration without the HR fence, `project_admin`-only, granted to no API role.

Orchestration lives in **SQL, not the edge function**. The earlier abandoned draft looped tenants
and shifts in TypeScript — a round trip per shift, with run bookkeeping split across independently
failing calls. That draft is replaced by a ~20-line trigger.

The function needed its own caller gate: unlike `kiosk-punch` (open by design, because device
credentials *are* the authentication), this takes no user input and writes across **every** tenant.
It requires `DERIVATION_TRIGGER_TOKEN` by header, compared in constant time, and **fails closed** if
the secret is unset. Verified 403 with no token and with a wrong one.

**Every unprocessed event was verified as correct, not missed:** three predate the lookback window,
one is the deliberately quarantined B7a artefact (`skip_derivation` + `void_reason`), two are the
2099 ADMS probes.

### B7d — the punch trail
A tray over the attendance table; the day travels into the header. Events stagger in — earned
*because* HR opens this rarely, where the same motion on the punch screen would irritate.

**Empty is the common case at launch**, so it explains *why*, and distinguishes the two reasons,
which mean opposite things: no `derivation_source` → the day predates the event log; derived with no
events → genuinely no punches. Reading the first as "did not come in" is the wrong conclusion.
Serial-only provenance and excluded events surface explicitly rather than going quietly missing.

No migration needed — `attendance_events_select_hr` already grants HR read.

### Where attendance actually stands
**Done:** B1–B8, and B7a/b/c/d. Derivation runs on a schedule; punches arrive from the app, a kiosk,
or a ZKTeco/eSSL unit through one seam; HR can correct a day and see the evidence behind it.

**NOT done — B9 is only partly built.** The decision doc §8 scopes B9 as *"Bulk mark, CSV import,
range regularization, unmarked-days view, aggregate reporting (v1 F7)"*. What exists is the device
provisioning screen, which was really B8 support. **None of the five listed B9 capabilities are
built.** Attendance is functionally complete and operable; its HR bulk-tooling is not.

**Also still open:** 34 of 273 RLS policies are in no migration (unchanged for six sessions);
`diagnose advisor` still returns "Access denied"; the C6 class of client-side dates remains in
read-only screens; and nothing has been exercised by a real user yet — the kiosk in particular has
never had a real punch through it.
