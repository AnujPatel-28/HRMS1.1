import { useCallback, useState } from "react";
import { useTenant } from "../contexts/TenantContext";
import { db, realtime } from "../insforge/client";
import type { ChatMessage } from "../types";

export function useChat(channel = "general") {
  const { tenantId } = useTenant();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveChannel = useCallback(async () => {
    const { data, error } = await db.from("chat_channels").select("id")
      .eq("tenant_id", tenantId).eq("name", channel).maybeSingle();
    if (error || !data) throw new Error("Channel unavailable");
    return data.id as string;
  }, [channel, tenantId]);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      const channelId = await resolveChannel();
      const { data, error } = await db
        .from("chat_messages")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("channel_id", channelId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true });
      if (error) throw error;
      setMessages((data as ChatMessage[]) ?? []);
      setError(null);
    } catch {
      setMessages([]);
      setError("Chat is unavailable. Please retry.");
    } finally {
      setLoading(false);
    }
  }, [resolveChannel, tenantId]);

  const sendMessage = useCallback(
    async (senderId: string, content: string) => {
      const channelId = await resolveChannel();
      const { error } = await db.from("chat_messages").insert([
        {
          sender_id: senderId,
          tenant_id: tenantId,
          channel,
          channel_id: channelId,
          content,
        },
      ]);
      if (error) throw error;
      await fetchMessages();
    },
    [channel, fetchMessages, resolveChannel, tenantId],
  );

  const connectRealtime = useCallback(() => {
    let active = true;
    let topic: string | undefined;
    const handler = (payload: { meta?: { channel?: string } }) => {
      if (active && topic && [topic, `realtime:${topic}`].includes(payload.meta?.channel ?? "")) void fetchMessages();
    };
    const setup = async () => {
      const channelId = await resolveChannel();
      await realtime.connect();
      if (!active) return;
      topic = `chat:${tenantId}:${channelId}`;
      const result = await realtime.subscribe(topic);
      if (!active) { realtime.unsubscribe(topic); return; }
      if (!result.ok) throw new Error("Chat subscription denied");
    };
    const reconnect = () => { if (active) void fetchMessages(); };
    for (const event of ["INSERT_message", "UPDATE_message", "DELETE_message"]) realtime.on(event, handler);
    realtime.on("connect", reconnect);
    void setup().catch(() => { if (active) setError("Live chat is unavailable. Please retry."); });

    return () => {
      active = false;
      for (const event of ["INSERT_message", "UPDATE_message", "DELETE_message"]) realtime.off(event, handler);
      realtime.off("connect", reconnect);
      if (topic) realtime.unsubscribe(topic);
    };
  }, [resolveChannel, fetchMessages, tenantId]);

  return { messages, loading, error, fetchMessages, sendMessage, connectRealtime };
}
