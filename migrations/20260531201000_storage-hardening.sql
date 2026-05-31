-- Migration: Phase 2 Storage Hardening
-- Creates employee-profile-photos bucket and secures employee-documents.

-- 1. Create employee-profile-photos (Public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-profile-photos', 'employee-profile-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Make employee-documents Private
UPDATE storage.buckets
SET public = false
WHERE id = 'employee-documents';

-- 3. Storage RLS Policies for employee-profile-photos
-- Public SELECT
CREATE POLICY "Public profiles are viewable by everyone"
ON storage.objects FOR SELECT
USING ( bucket_id = 'employee-profile-photos' );

-- Authenticated INSERT
CREATE POLICY "Authenticated users can upload profile photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'employee-profile-photos' );

-- Authenticated UPDATE
CREATE POLICY "Authenticated users can update profile photos"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'employee-profile-photos' );

-- Authenticated DELETE
CREATE POLICY "Authenticated users can delete profile photos"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'employee-profile-photos' );

-- 4. Storage RLS Policies for employee-documents
-- Authenticated SELECT (Only within tenant - simplified to auth users, assuming signed URLs or strict tenant checks in API)
CREATE POLICY "Authenticated users can read employee documents"
ON storage.objects FOR SELECT
TO authenticated
USING ( bucket_id = 'employee-documents' );

CREATE POLICY "Authenticated users can upload employee documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'employee-documents' );

CREATE POLICY "Authenticated users can update employee documents"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'employee-documents' );

CREATE POLICY "Authenticated users can delete employee documents"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'employee-documents' );
