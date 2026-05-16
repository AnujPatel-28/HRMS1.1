import { useEffect, useState, useRef } from "react";
import { Search, Filter, Eye, ChevronDown, AlertTriangle, CheckCircle, RefreshCw, X, Building2, Users, Calendar, Globe, CreditCard, Activity } from "lucide-react";
import { db } from "../insforge/client";

interface Tenant {
  id: string;
  company_name: string;
  subdomain: string;
  plan: string;
  status: string;
  max_employees: number;
  created_at: string;
  employee_count?: number;
}

const STATUS_CONFIG: Record<string, { label: string; colorClass: string; bgClass: string }> = {
  active: { label: "Active", colorClass: "text-emerald-700", bgClass: "bg-emerald-100" },
  trial: { label: "Trial", colorClass: "text-amber-700", bgClass: "bg-amber-100" },
  suspended: { label: "Suspended", colorClass: "text-red-700", bgClass: "bg-red-100" },
  cancelled: { label: "Cancelled", colorClass: "text-slate-700", bgClass: "bg-slate-100" },
};

const PLAN_LABELS: Record<string, string> = { trial: "Trial", starter: "Starter", growth: "Growth", pro: "Pro" };

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.cancelled;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.bgClass} ${cfg.colorClass}`}>
      {cfg.label}
    </span>
  );
}

interface DetailModalProps {
  tenant: Tenant;
  onClose: () => void;
}

function DetailModal({ tenant, onClose }: DetailModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">{tenant.company_name}</h2>
              <p className="text-sm text-slate-500">{tenant.subdomain}.talentmesh.in</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {[
            { icon: Globe, label: "Subdomain", value: tenant.subdomain },
            { icon: CreditCard, label: "Plan", value: PLAN_LABELS[tenant.plan] ?? tenant.plan },
            { icon: Activity, label: "Status", value: <StatusBadge status={tenant.status} /> },
            { icon: Users, label: "Max Employees", value: tenant.max_employees === 9999 ? "Unlimited" : tenant.max_employees },
            { icon: Users, label: "Current Employees", value: tenant.employee_count ?? "—" },
            { icon: Calendar, label: "Created", value: new Date(tenant.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Icon className="h-4 w-4 text-slate-400" />
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
              </div>
              <div className="text-sm font-medium text-slate-900">{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AllCompanies() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [detailTenant, setDetailTenant] = useState<Tenant | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [openPlanDropdown, setOpenPlanDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchTenants = async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const { data, error } = await db
        .from("tenants")
        .select("id,company_name,subdomain,plan,status,max_employees,created_at")
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);

      const list = (data || []) as Tenant[];
      const enriched = await Promise.all(
        list.map(async (t) => {
          const { count, error: countError } = await (db
            .from("employees")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", t.id) as unknown as Promise<{ count: number | null; error: { message: string } | null }>);

          if (countError) throw new Error(`Could not load employee count for ${t.company_name}: ${countError.message}`);
          return { ...t, employee_count: count ?? 0 };
        })
      );

      setTenants(enriched);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTenants([]);
      setLoadError(message);
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchTenants(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenPlanDropdown(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const updateTenant = async (id: string, updates: Partial<Tenant>) => {
    setActionLoading(id);
    const { error } = await db.from("tenants").update(updates).eq("id", id);
    if (error) {
      showToast(error.message, "error");
    } else {
      setTenants(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
      showToast("Company updated successfully.", "success");
    }
    setActionLoading(null);
    setOpenPlanDropdown(null);
  };

  const filtered = tenants.filter(t => {
    const matchesSearch = t.company_name.toLowerCase().includes(search.toLowerCase()) || t.subdomain.toLowerCase().includes(search.toLowerCase());
    const matchesPlan = filterPlan === "all" || t.plan === filterPlan;
    const matchesStatus = filterStatus === "all" || t.status === filterStatus;
    return matchesSearch && matchesPlan && matchesStatus;
  });

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`fixed right-6 top-6 z-[200] rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg transition-all ${toast.type === "success" ? "bg-emerald-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {/* Detail modal */}
      {detailTenant && <DetailModal tenant={detailTenant} onClose={() => setDetailTenant(null)} />}

      {/* Header */}
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">All Companies</h1>
          <p className="mt-1 text-sm text-slate-500">{tenants.length} registered tenants</p>
        </div>
        <button
          onClick={() => void fetchTenants()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Filter bar */}
      {loadError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by company or subdomain..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 pl-10 pr-4 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div className="flex items-center gap-3">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={filterPlan}
            onChange={e => setFilterPlan(e.target.value)}
            className="rounded-lg border border-slate-200 py-2 pl-3 pr-8 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="all">All Plans</option>
            <option value="trial">Trial</option>
            <option value="starter">Starter</option>
            <option value="growth">Growth</option>
            <option value="pro">Pro</option>
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="rounded-lg border border-slate-200 py-2 pl-3 pr-8 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                {["Company", "Subdomain", "Plan", "Status", "Employees", "Created", "Actions"].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-6 py-4">
                        <div className="h-4 animate-pulse rounded bg-slate-100" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : loadError ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-red-600">
                    Unable to load companies. Use Refresh after fixing the backend error above.
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-slate-500">
                    No companies match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map(tenant => (
                  <tr key={tenant.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-slate-900">{tenant.company_name}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-sm text-slate-500">{tenant.subdomain}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-slate-700">{PLAN_LABELS[tenant.plan] ?? tenant.plan}</span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={tenant.status} />
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-500">{tenant.employee_count} / {tenant.max_employees === 9999 ? "∞" : tenant.max_employees}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-500">
                        {new Date(tenant.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2" ref={openPlanDropdown === tenant.id ? dropdownRef : undefined}>
                        {/* View */}
                        <button
                          onClick={() => setDetailTenant(tenant)}
                          title="View details"
                          className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                        >
                          <Eye className="h-4 w-4" />
                        </button>

                        {/* Change plan */}
                        <div className="relative">
                          <button
                            onClick={() => setOpenPlanDropdown(openPlanDropdown === tenant.id ? null : tenant.id)}
                            title="Change plan"
                            disabled={actionLoading === tenant.id}
                            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Plan <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                          </button>
                          {openPlanDropdown === tenant.id && (
                            <div className="absolute right-0 top-full mt-1 z-50 w-32 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                              {["trial", "starter", "growth", "pro"].map(plan => (
                                <button
                                  key={plan}
                                  onClick={() => void updateTenant(tenant.id, { plan, max_employees: { trial: 10, starter: 25, growth: 100, pro: 9999 }[plan] ?? 25 })}
                                  className={`block w-full px-4 py-2 text-left text-sm hover:bg-slate-50 ${tenant.plan === plan ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700"}`}
                                >
                                  {PLAN_LABELS[plan]}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Suspend / Reactivate */}
                        {tenant.status !== "suspended" ? (
                          <button
                            onClick={() => void updateTenant(tenant.id, { status: "suspended" })}
                            disabled={actionLoading === tenant.id}
                            title="Suspend company"
                            className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100 disabled:opacity-50"
                          >
                            <AlertTriangle className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => void updateTenant(tenant.id, { status: "active" })}
                            disabled={actionLoading === tenant.id}
                            title="Reactivate company"
                            className="rounded-lg border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
