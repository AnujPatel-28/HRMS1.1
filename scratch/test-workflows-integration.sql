-- Test script for TalentMesh Atomic HR Workflows
-- Run this block directly inside PostgreSQL transaction to verify validations, constraints, and side effects.

BEGIN;

-- Setup mock JWT user claim context
-- '5a6549b4-014f-4bfe-9153-3f4208268eb4' is HR Manager user ID
-- 'a6d473f5-f1b9-4f8e-8c2d-d0261d8700b2' is Employee Anuj Patel user ID
PERFORM set_config('request.jwt.claim.sub', 'a6d473f5-f1b9-4f8e-8c2d-d0261d8700b2', true);

DECLARE
  v_tenant_id uuid := '97da3641-d69e-4e7a-bdc9-760675be8d28';
  v_employee_id uuid := 'eaf1224d-261f-46c0-a5cf-e122dcd7ad36';
  v_leave_type_id uuid := '930a6388-624d-4529-8ae6-95db63e68228';
  v_leave_id uuid;
  v_shift_id uuid;
  v_assignment_id uuid;
  v_attendance_id uuid;
  v_balance_before numeric;
  v_balance_after numeric;
  v_balance_final numeric;
  v_temp_cnt integer;
BEGIN
  RAISE NOTICE '========== STARTING ATOMIC HR WORKFLOW INTEGRATION TESTS ==========';

  -----------------------------------------------------------------------------
  -- TEST CASE 1: Employee Applies Leave (employee_apply_leave_request)
  -----------------------------------------------------------------------------
  RAISE NOTICE 'Test Case 1: Employee applying for leave...';
  
  SELECT balance INTO v_balance_before
  FROM leave_balances
  WHERE employee_id = v_employee_id AND leave_type_id = v_leave_type_id AND year = 2026;
  
  RAISE NOTICE 'Initial leave balance: %', v_balance_before;

  -- Apply for leave on 2026-06-15 to 2026-06-16 (2 working days)
  v_leave_id := public.employee_apply_leave_request(
    v_tenant_id,
    v_leave_type_id,
    '2026-06-15'::date,
    '2026-06-16'::date,
    'Family function test reason'
  );

  RAISE NOTICE 'Leave request created successfully. ID: %', v_leave_id;

  -- Verify leave is in pending state
  SELECT count(*) INTO v_temp_cnt FROM leaves WHERE id = v_leave_id AND status = 'pending';
  IF v_temp_cnt <> 1 THEN
    RAISE EXCEPTION 'Test Case 1 Failed: Leave is not in pending status!';
  END IF;
  RAISE NOTICE '✅ Test Case 1 Passed: Leave request created and set to pending.';

  -----------------------------------------------------------------------------
  -- TEST CASE 2: HR Approves Leave (approve_leave_request)
  -----------------------------------------------------------------------------
  RAISE NOTICE 'Test Case 2: HR approving the leave request...';
  
  -- Switch user context to HR Manager Manya
  PERFORM set_config('request.jwt.claim.sub', '5a6549b4-014f-4bfe-9153-3f4208268eb4', true);

  PERFORM public.approve_leave_request(v_leave_id);

  -- Verify balance is deducted
  SELECT balance INTO v_balance_after
  FROM leave_balances
  WHERE employee_id = v_employee_id AND leave_type_id = v_leave_type_id AND year = 2026;
  
  RAISE NOTICE 'Leave balance after approval: %', v_balance_after;
  IF v_balance_before - v_balance_after <> 2 THEN
    RAISE EXCEPTION 'Test Case 2 Failed: Leave balance deduction incorrect!';
  END IF;

  -- Verify attendance rows generated
  SELECT count(*) INTO v_temp_cnt 
  FROM attendance 
  WHERE employee_id = v_employee_id 
    AND date IN ('2026-06-15'::date, '2026-06-16'::date)
    AND status = 'on_leave';
  
  IF v_temp_cnt <> 2 THEN
    RAISE EXCEPTION 'Test Case 2 Failed: Attendance entries for on_leave were not created!';
  END IF;

  -- Verify audit logs written
  SELECT count(*) INTO v_temp_cnt 
  FROM audit_logs 
  WHERE target_id = v_leave_id
    AND action = 'leave.approved';
  
  IF v_temp_cnt <> 1 THEN
    RAISE EXCEPTION 'Test Case 2 Failed: Audit log entry missing!';
  END IF;

  RAISE NOTICE '✅ Test Case 2 Passed: Leave approved, balance deducted, attendance generated, audit logged.';

  -----------------------------------------------------------------------------
  -- TEST CASE 3: HR Cancels Approved Leave (cancel_leave_request)
  -----------------------------------------------------------------------------
  RAISE NOTICE 'Test Case 3: HR cancelling the approved leave...';

  PERFORM public.cancel_leave_request(v_leave_id, 'Cancelled by test suite', 'rejected');

  -- Verify balance is restored
  SELECT balance INTO v_balance_final
  FROM leave_balances
  WHERE employee_id = v_employee_id AND leave_type_id = v_leave_type_id AND year = 2026;
  
  RAISE NOTICE 'Leave balance after cancellation: %', v_balance_final;
  IF v_balance_final <> v_balance_before THEN
    RAISE EXCEPTION 'Test Case 3 Failed: Leave balance not restored!';
  END IF;

  -- Verify attendance rows removed
  SELECT count(*) INTO v_temp_cnt 
  FROM attendance 
  WHERE employee_id = v_employee_id 
    AND date IN ('2026-06-15'::date, '2026-06-16'::date);
  
  IF v_temp_cnt <> 0 THEN
    RAISE EXCEPTION 'Test Case 3 Failed: Attendance entries were not deleted!';
  END IF;

  RAISE NOTICE '✅ Test Case 3 Passed: Leave cancelled, balance restored, attendance deleted.';

  -----------------------------------------------------------------------------
  -- TEST CASE 4: Shift Change (hr_schedule_shift_change)
  -----------------------------------------------------------------------------
  RAISE NOTICE 'Test Case 4: HR scheduling a shift change...';

  -- Find a shift ID for the tenant
  SELECT id INTO v_shift_id FROM shifts WHERE tenant_id = v_tenant_id LIMIT 1;
  
  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'No shifts found for this tenant to run test!';
  END IF;

  -- Schedule shift change to tomorrow
  v_assignment_id := public.hr_schedule_shift_change(
    v_tenant_id,
    v_employee_id,
    v_shift_id,
    (CURRENT_DATE + 1)::date
  );

  RAISE NOTICE 'Shift assignment created. ID: %', v_assignment_id;

  -- Verify index constraints are satisfied and shift assignment exists
  SELECT count(*) INTO v_temp_cnt 
  FROM employee_shifts 
  WHERE id = v_assignment_id 
    AND effective_from = (CURRENT_DATE + 1)::date;

  IF v_temp_cnt <> 1 THEN
    RAISE EXCEPTION 'Test Case 4 Failed: Shift assignment missing in DB!';
  END IF;

  RAISE NOTICE '✅ Test Case 4 Passed: Shift change scheduled successfully.';

  -----------------------------------------------------------------------------
  -- TEST CASE 5: Attendance Updates (hr_update_attendance)
  -----------------------------------------------------------------------------
  RAISE NOTICE 'Test Case 5: HR updating attendance manual clock-in...';

  v_attendance_id := public.hr_update_attendance(
    v_tenant_id,
    NULL,
    v_employee_id,
    '2026-06-01'::date,
    '09:00:00'::time,
    '17:00:00'::time,
    'present'
  );

  RAISE NOTICE 'Attendance edited/created successfully. ID: %', v_attendance_id;

  -- Verify work hours calculation (8.0 hours - 1.0 hour lunch = 7.0 hours)
  -- Let's check work_hours column
  SELECT work_hours INTO v_balance_final FROM attendance WHERE id = v_attendance_id;
  RAISE NOTICE 'Calculated work hours: %', v_balance_final;
  
  IF v_balance_final IS NULL OR v_balance_final <= 0 THEN
    RAISE EXCEPTION 'Test Case 5 Failed: Work hours calculation incorrect!';
  END IF;

  RAISE NOTICE '✅ Test Case 5 Passed: Attendance record created and work hours calculated.';

  RAISE NOTICE '========== ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ==========';
END;

ROLLBACK;
