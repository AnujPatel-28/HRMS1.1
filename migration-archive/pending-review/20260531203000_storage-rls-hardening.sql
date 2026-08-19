-- Migration: Hardened Storage RLS Policies
-- Path: migrations/20260531203000_storage-rls-hardening.sql

-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 1. Drop existing storage policies if they exist
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read employee documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload employee documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update employee documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete employee documents" ON storage.objects;

-- 2. Public profile photos select policy (Publicly readable)
CREATE POLICY "Public profiles are viewable by everyone"
ON storage.objects FOR SELECT
USING ( bucket = 'employee-profile-photos' );

-- 3. Profile photo write/update/delete policies (Tenant-isolated)
CREATE POLICY "Authenticated users can upload profile photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket = 'employee-profile-photos'
  AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
);

CREATE POLICY "Authenticated users can update profile photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket = 'employee-profile-photos'
  AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
)
WITH CHECK (
  bucket = 'employee-profile-photos'
  AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
);

CREATE POLICY "Authenticated users can delete profile photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket = 'employee-profile-photos'
  AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
);

-- 4. Private employee documents policies (Tenant-isolated read/write)
CREATE POLICY "Authenticated users can read employee documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket = 'employee-documents'
  AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
);

CREATE POLICY "Authenticated users can upload employee documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket = 'employee-documents'
  AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
);

CREATE POLICY "Authenticated users can update employee documents"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket = 'employee-documents'
  AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
)
WITH CHECK (
  bucket = 'employee-documents'
  AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
);

CREATE POLICY "Authenticated users can delete employee documents"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket = 'employee-documents'
  AND key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  AND public.can_access_tenant((split_part(key, '/', 1))::uuid)
);
