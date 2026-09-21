#!/usr/bin/env node
/*
P3-03 TIER 1 HOLD-POINT REPORT — 2026-09-21
Scope: TB-M1M2 fb9a8659-9950-4637-a58e-4a882ef24419 only.
Prerequisite PASS: deny-topic RLS refused fresh anon/A/B subscriptions and
existing-socket publishes. Role/identity control allowed only authenticated A.
Already joined sockets retained delivery even after subsequent subscribe denial.
Initial probe cleanup attempted forbidden direct message-history DELETE; its
transaction rolled back. Cleanup was corrected to delete only the owned channel;
original disabled RLS state was verified restored before the implementation.

§5 results:
1 PASS server anonymous isolation; browser spoof rendering UNTESTED.
2 PASS Company B denial/no events before and after reconnect, including same name.
  Pre-migration reconnect was not separately exercised (UNTESTED baseline).
3 PASS hr-employee.a cannot subscribe to employee.a notifications.
4 PASS fixture chat/own notification and user-authorized existing general channels.
  The brief's da7a tenant has no existing channel. User explicitly replaced this
  with 111035ce / 97da3641 real same-name channels and authorized Vishal login.
5 PASS identifier-only payloads; content and attachment URL absent.
6 FAIL: existing suspended socket still receives message and notification ids.
  Reconnect is refused. This is a measured server delivery/revocation limitation.
7 PASS HTTP/SDK isolation + forged-reference regression; actual browser attachment
  click UNTESTED. Fresh signed URLs remain usable after suspension until expiry.
8 PASS old global patterns disabled, changed trigger bodies no longer publish there.
9 PASS build, one pg_proc row/name, pinned search_path, no anon EXECUTE, removed
  anon I/U/D/TRUNCATE on six tables, invariant 1/2/0. Authenticated writes retained
  for Tier 2 (not revoked). Policy drift exit 1: 49/318, same 49 deferred baseline.
  Diagnose exit 0, errors [], advisor null/unavailable. Build has bundle warning.
AC8 PARTIAL — automation disabled; schedules list has no auto-birthday-posts.
Presence: successful subscribe includes peer user ids. Denied users cannot see
new topic presence; identities remain visible to authorized topic participants.
Posts/post_reactions subscriptions fail both before/after (no enabled patterns);
this is inactive delivery, not evidence of an authorization repair.

Deployment: initial 20260912189000 applied, then the single authorized 189100 fix
after a forged attachment reference bypass was reproduced. Never edit either
applied migration. Bucket privacy was separately set with an authenticated admin
PATCH /api/storage/buckets/chat-attachments {"isPublic":false}, HTTP 200.
A migration-only rebuild MUST perform that PATCH; SQL does not set the flag.
No pre-existing chat-attachments objects were present; unqualified legacy keys
now fail closed. No other bucket was changed. Shared persona files untouched.

Run commands:
  npm run test:m1m2:target
  node tests/m1m2/p3_realtime_isolation.mjs
  node tests/m1m2/p3_realtime_isolation.mjs --storage-only
  node tests/m1m2/p3_realtime_isolation.mjs --storage-revoke
  node tests/m1m2/p3_realtime_isolation.mjs --existing
Default suite reports the measured revocation FAIL and now exits nonzero for it.
--existing temporarily changes only Vishal's password column, retains the original
hash only in memory, restores in finally and compares in SQL without printing it.
--prove requires the pristine disabled-RLS state and intentionally refuses now.
--apply and --before-only are historical baseline modes, not rerun instructions.
All owned fixtures were removed; memberships restored; seven existing channels
preserved. Stop here; Tier 2 remains undispatched.

RAW BEFORE excerpts (recorded before 189000; not regenerated after migration):
ACK BEFORE anon chat_messages {"ok":true,"channel":"chat_messages","presence":{"members":[{"type":"anonymous","presenceId":"0njgTXzEb4XkrHhvAAAV","joinedAt":"2026-09-21T10:02:07.538Z"}]}}
RAW BEFORE employee.b UPDATE_message [{"id":"c3030000-0000-4000-8000-000000000003","channel":"p303-same-name","content":"p303 BEFORE confidential body","sender_id":"a0000000-0000-4000-8001-000000000002","tenant_id":"a0000000-0000-4000-8000-000000000001","channel_id":"c3030000-0000-4000-8000-000000000001","created_at":"2026-09-21T10:01:55.923432+00:00","is_deleted":false,"attachment_url":"chat-attachments:a0000000-0000-4000-8000-000000000001/c3030000-0000-4000-8000-000000000001/p303-fixture.txt","attachment_name":"fixture.txt","client_message_id":"1f8df7e1-b8a6-469b-a598-95a3bed22002","meta":{"channel":"realtime:chat:p303-same-name","senderType":"system","messageId":"1c24d6d4-9e58-4464-bb46-2cb0518522d9","timestamp":"2026-09-21T10:02:17.760Z"}}]
RAW BEFORE employee.a INSERT_notification [{"id":"c3030000-0000-4000-8000-000000000005","title":"p303 spoof probe","tenant_id":"a0000000-0000-4000-8000-000000000001","employee_id":"a0000000-0000-4000-8001-000000000002","meta":{"channel":"realtime:notifications:a0000000-0000-4000-8001-000000000002","senderType":"user","messageId":"d272c8eb-1e3d-4819-9beb-17bb0434588f","timestamp":"2026-09-21T10:02:36.771Z"}}]
RAW anon realtime:error [{"channel":"p303-rls-proof","code":"REALTIME_UNAUTHORIZED","message":"Not authorized to publish to this channel"}]
STORAGE BEFORE previous_public_url {"status":200}
STORAGE BEFORE employee.a {"ok":true,"bytes":23}
STORAGE BEFORE employee.b {"ok":true,"bytes":23}

RAW AFTER / FORWARD-FIX evidence:
FAIL 7 forged cross-tenant attachment reference denied {"ok":true}
RLS_BEFORE [1,2,0]
STORAGE strategy {"status":200,"method":"presigned"}
ACK AFTER anon chat_messages {"ok":false,"channel":"chat_messages","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER anon chat_channels {"ok":false,"channel":"chat_channels","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER anon chat:p303-same-name {"ok":false,"channel":"chat:p303-same-name","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER anon notifications:a0000000-0000-4000-8001-000000000002 {"ok":false,"channel":"notifications:a0000000-0000-4000-8001-000000000002","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER anon chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001 {"ok":false,"channel":"chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER anon notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002 {"ok":false,"channel":"notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER anon chat-channels:a0000000-0000-4000-8000-000000000001 {"ok":false,"channel":"chat-channels:a0000000-0000-4000-8000-000000000001","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER anon posts {"ok":false,"channel":"posts","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER anon post_reactions {"ok":false,"channel":"post_reactions","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.a chat_messages {"ok":false,"channel":"chat_messages","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.a chat_channels {"ok":false,"channel":"chat_channels","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.a chat:p303-same-name {"ok":false,"channel":"chat:p303-same-name","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.a notifications:a0000000-0000-4000-8001-000000000002 {"ok":false,"channel":"notifications:a0000000-0000-4000-8001-000000000002","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.a chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001 {"ok":true,"channel":"chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","presence":{"members":[{"type":"user","presenceId":"a0000000-0000-4000-8001-000000000001","joinedAt":"2026-09-21T10:14:46.579Z"}]}}
ACK AFTER employee.a notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002 {"ok":true,"channel":"notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002","presence":{"members":[{"type":"user","presenceId":"a0000000-0000-4000-8001-000000000001","joinedAt":"2026-09-21T10:14:46.699Z"}]}}
ACK AFTER employee.a chat-channels:a0000000-0000-4000-8000-000000000001 {"ok":true,"channel":"chat-channels:a0000000-0000-4000-8000-000000000001","presence":{"members":[{"type":"user","presenceId":"a0000000-0000-4000-8001-000000000001","joinedAt":"2026-09-21T10:14:47.170Z"}]}}
ACK AFTER employee.a posts {"ok":false,"channel":"posts","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.a post_reactions {"ok":false,"channel":"post_reactions","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER hr-employee.a chat_messages {"ok":false,"channel":"chat_messages","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER hr-employee.a chat_channels {"ok":false,"channel":"chat_channels","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER hr-employee.a chat:p303-same-name {"ok":false,"channel":"chat:p303-same-name","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER hr-employee.a notifications:a0000000-0000-4000-8001-000000000002 {"ok":false,"channel":"notifications:a0000000-0000-4000-8001-000000000002","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER hr-employee.a chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001 {"ok":true,"channel":"chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","presence":{"members":[{"type":"user","presenceId":"a0000000-0000-4000-8001-000000000001","joinedAt":"2026-09-21T10:14:46.579Z"},{"type":"user","presenceId":"a0000000-0000-4000-8002-000000000001","joinedAt":"2026-09-21T10:14:48.496Z"}]}}
RAW AFTER employee.a presence:join [{"member":{"type":"user","presenceId":"a0000000-0000-4000-8002-000000000001","joinedAt":"2026-09-21T10:14:48.496Z"},"meta":{"channel":"chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","senderType":"system","messageId":"0d4621ec-1b62-4456-8f76-9bbd26ae8d59","timestamp":"2026-09-21T10:14:48.496Z"}}]
ACK AFTER hr-employee.a notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002 {"ok":false,"channel":"notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER hr-employee.a chat-channels:a0000000-0000-4000-8000-000000000001 {"ok":true,"channel":"chat-channels:a0000000-0000-4000-8000-000000000001","presence":{"members":[{"type":"user","presenceId":"a0000000-0000-4000-8001-000000000001","joinedAt":"2026-09-21T10:14:47.170Z"},{"type":"user","presenceId":"a0000000-0000-4000-8002-000000000001","joinedAt":"2026-09-21T10:14:48.716Z"}]}}
RAW AFTER employee.a presence:join [{"member":{"type":"user","presenceId":"a0000000-0000-4000-8002-000000000001","joinedAt":"2026-09-21T10:14:48.716Z"},"meta":{"channel":"chat-channels:a0000000-0000-4000-8000-000000000001","senderType":"system","messageId":"ea04780e-c28e-447b-a010-ddd2aa2642f6","timestamp":"2026-09-21T10:14:48.716Z"}}]
ACK AFTER hr-employee.a posts {"ok":false,"channel":"posts","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER hr-employee.a post_reactions {"ok":false,"channel":"post_reactions","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.b chat_messages {"ok":false,"channel":"chat_messages","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.b chat_channels {"ok":false,"channel":"chat_channels","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.b chat:p303-same-name {"ok":false,"channel":"chat:p303-same-name","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.b notifications:a0000000-0000-4000-8001-000000000002 {"ok":false,"channel":"notifications:a0000000-0000-4000-8001-000000000002","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.b chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001 {"ok":false,"channel":"chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.b notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002 {"ok":false,"channel":"notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.b chat-channels:a0000000-0000-4000-8000-000000000001 {"ok":false,"channel":"chat-channels:a0000000-0000-4000-8000-000000000001","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.b posts {"ok":false,"channel":"posts","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.b post_reactions {"ok":false,"channel":"post_reactions","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK AFTER employee.b own chat:b0000000-0000-4000-8000-000000000002:c3030000-0000-4000-8000-000000000002 {"ok":true,"channel":"chat:b0000000-0000-4000-8000-000000000002:c3030000-0000-4000-8000-000000000002","presence":{"members":[{"type":"user","presenceId":"b0000000-0000-4000-8001-000000000001","joinedAt":"2026-09-21T10:14:50.585Z"}]}}
PASS 2 Company B own same-name channel true
RAW AFTER hr-employee.a UPDATE_message [{"id":"c3030000-0000-4000-8000-000000000003","op":"UPDATE","channel_id":"c3030000-0000-4000-8000-000000000001","meta":{"channel":"realtime:chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","senderType":"system","messageId":"f50ae5b2-161b-4bf3-a818-ae7439e531a3","timestamp":"2026-09-21T10:14:54.400Z"}}]
RAW AFTER hr-employee.a UPDATE_channel [{"id":"c3030000-0000-4000-8000-000000000001","op":"UPDATE","meta":{"channel":"realtime:chat-channels:a0000000-0000-4000-8000-000000000001","senderType":"system","messageId":"b56402ae-2442-4511-9e11-3c1003d4b5b0","timestamp":"2026-09-21T10:14:59.899Z"}}]
RAW AFTER employee.a UPDATE_message [{"id":"c3030000-0000-4000-8000-000000000003","op":"UPDATE","channel_id":"c3030000-0000-4000-8000-000000000001","meta":{"channel":"realtime:chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","senderType":"system","messageId":"f50ae5b2-161b-4bf3-a818-ae7439e531a3","timestamp":"2026-09-21T10:14:54.400Z"}}]
RAW AFTER employee.a UPDATE_channel [{"id":"c3030000-0000-4000-8000-000000000001","op":"UPDATE","meta":{"channel":"realtime:chat-channels:a0000000-0000-4000-8000-000000000001","senderType":"system","messageId":"b56402ae-2442-4511-9e11-3c1003d4b5b0","timestamp":"2026-09-21T10:14:59.899Z"}}]
RAW AFTER employee.a INSERT_notification [{"id":"c3030000-0000-4000-8000-000000000005","op":"INSERT","meta":{"channel":"realtime:notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002","senderType":"system","messageId":"80207e29-f0a8-439f-8823-f2dafc240bd1","timestamp":"2026-09-21T10:15:05.281Z"}}]
PASS 1/2 anon receives no A content []
PASS 1/2 employee.b receives no A content []
PASS 4 own notification delivery [{"event":"INSERT_notification","args":[{"id":"c3030000-0000-4000-8000-000000000005","op":"INSERT","meta":{"channel":"realtime:notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002","senderType":"system","messageId":"80207e29-f0a8-439f-8823-f2dafc240bd1","timestamp":"2026-09-21T10:15:05.281Z"}}]}]
PASS 4/5 own chat id-only delivery [{"event":"UPDATE_message","args":[{"id":"c3030000-0000-4000-8000-000000000003","op":"UPDATE","channel_id":"c3030000-0000-4000-8000-000000000001","meta":{"channel":"realtime:chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","senderType":"system","messageId":"f50ae5b2-161b-4bf3-a818-ae7439e531a3","timestamp":"2026-09-21T10:14:54.400Z"}}]}]
RAW AFTER anon realtime:error [{"channel":"chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","code":"REALTIME_NOT_SUBSCRIBED","message":"Must subscribe to channel before publishing messages"}]
RAW AFTER employee.b realtime:error [{"channel":"chat:b0000000-0000-4000-8000-000000000002:c3030000-0000-4000-8000-000000000002","code":"REALTIME_UNAUTHORIZED","message":"Not authorized to publish to this channel"}]
RAW AFTER employee.a realtime:error [{"channel":"chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","code":"REALTIME_UNAUTHORIZED","message":"Not authorized to publish to this channel"}]
ACK RECONNECT employee.b chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001 {"ok":false,"channel":"chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
PASS 2 reconnect denied "chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001"
ACK RECONNECT employee.b notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002 {"ok":false,"channel":"notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
PASS 2 reconnect denied "notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002"
ACK RECONNECT employee.b chat-channels:a0000000-0000-4000-8000-000000000001 {"ok":false,"channel":"chat-channels:a0000000-0000-4000-8000-000000000001","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
PASS 2 reconnect denied "chat-channels:a0000000-0000-4000-8000-000000000001"
RAW AFTER hr-employee.a UPDATE_message [{"id":"c3030000-0000-4000-8000-000000000003","op":"UPDATE","channel_id":"c3030000-0000-4000-8000-000000000001","meta":{"channel":"realtime:chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","senderType":"system","messageId":"7990448e-d9bd-492e-8b86-9d32907ac1bf","timestamp":"2026-09-21T10:15:19.879Z"}}]
RAW AFTER hr-employee.a UPDATE_channel [{"id":"c3030000-0000-4000-8000-000000000001","op":"UPDATE","meta":{"channel":"realtime:chat-channels:a0000000-0000-4000-8000-000000000001","senderType":"system","messageId":"9d0d8f40-0ffa-47b3-992d-e16703a8e155","timestamp":"2026-09-21T10:15:25.275Z"}}]
RAW AFTER employee.a UPDATE_message [{"id":"c3030000-0000-4000-8000-000000000003","op":"UPDATE","channel_id":"c3030000-0000-4000-8000-000000000001","meta":{"channel":"realtime:chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","senderType":"system","messageId":"7990448e-d9bd-492e-8b86-9d32907ac1bf","timestamp":"2026-09-21T10:15:19.879Z"}}]
RAW AFTER employee.a UPDATE_channel [{"id":"c3030000-0000-4000-8000-000000000001","op":"UPDATE","meta":{"channel":"realtime:chat-channels:a0000000-0000-4000-8000-000000000001","senderType":"system","messageId":"9d0d8f40-0ffa-47b3-992d-e16703a8e155","timestamp":"2026-09-21T10:15:25.275Z"}}]
RAW AFTER employee.a INSERT_notification [{"id":"c3030000-0000-4000-8000-000000000005","op":"INSERT","meta":{"channel":"realtime:notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002","senderType":"system","messageId":"d37a187d-72b2-481d-9531-04249eef424f","timestamp":"2026-09-21T10:15:30.289Z"}}]
PASS 2 reconnect receives nothing []
STORAGE AFTER previous_public_url {"status":401}
PASS 7 anonymous public URL denied 401
STORAGE AFTER employee.a {"ok":true,"bytes":23}
PASS 7 employee.a download 23
STORAGE AFTER employee.b {"ok":false,"error":"Object not found"}
PASS 7 employee.b download "Object not found"
PASS 7 forged cross-tenant attachment reference denied {"ok":false,"error":"Object not found"}
STORAGE AFTER previous_signed_url {"status":403}
RAW AFTER hr-employee.a UPDATE_message [{"id":"c3030000-0000-4000-8000-000000000003","op":"UPDATE","channel_id":"c3030000-0000-4000-8000-000000000001","meta":{"channel":"realtime:chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","senderType":"system","messageId":"8f7fb015-c186-4216-837e-67890801fe97","timestamp":"2026-09-21T10:15:52.968Z"}}]
RAW AFTER hr-employee.a UPDATE_channel [{"id":"c3030000-0000-4000-8000-000000000001","op":"UPDATE","meta":{"channel":"realtime:chat-channels:a0000000-0000-4000-8000-000000000001","senderType":"system","messageId":"d44f509a-f968-43b9-9677-ecb26fc24710","timestamp":"2026-09-21T10:15:58.046Z"}}]
RAW AFTER employee.a UPDATE_message [{"id":"c3030000-0000-4000-8000-000000000003","op":"UPDATE","channel_id":"c3030000-0000-4000-8000-000000000001","meta":{"channel":"realtime:chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","senderType":"system","messageId":"8f7fb015-c186-4216-837e-67890801fe97","timestamp":"2026-09-21T10:15:52.968Z"}}]
RAW AFTER employee.a UPDATE_channel [{"id":"c3030000-0000-4000-8000-000000000001","op":"UPDATE","meta":{"channel":"realtime:chat-channels:a0000000-0000-4000-8000-000000000001","senderType":"system","messageId":"d44f509a-f968-43b9-9677-ecb26fc24710","timestamp":"2026-09-21T10:15:58.046Z"}}]
RAW AFTER employee.a INSERT_notification [{"id":"c3030000-0000-4000-8000-000000000005","op":"INSERT","meta":{"channel":"realtime:notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002","senderType":"system","messageId":"db7bd6e0-85df-40ec-a9c5-b9fa4d686c9f","timestamp":"2026-09-21T10:16:03.677Z"}}]
FAIL 6 PLATFORM_LIMIT existing revoked socket [{"event":"UPDATE_message","args":[{"id":"c3030000-0000-4000-8000-000000000003","op":"UPDATE","channel_id":"c3030000-0000-4000-8000-000000000001","meta":{"channel":"realtime:chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","senderType":"system","messageId":"8f7fb015-c186-4216-837e-67890801fe97","timestamp":"2026-09-21T10:15:52.968Z"}}]},{"event":"INSERT_notification","args":[{"id":"c3030000-0000-4000-8000-000000000005","op":"INSERT","meta":{"channel":"realtime:notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002","senderType":"system","messageId":"db7bd6e0-85df-40ec-a9c5-b9fa4d686c9f","timestamp":"2026-09-21T10:16:03.677Z"}}]}]
ACK REVOKED_RECONNECT employee.a chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001 {"ok":false,"channel":"chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
PASS 6 revoked reconnect denied "chat:a0000000-0000-4000-8000-000000000001:c3030000-0000-4000-8000-000000000001"
ACK REVOKED_RECONNECT employee.a notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002 {"ok":false,"channel":"notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
PASS 6 revoked reconnect denied "notifications:a0000000-0000-4000-8000-000000000001:a0000000-0000-4000-8001-000000000002"
ACK REVOKED_RECONNECT employee.a chat-channels:a0000000-0000-4000-8000-000000000001 {"ok":false,"channel":"chat-channels:a0000000-0000-4000-8000-000000000001","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
PASS 6 revoked reconnect denied "chat-channels:a0000000-0000-4000-8000-000000000001"
PASS 7 revoked new download denied "Object not found"
7 previously-issued URL after suspension {"status":403}
8 GLOBAL_TOPICS [{"pattern":"chat_messages","enabled":false},{"pattern":"chat_channels","enabled":false}]

RLS_AFTER [1,2,0]
EXISTING_CHANNELS_PRESERVED 7
AC8 PARTIAL automation disabled []

The 403 above was an expired short-lived URL, NOT proof of revocation.
Fresh 300-second URL control:
STORAGE strategy {"status":200,"method":"presigned"}
SIGNED_FRESH_BEFORE_SUSPENSION {"method":"presigned","requestedSeconds":300,"status":200}
PASS 7 suspended new download denied "Object not found"
SIGNED_FRESH_AFTER_SUSPENSION {"status":200}

Final direct HTTP GET and SDK regression run (after forward fix):
STORAGE strategy {"status":200,"method":"presigned"}
STORAGE AFTER previous_public_url {"status":401}
PASS 7 anonymous public URL denied 401
STORAGE AFTER wrong_tenant_GET {"status":404}
PASS 7 wrong-tenant GET denied 404
STORAGE AFTER employee.a {"ok":true,"bytes":23}
PASS 7 employee.a download 23
STORAGE AFTER employee.b {"ok":false,"error":"Object not found"}
PASS 7 employee.b download "Object not found"
PASS 7 forged cross-tenant attachment reference denied {"ok":false,"error":"Object not found"}
STORAGE AFTER previous_signed_url {"status":200}
RLS_AFTER [1,2,0]
EXISTING_CHANNELS_PRESERVED 7
Existing real same-name channels, before/after reconnect:
EXISTING_TARGET {"projectId":"fb9a8659-9950-4637-a58e-4a882ef24419","projectName":"tb-m1m2","baseUrl":"https://rq3qmu8y-j9g.ap-southeast.insforge.app","backendVersion":"1.0.0"}
EXISTING_SESSION_TENANT {"tenant":"111035ce-979c-429a-a482-ddfa87dbfe6e"}
ACK EXISTING INITIAL Vishal chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29 {"ok":true,"channel":"chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","presence":{"members":[{"type":"user","presenceId":"92d7d988-175a-445e-9fbb-66b78e9608b4","joinedAt":"2026-09-21T10:17:57.810Z"}]}}
ACK EXISTING INITIAL Vishal chat:97da3641-d69e-4e7a-bdc9-760675be8d28:237cef7f-4fce-4c43-8a6a-c0b52e872f98 {"ok":false,"channel":"chat:97da3641-d69e-4e7a-bdc9-760675be8d28:237cef7f-4fce-4c43-8a6a-c0b52e872f98","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK EXISTING INITIAL employee.b chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29 {"ok":false,"channel":"chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK EXISTING INITIAL employee.b chat:97da3641-d69e-4e7a-bdc9-760675be8d28:237cef7f-4fce-4c43-8a6a-c0b52e872f98 {"ok":false,"channel":"chat:97da3641-d69e-4e7a-bdc9-760675be8d28:237cef7f-4fce-4c43-8a6a-c0b52e872f98","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK EXISTING INITIAL anon chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29 {"ok":false,"channel":"chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK EXISTING INITIAL anon chat:97da3641-d69e-4e7a-bdc9-760675be8d28:237cef7f-4fce-4c43-8a6a-c0b52e872f98 {"ok":false,"channel":"chat:97da3641-d69e-4e7a-bdc9-760675be8d28:237cef7f-4fce-4c43-8a6a-c0b52e872f98","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
RAW EXISTING INITIAL Vishal p303_existing [{"id":"d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","op":"UPDATE","channel_id":"d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","meta":{"channel":"realtime:chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","senderType":"system","messageId":"6e847631-4147-4611-8749-30512094f370","timestamp":"2026-09-21T10:18:03.398Z"}}]
PASS EXISTING INITIAL Vishal [{"event":"p303_existing","args":[{"id":"d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","op":"UPDATE","channel_id":"d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","meta":{"channel":"realtime:chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","senderType":"system","messageId":"6e847631-4147-4611-8749-30512094f370","timestamp":"2026-09-21T10:18:03.398Z"}}]}]
PASS EXISTING INITIAL employee.b []
PASS EXISTING INITIAL anon []
ACK EXISTING RECONNECT Vishal chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29 {"ok":true,"channel":"chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","presence":{"members":[{"type":"user","presenceId":"92d7d988-175a-445e-9fbb-66b78e9608b4","joinedAt":"2026-09-21T10:18:12.801Z"}]}}
ACK EXISTING RECONNECT Vishal chat:97da3641-d69e-4e7a-bdc9-760675be8d28:237cef7f-4fce-4c43-8a6a-c0b52e872f98 {"ok":false,"channel":"chat:97da3641-d69e-4e7a-bdc9-760675be8d28:237cef7f-4fce-4c43-8a6a-c0b52e872f98","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK EXISTING RECONNECT employee.b chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29 {"ok":false,"channel":"chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK EXISTING RECONNECT employee.b chat:97da3641-d69e-4e7a-bdc9-760675be8d28:237cef7f-4fce-4c43-8a6a-c0b52e872f98 {"ok":false,"channel":"chat:97da3641-d69e-4e7a-bdc9-760675be8d28:237cef7f-4fce-4c43-8a6a-c0b52e872f98","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK EXISTING RECONNECT anon chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29 {"ok":false,"channel":"chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
ACK EXISTING RECONNECT anon chat:97da3641-d69e-4e7a-bdc9-760675be8d28:237cef7f-4fce-4c43-8a6a-c0b52e872f98 {"ok":false,"channel":"chat:97da3641-d69e-4e7a-bdc9-760675be8d28:237cef7f-4fce-4c43-8a6a-c0b52e872f98","error":{"code":"REALTIME_UNAUTHORIZED","message":"Not authorized to subscribe to this channel"}}
RAW EXISTING RECONNECT Vishal p303_existing [{"id":"d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","op":"UPDATE","channel_id":"d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","meta":{"channel":"realtime:chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","senderType":"system","messageId":"bc610212-bbc0-453e-9cb2-b17624c12104","timestamp":"2026-09-21T10:18:18.844Z"}}]
PASS EXISTING RECONNECT Vishal [{"event":"p303_existing","args":[{"id":"d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","op":"UPDATE","channel_id":"d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","meta":{"channel":"realtime:chat:111035ce-979c-429a-a482-ddfa87dbfe6e:d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29","senderType":"system","messageId":"bc610212-bbc0-453e-9cb2-b17624c12104","timestamp":"2026-09-21T10:18:18.844Z"}}]}]
PASS EXISTING RECONNECT employee.b []
PASS EXISTING RECONNECT anon []
PASSWORD_HASH_RESTORED [{"restored":true}]

*/
// No shared persona import: that module also reseeds memberships and leave balances.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@insforge/sdk';
import { io } from 'socket.io-client';
import { verifyTarget, runSql } from './_harness.mjs';
import { TB_M1M2 } from './_target.mjs';

const log = (label, value) => console.log(label, JSON.stringify(value));
const rows = sql => runSql(sql).rows;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
if (process.argv.includes('--existing')) {
  await existingData();
  process.exit(process.exitCode ?? 0);
}
if (!process.argv.includes('--prove')) {
  await tier1();
  process.exit(process.exitCode ?? 0);
}
const topic = 'p303-rls-proof';
const sockets = [];
let changed = false;
const verified = verifyTarget();
log('TARGET', verified);
const initial = rows("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('realtime.channels'::regclass,'realtime.messages'::regclass) ORDER BY relname");
log('INITIAL_RLS', initial);
assert.equal(initial.length, 2);
assert(initial.every(row => !row.relrowsecurity && !row.relforcerowsecurity), 'Probe requires the measured original disabled-RLS state');
assert.equal(rows("SELECT policyname FROM pg_policies WHERE schemaname='realtime'").length, 0, 'Existing policies: do not alter');
assert.equal(rows(`SELECT id FROM realtime.channels WHERE pattern='${topic}'`).length, 0);
const keyResult = spawnSync(process.execPath, ['node_modules/@insforge/cli/dist/index.js', 'secrets', 'get', 'ANON_KEY', '--json'], {encoding:'utf8'});
assert.equal(keyResult.status, 0, 'Anon key retrieval failed (output suppressed)');
const anonKey = JSON.parse(keyResult.stdout.slice(keyResult.stdout.indexOf('{'))).value;
const password = readFileSync('tests/m1m2/persona-password.local', 'utf8').trim();
const clients = new Map();
for (const name of ['employee.a', 'hr-employee.a', 'employee.b']) {
  const client = createClient({baseUrl:TB_M1M2.baseUrl, anonKey});
  const {data,error} = await client.auth.signInWithPassword({email:`${name}@m1m2.test`, password});
  assert(!error, `${name}: login failed`);
  assert(data.accessToken, 'Missing access token');
  clients.set(name, {client, token:data.accessToken});
}
async function invariant(label) {
  const counts = [];
  for (const {client} of clients.values()) {
    const {data,error} = await client.database.from('employees').select('id').eq('tenant_id','a0000000-0000-4000-8000-000000000001');
    assert(!error, 'Invariant read failed');
    counts.push(data.length);
  }
  log(label, counts);
  assert.deepEqual(counts,[1,2,0]);
}
async function socket(name, token) {
  const s = io(TB_M1M2.baseUrl,{transports:['websocket'],auth:{token},reconnection:false,timeout:15000});
  sockets.push(s);
  s.onAny((event,...args)=>log(`RAW ${name} ${event}`,args));
  await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});
  return s;
}
async function subscribe(s,name,channel=topic) {
  const ack = await s.timeout(10000).emitWithAck('realtime:subscribe',{channel});
  log(`ACK ${name} ${channel}`,ack);
  return ack;
}
async function publish(s,name,marker) {
  log(`SEND ${name}`,{channel:topic,event:'p303_marker',payload:{marker}});
  s.emit('realtime:publish',{channel:topic,event:'p303_marker',payload:{marker}});
  await delay(1500);
}
await invariant('RLS_BEFORE');
try {
  changed = true;
  runSql(`INSERT INTO realtime.channels(pattern,description,enabled) VALUES('${topic}','Disposable P3-03 RLS enforcement control',true)`);
  const anon = await socket('anon',anonKey);
  const a = await socket('employee.a',clients.get('employee.a').token);
  const b = await socket('employee.b',clients.get('employee.b').token);
  for (const [name,s] of [['anon',anon],['employee.a',a],['employee.b',b]]) assert.equal((await subscribe(s,`BEFORE ${name}`)).ok,true);
  await publish(anon,'BEFORE anon','before-anon');
  await publish(a,'BEFORE employee.a','before-a');
  // Preserve existing topics' original access while denying only this disposable topic.
  runSql(`DO $probe$ BEGIN
    ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY;
    CREATE POLICY p303_probe_channels ON realtime.channels FOR SELECT TO anon,authenticated USING (pattern <> '${topic}');
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY p303_probe_messages ON realtime.messages FOR INSERT TO anon,authenticated WITH CHECK (channel_name <> '${topic}');
  END $probe$`);
  log('DENY_CATALOGUE',rows("SELECT tablename,policyname,roles,qual,with_check FROM pg_policies WHERE schemaname='realtime'"));
  // Existing subscriptions isolate INSERT policy behavior from subscribe denial.
  await publish(anon,'DENY anon existing socket','deny-anon');
  await publish(a,'DENY employee.a existing socket','deny-a');
  const responses = [];
  for (const [name,token] of [['anon',anonKey],['employee.a',clients.get('employee.a').token],['employee.b',clients.get('employee.b').token]]) {
    const fresh = await socket(`DENY fresh ${name}`,token);
    responses.push(await subscribe(fresh,`DENY fresh ${name}`));
  }
  if (responses.some(result=>result.ok)) {
    log('PREREQUISITE','FAIL: deny policy did not prevent subscription; STOP implementation');
    process.exitCode = 2;
  } else {
    // Positive identity/role control: only authenticated employee A may join/publish.
    runSql(`DO $probe$ BEGIN
      ALTER POLICY p303_probe_channels ON realtime.channels USING (pattern <> '${topic}' OR (current_user='authenticated' AND auth.uid()='a0000000-0000-4000-8001-000000000001'::uuid));
      ALTER POLICY p303_probe_messages ON realtime.messages WITH CHECK (channel_name <> '${topic}' OR (current_user='authenticated' AND auth.uid()='a0000000-0000-4000-8001-000000000001'::uuid));
    END $probe$`);
    for (const [name,s] of [['anon',anon],['employee.a',a],['employee.b',b]]) {
      const result = await subscribe(s,`ROLE_CONTROL ${name}`);
      assert.equal(result.ok,name==='employee.a');
    }
    await publish(a,'ROLE_CONTROL employee.a','role-a');
    await publish(b,'ROLE_CONTROL employee.b','role-b');
    log('PREREQUISITE','Subscribe role/identity controls passed; inspect raw publish errors and delivered markers');
  }
} finally {
  for (const s of sockets) s.disconnect();
  if (changed) {
    runSql(`DO $probe$ BEGIN
      DROP POLICY IF EXISTS p303_probe_channels ON realtime.channels;
      DROP POLICY IF EXISTS p303_probe_messages ON realtime.messages;
      ALTER TABLE realtime.channels DISABLE ROW LEVEL SECURITY;
      ALTER TABLE realtime.messages DISABLE ROW LEVEL SECURITY;
      -- The platform denies direct DELETE on message history; deleting the owned
      -- channel uses its platform-managed cascading cleanup instead.
      DELETE FROM realtime.channels WHERE pattern='${topic}';
    END $probe$`);
    log('RESTORED_RLS',rows("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('realtime.channels'::regclass,'realtime.messages'::regclass) ORDER BY relname"));
    assert.equal(rows("SELECT policyname FROM pg_policies WHERE schemaname='realtime'").length,0);
    assert.equal(rows(`SELECT id FROM realtime.channels WHERE pattern='${topic}'`).length,0);
  }
  await invariant('RLS_AFTER');
}

async function tier1() {
  log('TARGET',verifyTarget());
  const cli = args => {
    const r=spawnSync(process.execPath,['node_modules/@insforge/cli/dist/index.js',...args,'--json'],{encoding:'utf8'});
    assert.equal(r.status,0,`CLI ${args.slice(0,2).join(' ')} failed (privileged output suppressed)`);
    return JSON.parse(r.stdout.slice(Math.min(...[r.stdout.indexOf('{'),r.stdout.indexOf('[')].filter(i=>i>=0))));
  };
  const anonKey=cli(['secrets','get','ANON_KEY']).value;
  const password=readFileSync('tests/m1m2/persona-password.local','utf8').trim();
  const A='a0000000-0000-4000-8000-000000000001', B='b0000000-0000-4000-8000-000000000002';
  const EA='a0000000-0000-4000-8001-000000000002', EB='b0000000-0000-4000-8001-000000000002';
  const CA='c3030000-0000-4000-8000-000000000001', CB='c3030000-0000-4000-8000-000000000002';
  const MA='c3030000-0000-4000-8000-000000000003', MB='c3030000-0000-4000-8000-000000000004';
  const MC='c3030000-0000-4000-8000-000000000006';
  const NA='c3030000-0000-4000-8000-000000000005';
  const key=`${A}/${CA}/p303-fixture.txt`;
  const clients={anon:{client:createClient({baseUrl:TB_M1M2.baseUrl,anonKey}),token:anonKey}};
  for(const name of ['employee.a','hr-employee.a','employee.b']) {
    const client=createClient({baseUrl:TB_M1M2.baseUrl,anonKey});
    const {data,error}=await client.auth.signInWithPassword({email:`${name}@m1m2.test`,password});
    assert(!error,`${name} login failed`);
    clients[name]={client,token:data.accessToken};
  }
  const inv=async label=>{
    const counts=[];
    for(const name of ['employee.a','hr-employee.a','employee.b']) {
      const {data,error}=await clients[name].client.database.from('employees').select('id').eq('tenant_id',A);
      assert(!error); counts.push(data.length);
    }
    log(label,counts); assert.deepEqual(counts,[1,2,0]);
  };
  await inv('RLS_BEFORE');
  const existing=rows('SELECT id,tenant_id,name,type FROM public.chat_channels ORDER BY id');
  log('EXISTING_CHANNELS',existing);
  log('EXISTING_DA7',existing.filter(c=>c.tenant_id.startsWith('da7a0000')));
  assert.equal(rows(`SELECT id FROM public.chat_channels WHERE id IN ('${CA}','${CB}')`).length,0,'Fixture collision');
  const originalMembership=rows(`SELECT id,status,access_version FROM public.tenant_memberships WHERE user_id='a0000000-0000-4000-8001-000000000001' AND tenant_id='${A}'`)[0];
  const activeSockets=[];
  let uploaded=false, setup=false, suspended=false;
  let oldUrl, signedUrl;
  const check=(label,ok,detail)=>{log(`${ok?'PASS':'FAIL'} ${label}`,detail);if(!ok)process.exitCode=1;};
  const sock=async(name,phase)=>{
    const s=io(TB_M1M2.baseUrl,{transports:['websocket'],auth:{token:clients[name].token},reconnection:false,timeout:15000});
    activeSockets.push(s); s.events=[];
    s.onAny((event,...args)=>{s.events.push({event,args});log(`RAW ${phase} ${name} ${event}`,args);});
    await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;
  };
  const sub=async(s,name,channel)=>{const ack=await s.timeout(10000).emitWithAck('realtime:subscribe',{channel});log(`ACK ${name} ${channel}`,ack);return ack;};
  const newChat=`chat:${A}:${CA}`,newNotice=`notifications:${A}:${EA}`;
  const newList=`chat-channels:${A}`;
  const legacy=['chat_messages','chat_channels','chat:p303-same-name',`notifications:${EA}`];
  const shapes=[...legacy,newChat,newNotice,newList,'posts','post_reactions'];
  const emit=async(phase)=>{
    runSql(`UPDATE public.chat_messages SET content='p303 ${phase} confidential body' WHERE id='${MA}'`);
    runSql(`UPDATE public.chat_channels SET description='p303 ${phase}' WHERE id='${CA}'`);
    runSql(`INSERT INTO public.notifications(id,tenant_id,employee_id,title,body,type) VALUES('${NA}','${A}','${EA}','p303 ${phase}','private fixture notification','general')`);
    await delay(2000);
    runSql(`DELETE FROM public.notifications WHERE id='${NA}'`);
  };
  const storageEvidence=async phase=>{
    const direct=await fetch(oldUrl,{redirect:'follow'});log(`STORAGE ${phase} previous_public_url`,{status:direct.status});
    if(phase==='AFTER')check('7 anonymous public URL denied',[401,403,404].includes(direct.status),direct.status);
    const wrongGet=await fetch(oldUrl,{headers:{Authorization:`Bearer ${clients['employee.b'].token}`},redirect:'follow'});
    log(`STORAGE ${phase} wrong_tenant_GET`,{status:wrongGet.status});
    if(phase==='AFTER')check('7 wrong-tenant GET denied',[401,403,404].includes(wrongGet.status),wrongGet.status);
    for(const name of ['employee.a','employee.b']) {
      const result=await clients[name].client.storage.from('chat-attachments').download(key);
      log(`STORAGE ${phase} ${name}`,{ok:!result.error,bytes:result.data?.size,error:result.error?.message});
      if(phase==='AFTER')check(`7 ${name} download`,name==='employee.a'?!result.error:!!result.error,result.error?.message??result.data?.size);
    }
    if (phase==='AFTER') {
      // Tier 2 (189200) revoked direct chat_messages writes; forge through the only write path.
      const forged=await clients['employee.b'].client.database.rpc('p3_send_chat_message',{p_channel_id:CB,p_content:'p303 forged reference',p_client_message_id:MC,p_attachment_url:`chat-attachments:${key}`,p_attachment_name:'forged.txt'});
      assert(!forged.error,forged.error?.message);
      const dl=await clients['employee.b'].client.storage.from('chat-attachments').download(key);
      check('7 forged cross-tenant attachment reference denied',!!dl.error,{ok:!dl.error,error:dl.error?.message});
      runSql(`DELETE FROM public.chat_messages WHERE tenant_id='${B}' AND content='p303 forged reference'`);
    }
    if(signedUrl){const replay=await fetch(signedUrl);log(`STORAGE ${phase} previous_signed_url`,{status:replay.status});}
  };
  try {
    setup=true;
    runSql(`INSERT INTO public.chat_channels(id,tenant_id,name,type,created_by) VALUES('${CA}','${A}','p303-same-name','global','${EA}'),('${CB}','${B}','p303-same-name','global','${EB}')`);
    runSql(`INSERT INTO public.chat_messages(id,tenant_id,sender_id,channel,channel_id,content) VALUES('${MA}','${A}','${EA}','p303-same-name','${CA}','p303 initial A'),('${MB}','${B}','${EB}','p303-same-name','${CB}','p303 initial B')`);
    const upload=await clients['employee.a'].client.storage.from('chat-attachments').upload(key,new Blob(['p303 attachment fixture'],{type:'text/plain'}));
    assert(!upload.error,upload.error?.message);uploaded=true;oldUrl=upload.data.url;
    const strategy=await fetch(`${TB_M1M2.baseUrl}/api/storage/buckets/chat-attachments/objects/${encodeURIComponent(key)}/download-strategy`,{method:'POST',headers:{Authorization:`Bearer ${clients['employee.a'].token}`,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})});
    const strategyBody=await strategy.json();
    log('STORAGE strategy',{status:strategy.status,method:strategyBody.method});signedUrl=strategyBody.method==='presigned'?strategyBody.url:undefined;
    runSql(`UPDATE public.chat_messages SET attachment_url='chat-attachments:${key}',attachment_name='fixture.txt' WHERE id='${MA}'`);
    if(process.argv.includes('--storage-revoke')) {
      // Mint immediately before suspension so expiry cannot masquerade as revocation.
      const res=await fetch(`${TB_M1M2.baseUrl}/api/storage/buckets/chat-attachments/objects/${encodeURIComponent(key)}/download-strategy`,{method:'POST',headers:{Authorization:`Bearer ${clients['employee.a'].token}`,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300})});
      const fresh=await res.json();assert(res.ok);assert.equal(fresh.method,'presigned');
      log('SIGNED_FRESH_BEFORE_SUSPENSION',{method:fresh.method,requestedSeconds:300,status:(await fetch(fresh.url)).status});
      suspended=true;runSql(`UPDATE public.tenant_memberships SET status='suspended' WHERE id='${originalMembership.id}'`);
      const blocked=await clients['employee.a'].client.storage.from('chat-attachments').download(key);
      check('7 suspended new download denied',!!blocked.error,blocked.error?.message);
      log('SIGNED_FRESH_AFTER_SUSPENSION',{status:(await fetch(fresh.url)).status});
      return;
    }
    if(process.argv.includes('--storage-only')) { await storageEvidence('AFTER'); return; }
    const apply=process.argv.includes('--apply');
    if(apply||process.argv.includes('--before-only')) {
      for(const name of Object.keys(clients)) {
        const s=await sock(name,'BEFORE');
        for(const channel of shapes)await sub(s,`BEFORE ${name}`,channel);
      }
      await emit('BEFORE');
      const anon=activeSockets[0];
      anon.emit('realtime:publish',{channel:`notifications:${EA}`,event:'INSERT_notification',payload:{id:NA,tenant_id:A,employee_id:EA,title:'p303 spoof probe'}});
      await delay(1500);
      log('BEFORE Bell meta comparison',{delivered:anon.events.some(e=>e.event==='INSERT_notification'),codeAcceptsPrefixedChannel:false,uiRender:'UNTESTED'});
      await storageEvidence('BEFORE');
      for(const s of activeSockets)s.disconnect();activeSockets.length=0;
      if(process.argv.includes('--before-only'))return;
      log('MIGRATION',cli(['db','migrations','up','20260912189000_m1m2-communication-realtime-storage.sql']));
      // Pinned CLI has no update-bucket command; use the documented management endpoint.
      const linked=JSON.parse(readFileSync('.insforge/project.json','utf8'));
      assert.equal(linked.project_id,TB_M1M2.projectId);assert.equal(linked.oss_host,TB_M1M2.baseUrl);
      const privacy=await fetch(`${TB_M1M2.baseUrl}/api/storage/buckets/chat-attachments`,{method:'PATCH',headers:{Authorization:`Bearer ${linked.api_key}`,'Content-Type':'application/json'},body:JSON.stringify({isPublic:false})});
      log('BUCKET_PRIVACY',{status:privacy.status});assert(privacy.ok,'Bucket privacy update failed');
    }
    const ss={};
    for(const name of Object.keys(clients)) {
      ss[name]=await sock(name,'AFTER');
      for(const channel of shapes) {
        const ack=await sub(ss[name],`AFTER ${name}`,channel);
        const allowed=(name==='employee.a'&&[newChat,newNotice,newList].includes(channel))||(name==='hr-employee.a'&&[newChat,newList].includes(channel));
        check(`subscribe ${name} ${channel}`,ack.ok===allowed,ack);
      }
    }
    check('2 Company B own same-name channel',(await sub(ss['employee.b'],'AFTER employee.b own',`chat:${B}:${CB}`)).ok,true);
    await emit('AFTER');
    for(const name of ['anon','employee.b'])check(`1/2 ${name} receives no A content`,!ss[name].events.some(e=>e.event.endsWith('_message')||e.event.endsWith('_notification')||e.event.endsWith('_channel')),ss[name].events.filter(e=>!e.event.startsWith('presence')));
    check('4 own notification delivery',ss['employee.a'].events.some(e=>e.event==='INSERT_notification'),ss['employee.a'].events.filter(e=>e.event==='INSERT_notification'));
    const events=ss['employee.a'].events.filter(e=>e.event==='UPDATE_message');
    check('4/5 own chat id-only delivery',events.length>0&&events.every(e=>Object.keys(e.args[0]).every(k=>['op','id','channel_id','meta'].includes(k))),events);
    for(const name of ['anon','employee.a','employee.b']) {
      ss[name].emit('realtime:publish',{channel:name==='employee.b'?`chat:${B}:${CB}`:newChat,event:'p303_spoof',payload:{marker:name}});
    }
    await delay(1500);
    for(const name of ['anon','employee.a','employee.b'])check(`publish denied ${name}`,ss[name].events.some(e=>e.event==='realtime:error'),ss[name].events.filter(e=>e.event==='realtime:error'));
    ss['employee.b'].disconnect();ss['employee.b']=await sock('employee.b','RECONNECT');
    for(const channel of [newChat,newNotice,newList])check('2 reconnect denied',!(await sub(ss['employee.b'],'RECONNECT employee.b',channel)).ok,channel);
    await emit('RECONNECT');
    check('2 reconnect receives nothing',!ss['employee.b'].events.some(e=>e.event.endsWith('_message')||e.event.endsWith('_notification')),ss['employee.b'].events);
    await storageEvidence('AFTER');
    suspended=true;runSql(`UPDATE public.tenant_memberships SET status='suspended' WHERE id='${originalMembership.id}'`);
    ss['employee.a'].events.length=0;
    await emit('REVOKED');
    const revokedEvents=ss['employee.a'].events.filter(e=>e.event.endsWith('_message')||e.event.endsWith('_notification'));
    check('6 PLATFORM_LIMIT existing revoked socket',revokedEvents.length===0,revokedEvents);
    const revoked=await sock('employee.a','REVOKED_RECONNECT');
    for(const channel of [newChat,newNotice,newList])check('6 revoked reconnect denied',!(await sub(revoked,'REVOKED_RECONNECT employee.a',channel)).ok,channel);
    const denied=await clients['employee.a'].client.storage.from('chat-attachments').download(key);
    check('7 revoked new download denied',!!denied.error,denied.error?.message);
    if(signedUrl){const replay=await fetch(signedUrl);log('7 previously-issued URL after suspension',{status:replay.status});}
    log('8 GLOBAL_TOPICS',rows("SELECT pattern,enabled FROM realtime.channels WHERE pattern IN ('chat_messages','chat_channels')"));
  } finally {
    for(const s of activeSockets)s.disconnect();
    if(suspended)runSql(`UPDATE public.tenant_memberships SET status='${originalMembership.status}',access_version=${originalMembership.access_version} WHERE id='${originalMembership.id}'`);
    if(uploaded){const result=await clients['employee.a'].client.storage.from('chat-attachments').remove(key);assert(!result.error,result.error?.message);}
    if(setup){
      runSql(`DELETE FROM public.notifications WHERE id='${NA}'`);
      runSql(`DELETE FROM public.chat_messages WHERE id IN ('${MA}','${MB}','${MC}')`);
      runSql(`DELETE FROM public.chat_channels WHERE id IN ('${CA}','${CB}')`);
    }
    await inv('RLS_AFTER');
    assert.deepEqual(rows('SELECT id,tenant_id,name,type FROM public.chat_channels ORDER BY id'),existing);
    log('EXISTING_CHANNELS_PRESERVED',existing.length);
  }
  const schedules=cli(['schedules','list']);
  log('AC8 PARTIAL automation disabled',schedules.map(s=>({name:s.name,isActive:s.isActive})).filter(s=>s.name==='auto-birthday-posts'));
}

// Lead-authorized existing-data test. Never logs or persists password hashes.
async function existingData() {
  log('EXISTING_TARGET',verifyTarget());
  const tenant='111035ce-979c-429a-a482-ddfa87dbfe6e';
  const own='d72cc7cc-6ab1-449d-a1dd-d64fc3e70c29';
  const otherTenant='97da3641-d69e-4e7a-bdc9-760675be8d28';
  const other='237cef7f-4fce-4c43-8a6a-c0b52e872f98';
  const employee='91eaf0ab-8ef7-4d07-80af-7d94ab88e05c';
  const q=value=>`'${String(value).replaceAll("'","''")}'`;
  const users=rows(`SELECT u.id,u.email,u.password FROM auth.users u JOIN public.employees e ON e.user_id=u.id WHERE e.id='${employee}' AND e.tenant_id='${tenant}'`);
  assert.equal(users.length,1,'Expected only the authorized existing user');
  const original=users[0];
  const password=readFileSync('tests/m1m2/persona-password.local','utf8').trim();
  const r=spawnSync(process.execPath,['node_modules/@insforge/cli/dist/index.js','secrets','get','ANON_KEY','--json'],{encoding:'utf8'});
  assert.equal(r.status,0,'Anon key unavailable');
  const anonKey=JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))).value;
  const sockets=[];
  let changed=false;
  try {
    changed=true;
    runSql(`UPDATE auth.users SET password=crypt(${q(password)},gen_salt('bf',10)) WHERE id=${q(original.id)}::uuid`);
    const v=createClient({baseUrl:TB_M1M2.baseUrl,anonKey});
    const login=await v.auth.signInWithPassword({email:original.email,password});
    if(login.error){log('UNTESTED existing login',{reason:login.error.message});return;}
    const context=await v.database.rpc('get_auth_tenant_id');
    log('EXISTING_SESSION_TENANT',{tenant:context.data,error:context.error?.message});
    if(context.error||context.data!==tenant){log('UNTESTED existing tenant resolution','Session did not resolve required tenant');return;}
    const b=createClient({baseUrl:TB_M1M2.baseUrl,anonKey});
    const bLogin=await b.auth.signInWithPassword({email:'employee.b@m1m2.test',password});
    assert(!bLogin.error,'Company B login failed');
    const tokens={Vishal:login.data.accessToken,'employee.b':bLogin.data.accessToken,anon:anonKey};
    const ownTopic=`chat:${tenant}:${own}`,otherTopic=`chat:${otherTenant}:${other}`;
    const connect=async(name,phase)=>{
      const s=io(TB_M1M2.baseUrl,{transports:['websocket'],auth:{token:tokens[name]},reconnection:false,timeout:15000});
      sockets.push(s);s.events=[];
      s.onAny((event,...args)=>{s.events.push({event,args});log(`RAW EXISTING ${phase} ${name} ${event}`,args);});
      await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});
      for(const topic of [ownTopic,otherTopic]) {
        const ack=await s.timeout(10000).emitWithAck('realtime:subscribe',{channel:topic});
        log(`ACK EXISTING ${phase} ${name} ${topic}`,ack);
        assert.equal(ack.ok,name==='Vishal'&&topic===ownTopic);
      }
      return s;
    };
    for(const phase of ['INITIAL','RECONNECT']) {
      const current={};
      for(const name of Object.keys(tokens))current[name]=await connect(name,phase);
      runSql(`SELECT realtime.publish('${ownTopic}','p303_existing',jsonb_build_object('id','${own}','channel_id','${own}','op','UPDATE'))`);
      runSql(`SELECT realtime.publish('${otherTopic}','p303_existing',jsonb_build_object('id','${other}','channel_id','${other}','op','UPDATE'))`);
      await delay(2500);
      for(const [name,s] of Object.entries(current)) {
        const events=s.events.filter(e=>e.event==='p303_existing');
        assert.equal(events.length,name==='Vishal'?1:0,`${phase} ${name} unexpected delivery`);
        if(name==='Vishal')assert.equal(events[0].args[0].channel_id,own);
        log(`PASS EXISTING ${phase} ${name}`,events);
        s.disconnect();
      }
    }
  } finally {
    for(const s of sockets)s.disconnect();
    if(changed) {
      runSql(`UPDATE auth.users SET password=${q(original.password)} WHERE id=${q(original.id)}::uuid`);
      const equality=rows(`SELECT password=${q(original.password)} AS restored FROM auth.users WHERE id=${q(original.id)}::uuid`);
      log('PASSWORD_HASH_RESTORED',equality);
      assert.equal(equality[0]?.restored,true,'Original password hash was not restored');
    }
  }
}
