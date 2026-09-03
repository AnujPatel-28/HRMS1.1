# 03 — The Creation Flow

Every call the wizard makes, in order, with what fails at each point. This is the page to have open
while debugging.

Source: `src/hr/EmployeeCreate.tsx`.

---

## 1. Step 1 — Personal Details, and the whole auth dance

The only step that writes anything before step 5. It has its own three-stage sub-flow, and **"Next"
stays disabled until all of it completes** (`authStep === "done"`).

```text
HR enters full name + email + phone, clicks "Verify"
   │
   ├─1─► POST /functions/create-employee-user       ← the caller's HR token
   │        · check_rate_limit                       (20 / hour / endpoint)
   │        · cross-tenant email conflict checks     (employees AND auth.users)
   │        · orphaned-auth-user handling            (delete+recreate, or refuse if <30 min old)
   │        · POST /api/auth/users                   → creates the auth user
   │        · INSERT employee_onboarding             → auth-side progress row
   │        · POST /api/auth/email/send-verification → generates AND emails the 6-digit OTP
   │
   ├─2─► employee reads the code, tells HR, HR types it
   │     POST /functions/verify-employee-code
   │        · POST /api/auth/email/verify            → marks the email verified
   │        · employee_onboarding.status = 'otp_verified'
   │
   └─3─► HR types a password
         POST /functions/set-employee-password
            · bcrypt hash in the edge function
            · rpc set_employee_password_by_hr        ← the caller's HR token, HR-fenced inside
```

**The OTP does not send itself.** ⚠️ Creating a user through the **admin API deliberately
suppresses** the verification email — the backend logs *"Skipping verification email during admin
user creation"*. `create-employee-user` must call `/api/auth/email/send-verification` explicitly, and
that call is what mints the code `verify-employee-code` later checks. Remove it and the verify step
becomes unsatisfiable by construction. `06` §2.

**This step requires the employee to be reachable in real time** — they must read the code back to
HR. That is one phone call per hire, and it is the strongest argument for the invite flow
(`doc/hrms_target_state_frd_2026-09-02.md` §9A).

---

## 2. Steps 2–4 — form only

Nothing is written. The wizard holds state in memory and mirrors it to `sessionStorage` as a draft.

**What actually gates "Next"** (from `canMoveToNext`) — everything else on these screens is optional:

| Step | Required |
|---|---|
| 1 Personal Details | full name, email, phone, **and** `authStep === "done"` |
| 2 Employment Info | **Department**, **Job Title**, Employee Code, Date of Joining |
| 3 KYC & Banking | Aadhaar (`^\d{12}$`), PAN (`^[A-Z]{5}[0-9]{4}[A-Z]$`) |
| 4 Emergency Contact | contact name, contact phone |
| 5 Review & Create | — |

Employment type, work mode, grade, work location, both managers and probation period are **not**
required and do not block progress.

`missingFields` renders the blocking list above the nav buttons. **It mirrors `canMoveToNext` by
hand** — add a condition to one and you must add its label to the other, or they drift silently.

---

## 3. Step 5 — Review & Create

```text
"Confirm & Create"
   │
   ├─1─► rpc create_employee_transaction(31 named args)      ← ONE transaction, six writes
   │        · INSERT employees                                (36 cols, status = 'active')
   │        · INSERT employee_onboarding_self                 (defaults, no section_* named)
   │        · INSERT employee_reporting_relationships ×2       (primary + secondary)
   │        · SELECT tenants.timezone  → probation_end_date
   │        · INSERT leave_balances     (one per ACTIVE leave_type)
   │        · INSERT audit_logs ×2      (employee.created, employee.manager_changed)
   │      returns the new employee id
   │
   ├─2─► employee_documents inserts     (Aadhaar / PAN / photo, if uploaded)
   │
   └─3─► POST /functions/finalize-onboarding
            · employee_onboarding.status = 'active'
```

**It is one transaction on purpose.** Any single failure rolls back all of it — which is why one
missing column blocks the entire wizard rather than leaving a half-made employee. Correct, and
worth preserving.

⚠️ **The RPC is called with 31 named arguments but the function declares 33.** The frontend sends
`p_department: null` and `p_designation: null` purely to satisfy the signature — both are vestigial
and the body ignores them. PostgREST matches on the **exact named-argument set**, so omitting them
makes the call unresolvable. Removing those two lines requires applying
`migrations-pending-deploy/20260902130000_*.sql` **first**. `06` §3.

---

## 4. Verifying a creation actually worked

Do not trust the success screen — check the six writes. ✅ This is the exact query used to confirm
the first successful end-to-end run:

```sql
SELECT full_name, status, employee_code,
       CASE WHEN user_id IS NULL THEN 'NULL' ELSE 'set' END AS auth_link,
       employment_type, org_unit_id
FROM employees WHERE email = '<the email>';

SELECT
  (SELECT count(*) FROM employee_onboarding_self s
     JOIN employees e ON e.id = s.employee_id WHERE e.email = '<the email>') AS onboarding_self,
  (SELECT count(*) FROM leave_balances b
     JOIN employees e ON e.id = b.employee_id WHERE e.email = '<the email>') AS leave_balances,
  (SELECT count(*) FROM employee_reporting_relationships r
     JOIN employees e ON e.id = r.employee_id WHERE e.email = '<the email>') AS reporting;
```

A healthy run: `status=active`, `auth_link=set`, `employment_type` in the CHECK vocabulary,
`onboarding_self=1`, `leave_balances` = number of active leave types, `reporting` = 1 or 2.

---

## 5. The draft

Mirrored to `sessionStorage` under `hrms_employee_draft_<tenantId>` on every change, cleared once
`isCreated`.

⚠️ **The password is deliberately blanked in the draft** — a plaintext password must never sit in
`sessionStorage`. The consequence is that after any reload the success panel cannot show it. That is
now stated on screen with a pointer to Reset Password, and Copy/Send are disabled, because the old
behaviour silently emitted an **empty** password. `06` §7.

An empty draft (no name, no email, no phone, `authStep === 'idle'`) is discarded rather than
restored, so an abandoned blank form does not resurrect itself.
