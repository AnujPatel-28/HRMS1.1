# Session context — 2026-08-28. Derivation is BUILT. B7a shipped. B7b–d remain.

Continues `session_context_2026-08-21-modules-and-attendance.md`. That handoff closed attendance
B2/B3/B4. This one covers **Phases 0–3 (which complete B4 and deliver B5 and B6)** plus **B7a**.

**Backend:** parent `rq3qmu8y` (`0431f0f6-225f-4fb1-86b7-3fd32684c7f4`). Applied head **`20260828120001`**.
**Frontend:** `hrms.talentmeshsolutions.com`, Vercel from GitHub `main`. Repo head **`1d2ad2e`**, **pushed**.
**Build:** green. **Policy drift:** 34 of 274 — the untracked count never moved.

---

## 0. State

```
Applied head    20260828120001      (9 migrations this session)
Repo head       1d2ad2e             pushed to origin/main at last check
Build           green
Policy drift    34 of 274           untracked count UNCHANGED; every new policy is in a migration
Data            attendance 13 | attendance_events 4 | derivation_runs 0 | shifts 6 | tenants 15

⚠️ DEPLOY   NOT LIVE. `main` was pushed (24ea41a..1d2ad2e) and re-checked several minutes
            later: the live bundle was STILL /assets/index-_OaU7Cj5.js, byte-identical, with
            zero Phase-0 markers. So the deploy had not completed -- and had not obviously
            started. VERIFY BY MARKER STRING BEFORE DOING ANYTHING IN B7b.
```

**CAUSE IDENTIFIED from the Vercel dashboard (`vercel.com/talentmeshs-projects/hrms-1-1`).**
Both pushed commits reached Vercel and created Production deployments on `main`:

```
4901ef4  docs: session handoff -- attendance derivation built, B7a shipped   Production  BLOCKED
1d2ad2e  fix(attendance): sync is_late from derived late_entry               Production  BLOCKED
24ea41a  docs: session handoff -- module composition and attendance B2/B3/B4 Production  READY  <- still live
```

**Status is `Blocked`, not `Error` and not `Building`.** So this is NOT a build failure, NOT a
misconfigured project, and NOT a wiring problem — **Vercel is correctly connected to this repo and
does deploy `main` to Production.** Every deployment through `24ea41a` (Aug 21) is `Ready`, and
`24ea41a` is still the live Production deployment, which is exactly the stale bundle the marker
check kept measuring.

`Blocked` is an **account/plan-level gate**, not a code problem. The project is on the **Hobby**
plan. **Open the blocked deployment in the dashboard and read the stated reason** — do not guess it;
the usual causes are plan deployment limits or a usage/spend cap, and the dashboard names the actual
one. **This is a human action; nothing in the repo will fix it.**

**Consequence: production is running code from Aug 21 while the database is at `20260828120001`.**
The DB is ahead of the frontend, which is the SAFE direction (every server change this session was
additive, and the legacy punch path was explicitly verified still working). But it is now a
persistent state rather than a transient one, so treat it as a standing condition, not a race.

**Do not start B7b until the block is cleared and a marker string proves the new bundle is live.**
B7b switches the punch path; shipping it onto an undeployed frontend is precisely the mistake the
marker rule exists to prevent.

**Unrelated repo-hygiene note spotted at the same time:** GitHub's **default branch is
`updateSuggestion`**, not `main`. Production deploys from `main`, so this is not currently harmful,
but the default branch is the retired one — a PR opened without changing the base will target the
wrong branch. Worth fixing when convenient.

### The plan documents are the map

| Path | What |
|---|---|
| `doc/attendance_completion_plan_2026-08-24.md` | Phases 0–3 (= B4 completion, B5, B6). **Has a STATUS section at the bottom.** |
| `doc/attendance_b7_cutover_plan.md` | **B7, split into B7a/b/c/d. Read this before touching B7.** |
| `doc/verification/phase3_ecase_battery.sql` | The E-case battery, re-runnable |
| `new update doc/attendance_shift_v2_decision_doc.md` | Still the authority. D1–D12 locked. |

---

## 1. What shipped

| Migration | What |
|---|---|
| `20260824100000` | **Phase 0** — §5.3 shift policy columns, circular-shift CHECK (E5), `attendance.shift_id`, per-shift unique key, extended status CHECK, `hr_save_shift` + `ShiftManagement.tsx` policy UI |
| `20260824100001` | Circular-shift CHECK proven on both branches |
| `20260824100002` | **Repairs a production break Phase 0 caused** — see §3 |
| `20260824110000` | **B5** — holiday calendars + precedence resolver |
| `20260825100000` | **B6 Pass 1** — §5.2 columns, `attendance_derivation_runs`, §2.4 hours matrix, derivation grouped by `shift_start` |
| `20260828100000` | **B6 Pass 2** — completeness, watermarks, `hr_run_attendance_derivation`, half-day leave (`leaves.day_fraction`), dual-write flip |
| `20260828110000` | **B7a** — `punch_in_attendance`, `tenant_business_date` |
| `20260828110001` | Quarantines an orphan QA event; re-asserts the legacy path globally |
| `20260828120000` | **Latent payroll bug fix** — derivation now syncs `is_late` from `late_entry` |
| `20260828120001` | Corrects the lateness column comments |

**B6 is built and its assertions are proven.** Derivation works end to end: events group by
`shift_start`, night shifts land on the right day, thresholds halve on half-day holidays, leave
overrides, completeness marks absent/weekly_off/holiday, and the whole thing is idempotent.

---

## 2. Two corrections to the PREVIOUS handoff — do not re-inherit them

1. **The B-numbers were wrong.** The 2026-08-21 handoff §6b said "B5 — the derivation processor."
   The decision doc §8 says **B5 = holiday calendars, B6 = derivation processor**, and the doc is
   the authority. This session used the doc's numbering.
2. **B4 was marked DONE but was half shipped.** The resolution engine and C7's exclusion
   constraint had landed; **none of §5.3's policy columns existed.** The §6 algorithm reads four
   of them. B6 was unbuildable until Phase 0 added them. If a handoff says a release is done,
   check its deliverables against the doc, not against the handoff.

---

## 3. Traps learned this session — these cost real time or real outages

**Dropping a unique index silently breaks every `ON CONFLICT` that inferred it.** Phase 0 replaced
`attendance_employee_id_date_key`, orphaning `approve_leave_request`'s
`ON CONFLICT (employee_id, date)` → `42P10`. **HR leave approval was broken in production.**
An inference clause *names no table*, so grepping the table name cannot find it — search the
clause. And it sat in a `FOREACH` body, so nothing surfaced until a real approval.
Fixed in `20260824100002`. See memory `hrms-unique-index-drop-playbook`.

**A probe that inspects only the rows it created cannot see a row it did not expect.**
`attendance.punch_in` has `DEFAULT now()`. Pass 1's INSERT did not name it, so every derived row
got `punch_in = now()`, which the dual-write trigger could not tell from a real punch — **Pass 1
was writing phantom `in` events into the immutable log.** Its own probe filtered
`WHERE id IN (v_ev1, v_ev2)` and passed; a human review pass counted attendance rows, not events,
and missed it too. **Assert the population against a baseline, not the sample.** Fixed in
`20260828100000`.

**Comments are part of `pg_get_functiondef`.** An assertion searching for a dangerous pattern
matched the explanatory comment written three lines above it, and rolled back its own migration.
Strip comments before matching code: `regexp_replace(def, '--[^\n]*', '', 'g')`. The same trap
made an agent's report claim `punch_in_attendance` writes `is_late` when only its header does.

**The InsForge CLI scans raw SQL text — including comments — for forbidden keywords.** A comment
containing the literal `set_config('request.jwt.claims'...)` got an entire migration rejected with
"Changing SQL session configuration is not allowed." Not a SQL error at all.

**The CLI also rejects some multi-line input** ("Query could not be parsed and was rejected for
security reasons"). Collapse a probe to a single line and it passes.

**`CREATE OR REPLACE` with new trailing defaulted parameters creates a SECOND overload**, it does
not replace. Use `DROP` + `CREATE` and **re-issue the grants** — they are not preserved. (Same
signature *is* preserved, so a same-signature `CREATE OR REPLACE` keeps its ACL.)

**Subagents were killed twice by the monthly spend limit**, once mid-verification with a migration
already applied. **After any agent failure, check `git status`, the applied head, and
`npm run build` before assuming anything.** Both times the work was sound; the reports were not
finished.

---

## 4. Do not re-litigate these

| | Decision |
|---|---|
| **`holidays` was NOT migrated into calendars** | §5.4 says migrate it; it has 10 frontend call sites across 6 files plus 4 server functions. `holidays` stays the tenant's default calendar; the new tables are an override layer. Precedence: shift → employee → `holidays` |
| **Half-day holidays do not change the working-day divisor** | Only `is_half_day` crosses the seam, for threshold halving (§2.2). Changing the divisor moves money |
| **`late_entry` is the authority; `is_late` is kept in sync** | The payroll contract keeps its exact shape. Retiring `is_late` is a **payroll-era** decision |
| **`leaves.day_fraction numeric` (default 1.0)**, not a boolean | Covers half days without foreclosing quarter days; payroll consumes a fraction directly |
| **Derivation RPCs are `project_admin`-only** | `attendance_derive_pass1`/`pass2` are definer with no `is_hr()` check. `hr_run_attendance_derivation` is the sole `authenticated` entry point |
| **The dual-write trigger now RAISES** | Earned, not assumed: zero failures were ever recorded in `attendance_audit_logs`, and both punch paths were proven working after the flip |
| **Attendance emits FACTS, never money** | Module independence. Payroll is the LAST module and is not yet designed |

---

## 5. Module independence — a standing product constraint

The HRMS is deliberately composable: a tenant may run **attendance without payroll** (using their
own payroll elsewhere) or payroll without attendance. **Payroll is the last module to be built and
its research/decision-locking has not happened.**

Everything built this session honours that:
- No derivation code reads, writes, or assumes anything from payroll.
- `punch_in_attendance` mirrors punch-out's payroll period-lock check but **gates it behind
  `tenant_has_module_for(tenant,'payroll')`** — proven with a lock set on both QA fixtures:
  attendance-only proceeds, full-suite is blocked.
- Every release proved **QA Attendance Only ≡ QA Full Suite**.

**Keep proving it.** Entitlement had never once run with a module OFF before 2026-08-21, and three
bugs were hiding in that blind spot, two of them monetary.

---

## 6. What is LEFT

### 6a. B7b — frontend switchover (NEXT, but gated)
**Blocked until the deploy is live and marker-verified.** `PunchInOut.tsx` calls
`punch_in_attendance`, drops `const TODAY` (line 19), stops writing `is_late` (line 766), reads
`late_entry`/`early_exit`/`in_time`/`out_time`.

⚠️ `punch_in_attendance` deliberately does **not** set `is_late` or half-day status, so **B7b is
not a pure call-site swap.** And `tenant_business_date` returns **NULL** when forbidden or the
module is off — B7b must handle that explicitly and **must never fall back to a device clock**.

### 6b. B7c — retire the direct-insert path
**Only after B7b is confirmed live by marker string.** This is the highest-risk step in the whole
programme.

### 6c. B7d — the HR punch trail (additive, independent of a–c)
Nothing in the product reads `attendance_events`; HR can see a derived day but not its evidence.
Design guidance is in `doc/attendance_b7_cutover_plan.md` §4, using
`UI Skill/family-values-design` — trays over the attendance table, the day row *travelling* into
the tray, staggered reveals (HR opens this rarely, so theatre is earned), micro-interactions only
on the daily punch screen. **Empty states are the common case at launch** — 4 events exist — so an
empty trail must explain *why* it is empty.

### 6d. Still open
- **The Phase 3 unknown.** An agent was killed while intending a correction migration. Both
  deployed functions match their stated behaviour on inspection, so nothing concrete was found —
  **but a passing battery does not retire it.** Carry it until something explains it.
- **C3 (ownership) is structurally verified only.** The CLI cannot set per-request JWT context, so
  the cross-employee *rejection* path was never exercised end to end. **Needs a live two-session
  QA pass** before C3 is called closed.
- **`hr_update_attendance` / `hr_approve_attendance_correction`** write `is_late` from their own
  cutoff logic and never touch `late_entry` — an HR correction leaves `late_entry` stale.
  Reconcile in B7b/B7c. Also recorded on the column comments.
- Both also look up attendance by `(employee_id, date)` assuming **one row**, which is ambiguous
  now that Pass 1 can write per-shift rows.
- **`punch_out_attendance` still writes an `overtime_amount`** — payroll policy living in
  attendance. Attendance should emit overtime *hours*. Queue after B7c.
- **B1 (scheduler)** still unproven; `schedules list` is `[]`. B6 runs fine on the manual HR
  trigger, which is why it was not blocking. Needs an edge function with a real auth story.
- **`diagnose advisor` returns "Access denied"** on this account, so decision-doc §10 rule 7
  cannot currently be satisfied. Treat as unverified, not clean.
- **34 of 274 RLS policies are in no migration.** Unchanged for five sessions.
- **C6 is a class of bug.** B7 fixes the punch path only. Client-side dates remain in
  `Attendance.tsx`, `MyLeaves`, `MyTeam`, `Calendar`, `RunPayroll` — read-only, mis-render at worst.

### 6e. Not started
**B8** (device/kiosk ingestion) — Q2, which hardware tenants will use, is still unanswered.
**B9** (HR tooling) — depends on B7.

---

## 7. Commands

```bash
npm run build                        # tsc -b && vite build
npm run check:policy-drift           # expect: 34 of 274
npx @insforge/cli db migrations list
npx @insforge/cli db query "<sql>" --json     # single-line only; NOTICE is not surfaced

# VERIFY THE DEPLOY BY MARKER STRING -- never by filename or timestamp
curl -s https://hrms.talentmeshsolutions.com/ | grep -oE "/assets/index-[A-Za-z0-9_-]+\.js"
curl -s https://hrms.talentmeshsolutions.com/assets/index-XXXX.js | grep -c working_hours_threshold_for_absent
#   0 = PRE-Phase-0 (what was live all session)   >0 = the new build is live

# Re-run the E-case battery (each DO block separately; pass = clean exit, fail = raises)
doc/verification/phase3_ecase_battery.sql

# Search server-side code, NOT comments
npx @insforge/cli db query "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and regexp_replace(pg_get_functiondef(p.oid),'--[^\n]*','','g') ~ '\mNAME\M' order by 1" --json

# QA fixtures -- exercise before shipping anything module-gated
#   QA Attendance Only / QA Attendance Payroll / QA Full Suite
# Verify RLS as a real user (superadmin and HR sessions give FALSE NEGATIVES)
#   employee-qa@talentmeshsolutions.com / Password@123     tenant da7a0000
#   quickwin089@gmail.com / RlsVerify!2026q                tenant 97da3641
```

---

## 8. How this session was run

Sonnet 5 subagents executed one release each, sequentially; Opus reviewed every result against the
live database rather than accepting the report. **That split earned its keep four times:** the
`approve_leave_request` production break, the phantom-event bug, an overstated "B6 is closed"
claim, and the latent `late_mark_count` payroll bug — all surfaced in review, not in the build.

Give each agent: the assigned migration version (never let it choose), the verified live facts, the
binding rules, and the traps in §3 verbatim. Agents do not infer that `SECURITY DEFINER` bypasses
every RLS policy and tenant fence, and that is the difference between a correct processor and a
cross-tenant read.
