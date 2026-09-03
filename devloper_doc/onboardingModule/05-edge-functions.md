# 05 — Edge Functions

Five functions serve onboarding. **Four have local source; check before you deploy over anything.**

```bash
npx @insforge/cli functions list                      # ALWAYS first — orphans exist
npx @insforge/cli functions code <slug> > /tmp/x.ts   # fetch the DEPLOYED source
diff /tmp/x.ts functions/<slug>.ts                    # confirm they match
npx @insforge/cli functions deploy <slug> --file functions/<slug>.ts
```

Six functions on this backend exist **only** on the server with no source in `functions/`
(`admin-auth-login`, `auth-verify`, `auth-signup`, `auth-session`, `check-punch-out-gate`,
`daily-incomplete-task-marker`). None of them is in this module, but the habit applies here too.

---

## 1. `create-employee-user` — step 1

Creates the auth user. The heaviest of the five.

| Does | Auth used |
|---|---|
| `check_rate_limit` (20/hour) | **caller's token** — so the HR fence applies |
| Cross-tenant conflict checks against `employees` and `auth.users` | admin key |
| Orphaned-auth-user handling | admin key |
| `POST /api/auth/users` | admin key |
| `INSERT employee_onboarding` | admin key |
| **`POST /api/auth/email/send-verification`** | admin key |

⚠️ **That last call is mandatory and easy to delete by accident.** Creating a user through the admin
API suppresses the verification email — the backend logs *"Skipping verification email during admin
user creation"*. This call is what mints the OTP that `verify-employee-code` later checks. Without
it the wizard tells HR a code was sent while nothing was ever attempted.

The response reports `verificationEmailSent: true|false`. If the send fails, the employee still
exists but **HR is told explicitly** rather than left waiting for a code that is not coming.

**Orphan handling, worth knowing before you touch it:** an auth user with no employee row is a real
state (the step-1→step-5 gap). If one exists for this email, the function deletes and recreates it —
unless it is **less than 30 minutes old**, in which case it refuses, on the assumption that someone
else is mid-wizard.

---

## 2. `verify-employee-code` — step 1, stage 2

Thin wrapper. `check_rate_limit`, a `^\d{6}$` shape check, then `POST /api/auth/email/verify`
with `{email, otp}`. On success it sets `employee_onboarding.status = 'otp_verified'` and writes an
audit row.

Note the OTP expires ~15 minutes after it is minted.

---

## 3. `set-employee-password` — step 1, stage 3

bcrypt-hashes the password in the function (cost 10), then calls
`set_employee_password_by_hr(target_email, target_password_hash, tenant_uuid)` **with the caller's
token**, so the HR fence inside the RPC applies. See `04` §2.

Do not switch this to the admin key — that would remove the only check that the caller is HR of
that tenant.

---

## 4. `finalize-onboarding` — step 5

Sets `employee_onboarding.status = 'active'` once the employee row exists. Small, and the last thing
to run.

---

## 5. `create-hr-admin-user` — not the employee path

Used by the **Super Admin console** when provisioning a tenant, not by this wizard.

Worth knowing because it differs in two ways that matter:

- it passes **`autoConfirm: true`**, so no verification email is involved at all
- it creates an auth user with `metadata.role = 'hr'` and **no `employees` row**

That second point has consequences elsewhere: an HR admin is invisible to the directory, org chart,
leave and attendance. `is_hr()` reads the JWT, so login works — but anything joining to `employees`
will not find them. It is defensible (an administrator is not an employee) but undocumented, and it
is why the org chart's orphan classifier misbehaves. Decision #11 in the target-state FRD.

---

## 6. Conventions that apply to all of them

- **Deno runtime.** `npm:` / `jsr:` / `esm.sh` imports, no bundler, no `node_modules`.
- Secrets come from function env: `INSFORGE_BASE_URL`, `INSFORGE_ADMIN_KEY` (falls back to the
  reserved `API_KEY`), `DEFAULT_TENANT_ID`.
- **The admin key is a full-access key.** Only ever server-side. Never return it, never log it.
- Every function CORS-preflights and returns `{ message, error }` shaped JSON.
- Audit rows go to `audit_logs` via the admin client, and a failed audit write must never fail the
  operation (all of them wrap it in try/catch).

**Reading logs:**

```bash
npx @insforge/cli logs function.logs --limit 100
npx @insforge/cli logs insforge.logs --limit 200   # auth + SMTP live here, not in function.logs
```

The second one is the important one for this module — *"Skipping verification email during admin
user creation"*, *"Email verification token created successfully"* and *"Email sent via SMTP"* are
all `insforge.logs`, not `function.logs`.
