# 06 — Gotchas & History

**Seven failures stood between "click Create" and an employee existing.** All were found and fixed
on 2026-09-02, in one sitting, by driving the wizard by hand.

**Each one hid the next.** That is why the QA run of the same day found only the first — nobody had
ever got far enough down the wizard to reach the rest. **A module can look fine in isolation and be
completely impassable end to end.**

They are listed in the order they surfaced, which is also the order they must be understood.

---

## 1. "Rate limit exceeded" on the very first attempt

**Cause:** `check_rate_limit` had no `EXECUTE` for `authenticated` — revoked by the 2026-08-17
hardening pass and never re-granted. The RPC returned a *permission* error, which
`create-employee-user` collapsed into a 429.

**Why it survived weeks:** the message said *rate limit*, which reads as **transient**. HR retried.
`rate_limits` held zero rows the whole time.

**Fix:** grant (`20260902100000`), and split the two error paths so a failed check returns 500 with
the real message. See `04` §4.

---

## 2. The verification email was never sent

**Cause:** creating a user through the **admin API deliberately suppresses** the verification email.
The backend says so plainly:

```
info - Skipping verification email during admin user creation
```

Nothing ever called `/api/auth/email/send-verification`, so the OTP that
`verify-employee-code` checks had **never been generated**. Meanwhile the wizard cheerfully said
*"A 6-digit verification code was sent to …"*.

**This was NOT an SMTP fault.** SMTP had to be configured too (it was, that same day) — but it was
never reached. Necessary, not sufficient.

**Fix:** call `send-verification` explicitly after creating the user, and stop the log line claiming
`(OTP sent)` when it had not been.

---

## 3. "Could not find the function … in the schema cache"

**Cause:** `employees.department` and `designation` were dropped in the org rebuild and the form
correctly stopped sending `p_department` / `p_designation` — but the function still **declares**
both. 33 declared, 31 sent.

**PostgREST resolves an RPC by its exact NAMED ARGUMENT SET**, not by arity or position. Two missing
names means *no overload matches at all*, so it fails in the schema cache rather than inside the
function — which is why the error lists every parameter you **did** send and reads like the function
is missing entirely. **The culprits are the names NOT in the message.**

**Fix (interim):** the frontend sends both as `null`; the body ignores them.
**Fix (proper, still parked):** `migrations-pending-deploy/20260902130000_*.sql` drops them.
⚠️ Apply that SQL **before** removing the frontend lines, never after, or creation breaks in the gap.

---

## 4. "column timezone does not exist"

**Cause:** the function read `SELECT COALESCE(timezone,'UTC') FROM public.tenant_settings`. But
`tenant_settings` is a **key/value store** (`id, tenant_id, key, value, updated_at`). The tenant
timezone lives on **`tenants`**.

**Fix:** `FROM public.tenants WHERE id = v_tenant_id`.

---

## 5. "violates check constraint employees_employment_type_check"

**Cause — and this is the pattern worth internalising.** The org rebuild introduced the
`employment_types` lookup with free-text `code`, while the legacy `employees.employment_type` column
kept a CHECK expecting the **old** vocabulary:

```
CHECK allows : full_time, part_time, contract, consultant, freelancer, intern, temporary, vendor
QA fixture   : FT, CON, INT          ← violates it
real tenants : full_time, intern     ← fine
```

**The bad data was not product-generated.** `OrgStructureManagement.tsx` — the screen HR actually
creates types on — already normalises (`code.toLowerCase().replace(/\s+/g,"_")`), so "Full Time"
becomes `full_time`. The QA fixture seeded the short codes. **The defect was that the write path
trusted `code` blindly** — safe only by convention, and nothing enforced the convention.

**Fix:** `src/utils/employmentType.ts` → `toLegacyEmploymentType()`. Passes through valid values,
maps the short forms, returns **null** for anything unrecognised (the constraint permits NULL and
`employment_type_id` is the real truth, so an odd code must not block creation).

⚠️ **Wired at SIX write sites, and it had to be.** Normalising only in the change handler was not
enough — a `sessionStorage` draft restores the raw code straight into form state, bypassing the
handler entirely. **Normalise at the WRITE, not at the change.**

> **The general rule:** a legacy text column mirroring a lookup table should have **ONE owner of the
> translation** — a trigger, or a single function. Guarding at each call site is how this produced
> the same bug twice in one afternoon.

---

## 6. "column personal_details_completed does not exist"

**Cause:** four columns on `employee_onboarding_self` were renamed and nothing that writes them was
updated:

```
personal_details_completed  → section_personal
bank_details_completed      → section_bank
documents_completed         → section_documents
emergency_contact_completed → section_emergency
```

**Twelve stale references in app code**, in two places that matter separately:

- `OnboardingWizard.tsx` (8) — the **employee's own** self-service wizard. Every section it marked
  complete wrote a non-existent column. **That whole flow was broken independently of employee
  creation.**
- `EmployeeDetail.tsx` (4) — HR's progress checklist, reading `undefined`, always rendering as
  nothing-completed.

**Why nothing caught it:** `src/types/index.ts` still **declared** the old names. Twelve
runtime-broken references compiled cleanly because the type agreed with the code and both disagreed
with the database. **A type that lies is worse than no type.**

---

## 7. The success screen showed a blank password

**Cause — correct behaviour with a wrong consequence.** The draft deliberately stores the password
as `""`, because a plaintext password must never sit in `sessionStorage`. But the draft is restored
into `credentials`, so after any reload the password is gone while the panel still rendered it.

**The dangerous part was the silence:** "Copy credentials" put `Password: ` on the clipboard and
"Send via mail client" would have emailed it. HR hands that to a new hire and nobody notices until
they cannot log in.

**Fix:** show the password only when present; otherwise say it cannot be recovered (it is stored
hashed) and point at Reset Password. Copy disabled, Send hidden.

> A blank field HR can see is recoverable. A blank password pasted into an email is not.

---

## 8. Not yet exercised — assume these are broken too

- **`hr_activate_draft_employee`** — the `draft` → `active` path. Two overloads exist. It writes the
  same legacy `employment_type` column, so it shares the §5 exposure. Nobody has ever run it.
- **Employee self-service wizard** (`/employee/onboarding`) — the column names are fixed as of
  2026-09-02 but the flow has still never been completed by a real employee.
- **Document uploads** — `employee_documents` inserts and the storage buckets behind them.

---

## 9. How to debug the next one

The lesson from doing six of these one at a time before doing the seventh properly:

**When the same shape recurs, stop fixing instances and enumerate the surface.** Auditing the whole
function cost one query and found gate 8 (`leave_balances.created_at`) *before* anyone hit it.

```sql
-- every column an INSERT names, checked against reality
WITH used(t, c) AS (VALUES ('employees','user_id'), ('leave_balances','created_at') /* ... */)
SELECT string_agg(u.t || '.' || u.c, ', ')
FROM used u
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns ic
  WHERE ic.table_schema = 'public' AND ic.table_name = u.t AND ic.column_name = u.c
);
```

Extract the pairs from `pg_get_functiondef()` rather than by hand — the whole audit is one script,
and it is in the session transcript for 2026-09-02.

**Two sweeps worth doing across the rest of the rebuild, both mechanical and both silent until
someone completes a flow:**

1. every `p_`-prefixed RPC signature against its caller's argument set
2. every legacy text column against the lookup table now feeding it

---

## 10. A CLI limitation you will hit

`npx @insforge/cli db migrations up` **refuses** the `create_employee_transaction` migration:

```
Error: Query could not be parsed and was rejected for security reasons.
```

Bisected and ruled out: not the `DROP` (removing it still fails), not the dollar-quoting (balanced,
named tags), not CRLF, no dynamic SQL. Other migrations in this repo create SECURITY DEFINER
functions and drop overloads without complaint, so it is specific to that file.

`db query` hits the Windows command-line length limit at ~8KB, and routing it through `exec_sql` is
blocked by the sandbox classifier (correctly).

**Workaround:** apply it through the **InsForge dashboard → Database → SQL Editor**. The
ready-to-paste file with a full explanatory header lives at
`doc/APPLY-IN-DASHBOARD-create_employee_transaction.sql`.
