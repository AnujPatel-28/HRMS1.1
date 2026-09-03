import { useEffect, useRef, useState, useMemo } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LogOut, LayoutDashboard, User, Clock, Calendar, ClipboardList,
  FileText, MessageSquare, X, Wallet, Home, MoreHorizontal, Menu,
  Contact, CreditCard, Users, Rss, GitBranch, FolderKanban, Receipt,
  Shield, ChevronDown, Columns, Layers, LayoutGrid
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useEmployee } from "../hooks/useEmployee";
import { useManagerView } from "../hooks/useManagerView";
import { NotificationBell } from "../shared/NotificationBell";
import { useTenant } from "../contexts/TenantContext";
import { RequireModule } from "../shared/RequireModule";
import type { ModuleKey } from "../modules";
import { db, realtime } from "../insforge/client";
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
  items: NavLinkItem[];
};

const BASE_SECTIONS: NavSection[] = [
  {
    title: "Profile",
    icon: User,
    items: [
      { label: "My Profile", href: "/employee/profile", icon: User },
      { label: "My ID Card", href: "/employee/id-card", icon: CreditCard },
      { label: "Directory", href: "/employee/directory", icon: Contact },
      { label: "Org Chart", href: "/employee/org-chart", icon: GitBranch },
      { label: "Resignation", href: "/employee/exit", icon: LogOut, module: "offboarding" },
    ],
  },
  {
    title: "Time & Tasks",
    icon: Clock,
    items: [
      { label: "Punch In/Out", href: "/employee/punch", icon: Clock, module: "attendance" },
      { label: "My Leaves", href: "/employee/leaves", icon: Calendar, module: "leave" },
      { label: "My Tasks", href: "/employee/tasks", icon: ClipboardList, module: "tasks" },
    ],
  },
  {
    title: "Finance",
    icon: Wallet,
    items: [
      { label: "Payslips", href: "/payroll/employee/payslips", icon: Wallet, module: "payroll" },
      { label: "Expenses", href: "/employee/expenses", icon: Receipt, module: "expenses" },
      { label: "Insurance", href: "/employee/insurance", icon: Shield, module: "insurance" },
    ],
  },
  {
    title: "Communication",
    icon: MessageSquare,
    items: [
      { label: "Chat", href: "/employee/chat", icon: MessageSquare, module: "chat" },
      { label: "Connect", href: "/employee/connect", icon: Rss, module: "connect" },
      { label: "Policies", href: "/employee/policies", icon: FileText, module: "policy_center" },
    ],
  },
];

function EmployeeSidebarContent({
  sections,
  location,
  unreadConnectCount,
  onItemClick,
  employee,
  flatLayout = false,
  isLight = false,
}: {
  sections: NavSection[];
  location: any;
  unreadConnectCount: number;
  onItemClick?: () => void;
  employee?: { full_name?: string; profile_photo_url?: string; org_unit_id?: string | null } | null;
  flatLayout?: boolean;
  isLight?: boolean;
}) {
  const deptLabel = useDepartmentLabel();
  const { open } = useSidebar();
  const [openSection, setOpenSection] = useState<string | null>(() => {
    const activeSection = sections.find((section) =>
      section.items.some(
        (item) =>
          item.href === location.pathname ||
          (item.href.includes("?") && location.pathname + location.search === item.href)
      )
    );
    return activeSection ? activeSection.title : sections[0]?.title ?? null;
  });

  useEffect(() => {
    const activeSection = sections.find((section) =>
      section.items.some(
        (item) =>
          item.href === location.pathname ||
          (item.href.includes("?") && location.pathname + location.search === item.href)
      )
    );
    if (activeSection) {
      setOpenSection(activeSection.title);
    }
  }, [location.pathname, location.search, sections]);

  const toggleSection = (title: string) => {
    setOpenSection((prev) => (prev === title ? null : title));
  };

  const activeSection = sections.find((section) =>
    section.items.some(
      (item) =>
        item.href === location.pathname ||
        (item.href.includes("?") && location.pathname + location.search === item.href)
    )
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
        : "bg-white/10 font-semibold text-white shadow-sm ring-1 ring-white/10";
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
        ? (isLight ? "text-brand-600" : "text-white")
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
          <p className={cn("text-xs mt-0.5", textSubtitleClass)}>Employee Portal</p>
        </motion.div>
      </div>

      {/* ── Nav sections ── */}
      <div className="flex flex-col gap-1 py-2 flex-1 overflow-y-auto hide-scrollbar">
        {/* Standalone Dashboard */}
        <SidebarLink
          isActive={location.pathname === "/employee/dashboard"}
          link={{
            label: "Dashboard",
            href: "/employee/dashboard",
            icon: (
              <LayoutDashboard
                className={getIconClass(location.pathname === "/employee/dashboard")}
              />
            ),
          }}
          className={getLinkClass(location.pathname === "/employee/dashboard")}
          onClick={onItemClick}
        />


        {flatLayout ? (
          sections.map((section) => {
            const SectionIcon = section.icon;
            const defaultHref = section.items[0]?.href ?? "/employee/dashboard";
            const isActive = activeSection?.title === section.title;
            const showBadge = section.title === "Communication" && unreadConnectCount > 0;

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
                        const isActive =
                          location.pathname === href ||
                          (href.includes("?") && location.pathname + location.search === href);
                        const showBadge = label === "Connect" && unreadConnectCount > 0;

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
            {/* Avatar — always visible */}
            {employee.profile_photo_url ? (
              <img src={employee.profile_photo_url} alt="" className={cn("h-8 w-8 rounded-full object-cover shrink-0", ringClass)} />
            ) : (
              <div className={cn("h-8 w-8 rounded-full flex items-center justify-center shrink-0", avatarBgClass)}>
                <span className="text-xs font-bold">{employee.full_name?.slice(0, 2).toUpperCase() ?? '?'}</span>
              </div>
            )}
            {/* Name — slides in when expanded */}
            <motion.div
              initial={false}
              animate={{ width: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden whitespace-nowrap min-w-0"
            >
              <p className={cn("text-xs truncate", textNameClass)}>{employee.full_name ?? 'Employee'}</p>
              <p className={cn("text-[10px] truncate", textMutedClass)}>{deptLabel(employee, 'Employee')}</p>
            </motion.div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmployeeLayout() {
  const deptLabel = useDepartmentLabel();
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, tenantId, user } = useAuth();
  const { employee } = useEmployee();
  const { hasModule } = useTenant();
  const { isManager, isManagerMode, toggleManagerMode, directReportIds } = useManagerView();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [unreadConnectCount, setUnreadConnectCount] = useState(0);
  const [hasProjects, setHasProjects] = useState(false);
  // Two modes, matching the HR portal: `classic` flattened every section into one list, which hid
  // the module structure the product is built on. Key scoped per user -- it had no user id, so on a
  // shared machine one person's layout followed the next person.
  const layoutKey = `sidebar_layout_style_${user?.id ?? 'anon'}`;
  const [layoutStyle, setLayoutStyle] = useState<'dropdown' | 'double_sidebar'>(() => {
    const stored = localStorage.getItem(layoutKey);
    return stored === 'dropdown' || stored === 'double_sidebar' ? stored : 'double_sidebar';
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [onboardingIncomplete, setOnboardingIncomplete] = useState(false);

  useEffect(() => {
    if (!employee?.id || !tenantId) return;
    
    db.from("employee_onboarding_self")
      .select("completed_at")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) {
          setOnboardingIncomplete(!data.completed_at);
        }
      });
  }, [employee?.id, tenantId]);

  const toggleLayout = () => {
    const next: 'dropdown' | 'double_sidebar' = layoutStyle === 'double_sidebar' ? 'dropdown' : 'double_sidebar';
    setLayoutStyle(next);
    localStorage.setItem(layoutKey, next);
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

  const sections = useMemo(() => {
    // Drop entries whose module this tenant does not have, then drop any section left empty.
    const result = BASE_SECTIONS.map((s) => ({
      ...s,
      items: s.items.filter((item) => !item.module || hasModule(item.module)),
    })).filter((s) => s.items.length > 0);
    const timeSection = result.find((s) => s.title === "Time & Tasks");
    if (timeSection && hasProjects) {
      const idx = timeSection.items.findIndex((i) => i.href === "/employee/tasks");
      if (idx !== -1) {
        timeSection.items.splice(idx + 1, 0, {
          label: "My Projects",
          href: "/employee/tasks?tab=projects",
          icon: FolderKanban,
        });
      }
    }
    if (isManager) {
      const profileSection = result.find((s) => s.title === "Profile");
      if (profileSection) {
        profileSection.items.push({ label: "My Team", href: "/employee/my-team", icon: Users });
      }
    }
    return result;
  }, [isManager, hasProjects, hasModule]);


  const activeSection = sections.find((section) =>
    section.items.some(
      (item) =>
        item.href === location.pathname ||
        (item.href.includes("?") && location.pathname + location.search === item.href)
    )
  );
  const activeItem = activeSection?.items.find(
    (item) =>
      item.href === location.pathname ||
      (item.href.includes("?") && location.pathname + location.search === item.href)
  );

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
      if (!error && data) setUnreadConnectCount(data.length);
    };

    void fetchUnreadCount();

    const handleInsert = (payload: any) => {
      if (payload.tenant_id === tenantId && location.pathname !== "/employee/connect") {
        setUnreadConnectCount((prev) => prev + 1);
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

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (isManagerMode) setShowBanner(true);
  }, [isManagerMode]);

  useEffect(() => {
    if (!employee?.id || !tenantId) return;
    db.from("tasks")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("assigned_to", employee.id)
      .not("project_id", "is", null)
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) setHasProjects(true);
      });
  }, [employee?.id, tenantId]);

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-[url('/bg3.1.svg')] bg-cover bg-center bg-fixed bg-no-repeat">

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
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700">TalentMesh</p>
              <p className="text-sm font-semibold text-slate-900">Employee Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isManager && (
              <div
                onClick={toggleManagerMode}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full cursor-pointer text-[11px] font-semibold select-none transition-all duration-200 ${
                  isManagerMode ? "bg-[#E24B4A] text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {isManagerMode ? "Manager" : "My View"}
              </div>
            )}
            <NotificationBell />
          </div>
        </div>
      </header>


      {/* Manager mode banner */}
      {isManagerMode && showBanner && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-800 px-4 py-2 text-xs flex justify-between items-center shadow-sm">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
            <span>Viewing as manager — showing your team of {directReportIds.length} members.</span>
          </div>
          <button onClick={() => setShowBanner(false)} className="text-amber-500 hover:text-amber-700 font-bold ml-2">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="w-full px-safe pb-24 md:!px-0 md:!py-0">
        {/* Mobile Overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* Desktop shell: a quiet ground, matching the HR portal. */}
        <div className="w-full hidden md:flex md:rounded-none md:border-none md:shadow-none overflow-hidden bg-slate-50" style={{height: '100vh'}}>
            {/* Main Sidebar */}
            {layoutStyle === 'double_sidebar' ? (
              <Sidebar open={false}>
                <DesktopSidebar className="border-r border-white/10 bg-[#0a1c3a] pt-0 px-2.5 pb-3 shrink-0 rounded-tl-3xl" style={{height: '100vh'}} showToggle={false}>
                  <EmployeeSidebarContent
                    sections={sections}
                    location={location}
                    unreadConnectCount={unreadConnectCount}
                    employee={employee}
                    flatLayout={true}
                  />
                </DesktopSidebar>
              </Sidebar>
            ) : (
              <Sidebar>
                <DesktopSidebar className="border-r border-slate-200/50 bg-gradient-to-b from-brand-50/50 via-slate-50/40 to-slate-100/50 pt-0 px-2.5 pb-3 shrink-0 rounded-tl-3xl" style={{height: '100vh'}} showToggle={true}>
                  <EmployeeSidebarContent
                    sections={sections}
                    location={location}
                    unreadConnectCount={unreadConnectCount}
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
                "h-full bg-[#0e2246] border-r border-white/10 transition-all duration-300 ease-in-out overflow-hidden flex flex-col shrink-0",
                layoutStyle === 'double_sidebar' && activeSection ? "w-52" : "w-0 border-r-0"
              )}
            >
              {layoutStyle === 'double_sidebar' && activeSection && (
                <div className="flex flex-col h-full py-4 px-3 select-none">
                  <div className="h-10 flex items-center px-2.5 mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      {activeSection.title}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 flex-1 overflow-y-auto hide-scrollbar">
                    {activeSection.items.map((item) => {
                      const ItemIcon = item.icon;
                      const isCurrent =
                        item.href === location.pathname ||
                        (item.href.includes("?") && location.pathname + location.search === item.href);
                      return (
                        <Link
                          key={item.href}
                          to={item.href}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-155",
                            isCurrent
                              ? "bg-white/10 text-white font-semibold shadow-sm ring-1 ring-white/10"
                              : "text-slate-300 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          <ItemIcon className={cn("h-4 w-4 shrink-0", isCurrent ? "text-white" : "text-slate-400")} />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Main content */}
            <main className="min-w-0 flex-1 flex flex-col h-full rounded-tl-3xl overflow-hidden bg-white">
              {/* In-content top bar (desktop only) */}
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
                              const isCurrent =
                                item.href === location.pathname ||
                                (item.href.includes("?") && location.pathname + location.search === item.href);
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
                              <p className="text-sm font-semibold text-slate-800 truncate">{employee?.full_name ?? 'Employee'}</p>
                              <p className="text-xs text-slate-400 truncate">{deptLabel(employee, 'Employee')}</p>
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
              <div className="flex-1 p-6 overflow-y-auto bg-[url('/bg3.1.svg')] bg-cover bg-center bg-no-repeat bg-fixed">
                {onboardingIncomplete && location.pathname !== "/employee/onboarding" && (
                  <div className="mb-4 flex items-center justify-between p-3.5 bg-brand-50 border border-brand-100 rounded-xl shadow-sm text-xs font-semibold text-brand-800 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white font-bold text-[10px]">!</span>
                      <span>Welcome! Please complete your onboarding profile details.</span>
                    </div>
                    <Link
                      to="/employee/onboarding"
                      className="px-3 py-1 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition animate-pulse"
                    >
                      Complete Onboarding →
                    </Link>
                  </div>
                )}
                <RequireModule to="/employee/dashboard"><Outlet /></RequireModule>
              </div>
            </main>
        </div>

        {/* ── Mobile: just the outlet ── */}
        <main className="md:hidden min-w-0 flex-1 p-4 bg-slate-50 min-h-screen">
          {onboardingIncomplete && location.pathname !== "/employee/onboarding" && (
            <div className="mb-4 flex flex-col p-3 bg-brand-50 border border-brand-100 rounded-xl shadow-sm text-xs font-semibold text-brand-800 gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white font-bold text-[10px] shrink-0">!</span>
                <span>Welcome! Please complete your onboarding details.</span>
              </div>
              <Link
                to="/employee/onboarding"
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-center font-bold rounded-lg transition"
              >
                Complete Onboarding
              </Link>
            </div>
          )}
          <RequireModule to="/employee/dashboard"><Outlet /></RequireModule>
        </main>

        {/* Mobile Slide-over Drawer */}
        <aside className={`fixed inset-y-0 right-0 z-50 w-full max-w-xs transform ${layoutStyle === 'dropdown' ? "bg-gradient-to-b from-brand-50/90 via-slate-50/90 to-slate-100/90 border-l border-slate-200/50" : "bg-[#0a1c3a]"} p-4 shadow-xl transition-transform duration-300 ease-in-out md:hidden ${mobileOpen ? "translate-x-0" : "translate-x-full"}`}>
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <span className={`font-semibold ${layoutStyle === 'dropdown' ? 'text-slate-800' : 'text-white'}`}>Navigation</span>
              <p className={`mt-1 text-xs ${layoutStyle === 'dropdown' ? 'text-slate-500' : 'text-slate-400'}`}>{employee?.full_name ?? "Employee"}</p>
            </div>
            <button onClick={() => setMobileOpen(false)} className={`rounded-lg p-1 ${layoutStyle === 'dropdown' ? 'text-slate-500 hover:bg-black/5 hover:text-slate-800' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-1 overflow-y-auto max-h-[calc(100vh-120px)] pr-2">
            <Sidebar open={true} animate={false}>
              <EmployeeSidebarContent
                sections={sections}
                location={location}
                unreadConnectCount={unreadConnectCount}
                onItemClick={() => setMobileOpen(false)}
                employee={employee}
                isLight={layoutStyle === 'dropdown'}
              />
            </Sidebar>
          </div>
        </aside>
      </div>

      {/* Mobile bottom nav */}
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
