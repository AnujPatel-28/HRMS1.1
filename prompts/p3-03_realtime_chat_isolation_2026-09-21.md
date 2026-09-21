# P3-03 — Realtime, chat and Connect isolation

Repo `C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`, branch
`p1-00-harness-reconciliation`, base **HEAD at dispatch** (after `c07a660`).

Read first:
- `doc/execution/non-payroll-monday/contracts.md` v0.5 — **§3 (scopes; `channel:<id>` is not
  advertised until this package proves enforcement), §4 (matrix: Communication Moderator; "Company
  Admin alone gains no private-channel access"; HR Admin "does not grant … communication
  moderation"), §5 item 5, line ~107 ("files and realtime subscriptions are authorized through their
  business action … a generic authenticated session is insufficient"), §164–165 (freshness)**
- `doc/execution/non-payroll-monday/tasks.md` v0.5 — P3-03 and the v0.5 preamble
- `doc/execution/non-payroll-monday/reviews/package-review-P3-02.md` §3 — **check existing rows,
  not only fixtures**
- `doc/session_context_2026-09-15-senior-dev-m1m2.md` §6 — traps
- The **live InsForge realtime docs** (`https://docs.insforge.dev`, realtime section, or the
  `insforge` / `insforge-cli` skills) on how the realtime server authorizes subscribe and publish.
  Do not design from memory; the platform's semantics are the thing under test.

---

## 1. What is broken today — measured by the lead on TB-M1M2, 2026-09-21, with live sockets

Probes: `scratch/p303-realtime-probe.mjs`, `scratch/p303-publish-probe.mjs` (committed with this brief — read them).
Payloads were published server-side with `realtime.publish`; **no data rows were written**.

**R1 — Anyone with the public anon key receives every tenant's chat and notifications.**
An **anonymous, never-logged-in** client and a **Company B** employee both subscribed successfully
(`{"ok":true}`) to `chat_messages`, `chat_channels`, `chat:general` and
`notifications:<Company A employee.a id>`, and **both received the marker payload on all four**.

Why: `realtime.channels`, `realtime.messages`, `realtime.config` all have **RLS disabled**, and
there are **zero** policies in the `realtime` schema. Nothing authorizes a subscription.

**R2 — What those topics carry is the full row, from every tenant.**
- `notify_chat_message` publishes `row_to_json(NEW)` — sender, content, attachment URL, tenant — to
  `'chat:' || NEW.channel` **and** to the global topic **`chat_messages`**.
- `notify_chat_channel` publishes the full channel row to the global topic **`chat_channels`**.
- `notify_employee_notification` publishes to `'notifications:' || NEW.employee_id`.
- `chat:<channel>` uses the channel **name** (text), so every tenant's `general` is the same topic.
- `src/hooks/useChat.ts` filters `payload.tenant_id === tenantId` **in the browser** — the client was
  already receiving other tenants' messages and discarding them. **Client filtering is not evidence.**

**R3 — Anyone can publish into any topic.** An anonymous client published
`INSERT_notification {"title":"p303 spoof probe"}` to `notifications:<employee.a id>` and it was
**delivered** to the subscriber. `NotificationBell.tsx` renders a realtime payload as a notification
when its `tenant_id`/`employee_id` match (both are not secrets). Whether the bell *displays* a spoof
today depends on its `meta.channel` comparison (delivered events carry `realtime:notifications:<id>`)
— **measure it, do not assume either way.** The server-side hole is proven regardless.

**R4 — Presence leaks identities.** Every subscribe response lists the other subscribers' user ids.

**R5 — Chat attachments are in a public bucket.** `chat-attachments` is `public`. (The same class was
proven by the lead for `employee-documents`: an anonymous `curl` with no auth header downloaded a
payslip PDF, HTTP 200, 231 KB. That bucket is **not** yours — see §4.)

**Connect (within-tenant):** `posts_update` lets any employee update any post in their tenant;
`post_reactions` is fenced only by a PERMISSIVE tenant policy (any employee can alter anyone's
reaction). `posts`/`post_reactions` topics are subscribed by the UI but **have no `realtime.channels`
pattern** — confirm whether they deliver anything at all before touching them.

Every table involved also grants `anon` INSERT/UPDATE/DELETE (fenced by RESTRICTIVE tenant policies,
so not exploitable through PostgREST — but remove it, as P3-02 did).

---

## 2. Direction — use the established shape, plus two realtime rules

1. **Payloads carry identifiers, not content.** Triggers publish `{op, id, channel_id}` (or
   `{op, id}` for notifications); the client **refetches under RLS**. This is defence in depth: a
   future subscribe-policy mistake then leaks an id, not a message body.
2. **Topics are tenant-qualified and keyed by id**, never by name:
   `chat:<tenant_id>:<channel_id>` and `notifications:<tenant_id>:<employee_id>` (exact shape is
   yours; it must make cross-tenant collision impossible). **Stop publishing to the global
   `chat_messages` and `chat_channels` topics** and disable/delete those `realtime.channels` rows.
3. **Subscribe is authorized server-side** by RLS on `realtime.channels` (SELECT) using
   `realtime.channel_name()` — the function exists on TB — resolving the topic to a tenant and record
   and applying the **same predicate as the table read** (chat channel membership/type rule;
   notification = the caller's own employee id). `anon` gets nothing.
4. **Client publish is denied** (RLS on `realtime.messages` INSERT) unless a feature genuinely needs
   it. Grep finds **no** client `realtime.publish` caller in `src/` — the app only subscribes — so deny.
5. Chat/Connect writes: reads policy-scoped, direct writes revoked at GRANT level where RLS cannot
   express the rule, mutations via definer RPCs with a column allowlist — the P2-02/P3-02 pattern.

**Measure before you trust a policy.** You must first prove the InsForge realtime server actually
evaluates RLS on `realtime.channels`/`realtime.messages` under the caller's role (e.g. enable RLS
with a deny-all policy on one test topic and show the subscribe is refused). A policy the server
does not evaluate is inert, and **a criterion that passes because the thing is inert is not a
pass.** If the platform does not evaluate it, **stop and report** — that changes the design.

---

## 3. Hold point — do this in two tiers, and stop between them

**Tier 1 — cross-tenant and anonymous isolation (the reason this package exists).** R1–R5:
subscribe authorization, publish denial, id-only payloads, tenant-qualified topics, presence
exposure (measure what the platform allows you to limit), `chat-attachments` private with
signed/authenticated access, and the frontend moved onto the new topics (`useChat.ts`,
`shared/Chat.tsx`, `NotificationBell.tsx`) with the browser tenant filter no longer load-bearing.

**Commit Tier 1, report, and stop.** The lead verifies Tier 1 independently with raw sockets before
Tier 2 is dispatched. Tier 1 is acceptable on its own.

**Tier 2 — within-tenant authorization (AC1, AC6, AC7).** Chat channel membership enforced
server-side, Company Admin/HR private-channel access per §4, Connect author/moderator actions,
reaction ownership, message/reaction retry idempotency (`chat_messages.client_message_id` exists —
check whether anything uses it). Tier 2 is briefed after Tier 1 acceptance; note what you learned.

---

## 4. Constraints

- `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`) only. **Never write to
  `0431f0f6-225f-4fb1-86b7-3fd32684c7f4`** — no realtime, bucket, function or schema change there.
  `npm run test:m1m2:target` before any write. CLI: `node node_modules/@insforge/cli/dist/index.js`.
- Migration `migrations/20260912189000_m1m2-communication-realtime-storage.sql` (hyphens). If Tier 1
  needs a forward fix after applying, `20260912189100_…` is pre-authorized for **one** fix, named
  with evidence. Beyond that, stop. Applied migrations are immutable.
- **Bucket privacy may not be settable from SQL** (P3-01 found this for `hr-policies`: the flag had
  to be set via CLI/API). Record exactly how you set it — a migration-only rebuild must not silently
  come back public; note it in the report for `reconciliation.md`.
- **Do not touch** `employee-documents`, `expense-receipts`, `task-attachments`: their screens are
  outside your files. They become **P3-04** (lead-owned brief, next). Do not touch the capability
  resolver or `AuthContext.tsx` (advertising `channel:<id>` is a later lead decision, like P3-02b).
- Trigger functions you change: **derive the body from `pg_get_functiondef()`**, change only the
  publish calls, keep the exact signature, assert one `pg_proc` row per name. Every definer: tenant
  fence, pinned `search_path`, no `anon` EXECUTE.
- A tenant fence must be RESTRICTIVE. PERMISSIVE is a grant.
- **Existing rows:** after your change, a real existing chat channel on TB (tenant `da7a0000`) must
  still deliver to its legitimate members. Test with existing data, not only fixtures.
- Fixtures: disposable, owned by `tests/m1m2/p3_realtime_isolation.mjs` (Tier 1) with a `finally`
  teardown. You may create temporary channels/messages/notifications in Company A and B, including
  **the same channel name in both tenants** (AC2's collision case). Do not edit shared fixture files.
  Importing `personas.mjs` runs its verification entrypoint — that is harmless but noisy.
- Allowed files: the `tasks.md` P3-03 list. Anything else → stop and report.
- RLS invariant 1 / 2 / 0 before setup and after teardown.

---

## 5. Tier 1 acceptance — evidence, not assertion

Raw socket evidence (actual subscribe responses and received-event logs), each **before and after**:

1. **Anonymous** client: subscribe to every chat/notification topic shape → refused; publishes →
   refused; receives nothing.
2. **Company B employee**, Company A topics (incl. same-name channel in both tenants) → refused /
   receives nothing, **before and after a reconnect**. (tasks.md AC2)
3. **`hr-employee.a` (another Company A employee)** subscribing to **`employee.a`'s** notification
   topic by knowing the id → refused. (AC3)
4. **Legitimate delivery still works**: a member receives their own channel event and their own
   notification — for a fixture channel **and** an existing `da7a0000` channel.
5. **Payload shape**: a received chat event contains no message content / attachment URL.
6. **Revocation (AC4)**: remove a member / suspend the membership while their socket is open, then
   publish → report exactly what the existing socket receives, and whether reconnect is refused.
   If the platform keeps delivering to an already-authorized socket, **report it as a measured
   platform limit** — do not paper over it in the client. The lead decides.
7. `chat-attachments`: anonymous and wrong-tenant GET denied; a legitimate member can still open an
   attachment in the UI path; record what happens to a **previously issued** URL. (AC5, chat only)
8. Global topics `chat_messages` / `chat_channels`: no longer published, rows disabled/removed.
9. Hygiene: one `pg_proc` row per touched name; no `anon` EXECUTE; no anon/authenticated
   INSERT/UPDATE/DELETE where you revoked; RLS 1/2/0 both times; `check:policy-drift` number (49/312
   is the deferred baseline); `npm run build` clean.

**AC8 (birthday automation):** confirm with `schedules list` that `auto-birthday-posts` has no
schedule; record AC8 as **PARTIAL — automation disabled**. Do not enable it.

## 6. Report back

Commit hash, files, per item above PASS / FAIL / UNTESTED / N/A with the raw log line. Something you
reasoned about but did not execute is UNTESTED. State plainly anything the platform would not let you
enforce. Stop at the Tier 1 hold point.

---

## 7. Tier 1 accepted (`34581df`). Tier 2 brief — within-tenant authorization

Read `reviews/package-review-P3-03-tier1.md` and **contracts.md §16 (A1, A2)** first. A1 is a user
decision: HR Admin manages channels and reads all projects, but does not read private channels.

Migration **`20260912189200_m1m2-communication-tier2.sql`**; **`20260912189300_…`** pre-authorized
for one forward fix, named with evidence. Tests in **`tests/m1m2/p3_chat_connect.mjs`** (disposable
fixtures, `finally` teardown, 1/2/0). Allowed files: the tasks.md P3-03 list. Same rules as §4.

### T2-1 Catalogue grants (A1)
Insert `access_template_grants`: `hr_admin` → `channel.manage@company`, `project.read@company`;
`communication_moderator` → `channel.manage@company`. Idempotent. Confirm with
`get_my_capability_summary` as `hr-employee.a` that both appear (company scope is not filtered).

### T2-2 Channel access
- Channel **metadata** (`chat_channels`, `chat_channel_members` rows) readable by: members; everyone
  in the tenant for `global`; org-unit match for `department` (keep the existing rule); and holders of
  `has_access_action('channel.manage','company')`.
- **Message** read (`chat_messages`): `global`/`department` per the same audience rule; `custom`
  (private) channels **members only**. No HR, `jwt_role_is_hr()`, `is_hr()` or Company-Admin
  bypass on messages. Drop the blanket `*_hr_all` policies on the three chat tables.
- **Realtime:** change `p3_realtime_topic_readable` so a `chat:` topic follows the **message-read**
  rule, not channel-row visibility — otherwise a channel manager could subscribe to a private
  channel. SECURITY INVOKER stays. Exact signature, derive from `pg_get_functiondef()`.
- Company Admin alone (`company-admin.a` / `owner.a`, no employee row) reads no private channel.

### T2-3 Writes through RPCs (P2-02/P3-02 pattern)
- Revoke INSERT/UPDATE/DELETE from `authenticated` on `chat_channels`, `chat_channel_members`,
  `chat_messages`. Definer RPCs with column allowlists, each with tenant fence, pinned `search_path`,
  no `anon` EXECUTE:
  - create/update/archive channel, set members → `channel.manage@company`.
  - send message → by **`channel_id`** (never name), sender derived server-side, caller must pass the
    message-read rule, announcement channels require `channel.manage@company`. **Idempotent on
    `(tenant_id, sender_id, client_message_id)`** — a retry returns the existing message, no second row,
    no second realtime event. Add the unique index if missing (check nothing's `ON CONFLICT` relies
    on a different one).
  - edit/soft-delete own message; soft-delete any message → `message.moderate` (not HR).
- Move `shared/Chat.tsx` / `useChat.ts` callers (channel create at ~528, member insert at ~559,
  message send) onto the RPCs; send a `client_message_id` (uuid per attempt).

### T2-4 Connect
- RESTRICTIVE tenant fence on `posts` and `post_reactions` (today `post_reactions` has only a
  PERMISSIVE one).
- `posts` update/delete: author, or `feed.moderate@company`. Insert: author = self, `feed.post`.
- `post_reactions`: insert/delete own only; retry idempotent (unique `(post_id, employee_id,
  reaction)` or equivalent — check the existing constraint first).
- `posts`/`post_reactions` realtime: **no trigger publishes them and no channel pattern exists** —
  Connect realtime never worked. Do not build it. Remove the dead subscribes in `Connect.tsx`; report
  the ones in `EmployeeLayout.tsx` / `HRLayout.tsx` (outside your files) rather than editing them.

### T2-5 Projects read for HR (A1)
`projects_p302_read` / `project_memberships_read`: add `OR has_access_action('project.read','company')`.
Read only — every P3-02 RPC must still deny HR `project.manage`/`project.members.manage`. Re-run
`node tests/m1m2/p3_projects_tasks.mjs` — it must still exit 0.

### Evidence (PASS/FAIL/UNTESTED per item, raw lines)
HR creates a channel and adds members (allowed); HR reads messages of a private channel it is not a
member of (**denied**) and cannot subscribe to its topic (**denied**); member of a private channel reads
and receives; non-member employee denied; Company Admin alone denied; send-retry with the same
`client_message_id` → one row, one event; employee edits another's message/post (denied), author
allowed, moderator soft-delete allowed; reaction on behalf of another employee denied; HR sees all
projects but `p3_update_project` denied; existing custom channels (`vishal`, `test`, `test2`) still
readable by their members (use existing rows — see §1 of package-review-P3-02 for why). Tier 1 suite
still passes except known item 6. Hygiene as §5 item 9.
