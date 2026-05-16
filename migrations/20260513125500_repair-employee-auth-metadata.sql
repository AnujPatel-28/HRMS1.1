UPDATE auth.users u
SET metadata = jsonb_build_object('role', 'employee', 'tenant_id', e.tenant_id),
    email_verified = true,
    updated_at = now()
FROM public.employees e
WHERE lower(u.email) = lower(e.email)
  AND e.status <> 'terminated'
  AND (u.metadata->>'role' IS NULL OR u.metadata->>'role' = 'employee');

UPDATE public.employees e
SET user_id = u.id
FROM auth.users u
WHERE lower(u.email) = lower(e.email)
  AND e.status <> 'terminated'
  AND (u.metadata->>'role' = 'employee');
