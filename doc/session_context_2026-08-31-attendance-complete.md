# Session context — 2026-08-31. Attendance is complete. Docs written. Nothing pushed.

Supersedes `session_context_2026-08-29-hr-correction-reconciliation.md` (that file's §8–§14 are this
same session, appended as it ran; this document is the consolidated state).

---

## 0. State

```
Applied head    20260831100000
Repo            25 commits on main, NOT PUSHED, tree clean
Build           green
Policy drift    32 of 275        (was 34 — two policies became migration-tracked)
Deploy          LIVE. Vercel unblocked 2026-08-29 when the repo was made public.

Data     attendance 23 | derived 8 | events 10 | derivation_runs 80 | devices 0

Deployed edge functions (attendance): kiosk-punch, adms-cdata,
                                      run-attendance-derivation, check-punch-out-gate,
                                      calculate-late-marks
Schedule: attendance-derivation-hourly  ("20 * * * *")
```

**The scheduler is demonstrably alive.** 80 runs, every one `trigger='schedule'` and
`status='completed'`, zero failures, firing unattended from 2026-08-30 16:47 UTC to
2026-08-31 07:20 UTC. B1's exit criterion is satisfied many times over.

---

## 1. What shipped

| Migration | What |
|---|---|
| `20260829100000` | HR write paths honour D5 + D6; `hr_unlock_attendance_day` |
| `20260829110000` | `punch_in_attendance` persists the evidence columns |
| `20260829120000` | `punch_out_attendance` same, + evidence moved out of the client |
| `20260829130000` | punch-out payroll lock module-gated; `search_path` pinned; `mark_attendance_selfie_missing` |
| `20260829140000` | **B7c step 3** — employee write surface on `attendance` revoked |
| `20260829150000` | **CRITICAL** — `TRUNCATE`/`TRIGGER` revoked from `anon` + `authenticated` on every relation |
| `20260829160000` | **B8 phase 1** — device identity + `device_ingest_punch` seam |
| `20260829170000` | Brute-force lockout on the device seam |
| `20260829180000` | `allow_serial_only` for ADMS, opt-in per device |
| `20260829190000` | `hr_list_kiosk_credentials` (never ships the PIN hash) |
| `20260829200000` | **B1** — `attendance_run_scheduled_derivation` |
| `20260831100000` | **CRITICAL** — leave RLS fence was PERMISSIVE, i.e. a grant |

**Releases completed:** B7b, B7c, B7d, B8 (all three phases), B1. B9 **partially** — device
provisioning only.

---

## 2. The four security findings, in order of severity

Each was found while doing something else, which is the pattern worth noting.

**1. `anon` held `TRUNCATE` on 50 of 68 tables.** Found while verifying B7c. RLS does **not** apply
to `TRUNCATE` — it ignores every policy and tenant fence. `anon` is the key shipped in the public JS
bundle by design. Anyone reading the bundle could have destroyed every tenant's data with one
statement. Fixed, including `ALTER DEFAULT PRIVILEGES` so new tables do not reinherit it.

**2. Leave's tenant fence was PERMISSIVE, not RESTRICTIVE.** Found while writing the leave docs.
Permissive policies are OR-ed — they *grant*. Any employee could set their own leave balance, edit a
colleague's, or flip `is_paid` (payroll-relevant) on a leave type. Fixed.

**3. Employees could write any column on their own attendance row.** Blanket `GRANT UPDATE` plus a
column-blind RLS policy — and **RLS cannot restrict columns**. `work_hours`, `status`, `is_late` all
feed payroll. Fixed by revoking the write surface entirely; every write now goes through an RPC.

**4. `attendance.is_locked` was read by the processor and written by nobody.** D5's guard was inert,
so every HR correction would have been silently reverted by the next derivation run.

> **The recurring lesson:** "RLS is enabled" says nothing about `TRUNCATE`, `TRIGGER`, column-level
> access, or whether a policy is a fence or a grant. Check the grants and the `permissive` column
> separately, every time.

---

## 3. Traps learned this session

- **A `RAISE` rolls back the counter you just wrote.** Postgres has no autonomous transactions, so
  `device_ingest_punch` **returns** failures instead of raising — otherwise the brute-force counter
  is undone with the raise and the lockout counts to one forever. A migration assertion guards this.
- **`late_entry ?? is_late` never falls through.** `late_entry` is `NOT NULL DEFAULT false`, so `??`
  always takes the left branch. Needs `||`. The TS type said `boolean | null`, which is why it
  compiled. This shipped once and made a genuinely late day display as on-time.
- **Assertions must strip comments AND collapse whitespace.** A column-aligned `SET` clause does not
  match a single-spaced pattern; my own probe reported a regression that did not exist.
- **`_` is a wildcard in `LIKE`.** `'%is_locked%'` also matches the words "is locked" — that false
  positive put a wrong claim in a migration header.
- **pg_cron is installed but unusable.** `project_admin` has no `USAGE` on the `cron` schema. The
  extension being visible is exactly what makes it a time sink. I recommended it before checking;
  that was wrong.
- **`ON CONFLICT` names no table.** Grepping the table name will never find it. Changing a unique
  index broke HR leave approval in production this way.
- **One derivation pass proves nothing about the other.** Pass 1 runs over events, Pass 2 over
  assigned employees; they see different row shapes.

---

## 4. Documentation

Three module doc sets under `devloper_doc/`, all sharing the same shape:

| Set | Files | Notes |
|---|---|---|
| `attendanceModule/` | 10 | New. Includes `09-edge-functions.md`, the single source for the two auth patterns |
| `organizationModule/` | 8 | **Audited and corrected** — see below |
| `leaveModule/` | 7 | New |

### The org doc audit found four errors
The schema doc was perfect (all 10 tables, all 16 columns verified). These were not:

1. **"Deactivating a unit with employees is Blocked, enforced in the database."** False — there is no
   database guard anywhere. It is a `window.confirm()` that archives anyway if HR agrees, and any
   direct API call bypasses it. Doc 03 §2 now splits guardrails into database-enforced vs UI-only.
2. **"A trigger rejects reporting cycles."** It is an RPC; a direct table write is unchecked.
3. `src/types.ts` → actually `src/types/index.ts`.
4. Doc 06's HR check used a Supabase-shaped `session.user.user_metadata.role` and an import path
   that does not exist.

Also added `07-edge-functions-and-onboarding.md` — employee creation runs through four edge
functions, and none of the six original docs mentioned it.

---

## 5. Design questions answered (do not re-litigate)

**Is leave part of attendance? No — peers.** `leave` and `attendance` are separate first-class
modules; **payroll reads `leaves` directly**, not through attendance; leave owns accrual,
carry-forward and encashment, which attendance knows nothing about. Attendance asks leave exactly one
question — *"approved leave on this date, and what fraction?"* — and `day_fraction` is the only
policy value that crosses. Full reasoning in `devloper_doc/leaveModule/01` and `05`.

**Devices: don't design around hardware.** One seam (`device_ingest_punch`); kiosk and ADMS are
adapters into it. Hardware becomes a support matrix, not an architecture decision.

**ADMS serial-only auth is opt-in per device**, defaults off, biometric-only, and stamps
`auth_mode='serial_only'` on every event so weak provenance stays visible.

**Derivation reads `leaves` without a leave-module gate, deliberately.** Gating it would make past
leave days re-derive as *absent* for a tenant who later switched leave off. Turning off a module must
not rewrite history.

---

## 6. What is left

### Immediate
1. **Push.** 25 commits. Then marker-verify:
   ```bash
   B=$(curl -s https://hrms.talentmeshsolutions.com/ | grep -oE "/assets/index-[A-Za-z0-9_-]+\.js")
   curl -s "https://hrms.talentmeshsolutions.com$B" | grep -c punch_in_attendance   # want >= 1
   ```
2. **Rotate two passwords.** The repo is public and these are in git history:
   `admin@talentmeshsolutions.com` / `Password123!` and `quickwin089@gmail.com` / `RlsVerify!2026q`.
   Deleting files does not help once history is public.
3. **Test.** Nothing has been exercised by a real user. The kiosk has never had a real punch.

### Kiosk test path
`/hr/devices` → register a kiosk → **copy the secret, it is shown once** → set a PIN for a test
employee → open `/kiosk`, enter serial + secret → punch with employee code + PIN.
⚠️ **8 of 20 active employees have no `employee_code`** and cannot use a kiosk at all.

### Known gaps
- **B9 bulk tooling does not exist** — bulk mark, CSV import, range regularization, unmarked-days
  view, aggregate reporting. Attendance is operable; its HR bulk tooling is not.
- **No PIN policy beyond length.** A 4-digit kiosk PIN is permitted.
- **`employees.kiosk_pin_hash` is still readable by HR directly**, though the app never fetches it.
- **`leaves.status` has no trigger.** A direct UPDATE moves status without the balance.
- **No constraint on balance arithmetic.** A buggy RPC can desynchronise the ledger silently.
- **`fn_accrue_monthly_leaves` may not be scheduled** — worth checking, or balances never grow.
- **32 of 275 RLS policies are in no migration.**
- **`diagnose advisor` returns "Access denied"** — decision-doc §10 rule 7 cannot be satisfied.
- **GitHub's default branch is still `updateSuggestion`**, the retired one.

---

## 7. Commands

```bash
npm run build
npm run check:policy-drift                    # expect: 32 of 275
npx @insforge/cli db migrations up --all
npx @insforge/cli db query "<sql>" --json     # single-line only; NOTICE is not surfaced

npx @insforge/cli schedules list
npx @insforge/cli functions list              # ALWAYS before deploying — orphans exist
npx @insforge/cli functions code <slug>
npx @insforge/cli logs function.logs

# Is derivation healthy?
#   select trigger, status, count(*) from attendance_derivation_runs group by 1,2;

# Test batteries (self-rolling-back, safe against live)
doc/verification/b8_device_ingest_battery.sql
doc/verification/b8_lockout_battery.sql
doc/verification/phase3_ecase_battery.sql

# QA logins (both EMPLOYEE role — neither is HR)
#   employee-qa@talentmeshsolutions.com / Password@123     tenant da7a0000
#   quickwin089@gmail.com / RlsVerify!2026q                tenant 97da3641
```

---

## 8. How this session was run

Mostly single-threaded. Three Sonnet subagents were used for well-specified mechanical work; **all
three were killed by the monthly spend limit**, two leaving nothing behind, one finishing on a retry.
After every agent failure: check `git status`, the applied head, and `npm run build` before assuming
anything.

Every agent result was re-verified against the live database rather than accepted. That caught the
derived-column regression in B7b, the `??`/`||` bug, and a claim about Pass 2 that was wrong because
the scan behind it was not comment-stripped. The split earned its keep every time.
