-- P3-03 authorized single forward fix. --storage-only reproduced:
-- FAIL 7 forged cross-tenant attachment reference denied {"ok":true}
-- A caller-authored message URL must never grant authority over another tenant's key.
-- Catalogue inspection found zero pre-existing chat-attachments objects (only our fixture).
-- Unqualified legacy keys fail closed; any future import requires an explicit trusted mapping.
CREATE OR REPLACE FUNCTION public.p3_chat_object_readable(object_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_channels c
    WHERE split_part(object_key,'/',1)=c.tenant_id::text
      AND split_part(object_key,'/',2)=c.id::text
      AND c.tenant_id=public.get_auth_tenant_id()
  );
$$;
REVOKE ALL ON FUNCTION public.p3_chat_object_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_chat_object_readable(text) TO authenticated;
