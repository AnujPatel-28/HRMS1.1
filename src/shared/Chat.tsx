import { useCallback, useEffect, useRef, useState, useReducer } from "react";
import { Send, Hash, Trash2, Paperclip, X, FileText, MessageSquare, Plus, Clock, AlertCircle } from "lucide-react";
import type { ChatMessage, Employee, ChatChannel } from "../types";
import { db, storage, realtime } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useAuth } from "../hooks/useAuth";
import { useTenant } from "../contexts/TenantContext";
import { EmptyState } from "./EmptyState";
import { ConfirmModal } from "./ConfirmModal";
import { useDepartmentLabel } from "../contexts/OrgUnitsContext";

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

// Org unit picker for department-channel creation (Slice B target_org_unit_ids write path).
// Same depth/hierarchical-sort shape as src/hr/OrgStructureManagement.tsx, trimmed to the columns
// this picker needs.
type OrgUnitOption = { id: string; name: string; parent_id: string | null };

function getOrgUnitDepth(unit: OrgUnitOption, all: OrgUnitOption[]): number {
  let depth = 0;
  let parentId = unit.parent_id;
  const visited = new Set<string>();
  while (parentId) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = all.find(u => u.id === parentId);
    if (!parent) break;
    depth++;
    parentId = parent.parent_id;
  }
  return depth;
}

function sortOrgUnitsHierarchically(units: OrgUnitOption[]): OrgUnitOption[] {
  const roots = units.filter(u => !u.parent_id || !units.some(p => p.id === u.parent_id));
  const childrenMap = new Map<string, OrgUnitOption[]>();
  units.forEach(u => {
    if (u.parent_id) {
      const list = childrenMap.get(u.parent_id) || [];
      list.push(u);
      childrenMap.set(u.parent_id, list);
    }
  });
  const result: OrgUnitOption[] = [];
  const traverse = (node: OrgUnitOption) => {
    result.push(node);
    const children = (childrenMap.get(node.id) || []).sort((a, b) => a.name.localeCompare(b.name));
    children.forEach(traverse);
  };
  roots.sort((a, b) => a.name.localeCompare(b.name)).forEach(traverse);
  return result;
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
  const deptLabel = useDepartmentLabel();
  const { employee } = useEmployee();
  const { hasGrant } = useAuth();
  const { tenantId } = useTenant();
  // D5: channel management is the catalogue grant channel.manage@company (contracts.md v0.5 §16
  // A1), not role === "hr" — a Communication Moderator without the HR role gets these controls,
  // and a tenant that removed the grant from HR Admin no longer shows them.
  const canManageChannels = hasGrant("channel.manage", "company");

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
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [channelToDelete, setChannelToDelete] = useState<ChatChannel | null>(null);
  
  // Modal States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDesc, setNewChannelDesc] = useState("");
  const [newChannelType, setNewChannelType] = useState<"global" | "department" | "custom">("global");
  const [newChannelDepts, setNewChannelDepts] = useState<string[]>([]);
  const [newChannelOrgUnitIds, setNewChannelOrgUnitIds] = useState<string[]>([]);
  const [newChannelMembers, setNewChannelMembers] = useState<string[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitOption[]>([]);
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetchSequenceRef = useRef<Record<string, number>>({});

  // 1. Fetch Channels
  const fetchChannels = useCallback(async () => {
    if (!tenantId) return;
    const { data, error } = await db.from("chat_channels").select("*").eq("tenant_id", tenantId).order("name", { ascending: true });
    if (error) {
      setChannels([]);
      setSelectedChannel(null);
      setRealtimeError("Chat is unavailable. Please retry.");
      return;
    }
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

  // Org units for the department-channel Org Unit picker (Slice B target_org_unit_ids write path).
  useEffect(() => {
    let active = true;
    if (!tenantId) return;
    db.from("org_units").select("id, name, parent_id").eq("tenant_id", tenantId).eq("is_active", true)
      .order("name", { ascending: true }).then(({ data }) => {
        if (active && data) setOrgUnits(data as OrgUnitOption[]);
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
    const { data, error } = await db.from("chat_messages").select("*")
      .eq("tenant_id", tenantId)
      .eq("channel_id", channelId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
      
    if (fetchSequenceRef.current[channelId] === seq) {
      if (error || !data?.length) {
        dispatchMessages({ type: "EVICT", channelIds: [channelId] });
        if (error) setRealtimeError("Chat is unavailable. Please retry.");
      } else {
        dispatchMessages({ type: "INIT_CHANNEL", channelId, messages: data as ChatMessage[] });
      }
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    if (selectedChannel && employees.length > 0) {
      void fetchMessages(selectedChannel.id);
    }
  }, [selectedChannel, employees, fetchMessages]);

  // 3. Server-authorized topics; event bodies are invalidations, never messages.
  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    const channelId = selectedChannel?.id;
    const listTopic = `chat-channels:${tenantId}`;
    const messageTopic = channelId ? `chat:${tenantId}:${channelId}` : null;
    const topics = messageTopic ? [listTopic, messageTopic] : [listTopic];
    setRealtimeError(null);
    const setupRealtime = async () => {
      await realtime.connect();
      for (const topic of topics) {
        if (!active) return;
        const result = await realtime.subscribe(topic);
        if (!active) { realtime.unsubscribe(topic); return; }
        if (!result.ok) throw new Error("Chat subscription denied");
      }
    };
    void setupRealtime().catch(() => {
      if (active) setRealtimeError("Live chat is unavailable. Please retry.");
    });
    const handleMessage = async (payload: { id?: string; meta?: { channel?: string } }) => {
      if (!active || !channelId || !payload.id) return;
      if (![messageTopic, `realtime:${messageTopic}`].includes(payload.meta?.channel ?? "")) return;
      const { data, error } = await db.from("chat_messages").select("*")
        .eq("id", payload.id).eq("channel_id", channelId).eq("is_deleted", false).maybeSingle();
      if (!active) return;
      if (error) {
        dispatchMessages({ type: "EVICT", channelIds: [channelId] });
        setRealtimeError("Chat is unavailable. Please retry.");
      } else if (data) {
        dispatchMessages({ type: "UPSERT", channelId, messages: [data as ChatMessage] });
      } else {
        dispatchMessages({ type: "DELETE", channelId, messageIds: [payload.id] });
      }
    };
    const handleChannel = (payload: { meta?: { channel?: string } }) => {
      if (active && [listTopic, `realtime:${listTopic}`].includes(payload.meta?.channel ?? "")) void fetchChannels();
    };
    for (const event of ["INSERT_message", "UPDATE_message", "DELETE_message"]) realtime.on(event, handleMessage);
    for (const event of ["INSERT_channel", "UPDATE_channel", "DELETE_channel"]) realtime.on(event, handleChannel);
    const handleOnline = () => {
      if (!active) return;
      if (channelId) void fetchMessages(channelId);
      void fetchChannels();
    };
    realtime.on("connect", handleOnline);
    window.addEventListener("online", handleOnline);
    return () => {
      active = false;
      for (const event of ["INSERT_message", "UPDATE_message", "DELETE_message"]) realtime.off(event, handleMessage);
      for (const event of ["INSERT_channel", "UPDATE_channel", "DELETE_channel"]) realtime.off(event, handleChannel);
      topics.forEach(topic => realtime.unsubscribe(topic));
      realtime.off("connect", handleOnline);
      window.removeEventListener("online", handleOnline);
    };
  }, [tenantId, selectedChannel?.id, fetchMessages, fetchChannels]);

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

    let attachment_url: string | null = null;
    let attachment_name: string | null = null;
    let filePath = "";

    try {
      if (f) {
        const fileExt = f.name.includes(".") ? f.name.split(".").pop() : "bin";
        const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
        filePath = `${tenantId}/${selectedChannel.id}/${fileName}`;
        
        // InsForge upload() returns { data: { url, key, ... } } — URL is in data.url
        const { data: uploadData, error: uploadError } = await storage.from("chat-attachments").upload(filePath, f);
        if (uploadError) throw uploadError;
        
        // Keep the key, never a signed URL. Download authorization happens on click.
        attachment_url = uploadData?.key ? `chat-attachments:${uploadData.key}` : null;
        attachment_name = f.name;
        
        dispatchMessages({ type: "UPSERT", channelId: selectedChannel.id, messages: [{
          ...optimisticMsg, upload_status: 'success', attachment_url, attachment_name
        }] });
      }

      const { data: messageId, error } = await db.rpc("p3_send_chat_message", {
        p_channel_id: selectedChannel.id,
        p_content: optimisticMsg.content,
        p_client_message_id: clientId,
        p_attachment_url: attachment_url,
        p_attachment_name: attachment_name,
      });

      if (error) throw error;
      if (!messageId) throw new Error("Message was not sent — the write was rejected.");

      const { data: sentRow } = await db.from("chat_messages").select("*").eq("id", messageId).maybeSingle();

      if (sentRow) {
        dispatchMessages({ type: "UPSERT", channelId: selectedChannel.id, messages: [{
          ...(sentRow as ChatMessage), delivery_status: 'sent', upload_status: f ? 'success' : 'none'
        }] });
      }
    } catch (err: any) {
      console.error("Failed to send message", err);
      dispatchMessages({ type: "UPSERT", channelId: selectedChannel.id, messages: [{
        ...optimisticMsg, delivery_status: 'failed', upload_status: f ? 'failed' : 'none'
      }] });
      
      if (attachment_url && filePath) {
        // remove() expects a single string path per InsForge SDK
        await storage.from("chat-attachments").remove(filePath);
      }
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage(id: string) {
    if (!tenantId) return;
    await db.rpc("p3_delete_chat_message", { p_message_id: id });
  }

  async function downloadAttachment(message: ChatMessage) {
    if (!message.attachment_url) return;
    try {
      const value = message.attachment_url;
      const key = value.startsWith("chat-attachments:")
        ? value.slice("chat-attachments:".length)
        : decodeURIComponent(new URL(value).pathname.split("/api/storage/buckets/chat-attachments/objects/")[1] ?? "");
      if (!key) throw new Error("Attachment key is unavailable");
      const { data, error } = await storage.from("chat-attachments").download(key);
      if (error || !data) throw error ?? new Error("Attachment unavailable");
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = message.attachment_name || "attachment";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setRealtimeError("This attachment is unavailable or you no longer have access.");
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const fmt = (ts: string) => new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const isMine = (senderId: string) => senderId === employee?.id;
  const canSend = canManageChannels || (selectedChannel && !selectedChannel.is_announcement);

  const DEPARTMENTS = ["sales", "dev", "marketing", "operations", "design", "other"] as const;

  function resetCreateModal() {
    setNewChannelName("");
    setNewChannelDesc("");
    setNewChannelType("global");
    setNewChannelDepts([]);
    setNewChannelOrgUnitIds([]);
    setNewChannelMembers([]);
  }

  function toggleDept(dept: string) {
    setNewChannelDepts(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]);
  }

  function toggleOrgUnit(id: string) {
    setNewChannelOrgUnitIds(prev => prev.includes(id) ? prev.filter(u => u !== id) : [...prev, id]);
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
    if (newChannelType === "department" && newChannelOrgUnitIds.length === 0) {
      // chat_messages_select / channels_employee_select now gate department channels on
      // target_org_unit_ids only — an empty selection here creates a channel no employee can read.
      alert("Please select at least one org unit. The legacy department list is no longer read by RLS.");
      return;
    }
    if (newChannelType === "custom" && newChannelMembers.length === 0) {
      alert("Please select at least one member for the private channel.");
      return;
    }
    setCreating(true);
    try {
      // p3_create_chat_channel (channel.manage@company) — target_departments is retired: every
      // chat policy now gates on target_org_unit_ids only.
      const { data: channelId, error } = await db.rpc("p3_create_chat_channel", {
        p_name: newChannelName.trim().toLowerCase().replace(/\s+/g, "-"),
        p_type: newChannelType,
        p_description: newChannelDesc.trim() || null,
        p_target_org_unit_ids: newChannelType === "department" && newChannelOrgUnitIds.length > 0
          ? newChannelOrgUnitIds
          : null,
        p_is_announcement: false,
      });

      if (error) throw error;
      if (!channelId) throw new Error("Channel was not created — the write was rejected.");

      const { data: createdRow, error: readError } = await db.from("chat_channels").select("*").eq("id", channelId).maybeSingle();
      if (readError || !createdRow) throw readError ?? new Error("Channel created but could not be read back.");
      const created = createdRow as ChatChannel;

      if (newChannelType === "custom" && newChannelMembers.length > 0) {
        const memberIds = employee?.id && !newChannelMembers.includes(employee.id)
          ? [...newChannelMembers, employee.id]
          : newChannelMembers;
        await db.rpc("p3_set_channel_members", { p_channel_id: created.id, p_employee_ids: memberIds });
      }

      setChannels(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedChannel(created);
      setShowCreateModal(false);
      resetCreateModal();
    } catch (err: any) {
      console.error("Failed to create channel", err);
      alert(`Failed to create channel: ${err?.message || err?.details || JSON.stringify(err)}`);
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

  // Mirrors the DB predicate exactly: every chat policy gates department channels on
  // target_org_unit_ids (20260820110000 / 20260820130000). The legacy target_departments branch that
  // used to sit beside this is gone — it compared capitalised unit names against the hardcoded
  // lowercase slug list, so it could never match, and employees.department no longer exists.
  const visibleChannels = canManageChannels
    ? channels
    : channels.filter(c =>
        c.type === "global" ||
        (c.type === "department" &&
          !!employee?.org_unit_id &&
          (c.target_org_unit_ids ?? []).includes(employee.org_unit_id)) ||
        c.type === "custom"
      );

  const currentMessages = selectedChannel ? (messagesCache[selectedChannel.id] || []) : [];
  const currentDraftText = selectedChannel ? (draftTexts[selectedChannel.id] || "") : "";
  const currentDraftFile = selectedChannel ? draftFiles[selectedChannel.id] : null;

  return (
    <section className="flex flex-col md:flex-row h-[calc(100svh-200px)] md:h-[calc(100svh-180px)] min-h-[400px] md:min-h-[500px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm mb-16 md:mb-0">
      {/* Sidebar */}
      <aside className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50/50 p-2 md:p-4 flex flex-row overflow-x-auto md:overflow-x-hidden md:flex-col gap-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="flex items-center justify-between mb-1 md:mb-2 px-2">
          <p className="text-[10px] md:text-xs font-bold uppercase tracking-wider text-slate-500">Channels</p>
          {canManageChannels && (
            <button onClick={() => setShowCreateModal(true)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors">
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex flex-row md:flex-col gap-1 overflow-y-auto overflow-x-visible md:overflow-x-hidden pr-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {visibleChannels.map((ch) => (
            <div key={ch.id} className="group flex items-center gap-1">
              <button onClick={() => setSelectedChannel(ch)}
                className={`flex shrink-0 md:w-full items-center gap-2 md:gap-2.5 rounded-xl px-3 py-1.5 md:py-2.5 text-left text-sm transition-all ${
                  selectedChannel?.id === ch.id 
                    ? "bg-white text-brand-700 font-semibold shadow-sm ring-1 ring-slate-200/50" 
                    : "text-slate-600 hover:bg-slate-200/50 font-medium"
                }`}>
                <Hash className={`h-4 w-4 shrink-0 ${selectedChannel?.id === ch.id ? "text-brand-500" : "opacity-60"}`} />
                <span className="capitalize truncate">{ch.name}</span>
              </button>
              {canManageChannels && ch.name !== "general" && (
                <button 
                  onClick={(e) => { e.stopPropagation(); setChannelToDelete(ch); }}
                  className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all text-slate-400 hover:bg-rose-50 hover:text-rose-600 shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden bg-[#F8FAFC]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/70 px-4 md:px-6 py-2 md:py-4 bg-white/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
              <Hash className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold capitalize text-slate-800 text-base md:text-lg leading-tight">{selectedChannel?.name || "Select Channel"}</h3>
              <p className="hidden md:block text-xs text-slate-500 font-medium">{selectedChannel?.description || "Company communication channel"}</p>
            </div>
          </div>
        </div>

        {/* Messages */}
        {realtimeError && <p role="status" className="px-4 py-2 text-sm text-amber-700">{realtimeError}</p>}
        <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6">
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
                <div className="flex justify-center pb-4">
                  <button 
                    onClick={() => void loadMore()} 
                    disabled={loadingMore}
                    className="text-xs font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 px-5 py-2 rounded-full transition-colors shadow-sm border border-brand-100 disabled:opacity-50"
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
                  <div key={m.id} className={`group flex gap-4 ${mine ? "flex-row-reverse" : ""}`}>
                    {/* Avatar */}
                    {senderEmp?.profile_photo_url ? (
                      <img src={senderEmp.profile_photo_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover shadow-sm ring-2 ring-white" />
                    ) : (
                      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold shadow-sm ring-2 ring-white ${mine ? "bg-brand-100 text-brand-700" : "bg-slate-200 text-slate-700"}`}>
                        {senderEmp?.full_name.slice(0, 2).toUpperCase() ?? "?"}
                      </div>
                    )}

                    <div className={`flex max-w-[85%] md:max-w-[70%] flex-col gap-1 md:gap-1.5 ${mine ? "items-end" : "items-start"}`}>
                      <div className="flex items-baseline gap-2 px-1">
                        {!mine && <span className="text-sm font-bold text-slate-700">{senderEmp?.full_name ?? "Unknown"}</span>}
                        <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                          {fmt(m.created_at)}
                          {mine && isSending && <Clock className="h-3 w-3 text-brand-400" />}
                          {mine && isFailed && <AlertCircle className="h-3 w-3 text-rose-500" />}
                        </span>
                      </div>
                      
                      <div className={`relative px-4 py-2 md:px-5 md:py-3 text-[14px] md:text-[15px] shadow-sm transition-all ${
                        isFailed 
                          ? "opacity-70 bg-rose-50 border border-rose-200 text-rose-900 rounded-2xl" 
                          : mine 
                            ? "rounded-2xl rounded-tr-sm bg-brand-600 text-white" 
                            : "rounded-2xl rounded-tl-sm border border-slate-200/60 bg-white text-slate-800"
                      }`}>
                        <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        
                        {/* Attachment Rendering */}
                        {(m.attachment_url || m.upload_status === 'uploading') && (
                          <button type="button" disabled={!m.attachment_url} onClick={() => void downloadAttachment(m)}
                            className={`mt-3 flex items-center gap-3 rounded-xl p-2.5 text-sm transition-colors ${mine ? (isFailed ? "bg-rose-100/50" : "bg-brand-700/50 hover:bg-brand-700") : "bg-slate-50 border border-slate-100 hover:bg-slate-100"}`}>
                            <div className={`p-2 rounded-lg shadow-sm ${mine ? (isFailed ? "bg-rose-200" : "bg-white text-brand-600") : "bg-white border border-slate-200 text-slate-600"}`}>
                              {m.upload_status === 'uploading' ? <Clock className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                            </div>
                            <span className="font-semibold truncate max-w-[200px]">{m.attachment_name || "Attachment"}</span>
                          </button>
                        )}

                        {(mine || hasGrant("message.moderate", "channel", selectedChannel?.id)) && !isSending && !isFailed && (
                          <button onClick={() => deleteMessage(m.id)}
                            className="absolute -left-10 top-1/2 -translate-y-1/2 opacity-0 rounded-full p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 transition-all shadow-sm bg-white border border-slate-100">
                            <Trash2 className="h-4 w-4" />
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
        <div className="px-3 md:px-6 pt-3 md:pt-4 pb-2 md:pb-3 bg-white border-t border-slate-200/60 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)]">
          {!canSend ? (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
              <p className="text-sm text-slate-500 font-medium">Only HR can post in #{selectedChannel?.name}.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {currentDraftFile && (
                <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-700 w-fit shadow-sm">
                  <FileText className="h-4 w-4" />
                  <span className="font-semibold max-w-[200px] truncate">{currentDraftFile.name}</span>
                  <button onClick={() => setDraftFiles(prev => ({ ...prev, [selectedChannel!.id]: null }))} className="ml-2 rounded-full p-1 hover:bg-brand-200/50 text-brand-600 hover:text-rose-600 transition-colors"><X className="h-4 w-4" /></button>
                </div>
              )}
              <div className="flex items-end gap-2 md:gap-3 rounded-2xl border border-slate-300 bg-slate-50 p-2 md:p-2.5 focus-within:bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all shadow-sm">
                <button onClick={() => fileInputRef.current?.click()} className="shrink-0 rounded-xl p-2 md:p-2.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors">
                  <Paperclip className="h-5 w-5" />
                </button>
                <input type="file" className="hidden" ref={fileInputRef} onChange={e => selectedChannel && setDraftFiles(prev => ({ ...prev, [selectedChannel.id]: e.target.files?.[0] || null }))} />
                <textarea
                  value={currentDraftText}
                  onChange={(e) => selectedChannel && setDraftTexts(prev => ({ ...prev, [selectedChannel.id]: e.target.value }))}
                  onKeyDown={handleKey}
                  placeholder={`Message #${selectedChannel?.name || "channel"}…`}
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-sm md:text-[15px] text-slate-800 outline-none placeholder:text-slate-400 px-2 py-1.5 md:py-2.5"
                />
                <button
                  onClick={() => void sendMessage()}
                  disabled={(!currentDraftText.trim() && !currentDraftFile) || sending}
                  className="shrink-0 rounded-xl bg-brand-600 p-2 md:p-2.5 text-white hover:bg-brand-700 hover:shadow-md hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40 disabled:hover:shadow-none transition-all shadow-sm"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
              <p className="text-[11px] text-slate-400 px-2 font-medium tracking-wide">Press <span className="font-bold text-slate-500">Enter</span> to send · <span className="font-bold text-slate-500">Shift+Enter</span> for new line</p>
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
                  onClick={() => { setNewChannelType(t); setNewChannelDepts([]); setNewChannelOrgUnitIds([]); setNewChannelMembers([]); }}
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
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Select Departments (Legacy)</label>
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

          {/* Org Unit Picker — Slice B target_org_unit_ids write path, alongside the legacy Department
              Picker above, which RLS no longer reads — org units are the authoritative target. */}
          {newChannelType === "department" && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Select Org Units</label>
              {orgUnits.length === 0 ? (
                <p className="text-[11px] text-slate-400">No org units configured for this tenant yet.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-slate-200 p-2">
                  {sortOrgUnitsHierarchically(orgUnits).map(unit => {
                    const depth = getOrgUnitDepth(unit, orgUnits);
                    const isChecked = newChannelOrgUnitIds.includes(unit.id);
                    return (
                      <button
                        key={unit.id}
                        type="button"
                        onClick={() => toggleOrgUnit(unit.id)}
                        style={{ paddingLeft: `${0.625 + depth * 1.25}rem` }}
                        className={`w-full flex items-center gap-1.5 rounded-lg py-1.5 pr-2.5 text-left text-xs font-medium transition ${
                          isChecked
                            ? "bg-brand-50 border border-brand-200 text-brand-700"
                            : "hover:bg-slate-50 border border-transparent text-slate-600"
                        }`}
                      >
                        {depth > 0 && <span className="text-slate-300">└─</span>}
                        <span className="flex-1 truncate">{unit.name}</span>
                        {isChecked && <span className="text-brand-600 text-xs font-bold">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {newChannelOrgUnitIds.length === 0 && (
                <p className="mt-1.5 text-[11px] text-rose-400 font-medium">Please select at least one org unit.</p>
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
                        <p className="text-[10px] text-slate-400 capitalize">{deptLabel(emp)}</p>
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
