-- Update cancel_leave_request to derive HR reviewer server-side from auth.uid().
-- SECURITY HARDENING (2026-06-02): p_hr_employee_id removed from signature.
-- The reviewing HR user is now derived server-side from auth.uid() to prevent
-- privilege escalation — a malicious authenticated caller can no longer forge
-- the reviewer identity by passing an arbitrary UUID.

CREATE OR REPLACE FUNCTION public.cancel_leave_request(
  p_leave_id uuid,
  p_rejection_reason text,
  p_new_status text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_leave RECORD;
    v_balance_row RECORD;
    v_caller_uid UUID;
    v_hr_employee_id UUID;
BEGIN
    -- 0. Derive reviewer identity from the calling user's auth context.
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    -- 1. Lock the leave record
    SELECT * INTO v_leave
    FROM leaves
    WHERE id = p_leave_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Leave request not found';
    END IF;

    IF v_leave.status = p_new_status THEN
        RAISE EXCEPTION 'Leave request is already %', p_new_status;
    END IF;

    -- 2. Verify caller is an HR employee of the leave's tenant.
    SELECT id INTO v_hr_employee_id
    FROM employees
    WHERE user_id = v_caller_uid
      AND tenant_id = v_leave.tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Caller is not an HR employee of this tenant';
    END IF;

    -- Additional role check via auth metadata.
    IF NOT EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = v_caller_uid
          AND metadata->>'role' = 'hr'
    ) THEN
        RAISE EXCEPTION 'Insufficient role: HR privileges required';
    END IF;

    -- 3. If reversing an already approved leave, restore the balance and remove attendance
    IF v_leave.status = 'approved' THEN
        IF v_leave.leave_type_id IS NOT NULL AND v_leave.approved_business_days IS NOT NULL THEN
            SELECT * INTO v_balance_row
            FROM leave_balances
            WHERE tenant_id = v_leave.tenant_id
              AND employee_id = v_leave.employee_id
              AND leave_type_id = v_leave.leave_type_id
              AND year = EXTRACT(YEAR FROM v_leave.start_date)
            FOR UPDATE;

            IF FOUND THEN
                UPDATE leave_balances
                SET used_days = used_days - v_leave.approved_business_days,
                    balance = balance + v_leave.approved_business_days,
                    updated_at = NOW()
                WHERE id = v_balance_row.id;
            END IF;
        END IF;

        -- Remove 'on_leave' attendance rows that fall within the calendar dates.
        -- We only delete if it's strictly 'on_leave' to prevent deleting actual punch data.
        DELETE FROM attendance
        WHERE employee_id = v_leave.employee_id
          AND date >= v_leave.start_date
          AND date <= v_leave.end_date
          AND status = 'on_leave'
          AND punch_in IS NULL;
    END IF;

    -- 4. Update status and reviewed details
    UPDATE leaves
    SET status = p_new_status,
        reviewed_by = v_hr_employee_id,
        reviewed_at = NOW(),
        rejection_reason = COALESCE(p_rejection_reason, rejection_reason)
    WHERE id = p_leave_id;

END;
$function$;
