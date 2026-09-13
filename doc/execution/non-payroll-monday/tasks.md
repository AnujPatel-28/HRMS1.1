# TalentMesh non-payroll Monday execution tasks

Plan version: **v0.5**  
Status: **P1-00 CLOSED (reduced scope). P1-01 AUTHORIZED TO IMPLEMENT.**  
Baseline revision: `7214f8e3abeaef797d45122c7bc1129f0663cc43`  
Contract dependency: `contracts.md` v0.5

### v0.5 stage recalibration — read this before the gates below

v0.1–v0.4 were written as if this product were live. **It is not.** There are no customers, no real
employees and no real payroll; all 15 backend tenants are dummy data. The gate structure inherited a
production-risk framing that does not apply, and P1-00 consumed a disproportionate amount of the
build budget satisfying ceremony rather than removing risk.

The evidence for rebalancing came from P1-00 itself. Four static P6 contract reviews contacted no
backend and found nothing wrong with the environment. One read-only `schedules list` found an active
hourly cron on the test branch pointed at the production host — the exact cross-target contamination
the whole package exists to prevent. See `reviews/package-review-P1-00.md` B1.

**The rule from v0.5 onward.** Review effort goes to things that are *expensive to undo later*:
the authorization model shape, schema, and any applied migration. It does not go to harnesses,
fixtures or credential paperwork. Prefer thirty minutes of running commands against the backend over
another round of document review. A P6 PACKAGE review is required only where this document says so
explicitly; it is no longer the default for every package.

**What stays non-negotiable regardless of stage**, because it is expensive to reverse once written:
tenant isolation, no-self-approval, the §6 wire shape, and migration immutability.

## Execution controls

### Backend targets

- `BASELINE-RO`: linked `HRMS` project `0431f0f6-225f-4fb1-86b7-3fd32684c7f4`. Read-only comparison only. Never migrate, deploy, create users, mutate fixtures, alter schedules/storage/realtime or deploy frontend here.
- `TB-M1M2`: **AUTHORIZED.** A full backend **branch** of `BASELINE-RO` — `tb-m1m2`, project `fb9a8659-9950-4637-a58e-4a882ef24419`, `https://rq3qmu8y-j9g.ap-southeast.insforge.app`. Isolated database, storage, functions, realtime and schedules; **auth is NOT isolated — a branch shares the parent's `JWT_SECRET`**, so a token minted on either backend validates on the other. The branch therefore proves cross-**tenant** isolation only. Cross-**backend** isolation negatives run against `ISOLATION_CONTROL` (`38640ffd-91ee-48f9-bbc0-4bbd3a12337f`), which is separately keyed. A dedicated standalone project was attempted first and abandoned on evidence: `migrations/` is not a schema source and `db export` renders all 84 RESTRICTIVE policies PERMISSIVE. See `reconciliation.md` §1.
  - **Schedules on a new branch must be audited immediately after creation.** `branch create --mode full` clones schedules with their absolute `functionUrl` intact, pointing at the parent. This has already caused one live incident here.
- `LOCAL-CANDIDATE`: local Vite application pointed only at recorded `TB-M1M2`. No production deployment.

P1-00 records the exact `TB-M1M2` project ID without keys. The harness must compare it with fresh target metadata without printing privileged output and fail before any mutation on mismatch.

### Migration reservations

These paths are reserved but not created. The integration lead rechecks local, `migrations-pending-deploy/`, remote history and `TB-M1M2` immediately before creating each file.

**v0.5 erratum — all eleven names were renamed.** v0.4 reserved them with underscores in the name part
(`..._m1m2_access_capability_contract.sql`). The InsForge CLI rejects that — `Migration file names
must match <migration_version>_<migration-name>.sql` — and **110 of the repository's 111 existing
migrations already use hyphens**, so the reservation table had invented a convention the repo does not
use. Found by P1-01 the first time anyone actually ran the tool against one of these paths; four P6
contract reviews and the P1-00 package review all read past it, because none of them ran a migration
command. `reviews/contract-review-v0.4.md` still shows the old names — it is a dated record of what
v0.4 said and is deliberately not rewritten. **The names in this table are authoritative.**

| Version/path | Owner | Purpose |
|---|---|---|
| `migrations/20260912179500_m1m2-reproducibility-baseline.sql` | P1-00 | Reviewed public/storage/realtime policy and database-function baseline |
| `migrations/20260912180000_m1m2-access-capability-contract.sql` | P1-01 | Frozen capability seam and shared no-self guard |
| `migrations/20260912181000_m1m2-membership-grants-invites-ownership.sql` | P1-02 | Membership, grants, invite, audit and owner lifecycle |
| `migrations/20260912182000_m1m2-shared-work-calendar-resolver.sql` | P2-01 | Shared dated calendar/schedule resolution |
| `migrations/20260912183000_m1m2-dated-organization-transfer.sql` | P1-03 | Relationship scope, overlap and dated transfer |
| `migrations/20260912184000_m1m2-attendance-correction-consistency.sql` | P2-02 | Attendance/correction and exclusive punch-out gate ownership |
| `migrations/20260912185000_m1m2-device-kiosk-verification.sql` | P2-03 | Device/kiosk correction only if review proves necessary |
| `migrations/20260912186000_m1m2-leave-approval-absence-coverage.sql` | P2-04 | Leave integrity and absence projection |
| `migrations/20260912187000_m1m2-policy-privacy-versioning.sql` | P3-01 | Policy privacy/versioning |
| `migrations/20260912188000_m1m2-project-members-task-lifecycle.sql` | P3-02 | Explicit project membership/task lifecycle |
| `migrations/20260912189000_m1m2-communication-realtime-storage.sql` | P3-03 | Chat/Connect/notification realtime and storage |

Only the lead creates/applies migrations or changes the linked target. Writes are serialized. Applied migrations are immutable.

### Ownership and models

- P1: GPT-5.6 Sol high.
- P2: Sonnet 5 medium/high; fallback GPT-5.6 Sol high.
- P3: Sonnet 5 medium; use high for realtime/storage security; fallback GPT-5.6 Sol high.
- Independent P6: Opus 5; fallback GPT-6 Astra, then a separate GPT-5.6 Sol high review with same-model disclosure.
- Current Codex advertises Astra/Sol/Terra/Luna, not Sonnet/Opus. Tool-capable availability must be verified before dispatch.

## P1 — Access / Organization

### P1-00 — Guarded harness, target and reproducibility reconciliation

- **Owner:** Integration lead within P1; sole owner of environment and migration sequencing.
- **Model:** GPT-5.6 Sol high.
- **Status:** **CLOSED at reduced scope (v0.5).** Criteria 1, 3, 4, 6, 10 met and independently verified; 2 and 7 are the remaining closing work; 5, 9, 11 deferred with named owners.
- **Exact allowed files:**
  - `package.json`
  - `scripts/check-policy-drift.mjs`
  - `tests/m1m2/_harness.mjs` (new)
  - `tests/m1m2/_target.mjs` (new; identifiers only, no keys)
  - `tests/m1m2/fixtures/seed.mjs` (new)
  - `tests/m1m2/fixtures/reset.mjs` (new)
  - `tests/m1m2/fixtures/personas.mjs` (new, v0.5 — the P1-01 unblock; must not provision through `create-employee-user` / `create-hr-admin-user` / `set-employee-password`, which P1-02 is about to rewrite)
  - `doc/execution/non-payroll-monday/reconciliation.md` (new)
  - `migrations/20260912179500_m1m2-reproducibility-baseline.sql` (new, only after classification/review)
  - `functions/auth-signup/index.ts` (new local capture)
  - `functions/auth-session/index.ts` (new local capture)
  - `functions/auth-verify/index.ts` (new local capture)
  - `functions/admin-auth-login/index.ts` (new local capture)
  - `functions/daily-incomplete-task-marker/index.ts` (new local capture)
- **Dependencies:** `contracts.md` v0.5; `TB-M1M2` authorized (above); read-only access to deployed function/policy/config source. Credential rotation is no longer a dependency — see criterion 9. The expected function extensions must be adjusted in this plan and re-reviewed if retrieved source uses a different entrypoint.
- **Acceptance tests (v0.5 — rescoped; see the stage recalibration above):**

  **Closing criteria — P1-01 does not start until these are met.**
  1. A deliberate wrong-project run stops before mutation; full CLI output/credentials are never logged. **MET** — guard fails closed on all four vectors (`WRONG_PROJECT`, `BASELINE_RO_DENIED`, `BRANCH_LINEAGE_MISMATCH`, `CLI_ARGUMENT_DENIED`), self-test observed green by P6.
  2. The `TB-M1M2` fixture set provisions/resets synthetic Company A/B **and the personas P1-01 needs** — one employee-only and one composed employee+HR persona in Company A, one employee-only in Company B — deterministically and idempotently, via `tests/m1m2/fixtures/personas.mjs`. Non-employee Company Admin is explicitly **out of scope here** and moves to P1-02, which creates the membership tables that make that principal representable.
  3. No literal passwords, admin keys, schedule headers or personal data exist in harness/fixtures. **MET.**
  4. `check-policy-drift` covers `public`, `storage` and `realtime`. **MET.** It is *not* required to pass: the 50 untracked policies are pre-existing drift, recorded and owned by AC5 below, and blocking on them would stall every lane for a condition none of them created.
  6. The remote-only `20260812140000`, both `migrations-pending-deploy/` files and the untracked-applied `20260904120000` receive apply/defer/supersede/immutable decisions. **MET** — `reconciliation.md` §5.
  7. Deployed-only function bodies are captured locally **and dispositioned**: for each, does it enforce tenant scope, does it authenticate its caller, does it derive authority from anything but verified server state, and is it `keep` / `harden` / `delete`. A `delete` disposition removes that file from P1-02's list.
  8. `check-punch-out-gate` and `on-leave-reviewed` local/deployed diffs name an authoritative side. Required before **P2** edits either file — **not** a P1-01 gate.
  10. Reconciliation records the P6 C8 baseline erratum: committed history permits six relationship types. **MET** — verified against `migrations/20260813080000:106-113`.

  **Deferred — real work, tracked, not gating P1-01.** These were written as blockers under a production-risk framing that does not apply to a pre-launch backend of dummy data.
  5. Classify all 50 untracked `public`/`storage` policies intended/stale and land reviewed `intended` definitions in `20260912179500`, preserving `AS RESTRICTIVE` exactly. **Owner: P1-00 lead, due before the first customer backend is stood up.** The 32 public entries are the RESTRICTIVE tenant fence; the 18 `storage.objects` entries have never been under any gate and P3-01/P3-03 depend on them.
  9. Rotate the parent and branch API keys, record confirmation without values, and stop `package.json` invoking credential-embedding `scratch/` scripts. **Housekeeping, not a gate** — the leaked key protects dummy data. **Warning: rotating `anon-key` on the parent breaks the deployed Vercel frontend until its env vars are updated.** Do the admin key first, verify the app, then the anon key.
  11. Classify every database function `intended` / `stale` / other, explicitly including `exec_sql`, `query_json`, `update_user_password`, `close_stale_attendance`, `get_auth_tenant_id`, `can_access_tenant`, `is_superadmin` and `tenant_is_active`. SECURITY DEFINER, SQL-execution and password-setting functions must never be copied forward merely because a rebuild discovers them. The **rebuild-from-`migrations/`-alone** clause is withdrawn — see `contracts.md` §14.2 v0.5; it was never achievable because `migrations/` has never contained the core schema. It is replaced by the reviewed-snapshot requirement there.
- **Review requirements:** P6 PACKAGE review **complete** — `reviews/package-review-P1-00.md`, CHANGES REQUIRED. This v0.5 rescope is the lead's disposition of that review. Criteria 1, 3, 4, 6 and 10 are accepted as met on the reviewer's own independent verification; 2 and 7 are the remaining closing work; 5, 9 and 11 are deferred with named owners. **No further P6 review of P1-00 is required.**
- **Backend target:** `BASELINE-RO` read-only retrieval; all writes/tests on `TB-M1M2`; no production deployment.

### P1-01 — Capability seam, composed navigation, exclusions and shared approval guard

- **Owner:** P1 Access/Organization lane; owner of shared contexts/guards.
- **Model:** GPT-5.6 Sol high.
- **Status:** **AUTHORIZED TO IMPLEMENT** once P1-00 criteria 2 and 7 close. No P6 pre-authorization remains outstanding.
- **Exact allowed files:**
  - `src/types/access.ts` (new)
  - `src/contexts/AuthContext.tsx`
  - `src/contexts/TenantContext.tsx`
  - `src/App.tsx`
  - `src/modules.ts`
  - `src/shared/RequireModule.tsx`
  - `src/shared/NotificationBell.tsx`
  - `src/employee/EmployeeLayout.tsx`
  - `src/hr/HRLayout.tsx`
  - `src/hr/Directory.tsx`
  - `src/payroll/PayrollLayout.tsx`
  - `src/payroll/employee/EmployeePayrollLayout.tsx`
  - `migrations/20260912180000_m1m2-access-capability-contract.sql` (new, lead-created)
  - `tests/m1m2/p1_capability_contract.mjs` (new)
- **Dependencies:** P1-00 harness/reconciliation **and `tests/m1m2/fixtures/personas.mjs`**; `contracts.md` v0.5; `TB-M1M2` (authorized). P1-01 owns and freezes the §6 concrete wire shape in `src/types/access.ts`; P1-02 must implement it and may not redefine it.
- **Acceptance tests:**
  1. Employee-only sees My Work; HR+employee sees My Work, applicable Team and Administration. **v0.5: the non-employee Company Admin clause moves to P1-02 AC14.** That principal is not merely unseeded here, it is unrepresentable — `contracts.md` §6 requires `membershipId`/`membershipStatus`/`accessVersion`/`grants[]`, whose tables are created by P1-02's migration `20260912181000`, and every authority source available to P1-01 is employee-based by construction (`contracts.md` §2.5). P1-01 must still **design** the wire shape so the principal is expressible without an `employeeId`; it is P1-02 that demonstrates one.
  2. Capability/module failure renders unavailable/retry in every consumer and denies direct protected routes; no empty-screen/fail-open behavior.
  3. Capability summaries omit project/channel scopes until their backing packages pass.
  4. Client-modified roles/grants/modules cannot authorize a direct request.
  5. Direct GETs to `/payroll/employee/payslips`, `/payroll/hr/run`, `/hr/insurance` and `/employee/insurance`, plus corresponding APIs/jobs, are unavailable for excluded tenants.
  6. One shared server distinct-approver predicate returns the same denial class for self-approval and is the only approved predicate consumed by P2/P3.
  7. Task and leave notifications deep-link to the correct surface in a composed session; Directory/Team visibility matches server capability state.
  8. Build passes and allowed files add no lint findings beyond documented baseline.
- **Review requirements:** P6 PACKAGE review of wire shape, helper, direct-route/API evidence and composed navigation. A later package changing the wire shape requires renewed contract review, not silent adaptation.
- **Backend target:** `TB-M1M2`; `BASELINE-RO` comparison only; local UI on `LOCAL-CANDIDATE`.

### P1-02 — Named membership, templates, invitation, revocation, audit and ownership

- **Owner:** P1 Access/Organization lane; lead applies backend changes.
- **Model:** GPT-5.6 Sol high.
- **Status:** BLOCKED on P1-00, P1-01 shared seam, credential hygiene and `TB-M1M2`.
- **Exact allowed files:**
  - `migrations/20260912181000_m1m2-membership-grants-invites-ownership.sql` (new, lead-created)
  - `functions/create-hr-admin-user/index.js`
  - `functions/create-employee-user.ts`
  - `functions/finalize-onboarding.ts`
  - `functions/set-employee-password.ts`
  - `functions/verify-employee-code.ts`
  - `functions/accept-tenant-invitation/index.ts` (new)
  - `functions/manage-tenant-access/index.ts` (new)
  - ~~`functions/auth-signup` / `auth-session` / `auth-verify` / `admin-auth-login`~~ — **REMOVED in v0.5.** P1-00 criterion 7 dispositioned all four **DELETE**: they are the sister ATS product's functions, no HRMS code calls any of them, and `admin-auth-login` grants `super_admin` from an e-mail domain with no tenant fence. P1-02 inherits no handoff. See `reconciliation.md` §11.
  - `src/hr/UsersAccess.tsx` (new)
  - `src/hooks/useAuditLog.ts`
  - `tests/m1m2/fixtures/personas.mjs` (v0.5 — added so P1-02 can create the non-employee Owner and Company Admin that AC1, AC13 and AC14 require; P1-00 could not, because those principals are unrepresentable without this package's membership tables)
  - `src/App.tsx` (sequential handoff from P1-01)
  - `src/hr/HRLayout.tsx` (sequential handoff from P1-01)
  - `tests/m1m2/p1_membership_invitation_revocation.mjs` (new)
  - `tests/m1m2/p1_owner_lifecycle.mjs` (new)
- **Dependencies:** P1-00 decisions/captured auth functions; P1-01 predicates/wire shape; preservation of four existing limiter edits; accepted template mapping; `TB-M1M2` auth/email.
- **Acceptance tests:**
  1. Named non-employee Owner/Company Admin works without an employee row and cannot acquire one via route/supplied ID.
  2. Non-employee HR Admin, Manager, Project Manager and Communication Moderator receive association-required denial for operational actions—not a 500—and no fake employee is created.
  3. Legacy `is_hr()` workflows remain functional; HR without `access.manage` cannot insert/update/delete own or another `employee_roles` row.
  4. For every fixed template, each action present in the §4 matrix is permitted only at its stated scope, every absent action is denied, and cross-action scope union, self-escalation and title-derived authority fail.
  5. One invite is expiring, single-use and tenant/template/scope-bound; replay, expiry, tampering and wrong tenant fail.
  6. Acceptance/provisioning/recovery retry is idempotent; first-admin bootstrap works without an employee and cannot provision subsequent admins.
  7. Old revoked sessions are denied on the next enabled database/RPC/function/storage/realtime operation; any surface lacking this proof is disabled.
  8. Access mutations create exactly one server-written membership/account audit row; direct client `access.*` audit insertion is denied.
  9. Owner transfer uses pending acceptance then atomic swap; exactly one owner exists at every committed intermediate state; abandon/replay are safe.
  10. An ownerless fixture surfaces a provisioning defect and allows only the protected platform repair path; no implicit HR owner.
  11. Cross-tenant account/password/reset targets fail.
  12. The four preserved limiter edits pass employee-create and set-password smoke tests before and after this package.
  13. A non-employee Company Admin created through the normal membership path and through first-admin bootstrap can perform only the §4 Company Admin access/configuration actions on `org_units`, `job_titles`, `locations` and `employment_types`; both are denied leave approval and every other HR Admin action, bootstrap metadata does not satisfy legacy `is_hr()`, and out-of-row actions produce a deterministic denial rather than a 500.
  14. **(moved here from P1-01 AC1 in v0.5.)** A non-employee Company Admin sees Administration and **no personal record** — no My Work, no personal attendance/leave/payslip surface, and no fabricated employee row anywhere in the capability summary. This is the first package in which that principal is representable, because it creates the membership tables the §6 wire shape requires.
- **Review requirements:** P6 PACKAGE high-risk review of RLS/grants, legacy seam, invitation, revocation, server audit and owner lifecycle. Existing limiter diffs must remain attributable and reviewed.
- **Backend target:** `TB-M1M2` with synthetic accounts only; never mutate `BASELINE-RO`.

### P1-03 — Dated organization placement and reporting

- **Owner:** P1 Access/Organization lane.
- **Model:** GPT-5.6 Sol high.
- **Status:** BLOCKED on P1-00/P1-01/P1-02, P2-01 tenant-date primitive and dated-context review.
- **Exact allowed files:**
  - `migrations/20260912183000_m1m2-dated-organization-transfer.sql` (new, lead-created)
  - `src/contexts/AuthContext.tsx` (sequential handoff from P1-01)
  - `src/contexts/OrgUnitsContext.tsx`
  - `src/hooks/useOrgStructure.ts`
  - `src/hooks/useManagerView.tsx`
  - `src/hr/OrgStructureManagement.tsx`
  - `src/shared/pages/OrgChart.tsx`
  - `src/utils/managerCycleValidation.ts`
  - `src/utils/orgChart.ts`
  - `tests/m1m2/p1_organization_transfer.mjs` (new)
- **Dependencies:** P1 capability/membership; consumes the P2-01-owned tenant timezone/business-date primitive without redefining it; synthetic matrix organization; recorded precedence/synchronization for legacy manager fields.
- **Acceptance tests:**
  1. Designation/unit/relationship/access remain independent; an HR-sounding designation cannot perform an HR action.
  2. Same-tenant, non-self and acyclic rules are server enforced.
  3. Only `primary` grants direct-report scope; `secondary`, `mentor`, `project_manager`, `reviewer` and `temporary` each fail employee/attendance/leave manager-scope reads without another grant.
  4. No two primary intervals overlap, including boundary date D where outgoing `effective_to=D` and incoming `effective_from=D`; exactly one resolves on every date.
  5. Effective-date transfer changes current Team/direct-report scope; former primary loses it, history remains unchanged and client Team state matches server resolution.
  6. Workflows resolve eligible actors dynamically. New eligible primary/HR is recognized on next check; no eligible actor produces a visible blocked state. No stored reassignment is claimed.
  7. Cross-tenant manager/unit/designation IDs and overlapping unit assignments fail.
- **Review requirements:** P6 PACKAGE review of date exclusion, all six relationship types, compatibility precedence, cycle enforcement and historical immutability. P2/P3 review consumer contract.
- **Backend target:** `TB-M1M2` synthetic matrix fixture only.

## P2 — Attendance / Leave / Shifts / Devices

### P2-01 — Shared dated schedule and calendar resolver

- **Owner:** P2 Time lane.
- **Model:** Sonnet 5 medium/high; fallback GPT-5.6 Sol high.
- **Status:** BLOCKED on P1-00, P1-01 access contract and `TB-M1M2`.
- **Exact allowed files:**
  - `migrations/20260912182000_m1m2-shared-work-calendar-resolver.sql` (new, lead-created)
  - `src/hr/ShiftManagement.tsx`
  - `src/hr/Calendar.tsx`
  - `src/hr/HolidayList.tsx`
  - `src/hooks/useEmployeeShift.ts`
  - `src/utils/date.ts`
  - `tests/m1m2/p2_calendar_shifts.mjs` (new)
- **Dependencies:** P1-00 harness; P1-01 tenant/capability identity; accepted calendar contract; synthetic five/six-day and overnight fixtures. P2-01 exclusively defines the tenant timezone/business-date primitive consumed by P1-03 and other lanes.
- **Acceptance tests:**
  1. Five/six-day weeks, holiday, off-day and half-day resolve from one server contract.
  2. Effective employee assignment/default precedence and overlap/default conflicts are deterministic.
  3. Overnight interval resolves correct tenant business date.
  4. Missing assignment/default is an explicit gap; no fabricated Standard shift.
  5. Nullable cutoff regression passes; cross-tenant IDs fail.
- **Review requirements:** P6 PACKAGE review; P2-02/P2-04/P3-02 sign off the returned contract.
- **Backend target:** `TB-M1M2`; local UI only.

### P2-02 — Attendance, corrections and exclusive punch-out gate ownership

- **Owner:** P2 Time lane; sole owner of task-to-punch-out gate behavior.
- **Model:** Sonnet 5 high; fallback GPT-5.6 Sol high.
- **Status:** BLOCKED on P1-00 drift decision, P1-01 guard, P1-03 and P2-01.
- **Exact allowed files:**
  - `migrations/20260912184000_m1m2-attendance-correction-consistency.sql` (new, lead-created)
  - `functions/run-attendance-derivation/index.ts`
  - `functions/check-punch-out-gate/index.ts`
  - `functions/calculate-late-marks.ts`
  - `src/hr/Attendance.tsx`
  - `src/hr/AttendanceWorkspace.tsx`
  - `src/hr/components/EmployeeTimeline.tsx`
  - `src/hr/components/PunchTrailTray.tsx`
  - `src/employee/PunchInOut.tsx`
  - `src/utils/attendance.ts`
  - `tests/m1m2/p2_attendance_corrections.mjs` (new)
- **Dependencies:** P1-00 authoritative `check-punch-out-gate` side; P1-01 shared no-self predicate; P1-03 primary scope; P2-01 resolver.
- **Acceptance tests:**
  1. Attendance-only IN/OUT and `no_record` work without fabricated absence.
  2. An Employee uses `attendance.correction.request:self` to initiate the supported missing-OUT correction flow; performing/approving the correction remains a distinct authorized action, immutable raw evidence and audit are retained, and a locked correction fails.
  3. Late/replayed events and scheduled retry are deterministic/idempotent.
  4. Day/night derivation preserves provenance.
  5. Self-approval uses the shared denial class; direct-report/company/wrong-tenant actions enforce scope.
  6. With Tasks disabled, an employee with an unapproved task can punch out; re-enable and verify documented gate behavior resumes.
- **Review requirements:** P6 PACKAGE high-risk review. P3-02 may test but may not alter gate behavior or its migration.
- **Backend target:** `TB-M1M2`; do not change `BASELINE-RO` schedule.

### P2-03 — Kiosk and device adapter verification

- **Owner:** P2 Time lane.
- **Model:** Sonnet 5 medium/high; fallback GPT-5.6 Sol high.
- **Status:** BLOCKED on P1-00, hardware identity, P2-01/P2-02.
- **Exact allowed files:**
  - `migrations/20260912185000_m1m2-device-kiosk-verification.sql` (new only if reviewed correction required)
  - `functions/kiosk-punch/index.ts`
  - `functions/adms-cdata/index.ts`
  - `src/kiosk/Kiosk.tsx`
  - `src/hr/AttendanceDevices.tsx`
  - `tests/m1m2/p2_kiosk_device.mjs` (new)
  - `doc/execution/non-payroll-monday/evidence/p2-device.md` (new)
- **Dependencies:** P1-00 guarded target/fixtures; named phone/tablet; exact model/firmware/transport for biometric; P2 ingestion/derivation.
- **Acceptance tests:**
  1. Physical phone/tablet provisions and performs synthetic code/PIN IN/OUT.
  2. Wrong PIN, disabled device, wrong tenant and retry/replay behave safely.
  3. `adms-cdata` route/auth/timestamp/dedup/acknowledgement pass fixtures.
  4. Serial-only weak auth is not enabled silently.
  5. Physical, simulated, overnight-observed and not-run evidence remain distinct.
- **Review requirements:** P6 auth/dedup review; lead validates physical evidence. No hardware, no physical/biometric pass.
- **Backend target:** `TB-M1M2` isolated device only.

### P2-04 — Leave workflow and reversible absence coverage

- **Owner:** P2 Time lane.
- **Model:** Sonnet 5 high; fallback GPT-5.6 Sol high.
- **Status:** BLOCKED on P1-00 drift/evidence decision, P1-01 guard, P1-03 and P2-01.
- **Exact allowed files:**
  - `migrations/20260912186000_m1m2-leave-approval-absence-coverage.sql` (new, lead-created)
  - `functions/on-leave-reviewed.ts`
  - `src/employee/MyLeaves.tsx`
  - `src/hr/LeaveManagement.tsx`
  - `src/hooks/useLeaves.ts`
  - `src/utils/leave.ts`
  - `tests/m1m2/p2_leave_workflow.mjs` (new)
- **Dependencies:** P1-00 authoritative function side and verification whether `attendance_events` retains punches; P1 shared no-self/action scope; P1-03 dynamic eligibility; P2-01 calendar; known synthetic balances.
- **Acceptance tests:**
  1. Apply/approve/reject/cancel-pending/cancel-approved use server APIs and correct states.
  2. Requester with HR/Owner/Manager roles cannot review own leave and receives the shared denial class.
  3. Balances/counters remain correct across approve/cancel/retry without double debit.
  4. Five/six-day, holiday, overnight and dated shift/manager transfer resolve per date.
  5. Punch on D, approve backdated leave over D, then cancel: raw event and derived punch/evidence remain readable and day restores correctly.
  6. Partial sessions pass exact interval tests or are marked unsupported.
  7. Projects receive minimum availability only; Leave-only/disabled-Leave fixtures behave correctly.
- **Review requirements:** P6 PACKAGE high-risk integrity/privacy review. No substantial ledger redesign or historical balance invention.
- **Backend target:** `TB-M1M2` known synthetic balances only.

## P3 — Policy / Projects / Tasks / Chat / Connect

### P3-01 — Policy Center privacy, versioning and supported settings

- **Owner:** P3 Policy/Work/Communication lane.
- **Model:** Sonnet 5 medium; fallback GPT-5.6 Sol high.
- **Status:** BLOCKED on P1-00 reproducible private storage and P1 access contract.
- **Exact allowed files:**
  - `migrations/20260912187000_m1m2-policy-privacy-versioning.sql` (new, lead-created)
  - `src/hr/PolicyCenter.tsx`
  - `src/hr/PolicyUpload.tsx`
  - `src/employee/Policies.tsx`
  - `src/utils/policyValidation.ts`
  - `tests/m1m2/p3_policy_center.mjs` (new)
- **Dependencies:** P1-00 storage policy baseline/harness; P1-01 module state; P1-02 membership scopes; selected supported settings.
- **Acceptance tests:**
  1. Authorized publish/read/acknowledge preserves version/effective date/audience.
  2. Wrong tenant, unrelated peer, revoked user and disabled module cannot read/download/mutate.
  3. Anonymous, wrong-tenant and non-member GETs fail; post-revocation signed/private URL behavior is documented and tested.
  4. Acknowledgement is idempotent and never presented as rule enforcement.
  5. Supported setting changes are atomic and consumed; unsupported controls absent.
  6. Entitlement failure renders unavailable/retry in every Policy Center `hasModule` consumer, not an empty screen.
- **Review requirements:** P6 PACKAGE review of storage/RLS/action/version evidence.
- **Backend target:** `TB-M1M2`; no bucket change on `BASELINE-RO`.

### P3-02 — Projects, membership and task lifecycle

- **Owner:** P3 Policy/Work/Communication lane.
- **Model:** Sonnet 5 medium; fallback GPT-5.6 Sol high.
- **Status:** BLOCKED on P1-00/P1 capabilities, P1-03 and P2 availability.
- **Exact allowed files:**
  - `migrations/20260912188000_m1m2-project-members-task-lifecycle.sql` (new, lead-created)
  - `src/hr/TaskWorkspace.tsx`
  - `src/hr/TaskManagement.tsx`
  - `src/hr/pms/ProjectList.tsx`
  - `src/hr/pms/ProjectDetail.tsx`
  - `src/employee/MyTasks.tsx`
  - `src/employee/pms/EmployeeProjectView.tsx`
  - `src/hooks/useTasks.ts`
  - `src/utils/taskConstants.ts`
  - `functions/on-task-assigned.ts`
  - `functions/on-task-approved.ts`
  - `functions/on-task-rejected.ts`
  - `tests/m1m2/p3_projects_tasks.mjs` (new)
- **Dependencies:** P1-00 harness; P1-01 shared no-self predicate; P1-02 capability check; P1-03 reporting separation; P2-01/P2-04 availability; decision on direct-table substitutes.
- **Acceptance tests:**
  1. Explicit project membership, assignment, submit, review with reason, resubmit and archive use server APIs; HR Admin assigns/reviews at `company`, Manager assigns/reviews only at `direct_reports`, and Employee submits a non-project task at `self` as well as a project task at `project:<id>`.
  2. Employee-associated HR Admin through the legacy-compatible seam, Manager for a direct report and explicit Project Manager can review only at their §4 matrix scopes and are denied out of scope; raw metadata is not the task-review authority.
  3. Assignee cannot review own submission and receives the shared denial class.
  4. Project Manager is project-scoped and not a reporting manager; wrong tenant/non-member/unrelated peer fail.
  5. Notifications reach current authorized recipients and deep links recheck access.
  6. Projects-only works; with Tasks disabled, the P2-owned punch-out regression passes. This task may not change gate logic.
  7. Availability exposes no leave type/reason/document; retries do not duplicate submissions/notifications.
- **Review requirements:** P6 PACKAGE review of project membership/RLS/capability predicate/no-self and direct updates. P2 owns any punch-out repair.
- **Backend target:** `TB-M1M2` synthetic projects only.

### P3-03 — Chat, Connect and notification realtime/storage isolation

- **Owner:** P3 Policy/Work/Communication lane.
- **Model:** Sonnet 5 high; fallback GPT-5.6 Sol high.
- **Status:** BLOCKED on P1-00 policy baseline, P1 revocation and private storage/realtime access.
- **Exact allowed files:**
  - `migrations/20260912189000_m1m2-communication-realtime-storage.sql` (new, lead-created)
  - `src/shared/Chat.tsx`
  - `src/employee/Chat.tsx`
  - `src/hr/Chat.tsx`
  - `src/hooks/useChat.ts`
  - `src/shared/pages/Connect.tsx`
  - `src/shared/NotificationBell.tsx` (sequential handoff from P1-01)
  - `functions/auto-birthday-posts.ts`
  - `tests/m1m2/p3_chat_connect.mjs` (new)
  - `tests/m1m2/p3_realtime_isolation.mjs` (new)
- **Dependencies:** P1-00 reproducible storage/realtime policies; P1-02 current revocation; activated channel scope; private attachment plan; realtime configuration access; birthday eligibility/privacy decision.
- **Acceptance tests:**
  1. Channel/feed reads/writes enforce current audience/membership server-side.
  2. Two tenants with the same channel name: raw socket capture proves tenant B receives no tenant A chat/channel/notification payload before/after reconnect.
  3. `notifications:<employee_id>` cannot be subscribed to by another employee merely by knowing the ID.
  4. Revoked existing sockets receive no later payload and cannot reconnect to protected topics.
  5. Anonymous, wrong-tenant, non-member and revoked access to chat/task/employee/policy/expense attachment buckets is denied as applicable; previously issued URL behavior is recorded.
  6. Company Admin alone cannot read private channels; author/moderator controls are action-scoped.
  7. Duplicate message/reaction retries are idempotent/deduplicated; communication-only and disabled-module fixtures pass.
  8. Birthday automation passes removed-role, eligibility/privacy and duplicate-run tests or remains disabled/partial.
- **Review requirements:** P6 PACKAGE high-risk review with raw packet evidence, storage HTTP evidence and notification trigger/policy review. Client filtering is not evidence.
- **Backend target:** `TB-M1M2` only; no realtime/bucket/function change on `BASELINE-RO`.

## Integrated ordering and hold points

1. P6 re-reviews `contracts.md` and `tasks.md` v0.4. CHANGES REQUIRED keeps every task blocked.
2. P1-00 establishes the guarded harness, exact `TB-M1M2`, credential hygiene and reproducible policy/function/migration baseline.
3. P1-00 decides the remote-only migration, both `migrations-pending-deploy` files, applied-untracked migration, 32 public policies, storage/realtime policies, five deployed-only functions and two function drifts.
4. P1-01 freezes/implements the capability seam and shared no-self predicate. P1-02 consumes the frozen shape; it does not redefine it.
5. P1-02 implements only the narrow M1 transition: retain `is_hr()` for legacy HR, protect access writes, named Company Admin/Owner, invite/revoke/audit/owner lifecycle. Hold on self-escalation, cross-tenant, recovery, revocation or owner failure.
6. P2-01 freezes the tenant timezone/business-date primitive and shared calendar without depending on P1-03.
7. P1-03 consumes that primitive and freezes primary-only scope, all non-primary denials, date-overlap rules and dynamic eligible-actor behavior. P2-02 solely owns punch-out gate; P2-04 proves evidence preservation. P2-03 waits for hardware.
8. P3-01 then P3-02 then P3-03 within the lane. P3-02 only consumes the punch-out invariant.
9. Each package receives P6 PACKAGE review. Integrated two-tenant/synthetic/hardware evidence then receives P6 FINAL review. No production deployment is implied.

## Deadline assessment after P6

Full M1 + M2 Essential by 2026-09-14 EOD remains unlikely. The authorization problem is a dangerous existing fan-out—not just a missing table: about 68 policy bodies reference `is_hr()` and 26 consumers call `assert_hr_for_tenant`. M1 therefore keeps this legacy operational seam and narrowly protects access writes; universal resolver retirement is M2 Remaining.

Old-session revocation across database/RPC/functions/storage/realtime is the least likely Essential criterion. It cannot be claimed by updating invitation UI or one policy. Any enabled surface without proven freshness must be disabled and labelled incomplete.

Additional high risks are the absent harness/test backend, public/storage/realtime reproducibility, notification/chat socket isolation, physical kiosk/overnight evidence and biometric hardware. Failure of any Essential gate yields a reduced M1 internal-test candidate with an explicit incomplete matrix—not “M1 + M2 Essential complete.”
