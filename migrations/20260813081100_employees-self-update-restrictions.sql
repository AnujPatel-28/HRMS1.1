-- Release 6B-Hardening: Enforce employee update restrictions on administrative fields
--
-- This migration adds a BEFORE UPDATE trigger on public.employees to ensure that
-- standard employees (non-HR) can only modify self-service fields on their own profile
-- and cannot escalate their role, change their manager, status, grade, or other HR-controlled fields.

CREATE OR REPLACE FUNCTION public.enforce_employee_update_restrictions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- If there is no authenticated user (e.g. system/postgres session), allow the update
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- If actor is HR, allow the update to proceed
  IF public.is_hr() THEN
    RETURN NEW;
  END IF;

  -- Otherwise, verify that the employee is only updating their own row
  IF OLD.user_id IS DISTINCT FROM auth.uid() OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: employees can only update their own profile';
  END IF;

  -- Verify that restricted columns have not changed
  IF OLD.id IS DISTINCT FROM NEW.id OR
     OLD.user_id IS DISTINCT FROM NEW.user_id OR
     OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
     OLD.email IS DISTINCT FROM NEW.email OR
     OLD.full_name IS DISTINCT FROM NEW.full_name OR
     OLD.role IS DISTINCT FROM NEW.role OR
     OLD.status IS DISTINCT FROM NEW.status OR
     OLD.grade IS DISTINCT FROM NEW.grade OR
     OLD.manager_id IS DISTINCT FROM NEW.manager_id OR
     OLD.secondary_manager_id IS DISTINCT FROM NEW.secondary_manager_id OR
     OLD.org_unit_id IS DISTINCT FROM NEW.org_unit_id OR
     OLD.job_title_id IS DISTINCT FROM NEW.job_title_id OR
     OLD.location_id IS DISTINCT FROM NEW.location_id OR
     OLD.employment_type_id IS DISTINCT FROM NEW.employment_type_id OR
     OLD.date_of_joining IS DISTINCT FROM NEW.date_of_joining OR
     OLD.department IS DISTINCT FROM NEW.department OR
     OLD.designation IS DISTINCT FROM NEW.designation OR
     OLD.employment_confirmed_at IS DISTINCT FROM NEW.employment_confirmed_at OR
     OLD.probation_end_date IS DISTINCT FROM NEW.probation_end_date OR
     OLD.probation_status IS DISTINCT FROM NEW.probation_status OR
     OLD.created_by IS DISTINCT FROM NEW.created_by OR
     OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Forbidden: employees cannot modify administrative profile fields (role, tenant, manager, status, grade, job details)';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_update_restrictions_trigger ON public.employees;

CREATE TRIGGER employees_update_restrictions_trigger
  BEFORE UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_employee_update_restrictions();
