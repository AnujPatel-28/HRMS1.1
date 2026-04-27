import { useCallback, useState } from "react";
import { db, realtime } from "../insforge/client";
import type { ChatMessage } from "../types";

export function useChat(channel = "general") {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    const { data } = await db
      .from("chat_messages")
      .select("*")
      .eq("channel", channel)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });
    setMessages((data as ChatMessage[]) ?? []);
    setLoading(false);
  }, [channel]);

  const sendMessage = useCallback(
    async (senderId: string, content: string) => {
      await db.from("chat_messages").insert([
        {
          sender_id: senderId,
          channel,
          content,
        },
      ]);
      await fetchMessages();
    },
    [channel, fetchMessages],
  );

  const connectRealtime = useCallback(() => {
    void realtime.connect();
    void realtime.subscribe(channel);
    const handler = () => void fetchMessages();
    realtime.on("message", handler);

    return () => {
      realtime.off("message", handler);
      realtime.unsubscribe(channel);
      realtime.disconnect();
    };
  }, [channel, fetchMessages]);

  return { messages, loading, fetchMessages, sendMessage, connectRealtime };
}
