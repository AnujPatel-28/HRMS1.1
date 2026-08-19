import React, { useCallback, useEffect, useState } from "react";
import { 
  Shield, Plus, Search, Edit2, Trash2, Download, Bell, 
  X, Upload, FileText, ChevronDown, ChevronUp, User, RefreshCw
} from "lucide-react";
import { db, storage } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import { useAuditLog } from "../hooks/useAuditLog";
import { ConfirmModal } from "../shared/ConfirmModal";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { SelectDropdown } from "../shared/components/SelectDropdown";
import Papa from "papaparse";

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
  status: string;
  email: string;
}

interface InsurancePolicy {
  id: string;
  tenant_id: string;
  employee_id: string;
  insurer_name: string;
  policy_number: string;
  policy_type: "Health" | "Life" | "Accident" | "Dental" | "Vision" | "Group";
  coverage_amount: number;
  premium_amount: number;
  premium_frequency: "Monthly" | "Quarterly" | "Annual";
  start_date: string;
  expiry_date: string;
  status: "Active" | "Expired" | "Cancelled";
  rm_name: string | null;
  rm_phone: string | null;
  rm_email: string | null;
  rm_company: string | null;
  notes: string | null;
  policy_document_url: string | null;
  created_at: string;
  employee?: Employee;
}

const POLICY_TYPES = ["Health", "Life", "Accident", "Dental", "Vision", "Group"] as const;
const STATUS_OPTIONS = ["Active", "Expired", "Cancelled"] as const;
const FREQUENCY_OPTIONS = ["Monthly", "Quarterly", "Annual"] as const;

const EMPTY_FORM = {
  employee_id: "",
  policy_type: "Health" as InsurancePolicy["policy_type"],
  insurer_name: "",
  policy_number: "",
  coverage_amount: "",
  premium_amount: "",
  premium_frequency: "Annual" as InsurancePolicy["premium_frequency"],
  start_date: "",
  expiry_date: "",
  status: "Active" as InsurancePolicy["status"],
  rm_name: "",
  rm_phone: "",
  rm_email: "",
  rm_company: "",
  notes: ""
};

export default function HRInsurance() {
  const { tenantId } = useTenant();
  const { success, error: toastError } = useToast();
  const { logAction } = useAuditLog();

  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedEmpFilter, setSelectedEmpFilter] = useState("all");
  const [selectedTypeFilter, setSelectedTypeFilter] = useState("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("all");

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<InsurancePolicy | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [rmCollapsed, setRmCollapsed] = useState(true);

  // Confirm Delete Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [policyToDelete, setPolicyToDelete] = useState<InsurancePolicy | null>(null);

  // Fetch all active employees for selection
  useEffect(() => {
    if (!tenantId) return;
    db.from("employees")
      .select("id, full_name, employee_code, status, email")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("full_name")
      .then(({ data, error }) => {
        if (!error && data) {
          setEmployees(data as Employee[]);
        }
      });
  }, [tenantId]);

  // Fetch policies
  const fetchPolicies = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await db
        .from("insurance_policies")
        .select("*, employee:employees(id, full_name, employee_code, status, email)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (data) {
        setPolicies(data as InsurancePolicy[]);
      }
    } catch (err) {
      console.error(err);
      toastError("Failed to fetch insurance policies.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toastError]);

  useEffect(() => {
    void fetchPolicies();
  }, [fetchPolicies]);

  // Open modal for add
  const handleOpenAdd = () => {
    setEditingPolicy(null);
    setForm(EMPTY_FORM);
    setFile(null);
    setRmCollapsed(true);
    setModalOpen(true);
  };

  // Open modal for edit
  const handleOpenEdit = (policy: InsurancePolicy) => {
    setEditingPolicy(policy);
    setForm({
      employee_id: policy.employee_id,
      policy_type: policy.policy_type,
      insurer_name: policy.insurer_name,
      policy_number: policy.policy_number,
      coverage_amount: String(policy.coverage_amount),
      premium_amount: String(policy.premium_amount),
      premium_frequency: policy.premium_frequency,
      start_date: policy.start_date,
      expiry_date: policy.expiry_date,
      status: policy.status,
      rm_name: policy.rm_name || "",
      rm_phone: policy.rm_phone || "",
      rm_email: policy.rm_email || "",
      rm_company: policy.rm_company || "",
      notes: policy.notes || ""
    });
    setFile(null);
    // Expand RM section if any RM field is present
    const hasRmDetails = !!(policy.rm_name || policy.rm_phone || policy.rm_email || policy.rm_company);
    setRmCollapsed(!hasRmDetails);
    setModalOpen(true);
  };

  // Handle Form Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employee_id || !form.insurer_name || !form.policy_number || !form.coverage_amount || !form.premium_amount || !form.start_date || !form.expiry_date) {
      toastError("Please fill out all required fields.");
      return;
    }

    setSubmitting(true);
    try {
      let documentUrl = editingPolicy?.policy_document_url || null;

      // Handle file upload if a new file is selected
      if (file) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
        const filePath = `${tenantId}/${form.employee_id}/${fileName}`;

        const { data: uploadData, error: uploadError } = await storage
          .from("insurance-documents")
          .upload(filePath, file);

        if (uploadError) throw uploadError;
        documentUrl = uploadData?.url ?? null;
      }

      const policyPayload = {
        tenant_id: tenantId,
        employee_id: form.employee_id,
        policy_type: form.policy_type,
        insurer_name: form.insurer_name,
        policy_number: form.policy_number,
        coverage_amount: parseFloat(form.coverage_amount),
        premium_amount: parseFloat(form.premium_amount),
        premium_frequency: form.premium_frequency,
        start_date: form.start_date,
        expiry_date: form.expiry_date,
        status: form.status,
        rm_name: form.rm_name || null,
        rm_phone: form.rm_phone || null,
        rm_email: form.rm_email || null,
        rm_company: form.rm_company || null,
        notes: form.notes || null,
        policy_document_url: documentUrl
      };

      if (editingPolicy) {
        // Update
        const { error } = await db
          .from("insurance_policies")
          .update(policyPayload)
          .eq("tenant_id", tenantId)
          .eq("id", editingPolicy.id);

        if (error) throw error;
        void logAction("insurance.updated", "insurance_policy", editingPolicy.id);
        success("Insurance policy updated successfully.");
      } else {
        // Insert
        const { data, error } = await db
          .from("insurance_policies")
          .insert([policyPayload])
          .select("id")
          .single();

        if (error) throw error;
        void logAction("insurance.created", "insurance_policy", data?.id);
        success("Insurance policy added successfully.");
      }

      setModalOpen(false);
      void fetchPolicies();
    } catch (err: any) {
      console.error(err);
      toastError(err.message || "Failed to save insurance policy.");
    } finally {
      setSubmitting(false);
    }
  };

  // Open Delete Confirmation
  const handleOpenDelete = (policy: InsurancePolicy) => {
    setPolicyToDelete(policy);
    setDeleteModalOpen(true);
  };

  // Execute Delete
  const handleDelete = async () => {
    if (!policyToDelete) return;
    try {
      // Remove file from storage if it exists
      if (policyToDelete.policy_document_url) {
        const pathParts = policyToDelete.policy_document_url.split("/insurance-documents/");
        if (pathParts.length > 1) {
          const filePath = decodeURIComponent(pathParts[1]);
          await storage.from("insurance-documents").remove(filePath);
        }
      }

      const { error } = await db
        .from("insurance_policies")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", policyToDelete.id);

      if (error) throw error;

      void logAction("insurance.deleted", "insurance_policy", policyToDelete.id);
      success("Insurance policy removed successfully.");
      setDeleteModalOpen(false);
      setPolicyToDelete(null);
      void fetchPolicies();
    } catch (err) {
      console.error(err);
      toastError("Failed to delete policy.");
    }
  };

  // Download policy document
  const handleDownloadDoc = async (policy: InsurancePolicy) => {
    if (!policy.policy_document_url) return;
    try {
      const pathParts = policy.policy_document_url.split("/insurance-documents/");
      const filePath = pathParts.length > 1 ? decodeURIComponent(pathParts[1]) : policy.policy_document_url;

      const { data: blob, error } = await storage
        .from("insurance-documents")
        .download(filePath);

      if (error || !blob) throw error || new Error("Document not found");

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `policy_${policy.policy_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error(err);
      toastError("Failed to download policy document.");
    }
  };

  // Notify Employee manually
  const handleNotifyEmployee = async (policy: InsurancePolicy) => {
    try {
      const { error } = await db.from("notifications").insert([
        {
          tenant_id: tenantId,
          employee_id: policy.employee_id,
          title: "Insurance Update",
          body: `Your ${policy.policy_type} insurance policy with ${policy.insurer_name} has been updated. Please review your coverage details.`,
          type: "general"
        }
      ]);

      if (error) throw error;
      success(`Notification sent to ${policy.employee?.full_name || "employee"}.`);
    } catch (err) {
      console.error(err);
      toastError("Failed to notify employee.");
    }
  };

  // Check if policy is expiring in 30 days
  const getPolicyExpiryStatus = (expiryDateStr: string, status: string) => {
    if (status.toLowerCase() === "cancelled" || status.toLowerCase() === "expired") {
      return "expired";
    }
    const expiry = new Date(expiryDateStr);
    const today = new Date();
    expiry.setHours(0,0,0,0);
    today.setHours(0,0,0,0);

    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return "expired";
    if (diffDays <= 30) return "expiring_soon";
    return "active";
  };

  // Selection Checkboxes
  const handleSelectRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleSelectAll = (filteredList: InsurancePolicy[]) => {
    if (selectedIds.size === filteredList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredList.map(p => p.id)));
    }
  };

  // Export to CSV
  const handleBulkExport = () => {
    const listToExport = policies.filter(p => selectedIds.has(p.id));
    if (listToExport.length === 0) {
      toastError("Please select at least one policy to export.");
      return;
    }

    const exportData = listToExport.map(p => ({
      "Employee Name": p.employee?.full_name || "Unknown",
      "Employee Code": p.employee?.employee_code || "",
      "Policy Type": p.policy_type,
      "Insurer Name": p.insurer_name,
      "Policy Number": p.policy_number,
      "Coverage Amount (₹)": p.coverage_amount,
      "Premium Amount (₹)": p.premium_amount,
      "Premium Frequency": p.premium_frequency,
      "Start Date": p.start_date,
      "Expiry Date": p.expiry_date,
      "Status": p.status,
      "RM Name": p.rm_name || "",
      "RM Phone": p.rm_phone || "",
      "RM Email": p.rm_email || "",
      "RM Company": p.rm_company || "",
      "Internal Notes": p.notes || ""
    }));

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `insurance_policies_export_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    success(`Successfully exported ${listToExport.length} policies to CSV.`);
  };

  // Filtered Policies
  const filteredPolicies = policies.filter(p => {
    const empMatch = selectedEmpFilter === "all" || p.employee_id === selectedEmpFilter;
    const typeMatch = selectedTypeFilter === "all" || p.policy_type === selectedTypeFilter;
    const statusMatch = selectedStatusFilter === "all" || p.status === selectedStatusFilter;

    const query = searchTerm.toLowerCase();
    const searchMatch = 
      !searchTerm ||
      p.employee?.full_name.toLowerCase().includes(query) ||
      p.insurer_name.toLowerCase().includes(query) ||
      p.policy_number.toLowerCase().includes(query);

    return empMatch && typeMatch && statusMatch && searchMatch;
  });

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Shield className="h-7 w-7 text-brand-600 animate-pulse" />
            Insurance Management
          </h2>
          <p className="text-sm text-slate-500">Record employee policies, upload certificates, and manage claims relationship contacts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={handleBulkExport}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
            >
              <Download className="h-4 w-4" /> Export CSV ({selectedIds.size})
            </button>
          )}
          <button
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" /> Add Policy
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search employee, insurer, policy number..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 pl-10 pr-4 py-2 text-sm outline-none ring-brand-600 focus:ring focus:border-brand-500 focus:bg-white transition"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Employee Filter */}
          <SelectDropdown
            value={selectedEmpFilter}
            onChange={setSelectedEmpFilter}
            options={[
              { value: "all", label: "All Employees" },
              ...employees.map(e => ({ value: e.id, label: e.full_name }))
            ]}
            searchable
            containerClassName="min-w-[160px] flex-1 sm:flex-initial"
            triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />

          {/* Policy Type Filter */}
          <SelectDropdown
            value={selectedTypeFilter}
            onChange={setSelectedTypeFilter}
            options={[
              { value: "all", label: "All Policy Types" },
              ...POLICY_TYPES.map(t => ({ value: t, label: t }))
            ]}
            containerClassName="min-w-[150px] flex-1 sm:flex-initial"
            triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />

          {/* Status Filter */}
          <SelectDropdown
            value={selectedStatusFilter}
            onChange={setSelectedStatusFilter}
            options={[
              { value: "all", label: "All Statuses" },
              ...STATUS_OPTIONS.map(s => ({ value: s, label: s }))
            ]}
            containerClassName="min-w-[130px] flex-1 sm:flex-initial"
            triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />

          {/* Reset Filters */}
          {(searchTerm || selectedEmpFilter !== "all" || selectedTypeFilter !== "all" || selectedStatusFilter !== "all") && (
            <button
              onClick={() => {
                setSearchTerm("");
                setSelectedEmpFilter("all");
                setSelectedTypeFilter("all");
                setSelectedStatusFilter("all");
              }}
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              title="Reset Filters"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Policies Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-xs uppercase tracking-wide">
              <tr>
                <th className="px-5 py-4 w-10">
                  <input
                    type="checkbox"
                    checked={filteredPolicies.length > 0 && selectedIds.size === filteredPolicies.length}
                    onChange={() => handleSelectAll(filteredPolicies)}
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
                  />
                </th>
                <th className="px-5 py-4">Employee</th>
                <th className="px-5 py-4">Policy Type</th>
                <th className="px-5 py-4">Insurer</th>
                <th className="px-5 py-4">Policy Number</th>
                <th className="px-5 py-4">Coverage</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Expiry Date</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-4" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-28" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4.5 w-16 rounded-full" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-5 py-4 flex justify-end"><Skeleton className="h-8 w-24" /></td>
                  </tr>
                ))
              ) : filteredPolicies.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-10 text-center">
                    <EmptyState 
                      icon={Shield} 
                      title="No Insurance Policies Found" 
                      description={searchTerm || selectedEmpFilter !== "all" || selectedTypeFilter !== "all" || selectedStatusFilter !== "all" ? "No insurance policies match your search filters." : "Create your first employee insurance policy to begin management."} 
                    />
                  </td>
                </tr>
              ) : (
                filteredPolicies.map(policy => {
                  const expiryStatus = getPolicyExpiryStatus(policy.expiry_date, policy.status);
                  
                  // Row highlighting styles based on expiry
                  let rowBg = "hover:bg-slate-50 transition";
                  if (expiryStatus === "expired") {
                    rowBg = "bg-rose-50/40 border-l-4 border-l-rose-500 hover:bg-rose-50 transition";
                  } else if (expiryStatus === "expiring_soon") {
                    rowBg = "bg-amber-50/40 border-l-4 border-l-amber-500 hover:bg-amber-50 transition";
                  }

                  return (
                    <tr key={policy.id} className={rowBg}>
                      <td className="px-5 py-4 align-middle">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(policy.id)}
                          onChange={() => handleSelectRow(policy.id)}
                          className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
                        />
                      </td>
                      <td className="px-5 py-4 align-middle font-medium text-slate-900">
                        <div>
                          <p className="font-semibold text-slate-800">{policy.employee?.full_name || "Unknown employee"}</p>
                          <p className="text-xs text-slate-400">{policy.employee?.employee_code || "No Code"}</p>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle font-medium text-slate-700">{policy.policy_type}</td>
                      <td className="px-5 py-4 align-middle text-slate-600">{policy.insurer_name}</td>
                      <td className="px-5 py-4 align-middle font-mono text-slate-600">{policy.policy_number}</td>
                      <td className="px-5 py-4 align-middle font-semibold text-slate-800">₹{policy.coverage_amount.toLocaleString("en-IN")}</td>
                      <td className="px-5 py-4 align-middle">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm border ${
                          policy.status === "Active" 
                            ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                            : policy.status === "Expired" 
                              ? "bg-rose-50 text-rose-700 border-rose-100" 
                              : "bg-slate-100 text-slate-600 border-slate-200"
                        }`}>
                          {policy.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          expiryStatus === "expired"
                            ? "bg-rose-100 text-rose-800"
                            : expiryStatus === "expiring_soon"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                        }`}>
                          {new Date(policy.expiry_date).toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-middle text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleNotifyEmployee(policy)}
                            className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 hover:text-brand-600 transition"
                            title="Notify Employee"
                          >
                            <Bell className="h-3.5 w-3.5" />
                          </button>
                          {policy.policy_document_url && (
                            <button
                              onClick={() => handleDownloadDoc(policy)}
                              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 hover:text-emerald-600 transition"
                              title="Download Policy Copy"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenEdit(policy)}
                            className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 hover:text-brand-600 transition"
                            title="Edit Policy"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleOpenDelete(policy)}
                            className="rounded-lg border border-rose-200 p-2 text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition"
                            title="Delete Policy"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Policy Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setModalOpen(false)}>
          <div className="flex h-full max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl transition" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5 text-brand-600" />
                {editingPolicy ? "Edit Insurance Policy" : "Add Insurance Policy"}
              </h3>
              <button onClick={() => setModalOpen(false)} className="rounded-lg p-1.5 hover:bg-slate-200 text-slate-500 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Employee Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Employee *</label>
                {editingPolicy ? (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 font-medium">
                    <User className="h-4 w-4 text-slate-400" />
                    <span>{editingPolicy.employee?.full_name} ({editingPolicy.employee?.employee_code})</span>
                  </div>
                ) : (
                  <SelectDropdown
                    value={form.employee_id}
                    onChange={val => setForm({ ...form, employee_id: val })}
                    options={employees.map(e => ({ value: e.id, label: `${e.full_name} (${e.employee_code})` }))}
                    searchable
                    placeholder="Search and select employee..."
                    triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                )}
              </div>

              {/* Policy Fields Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Policy Type *</label>
                  <select
                    value={form.policy_type}
                    onChange={e => setForm({ ...form, policy_type: e.target.value as any })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                  >
                    {POLICY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Insurer Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Star Health, HDFC Ergo"
                    value={form.insurer_name}
                    onChange={e => setForm({ ...form, insurer_name: e.target.value })}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Policy Number *</label>
                  <input
                    type="text"
                    placeholder="e.g. POL-98765432"
                    value={form.policy_number}
                    onChange={e => setForm({ ...form, policy_number: e.target.value })}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Coverage Amount (₹) *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm">₹</span>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={form.coverage_amount}
                      onChange={e => setForm({ ...form, coverage_amount: e.target.value })}
                      required
                      className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Premium Amount (₹) *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm">₹</span>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={form.premium_amount}
                      onChange={e => setForm({ ...form, premium_amount: e.target.value })}
                      required
                      className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Premium Frequency *</label>
                  <select
                    value={form.premium_frequency}
                    onChange={e => setForm({ ...form, premium_frequency: e.target.value as any })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                  >
                    {FREQUENCY_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Start Date *</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={e => setForm({ ...form, start_date: e.target.value })}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Expiry Date *</label>
                  <input
                    type="date"
                    value={form.expiry_date}
                    onChange={e => setForm({ ...form, expiry_date: e.target.value })}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Status *</label>
                  <select
                    value={form.status}
                    onChange={e => setForm({ ...form, status: e.target.value as any })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                  >
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Relationship Manager Collapsible Section */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
                <button
                  type="button"
                  onClick={() => setRmCollapsed(!rmCollapsed)}
                  className="flex w-full items-center justify-between font-semibold text-slate-800 text-sm"
                >
                  <span className="flex items-center gap-1.5">
                    <User className="h-4 w-4 text-brand-600" />
                    Relationship Manager (claims contact)
                  </span>
                  {rmCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </button>

                {!rmCollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600 uppercase">RM Name</label>
                      <input
                        type="text"
                        placeholder="e.g. John Doe"
                        value={form.rm_name}
                        onChange={e => setForm({ ...form, rm_name: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600 uppercase">RM Company</label>
                      <input
                        type="text"
                        placeholder="e.g. Star Health Insurance"
                        value={form.rm_company}
                        onChange={e => setForm({ ...form, rm_company: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600 uppercase">RM Phone</label>
                      <input
                        type="tel"
                        placeholder="e.g. +91 98765 43210"
                        value={form.rm_phone}
                        onChange={e => setForm({ ...form, rm_phone: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600 uppercase">RM Email</label>
                      <input
                        type="email"
                        placeholder="e.g. rm@starhealth.in"
                        value={form.rm_email}
                        onChange={e => setForm({ ...form, rm_email: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Internal Notes (HR only)</label>
                <textarea
                  placeholder="Internal notes, audit logs, or details not shown to the employee..."
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 resize-none"
                />
              </div>

              {/* Policy Document Upload */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Policy Document (PDF)</label>
                <div className="flex w-full items-center justify-center">
                  <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 py-5 hover:bg-slate-100 transition">
                    <div className="flex flex-col items-center justify-center pb-2 pt-1 text-slate-500">
                      <Upload className="mb-2 h-5 w-5 text-slate-400" />
                      <p className="text-xs font-semibold">{file ? file.name : "Click to select policy copy (PDF)"}</p>
                    </div>
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf"
                      onChange={e => setFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>
                {editingPolicy?.policy_document_url && !file && (
                  <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-1 bg-slate-50 px-2.5 py-1.5 rounded border border-slate-100 w-fit">
                    <FileText className="h-3.5 w-3.5 text-brand-600" />
                    <span>Active Document Uploaded. Select a file above to replace it.</span>
                  </p>
                )}
              </div>
            </form>

            <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {submitting ? "Saving..." : editingPolicy ? "Update Policy" : "Save Policy"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Delete Insurance Record"
        message="This will remove the insurance record. The Employee will no longer see it."
        confirmText="Remove Policy"
        confirmColor="red"
      />
    </section>
  );
}
