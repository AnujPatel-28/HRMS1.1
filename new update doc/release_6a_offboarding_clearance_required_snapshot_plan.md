# Release 6A Implementation Plan: Offboarding Clearance Required Snapshot

Target:

```text
Frontend branch: updateSuggestion
InsForge preview: https://rq3qmu8y-jx7.ap-southeast.insforge.app
```

Source of truth:

- `new update doc/people_suite_edge_case_hardening_plan.md`
- `new update doc/people_suite_architecture_and_developer_guide.md`
- `new update doc/people_suite_full_implementation_plan.md`

Do not use the old `doc` folder.

## Goal

Make offboarding clearance completion depend on request-level clearance requirements, not mutable tenant template state or legacy boolean fallbacks.

This release adds an `is_required` snapshot to each `exit_clearances` row and updates completion logic so final offboarding is blocked only by required, active, non-cancelled clearance rows.

## Problem

Current offboarding behavior has two remaining risks:

- `exit_clearances` rows do not store whether a clearance item was required at the time the exit request entered notice period.
- Completion can still depend on compatibility behavior around legacy clearance booleans, which can drift from normalized clearance rows.

Real HRMS example:

HR changes the tenant clearance template after an employee has already started offboarding. The employee's exit request should keep the original clearance requirements that were valid when the request was approved, not silently change because the template changed later.

## Release Scope

Implement only these changes:

1. Add `exit_clearances.is_required boolean not null default true`.
2. Backfill existing clearances to `is_required = true`.
3. Update clearance seeding logic to copy requirement state from the template when available.
4. Update `complete_exit_transaction` so it checks only required, non-cancelled clearance rows.
5. Update offboarding UI counts to ignore `cancelled` rows and clearly count only required pending items.
6. Update docs after implementation.

Do not implement structured exit interviews in this release. That is Release 7.

Do not revoke base `employees` RLS in this release. That is Release 6B.

## Preflight Checks

Before editing code or SQL, the agent must inspect the live/current repo state:

```powershell
rg "exit_clearances" migrations src
rg "complete_exit_transaction" migrations src
rg "update_exit_clearance_transaction" migrations src
rg "exit_clearance_templates" migrations src
rg "clearance_pending" src migrations
```

Confirm these facts before coding:

| Check | Expected handling |
| --- | --- |
| Does `exit_clearances.is_required` already exist? | If yes, do not re-add it; only align logic/docs. |
| Does `exit_clearance_templates` have an `is_required` or equivalent column? | If yes, snapshot from it. If no, default `is_required = true`. |
| Is clearance seeding trigger-based or RPC-based in current code? | Update the actual live seeding path only. |
| Does `complete_exit_transaction` already ignore `cancelled` rows? | If yes, verify and document. If no, update. |

## Database Migration

Create a new migration:

```text
migrations/20260706100000_exit-clearance-required-snapshot.sql
```

The exact timestamp can be adjusted only if a newer local migration already exists.

### Migration Step 1: Add Snapshot Column

```sql
alter table public.exit_clearances
add column if not exists is_required boolean not null default true;

update public.exit_clearances
set is_required = true
where is_required is distinct from true;
```

### Migration Step 2: Update Clearance Seeding

Find the current function or trigger that creates `exit_clearances` rows.

If templates have `is_required`, insert it:

```sql
coalesce(template.is_required, true)
```

If templates do not have `is_required`, insert:

```sql
true
```

The seeded rows must keep the snapshot even if the template changes later.

### Migration Step 3: Update `complete_exit_transaction`

The completion RPC must block completion if at least one required clearance is incomplete:

```sql
exists (
  select 1
  from public.exit_clearances ec
  where ec.exit_request_id = p_request_id
    and ec.is_required = true
    and ec.status not in ('approved', 'cancelled')
)
```

Important behavior:

- `approved` means complete.
- `cancelled` means not applicable and must not block completion.
- `pending` and `rejected` must block final completion.
- Optional clearances with `is_required = false` must not block final completion.

### Migration Step 4: Preserve Existing Idempotency

Do not regress earlier behavior:

- already `inactive` employee can complete
- already `terminated` employee can complete while preserving `terminated`
- audit log still includes warning details for terminated reconciliation

## Frontend Updates

### `src/hr/OffboardingManagement.tsx`

Update pending clearance summaries to count only rows where:

```ts
clearance.is_required !== false &&
clearance.status !== "approved" &&
clearance.status !== "cancelled"
```

If the current type does not include `is_required`, update the local type or shared type.

### `src/employee/MyExit.tsx`

Ensure employee-facing progress ignores cancelled rows and treats optional rows separately if they are displayed.

Minimum safe behavior:

- Required approved rows count toward completion.
- Required pending/rejected rows show as outstanding.
- Cancelled rows are hidden or shown as cancelled, but never counted as pending.
- Optional rows do not block the progress label.

### `src/types/index.ts`

If `ExitClearance` is defined here, add:

```ts
is_required?: boolean;
```

Use optional typing if older rows/API payloads may omit it during dev.

## Audit And Reports

No new audit event is required for adding the snapshot column.

If any report or dashboard counts pending clearances, update it to exclude:

- `status = 'cancelled'`
- `is_required = false` when the count means "blocking"

Use `rg "clearance"` to find all counts before finalizing.

## QA Checklist

### Automated

```powershell
npm run build
npx @insforge/cli db migrations up --all
```

### Manual

1. Create or use an exit request in `notice_period`.
2. Confirm seeded `exit_clearances` rows have `is_required = true` by default.
3. Mark one required clearance as `pending`; final completion must fail.
4. Mark all required clearances as `approved`; final completion must succeed.
5. Set one clearance to `cancelled`; final completion must not be blocked by that cancelled row.
6. If optional clearances exist, set `is_required = false` and keep status `pending`; final completion must still succeed.
7. Verify `inactive` and `terminated` idempotency from earlier releases still works.

## Rollback Plan

If the migration breaks completion:

1. Revert frontend counting changes.
2. Re-deploy the previous `complete_exit_transaction` body from the prior migration.
3. Keep the `is_required` column if already deployed; additive columns are safe to leave.

Do not drop the column in production-like preview unless explicitly approved.

## Definition Of Done

- `exit_clearances.is_required` exists and is populated.
- New seeded clearance rows store the required snapshot.
- Final completion checks required normalized clearance rows only.
- Cancelled rows do not block completion.
- Optional rows do not block completion.
- `npm run build` passes.
- Migration applies successfully on the updateSuggestion InsForge preview.
- `people_suite_edge_case_hardening_plan.md` is updated with Release 6A completion notes.

