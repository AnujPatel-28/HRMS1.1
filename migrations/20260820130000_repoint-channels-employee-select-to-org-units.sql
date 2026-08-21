-- Phase 1 Slice B, the sixth policy. Closes the divergence 20260820110000 deliberately left open.
--
-- ── Why this exists ──────────────────────────────────────────────────────────
-- 20260820110000 repointed FIVE policies off the drifting `employees.department` text column and onto
-- `employees.org_unit_id`. It explicitly declined to touch a sixth carrying the identical defect,
-- recording the consequence in its own footer:
--
--   "[29] chat_channels.channels_employee_select carries the identical defect ... after this file,
--    the CHANNEL visibility gate keys off drifting text while the MESSAGE gate keys off org_unit_id,
--    so the two can disagree — a user may list a channel whose messages they cannot read, or the
--    reverse. Widening this migration to six policies is a reviewer's call."
--
-- This file is that call, made: the two gates are brought onto the same column. Leaving them split is
-- worse than either endpoint, because "can list the channel" and "can read its messages" become two
-- different questions with two different answers.
--
-- ── Two defects in one policy ────────────────────────────────────────────────
-- D1. `e.department = ANY (target_departments)` — an exact match on a column that provably drifts
--     (06 §2.1: `HR`/`Hr`, `sales`/`Sales`). Same defect the five already fixed carried.
--
-- D2. P2 violation: BOTH branches resolve the caller with an inline
--     `SELECT ... FROM employees WHERE user_id = auth.uid()`. An inline subquery in a policy runs as
--     the INVOKING role, so `employees` RLS is re-entered — the shape that produced
--     `42P17 infinite recursion` on 2026-08-14 and took every authenticated read down. Both go
--     through the SECURITY DEFINER helpers 20260820110000 already created.
--
-- ── Authorisation delta a reviewer must accept ───────────────────────────────
-- The department branch changes WHICH COLUMN decides membership: `target_departments` (text names)
-- becomes `target_org_unit_ids` (uuid). It does NOT change who may list a channel in any other way,
-- and it makes this policy agree with chat_messages_select, which already reads target_org_unit_ids.
--
-- Vacuous on today's data — verified at author time: chat_channels holds 7 rows, **0 of type
-- 'department'**, and 0 with a non-empty target_departments. So no channel's visibility changes.
-- Applying while it is still vacuous is the cheapest this will ever be.
--
-- The custom branch is authorisation-NEUTRAL: `ccm.employee_id = get_my_employee_id()` resolves the
-- same single employee row (`user_id = auth.uid() LIMIT 1`) the JOIN did, and the baseline carried no
-- status filter, matching get_my_employee_id() exactly. This mirrors chat_messages_select's custom
-- branch byte for byte.
--
-- ── Frontend ─────────────────────────────────────────────────────────────────
-- src/shared/Chat.tsx `visibleChannels` was updated in the same session to check
-- target_org_unit_ids first and fall back to the legacy text, so the client-side list and this policy
-- now agree. src/shared/Chat.tsx:481 writes BOTH columns on channel creation, so nothing fails closed.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
-- The prior definition is quoted verbatim below; re-run it to restore.

-- ── [29] chat_channels.channels_employee_select ──────────────────────────────
-- WAS:
--   USING (((type = 'global'::text) OR ((type = 'department'::text) AND (EXISTS ( SELECT 1
--      FROM employees e
--     WHERE ((e.user_id = ( SELECT auth.uid() AS uid))
--       AND (e.department = ANY (chat_channels.target_departments))))))
--     OR ((type = 'custom'::text) AND (EXISTS ( SELECT 1
--      FROM (chat_channel_members ccm
--        JOIN employees e ON ((e.id = ccm.employee_id)))
--     WHERE ((ccm.channel_id = chat_channels.id) AND (e.user_id = ( SELECT auth.uid() AS uid))))))))
DROP POLICY IF EXISTS "channels_employee_select" ON public.chat_channels;
CREATE POLICY "channels_employee_select" ON public.chat_channels
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  (type = 'global'::text)
  OR ((type = 'department'::text) AND public.get_my_org_unit_id() = ANY (chat_channels.target_org_unit_ids))
  OR ((type = 'custom'::text) AND EXISTS (
        SELECT 1
        FROM public.chat_channel_members ccm
        WHERE ccm.channel_id = chat_channels.id
          AND ccm.employee_id = public.get_my_employee_id()
      ))
);

-- ── Verify after applying ────────────────────────────────────────────────────
--   No policy may still match employees.department:
--     SELECT tablename, policyname FROM pg_policies
--     WHERE coalesce(qual,'') LIKE '%e.department%'
--        OR coalesce(qual,'') LIKE '%employees.department%';
--     -- expect zero rows
--
--   And an authenticated read must still succeed (rows or [], never a permission error):
--     db.from("chat_channels").select("id")
