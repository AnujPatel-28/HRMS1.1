import { useEffect, useState } from "react";
import { LogOut, X, Home, Users, CalendarCheck, MoreHorizontal, ArrowLeft, Clock, Palmtree, Calendar, MessageSquare, Contact, GitBranch, ClipboardList, Gift, FileText, Wallet, Settings, Rss, FolderKanban, Receipt, Shield } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useEmployee } from "../hooks/useEmployee";
import { db, realtime } from "../insforge/client";

import { NotificationBell } from "../shared/NotificationBell";

type NavLinkItem = {
  label: string;
  href: string;
  icon: React.ElementType;
};

type NavSection = {
  title: string;
  items: readonly NavLinkItem[];
};

const sections: readonly NavSection[] = [
  {
    title: "People",
    items: [
      { label: "Dashboard", href: "/hr/dashboard", icon: Home },
      { label: "Employees", href: "/hr/employees", icon: Users },
      { label: "Directory", href: "/hr/directory", icon: Contact },
      { label: "Org Chart", href: "/hr/org-chart", icon: GitBranch },
      { label: "Insurance", href: "/hr/insurance", icon: Shield },
    ],
  },
  {
    title: "Attendance",
    items: [
      { label: "Attendance", href: "/hr/attendance", icon: CalendarCheck },
      { label: "Shifts", href: "/hr/shifts", icon: Clock },
    ],
  },
  {
    title: "HR Management",
    items: [
      { label: "Leaves", href: "/hr/leaves", icon: Palmtree },
      { label: "Tasks", href: "/hr/tasks", icon: ClipboardList },
      { label: "Projects", href: "/hr/pms", icon: FolderKanban },
      { label: "Expenses", href: "/hr/expenses", icon: Receipt },
      { label: "Holidays", href: "/hr/holidays", icon: Gift },
      { label: "Calendar", href: "/hr/calendar", icon: Calendar },
    ],
  },
  {
    title: "Communication",
    items: [
      { label: "Chat", href: "/hr/chat", icon: MessageSquare },
      { label: "Connect", href: "/hr/connect", icon: Rss },
    ],
  },
  {
    title: "Admin",
    items: [
      { label: "Policies", href: "/hr/policies", icon: FileText },
      { label: "Payroll", href: "/payroll/hr/salaries", icon: Wallet },
      { label: "IT Declarations", href: "/hr/declarations", icon: ClipboardList },
      { label: "Policy Center", href: "/hr/policy-center", icon: Settings },
    ],
  },
];

export default function HRLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, tenantId } = useAuth();
  const { employee } = useEmployee();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadConnectCount, setUnreadConnectCount] = useState(0);
  const [pendingExpensesCount, setPendingExpensesCount] = useState(0);

  // Sync last visit and subscribe to realtime connect events
  useEffect(() => {
    if (location.pathname === "/hr/connect") {
      setUnreadConnectCount(0);
      localStorage.setItem("last_connect_visit", new Date().toISOString());
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!tenantId) return;
    const fetchPendingCount = async () => {
      const { count, error } = await db
        .from("expenses")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "pending");
      if (!error && count !== null) {
        setPendingExpensesCount(count);
      }
    };
    void fetchPendingCount();
  }, [tenantId, location.pathname]);

  useEffect(() => {
    if (!tenantId) return;

    const fetchUnreadCount = async () => {
      const lastVisit = localStorage.getItem("last_connect_visit");
      const lastVisitTime = lastVisit ? new Date(lastVisit).toISOString() : new Date(0).toISOString();
      
      const { data, error } = await db
        .from("posts")
        .select("id")
        .eq("tenant_id", tenantId)
        .gt("created_at", lastVisitTime);

      if (!error && data) {
        setUnreadConnectCount(data.length);
      }
    };

    void fetchUnreadCount();

    const handleInsert = (payload: any) => {
      if (payload.tenant_id === tenantId) {
        if (location.pathname !== "/hr/connect") {
          setUnreadConnectCount((prev) => prev + 1);
        }
      }
    };

    const setupRealtime = async () => {
      await realtime.connect();
      await realtime.subscribe("posts");
    };

    void setupRealtime();
    realtime.on("INSERT", handleInsert);

    return () => {
      realtime.off("INSERT", handleInsert);
      realtime.unsubscribe("posts");
    };
  }, [tenantId, location.pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const handleMobileNavigate = (href: string) => {
    setMobileOpen(false);
    navigate(href);
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-md pt-safe md:pt-0">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-safe py-3 md:px-4">
          <div className="flex items-center min-w-0">
            {/* Desktop Text Branding */}
            <div className="hidden sm:block min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700">TalentMesh Solutions</p>
              <h1 className="truncate text-lg font-bold text-slate-900">HR Portal</h1>
            </div>
            
            {/* Mobile Logo Branding */}
            <img 
              src="/TalentMesh_page-0002-removebg-preview.png" 
              alt="TalentMesh" 
              className="w-[38.2vw] max-w-[180px] h-auto shrink-0 object-contain sm:hidden -ml-1" 
            />
          </div>
          <div className="flex items-center gap-3">
            <Link to="/select" className="hidden items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-700 sm:inline-flex">
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Switch product</span>
            </Link>
            <NotificationBell />
            <div className="hidden text-right sm:block">
              <p className="text-xs text-slate-500">Logged in as</p>
              <p className="text-sm font-semibold text-slate-900">{employee?.full_name ?? "HR User"}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="hidden sm:inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl px-safe py-6 pb-24 md:gap-6 md:px-4 md:py-6">
        {/* Mobile Overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* Sidebar (Desktop) / Slide-up Menu (Mobile) */}
        <aside className={`fixed inset-y-0 left-0 z-50 w-[88vw] max-w-sm transform overflow-y-auto pb-24 md:pb-0 md:overflow-visible bg-white p-4 shadow-xl transition-transform duration-300 ease-in-out md:sticky md:top-24 md:z-30 md:w-56 md:max-w-none md:translate-x-0 md:self-start md:bg-transparent md:p-0 md:shadow-none ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
          <div className="mb-6 flex items-start justify-between gap-3 md:hidden">
            <div>
              <span className="font-semibold text-slate-900">Navigation</span>
              <p className="mt-1 text-xs text-slate-500">{employee?.full_name ?? "HR User"}</p>
            </div>
            <button onClick={() => setMobileOpen(false)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="h-full space-y-4 md:h-fit md:rounded-xl md:border md:border-slate-200 md:bg-white md:p-3 md:shadow-xl md:-translate-y-1">
            <Link
              to="/select"
              className="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 md:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
              Switch product
            </Link>
            {sections.map((section) => (
              <div key={section.title} className="space-y-1">
                <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 select-none">
                  {section.title}
                </p>
                {section.items.map(({ label, href, icon: Icon }) => {
                  const isActive = location.pathname === href;
                  const showBadge = label === "Connect" && unreadConnectCount > 0;
                  const isExpensesBadge = label === "Expenses" && pendingExpensesCount > 0;
                  const renderLink = () => (
                    <button
                      key={href}
                      type="button"
                      onClick={() => handleMobileNavigate(href)}
                      className={`group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-display transition-all duration-200 ease-in-out hover:translate-x-1 ${isActive ? "bg-brand-50 font-semibold text-brand-700 shadow-sm ring-1 ring-brand-100" : "text-slate-600 hover:bg-slate-50"}`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? "text-brand-600" : "text-slate-400 group-hover:text-slate-600"}`} />
                        <span>{label}</span>
                      </div>
                      {showBadge && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white animate-pulse">
                          {unreadConnectCount}
                        </span>
                      )}
                      {isExpensesBadge && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                          {pendingExpensesCount}
                        </span>
                      )}
                    </button>
                  );

                  return renderLink();
                })}
              </div>
            ))}
            {/* Mobile Logout Button in Drawer */}
            <div className="mt-4 border-t border-slate-100 pt-4 md:hidden">
              <button
                type="button"
                onClick={handleLogout}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-display font-medium text-rose-600 transition-all duration-200 ease-in-out hover:bg-rose-50"
              >
                <LogOut className="h-4 w-4 shrink-0 text-rose-500" />
                Logout
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-[100] flex items-center justify-around border-t border-slate-200 bg-white/90 pb-safe pt-2 backdrop-blur-md md:hidden px-safe">
        <NavLink
          to="/hr/dashboard"
          className={({ isActive }) =>
            `flex flex-col items-center py-1.5 px-2 text-[11px] font-medium transition-colors ${isActive ? "text-brand-700" : "text-slate-500 hover:text-slate-900"}`
          }
        >
          <Home className="mb-1 h-5 w-5" />
          Dashboard
        </NavLink>
        <NavLink
          to="/hr/employees"
          className={({ isActive }) =>
            `flex flex-col items-center py-1.5 px-2 text-[11px] font-medium transition-colors ${isActive ? "text-brand-700" : "text-slate-500 hover:text-slate-900"}`
          }
        >
          <Users className="mb-1 h-5 w-5" />
          Employees
        </NavLink>
        <NavLink
          to="/hr/attendance"
          className={({ isActive }) =>
            `flex flex-col items-center py-1.5 px-2 text-[11px] font-medium transition-colors ${isActive ? "text-brand-700" : "text-slate-500 hover:text-slate-900"}`
          }
        >
          <CalendarCheck className="mb-1 h-5 w-5" />
          Attendance
        </NavLink>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className={`flex flex-col items-center py-1.5 px-2 text-[11px] font-medium transition-colors ${mobileOpen ? "text-brand-700" : "text-slate-500 hover:text-slate-900"}`}
        >
          <MoreHorizontal className="mb-1 h-5 w-5" />
          More
        </button>
      </nav>
      
    </div>
  );
}
