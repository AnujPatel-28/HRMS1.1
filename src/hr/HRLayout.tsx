import { useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useEmployee } from "../hooks/useEmployee";

import { NotificationBell } from "../shared/NotificationBell";

const links = [
  ["Dashboard", "/hr/dashboard"],
  ["Employees", "/hr/employees"],
  ["Attendance", "/hr/attendance"],
  ["Leaves", "/hr/leaves"],
  ["Tasks", "/hr/tasks"],
  ["Policies", "/hr/policies"],
  ["Holidays", "/hr/holidays"],
  ["Calendar", "/hr/calendar"],
  ["Chat", "/hr/chat"],
] as const;

export default function HRLayout() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { employee } = useEmployee();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="md:hidden p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
              <Menu className="h-6 w-6" />
            </button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">TalentMesh Solutions</p>
              <h1 className="text-lg font-semibold text-slate-900">HR Portal</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
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

      <div className="mx-auto flex max-w-7xl px-4 py-6 md:gap-6">
        {/* Mobile Overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* Sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-50 w-64 transform bg-white p-4 shadow-xl transition-transform duration-200 ease-in-out md:static md:w-56 md:translate-x-0 md:bg-transparent md:p-0 md:shadow-none ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between mb-6 md:hidden">
            <span className="font-semibold text-slate-900">Menu</span>
            <button onClick={() => setMobileOpen(false)} className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="h-full space-y-1 md:h-fit md:rounded-xl md:border md:border-slate-200 md:bg-white md:p-3 md:shadow-sm">
            {links.map(([label, href]) => (
              <NavLink
                key={href}
                to={href}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-sm ${isActive ? "bg-brand-50 text-brand-700 font-semibold" : "text-slate-600 hover:bg-slate-100"}`
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
    </div>
  );
}
