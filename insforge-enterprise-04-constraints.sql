DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_subdomain_unique') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_subdomain_unique UNIQUE (subdomain);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_plan_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_plan_check CHECK (plan IN ('trial', 'starter', 'growth', 'pro'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_status_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_status_check CHECK (status IN ('trial', 'active', 'suspended', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_max_employees_positive') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_max_employees_positive CHECK (max_employees > 0);
  END IF;
END $$;
