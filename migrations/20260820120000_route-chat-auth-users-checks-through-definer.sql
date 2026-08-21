-- Fix: the chat module is non-functional in production. Every read of chat_messages, chat_channels
-- and chat_channel_members fails with `permission denied for table users`, for anon AND for every
-- authenticated caller. src/shared/Chat.tsx reads all three directly via db.from(...), so the whole
-- feature errors out.
--
-- ── Cause ────────────────────────────────────────────────────────────────────
-- Three policies resolve "is the caller HR?" with an inline read of auth.users:
--
--   EXISTS (SELECT 1 FROM auth.users u
--           WHERE u.id = (SELECT auth.uid())
--             AND COALESCE(u.metadata ->> 'role', '') = 'hr')
--
-- A table read inside a policy expression runs as the INVOKING role, and only `project_admin` holds
-- SELECT on auth.users — `anon` and `authenticated` hold nothing:
--
--   SELECT grantee, privilege_type FROM information_schema.table_privileges
--   WHERE table_schema = 'auth' AND table_name = 'users';   -- project_admin only
--
-- So the privilege check fails before the predicate is ever evaluated. This is the same class of
-- defect as the P2 inline-`employees` subqueries that 20260820110000 removed, one table over: it is
-- not recursion, it is a missing GRANT that cannot be granted without exposing auth.users wholesale.
--
-- ── Not introduced by 20260820110000 ─────────────────────────────────────────
-- That migration reproduced chat_messages_select's two auth.users subqueries byte-identical from the
-- baseline (deliberately — its D3 note declined to substitute is_hr() because that would change which
-- source of truth the HR branch reads). Proof the defect predates it: channels_hr_all and
-- members_hr_all carry the same subquery, were never touched by it, and fail identically.
--
-- ── Why a new helper and NOT is_hr() ─────────────────────────────────────────
-- is_hr() is a DIFFERENT predicate. It additionally requires the JWT's tenant_id to match
-- get_auth_tenant_id(), and it ORs in an employee_roles branch. Substituting it here would be a
-- silent authorisation change in three policies. jwt_role_is_hr() below reproduces the existing
-- predicate EXACTLY — same COALESCE, same bare metadata check, no tenant scoping — so every policy
-- rewritten in this file is authorisation-NEUTRAL. The only thing that changes is WHICH ROLE reads
-- auth.users: the definer instead of the caller.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Re-create the three policies with the inline EXISTS blocks quoted above each one. That restores the
-- outage, so it is a rollback of last resort.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. The helper
-- ═══════════════════════════════════════════════════════════════════════════════

-- Byte-for-byte the predicate the three policies used inline, executed as the definer so the caller
-- needs no privilege on auth.users. Returns false (never NULL) for anon: auth.uid() is NULL, no row
-- matches, EXISTS is false. Reads only the caller's own row and returns a boolean, so it leaks
-- nothing.
CREATE OR REPLACE FUNCTION public.jwt_role_is_hr()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = (SELECT auth.uid())
      AND COALESCE(u.metadata ->> 'role'::text, ''::text) = 'hr'::text
  );
$$;

-- chat_messages_select is `TO public`, and a `TO public` policy IS evaluated for anon. Revoking
-- PUBLIC would turn an anon GET /chat_messages into `permission denied for function` — the same trap
-- 20260820110000 documented for get_my_org_unit_id / get_my_employee_id.
GRANT EXECUTE ON FUNCTION public.jwt_role_is_hr() TO PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. The three policies
--
-- AS PERMISSIVE, FOR <cmd> and TO <role> are preserved exactly. The ONLY edit in each is swapping
-- the inline EXISTS(...auth.users...) for public.jwt_role_is_hr().
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── chat_channels.channels_hr_all ────────────────────────────────────────────
-- WAS (both USING and WITH CHECK):
--   (EXISTS ( SELECT 1 FROM auth.users u
--     WHERE ((u.id = ( SELECT auth.uid() AS uid))
--       AND (COALESCE((u.metadata ->> 'role'::text), ''::text) = 'hr'::text))))
DROP POLICY IF EXISTS "channels_hr_all" ON public.chat_channels;
CREATE POLICY "channels_hr_all" ON public.chat_channels
AS PERMISSIVE
FOR ALL
TO authenticated
USING (public.jwt_role_is_hr())
WITH CHECK (public.jwt_role_is_hr());

-- ── chat_channel_members.members_hr_all ──────────────────────────────────────
-- WAS: identical to the above, on both USING and WITH CHECK.
DROP POLICY IF EXISTS "members_hr_all" ON public.chat_channel_members;
CREATE POLICY "members_hr_all" ON public.chat_channel_members
AS PERMISSIVE
FOR ALL
TO authenticated
USING (public.jwt_role_is_hr())
WITH CHECK (public.jwt_role_is_hr());

-- ── chat_messages.chat_messages_select ───────────────────────────────────────
-- Reproduced from 20260820110000 with its two inline auth.users EXISTS blocks — and ONLY those —
-- replaced by the helper. The org-unit and channel-membership logic that migration introduced is
-- carried over unchanged.
DROP POLICY IF EXISTS "chat_messages_select" ON public.chat_messages;
CREATE POLICY "chat_messages_select" ON public.chat_messages
AS PERMISSIVE
FOR SELECT
TO public
USING (
  (
    (is_deleted = false)
    OR public.jwt_role_is_hr()
    OR (chat_messages.sender_id = public.get_my_employee_id())
  )
  AND (
    public.jwt_role_is_hr()
    OR EXISTS (
      SELECT 1
      FROM public.chat_channels cc
      WHERE cc.name = chat_messages.channel
        AND (
          (cc.type = 'global'::text)
          OR ((cc.type = 'department'::text) AND public.get_my_org_unit_id() = ANY (cc.target_org_unit_ids))
          OR ((cc.type = 'custom'::text) AND EXISTS (
                SELECT 1
                FROM public.chat_channel_members ccm
                WHERE ccm.channel_id = cc.id
                  AND ccm.employee_id = public.get_my_employee_id()
              ))
        )
    )
  )
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Verify after applying
--
--   Authenticated read of each table must return rows or [], never a permission error:
--     db.from("chat_channels").select("id")
--     db.from("chat_messages").select("id")
--     db.from("chat_channel_members").select("id")
--
--   And no policy should inline-read auth.users any more:
--     SELECT tablename, policyname FROM pg_policies
--     WHERE coalesce(qual,'') LIKE '%auth.users%' OR coalesce(with_check,'') LIKE '%auth.users%';
--     -- expect zero rows
-- ═══════════════════════════════════════════════════════════════════════════════
