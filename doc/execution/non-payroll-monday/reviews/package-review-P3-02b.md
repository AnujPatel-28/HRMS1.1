# Package review — P3-02b advertise project and channel scopes

Reviewer: Opus 5 (lead), 2026-09-21. **Verdict: ACCEPTED** at `ee0cefc` (Sonnet 5).
Migration `20260912191000`; no forward fix needed.

## ⚠️ Production deploy order

**Deploy the frontend first, then apply `20260912191000`.** The new capability summary emits
project/channel grants; the *old* `AuthContext.tsx` rejects any summary containing one, so the
reverse order drops every user's capabilities at once — the same class as the punch-in
deploy-skew incident. The new `AuthContext.tsx` accepts both shapes, so frontend-first is safe.

## 1. Independently verified

| Check | Result |
|---|---|
| `has_access_action` diff vs its previous body (`181000`) | **exactly one appended OR branch**, active only for `project`/`channel` with a non-null id; every existing call path byte-identical |
| `access_scope_allows` | delegates to the untouched `p3_project_scope` / `p3_channel_scope`; adds only `task.submit@project` and `channel.read`/`message.send@channel` for explicit members |
| `AuthContext.tsx` / `Chat.tsx` diff | rejection removed, `scopeId` validation kept, `hasGrant(…, scopeId?)` narrows only when given; Chat management keys on `channel.manage@company`, moderation on `message.moderate@channel` |
| `p3_scope_advertising.mjs` | exit 0 — summary/server agreement both directions, PM/member/HR/moderator/Company-Admin cases, revocation freshness |
| P1 suites (after lead test repairs, §2) | `p1_capability_contract`, `p1_membership_invitation_revocation`, `p1_organization_transfer`, `p1_owner_lifecycle` — all exit 0 |
| P3 suites | `p3_projects_tasks`, `p3_chat_connect` exit 0; `p3_private_buckets` exit 0 on re-run (first run hit a CDN `UND_ERR_CONNECT_TIMEOUT`, not an assertion; buckets verified private after); `p3_realtime_isolation` only the accepted item 6 |
| Build / drift | clean / 44 of 325 (unchanged) |

## 2. The P1 suites had been silently broken since P2/P3 — repaired by the lead

Sonnet reported three P1 failures as "pre-existing, unrelated". Checked rather than accepted:
none was caused by P3-02b, but two of them **aborted before P1's revocation checks ran**, so that
coverage had been dark since P3-03 — a lead miss (P1 suites were not re-run at P3-03 acceptance).

| Suite | Cause | Fix |
|---|---|---|
| `p1_membership_invitation_revocation` | hard-coded template matrix predates §16 A1 grants (189200); then a stale error regex | matrix + regex updated |
| `p1_organization_transfer` | `is_manager_of` consumer list predates P2-02 and P3-02 consumers | list updated; a new consumer still fails |
| `p1_owner_lifecycle` | **fixture damage**: `company-admin.a` had no `tenant_memberships` row (an earlier aborted P1 run); then a stale regex | `npm run test:m1m2:personas` restored it; regex updated |

The stale regexes: P2-04 answers a cross-tenant leave with `P1003 APPROVAL_SUBJECT_UNAVAILABLE`
instead of revealing the row. Verified the fixture leave is in tenant `da7a0000`, so both are
genuine cross-tenant denials. **Rule going forward: every acceptance re-runs every suite in
`tests/m1m2/`, not only the package's own and its neighbours.**

## 3. Residuals

- `EmployeeProjectView.tsx` has no manage controls to gate (would be a new feature); `ProjectList`
  "New Project" cannot be gated by a project-scoped grant (no project yet) — server denies non-PMs.
- `p1_membership_invitation_revocation` prints "private storage and realtime remain
  disabled/incomplete" — text is stale since P3-03/P3-04 enforced both.
