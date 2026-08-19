-- Slice B, part 1 of 2: the ADDITIVE half. Safe to apply immediately; no policy is touched here.
--
-- WHY THIS FILE EXISTS — a deadlock in the original bundling.
--
-- 20260819120000_repoint-department-rls-to-org-units.sql (still in migrations-pending-deploy/)
-- bundles two things with opposite gating:
--
--   section 2  ADD COLUMN + backfill        additive — nothing reads these columns yet
--   section 3  five RLS policy replacements gated — needs the frontend to be writing the new columns
--
-- The gate on section 3 is "the SPA must populate the uuid target columns first". But the SPA cannot
-- populate a column that does not exist, and the column is created by the very file that is gated.
-- Frontend and migration each waited on the other. Verified against the live backend 2026-08-20:
--
--   chat_channels          target_org_unit_ids   ABSENT
--   hr_policies            include_descendants   ABSENT
--   hr_policies            org_unit_id           present (from 20260813081500)
--
-- Splitting breaks the cycle. Apply order becomes:
--   1. THIS FILE                     → columns exist
--   2. deploy the SPA write paths    → new channels/projects carry uuid targets
--   3. review pass on §9.2 widening  → see the NOTES file
--   4. apply the gated policy half   → its section 2 re-runs as a no-op
--
-- SAFE TO RUN TWICE, AND DELIBERATELY SO. Every statement below is copied verbatim from section 2 of
-- the gated file, which was already written idempotently — ADD COLUMN IF NOT EXISTS, and each
-- backfill guarded on the target being unset. So when the gated file is applied in step 4 its own
-- section 2 becomes a no-op rather than a conflict, and that file needs no edit.
--
-- Rollback: DROP COLUMN public.chat_channels.target_org_unit_ids and
-- public.hr_policies.include_descendants. The projects backfill writes a jsonb key
-- (visibility_config -> 'org_unit_ids'); removing it is a jsonb operation, not DDL.

-- 06 §9.2: per-policy subtree toggle. Some policies are unit-only (a team SOP), some unit-and-below
-- (a division leave policy). Defaulting to true is the widening flagged in the NOTES file — but note
-- that NOTHING READS THIS COLUMN until part 2 is applied, so adding it here widens nothing.
ALTER TABLE public.hr_policies
  ADD COLUMN IF NOT EXISTS include_descendants boolean NOT NULL DEFAULT true;

ALTER TABLE public.chat_channels
  ADD COLUMN IF NOT EXISTS target_org_unit_ids uuid[];

-- hr_policies.department_filter is INTENTIONALLY KEPT. Dropping it is 06 §5 step 6 and is separately
-- deploy-gated behind the ten screens that still render the hardcoded department list.
--
-- Every backfill is case-insensitive and tenant-scoped. Case-insensitive because the documented drift
-- IS case (`HR`/`Hr`); an exact match would miss precisely the rows that motivated this work.
-- Tenant-scoped because a cross-tenant name match baked into a migration is a tenancy breach.
UPDATE public.hr_policies p
SET org_unit_id = ou.id
FROM public.org_units ou
WHERE p.org_unit_id IS NULL
  AND p.department_filter IS NOT NULL
  AND ou.tenant_id = p.tenant_id
  AND lower(ou.name) = lower(p.department_filter);

UPDATE public.chat_channels cc
SET target_org_unit_ids = m.ids
FROM (
  SELECT c.id, array_agg(DISTINCT ou.id) AS ids
  FROM public.chat_channels c
  CROSS JOIN LATERAL unnest(c.target_departments) AS d(name)
  JOIN public.org_units ou
    ON ou.tenant_id = c.tenant_id
   AND lower(ou.name) = lower(d.name)
  WHERE c.target_departments IS NOT NULL
  GROUP BY c.id
) m
WHERE cc.id = m.id
  AND cc.target_org_unit_ids IS NULL;

-- projects needs no DDL: visibility_config already carries uuid text in 'employee_ids', so
-- 'org_unit_ids' follows the shape the table already uses.
UPDATE public.projects p
SET visibility_config = jsonb_set(
      p.visibility_config,
      '{org_unit_ids}',
      coalesce((
        SELECT jsonb_agg(DISTINCT ou.id::text)
        FROM jsonb_array_elements_text(p.visibility_config -> 'departments') AS d(name)
        JOIN public.org_units ou
          ON ou.tenant_id = p.tenant_id
         AND lower(ou.name) = lower(d.name)
      ), '[]'::jsonb)
    )
WHERE p.visibility_config ->> 'type' = 'departments'
  AND jsonb_typeof(p.visibility_config -> 'departments') = 'array'
  AND NOT (p.visibility_config ? 'org_unit_ids');
