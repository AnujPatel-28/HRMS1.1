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

  useEffect(() => {
    if (initialUnreadCount > 0) setUnreadCount(initialUnreadCount);
  }, [initialUnreadCount]);

  useEffect(() => {
    if (!employee?.id || !tenantId) return;
    let active = true;

    // Initial fetch of recent 20
    const fetchNotifs = async () => {
      const { data } = await db.from("notifications")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employee.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (active && data) {
        setNotifications(data as Notification[]);
        setUnreadCount(data.filter(n => !n.is_read).length);
      }
    };
    void fetchNotifs();

    // Subscribe to realtime inserts
    const setupRealtime = async () => {
      await realtime.connect();
      await realtime.subscribe(`notifications:${employee.id}`);
    };
    
    void setupRealtime();

    const handler = (payload: any) => {
      if (!active || payload.meta?.channel !== `notifications:${employee.id}`) return;
      const newNotif = payload as Notification;
      if (newNotif.tenant_id !== tenantId) return;
      setNotifications(prev => [newNotif, ...prev].slice(0, 20));
      setUnreadCount(prev => prev + 1);
    };

    realtime.on('INSERT_notification', handler);

    return () => {
      active = false;
      realtime.off('INSERT_notification', handler);
      realtime.unsubscribe(`notifications:${employee.id}`);
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

    const isHr = employee?.department === "operations" && employee.email === "hr@talentmesh.com"; // Simplistic role check
    const prefix = isHr ? "/hr" : "/employee";

    if (notif.type?.includes("task")) navigate(`${prefix}/tasks`);
    else if (notif.type?.includes("leave")) navigate(`${prefix}/leaves`);
    else if (notif.type === "new_policy") navigate(`${prefix}/policies`);
    else if (notif.type === "punch_unlock") navigate(`${prefix}/dashboard`);
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
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-32px)] rounded-xl border border-slate-200 bg-white shadow-lg z-50 overflow-hidden flex flex-col max-h-[400px]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-slate-50">
            <h3 className="font-semibold text-slate-800">Notifications</h3>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                Mark all as read
              </button>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto">
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
                    <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${!notif.is_read ? "bg-white shadow-sm" : "bg-slate-100"}`}>
                      {TYPE_ICONS[notif.type ?? "general"] || TYPE_ICONS.general}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!notif.is_read ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>
                        {notif.title}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{notif.body}</p>
                      <p className="text-[10px] text-slate-400 mt-1 font-medium">{timeAgo(notif.created_at)}</p>
                    </div>
                    {!notif.is_read && (
                      <div className="flex items-center">
                        <div className="h-2 w-2 rounded-full bg-brand-500" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="border-t border-slate-100 p-2 text-center bg-slate-50">
            <button className="text-xs font-medium text-slate-500 hover:text-slate-700" onClick={() => setIsOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
