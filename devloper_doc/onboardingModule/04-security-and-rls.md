# 04 — Security & RLS

---

## 1. The rule that broke this module twice

**Every RPC the wizard calls with the *caller's* token needs `EXECUTE` for `authenticated`.**

A `SECURITY DEFINER` function does not grant itself. If `authenticated` lacks EXECUTE, the call
fails with `permission denied for function …` — and if the caller collapses that into a friendlier
message, the real cause disappears.

The 2026-08-17 hardening pass revoked EXECUTE broadly and re-granted selectively. It got this module
wrong **twice, in opposite directions** ✅:

| Function | What went wrong | Symptom |
|---|---|---|
| `check_rate_limit` | under-granted, never re-granted | *"Rate limit exceeded"* on the first attempt, with `rate_limits` empty |
| `set_employee_password_by_hr` | under-granted, never re-granted | *"permission denied for function set_employee_password_by_hr"* at the last step |
| `fn_accrue_monthly_leaves` | **over**-granted | any employee could fire a cross-tenant balance mutation |

**The re-grant list is now fully audited** ✅. Of 20 functions `authenticated` cannot execute, six
are called by the app, and only those invoked with the caller's token can fail this way:

```
attendance_run_scheduled_derivation   ADMIN key   ok
device_ingest_punch                   ADMIN key   ok
fn_check_insurance_expiries           ADMIN key   ok
get_auth_user_details_by_email        ADMIN key   ok
get_auth_user_details_by_email_v2     ADMIN key   ok
set_employee_password_by_hr           USER token  fixed 20260902110000
```

The other 14 are trigger functions, internal derivation passes, or deliberately locked
(`exec_sql`, `query_json`, `update_user_password`, `fn_accrue_monthly_leaves`). **None should be
granted.**

> **Before adding an RPC call from the frontend or an edge function that forwards the user's token:
> check the grant.** It is one query:
> `SELECT has_function_privilege('authenticated', 'public.your_fn(argtypes)', 'EXECUTE');`

---

## 2. Why granting a password-setter is safe

`set_employee_password_by_hr` is `SECURITY DEFINER`, so the fence has to live **inside** it — and it
does ✅:

```sql
IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Unauthorized';

-- actor role and tenant come from auth.users keyed on auth.uid(), NEVER from an argument
SELECT u.metadata->>'role', (u.metadata->>'tenant_id')::uuid
INTO actor_role, actor_tenant_id
FROM auth.users u WHERE u.id = (SELECT auth.uid());

IF actor_role <> 'hr' OR actor_tenant_id IS DISTINCT FROM tenant_uuid
  THEN RAISE EXCEPTION 'Forbidden';

-- and a target already owned by another tenant is refused
IF target_user_tenant_id IS NOT NULL AND target_user_tenant_id IS DISTINCT FROM tenant_uuid
  THEN RAISE EXCEPTION 'Employee not found for this tenant';
```

**The caller cannot spoof `actor_role`** — it is read from `auth.users`, not from the request. The
grant widens nothing; it only lets the fence be reached.

The migration that grants it asserts this invariant, so the grant cannot outlive the fence:

```sql
-- fails if the function stops being SECURITY DEFINER or loses its HR check
AND p.prosecdef AND p.prosrc ~ 'actor_role' AND p.prosrc ~ 'Forbidden'
```

---

## 3. RLS on the onboarding tables ✅

```
employee_onboarding       HR can manage employee_onboarding in their tenant   [ALL]
employee_onboarding       module_enabled_onboarding                          [ALL]  RESTRICTIVE

employee_onboarding_self  onboarding_self_employee                           [ALL]
employee_onboarding_self  onboarding_self_hr_view                            [SELECT]
employee_onboarding_self  module_enabled_onboarding                          [ALL]  RESTRICTIVE
```

The shape is right: the **employee** owns their own self-service row (`ALL`), HR can only **read**
it (`SELECT`), and both tables are gated on the `onboarding` module entitlement.

---

## 4. Errors must not lie about their cause

The single most expensive bug in this module was not the missing grant — it was the **message**:

```ts
// WRONG. A failed CHECK and a hit LIMIT are different failures.
if (rateLimitErr || rateLimitOk === false) return json({ error: "Rate limit exceeded" }, 429);
```

A permission error was reported as a rate limit, which reads as **transient**. HR retried for weeks.
Both `create-employee-user` and `set-employee-password` now split them ✅:

```ts
if (rateLimitErr)          return json({ ... rateLimitErr.message }, 500);  // the real cause
if (rateLimitOk === false) return json({ error: "Rate limit exceeded" }, 429);
```

> **Rule:** never merge a *failed check* with a *failing result*. One is a bug in your system, the
> other is the system working. Collapsing them hides the first behind the second.

---

## 5. Things to be careful with here

- **HR knows every employee's password.** It is typed by HR and shared. There is no
  change-password screen anywhere in the app, so this is the permanent state, not a first-week
  window. The invite flow (FRD §9A) is the fix; forgot-password (shipped 2026-09-02) is the
  partial mitigation.
- **The admin key is used by `create-employee-user`** for the auth-user call, but `check_rate_limit`
  and `set_employee_password_by_hr` deliberately use the **caller's** token so the HR fence applies.
  Do not "simplify" those to the admin key — it would remove the only check that the caller is HR
  of that tenant.
- **Cross-tenant email conflicts are checked in two places** (`employees` and `auth.users`) because
  an email can exist in one without the other during the step-1→step-5 gap.
