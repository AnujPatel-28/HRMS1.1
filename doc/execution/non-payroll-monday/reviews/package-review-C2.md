# Package review — C2 business date everywhere

Reviewer: Opus 5 (lead), 2026-09-22. **Verdict: ACCEPTED.** Migration `20260912193000` and
`tests/m1m2/c2_business_date.mjs` written and applied by Sonnet 5, which hit its usage limit before
committing; the lead verified independently and committed.

## 1. What changed

7 functions now use `tenant_business_date(<tenant>, now())` instead of server-UTC `CURRENT_DATE`
(yesterday in IST until 05:30): `employee_apply_leave_request` (notice, eligibility),
`hr_schedule_shift_change` (default "tomorrow", future guard), `create_employee_transaction`,
`open_initial_unit_assignment`, `attendance_evaluate_location` (fallback), and the two cross-tenant
batch jobs `expire_location_exceptions` and `fn_accrue_monthly_leaves` (per row's tenant).
Deliberately unchanged: `fn_check_insurance_expiries` (excluded product) and
`attendance_reconcile_missing_selfies` (lookback window, harmless).

## 2. Independent verification — against the true pre-C2 bodies

`migrations/` is not the schema source, so the lead compared **the parent project's live bodies**
(which never received C2 or any M1/M2 migration touching these functions) with TB's post-C2 bodies,
**read-only**, from a throwaway folder linked to the parent (the repo's link never left TB; the
folder was deleted afterwards). Script: `scratch/c2-parent-diff.mjs`.

Result: in all 7 functions the **only** differences are the date expressions (plus, in
`employee_apply_leave_request`, lines P2-04's accepted `186000` had already put on TB). No statement
lost — the failure mode this repo has hit before with hand-rewritten bodies.

| Check | Result |
|---|---|
| `prosrc` sweep for `current_date` | only the 2 deliberate uses + comments |
| `pg_proc` | one row each for all 7 |
| `c2_business_date.mjs` | sets Company A to a timezone whose date differs from UTC **now** ("divergence confirmed"), proves each function follows the tenant date, restores the timezone and every touched fixture with assertions |
| All 16 suites | exit 0 except `p3_realtime_isolation` (only the accepted item-6 FAIL); build clean; drift 44 of 328 (baseline); personas 5/5 |
