# Onboarding / Add Employee — Developer Documentation

**Written 2026-09-02**, immediately after driving the wizard end to end for the first time and
fixing the **seven** separate failures that stood between "click Create" and an employee existing.
Everything marked ✅ was verified against the live parent backend `rq3qmu8y`, not read from code.

| Doc | Read it when |
|---|---|
| [01 — Overview & Concepts](01-overview-and-concepts.md) | **Always first.** The two paths, the state machine, and what "onboarding" actually owns |
| [02 — Database Schema & ER](02-database-schema-and-er.md) | You need to know which table holds what |
| [03 — The Creation Flow](03-the-creation-flow.md) | **The important one.** Every call the wizard makes, in order, and what can fail at each |
| [04 — Security & RLS](04-security-and-rls.md) | You are touching any write path or wondering why something says "permission denied" |
| [05 — Edge Functions](05-edge-functions.md) | You are editing anything under `functions/` |
| [06 — Gotchas & History](06-gotchas-and-history.md) | **Read before debugging.** Seven real failures with their real causes |

---

## The one thing to understand first

**This module was NOT rebuilt when Organisation was.** ✅

Organisation and Attendance were rebuilt on the module/contract substrate. Onboarding was not — and
it still speaks the vocabulary of the schema Organisation replaced. Every failure found on
2026-09-02 was the same shape: *the schema moved, the caller did not*.

That is not a list of bugs. **It is one unfinished migration, surfacing a field at a time.**

If you are debugging something here, your first hypothesis should be *"what did Organisation rename
or drop that this still uses?"* — not *"what is wrong with my input?"*

---

## The 60-second version

Creating an employee is **not one write**. It is a five-step wizard that, along the way, creates an
auth user, verifies an email, sets a password, and only then writes any employee row:

```text
Step 1  Personal Details   ─┬─► create-employee-user   → auth user (NO employees row yet)
                            ├─► send-verification      → 6-digit OTP by email
                            ├─► verify-employee-code   → marks the email verified
                            └─► set-employee-password  → sets the login password
Step 2  Employment Info         (form only — nothing written)
Step 3  KYC & Banking           (form only)
Step 4  Emergency Contact       (form only)
Step 5  Review & Create    ────► create_employee_transaction  → the employees row + 5 side effects
                                 finalize-onboarding          → marks onboarding complete
```

**The auth user exists from step 1. The employee row does not exist until step 5.** Everything
between those two points is a half-created state, and the code has explicit machinery for it
(`employee_onboarding`, `check_onboarding_resumable`, the orphaned-auth-user guards). Understand
that gap or the error handling will look paranoid.

---

## Three things to remember on day one

1. **`create_employee_transaction` is one transaction doing six things.** It writes `employees`,
   `employee_onboarding_self`, `employee_reporting_relationships` (×2), `leave_balances` (one per
   active leave type) and `audit_logs` (×2). Any one of them failing rolls back all of it — which
   is correct, and is why a single missing column blocks the entire wizard.

2. **The legacy text columns are live seams.** `employees` still carries `employment_type`,
   `work_location` and friends *alongside* the FK columns Organisation introduced
   (`employment_type_id`, `location_id`, `org_unit_id`, `job_title_id`). Both are written. A CHECK
   constraint guards the text one and knows nothing about the lookup table feeding it. See `06` §5.

3. **HR types the employee's password and can read it.** That is the current design, not an
   oversight — and it is the thing most worth replacing. The invite flow that fixes it is queued as
   the first item of V1.1 (`doc/hrms_target_state_frd_2026-09-02.md` §9A).

---

## Status, honestly

| | |
|---|---|
| **Works end to end?** | ✅ Yes — verified 2026-09-02 on the live QA tenant |
| **Rebuilt on the substrate?** | ❌ No |
| **Self-service employee wizard** | Exists (`/employee/onboarding`), was writing four columns that do not exist until 2026-09-02 |
| **Draft resume** | Works, but deliberately drops the password — see `06` §7 |
| **Bulk / CSV import** | Does not exist |
| **Onboarding templates** | Do not exist. Offboarding has `exit_clearance_templates`; onboarding has no equivalent |
