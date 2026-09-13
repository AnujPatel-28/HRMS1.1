# P6 PACKAGE REVIEW — P1-02

Reviewer: Opus 5, PACKAGE mode (independent of the implementer)
Date: 2026-09-14 IST
Under review: commit `5f40414`, base `e178c0e`
Target: `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`). No parent writes.

**VERDICT: ACCEPT.** AC4 is upgraded from the implementer's UNTESTED to **PASS** on evidence they did
not use. AC7 remains correctly incomplete-and-labelled. One unreported scope deviation, ratified.

---

## 1. What I verified myself, not from the report

| Check | Result |
|---|---|
| Both `181000` and `181500` recorded on the branch | ✅ |
| `write_access_audit` — `target_id` cast | ✅ `NULLIF(p_target_id,'')::uuid`, with a `PERFORM` pre-check for a clean failure |
| `write_access_audit` — `actor_id` semantics | ✅ resolves `v_actor_employee_id`; the 65 legacy rows keep their meaning |
| **Forged `access.*` insert as an authenticated user** | ✅ **denied** — `42501 new row violates row-level security policy` |
| Non-access UX event still insertable | ✅ `[]` — §14.4's carve-out preserved, browsers keep non-protected events |
| Direct `write_access_audit` RPC call by a client | ✅ **denied** — `42501 permission denied for function` |
| Membership PK vs. the frozen formula | ✅ all 8 rows match `md5(tenant‖':'‖user)::uuid` |
| **PK vs. the id P1-01 already issued** | ✅ `employee.a` = `2c4de0df-903f-f3ab-7e42-2feec67768f3` — **identical**, no id churn across the transition |
| RLS invariant (Company A) | ✅ **1 / 2 / 0** unchanged |
| AC14 — non-employee Company Admin summary | ✅ `employeeId: null`, `responsibilities: ["company_admin"]`, exactly the 9 §4 actions |
| AC13 — bootstrapped principal vs. legacy `is_hr()` | ✅ **false** — §2.11 satisfied |
| New-table policy shape | ✅ 5 of 6 carry a RESTRICTIVE tenant fence |
| Policy drift | ✅ 293 → 311 policies, untracked still **50** — every new policy is migration-tracked |
| `npm run build` / harness self-test | ✅ both pass |

`access_template_grants` is the sixth table and correctly has no restrictive fence: it is a pure
catalogue (`template_key, action, scope_type`), carries no `tenant_id`, is SELECT-only for
`authenticated`, and has no write policy — so writes are denied by default. Same shape as
`public.modules`.

---

## 2. AC4 — upgraded UNTESTED → PASS

The implementer marked this UNTESTED because the suite does not execute every action/absence
combination individually. That is an honest call, but a cheaper and stronger proof was available.

**I compared `access_template_grants` row-for-row against `contracts.md` §4.** All six templates, 67
rows, exact:

| Template | Contract §4 | Catalogue | Match |
|---|---|---|---|
| Company Admin | 9 company | 9 | ✅ |
| HR Admin | 19 company | 19 | ✅ |
| Manager | 6 direct_reports + 2 company | 8 | ✅ |
| Employee | 10 self + 4 company + 2 project + 2 channel | 18 | ✅ |
| Project Manager | 1 company + 5 project | 6 | ✅ |
| Communication Moderator | 3 company + 4 channel | 7 | ✅ |

No invented grant, no missing cell, no scope drift — including the two deliberate duplications
(`policy.read` at both `self` and `company`; `task.submit` at both `self` and `project`).

The resolver reads only from this catalogue, which I confirmed end to end: the non-employee Company
Admin received exactly its 9 actions and nothing else. Per-template correctness therefore follows
from catalogue exactness rather than needing a combinatorial suite.

**The §3 suppression also holds, and this is the subtle part.** The catalogue legitimately contains
`project:` and `channel:` grants — it is the full matrix. §3 forbids *advertising* them until P3-02
and P3-03 enforce them. The resolver filters them at emit time: Employee's catalogue is 18 rows, of
which 4 are project/channel, and the live summary returns **14** with scopes `self,company` only.
18 − 4 = 14. Catalogue complete, wire surface correctly narrowed.

---

## 3. AC7 — correctly incomplete, and labelled where it counts

Revoked-token denial is proven for database/RPC and edge functions. Private storage and realtime are
not proven, and the standing rule is prove-it-or-disable-it.

The labelling is **server-side state, not a claim in a report** — `list_tenant_access()` emits:

```
'surfaces', jsonb_build_object(
  'databaseRpc', 'enabled', 'edgeFunctions', 'enabled',
  'privateStorage', 'incomplete', 'realtime', 'incomplete')
```

and `UsersAccess.tsx` renders "Realtime access events — Disabled — instant disconnect unproven". That
is the correct shape: a consumer cannot mistake an unproven surface for a working one. AC7 stays
UNTESTED/incomplete and P3-03 owns closing it.

---

## 4. Findings

**F1 — Scope deviation, unreported (ratified).** `tests/m1m2/p1_owner_lifecycle.mjs` is not on the
allowed-file list. It is a test for AC9, which is in scope, and it is benign — but the brief said to
stop and report rather than add a file, and the report did not mention it. Ratified because the
content is in-scope and useful. Noted so the next package does not read silence as permission.

**F2 — `@ts-nocheck` is not a finding.** The implementer flagged it against itself. It is the
existing repo convention for Deno entrypoints — 10+ functions already carry it, because the repo's
tsconfig targets the Vite app and does not typecheck `Deno.` globals. Consistent, not a smell.

**F3 — `GENERATED ALWAYS` is better than what I specified.** My brief asked for the `md5` formula as
a column DEFAULT. Postgres cannot reference sibling columns in a DEFAULT, so the implementer used a
non-overridable `GENERATED ALWAYS` column instead. That is a stronger guarantee — a DEFAULT can be
overridden by an explicit insert, a generated column cannot. Adopted; P1-03 onward should assume it.

**F4 — Inherited lint, unchanged.** 13 pre-existing violations in touched files. Not introduced here.

---

## 5. Status

P1-02 is accepted. AC1–AC3, AC5, AC6, AC8–AC14 PASS; **AC4 PASS** on the catalogue proof above; AC7
incomplete and correctly labelled, owned by P3-03.

Next: P2-01 (`20260912182000`, shared work-calendar resolver). Note for it — the branch's
`attendance-derivation-hourly` schedule is **repointed and deactivated**; P2 must re-enable it
deliberately and re-verify the host, and must confirm whether `branch reset` restores T0 schedule
config before relying on any reset.
