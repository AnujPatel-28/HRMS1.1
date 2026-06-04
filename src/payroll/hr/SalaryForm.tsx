import { useMemo, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useTenant } from "../../contexts/TenantContext";
import { useEmployee } from "../../hooks/useEmployee";
import { useAuditLog } from "../../hooks/useAuditLog";
import { db } from "../../insforge/client";
import { useToast } from "../../shared/ToastContext";
import type { Employee } from "../../types";
import type { SalaryStructure } from "./SalaryStructures";
import { formatLocalDate } from "../../utils/date";

type SalaryFormProps = {
  employee: Employee;
  structure: SalaryStructure | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

// Business-calendar date helper — uses local timezone.
// toISOString() would return yesterday's date for IST users before 05:30,
// causing salary structures to be effective-dated to the wrong month.
const today = () => formatLocalDate(new Date());

const toNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.round(value));

function calculateBreakdown(values: {
  ctcAnnual: number;
  basicPercent: number;
  hraPercent: number;
  specialAllowance: number;
  otherAllowances: number;
  pfApplicable: boolean;
  esiApplicable: boolean;
  tdsMonthly: number;
}) {
  const monthlyCtc = values.ctcAnnual / 12;
  const basicMonthly = monthlyCtc * (values.basicPercent / 100);
  const hraMonthly = basicMonthly * (values.hraPercent / 100);
  const grossMonthly = basicMonthly + hraMonthly + values.specialAllowance + values.otherAllowances;
  const pfEmployee = values.pfApplicable ? basicMonthly * 0.12 : 0;
  const pfEmployer = values.pfApplicable ? Math.min(basicMonthly, 15000) * 0.12 : 0;
  const esiEmployee = values.esiApplicable && grossMonthly <= 21000 ? grossMonthly * 0.0075 : 0;
  const esiEmployer = values.esiApplicable && grossMonthly <= 21000 ? grossMonthly * 0.0325 : 0;
  const netMonthly = grossMonthly - pfEmployee - esiEmployee - values.tdsMonthly;
  const calculatedCost = grossMonthly + pfEmployer + esiEmployer;
  const variance = calculatedCost - monthlyCtc;

  return {
    monthlyCtc,
    basicMonthly,
    hraMonthly,
    grossMonthly,
    pfEmployee,
    pfEmployer,
    esiEmployee,
    esiEmployer,
    netMonthly,
    calculatedCost,
    variance,
  };
}

export function SalaryForm({ employee, structure, onClose, onSaved }: SalaryFormProps) {
  const { tenantId } = useTenant();
  const { employee: currentEmployee } = useEmployee();
  const { logAction } = useAuditLog();
  const { success, error: toastError } = useToast();
  const [mode, setMode] = useState<"auto" | "manual">(structure ? "manual" : "auto");
  const [ctcAnnual, setCtcAnnual] = useState(String(structure?.ctc_annual ?? ""));
  const [basicPercent, setBasicPercent] = useState(String(structure?.basic_percent ?? 40));
  const [hraPercent, setHraPercent] = useState(String(structure?.hra_percent ?? 50));
  const [specialAllowance, setSpecialAllowance] = useState(String(structure?.special_allowance ?? 0));
  const [otherAllowances, setOtherAllowances] = useState(String(structure?.other_allowances ?? 0));
  const [pfApplicable, setPfApplicable] = useState(structure?.pf_applicable ?? true);
  const [esiApplicable, setEsiApplicable] = useState(structure?.esi_applicable ?? false);
  const [tdsMonthly, setTdsMonthly] = useState(String(structure?.tds_monthly ?? 0));
  const [effectiveFrom, setEffectiveFrom] = useState(structure?.effective_from ?? today());
  const [saving, setSaving] = useState(false);

  const autoSpecialAllowance = useMemo(() => {
    const annual = toNumber(ctcAnnual);
    const monthlyCtc = annual / 12;
    const basicPct = toNumber(basicPercent);
    const hraPct = toNumber(hraPercent);
    const other = toNumber(otherAllowances);
    
    const basicMonthly = monthlyCtc * (basicPct / 100);
    const hraMonthly = basicMonthly * (hraPct / 100);
    const pfEmployer = pfApplicable ? Math.min(basicMonthly, 15000) * 0.12 : 0;
    
    let allowance = 0;
    if (esiApplicable) {
      const grossIfEsi = (monthlyCtc - pfEmployer) / 1.0325;
      if (grossIfEsi <= 21000) {
        allowance = grossIfEsi - (basicMonthly + hraMonthly + other);
      } else {
        allowance = monthlyCtc - pfEmployer - (basicMonthly + hraMonthly + other);
      }
    } else {
      allowance = monthlyCtc - pfEmployer - (basicMonthly + hraMonthly + other);
    }
    
    return allowance;
  }, [ctcAnnual, basicPercent, hraPercent, pfApplicable, esiApplicable, otherAllowances]);

  const componentsExceedCtc = useMemo(() => {
    return mode === "auto" && autoSpecialAllowance < 0;
  }, [mode, autoSpecialAllowance]);

  const calculatedSpecialAllowance = useMemo(() => {
    if (mode === "auto") {
      return Math.max(0, Math.round(autoSpecialAllowance));
    }
    return toNumber(specialAllowance);
  }, [mode, autoSpecialAllowance, specialAllowance]);

  const breakdown = useMemo(
    () =>
      calculateBreakdown({
        ctcAnnual: toNumber(ctcAnnual),
        basicPercent: toNumber(basicPercent),
        hraPercent: toNumber(hraPercent),
        specialAllowance: calculatedSpecialAllowance,
        otherAllowances: toNumber(otherAllowances),
        pfApplicable,
        esiApplicable,
        tdsMonthly: toNumber(tdsMonthly),
      }),
    [basicPercent, ctcAnnual, esiApplicable, hraPercent, otherAllowances, pfApplicable, calculatedSpecialAllowance, tdsMonthly],
  );

  const initials = employee.full_name.slice(0, 2).toUpperCase();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (toNumber(ctcAnnual) <= 0) {
      toastError("Annual CTC must be greater than zero.");
      return;
    }

    if (componentsExceedCtc) {
      toastError("Salary components exceed target CTC. Please adjust CTC, basic %, HRA %, or other allowances.");
      return;
    }

    if (mode === "manual" && Math.abs(breakdown.variance) > 10) {
      toastError("Calculated Cost does not match Expected CTC (variance exceeds ₹10).");
      return;
    }

    setSaving(true);
    try {
      const { error } = await db.from("salary_structures").upsert(
        [
          {
            tenant_id: tenantId,
            employee_id: employee.id,
            effective_from: effectiveFrom,
            ctc_annual: toNumber(ctcAnnual),
            basic_percent: toNumber(basicPercent),
            hra_percent: toNumber(hraPercent),
            special_allowance: calculatedSpecialAllowance,
            pf_applicable: pfApplicable,
            esi_applicable: esiApplicable,
            tds_monthly: toNumber(tdsMonthly),
            other_allowances: toNumber(otherAllowances),
            created_by: currentEmployee?.id ?? null,
          },
        ],
        { onConflict: "tenant_id,employee_id,effective_from" },
      );

      if (error) throw error;

      // Dispatch audit log
      const isNew = !structure;
      const hasDateChange = structure && structure.effective_from !== effectiveFrom;
      const logActionType = isNew || hasDateChange ? "salary_structure_created" : "salary_structure_updated";
      void logAction(logActionType, "salary_structures", employee.id, {
        employee_name: employee.full_name,
        ctc_annual: toNumber(ctcAnnual),
        effective_from: effectiveFrom,
        basic_percent: toNumber(basicPercent),
        hra_percent: toNumber(hraPercent),
        calculated_variance: breakdown.variance,
      });

      success("Salary structure saved.");
      await onSaved();
      onClose();
    } catch (err) {
      toastError("Failed to save salary structure.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm">
      <div className="ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            {employee.profile_photo_url ? (
              <img src={employee.profile_photo_url} alt={employee.full_name} className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-slate-900">{employee.full_name}</h2>
              <p className="text-sm capitalize text-slate-500">{employee.department ?? "No department"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className="text-sm font-semibold text-slate-700">Salary Structure Mode</span>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (mode === "auto") return;
                    if (window.confirm("Recalculate Special Allowance automatically? This will overwrite your manual design.")) {
                      setMode("auto");
                    }
                  }}
                  className={`flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-semibold transition-all duration-200 ${
                    mode === "auto"
                      ? "border-brand-600 bg-brand-50/50 text-brand-700 ring-2 ring-brand-600/10"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${mode === "auto" ? "bg-brand-600 animate-pulse" : "bg-slate-300"}`} />
                  Auto Balance
                </button>
                <button
                  type="button"
                  onClick={() => setMode("manual")}
                  className={`flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-semibold transition-all duration-200 ${
                    mode === "manual"
                      ? "border-brand-600 bg-brand-50/50 text-brand-700 ring-2 ring-brand-600/10"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${mode === "manual" ? "bg-brand-600 animate-pulse" : "bg-slate-300"}`} />
                  Manual Design
                </button>
              </div>
            </div>

            <label className="sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Annual CTC (INR)</span>
              <input
                type="number"
                min="0"
                step="1"
                value={ctcAnnual}
                onChange={(event) => setCtcAnnual(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
                required
              />
            </label>

            <label>
              <span className="text-sm font-medium text-slate-700">Basic %</span>
              <input
                type="number"
                min="30"
                max="60"
                step="0.01"
                value={basicPercent}
                onChange={(event) => setBasicPercent(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
              />
            </label>

            <label>
              <span className="text-sm font-medium text-slate-700">HRA %</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={hraPercent}
                onChange={(event) => setHraPercent(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
              />
              <span className="mt-1 block text-xs text-slate-500">% of basic salary</span>
            </label>

            <label>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Special allowance (INR/month)</span>
                {mode === "auto" && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200/80 bg-emerald-50/40 px-2 py-0.5 text-[10px] font-bold text-emerald-700 uppercase tracking-wider shadow-[0_1px_2px_rgba(16,185,129,0.05)]">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    Auto Balanced
                  </span>
                )}
              </div>
              <input
                type="number"
                value={mode === "auto" ? calculatedSpecialAllowance : specialAllowance}
                onChange={(event) => setSpecialAllowance(event.target.value)}
                readOnly={mode === "auto"}
                className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-all duration-200 ${
                  mode === "auto"
                    ? "bg-emerald-50/60 text-emerald-900 border-emerald-200 cursor-default focus:ring-0"
                    : "border-slate-300 ring-brand-600 focus:ring"
                }`}
              />
              {mode === "auto" && (
                <span className="mt-1 block text-xs text-emerald-600 font-medium">
                  Automatically adjusted to match target CTC.
                </span>
              )}
            </label>

            <label>
              <span className="text-sm font-medium text-slate-700">Other allowances (INR/month)</span>
              <input
                type="number"
                min="0"
                step="1"
                value={otherAllowances}
                onChange={(event) => setOtherAllowances(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
              />
            </label>

            <div className="rounded-lg border border-slate-200 p-3">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-700">PF applicable</span>
                <input
                  type="checkbox"
                  checked={pfApplicable}
                  onChange={(event) => setPfApplicable(event.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                />
              </label>
              <p className="mt-2 text-xs text-slate-500">PF = {formatCurrency(breakdown.pfEmployee)}/month</p>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-700">ESI applicable</span>
                <input
                  type="checkbox"
                  checked={esiApplicable}
                  onChange={(event) => setEsiApplicable(event.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                />
              </label>
              <p className="mt-2 text-xs text-slate-500">
                ESI = {formatCurrency(breakdown.esiEmployee)}/month (only if gross &lt; Rs. 21,000)
              </p>
            </div>

            <label>
              <span className="text-sm font-medium text-slate-700">TDS per month (INR)</span>
              <input
                type="number"
                min="0"
                step="1"
                value={tdsMonthly}
                onChange={(event) => setTdsMonthly(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
              />
              <span className="mt-1 block text-xs text-slate-500">Enter estimated monthly TDS. Adjust each month as needed.</span>
            </label>

            <label>
              <span className="text-sm font-medium text-slate-700">Effective from</span>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
                required
              />
              <span className="mt-1 block text-xs text-slate-500">
                If employee already has a structure, a new record is created from this date.
              </span>
            </label>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Live breakdown</h3>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Expected Monthly CTC</dt><dd className="font-semibold text-slate-900">{formatCurrency(breakdown.monthlyCtc)}</dd></div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Calculated Monthly Cost</dt>
                <dd className={`font-semibold ${(componentsExceedCtc || (mode === "manual" && Math.abs(breakdown.variance) > 10)) ? "text-red-600" : "text-emerald-700"}`}>
                  {formatCurrency(breakdown.calculatedCost)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 sm:col-span-2 border-b border-slate-200 pb-2">
                <dt className="text-slate-500">CTC Variance</dt>
                <dd className={`font-semibold ${(componentsExceedCtc || (mode === "manual" && Math.abs(breakdown.variance) > 10)) ? "text-red-600" : "text-slate-900"}`}>
                  {formatCurrency(breakdown.variance)}
                </dd>
              </div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Basic/month</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.basicMonthly)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">HRA/month</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.hraMonthly)}</dd></div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Special allowance</dt>
                <dd className="font-medium text-slate-900">{formatCurrency(calculatedSpecialAllowance)}</dd>
              </div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Gross/month</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.grossMonthly)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Employer PF</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.pfEmployer)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Employer ESI</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.esiEmployer)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Employee PF</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.pfEmployee)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Employee ESI</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.esiEmployee)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">TDS</dt><dd className="font-medium text-slate-900">{formatCurrency(toNumber(tdsMonthly))}</dd></div>
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 sm:col-span-2">
                <dt className="font-semibold text-slate-900">Estimated net/month</dt>
                <dd className="font-semibold text-emerald-700">{formatCurrency(breakdown.netMonthly)}</dd>
              </div>
            </dl>
            {componentsExceedCtc && (
              <p className="mt-3 text-xs text-red-600 font-medium">
                ⚠️ Salary components exceed target CTC. Please adjust CTC, basic %, HRA %, or other allowances.
              </p>
            )}
            {mode === "manual" && Math.abs(breakdown.variance) > 10 && (
              <p className="mt-3 text-xs text-red-600 font-medium">
                ⚠️ Calculated Monthly Cost must match Expected Monthly CTC (Variance limit is ₹10). Please adjust basic %, HRA %, or allowances.
              </p>
            )}
          </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || componentsExceedCtc || (mode === "manual" && Math.abs(breakdown.variance) > 10)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Salary"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export { calculateBreakdown, formatCurrency };
