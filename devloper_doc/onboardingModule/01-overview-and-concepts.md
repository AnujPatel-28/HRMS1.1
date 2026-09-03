# 01 — Overview & Concepts

## 1. What this module owns

Getting a person from *"we hired someone"* to *"they can log in and are a real employee"*.

It does **not** own recruitment — that is a separate sister product, deliberately out of this schema
(`doc/architecture/README.md` §2). Onboarding starts at the point where a hire is a decided fact.

Its entitlement key is `onboarding`. It is **not** core, so a tenant can have it disabled — in which
case employees can only arrive by direct database write or import, neither of which exists yet.

---

## 2. The two paths, and why both exist

### Path A — HR-driven creation (`/hr/employees/create`)

The five-step wizard. HR enters everything, including the employee's password, and hands the
credentials over. This is the path that actually runs today.

### Path B — employee self-service (`/employee/onboarding`)

After they can log in, the employee fills in their own personal details, bank details, documents and
emergency contact. Tracked in `employee_onboarding_self` as four booleans.

**They are sequential, not alternative.** Path B cannot start until Path A has produced a login. So
the four self-service sections are *completion tracking after the fact*, not a way for the employee
to create their own account.

> ⚠️ Path B was writing four columns that **do not exist** (`personal_details_completed` and
> friends were renamed to `section_personal` etc.) until 2026-09-02, so every section it marked
> complete failed. It compiled cleanly because `src/types/index.ts` still declared the old names.
> See `06` §6.

---

## 3. The state machine

`employees.status` is CHECK-constrained to six values ✅:

```
active | inactive | terminated | draft | pending_hr_review | pending_onboarding
```

**Only `active` and `draft` are in live use.** ✅ The other four are declared and unused — treat
`pending_hr_review` and `pending_onboarding` as aspirational until something writes them.

The wizard's happy path never touches `draft`: `create_employee_transaction` inserts the employee
already `active`. `draft` exists for the separate `hr_activate_draft_employee` path (a partially
created employee that HR later completes), which **has never been exercised** — see `06` §8.

`employee_onboarding` tracks the *auth-side* progress separately, keyed on `auth_user_id`:

```
id | tenant_id | auth_user_id | status | last_error | created_at | updated_at | expired_at
```

This is the row that lets a half-finished wizard be resumed or safely abandoned. It is what
`check_onboarding_resumable(p_email, p_tenant_id)` reads.

---

## 4. Why the auth user comes first

This is the design decision that shapes everything else, and it is worth understanding before you
change anything.

The wizard creates the **auth user in step 1**, before any employee data has been entered. That
means between step 1 and step 5 there is an auth user with no employee row — a genuine orphan.

**Why it is done this way:** the email must be proven before HR invests in filling four more steps,
and the password must be set while HR still has the person's attention. Deferring auth to the end
would mean discovering a duplicate or unreachable email after all the data entry.

**What it costs:** a whole class of half-created states, and the machinery to handle them —

- `check_onboarding_resumable` — can this email pick up where it left off?
- the orphaned-auth-user guards in `create-employee-user` (delete and recreate if old enough,
  refuse if too new — 30 minutes)
- the cross-tenant email conflict checks, which must run against `auth.users` *and* `employees`

If you are tempted to simplify that error handling, this is the reason it exists.

---

## 5. What crosses the boundary

Onboarding is a **consumer** of Organisation, not a peer of it. It reads:

| From | What |
|---|---|
| `org_units` | department placement (`org_unit_id`) |
| `job_titles` | designation (`job_title_id`) |
| `locations` | work location (`location_id`) |
| `employment_types` | employment type (`employment_type_id`) |
| `employee_grades` | grade (free text on `employees`, not an FK ✅) |
| `leave_types` | to seed one `leave_balances` row per active type |

It **publishes** exactly one thing: a row in `employees`. Every other module keys off that.

> **This dependency is the whole story of this module's bugs.** Organisation moved four of those
> six from text columns to FK lookups and kept the text columns for compatibility. Onboarding
> writes both, and the constraints on the text ones do not know about the lookup tables. `06` §5.
