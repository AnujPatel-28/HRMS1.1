import { useCallback, useEffect, useState } from "react";
import { FileText, Eye, X } from "lucide-react";
import type { HRPolicy } from "../types";
import { db } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";

export default function Policies() {
  const { employee } = useEmployee();
  const { tenantId } = useTenant();
  const [policies, setPolicies] = useState<HRPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { error } = useToast();

  const fetchPolicies = useCallback(async () => {
    if (!employee?.id || !tenantId) return;
    try {
      // Fetch policies visible to this employee: 'all' or their department
      const { data, error: fetchErr } = await db.from("hr_policies").select("*")
        .eq("tenant_id", tenantId)
        .in("visible_to", ["all", ...(employee.department ? ["department-specific"] : [])])
        .order("created_at", { ascending: false });

      if (fetchErr) throw fetchErr;

      // Filter department-specific to only match this employee's dept
      const filtered = (data ?? []).filter((p: HRPolicy) => {
        if (p.visible_to === "all") return true;
        if (p.visible_to === "department-specific") return p.department_filter === employee.department;
        return false;
      });
      setPolicies(filtered as HRPolicy[]);
    } catch (err) {
      error("Failed to load policies.");
    } finally {
      setLoading(false);
    }
  }, [employee?.id, employee?.department, tenantId, error]);

  useEffect(() => { void fetchPolicies(); }, [fetchPolicies]);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Company Policies</h2>
        <p className="text-sm text-slate-500">HR documents and policies relevant to you.</p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
        </div>
      ) : policies.length === 0 ? (
        <EmptyState icon={FileText} title="No policies uploaded yet" description="HR hasn't uploaded any documents relevant to you." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {policies.map(policy => (
            <div key={policy.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-100">
                  <FileText className="h-5 w-5 text-brand-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-900 leading-tight">{policy.title}</h3>
                  {policy.description && (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{policy.description}</p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1 font-medium">
                    Uploaded {new Date(policy.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-1 border-t border-slate-100">
                <button onClick={() => setPreviewUrl(policy.file_url)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 border border-brand-200 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 transition">
                  <Eye className="h-3.5 w-3.5" /> View
                </button>
                <a href={policy.file_url} download={policy.file_name || "policy"} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
                  Download
                </a>
              </div>
            </div>
          ))}
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
              <button onClick={() => setPreviewUrl(null)} className="rounded-lg p-1.5 hover:bg-slate-200 transition">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <div className="flex-1 bg-slate-100">
              <iframe src={previewUrl} className="h-full w-full border-none" title="Policy Preview" />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
