import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Hash, Trash2, Paperclip, X, FileText, MessageSquare, Plus } from "lucide-react";
import type { ChatMessage, Employee, ChatChannel } from "../types";
import { db, storage, realtime } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useAuth } from "../hooks/useAuth";
import { EmptyState } from "./EmptyState";
import { ConfirmModal } from "./ConfirmModal";

export default function Chat() {
  const { employee } = useEmployee();
  const { role } = useAuth();
  const isHr = role === "hr";

  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<(ChatMessage & { sender?: Employee })[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [channelToDelete, setChannelToDelete] = useState<ChatChannel | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDesc, setNewChannelDesc] = useState("");
  const [newChannelType, setNewChannelType] = useState<"global" | "department" | "custom">("global");
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch Channels
  const fetchChannels = useCallback(async () => {
    const { data } = await db.from("chat_channels").select("*").order("name", { ascending: true });
    if (data) {
      const allChannels = data as ChatChannel[];
      setChannels(allChannels);
      // Select 'general' by default if not selected
      if (!selectedChannel && allChannels.length > 0) {
        const general = allChannels.find(c => c.name === "general") || allChannels[0];
        setSelectedChannel(general);
      } else if (selectedChannel) {
        // Refresh selected channel info
        const updated = allChannels.find(c => c.id === selectedChannel.id);
        if (updated) setSelectedChannel(updated);
      }
    }
  }, [selectedChannel]);

  useEffect(() => {
    void fetchChannels();
  }, []);

  useEffect(() => {
    let active = true;
    db.from("employees").select("*").then(({ data }) => {
      if (active && data) setEmployees(data as Employee[]);
    });
    return () => { active = false; };
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!selectedChannel) return;
    setLoading(true);
    const { data } = await db.from("chat_messages").select("*")
      .eq("channel", selectedChannel.name).eq("is_deleted", false)
      .order("created_at", { ascending: false }).limit(50); // Get latest 50
    
    if (data) {
      const msgs = (data as ChatMessage[]).reverse(); // Oldest first for chat view
      const empMap: Record<string, Employee> = {};
      employees.forEach((e) => { empMap[e.id] = e; });
      setMessages(msgs.map((m) => ({ ...m, sender: empMap[m.sender_id] })));
    }
    setLoading(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [selectedChannel, employees]);

  useEffect(() => {
    if (employees.length > 0) void fetchMessages();
  }, [fetchMessages, employees]);

  // Realtime subscription
  useEffect(() => {
    if (!selectedChannel || employees.length === 0) return;
    // The subscribe method connects to the channel
    const setupRealtime = async () => {
      await realtime.connect();
      await realtime.subscribe(`chat:${selectedChannel.name}`);
    };
    
    void setupRealtime();

    const handler = (payload: any) => {
      if (payload.meta?.channel !== `chat:${selectedChannel.name}`) return;
      
      const newMsg = payload as ChatMessage;
      if (newMsg.channel === selectedChannel.name && !newMsg.is_deleted) {
        const empMap: Record<string, Employee> = {};
        employees.forEach((e) => { empMap[e.id] = e; });
        setMessages(prev => [...prev, { ...newMsg, sender: empMap[newMsg.sender_id] }]);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      }
    };
    
    realtime.on('INSERT_message', handler);

    return () => {
      realtime.off('INSERT_message', handler);
      realtime.unsubscribe(`chat:${selectedChannel.name}`);
    };
  }, [selectedChannel, employees]);

  async function sendMessage() {
    if ((!input.trim() && !file) || !employee?.id) return;
    setSending(true);

    let attachment_url = null;
    let attachment_name = null;

    try {
      if (file) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
        const filePath = `chat/${fileName}`;
        
        const { error: uploadError } = await storage.from("chat-attachments").upload(filePath, file);
        if (uploadError) throw uploadError;
        
        attachment_url = storage.from("chat-attachments").getPublicUrl(filePath);
        attachment_name = file.name;
      }

      await db.from("chat_messages").insert([{
        sender_id: employee.id,
        channel: selectedChannel?.name || "general",
        channel_id: selectedChannel?.id,
        content: input.trim() || "Sent an attachment",
        attachment_url,
        attachment_name,
      }]);

      setInput("");
      setFile(null);
      // We don't need to fetchMessages() because realtime will append it.
    } catch (err) {
      console.error("Failed to send message", err);
      alert("Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage(id: string) {
    await db.from("chat_messages").update({ is_deleted: true }).eq("id", id);
    setMessages(prev => prev.filter(m => m.id !== id));
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const fmt = (ts: string) => new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const isMine = (m: ChatMessage) => m.sender_id === employee?.id;
  const canSend = isHr || (selectedChannel && !selectedChannel.is_announcement);

  async function createChannel() {
    if (!newChannelName.trim()) return;
    setCreating(true);
    try {
      const { data, error } = await db.from("chat_channels").insert([{
        name: newChannelName.trim().toLowerCase().replace(/\s+/g, "-"),
        description: newChannelDesc.trim() || null,
        type: newChannelType,
        created_by: employee?.id,
        target_departments: newChannelType === "department" ? [employee?.department || ""] : [],
      }]).select();

      if (error) throw error;
      if (data) {
        const created = data[0] as ChatChannel;
        setChannels(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        setSelectedChannel(created);
        setShowCreateModal(false);
        setNewChannelName("");
        setNewChannelDesc("");
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
      const { error } = await db.from("chat_channels").delete().eq("id", channelToDelete.id);
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

  // Filter visible channels for employees
  const visibleChannels = isHr
    ? channels
    : channels.filter(c => 
        c.type === "global" || 
        (c.type === "department" && c.target_departments.includes(employee?.department || ""))
      );

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
                className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition hover:bg-rose-50 hover:text-rose-600 ${selectedChannel?.id === ch.id ? "text-white/70 hover:bg-white/20 hover:text-white" : "text-slate-400"}`}
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
          ) : loading ? (
            <div className="py-10 text-center text-sm text-slate-400">Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="py-10 flex justify-center">
              <EmptyState icon={MessageSquare} title="No messages yet" description={`Start the conversation in #${selectedChannel.name}. Say hello!`} />
            </div>
          ) : (
            messages.map((m) => {
              const mine = isMine(m);
              return (
                <div key={m.id} className={`group flex gap-3 ${mine ? "flex-row-reverse" : ""}`}>
                  {/* Avatar */}
                  {m.sender?.profile_photo_url ? (
                    <img src={m.sender.profile_photo_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover shadow-sm" />
                  ) : (
                    <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold shadow-sm ${mine ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600 border border-slate-200"}`}>
                      {m.sender?.full_name.slice(0, 2).toUpperCase() ?? "?"}
                    </div>
                  )}

                  <div className={`flex max-w-[75%] flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
                    <div className="flex items-baseline gap-2 px-1">
                      {!mine && <span className="text-xs font-semibold text-slate-700">{m.sender?.full_name ?? "Unknown"}</span>}
                      <span className="text-[10px] font-medium text-slate-400">{fmt(m.created_at)}</span>
                    </div>
                    
                    <div className={`relative rounded-2xl px-4 py-2 text-sm shadow-sm ${mine ? "rounded-tr-sm bg-brand-600 text-white" : "rounded-tl-sm border border-slate-200 bg-white text-slate-800"}`}>
                      <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                      
                      {/* Attachment Rendering */}
                      {m.attachment_url && (
                        <a href={m.attachment_url} target="_blank" rel="noreferrer"
                          className={`mt-2 flex items-center gap-2 rounded-lg p-2 text-xs transition ${mine ? "bg-brand-700 hover:bg-brand-800" : "bg-slate-50 border border-slate-100 hover:bg-slate-100"}`}>
                          <div className={`p-1.5 rounded-md ${mine ? "bg-brand-600" : "bg-white border border-slate-200 text-brand-600"}`}>
                            <FileText className="h-3 w-3" />
                          </div>
                          <span className="font-medium truncate max-w-[200px]">{m.attachment_name || "Attachment"}</span>
                        </a>
                      )}

                      {mine && (
                        <button onClick={() => deleteMessage(m.id)}
                          className="absolute -left-8 top-1.5 hidden rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 group-hover:flex transition">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-200 px-4 py-3 bg-slate-50">
          {!canSend ? (
            <p className="text-center text-sm text-slate-500 py-2 font-medium">Only HR can post in #{selectedChannel?.name}.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {file && (
                <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs text-brand-700 w-fit">
                  <FileText className="h-3.5 w-3.5" />
                  <span className="font-medium max-w-[200px] truncate">{file.name}</span>
                  <button onClick={() => setFile(null)} className="ml-1 text-brand-600 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
                </div>
              )}
              <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500 transition shadow-sm">
                <button onClick={() => fileInputRef.current?.click()} className="shrink-0 text-slate-400 hover:text-brand-600 pb-0.5 transition">
                  <Paperclip className="h-5 w-5" />
                </button>
                <input type="file" className="hidden" ref={fileInputRef} onChange={e => setFile(e.target.files?.[0] || null)} />
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder={`Message #${selectedChannel?.name || "channel"}…`}
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 py-0.5"
                />
                <button
                  onClick={() => void sendMessage()}
                  disabled={(!input.trim() && !file) || sending}
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
        onClose={() => setShowCreateModal(false)}
        onConfirm={() => void createChannel()}
        title="Create New Channel"
        confirmText="Create Channel"
        isSubmitting={creating}
        message="Create a new communication channel for your team."
      >
        <div className="space-y-4 pt-2">
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
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Channel Type</label>
            <select 
              value={newChannelType}
              onChange={e => setNewChannelType(e.target.value as any)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
            >
              <option value="global">Global (Everyone)</option>
              <option value="department">Department (Your department only)</option>
            </select>
          </div>
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
