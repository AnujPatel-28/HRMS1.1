# Package review — C4 re-derive an already-derived attendance day

Lead: Opus 5.5, 2026-09-23, in-session. **Verdict: ACCEPTED** (suite results in §6).

## 1. Before (live, TB-M1M2) — `tests/m1m2/c4_rederive_day.mjs` pre-migration: 9/15

Disposable employee + shift in Company A. D1 has punches (9h → `present`), D2 has none (`absent`),
D3 is HR-corrected and locked. Leave approved over D1..D3, then cancelled:

| Defect | Measured |
|---|---|
| Cancel never re-derives | D1 stayed `on_leave` after cancel (punches intact, status wrong) |
| Cancel leaves a hole | D2's leave placeholder deleted, nothing refilled → **no row** |
| **Approve overwrites an HR correction** (D5) | locked D3 rewritten to `on_leave` by the approve upsert |
| No HR "recalculate day" | — |

Evidence already survived byte-identical (P2-04 holds): punches, in/out times, event rows.

## 2. Fix — three migrations (one package)

| Migration | Change |
|---|---|
| `20260912195000` | New `attendance_rederive_day` (internal, no client EXECUTE): skip locked day → un-stamp that employee-day's events (attendance_id → NULL only) → delete the day's row **only** if it has no punch/derived time and nothing references it (breaks/selfies/overtime cascade; audit logs) → run row → pass 1 + pass 2 for that one day. Returns the resulting status or `locked` / `no_shift` / `module_off` / `no_row`. New `hr_rederive_attendance_day` (HR via `assert_hr_for_tenant`, period-lock check, audit `attendance.rederived`). `cancel_leave_request` calls the core per leave day. Pass functions unchanged. |
| `20260912195100` (forward fix 1) | `approve_leave_request`: `ON CONFLICT … DO UPDATE … WHERE NOT attendance.is_locked`. |
| `20260912195200` (forward fix 2, lead-authorized) | `cancel_leave_request`: the loop moved **after** `UPDATE leaves SET status` — derivation reads `leaves.status`, so running it first re-applied the leave being cancelled (D1 stayed `on_leave`, D2 refilled as `on_leave`). |

All three function bodies were generated from live `pg_get_functiondef()` and diffed against the
pre-C4 bodies: only the intended lines differ (plus one blank line left in cancel's IF branch).

**Why two forward fixes (process note):** the approve fix was meant to ship inside `195000`, but the
generator script failed on a quoting error *after* the first version had been written, and that
first version was applied. Applied migrations are immutable, so it went to `195100`. The ordering bug
was then found by the suite. Neither changes the package scope.

`approve_leave_request` otherwise unchanged: it already writes `on_leave` over punch rows without
destroying evidence. A leave approved over a locked day still deducts balance for it; HR resolves via
unlock + recalculate (HR's correction wins until then).

Frontend: `src/hr/Attendance.tsx` — **Recalculate** button next to Trail on each daily row (desktop
and mobile); maps `locked`/`no_shift`/`module_off`/`no_row` to plain messages.

## 3. After — 15/15, stable

approve → D1 `on_leave`, evidence identical, locked D3 untouched · cancel → D1 `present`, one row,
punch/in/out identical, **every event row identical incl. `attendance_id`** (to_jsonb compare), D2
`absent`, D3 identical · HR recalculate D1 twice → `present`/`present`, idempotent · recalculate
locked D3 → `locked`, untouched · employee → `HR privileges required`; employee → internal core
`42501`; cross-tenant → denied. RLS 1/2/0 before/after. 4 consecutive runs 15/15.

**Test-harness note:** 3 of 5 early runs failed with `TypeError: fetch failed` on the first HR call
after several seconds of CLI checks — TB's gateway drops idle keep-alive sockets (known flake,
handoff §4). Fixed in the test with a throwaway warm-up read before such calls (the real call is
never retried, so no function error can be masked).

## 4. Not done / notes

- **Module independence — TESTED:** with Company A's attendance module switched off (restored after),
  approve + cancel a leave → cancel succeeds, leave `cancelled`, placeholder row removed (17/17).
- **Other ways a leave leaves `approved` — swept:** only `approve_leave_request`, `cancel_leave_request`
  and `employee_cancel_pending_leave` (pending-only, never touched attendance) write `leaves`
  (`position()` sweep, both known functions present as a positive control); no client code updates
  or deletes `leaves` directly.
- **FINDING → C8: absent-marking never happens.** Pass 2 marks `absent` only up to
  `shifts.last_sync_of_events - 1`, and **nothing writes that column** (only pass 2 reads it; no
  client/function writer). All 10 real shifts on TB have it NULL. So for every tenant a no-punch
  working day stays blank ("no record"), and after a leave cancel it stays blank; Recalculate returns
  `no_row`. The C4 test sets the watermark on its fixture shift to prove the path works.
- Re-deriving one day runs pass 1/2 for that shift+date, which also derives other employees'
  still-unstamped events / fills their derivable gaps on that date — same work the hourly job
  would do; pass functions cannot be scoped per employee without changing them (out of scope).
- `hr_run_attendance_derivation` over a range still only fills gaps; bulk recompute is B9 tooling.

## 5. Production

Migrations `195000` → `195100` → `195200` **before** the frontend at `529fb1f`+ (the Recalculate button
calls `hr_rederive_attendance_day`). Folded into the promotion sequence in
`doc/session_context_2026-09-21-p3-complete.md` §2.

## 6. Every suite

All 18 `tests/m1m2` suites after the three C4 migrations, exit code captured per suite:

```
c1_employee_self_edit rc=0
c2_business_date rc=0
c3_manager_convergence rc=0
c4_rederive_day rc=0
c7_tenant_write_policies rc=0
p1_capability_contract rc=0
p1_membership_invitation_revocation rc=0
p1_organization_transfer rc=0
p1_owner_lifecycle rc=0
p2_attendance_corrections rc=0
p2_leave_workflow rc=1  -> rc=0 after the AC5 update below
p2_work_calendar_resolver rc=0
p3_chat_connect rc=0
p3_policy_center rc=0
p3_private_buckets rc=0
p3_projects_tasks rc=0
p3_realtime_isolation rc=1
p3_scope_advertising rc=0
```

`p3_realtime_isolation` rc=1 = item 6 only (accepted platform limit).

**`p2_leave_workflow` (P2-04 AC5) encoded the gap C4 closes** and was updated, strengthened not relaxed: after cancel it asserted `derivation_source IS NULL` ("released for the deriver to reclaim") and logged "status stays on_leave -- restoring it is pass1/pass2's job". It now asserts `derivation_source='derived'` **and** `status` = the baseline punch-derived status; its "plain pass1 re-run is a no-op" check is asserted against the restored status. A fixed-id run row left by the first failing re-run blocked the next run (`CLI_CALL_FAILED`); removed, then rc=0 with no assertion errors.
