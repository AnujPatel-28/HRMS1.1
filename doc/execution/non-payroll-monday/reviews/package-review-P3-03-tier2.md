# Package review — P3-03 Tier 2 (within-tenant chat / Connect authorization)

Reviewer: Opus 5 (lead), 2026-09-21. **Verdict: ACCEPTED** with two lead forward fixes.

Commits: `2f1a140` + `5c00065` (Sonnet 5: migration `189200`, frontend, `p3_chat_connect.mjs`).
Lead: `189300`, `189400`, Tier 1 probe repair, this review.

## 1. Two defects found in review — both fixed by the lead, both proven before and after

| # | Defect | Before | After |
|---|---|---|---|
| **L1** (`189300`) | `p3_chat_object_readable` (from `189100`) granted attachment access by **channel-row visibility**. `189200` made private channels' rows visible to `channel.manage` holders (§16 A1), so HR could read **and write** a private channel's attachments without being a member | HR download ALLOWED, HR upload ALLOWED | HR download `Object not found`, HR upload `permission denied`; member still uploads/downloads |
| **L2** (`189400`) | `p3_set_channel_members` let a channel manager add **themselves** to any private channel and then read its history — defeating A1 | (by code) | HR self-add to another's private channel `CHANNEL_SELF_ADD_DENIED`; HR self-add to a channel it created ALLOWED |

Probes: `scratch/p303-private-attachment-probe.mjs`, `scratch/p303-self-add-probe.mjs`. Both
rules now follow the **message-read** rule (`p3_channel_audience`), as the realtime topic check
already did. **Pattern to remember:** when a package widens *metadata* visibility, every check
that keyed on metadata visibility silently widens too.

Also: the Tier 1 suite crashed after `189200` revoked direct `chat_messages` writes (its forged-
reference probe inserted directly). Repointed at `p3_send_chat_message` — same attack, only write
path. Sonnet correctly stopped rather than edit a file outside its list.

## 2. Independently verified on TB-M1M2

| Check | Result |
|---|---|
| `p3_chat_connect.mjs` | exit 0 (after 189300 and 189400); RLS 1/2/0 before/after |
| `p3_projects_tasks.mjs` | exit 0 — P3-02 unaffected by HR `project.read@company` |
| `p3_realtime_isolation.mjs` | runs to completion; only the accepted item 6 FAIL; forged cross-tenant reference PASS |
| 5 key functions | one `pg_proc` row each, no `anon` EXECUTE |
| Build / drift | clean / 49 of 315 (deferred baseline) |

Implementer-reported and consistent with the migration read: HR creates/updates/archives
channels; HR non-member reads 0 private messages and is refused the private topic; Company Admin
alone reads nothing private; send retry returns one row; non-author edit denied; moderator
soft-delete allowed; cross-author post edit denied; reaction for another employee denied (`42501`).

## 3. Residuals (accepted, recorded)

- `posts_update` lets an author change **any** column of their own post, including `type` →
  `announcement` and `is_pinned` (insert blocks announcements for non-moderators; update does
  not). RLS cannot scope columns; fix is an RPC for post edits. Low severity, within-tenant.
- Send idempotency is keyed `(channel_id, client_message_id)`, not per sender. Client ids are
  random UUIDs, so collision is negligible; a collision would return the other message's id.
- Existing channels `test` / `test2` (tenant `97da3641`): membership rows unchanged by SQL; live
  member read UNTESTED (no credentials). `vishal` live read PASS.
- Tenants with no `hr_admin` / `communication_moderator` holder cannot create channels — same
  class as P3-02's zero `project_manager` finding.
- Connect realtime (`posts`, `post_reactions`) never worked — no trigger, no channel pattern.
  Dead subscribes removed from `Connect.tsx`; still present in `EmployeeLayout.tsx` / `HRLayout.tsx`.
- AC8 birthday automation: PARTIAL, disabled.

**P3-03 is complete.** `channel:<id>` may now be advertised — fold that into P3-02b (resolver +
AuthContext change, one package for both project and channel scope).
