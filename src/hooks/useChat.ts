import { useCallback, useState } from "react";
import { useTenant } from "../contexts/TenantContext";
import { db, realtime } from "../insforge/client";
import type { ChatMessage } from "../types";

export function useChat(channel = "general") {
  const { tenantId } = useTenant();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    const { data } = await db
      .from("chat_messages")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("channel", channel)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });
    setMessages((data as ChatMessage[]) ?? []);
    setLoading(false);
  }, [channel, tenantId]);

  const sendMessage = useCallback(
    async (senderId: string, content: string) => {
      await db.from("chat_messages").insert([
        {
          sender_id: senderId,
          tenant_id: tenantId,
          channel,
          content,
        },
      ]);
      await fetchMessages();
    },
    [channel, fetchMessages, tenantId],
  );

  const connectRealtime = useCallback(() => {
    void realtime.connect();
    void realtime.subscribe(channel);
    const handler = () => void fetchMessages();
    const tenantScopedHandler = (payload: ChatMessage) => {
      if (payload.tenant_id === tenantId) handler();
    };
    realtime.on("message", tenantScopedHandler);

    return () => {
      realtime.off("message", tenantScopedHandler);
      realtime.unsubscribe(channel);
      realtime.disconnect();
    };
  }, [channel, fetchMessages, tenantId]);

  return { messages, loading, fetchMessages, sendMessage, connectRealtime };
}
