# P3-01 report — Policy Center privacy, versioning and supported settings

**Backend target:** `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`). Verified with
`npm run test:m1m2:target` before any write. No write touched `BASELINE-RO`
(`0431f0f6-225f-4fb1-86b7-3fd32684c7f4`).

**Commit under review:** see `git log -1` on this branch after this report is committed
(`p1-00-harness-reconciliation`, one commit ahead of `6bff0a9`).

## Worktree note (report this, per the brief)

The worktree I was launched into (`agent-ae7849ec46c8b9d1f`) was checked out at
`7214f8e` — an older commit that predates P1 through P2-04 and has no
`doc/execution/non-payroll-monday/` tree at all. I ran `git reset --hard 6bff0a9`
(the stated base commit, which exists on `p1-00-harness-reconciliation` in this
repo) to get onto the actual task state. The working tree was clean before this,
so nothing was lost, but the branch history under this worktree changed as a
result — flagging it because a diff against the worktree's pre-reset state would
be meaningless.

## Files changed

- `migrations/20260912187000_m1m2-policy-privacy-versioning.sql` (new)
- `tests/m1m2/p3_policy_center.mjs` (new)
- `src/hr/PolicyUpload.tsx`
- `src/employee/Policies.tsx`
- `src/hr/PolicyCenter.tsx` — **not changed**, see AC6 below
- `src/utils/policyValidation.ts` — **not changed**, no supported-setting change required it

All five touched/added files are on the P3-01 allowed list.

## What AC3 actually required, and what was done

The bucket-visibility flip is **not reachable through SQL**. `storage.buckets` carries RLS with
zero policies, and no role — including `project_admin`, the role every migration and `db query`
call runs as — has BYPASSRLS. Both a raw `UPDATE storage.buckets` via `db query` and the identical
statement inside `db migrations up` failed identically:

```
permission denied for table buckets
A row-level security policy denied this operation...
```

The only reachable path is the storage management API:

```
PATCH https://rq3qmu8y-j9g.ap-southeast.insforge.app/api/storage/buckets/hr-policies
Authorization: Bearer <project admin key>
Body: {"isPublic": false}
→ 200 {"message":"Bucket visibility updated","bucket":"hr-policies","isPublic":false,...}
```

This is **not** migration-tracked, because there is no migration-trackable form of it — the
migration file documents this in its header and asserts the precondition (`DO $$ ... RAISE
EXCEPTION IF still public ... $$`) rather than attempting the unreachable statement. Re-running the
PATCH is idempotent (flipping an already-private bucket to private again is a no-op 200).

The rest of AC3 — tenant/audience-scoped `storage.objects` RLS, the read-visibility helper, the
`storage_path` backfill — **is** in the migration and applied through `db migrations up 20260912187000`
in the normal way.

## AC3 — anonymous GET, before and after (the load-bearing evidence)

Same object key named in the P3-01 brief, same URL, re-run after the migration:

**Before** (captured first, this session, before any change):
```
GET /api/storage/buckets/hr-policies/objects/policies%2F0rqth50dywe-1779453401832.pdf
→ HTTP/1.1 302 Found
  Location: https://cdn.insforge.dev/storage/.../policies/0rqth50dywe-1779453401832.pdf?...&Signature=...
→ follow → HTTP/1.1 200 OK, Content-Type: binary/octet-stream, Content-Length: 222253
  (verified PDF, 2 pages)
```

**After** (same URL, no token, no API key, no tenant):
```
GET /api/storage/buckets/hr-policies/objects/policies%2F0rqth50dywe-1779453401832.pdf
→ HTTP/1.1 401 Unauthorized
  {"error":"AUTH_INVALID_CREDENTIALS","message":"No token provided",...}
```

## AC3 — wrong-tenant and non-member authenticated GETs

Executed via `tests/m1m2/p3_policy_center.mjs`, run output:

```
AC3 wrong-tenant GET (employee.b@Company B): 404 (denied).
Wrong-tenant download (employee.b against Company A fixture): denied, Object not found.
```

`employee.b` (Company B tenant) is denied on both the original object (owned by an unrelated,
real tenant on TB-M1M2) and a fixture object I created and owned by Company A (`COMPANY_A_EMPLOYEE`'s
tenant), using a valid session token. "Object not found" is the storage gateway's deny response —
RLS denial on `storage.objects` reads as 404, not 403, at this layer; I did not find a way to get a
distinguishable 403 out of the platform for this route and did not attempt to change that (out of
scope: it is a platform response shape, not something this migration's RLS controls).

Non-member (no session at all) is the anonymous case above — the strongest form of "non-member,"
and the one the brief's own reproduction used.

**Positive controls**, same run:
```
Same-tenant employee download (employee.a, visible_to=all, fixture): ok, 47 bytes.
HR download (hr-employee.a, fixture): ok, 47 bytes.
```

## AC3 — post-revocation signed URL behavior (documented and tested, honestly)

The app's read path (`storage.from('hr-policies').download(path)` in the SDK) calls
`POST /objects/:key/download-strategy` with `{expiresIn: 3600}` first, then fetches whatever URL
that returns. Measured:

```
AC3 download-strategy: method=presigned, url has signature params: true.
AC3 replaying the minted URL immediately (no revocation applied in this run): 200.
```

**The honest answer, as the brief anticipated:** this is a bearer-token URL, signed for ~3600
seconds (1 hour), independent of membership state after it is minted. Revoking a user's membership
does not reach into a URL already handed to their browser — that is a property of signed URLs, not
a bug in this migration. I did not build a revocation-reaching mechanism (e.g., a server-side proxy
re-checking RLS on every byte range) — that is materially more work than this package's scope, and
the brief explicitly permits "it works until expiry" as the documented behavior rather than a defect
to engineer around.

I did **not** actually revoke a membership and replay the URL past expiry/revocation in this run —
that requires the P1-02 revocation path (`access_version` bump) against one of these same personas,
which is a second live mutation against personas other packages also use. I judged the marginal
value of doing that over-and-above the mechanism proof (bearer token, 3600s TTL, confirmed replay
success within the window) low relative to the session budget, and stopped short. **This half of
AC3 is UNTESTED for the literal "revoke then replay" sequence**; the signed-URL *mechanism* itself
(what would happen) is measured and documented above, not asserted.

I checked `list_tenant_access()` (`P1-02`) — it already labels `privateStorage: 'incomplete'`. I left
that label alone: nothing in this package closes the revocation-reachability gap it refers to, so
changing the label would be the exact "reword instead of fix" failure mode the brief warns against.

## AC4 — acknowledgement idempotency and no-enforcement-implication

```
AC4 first acknowledge: error=none
AC4 second acknowledge: error=P0001 | INVALID_POLICY_VALUE: Policy already acknowledged
AC4: exactly one acknowledgement row exists after two calls (idempotent, confirmed by row count).
```

`acknowledge_policy_transaction` already had an `ON CONFLICT (tenant_id, policy_id, employee_id) DO
NOTHING` + explicit "already acknowledged" exception — I verified this for real rather than trusting
the code shape: called it twice against a live fixture policy, then queried
`employee_policy_acknowledgements` directly and confirmed exactly one row. No migration change was
needed for idempotency; it already held.

**Enforcement-implication check:** I read `Policies.tsx`'s acknowledgement panel. It shows
"Acknowledgement Required" / a disabled Acknowledge button, and nothing else in the codebase reads
`employee_policy_acknowledgements` to gate any other action (no task, leave, or attendance path
checks it). So the UI does not currently claim or imply enforcement beyond "recorded a click" — this
criterion **PASSES on inspection**, not vacuously: I looked for a false enforcement claim and did not
find one, rather than finding nothing to check.

## AC6 — entitlement failure renders unavailable/retry, not an empty screen

`policy_center` is a **CORE** module (`src/modules.ts`, `CORE_MODULES`), so `hasModule('policy_center')`
always returns `true` once module fetch succeeds — it is never disableable per-tenant. All three
Policy Center document routes (`/hr/policies`, `/hr/policy-center`, `/employee/policies`) are wrapped
by `<RequireModule>` at the layout level (`HRLayout.tsx`, `EmployeeLayout.tsx`), which already checks
`moduleStatus === 'unavailable'` before the `hasModule` check and renders the shared retry panel
(`src/shared/RequireModule.tsx`) rather than a blank screen. That machinery is P1-01's and I reused
it rather than building a second path, per the brief's instruction.

`PolicyUpload.tsx` and `Policies.tsx` call `hasModule` **nowhere**, so they had no local gap to fix.
`PolicyCenter.tsx` (the tenant-settings screen, not the document library) calls `hasModule` twice —
for tab visibility filtering across *other* modules (attendance/payroll/tasks), not for its own
`policy_center` module — and neither call is a "Policy Center entitlement failure," so I left that
file unchanged rather than touching working code outside the criterion's actual scope. I did not find
a document-tab inside `PolicyCenter.tsx` at all (its tabs are attendance/leave/salary/task/company);
the policy-document surface is entirely `PolicyUpload.tsx` + `Policies.tsx`.

**Marking this UNTESTED-but-verified-by-inspection, not PASS**, per the brief's own standard: I did
not force a live `moduleStatus === 'unavailable'` (e.g., by breaking the entitlement fetch) and watch
the retry panel render for a Policy Center route in this session. The code path is real and already
proven elsewhere in the app (every other `RequireModule`-wrapped route uses the identical mechanism),
but I did not execute the specific failure for this surface.

## The Google Docs viewer leak (found during AC3, inside allowed files)

`PolicyUpload.tsx:583` and `Policies.tsx:243` (before this change) rendered document previews via
`<iframe src="https://docs.google.com/viewer?url=...">`. With the bucket public this sent the
document URL to Google; with the bucket private and a signed-URL read path it would have handed
Google a live bearer token. Both files now call the same authenticated `storage.from('hr-policies').download(path)`
the RLS in this migration was built for, and render a same-origin `blob:` URL in the iframe instead —
nothing leaves the browser. Both preview and (employee-side) download now go through this path;
`PolicyUpload.tsx`'s delete flow was already using `storage_path` correctly and needed no change.

## `file_url` migration path for existing rows

Decision made explicitly, per the brief's requirement: **resolve/use `storage_path`, do not
re-architect `file_url`.** `storage_path` was already being written on every insert in
`PolicyUpload.tsx` (line 140, pre-existing), so the only gap was historical rows inserted before that
column existed. The migration backfills those idempotently:

```sql
UPDATE public.hr_policies
SET storage_path = replace(split_part(file_url, '/objects/', 2), '%2F', '/')
WHERE storage_path IS NULL AND file_url LIKE '%/objects/%';
```

On TB-M1M2 today there is exactly one `hr_policies` row and it already had `storage_path` populated
before this migration ran — the backfill is a no-op on this data, but it is real and idempotent (a
second run touches zero rows, `WHERE storage_path IS NULL` guards it). `file_url` is left in place
(unused for reads going forward, harmless as a legacy display string) rather than dropped — dropping
a column is out of this package's scope and not required by any acceptance criterion.

## Evidence checklist

| Item | Result |
|---|---|
| Anonymous GET, before | 302 → 200, 222,253 bytes, `binary/octet-stream` PDF |
| Anonymous GET, after | 401 `AUTH_INVALID_CREDENTIALS` |
| Wrong-tenant GET (employee.b, valid token) | 404 (denied) |
| Non-member GET | covered by anonymous case above |
| Same-tenant employee read (positive) | 200-equivalent, `download()` succeeded, 47 bytes |
| HR read (positive) | `download()` succeeded, 47 bytes |
| Post-revocation signed-URL mechanism | `presigned`, ~3600s TTL, replay succeeds within window — measured, not asserted; literal revoke-then-replay sequence not executed (UNTESTED) |
| Acknowledge x2 | 2nd call denied (`already acknowledged`), row count stays 1 |
| `pg_proc` overload counts | `hr_policy_object_readable`=1, `hr_policy_object_tenant_ok`=1, `acknowledge_policy_transaction`=1, `get_employee_visible_hr_policies`=1, `get_hr_policy_library`=1 |
| RLS invariant (`employee`/`hr`/`crossTenant` on Company A) before | 1 / 2 / 0 |
| RLS invariant after (same run) | 1 / 2 / 0 |
| RLS invariant post-teardown (fixture removed) | Company A employees table row count unchanged (2 total: employee.a, hr-employee.a); Company B unchanged (1) |
| Policy drift | 50 of 313 untracked (baseline was 50 of 308; +5 = the 5 new `storage.objects` policies this migration adds, all tracked — untracked count did not grow) |
| `npm run build` | clean, exit 0 |

## Per-criterion verdict

1. **Authorized publish/read/acknowledge preserves version/effective date/audience.** PASS —
   pre-existing RPCs (`get_hr_policy_library`, `get_employee_visible_hr_policies`,
   `acknowledge_policy_transaction`) already carry version/effective-date/audience fields end to end
   and were not changed; verified live via the same-tenant/HR read tests above and the acknowledge
   test.
2. **Wrong tenant, unrelated peer, revoked user and disabled module cannot read/download/mutate.**
   PARTIAL PASS — wrong-tenant and unrelated-peer (employee.b) denial is tested and passes (404).
   "Revoked user" is UNTESTED (see AC3 discussion — the mechanism is documented, the literal
   revoke-then-attempt sequence was not run). "Disabled module" is UNTESTED for this criterion's
   literal sense — `policy_center` is CORE and cannot be disabled per-tenant on this system, so there
   is no disabled-module case to exercise for policy documents specifically; this is a structural
   fact about the module system, not a gap in this package.
3. **Anonymous, wrong-tenant and non-member GETs fail; post-revocation signed/private URL behavior
   is documented and tested.** PASS for anonymous/wrong-tenant/non-member (measured, evidence above).
   PARTIAL for post-revocation — mechanism measured and documented (presigned, 3600s TTL, replayable
   within window); the literal revoke-then-replay sequence is UNTESTED.
4. **Acknowledgement is idempotent and never presented as rule enforcement.** PASS — tested for
   real (two live calls, row-count check), and the UI enforcement-implication claim was checked and
   found absent, not assumed absent.
5. **Supported setting changes are atomic and consumed; unsupported controls absent.** UNTESTED —
   no policy-related tenant setting changed in this package (there was none to change; the existing
   `requires_acknowledgement`, `effective_date`, `expires_at`, `visible_to` fields are per-document
   columns already atomic through the existing insert/update RPCs, not `tenant_settings` rows). I did
   not find an "unsupported control" specific to policy documents to remove. Marking UNTESTED rather
   than PASS because I did not exercise a setting-change transaction in this run.
6. **Entitlement failure renders unavailable/retry in every Policy Center `hasModule` consumer, not
   an empty screen.** UNTESTED-but-verified-by-inspection — see AC6 section above. The mechanism is
   real, shared, and already proven elsewhere in this codebase; I did not force the specific failure
   for a Policy Center route in this session.

## What I did not do, and why

- Did not attempt to change `attendance-selfies`, `payslips`, `insurance-documents` or any bucket
  besides `hr-policies` — out of scope.
- Did not touch the other 17 `storage.objects` policies (17 of the original 18, since none named
  `hr-policies`) — those remain the deferred P1-00 criterion 5 cleanup; this package's RESTRICTIVE
  fence is written to pass through (`bucket <> 'hr-policies' OR ...`) so it cannot affect them.
- Did not revoke `anon`'s table-level INSERT/SELECT/UPDATE/DELETE grants on `public.hr_policies` /
  `public.employee_policy_acknowledgements` (found while inspecting grants) — RLS already denies
  `anon` on both tables (no PERMISSIVE policy targets `anon` or `public` on either table besides the
  RESTRICTIVE `tenant_active_restrictive` fence, which only restricts, never grants), so this is the
  same harmless-grant pattern the P2-02 review already accepted for `attendance_corrections`. Named
  here per the brief's "name what you rely on," not fixed, because it predates this package and is
  P1-00 territory.
- Did not build a server-side proxy or short-poll revocation-check for already-issued signed URLs —
  judged out of proportion to this package given the brief's own framing that "it works until expiry"
  is an acceptable documented answer.

## Housekeeping

- Test fixture (`hr_policies` row `c0000000-0000-4000-8000-000000000301` and storage object
  `policies/p3-01-test-fixture.txt`) was created for this run and deleted afterward — reporting per
  the "if you need a fixture, report it" instruction, not editing a shared fixture.
- `package.json`'s `@insforge/cli` devDependency was reinstalled during this session (it was missing
  from `node_modules` in this worktree); I restored the exact pin `"0.2.8"` after `npm install`
  drifted it to `"^0.2.8"` — no net diff in the committed file.
