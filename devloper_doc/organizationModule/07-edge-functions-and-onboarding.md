# 07 - Organisation Module: Edge Functions & Employee Onboarding

`03-setup-and-workflow.md` ends with "Step 7: Employees". That step is **not** a simple insert into the `employees` table — creating an employee also creates a *login account*, and that cannot be done from the browser. It runs through edge functions.

This document covers what those are and why the flow looks the way it does.

---

## 1. Why creating an employee needs a server function

An employee record and a login account are two different things in two different places:

```text
  employees          →  your tenant's business data (name, unit, grade, title)
  auth users         →  the login account (email, password, session)
```

Creating a login account requires **admin rights**. A browser session must never hold those — if it did, any employee could mint accounts. So account creation happens inside an edge function that holds the admin key, and the browser only asks it to.

---

## 2. The Onboarding Functions

Called from `src/hr/EmployeeCreate.tsx` and `src/hr/EmployeeDetail.tsx`.

| Function | Purpose |
|---|---|
| `create-employee-user` | Creates the auth account for a new employee and links it to the tenant |
| `create-hr-admin-user` | Same, for an HR admin (used during tenant provisioning) |
| `verify-employee-code` | Verifies the code an employee was given, proving they own the invite |
| `set-employee-password` | Lets HR set or reset an employee's password within their own tenant |
| `finalize-onboarding` | Flips onboarding state to `active` once the `employees` row exists |

```typescript
const fnRes = await insforge.functions.invoke("create-employee-user", { body: { ... } });
```

Note `insforge.functions.invoke` — this wrapper stamps `tenant_id` onto the body from the current session. That is what you want for HR-initiated calls. (The kiosk in the attendance module deliberately uses the *unwrapped* `rawFunctions` instead, because it has no session; see that module's doc 09.)

---

## 3. ⚠️ Why onboarding uses codes instead of email links

**SMTP is not configured on this project.** Email verification is switched on in the auth settings, but no mail can actually be sent.

That is why onboarding is **HR-driven** rather than self-service: HR creates the account and hands the employee a code, instead of the system emailing an invite link. `verify-employee-code` and `set-employee-password` exist precisely to fill the gap left by the missing email channel.

If SMTP is ever configured, this flow can be revisited — but until then, **do not add a feature that assumes an employee will receive an email.** It will silently never arrive.

---

## 4. ⚠️ The Orphan Trap

Several functions are **deployed but have no source file in this repository**, including `admin-auth-login`, `auth-signup`, `auth-verify`, and `auth-session` — all of which touch identity, so they matter to this module.

```bash
# ALWAYS do this before deploying a function you did not write yourself
npx @insforge/cli functions list
npx @insforge/cli functions code <slug>
```

Deploying a local file under the same slug **overwrites the only copy that exists**. If you fetch an orphan, commit it.

---

## 5. Authentication patterns

Two patterns, and picking the wrong one is a security bug. This is covered in full in `devloper_doc/attendanceModule/09-edge-functions.md` §2 — the same rules apply everywhere:

- **Pattern A — run as the caller** (`edgeFunctionToken`): normal RLS applies. The safe default.
- **Pattern B — run as `project_admin`** (admin key): **RLS does not apply at all.** Only when there is no logged-in user to act as, or when the operation genuinely needs rights no user may hold — like creating an auth account.

The onboarding functions are Pattern B by necessity. That means each one must check for itself that the caller is really HR and really belongs to the tenant it is operating on — the database will not do it for them.

---

## 6. Useful commands

```bash
npx @insforge/cli functions list
npx @insforge/cli functions code <slug>
npx @insforge/cli functions deploy <slug> --file functions/<slug>.ts --name <slug> --description "..."
npx @insforge/cli logs function.logs
npx @insforge/cli secrets get API_KEY
```
