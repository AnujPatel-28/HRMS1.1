import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut, Menu, X } from "lucide-react";
import { useTenant } from "../contexts/TenantContext";
import { useAuth } from "../hooks/useAuth";
import { useEmployee } from "../hooks/useEmployee";
import { NotificationBell } from "../shared/NotificationBell";

const links: { label: string; href: string; disabled?: boolean; note?: string }[] = [
  { label: "Salary Structures", href: "/payroll/hr/salaries" },
  { label: "Run Payroll", href: "/payroll/hr/run" },
  { label: "Payslips", href: "/payroll/hr/payslips" },
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
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
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

      <div className="mx-auto flex max-w-7xl px-4 py-6 md:gap-6">
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-50 w-64 transform bg-white p-4 shadow-xl transition-transform duration-200 ease-in-out md:static md:w-56 md:translate-x-0 md:bg-transparent md:p-0 md:shadow-none ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="mb-6 flex items-center justify-between md:hidden">
            <span className="font-semibold text-slate-900">Payroll</span>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="h-full space-y-1 md:h-fit md:rounded-xl md:border md:border-slate-200 md:bg-white md:p-3 md:shadow-sm">
            {links.map((link) =>
              link.disabled ? (
                <div
                  key={link.label}
                  className="flex cursor-not-allowed items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-400"
                >
                  <span>{link.label}</span>
                  {link.note && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
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
                    `block rounded-lg px-3 py-2 text-sm ${
                      isActive ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-100"
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              ),
            )}
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
