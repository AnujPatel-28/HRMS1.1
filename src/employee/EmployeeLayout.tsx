import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut, LayoutDashboard, User, Clock, Calendar, ClipboardList, FileText, MessageSquare, Menu, X, Wallet } from "lucide-react";
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
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { employee } = useEmployee();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const deptColor = DEPT_COLORS[employee?.department ?? ""] ?? "bg-slate-100 text-slate-600";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="md:hidden p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
              <Menu className="h-6 w-6" />
            </button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">TalentMesh Solutions</p>
              <h1 className="text-lg font-semibold text-slate-900">Employee Portal</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/select" className="hidden text-xs font-medium text-slate-500 hover:text-brand-700 sm:inline">
              ⟵ Switch product
            </Link>
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
            {links.map(({ label, href, icon: Icon }) => (
              <NavLink key={href} to={href} onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${isActive ? "bg-brand-50 text-brand-700 font-semibold" : "text-slate-600 hover:bg-slate-100"}`
                }>
                <Icon className="h-4 w-4 shrink-0" />
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
