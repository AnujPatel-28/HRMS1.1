# Release 7 Implementation Plan: Structured Exit Interview

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

Move exit interview handling from a single free-text field into a structured, auditable `jsonb` payload while preserving current compatibility with `exit_feedback` and `exit_interview_done`.

This release makes exit interviews useful for real HR review and future reporting.

## Problem

Current exit interview behavior is too flat for a real HRMS:

- `exit_feedback` stores one text blob.
- Structured answers such as reason category, manager feedback, rehire eligibility, risk level, and action items are not first-class data.
- Future reports cannot reliably group or filter exit themes.

Real HRMS example:

HR wants to know how many exits in Q3 were caused by compensation, manager issues, relocation, or career growth. Free text cannot answer that reliably.

## Release Scope

In scope:

1. Add `exit_requests.exit_interview_data jsonb`.
2. Add `exit_requests.exit_interview_completed_at timestamptz` if not already present.
3. Add `exit_requests.exit_interview_completed_by uuid` referencing employees if safe and consistent with existing FK patterns.
4. Add an HR structured form.
5. Continue writing `exit_feedback` summary text for compatibility.
6. Keep `exit_interview_done` boolean for compatibility.
7. Update `complete_exit_transaction` to require structured completion when required by current business rules.

Out of scope:

- No RLS tightening. That is Release 6B.
- No clearance required snapshot work. That is Release 6A.
- No analytics dashboard in this release.
- No AI-generated exit interview summaries.

## Preflight Audit

Run:

```powershell
rg "exit_interview" src migrations
rg "exit_feedback" src migrations
rg "complete_exit_transaction" src migrations
rg "OffboardingManagement" src
rg "MyExit" src
```

Confirm:

| Check | Expected handling |
| --- | --- |
| Does `exit_interview_data` already exist? | If yes, do not re-add. Align UI/RPC only. |
| Does `exit_interview_completed_at` already exist? | If yes, use it. If no, add it. |
| Does `exit_interview_completed_by` fit existing FK rules? | Add only if `audit_logs.actor_id` and employee FK patterns are stable. |
| Does completion already require `exit_interview_done = true`? | Preserve or make the requirement explicit. |

## Data Model

Create a migration:

```text
migrations/20260706130000_exit-interview-structured-data.sql
```

### Add Columns

```sql
alter table public.exit_requests
add column if not exists exit_interview_data jsonb not null default '{}'::jsonb;

alter table public.exit_requests
add column if not exists exit_interview_completed_at timestamptz;

alter table public.exit_requests
add column if not exists exit_interview_completed_by uuid;
```

Add FK only after checking current FK style:

```sql
alter table public.exit_requests
add constraint exit_requests_exit_interview_completed_by_fkey
foreign key (exit_interview_completed_by)
references public.employees(id);
```

If a matching constraint already exists, do not recreate it.

### Structured JSON Shape

Use this shape in frontend and docs:

```json
{
  "primary_reason": "career_growth",
  "reason_notes": "Accepted a senior role elsewhere.",
  "manager_feedback": "Positive working relationship.",
  "work_environment_rating": 4,
  "compensation_rating": 3,
  "growth_rating": 5,
  "rehire_eligible": true,
  "risk_level": "low",
  "knowledge_transfer_done": true,
  "company_property_notes": "Laptop returned to IT.",
  "hr_action_items": ["Review compensation band for senior engineers"],
  "completed_by_name": "QA HR Admin",
  "completed_at": "2026-07-06T10:30:00+05:30"
}
```

Allowed values:

| Field | Values |
| --- | --- |
| `primary_reason` | `career_growth`, `compensation`, `manager`, `relocation`, `personal`, `performance`, `culture`, `other` |
| `risk_level` | `low`, `medium`, `high` |
| ratings | integers `1` to `5` |
| booleans | true/false |

## Database RPC

Preferred: create a dedicated RPC for saving the structured interview.

```text
public.update_exit_interview_transaction(
  p_request_id uuid,
  p_exit_interview_data jsonb,
  p_exit_feedback text
)
```

The RPC should:

1. Verify HR permission.
2. Verify tenant scope.
3. Lock the `exit_requests` row.
4. Validate request status is not `completed`, `rejected`, or `withdrawn`.
5. Set `exit_interview_data`.
6. Set `exit_feedback` compatibility summary.
7. Set `exit_interview_done = true`.
8. Set `exit_interview_completed_at = now()`.
9. Set `exit_interview_completed_by` to current employee id if available.
10. Write an audit log event:

```text
offboarding.exit_interview_completed
```

Do not let the frontend directly update all these columns separately.

## Completion RPC Update

Update `complete_exit_transaction` to require exit interview completion before final completion if current business rules already require it.

Safe condition:

```sql
exit_interview_done = true
and coalesce(exit_interview_data, '{}'::jsonb) <> '{}'::jsonb
```

Compatibility exception:

If old rows have `exit_interview_done = true` and non-empty `exit_feedback` but empty `exit_interview_data`, either:

1. Allow completion for old rows and write audit warning, or
2. Backfill `exit_interview_data` from `exit_feedback`.

Preferred for preview:

Backfill old completed/done rows:

```json
{
  "legacy_feedback": "...",
  "migration_source": "exit_feedback"
}
```

## Frontend Updates

### `src/hr/OffboardingManagement.tsx`

Replace or extend the current exit interview text area with structured fields:

- primary reason select
- reason notes textarea
- manager feedback textarea
- work environment rating
- compensation rating
- growth rating
- rehire eligibility toggle
- risk level select
- knowledge transfer done checkbox
- company property notes textarea
- HR action items simple textarea or tag list

Submit through:

```ts
db.rpc("update_exit_interview_transaction", {
  p_request_id: request.id,
  p_exit_interview_data: payload,
  p_exit_feedback: summaryText,
});
```

Do not perform separate client-side writes to `exit_requests` and `audit_logs`.

### `src/employee/MyExit.tsx`

Employee view should show only safe completion status:

- "Exit interview completed" when done.
- Do not show HR internal risk level or action items to the employee.
- Do not expose manager feedback unless product explicitly approves it.

### `src/types/index.ts`

Add structured type:

```ts
export interface ExitInterviewData {
  primary_reason?: "career_growth" | "compensation" | "manager" | "relocation" | "personal" | "performance" | "culture" | "other";
  reason_notes?: string;
  manager_feedback?: string;
  work_environment_rating?: number;
  compensation_rating?: number;
  growth_rating?: number;
  rehire_eligible?: boolean;
  risk_level?: "low" | "medium" | "high";
  knowledge_transfer_done?: boolean;
  company_property_notes?: string;
  hr_action_items?: string[];
  completed_by_name?: string;
  completed_at?: string;
  legacy_feedback?: string;
  migration_source?: string;
}
```

Add fields to `ExitRequest`:

```ts
exit_interview_data?: ExitInterviewData;
exit_interview_completed_at?: string | null;
exit_interview_completed_by?: string | null;
```

## QA Checklist

### Automated

```powershell
npm run build
npx @insforge/cli db migrations up --all
```

### Manual

1. HR opens an exit request in notice period.
2. HR fills structured interview fields and saves.
3. Verify one RPC call saves the structured interview.
4. Verify `exit_interview_done = true`.
5. Verify `exit_interview_data` contains structured JSON.
6. Verify `exit_feedback` contains a readable compatibility summary.
7. Verify audit log contains `offboarding.exit_interview_completed`.
8. Try completing offboarding before interview completion; it must fail if interview is required.
9. Complete interview, approve required clearances, then complete offboarding; it must succeed.
10. Login as employee and verify only safe interview completion status is visible.

## Rollback Plan

If the structured form causes issues:

1. Revert frontend to the previous text-area UI.
2. Keep `exit_interview_data` columns because they are additive.
3. Temporarily update completion RPC to accept legacy `exit_interview_done = true` and `exit_feedback` until the UI is fixed.

Do not drop structured columns from preview unless explicitly approved.

## Definition Of Done

- Structured exit interview columns exist.
- HR saves interview through one transactional RPC.
- `exit_feedback` and `exit_interview_done` compatibility remains.
- Completion rules are explicit and tested.
- Employee portal does not expose HR-only interview content.
- `npm run build` passes.
- Migration applies successfully on the updateSuggestion InsForge preview.
- `people_suite_edge_case_hardening_plan.md` is updated with Release 7 completion notes.

