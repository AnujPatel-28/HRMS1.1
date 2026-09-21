# P3-02b — Advertise `project:<id>` and `channel:<id>` scopes

Repo `C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`, branch
`p1-00-harness-reconciliation`, base **HEAD at dispatch** (after `245f578`).

Read first:
- `doc/execution/non-payroll-monday/contracts.md` v0.5 — **§3** (scopes: `project:<id>` /
  `channel:<id>` = "one explicit current membership and role", server membership check, never a
  caller-supplied id or cached array), **§4** matrix, **§6** (capability summary wire shape —
  non-negotiable), **§16 A1/A2**.
- `reviews/package-review-P3-02.md`, `package-review-P3-03-tier2.md` — both accepted packages
  enforced these scopes server-side and deliberately did **not** advertise them. You are that step.
- `doc/session_context_2026-09-15-senior-dev-m1m2.md` §6 traps, and memory of the deploy-skew
  incident (§3 below).

---

## 1. What exists today — measured by the lead, 2026-09-21

- **Enforcement is done.** `p3_project_scope(project_id, action)` (P3-02) and
  `p3_channel_scope(channel_id, action)` (P3-03) are the server membership checks every RPC and
  policy uses. They work; do not change their behaviour.
- **Advertising is blocked in two places that must change together:**
  1. `get_my_capability_summary()` (last defined in `migrations/20260912181000`, line ~614) filters
     `grant_row.scope_type NOT IN ('project','channel')` and emits `{action, scopeType}` only.
     `has_access_action(text,text,uuid)` (same file, ~350) has the same filter and requires
     `p_scope_id IS NULL`.
  2. `src/contexts/AuthContext.tsx:117` **rejects the entire summary** —
     `unsupported_capability_scope` — if any grant has scope `project` or `channel`. Every user
     would lose their capability summary.
- `tests/m1m2/p1_capability_contract.mjs:95` **asserts** no project/channel grants. That
  assertion is now wrong by design — update it (authorized).
- The frontend type already allows it: `src/types/access.ts` `Grant.scopeId?`, and
  `AuthContext.tsx:99-104` already validates `scopeId` is a string for project/channel.
  `hasGrant(action, scopeType)` has no `scopeId` parameter.
- `src/shared/Chat.tsx` gates channel management with `role === "hr"` (lines ~136, 485, 590, 610,
  628). Since §16 A1, channel management is the catalogue grant `channel.manage@company` —
  a Communication Moderator is not `role === "hr"` and gets no buttons; a tenant that removed
  the grant from HR still shows them.
- P3-02 recorded: Project Manager screens do not show project actions from the summary.

## 2. Decisions — do not redesign

**D1 — One predicate.** Summary emission and `has_access_action` must be driven by the **same**
server check, so the UI can never advertise what the server would deny, or hide what it allows.
Write one helper (e.g. `access_scope_allows(p_scope_type text, p_scope_id uuid, p_action text)`)
that delegates to `p3_project_scope` / `p3_channel_scope`. If an action the §4 matrix lists at
project scope is not covered by `p3_project_scope` (check `task.submit` — its branches cover
`project.read` and the manager actions only), handle it **in the new helper** (e.g. current
membership via `is_project_member` + the template holding that action at project scope). **Do not
change `p3_project_scope` or `p3_channel_scope`** — RLS policies depend on them.

**D2 — `has_access_action` gains the scoped branch.** For `p_scope_type IN ('project','channel')`
with a non-null `p_scope_id`, return `access_scope_allows(...)`. Every existing branch and call
site must behave exactly as before — it is called from dozens of policies and RPCs. Replace on the
**exact signature** `(text,text,uuid)`, body derived from `pg_get_functiondef()`, assert one
`pg_proc` row.

**D3 — Summary emits one grant per current membership.** For each project where the caller has a
current membership, and each action the caller's templates hold at `project` scope, emit
`{"action","scopeType":"project","scopeId":"<project_id>"}` **iff** `access_scope_allows` is true.
Same for channels, from **explicit** `chat_channel_members` rows only (contract: "explicit
membership") — global/department channel access is a type rule, not a grant; do not emit a grant
per global channel. Keep every other field, the ordering, and `contractVersion` exactly as §6.
Replace on the exact signature, derived from the live body.

**D4 — Frontend, tolerant first.** `AuthContext.tsx`: remove the rejection at ~117; keep the
`scopeId` validation. Add an optional `scopeId` to `hasGrant(action, scopeType?, scopeId?)` —
when given, match it exactly. The UI uses grants for **presentation only**; it never sends a grant
back as authority (contract §5 item 5).

**D5 — Wire the screens.**
- `ProjectList.tsx` / `ProjectDetail.tsx` / `EmployeeProjectView.tsx`: show manage / member /
  assign / review controls from `hasGrant(<action>, 'project', project.id)` or the company-scope
  grant (HR `project.read@company` = read-only; HR must **not** get manage controls).
- `Chat.tsx`: replace `role === "hr"` management gates with `hasGrant('channel.manage','company')`;
  message moderation from `hasGrant('message.moderate','channel', channel.id)`.

## 3. Deploy order — the reason this package exists as its own step

`doc/…/hrms-frontend-backend-deploy-skew` (memory): a backend change shipped without its frontend
broke punch-in in production for four days. Here the skew is total: **the new summary + the old
AuthContext = every user loses their capabilities.** So:
- The `AuthContext.tsx` change must be **backward-compatible** (works with the old summary too).
- Record in the report, and in `reconciliation.md` if you can't edit it then in the report only:
  **when promoting to production, deploy the frontend first, then apply the migration.**

## 4. Constraints

- `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`) only. **Never write to
  `0431f0f6-225f-4fb1-86b7-3fd32684c7f4`.** `npm run test:m1m2:target` before any write. CLI
  `node node_modules/@insforge/cli/dist/index.js`.
- Migration `migrations/20260912191000_m1m2-advertise-project-channel-scope.sql` (hyphens);
  `20260912191100_…` pre-authorized for **one** forward fix, named with evidence.
- **`CREATE OR REPLACE` with a changed parameter list creates an overload.** Keep exact signatures.
  Assert one `pg_proc` row per touched name in a DO block.
- Every DEFINER: tenant fence, pinned `search_path`, no `anon` EXECUTE.
- Allowed files: the migration(s); `src/contexts/AuthContext.tsx`; `src/types/access.ts`;
  `src/hr/pms/ProjectList.tsx`; `src/hr/pms/ProjectDetail.tsx`;
  `src/employee/pms/EmployeeProjectView.tsx`; `src/shared/Chat.tsx`;
  `tests/m1m2/p1_capability_contract.mjs` (update the line-95 assertion only, plus new positive
  assertions); new `tests/m1m2/p3_scope_advertising.mjs`. Anything else → stop and report.
- Disposable fixtures (a project with PM + member, a custom channel with a member and a
  moderator), `finally` teardown, RLS 1/2/0 before and after.

## 5. Acceptance — evidence, raw lines

1. **Agreement:** for each fixture persona, every emitted project/channel grant satisfies
   `has_access_action(action, scopeType, scopeId)` = true, **and** a sample of non-emitted
   combinations (other project, other channel, non-member, wrong action) = false. This is the
   package — the summary and the server must never disagree.
2. PM sees `project.manage` / `project.members.manage` / `task.assign` / `task.review` for **their
   project only**; a member sees `project.read` (+ `task.submit` if D1 covers it); HR sees
   `project.read@company` and **no** project-scoped manage grant.
3. Channel: explicit member gets channel grants for that channel; a global channel produces none;
   moderator gets `message.moderate` for channels they belong to; Company Admin alone gets none.
4. Revocation freshness: remove a project membership → the next summary call no longer emits it.
5. `has_access_action` unchanged for every non-scoped call: re-run **all** of
   `p1_capability_contract.mjs`, `p3_projects_tasks.mjs`, `p3_chat_connect.mjs`,
   `p3_realtime_isolation.mjs` (known item-6 FAIL only), `p3_private_buckets.mjs` — all green.
6. Frontend: build clean; AuthContext accepts both the old and new summary shapes (show it with a
   unit-style check or a recorded manual run); Chat management controls appear for a moderator
   without `role === "hr"`.
7. Hygiene: `pg_proc` counts, no `anon` EXECUTE, drift number (44 of 325 is the current baseline).

## 6. Report

Commit hash, files, per item PASS / FAIL / UNTESTED with raw lines; the deploy-order note;
anything you stopped on.
