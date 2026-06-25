import { useEffect, useState, useMemo } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, LayoutDashboard, User, Clock, Calendar, ClipboardList, FileText, MessageSquare, X, Wallet, Home, MoreHorizontal, Menu, Contact, CreditCard, Users, Rss, GitBranch, FolderKanban, Receipt, Shield } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useEmployee } from "../hooks/useEmployee";
import { useManagerView } from "../hooks/useManagerView";
import { NotificationBell } from "../shared/NotificationBell";
import { db, realtime } from "../insforge/client";

const links = [
  { label: "Dashboard", href: "/employee/dashboard", icon: LayoutDashboard },
  { label: "My Profile", href: "/employee/profile", icon: User },
  { label: "My ID Card", href: "/employee/id-card", icon: CreditCard },
  { label: "Directory", href: "/employee/directory", icon: Contact },
  { label: "Org Chart", href: "/employee/org-chart", icon: GitBranch },
  { label: "Punch In/Out", href: "/employee/punch", icon: Clock },
  { label: "My Leaves", href: "/employee/leaves", icon: Calendar },
  { label: "My Tasks", href: "/employee/tasks", icon: ClipboardList },
  { label: "Policies", href: "/employee/policies", icon: FileText },
  { label: "Chat", href: "/employee/chat", icon: MessageSquare },
  { label: "Connect", href: "/employee/connect", icon: Rss },
  { label: "Payslips", href: "/payroll/employee/payslips", icon: Wallet },
  { label: "Expenses", href: "/employee/expenses", icon: Receipt },
  { label: "Insurance", href: "/employee/insurance", icon: Shield },
] as const;

const DEPT_COLORS: Record<string, string> = {
  sales: "bg-emerald-100 text-emerald-700",
  dev: "bg-blue-100 text-blue-700",
  marketing: "bg-pink-100 text-pink-700",
  operations: "bg-amber-100 text-amber-700",
  design: "bg-purple-100 text-purple-700",
  other: "bg-slate-100 text-slate-600",
};

export default function EmployeeLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, tenantId } = useAuth();
  const { employee } = useEmployee();
  const { isManager, isManagerMode, toggleManagerMode, directReportIds } = useManagerView();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [unreadConnectCount, setUnreadConnectCount] = useState(0);

  // Sync last visit and subscribe to realtime connect events
  useEffect(() => {
    if (location.pathname === "/employee/connect") {
      setUnreadConnectCount(0);
      localStorage.setItem("last_connect_visit", new Date().toISOString());
    }
  }, [location.pathname]);

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
        if (location.pathname !== "/employee/connect") {
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

  useEffect(() => {
    if (isManagerMode) {
      setShowBanner(true);
    }
  }, [isManagerMode]);

  const [hasProjects, setHasProjects] = useState(false);

  useEffect(() => {
    if (!employee?.id || !tenantId) return;
    db.from("tasks")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("assigned_to", employee.id)
      .not("project_id", "is", null)
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setHasProjects(true);
        }
      });
  }, [employee?.id, tenantId]);

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const handleMobileNavigate = (href: string) => {
    setMobileOpen(false);
    navigate(href);
  };

  const deptColor = DEPT_COLORS[employee?.department ?? ""] ?? "bg-slate-100 text-slate-600";

  const menuLinks = useMemo(() => {
    const list = [...links];
    if (hasProjects) {
      const idx = list.findIndex((l) => l.href === "/employee/tasks");
      if (idx !== -1) {
        list.splice(idx + 1, 0, {
          label: "My Projects",
          href: "/employee/tasks?tab=projects",
          icon: FolderKanban,
        } as any);
      }
    }
    if (isManager) {
      list.push({ label: "My Team", href: "/employee/my-team", icon: Users } as any);
    }
    return list;
  }, [isManager, hasProjects]);

  return (
    <div className="min-h-screen bg-[url('/bg3.1.svg')] bg-cover bg-center bg-fixed bg-no-repeat">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-md pt-safe md:pt-0">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-safe py-3 md:px-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 md:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">TalentMesh Solutions</p>
              <h1 className="text-lg font-semibold text-slate-900">Employee Portal</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isManager && (
              <div
                onClick={toggleManagerMode}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-pointer text-xs font-semibold select-none transition-all duration-200 ${
                  isManagerMode
                    ? "bg-[#E24B4A] text-white hover:bg-[#c93e3d]"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <span>{isManagerMode ? "Manager View" : "My View"}</span>
              </div>
            )}
            <NotificationBell />
            <div className="hidden items-center gap-3 sm:flex">
              {employee?.profile_photo_url ? (
                <img src={employee.profile_photo_url} alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-brand-200" />
              ) : (
                <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                  {employee?.full_name?.slice(0, 2).toUpperCase() ?? "?"}
                </div>
              )}
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-900">{employee?.full_name ?? "Employee"}</p>
                {employee?.department && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${deptColor}`}>
                    {employee.department}
                  </span>
                )}
              </div>
            </div>
            <button onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition">
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </div>
        </div>
      </header>

      {isManagerMode && showBanner && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-800 px-4 py-2 text-xs flex justify-between items-center shadow-sm">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"></span>
            <span>Viewing as manager — showing your team of {directReportIds.length} members.</span>
          </div>
          <button onClick={() => setShowBanner(false)} className="text-amber-500 hover:text-amber-700 font-bold ml-2">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="mx-auto flex max-w-7xl px-safe py-6 pb-24 md:gap-6 md:px-4 md:py-6">
        {/* Mobile Overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* Sidebar (Desktop) / Slide-up Menu (Mobile) */}
        <aside className={`fixed inset-y-0 right-0 z-50 w-full transform bg-white p-4 shadow-xl transition-transform duration-300 ease-in-out md:sticky md:top-24 md:z-30 md:w-56 md:translate-x-0 md:self-start md:bg-transparent md:p-0 md:shadow-none sm:w-80 ${mobileOpen ? "translate-x-0" : "translate-x-full md:translate-x-0"}`}>
          <div className="mb-6 flex items-start justify-between gap-3 md:hidden">
            <div>
              <span className="font-semibold text-slate-900">Navigation</span>
              <p className="mt-1 text-xs text-slate-500">{employee?.full_name ?? "Employee"}</p>
            </div>
            <button onClick={() => setMobileOpen(false)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="h-full space-y-1 md:h-fit md:rounded-xl md:border md:border-slate-200 md:bg-white md:p-3 md:shadow-xl md:-translate-y-1">
            {menuLinks.map(({ label, href, icon: Icon }) => {
              const isActive = location.pathname === href;
              const showBadge = label === "Connect" && unreadConnectCount > 0;
              return (
                <button
                  key={href}
                  type="button"
                  onClick={() => handleMobileNavigate(href)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium font-display transition ${isActive ? "bg-brand-50 text-brand-700 font-semibold" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{label}</span>
                  </div>
                  {showBadge && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white animate-pulse">
                      {unreadConnectCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-[100] flex items-center justify-around border-t border-slate-200 bg-white/90 pb-safe pt-2 backdrop-blur-md md:hidden px-safe">
        <NavLink
          to="/employee/dashboard"
          className={({ isActive }) =>
            `flex flex-col items-center p-2 text-xs font-medium transition-colors ${isActive ? "text-brand-700" : "text-slate-500 hover:text-slate-900"}`
          }
        >
          <Home className="mb-1 h-5 w-5" />
          Dashboard
        </NavLink>
        <NavLink
          to="/employee/punch"
          className={({ isActive }) =>
            `flex flex-col items-center p-2 text-xs font-medium transition-colors ${isActive ? "text-brand-700" : "text-slate-500 hover:text-slate-900"}`
          }
        >
          <Clock className="mb-1 h-5 w-5" />
          Punch
        </NavLink>
        <NavLink
          to="/employee/tasks"
          className={({ isActive }) =>
            `flex flex-col items-center p-2 text-xs font-medium transition-colors ${isActive ? "text-brand-700" : "text-slate-500 hover:text-slate-900"}`
          }
        >
          <ClipboardList className="mb-1 h-5 w-5" />
          Tasks
        </NavLink>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className={`flex flex-col items-center p-2 text-xs font-medium transition-colors ${mobileOpen ? "text-brand-700" : "text-slate-500 hover:text-slate-900"}`}
        >
          <MoreHorizontal className="mb-1 h-5 w-5" />
          More
        </button>
      </nav>
      
    </div>
  );
}
