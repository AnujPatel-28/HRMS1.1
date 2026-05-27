import { useEffect, useState } from "react";
import { LogOut, X, Home, Users, CalendarCheck, MoreHorizontal, ArrowLeft, Menu, LayoutDashboard, Clock, Plane, CheckSquare, ShieldCheck, Palmtree, Calendar, MessageSquare, BookOpen } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useEmployee } from "../hooks/useEmployee";

import { NotificationBell } from "../shared/NotificationBell";

type NavLinkItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  indent?: boolean;
};

const links: readonly NavLinkItem[] = [
  { label: "Dashboard", href: "/hr/dashboard", icon: LayoutDashboard },
  { label: "Employees", href: "/hr/employees", icon: Users },
  { label: "Attendance", href: "/hr/attendance", icon: CalendarCheck },
  { label: "Shifts", href: "/hr/shifts", icon: Clock },
  { label: "Leaves", href: "/hr/leaves", icon: Plane },
  { label: "Tasks", href: "/hr/tasks", icon: CheckSquare },
  { label: "Policies", href: "/hr/policies", icon: ShieldCheck },
  { label: "Holidays", href: "/hr/holidays", icon: Palmtree },
  { label: "Calendar", href: "/hr/calendar", icon: Calendar },
  { label: "Chat", href: "/hr/chat", icon: MessageSquare },
  { label: "Policy Center", href: "/hr/policy-center", icon: BookOpen },
];

export default function HRLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { employee } = useEmployee();
  const [mobileOpen, setMobileOpen] = useState(false);

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
              <h1 className="text-lg font-semibold text-slate-900">HR Portal</h1>
            </div>
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
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
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
          <div className="h-full space-y-1 md:h-fit md:rounded-xl md:border md:border-slate-200 md:bg-white md:p-3 md:shadow-xl md:-translate-y-1">
            <Link
              to="/select"
              className="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 md:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
              Switch product
            </Link>
            {links.map(({ label, href, icon: Icon, indent }) => {
              const isActive = location.pathname === href;
              return (
                <button
                  key={href}
                  type="button"
                  onClick={() => handleMobileNavigate(href)}
                  className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-display transition-all duration-200 ease-in-out hover:translate-x-1 ${indent ? "ml-3" : ""} ${isActive ? "bg-brand-50 font-semibold text-brand-700 shadow-sm ring-1 ring-brand-100" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? "text-brand-600" : "text-slate-400 group-hover:text-slate-600"}`} />
                  {label}
                </button>
              );
            })}
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
            `flex flex-col items-center p-2 text-xs font-medium transition-colors ${isActive ? "text-brand-700" : "text-slate-500 hover:text-slate-900"}`
          }
        >
          <Home className="mb-1 h-5 w-5" />
          Dashboard
        </NavLink>
        <NavLink
          to="/hr/employees"
          className={({ isActive }) =>
            `flex flex-col items-center p-2 text-xs font-medium transition-colors ${isActive ? "text-brand-700" : "text-slate-500 hover:text-slate-900"}`
          }
        >
          <Users className="mb-1 h-5 w-5" />
          Employees
        </NavLink>
        <NavLink
          to="/hr/attendance"
          className={({ isActive }) =>
            `flex flex-col items-center p-2 text-xs font-medium transition-colors ${isActive ? "text-brand-700" : "text-slate-500 hover:text-slate-900"}`
          }
        >
          <CalendarCheck className="mb-1 h-5 w-5" />
          Attendance
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
