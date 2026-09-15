# TalentMesh HRMS — product validation and recommended direction

Reviewed 9 September 2026. This is an advisory review of current source and the linked live InsForge backend, not a declaration that every workflow passes end-to-end tests. No application code, backend data, permissions, functions, DNS, or deployments were changed.

## Verdict

Keep the multi-tenant, modular product direction. A shared React application, tenant subdomains, a platform administration console, and a company administration workspace are appropriate foundations. The product needs a coherent permission model and reliable provisioning before a broad customer launch. Another wholesale rewrite is unnecessary.

The crucial distinction is between the software provider's authority, a customer's account ownership, a customer's operational HR permissions, and an employee's own access. These are currently compressed into too few roles.

## Evidence and freshness

Priority used: current live definitions/configuration; current source; September 4 session notes and audit; September 2 target-state FRD; older documents as historical context. A recent filename is not evidence of deployment. Likewise, a feature table, an active edge function, and a green build do not prove a working user journey.

Read the September 4 hardening handoff, September 4 module/security audit, September 3/4 navigation and policy handoff, September 2 target-state/vision documents and QA results. Inspected current routing, role/tenant contexts, module registry, company creation, manager views, and relevant local functions.

Live inspection covered metadata, migration history, selected PostgreSQL function definitions and grants, relevant RLS policies, module distribution, and diagnostics. All 20 deployed edge functions are listed active. Source was inspected for `create-hr-admin-user`, `create-employee-user`, `set-employee-password`, and `run-attendance-derivation`; the other 16 have not received a complete source/security audit in this review.

Current snapshot: 15 tenants, 23 employee records, 13 module types, 195 tenant/module records. Several tenant modules are disabled, so it would be inaccurate to say every existing tenant has everything enabled. The INSERT trigger still enables every module for a newly created tenant.

Corrections to earlier documentation:

| Earlier claim | Current evidence |
|---|---|
| September 4 hardening is unapplied | Migration `20260904120000` appears in live history; inspected break/password definitions contain its guards; authenticated execution of `check_rate_limit` and `attendance_event_ingest` is false. Do not apply the old migration again. |
| Existing tenants lack the work-calendar module record | All 13 module keys have 15 tenant records today. This gap is resolved in the current dataset. |
| Derivation-run history leaks across tenants because SELECT uses `true` | The live table also has RESTRICTIVE `tenant_isolation`, `tenant_active_restrictive`, and module policies. They constrain the permissive rule. The old cross-tenant conclusion is unsupported by the current policy composition. Ordinary employees may still have broader within-company operational visibility than needed. |
| Public tables have RLS disabled | A catalog query found no public ordinary tables with RLS disabled. Policy quality, column grants, views, and definer functions still need separate assessment. |

`npm run build` passed (TypeScript and Vite). The main JavaScript bundle is approximately 2.54 MB minified / 629 KB gzip, and Vite warned about its size. This supports route/module lazy loading; it is not a measured browser performance result.

`diagnose --json` returned 4 active connections of 30, no sampled slow queries or locks, 98.9% cache-hit ratio, and no errors in the returned log samples. Advisor and metrics were unavailable with access-denied errors: there is no clean Advisor certification. The installed CLI did not recognize `memory`. The vendor skill/agents URLs failed through browsing; official realtime docs were obtained through the CLI instead.

## Current findings and priorities

### P0 — onboarding functions and the new rate-limit grant conflict

Live `has_function_privilege('authenticated', check_rate_limit, 'EXECUTE')` is false. Both deployed `create-employee-user` and `set-employee-password` create a client with the caller's `edgeFunctionToken`, invoke this RPC through that client, and return HTTP 500 on `rateLimitErr`.

This is a verified deployment compatibility defect. The expected result for a normal authenticated HR caller is failure at the rate-limit check. No employee creation or password-reset attempt was performed to reproduce it because that would mutate accounts and potentially send mail.

Local evidence: `functions/create-employee-user.ts:223`, `:241`, `:253`; `functions/set-employee-password.ts:104`, `:105`, `:116`; `migrations/20260904120000_harden-definer-tenant-fences.sql:15`. The migration comment claiming there are no legitimate authenticated callers is contradicted by the deployed edge sources.

Fix as a coordinated release: authenticate the caller, resolve tenant membership and employee-management permission on the server, check tenant status, then call the internal limiter with server credentials using a verified actor and server-controlled limits. Alternatively, expose a narrowly scoped authenticated wrapper that derives these values itself. Do not simply restore broad execution on the caller-parameterized helper. Validate onboarding, verification, password setup, retries, and rate-limit exhaustion together.

### P0 — confidential storage remains public

Live `employee-documents` is public with 15 objects; `task-attachments` is public with 5; `hr-policies` is public with 1. `chat-attachments` and `expense-receipts` are also public, currently empty. The contents of these files were not downloaded, so this review does not claim which personal fields they contain.

Make confidential categories private and authorize downloads by tenant, employee/record scope, and permission. Generate short-lived signed URLs only after access checks. Public company logos may remain public. Test old stored URLs and document previews during the change; changing visibility without updating consumers can break onboarding and HR screens.

### P0 — realtime isolation needs its own boundary

Live metadata and `pg_policies` show no realtime subscribe/publish policies. Live `notify_chat_message` publishes full rows to the global `chat_messages` topic, and `notify_chat_channel` publishes rows to `chat_channels`. `src/shared/Chat.tsx:271` subscribes to these global names.

This is a high-priority architectural exposure; cross-tenant receipt was not reproduced with two live sessions. Do not treat base-table RLS or client-side filtering as protection for explicitly published payloads.

Use tenant-and-conversation-scoped topics with authenticated membership policies, module/status checks, and appropriate publish restrictions. Tenant scope alone is insufficient for private conversations within one company. Apply equivalent checks to notifications and attachments. Remove the global publishing path. Test removal from a room, tenant suspension, and logout on an already connected socket: the current InsForge realtime docs describe existing subscriptions retaining receipt until unsubscribe/reconnect, so revocation requires explicit lifecycle handling.

### P1 — the role model differs between UI, database, and edge functions

`src/types/index.ts:1` permits only `hr`, `employee`, and `superadmin`. `src/App.tsx:154`, `:193`, `:207`, and `:219` use exclusive role gates. A metadata-HR user is therefore excluded from the employee self-service routes, including their own payslips and leave.

Meanwhile, live `is_hr()` accepts either metadata role `hr` OR an active `employee_roles.role = 'hr_admin'`. `AuthContext` does not resolve those assignments, and deployed `create-employee-user` insists on metadata role `hr`. A delegated HR administrator can therefore be recognized in SQL but rejected by the edge/UI layers. This needs one authoritative permission resolution contract.

Manager detection currently counts employees with `manager_id`, while the product also has effective-dated reporting relationships. Define which source controls current team scope and historical approvals, and make all clients use that contract. Do not infer authority from a job title or org-chart depth.

### P1 — account recovery and provisioning need redesign

Live password-reset SQL still allows claiming a target with no tenant and rebuilds its metadata as employee/tenant. The new privileged-role check prevents some targets, but it is not proof that a target belongs to the requesting company's onboarding process. Use a verified invitation/membership or tenant-owned draft association. Null tenant metadata is not sufficient authorization.

The deployed employee-creation function also has a risky account-recovery path: it may delete and recreate an auth user after an email lookup. Its age check requires a different tenant even though that case has already returned, so the intended cooldown is ineffective. Employee lookup errors return false, which can incorrectly look like an orphan. Fix this path before restoring the rate-limit dependency; require positive evidence of an owned, recoverable onboarding attempt and preserve identities rather than deleting them on an email match.

Company provisioning inserts the tenant in React and then calls `create-hr-admin-user`. That edge verifies platform authority and tenant status, which is good, but auth-user creation and metadata assignment are separate operations. A later failure can leave partial state; the browser's tenant-delete compensation does not fully reverse auth creation. Use a server-side provisioning job with an idempotency key, explicit steps, retry/reconciliation, and a recoverable failure status.

### P1 — entitlements and setup are not yet a complete product flow

Live `seed_tenant_modules` inserts all modules with `enabled = true`. New tenants should receive core capabilities plus explicitly purchased/trial entitlements. Trial breadth and expiry should be deliberate inputs. HR administrators should configure licensed modules but should not grant paid entitlements to themselves. The inspected `tenant_modules` policies already separate platform writes from tenant reads; retain that boundary.

`TenantContext.tsx:187` deliberately shows all modules if entitlement loading fails. Prefer an explicit unavailable/retry state for optional modules. Missing entitlement information must not be treated as enabled, empty data, or zero-valued payroll input.

Company creation still displays manual Vercel/GoDaddy DNS instructions and a temporary HR password. It does not include a complete first-run company configuration wizard. A provisioned login is not yet a configured HRMS.

## Recommended ownership and permission model

Use **Platform Admin** for TalentMesh staff, **Company Owner** for the customer's accountable account holder, **Company Admin** for delegated tenant administration, and **HR Admin** for operational HR. The initial customer contact can hold Owner + Company Admin + HR Admin in a small business. Keep the concepts distinct so a larger company can separate them later.

Call the tenant workspace **Company Administration**, with **HR Administration** and **Policy Center** inside it. “HR Admin” is a role; “HR admin panel” is a UI area. Creating a company should invite a named owner/first administrator, not create a shared panel login.

| Role | Recommended initial scope | Typical authority | Default exclusions |
|---|---|---|---|
| Platform Admin | Platform | Provision/suspend tenants, plans, entitlements, domain status, platform audit | Routine employee records, salary data, private conversations; any support access separately authorized, temporary, audited |
| Company Owner | One tenant | Account ownership, billing contacts, owner transfer, appoint company admins | No automatic operational payroll/HR approval just because they own the account |
| Company Admin | One tenant | Security settings, users, permitted role assignment, integrations, company setup | Platform administration; compensation operations unless separately granted |
| HR Admin | Tenant or assigned entity/location | Employee lifecycle, HR policies, leave administration, attendance exceptions | Platform entitlements; payroll release and sensitive financial data unless separately granted |
| HR Executive | Assigned population | Onboarding tasks, selected profile/document operations | Role grants, salary access, destructive bulk exports by default |
| Payroll Admin | Assigned legal entity/pay group | Salary inputs, payroll preparation, payroll reports | User privilege management; own final payroll approval |
| Payroll Approver | Assigned pay group | Review and approve/release prepared runs | Unreviewed input changes during approval |
| Manager | Direct reports; optional explicit wider scope | Assigned approvals, team attendance/leave summaries | Salary/bank/identity documents, peers, unrelated departments, own approvals |
| Employee | Self | Own leave, attendance, profile requests, documents and payslips as entitled | Colleagues' confidential records and administrative settings |
| Auditor / clearance assignee | Explicit records/modules | Read-only evidence or assigned exit checklist | Broad HR permissions merely to complete a checklist |

These are recommended templates, not claims about current implementation. One person can hold multiple roles and remain an employee. Show **My work**, **Team**, and **Administration** according to effective permissions. A non-employee owner need not receive a fictitious employment record.

Represent identity separately from tenant membership: `user → tenant membership → role assignments + scope`, with an optional employee link. This also accommodates consultants and a user associated with two companies without requiring email aliases. A tenant can contain multiple legal entities; legal entity should be modeled separately for payroll and statutory settings.

An authorization decision should combine authenticated identity, active membership, tenant status, module entitlement, action permission, target scope, field access, and workflow state. Enforce it in database/RPC/edge paths, and expose an effective-permissions result to React and mobile for consistent presentation. Avoid using a browser-supplied role or tenant as proof.

Start with named permissions such as `employees.read_basic`, `employees.read_sensitive`, `employees.invite`, `roles.assign`, `attendance.correct`, `leave.approve`, `payroll.prepare`, `payroll.approve`, and `reports.export`. Scopes should initially be self, direct reports, selected location/org unit/entity, or tenant. Exports and sensitive fields require explicit permission, not merely access to a page.

Role assignment is itself privileged: prevent self-escalation, protect the last owner, audit grants/revocations, and invalidate permission caches when access changes. If several roles grant access, combine their grants within scope; tenant fences, explicit prohibitions, and self-approval restrictions must still apply.

## Tenant setup and daily workflow

Recommended setup:

1. Platform selects plan/modules, reserves the subdomain, and creates a tenant in a provisioning state.
2. Invite the named Company Owner/first admin. The recipient verifies their address and sets their own password; privileged accounts should have MFA.
3. Collect company and legal-entity details, timezone, locations, working calendars, and effective dates.
4. Configure only the enabled modules: shifts/devices/geofences for attendance; leave types/balances/rules for leave; other module settings as relevant. Calendar confirmation may explicitly mean no configured holidays; do not silently assume a national calendar fits everyone.
5. Import/create employees with a preview, duplicate validation, employment dates, manager assignments, and scoped roles.
6. Configure approvers and fallback/escalation rules, then run an administrator-visible readiness check.
7. Activate employee access for the ready modules and show unresolved setup tasks. Record invitation delivery and allow safe resend/recovery.

Track commercial status, domain readiness, setup readiness, and user lifecycle separately. A failed DNS check should not be confused with cancelled billing; an accepted invitation should not automatically mean an employee is activated.

For leave, expenses, attendance corrections, and exits, use a shared approval foundation with module-specific rules: submission → resolved approval steps → approval/rejection → audited effects. Snapshot the policy version and approver resolution, support delegation and reminders, disallow self-approval, and define what happens when a manager leaves or changes. Retries and double-clicks must not double-apply balances or payroll effects. Do not make the workflow engine an unrestricted graph in the first release.

Preserve the existing separation of directory, calendar, and policy foundations from optional workflows. Basic employee creation/import and ending an employment record should remain core capabilities even when an advanced onboarding/offboarding workflow is not licensed. Disabling a module must not rewrite historical facts.

## Subdomains

The existing `company.hrms.talentmeshsolutions.com` approach is valid. Keep a shared deployment and stable tenant UUIDs; the hostname is a company lookup and branding mechanism, not authorization. The inspected backend resolves tenant identity from `auth.users` and checks active status, which is a useful foundation. Unknown hosts must not fall back to another tenant outside explicit local development.

Automate domains before self-service signup. A wildcard can remove repetitive per-company DNS work, but the older suggestion of merely adding a wildcard CNAME is incomplete: wildcard TLS issuance/renewal needs the hosting provider's supported DNS setup. Vercel documents nameserver-based setup and an ACME-challenge delegation alternative for subdomains. Check the actual project/domain configuration before changing DNS. No DNS or Vercel account inspection was performed here. [Vercel wildcard setup](https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers)

Use an isolated platform login surface and narrow session scope. Verify accepted redirect URLs, suspended tenants, unknown hosts, tenant switching, and custom-domain ownership. Native mobile should discover a company by invitation/company code or verified membership selection; it should not depend on `window.location.hostname`.

## Research comparison

Keka documents predefined and custom roles, separate HR Executive and Payroll Admin responsibilities, and assignment scopes such as location or department. This supports adding templates and population scope rather than treating every HR user as financially privileged. [Keka roles](https://help.keka.com/hc/en-us/articles/39946742389521-Understanding-User-Roles)

Zoho People distinguishes general and specific roles and documents configurable form/field/service permissions. Its “Super Administrator” refers to the customer's primary account owner; using that name for both your provider operator and customer owner would confuse the two levels. [Zoho user access control](https://help.zoho.com/portal/en/kb/people/administrator-guide/settings/manage-accounts/articles/user-access-control-zoho-people)

Zoho also separates service operations and settings permissions. That is useful for TalentMesh: managing an attendance policy, approving a correction, and viewing attendance are separate capabilities. [Zoho permissions](https://help.zoho.com/portal/en/kb/people/administrator-guide/common-settings/articles/setting-up-permissions-zoho-people)

These sources support common product patterns. They do not prove TalentMesh has market differentiation, and this review does not endorse the older documents' broad claims that competing Indian HRMS products cannot sell attendance independently. Validate packaging with current vendor quotations and customer interviews before using that as a sales claim.

## React Native and payroll

Keep React for dense administration workflows. Add a React Native employee/manager app against the same authorized backend. Share domain types, validation, API contracts, and applicable state logic; budget for native navigation, components, secure credential storage, camera/location, notifications, and deep links. React Native uses native UI components, so this is not an automatic conversion of the existing DOM/Tailwind application. [React Native components](https://reactnative.dev/docs/intro-react-native-components)

Extract browser dependencies behind interfaces now. A mobile API must take an explicit tenant context and validate membership. If offline punches are supported, queue them with stable event IDs and server-side duplicate/replay validation; device timestamps and GPS are evidence, not unquestionable truth. Prove employee self-service and manager approvals on web first, then build the mobile experience around those contracts.

Payroll remains an intentionally unfinished redesign. Do not use its present screens as evidence that the product is payroll-ready. Plan separate preparation/approval permissions; effective-dated salary components and employment changes; immutable input snapshots; period locks; correction/reversal handling; audit; and server-authoritative calculation/persistence. A Payroll-only customer still needs the employee master and calendar and must supply validated period inputs from import or another source. Missing attendance must block or request a source, never silently become zero pay. Statutory calculations require a separate jurisdiction-specific review before release.

## Delivery sequence and acceptance gates

1. **Secure the current release:** fix the rate-limit/edge mismatch together with recovery authorization, confidential storage, realtime isolation, and role-resolution inconsistencies. Rehearse changes in an isolated test environment and verify affected workflows before production.
2. **Make one complete customer setup work:** owner invitation, recoverable provisioning, intentional entitlements, company wizard, role templates, readiness checks. Validate one attendance-only tenant and one attendance-plus-leave tenant.
3. **Stabilize daily operations:** shared approval rules, calendar consistency, leave balances/ledger reconciliation, effective-dated manager changes, offboarding revocation, meaningful audit trails.
4. **Pilot with real administrators:** observe setup completion, first successful employee action, support interventions, approval turnaround, and data corrections. Use a small target segment and a few design partners before claiming universal HRMS flexibility.
5. **Build payroll after its contracts are stable, then mobile against the same APIs.** Mobile shell exploration can happen earlier; avoid duplicating unsettled business rules in a second client.

Minimum release test matrix: two tenants; platform admin, owner, HR, delegated HR, manager, employee, payroll preparer/approver, and revoked user. Exercise the UI and direct APIs, storage, RPCs and realtime. Include cross-tenant identifiers, peer records, sensitive fields, own-request approval, disabled modules, suspended tenant with an existing session/socket, cancelled/expired invitation, duplicate provisioning retry, manager transfer, and offboarding. Tests that merely hide navigation are insufficient.

This review did not run that matrix, send invitations, modify accounts, test GPS/camera/devices, download employee documents, or establish performance under customer load. Prior QA reports remain historical evidence until rerun against this deployment. Treat the result as a concrete release plan and a bounded live audit, not final production certification.
