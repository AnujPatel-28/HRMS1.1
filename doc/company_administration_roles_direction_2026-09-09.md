# Company Administration and roles — context for future sessions

**Date:** 2026-09-09  
**Purpose:** Preserve the product discussion about evolving the current HR area into Company Administration. The user requested this note for future-session context.  
**Status:** Product direction and recommendations; not an implementation specification or evidence of completed work. Creating this note does not authorize production changes.

## 1. What the user wants

TalentMesh is evolving from an internal company tool into a multi-tenant HRMS product. Each customer should be able to configure its company and assign people appropriate access through a Company Administration workspace.

The user explored whether the current HR Admin area could become a general company setup/administration panel, with other company people receiving permissions assigned by an authorized administrator. The recommended interpretation is a shared workspace accessed through individual accounts, rather than a shared administrator username/password.

The user then supplied four screenshots of a Kredily demo as a concrete role-management reference. The discussion favored understandable role templates now, with a foundation for more granular permissions later, rather than another wholesale restructuring.

## 2. Direction to carry forward

- **Platform Admin:** TalentMesh's operator. Manages tenant provisioning, plans and module entitlements. This is distinct from a customer's administrator.
- **Company Administration:** The customer's administration workspace. It contains company setup, HR administration, Policy Center, and Users & Access.
- **Company Owner:** The named person accountable for the customer account and appointing administrators. Ownership is separate from employment and operational HR permissions.
- **HR Admin:** A responsibility assigned to a person, not the name of a shared login or an exclusive identity that prevents employee self-service.
- **Individual accounts:** Each administrator uses their own credentials. Grants, revocations and actions must be attributable to the person who performed them.
- **Multiple responsibilities:** One person may be an employee, manager and HR administrator. Offer My Work, Team and Administration according to actual access.
- **Optional employee association:** A non-employee owner/administrator should not require a fictitious employment record. An administrator without an employee record has no personal attendance, leave or payslip record merely because a route is accessible.

Recommended company flow:

```text
TalentMesh Platform Admin
    provisions tenant and purchased/trial modules
                    ↓
Named Company Owner / First Administrator
    accepts an invitation and establishes their own credentials
                    ↓
Company Administration
    configures company rules and assigns permitted access
                    ↓
People use individual accounts
    My Work · Team · Administration
    according to their responsibilities and scope
```

Keep commercial entitlements, company policies and individual permissions separate:

| Layer | Example | Authority |
|---|---|---|
| Module entitlement | The company has Attendance and Leave | TalentMesh platform |
| Company policy | Leave approval rules or shift settings | Authorized company administrator |
| User permission | A manager can approve requests for assigned reports | Person authorized to manage access |

Company administrators may configure supported capabilities and delegate permitted authority. They must not grant cross-tenant access, activate unpurchased modules, remove audit history, or acquire platform privileges.

## 3. What the Kredily screenshots actually show

These observations describe the supplied demo screenshots, not an audit of Kredily's current backend or complete product.

| Role displayed | Access described on screen |
|---|---|
| CEO | Also receives HR Admin authority; can view sensitive employee information, edit profiles, perform attendance/leave operations and manage administrators |
| HR Admin | Permissions apply to all employees; profile and sensitive-data access, profile editing, attendance/leave operations and administrator management |
| Finance Admin | Permissions apply to all employees; salary/bank information and sensitive identification information. Payroll preparation/release authority is not established by the screenshot |
| HR Executive | Permissions apply to all employees; non-payroll profiles, sensitive personal information, profile creation/editing and attendance/leave operations. Explicitly no payroll access |

Role cards show assigned people and Add/Change controls. Company Profile and My Profile appear in the same navigation. This is a useful UI reference for company and personal areas coexisting, but does not prove all roles' navigation behavior.

**Not established by the screenshots:** custom-role editing, department/location scopes, multiple simultaneous roles, self-approval controls, exact account authentication behavior, or backend enforcement. Do not infer these as implemented capabilities.

The screenshots are references, not instructions to copy their design exactly or interact with the displayed tenant.

## 4. Recommended differences for TalentMesh

### Separate designation from access

CEO is an organizational position. Company Owner is account ownership. Company Admin and HR Admin grant authority. One person can hold these together, but placing someone at the top of the org chart must not automatically grant sensitive-data access or permission to appoint administrators.

### Protect user and role management separately

The displayed Kredily HR Admin includes administrator management. For TalentMesh, make **Manage users and access** a distinct permission. A small-company default template may include it, but operational HR access must not inherently allow privilege grants or self-escalation. Protect the last owner and define a controlled ownership-transfer process.

### Separate sensitive information from payroll

The screenshot's HR Executive has no payroll access but still sees PAN/IDs/date of birth. Therefore, a no-payroll role is not necessarily a low-sensitivity role.

Design permissions to distinguish:

- Basic employee information.
- Identity documents and sensitive personal details.
- Salary and bank information.
- Creating/editing records.
- Approving requests.
- Exporting information and downloading documents.
- Assigning or revoking access.

Permission to configure a module need not confer permission to read every confidential record in it.

## 5. Role-management model and UI

The recommended model is:

**Role template → permitted actions → employee population/scope → named assignees.**

Illustrative templates, not a commitment to implement all of them in V1:

| Template | Purpose | Scope direction |
|---|---|---|
| Company Admin | Company configuration and explicitly granted user/access management | Tenant |
| HR Admin | Employee administration and HR policies | Tenant initially; narrower scope when enforced |
| HR Executive | Onboarding and selected profile operations | Tenant or assigned population |
| Finance/Payroll Admin | Explicit financial permissions and payroll responsibilities | Company/pay group when supported |
| Manager | Team information and assigned approvals | Direct reports or explicitly assigned population |
| Employee | Personal records and requests | Self |

Recommended location: **Company Administration → Users & Access**.

For each role, show its purpose, permitted actions, sensitive-data access, scope and named assignees. Start with clear fixed templates. A custom-role builder is optional later scope.

Do not show scope selectors or permission switches that are not enforced. A tenant-wide V1 HR role is acceptable only when that access matches the customer's authorized responsibilities; company size alone is not proof that broad access is appropriate.

## 6. Current TalentMesh constraints to account for

The September 9 review identified:

- React's exclusive `hr` versus `employee` route gates prevent an HR user from using employee self-service routes.
- SQL `is_hr()` recognizes metadata HR and an active `employee_roles` HR-admin assignment, while some UI/edge paths resolve only metadata roles.
- `employee_roles` requires an employee association, which does not accommodate non-employee tenant administrators.
- A role/scope record does not itself enforce scope. Broad `is_hr()` checks must not accidentally turn a scoped assignment into tenant-wide authority.

Use a consistent server-derived access resolution contract for presentation and server checks. It may compose existing sources during migration; it does not require merging every fact into a single table immediately. Never accept a client-supplied access summary as proof of permission. Database policies, RPCs, edge functions, storage and realtime need the relevant independent enforcement.

These are dated observations. Re-read current source and live definitions before implementation; do not assume a later session has left them unchanged.

## 7. V1 and V2 boundaries

**V1:** A small set of usable role templates, named invitations/accounts, consistent access resolution, employee self-service for employees who also administer HR, safe assignment/revocation, intentional entitlements, and auditability. Configure only workflows that are ready and tested.

**V2:** Custom roles, narrower organizational/location scopes, richer field-level permissions, delegated administration, configurable approvals, and payroll preparation/approval separation as those capabilities are introduced.

Establish membership and action/scope concepts early, but avoid a wholesale rewrite of all existing policies merely to prepare a speculative matrix. Extend enforcement in controlled, tested increments. Existing customers need explicit role mappings and validated migrations; never temporarily broaden access to make a migration easier.

Payroll remains unfinished and intended for redesign. The screenshots do not change that scope or authorize enabling it. Mobile should eventually use the same backend contracts; it is not an automatic conversion of the React web UI.

## 8. Open implementation decisions

The following still need to be settled in implementation planning:

- Exact V1 role templates and permissions.
- Membership schema and migration for existing non-employee administrators.
- Which authority can assign each role, including ownership transfer and recovery.
- The first genuinely supported scopes and how every relevant backend path enforces them.
- Which sensitive fields each template may read, edit, export or download.
- Permission revocation behavior for existing sessions, cached UI state and realtime connections.

Do not treat suggested names or the illustrative matrix as final, implemented requirements.

## 9. Related context and references

- `doc/product_validation_2026-09-09.md`: bounded live audit, defects and broader architecture recommendations.
- `doc/product_direction_review_2026-09-09.md`: second opinion emphasizing a narrower first release. Its claims still need the qualifications discussed in this conversation; it does not automatically supersede live evidence.
- `doc/hrms_target_state_frd_2026-09-02.md`: earlier target contracts and V1 priorities. Distinguish intended behavior from dated implementation claims.

Established examples discussed before the screenshots:

- [Keka user roles](https://help.keka.com/hc/en-us/articles/39946742389521-Understanding-User-Roles)
- [Zoho People user access control](https://help.zoho.com/portal/en/kb/people/administrator-guide/settings/manage-accounts/articles/user-access-control-zoho-people)

User-supplied screenshot paths:

- `C:/Users/Anuj/Pictures/Screenshots/Screenshot 2026-09-09 163552.png`
- `C:/Users/Anuj/Pictures/Screenshots/Screenshot 2026-09-09 163652.png`
- `C:/Users/Anuj/Pictures/Screenshots/Screenshot 2026-09-09 163707.png`
- `C:/Users/Anuj/Pictures/Screenshots/Screenshot 2026-09-09 163724.png`

**Future-session instruction:** Read this as product context, verify current implementation, preserve tenant isolation and individual accountability, and evolve the existing HR area into Company Administration without reintroducing shared administrator credentials or exclusive employee/admin identities.
