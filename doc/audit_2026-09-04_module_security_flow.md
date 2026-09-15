# TalentMesh HRMS — Module, Security & Flow Audit

**Date:** 2026-09-04 · **Auditor:** live-verified against parent `rq3qmu8y` (not from docs).
**Scope:** every module's working state, vulnerabilities, the resource-management flow, the Policy
Center per module, and payroll's incomplete state. **Method:** every finding cites a live query
result or a current `file:line`. Doc claims were treated as hypotheses to test, not as facts.

> **One-line verdict.** The layer the team hardened — **table-level RLS** — is genuinely strong:
> tenant isolation *and* module gating are enforced on every content table. The real exposure sits
> in the three layers RLS does **not** automatically cover: **realtime**, **public storage buckets**,
> and a handful of **SECURITY DEFINER functions**. Fix those three and the security story is solid.

---

## 0. What changed since the docs were written (differential findings)

Several standing "known issues" in `CLAUDE.md` / memory are **already resolved** — recording so they
stop being re-raised:

| Standing claim | Live reality (2026-09-04) |
|---|---|
| "4 tables have RLS off (`tenant_settings`, `attendance_audit_logs`, `test_log`, `test_mcp_sync`)" | **All resolved.** `test_log`/`test_mcp_sync` no longer exist. `tenant_settings` = RLS on, 5 policies. `attendance_audit_logs` = RLS on, 1 policy. **Zero** public tables have RLS off. |
| "Prod admin key `ik_aaf7…` served publicly and still valid/unrotated" | **Rotated.** Live admin key is now `ik_99bf…`. `public/test-admin.html` was removed (commit `707b79e`); `test-admin*.js` contain no hardcoded key. |
| `tenant_settings` "a real cross-tenant leak" | **Fixed** — RLS on with `can_access_tenant()` + `is_hr()`. |
| `leave_min_notice_days` "browser-only" (settings inventory) | **Server-enforced** — `employee_apply_leave_request` reads the tenant_settings key and raises. |

Two tables show **RLS on with zero policies** — `rate_limits`, `attendance_device_auth_failures`.
That is *deny-all* for anon/authenticated (only SECURITY DEFINER writers reach them). Correct posture
for internal bookkeeping, not a hole.

---

## 1. Module-by-module working state

| Module | State | Enforcement backbone | Notes / gaps |
|---|---|---|---|
| **Directory / Org** (core) | Working | `employees` self-read + HR-write (7 policies), `employee_directory_public` VIEW for colleague lookup, broad SELECT on `employees` revoked | Employee-create refactor (`create_employee_transaction`) is **deploy-gated** in `migrations-pending-deploy/` — managed, not broken |
| **Attendance** | Working, hardened | Event log + derived day; scheduled derivation (591 runs logged); server-side multi-branch geofence; impossible-travel; selfie reconciliation | **1 IDOR** in break RPCs (§2.3); device↔fenced-site binding still open |
| **Leave** | Working, well-fenced | `employee_apply_leave_request` validates tenant access, notice, balance, probation, overlap — all server-side | Solid. `probation_restricted` / `requires_document` settings still inert (older finding) |
| **Tasks / Projects** | Working | `save_task_policy_transaction`, `submit/approve/reject_task_request` (DEFINER, concurrency-guarded) | Punch-out gate defaults open when tasks off — correct |
| **Policy Center** (core) | Working, now honest | Module-gated tabs shipped; 6 dead controls removed; "in-force" panel added | `salary_template_<dept>` still rendered, read by nothing (§4) |
| **Chat** | Table-safe, realtime-LEAKY | Tables have tenant isolation + module gate | **Cross-tenant realtime leak (§2.1) — highest-severity finding** |
| **Connect / Expenses / Insurance** | Working | module_gate + tenant_fence present on `posts`, `post_reactions`, `expenses`, `insurance_policies` | — |
| **Onboarding / Offboarding** | Working | `create_draft_employee`→`hr_activate_draft_employee`; `complete_exit_transaction`, `seed_exit_clearances` | HR-driven; SMTP now live via Resend so a self-service invite is now *possible* (§3) |
| **Payroll** | Incomplete (by design — built last) | Frontend calc engine exists (PT slabs, ESI periods, LOP methods); writes are **raw table writes**, not a locked txn RPC | §5 |

---

## 2. Vulnerabilities (ranked)

### 2.1 HIGH — Cross-tenant chat leak via realtime  (top finding)
**Evidence:** `metadata` → realtime `subscribe.policies: []`, `publish.policies: []`; `pg_policies`
in schema `realtime` = **none**. `src/shared/Chat.tsx:271-273` subscribes to the **global table
streams** `chat_messages`, `chat_channels`, `chat_channel_members`.

The chat *tables* are correctly fenced (`tenant_id = get_auth_tenant_id()`), so a **REST** read cannot
cross tenants. But InsForge realtime delivery is **not** gated by base-table RLS — it needs its own
policies on `realtime.channels` (subscribe) and `realtime.messages` (publish), of which there are
none. A global table stream broadcasts each changed row to **every** subscriber. Any authenticated
user of any tenant auto-subscribes the moment they open Chat, and would receive **every tenant's**
messages in real time. The victim need do nothing.

**Confidence:** architecturally confirmed (policy-absent + global stream + InsForge's own contract).
Recommend a 2-tenant live subscribe test to confirm exploitability before/after the fix.
**Fix:** publish DB changes to **tenant-scoped channel names** (`chat:<tenant_id>:<channel>`) via the
trigger, and/or add realtime subscribe/publish RLS scoped to `get_auth_tenant_id()`; switch the
frontend off the global streams onto the per-tenant pattern.

### 2.2 HIGH — Employee PII in PUBLIC storage buckets
**Evidence:** `metadata` storage → `employee-documents` **public**, 15 objects; `hr-policies`
public (1); `task-attachments` public (5); `employee-profile-photos` public (1).

A public InsForge bucket serves over HTTPS with **no auth and no RLS** — there is no tenant fence
possible on a public bucket. `employee-documents` typically holds ID proofs, PAN/Aadhaar, signed
contracts, bank details. Anyone with (or who can construct) the object URL downloads them, across all
tenants. The 18 `storage.objects` RLS policies protect only the *private* buckets and the upload path.
**Fix:** flip `employee-documents`, `hr-policies`, `task-attachments` (and `expense-receipts` before
it is used) to **private** + signed URLs. `employee-documents` is the priority.

### 2.3 MEDIUM — IDOR in break RPCs (no caller-identity check)
**Evidence:** `start_employee_break(p_attendance_id, p_tenant_id, p_break_type)` and
`end_employee_break(p_attendance_id, p_tenant_id)` — both SECURITY DEFINER, authenticated-callable.
They match the attendance row `WHERE id = p_attendance_id AND tenant_id = p_tenant_id` but **never
check the caller owns that row or belongs to that tenant** (no `get_auth_employee_id`, no
`can_access_tenant`). Any authenticated user can start/end breaks on any employee's session —
inflating break minutes (which feed over-limit penalties and derivation). The audit log even records
`actor_id = v_attendance.employee_id` — the **victim**, not the caller — so the tampering is
mis-attributed. **Fix:** add `IF NOT can_access_tenant(p_tenant_id) …` and bind the row to
`employee_id = get_auth_employee_id(p_tenant_id)` (mirror `punch_out_attendance`).

### 2.4 LOW–MEDIUM — `attendance_derivation_runs` world-readable across tenants
**Evidence:** `pg_policies` → `attendance_derivation_runs_all_read [SELECT] authenticated USING
(true)`; 591 rows across 6 tenants. Any authenticated user reads every tenant's derivation history
(tenant_ids, shift_ids, employee counts, error detail). Operational metadata, not PII, but a
cross-tenant leak. **Fix:** replace `true` with `can_access_tenant(tenant_id)`.

### 2.5 LOW — Email enumeration oracle
**Evidence:** `check_employee_exists_by_email(user_email)` — DEFINER, no tenant scope, no caller
check; returns whether an email is a registered employee **platform-wide**. **Fix:** scope to the
caller's tenant, or accept (used for onboarding dedupe).

> A full sweep of all **94 authenticated SECURITY DEFINER functions** for missing tenant/caller
> fences was run in parallel; §2.3 / §2.5 are confirmed samples. Full results in §2.6.

### 2.6 Full DEFINER-function fence sweep (all 94 read, findings spot-verified by me)

**Systemic root cause (verified):** `is_hr()` and `can_view_employee()` take **no tenant parameter**
— they check whether the *caller* is HR/manager in the *caller's own* tenant (`get_auth_tenant_id()`).
Used as the **sole** gate inside a DEFINER function that accepts `p_tenant_id`, they read like a
tenant check but prove nothing about the passed tenant. And because SECURITY DEFINER **bypasses RLS
entirely**, there is no restrictive `tenant_isolation` policy to save these — unlike the REST layer
(§2, verified: every content table's bare-`is_hr()` permissive policy is neutralised by a RESTRICTIVE
`tenant_id = get_auth_tenant_id()` that ANDs on top).

Of 94: **71 SAFE, 9 internal-helpers, 14 RISK.** RISK ranked by practical exploitability:

| Fn | Type | Precondition | Impact |
|---|---|---|---|
| **`set_employee_password_by_hr`** | WRITE | **MET — 9 of 31 accounts have null tenant** (live-checked) | Any HR user claims an unclaimed account into their tenant + resets its password + wipes its metadata/role. Account takeover. |
| **`check_rate_limit`** | WRITE | user_id (via `get_user_id_by_email`) | Caller-controlled tenant/user/limits, no JWT tie → pre-exhaust a victim's rate bucket to **lock them out of OTP/login**. Chains with the email oracle. |
| **`attendance_event_ingest`** | WRITE | same-tenant coworker id (visible in directory) | Tenant IS fenced, but `p_employee_id` is not tied to caller → **forge a coworker's punch** into the authoritative event log derivation trusts. |
| **`punch_out_attendance`** | WRITE | a foreign `attendance_id` UUID | **Cross-tenant** — `can_access_tenant` count = **0** (verified); only gate is param-blind `is_hr()`. An HR user force-closes any tenant's open session. |
| **`delete_chat_channel`** | WRITE | a foreign `channel_id` UUID | **Cross-tenant** — `DELETE … WHERE id = channel_id`, no tenant filter (verified). HR deletes any tenant's channel. |
| `punch_in_attendance` | WRITE | HR in own tenant | Intra-tenant: `p_employee_id` not existence-checked (siblings do) → dangling attendance rows. |
| `get_user_id_by_email` | READ | an email | Platform-wide email → `auth.users.id` oracle. |
| `check_employee_exists_by_email` | READ | an email | Platform-wide existence oracle (boolean). |
| `attendance_check_impossible_travel` | READ | an employee id | Returns a real `previous_punch_at` timestamp cross-tenant; repeated calls trilaterate last-punch location. |
| `increment_announcement_view` / `_dismiss` | WRITE | an announcement id | Cosmetic counter spam across tenants. |
| `close_stale_attendance`, `expire_location_exceptions`, `fn_cleanup_expired_onboarding`, `fn_auto_redmark_tasks` | WRITE | none | Zero-param bulk maintenance, no auth check — but **no chosen target** (only rows past an objective clock threshold). Defense-in-depth: add `is_admin()`. |

**Fix pattern for all cross-tenant ones:** add `IF NOT can_access_tenant(p_tenant_id) THEN RAISE`
at the top, and for employee-scoped writes bind to `get_auth_employee_id(p_tenant_id)` or
`EXISTS(SELECT 1 FROM employees WHERE id = p_employee_id AND tenant_id = p_tenant_id)` — the check
`hr_update_attendance`, `hr_set_employee_kiosk_pin` and siblings already carry. Retire the
`is_hr()`-as-tenant-check anti-pattern.

**Two follow-ups the sweep flagged, now resolved by me:**
- *"Do any RLS policies use bare `is_hr()`/`can_view_employee()` as their sole clause?"* — **No hole.**
  chat_messages/chat_channels/chat_channel_members/attendance/attendance_events/leaves/employees all
  carry a RESTRICTIVE `tenant_isolation`. The REST read layer is sound.
- `set_employee_password_by_hr` precondition — **9 unclaimed accounts exist**, so it is live, not
  theoretical. Prioritise it.

---

## 3. Resource-management flow — is it correct?

**Largely yes, and the design is mature.** The target-state FRD's module-contract model is sound and
worth preserving:
- **Core vs. sellable split is right:** `directory`, `work_calendar`, `policy_center` are core
  because turning them off would make other modules *wrong*, not merely absent. Verified `is_core` in
  the live catalogue.
- **Two invariants are correctly implemented:** (A) a module that is off is *silent, never wrong* —
  payroll refuses to run without attendance rather than paying ₹0 (`RunPayroll.tsx:169`); (B) turning
  a module off *never rewrites history* — derivation reads `leaves` ungated so past leave days do not
  re-derive as absent.
- **The table layer honours module independence:** module-gate + tenant-fence confirmed on every
  content table.

**Where the flow contradicts the vision — worth changing:**

1. **`seed_tenant_modules` enables every module for every new tenant** (`INSERT … SELECT NEW.id,
   m.key, true`). A product sold as *composable modules* ships **fully entitled by default**, so the
   module-independence machinery is never exercised in production (all 12 real tenants have
   everything on). **Recommendation:** seed only core + the modules on the signed plan; make
   entitlement a provisioning input. This single change turns "modules are independent" from
   architecture into product.
2. **SMTP is now live (Resend).** `resetPasswordMethod: "code"` works and mail can send. The standing
   "HR knows every employee password permanently" constraint is now a **choice, not a limitation** —
   move employee onboarding to the **invite flow** (employee sets their own password).
3. **Dead/unrouted surfaces still in the tree:** `src/hr/Settings.tsx` (669 lines, unrouted, raw
   upserts that bypass the concurrency guard) should be deleted; it overlaps Policy Center keys.

---

## 4. Policy Center — per module

**It works and it is now honest** (the 09-03/04 session fixed the "looks configured but changes
nothing" problem). Verified live:
- **Module gating shipped** — tabs gate on the owning module (`attendance / leave / salary→payroll /
  task / company`); previously zero gating.
- **Dead controls removed** — `late_mark_enabled`, `auto_punch_out`, `half_day_enabled` gone.
- **Salary keys reach enforcement** — `pf_wage_ceiling`, `esi_gross_ceiling`, `professional_tax_state`,
  `professional_tax_manual_amount`, `lop_calculation_method` are read by `payroll-calc.ts` /
  `RunPayroll.tsx`. Attendance policy lives on the `shifts` row and drives derivation.

**Remaining Policy Center suggestions:**
- **`salary_template_<dept>` is still rendered but read by nothing** — the department-template editor
  writes to a store no calculation reads. Remove during the payroll build (do not ship a control that
  lies).
- **`tenant_settings` has no module gate in RLS** (only `can_access_tenant` + `is_hr`), so Policy
  Center gating is *UI-only*. Acceptable (HR-only surface), but note: an HR user could still save a
  salary key on an attendance-only tenant via direct API. Low risk.

---

## 5. Payroll — incomplete, as expected

Confirmed state (the owner already flagged it as unbuilt / decision-locking pending):
- **Calc engine exists** in the frontend (`payroll-calc.ts`): Professional-Tax slabs, ESI
  contribution periods, LOP methods `calendar | fixed_26 | working_days`, working days from
  `work_calendar_working_days()`.
- **No hardened write path.** Unlike attendance/leave/tasks (which have DEFINER transaction RPCs with
  optimistic concurrency + audit), payroll persists via **raw `.from("payroll_runs" / "payslips")`
  table writes**. Before payroll is "done" it needs the same transaction-RPC treatment.
- **The "working-days source" switch is the real independence axis** (half-built as
  `lop_calculation_method`). Per the vision, payroll needs the *employee master*, not the org chart —
  so payroll-without-org-chart already works; the missing piece is `Attendance / Leave / Fixed /
  Imported CSV` as the days source. Build that when payroll is built.

---

## 6. Priority order (recommended)

1. **Realtime chat isolation (§2.1)** — highest severity, live now.
2. **DEFINER fences (§2.6)** — one migration adding `can_access_tenant(p_tenant_id)` to the RISK
   functions. `set_employee_password_by_hr` (9 accounts claimable) and `check_rate_limit` (login
   lockout) first; then `attendance_event_ingest`, `punch_out_attendance`, `delete_chat_channel`,
   the break RPCs (§2.3).
3. **`employee-documents` → private + signed URLs (§2.2)** — PII, one setting.
4. **`attendance_derivation_runs` policy (§2.4)** — replace `USING (true)`.
5. **`seed_tenant_modules` default (§3.1)** — product decision that unlocks the module story.
6. Housekeeping: delete `src/hr/Settings.tsx`, drop `salary_template_<dept>`, move to invite-based
   onboarding.
7. Payroll last, with a hardened write path and the working-days-source switch.

*No changes were applied by this audit — every finding carries remediation for the owner to action.*
