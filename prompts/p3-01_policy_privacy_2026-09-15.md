# P3-01 — Policy Center privacy, versioning and supported settings

Repo `C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`, branch
`p1-00-harness-reconciliation`, base **`3161ad1`**.

Read first:
- `doc/execution/non-payroll-monday/contracts.md` v0.5 — §3, §4, §12
- `doc/execution/non-payroll-monday/tasks.md` v0.5 — P3-01 and the v0.5 preamble
- `doc/execution/non-payroll-monday/reviews/package-review-P2-02.md` §1 — the write-denial pattern you should copy

---

## 1. AC3 cannot pass today, and I proved it rather than inferred it

Your AC3: *"Anonymous, wrong-tenant and non-member GETs fail."*

The `hr-policies` bucket is **public**. Measured on the branch just now, with **no token, no API key,
no tenant** — a plain anonymous `curl`:

```
GET /api/storage/buckets/hr-policies/objects/policies/0rqth50dywe-1779453401832.pdf
→ 302, follow → HTTP 200, 222,253 bytes, binary/octet-stream
```

An HR policy document downloads to anyone on the internet who has the URL. RLS on `storage.objects`
is irrelevant for reads on a public bucket — the object serves straight over HTTPS.

**This is the package.** Everything else in P3-01 is secondary to closing it.

### It is not a flag flip — it is three changes

1. **The bucket goes private.** One setting, and the easy part.
2. **`storage.objects` policies** must then scope reads by tenant and audience. Note this surface has
   **never been under migration control** — 18 live storage policies exist in no migration (the
   deferred P1-00 criterion 5). You are writing into an area with existing untracked policies.
   Do not assume the existing ones are correct or intentional; name what you rely on.
3. **The read path must change, and the app has never done this.** `getSignedUrl` appears
   **nowhere in `src/`**. `PolicyUpload.tsx:124` stores a *public* URL into `hr_policies.file_url`:

   ```ts
   const publicUrl = uploadData?.url ?? "";
   ...
   file_url: publicUrl,
   ```

   So every existing `file_url` row is a public URL that **dies the moment the bucket goes private**.
   You need a read path that mints a short-lived signed URL at view time, and a plan for the rows
   already stored — migrate the column to a storage key, or resolve keys from the stored URL. Decide,
   state it, and make it idempotent.

**Do not leave the bucket public and satisfy AC3 with a UI change.** Hiding the link is not access
control; the object stays fetchable. If you conclude the bucket cannot go private in this package,
**stop and report** rather than reporting AC3 as passed.

---

## 2. AC3's harder half — post-revocation

The criterion also asks for *"post-revocation signed/private URL behavior documented and tested."*

A signed URL is a bearer token with a lifetime. Revoking a user's membership **does not** invalidate
a signed URL already issued to them — it stays valid until it expires. That is a property of the
mechanism, not a bug, and the contract asks you to **document and test** it rather than pretend
otherwise.

So: choose a short expiry, state it, and test what actually happens when a revoked user replays a
still-valid URL. If the honest answer is "it works until expiry," that is the documented behaviour —
say so. P1-02 hit the same class of problem and labelled storage revocation `incomplete` in
`list_tenant_access()`; if you close it here, update that surface, and if you cannot, leave it.

---

## 3. AC4 — do not let this one pass vacuously

*"Acknowledgement is idempotent and never presented as rule enforcement."*

Acknowledgement records that a person clicked a button. It is not enforcement of anything. This repo
already has settings that are configurable and read by no enforcement path — `probation_restricted`
and `requires_document` are two, confirmed inert during P2-04.

So test idempotency for real (double-acknowledge changes nothing), and check the UI does not imply a
policy is *enforced* because it was acknowledged. If a control implies enforcement that does not
exist, that is a finding to report, not a string to reword.

---

## 4. AC6 — reuse what exists, do not rebuild it

P1-01 already built the unavailable/retry machinery: `TenantContext` exposes `moduleStatus`
(`"available" | "unavailable"`) and `unavailableReason`, `hasModule` returns **false** on unknown
state (the fail-open was removed), and `RequireModule` renders a retry panel for unknown while
keeping the silent redirect for genuinely disabled.

Wire the Policy Center consumers to that. **Do not invent a second entitlement-failure path.**

---

## 5. Constraints

- Target `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`) only. **Never write to
  `0431f0f6-225f-4fb1-86b7-3fd32684c7f4`, and change no bucket on it.**
  `npm run test:m1m2:target` before any write.
- Migration `migrations/20260912187000_m1m2-policy-privacy-versioning.sql`. Hyphens. Applied
  migrations are immutable.
- **Copy P2-02/P2-04's write pattern** where you touch policy write paths: reads policy-scoped,
  writes revoked at **both** the GRANT and policy level, mutations through definer RPCs with an
  explicit column allowlist. RLS cannot scope columns.
- A tenant fence must be **RESTRICTIVE**. PERMISSIVE is a grant; it ORs with the others.
- Every `SECURITY DEFINER` function: own tenant fence, pinned `search_path`, no `anon` EXECUTE.
  RLS does not backstop a definer function.
- **`CREATE OR REPLACE` with an appended DEFAULT parameter creates a second overload** rather than
  replacing. Replace on the exact signature, then assert `pg_proc` holds one row per name.
- Use `tenant_business_date` for any date boundary (effective dates, version cutovers). Do not
  re-derive with `AT TIME ZONE` or `CURRENT_DATE`.
- Use P1-02's membership scopes and P1-03's rule that only an effective `primary` relationship grants
  direct-report scope.

**Allowed files:** the `tasks.md` P3-01 list. If you need a fixture — a policy document, an
acknowledgement row — **report it** and it will be authorized, as it was for P1-02 and P2-04. Do not
edit a shared fixture unannounced.

RLS invariant **1 / 2 / 0** (Company A `employees`). Report it before fixtures and after teardown.

---

## 6. Report back

Exact commit, files changed, **per criterion PASS / FAIL / UNTESTED**. A criterion you reasoned about
but did not execute is UNTESTED. A criterion that passed because the thing it tests is inert is **not
a pass** — say which it was. Every package so far has been accepted partly because it labelled gaps
honestly; that is the standard here.

Evidence, not assertion, for:
- **the same anonymous `curl` I ran above, re-run after your change, showing it now fails** — this is
  the single most important line in your report
- a wrong-tenant and a non-member authenticated GET, both denied
- post-revocation signed-URL behaviour, whatever it turns out to be
- the migration path for existing `file_url` rows, and that it is idempotent
- double-acknowledgement changing nothing
- `pg_proc` overload counts; RLS 1/2/0 both times; policy drift (**50 untracked is the deferred
  baseline** — report the real `check-policy-drift` number, not a `git status` count); `npm run build`

If closing AC3 requires work beyond your allowed files — a change to how every policy URL is stored,
say — **stop and report**. That is a scoping decision, not something to solve by widening your own
file list.
