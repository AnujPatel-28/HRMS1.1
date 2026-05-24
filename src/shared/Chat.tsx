import { useCallback, useEffect, useRef, useState, useReducer } from "react";
import { Send, Hash, Trash2, Paperclip, X, FileText, MessageSquare, Plus, Clock, AlertCircle } from "lucide-react";
import type { ChatMessage, Employee, ChatChannel } from "../types";
import { db, storage, realtime } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useAuth } from "../hooks/useAuth";
import { useTenant } from "../contexts/TenantContext";
import { EmptyState } from "./EmptyState";
import { ConfirmModal } from "./ConfirmModal";

// Helper for generating local optimistic UUIDs
function uuidv4() {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
    (parseInt(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> parseInt(c) / 4).toString(16)
  );
}

// 1. Pure Deterministic Reducer for Message Cache
type MessageAction = 
  | { type: "INIT_CHANNEL"; channelId: string; messages: ChatMessage[] }
  | { type: "PAGINATE"; channelId: string; messages: ChatMessage[] }
  | { type: "UPSERT"; channelId: string; messages: ChatMessage[] }
  | { type: "DELETE"; channelId: string; messageIds: string[] }
  | { type: "EVICT"; channelIds: string[] };

function sortMessages(msgs: ChatMessage[]) {
  // Sort oldest first for chat rendering
  return [...msgs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function messageReducer(state: Record<string, ChatMessage[]>, action: MessageAction): Record<string, ChatMessage[]> {
  switch (action.type) {
    case "INIT_CHANNEL": {
      // Reconcile new fetch with existing cache (useful for resync)
      const existing = state[action.channelId] || [];
      const merged = [...existing];
      
      action.messages.forEach(newMsg => {
        const idx = merged.findIndex(m => 
          (m.client_message_id && newMsg.client_message_id && m.client_message_id === newMsg.client_message_id) || 
          (m.id === newMsg.id)
        );
        if (idx !== -1) {
          merged[idx] = { ...merged[idx], ...newMsg };
        } else {
          merged.push(newMsg);
        }
      });
      return { ...state, [action.channelId]: sortMessages(merged) };
    }
    case "PAGINATE": {
      const existing = state[action.channelId] || [];
      // Just append and sort, deduplication is theoretically handled by cursor pagination
      // but we do a quick pass to be safe.
      const map = new Map(existing.map(m => [m.id, m]));
      action.messages.forEach(m => map.set(m.id, m));
      return { ...state, [action.channelId]: sortMessages(Array.from(map.values())) };
    }
    case "UPSERT": {
      const existing = state[action.channelId] || [];
      const updated = [...existing];
      
      action.messages.forEach(newMsg => {
        const idx = updated.findIndex(m => 
          (m.client_message_id && newMsg.client_message_id && m.client_message_id === newMsg.client_message_id) || 
          (m.id && newMsg.id && m.id === newMsg.id)
        );
        if (idx !== -1) {
          updated[idx] = { ...updated[idx], ...newMsg };
        } else {
          updated.push(newMsg);
        }
      });
      return { ...state, [action.channelId]: sortMessages(updated) };
    }
    case "DELETE": {
      const existing = state[action.channelId] || [];
      return { ...state, [action.channelId]: existing.filter(m => !action.messageIds.includes(m.id)) };
    }
    case "EVICT": {
      const newState = { ...state };
      action.channelIds.forEach(id => delete newState[id]);
      return newState;
    }
    default:
      return state;
  }
}

export default function Chat() {
  const { employee } = useEmployee();
  const { role } = useAuth();
  const { tenantId } = useTenant();
  const isHr = role === "hr";

  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ChatChannel | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  
  // Cache and Draft States
  const [messagesCache, dispatchMessages] = useReducer(messageReducer, {});
  const [draftTexts, setDraftTexts] = useState<Record<string, string>>({});
  const [draftFiles, setDraftFiles] = useState<Record<string, File | null>>({});
  
  // LRU Tracking
  const [accessedChannels, setAccessedChannels] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [channelToDelete, setChannelToDelete] = useState<ChatChannel | null>(null);
  
  // Modal States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDesc, setNewChannelDesc] = useState("");
  const [newChannelType, setNewChannelType] = useState<"global" | "department" | "custom">("global");
  const [newChannelDepts, setNewChannelDepts] = useState<string[]>([]);
  const [newChannelMembers, setNewChannelMembers] = useState<string[]>([]);
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetchSequenceRef = useRef<Record<string, number>>({});

  // 1. Fetch Channels
  const fetchChannels = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await db.from("chat_channels").select("*").eq("tenant_id", tenantId).order("name", { ascending: true });
    if (data) {
      const allChannels = data as ChatChannel[];
      setChannels(allChannels);
      
      setSelectedChannel(prev => {
        if (!prev && allChannels.length > 0) {
          return allChannels.find(c => c.name === "general") || allChannels[0];
        } else if (prev) {
          const updated = allChannels.find(c => c.id === prev.id);
          // Safe fallback if channel is deleted
          if (!updated) return allChannels.find(c => c.name === "general") || null;
          return updated;
        }
        return prev;
      });
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) void fetchChannels();
  }, [tenantId, fetchChannels]);

  useEffect(() => {
    let active = true;
    if (!tenantId) return;
    db.from("employees_public").select("*").eq("tenant_id", tenantId).then(({ data }) => {
      if (active && data) setEmployees(data as Employee[]);
    });
    return () => { active = false; };
  }, [tenantId]);

  // LRU Update
  useEffect(() => {
    if (selectedChannel) {
      setAccessedChannels(prev => {
        const filtered = prev.filter(id => id !== selectedChannel.id);
        return [selectedChannel.id, ...filtered];
      });
    }
  }, [selectedChannel]);

  // LRU Eviction
  useEffect(() => {
    if (accessedChannels.length > 5) {
      const toEvict = accessedChannels.slice(5).filter(id => !draftTexts[id] && !draftFiles[id]);
      if (toEvict.length > 0) {
        dispatchMessages({ type: "EVICT", channelIds: toEvict });
        setAccessedChannels(prev => prev.filter(id => !toEvict.includes(id)));
      }
    }
  }, [accessedChannels, draftTexts, draftFiles]);

  // 2. Fetch Messages with Sequence Ref
  const fetchMessages = useCallback(async (channelId: string) => {
    if (!tenantId) return;
    const seq = (fetchSequenceRef.current[channelId] || 0) + 1;
    fetchSequenceRef.current[channelId] = seq;
    
    setLoading(true);
    const { data } = await db.from("chat_messages").select("*")
      .eq("tenant_id", tenantId)
      .eq("channel_id", channelId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
      
    if (data && fetchSequenceRef.current[channelId] === seq) {
      dispatchMessages({ type: "INIT_CHANNEL", channelId, messages: data as ChatMessage[] });
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    if (selectedChannel && employees.length > 0) {
      void fetchMessages(selectedChannel.id);
    }
  }, [selectedChannel, employees, fetchMessages]);

  // 3. Stable Realtime Subscription & Resync
  useEffect(() => {
    if (employees.length === 0 || !tenantId) return;

    const setupRealtime = async () => {
      await realtime.connect();
      await realtime.subscribe("chat_messages");
      await realtime.subscribe("chat_channels");
      await realtime.subscribe("chat_channel_members");
    };

    void setupRealtime();

    const handleInsertOrUpdate = (payload: any) => {
      if (payload.tenant_id !== tenantId) return;

      if ("content" in payload && "channel_id" in payload) {
        const msg = payload as ChatMessage;
        if (msg.is_deleted) {
          dispatchMessages({ type: "DELETE", channelId: msg.channel_id!, messageIds: [msg.id] });
        } else {
          dispatchMessages({ type: "UPSERT", channelId: msg.channel_id!, messages: [msg] });
        }
      } else {
        // It's a channel or channel member update
        void fetchChannels();
      }
    };

    realtime.on("INSERT", handleInsertOrUpdate);
    realtime.on("UPDATE", handleInsertOrUpdate);

    // Resynchronization on reconnect
    const handleOnline = () => {
      // Refetch for active and top recently active cached channels
      accessedChannels.slice(0, 3).forEach(id => {
        void fetchMessages(id);
      });
      void fetchChannels();
    };

    window.addEventListener("online", handleOnline);

    return () => {
      realtime.off("INSERT", handleInsertOrUpdate);
      realtime.off("UPDATE", handleInsertOrUpdate);
      realtime.unsubscribe("chat_messages");
      realtime.unsubscribe("chat_channels");
      realtime.unsubscribe("chat_channel_members");
      window.removeEventListener("online", handleOnline);
    };
  }, [employees, tenantId, accessedChannels, fetchMessages, fetchChannels]);

  // Load More (Composite Cursor Pagination)
  async function loadMore() {
    if (!selectedChannel || !tenantId) return;
    const channelMsgs = messagesCache[selectedChannel.id] || [];
    if (channelMsgs.length === 0) return;
    
    // Oldest is first
    const oldest = channelMsgs[0];
    
    setLoadingMore(true);
    const { data } = await db.from("chat_messages").select("*")
      .eq("tenant_id", tenantId)
      .eq("channel_id", selectedChannel.id)
      .eq("is_deleted", false)
      .or(`created_at.lt.${oldest.created_at},and(created_at.eq.${oldest.created_at},id.lt.${oldest.id})`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
      
    if (data && data.length > 0) {
      dispatchMessages({ type: "PAGINATE", channelId: selectedChannel.id, messages: data as ChatMessage[] });
    }
    setLoadingMore(false);
  }

  // 4. Send Message with Delivery/Upload States
  async function sendMessage() {
    if (!selectedChannel || !employee?.id || !tenantId) return;
    const txt = draftTexts[selectedChannel.id] || "";
    const f = draftFiles[selectedChannel.id];
    if (!txt.trim() && !f) return;
    
    setSending(true);

    const clientId = uuidv4();
    const now = new Date().toISOString();
    const optimisticMsg: ChatMessage = {
      id: clientId, 
      client_message_id: clientId,
      tenant_id: tenantId,
      sender_id: employee.id,
      channel: selectedChannel.name,
      channel_id: selectedChannel.id,
      content: txt.trim() || "Sent an attachment",
      attachment_url: null,
      attachment_name: f ? f.name : null,
      is_deleted: false,
      created_at: now,
      delivery_status: 'sending',
      upload_status: f ? 'uploading' : 'none'
    };

    dispatchMessages({ type: "UPSERT", channelId: selectedChannel.id, messages: [optimisticMsg] });
    
    // Clear drafts for this channel
    setDraftTexts(prev => ({ ...prev, [selectedChannel.id]: "" }));
    setDraftFiles(prev => ({ ...prev, [selectedChannel.id]: null }));
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);

    let attachment_url = null;
    let attachment_name = null;
    let filePath = "";

    try {
      if (f) {
        const fileExt = f.name.includes(".") ? f.name.split(".").pop() : "bin";
        const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
        filePath = `chat/${fileName}`;
        
        const { error: uploadError } = await storage.from("chat-attachments").upload(filePath, f);
        if (uploadError) throw uploadError;
        
        attachment_url = storage.from("chat-attachments").getPublicUrl(filePath);
        attachment_name = f.name;
        
        dispatchMessages({ type: "UPSERT", channelId: selectedChannel.id, messages: [{
          ...optimisticMsg, upload_status: 'success', attachment_url, attachment_name
        }] });
      }

      const { data, error } = await db.from("chat_messages").insert([{
        client_message_id: clientId,
        sender_id: employee.id,
        tenant_id: tenantId,
        channel: selectedChannel.name,
        channel_id: selectedChannel.id,
        content: optimisticMsg.content,
        attachment_url,
        attachment_name,
      }]).select();

      if (error) throw error;

      if (data && data.length > 0) {
        dispatchMessages({ type: "UPSERT", channelId: selectedChannel.id, messages: [{
          ...(data[0] as ChatMessage), delivery_status: 'sent', upload_status: f ? 'success' : 'none'
        }] });
      }
    } catch (err: any) {
      console.error("Failed to send message", err);
      dispatchMessages({ type: "UPSERT", channelId: selectedChannel.id, messages: [{
        ...optimisticMsg, delivery_status: 'failed', upload_status: f ? 'failed' : 'none'
      }] });
      
      if (attachment_url && filePath) {
         await storage.from("chat-attachments").remove(filePath);
      }
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage(id: string) {
    if (!tenantId) return;
    await db.from("chat_messages").update({ is_deleted: true }).eq("tenant_id", tenantId).eq("id", id);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const fmt = (ts: string) => new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const isMine = (senderId: string) => senderId === employee?.id;
  const canSend = isHr || (selectedChannel && !selectedChannel.is_announcement);

  const DEPARTMENTS = ["sales", "dev", "marketing", "operations", "design", "other"] as const;

  function resetCreateModal() {
    setNewChannelName("");
    setNewChannelDesc("");
    setNewChannelType("global");
    setNewChannelDepts([]);
    setNewChannelMembers([]);
  }

  function toggleDept(dept: string) {
    setNewChannelDepts(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]);
  }

  function toggleMember(id: string) {
    setNewChannelMembers(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  }

  async function createChannel() {
    if (!newChannelName.trim()) return;
    if (newChannelType === "department" && newChannelDepts.length === 0) {
      alert("Please select at least one department.");
      return;
    }
    if (newChannelType === "custom" && newChannelMembers.length === 0) {
      alert("Please select at least one member for the private channel.");
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await db.from("chat_channels").insert([{
        tenant_id: tenantId,
        name: newChannelName.trim().toLowerCase().replace(/\s+/g, "-"),
        description: newChannelDesc.trim() || null,
        type: newChannelType,
        created_by: employee?.id,
        target_departments: newChannelType === "department" ? newChannelDepts : [],
      }]).select();

      if (error) throw error;
      if (data) {
        const created = data[0] as ChatChannel;

        if (newChannelType === "custom" && newChannelMembers.length > 0) {
          const memberRows = newChannelMembers.map(empId => ({ tenant_id: tenantId, channel_id: created.id, employee_id: empId }));
          if (employee?.id && !newChannelMembers.includes(employee.id)) {
            memberRows.push({ tenant_id: tenantId, channel_id: created.id, employee_id: employee.id });
          }
          await db.from("chat_channel_members").insert(memberRows);
        }

        setChannels(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        setSelectedChannel(created);
        setShowCreateModal(false);
        resetCreateModal();
      }
    } catch (err) {
      console.error("Failed to create channel", err);
      alert("Failed to create channel. Name might already exist.");
    } finally {
      setCreating(false);
    }
  }

  async function deleteChannel() {
    if (!channelToDelete) return;
    setDeleting(true);
    try {
      const { error } = await db.rpc("delete_chat_channel", { channel_id: channelToDelete.id });
      if (error) throw error;

      setChannels(prev => prev.filter(c => c.id !== channelToDelete.id));
      if (selectedChannel?.id === channelToDelete.id) {
        setSelectedChannel(channels.find(c => c.id !== channelToDelete.id) || null);
      }
      setChannelToDelete(null);
    } catch (err) {
      console.error("Failed to delete channel", err);
      alert("Failed to delete channel.");
    } finally {
      setDeleting(false);
    }
  }

  const visibleChannels = isHr
    ? channels
    : channels.filter(c =>
        c.type === "global" ||
        (c.type === "department" && c.target_departments.includes(employee?.department || "")) ||
        c.type === "custom"
      );

  const currentMessages = selectedChannel ? (messagesCache[selectedChannel.id] || []) : [];
  const currentDraftText = selectedChannel ? (draftTexts[selectedChannel.id] || "") : "";
  const currentDraftFile = selectedChannel ? draftFiles[selectedChannel.id] : null;

  return (
    <section className="flex flex-col md:flex-row h-[calc(100svh-180px)] min-h-[500px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Sidebar */}
      <aside className="w-full md:w-48 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50 p-3 flex flex-row overflow-x-auto md:flex-col gap-1">
        <div className="flex items-center justify-between mb-1 px-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Channels</p>
          {isHr && (
            <button onClick={() => setShowCreateModal(true)} className="p-1 text-slate-400 hover:text-brand-600 hover:bg-white rounded transition">
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {visibleChannels.map((ch) => (
          <div key={ch.id} className="group flex items-center gap-1">
            <button onClick={() => setSelectedChannel(ch)}
              className={`flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                selectedChannel?.id === ch.id ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-200"
              }`}>
              <Hash className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="capitalize font-medium truncate">{ch.name}</span>
            </button>
            {isHr && ch.name !== "general" && (
              <button 
                onClick={(e) => { e.stopPropagation(); setChannelToDelete(ch); }}
                className="p-1.5 rounded-lg transition text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden bg-white">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3.5 bg-white z-10 shadow-sm">
          <Hash className="h-5 w-5 text-slate-400" />
          <h3 className="font-semibold capitalize text-slate-800 text-lg">{selectedChannel?.name || "Select Channel"}</h3>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!selectedChannel ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              Select a channel to start chatting
            </div>
          ) : currentMessages.length === 0 && !loading ? (
            <div className="py-10 flex justify-center">
              <EmptyState icon={MessageSquare} title="No messages yet" description={`Start the conversation in #${selectedChannel.name}. Say hello!`} />
            </div>
          ) : (
            <>
              {currentMessages.length >= 50 && (
                <div className="flex justify-center py-2">
                  <button 
                    onClick={() => void loadMore()} 
                    disabled={loadingMore}
                    className="text-xs font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 px-4 py-1.5 rounded-full transition disabled:opacity-50"
                  >
                    {loadingMore ? "Loading..." : "Load Older Messages"}
                  </button>
                </div>
              )}
              {currentMessages.map((m) => {
                const mine = isMine(m.sender_id);
                const senderEmp = employees.find(e => e.id === m.sender_id);
                const isFailed = m.delivery_status === 'failed';
                const isSending = m.delivery_status === 'sending';

                return (
                  <div key={m.id} className={`group flex gap-3 ${mine ? "flex-row-reverse" : ""}`}>
                    {/* Avatar */}
                    {senderEmp?.profile_photo_url ? (
                      <img src={senderEmp.profile_photo_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover shadow-sm" />
                    ) : (
                      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold shadow-sm ${mine ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600 border border-slate-200"}`}>
                        {senderEmp?.full_name.slice(0, 2).toUpperCase() ?? "?"}
                      </div>
                    )}

                    <div className={`flex max-w-[75%] flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
                      <div className="flex items-baseline gap-2 px-1">
                        {!mine && <span className="text-xs font-semibold text-slate-700">{senderEmp?.full_name ?? "Unknown"}</span>}
                        <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
                          {fmt(m.created_at)}
                          {mine && isSending && <Clock className="h-2.5 w-2.5 text-brand-400" />}
                          {mine && isFailed && <AlertCircle className="h-2.5 w-2.5 text-rose-500" />}
                        </span>
                      </div>
                      
                      <div className={`relative rounded-2xl px-4 py-2 text-sm shadow-sm transition ${isFailed ? "opacity-70 bg-rose-50 border border-rose-200 text-rose-900" : mine ? "rounded-tr-sm bg-brand-600 text-white" : "rounded-tl-sm border border-slate-200 bg-white text-slate-800"}`}>
                        <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        
                        {/* Attachment Rendering */}
                        {(m.attachment_url || m.upload_status === 'uploading') && (
                          <a href={m.attachment_url || "#"} target={m.attachment_url ? "_blank" : "_self"} rel="noreferrer"
                            className={`mt-2 flex items-center gap-2 rounded-lg p-2 text-xs transition ${mine ? (isFailed ? "bg-rose-100" : "bg-brand-700 hover:bg-brand-800") : "bg-slate-50 border border-slate-100 hover:bg-slate-100"}`}>
                            <div className={`p-1.5 rounded-md ${mine ? (isFailed ? "bg-rose-200" : "bg-brand-600") : "bg-white border border-slate-200 text-brand-600"}`}>
                              {m.upload_status === 'uploading' ? <Clock className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                            </div>
                            <span className="font-medium truncate max-w-[200px]">{m.attachment_name || "Attachment"}</span>
                          </a>
                        )}

                        {mine && !isSending && !isFailed && (
                          <button onClick={() => deleteMessage(m.id)}
                            className="absolute -left-8 top-1.5 hidden rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 group-hover:flex transition">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-200 px-4 py-3 bg-slate-50">
          {!canSend ? (
            <p className="text-center text-sm text-slate-500 py-2 font-medium">Only HR can post in #{selectedChannel?.name}.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {currentDraftFile && (
                <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs text-brand-700 w-fit">
                  <FileText className="h-3.5 w-3.5" />
                  <span className="font-medium max-w-[200px] truncate">{currentDraftFile.name}</span>
                  <button onClick={() => setDraftFiles(prev => ({ ...prev, [selectedChannel!.id]: null }))} className="ml-1 text-brand-600 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
                </div>
              )}
              <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500 transition shadow-sm">
                <button onClick={() => fileInputRef.current?.click()} className="shrink-0 text-slate-400 hover:text-brand-600 pb-0.5 transition">
                  <Paperclip className="h-5 w-5" />
                </button>
                <input type="file" className="hidden" ref={fileInputRef} onChange={e => selectedChannel && setDraftFiles(prev => ({ ...prev, [selectedChannel.id]: e.target.files?.[0] || null }))} />
                <textarea
                  value={currentDraftText}
                  onChange={(e) => selectedChannel && setDraftTexts(prev => ({ ...prev, [selectedChannel.id]: e.target.value }))}
                  onKeyDown={handleKey}
                  placeholder={`Message #${selectedChannel?.name || "channel"}…`}
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 py-0.5"
                />
                <button
                  onClick={() => void sendMessage()}
                  disabled={(!currentDraftText.trim() && !currentDraftFile) || sending}
                  className="shrink-0 rounded-lg bg-brand-600 p-1.5 text-white hover:bg-brand-700 disabled:opacity-40 transition shadow-sm"
                >
                  <Send className="h-4.5 w-4.5" />
                </button>
              </div>
              <p className="text-[10px] text-slate-400 px-1 font-medium tracking-wide">Press Enter to send · Shift+Enter for new line</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); resetCreateModal(); }}
        onConfirm={() => void createChannel()}
        title="Create New Channel"
        confirmText="Create Channel"
        isSubmitting={creating}
        message="Create a new communication channel for your team."
      >
        <div className="space-y-4 pt-2">
          {/* Channel Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Channel Name</label>
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={newChannelName}
                onChange={e => setNewChannelName(e.target.value)}
                placeholder="e.g. project-x"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Description (Optional)</label>
            <textarea
              value={newChannelDesc}
              onChange={e => setNewChannelDesc(e.target.value)}
              placeholder="What is this channel about?"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none resize-none"
            />
          </div>

          {/* Channel Type */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Channel Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(["global", "department", "custom"] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setNewChannelType(t); setNewChannelDepts([]); setNewChannelMembers([]); }}
                  className={`flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 text-xs font-semibold transition ${
                    newChannelType === t
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-slate-200 bg-white text-slate-500 hover:border-brand-300"
                  }`}
                >
                  <span className="text-base">{t === "global" ? "🌐" : t === "department" ? "🏢" : "🔒"}</span>
                  <span className="capitalize">{t === "custom" ? "Private" : t}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              {newChannelType === "global" && "Everyone in the company can see and message this channel."}
              {newChannelType === "department" && "Only employees from the selected departments can access this channel."}
              {newChannelType === "custom" && "Only the specific employees you choose can access this channel."}
            </p>
          </div>

          {/* Department Picker */}
          {newChannelType === "department" && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Select Departments</label>
              <div className="flex flex-wrap gap-2">
                {DEPARTMENTS.map(dept => (
                  <button
                    key={dept}
                    type="button"
                    onClick={() => toggleDept(dept)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition border ${
                      newChannelDepts.includes(dept)
                        ? "bg-brand-600 text-white border-brand-600"
                        : "bg-white text-slate-600 border-slate-300 hover:border-brand-400"
                    }`}
                  >
                    {dept}
                  </button>
                ))}
              </div>
              {newChannelDepts.length === 0 && (
                <p className="mt-1.5 text-[11px] text-rose-400 font-medium">Please select at least one department.</p>
              )}
            </div>
          )}

          {/* Employee Picker for Private channels */}
          {newChannelType === "custom" && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Select Members</label>
              <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-slate-200 p-2">
                {employees
                  .filter(e => e.id !== employee?.id) // Exclude self (creator is auto-added)
                  .map(emp => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => toggleMember(emp.id)}
                      className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                        newChannelMembers.includes(emp.id)
                          ? "bg-brand-50 border border-brand-200"
                          : "hover:bg-slate-50 border border-transparent"
                      }`}
                    >
                      <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                        newChannelMembers.includes(emp.id) ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                      }`}>
                        {emp.full_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold truncate text-xs ${newChannelMembers.includes(emp.id) ? "text-brand-800" : "text-slate-700"}`}>{emp.full_name}</p>
                        <p className="text-[10px] text-slate-400 capitalize">{emp.department || "—"}</p>
                      </div>
                      {newChannelMembers.includes(emp.id) && (
                        <span className="text-brand-600 text-xs font-bold">✓</span>
                      )}
                    </button>
                  ))}
              </div>
              {newChannelMembers.length === 0 && (
               <p className="mt-1.5 text-[11px] text-rose-400 font-medium">Please select at least one employee.</p>
              )}
              {newChannelMembers.length > 0 && (
                <p className="mt-1.5 text-[11px] text-brand-600 font-medium">{newChannelMembers.length} member{newChannelMembers.length > 1 ? "s" : ""} selected (+ you)</p>
              )}
            </div>
          )}
        </div>
      </ConfirmModal>

      <ConfirmModal
        isOpen={!!channelToDelete}
        onClose={() => setChannelToDelete(null)}
        onConfirm={() => void deleteChannel()}
        title="Delete Channel"
        message={
          <>
            Are you sure you want to delete <span className="font-bold text-slate-900">#{channelToDelete?.name}</span>? 
            This will permanently remove the channel and all its messages. This action cannot be undone.
          </>
        }
        confirmText="Delete Channel"
        confirmColor="red"
        isSubmitting={deleting}
      />
    </section>
  );
}
