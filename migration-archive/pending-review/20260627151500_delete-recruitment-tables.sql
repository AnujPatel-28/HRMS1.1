-- Migration to delete recruitment-related tables and routines from the database
DROP TABLE IF EXISTS public.job_alerts CASCADE;
DROP TABLE IF EXISTS public.resume_access_log CASCADE;
DROP TABLE IF EXISTS public.nvites CASCADE;
DROP TABLE IF EXISTS public.subscription_events CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.custom_proposals CASCADE;
DROP TABLE IF EXISTS public.application_events CASCADE;
DROP TABLE IF EXISTS public.application_status_history CASCADE;
DROP TABLE IF EXISTS public.applications CASCADE;
DROP TABLE IF EXISTS public.candidate_resumes CASCADE;
DROP TABLE IF EXISTS public.candidate_profiles CASCADE;
DROP TABLE IF EXISTS public.jobs CASCADE;
DROP TABLE IF EXISTS public.company_profiles CASCADE;
DROP TABLE IF EXISTS public.recruiter_profiles CASCADE;
DROP FUNCTION IF EXISTS public.update_application_status CASCADE;
