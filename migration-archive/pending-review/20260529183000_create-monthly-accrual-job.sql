-- Migration: Create monthly leave accrual function and schedule cron job
-- Created: 2026-05-29

-- 1. Create the stored procedure to accrue monthly leaves with an idempotency guard
CREATE OR REPLACE FUNCTION public.fn_accrue_monthly_leaves()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_rec RECORD;
    v_target_year integer;
    v_month_start date;
BEGIN
    v_target_year := EXTRACT(YEAR FROM CURRENT_DATE);
    v_month_start := DATE_TRUNC('month', CURRENT_DATE)::date;

    FOR v_rec IN
        SELECT lb.id, lt.days_per_year
        FROM public.leave_balances lb
        JOIN public.leave_types lt ON lb.leave_type_id = lt.id
        WHERE lt.accrual_type = 'monthly'
          AND lt.is_active = true
          AND lb.year = v_target_year
          AND (lb.last_accrual_date IS NULL OR lb.last_accrual_date < v_month_start)
    LOOP
        UPDATE public.leave_balances
        SET balance = balance + (v_rec.days_per_year / 12.0),
            last_accrual_date = CURRENT_DATE,
            updated_at = NOW()
        WHERE id = v_rec.id;
    END LOOP;
END;
$$;

-- 2. Schedule the cron job to run on the 1st of every month at midnight
SELECT cron.schedule('accrue-monthly-leaves', '0 0 1 * *', 'SELECT public.fn_accrue_monthly_leaves()');
