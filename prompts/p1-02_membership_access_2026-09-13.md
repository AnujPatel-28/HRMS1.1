# P1-02 — Membership, templates, invitation, revocation, audit and ownership

You are implementing **P1-02**. Repo `C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`,
branch `p1-00-harness-reconciliation`, base commit **`59c2256`**.

Read first:
- `doc/execution/non-payroll-monday/contracts.md` v0.5 — §2, §4, §5, §8, §13, §14
- `doc/execution/non-payroll-monday/tasks.md` v0.5 — the P1-02 section (AC1–AC14) and the v0.5 preamble
- `migrations/20260912180000_m1m2-access-capability-contract.sql` — P1-01's frozen seam. **You
  implement it. You do not redefine it.**
- `src/types/access.ts` — the frozen wire shape

This is the largest package in M1 and the one with the most ways to be quietly wrong. **A partial
package with honest failures beats a complete one with an unverified claim.** P1-01 was accepted
partly because it reported two criteria as UNTESTED rather than inferring them from static reading.

---

## 1. Backend and personas

Target `TB-M1M2` — `fb9a8659-9950-4637-a58e-4a882ef24419`,
`https://rq3qmu8y-j9g.ap-southeast.insforge.app`. **Never write to
`0431f0f6-225f-4fb1-86b7-3fd32684c7f4` (the production parent).**

```
npm run test:m1m2:harness     # guard self-test
npm run test:m1m2:target      # confirms the link
npm run test:m1m2:personas    # idempotent
```

Password in `tests/m1m2/persona-password.local` (git-ignored). Existing personas:
`employee.a@m1m2.test` (employee), `hr-employee.a@m1m2.test` (employee + `hr_admin`),
`employee.b@m1m2.test` (Company B). Verified invariant — reading `employees` scoped to Company A
returns **1 / 2 / 0**. Re-run after your migration; a change means you moved RLS.

**You must create the non-employee personas** this package needs (AC1, AC13, AC14) — an Owner and a
Company Admin with no employee row. Add them to `tests/m1m2/fixtures/personas.mjs`, which is added to
your allowed files for this purpose.

---

## 2. Three defects that are the substance of this package

These are not hypothetical. I measured all three on the live branch today.

### 2.1 The audit log is forgeable by any authenticated user

`audit_logs` has one INSERT policy, `"Users can insert audit logs"`, PERMISSIVE, for `authenticated`:

```
qual:       null
with_check: ((tenant_id = get_auth_tenant_id()) OR is_superadmin())
```

The **only** constraint is that the row lands in your own tenant. `action`, `actor_id`, `actor_role`,
`target_type`, `target_id`, `details` and `ip_address` are all caller-supplied and unconstrained. Any
employee can write `action: 'access.revoke', actor_role: 'hr_admin', actor_id: <somebody else>` into
their tenant's audit log — forging attribution to another person, or burying a real event in noise.

`src/hooks/useAuditLog.ts` is the browser path that does exactly this, and it fetches the "IP
address" from `api.ipify.org` client-side — so the recorded IP is whatever the client says it is, and
every user's IP is handed to a third party.

**AC8 requires:** access mutations create exactly one **server-written** audit row, and direct client
`access.*` audit insertion is **denied**. §14.4 says outright that browser-authored audit and the
external IP lookup are not evidence of protected audit.

Write access audit server-side — a trigger or definer function on the membership/grant tables — and
constrain or revoke the client INSERT path for `access.*` actions. Do not leave the ipify call on any
path you touch.

### 2.2 First-admin bootstrap mints a full legacy HR principal

`functions/create-hr-admin-user/index.js:96-98` sets:

```js
metadata: { role: "hr", tenant_id }
```

`is_hr()`'s first branch is `auth.users.metadata->>'role' = 'hr' AND tenant matches`. So the
bootstrapped principal satisfies legacy operational `is_hr()` in full.

**§2.11 forbids exactly this:** "bootstrap metadata must not make that principal satisfy legacy
operational `is_hr()` or grant HR Admin actions." The resulting principal must be **Owner plus the
exact Company Admin row in §4** — access administration plus `org.read` / `org.manage` /
`reporting.manage` / `designation.manage`. Not leave approval. Not employee records. Not HR.

This is the hardest thing in the package, because today "first admin" and "full HR" are the same
thing and other code may assume it. Changing it is the point. If you find a caller that breaks,
**report it** — do not restore the metadata to make it pass.

### 2.3 Revocation freshness is unproven on every surface

§8.3 and AC7: a revoked session must be denied on the **next** operation on every enabled surface —
database/RPC, edge function, storage, realtime. The standing rule is blunt and you must honour it:
**any surface you cannot prove is disabled and labelled incomplete.** Do not claim a surface because
the pattern looks right. Prove it with a live revoked token, or disable it.

`accessVersion` exists in the wire shape for this. Nothing consumes it yet; you are the first.

---

## 3. `membershipId` — this is load-bearing, do not re-derive it

P1-01 already mints membership ids and I verified the value against the formula:

```sql
md5(tenant_id::text || ':' || user_id::text)::uuid
```

**Your membership table's primary key must default to exactly this expression**, so every id already
issued stays valid. If you generate fresh UUIDs instead, every id P1-01 has handed out silently stops
matching and nothing will tell you. Add a test that asserts a row's PK equals the formula.

---

## 4. What you must not do

- **Do not redefine the wire shape.** `src/types/access.ts` and `get_my_capability_summary` are
  frozen. If you believe the shape is wrong, stop and say so — that is a contract revision, not your
  call.
- **Do not widen authority to make a criterion pass.** §4's matrix is normative: if an action or scope
  you need is absent or contradictory, implementation **blocks pending contract revision**. You may
  not invent a grant.
- **Do not backfill `role: "hr"` into user metadata.** There is a standing rule against it and it
  silently widens authority.
- **Do not use `FORCE ROW LEVEL SECURITY`**, and do not assume RLS backstops a `SECURITY DEFINER`
  function — it does not. Every definer function needs its own tenant fence and must derive identity
  from `auth.uid()`, never from a caller-supplied id. Follow the pattern in
  `20260912180000_m1m2-access-capability-contract.sql`.
- **Do not write a PERMISSIVE policy as a tenant fence.** A permissive policy is a *grant*; it ORs
  with the others. Tenant isolation here is RESTRICTIVE. Getting this backwards gave every employee
  full access to `leave_types`/`leave_balances` once already.
- Applied migrations are immutable. Wrong after applying means a new forward migration.

---

## 5. Allowed files

```
migrations/20260912181000_m1m2-membership-grants-invites-ownership.sql   (new)
functions/create-hr-admin-user/index.js
functions/create-employee-user.ts
functions/finalize-onboarding.ts
functions/set-employee-password.ts
functions/verify-employee-code.ts
functions/accept-tenant-invitation/index.ts                             (new)
functions/manage-tenant-access/index.ts                                 (new)
src/hr/UsersAccess.tsx                                                  (new)
src/hooks/useAuditLog.ts
src/App.tsx                                                             (handoff from P1-01)
src/hr/HRLayout.tsx                                                     (handoff from P1-01)
tests/m1m2/fixtures/personas.mjs                                        (v0.5 — non-employee personas)
tests/m1m2/p1_membership_invitation_revocation.mjs                      (new)
```

The four `auth-*` functions were **removed** from this list in v0.5 — they are the sister ATS
product's, nothing in `src/` calls them, and they are dispositioned DELETE. See `reconciliation.md`
§11. Do not adopt them.

Anything else: **stop and report**, do not edit.

### The four limiter edits — AC12

`create-employee-user.ts`, `finalize-onboarding.ts`, `set-employee-password.ts` and
`verify-employee-code.ts` carry edits committed at `59c2256` that move `check_rate_limit` onto the
server client. They are **not mine and not yours** — preserve their behaviour and their comments.

Do not re-grant `check_rate_limit` to `authenticated` to simplify anything; it is
caller-parameterised, so an authenticated caller could burn or reset another user's counter.

**AC12 needs a "before" run and it has never happened.** Establish the employee-create and
set-password smoke baseline against `59c2256` *first*, record the result, then do your work, then
re-run. Without the before-baseline AC12 cannot be claimed in either direction.

---

## 6. Sequencing suggestion

Migration and RLS first, then the edge functions, then `UsersAccess.tsx` last. The UI is the cheapest
thing to redo and the most expensive thing to debug against a moving schema.

AC7 (revocation) and AC9 (owner transfer) are the two most likely to be incomplete. Start them early
enough that "disabled and labelled incomplete" is still an option rather than a scramble.

---

## 7. Report back

Exact commit, files changed, and **per criterion: PASS / FAIL / UNTESTED**. A criterion you reasoned
about but did not execute is UNTESTED. Say so — it is not a mark against you, and claiming it is.

Evidence, not assertion, for at least:
- the forged-audit attempt after your change (an authenticated client trying to insert an `access.*`
  row, and the denial)
- a bootstrapped Company Admin failing `is_hr()` and being denied leave approval (AC13)
- a revoked session denied on each surface you claim, named individually; every surface you cannot
  prove, listed as disabled
- the membership PK equalling the `md5` formula
- persona row counts re-run after your migration
- AC12 before and after
- `npm run build`

If the contract and the code disagree, or a criterion cannot be met without widening authority,
**stop and say so**. An honest blocked report is worth more than a green one that hides a gap.
