import { Link, Outlet, useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut, Wallet } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useEmployee } from "../../hooks/useEmployee";
import { useTenant } from "../../contexts/TenantContext";
import { useJobTitleLabel } from "../../contexts/OrgUnitsContext";

export default function EmployeePayrollLayout() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { employee } = useEmployee();
  const { tenant } = useTenant();
  const titleLabel = useJobTitleLabel();

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md shadow-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          {/* Left: Logo + Title */}
          <div className="flex items-center gap-3">
            {tenant?.logo_url ? (
              <img
                src={tenant.logo_url}
                alt={tenant.company_name}
                className="h-9 w-9 rounded-lg object-contain border border-slate-200"
              />
            ) : (
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-purple-600 text-white shadow-sm">
                <Wallet className="h-5 w-5" />
              </div>
            )}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-purple-600">
                {tenant?.company_name ?? "TalentMesh"}
              </p>
              <h1 className="text-base font-semibold text-slate-900 leading-tight">My Payslips</h1>
            </div>
          </div>

          {/* Right: Back link + employee name + logout */}
          <div className="flex items-center gap-3">
            <Link
              to="/employee/dashboard"
              className="hidden items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-purple-700 transition sm:inline-flex"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to my portal
            </Link>

            <div className="hidden h-5 w-px bg-slate-200 sm:block" />

            <div className="hidden items-center gap-2.5 sm:flex">
              {employee?.profile_photo_url ? (
                <img
                  src={employee.profile_photo_url}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover ring-2 ring-purple-200"
                />
              ) : (
                <div className="grid h-8 w-8 place-items-center rounded-full bg-purple-100 text-xs font-bold text-purple-700">
                  {employee?.full_name?.slice(0, 2).toUpperCase() ?? "?"}
                </div>
              )}
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-900 leading-tight">
                  {employee?.full_name ?? "Employee"}
                </p>
                <p className="text-[11px] text-slate-500 capitalize">{titleLabel(employee, "Employee")}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
