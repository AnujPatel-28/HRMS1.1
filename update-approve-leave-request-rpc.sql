-- Update approve_leave_request to explicitly set session_status = 'closed'
-- for the auto-generated attendance rows. This avoids unique constraint
-- violations (idx_single_open_session) when the employee already has an
-- open attendance session (e.g. today's clock-in).

CREATE OR REPLACE FUNCTION public.approve_leave_request(p_leave_id uuid, p_hr_employee_id uuid, p_working_dates date[], p_approved_business_days integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_leave RECORD;
    v_balance_row RECORD;
    v_date DATE;
BEGIN
    -- 1. Lock the leave record
    SELECT * INTO v_leave
    FROM leaves
    WHERE id = p_leave_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Leave request not found';
    END IF;

    IF v_leave.status != 'pending' THEN
        RAISE EXCEPTION 'Leave request is no longer pending (current status: %)', v_leave.status;
    END IF;

    -- 2. Deduct balance if leave_type_id is present
    IF v_leave.leave_type_id IS NOT NULL THEN
        SELECT * INTO v_balance_row
        FROM leave_balances
        WHERE tenant_id = v_leave.tenant_id
          AND employee_id = v_leave.employee_id
          AND leave_type_id = v_leave.leave_type_id
          AND year = EXTRACT(YEAR FROM v_leave.start_date)
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Leave balance not found for this employee and type';
        END IF;

        IF v_balance_row.balance < p_approved_business_days THEN
            RAISE EXCEPTION 'Insufficient leave balance (available: %, requested: %)', v_balance_row.balance, p_approved_business_days;
        END IF;

        UPDATE leave_balances
        SET used_days = used_days + p_approved_business_days,
            balance = balance - p_approved_business_days,
            updated_at = NOW()
        WHERE id = v_balance_row.id;
    END IF;

    -- 3. Update the leave status
    UPDATE leaves
    SET status = 'approved',
        reviewed_by = p_hr_employee_id,
        reviewed_at = NOW(),
        approved_business_days = p_approved_business_days
    WHERE id = p_leave_id;

    -- 4. Generate Attendance Rows
    IF p_working_dates IS NOT NULL THEN
        FOREACH v_date IN ARRAY p_working_dates
        LOOP
            INSERT INTO attendance (tenant_id, employee_id, date, status, punch_out_allowed, session_status)
            VALUES (v_leave.tenant_id, v_leave.employee_id, v_date, 'on_leave', true, 'closed')
            ON CONFLICT (employee_id, date) 
            DO UPDATE SET status = 'on_leave', punch_out_allowed = true, session_status = 'closed';
        END LOOP;
    END IF;

END;
$function$;
