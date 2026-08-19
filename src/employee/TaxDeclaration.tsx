import { useEffect, useState, useCallback } from "react";
import { 
  ShieldAlert, 
  Calendar, 
  CheckCircle, 
  Copy, 
  Save, 
  Send, 
  ChevronDown, 
  AlertTriangle, 
  Info, 
  Printer,
  ChevronRight
} from "lucide-react";
import { db } from "../insforge/client";
import { useToast } from "../shared/ToastContext";
import { ConfirmModal } from "../shared/ConfirmModal";
import { Skeleton } from "../shared/Skeleton";

// --- Types ---
interface DeclarationWindow {
  id: string;
  financial_year: string;
  is_open: boolean;
  opens_at: string | null;
  closes_at: string | null;
}

interface ITDeclaration {
  id?: string;
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
}

interface TaxDeclarationProps {
  employeeId: string;
  tenantId: string;
}

const DEFAULT_DECLARATION = (tenantId: string, employeeId: string, fy: string): ITDeclaration => ({
  tenant_id: tenantId,
  employee_id: employeeId,
  financial_year: fy,
  tax_regime: "new",
  ppf_amount: 0,
  lic_premium: 0,
  elss_mutual_fund: 0,
  nsc_amount: 0,
  home_loan_principal: 0,
  tuition_fees: 0,
  other_80c: 0,
  health_insurance_self: 0,
  health_insurance_parents: 0,
  hra_rent_paid_annual: 0,
  hra_landlord_name: "",
  hra_landlord_pan: "",
  home_loan_interest: 0,
  prev_employer_income: 0,
  prev_employer_tds: 0,
  prev_employer_name: "",
  lta_amount: 0,
  medical_reimbursement: 0,
  status: "draft",
  submitted_at: null,
  verified_by: null,
  verified_at: null,
  hr_notes: null,
});

export default function TaxDeclaration({ employeeId, tenantId }: TaxDeclarationProps) {
  const { success, error: toastError } = useToast();

  // Navigation tabs: 'overview', 'deductions', 'prev_employer', 'reimbursements', 'forms'
  const [activeTab, setActiveTab] = useState<"overview" | "deductions" | "prev_employer" | "reimbursements" | "forms">("overview");
  
  // Available Financial Years from windows
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState<string>("2026-27");
  const [windowInfo, setWindowInfo] = useState<DeclarationWindow | null>(null);
  
  // Declaration Form state
  const [declaration, setDeclaration] = useState<ITDeclaration | null>(null);
  const [hasPreviousYearDecl, setHasPreviousYearDecl] = useState(false);
  const [hasHraComponent, setHasHraComponent] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  // Accordion toggle states for Deductions Tab
  const [openAccordions, setOpenAccordions] = useState<Record<string, boolean>>({
    sec80c: true,
    sec80d: false,
    hra: false,
    sec24: false,
  });

  const toggleAccordion = (section: string) => {
    setOpenAccordions(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Check if HRA is in employee's active salary structure
  const checkHraComponent = useCallback(async () => {
    try {
      const { data } = await db
        .from("salary_structures")
        .select("hra_percent")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employeeId)
        .order("effective_from", { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        setHasHraComponent((data[0] as { hra_percent: number }).hra_percent > 0);
      } else {
        setHasHraComponent(false);
      }
    } catch (err) {
      console.error("Error checking HRA component", err);
    }
  }, [tenantId, employeeId]);

  // Fetch available years from it_declaration_windows
  const fetchAvailableYears = useCallback(async () => {
    try {
      const { data, error } = await db
        .from("it_declaration_windows")
        .select("financial_year, is_open, opens_at, closes_at")
        .eq("tenant_id", tenantId)
        .order("financial_year", { ascending: false });

      if (error) throw error;
      
      const years = (data ?? []).map(d => d.financial_year);
      if (years.length > 0) {
        setAvailableYears(years);
        // Default to the first year (usually latest) or current local default
        if (!years.includes(selectedYear)) {
          setSelectedYear(years[0]);
        }
      } else {
        // Fallback default years
        setAvailableYears(["2026-27", "2025-26"]);
      }
    } catch {
      setAvailableYears(["2026-27", "2025-26"]);
    }
  }, [tenantId, selectedYear]);

  // Fetch window status for selected FY
  const fetchWindowAndDeclaration = useCallback(async () => {
    if (!tenantId || !employeeId) return;
    setLoading(true);
    try {
      // 1. Fetch Window info
      const { data: winData } = await db
        .from("it_declaration_windows")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("financial_year", selectedYear)
        .maybeSingle();
      
      setWindowInfo((winData as DeclarationWindow) || null);

      // 2. Fetch Declaration details
      const { data: declData, error: declErr } = await db
        .from("it_declarations")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employeeId)
        .eq("financial_year", selectedYear)
        .maybeSingle();

      if (declErr) throw declErr;

      if (declData) {
        setDeclaration(declData as ITDeclaration);
      } else {
        setDeclaration(DEFAULT_DECLARATION(tenantId, employeeId, selectedYear));
      }

      // 3. Check for previous year declaration to enable "Copy From Previous"
      const prevYearStr = getPreviousYearStr(selectedYear);
      const { count } = await db
        .from("it_declarations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("employee_id", employeeId)
        .eq("financial_year", prevYearStr);

      setHasPreviousYearDecl((count ?? 0) > 0);
    } catch (err) {
      console.error(err);
      toastError("Failed to fetch IT declaration info.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, employeeId, selectedYear, toastError]);

  useEffect(() => {
    void fetchAvailableYears();
    void checkHraComponent();
  }, [fetchAvailableYears, checkHraComponent]);

  useEffect(() => {
    void fetchWindowAndDeclaration();
  }, [fetchWindowAndDeclaration]);

  const getPreviousYearStr = (fy: string) => {
    const parts = fy.split("-");
    if (parts.length === 2) {
      const yr1 = parseInt(parts[0], 10);
      const yr2 = parseInt(parts[1], 10);
      if (!isNaN(yr1) && !isNaN(yr2)) {
        return `${yr1 - 1}-${(yr2 - 1).toString().padStart(2, "0")}`;
      }
    }
    return "2025-26";
  };

  const handleInputChange = (field: keyof ITDeclaration, value: any) => {
    if (!declaration) return;
    setDeclaration({
      ...declaration,
      [field]: value
    });
  };

  const handleNumberInputChange = (field: keyof ITDeclaration, valStr: string) => {
    if (!declaration) return;
    const val = parseFloat(valStr) || 0;
    setDeclaration({
      ...declaration,
      [field]: Math.max(0, val)
    });
  };

  // Copy values from previous year
  const handleCopyFromPrevious = async () => {
    if (!declaration) return;
    const prevYearStr = getPreviousYearStr(selectedYear);
    try {
      const { data, error } = await db
        .from("it_declarations")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employeeId)
        .eq("financial_year", prevYearStr)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const prev = data as ITDeclaration;
        setDeclaration({
          ...declaration,
          tax_regime: prev.tax_regime,
          ppf_amount: prev.ppf_amount,
          lic_premium: prev.lic_premium,
          elss_mutual_fund: prev.elss_mutual_fund,
          nsc_amount: prev.nsc_amount,
          home_loan_principal: prev.home_loan_principal,
          tuition_fees: prev.tuition_fees,
          other_80c: prev.other_80c,
          health_insurance_self: prev.health_insurance_self,
          health_insurance_parents: prev.health_insurance_parents,
          hra_rent_paid_annual: prev.hra_rent_paid_annual,
          hra_landlord_name: prev.hra_landlord_name || "",
          hra_landlord_pan: prev.hra_landlord_pan || "",
          home_loan_interest: prev.home_loan_interest,
          prev_employer_income: prev.prev_employer_income,
          prev_employer_tds: prev.prev_employer_tds,
          prev_employer_name: prev.prev_employer_name || "",
          lta_amount: prev.lta_amount,
          medical_reimbursement: prev.medical_reimbursement,
        });
        success(`Values copied from ${prevYearStr} declaration. Review and update.`);
      } else {
        toastError("No declaration found for the previous year.");
      }
    } catch {
      toastError("Failed to copy previous year values.");
    }
  };

  // Save as Draft
  const handleSaveDraft = async () => {
    if (!declaration) return;
    setSaving(true);
    try {
      const payload = {
        ...declaration,
        status: "draft",
        updated_at: new Date().toISOString(),
      };

      let error;
      if (declaration.id) {
        const { error: err } = await db
          .from("it_declarations")
          .update(payload)
          .eq("id", declaration.id);
        error = err;
      } else {
        const { error: err } = await db
          .from("it_declarations")
          .insert([payload]);
        error = err;
      }

      if (error) throw error;
      success("Declaration saved as draft successfully.");
      void fetchWindowAndDeclaration();
    } catch (err) {
      console.error(err);
      toastError("Failed to save draft declaration.");
    } finally {
      setSaving(false);
    }
  };

  // Submit Declaration
  const handleSubmit = async () => {
    if (!declaration) return;
    setSaving(true);
    try {
      const payload = {
        ...declaration,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      let error;
      if (declaration.id) {
        const { error: err } = await db
          .from("it_declarations")
          .update(payload)
          .eq("id", declaration.id);
        error = err;
      } else {
        const { error: err } = await db
          .from("it_declarations")
          .insert([payload]);
        error = err;
      }

      if (error) throw error;
      success("Declaration submitted successfully to HR.");
      setShowSubmitModal(false);
      void fetchWindowAndDeclaration();
    } catch (err) {
      console.error(err);
      toastError("Failed to submit declaration.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isWindowOpen = windowInfo?.is_open === true;
  const isSubmitted = declaration?.status === "submitted" || declaration?.status === "verified_by_hr";
  const isReadOnly = !isWindowOpen || isSubmitted;

  // Running totals
  const total80C = declaration 
    ? (declaration.ppf_amount + declaration.lic_premium + declaration.elss_mutual_fund + 
       declaration.nsc_amount + declaration.home_loan_principal + declaration.tuition_fees + declaration.other_80c)
    : 0;

  const total80D = declaration
    ? (declaration.health_insurance_self + declaration.health_insurance_parents)
    : 0;

  const progressPercent80C = Math.min(100, (total80C / 150000) * 100);

  // Formatting currency
  const formatCurrency = (amt: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(amt);
  };

  return (
    <div className="space-y-6">
      {/* Top Selector & Window Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-purple-50 text-purple-600">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">Financial Year Selector</h3>
            <p className="text-xs text-slate-500">Select financial year to view/edit declarations</p>
          </div>
        </div>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(e.target.value)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-200"
        >
          {availableYears.map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
      </div>

      {/* Warnings & Status Info */}
      {!isWindowOpen ? (
        <div className="flex items-start gap-3.5 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 shadow-sm">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600 animate-pulse" />
          <div>
            <h4 className="font-bold text-red-900 leading-tight">Declaration Window is not yet open</h4>
            <p className="mt-1 text-sm text-red-700">
              The IT declaration window is currently closed for FY {selectedYear}. Please contact your HR department.
              You can review your details in read-only mode below.
            </p>
          </div>
        </div>
      ) : isSubmitted ? (
        <div className="flex items-start gap-3.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800 shadow-sm">
          <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <h4 className="font-bold text-emerald-900 leading-tight">
              Declaration {declaration?.status === "verified_by_hr" ? "Verified by HR" : "Submitted"}
            </h4>
            <p className="mt-1 text-sm text-emerald-700">
              You submitted your declarations for FY {selectedYear} on{" "}
              {declaration?.submitted_at ? new Date(declaration.submitted_at).toLocaleDateString() : "N/A"}.
              {declaration?.status === "verified_by_hr" && (
                <span className="block mt-1 font-semibold text-emerald-900">
                  Verification completed. Check verification notes under overview.
                </span>
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-2xl border border-purple-200 bg-purple-50/50 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 text-purple-900">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-purple-600" />
            <div>
              <h4 className="font-semibold leading-tight text-purple-900">Declaration window is open</h4>
              <p className="mt-0.5 text-xs text-purple-700">
                {windowInfo?.closes_at 
                  ? `Declaration window closes on ${new Date(windowInfo.closes_at).toLocaleDateString()}. Submit before then.`
                  : "Submit your declaration for HR review and TDS setup."}
              </p>
            </div>
          </div>
          {hasPreviousYearDecl && (
            <button
              type="button"
              onClick={handleCopyFromPrevious}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-purple-200 bg-white px-4 py-2 text-xs font-semibold text-purple-700 shadow-sm hover:bg-purple-50 transition"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy From Previous Year
            </button>
          )}
        </div>
      )}

      {/* Tax Regime Selector Section */}
      {declaration && !isReadOnly && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4">Tax Regime Choice</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* New Regime Card */}
            <label className={`relative flex cursor-pointer flex-col rounded-xl border p-4 transition ${declaration.tax_regime === "new" ? "border-purple-600 bg-purple-50/30 ring-2 ring-purple-100" : "border-slate-200 hover:bg-slate-50"}`}>
              <input
                type="radio"
                name="tax_regime"
                value="new"
                checked={declaration.tax_regime === "new"}
                onChange={() => handleInputChange("tax_regime", "new")}
                className="sr-only"
              />
              <span className="font-bold text-slate-800 text-sm">New Tax Regime (Default)</span>
              <span className="mt-1 text-xs text-slate-500">Lower tax rates, standard deductions apply. No customized deductions (80C, 80D, HRA) allowed.</span>
            </label>

            {/* Old Regime Card */}
            <label className={`relative flex cursor-pointer flex-col rounded-xl border p-4 transition ${declaration.tax_regime === "old" ? "border-purple-600 bg-purple-50/30 ring-2 ring-purple-100" : "border-slate-200 hover:bg-slate-50"}`}>
              <input
                type="radio"
                name="tax_regime"
                value="old"
                checked={declaration.tax_regime === "old"}
                onChange={() => handleInputChange("tax_regime", "old")}
                className="sr-only"
              />
              <span className="font-bold text-slate-800 text-sm">Old Tax Regime</span>
              <span className="mt-1 text-xs text-slate-500">Higher tax rates, but allows claims under Section 80C, 80D, Home Loan Interest, and HRA.</span>
            </label>
          </div>
          {declaration.tax_regime === "new" && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>Note: Changing to the Old Regime enables the Deductions section below.</span>
            </div>
          )}
        </div>
      )}

      {/* Main Tabs Navigation */}
      <div className="border-b border-slate-200 bg-white px-2 pt-2 rounded-t-2xl shadow-sm">
        <nav className="flex space-x-4">
          {[
            { id: "overview", label: "Overview" },
            { id: "deductions", label: "Deductions (80C, 80D, HRA)", disabled: declaration?.tax_regime === "new" },
            { id: "prev_employer", label: "Previous Employer" },
            { id: "reimbursements", label: "Reimbursements" },
            { id: "forms", label: "Forms / Export" }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => !t.disabled && setActiveTab(t.id as any)}
              disabled={t.disabled}
              className={`pb-3 px-3 text-sm font-semibold border-b-2 transition-all ${
                activeTab === t.id
                  ? "border-purple-600 text-purple-700" 
                  : t.disabled
                    ? "border-transparent text-slate-300 cursor-not-allowed"
                    : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Contents */}
      {declaration && (
        <div className="min-h-[400px]">
          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs text-slate-500">Selected Tax Regime</p>
                  <p className="mt-1 text-xl font-bold uppercase text-slate-800">
                    {declaration.tax_regime} Regime
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs text-slate-500">Total Deductions Declared</p>
                  <p className="mt-1 text-xl font-bold text-slate-800">
                    {declaration.tax_regime === "old" 
                      ? formatCurrency(total80C + total80D + declaration.hra_rent_paid_annual + declaration.home_loan_interest)
                      : "₹0 (New Regime)"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs text-slate-500">Declaration Status</p>
                  <p className="mt-1 flex items-center gap-1.5 text-lg font-bold capitalize">
                    {declaration.status === "verified_by_hr" ? (
                      <span className="text-emerald-700">Verified by HR</span>
                    ) : declaration.status === "submitted" ? (
                      <span className="text-purple-700">Submitted</span>
                    ) : (
                      <span className="text-amber-700">Draft</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Summary Table */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-5 py-3">Section Description</th>
                      <th className="px-5 py-3">Eligible Regime</th>
                      <th className="px-5 py-3 text-right">Declared Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {declaration.tax_regime === "old" && (
                      <>
                        <tr>
                          <td className="px-5 py-4 font-medium text-slate-900">Section 80C Deductions</td>
                          <td className="px-5 py-4 text-purple-700 font-semibold">Old Regime Only</td>
                          <td className="px-5 py-4 text-right font-semibold">{formatCurrency(total80C)}</td>
                        </tr>
                        <tr>
                          <td className="px-5 py-4 font-medium text-slate-900">Section 80D Health Insurance</td>
                          <td className="px-5 py-4 text-purple-700 font-semibold">Old Regime Only</td>
                          <td className="px-5 py-4 text-right font-semibold">{formatCurrency(total80D)}</td>
                        </tr>
                        <tr>
                          <td className="px-5 py-4 font-medium text-slate-900">House Rent Allowance (HRA)</td>
                          <td className="px-5 py-4 text-purple-700 font-semibold">Old Regime Only</td>
                          <td className="px-5 py-4 text-right font-semibold">{formatCurrency(declaration.hra_rent_paid_annual)}</td>
                        </tr>
                        <tr>
                          <td className="px-5 py-4 font-medium text-slate-900">Home Loan Interest (Section 24)</td>
                          <td className="px-5 py-4 text-purple-700 font-semibold">Old Regime Only</td>
                          <td className="px-5 py-4 text-right font-semibold">{formatCurrency(declaration.home_loan_interest)}</td>
                        </tr>
                      </>
                    )}
                    <tr>
                      <td className="px-5 py-4 font-medium text-slate-900">Income from Previous Employer</td>
                      <td className="px-5 py-4 text-slate-500">Both Regimes</td>
                      <td className="px-5 py-4 text-right font-semibold">{formatCurrency(declaration.prev_employer_income)}</td>
                    </tr>
                    <tr>
                      <td className="px-5 py-4 font-medium text-slate-900">Reimbursements (LTA & Medical)</td>
                      <td className="px-5 py-4 text-slate-500">Both Regimes</td>
                      <td className="px-5 py-4 text-right font-semibold">{formatCurrency(declaration.lta_amount + declaration.medical_reimbursement)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* HR Notes / Feedback if verified or rejected */}
              {declaration.hr_notes && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                  <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Info className="h-4.5 w-4.5 text-slate-500" />
                    HR Verification Notes
                  </h4>
                  <p className="mt-2 text-sm text-slate-600 whitespace-pre-wrap">{declaration.hr_notes}</p>
                </div>
              )}

              {/* Action Buttons */}
              {!isReadOnly && (
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveDraft}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                  >
                    <Save className="h-4 w-4" />
                    Save as Draft
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setShowSubmitModal(true)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition"
                  >
                    <Send className="h-4 w-4" />
                    Submit Declaration
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: DEDUCTIONS */}
          {activeTab === "deductions" && declaration.tax_regime === "old" && (
            <div className="space-y-4">
              
              {/* SECTION 80C */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleAccordion("sec80c")}
                  className="flex w-full items-center justify-between bg-slate-50 px-5 py-4 text-left font-bold text-slate-800 hover:bg-slate-100/70"
                >
                  <div className="flex flex-col gap-1">
                    <span>Section 80C Deductions</span>
                    <span className="text-xs font-normal text-slate-500">
                      Provident Fund, LIC Premium, ELSS, NSC, Home Loan Principal, Tuition fees. Limit: {formatCurrency(150000)}
                    </span>
                  </div>
                  {openAccordions.sec80c ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </button>
                
                {openAccordions.sec80c && (
                  <div className="p-5 border-t border-slate-200 space-y-4">
                    {/* Limit Progress Bar */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-500">Total declared 80C:</span>
                        <span className="font-bold text-purple-700">
                          {formatCurrency(total80C)} / {formatCurrency(150000)}
                        </span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-purple-600 transition-all duration-300"
                          style={{ width: `${progressPercent80C}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      {[
                        { key: "ppf_amount", label: "Public Provident Fund (PPF)" },
                        { key: "lic_premium", label: "LIC Insurance Premium" },
                        { key: "elss_mutual_fund", label: "ELSS / Tax-saving Mutual Funds" },
                        { key: "nsc_amount", label: "National Savings Certificate (NSC)" },
                        { key: "home_loan_principal", label: "Home Loan Principal Repayment" },
                        { key: "tuition_fees", label: "Tuition Fees (Children education)" },
                        { key: "other_80c", label: "Other Section 80C Investments" },
                      ].map(field => (
                        <div key={field.key}>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-700">{field.label}</label>
                          <div className="relative rounded-lg shadow-sm">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                              <span className="text-slate-500 sm:text-sm">₹</span>
                            </div>
                            <input
                              type="number"
                              disabled={isReadOnly}
                              value={declaration[field.key as keyof ITDeclaration] || 0}
                              onChange={(e) => handleNumberInputChange(field.key as keyof ITDeclaration, e.target.value)}
                              className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 80D */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleAccordion("sec80d")}
                  className="flex w-full items-center justify-between bg-slate-50 px-5 py-4 text-left font-bold text-slate-800 hover:bg-slate-100/70"
                >
                  <div className="flex flex-col gap-1">
                    <span>Section 80D Health Insurance</span>
                    <span className="text-xs font-normal text-slate-500">
                      Medical insurance premium. Limit: Self + Family ({formatCurrency(25000)}), Parents ({formatCurrency(50000)})
                    </span>
                  </div>
                  {openAccordions.sec80d ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </button>
                
                {openAccordions.sec80d && (
                  <div className="p-5 border-t border-slate-200 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Health Insurance Premium (Self + Family) (Max ₹25k)</label>
                        <div className="relative rounded-lg shadow-sm">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <span className="text-slate-500 sm:text-sm">₹</span>
                          </div>
                          <input
                            type="number"
                            disabled={isReadOnly}
                            value={declaration.health_insurance_self}
                            onChange={(e) => handleNumberInputChange("health_insurance_self", e.target.value)}
                            className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Health Insurance Premium (Parents) (Max ₹50k)</label>
                        <div className="relative rounded-lg shadow-sm">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <span className="text-slate-500 sm:text-sm">₹</span>
                          </div>
                          <input
                            type="number"
                            disabled={isReadOnly}
                            value={declaration.health_insurance_parents}
                            onChange={(e) => handleNumberInputChange("health_insurance_parents", e.target.value)}
                            className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* HOUSE RENT ALLOWANCE (HRA) */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleAccordion("hra")}
                  className="flex w-full items-center justify-between bg-slate-50 px-5 py-4 text-left font-bold text-slate-800 hover:bg-slate-100/70"
                >
                  <div className="flex flex-col gap-1">
                    <span>House Rent Allowance (HRA)</span>
                    <span className="text-xs font-normal text-slate-500">
                      Exemption for rent paid. Requires landlord details if rent exceeds {formatCurrency(100000)} per year.
                    </span>
                  </div>
                  {openAccordions.hra ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </button>
                
                {openAccordions.hra && (
                  <div className="p-5 border-t border-slate-200 space-y-4">
                    {!hasHraComponent ? (
                      <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                        <span>Your active salary structure does not contain an HRA component. HRA declarations are disabled.</span>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div>
                            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Annual Rent Paid</label>
                            <div className="relative rounded-lg shadow-sm">
                              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                <span className="text-slate-500 sm:text-sm">₹</span>
                              </div>
                              <input
                                type="number"
                                disabled={isReadOnly}
                                value={declaration.hra_rent_paid_annual}
                                onChange={(e) => handleNumberInputChange("hra_rent_paid_annual", e.target.value)}
                                className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Landlord Name</label>
                            <input
                              type="text"
                              disabled={isReadOnly}
                              value={declaration.hra_landlord_name}
                              onChange={(e) => handleInputChange("hra_landlord_name", e.target.value)}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Landlord PAN</label>
                            <input
                              type="text"
                              disabled={isReadOnly}
                              value={declaration.hra_landlord_pan}
                              onChange={(e) => handleInputChange("hra_landlord_pan", e.target.value)}
                              placeholder="Required if rent > ₹1L/year"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500 uppercase"
                            />
                          </div>
                        </div>

                        {declaration.hra_rent_paid_annual > 100000 && !declaration.hra_landlord_pan && (
                          <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                            <span>Warning: Landlord PAN is legally required under income tax rules for annual rent exceeding ₹1,00,000.</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* HOME LOAN INTEREST (SECTION 24) */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleAccordion("sec24")}
                  className="flex w-full items-center justify-between bg-slate-50 px-5 py-4 text-left font-bold text-slate-800 hover:bg-slate-100/70"
                >
                  <div className="flex flex-col gap-1">
                    <span>Home Loan Interest (Section 24)</span>
                    <span className="text-xs font-normal text-slate-500">
                      Interest on home loans for self-occupied property. Limit: {formatCurrency(200000)}
                    </span>
                  </div>
                  {openAccordions.sec24 ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </button>
                
                {openAccordions.sec24 && (
                  <div className="p-5 border-t border-slate-200 space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-700">Interest Payable on Home Loan (Max ₹2,00,000)</label>
                      <div className="relative rounded-lg shadow-sm">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                          <span className="text-slate-500 sm:text-sm">₹</span>
                        </div>
                        <input
                          type="number"
                          disabled={isReadOnly}
                          value={declaration.home_loan_interest}
                          onChange={(e) => handleNumberInputChange("home_loan_interest", e.target.value)}
                          className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              {!isReadOnly && (
                <div className="flex items-center justify-end gap-3 mt-4">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveDraft}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                  >
                    <Save className="h-4 w-4" />
                    Save Draft
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PREVIOUS EMPLOYER */}
          {activeTab === "prev_employer" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-6">
              <div>
                <h4 className="font-semibold text-slate-800">Previous Employer Income Details</h4>
                <p className="text-xs text-slate-500 mt-0.5">Required if you joined TalentMesh mid-year during this financial year.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">Previous Employer Name</label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={declaration.prev_employer_name}
                    onChange={(e) => handleInputChange("prev_employer_name", e.target.value)}
                    placeholder="e.g. Acme Corp"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">Gross Income from Prev Employer</label>
                  <div className="relative rounded-lg shadow-sm">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <span className="text-slate-500 sm:text-sm">₹</span>
                    </div>
                    <input
                      type="number"
                      disabled={isReadOnly}
                      value={declaration.prev_employer_income}
                      onChange={(e) => handleNumberInputChange("prev_employer_income", e.target.value)}
                      className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">TDS Deducted by Prev Employer</label>
                  <div className="relative rounded-lg shadow-sm">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <span className="text-slate-500 sm:text-sm">₹</span>
                    </div>
                    <input
                      type="number"
                      disabled={isReadOnly}
                      value={declaration.prev_employer_tds}
                      onChange={(e) => handleNumberInputChange("prev_employer_tds", e.target.value)}
                      className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                </div>
              </div>

              {!isReadOnly && (
                <div className="flex justify-end mt-4">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveDraft}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                  >
                    <Save className="h-4 w-4" />
                    Save Draft
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: REIMBURSEMENTS */}
          {activeTab === "reimbursements" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-6">
              <div>
                <h4 className="font-semibold text-slate-800">Reimbursement Projections</h4>
                <p className="text-xs text-slate-500 mt-0.5">Declare your projected reimbursement claims (LTA and Medical claims).</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">Leave Travel Allowance (LTA)</label>
                  <div className="relative rounded-lg shadow-sm">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <span className="text-slate-500 sm:text-sm">₹</span>
                    </div>
                    <input
                      type="number"
                      disabled={isReadOnly}
                      value={declaration.lta_amount}
                      onChange={(e) => handleNumberInputChange("lta_amount", e.target.value)}
                      className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">Medical Reimbursement Projection</label>
                  <div className="relative rounded-lg shadow-sm">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <span className="text-slate-500 sm:text-sm">₹</span>
                    </div>
                    <input
                      type="number"
                      disabled={isReadOnly}
                      value={declaration.medical_reimbursement}
                      onChange={(e) => handleNumberInputChange("medical_reimbursement", e.target.value)}
                      className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm text-slate-800 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                </div>
              </div>

              {!isReadOnly && (
                <div className="flex justify-end mt-4">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveDraft}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                  >
                    <Save className="h-4 w-4" />
                    Save Draft
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: FORMS / PRINT EXPORT */}
          {activeTab === "forms" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-semibold text-slate-800">IT Declaration PDF/Print Statement</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Export a print-ready version of your declarations for your records.</p>
                </div>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-700 transition shadow-sm"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Declaration
                </button>
              </div>

              {/* Printable Area Layout */}
              <div className="border border-slate-200 rounded-xl p-6 bg-slate-50/50 print:bg-white print:border-none print:p-0">
                <div className="text-center pb-6 border-b border-slate-200 print:pb-4">
                  <h2 className="text-lg font-bold text-slate-900">INCOME TAX INVESTMENT DECLARATION</h2>
                  <p className="text-xs text-slate-500 mt-1">Financial Year: {declaration.financial_year}</p>
                  <p className="text-xs text-slate-500 uppercase">Regime Option: {declaration.tax_regime} Regime</p>
                </div>

                <div className="grid grid-cols-2 gap-4 py-6 border-b border-slate-200 text-xs text-slate-600 print:py-4">
                  <div>
                    <span className="font-semibold text-slate-500">Employee ID:</span> {employeeId}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500">Submission Date:</span>{" "}
                    {declaration.submitted_at ? new Date(declaration.submitted_at).toLocaleDateString() : "Draft - Not Submitted"}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500">Tenant ID:</span> {tenantId}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500">Status:</span>{" "}
                    <span className="font-semibold capitalize text-slate-900">{declaration.status}</span>
                  </div>
                </div>

                <div className="py-6 space-y-4 print:py-4">
                  <h4 className="font-bold text-xs text-slate-800 uppercase tracking-wider">Declaration Summary</h4>
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-300 text-slate-500">
                        <th className="py-2">Investment Component</th>
                        <th className="py-2 text-right">Declared Amount (INR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-700">
                      {declaration.tax_regime === "old" ? (
                        <>
                          <tr>
                            <td className="py-2">PPF Contribution (80C)</td>
                            <td className="py-2 text-right">{formatCurrency(declaration.ppf_amount)}</td>
                          </tr>
                          <tr>
                            <td className="py-2">LIC Premium (80C)</td>
                            <td className="py-2 text-right">{formatCurrency(declaration.lic_premium)}</td>
                          </tr>
                          <tr>
                            <td className="py-2">ELSS Mutual Funds (80C)</td>
                            <td className="py-2 text-right">{formatCurrency(declaration.elss_mutual_fund)}</td>
                          </tr>
                          <tr>
                            <td className="py-2">NSC Amount (80C)</td>
                            <td className="py-2 text-right">{formatCurrency(declaration.nsc_amount)}</td>
                          </tr>
                          <tr>
                            <td className="py-2">Home Loan Principal (80C)</td>
                            <td className="py-2 text-right">{formatCurrency(declaration.home_loan_principal)}</td>
                          </tr>
                          <tr>
                            <td className="py-2">Tuition Fees (80C)</td>
                            <td className="py-2 text-right">{formatCurrency(declaration.tuition_fees)}</td>
                          </tr>
                          <tr>
                            <td className="py-2">Other 80C Investments</td>
                            <td className="py-2 text-right">{formatCurrency(declaration.other_80c)}</td>
                          </tr>
                          <tr className="font-semibold text-slate-900 bg-slate-100/50">
                            <td className="py-2 pl-2">Total Section 80C</td>
                            <td className="py-2 pr-2 text-right">{formatCurrency(total80C)}</td>
                          </tr>
                          <tr>
                            <td className="py-2">Health Insurance (Self/Family) (80D)</td>
                            <td className="py-2 text-right">{formatCurrency(declaration.health_insurance_self)}</td>
                          </tr>
                          <tr>
                            <td className="py-2">Health Insurance (Parents) (80D)</td>
                            <td className="py-2 text-right">{formatCurrency(declaration.health_insurance_parents)}</td>
                          </tr>
                          <tr>
                            <td className="py-2">Annual Rent Paid (HRA)</td>
                            <td className="py-2 text-right">{formatCurrency(declaration.hra_rent_paid_annual)}</td>
                          </tr>
                          <tr>
                            <td className="py-2">Home Loan Interest (Section 24)</td>
                            <td className="py-2 text-right">{formatCurrency(declaration.home_loan_interest)}</td>
                          </tr>
                        </>
                      ) : (
                        <tr>
                          <td className="py-2 text-slate-500 italic" colSpan={2}>
                            No tax exemptions/deductions claimed under New Regime option.
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td className="py-2">Income from Previous Employer</td>
                        <td className="py-2 text-right">{formatCurrency(declaration.prev_employer_income)}</td>
                      </tr>
                      <tr>
                        <td className="py-2">Leave Travel Allowance (LTA)</td>
                        <td className="py-2 text-right">{formatCurrency(declaration.lta_amount)}</td>
                      </tr>
                      <tr>
                        <td className="py-2">Medical Reimbursement Claim</td>
                        <td className="py-2 text-right">{formatCurrency(declaration.medical_reimbursement)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="pt-6 border-t border-slate-200 flex flex-col gap-4 text-xs text-slate-500">
                  <p>
                    I hereby declare that the details furnished above are true and correct to the best of my knowledge and belief.
                    In case any of the information is found to be false, untrue or misrepresenting, I am aware that I may be held liable for it.
                  </p>
                  <div className="flex items-center justify-between pt-6">
                    <div>
                      <div className="h-px w-36 bg-slate-300 mb-1" />
                      <span>Employee Signature</span>
                    </div>
                    <div>
                      <div className="h-px w-36 bg-slate-300 mb-1" />
                      <span>Date</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        onConfirm={handleSubmit}
        title="Submit IT Declaration"
        message={`Are you sure you want to submit your tax declaration for FY ${selectedYear}? Once submitted, you cannot make changes and your HR will be notified.`}
        confirmText="Submit"
        confirmColor="brand"
      />
    </div>
  );
}
