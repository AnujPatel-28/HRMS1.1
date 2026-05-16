import { useMemo, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useTenant } from "../../contexts/TenantContext";
import { useEmployee } from "../../hooks/useEmployee";
import { db } from "../../insforge/client";
import { useToast } from "../../shared/ToastContext";
import type { Employee } from "../../types";
import type { SalaryStructure } from "./SalaryStructures";

type SalaryFormProps = {
  employee: Employee;
  structure: SalaryStructure | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

const today = () => new Date().toISOString().slice(0, 10);

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
  const esiEmployee = values.esiApplicable && grossMonthly < 21000 ? grossMonthly * 0.0075 : 0;
  const netMonthly = grossMonthly - pfEmployee - esiEmployee - values.tdsMonthly;

  return {
    monthlyCtc,
    basicMonthly,
    hraMonthly,
    grossMonthly,
    pfEmployee,
    esiEmployee,
    netMonthly,
  };
}

export function SalaryForm({ employee, structure, onClose, onSaved }: SalaryFormProps) {
  const { tenantId } = useTenant();
  const { employee: currentEmployee } = useEmployee();
  const { success, error: toastError } = useToast();
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

  const breakdown = useMemo(
    () =>
      calculateBreakdown({
        ctcAnnual: toNumber(ctcAnnual),
        basicPercent: toNumber(basicPercent),
        hraPercent: toNumber(hraPercent),
        specialAllowance: toNumber(specialAllowance),
        otherAllowances: toNumber(otherAllowances),
        pfApplicable,
        esiApplicable,
        tdsMonthly: toNumber(tdsMonthly),
      }),
    [basicPercent, ctcAnnual, esiApplicable, hraPercent, otherAllowances, pfApplicable, specialAllowance, tdsMonthly],
  );

  const initials = employee.full_name.slice(0, 2).toUpperCase();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (toNumber(ctcAnnual) <= 0) {
      toastError("Annual CTC must be greater than zero.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await db.from("salary_structures").insert([
        {
          tenant_id: tenantId,
          employee_id: employee.id,
          effective_from: effectiveFrom,
          ctc_annual: toNumber(ctcAnnual),
          basic_percent: toNumber(basicPercent),
          hra_percent: toNumber(hraPercent),
          special_allowance: toNumber(specialAllowance),
          pf_applicable: pfApplicable,
          esi_applicable: esiApplicable,
          tds_monthly: toNumber(tdsMonthly),
          other_allowances: toNumber(otherAllowances),
          created_by: currentEmployee?.id ?? null,
        },
      ]);

      if (error) throw error;

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
              <span className="text-sm font-medium text-slate-700">Special allowance (INR/month)</span>
              <input
                type="number"
                min="0"
                step="1"
                value={specialAllowance}
                onChange={(event) => setSpecialAllowance(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
              />
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
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Monthly CTC</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.monthlyCtc)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Basic/month</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.basicMonthly)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">HRA/month</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.hraMonthly)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Special allowance</dt><dd className="font-medium text-slate-900">{formatCurrency(toNumber(specialAllowance))}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Gross/month</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.grossMonthly)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">PF deduction</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.pfEmployee)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">ESI deduction</dt><dd className="font-medium text-slate-900">{formatCurrency(breakdown.esiEmployee)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">TDS</dt><dd className="font-medium text-slate-900">{formatCurrency(toNumber(tdsMonthly))}</dd></div>
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 sm:col-span-2">
                <dt className="font-semibold text-slate-900">Estimated net/month</dt>
                <dd className="font-semibold text-emerald-700">{formatCurrency(breakdown.netMonthly)}</dd>
              </div>
            </dl>
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
              disabled={saving}
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
