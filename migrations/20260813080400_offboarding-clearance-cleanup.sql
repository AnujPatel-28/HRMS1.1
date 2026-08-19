-- Migration: Offboarding Exit Clearance Soft Cancellation
-- This migration updates the status constraint for exit_clearances to support 'cancelled',
-- and adds a trigger to automatically soft-cancel incomplete clearances when an exit request is rejected or withdrawn.

-- 1. Re-define status check constraint
ALTER TABLE public.exit_clearances DROP CONSTRAINT IF EXISTS exit_clearances_status_check;
ALTER TABLE public.exit_clearances ADD CONSTRAINT exit_clearances_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

-- 2. Trigger function to soft-cancel incomplete clearances
CREATE OR REPLACE FUNCTION public.cleanup_exit_clearances_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('rejected', 'withdrawn') AND OLD.status NOT IN ('rejected', 'withdrawn') THEN
    UPDATE public.exit_clearances
    SET status = 'cancelled',
        remarks = COALESCE(remarks, 'Exit request was ' || NEW.status),
        updated_at = now()
    WHERE exit_request_id = NEW.id
      AND status <> 'approved';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Bind the trigger to exit_requests
DROP TRIGGER IF EXISTS cleanup_exit_clearances_on_cancel_trigger ON public.exit_requests;
CREATE TRIGGER cleanup_exit_clearances_on_cancel_trigger
AFTER UPDATE OF status ON public.exit_requests
FOR EACH ROW EXECUTE FUNCTION public.cleanup_exit_clearances_on_cancel();
