import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut, Menu, X, FileSpreadsheet, Play, Receipt } from "lucide-react";
import { useTenant } from "../contexts/TenantContext";
import { useAuth } from "../hooks/useAuth";
import { useEmployee } from "../hooks/useEmployee";
import { NotificationBell } from "../shared/NotificationBell";
import { Sidebar, DesktopSidebar, SidebarLink } from "../components/ui/sidebar";

const links: { label: string; href: string; icon: React.ElementType; disabled?: boolean; note?: string }[] = [
  { label: "Salary Structures", href: "/payroll/hr/salaries", icon: FileSpreadsheet },
  { label: "Run Payroll", href: "/payroll/hr/run", icon: Play },
  { label: "Payslips", href: "/payroll/hr/payslips", icon: Receipt },
];

export default function PayrollLayout() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { employee } = useEmployee();
  const { tenant } = useTenant();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-md pt-safe md:pt-0">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-safe py-3 md:px-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:hidden"
            >
              <Menu className="h-6 w-6" />
            </button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                {tenant?.company_name ?? "TalentMesh"}
              </p>
              <h1 className="text-lg font-semibold text-slate-900">Payroll</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/hr/dashboard"
              className="hidden items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-700 sm:inline-flex"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to HR Portal
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

      <div className="mx-auto flex max-w-7xl px-safe py-6 md:gap-6 md:px-4">
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Desktop Sidebar (Hover-expandable) */}
        <Sidebar>
          <DesktopSidebar className="md:sticky md:top-24 md:rounded-xl md:border md:border-white/10 md:bg-[#0a1c3a] md:p-3 md:shadow-xl md:-translate-y-1">
            <div className="flex flex-col gap-1">
              {links.map((link) => {
                const Icon = link.icon;
                const isActive = window.location.pathname === link.href;
                
                return link.disabled ? (
                  <div
                    key={link.label}
                    className="flex cursor-not-allowed items-center justify-between rounded-lg px-3 py-2 text-sm font-display text-slate-500"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 shrink-0 text-slate-600" />
                      <span>{link.label}</span>
                    </div>
                    {link.note && (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-400">
                        {link.note}
                      </span>
                    )}
                  </div>
                ) : (
                  <SidebarLink
                    key={link.href}
                    link={{
                      label: link.label,
                      href: link.href,
                      icon: <Icon className={`h-5 w-5 shrink-0 transition-colors ${isActive ? "text-white" : "text-slate-400"}`} />,
                    }}
                    className={isActive 
                      ? "bg-white/10 text-white font-semibold shadow-sm ring-1 ring-white/10" 
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                    }
                  />
                );
              })}
            </div>
          </DesktopSidebar>
        </Sidebar>

        {/* Mobile Slide-over Drawer */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-[88vw] max-w-sm transform bg-[#0a1c3a] p-4 shadow-xl transition-transform duration-200 ease-in-out md:hidden ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="mb-6 flex items-center justify-between">
            <span className="font-semibold text-white">Payroll</span>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="h-full space-y-1">
            {links.map((link) => {
              const Icon = link.icon;
              return link.disabled ? (
                <div
                  key={link.label}
                  className="flex cursor-not-allowed items-center justify-between rounded-lg px-3 py-2 text-sm font-display text-slate-500"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 shrink-0 text-slate-600" />
                    <span>{link.label}</span>
                  </div>
                  {link.note && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-400">
                      {link.note}
                    </span>
                  )}
                </div>
              ) : (
                <NavLink
                  key={link.href}
                  to={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-display ${
                      isActive 
                        ? "bg-white/10 font-semibold text-white shadow-sm ring-1 ring-white/10" 
                        : "text-slate-300 hover:bg-white/10 hover:text-white"
                    }`
                  }
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span>{link.label}</span>
                </NavLink>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
