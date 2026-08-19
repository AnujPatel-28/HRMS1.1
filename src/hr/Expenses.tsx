import { useState, useEffect, useMemo } from "react";
import {
  Car,
  UtensilsCrossed,
  Building,
  Monitor,
  Stethoscope,
  Receipt,
  Check,
  Eye,
  Loader2,
  Calendar,
  Download,
  ArrowUpDown,
  Search,
  CheckSquare,
  Square,
  DollarSign
} from "lucide-react";
import { db } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import type { Expense, Employee } from "../types";
import { MONTH_NAMES } from "../payroll/hr/payroll-calc";

const CATEGORIES = [
  { value: "travel", label: "Travel", icon: Car },
  { value: "food", label: "Food", icon: UtensilsCrossed },
  { value: "accommodation", label: "Accommodation", icon: Building },
  { value: "equipment", label: "Equipment", icon: Monitor },
  { value: "medical", label: "Medical", icon: Stethoscope },
  { value: "other", label: "Other", icon: Receipt }
] as const;

export default function HRExpenses() {
  const { employee: currentHR } = useEmployee();
  const { tenantId } = useTenant();
  const { success, error } = useToast();

  const [activeTab, setActiveTab] = useState<"pending" | "all" | "history">("pending");
  const [expenses, setExpenses] = useState<(Expense & { payroll_runs?: { month: number; year: number } | null })[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkApproving, setBulkApproving] = useState(false);

  // Reject Modal State
  const [rejectExpense, setRejectExpense] = useState<Expense | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  // Filter & Sorting States
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"expense_date" | "amount" | "employee_name">("expense_date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // History Tab Month Selector
  const [selectedHistoryMonth, setSelectedHistoryMonth] = useState<string>("");

  const fetchExpensesAndEmployees = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [expensesRes, employeesRes] = await Promise.all([
        db.from("expenses").select("*, payroll_runs(month, year)").eq("tenant_id", tenantId).order("expense_date", { ascending: false }),
        db.from("employees").select("*").eq("tenant_id", tenantId)
      ]);

      if (expensesRes.error) throw expensesRes.error;
      if (employeesRes.error) throw employeesRes.error;

      setExpenses(expensesRes.data || []);
      setEmployees(employeesRes.data || []);

      // Default the history selector to the most recent payroll run month
      const reimbursed = (expensesRes.data || []).filter(e => e.status === "reimbursed" && e.payroll_runs);
      if (reimbursed.length > 0) {
        const first = reimbursed[0];
        const monthKey = `${first.payroll_runs!.year}-${String(first.payroll_runs!.month).padStart(2, "0")}`;
        setSelectedHistoryMonth(monthKey);
      }
    } catch (err) {
      console.error(err);
      error("Failed to load expenses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchExpensesAndEmployees();
  }, [tenantId]);

  const employeeMap = useMemo(() => {
    return new Map(employees.map(e => [e.id, e]));
  }, [employees]);

  // Handle Approval Action
  const handleApprove = async (id: string, silent = false) => {
    if (!currentHR?.id || !tenantId) return;
    try {
      const exp = expenses.find(e => e.id === id);
      if (!exp) return;

      const { error: updateErr } = await db
        .from("expenses")
        .update({
          status: "approved",
          reviewed_by: currentHR.id,
          reviewed_at: new Date().toISOString()
        })
        .eq("tenant_id", tenantId)
        .eq("id", id);

      if (updateErr) throw updateErr;

      // Notify employee
      await db.from("notifications").insert([{
        tenant_id: tenantId,
        employee_id: exp.employee_id,
        title: "Expense Approved",
        body: `Your ₹${exp.amount} ${exp.category} expense '${exp.title}' has been approved. It will be included in your next payroll.`,
        type: "general",
        reference_id: exp.id
      }]);

      if (!silent) {
        success("Expense claim approved.");
        void fetchExpensesAndEmployees();
      }
    } catch (err) {
      console.error(err);
      if (!silent) error("Failed to approve expense.");
    }
  };

  // Bulk Approve Action
  const handleBulkApprove = async () => {
    if (selectedIds.length === 0 || bulkApproving) return;
    setBulkApproving(true);
    try {
      await Promise.all(selectedIds.map(id => handleApprove(id, true)));
      success(`Approved ${selectedIds.length} expenses successfully.`);
      setSelectedIds([]);
      void fetchExpensesAndEmployees();
    } catch (err) {
      console.error(err);
      error("Failed to bulk approve.");
    } finally {
      setBulkApproving(false);
    }
  };

  // Toggle selection for Bulk Approval
  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Toggle all pending cards
  const pendingExpenses = useMemo(() => {
    return expenses.filter(e => e.status === "pending");
  }, [expenses]);

  const toggleSelectAll = () => {
    if (selectedIds.length === pendingExpenses.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(pendingExpenses.map(e => e.id));
    }
  };

  // Handle Reject Action
  const handleRejectConfirm = async () => {
    if (!rejectExpense || !rejectionReason.trim() || rejecting || !currentHR?.id) return;
    setRejecting(true);
    try {
      const { error: rejectErr } = await db
        .from("expenses")
        .update({
          status: "rejected",
          rejection_reason: rejectionReason.trim(),
          reviewed_by: currentHR.id,
          reviewed_at: new Date().toISOString()
        })
        .eq("tenant_id", tenantId)
        .eq("id", rejectExpense.id);

      if (rejectErr) throw rejectErr;

      // Notify employee
      await db.from("notifications").insert([{
        tenant_id: tenantId,
        employee_id: rejectExpense.employee_id,
        title: "Expense Rejected",
        body: `Your ${rejectExpense.category} expense '${rejectExpense.title}' was rejected. Reason: ${rejectionReason.trim()}`,
        type: "general",
        reference_id: rejectExpense.id
      }]);

      success("Expense claim rejected.");
      setRejectExpense(null);
      setRejectionReason("");
      void fetchExpensesAndEmployees();
    } catch (err) {
      console.error(err);
      error("Failed to reject expense.");
    } finally {
      setRejecting(false);
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    if (expenses.length === 0) return;

    const headers = [
      "Employee",
      "Date",
      "Category",
      "Title",
      "Amount (INR)",
      "Status",
      "Reviewed By",
      "Reviewed At",
      "Reimbursement Month"
    ];

    const rows = filteredExpenses.map(exp => {
      const emp = employeeMap.get(exp.employee_id);
      const reviewer = exp.reviewed_by ? employeeMap.get(exp.reviewed_by) : null;
      const reimbursedMonth = exp.payroll_runs
        ? `${MONTH_NAMES[exp.payroll_runs.month - 1]} ${exp.payroll_runs.year}`
        : "-";

      return [
        `"${emp?.full_name || "Unknown"}"`,
        exp.expense_date,
        exp.category,
        `"${exp.title.replace(/"/g, '""')}"`,
        exp.amount,
        exp.status,
        `"${reviewer?.full_name || "-"}"`,
        exp.reviewed_at ? exp.reviewed_at.split("T")[0] : "-",
        `"${reimbursedMonth}"`
      ];
    });

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map(e => e.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Expenses_Report_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered and Sorted list for All Expenses tab
  const filteredExpenses = useMemo(() => {
    return expenses
      .filter(exp => {
        const emp = employeeMap.get(exp.employee_id);
        if (filterEmployee && exp.employee_id !== filterEmployee) return false;
        if (filterCategory && exp.category !== filterCategory) return false;
        if (filterStatus && exp.status !== filterStatus) return false;
        if (filterMonth) {
          const expMonth = exp.expense_date.substring(0, 7); // YYYY-MM
          if (expMonth !== filterMonth) return false;
        }
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase();
          const titleMatch = exp.title.toLowerCase().includes(query);
          const empMatch = emp?.full_name.toLowerCase().includes(query);
          const descMatch = exp.description?.toLowerCase().includes(query);
          if (!titleMatch && !empMatch && !descMatch) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const orderMultiplier = sortOrder === "asc" ? 1 : -1;
        if (sortField === "expense_date") {
          return (new Date(a.expense_date).getTime() - new Date(b.expense_date).getTime()) * orderMultiplier;
        }
        if (sortField === "amount") {
          return (a.amount - b.amount) * orderMultiplier;
        }
        if (sortField === "employee_name") {
          const empA = employeeMap.get(a.employee_id)?.full_name || "";
          const empB = employeeMap.get(b.employee_id)?.full_name || "";
          return empA.localeCompare(empB) * orderMultiplier;
        }
        return 0;
      });
  }, [expenses, filterEmployee, filterCategory, filterStatus, filterMonth, searchQuery, sortField, sortOrder, employeeMap]);

  // Reimbursement History Grouping
  const historyMonths = useMemo(() => {
    const months = new Map<string, { label: string; amount: number; claims: number }>();
    expenses.forEach(e => {
      if (e.status === "reimbursed" && e.payroll_runs) {
        const key = `${e.payroll_runs.year}-${String(e.payroll_runs.month).padStart(2, "0")}`;
        const label = `${MONTH_NAMES[e.payroll_runs.month - 1]} ${e.payroll_runs.year}`;
        const cur = months.get(key) ?? { label, amount: 0, claims: 0 };
        cur.amount += e.amount;
        cur.claims++;
        months.set(key, cur);
      }
    });
    return Array.from(months.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [expenses]);

  const historyExpenses = useMemo(() => {
    if (!selectedHistoryMonth) return [];
    return expenses.filter(e => {
      if (e.status !== "reimbursed" || !e.payroll_runs) return false;
      const key = `${e.payroll_runs.year}-${String(e.payroll_runs.month).padStart(2, "0")}`;
      return key === selectedHistoryMonth;
    });
  }, [expenses, selectedHistoryMonth]);

  // All Expenses Tab Summary Stats
  const allStats = useMemo(() => {
    let approvedUnpaid = 0;
    let reimbursedThisMonth = 0;
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    expenses.forEach(e => {
      if (e.status === "approved") {
        approvedUnpaid += e.amount;
      } else if (e.status === "reimbursed" && e.reimbursed_at) {
        const reimbursedMonth = e.reimbursed_at.substring(0, 7); // YYYY-MM
        if (reimbursedMonth === currentMonthKey) {
          reimbursedThisMonth += e.amount;
        }
      }
    });

    return {
      approvedUnpaid,
      reimbursedThisMonth,
      pendingCount: pendingExpenses.length
    };
  }, [expenses, pendingExpenses]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Expenses Management</h2>
          <p className="text-sm text-slate-500 font-medium">Review and process company expense claims.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setActiveTab("pending")}
            className={`relative rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              activeTab === "pending" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Pending Review
            {pendingExpenses.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white shadow-sm ring-1 ring-white">
                {pendingExpenses.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("all")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              activeTab === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            All Expenses
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              activeTab === "history" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Reimbursement History
          </button>
        </div>
      </div>

      {/* TAB 1: PENDING REVIEW */}
      {activeTab === "pending" && (
        <div className="space-y-4 animate-fadeIn">
          {pendingExpenses.length > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 p-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleSelectAll}
                  className="text-slate-500 hover:text-slate-700"
                  title="Toggle Select All"
                >
                  {selectedIds.length === pendingExpenses.length ? (
                    <CheckSquare className="h-5 w-5 text-brand-600" />
                  ) : (
                    <Square className="h-5 w-5" />
                  )}
                </button>
                <span className="text-xs font-semibold text-slate-600">
                  {selectedIds.length} Selected for bulk actions
                </span>
              </div>
              {selectedIds.length > 0 && (
                <button
                  onClick={handleBulkApprove}
                  disabled={bulkApproving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
                >
                  {bulkApproving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Approve Selected
                </button>
              )}
            </div>
          )}

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[1, 2].map(i => (
                <Skeleton key={i} className="h-44 w-full rounded-2xl" />
              ))}
            </div>
          ) : pendingExpenses.length === 0 ? (
            <EmptyState
              icon={Check}
              title="All caught up!"
              description="No expense claims are currently awaiting review."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {pendingExpenses.map(exp => {
                const emp = employeeMap.get(exp.employee_id);
                const CatIcon = CATEGORIES.find(c => c.value === exp.category)?.icon || Receipt;
                const isSelected = selectedIds.includes(exp.id);

                return (
                  <div
                    key={exp.id}
                    className={`relative overflow-hidden rounded-2xl border bg-white p-5 shadow-sm hover:shadow transition duration-200 flex flex-col justify-between ${
                      isSelected ? "border-brand-500 ring-2 ring-brand-100" : "border-slate-200"
                    }`}
                  >
                    <div>
                      {/* Checkbox Overlay */}
                      <button
                        onClick={() => toggleSelect(exp.id)}
                        className="absolute right-4 top-4 text-slate-400 hover:text-slate-600"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-5 w-5 text-brand-600" />
                        ) : (
                          <Square className="h-5 w-5" />
                        )}
                      </button>

                      {/* Header Row */}
                      <div className="flex items-center gap-3">
                        {emp?.profile_photo_url ? (
                          <img
                            src={emp.profile_photo_url}
                            alt=""
                            className="h-10 w-10 rounded-full object-cover border border-slate-100"
                          />
                        ) : (
                          <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                            {emp?.full_name?.slice(0, 2).toUpperCase() || "?"}
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-slate-800">{emp?.full_name || "Unknown"}</p>
                          <p className="text-xs text-slate-400 font-medium capitalize">
                            {emp?.department || "No department"}
                          </p>
                        </div>
                      </div>

                      {/* Info section */}
                      <div className="mt-4 space-y-2">
                        <h4 className="text-lg font-bold text-slate-900 leading-tight">
                          {exp.title}
                        </h4>
                        {exp.description && (
                          <p className="text-xs text-slate-500 font-medium line-clamp-2">
                            {exp.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 capitalize">
                            <CatIcon className="h-3 w-3 text-slate-400" />
                            {exp.category}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
                            <Calendar className="h-3 w-3 text-slate-400" />
                            {exp.expense_date}
                          </span>
                          {exp.receipt_url && (
                            <a
                              href={exp.receipt_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700"
                            >
                              <Eye className="h-3 w-3" />
                              View Receipt
                            </a>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
                      <div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Amount Claimed</p>
                        <p className="text-2xl font-black text-slate-900">₹{exp.amount.toLocaleString("en-IN")}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setRejectExpense(exp)}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => handleApprove(exp.id)}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition"
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ALL EXPENSES */}
      {activeTab === "all" && (
        <div className="space-y-6 animate-fadeIn">
          {/* Summary stats above table */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Approved Unpaid</p>
              <p className="mt-1 text-xl font-bold text-slate-900">₹{allStats.approvedUnpaid.toLocaleString("en-IN")}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Reimbursed This Month</p>
              <p className="mt-1 text-xl font-bold text-slate-900">₹{allStats.reimbursedThisMonth.toLocaleString("en-IN")}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pending Review Count</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{allStats.pendingCount} Claims</p>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search title, employee..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                />
              </div>

              <select
                value={filterEmployee}
                onChange={e => setFilterEmployee(e.target.value)}
                className="rounded-lg border border-slate-300 py-2 px-3 text-sm outline-none bg-white"
              >
                <option value="">All Employees</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>

              <select
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                className="rounded-lg border border-slate-300 py-2 px-3 text-sm outline-none bg-white"
              >
                <option value="">All Categories</option>
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>

              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="rounded-lg border border-slate-300 py-2 px-3 text-sm outline-none bg-white"
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="reimbursed">Reimbursed</option>
              </select>

              <input
                type="month"
                value={filterMonth}
                onChange={e => setFilterMonth(e.target.value)}
                className="rounded-lg border border-slate-300 py-1.5 px-3 text-sm outline-none"
              />

              <button
                onClick={handleExportCSV}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 py-2 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <Download className="h-4 w-4" />
                CSV Export
              </button>
            </div>

            {/* Sorting controls */}
            <div className="flex items-center gap-4 text-xs font-semibold text-slate-500 pt-2 border-t border-slate-100">
              <span>Sort By:</span>
              <button
                onClick={() => {
                  if (sortField === "expense_date") setSortOrder(o => (o === "asc" ? "desc" : "asc"));
                  else {
                    setSortField("expense_date");
                    setSortOrder("desc");
                  }
                }}
                className={`inline-flex items-center gap-1 ${sortField === "expense_date" ? "text-brand-600 font-bold" : ""}`}
              >
                Date <ArrowUpDown className="h-3 w-3" />
              </button>
              <button
                onClick={() => {
                  if (sortField === "amount") setSortOrder(o => (o === "asc" ? "desc" : "asc"));
                  else {
                    setSortField("amount");
                    setSortOrder("desc");
                  }
                }}
                className={`inline-flex items-center gap-1 ${sortField === "amount" ? "text-brand-600 font-bold" : ""}`}
              >
                Amount <ArrowUpDown className="h-3 w-3" />
              </button>
              <button
                onClick={() => {
                  if (sortField === "employee_name") setSortOrder(o => (o === "asc" ? "desc" : "asc"));
                  else {
                    setSortField("employee_name");
                    setSortOrder("asc");
                  }
                }}
                className={`inline-flex items-center gap-1 ${sortField === "employee_name" ? "text-brand-600 font-bold" : ""}`}
              >
                Employee <ArrowUpDown className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm divide-y divide-slate-100">
                <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Employee</th>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Category</th>
                    <th className="px-5 py-3">Title</th>
                    <th className="px-5 py-3">Amount</th>
                    <th className="px-5 py-3">Receipt</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Reviewed By</th>
                    <th className="px-5 py-3">Payroll Run</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredExpenses.map(exp => {
                    const emp = employeeMap.get(exp.employee_id);
                    const reviewer = exp.reviewed_by ? employeeMap.get(exp.reviewed_by) : null;
                    const CatIcon = CATEGORIES.find(c => c.value === exp.category)?.icon || Receipt;

                    const statusColors = {
                      pending: "bg-amber-100 text-amber-800 border-amber-200",
                      approved: "bg-blue-100 text-blue-800 border-blue-200",
                      rejected: "bg-rose-100 text-rose-800 border-rose-200",
                      reimbursed: "bg-emerald-100 text-emerald-800 border-emerald-200"
                    }[exp.status];

                    return (
                      <tr key={exp.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            {emp?.profile_photo_url ? (
                              <img src={emp.profile_photo_url} alt="" className="h-8 w-8 rounded-full object-cover shadow-sm border border-slate-100" />
                            ) : (
                              <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                                {emp?.full_name?.slice(0, 2).toUpperCase() || "?"}
                              </div>
                            )}
                            <span className="font-semibold text-slate-800">{emp?.full_name || "Unknown"}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap text-slate-600">
                          {exp.expense_date}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap capitalize text-slate-600 text-xs">
                          <span className="inline-flex items-center gap-1">
                            <CatIcon className="h-3.5 w-3.5 text-slate-400" />
                            {exp.category}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-medium text-slate-800">
                          {exp.title}
                          {exp.status === "rejected" && exp.rejection_reason && (
                            <p className="text-xs text-rose-600 font-semibold mt-0.5">
                              Rejected: {exp.rejection_reason}
                            </p>
                          )}
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
                            {exp.status}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-slate-600 whitespace-nowrap">
                          {reviewer?.full_name || "-"}
                        </td>
                        <td className="px-5 py-4 text-xs font-semibold text-slate-500 whitespace-nowrap">
                          {exp.payroll_runs ? (
                            <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700 border border-emerald-100">
                              {MONTH_NAMES[exp.payroll_runs.month - 1]} {exp.payroll_runs.year}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: REIMBURSEMENT HISTORY */}
      {activeTab === "history" && (
        <div className="space-y-6 animate-fadeIn">
          {historyMonths.length === 0 ? (
            <EmptyState
              icon={DollarSign}
              title="No reimbursement history"
              description=" Reimbursed expense reports will show here once payroll runs are approved."
            />
          ) : (
            <>
              {/* Month Selector & Summary */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Select Payroll Month
                  </label>
                  <select
                    value={selectedHistoryMonth}
                    onChange={e => setSelectedHistoryMonth(e.target.value)}
                    className="rounded-lg border border-slate-300 py-2 px-3 text-sm outline-none bg-white font-semibold text-slate-800"
                  >
                    {historyMonths.map(([key, data]) => (
                      <option key={key} value={key}>
                        {data.label}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedHistoryMonth && (
                  <div className="flex gap-4">
                    <div className="text-right">
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Reimbursements</p>
                      <p className="text-xl font-bold text-slate-900">
                        ₹{historyMonths.find(m => m[0] === selectedHistoryMonth)?.[1]?.amount.toLocaleString("en-IN") || 0}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Reimbursed Claims</p>
                      <p className="text-xl font-bold text-slate-900">
                        {historyMonths.find(m => m[0] === selectedHistoryMonth)?.[1]?.claims || 0} Claims
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Grouped Table */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden animate-fadeIn">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-900">Reimbursement Details</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm divide-y divide-slate-100">
                    <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Employee</th>
                        <th className="px-5 py-3">Date</th>
                        <th className="px-5 py-3">Category</th>
                        <th className="px-5 py-3">Title</th>
                        <th className="px-5 py-3">Amount</th>
                        <th className="px-5 py-3">Receipt</th>
                        <th className="px-5 py-3">Reviewed By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {historyExpenses.map(exp => {
                        const emp = employeeMap.get(exp.employee_id);
                        const reviewer = exp.reviewed_by ? employeeMap.get(exp.reviewed_by) : null;
                        const CatIcon = CATEGORIES.find(c => c.value === exp.category)?.icon || Receipt;

                        return (
                          <tr key={exp.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-2">
                                {emp?.profile_photo_url ? (
                                  <img src={emp.profile_photo_url} alt="" className="h-8 w-8 rounded-full object-cover shadow-sm border border-slate-100" />
                                ) : (
                                  <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                                    {emp?.full_name?.slice(0, 2).toUpperCase() || "?"}
                                  </div>
                                )}
                                <span className="font-semibold text-slate-800">{emp?.full_name || "Unknown"}</span>
                              </div>
                            </td>
                            <td className="px-5 py-4 whitespace-nowrap text-slate-600">
                              {exp.expense_date}
                            </td>
                            <td className="px-5 py-4 whitespace-nowrap capitalize text-slate-600 text-xs">
                              <span className="inline-flex items-center gap-1">
                                <CatIcon className="h-3.5 w-3.5 text-slate-400" />
                                {exp.category}
                              </span>
                            </td>
                            <td className="px-5 py-4 font-medium text-slate-800">
                              {exp.title}
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
                            <td className="px-5 py-4 text-slate-600 whitespace-nowrap">
                              {reviewer?.full_name || "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Reject Modal */}
      {rejectExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl animate-scaleIn">
            <h3 className="text-lg font-bold text-slate-900">Reject Expense Claim</h3>
            <p className="mt-1 text-xs text-slate-500">
              Claim for **₹{rejectExpense.amount.toLocaleString("en-IN")}** by **{employeeMap.get(rejectExpense.employee_id)?.full_name}**.
            </p>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
                Reason for Rejection *
              </label>
              <textarea
                required
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                rows={3}
                placeholder="Explain why this expense claim is being rejected..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none"
              />
            </div>
            <div className="mt-5 flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                disabled={rejecting}
                onClick={() => {
                  setRejectExpense(null);
                  setRejectionReason("");
                }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={rejecting || !rejectionReason.trim()}
                onClick={handleRejectConfirm}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1"
              >
                {rejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
