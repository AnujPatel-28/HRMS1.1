# TalentMesh M1 + M2 Essential baseline

Status: **BASELINE COMPLETE — DRAFT FOR REVIEW; IMPLEMENTATION BLOCKED**  
Observed: 2026-09-12 IST  
Target: controlled internal testing by 2026-09-14 EOD IST  
Scope: non-payroll M1 + M2 Essential only. Payroll and Insurance are excluded.

This document records what was actually observed. It does not certify production readiness, authorize a deployment, or claim that an existing workflow passes. No production write, migration, deployment, user creation, or test-data mutation was performed.

## 1. Applicable instructions and sources

- Applicable repository instruction file: `C:/Users/Anuj/Desktop/hrms/AGENTS.md`. No deeper `AGENTS.md` was found in the target repository during the inventory.
- Milestone authority: `doc/non_payroll_implementation_roadmap_2026-09-12.md`, especially the revised M1 + M2 Essential scope.
- Product/access direction: `doc/company_administration_roles_direction_2026-09-09.md`.
- Execution/model guidance: `prompts/non_payroll_m1_m2_agent_prompts_2026-09-12.md`.
- Older documents were treated as context only. Live source and read-only backend inspection win where they disagree.

## 2. Source revision and working tree

| Item | Observed state |
|---|---|
| Repository | `C:/Users/Anuj/Desktop/hrms/HRMS-Talentmesh-Solutions` |
| Branch | `main` |
| HEAD | `7214f8e3abeaef797d45122c7bc1129f0663cc43` |
| HEAD subject | `Session handoff: policy centre, geofence, navigation` |
| HEAD authored | 2026-09-04 00:26:24 +05:30 |
| Upstream comparison | `origin/main`, 0 ahead / 0 behind at inspection time |
| Staged changes | none |
| Tracked modifications | 4 files, 51 insertions and 11 deletions |
| Untracked paths | 18 |

### Existing uncommitted user changes — preserve exactly

Modified tracked files:

- `functions/create-employee-user.ts`
- `functions/finalize-onboarding.ts`
- `functions/set-employee-password.ts`
- `functions/verify-employee-code.ts`

The four edits move rate-limit checks to the server/admin client and distinguish a limiter failure from a genuine limit hit. They are existing user work. They must not be reverted, recreated, or folded into an unrelated change.

Untracked paths present before these execution artifacts were created:

- `doc/Roughpicture.md`
- `doc/audit_2026-09-04_module_security_flow.md`
- `doc/company_administration_roles_direction_2026-09-09.md`
- `doc/discussionOnProduct_validaation.md`
- `doc/non_payroll_implementation_roadmap_2026-09-12.md`
- `doc/product_direction_review_2026-09-09.md`
- `doc/product_validation_2026-09-09.md`
- `doc/qa/RESULTS-2026-09-02.md`
- `doc/role_permission_map_2026-09-09.md`
- `doc/session_context_2026-09-04-definer-hardening.md`
- `migrations/20260904120000_harden-definer-tenant-fences.sql`
- `prompts/non_payroll_m1_m2_agent_prompts_2026-09-12.md`
- `scratch/qa-accrual-grant-check.mjs`
- `scratch/qa-leave-suite.mjs`
- `scratch/qa-orgchart-check.mjs`
- `scratch/qa-rate-limit-check.mjs`
- `scratch/qa-tasks-attendance-suite.mjs`
- `scratch/qa-tasks-suite2.mjs`

The untracked migration `20260904120000_harden-definer-tenant-fences.sql` is already recorded as applied on the linked backend. It is immutable for future work; any correction must be a new forward migration.

## 3. Local frontend and application baseline

### VERIFIED

- The application is React/Vite/TypeScript with `@insforge/sdk` declared at `^1.2.5`.
- Tailwind is pinned to 3.4.17, consistent with repository instructions.
- `src/App.tsx` still uses mutually exclusive `hr` and `employee` route guards. A person with HR responsibilities does not receive a composed My Work/Team/Administration experience from a single authoritative capability set.
- `src/contexts/AuthContext.tsx` derives `superadmin | hr | employee` primarily from user metadata/profile and employee lookup. It has no tenant-membership/access-version/action-scope capability contract.
- `src/contexts/TenantContext.tsx` fails open when module entitlement loading fails: the error path leaves modules unknown and `hasModule` returns true.
- Payroll and Insurance routes/source are still present. Backend tenant entitlements also leave these modules enabled for most tenants; exclusion is not currently enforced end to end.
- `src/shared/RequireModule.tsx` is a presentation redirect, not a security boundary.
- `src/hooks/useEmployeeShift.ts` fabricates a client-side fallback “Standard shift” when configuration is missing or loading fails. This hides a configuration gap and conflicts with the shared-calendar contract.
- `src/hr/Attendance.tsx` has an explicit display-only `no_record` state and does not fabricate absence rows in the inspected path.
- The nullable shift cutoff normalization exists and should be retained as a regression target.
- Chat and Connect subscribe to generic realtime topics and filter tenant IDs in the browser. Browser filtering is not an authorization control.
- Projects infer participation from manager/visibility/task data; no `project_members` table exists.
- Current leave screens use server RPCs in the inspected active apply/cancel/approve paths, but an older direct-write hook remains. Behavioral authorization has not been proven.
- Current task screens use server RPCs in important submit/review paths, while direct task updates/inserts also remain. Behavioral authorization has not been proven.
- A local `functions/auto-birthday-posts.ts` exists but no deployed function with that slug was found.

## 4. Linked backend and deployment state

The linked backend was inspected read-only through InsForge CLI 0.1.73.

| Item | Observed state |
|---|---|
| Linked project | `HRMS` (`0431f0f6-225f-4fb1-86b7-3fd32684c7f4`) |
| Region / backend | `ap-southeast` / `https://rq3qmu8y.ap-southeast.insforge.app` |
| Backend version | 1.0.0 |
| Database inventory | 70 tables |
| Active edge functions | 20; runtime reported running |
| Storage buckets | 15 |
| Active schedules | 1 attendance-derivation schedule |
| Current public site | `https://rq3qmu8y.insforge.site` returned HTTP 200 with title `Decommissioned` |
| Latest recorded frontend deployment | production-targeted Vercel record marked READY, but only 3 files / 1,125 bytes; not a usable candidate |
| Isolated test backend | **MISSING**; branch listing was denied and no separate non-production project was verified |

No write target is authorized. Until a dedicated non-production backend with its own database, auth, storage, functions and schedules is identified, all implementation and mutating tests remain blocked. A schema-only branch is insufficient for this release because function, auth, storage, realtime and schedule behavior are in scope.

### Authentication

- Google and GitHub OAuth providers are configured.
- SMTP is configured and email verification is required; delivery was not tested.
- Public sign-up is enabled.
- Password minimum length is 6 and no complexity requirements were reported.
- Allowed redirect URLs were reported empty.
- The CLI emitted privileged credential material while returning project/schedule state. Values are deliberately omitted here. Rotation before implementation/testing is a blocker requiring separately authorized infrastructure work.

### Deployed function parity

Exact local/deployed normalized-source comparison was completed for locally present deployed functions.

| Function | Parity |
|---|---|
| `create-employee-user` | exact match, including current uncommitted user edit |
| `finalize-onboarding` | exact match, including current uncommitted user edit |
| `set-employee-password` | exact match, including current uncommitted user edit |
| `verify-employee-code` | exact match, including current uncommitted user edit |
| `create-hr-admin-user` | exact match |
| `run-attendance-derivation` | exact match |
| `adms-cdata` | exact match |
| `kiosk-punch` | exact match |
| `calculate-late-marks` | exact match |
| `on-task-assigned` | exact match |
| `on-task-approved` | exact match |
| `on-task-rejected` | exact match |
| `check-punch-out-gate` | **drift: local and deployed differ** |
| `on-leave-reviewed` | **drift: local and deployed differ** |
| `auto-birthday-posts` | local only; not found deployed |
| `auth-signup`, `auth-session`, `auth-verify`, `admin-auth-login`, `daily-incomplete-task-marker` | deployed source has no matching local path in the inspected function inventory |

`insurance-expiry-check` is deployed even though Insurance is excluded. No corresponding schedule was listed, but deployment alone means exclusion is not fully reconciled.

The active attendance derivation schedule runs hourly at minute 20. Its last/next execution timestamps were current at inspection time. This proves scheduling metadata, not correct attendance results.

## 5. Database and authorization baseline

### Migration parity

- Remote migration history contains 111 versions; the active local `migrations/` directory contains 110.
- Every active local migration version is recorded as applied remotely.
- Remote-only version: `20260812140000` (`entrypoint-hardening`).
- Local pending-directory versions `20260902120000` and `20260902130000` were not recorded as applied.
- The untracked local `20260904120000_harden-definer-tenant-fences.sql` is applied remotely and must never be edited in place.
- Policy drift check found 32 live policies across 275 live policies that are not represented in active migrations. A reproducible schema cannot yet be built from the repository alone.

### Relevant live tables and estimated rows

RLS was enabled on all inspected public application tables. Representative estimates: 15 tenants, 23 employees, 16 org units, 19 unit assignments, 8 reporting relationships, 3 employee-role rows, 10 shifts, 15 employee-shift assignments, 49 attendance rows, 10 attendance events, 1,827 derivation runs, 7 leave requests, 38 leave-balance rows, 9 leave types, 1 project, 3 tasks, 4 task submissions, 7 chat channels, 6 channel memberships, 12 chat messages, and no posts/reactions.

Counts are inventory only; they do not establish data correctness.

### VERIFIED access/schema facts

- `tenant_memberships`, `memberships`, `invitations`, `access_grants`, `role_templates`, `project_members`, and `leave_ledger` do not exist under the checked names.
- `employee_roles.employee_id` is required. Current access roles cannot represent a non-employee administrator.
- Only three active role rows were observed, all `owner` rows across three tenants. Existing ownership is employee-bound, allows at most one active owner, and does not provide a complete transfer/last-owner lifecycle.
- `employee_roles` stores role-level scope. It does not provide per-action scope grants.
- `employee_roles_hr_all` lets any current HR principal perform all operations on role rows within the tenant. Combined with broad HR resolution, this is a structural self-escalation risk and does not meet protected access-authority requirements.
- `is_hr()`/related helpers still depend on metadata and employee roles. Metadata remains load-bearing for several backend/frontend paths.
- `is_manager_of()` treats primary manager, secondary manager, and any current reporting relationship identically. Secondary management is therefore blanket manager scope today.
- Reporting relationships are effective-dated and constrain relationship type to `primary` or `secondary`; only one open active primary is indexed per employee.
- Unit assignments are effective-dated. A complete atomic unit/manager transfer and pending-approval reassignment flow was not found/proven.
- `approve_leave_request`, `approve_task_request`, and `reject_task_request` re-derive an HR identity, but do not reject self-approval. An HR employee can structurally satisfy both requester/assignee and reviewer checks.
- `hr_schedule_shift_change` validates tenant, active employee, active shift, future effective date, and audits the operation through `assert_hr_for_tenant`.
- `approve_leave_request` computes working dates from the shift on the leave start date, falls back to a tenant default, and then to a hard-coded six-day week. It does not use the shared work-calendar RPC and does not support schedule changes inside the leave range.
- Calendar/attendance helpers exist (`tenant_business_date`, `work_calendar_holiday`, `work_calendar_working_days`, `attendance_resolve_shift`), but no single server contract resolving dated schedule, holiday and approved absence together was found.
- Leave uses aggregate counters and a `day_fraction`; no leave ledger or verified session/interval coverage representation exists.
- Module policies exist on many public tables and `tenant_has_module` fails closed at the database level. The frontend entitlement context still fails open, and edge/storage/realtime coverage is not uniform.
- Payroll is enabled for 14 of 15 tenants and Insurance for 13 of 15. All internal-test fixtures must explicitly disable both.

### Realtime and storage

- `realtime.channels` and `realtime.messages` reported RLS disabled and zero policies.
- Enabled realtime patterns include generic chat table/topics and wildcard notification topics; permission arrays were empty.
- Client code filters tenant payloads after receipt. Cross-tenant/private-channel socket isolation is **BROKEN until proven otherwise** and is a release blocker.
- Nine buckets are marked public, including `chat-attachments`, `employee-documents`, `hr-policies`, and `task-attachments`.
- Storage policies also permit broad same-tenant employee-document operations, while the bucket itself is public. Private attachment/document criteria are **BROKEN until bucket URL behavior and policy migration are corrected and tested**.

## 6. Tests and checks actually run

| Check | Result | Meaning |
|---|---|---|
| `git status`, revision, upstream comparison, diff inventory | PASS | Working tree and existing user changes captured |
| Repository/source inventory with `rg` | PASS, with no `tests/` directory found | Existing implementation paths identified |
| `npm run build` | PASS | Vite compiled 2,312 modules; largest JS chunk about 2.54 MB and exceeded the configured warning threshold |
| `npm run lint` | **FAIL** | 246 findings: 214 errors and 32 warnings; lint is not a passing release gate |
| `npm run check:policy-drift` | **FAIL** | 32 of 275 live policies are untracked in active migrations |
| `npm run test:hrms-workflows` | **NOT RUN — UNSAFE** | Scripts contain embedded credentials/PII/real identifiers and mutate live backend state; one changes leave status without restoration |
| Scratch QA scripts | **NOT RUN — UNSAFE/UNCONTROLLED** | Several authenticate and mutate backend rows using hard-coded identifiers; they are not a safe synthetic fixture suite |
| Read-only CLI metadata/current/functions/storage/schedules/deployments/migrations/schema queries | PASS where noted | Established live inventory/parity; did not test business behavior |
| InsForge branch list | **BLOCKED** | Insufficient permissions; isolated backend not established |
| InsForge advisor | **BLOCKED** | Access denied |
| InsForge DB diagnostics | INCONCLUSIVE | Returned empty sections; cannot be interpreted as healthy |
| Frontend public endpoint GET | PASS as an HTTP check, **BROKEN as deployment** | Endpoint is reachable but serves a decommissioned page |
| Physical kiosk/biometric tests | **NOT RUN** | No registered device and no hardware/model/firmware/transport supplied |
| Auth email/OAuth delivery | **NOT RUN** | Configuration exists; delivery/login journeys were not exercised |

There is no declared unit-test runner in `package.json`. The only workflow test command is currently unsafe against the linked backend. Before execution, tests need synthetic fixtures, environment-supplied credentials, deterministic cleanup/restore, a hard guard against the linked parent/production target, and explicit project-ID validation.

## 7. Status matrix

### VERIFIED

- Source revision, dirty-tree contents, local build status, lint status and policy-drift status.
- Linked backend inventory, active functions, buckets, schedules, migration versions and selected live authorization definitions.
- Exact parity for the function set listed above and exact drift for two deployed/local functions.
- Existing effective-dated org/shift foundations and attendance evidence/derivation foundations.
- Missing membership/invitation/action-grant/project-membership/leave-ledger tables under the checked names.
- Current deployment endpoint is decommissioned.

### UNKNOWN / NOT VERIFIED

- A safe isolated test project, its ID, credentials, test users, function/storage/schedule parity, and reset procedure.
- Actual email invitation delivery, OAuth behavior, password reset/recovery, redirect safety and idempotent provisioning.
- Behavioral cross-tenant access for every RPC/table/file/socket path.
- Correctness of attendance derivation, retries, corrections, overnight schedules, holidays and current leave balances.
- Whether partial-day leave maps to operational intervals/sessions.
- Device protocol compatibility, physical kiosk behavior and any biometric adapter.
- The source/configuration of deployed-only functions and whether they are reproducible.
- Browser-level usability of the current app against a non-production backend.
- Whether the 32 untracked live policies are intended or stale.

### BROKEN relative to M1 + M2 Essential

- No usable current frontend test deployment.
- Lint gate and policy-drift gate fail.
- Frontend entitlement loading fails open.
- Exclusive HR/employee identity presentation blocks combined responsibilities.
- Secondary managers receive blanket manager scope.
- No-self-approval is absent in inspected leave/task review functions.
- Realtime authorization is absent at the realtime schema and clients rely on post-receipt filtering.
- Sensitive-looking buckets/attachments are public and same-tenant employee-document access is too broad for private-document criteria.
- Local/deployed function and source inventory drift exists.
- Payroll/Insurance exclusion is not enforced across current tenant entitlements/deployments.

### MISSING relative to M1 + M2 Essential

- Tenant membership independent of employment.
- Fixed, server-enforced role templates with per-action scopes.
- Non-employee administrator lifecycle.
- Secure expiring single-use invitation flow.
- Current-session revocation/version enforcement across database, RPC, functions, storage and realtime.
- Protected owner transfer and last-owner guarantees.
- Explicit project membership and private-channel access contracts.
- One shared dated calendar/schedule/approved-absence resolver.
- Safe, repeatable synthetic integration tests and a full non-production backend target.
- Physical test device/hardware evidence.

## 8. Blockers and gate decision

1. **No isolated write/test backend.** The linked `HRMS` parent remains read-only for this effort. P1/P2/P3 must not start mutating work without a named non-production project containing all required services.
2. **Credential exposure/fixture hygiene.** Privileged CLI output and existing scripts exposed credential material to local execution logs/source. Values are not copied here. Rotate affected credentials and replace embedded test credentials before using the test harness.
3. **Contract review is mandatory.** `contracts.md` is a proposed freeze, not approved. Independent P6 CONTRACT review must complete before shared security implementation.
4. **Schema reproducibility is incomplete.** Reconcile the remote-only migration and 32 live-only policies before trusting a fresh environment.
5. **Realtime/private storage are release blockers** for Chat/Connect/attachments unless repaired and negatively tested.
6. **Hardware is unavailable/undefined.** Kiosk can only be labelled simulated until a real phone/tablet test is performed; biometric remains conditional on an exact device/protocol.
7. **Deadline risk is high.** W2 membership/invite/revocation/ownership is absent rather than partially finished. A reduced M1 candidate may be possible; claiming full M1 + M2 Essential by Monday is not credible without immediate environment access and clean first-pass reviews.

Gate decision: **HOLD P1/P2/P3 IMPLEMENTATION.** Review this baseline and `contracts.md`, establish the isolated backend, resolve credential handling, and record the approved backend target before any implementation package begins.
