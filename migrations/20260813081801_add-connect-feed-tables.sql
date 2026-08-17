-- Migration: Connect feed tables (posts + reactions)
-- Created: 2026-08-13
-- Target: public.posts, public.post_reactions
--
-- These two tables existed only on the updateSuggestion backend branch, which is
-- now unrecoverable (502). Definitions and policy bodies are recovered verbatim
-- from the saved branch-vs-parent diff so parent matches what the
-- updateSuggestion frontend's Connect page (src/shared/pages/Connect.tsx) expects.

CREATE TABLE IF NOT EXISTS public.posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  author_id uuid NOT NULL,
  content text NOT NULL,
  image_url text,
  type text NOT NULL DEFAULT 'post'::text,
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (author_id) REFERENCES public.employees(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_posts_tenant_created
  ON public.posts USING btree (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.post_reactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  reaction text NOT NULL DEFAULT 'like'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (post_id, employee_id),
  FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_reactions_post
  ON public.post_reactions USING btree (post_id);

-- ==========================================
-- RLS
-- ==========================================
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_reactions TO authenticated;

-- Read: anything inside your own tenant.
DROP POLICY IF EXISTS posts_select ON public.posts;
CREATE POLICY posts_select ON public.posts
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (tenant_id = (SELECT get_auth_tenant_id()));

-- Write: only as yourself, in your own tenant; announcements are HR-only.
DROP POLICY IF EXISTS posts_insert ON public.posts;
CREATE POLICY posts_insert ON public.posts
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = (SELECT get_auth_tenant_id())
    AND author_id = (SELECT employees.id FROM public.employees WHERE employees.user_id = (SELECT auth.uid()))
    AND (type <> 'announcement'::text OR (SELECT is_hr()))
  );

DROP POLICY IF EXISTS posts_update ON public.posts;
CREATE POLICY posts_update ON public.posts
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT get_auth_tenant_id()))
  WITH CHECK (tenant_id = (SELECT get_auth_tenant_id()));

-- Delete: your own post, or any post in your tenant if you are HR.
DROP POLICY IF EXISTS posts_delete ON public.posts;
CREATE POLICY posts_delete ON public.posts
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    tenant_id = (SELECT get_auth_tenant_id())
    AND (
      author_id = (SELECT employees.id FROM public.employees WHERE employees.user_id = (SELECT auth.uid()))
      OR (SELECT is_hr())
    )
  );

DROP POLICY IF EXISTS post_reactions_tenant_isolation ON public.post_reactions;
CREATE POLICY post_reactions_tenant_isolation ON public.post_reactions
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT get_auth_tenant_id()))
  WITH CHECK (tenant_id = (SELECT get_auth_tenant_id()));
