-- P3-03 Tier 1. Prerequisite measured with raw Socket.IO on TB-M1M2:
-- channels SELECT and messages INSERT evaluate current_user/auth.uid().
-- Already-joined sockets keep receiving after denial: platform limit, not repaired here.
-- Deployment also MUST PATCH /api/storage/buckets/chat-attachments {"isPublic":false}.
-- SQL cannot set the managed bucket flag. The acceptance runner verifies it separately.

-- Invoker deliberately delegates channel visibility to the existing table RLS.
-- Tier 2 owns replacing the legacy HR/private-channel and write policies.
CREATE FUNCTION public.p3_realtime_topic_readable(topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.chat_channels c
      WHERE topic = 'chat:' || c.tenant_id::text || ':' || c.id::text
        AND c.tenant_id = public.get_auth_tenant_id())
    OR (topic = 'chat-channels:' || public.get_auth_tenant_id()::text
        AND public.can_access_tenant(public.get_auth_tenant_id())
        AND public.tenant_has_module('chat') AND public.get_my_employee_id() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.employees e
      WHERE topic = 'notifications:' || e.tenant_id::text || ':' || e.id::text
        AND e.user_id = auth.uid() AND e.tenant_id = public.get_auth_tenant_id()
        AND public.can_access_tenant(e.tenant_id))
  );
$$;
REVOKE ALL ON FUNCTION public.p3_realtime_topic_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_realtime_topic_readable(text) TO authenticated;

ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY p3_realtime_subscribe ON realtime.channels FOR SELECT TO authenticated
  USING (public.p3_realtime_topic_readable(realtime.channel_name()));
CREATE POLICY p3_realtime_tenant_fence ON realtime.channels AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.p3_realtime_topic_readable(realtime.channel_name()));
-- No permissive INSERT policy: deny all client publishing, including existing sockets.
CREATE POLICY p3_realtime_publish_denied ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (false);
UPDATE realtime.channels SET enabled=false
  WHERE pattern IN ('chat_messages','chat_channels','chat:%','notifications:%');
INSERT INTO realtime.channels(pattern,description,enabled) VALUES
  ('chat:%:%','P3 tenant and channel id events',true),
  ('chat-channels:%','P3 tenant channel-list invalidations (ids only)',true),
  ('notifications:%:%','P3 tenant and recipient id events',true);

-- Captured with pg_get_functiondef on 2026-09-21; preserve signatures/return paths.
-- Row tenant identity is part of every topic; never resolve a channel by its name.
CREATE OR REPLACE FUNCTION public.notify_chat_message()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM realtime.publish('chat:' || OLD.tenant_id::text || ':' || OLD.channel_id::text,
      'DELETE_message', jsonb_build_object('op',TG_OP,'id',OLD.id,'channel_id',OLD.channel_id));
    RETURN OLD;
  ELSE
    PERFORM realtime.publish('chat:' || NEW.tenant_id::text || ':' || NEW.channel_id::text,
      TG_OP || '_message', jsonb_build_object('op',TG_OP,'id',NEW.id,'channel_id',NEW.channel_id));
    RETURN NEW;
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.notify_chat_channel()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM realtime.publish('chat-channels:' || OLD.tenant_id::text, TG_OP || '_channel',
      jsonb_build_object('op',TG_OP,'id',OLD.id));
    RETURN OLD;
  ELSE
    PERFORM realtime.publish('chat-channels:' || NEW.tenant_id::text, TG_OP || '_channel',
      jsonb_build_object('op',TG_OP,'id',NEW.id));
    RETURN NEW;
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.notify_employee_notification()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  PERFORM realtime.publish(
    'notifications:' || NEW.tenant_id::text || ':' || NEW.employee_id::text,
    'INSERT_notification', jsonb_build_object('op',TG_OP,'id',NEW.id)
  );
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_chat_message(), public.notify_chat_channel(),
  public.notify_employee_notification() FROM PUBLIC, anon;

-- The frontend stores new attachment keys in attachment_url as chat-attachments:<key>.
-- Legacy URLs remain readable only through their RLS-visible message/channel record.
CREATE FUNCTION public.p3_chat_object_readable(object_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.chat_channels c
      WHERE split_part(object_key,'/',1)=c.tenant_id::text
        AND split_part(object_key,'/',2)=c.id::text
        AND c.tenant_id=public.get_auth_tenant_id())
    OR EXISTS (SELECT 1 FROM public.chat_messages m JOIN public.chat_channels c
      ON c.id=m.channel_id AND c.tenant_id=m.tenant_id
      WHERE m.tenant_id=public.get_auth_tenant_id() AND NOT m.is_deleted
        AND (m.attachment_url='chat-attachments:' || object_key
          OR split_part(m.attachment_url,'/api/storage/buckets/chat-attachments/objects/',2)
             IN (object_key,replace(object_key,'/','%2F'))))
  );
$$;
REVOKE ALL ON FUNCTION public.p3_chat_object_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p3_chat_object_readable(text) TO authenticated;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY p3_chat_attachment_fence ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (bucket <> 'chat-attachments' OR public.p3_chat_object_readable(key))
  WITH CHECK (bucket <> 'chat-attachments' OR (
    split_part(key,'/',1)=public.get_auth_tenant_id()::text
    AND public.p3_chat_object_readable(key)));
CREATE POLICY p3_chat_attachment_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket='chat-attachments' AND public.p3_chat_object_readable(key));
CREATE POLICY p3_chat_attachment_no_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon
  USING (bucket <> 'chat-attachments') WITH CHECK (bucket <> 'chat-attachments');

REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.chat_channels,public.chat_channel_members,
  public.chat_messages,public.notifications,public.posts,public.post_reactions FROM anon;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['notify_chat_message','notify_chat_channel','notify_employee_notification',
    'p3_realtime_topic_readable','p3_chat_object_readable'] LOOP
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=fn) <> 1 THEN
      RAISE EXCEPTION 'P3 function overload invariant failed: %', fn;
    END IF;
  END LOOP;
END $$;
