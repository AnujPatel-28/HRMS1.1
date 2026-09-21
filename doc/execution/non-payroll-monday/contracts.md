# TalentMesh M1 + M2 Essential shared contracts

Contract version: **v0.5**  
Status: **ACTIVE.** v0.4 accepted by P6 (`reviews/contract-review-v0.4.md`); v0.5 changes §14.2 only, on the P1-00 package review's finding that the v0.4 rebuild clause was unsatisfiable. Every other clause is v0.4 unchanged.  
Review sources: `reviews/contract-review.md`, `reviews/contract-review-v0.2.md` and `reviews/contract-review-v0.3.md`, Opus 5 CONTRACT reviews dated 2026-09-12 IST  
Scope: non-payroll internal-test candidate only

No P1/P2/P3 implementation may begin until P6 accepts this revision. These are behavioral contracts, not a speculative database redesign. Implementers may extend the current schema only through the smallest reviewed forward migrations that satisfy them. Existing authority must remain usable until its replacement is proven; transition work must not widen access.

## 1. Terms and invariants

- **Account:** one authenticated human identity. Shared administrator credentials are forbidden.
- **Tenant membership:** the account’s tenant-specific relationship. It can exist without an employee association.
- **Employee association:** an optional link from a membership to one employee in the same tenant. Its absence never creates a synthetic employee.
- **Responsibility/template:** a fixed bundle of permitted actions. It is not a designation or job title.
- **Grant:** one action paired with one allowed scope for one active membership.
- **Owner:** separately recorded protected account authority. Ownership is not employment, HR permission, or a job title.
- **Capability summary:** server-derived current access information for presentation. The client cannot submit it as authorization proof.
- **Current context:** the tenant, membership, optional employee and effective date/time used to authorize an operation.

Every allow decision is:

`active membership AND enabled module AND action/scope match AND record-state eligibility AND workflow eligibility`

Tenant isolation, revocation, no-self-approval, protected-owner rules and dated context are mandatory. Multiple roles may add action-specific grants, but scopes must never be unioned across unrelated actions.

## 2. Membership, employment and M1 compatibility

1. An account may hold one active membership per tenant and memberships in more than one tenant.
2. Each membership has a tenant, account, lifecycle status, access version and audit timestamps/actors.
3. A membership may reference zero or one employee in the same tenant. The employee association is not an authority source by itself.
4. In M1, Owner and Company Admin may be non-employees. A non-employee Company Admin holds only the Company Admin actions enumerated in §4: access administration plus company-configuration actions on organization units, designations, locations/employment configuration and reporting. Those configuration writes use the same narrow server capability path as other per-action grants and never require or confer legacy `is_hr()`; personal and operational HR workflows remain unavailable.
5. In M1, operational HR Admin, Manager, Employee, Project Manager and Communication Moderator actions require an active employee association because existing workflow actor/reviewer columns and helpers are employee-based. A non-employee assigned one of these templates receives a deterministic, user-facing ineligible/association-required denial—not a server error and never a fabricated employee row. General non-employee operational actors are M2 Remaining. A Company Admin without an employee association receives the same association-required denial if it attempts an action outside its enumerated Company Admin row.
6. An employee with administrative responsibilities keeps My Work and, when applicable, Team alongside Administration.
7. An inactive/revoked membership has no protected tenant access even if old JWT metadata or an employee role still says `hr`.
8. Employee termination does not silently transfer or delete ownership. Membership and employment lifecycles are explicit and audited.
9. No account can acquire an employee association by opening a route or supplying an employee ID. Association is a protected server operation.
10. For M1 compatibility, auth metadata remains the bootstrap writer for the first tenant administrator; membership/`employee_roles` is the writer for subsequent grants. `is_hr()` remains the legacy operational HR gate. Retiring the metadata branch and converging on one authority resolver is M2 Remaining.
11. The first-admin bootstrap path is narrow, server-owned and tested end to end without a pre-existing employee row. The resulting principal is limited to Owner plus the exact Company Admin action row in §4; bootstrap metadata must not make that principal satisfy legacy operational `is_hr()` or grant HR Admin actions. The path cannot grant later principals authority.

## 3. Supported scopes and action evaluation

M1 + M2 Essential defines these scopes:

| Scope | Meaning |
|---|---|
| `self` | The membership’s associated employee only; unavailable without an employee association |
| `direct_reports` | Employees with a current effective **primary** reporting relationship to the actor; self excluded |
| `company` | Records in the active tenant, subject to action and field sensitivity |
| `project:<id>` | One explicit current project membership and project role |
| `channel:<id>` | One explicit current channel membership and channel role |

`project:<id>` is unavailable and must not be advertised until P3-02 provides and enforces project membership. `channel:<id>` must not be advertised until P3-03 proves server-side channel and realtime enforcement. Unsupported scopes/selectors are absent, not optimistic placeholders.

Rules:

1. Every grant names exactly one action and one scope. A company-scoped `employee.basic.read` grant does not widen any sensitive read/write/export/approval action.
2. Project/channel scopes are current server membership checks, not caller-supplied IDs or cached arrays.
3. Direct-report scope resolves only from the primary relationship contract in §9.
4. Deny is the default on missing membership, unavailable module state, unknown action/scope, tenant mismatch, revoked status or stale access version.
5. Database/RPC, function, storage and realtime paths independently enforce the same result. UI guards are presentation only.
6. M1 does not introduce arbitrary org-unit/location combinations, implicit descendants, wildcard project/channel scopes, configurable custom roles or title-derived scope.

## 4. Fixed templates

Initial templates are immutable bundles in the UI. Custom role editing is deferred.

| Template | Required intent | Default scope | M1 employee requirement and exclusions |
|---|---|---|---|
| Company Admin | Company configuration and, only when separately included, named users/access management | `company` | Employee association optional; no operational HR approval, ownership transfer, payroll or insurance |
| HR Admin | Employee administration, attendance/leave operations and HR policy administration | `company` for listed HR actions | Active employee association required in M1; does not grant `access.manage`, ownership, payroll/insurance, project management or communication moderation |
| Manager | Team basic information and explicitly supported operational approvals | `direct_reports` | Active employee association required; no tenant-wide HR, access management, sensitive export or non-primary blanket scope |
| Employee | Personal records and requests | `self` | Active employee association required; cannot approve own work |
| Project Manager | Project setup/member/task review for explicit projects | `project:<id>` | Active employee association required in M1; not a reporting manager or HR authority |
| Communication Moderator | Moderate permitted content for explicit channels/company feed where granted | `channel:<id>` or explicit company-feed action | Active employee association required in M1; Company Admin alone gains no private-channel access |

Owner is not a template. Owner may be a non-employee and may separately hold Company Admin. Ownership does not automatically confer HR workflow authority.

Minimum distinct actions for this milestone:

- access: `membership.read`, `membership.invite`, `membership.revoke`, `membership.employee_associate`, `access.manage`, `owner.transfer`
- organization: `org.read`, `org.manage`, `reporting.manage`, `designation.manage`
- employees: `employee.basic.read`, `employee.sensitive.read`, `employee.write`, `employee.export`
- attendance/shifts/devices: `attendance.read`, `attendance.correction.request`, `attendance.correct`, `attendance.approve`, `shift.read`, `shift.manage`, `device.manage`. `attendance.correction.request` is the employee’s self-scoped request action; it is distinct from performing or approving a correction.
- leave: `leave.read`, `leave.request`, `leave.approve`, `leave.configure`
- policy: `policy.read`, `policy.publish`, `policy.acknowledge`, `policy.configure`
- projects/tasks: `project.read`, `project.manage`, `project.members.manage`, `task.assign`, `task.submit`, `task.review`
- communication: `channel.read`, `channel.manage`, `message.send`, `message.moderate`, `feed.read`, `feed.post`, `feed.moderate`

The fixed template-to-action contract is:

| Template | `self` | `direct_reports` | `company` | `project:<id>` | `channel:<id>` |
|---|---|---|---|---|---|
| Company Admin | — | — | `membership.read`, `membership.invite`, `membership.revoke`, `membership.employee_associate`, `access.manage`, `org.read`, `org.manage`, `reporting.manage`, `designation.manage` | — | — |
| HR Admin | — | — | `org.read`, `employee.basic.read`, `employee.sensitive.read`, `employee.write`, `employee.export`, `attendance.read`, `attendance.correct`, `attendance.approve`, `shift.read`, `shift.manage`, `device.manage`, `leave.read`, `leave.approve`, `leave.configure`, `policy.read`, `policy.publish`, `policy.configure`, `task.assign`, `task.review` | — | — |
| Manager | — | `employee.basic.read`, `attendance.read`, `attendance.approve`, `leave.read`, `task.assign`, `task.review` | `org.read`, `policy.read` | — | — |
| Employee | `employee.basic.read`, `employee.write`, `attendance.read`, `attendance.correction.request`, `shift.read`, `leave.read`, `leave.request`, `policy.read`, `policy.acknowledge`, `task.submit` | — | `org.read`, `policy.read`, `feed.read`, `feed.post` | `project.read`, `task.submit` | `channel.read`, `message.send` |
| Project Manager | — | — | `org.read` | `project.read`, `project.manage`, `project.members.manage`, `task.assign`, `task.review` | — |
| Communication Moderator | — | — | `feed.read`, `feed.post`, `feed.moderate` | — | `channel.read`, `channel.manage`, `message.send`, `message.moderate` |

Every action absent from a template row is denied unless another assigned template independently grants it. Each populated cell is limited to its stated scope; no column or scope is inherited across rows. `owner.transfer` belongs only to the separately protected Owner authority in §5, not to any template.

This matrix is normative for every workflow surface named by P2/P3 acceptance criteria. If a required workflow action or scope is absent or contradictory, implementation remains blocked until a reviewed contract revision changes the matrix or the workflow acceptance criterion; an implementation agent may not invent or broaden authorization.

For the M1 configuration surface, `org.manage` covers organization-unit, location and employment-type configuration; `designation.manage` covers job-title/designation configuration; and `reporting.manage` covers reporting relationships. This mapping makes the four existing `is_hr()`-gated configuration tables named in the P6 review testable through the narrow Company Admin capability path.

Files and realtime subscriptions are authorized through their corresponding business action and record scope. A generic authenticated session is insufficient. Payroll and Insurance actions are absent from every candidate template.

## 5. Protected users, legacy HR seam, ownership and audit

1. Only an active Owner or a membership with current `access.manage:company` can invite, associate employees, assign/revoke templates or inspect access audit history.
2. HR Admin and legacy `is_hr()` do not imply `access.manage`.
3. For M1, `is_hr()` remains unchanged as the broad legacy operational-HR gate. A separate narrower server predicate governs `employee_roles`/membership/grant writes. Do not attempt a partial rewrite of the approximately 68 HR policy bodies and 26 `assert_hr_for_tenant` consumers.
4. A caller cannot grant an action/scope they are not authorized to administer and cannot self-escalate. Direct `employee_roles` insert/update/delete by HR without `access.manage` is denied while existing HR workflows remain functional.
5. Membership/grant mutations are server-side, tenant-derived, atomic and audited with membership/account actor identity, subject, prior/new state, reason/correlation and timestamp. The browser-authored `useAuditLog` hook does not satisfy this requirement and direct client insertion of `access.*` audit events is denied.
6. External IP lookup is not required for the M1 protected audit trail. The existing client `api.ipify.org` behavior is an out-of-scope privacy decision and must not become the access-audit authority.
7. User enumeration and access audit output require access-management authority.
8. The database permits **at most one** active Owner per tenant. A tenant with zero owners is an explicit provisioning defect surfaced to platform administration; it must not grant implicit ownership to HR.
9. Initial assignment from an ownerless tenant is a distinct protected provisioning/repair operation with an audit trail. Existing tenants are not silently backfilled from job title or HR metadata.
10. Owner transfer uses a pending-transfer artifact/state for target acceptance. Pending acceptance is not an active owner row. Completion atomically swaps source to target while preserving exactly one active owner at every committed read; abandon/expiry retains the source owner and retry is idempotent.
11. Company Admin naming must not conceal incomplete owner assignment, transfer or last-owner behavior.
12. Account recovery/password operations derive tenant and subject server-side, preserve rate limits and reject cross-tenant targets.

## 6. Server-derived capabilities

The frozen v0.4 wire contract is conceptually:

```text
tenantId
membershipId
membershipStatus
employeeId?                 // absent for non-employees
accessVersion
responsibilities[]          // fixed template identifiers for display
grants[] { action, scopeType, scopeId? }
enabledModules[]
unavailableReason?          // explicit error/retry state, never silent allow
issuedAt
contractVersion             // "v0.4"
```

- P1-01 freezes the concrete field names and serialization in its owned access type/contract; P1-02 implements that wire shape and may not redefine it.
- The summary is recomputed from authoritative server state and contains no secrets.
- The client uses it to compose My Work, Team and Administration.
- The server never trusts client-submitted roles, grants, employee/tenant IDs, module flags or access versions as proof.
- Failure produces explicit unavailable/retry and denies protected actions.
- A scope with no backing enforcement is omitted.
- Sensitive fields are omitted unless the exact action/scope permits them.

## 7. Uniform no-self-approval

1. One P1-owned server predicate/guard defines distinct-approver behavior and a common denial class. Attendance, Leave and Tasks call it rather than reimplementing identity logic.
2. The employee/requester/submission owner cannot approve, reject, correct, waive or finalize their own controlled request.
3. Owner, Company Admin, HR Admin, Manager and Project Manager status do not override this rule.
4. Approval execution re-derives actor, subject, current action/scope, module state and record state inside the transaction.
5. A user may withdraw/cancel their own request only where the workflow state supports it.
6. If no distinct eligible approver exists, the request has an actionable blocked state; it never auto-approves.
7. The same synthetic human holding employee + HR + Manager + Project Manager responsibilities must be denied consistently in attendance correction, leave and task review.

## 8. Revocation and existing sessions

1. Every access-affecting mutation increments the membership access version atomically.
2. On the next protected operation, a revoked/inactive/stale-version session is denied. Waiting for JWT expiry is insufficient.
3. This applies to every enabled candidate surface: database/RPC, edge function, private storage and realtime. A surface without proven freshness enforcement is disabled and labelled incomplete; partial inconsistent retrofit is not accepted.
4. Long-lived subscriptions are reauthorized or disconnected when membership, project/channel membership, module entitlement or access version changes.
5. Client caches/navigation refresh after denial. Offline/cached data is not current authorization.
6. Previously downloaded data cannot be recalled and must not be claimed as revoked.
7. Revocation retry is idempotent and server-audited.
8. Full retirement of legacy `is_hr()` and a universal single authority resolver remain M2 Remaining; this does not waive existing-session revocation on enabled M1 candidate paths.

## 9. Reporting relationships and approval eligibility

The persisted model may contain `primary`, `secondary`, `mentor`, `project_manager`, `reviewer` and `temporary` relationship types. Only `primary` yields `direct_reports` scope.

- **Primary:** one current effective relationship used for Team/direct-report scope and, only where a workflow explicitly supports it, dynamic approval eligibility.
- **Secondary, mentor, project_manager, reviewer and temporary:** contextual relationships only. None grants blanket employee, attendance, leave, approval or sensitive-data access. Independent grants/project/channel roles remain possible.
- Existing M1 approval workflows resolve eligible actors dynamically at read/execute time. No stored pending approver or reassignment record is claimed.
- Leave approval remains HR-only unless a reviewed P2 change explicitly implements a manager approval action. The contract does not infer manager approval from team visibility.
- On a manager transfer, workflows that use primary-manager eligibility resolve the new primary at the next check and exclude the former primary. If the current eligible set is empty, the request is visibly blocked.
- True stored approver assignment/reassignment is M2 Remaining.
- M1 keeps legacy `employees.manager_id`/`secondary_manager_id` as compatibility inputs. The server resolver gives a current effective primary relationship precedence and uses legacy `manager_id` only for not-yet-migrated rows; writes go through one server operation that keeps compatibility fields consistent. Retiring them is M2 Remaining.

## 10. Dated organizational context

1. Unit assignment, primary relationship, designation, grade, location and employment status are independent facts resolved for an explicit `asOf` in tenant time.
2. No two active primary relationships may overlap on any date. Boundary-day overlap (`outgoing.effective_to = incoming.effective_from`) is either rejected or normalized so exactly one primary resolves.
3. A basic transfer schedules new unit and/or primary manager with an effective date. Same-tenant, non-self and acyclic rules are server-enforced.
4. On the effective date, the new primary gains current permitted scope and the former primary loses it on the next operation.
5. Pending workflows use dynamic current eligibility as defined in §9; when no eligible actor remains they show a blocked state. M1 does not claim stored approver reassignment.
6. Past decisions, attendance and audits retain the identity/context at creation; transfer does not rewrite history.
7. Designation/title never confers authority, including HR-sounding titles.
8. Cross-tenant manager/unit/designation IDs are denied server-side.

## 11. Calendar and approved-absence coverage

Attendance, Leave and project availability share dated resolution of tenant timezone/business date, effective shift interval, holiday/off-day state and approved absence.

1. Employee assignment overrides the default only within its effective interval; missing configuration returns a gap and never a fabricated Standard shift.
2. Leave computes working coverage per date across schedule changes and holidays rather than using only the start-date shift.
3. Project availability receives minimum interval/fraction only, not leave reason/type/documents.
4. Approve/cancel/retry is transactional and idempotent.
5. A leave projection may change derived status, but raw event rows and evidence columns—including existing punch timestamps—must not be nulled or destroyed. Backdated approval and cancellation must remain reversible.
6. Substantial ledger migration/reconciliation is M2 Remaining; known synthetic opening balances are required for M1 tests.
7. Partial session/interval support either passes exact tests or is marked unsupported.

## 12. Disabled modules and excluded products

1. Missing/unavailable entitlement state denies protected access and renders an unavailable/retry state, not an empty screen or silent allow.
2. A disabled module denies new mutations, subscriptions, files and jobs while retaining historical data.
3. Every `hasModule` consumer renders explicit unavailable state during entitlement failure.
4. Direct routes are gated: `/payroll/employee/payslips`, `/payroll/hr/run`, `/hr/insurance` and `/employee/insurance` are unavailable for the candidate, as are corresponding APIs/jobs.
5. Payroll and Insurance actions are absent from templates and disabled for every synthetic candidate tenant.
6. Disabling Tasks cannot trap punch-out; P2 owns the gate and P3 only runs consumer regression.
7. Projects-only, Leave-only, Attendance-only and communication-only fixtures work without unrelated modules.
8. UI guards remain presentation only; server enforcement is mandatory.

## 13. Invitation contract

One M1 invitation flow is named, expiring, single-use and tenant/template/scope-bound. It is server-generated, contains no backend credential and uses a pending artifact rather than active authority.

- Replay, expiry, wrong tenant, tampering and unauthorized inviter fail deterministically.
- Acceptance/recovery is idempotent and creates no duplicate membership/grant.
- The first-admin bootstrap is separate from normal invitation and cannot be replayed for later admins.
- Employee association is a separate protected operation.
- A non-employee Company Admin can complete the flow. A non-employee operational template is recorded as association-required under §2.5, not failed with a 500.

## 14. Evidence, migration safety and review

1. P1-00 owns the guarded synthetic harness, exact backend target, fixture reset, migration/policy/function reconciliation and credential-rotation evidence before any lane implementation.
2. **(v0.5)** Reproducibility comparison covers policies in `public`, `storage` and `realtime` **and database-function definitions**. P1-00 identifies every database function required by a rebuild; compares each against `BASELINE-RO` and repository definitions; classifies each as `intended`, `stale` or another explicit disposition; records every disposition; and permits only reviewed `intended` definitions into `20260912179500`. The review must explicitly disposition `exec_sql`, `query_json`, `update_user_password`, `close_stale_attendance`, `get_auth_tenant_id`, `can_access_tenant`, `is_superadmin` and `tenant_is_active`. SECURITY DEFINER, SQL-execution and password-setting functions must not be copied forward merely because a rebuild discovers them.

   **The v0.4 clause "`TB-M1M2` is not reproducible until a clean rebuild succeeds from `migrations/` alone" is WITHDRAWN.** It was never satisfiable and no implementation effort could have satisfied it: `migrations/` is a 110-file incremental changelog applied on top of a schema created in the dashboard, and no SQL in this repository creates `public.tenants` or `public.employees` — 45 referenced objects are created by no repo file. `db export` is disqualified as a substitute on measurement: it drops all 70 primary keys, every GRANT/REVOKE, and renders all 84 RESTRICTIVE policies PERMISSIVE, which would silently convert every tenant fence into a grant.

   **Replaced by:** M1 reproducibility is *a reviewed baseline snapshot plus `migrations/` applied on top*. The snapshot is a faithful platform-level capture — InsForge `backups create`, or `pg_dump --schema-only` via `db connection-string` — not a hand-rolled export. Repository-only reproducibility is real, still owed, and scheduled as named work rather than assumed; it is not a gate on M1.

   **Why this is scheduled and not dropped:** with no repository schema source there is no way to stand up staging, onboard a second environment, or rebuild after a loss, and this project has no backup/DR policy. It is cheapest to fix now, while all data is dummy. After launch it becomes a restore-path problem.
3. The remote-only migration, both `migrations-pending-deploy` files, deployed-only function bodies and local/deployed function drifts receive an explicit apply/defer/supersede/authoritative-side decision.
4. Existing browser-authored audit and external IP lookup are not evidence of protected server audit.
5. Each package reports exact revision, changed files, backend target, tests pass/fail/not-run and limitations.
6. High-risk packages receive P6 PACKAGE review; the integrated candidate receives P6 FINAL review.
7. Any code patch invalidates affected prior acceptance. Reviewer acceptance is not production authorization.
8. Any unmet Essential criterion is labelled incomplete; it is not hidden behind navigation or a reduced template.

## 15. P6 v0.1 finding dispositions

| Findings | v0.2 disposition |
|---|---|
| C1 | Non-employee Company Admin/Owner supported; operational templates require employee association in M1 and deny gracefully |
| C2 | P1-00 harness/reconciliation task added in `tasks.md` |
| C3–C4 | Pending owner-transfer artifact + atomic swap; at-most-one owner and explicit ownerless provisioning defect |
| C5–C6 | Keep legacy `is_hr()`/metadata bootstrap for M1; narrow access-management writes; single resolver deferred |
| C7, C9, C20 | All six relationship types covered; only primary grants scope; no date overlap; dynamic eligibility and blocked state replace fictional stored reassignment |
| C8 | P1-00 must record the baseline relationship-type erratum; `baseline.md` was not edited because this revision request was limited to contracts/tasks |
| C10–C14 | Frozen v0.2 wire contract; shared no-self guard; server audit ownership; direct excluded routes; populated migration table in `tasks.md` |
| C15–C18 | Pending migrations, gate ownership and public/storage/realtime reproducibility assigned to P1-00/P2/P3 |
| C19 | Evidence columns/punch timestamps cannot be nulled; backdated leave reversibility test required |
| C21–C22 | Notification/Directory ownership and composed deep-link/title-negative tests added |
| N1–N8 | Preserved as explicit verification gates in P1-00 and consuming packages; no runtime claim added |
| S1–S5 | Unavailable-state consumer test, scope activation, contract version and manager-UI coordination added; external IP lookup documented as deferred privacy decision |

This v0.4 remains **unaccepted** until another P6 CONTRACT review records an acceptance verdict.

## 16. v0.5 amendments — 2026-09-21

**A1 — HR Admin defaults (user decision, 2026-09-21).** The HR Admin template gains two
catalogue grants, overriding §4's "does not grant … project management or communication
moderation" for these two actions only:
- `channel.manage` at `company` — create/manage company chat channels and their membership.
  **Not** `channel.read` of private channels and **not** `message.moderate`: HR manages channels
  but cannot read a private channel's messages unless a member.
- `project.read` at `company` — read-only visibility of all projects. **Not** `project.manage`,
  `project.members.manage` or `task.review` at project scope.
Both are ordinary `access_template_grants` rows, so a tenant can remove them. The Communication
Moderator template also gains `channel.manage` at `company` (channel creation needs a company-scope
action; §4 listed it only at `channel:<id>`).

**A2 — Realtime freshness (P3-03 Tier 1).** The InsForge realtime server does not revoke an
already-joined socket when policy changes; reconnect is refused. §164 is satisfied for realtime by
**identifier-only payloads plus fresh RLS refetch**, not by socket termination. A realtime payload
must never carry content.
