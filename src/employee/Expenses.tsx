import React, { useState, useEffect, useRef } from "react";
import {
  Car,
  UtensilsCrossed,
  Building,
  Monitor,
  Stethoscope,
  Receipt,
  Clock,
  Check,
  X,
  Plus,
  Eye,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Trash2,
  TrendingUp,
  DollarSign
} from "lucide-react";
import { db, storage } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import type { Expense } from "../types";
import { MONTH_NAMES } from "../payroll/hr/payroll-calc";
import { useTenantHrIds } from "../hooks/useTenantHrIds";

const CATEGORIES = [
  { value: "travel", label: "Travel", icon: Car },
  { value: "food", label: "Food", icon: UtensilsCrossed },
  { value: "accommodation", label: "Accommodation", icon: Building },
  { value: "equipment", label: "Equipment", icon: Monitor },
  { value: "medical", label: "Medical", icon: Stethoscope },
  { value: "other", label: "Other", icon: Receipt }
] as const;

export default function Expenses() {
  const { employee, loading: empLoading } = useEmployee();
  const { tenantId } = useTenant();
  const { success, error } = useToast();
  const hrIds = useTenantHrIds();

  const [activeTab, setActiveTab] = useState<"my" | "submit">("my");
  const [expenses, setExpenses] = useState<(Expense & { payroll_runs?: { month: number; year: number } | null })[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Expense["category"]>("travel");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cancel Modal State
  const [cancelExpense, setCancelExpense] = useState<Expense | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Expanded Row State (for rejection reason)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const fetchExpenses = async () => {
    if (!employee?.id || !tenantId) return;
    setLoading(true);
    try {
      const { data, error: fetchErr } = await db
        .from("expenses")
        .select("*, payroll_runs(month, year)")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employee.id)
        .order("expense_date", { ascending: false });

      if (fetchErr) throw fetchErr;
      setExpenses(data || []);
    } catch (err) {
      console.error(err);
      error("Failed to load expenses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!empLoading) {
      void fetchExpenses();
    }
  }, [employee?.id, tenantId, empLoading]);

  // Handle Receipt Upload & Preview
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      error("File size must be under 5 MB.");
      return;
    }

    setReceiptFile(file);

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setReceiptPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else if (file.type === "application/pdf") {
      setReceiptPreview("pdf");
    } else {
      setReceiptPreview("file");
    }
  };

  // Submit Expense Form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee?.id || !tenantId || uploading) return;

    if (!title.trim() || !amount || Number(amount) <= 0) {
      error("Please enter a valid title and amount.");
      return;
    }

    if (new Date(expenseDate) > new Date()) {
      error("Expense date cannot be in the future.");
      return;
    }

    setUploading(true);
    let receiptUrl: string | null = null;
    let receiptName: string | null = null;

    try {
      if (receiptFile) {
        const { data: uploadData, error: uploadErr } = await storage
          .from("expense-receipts")
          .uploadAuto(receiptFile);

        if (uploadErr || !uploadData) throw uploadErr || new Error("Upload failed");
        receiptUrl = uploadData.url;
        receiptName = receiptFile.name;
      }

      const newExpense = {
        tenant_id: tenantId,
        employee_id: employee.id,
        title: title.trim(),
        amount: Number(amount),
        currency: "INR",
        category,
        expense_date: expenseDate,
        description: description.trim() || null,
        receipt_url: receiptUrl,
        receipt_name: receiptName,
        status: "pending" as const
      };

      const { data: insertData, error: insertErr } = await db
        .from("expenses")
        .insert([newExpense])
        .select()
        .single();

      if (insertErr) throw insertErr;

      // Create notification for HR. Resolved through tenant_hr_employee_ids() — employees.role
      // is gone, and an employee cannot read other people's rows in employee_roles.
      if (hrIds.size > 0) {
        const notifications = Array.from(hrIds).map((hrId) => ({
          tenant_id: tenantId,
          employee_id: hrId,
          title: "New expense claim",
          body: `${employee.full_name} submitted a ₹${amount} expense for ${category}`,
          type: "general",
          reference_id: insertData.id
        }));
        await db.from("notifications").insert(notifications);
      }

      success("Expense submitted for approval.");
      // Reset Form
      setTitle("");
      setAmount("");
      setCategory("travel");
      setExpenseDate(new Date().toISOString().split("T")[0]);
      setDescription("");
      setReceiptFile(null);
      setReceiptPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Refresh list and switch tab
      await fetchExpenses();
      setActiveTab("my");
    } catch (err) {
      console.error(err);
      error("Failed to submit expense claim.");
    } finally {
      setUploading(false);
    }
  };

  // Cancel Pending Expense
  const handleCancelConfirm = async () => {
    if (!cancelExpense || cancelling) return;
    setCancelling(true);
    try {
      const { error: deleteErr } = await db
        .from("expenses")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", cancelExpense.id)
        .eq("status", "pending");

      if (deleteErr) throw deleteErr;

      // Delete receipt from storage if exists
      if (cancelExpense.receipt_url) {
        // extract storage path / key from url
        const marker = "/objects/";
        const idx = cancelExpense.receipt_url.indexOf(marker);
        if (idx !== -1) {
          const key = decodeURIComponent(cancelExpense.receipt_url.slice(idx + marker.length));
          await storage.from("expense-receipts").remove?.(key);
        }
      }

      success("Expense claim cancelled.");
      setCancelExpense(null);
      await fetchExpenses();
    } catch (err) {
      console.error(err);
      error("Failed to cancel expense claim.");
    } finally {
      setCancelling(false);
    }
  };

  // Toggle Row Expansion
  const toggleRow = (id: string) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Calculation of Summary Cards
  const stats = React.useMemo(() => {
    let pendingAmt = 0;
    let pendingCount = 0;
    let approvedAmt = 0;
    let approvedCount = 0;
    let reimbursedAmt = 0;

    const currentYear = new Date().getFullYear();

    expenses.forEach(e => {
      if (e.status === "pending") {
        pendingAmt += e.amount;
        pendingCount++;
      } else if (e.status === "approved") {
        approvedAmt += e.amount;
        approvedCount++;
      } else if (e.status === "reimbursed") {
        const reimbursedDate = e.reimbursed_at ? new Date(e.reimbursed_at) : null;
        if (reimbursedDate && reimbursedDate.getFullYear() === currentYear) {
          reimbursedAmt += e.amount;
        }
      }
    });

    return {
      pendingAmt,
      pendingCount,
      approvedAmt,
      approvedCount,
      reimbursedAmt
    };
  }, [expenses]);

  const isLoading = loading || empLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Expenses</h2>
          <p className="text-sm text-slate-500 font-medium">Claim and track your business expenses.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setActiveTab("my")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              activeTab === "my" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            My Expenses
          </button>
          <button
            onClick={() => setActiveTab("submit")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              activeTab === "submit" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Submit Expense
          </button>
        </div>
      </div>

      {activeTab === "my" ? (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Pending</p>
                <div className="rounded-lg bg-amber-50 p-2 text-amber-500">
                  <Clock className="h-5 w-5" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">₹{stats.pendingAmt.toLocaleString("en-IN")}</p>
              <p className="text-xs text-slate-400 mt-1">Across {stats.pendingCount} pending claims</p>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Approved (Unpaid)</p>
                <div className="rounded-lg bg-blue-50 p-2 text-blue-500">
                  <Check className="h-5 w-5" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">₹{stats.approvedAmt.toLocaleString("en-IN")}</p>
              <p className="text-xs text-slate-400 mt-1">Across {stats.approvedCount} approved claims</p>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Reimbursed This Year</p>
                <div className="rounded-lg bg-emerald-50 p-2 text-emerald-500">
                  <TrendingUp className="h-5 w-5" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">₹{stats.reimbursedAmt.toLocaleString("en-IN")}</p>
              <p className="text-xs text-slate-400 mt-1">Tax-free salary integrations</p>
            </div>
          </div>

          {/* Table Container */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">Expense History</h3>
              {!isLoading && expenses.length > 0 && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {expenses.length} Claims
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="space-y-3 p-5">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : expenses.length === 0 ? (
              <div className="p-10">
                <EmptyState
                  icon={Receipt}
                  title="No expense claims yet"
                  description="Submit your first claim using the 'Submit Expense' tab above."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm divide-y divide-slate-100">
                  <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Title</th>
                      <th className="px-5 py-3">Category</th>
                      <th className="px-5 py-3">Amount</th>
                      <th className="px-5 py-3">Receipt</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Reimbursed</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {expenses.map(exp => {
                      const CatIcon = CATEGORIES.find(c => c.value === exp.category)?.icon || Receipt;
                      const isExpanded = !!expandedRows[exp.id];

                      const statusColors = {
                        pending: "bg-amber-100 text-amber-800 border-amber-200",
                        approved: "bg-blue-100 text-blue-800 border-blue-200",
                        rejected: "bg-rose-100 text-rose-800 border-rose-200",
                        reimbursed: "bg-emerald-100 text-emerald-800 border-emerald-200"
                      }[exp.status];

                      const statusIcons = {
                        pending: <Clock className="h-3.5 w-3.5 mr-1 shrink-0" />,
                        approved: <Check className="h-3.5 w-3.5 mr-1 shrink-0" />,
                        rejected: <X className="h-3.5 w-3.5 mr-1 shrink-0" />,
                        reimbursed: <DollarSign className="h-3.5 w-3.5 mr-1 shrink-0" />
                      }[exp.status];

                      return (
                        <React.Fragment key={exp.id}>
                          <tr className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-5 py-4 font-medium text-slate-600 whitespace-nowrap">
                              {new Date(exp.expense_date).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric"
                              })}
                            </td>
                            <td className="px-5 py-4 font-semibold text-slate-800">
                              <div>
                                <p>{exp.title}</p>
                                {exp.description && (
                                  <p className="text-xs text-slate-400 font-normal mt-0.5 line-clamp-1">
                                    {exp.description}
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-4 whitespace-nowrap text-slate-600">
                              <span className="inline-flex items-center gap-1.5 capitalize text-xs">
                                <CatIcon className="h-3.5 w-3.5 text-slate-400" />
                                {exp.category}
                              </span>
                            </td>
                            <td className="px-5 py-4 font-bold text-slate-900 whitespace-nowrap">
                              ₹{exp.amount.toLocaleString("en-IN")}
                            </td>
                            <td className="px-5 py-4 whitespace-nowrap">
                              {exp.receipt_url ? (
                                <a
                                  href={exp.receipt_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  View
                                </a>
                              ) : (
                                <span className="text-xs text-slate-400">-</span>
                              )}
                            </td>
                            <td className="px-5 py-4 whitespace-nowrap">
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusColors}`}>
                                {statusIcons}
                                <span className="capitalize">{exp.status}</span>
                              </span>
                            </td>
                            <td className="px-5 py-4 text-xs font-medium text-slate-500 whitespace-nowrap">
                              {exp.status === "reimbursed" && exp.payroll_runs ? (
                                <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700 font-bold border border-emerald-100">
                                  {MONTH_NAMES[exp.payroll_runs.month - 1]} {exp.payroll_runs.year} payroll
                                </span>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="px-5 py-4 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-2">
                                {exp.status === "rejected" && exp.rejection_reason && (
                                  <button
                                    onClick={() => toggleRow(exp.id)}
                                    title="View rejection reason"
                                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-1"
                                  >
                                    Reason
                                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                  </button>
                                )}
                                {exp.status === "pending" && (
                                  <button
                                    onClick={() => setCancelExpense(exp)}
                                    className="rounded-lg border border-rose-100 p-1.5 text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition"
                                    title="Cancel claim"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Rejection Reason Expander */}
                          {exp.status === "rejected" && isExpanded && (
                            <tr className="bg-rose-50/50">
                              <td colSpan={8} className="px-5 py-3 border-t border-b border-rose-100 text-xs">
                                <div className="flex items-start gap-2 text-rose-800">
                                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                                  <div>
                                    <p className="font-bold">Rejection Reason:</p>
                                    <p className="mt-1 text-slate-600 font-medium">
                                      {exp.rejection_reason || "No comments left by HR."}
                                    </p>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* TAB 2: Submit Expense Form */
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Submit Expense Claim</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
                Title *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Uber to client meeting"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
                  Amount *
                </label>
                <div className="relative rounded-lg shadow-sm">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <span className="text-slate-500 sm:text-sm">₹</span>
                  </div>
                  <input
                    type="number"
                    required
                    min="1"
                    step="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
                  Category *
                </label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value as Expense["category"])}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 bg-white"
                >
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
                Date *
              </label>
              <input
                type="date"
                required
                max={new Date().toISOString().split("T")[0]}
                value={expenseDate}
                onChange={e => setExpenseDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
                Description (Optional)
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                placeholder="Provide details about this expense claim..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none"
              />
            </div>

            {/* Receipt Upload */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
                Receipt Attachment
              </label>
              <div className="mt-1 flex justify-center rounded-xl border border-dashed border-slate-300 px-6 py-6 hover:border-brand-400 transition cursor-pointer"
                   onClick={() => fileInputRef.current?.click()}>
                <div className="space-y-1 text-center">
                  <Receipt className="mx-auto h-8 w-8 text-slate-400" />
                  <div className="flex text-xs text-slate-600">
                    <span className="relative rounded-md font-semibold text-brand-600 hover:text-brand-500">
                      Upload a file
                    </span>
                    <p className="pl-1">or drag and drop</p>
                  </div>
                  <p className="text-[10px] text-slate-400">JPG, PNG, PDF up to 5 MB</p>
                </div>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/png, image/jpeg, image/jpg, application/pdf"
                onChange={handleFileChange}
                className="hidden"
              />

              {/* Upload Preview */}
              {receiptFile && (
                <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 p-2 text-xs bg-slate-50 animate-fadeIn">
                  <div className="flex items-center gap-2 min-w-0">
                    {receiptPreview && receiptPreview.startsWith("data:image/") ? (
                      <img src={receiptPreview} alt="Receipt Thumbnail" className="h-10 w-10 rounded object-cover shadow-sm border border-slate-100" />
                    ) : (
                      <div className="grid h-10 w-10 place-items-center rounded bg-slate-200 text-slate-500 font-bold border border-slate-300">
                        PDF
                      </div>
                    )}
                    <span className="truncate font-semibold text-slate-700 max-w-[200px]">
                      {receiptFile.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setReceiptFile(null);
                      setReceiptPreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="text-slate-400 hover:text-rose-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={uploading}
              className="w-full flex justify-center items-center gap-1.5 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Submit Expense for Approval
                </>
              )}
            </button>
          </form>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {cancelExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl animate-scaleIn">
            <h3 className="text-lg font-bold text-slate-900">Cancel Claim?</h3>
            <p className="mt-2 text-sm text-slate-500">
              Are you sure you want to cancel the pending expense claim for **₹{cancelExpense.amount.toLocaleString("en-IN")}**? This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                disabled={cancelling}
                onClick={() => setCancelExpense(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                No, Keep
              </button>
              <button
                disabled={cancelling}
                onClick={handleCancelConfirm}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1"
              >
                {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Yes, Cancel Claim
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
