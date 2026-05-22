import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, BriefcaseBusiness, Users, Wallet } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useTenant } from "../contexts/TenantContext";

function lastProductKey(userId: string) {
  return `talentmesh_last_product_${userId}`;
}

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 space-y-2 text-sm text-slate-600">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ProductSelector() {
  const navigate = useNavigate();
  const { user, role, loading } = useAuth();
  const { tenant } = useTenant();

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-slate-500">Loading...</div>;
  }

  if (!user || !role) {
    return <Navigate to="/" replace />;
  }

  const saveChoice = (product: "hr" | "employee" | "payroll") => {
    localStorage.setItem(lastProductKey(user.id), product);
    navigate(
      product === "hr" ? "/hr/dashboard" : product === "payroll" ? "/payroll/hr/salaries" : "/employee/dashboard",
      { replace: true },
    );
  };

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-5xl">
        <div className="mb-8 text-center">
          <div className="mx-auto grid h-20 w-20 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt={tenant.company_name} className="h-full w-full object-contain p-3" />
            ) : (
              <BriefcaseBusiness className="h-9 w-9 text-brand-600" />
            )}
          </div>
          <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-brand-700">
            {tenant?.company_name ?? "TalentMesh"}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">What would you like to do today?</h1>
        </div>

        {role === "employee" ? (
          <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-teal-50 text-teal-700">
              <Users className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">My Portal</h2>
            <p className="mt-1 text-sm text-slate-500">Attendance, leaves, tasks, policies and your employee profile</p>
            <FeatureList
              items={[
                "Punch in/out and view attendance",
                "Apply for leave and track status",
                "Submit assigned tasks",
                "View policies and profile details",
                "View payslips and download pay stubs",
              ]}
            />
            <button
              type="button"
              onClick={() => saveChoice("employee")}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700"
            >
              Go to My Dashboard <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                <Users className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">HR Management</h2>
              <p className="mt-1 text-sm text-slate-500">Attendance, leaves, tasks, policies and team management</p>
              <FeatureList
                items={[
                  "Employee profiles & documents",
                  "Attendance & punch in/out",
                  "Leave management & approvals",
                  "Task assignment & tracking",
                ]}
              />
              <button
                type="button"
                onClick={() => saveChoice("hr")}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                Open HR Portal <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-purple-50 text-purple-700">
                <Wallet className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">Payroll System</h2>
              <p className="mt-1 text-sm text-slate-500">Salary structures, payroll runs and payslip management</p>
              <FeatureList
                items={[
                  "Salary & CTC management",
                  "Monthly payroll processing",
                  "Payslip generation & download",
                  "PF, ESI & tax deductions",
                ]}
              />
              <button
                type="button"
                onClick={() => saveChoice("payroll")}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-purple-700"
              >
                Open Payroll <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
