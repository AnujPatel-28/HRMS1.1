import { useState, useEffect, useCallback, useMemo } from "react";
import {
  FileText,
  Calendar,
  Lock,
  Unlock,
  CheckCircle,
  Eye,
  AlertTriangle,
  User,
  Search,
  Check,
  X,
  MessageSquare,
  Printer
} from "lucide-react";
import { db } from "../../insforge/client";
import { useToast } from "../../shared/ToastContext";
import { useEmployee } from "../../hooks/useEmployee";
import { useTenant } from "../../contexts/TenantContext";
import { Skeleton } from "../../shared/Skeleton";
import { ConfirmModal } from "../../shared/ConfirmModal";
import { EmptyState } from "../../shared/EmptyState";

// --- Types ---
interface DeclarationWindow {
  id?: string;
  tenant_id: string;
  financial_year: string;
  is_open: boolean;
  opens_at: string | null;
  closes_at: string | null;
  opened_by?: string | null;
}

interface ITDeclaration {
  id: string;
  tenant_id: string;
  employee_id: string;
  financial_year: string;
  tax_regime: "old" | "new";
  ppf_amount: number;
  lic_premium: number;
  elss_mutual_fund: number;
  nsc_amount: number;
  home_loan_principal: number;
  tuition_fees: number;
  other_80c: number;
  health_insurance_self: number;
  health_insurance_parents: number;
  hra_rent_paid_annual: number;
  hra_landlord_name: string;
  hra_landlord_pan: string;
  home_loan_interest: number;
  prev_employer_income: number;
  prev_employer_tds: number;
  prev_employer_name: string;
  lta_amount: number;
  medical_reimbursement: number;
  status: "draft" | "submitted" | "verified_by_hr";
  submitted_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  hr_notes: string | null;
  // joined fields
  employees?: {
    full_name: string;
    email: string;
    employee_code: string | null;
    pan_number: string | null;
    aadhaar_number: string | null;
    bank_name: string | null;
    account_number: string | null;
    ifsc_code: string | null;
  } | null;
}

export default function TaxDeclarationHR() {
  const { tenantId } = useTenant();
  const { employee: hrEmployee } = useEmployee();
  const { success, error: toastError } = useToast();

  const [loading, setLoading] = useState(true);
  const [windowLoading, setWindowLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // FY Windows State
  const [financialYear, setFinancialYear] = useState("2026-27");
  const [windowInfo, setWindowInfo] = useState<DeclarationWindow | null>(null);
  const [closesAtInput, setClosesAtInput] = useState("");

  // Stats
  const [activeEmployeeCount, setActiveEmployeeCount] = useState(0);
  const [submittedCount, setSubmittedCount] = useState(0);

  // Declarations List
  const [declarations, setDeclarations] = useState<ITDeclaration[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Selected for View / Edit Modal
  const [selectedDecl, setSelectedDecl] = useState<ITDeclaration | null>(null);
  const [hrNotes, setHrNotes] = useState("");
  const [showVerifyModal, setShowVerifyModal] = useState(false);

  // Fetch window and count stats
  const fetchWindowDetails = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data } = await db
        .from("it_declaration_windows")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("financial_year", financialYear)
        .maybeSingle();

      if (data) {
        const win = data as DeclarationWindow;
        setWindowInfo(win);
        setClosesAtInput(win.closes_at ? new Date(win.closes_at).toISOString().slice(0, 16) : "");
      } else {
        setWindowInfo(null);
        setClosesAtInput("");
      }

      // Count active employees
      const { count: empCount } = await db
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "active");
      
      setActiveEmployeeCount(empCount ?? 0);

      // Count submitted/verified declarations
      const { count: declCount } = await db
        .from("it_declarations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("financial_year", financialYear)
        .in("status", ["submitted", "verified_by_hr"]);

      setSubmittedCount(declCount ?? 0);
    } catch (err) {
      console.error(err);
    }
  }, [tenantId, financialYear]);

  // Fetch declarations
  const fetchDeclarations = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await db
        .from("it_declarations")
        .select(`
          *,
          employees:employee_id (
            full_name,
            email,
            employee_code,
            pan_number,
            aadhaar_number,
            bank_name,
            account_number,
            ifsc_code
          )
        `)
        .eq("tenant_id", tenantId)
        .eq("financial_year", financialYear)
        .order("submitted_at", { ascending: false });

      if (error) throw error;
      setDeclarations((data as unknown as ITDeclaration[]) ?? []);
    } catch {
      toastError("Failed to fetch employee declarations.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, financialYear, toastError]);

  useEffect(() => {
    void fetchWindowDetails();
    void fetchDeclarations();
  }, [fetchWindowDetails, fetchDeclarations]);

  // Toggle Window Status (Open/Close)
  const handleToggleWindow = async () => {
    if (!tenantId || !hrEmployee) return;
    setWindowLoading(true);
    try {
      const isOpenNext = !windowInfo?.is_open;
      const opensAt = isOpenNext ? new Date().toISOString() : null;
      const closesAt = isOpenNext && closesAtInput ? new Date(closesAtInput).toISOString() : null;

      const payload = {
        tenant_id: tenantId,
        financial_year: financialYear,
        is_open: isOpenNext,
        opens_at: opensAt,
        closes_at: closesAt,
        opened_by: hrEmployee.id,
      };

      let error;
      if (windowInfo?.id) {
        const { error: err } = await db
          .from("it_declaration_windows")
          .update(payload)
          .eq("id", windowInfo.id);
        error = err;
      } else {
        const { error: err } = await db
          .from("it_declaration_windows")
          .insert([payload]);
        error = err;
      }

      if (error) throw error;

      // STEP 5: Create Notifications for all employees when window opens
      if (isOpenNext) {
        const { data: targets } = await db
          .from("employees")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("status", "active");

        if (targets && targets.length > 0) {
          const formattedClosesAt = closesAt ? new Date(closesAt).toLocaleDateString() : null;
          const { error: notifErr } = await db.from("notifications").insert(
            targets.map(t => ({
              tenant_id: tenantId,
              employee_id: t.id,
              title: "IT Declaration Window is Open",
              body: `Submit your investment declarations for FY ${financialYear}${formattedClosesAt ? ` before ${formattedClosesAt}` : " soon"}.`,
              type: "general"
            }))
          );
          if (notifErr) console.warn("Failed to create notifications:", notifErr);
        }
      }

      success(
        isOpenNext 
          ? `Declaration window opened for FY ${financialYear}. Employees notified.`
          : `Declaration window closed for FY ${financialYear}.`
      );
      void fetchWindowDetails();
    } catch {
      toastError("Failed to update declaration window status.");
    } finally {
      setWindowLoading(false);
    }
  };

  // Verify declaration
  const handleVerifyDeclaration = async () => {
    if (!selectedDecl || !hrEmployee) return;
    setActionLoading(true);
    try {
      const { error } = await db
        .from("it_declarations")
        .update({
          status: "verified_by_hr",
          verified_by: hrEmployee.id,
          verified_at: new Date().toISOString(),
          hr_notes: hrNotes || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedDecl.id);

      if (error) throw error;

      // Notify employee
      await db.from("notifications").insert([{
        tenant_id: tenantId,
        employee_id: selectedDecl.employee_id,
        title: "IT Declaration Verified",
        body: `Your IT declaration for FY ${financialYear} has been verified by HR. Check notes.`,
        type: "general"
      }]);

      success("IT declaration verified successfully.");
      setShowVerifyModal(false);
      setSelectedDecl(null);
      void fetchDeclarations();
      void fetchWindowDetails();
    } catch {
      toastError("Failed to verify declaration.");
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered Declarations
  const filteredDeclarations = useMemo(() => {
    return declarations.filter(d => {
      const matchesSearch = d.employees?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
        d.employees?.email?.toLowerCase().includes(searchTerm.toLowerCase()) || 
        d.employees?.employee_code?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === "all" || d.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [declarations, searchTerm, statusFilter]);

  const formatCurrency = (amt: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(amt);
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">IT Declaration Management</h2>
        <p className="text-sm text-slate-500">Manage tax declaration windows and verify employee investment entries.</p>
      </div>

      {/* Grid: Window controller & Submission Stats */}
      <div className="grid gap-6 md:grid-cols-2">
        
        {/* Window Controller */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-purple-50 text-purple-600">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Declaration Window Control</h3>
              <p className="text-xs text-slate-500">Configure financial year and windows visibility</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Financial Year</label>
              <select
                value={financialYear}
                onChange={(e) => setFinancialYear(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600"
              >
                <option value="2026-27">2026-27</option>
                <option value="2025-26">2025-26</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Optional Closing Date</label>
              <input
                type="datetime-local"
                value={closesAtInput}
                disabled={windowInfo?.is_open}
                onChange={(e) => setClosesAtInput(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              disabled={windowLoading}
              onClick={handleToggleWindow}
              className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition ${
                windowInfo?.is_open 
                  ? "bg-rose-600 hover:bg-rose-700" 
                  : "bg-purple-600 hover:bg-purple-700"
              }`}
            >
              {windowInfo?.is_open ? (
                <>
                  <Lock className="h-4 w-4" />
                  {windowLoading ? "Closing Window..." : "Close Declaration Window"}
                </>
              ) : (
                <>
                  <Unlock className="h-4 w-4" />
                  {windowLoading ? "Opening Window..." : "Open Declaration Window"}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Submission Stats */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div className="space-y-2">
            <h3 className="font-semibold text-slate-800 text-sm">Submission Progress</h3>
            <p className="text-xs text-slate-500">Submissions for active employees in FY {financialYear}</p>
          </div>
          <div className="my-4 flex items-baseline gap-2">
            <span className="text-4xl font-extrabold text-slate-900">{submittedCount}</span>
            <span className="text-sm font-medium text-slate-500">/ {activeEmployeeCount} submitted</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div 
              className="bg-purple-600 h-full transition-all duration-300"
              style={{ width: `${activeEmployeeCount ? (submittedCount / activeEmployeeCount) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
        <div className="relative flex-1">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-4 w-4 text-slate-400" />
          </span>
          <input
            type="text"
            placeholder="Search employee by name, email, code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-purple-600"
        >
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="verified_by_hr">Verified</option>
        </select>
      </div>

      {/* Submissions Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : filteredDeclarations.length === 0 ? (
          <div className="p-10">
            <EmptyState
              icon={FileText}
              title="No declarations found"
              description="No declarations have been made for the selected filter."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3">Employee</th>
                  <th className="px-5 py-3">Regime</th>
                  <th className="px-5 py-3">80C Total</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Submitted On</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 bg-white">
                {filteredDeclarations.map(d => {
                  const total80C = d.ppf_amount + d.lic_premium + d.elss_mutual_fund + d.nsc_amount + d.home_loan_principal + d.tuition_fees + d.other_80c;
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="grid h-8 w-8 place-items-center rounded-full bg-purple-50 text-purple-700 font-bold text-xs uppercase">
                            {d.employees?.full_name?.slice(0, 2) || "?"}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">{d.employees?.full_name || "Unknown"}</p>
                            <p className="text-xs text-slate-500">{d.employees?.employee_code || "N/A"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 uppercase font-semibold text-xs text-slate-600">{d.tax_regime}</td>
                      <td className="px-5 py-4 font-semibold">{formatCurrency(total80C)}</td>
                      <td className="px-5 py-4">
                        {d.status === "verified_by_hr" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                            Verified
                          </span>
                        ) : d.status === "submitted" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                            Submitted
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                            Draft
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500">
                        {d.submitted_at ? new Date(d.submitted_at).toLocaleDateString() : "Not yet"}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDecl(d);
                              setHrNotes(d.hr_notes || "");
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </button>

                          {d.status === "submitted" && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDecl(d);
                                setHrNotes(d.hr_notes || "");
                                setShowVerifyModal(true);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Verify
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* View / Verification Detail Modal */}
      {selectedDecl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedDecl(null)}>
          <div className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 bg-slate-50">
              <div>
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <User className="h-5 w-5 text-purple-600" />
                  Tax Declaration: {selectedDecl.employees?.full_name} ({selectedDecl.financial_year})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Selected regime: {selectedDecl.tax_regime.toUpperCase()}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 bg-white"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Details
                </button>
                <button onClick={() => setSelectedDecl(null)} className="rounded-lg p-1 hover:bg-slate-200">
                  <X className="h-5 w-5 text-slate-500" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Profile overview card */}
              <div className="grid gap-4 sm:grid-cols-2 bg-slate-50 p-4 rounded-xl border border-slate-100 text-xs text-slate-700">
                <div className="space-y-1.5">
                  <p><span className="font-bold text-slate-500">Pan Number:</span> {selectedDecl.employees?.pan_number || "N/A"}</p>
                  <p><span className="font-bold text-slate-500">Aadhaar Number:</span> {selectedDecl.employees?.aadhaar_number || "N/A"}</p>
                </div>
                <div className="space-y-1.5">
                  <p><span className="font-bold text-slate-500">Bank Account:</span> {selectedDecl.employees?.bank_name} ({selectedDecl.employees?.account_number})</p>
                  <p><span className="font-bold text-slate-500">IFSC Code:</span> {selectedDecl.employees?.ifsc_code || "N/A"}</p>
                </div>
              </div>

              {/* Declarations Grid */}
              <div className="grid gap-6 sm:grid-cols-2">
                
                {/* Left Col: Regime deductions */}
                <div className="space-y-4">
                  <h4 className="font-bold text-sm text-slate-800 border-b border-slate-100 pb-2">Old Regime Claims</h4>
                  {selectedDecl.tax_regime === "new" ? (
                    <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-4 text-xs text-slate-500 italic">
                      <AlertTriangle className="h-4.5 w-4.5 text-slate-400 shrink-0" />
                      <span>Employee opted for the New Tax Regime. Custom exemptions/deductions are disabled.</span>
                    </div>
                  ) : (
                    <div className="space-y-3.5 text-xs text-slate-700">
                      <div className="flex justify-between border-b border-slate-100 pb-1.5">
                        <span className="font-medium text-slate-500">PPF Contribution:</span>
                        <span className="font-bold">{formatCurrency(selectedDecl.ppf_amount)}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-1.5">
                        <span className="font-medium text-slate-500">LIC Premium Paid:</span>
                        <span className="font-bold">{formatCurrency(selectedDecl.lic_premium)}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-1.5">
                        <span className="font-medium text-slate-500">ELSS / Mutual Funds:</span>
                        <span className="font-bold">{formatCurrency(selectedDecl.elss_mutual_fund)}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-1.5">
                        <span className="font-medium text-slate-500">NSC Amount:</span>
                        <span className="font-bold">{formatCurrency(selectedDecl.nsc_amount)}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-1.5">
                        <span className="font-medium text-slate-500">Home Loan Principal:</span>
                        <span className="font-bold">{formatCurrency(selectedDecl.home_loan_principal)}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-1.5">
                        <span className="font-medium text-slate-500">Tuition Fees:</span>
                        <span className="font-bold">{formatCurrency(selectedDecl.tuition_fees)}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-1.5">
                        <span className="font-medium text-slate-500">Other 80C Investments:</span>
                        <span className="font-bold">{formatCurrency(selectedDecl.other_80c)}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-200 pb-1.5 bg-slate-50/50 p-2 font-bold text-slate-800">
                        <span>Total Section 80C Claim:</span>
                        <span>
                          {formatCurrency(
                            selectedDecl.ppf_amount + selectedDecl.lic_premium + selectedDecl.elss_mutual_fund + 
                            selectedDecl.nsc_amount + selectedDecl.home_loan_principal + selectedDecl.tuition_fees + selectedDecl.other_80c
                          )}
                        </span>
                      </div>

                      <div className="flex justify-between border-b border-slate-100 pb-1.5 pt-2">
                        <span className="font-medium text-slate-500">Health Insurance (Self):</span>
                        <span className="font-bold">{formatCurrency(selectedDecl.health_insurance_self)}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-1.5">
                        <span className="font-medium text-slate-500">Health Insurance (Parents):</span>
                        <span className="font-bold">{formatCurrency(selectedDecl.health_insurance_parents)}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-1.5 bg-slate-50/50 p-2 font-bold text-slate-800">
                        <span>Total 80D Insurance Claim:</span>
                        <span>{formatCurrency(selectedDecl.health_insurance_self + selectedDecl.health_insurance_parents)}</span>
                      </div>

                      <div className="flex justify-between border-b border-slate-100 pb-1.5 pt-2">
                        <span className="font-medium text-slate-500">Home Loan Interest (Sec 24):</span>
                        <span className="font-bold text-slate-900">{formatCurrency(selectedDecl.home_loan_interest)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Col: HRA, previous employer, reimbursements */}
                <div className="space-y-4">
                  <h4 className="font-bold text-sm text-slate-800 border-b border-slate-100 pb-2">HRA Exemption Claim</h4>
                  {selectedDecl.tax_regime === "new" ? (
                    <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-4 text-xs text-slate-500 italic">
                      <span>No HRA claimed under New Regime.</span>
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs text-slate-700">
                      <div className="flex justify-between">
                        <span className="font-medium text-slate-500">Annual Rent Paid:</span>
                        <span className="font-bold">{formatCurrency(selectedDecl.hra_rent_paid_annual)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-medium text-slate-500">Landlord Name:</span>
                        <span className="font-bold">{selectedDecl.hra_landlord_name || "N/A"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-medium text-slate-500">Landlord PAN:</span>
                        <span className="font-bold uppercase">{selectedDecl.hra_landlord_pan || "N/A"}</span>
                      </div>
                    </div>
                  )}

                  <h4 className="font-bold text-sm text-slate-800 border-b border-slate-100 pb-2 pt-2">Income from Previous Employer</h4>
                  <div className="space-y-2 text-xs text-slate-700">
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-500">Previous Employer:</span>
                      <span className="font-bold">{selectedDecl.prev_employer_name || "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-500">Prev Employer Gross Income:</span>
                      <span className="font-bold">{formatCurrency(selectedDecl.prev_employer_income)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-500">Prev Employer TDS Deducted:</span>
                      <span className="font-bold">{formatCurrency(selectedDecl.prev_employer_tds)}</span>
                    </div>
                  </div>

                  <h4 className="font-bold text-sm text-slate-800 border-b border-slate-100 pb-2 pt-2">Reimbursements</h4>
                  <div className="space-y-2 text-xs text-slate-700">
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-500">Leave Travel Allowance (LTA):</span>
                      <span className="font-bold">{formatCurrency(selectedDecl.lta_amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-500">Medical Reimbursement Projection:</span>
                      <span className="font-bold">{formatCurrency(selectedDecl.medical_reimbursement)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* HR Notes / Verification Entry in View Mode */}
              <div className="border-t border-slate-200 pt-5 space-y-3">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <MessageSquare className="h-4 w-4 text-slate-500" />
                  HR Verification Notes
                </label>
                <textarea
                  rows={2}
                  disabled={selectedDecl.status === "verified_by_hr"}
                  value={hrNotes}
                  onChange={(e) => setHrNotes(e.target.value)}
                  placeholder="Enter verification notes, approvals, or discrepancy descriptions..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-slate-200 px-5 py-4 bg-slate-50 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setSelectedDecl(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 bg-white"
              >
                Close
              </button>
              {selectedDecl.status === "submitted" && (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => setShowVerifyModal(true)}
                  className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-4 py-2 text-sm font-semibold transition"
                >
                  <CheckCircle className="h-4 w-4" />
                  Verify Declaration
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Verify Confirmation Modal */}
      <ConfirmModal
        isOpen={showVerifyModal}
        onClose={() => setShowVerifyModal(false)}
        onConfirm={handleVerifyDeclaration}
        title="Verify IT Declaration"
        message="Are you sure you want to verify this employee's tax declaration? The employee will be notified and this status will be locked."
        confirmText="Verify"
        confirmColor="brand"
      />
    </section>
  );
}
