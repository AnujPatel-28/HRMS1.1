import { useEffect, useMemo, useRef, useState } from "react";
import { LogOut, X, Home, Users, CalendarCheck, MoreHorizontal, ArrowLeft, Clock, Palmtree, Calendar, MessageSquare, Contact, GitBranch, ClipboardList, Gift, FileText, Wallet, Settings, Rss, FolderKanban, Receipt, Shield, ChevronDown, Menu, Columns, Layers, LayoutGrid, Network, MonitorSmartphone } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { RequireModule } from "../shared/RequireModule";
import type { ModuleKey } from "../modules";
import { db, realtime } from "../insforge/client";

import { NotificationBell } from "../shared/NotificationBell";
import { Sidebar, DesktopSidebar, SidebarLink, useSidebar } from "../components/ui/sidebar";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../utils/cn";
import { useDepartmentLabel } from "../contexts/OrgUnitsContext";

type NavLinkItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  /** Hidden when this module is disabled for the tenant. Omit for always-visible items. */
  module?: ModuleKey;
};

type NavSection = {
  title: string;
  icon: React.ElementType;
  items: readonly NavLinkItem[];
};

/**
 * Grouped by the module that OWNS each screen, mirroring doc/Roughpicture.md: Organisation is the
 * base every other module builds on, Attendance / Task & Project / Payroll & Finance are its three
 * children, and Chat and Connect are optional add-ons rather than part of the core product.
 *
 * The previous grouping was functional -- "People", "HR Management", "Admin" -- which cut across
 * modules: Leaves and Holidays sat under HR Management while Attendance and Shifts sat under
 * Attendance, and Tasks and Projects had no home of their own. A section whose items are all gated
 * off is dropped entirely, so a tenant sees only the modules it actually has.
 */
const allSections: readonly NavSection[] = [
  {
    title: "Organisation",
    icon: Users,
    items: [
      { label: "Employees", href: "/hr/employees", icon: Users },
      { label: "Directory", href: "/hr/directory", icon: Contact },
      { label: "Org Chart", href: "/hr/org-chart", icon: GitBranch },
      { label: "Org Setup", href: "/hr/org-structure", icon: Network },
      { label: "Offboarding", href: "/hr/offboarding", icon: LogOut, module: "offboarding" },
    ],
  },
  {
    title: "Attendance",
    icon: CalendarCheck,
    items: [
      { label: "Attendance", href: "/hr/attendance", icon: CalendarCheck, module: "attendance" },
      { label: "Shifts", href: "/hr/shifts", icon: Clock, module: "attendance" },
      { label: "Leaves", href: "/hr/leaves", icon: Palmtree, module: "leave" },
      // work_calendar, NOT leave. The holiday calendar is core substrate that attendance derivation
      // and payroll's working-day divisor both read, and modules.ts already routes it that way --
      // gating the LINK on `leave` hid the screen from an attendance-only tenant entitled to it,
      // the same mistake 20260821180000 fixed for the route.
      { label: "Holidays", href: "/hr/holidays", icon: Gift, module: "work_calendar" },
      { label: "Devices", href: "/hr/devices", icon: MonitorSmartphone, module: "attendance" },
      { label: "Calendar", href: "/hr/calendar", icon: Calendar },
    ],
  },
  {
    title: "Task & Project",
    icon: FolderKanban,
    items: [
      { label: "Projects", href: "/hr/pms", icon: FolderKanban, module: "tasks" },
      { label: "Tasks", href: "/hr/tasks", icon: ClipboardList, module: "tasks" },
    ],
  },
  {
    title: "Payroll & Finance",
    icon: Wallet,
    items: [
      { label: "Payroll", href: "/payroll/hr/salaries", icon: Wallet, module: "payroll" },
      { label: "IT Declarations", href: "/hr/declarations", icon: ClipboardList, module: "payroll" },
      { label: "Expenses", href: "/hr/expenses", icon: Receipt, module: "expenses" },
      { label: "Insurance", href: "/hr/insurance", icon: Shield, module: "insurance" },
    ],
  },
  {
    title: "Policy Center",
    icon: Settings,
    items: [
      { label: "Policy Center", href: "/hr/policy-center", icon: Settings, module: "policy_center" },
      { label: "Policies", href: "/hr/policies", icon: FileText, module: "policy_center" },
    ],
  },
  {
    title: "Add-ons",
    icon: MessageSquare,
    items: [
      { label: "Chat", href: "/hr/chat", icon: MessageSquare, module: "chat" },
      { label: "Connect", href: "/hr/connect", icon: Rss, module: "connect" },
    ],
  },
];

function HRSidebarContent({
  sections,
  location,
  unreadConnectCount,
  pendingExpensesCount,
  onItemClick,
  employee,
  flatLayout = false,
  isLight = false,
}: {
  sections: readonly NavSection[];
  location: any;
  unreadConnectCount: number;
  pendingExpensesCount: number;
  onItemClick?: () => void;
  employee?: { full_name?: string; profile_photo_url?: string; org_unit_id?: string | null } | null;
  flatLayout?: boolean;
  isLight?: boolean;
}) {
  const deptLabel = useDepartmentLabel();
  const { open } = useSidebar();
  const [openSection, setOpenSection] = useState<string | null>(() => {
    const activeSection = sections.find((section) =>
      section.items.some((item) => item.href === location.pathname)
    );
    return activeSection ? activeSection.title : sections[0]?.title ?? null;
  });

  useEffect(() => {
    const activeSection = sections.find((section) =>
      section.items.some((item) => item.href === location.pathname)
    );
    if (activeSection) {
      setOpenSection(activeSection.title);
    }
  }, [location.pathname, sections]);

  const toggleSection = (title: string) => {
    setOpenSection((prev) => (prev === title ? null : title));
  };

  const activeSection = sections.find((section) =>
    section.items.some((item) => item.href === location.pathname)
  );

  const borderClass = isLight ? "border-slate-200" : "border-white/10";
  const textTitleClass = isLight ? "text-slate-800 font-bold" : "text-white font-bold";
  const textSubtitleClass = isLight ? "text-slate-600 font-medium" : "text-slate-300 font-semibold";
  const textNameClass = isLight ? "text-slate-800 font-semibold" : "text-white font-semibold";
  const textMutedClass = isLight ? "text-slate-500" : "text-slate-400";
  const ringClass = isLight ? "ring-2 ring-slate-100" : "ring-2 ring-white/10";
  const avatarBgClass = isLight ? "bg-slate-200 text-slate-800" : "bg-white/10 text-white";

  const getLinkClass = (isActive: boolean) => {
    if (isActive) {
      return isLight 
        ? "bg-brand-600/15 font-semibold text-brand-700 shadow-sm ring-1 ring-brand-600/10" 
        : "bg-emerald-500/10 font-semibold text-emerald-400 shadow-sm ring-1 ring-emerald-500/20";
    } else {
      return isLight 
        ? "text-slate-600 hover:bg-black/5 hover:text-slate-900" 
        : "text-slate-300 hover:bg-white/10 hover:text-white";
    }
  };

  const getIconClass = (isActive: boolean) => {
    return cn(
      "h-4 w-4 shrink-0 transition-colors",
      isActive
        ? (isLight ? "text-brand-600" : "text-emerald-400")
        : (isLight ? "text-slate-500 group-hover/sidebar:text-slate-800" : "text-slate-400 group-hover/sidebar:text-slate-200")
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Logo / Brand header ── */}
      <div className={cn("flex items-center gap-2.5 h-16 shrink-0 mb-4 pl-[2px] pr-0 border-b", borderClass)}>
        <div className="h-8 w-8 shrink-0 rounded-lg bg-brand-600 flex items-center justify-center shadow-sm">
          <span className="text-white font-black text-xs leading-none">T</span>
        </div>
        <motion.div
          initial={false}
          animate={{
            width: open ? "auto" : 0,
            opacity: open ? 1 : 0,
          }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="overflow-hidden whitespace-nowrap flex flex-col min-w-0"
        >
          <p className={cn("text-[10px] uppercase tracking-widest leading-none", textTitleClass)}>TalentMesh</p>
          <p className={cn("text-xs mt-0.5", textSubtitleClass)}>HR Portal</p>
        </motion.div>
      </div>

      {/* ── Nav sections ── */}
      <div className="flex flex-col gap-1 py-2 flex-1 overflow-y-auto hide-scrollbar">
        {/* Standalone Dashboard */}
        <SidebarLink
            isActive={location.pathname === "/hr/dashboard"}
            link={{
              label: "Dashboard",
              href: "/hr/dashboard",
              icon: (
                <Home
                  className={getIconClass(location.pathname === "/hr/dashboard")}
                />
              ),
            }}
            className={getLinkClass(location.pathname === "/hr/dashboard")}
            onClick={onItemClick}
          />

        {flatLayout ? (
          sections.map((section) => {
            const SectionIcon = section.icon;
            const defaultHref = section.items[0]?.href ?? "/hr/dashboard";
            const isActive = activeSection?.title === section.title;
            const showBadge = section.title === "Communication" && unreadConnectCount > 0;
            const isExpensesBadge = section.title === "HR Management" && pendingExpensesCount > 0;

            return (
              <SidebarLink
                key={section.title}
                isActive={isActive}
                link={{
                  label: section.title,
                  href: defaultHref,
                  icon: (
                    <SectionIcon
                      className={getIconClass(isActive)}
                    />
                  ),
                }}
                className={getLinkClass(isActive)}
                onClick={onItemClick}
              >
                {showBadge && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white animate-pulse">
                    {unreadConnectCount}
                  </span>
                )}
                {isExpensesBadge && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                    {pendingExpensesCount}
                  </span>
                )}
              </SidebarLink>
            );
          })
        ) : (
          sections.map((section, sIdx) => {
            const SectionIcon = section.icon;
            const isExpanded = openSection === section.title;

            return (
              <div key={section.title}>
                {/* Section header */}
                {open ? (
                  <button
                    onClick={() => toggleSection(section.title)}
                    className={cn("flex w-full items-center justify-between px-2.5 py-1 rounded-md transition duration-150 text-left group", isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-slate-200")}
                  >
                    <div className="flex items-center gap-1.5">
                      <SectionIcon className="h-4 w-4 shrink-0" />
                      <span className="text-[10px] font-bold uppercase tracking-widest select-none">
                        {section.title}
                      </span>
                    </div>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                        !isExpanded && "-rotate-90"
                      )}
                    />
                  </button>
                ) : (
                  <div className="flex flex-col items-center py-1">
                    <div
                      className="flex justify-center cursor-pointer"
                      onClick={() => toggleSection(section.title)}
                      title={section.title}
                    >
                      <SectionIcon className={cn("h-4 w-4 transition-colors", isLight ? "text-slate-500 hover:text-slate-800" : "text-slate-400 hover:text-slate-200")} />
                    </div>
                    {sIdx < sections.length - 1 && (
                      <div className={cn("h-px w-8 mt-2", isLight ? "bg-slate-200" : "bg-white/10")} />
                    )}
                  </div>
                )}

                {/* Section items */}
                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial="collapsed"
                      animate="open"
                      exit="collapsed"
                      variants={{
                        open: { opacity: 1, height: "auto" },
                        collapsed: { opacity: 0, height: 0 },
                      }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden space-y-0.5 mt-0.5"
                    >
                      {section.items.map(({ label, href, icon: Icon }) => {
                        const isActive = location.pathname === href;
                        const showBadge = label === "Connect" && unreadConnectCount > 0;
                        const isExpensesBadge = label === "Expenses" && pendingExpensesCount > 0;

                        return (
                          <SidebarLink
                            key={href}
                            isActive={isActive}
                            link={{
                              label,
                              href,
                              icon: (
                                <Icon
                                  className={getIconClass(isActive)}
                                />
                              ),
                            }}
                            className={getLinkClass(isActive)}
                            onClick={onItemClick}
                          >
                            {showBadge && (
                              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white animate-pulse">
                                {unreadConnectCount}
                              </span>
                            )}
                            {isExpensesBadge && (
                              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                                {pendingExpensesCount}
                              </span>
                            )}
                          </SidebarLink>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>

      {/* ── User avatar footer (simple display) ── */}
      {employee && (
        <div className={cn("mt-auto pt-3 shrink-0 border-t", borderClass)}>
          <div className="flex items-center gap-2.5 min-w-0 px-1 py-1">
            {employee.profile_photo_url ? (
              <img src={employee.profile_photo_url} alt="" className={cn("h-8 w-8 rounded-full object-cover shrink-0", ringClass)} />
            ) : (
              <div className={cn("h-8 w-8 rounded-full flex items-center justify-center shrink-0", avatarBgClass)}>
                <span className="text-xs font-bold">{employee.full_name?.slice(0, 2).toUpperCase() ?? '?'}</span>
              </div>
            )}
            <motion.div
              initial={false}
              animate={{ width: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden whitespace-nowrap min-w-0"
            >
              <p className={cn("text-xs truncate", textNameClass)}>{employee.full_name ?? 'HR User'}</p>
              <p className={cn("text-[10px] truncate", textMutedClass)}>{deptLabel(employee, 'HR')}</p>
            </motion.div>
          </div>
        </div>
      )}
    </div>
  );
}

const dashboardLink: NavLinkItem = { label: "Dashboard", href: "/hr/dashboard", icon: Home };

export default function HRLayout() {
  const deptLabel = useDepartmentLabel();
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, tenantId } = useAuth();
  const { employee } = useEmployee();
  const { hasModule } = useTenant();

  // Hide nav entries whose module this tenant does not have. Sections that end up empty are
  // dropped entirely, so a disabled module leaves no empty heading behind.
  const sections = useMemo(
    () =>
      allSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => !item.module || hasModule(item.module)),
        }))
        .filter((section) => section.items.length > 0),
    [hasModule],
  );

  const flatLinks = useMemo(
    () => [dashboardLink, ...sections.flatMap((s) => s.items)],
    [sections],
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadConnectCount, setUnreadConnectCount] = useState(0);
  const [pendingExpensesCount, setPendingExpensesCount] = useState(0);
  const [layoutStyle, setLayoutStyle] = useState<'dropdown' | 'double_sidebar' | 'classic'>(() => {
    return (localStorage.getItem('sidebar_layout_style') as 'dropdown' | 'double_sidebar' | 'classic') || 'double_sidebar';
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const toggleLayout = () => {
    let next: 'dropdown' | 'double_sidebar' | 'classic';
    if (layoutStyle === 'dropdown') {
      next = 'double_sidebar';
    } else if (layoutStyle === 'double_sidebar') {
      next = 'classic';
    } else {
      next = 'dropdown';
    }
    setLayoutStyle(next);
    localStorage.setItem('sidebar_layout_style', next);
  };

  // Topbar profile card
  const [topbarCardOpen, setTopbarCardOpen] = useState(false);
  const topbarCardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!topbarCardOpen) return;
    const handleOut = (e: MouseEvent) => {
      if (topbarCardRef.current && !topbarCardRef.current.contains(e.target as Node)) {
        setTopbarCardOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOut);
    return () => document.removeEventListener('mousedown', handleOut);
  }, [topbarCardOpen]);

  const activeSection = sections.find((section) =>
    section.items.some((item) => item.href === location.pathname)
  );
  const activeItem = activeSection?.items.find((item) => item.href === location.pathname);

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

  return (
    <div className="min-h-screen bg-[url('/bg1.1.1.svg')] bg-cover bg-center bg-fixed bg-no-repeat">

      {/* ── Mobile-only minimal header ── */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-sm pt-safe md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <img
              src="/TalentMesh_page-0002-removebg-preview.png"
              alt="TalentMesh"
              className="w-[32vw] max-w-[140px] h-auto object-contain"
            />
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
          </div>
        </div>
      </header>

      {/* Classic Layout Desktop Top Header */}
      {layoutStyle === 'classic' && (
        <header className="hidden md:block sticky top-0 z-40 border-b border-slate-200 bg-white shadow-md pt-safe md:pt-0">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-safe py-3 md:px-4">
            <div className="flex items-center min-w-0">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700">TalentMesh Solutions</p>
                <h1 className="truncate text-lg font-bold text-slate-900">HR Portal</h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/select" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-700 sm:inline-flex">
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Switch product</span>
              </Link>
              <div className="w-px h-4 bg-slate-200" />
              
              {/* Layout Switcher Toggle Setting */}
              <button
                onClick={toggleLayout}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-brand-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all focus:outline-none shrink-0"
                title="Switch to Dropdown Layout"
                aria-label="Toggle layout style"
              >
                <Layers className="h-4 w-4" />
              </button>
              
              <div className="w-px h-4 bg-slate-200" />
              <NotificationBell />
              <div className="hidden text-right sm:block">
                <p className="text-[10px] text-slate-400">Logged in as</p>
                <p className="text-sm font-semibold text-slate-900">{employee?.full_name ?? "HR User"}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>
        </header>
      )}

      <div className={cn(
        "w-full px-safe pb-24",
        layoutStyle === 'classic'
          ? "md:mx-auto md:max-w-7xl md:px-4 md:py-6 md:pb-24"
          : "md:!px-0 md:!py-0"
      )}>
        {/* Mobile Overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {layoutStyle === 'classic' ? (
          /* Desktop Classic Layout: Sidebar + Main Outlet side-by-side */
          <div className="hidden md:flex md:gap-6 w-full">
            {/* Sidebar (Desktop Classic) */}
            <aside className="sticky top-24 z-30 w-56 self-start shrink-0">
              <div className="h-[calc(100vh-180px)] flex flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-xl -translate-y-1">
                <div className="flex-1 overflow-y-auto space-y-1 pr-1 hide-scrollbar">
                  {flatLinks.map(({ label, href, icon: Icon }) => {
                    const isActive = location.pathname === href;
                    const showBadge = label === "Connect" && unreadConnectCount > 0;
                    const isExpensesBadge = label === "Expenses" && pendingExpensesCount > 0;
                    return (
                      <Link
                        key={href}
                        to={href}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-display transition-all duration-200 ease-in-out hover:translate-x-1",
                          isActive
                            ? "bg-brand-50 font-semibold text-brand-700 shadow-sm ring-1 ring-brand-100"
                            : "text-slate-600 hover:bg-slate-50"
                        )}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0 transition-colors", isActive ? "text-brand-600" : "text-slate-400 group-hover:text-slate-600")} />
                        <span className="flex-1 truncate">{label}</span>
                        {showBadge && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white animate-pulse">
                            {unreadConnectCount}
                          </span>
                        )}
                        {isExpensesBadge && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                            {pendingExpensesCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </aside>

            {/* Main content (Desktop Classic) */}
            <main className="min-w-0 flex-1">
              <RequireModule to="/hr/dashboard"><Outlet context={{ layoutStyle }} /></RequireModule>
            </main>
          </div>
        ) : (
          /* Desktop Unified Card Layout (dropdown / double_sidebar) */
          <div className={cn("w-full hidden md:flex md:rounded-none md:border-none md:shadow-none overflow-hidden", (layoutStyle === 'dropdown' || layoutStyle === 'double_sidebar') ? "bg-gradient-to-b from-brand-50/30 via-slate-50/50 to-slate-100/40" : "bg-[#0a1c3a]")} style={{ height: '100vh' }}>
            {/* Main Sidebar */}
            {layoutStyle === 'double_sidebar' ? (
              <Sidebar open={false}>
                <DesktopSidebar className="border-r border-slate-200/50 bg-gradient-to-b from-brand-50 via-slate-50 to-slate-100 pt-0 px-2.5 pb-3 shrink-0 rounded-tl-3xl" style={{ height: '100vh' }} showToggle={false}>
                  <HRSidebarContent
                    sections={sections}
                    location={location}
                    unreadConnectCount={unreadConnectCount}
                    pendingExpensesCount={pendingExpensesCount}
                    employee={employee}
                    flatLayout={true}
                    isLight={true}
                  />
                </DesktopSidebar>
              </Sidebar>
            ) : (
              <Sidebar>
                <DesktopSidebar className="border-r border-slate-200/50 bg-gradient-to-b from-brand-50/50 via-slate-50/40 to-slate-100/50 pt-0 px-2.5 pb-3 shrink-0 rounded-tl-3xl" style={{ height: '100vh' }} showToggle={true}>
                  <HRSidebarContent
                    sections={sections}
                    location={location}
                    unreadConnectCount={unreadConnectCount}
                    pendingExpensesCount={pendingExpensesCount}
                    employee={employee}
                    flatLayout={true}
                    isLight={true}
                  />
                </DesktopSidebar>
              </Sidebar>
            )}

            {/* Secondary sliding panel */}
            <div
              className={cn(
                "h-full bg-gradient-to-b from-brand-50 via-slate-50 to-slate-100 border-r border-slate-200/80 transition-all duration-300 ease-in-out overflow-hidden flex flex-col shrink-0",
                layoutStyle === 'double_sidebar' && activeSection ? "w-52" : "w-0 border-r-0"
              )}
            >
              {layoutStyle === 'double_sidebar' && activeSection && (
                <div className="flex flex-col h-full py-4 px-3 select-none">
                  <div className="h-10 flex items-center px-2.5 mb-3">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-600">
                      {activeSection.title}
                    </span>
                  </div>
                  <motion.div
                    key={activeSection.title}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="flex flex-col gap-1 flex-1 overflow-y-auto hide-scrollbar"
                  >
                    {activeSection.items.map((item) => {
                      const ItemIcon = item.icon;
                      const isCurrent = item.href === location.pathname;
                      return (
                        <Link
                          key={item.href}
                          to={item.href}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-all duration-155 group",
                            isCurrent
                              ? "bg-brand-600/15 text-brand-700 font-bold shadow-sm ring-1 ring-brand-600/10"
                              : "text-slate-700 hover:bg-brand-600/5 hover:text-brand-700"
                          )}
                        >
                          <ItemIcon className={cn("h-4 w-4 shrink-0 transition-colors", isCurrent ? "text-brand-600" : "text-slate-500 group-hover:text-brand-600")} />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </motion.div>
                </div>
              )}
            </div>

            {/* Main content */}
            <main className="min-w-0 flex-1 flex flex-col h-full rounded-tl-3xl overflow-hidden bg-white">
              {/* In-content top bar */}
              <div className="flex items-center justify-between gap-3 px-6 h-16 border-b border-slate-100 bg-white shrink-0">
                {/* Left page title / Breadcrumbs */}
                {layoutStyle === 'double_sidebar' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">
                      {activeItem ? activeItem.label : "Dashboard"}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">
                      {activeSection ? activeSection.title : "Dashboard"}
                    </span>
                    {activeItem && (
                      <>
                        <span className="text-slate-300">/</span>
                        <span className="text-sm text-slate-500 font-medium">{activeItem.label}</span>
                      </>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Link to="/select" className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-700 transition-colors">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Switch product</span>
                  </Link>
                  <div className="w-px h-4 bg-slate-200" />

                  {/* Layout Switcher Toggle Setting */}
                  <button
                    onClick={toggleLayout}
                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-brand-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all focus:outline-none shrink-0"
                    title={
                      layoutStyle === 'dropdown'
                        ? "Switch to Double-Sidebar Layout"
                        : layoutStyle === 'double_sidebar'
                        ? "Switch to Classic Layout"
                        : "Switch to Dropdown Layout"
                    }
                    aria-label="Toggle layout style"
                  >
                    {layoutStyle === 'dropdown' ? (
                      <Columns className="h-4 w-4" />
                    ) : layoutStyle === 'double_sidebar' ? (
                      <LayoutGrid className="h-4 w-4" />
                    ) : (
                      <Layers className="h-4 w-4" />
                    )}
                  </button>

                  {/* Dynamic sub-item dropdown (Option A) */}
                  {layoutStyle === 'dropdown' && activeSection && activeSection.items.length > 0 && (
                    <div className="relative">
                      <button
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all focus:outline-none"
                      >
                        {activeItem ? (
                          <>
                            {(() => {
                              const ActiveIcon = activeItem.icon;
                              return <ActiveIcon className="h-3.5 w-3.5 text-brand-600 shrink-0" />;
                            })()}
                            <span>{activeItem.label}</span>
                          </>
                        ) : (
                          <span>Select page</span>
                        )}
                        <ChevronDown className={cn("h-3 w-3 text-slate-500 transition-transform duration-200", dropdownOpen && "rotate-180")} />
                      </button>

                      {dropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setDropdownOpen(false)} />
                          <div className="absolute right-0 mt-1.5 w-48 rounded-xl border border-slate-100 bg-white p-1.5 shadow-xl z-40 focus:outline-none">
                            {activeSection.items.map((item) => {
                              const ItemIcon = item.icon;
                              const isCurrent = item.href === location.pathname;
                              return (
                                <button
                                  key={item.href}
                                  onClick={() => {
                                    setDropdownOpen(false);
                                    navigate(item.href);
                                  }}
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors",
                                    isCurrent
                                      ? "bg-brand-50 text-brand-700 font-semibold"
                                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                  )}
                                >
                                  <ItemIcon className={cn("h-3.5 w-3.5 shrink-0", isCurrent ? "text-brand-600" : "text-slate-400")} />
                                  <span>{item.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div className="w-px h-4 bg-slate-200" />
                  <NotificationBell />

                  {/* Topbar avatar — clickable for profile card */}
                  <div className="relative" ref={topbarCardRef}>
                    <button
                      onClick={() => setTopbarCardOpen((v) => !v)}
                      className="rounded-full ring-2 ring-brand-200 ring-offset-1 hover:ring-brand-400 transition-all focus:outline-none"
                      title="Profile & sign out"
                    >
                      {employee?.profile_photo_url ? (
                        <img src={employee.profile_photo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                          {employee?.full_name?.slice(0, 2).toUpperCase() ?? "?"}
                        </div>
                      )}
                    </button>

                    {/* Profile card dropdown */}
                    <AnimatePresence>
                      {topbarCardOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 6, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 6, scale: 0.96 }}
                          transition={{ duration: 0.15, ease: 'easeOut' }}
                          className="absolute right-0 top-full mt-2 bg-white rounded-2xl shadow-xl border border-slate-200/80 p-3 z-50 w-56"
                        >
                          {/* Profile info */}
                          <div className="flex items-center gap-3 pb-3 mb-2 border-b border-slate-100">
                            {employee?.profile_photo_url ? (
                              <img src={employee.profile_photo_url} alt="" className="h-10 w-10 rounded-full object-cover ring-2 ring-brand-100 shrink-0" />
                            ) : (
                              <div className="h-10 w-10 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                                <span className="text-sm font-bold text-brand-700">{employee?.full_name?.slice(0, 2).toUpperCase() ?? '?'}</span>
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-800 truncate">{employee?.full_name ?? 'HR User'}</p>
                              <p className="text-xs text-slate-400 truncate">{deptLabel(employee, 'HR')}</p>
                            </div>
                          </div>
                          {/* Sign out */}
                          <button
                            onClick={() => { setTopbarCardOpen(false); handleLogout(); }}
                            className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-rose-500 hover:bg-rose-50 transition-colors font-medium"
                          >
                            <LogOut className="h-4 w-4 shrink-0" />
                            Sign out
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                </div>
              </div>
              <div className="flex-1 p-6 overflow-y-auto bg-[url('/bg1.1.1.svg')] bg-cover bg-center bg-no-repeat bg-fixed">
                <RequireModule to="/hr/dashboard"><Outlet context={{ layoutStyle }} /></RequireModule>
              </div>
            </main>
          </div>
        )}

        {/* ── Mobile: just the outlet ── */}
        <main className="md:hidden min-w-0 flex-1">
          <RequireModule to="/hr/dashboard"><Outlet context={{ layoutStyle }} /></RequireModule>
        </main>

        {/* Mobile Slide-over Drawer */}
        <aside className={`fixed inset-y-0 left-0 z-50 w-[88vw] max-w-sm transform overflow-y-auto pb-24 ${layoutStyle === 'dropdown' ? "bg-gradient-to-b from-brand-50/90 via-slate-50/90 to-slate-100/90 border-r border-slate-200/50" : "bg-[#0a1c3a]"} p-4 shadow-xl transition-transform duration-300 ease-in-out md:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <span className={`font-semibold ${layoutStyle === 'dropdown' ? 'text-slate-800' : 'text-white'}`}>Navigation</span>
              <p className={`mt-1 text-xs ${layoutStyle === 'dropdown' ? 'text-slate-500' : 'text-slate-400'}`}>{employee?.full_name ?? "HR User"}</p>
            </div>
            <button onClick={() => setMobileOpen(false)} className={`rounded-lg p-1 ${layoutStyle === 'dropdown' ? 'text-slate-500 hover:bg-black/5 hover:text-slate-800' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="h-full space-y-4">
            <Link
              to="/select"
              className={`mb-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${layoutStyle === 'dropdown' ? 'border border-slate-200 text-slate-600 hover:bg-black/5 hover:text-slate-800' : 'border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'}`}
              onClick={() => setMobileOpen(false)}
            >
              <ArrowLeft className="h-4 w-4" />
              Switch product
            </Link>
            <Sidebar open={true} animate={false}>
              <HRSidebarContent
                sections={sections}
                location={location}
                unreadConnectCount={unreadConnectCount}
                pendingExpensesCount={pendingExpensesCount}
                onItemClick={() => setMobileOpen(false)}
                employee={employee}
                isLight={layoutStyle === 'dropdown'}
              />
            </Sidebar>
            {/* Mobile Logout */}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={handleLogout}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-rose-600 transition-all hover:bg-rose-50"
              >
                <LogOut className="h-4 w-4 shrink-0 text-rose-500" />
                Logout
              </button>
            </div>
          </div>
        </aside>
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
