-- Correct the lateness column comments. Documentation only -- no behaviour changes.
--
-- `20260824100000` described `is_late` as "unrelated to the new late_entry column ... Both
-- models coexist ... Do not merge or delete either column here." That was accurate when it was
-- written. `20260828120000` made it false: `attendance_derive_pass1` now writes `is_late` from
-- the same `v_late_entry` it writes to `late_entry`, on both the INSERT and the UPDATE path.
--
-- A stale comment on a column that feeds a payroll contract is not a cosmetic problem. The next
-- agent reads `pg_get_functiondef` and `col_description` as ground truth -- this project has
-- already had one migration assertion fail because it matched a comment rather than code, and
-- one function claim ("deliberately never sets punch_in") that was the exact opposite of what
-- the function did. Documentation that contradicts behaviour is how those happen.

COMMENT ON COLUMN public.attendance.is_late IS
  'Lateness as consumed by the PAYROLL CONTRACT: payroll_period_input counts late marks as '
  '(is_late AND status NOT IN (''absent'',''half_day'')) and exposes it as late_mark_count. '
  'Since 20260828120000, attendance_derive_pass1 keeps this IN SYNC with late_entry -- derived '
  'rows write the same value to both. late_entry is the AUTHORITY (D6: derived from hours '
  'against shift start + grace); is_late is the compatibility surface every existing consumer '
  'already reads (payroll_period_input, hr_update_attendance, '
  'hr_approve_attendance_correction, PunchInOut.tsx, Attendance.tsx). '
  'KNOWN DIVERGENCE, still open: hr_update_attendance and hr_approve_attendance_correction '
  'write is_late from their own cutoff-time calculation (shift.start_time + '
  'tenant_settings.late_mark_grace_minutes) and never touch late_entry, so an HR correction on '
  'a derived row leaves late_entry stale. Reconcile in B7b/B7c. '
  'Retiring this column is a PAYROLL-ERA decision -- payroll is the last module to be designed '
  'and its decisions are not locked; do not drop it as a side effect of an attendance change.';

COMMENT ON COLUMN public.attendance.late_entry IS
  'THE lateness authority (D6): derived server-side from hours worked against shift start plus '
  'late_entry_grace_minutes, by attendance_derive_pass1. An independent FLAG, never a status -- '
  'an employee can be present AND late. Mirrored into is_late for contract compatibility (see '
  'that column). Not written by hr_update_attendance or hr_approve_attendance_correction yet, '
  'which is the open divergence noted on is_late.';

-- Assertion: the claim this migration makes about the code is actually true. Comments are
-- stripped before matching, so this checks CODE, not the very comments being written.
DO $comments_match_code$
DECLARE
  v_src text;
BEGIN
  SELECT regexp_replace(pg_get_functiondef(oid), '--[^\n]*', '', 'g')
    INTO v_src
  FROM pg_proc WHERE proname = 'attendance_derive_pass1';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: attendance_derive_pass1 not found';
  END IF;

  IF v_src !~ '\mis_late\M' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: the new comment claims Pass 1 syncs is_late, but its code never '
      'references the column. Fix the code or the comment -- do not ship them disagreeing.';
  END IF;

  IF v_src !~ '\mlate_entry\M' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Pass 1 no longer references late_entry';
  END IF;
END $comments_match_code$;
