import { useEffect, useState } from "react";
import { Building2, Users, TrendingUp, DollarSign, Activity, BarChart3, RefreshCw } from "lucide-react";
import { db } from "../insforge/client";

interface StatsData {
  totalCompanies: number;
  activeCompanies: number;
  trialCompanies: number;
  totalEmployees: number;
  monthlyRevenue: number;
}

interface TenantRow {
  id: string;
  plan: string;
  status: string;
}

const PLAN_RATES: Record<string, number> = {
  starter: 99,
  growth: 149,
  pro: 249,
  trial: 0,
};

export default function AdminDashboard() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: tenants, error: tErr } = await db.from("tenants").select("id,plan,status");

      if (tErr) throw new Error(tErr.message);

      const tenantList = (tenants || []) as TenantRow[];
      const totalCompanies = tenantList.length;
      const activeCompanies = tenantList.filter(t => t.status === "active").length;
      const trialCompanies = tenantList.filter(t => t.status === "trial").length;

      const { count: totalEmployees, error: eErr } = await (db
        .from("employees")
        .select("id", { count: "exact", head: true }) as unknown as Promise<{ count: number | null; error: { message: string } | null }>);

      if (eErr) throw new Error((eErr as { message: string }).message);

      let monthlyRevenue = 0;
      for (const tenant of tenantList) {
        const rate = PLAN_RATES[tenant.plan] ?? 0;
        if (rate > 0) {
          const { count } = await (db
            .from("employees")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.id) as unknown as Promise<{ count: number | null; error: unknown }>);
          monthlyRevenue += rate * (count ?? 0);
        }
      }

      setStats({
        totalCompanies,
        activeCompanies,
        trialCompanies,
        totalEmployees: totalEmployees ?? 0,
        monthlyRevenue,
      });
      setLastUpdated(new Date());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchStats(); }, []);

  const statCards = stats ? [
    { label: "Total Companies", value: stats.totalCompanies, icon: Building2, colorClass: "text-brand-600", bgClass: "bg-brand-50" },
    { label: "Active Companies", value: stats.activeCompanies, icon: Activity, colorClass: "text-emerald-600", bgClass: "bg-emerald-50" },
    { label: "Trial Companies", value: stats.trialCompanies, icon: BarChart3, colorClass: "text-amber-600", bgClass: "bg-amber-50" },
    { label: "Total Employees", value: stats.totalEmployees, icon: Users, colorClass: "text-purple-600", bgClass: "bg-purple-50" },
    { label: "Monthly Revenue Est.", value: `₹${stats.monthlyRevenue.toLocaleString("en-IN")}`, icon: DollarSign, colorClass: "text-cyan-600", bgClass: "bg-cyan-50" },
  ] : [];

  return (
    <div>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Platform Overview</h1>
          <p className="mt-1 text-sm text-slate-500">
            Real-time metrics across all tenants · Last updated {lastUpdated.toLocaleTimeString()}
          </p>
        </div>
        <button
          onClick={() => void fetchStats()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {statCards.map(card => (
            <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500">{card.label}</p>
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.bgClass} ${card.colorClass}`}>
                  <card.icon className="h-5 w-5" />
                </div>
              </div>
              <p className="mt-4 text-3xl font-bold text-slate-900">
                {typeof card.value === "number" ? card.value.toLocaleString() : card.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {!loading && stats && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-semibold text-slate-900">Revenue Rate Card</h2>
          </div>
          <div className="flex flex-wrap gap-6">
            {[
              { plan: "Trial", rate: "Free", color: "bg-slate-400" },
              { plan: "Starter", rate: "₹99 / user", color: "bg-brand-500" },
              { plan: "Growth", rate: "₹149 / user", color: "bg-purple-500" },
              { plan: "Pro", rate: "₹249 / user", color: "bg-cyan-500" },
            ].map(({ plan, rate, color }) => (
              <div key={plan} className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${color}`} />
                <span className="text-sm text-slate-600">{plan}:</span>
                <span className="text-sm font-semibold text-slate-900">{rate}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
