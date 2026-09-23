# Session handoff — P3 complete (2026-09-21)

Written by Opus 5 (lead). Supersedes `session_context_2026-09-15-senior-dev-m1m2.md` for status;
its §1 (how to act), §3 (environment hazards) and §6 (traps) still apply — read them too.

## 1. Status

**M1/M2 non-payroll security scope is complete** except P2-03 (kiosk, blocked on hardware).
Accepted this session, each re-verified by the lead on TB-M1M2 (reviews in
`doc/execution/non-payroll-monday/reviews/`):

| Package | Commit | What it closed |
|---|---|---|
| P3-02 | `c07a660` | employee self-approving own task; project membership enforced |
| P3-03 T1 | `6e3a27e` | anon + cross-tenant clients receiving/publishing every chat & notification topic |
| P3-03 T2 | `a959f36` | within-tenant chat/Connect; lead fixes 189300 (private attachments), 189400 (manager self-add) |
| P3-04 | `245f578` | payslip downloadable by anyone and by colleagues; `employee_documents` PERMISSIVE grant |
| P3-02b | `b1a674e` | project/channel scopes advertised from the same predicate the server enforces |

Contract amendments: `contracts.md` §16 — A1 (HR manages channels + reads all projects, not
private channels; user decision) and A2 (realtime freshness = id-only payloads + RLS refetch).

## 2. ⚠️ Production promotion (nothing here is on the parent yet)

All work is on TB-M1M2 only. When promoting to the parent `0431f0f6…`:
1. **`backups create` first.** No backup exists; the schema is not reconstructible from `migrations/`.
2. **Deploy the frontend before migration `20260912191000`** (P3-02b) — new summary + old
   AuthContext drops every user's capabilities.
   **Conflict with C3 (added 2026-09-23):** C3 needs migration `20260912194000` applied BEFORE its
   frontend (`b9b232a`+), the reverse of P3-02b. Prod frontend = Vercel from `main`, so one deploy
   cannot satisfy both. Sequence: (a) frontend at the last pre-C3 commit that includes P3-02b
   (`b77afc8`); (b) migrations up to `20260912193000`; (c) `20260912194000`; (d) frontend at C3 or later.
   **C7/C4 (2026-09-23):** apply `194500` (C7, no frontend dependency) and `195000`/`195100`/`195200`
   (C4) in step (c) too — C4's frontend (`529fb1f`, HR Recalculate) needs them before step (d).
   **C5 (2026-09-23):** `196000`/`196100` in step (c) as well (new apply parameter + leave-type toggle);
   the old frontend keeps working on them. Payroll is hidden in the frontend (`0eebac8`), data untouched.
   **C6 (2026-09-23):** `197000`/`197100` in step (c) too; no frontend dependency.
   **C9 (2026-09-23):** `198000` in step (c); no frontend dependency.
   **C8 (2026-09-23):** `199000` in step (c). **Before enabling the production derivation schedule,**
   confirm each attendance-enabled tenant actually punches — no-punch shifted employees are now marked absent.
3. **Bucket privacy is not in SQL.** PATCH `isPublic:false` for `chat-attachments`,
   `employee-documents`, `expense-receipts`, `task-attachments` (and confirm `hr-policies`).
4. Run every `tests/m1m2` suite against a branch of the promoted state before cutover.

## 3. Next work (small; Sonnet or Haiku, lead verifies)

- Half-day leave write path (`day_fraction`); re-derivation entrypoint for an already-derived
  attendance day; `employee_apply_leave_request` server-UTC `CURRENT_DATE`; dead `manager_id`
  fallback in `is_manager_of` (reconciliation.md §14, package-review-P1-03 §3).
- Residuals from this session: post author can change `type`/`is_pinned` (P3-03 T2 §3); owner can
  delete HR-issued files in own folder (P3-04 §2); stale Connect realtime subscribes in
  `EmployeeLayout.tsx`/`HRLayout.tsx`; operational: no tenant has `project_manager` /
  `communication_moderator` assigned.
- Then **payroll** (last module, research/decision lock first).

## 4. Rules learned this session (also in memory)

- **Re-run every `tests/m1m2` suite at each acceptance.** P1 revocation coverage was silently dark
  from P3-03 to P3-02b behind stale assertions. Never accept "pre-existing failure" unread.
- **Fixture suites miss existing rows** — count real data against any new authority table.
- **Widening a SELECT policy widens every check keyed on "can see the row"** (storage fences,
  INVOKER helpers, realtime topics).
- Storage objects can't be deleted by SQL — remove via SDK as the uploader.
- The TB storage CDN occasionally times out (`UND_ERR_CONNECT_TIMEOUT`) — re-run once.
- Model split that worked: Opus briefs/reviews/small lead fixes; Sonnet implements decided
  packages; GPT (Sol/Astra) for the security-subtle ones (P3-02 core, P3-03 T1).
