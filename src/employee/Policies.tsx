import { useCallback, useEffect, useState } from "react";
import { FileText, Eye, X, Search, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle } from "lucide-react";
import type { EmployeeVisibleHRPolicy } from "../types";
import { db } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";

export default function Policies() {
  const { employee } = useEmployee();
  const { tenantId } = useTenant();
  const [policies, setPolicies] = useState<EmployeeVisibleHRPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  // Search & Pagination states
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 4; // grid of 2x2
  const [totalCount, setTotalCount] = useState(0);

  const { success, error } = useToast();

  const fetchPolicies = useCallback(async () => {
    if (!employee?.id || !tenantId) return;
    setLoading(true);
    try {
      const { data, error: fetchErr } = await db.rpc("get_employee_visible_hr_policies", {
        p_search: searchQuery || null,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize
      });

      if (fetchErr) throw fetchErr;

      if (data) {
        setPolicies(data as EmployeeVisibleHRPolicy[]);
        setTotalCount(data[0]?.total_count ? Number(data[0].total_count) : 0);
      } else {
        setPolicies([]);
        setTotalCount(0);
      }
    } catch (err) {
      error("Failed to load policies.");
    } finally {
      setLoading(false);
    }
  }, [employee?.id, tenantId, searchQuery, page, error]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  useEffect(() => {
    void fetchPolicies();
  }, [fetchPolicies]);

  async function handleAcknowledge(policyId: string) {
    setAcknowledgingId(policyId);
    try {
      const { error: ackErr } = await db.rpc("acknowledge_policy_transaction", {
        p_policy_id: policyId
      });
      if (ackErr) throw ackErr;

      success("Policy acknowledged successfully.");
      void fetchPolicies();
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes("already acknowledged")) {
        error("Policy has already been acknowledged.");
      } else {
        error("Failed to acknowledge policy.");
      }
    } finally {
      setAcknowledgingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <section className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Company Policies</h2>
          <p className="text-sm text-slate-500">HR documents and policies relevant to you.</p>
        </div>
        
        {/* Search Input */}
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input 
            type="text"
            placeholder="Search policies by title..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(pageSize)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
        </div>
      ) : policies.length === 0 ? (
        <EmptyState icon={FileText} title="No policies found" description="There are no policy documents matching your criteria." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {policies.map(policy => {
            const isExpired = policy.expires_at ? new Date(policy.expires_at) < new Date() : false;
            return (
              <div 
                key={policy.id} 
                className={`flex flex-col justify-between gap-3 rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition ${
                  isExpired ? "border-slate-100 opacity-75" : "border-slate-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-100">
                    <FileText className="h-5 w-5 text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="font-semibold text-slate-900 leading-tight break-all">{policy.title}</h3>
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600">
                        v{policy.version_number}
                      </span>
                      {isExpired ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-800">
                          Expired
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold text-emerald-800">
                          Current
                        </span>
                      )}
                    </div>
                    {policy.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{policy.description}</p>
                    )}
                    
                    {policy.effective_date && (
                      <p className="text-[10px] text-slate-400 mt-1 font-medium">
                        Effective: {new Date(policy.effective_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>

                {/* Acknowledgement Status Panel */}
                {policy.requires_acknowledgement && (
                  <div className="rounded-xl border p-3 mt-1 text-xs bg-slate-50 border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    {policy.acknowledged_at ? (
                      <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Acknowledged on {new Date(policy.acknowledged_at).toLocaleDateString()}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 text-amber-700 font-semibold">
                          <AlertCircle className="h-4 w-4" />
                          <span>Acknowledgement Required</span>
                        </div>
                        <button
                          onClick={() => void handleAcknowledge(policy.id)}
                          disabled={acknowledgingId === policy.id || isExpired}
                          className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                        >
                          {acknowledgingId === policy.id ? "Acknowledging..." : "Acknowledge"}
                        </button>
                      </>
                    )}
                  </div>
                )}

                <div className="flex gap-2 pt-2 border-t border-slate-100">
                  <button 
                    onClick={() => setPreviewUrl(policy.file_url)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 border border-brand-200 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 transition"
                  >
                    <Eye className="h-3.5 w-3.5" /> View
                  </button>
                  <a 
                    href={policy.file_url} 
                    download={policy.file_name || "policy"} 
                    target="_blank" 
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                  >
                    Download
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500 pt-3 border-t border-slate-200">
          <div>
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount} policies
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded border border-slate-200 hover:bg-slate-100 disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-semibold text-slate-700">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded border border-slate-200 hover:bg-slate-100 disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* PDF Preview Modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreviewUrl(null)}>
          <div className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <FileText className="h-4 w-4 text-brand-600" /> Document Preview
              </h3>
              <button onClick={() => setPreviewUrl(null)} className="rounded-lg p-1.5 hover:bg-slate-200 transition"><X className="h-5 w-5 text-slate-500" /></button>
            </div>
            <div className="flex-1 bg-slate-100 relative">
              <iframe 
                src={`https://docs.google.com/viewer?url=${encodeURIComponent(previewUrl)}&embedded=true`} 
                className="h-full w-full border-none" 
                title="Policy Preview" 
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
