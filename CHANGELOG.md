# Changelog

All notable changes to TalentMesh HRMS. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/). `0.x` while the UI/UX rework is under way; `1.0.0` marks the first
real customer. Every release tag records the frontend commit **and** the database migration head.

## [0.9.1] - 2026-09-23

Security patch. No frontend change. Database migration head: `20260923162654`.

### Security
- Leave approve/cancel checked the leave's status before the caller's permission, so a user of another
  company holding a leave id learned whether it existed and its status. The caller is now authorized
  first, and every outsider gets the same denial (C10).

## [0.9.0] - 2026-09-23

First production release of the non-payroll modules. Payroll is hidden (it will be rebuilt from scratch
as a standalone module later). Database migration head: `20260912199000`.

### Added
- Access model: capability summary, tenant memberships, invitations, owner transfer, access audit
  (Users & Access, `accept-tenant-invitation`, `manage-tenant-access`).
- Dated organisation transfers, and one work-calendar resolver shared by attendance and leave.
- Half-day leave (first/second half, 0.5 day), enabled per leave type by HR.
- HR "Recalculate" for an attendance day. Cancelled leave re-derives the day.
- Absence marking once a day's punches are final (app/kiosk next morning; devices after sync).
- Employee self-edit of personal fields, and new-hire requests with an HR review.
- Projects and tasks lifecycle, chat channels and Connect with scoped realtime.

### Changed
- Approving leave respects HR-locked attendance days.
- Business dates use each tenant's timezone everywhere (no server-UTC dates).
- Payroll removed from menus, routes and panels. Its data is untouched.

### Security
- An employee could make themself HR's manager, and managers could read reports' bank/PAN details. Both
  are closed: one reporting authority.
- Nine tables writable by any employee (office geofence, shifts, payroll run status, WFH exceptions…)
  are now HR-only.
- Employees could self-approve expenses, pin announcements, delete HR-issued documents and overwrite
  colleagues' photos. All are closed.
- Storage: per-bucket write fences. `hr-policies`, `chat-attachments`, `employee-documents`,
  `expense-receipts` and `task-attachments` are now private.

[0.9.1]: https://github.com/AnujPatel-28/HRMS1.1/releases/tag/v0.9.1
[0.9.0]: https://github.com/AnujPatel-28/HRMS1.1/releases/tag/v0.9.0
