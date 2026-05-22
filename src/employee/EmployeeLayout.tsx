import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, LayoutDashboard, User, Clock, Calendar, ClipboardList, FileText, MessageSquare, X, Wallet, Home, MoreHorizontal, Menu } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useEmployee } from "../hooks/useEmployee";
import { NotificationBell } from "../shared/NotificationBell";

const links = [
  { label: "Dashboard", href: "/employee/dashboard", icon: LayoutDashboard },
  { label: "My Profile", href: "/employee/profile", icon: User },
  { label: "Punch In/Out", href: "/employee/punch", icon: Clock },
  { label: "My Leaves", href: "/employee/leaves", icon: Calendar },
  { label: "My Tasks", href: "/employee/tasks", icon: ClipboardList },
  { label: "Policies", href: "/employee/policies", icon: FileText },
  { label: "Chat", href: "/employee/chat", icon: MessageSquare },
  { label: "Payslips", href: "/payroll/employee/payslips", icon: Wallet },
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

  const deptColor = DEPT_COLORS[employee?.department ?? ""] ?? "bg-slate-100 text-slate-600";

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
            {links.map(({ label, href, icon: Icon }) => {
              const isActive = location.pathname === href;
              return (
                <button
                  key={href}
                  type="button"
                  onClick={() => handleMobileNavigate(href)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium font-display transition ${isActive ? "bg-brand-50 text-brand-700 font-semibold" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
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
