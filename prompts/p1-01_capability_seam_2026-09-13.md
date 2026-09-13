# P1-01 — Capability seam, composed navigation, exclusions, shared approval guard

You are implementing **P1-01** on the TalentMesh HRMS. Work in
`C:\Users\Anuj\Desktop\hrms\HRMS-Talentmesh-Solutions`, on branch `p1-00-harness-reconciliation`
(base commit `b43796c`).

Read before writing anything:
- `doc/execution/non-payroll-monday/contracts.md` v0.5 — §1, §2, §3, §6, §7, §12
- `doc/execution/non-payroll-monday/tasks.md` v0.5 — the P1-01 section and the v0.5 preamble
- `doc/execution/non-payroll-monday/reconciliation.md` §11, §12 — your test personas and their limits

**The v0.5 preamble is binding.** This is a pre-launch product with no real users. Do not add
ceremony, abstraction or configurability nobody asked for. Every changed line must trace to an
acceptance criterion below.

---

## 1. Backend and personas

Target `TB-M1M2` — branch `tb-m1m2`, project `fb9a8659-9950-4637-a58e-4a882ef24419`,
`https://rq3qmu8y-j9g.ap-southeast.insforge.app`. **Never write to
`0431f0f6-225f-4fb1-86b7-3fd32684c7f4` (the production parent).**

Verify before you start, and again before any backend write:

```
npm run test:m1m2:harness    # guard self-test, local only
npm run test:m1m2:target     # confirms the link points at tb-m1m2
npm run test:m1m2:personas   # idempotent; re-run any time
```

Three personas exist. Password is in `tests/m1m2/persona-password.local` (git-ignored).

| Persona | Tenant | Authority |
|---|---|---|
| `employee.a@m1m2.test` | Company A | employee only |
| `hr-employee.a@m1m2.test` | Company A | **composed** employee + `hr_admin` |
| `employee.b@m1m2.test` | Company B | employee only — cross-tenant negative |

Verified baseline: reading `employees` scoped to Company A returns **1 / 2 / 0** rows respectively.
If you ever see different numbers, stop — something you did changed RLS.

**Known limit:** the composed persona holds HR via `employee_roles`, not JWT metadata. Edge functions
gating on `metadata.role === "hr"` will not see it as HR. That is deliberate. Do not "fix" it by
writing `role: "hr"` into user metadata — there is a standing rule against backfilling `hr_admin`
that way, and doing so would silently widen authority.

**Trap:** `public.employees.tenant_id` has a DEFAULT pointing at an unrelated real tenant
(`c3816de9-…`). Any insert omitting `tenant_id` lands there silently. Always pass it explicitly.

---

## 2. The frozen wire shape — this is a decision, not a starting point

You own `src/types/access.ts` and you **freeze** it. P1-02 implements this shape and may not
redefine it. Emit exactly these names:

```ts
export type ScopeType = "self" | "direct_reports" | "company" | "project" | "channel";

export type Grant = {
  action: string;            // e.g. "leave.approve"
  scopeType: ScopeType;
  scopeId?: string;          // present only for project/channel
};

export type CapabilitySummary = {
  tenantId: string;
  membershipId: string;      // never null — see the derivation rule below
  membershipStatus: "active" | "suspended" | "revoked";
  employeeId: string | null; // null for a non-employee principal
  accessVersion: number;
  responsibilities: string[];
  grants: Grant[];
  enabledModules: string[];
  unavailableReason: string | null;
  issuedAt: string;          // ISO 8601 UTC
  contractVersion: "v0.5";
};
```

**`membershipId` derivation — required, and it is what saves P1-02 a migration.** §2.1 guarantees one
active membership per (tenant, account), so the id is derivable today and stable forever:

```sql
md5(tenant_id::text || ':' || user_id::text)::uuid
```

Return that from your resolver. **P1-02 must use the same expression as the default for its
membership table's primary key**, so every id minted now stays valid when the row materialises.
State this in a comment in both `src/types/access.ts` and your migration.

**`accessVersion`** is a monotonic integer that must change whenever access changes. In M1 derive it
from the greatest `updated_at` across the rows your resolver read (employee, roles, tenant), as epoch
seconds. It exists so a stale client can be detected; nothing consumes it yet.

**Scopes you must NOT advertise.** §3 forbids emitting `project` or `channel` scopes until P3-02 and
P3-03 enforce them server-side. Omit those grants entirely — no empty arrays as placeholders, no
"coming soon" entries.

---

## 3. The server resolver

Your migration is `migrations/20260912180000_m1m2-access-capability-contract.sql`. It creates:

1. **A capability resolver** returning the shape above for the *calling* user. In M1 it derives from
   the legacy sources that exist — `employees`, `employee_roles`, JWT metadata, `tenant_modules` —
   because P1-02's membership tables do not exist yet. That is expected; do not create them.
2. **One shared distinct-approver predicate** (§7). Attendance, Leave and Tasks will all call it in
   P2/P3 rather than reimplementing identity logic. It must return the **same denial class** for
   self-approval regardless of caller authority, and Owner / Company Admin / HR Admin / Manager /
   Project Manager must not override it.

Both are `SECURITY DEFINER`, so **both bypass RLS** — a definer function is not backstopped by the
table policies. Every one must carry its own explicit tenant fence and must never trust a
caller-supplied tenant or employee id. Derive identity from `auth.uid()` only.

---

## 4. Two real defects you are fixing — these are the substance of P1-01

### 4.1 Entitlement loading fails OPEN

`src/contexts/TenantContext.tsx:186-199` and `hasModule` at :202:

```ts
if (moduleError) {
  // Fail OPEN, deliberately: ...
  console.warn("Could not load module entitlements; showing all modules.", moduleError);
  setEnabledModules(null);
}
// hasModule: if (enabledModules === null) return true;
```

On a failed entitlement lookup the UI shows **every** module. Contract §12.1 requires the opposite:
"Missing/unavailable entitlement state denies protected access and renders an unavailable/retry
state, not an empty screen or silent allow."

The existing rationale — "the database is the real boundary" — is true about *security* and does not
address the contract's concern, which is a user being shown Payroll they never bought and then
hitting errors. Replace fail-open with an explicit unavailable state carrying `unavailableReason`,
and a retry. Do not silently delete the old comment; replace it with one that says why the decision
changed.

### 4.2 "Disabled" and "unknown" are different states, and the code conflates them

`src/shared/RequireModule.tsx` redirects silently. For a **disabled** module that is correct and
deliberate (a tenant that never bought something should not get an error toast — that was the
2026-08-14 failure). **Keep that behaviour.**

But a module whose state **failed to load** is not disabled — it is unknown, and a silent redirect
there is indistinguishable from "not purchased" and is a fail-open path into the wrong screen. Unknown
must render unavailable/retry and must deny.

Getting this distinction wrong in either direction is the single most likely way to fail this package.

---

## 5. Exact allowed files — touching anything else fails the package

```
src/types/access.ts                          (new — you freeze it)
src/contexts/AuthContext.tsx
src/contexts/TenantContext.tsx
src/App.tsx
src/modules.ts
src/shared/RequireModule.tsx
src/shared/NotificationBell.tsx
src/employee/EmployeeLayout.tsx
src/hr/HRLayout.tsx
src/hr/Directory.tsx
src/payroll/PayrollLayout.tsx
src/payroll/employee/EmployeePayrollLayout.tsx
migrations/20260912180000_m1m2-access-capability-contract.sql   (new)
tests/m1m2/p1_capability_contract.mjs                           (new)
```

Do **not** touch `tests/m1m2/_harness.mjs`, `_target.mjs`, `fixtures/*`, `package.json`, or any
`functions/`. If you believe another file must change, **stop and report it** rather than doing it.

Applied migrations are immutable. If yours is wrong after applying, write a new one.

---

## 6. Acceptance criteria

1. Employee-only sees My Work. HR+employee sees My Work, applicable Team **and** Administration —
   one human, three surfaces, composed from grants rather than from a single role string.
   *(The non-employee Company Admin case moved to P1-02 AC14; do not attempt it.)*
2. Capability or module failure renders unavailable/retry in **every** consumer and denies direct
   protected routes. No empty screen, no fail-open. See §4.
3. Capability summaries omit project and channel scopes entirely.
4. A client-modified role, grant or module flag cannot authorize a request. Prove it by tampering —
   edit the summary in memory or in devtools, then issue the request and show the server still denies.
5. Direct GETs to `/payroll/employee/payslips`, `/payroll/hr/run`, `/hr/insurance`,
   `/employee/insurance` and their APIs are unavailable for the fixture tenants (payroll and
   insurance are off on both).
6. One shared server distinct-approver predicate returns the same denial class for self-approval and
   is the only approved predicate P2/P3 will consume.
7. Task and leave notifications deep-link to the correct surface in a composed session; Directory and
   Team visibility match server capability state.
8. `npm run build` passes and your files add no new lint findings.

---

## 7. Report back

State plainly: exact commit, files changed, which criteria **pass**, which **fail**, and which you
**did not test**. A criterion you could not verify is not a pass — say so.

Include, as evidence rather than assertion:
- the AC4 tamper attempt and the server's response
- the per-persona row counts from §1, re-run after your migration
- `npm run build` output

If something in this prompt contradicts the code or the contract, **stop and say so** rather than
picking an interpretation. Do not widen authority, invent a scope, or expand your file list to make a
criterion pass — an honest blocked report is worth more than a green one that hides a gap.
