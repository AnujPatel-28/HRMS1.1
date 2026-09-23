# Session handoff — cleanup C1–C9 complete, payroll hidden, device direction set (2026-09-23)

Written by Opus 5.5 (senior engineer / lead) at the end of a long session. **Read this first.** Then,
only as needed: `doc/session_context_2026-09-21-p3-complete.md` §2 (production promotion order — now
the full list), `doc/session_context_2026-09-22-cleanup-c1-c2.md` §4–5 (environment facts, rules),
`devloper_doc/attendanceModule/11-biometric-direction-review.md` (the device plan).

---

## 1. Your role and how to work

You are the **senior engineer / lead**. The pattern that worked all session:

1. **Measure before you fix.** Probe the live test backend as a real persona (plain employee, HR,
   cross-tenant) and prove the defect. Every package this session has a "before" run that fails for the
   intended reasons, then an "after" run.
2. **Write the test first**, run it against the unfixed backend, keep the log, then write the
   migration, apply to TB, re-run.
3. **Derive changed function bodies from live `pg_get_functiondef()`** with a small generator script
   that does anchored, once-only replacements and aborts on a missing anchor; diff the result against
   live and confirm only intended lines differ (see `scratch/c5-gen.mjs` for the pattern).
4. **Accept only after every suite runs** (`tests/m1m2/*.mjs`, 22 suites) with exit codes captured
   correctly (see §5 trap 1), then write `doc/execution/non-payroll-monday/reviews/package-review-<X>.md`,
   update `doc/execution/non-payroll-monday/tasks.md`, commit **only your own files**.
5. **User preference:** do the work **in-session**; do not delegate implementation to Sonnet agents
   (usage limits were hit before). A `web-fetch` agent for reading URLs is fine.
6. Report to the user in plain language: what was wrong (measured), what changed, test counts, what
   they must do. The user is the product owner, not a database engineer.

## 2. Product direction (user decisions — do not relitigate)

- **Target now: a complete HRMS WITHOUT payroll.** Every module independent (attendance-only,
  leave-only, etc. must work alone).
- **Payroll is last and rebuilt from scratch:** research → decision lock → build, designed to run
  standalone AND with our HRMS or a third-party HRMS/attendance. The existing payroll code/tables are
  **not** a foundation. Payroll is **hidden** in the frontend (`src/modules.ts` → `HIDDEN_MODULES`,
  commit `0eebac8`); data untouched. Payroll-table findings go to the payroll research, not fixes.
- **Absence marking (C8):** app/kiosk → next morning; biometric → only after the device has synced.
- **Half-day leave (C5):** built — first/second half, 0.5 days, HR enables per leave type.

## 3. State at handoff

Branch `p1-00-harness-reconciliation`, **63 commits ahead of `origin/main`, NOT pushed.**
All work is on the test backend **TB-M1M2** only. **Nothing is on the production parent.**

Accepted this session (each: before-run proof → fix → after-run → all suites):

| Pkg | Commit | Migration(s) | What was wrong → fixed |
|---|---|---|---|
| C3 | `b9b232a` | `194000` | managers read reports' bank/PAN; **any employee could make themself manager of HR** → one authority (primary reporting relationship), policies closed |
| C7 | `d3809b8` | `194500` | 9 tables writable by any employee (office geofence, shifts, payroll_runs "paid", self-approved WFH exception…) → RESTRICTIVE fence + HR write + needed reads |
| C4 | `529fb1f` | `195000`,`195100`,`195200` | cancelled leave left the day `on_leave`/blank; approving leave overwrote HR-locked days → cancel re-derives, approve respects locks, HR **Recalculate** button |
| payroll hide | `0eebac8` | — | payroll removed from all menus/routes/panels (presentation only) |
| C5 | `3fd2e0f` | `196000`,`196100` | half-day leave built end-to-end (+ no false late mark on half-day) |
| C6 | `91cf097` | `197000`,`197100` | employee could self-approve expenses, pin/announce posts, delete HR-issued docs, overwrite colleagues' photos |
| C9 | `480cbda` | `198000` | employees could upload into 9 storage buckets (incl. a selfie into a colleague's folder) → per-bucket write fences |
| C8 | `034957d` | `199000` | absence was never marked for any tenant → `attendance_absence_watermark()` |

Suites: **22 in `tests/m1m2/`, all green** except the accepted `p3_realtime_isolation` item 6
(InsForge platform limit — existing sockets keep receiving after revocation). Policy drift 39 (baseline).

Earlier accepted work (C1, C2, P1–P3) is summarised in the 09-22 and 09-21 handoffs.

## 4. What to do next (in this order)

### 4.1 Ask the user which track first (they were offered both)

**Track A — Production release** (everything non-payroll is done):
1. User runs `git push` and `backups create` (**hard gate — no backup exists; the schema is not
   reconstructible from `migrations/`**).
2. Follow the exact order in `doc/session_context_2026-09-21-p3-complete.md` §2 — frontend at
   `b77afc8` (P3-02b) → migrations through `193000` → `194000`…`199000` → frontend at current HEAD.
   Also: bucket privacy PATCHes listed there; rotate the admin key.
3. **Before enabling the production derivation schedule:** check each attendance-enabled tenant
   actually punches. With C8, every shifted employee without punches is marked `absent`.
4. Rehearse on a branch of production first (`branch create --mode full` of the parent), run all
   suites against it, then promote. Never write to the parent without the user's explicit go.

**Track B — Biometric device lane (no hardware needed to start)** — plan in doc 11 §6:
- **D1** `/iclock/*` gateway (Cloudflare Worker on `attendance.<domain>`; accept HTTP and HTTPS;
  preserve method/query/raw body; plain-text replies; size/rate limits; source-controlled).
- **D2** correctness: fail-closed timezone (unknown/unregistered device must never fall back to UTC),
  durable quarantine table for rejected ATTLOG rows + HR review, per-device direction mode (a device
  sending status `0` for every punch currently makes every punch `in`), canonical shift resolver in the
  source-policy check, `received_at` + clock-drift flag.
- **D4** HR device UX (setup steps + server URL, device health, audited serial-only toggle, User-ID
  mapping). **D6** device log-file import through the same seam (= the unbuilt B9 bulk tooling).
- In parallel the user buys **one ZKTeco SpeedFace V5L + one MB160** (return-able) for the **P2-03**
  physical pilot; **D3** (modern handshake + heartbeat) and **D5** (push employees to devices) come
  after the pilot. Do not use eSSL inBio/C3 (access panels).

Recommendation to give the user: Track A first if they want to go live soon; Track B first if the
first customer needs biometric devices on day one. Both are ready to start.

### 4.2 Later
- **Payroll**: research + decision lock doc first (standalone + pluggable), then build. Carry these
  findings into it: `declarations_self_all` lets an employee write any column of own tax declaration;
  `payroll_runs_tenant_select` shows every run row to employees; half-day LOP.
- React Native punch app (planned before payroll in earlier sessions — confirm with user).
- `doc/ui-ux-audit-2026-09-22/` and `devloper_doc/attendanceModule/10-…md` are **untracked, not
  created by the lead** — ask the user before committing or acting on them.

## 5. Environment facts and traps (all hit this session)

- **Test backend** TB-M1M2 `fb9a8659-9950-4637-a58e-4a882ef24419`. **Never write to the parent
  `0431f0f6-…`.** Run `npm run test:m1m2:target` before any write. CLI:
  `node node_modules/@insforge/cli/dist/index.js` (not npx). Apply one migration:
  `db migrations up <version>`.
- **Next migration version must be > `20260912199000`** (e.g. `20260912200000`); applied migrations
  are immutable — a mistake needs a forward fix (`…100`).
- Use `runSql` from `tests/m1m2/_harness.mjs` in small node scripts; write scripts with the file tool,
  not bash heredocs (quoting broke a generator once and a half-written migration got applied).
- **Trap 1 — exit codes:** `node $f > log; echo "$(basename $f) rc=$?"` prints rc=0 for everything
  (`$(...)` resets `$?`). Use `node $f > log 2>&1; rc=$?`. Then also grep every log for
  `AssertionError|HarnessBlocked|^FAIL`.
- **Trap 2 — regex through the CLI:** backslashes are eaten (`\m`, `\s` silently change meaning). Use
  `position()` / `LIKE`, and always add a positive control to a "found nothing" sweep.
- **Trap 3 — CRLF:** some live function bodies (e.g. `attendance_derive_pass1`) are stored with CRLF;
  generator anchors must match the body's line endings.
- **Trap 4 — timestamps:** the CLI JSON path drops microseconds; read `updated_at::text` when passing
  it to an optimistic-concurrency RPC (else `STALE_WRITE`).
- **Trap 5 — network:** TB drops idle keep-alive sockets; the first request after CLI work can fail
  with `fetch failed`. Suites call a throwaway `warm(client)` read before such calls and before the
  closing RLS invariant. Never blindly retry a non-idempotent call. `HarnessBlockedError` on a plain
  SELECT is the flaky CLI — re-run the suite once.
- **Storage rule:** a global PERMISSIVE `storage_objects_owner_insert` makes any bucket without a
  RESTRICTIVE write fence writable by everyone. **Every new bucket needs a branch in
  `c9_storage_write_allowed()`.** Probe: `scratch/c6-bucket-probe.mjs`.
- **RLS rule:** a tenant check written PERMISSIVE is a grant. Sweep for PERMISSIVE write policies
  without a role check; do not exclude quals mentioning `auth.uid` (the C3 hole had that shape).
- Storage objects cannot be deleted by SQL — remove through the SDK as the uploader.
- Company A has **payroll module OFF** on TB; tests that need it enable it and restore the prior value.
- `attendance-derivation-hourly` schedule on TB is **inactive** — don't enable it.
- Personas: `employee.a`, `hr-employee.a` (Company A `a000…0001`), `employee.b` (Company B);
  password in `tests/m1m2/persona-password.local`. RLS invariant is 1 / 2 / 0.

## 6. User actions outstanding

1. **`git push`** — 63 commits exist only on the laptop.
2. **`backups create`** — still no backup.
3. Decide Track A vs Track B (§4.1). If Track B: buy the two pilot devices.
4. Decide what to do with the untracked `doc/ui-ux-audit-2026-09-22/` and doc 10.
