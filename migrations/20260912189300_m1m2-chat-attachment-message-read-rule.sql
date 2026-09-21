-- P3-03 Tier 2 authorized single forward fix (lead, 2026-09-21).
-- Defect: 189200 widened chat_channels SELECT to channel.manage holders (contracts §16 A1: HR
-- manages channels, never reads private ones). p3_chat_object_readable (189100) decides attachment
-- access by channel-ROW visibility, so a non-member channel manager could read and write a private
-- channel's attachments. Attachments must follow the MESSAGE-read rule, as 189200 already did for
-- realtime topics. Same signature, body derived from 189100 (the live definition).
CREATE OR REPLACE FUNCTION public.p3_chat_object_readable(object_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_channels c
    WHERE split_part(object_key,'/',1)=c.tenant_id::text
      AND split_part(object_key,'/',2)=c.id::text
      AND c.tenant_id=public.get_auth_tenant_id()
      AND public.p3_channel_audience(c.id)
  );
$$;
REVOKE ALL ON FUNCTION public.p3_chat_object_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_chat_object_readable(text) TO authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname='p3_chat_object_readable') <> 1 THEN
    RAISE EXCEPTION 'P3 function overload invariant failed: p3_chat_object_readable';
  END IF;
END $$;
