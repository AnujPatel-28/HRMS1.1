# 02 — Database Schema & ER

All column lists ✅ verified against `information_schema` on the live parent, 2026-09-02.

---

## 1. The map

```text
                      auth.users
                          │  (created FIRST, in step 1)
                          │
              ┌───────────┴────────────┐
              │                        │
   ┌──────────▼──────────┐   ┌─────────▼──────────────┐
   │ employee_onboarding │   │      employees          │
   │ AUTH-side progress  │   │  created LAST, step 5   │
   │ keyed on auth_user  │   │  the module's ONLY      │
   └─────────────────────┘   │  published output       │
                             └─────────┬───────────────┘
                                       │  written in the SAME transaction
        ┌──────────────┬───────────────┼───────────────────┬──────────────┐
        ▼              ▼               ▼                   ▼              ▼
┌───────────────┐ ┌──────────┐ ┌────────────────┐ ┌───────────────┐ ┌──────────┐
│ employee_     │ │ leave_   │ │ employee_      │ │ employee_     │ │  audit_  │
│ onboarding_   │ │ balances │ │ reporting_     │ │ documents     │ │  logs    │
│ self          │ │ 1 per    │ │ relationships  │ │ (uploaded     │ │  ×2      │
│ EMPLOYEE-side │ │ leave    │ │ ×2 (primary +  │ │  separately)  │ │          │
│ progress      │ │ type     │ │  secondary)    │ │               │ │          │
└───────────────┘ └──────────┘ └────────────────┘ └───────────────┘ └──────────┘
```

**Two different onboarding tables, and the names are unhelpfully similar:**

| Table | Side | Keyed on | Tracks |
|---|---|---|---|
| `employee_onboarding` | **auth** | `auth_user_id` | Did account creation finish? Resumable? |
| `employee_onboarding_self` | **employee** | `employee_id` | Which of the four self-service sections are done? |

---

## 2. `employee_onboarding` — the auth-side progress row

```
id | tenant_id | auth_user_id | status | last_error | created_at | updated_at | expired_at
```

Created by `create-employee-user` at step 1, set to `active` by `finalize-onboarding` at step 5.
`last_error` and `expired_at` exist so a stalled attempt can be diagnosed and aged out rather than
silently blocking the email forever.

Note it keys on **`auth_user_id`, not `employee_id`** — deliberately, because at the moment it is
created there is no employee row to point at.

---

## 3. `employee_onboarding_self` — the employee-side checklist

```
id | tenant_id | employee_id | section_personal | section_bank | section_documents
   | section_emergency | completed_at | created_at | updated_at
```

All four `section_*` columns are `boolean DEFAULT false` ✅.

> ⚠️ **These were renamed.** They used to be `personal_details_completed`, `bank_details_completed`,
> `documents_completed`, `emergency_contact_completed`. Twelve references in the app and one INSERT
> inside `create_employee_transaction` were still using the old names as of 2026-09-02. If you see
> the old names anywhere, they are wrong — the columns do not exist. `06` §6.
>
> Because they default to `false`, an INSERT should simply **omit** them rather than name them.
> Fewer names to keep in step.

---

## 4. `employees` — the output

36 columns are written by `create_employee_transaction` ✅. The ones that matter for onboarding:

| Group | Columns |
|---|---|
| Identity | `user_id` (→ `auth.users`), `full_name`, `email`, `phone`, `date_of_birth`, `gender` |
| Address | `address`, `city`, `state`, `pincode` |
| **Placement (FK)** | `org_unit_id`, `job_title_id`, `location_id`, `employment_type_id` |
| **Placement (legacy text)** | `employment_type`, `work_location`, `work_mode`, `grade` |
| Employment | `employee_code`, `date_of_joining`, `status`, `probation_status`, `probation_end_date` |
| KYC | `aadhaar_number`, `pan_number`, `bank_name`, `account_number`, `ifsc_code` |
| Emergency | `emergency_contact_name`, `emergency_contact_phone`, `emergency_contact_relation` |
| Reporting | `manager_id`, `secondary_manager_id` |

**The FK / legacy-text split is the single most important thing on this page.** Both are written.
Four CHECK constraints guard the legacy side ✅:

```
employees_employment_type_check   employees_work_mode_check
employees_status_check            employees_probation_status_check
```

Only `employment_type` is fed by a rebuilt lookup table, so only it can be poisoned by a
vocabulary mismatch. That is exactly what happened — see `06` §5.

**Already dropped, so do not add them back:** `employees.department` and `employees.designation`.
`org_unit_id` and `job_title_id` replaced them (org rebuild, 06 §5 step 6). ✅

---

## 5. `leave_balances` — seeded at creation

One row per **active** `leave_types` row in the tenant, inserted inside the same transaction:

```
tenant_id | employee_id | leave_type_id | year | total_allocated | used_days
          | carried_forward | balance | updated_at
```

⚠️ **There is no `created_at` on this table** ✅ — only `updated_at`. The function named it until
2026-09-02 and that alone blocked the whole wizard. Full column list:

```
id, tenant_id, employee_id, leave_type_id, year, total_allocated, carried_forward,
used_days, pending_days, balance, last_accrual_date, updated_at
```

`ON CONFLICT (tenant_id, employee_id, leave_type_id, year) DO NOTHING` makes the seeding idempotent.

---

## 6. `employee_reporting_relationships` — two rows, not one

```
tenant_id | employee_id | manager_id | relationship_type | effective_from
          | is_active | created_at | updated_at
```

Written **twice** when both managers are set: `relationship_type = 'primary'` and `'secondary'`.
The `employees.manager_id` / `secondary_manager_id` columns are the *current* value; this table is
the effective-dated history. Both are maintained — do not assume one is derived from the other.

---

## 7. Where the timezone comes from

`create_employee_transaction` needs the tenant timezone to compute the probation end date.

**It lives on `tenants.timezone`.** ✅

It is **not** on `tenant_settings` — that is a key/value store (`id, tenant_id, key, value,
updated_at`) with no such column. The function read the wrong table until 2026-09-02 and failed with
*"column timezone does not exist"*. `06` §4.
