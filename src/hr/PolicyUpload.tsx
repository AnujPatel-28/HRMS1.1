import { useCallback, useEffect, useState } from "react";
import { Upload, FileText, Trash2, X, Eye } from "lucide-react";
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

export default function PolicyUpload() {
  const { employee: hrEmployee } = useEmployee();
  const { tenantId } = useTenant();
  const { logAction } = useAuditLog();
  const [policies, setPolicies] = useState<HRPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<HRPolicy["visible_to"]>("all");
  const [department, setDepartment] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { success, error: toastError } = useToast();
  const [deletePolicyItem, setDeletePolicyItem] = useState<HRPolicy | null>(null);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: fetchErr } = await db.from("hr_policies").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
      if (fetchErr) throw fetchErr;
      if (data) setPolicies(data as HRPolicy[]);
    } catch (err) {
      toastError("Failed to fetch policies.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toastError]);

  useEffect(() => {
    void fetchPolicies();
  }, [fetchPolicies]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title || !hrEmployee) return;

    setUploading(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
      const filePath = `policies/${fileName}`;

      // Upload to Storage
      const { error: uploadError } = await storage.from("hr-policies").upload(filePath, file);
      if (uploadError) throw uploadError;

      const publicUrl = storage.from("hr-policies").getPublicUrl(filePath);

      // Insert into DB
      const { data: inserted, error: insertError } = await db.from("hr_policies").insert([{
        tenant_id: tenantId,
        title,
        description: description || null,
        file_url: publicUrl,
        file_name: file.name,
        uploaded_by: hrEmployee.id,
        visible_to: visibility,
        department_filter: visibility === "department-specific" ? department : null,
      }]).select("id").single();

      if (insertError) throw insertError;

      // Notify
      const titlePrefix = visibility === "all" ? "New Company Policy:" : `New Policy for ${department}:`;
      const notifType = "new_policy";
      let q = db.from("employees").select("id").eq("tenant_id", tenantId).eq("status", "active");
      if (visibility === "department-specific" && department) {
        q = q.eq("department", department);
      }
      const { data: targets } = await q;

      if (targets && targets.length > 0) {
        await db.from("notifications").insert(
          targets.map(t => ({
            tenant_id: tenantId,
            employee_id: t.id,
            title: "New HR Policy Document",
            body: `${titlePrefix} ${title}`,
            type: notifType
          }))
        );
      }

      void logAction("policy.uploaded", "hr_policy", inserted?.id);

      setFile(null); setTitle(""); setDescription(""); setVisibility("all"); setDepartment("");
      success("Policy uploaded successfully.");
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
      // Extract file path from URL
      const pathParts = deletePolicyItem.file_url.split("/hr-policies/");
      if (pathParts.length > 1) {
        const filePath = pathParts[1];
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

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Policy Management</h2>
        <p className="text-sm text-slate-500">Upload and manage company policies and handbooks.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Upload Form */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm h-fit">
          <h3 className="font-semibold text-slate-800 mb-4">Upload Document</h3>
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Document Title *</label>
              <input value={title} onChange={e => setTitle(e.target.value)} required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Visibility *</label>
              <select value={visibility} onChange={e => setVisibility(e.target.value as any)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring">
                <option value="all">All Employees</option>
                <option value="hr_only">HR Only</option>
                <option value="department-specific">Specific Department</option>
              </select>
            </div>
            {visibility === "department-specific" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Department *</label>
                <select value={department} onChange={e => setDepartment(e.target.value)} required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring">
                  <option value="">Select department</option>
                  {DEPT_OPTIONS.map(d => <option key={d} value={d} className="capitalize">{d}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">File (PDF/DOCX) *</label>
              <div className="flex w-full items-center justify-center">
                <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 py-6 hover:bg-slate-100">
                  <div className="flex flex-col items-center justify-center pb-2 pt-1 text-slate-500">
                    <Upload className="mb-2 h-6 w-6 text-slate-400" />
                    <p className="text-xs font-semibold">{file ? file.name : "Click to upload file"}</p>
                  </div>
                  <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={e => setFile(e.target.files?.[0] || null)} required />
                </label>
              </div>
            </div>
            <button type="submit" disabled={uploading}
              className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {uploading ? "Uploading..." : "Upload Policy"}
            </button>
          </form>
        </div>

        {/* Policy List */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="font-semibold text-slate-800">Policy Library</h3>
          </div>
          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3">Title</th>
                  <th className="px-5 py-3">Visibility</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i}>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-full" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-16" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-24" /></td>
                      <td className="px-5 py-3 flex justify-end"><Skeleton className="h-8 w-16" /></td>
                    </tr>
                  ))
                ) : policies.length === 0 ? (
                  <tr><td colSpan={4} className="p-10"><EmptyState icon={FileText} title="No policies uploaded" description="Upload a document to add it to the library." /></td></tr>
                ) : policies.map(policy => (
                  <tr key={policy.id} className="hover:bg-slate-50 transition">
                    <td className="px-5 py-3 align-top">
                      <p className="font-medium text-slate-900 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-brand-600" />
                        {policy.title}
                      </p>
                      {policy.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{policy.description}</p>}
                    </td>
                    <td className="px-5 py-3 align-top capitalize text-slate-600">
                      {policy.visible_to === "department-specific" ? `Dept: ${policy.department_filter}` : policy.visible_to.replace("_", " ")}
                    </td>
                    <td className="px-5 py-3 align-top text-slate-500 text-xs">
                      {new Date(policy.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 align-top text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setPreviewUrl(policy.file_url)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                          <Eye className="h-3.5 w-3.5" /> View
                        </button>
                        <a href={policy.file_url} download={policy.file_name || "policy"} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
                          Download
                        </a>
                        <button onClick={() => setDeletePolicyItem(policy)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              <iframe src={previewUrl} className="h-full w-full border-none" title="PDF Preview" />
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
