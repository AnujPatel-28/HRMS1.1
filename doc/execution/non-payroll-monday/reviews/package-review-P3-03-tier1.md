# Package review — P3-03 Tier 1 (cross-tenant and anonymous realtime isolation)

Reviewer: Opus 5 (lead), 2026-09-21. **Verdict: ACCEPTED** at `34581df` (GPT-6 Astra).
Migrations `20260912189000` + authorized forward fix `20260912189100` (forged cross-tenant
attachment reference — found by the implementer's own negative test).

## 1. Independently verified on TB-M1M2

| Check | Result |
|---|---|
| Lead's original attack probes (`scratch/p303-realtime-probe.mjs`, `p303-publish-probe.mjs`) | every legacy topic `REALTIME_UNAUTHORIZED` for anon and Company B; nothing received |
| Lead's new-shape probe (`scratch/p303-tier1-verify.mjs`) — tenant `111035ce` chat + channel-list topics, Company A notification topic | Company B, same-tenant colleague, anon: all refused, nothing received. `employee.a` on own notification topic: subscribed, received exactly the server event; own spoof publish not delivered |
| Full suite `p3_realtime_isolation.mjs` | all PASS except the known item 6 (exit 1 is that deliberate FAIL); RLS 1/2/0 before and after; 7 existing channels preserved |
| `--existing` (Vishal, tenant `111035ce`) | receives own `general` before and after reconnect; refused on `97da3641` `general` (real same-name collision); Company B and anon receive nothing; `PASSWORD_HASH_RESTORED true` |
| `realtime.channels` / `realtime.messages` RLS | enabled; legacy patterns disabled; `chat:%:%`, `chat-channels:%`, `notifications:%:%` enabled |
| `chat-attachments` bucket | private (set by API PATCH — not reconstructible from SQL) |
| 5 touched functions | one `pg_proc` row each, no `anon` EXECUTE |

Design review: subscribe predicate is SECURITY INVOKER and delegates to table RLS (no definer
bypass); payloads are identifiers only; client publish denied by a RESTRICTIVE `false`.

## 2. Accepted residuals — lead decisions

- **Item 6, platform limit:** an already-joined socket keeps receiving events after the member is
  revoked; reconnect is refused. **Accepted** because payloads are ids only and every content read is
  a fresh RLS refetch, so the residual is event metadata (ids, timing) until the socket drops.
  This deviates from contracts.md §164 ("disable surfaces without proven freshness") — recorded as a
  v0.5 amendment. Report to InsForge as a feature request (server-side unsubscribe on policy change).
- **Presence:** authorized subscribers of the same topic see each other's user ids. Accepted — same
  audience that can read the channel.
- **Signed URLs** survive suspension until expiry (300 s). The app downloads through authenticated
  SDK calls, not stored links. Accepted.
- UNTESTED: browser click-through of an attachment; bell rendering of a spoof (now moot — client
  publish is denied server-side).

## 3. Carried to Tier 2

`chat_channels` HR/`jwt_role_is_hr` blanket access, direct writes, Connect author controls, reaction
ownership, idempotency. Note: the chat subscribe predicate currently follows **channel-row**
visibility; Tier 2 must make it follow the **message-read** rule once channel managers can see
private channel metadata.
