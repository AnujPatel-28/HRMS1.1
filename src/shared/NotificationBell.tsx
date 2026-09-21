import { useEffect, useState } from "react";
import { Bell, ClipboardList, CalendarCheck, FileText, CheckCircle, XCircle, Info } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Notification } from "../types";
import { db, realtime } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";

type NotificationBellProps = {
  unreadCount?: number;
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  task_assigned: <ClipboardList className="h-4 w-4 text-brand-600" />,
  task_approved: <CheckCircle className="h-4 w-4 text-emerald-600" />,
  task_rejected: <XCircle className="h-4 w-4 text-rose-600" />,
  leave_approved: <CalendarCheck className="h-4 w-4 text-emerald-600" />,
  leave_rejected: <XCircle className="h-4 w-4 text-rose-600" />,
  punch_unlock: <CheckCircle className="h-4 w-4 text-emerald-600" />,
  new_policy: <FileText className="h-4 w-4 text-purple-600" />,
  general: <Info className="h-4 w-4 text-slate-600" />,
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationBell({ unreadCount: initialUnreadCount = 0 }: NotificationBellProps) {
  const { employee } = useEmployee();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);

  useEffect(() => {
    if (initialUnreadCount > 0) setUnreadCount(initialUnreadCount);
  }, [initialUnreadCount]);

  useEffect(() => {
    if (!employee?.id || !tenantId) return;
    let active = true;
    const topic = `notifications:${tenantId}:${employee.id}`;
    setNotifications([]);
    setUnreadCount(0);
    setRealtimeError(null);

    const fetchNotifs = async () => {
      const { data, error } = await db.from("notifications")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employee.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (active && data) {
        setNotifications(data as Notification[]);
        setUnreadCount(data.filter(n => !n.is_read).length);
      }
      if (active && error) {
        setNotifications([]);
        setUnreadCount(0);
        setRealtimeError("Notifications are unavailable. Please retry.");
      }
    };
    void fetchNotifs();

    const setupRealtime = async () => {
      await realtime.connect();
      if (!active) return;
      const result = await realtime.subscribe(topic);
      if (!active) { realtime.unsubscribe(topic); return; }
      if (!result.ok) throw new Error("Notification subscription denied");
    };
    
    void setupRealtime().catch(() => {
      if (active) setRealtimeError("Live notifications are unavailable. Please retry.");
    });

    const handler = (payload: any) => {
      if (!active) return;

      const eventChannel = payload?.meta?.channel;
      if (eventChannel !== topic && eventChannel !== `realtime:${topic}`) return;
      // The event is an invalidation only. Content always comes from an RLS read.
      void fetchNotifs();
    };
    realtime.on("INSERT_notification", handler);
    realtime.on("connect", fetchNotifs);

    return () => {
      active = false;
      realtime.off("INSERT_notification", handler);
      realtime.off("connect", fetchNotifs);
      realtime.unsubscribe(topic);
    };
  }, [employee?.id, tenantId]);

  useEffect(() => {
    // Close dropdown on click outside
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".notification-container")) setIsOpen(false);
    };
    if (isOpen) document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [isOpen]);

  async function handleNotificationClick(notif: Notification) {
    setIsOpen(false);
    if (!notif.is_read) {
      await db.from("notifications").update({ is_read: true }).eq("tenant_id", tenantId).eq("id", notif.id);
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }

    // These notifications belong to the recipient's personal work, even when the same human also
    // holds HR grants. A single role string sent composed users to the administration copy of the
    // task/leave screen and lost the personal record the notification referred to.
    if (notif.type?.includes("task")) navigate("/employee/tasks");
    else if (notif.type?.includes("leave")) navigate("/employee/leaves");
    else if (notif.type === "new_policy") navigate("/employee/policies");
    else if (notif.type === "punch_unlock") navigate("/employee/dashboard");
  }

  async function markAllRead() {
    if (!employee?.id || !tenantId) return;
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;

    await db.from("notifications").update({ is_read: true }).eq("tenant_id", tenantId).in("id", unreadIds);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }

  return (
    <div className="relative notification-container">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`relative rounded-full border border-slate-200 p-2 hover:bg-slate-50 transition ${isOpen ? "bg-slate-100 ring-2 ring-brand-500 ring-offset-1" : "bg-white text-slate-600"}`}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white border-2 border-white shadow-sm">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div className="fixed inset-0 z-[100] bg-slate-900/20 backdrop-blur-sm sm:hidden" onClick={() => setIsOpen(false)} />
          
          <div className="fixed inset-x-4 top-[calc(5rem+env(safe-area-inset-top,0px))] z-[101] flex max-h-[calc(100vh-9rem-env(safe-area-inset-bottom,0px))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:absolute sm:inset-auto sm:right-0 sm:mt-2 sm:max-h-[400px] sm:w-96 sm:rounded-xl sm:shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-slate-50">
              <h3 className="font-semibold text-slate-800">Notifications</h3>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                  Mark all as read
                </button>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto">
              {realtimeError && <p role="status" className="p-3 text-sm text-amber-700">{realtimeError}</p>}
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  <Bell className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                  No notifications yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {notifications.map(notif => (
                    <button
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={`w-full text-left flex gap-3 p-4 transition hover:bg-slate-50 ${!notif.is_read ? "bg-brand-50/30" : ""}`}
                    >
                      <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${!notif.is_read ? "bg-white shadow-sm ring-1 ring-slate-100" : "bg-slate-50"}`}>
                        {TYPE_ICONS[notif.type ?? "general"] || TYPE_ICONS.general}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${!notif.is_read ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>
                          {notif.title}
                        </p>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">{notif.body}</p>
                        <p className="text-[10px] text-slate-400 mt-2 font-medium uppercase tracking-wider">{timeAgo(notif.created_at)}</p>
                      </div>
                      {!notif.is_read && (
                        <div className="flex items-start pt-1.5 pl-2">
                          <div className="h-2 w-2 rounded-full bg-brand-500 shadow-[0_0_8px_rgba(var(--brand-500),0.6)]" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-slate-100 p-3 text-center bg-slate-50 sm:hidden">
              <button className="w-full rounded-xl bg-white border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 shadow-sm" onClick={() => setIsOpen(false)}>
                Close Notifications
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
