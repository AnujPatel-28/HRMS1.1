import { useState } from "react";
import { LogOut, Menu, X, Home, Users, CalendarCheck, MoreHorizontal } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useEmployee } from "../hooks/useEmployee";

import { NotificationBell } from "../shared/NotificationBell";

type NavLinkItem = {
  label: string;
  href: string;
  indent?: boolean;
};

const links: readonly NavLinkItem[] = [
  { label: "Dashboard", href: "/hr/dashboard" },
  { label: "Employees", href: "/hr/employees" },
  { label: "Attendance", href: "/hr/attendance" },
  { label: "Shifts", href: "/hr/shifts" },
  { label: "Leaves", href: "/hr/leaves" },
  { label: "Tasks", href: "/hr/tasks" },
  { label: "Policies", href: "/hr/policies" },
  { label: "Holidays", href: "/hr/holidays" },
  { label: "Calendar", href: "/hr/calendar" },
  { label: "Chat", href: "/hr/chat" },
  { label: "Policy Center", href: "/hr/policy-center" },
];

export default function HRLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const { employee } = useEmployee();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white pt-safe md:pt-0">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-safe py-3 md:px-4">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">TalentMesh Solutions</p>
              <h1 className="text-lg font-semibold text-slate-900">HR Portal</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/select" className="hidden text-xs font-medium text-slate-500 hover:text-brand-700 sm:inline">
              ⟵ Switch product
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

      <div className="mx-auto flex max-w-7xl px-safe py-10 md:px-4 md:py-6 md:gap-6">
        {/* Mobile Overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* Sidebar (Desktop) / Slide-up Menu (Mobile) */}
        <aside className={`fixed inset-y-0 right-0 z-50 w-full transform bg-white p-4 shadow-xl transition-transform duration-300 ease-in-out md:static md:w-56 md:translate-x-0 md:bg-transparent md:p-0 md:shadow-none sm:w-80 ${mobileOpen ? "translate-x-0" : "translate-x-full md:translate-x-0"}`}>
          <div className="flex items-center justify-between mb-6 md:hidden">
            <span className="font-semibold text-slate-900">Menu</span>
            <button onClick={() => setMobileOpen(false)} className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="h-full space-y-1 md:h-fit md:rounded-xl md:border md:border-slate-200 md:bg-white md:p-3 md:shadow-sm">
            {links.map(({ label, href, indent }) => (
              <NavLink
                key={href}
                to={href}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-sm ${indent ? "ml-3" : ""} ${isActive ? "bg-brand-50 text-brand-700 font-semibold" : "text-slate-600 hover:bg-slate-100"}`
                }
              >
                {label}
              </NavLink>
            ))}
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
      
      {/* Spacer for mobile bottom nav */}
      <div className="h-16 md:hidden" />
    </div>
  );
}
