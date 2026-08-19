-- Phase 1, step 7: named unit types, unit heads, and a safe hierarchy.
--
-- Design: doc/architecture/06-organisation-management.md §3.1, §3.2, §7.
--
-- The tenant names its own levels ("Practice", "Chapter", "Vertical"); every type carries a
-- system-understood `structural_role` from a fixed set, so approval routing, policy scoping and
-- reporting keep working regardless of naming. A tenant may invent new NAMES and NESTINGS, never a
-- new MEANING — that bound is what keeps the rest of the system buildable, and it is the direct fix
-- for how `.eq("department", "operations")` got hardcoded in the first place.

CREATE TABLE IF NOT EXISTS public.org_unit_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  structural_role text NOT NULL CHECK (structural_role IN ('division', 'department', 'team')),
  level_order     integer NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE public.org_units
  ADD COLUMN IF NOT EXISTS type_id          uuid REFERENCES public.org_unit_types(id),
  ADD COLUMN IF NOT EXISTS head_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS path             text;

-- Seed the three standard types for every existing tenant. Preseeding TYPES is discoverability;
-- units are NOT preseeded, because that would impose a shape. A company that does not care never
-- opens the screen and sees exactly the fixed model it expects.
INSERT INTO public.org_unit_types (tenant_id, name, structural_role, level_order)
SELECT t.id, v.name, v.role, v.lvl
FROM public.tenants t
CROSS JOIN (VALUES ('Division', 'division', 1), ('Department', 'department', 2), ('Team', 'team', 3))
  AS v(name, role, lvl)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Every existing unit is unit_type='department', so point them all at that type.
UPDATE public.org_units ou
SET type_id = t.id
FROM public.org_unit_types t
WHERE t.tenant_id = ou.tenant_id
  AND t.structural_role = 'department'
  AND ou.type_id IS NULL;

-- ── Cycle guard and materialised path ────────────────────────────────────────
-- A cycle would hang any recursive scope query. The existing check is client-side only
-- (utils/managerCycleValidation.ts), which binds nothing written through the API (P5).

CREATE OR REPLACE FUNCTION public.org_units_maintain_path()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_parent_path text;
  v_cursor      uuid;
  v_hops        integer := 0;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'An org unit cannot be its own parent';
    END IF;

    -- Walk up from the proposed parent; meeting ourselves means this edge closes a cycle.
    v_cursor := NEW.parent_id;
    WHILE v_cursor IS NOT NULL LOOP
      v_hops := v_hops + 1;
      IF v_cursor = NEW.id THEN
        RAISE EXCEPTION 'Org unit hierarchy cycle detected';
      END IF;
      IF v_hops > 64 THEN
        RAISE EXCEPTION 'Org unit hierarchy too deep (possible pre-existing cycle)';
      END IF;
      SELECT parent_id INTO v_cursor FROM public.org_units WHERE id = v_cursor;
    END LOOP;

    SELECT path INTO v_parent_path FROM public.org_units WHERE id = NEW.parent_id;
    NEW.path := coalesce(v_parent_path, '/') || NEW.id::text || '/';
  ELSE
    NEW.path := '/' || NEW.id::text || '/';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_units_path_guard ON public.org_units;
CREATE TRIGGER org_units_path_guard
BEFORE INSERT OR UPDATE OF parent_id ON public.org_units
FOR EACH ROW EXECUTE FUNCTION public.org_units_maintain_path();

-- Backfill paths for existing rows. Every current unit is a root (parent_id is NULL throughout), so
-- a single pass is sufficient; the trigger maintains them from here.
UPDATE public.org_units SET path = '/' || id::text || '/' WHERE path IS NULL AND parent_id IS NULL;

CREATE INDEX IF NOT EXISTS org_units_path_idx   ON public.org_units (tenant_id, path);
CREATE INDEX IF NOT EXISTS org_units_parent_idx ON public.org_units (parent_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.org_unit_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_unit_types_tenant_select ON public.org_unit_types
FOR SELECT TO authenticated
USING ((SELECT public.can_access_tenant(org_unit_types.tenant_id)));

CREATE POLICY org_unit_types_hr_all ON public.org_unit_types
FOR ALL TO authenticated
USING      ((SELECT public.can_access_tenant(org_unit_types.tenant_id)) AND (SELECT public.is_hr()))
WITH CHECK ((SELECT public.can_access_tenant(org_unit_types.tenant_id)) AND (SELECT public.is_hr()));
