import { useCallback, useEffect, useState } from "react";
import { Upload, FileText, Trash2, X, Eye, Search, ChevronLeft, ChevronRight, CheckSquare } from "lucide-react";
import type { HRPolicy } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db, storage } from "../insforge/client";
import { useAuditLog } from "../hooks/useAuditLog";
import { useEmployee } from "../hooks/useEmployee";
import { useToast } from "../shared/ToastContext";
import { ConfirmModal } from "../shared/ConfirmModal";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";

const DEPT_OPTIONS = ["sales", "dev", "marketing", "operations", "design", "other"] as const;

function extractPathFromUrl(url: string): string {
  if (!url) return "";
  const objectsParts = url.split("/objects/");
  if (objectsParts.length > 1) {
    return decodeURIComponent(objectsParts[1]);
  }
  const pathParts = url.split("/hr-policies/");
  if (pathParts.length > 1) {
    return pathParts[1];
  }
  return "";
}

export default function PolicyUpload() {
  const { employee: hrEmployee } = useEmployee();
  const { tenantId } = useTenant();
  const { logAction } = useAuditLog();
  const [policies, setPolicies] = useState<HRPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  // Form fields state
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<HRPolicy["visible_to"]>("all");
  const [department, setDepartment] = useState("");
  const [selectedOrgUnitId, setSelectedOrgUnitId] = useState("");
  const [orgUnits, setOrgUnits] = useState<{ id: string; name: string }[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { success, error: toastError } = useToast();
  const [deletePolicyItem, setDeletePolicyItem] = useState<HRPolicy | null>(null);

  // Pagination & Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterVisibility, setFilterVisibility] = useState("all_types");
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [totalCount, setTotalCount] = useState(0);

  // Versioning state
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [requiresAck, setRequiresAck] = useState(false);
  const [supersedingPolicy, setSupersedingPolicy] = useState<HRPolicy | null>(null);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: fetchErr } = await db.rpc("get_hr_policy_library", {
        p_search: searchQuery || null,
        p_visibility: filterVisibility === "all_types" ? null : filterVisibility,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize
      });
      if (fetchErr) throw fetchErr;
      if (data) {
        setPolicies(data as HRPolicy[]);
        setTotalCount(data[0]?.total_count ? Number(data[0].total_count) : 0);
      } else {
        setPolicies([]);
        setTotalCount(0);
      }
    } catch (err) {
      toastError("Failed to fetch policies.");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterVisibility, page, toastError]);

  const fetchOrgUnits = useCallback(async () => {
    try {
      const { data, error } = await db
        .from("org_units")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      if (data) setOrgUnits(data);
    } catch (err) {
      console.error("Failed to fetch org units:", err);
    }
  }, [tenantId]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, filterVisibility]);

  useEffect(() => {
    void fetchPolicies();
  }, [fetchPolicies]);

  useEffect(() => {
    void fetchOrgUnits();
  }, [fetchOrgUnits]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title || !hrEmployee) return;

    setUploading(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
      const filePath = `policies/${fileName}`;

      const { data: uploadData, error: uploadError } = await storage.from("hr-policies").upload(filePath, file);
      if (uploadError) throw uploadError;
      const publicUrl = uploadData?.url ?? "";

      const useOrgUnit = visibility === "department-specific" && orgUnits.length > 0;
      const nextVersionNumber = supersedingPolicy ? supersedingPolicy.version_number + 1 : 1;

      // Insert into DB
      const { data: inserted, error: insertError } = await db.from("hr_policies").insert([{
        tenant_id: tenantId,
        title,
        description: description || null,
        file_url: publicUrl,
        file_name: file.name,
        uploaded_by: hrEmployee.id,
        visible_to: visibility,
        department_filter: (visibility === "department-specific" && !useOrgUnit) ? department : null,
        org_unit_id: useOrgUnit ? selectedOrgUnitId : null,
        storage_path: filePath,
        version_number: nextVersionNumber,
        effective_date: effectiveDate || null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        requires_acknowledgement: requiresAck,
        supersedes_policy_id: supersedingPolicy ? supersedingPolicy.id : null
      }]).select("id").single();

      if (insertError) {
        await storage.from("hr-policies").remove(filePath);
        throw insertError;
      }

      // If there was a superseded policy, set its expires_at to now() to mark it as expired/superseded
      if (supersedingPolicy) {
        await db.from("hr_policies")
          .update({ expires_at: new Date().toISOString() })
          .eq("id", supersedingPolicy.id);
      }

      // Server-side fan-out notifications RPC
      const { error: notifError } = await db.rpc("create_policy_notifications_transaction", {
        p_policy_id: inserted.id
      });
      if (notifError) {
        console.error("Failed to generate policy notifications:", notifError);
      }

      void logAction("policy.uploaded", "hr_policy", inserted?.id);

      setFile(null); 
      setTitle(""); 
      setDescription(""); 
      setVisibility("all"); 
      setDepartment(""); 
      setSelectedOrgUnitId("");
      setEffectiveDate("");
      setExpiresAt("");
      setRequiresAck(false);
      setSupersedingPolicy(null);
      
      success(supersedingPolicy ? "New version uploaded successfully." : "Policy uploaded successfully.");
      void fetchPolicies();
    } catch (err) {
      console.error("Upload error", err);
      toastError("Failed to upload policy.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeletePolicy() {
    if (!deletePolicyItem) return;
    try {
      const filePath = deletePolicyItem.storage_path || extractPathFromUrl(deletePolicyItem.file_url);
      if (filePath) {
        await storage.from("hr-policies").remove(filePath);
      }
      await db.from("hr_policies").delete().eq("tenant_id", tenantId).eq("id", deletePolicyItem.id);
      void logAction("policy.deleted", "hr_policy", deletePolicyItem.id);
      success("Policy deleted.");
      setDeletePolicyItem(null);
      void fetchPolicies();
    } catch (err) {
      console.error("Delete error", err);
      toastError("Failed to delete policy.");
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Policy Management</h2>
        <p className="text-sm text-slate-500">Upload and manage company policies, versions, and employee acknowledgements.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Upload Form */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm h-fit">
          <h3 className="font-semibold text-slate-800 mb-4">
            {supersedingPolicy ? `Upload New Version (v${supersedingPolicy.version_number + 1})` : "Upload Document"}
          </h3>

          {supersedingPolicy && (
            <div className="mb-4 rounded-lg bg-brand-50 border border-brand-200 p-3 text-xs text-brand-800 flex items-center justify-between">
              <span>
                <strong>Updating:</strong> "{supersedingPolicy.title}" (v{supersedingPolicy.version_number})
              </span>
              <button 
                type="button" 
                onClick={() => {
                  setSupersedingPolicy(null);
                  setTitle("");
                  setDescription("");
                  setVisibility("all");
                  setDepartment("");
                  setSelectedOrgUnitId("");
                  setEffectiveDate("");
                  setExpiresAt("");
                  setRequiresAck(false);
                }} 
                className="text-brand-600 hover:text-brand-800 font-semibold underline ml-2"
              >
                Cancel
              </button>
            </div>
          )}

          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Document Title *</label>
              <input 
                value={title} 
                onChange={e => setTitle(e.target.value)} 
                required
                disabled={!!supersedingPolicy}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring disabled:bg-slate-50 disabled:text-slate-500" 
              />
            </div>
            
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Description</label>
              <textarea 
                value={description} 
                onChange={e => setDescription(e.target.value)} 
                rows={2}
                disabled={!!supersedingPolicy}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring disabled:bg-slate-50 disabled:text-slate-500" 
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Visibility *</label>
              <select 
                value={visibility} 
                onChange={e => setVisibility(e.target.value as any)}
                disabled={!!supersedingPolicy}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="all">All Employees</option>
                <option value="hr_only">HR Only</option>
                <option value="department-specific">Specific Org Unit</option>
              </select>
            </div>

            {visibility === "department-specific" && (
              <div>
                {orgUnits.length > 0 ? (
                  <>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Target Org Unit *</label>
                    <select 
                      value={selectedOrgUnitId} 
                      onChange={e => setSelectedOrgUnitId(e.target.value)} 
                      required
                      disabled={!!supersedingPolicy}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring disabled:bg-slate-50 disabled:text-slate-500"
                    >
                      <option value="">Select Org Unit</option>
                      {orgUnits.map(ou => <option key={ou.id} value={ou.id}>{ou.name}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Department (Legacy Fallback) *</label>
                    <select 
                      value={department} 
                      onChange={e => setDepartment(e.target.value)} 
                      required
                      disabled={!!supersedingPolicy}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring disabled:bg-slate-50 disabled:text-slate-500"
                    >
                      <option value="">Select department</option>
                      {DEPT_OPTIONS.map(d => <option key={d} value={d} className="capitalize">{d}</option>)}
                    </select>
                  </>
                )}
              </div>
            )}

            {/* P5: Governance Fields */}
            <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Effective Date</label>
                <input 
                  type="date"
                  value={effectiveDate}
                  onChange={e => setEffectiveDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none ring-brand-600 focus:ring"
                />
              </div>
              
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Expiration Date</label>
                <input 
                  type="date"
                  value={expiresAt}
                  onChange={e => setExpiresAt(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none ring-brand-600 focus:ring"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 py-2 border-b border-slate-100">
              <input 
                type="checkbox" 
                id="requiresAck"
                checked={requiresAck}
                onChange={e => setRequiresAck(e.target.checked)}
                className="h-4 w-4 rounded text-brand-600 border-slate-300 focus:ring-brand-500"
              />
              <label htmlFor="requiresAck" className="text-xs font-semibold text-slate-700 cursor-pointer select-none">
                Requires Employee Acknowledgement
              </label>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">File (PDF/DOCX) *</label>
              <div className="flex w-full items-center justify-center">
                <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 py-6 hover:bg-slate-100">
                  <div className="flex flex-col items-center justify-center pb-2 pt-1 text-slate-500">
                    <Upload className="mb-2 h-6 w-6 text-slate-400" />
                    <p className="text-xs font-semibold">{file ? file.name : "Click to upload file"}</p>
                  </div>
                  <input 
                    type="file" 
                    className="hidden" 
                    accept=".pdf,.doc,.docx" 
                    onChange={e => setFile(e.target.files?.[0] || null)} 
                    required 
                  />
                </label>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={uploading}
              className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {uploading ? "Uploading..." : supersedingPolicy ? "Upload New Version" : "Upload Policy"}
            </button>
          </form>
        </div>

        {/* Policy Library with Pagination and Search */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
          {/* Search and Filters */}
          <div className="border-b border-slate-200 px-5 py-4 bg-slate-50/50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="font-semibold text-slate-800 shrink-0">Policy Library</h3>
            <div className="flex flex-col sm:flex-row gap-2 w-full max-w-md sm:justify-end">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <input 
                  type="text"
                  placeholder="Search by title..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs outline-none focus:border-brand-500"
                />
              </div>
              <select 
                value={filterVisibility}
                onChange={e => setFilterVisibility(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
              >
                <option value="all_types">All Visibilities</option>
                <option value="all">All Employees</option>
                <option value="hr_only">HR Only</option>
                <option value="department-specific">Specific Org Unit</option>
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3">Title & Version</th>
                  <th className="px-5 py-3">Visibility</th>
                  <th className="px-5 py-3">Governance / Ack</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  [...Array(pageSize)].map((_, i) => (
                    <tr key={i}>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-full" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-16" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-24" /></td>
                      <td className="px-5 py-3 flex justify-end"><Skeleton className="h-8 w-16" /></td>
                    </tr>
                  ))
                ) : policies.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-10">
                      <EmptyState 
                        icon={FileText} 
                        title="No policies found" 
                        description="Try modifying your search or upload a new policy." 
                      />
                    </td>
                  </tr>
                ) : policies.map(policy => {
                  const isExpired = policy.expires_at ? new Date(policy.expires_at) < new Date() : false;
                  return (
                    <tr key={policy.id} className={`hover:bg-slate-50 transition ${isExpired ? "opacity-70 bg-slate-50/30" : ""}`}>
                      <td className="px-5 py-3 align-top">
                        <div className="font-medium text-slate-900 flex items-start gap-2">
                          <FileText className="h-4 w-4 text-brand-600 mt-0.5 shrink-0" />
                          <div>
                            <span className="break-all">{policy.title}</span>
                            <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                              v{policy.version_number}
                            </span>
                            {isExpired && (
                              <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                Expired
                              </span>
                            )}
                          </div>
                        </div>
                        {policy.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{policy.description}</p>}
                      </td>
                      
                      <td className="px-5 py-3 align-top capitalize text-slate-600 text-xs">
                        {policy.visible_to === "department-specific" ? (
                          policy.org_unit_name ? `Org: ${policy.org_unit_name}` : `Dept: ${policy.department_filter}`
                        ) : (
                          policy.visible_to.replace("_", " ")
                        )}
                      </td>
                      
                      <td className="px-5 py-3 align-top text-xs space-y-1">
                        {policy.requires_acknowledgement ? (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700">
                              <CheckSquare className="h-3 w-3" /> Ack Req
                            </span>
                            <span className="text-slate-500 font-semibold">
                              {policy.acknowledged_count ?? 0} / {policy.total_targeted ?? 0}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">No Ack Required</span>
                        )}
                        
                        {(policy.effective_date || policy.expires_at) && (
                          <div className="text-[10px] text-slate-400 space-y-0.5">
                            {policy.effective_date && (
                              <div>Eff: {new Date(policy.effective_date).toLocaleDateString()}</div>
                            )}
                            {policy.expires_at && (
                              <div>Exp: {new Date(policy.expires_at).toLocaleDateString()}</div>
                            )}
                          </div>
                        )}
                      </td>
                      
                      <td className="px-5 py-3 align-top text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button 
                            onClick={() => setPreviewUrl(policy.file_url)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                          >
                            <Eye className="h-3.5 w-3.5" /> View
                          </button>
                          
                          <button 
                            onClick={() => {
                              setSupersedingPolicy(policy);
                              setTitle(policy.title);
                              setDescription(policy.description || "");
                              setVisibility(policy.visible_to);
                              if (policy.visible_to === "department-specific") {
                                if (policy.org_unit_id) {
                                  setSelectedOrgUnitId(policy.org_unit_id);
                                } else {
                                  setDepartment(policy.department_filter || "");
                                }
                              }
                              setRequiresAck(policy.requires_acknowledgement);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-brand-200 px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
                          >
                            New Version
                          </button>

                          <button 
                            onClick={() => setDeletePolicyItem(policy)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="border-t border-slate-200 px-5 py-3 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
              <div>
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount} policies
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1 rounded border border-slate-200 hover:bg-slate-100 disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="font-semibold text-slate-700">Page {page} of {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1 rounded border border-slate-200 hover:bg-slate-100 disabled:opacity-50"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* PDF Preview Modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreviewUrl(null)}>
          <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 bg-slate-50">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2"><FileText className="h-4 w-4" /> Document Preview</h3>
              <button onClick={() => setPreviewUrl(null)} className="rounded-lg p-1.5 hover:bg-slate-200"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 bg-slate-100 relative">
              <iframe 
                src={`https://docs.google.com/viewer?url=${encodeURIComponent(previewUrl)}&embedded=true`} 
                className="h-full w-full border-none" 
                title="Document Preview" 
              />
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deletePolicyItem}
        onClose={() => setDeletePolicyItem(null)}
        onConfirm={handleDeletePolicy}
        title="Delete Policy"
        message={`Are you sure you want to delete "${deletePolicyItem?.title}" permanently?`}
        confirmText="Delete"
        confirmColor="red"
      />
    </section>
  );
}
