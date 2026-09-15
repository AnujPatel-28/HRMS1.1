# P6 PACKAGE REVIEW — P3-01

Reviewer: Opus 5, PACKAGE mode (independent of the implementer)
Date: 2026-09-15 IST
Under review: commit `e34baab`, base `6bff0a9`, merged fast-forward into `p1-00-harness-reconciliation`
Target: `TB-M1M2` (`fb9a8659-9950-4637-a58e-4a882ef24419`). No parent writes, no parent bucket change.

**VERDICT: ACCEPT.** AC3 closed and verified with the same request that proved it broken. One
reproducibility gap recorded — it is inherent to the platform, not a package defect.

---

## 1. The headline, verified with the identical request

Before (recorded in the brief): anonymous `curl`, no token, no API key, no tenant →
**HTTP 200, 222,253 bytes** of an HR policy PDF.

After, same object, same request:

```
GET .../hr-policies/objects/policies/0rqth50dywe-1779453401832.pdf
→ HTTP 401, 153 bytes
```

`hr-policies` is now `public: false`. That is AC3's core, closed.

---

## 2. Verified independently

| Check | Result |
|---|---|
| Scope | ✅ five files, all allowed (plus its own report doc) |
| Bucket private | ✅ `hr-policies public: false` |
| Anonymous GET | ✅ **401** (was 200) |
| `storage.objects` policies | ✅ 5 created, incl. **RESTRICTIVE** `hr_policies_bucket_tenant_isolation` |
| Policy drift **after merge** | ✅ **50 of 313** — deferred baseline unchanged, all 5 new policies tracked |
| RLS invariant | ✅ **1 / 2 / 0** |
| `npm run build` | ✅ clean |
| Main branch integrity after the agent's `git reset --hard` | ✅ contained to its worktree; `p1-00-harness-reconciliation` was untouched at `6bff0a9` |

**Two false alarms of my own, checked before reporting.** I first measured drift at 55 and found
`docs.google.com` still present — both were artifacts of grepping *my* checkout, which did not yet
contain the agent's migration or edits. Against `e34baab`: the migration creates all 5 policies, and
the two `docs.google.com` hits are **comments explaining the removal**; the iframe now renders a
same-origin `blob:` URL from an authenticated `storage.download()`. The implementer's claim is true.

---

## 3. Reproducibility gap — record it, do not blame the package

**The bucket privacy flag is not in the migration, and cannot be.** `storage.buckets` RLS blocks the
change even for `project_admin`, so SQL cannot set it. The implementer closed it through the storage
management API (`PATCH isPublic:false`) and documented that in the migration header, which is the
right mitigation available.

**Consequence:** a migration-only rebuild of this backend would come up with `hr-policies` **public
again**. This joins the existing reproducibility debt (`reconciliation.md` §8 / `contracts.md` §14.2)
— the schema was never fully reconstructible from `migrations/`, and now there is a security-relevant
bucket setting in the same category. Whatever snapshot mechanism closes §14.2 must capture bucket
configuration too.

---

## 4. Bonus fix, in scope and worth naming

Both policy preview components embedded the document in a `docs.google.com/viewer` iframe. Once the
bucket went private that would have handed a **live bearer-token URL to Google** on every preview.
Switched to an authenticated `storage.download()` into a same-origin blob. Found while doing the
package rather than asked for, inside allowed files, and it would have been a real leak introduced
*by* the privacy change.

---

## 5. Honest UNTESTED items, accepted as stated

- **Revoke-then-replay of a signed URL not executed.** The mechanism is measured — presigned,
  ~3600 s TTL, replayable until expiry — but the live revoke sequence was not run. This is the
  behaviour the contract asks to be *documented and tested*; half of that is done. Storage revocation
  remains `incomplete` in `list_tenant_access()`, correctly.
- **AC6 by code inspection only** — reuses P1-01's `RequireModule`, but no live entitlement failure
  was forced. Same gap P1-01's own AC2 carries.
- **AC5 untested by design** — no policy-related setting was touched.
- **AC2's disabled-module half structurally moot** — `policy_center` is core and cannot be disabled
  per tenant.

None is glossed. This is the reporting standard the earlier packages set.

---

## 6. Still open, outside this package

`employee-documents` and `expense-receipts` remain **public buckets holding personal data** —
confirmed by the same bucket listing. Not P3-01's scope and untested here, but almost certainly the
same exposure that `hr-policies` had. **Unowned; needs its own small package.**

---

## 7. Status

P3-01 accepted. Next in the ordering is **P3-02** (`20260912188000`, projects, membership and task
lifecycle), then **P3-03** (realtime and storage), which is the last security-critical package.
