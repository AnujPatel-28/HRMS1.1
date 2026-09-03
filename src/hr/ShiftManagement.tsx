import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Clock, Pencil, Plus, Save, Search, Trash2, Users } from "lucide-react";
import { db } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import type { Employee, EmployeeShift, Shift } from "../types";
import { useToast } from "../shared/ToastContext";
import { useAuditLog } from "../hooks/useAuditLog";
import { Skeleton } from "../shared/Skeleton";
import { SelectDropdown } from "../shared/components/SelectDropdown";
import { EmptyState } from "../shared/EmptyState";
import { ConfirmModal } from "../shared/ConfirmModal";
import { formatLocalDate } from "../utils/date";
import { useDepartmentLabel } from "../contexts/OrgUnitsContext";

type ShiftFormState = {
  name: string;
  start_time: string;
  end_time: string;
  working_days: number[];
  half_day_cutoff_override: string;
  punch_in_opens_minutes_before: string;
  is_default: boolean;
  // §5.3 policy fields (Phase 0) -- consumed by the derivation processor once it ships.
  working_hours_threshold_for_absent: string;
  working_hours_threshold_for_half_day: string;
  determine_check_in_and_check_out: "alternating" | "strict_log_type";
  working_hours_calculation_based_on: "first_last" | "every_pair";
  enable_late_entry_marking: boolean;
  late_entry_grace_minutes: string;
  enable_early_exit_marking: boolean;
  early_exit_grace_minutes: string;
  enable_auto_derivation: boolean;
  mark_attendance_on_holidays: boolean;
  allowed_punch_sources: string[];
};

type EmployeeAssignmentRow = {
  employee: Employee;
  explicitAssignment: EmployeeShift | null;
  currentShift: Shift | null;
  nextShift?: Shift | null;
};

const DAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const PUNCH_SOURCE_OPTIONS = [
  { value: "app", label: "App (GPS + selfie)" },
  { value: "device", label: "Biometric / RFID device" },
  { value: "kiosk", label: "Shared kiosk" },
  { value: "manual", label: "HR manual entry" },
  { value: "import", label: "CSV / Excel import" },
];

const CHECK_IN_OUT_OPTIONS = [
  { value: "alternating", label: "Alternating (device doesn't report direction)" },
  { value: "strict_log_type", label: "Strict log type (device reports IN/OUT)" },
];

const WORKING_HOURS_BASIS_OPTIONS = [
  { value: "first_last", label: "First check-in to last check-out" },
  { value: "every_pair", label: "Every check-in/check-out pair" },
];

const defaultShiftForm: ShiftFormState = {
  name: "",
  start_time: "09:00",
  end_time: "18:00",
  working_days: [1, 2, 3, 4, 5, 6],
  half_day_cutoff_override: "",
  punch_in_opens_minutes_before: "60",
  is_default: false,
  working_hours_threshold_for_absent: "0",
  working_hours_threshold_for_half_day: "0",
  determine_check_in_and_check_out: "alternating",
  working_hours_calculation_based_on: "first_last",
  enable_late_entry_marking: true,
  late_entry_grace_minutes: "10",
  enable_early_exit_marking: false,
  early_exit_grace_minutes: "10",
  enable_auto_derivation: true,
  mark_attendance_on_holidays: false,
  allowed_punch_sources: ["app", "device", "kiosk", "manual", "import"],
};

function formatTimeValue(value: string | null | undefined) {
  if (!value) return "--:--";
  return value.slice(0, 5);
}

/** Turns an absent time — including formatTimeValue's "--:--" placeholder — back into null. */
function normalizeTimeInput(value: string | null | undefined) {
  if (!value || value === "--:--") return null;
  return value;
}

function formatWorkingDays(days: number[]) {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7 && sorted.every((day, index) => day === index)) return "All days";
  if (sorted.length === 6 && sorted.join(",") === "1,2,3,4,5,6") return "Mon - Sat";
  if (sorted.length === 5 && sorted.join(",") === "1,2,3,4,5") return "Mon - Fri";
  return sorted.map((day) => DAY_OPTIONS.find((option) => option.value === day)?.label.slice(0, 3) ?? day).join(", ");
}

function toShiftForm(shift: Shift): ShiftFormState {
  return {
    name: shift.name,
    start_time: formatTimeValue(shift.start_time),
    end_time: formatTimeValue(shift.end_time),
    working_days: Array.isArray(shift.working_days) ? shift.working_days.map(Number) : [1, 2, 3, 4, 5, 6],
    half_day_cutoff_override: formatTimeValue(shift.half_day_cutoff_override),
    punch_in_opens_minutes_before: String(shift.punch_in_opens_minutes_before ?? 60),
    is_default: Boolean(shift.is_default),
    working_hours_threshold_for_absent: String(shift.working_hours_threshold_for_absent ?? 0),
    working_hours_threshold_for_half_day: String(shift.working_hours_threshold_for_half_day ?? 0),
    determine_check_in_and_check_out: shift.determine_check_in_and_check_out ?? "alternating",
    working_hours_calculation_based_on: shift.working_hours_calculation_based_on ?? "first_last",
    enable_late_entry_marking: shift.enable_late_entry_marking ?? true,
    late_entry_grace_minutes: String(shift.late_entry_grace_minutes ?? 10),
    enable_early_exit_marking: shift.enable_early_exit_marking ?? false,
    early_exit_grace_minutes: String(shift.early_exit_grace_minutes ?? 10),
    enable_auto_derivation: shift.enable_auto_derivation ?? true,
    mark_attendance_on_holidays: shift.mark_attendance_on_holidays ?? false,
    allowed_punch_sources: Array.isArray(shift.allowed_punch_sources)
      ? shift.allowed_punch_sources
      : ["app", "device", "kiosk", "manual", "import"],
  };
}

function normalizeShift(raw: Shift): Shift {
  return {
    ...raw,
    start_time: formatTimeValue(raw.start_time),
    end_time: formatTimeValue(raw.end_time),
    half_day_cutoff_override: raw.half_day_cutoff_override ? formatTimeValue(raw.half_day_cutoff_override) : null,
    punch_in_opens_minutes_before: Number(raw.punch_in_opens_minutes_before ?? 60),
    working_days: Array.isArray(raw.working_days) ? raw.working_days.map(Number) : [1, 2, 3, 4, 5, 6],
    working_hours_threshold_for_absent: Number(raw.working_hours_threshold_for_absent ?? 0),
    working_hours_threshold_for_half_day: Number(raw.working_hours_threshold_for_half_day ?? 0),
    determine_check_in_and_check_out: raw.determine_check_in_and_check_out ?? "alternating",
    working_hours_calculation_based_on: raw.working_hours_calculation_based_on ?? "first_last",
    enable_late_entry_marking: raw.enable_late_entry_marking ?? true,
    late_entry_grace_minutes: Number(raw.late_entry_grace_minutes ?? 10),
    enable_early_exit_marking: raw.enable_early_exit_marking ?? false,
    early_exit_grace_minutes: Number(raw.early_exit_grace_minutes ?? 10),
    enable_auto_derivation: raw.enable_auto_derivation ?? true,
    mark_attendance_on_holidays: raw.mark_attendance_on_holidays ?? false,
    allowed_punch_sources: Array.isArray(raw.allowed_punch_sources)
      ? raw.allowed_punch_sources
      : ["app", "device", "kiosk", "manual", "import"],
  };
}

// Business-calendar dates for shift effective_from / effective_to.
// Must use local timezone — toISOString() would return wrong date for IST midnight assignments.
function tomorrowString() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return formatLocalDate(date);
}

function todayString() {
  return formatLocalDate(new Date());
}

function ShiftFormFields({
  form,
  onChange,
}: {
  form: ShiftFormState;
  onChange: (next: ShiftFormState) => void;
}) {
  const [showPolicy, setShowPolicy] = useState(false);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-slate-600">Shift name</span>
        <input
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
          placeholder="Morning Shift"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-slate-600">Start time</span>
        <input
          type="time"
          value={form.start_time}
          onChange={(event) => onChange({ ...form, start_time: event.target.value })}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-slate-600">End time</span>
        <input
          type="time"
          value={form.end_time}
          onChange={(event) => onChange({ ...form, end_time: event.target.value })}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-slate-600">Custom half-day cutoff for this shift (leave empty to use company default)</span>
        <input
          type="time"
          value={form.half_day_cutoff_override}
          onChange={(event) => onChange({ ...form, half_day_cutoff_override: event.target.value })}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-slate-600">Punch-in opens (minutes before start)</span>
        <input
          type="number"
          min="0"
          value={form.punch_in_opens_minutes_before}
          onChange={(event) => onChange({ ...form, punch_in_opens_minutes_before: event.target.value })}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
          placeholder="60"
        />
      </label>
      {/*
        "Late mark grace override" was removed here: nothing ever read shifts.late_mark_grace_override.
        The grace that actually decides lateness is `late_entry_grace_minutes` below, used by both
        attendance_derive_pass1 and (since 20260903102438) HR correction approval. Offering a third
        grace field that silently did nothing is the exact pattern the policy-center audit removed.
      */}
      {form.end_time < form.start_time && (
        <div className="md:col-span-2 mb-2 flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
          <span>
            <strong>Night Shift Detected:</strong> End time is before start time. Attendance systems will automatically cross the midnight boundary.
          </span>
        </div>
      )}
      <div className="md:col-span-2">
        <span className="mb-2 block text-xs font-semibold text-slate-600">Working days</span>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {DAY_OPTIONS.map((day) => {
            const checked = form.working_days.includes(day.value);
            return (
              <label key={day.value} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const nextDays = event.target.checked
                      ? [...form.working_days, day.value].sort((a, b) => a - b)
                      : form.working_days.filter((value) => value !== day.value);
                    onChange({ ...form, working_days: nextDays });
                  }}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                />
                {day.label}
              </label>
            );
          })}
        </div>
      </div>
      <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <input
          type="checkbox"
          checked={form.is_default}
          onChange={(event) => onChange({ ...form, is_default: event.target.checked })}
          className="mt-1 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
        />
        <span>
          <span className="block text-sm font-semibold text-slate-800">Set as default shift</span>
          <span className="mt-1 block text-xs text-slate-500">Only one shift can be the default. Setting this as default will remove default from the current default shift.</span>
        </span>
      </label>

      <div className="md:col-span-2">
        <button
          type="button"
          onClick={() => setShowPolicy((current) => !current)}
          className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          <span>Attendance derivation policy (advanced)</span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${showPolicy ? "rotate-180" : ""}`} />
        </button>
        {showPolicy ? (
          <div className="mt-3 grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Absent threshold (hours worked)</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.working_hours_threshold_for_absent}
                onChange={(event) => onChange({ ...form, working_hours_threshold_for_absent: event.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
                placeholder="0"
              />
              <span className="mt-1 block text-xs text-slate-500">Below this many hours worked, mark Absent. 0 disables hours-based absence.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Half-day threshold (hours worked)</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.working_hours_threshold_for_half_day}
                onChange={(event) => onChange({ ...form, working_hours_threshold_for_half_day: event.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
                placeholder="0"
              />
              <span className="mt-1 block text-xs text-slate-500">Below this many hours worked (and at/above the absent threshold), mark Half Day. 0 disables hours-based half-day.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Check-in/out direction from device logs</span>
              <SelectDropdown
                value={form.determine_check_in_and_check_out}
                onChange={(value) => onChange({ ...form, determine_check_in_and_check_out: value as ShiftFormState["determine_check_in_and_check_out"] })}
                options={CHECK_IN_OUT_OPTIONS}
                containerClassName="w-full"
                triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Working hours calculation</span>
              <SelectDropdown
                value={form.working_hours_calculation_based_on}
                onChange={(value) => onChange({ ...form, working_hours_calculation_based_on: value as ShiftFormState["working_hours_calculation_based_on"] })}
                options={WORKING_HOURS_BASIS_OPTIONS}
                containerClassName="w-full"
                triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <input
                type="checkbox"
                checked={form.enable_late_entry_marking}
                onChange={(event) => onChange({ ...form, enable_late_entry_marking: event.target.checked })}
                className="mt-1 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <span className="text-sm text-slate-700">Flag late entries</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Late entry grace (minutes)</span>
              <input
                type="number"
                min="0"
                value={form.late_entry_grace_minutes}
                onChange={(event) => onChange({ ...form, late_entry_grace_minutes: event.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
                placeholder="10"
              />
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <input
                type="checkbox"
                checked={form.enable_early_exit_marking}
                onChange={(event) => onChange({ ...form, enable_early_exit_marking: event.target.checked })}
                className="mt-1 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <span className="text-sm text-slate-700">Flag early exits</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Early exit grace (minutes)</span>
              <input
                type="number"
                min="0"
                value={form.early_exit_grace_minutes}
                onChange={(event) => onChange({ ...form, early_exit_grace_minutes: event.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
                placeholder="10"
              />
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <input
                type="checkbox"
                checked={form.enable_auto_derivation}
                onChange={(event) => onChange({ ...form, enable_auto_derivation: event.target.checked })}
                className="mt-1 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <span className="text-sm text-slate-700">Include this shift in automatic attendance derivation</span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <input
                type="checkbox"
                checked={form.mark_attendance_on_holidays}
                onChange={(event) => onChange({ ...form, mark_attendance_on_holidays: event.target.checked })}
                className="mt-1 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <span className="text-sm text-slate-700">Mark attendance for employees who work on a holiday</span>
            </label>
            <div className="md:col-span-2">
              <span className="mb-2 block text-xs font-semibold text-slate-600">Allowed punch sources</span>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {PUNCH_SOURCE_OPTIONS.map((source) => {
                  const checked = form.allowed_punch_sources.includes(source.value);
                  return (
                    <label key={source.value} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const nextSources = event.target.checked
                            ? [...form.allowed_punch_sources, source.value]
                            : form.allowed_punch_sources.filter((value) => value !== source.value);
                          onChange({ ...form, allowed_punch_sources: nextSources });
                        }}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                      />
                      {source.label}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ShiftManagement() {
  const deptLabel = useDepartmentLabel();
  const { tenantId } = useTenant();
  const { success, error: toastError } = useToast();
  const { logAction } = useAuditLog();
  const [loading, setLoading] = useState(true);
  const [savingShift, setSavingShift] = useState(false);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [shiftForm, setShiftForm] = useState<ShiftFormState>(defaultShiftForm);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [editingShiftForm, setEditingShiftForm] = useState<ShiftFormState>(defaultShiftForm);
  const [deleteTarget, setDeleteTarget] = useState<Shift | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeAssignments, setEmployeeAssignments] = useState<EmployeeShift[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<Record<string, boolean>>({});
  const [bulkShiftId, setBulkShiftId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const today = todayString();
      const [shiftRes, employeeRes, assignmentRes] = await Promise.all([
        db.from("shifts").select("*").eq("tenant_id", tenantId).order("is_default", { ascending: false }).order("name"),
        db.from("employees").select("*").eq("tenant_id", tenantId).eq("status", "active").order("full_name"),
        db.from("employee_shifts")
          .select("*")
          .eq("tenant_id", tenantId)
          .or(`effective_to.is.null,effective_to.gte.${today}`)
          .order("effective_from", { ascending: false }),
      ]);

      if (shiftRes.error) throw shiftRes.error;
      if (employeeRes.error) throw employeeRes.error;
      if (assignmentRes.error) throw assignmentRes.error;

      setShifts(((shiftRes.data ?? []) as Shift[]).map(normalizeShift));
      setEmployees((employeeRes.data ?? []) as Employee[]);
      setEmployeeAssignments((assignmentRes.data ?? []) as EmployeeShift[]);
    } catch (err) {
      console.error(err);
      toastError("Failed to load shifts.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toastError]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const defaultShift = useMemo(() => shifts.find((shift) => shift.is_default && shift.is_active !== false) ?? null, [shifts]);

  const assignmentRows = useMemo<EmployeeAssignmentRow[]>(() => {
    const today = todayString();
    const assignmentMap = new Map<string, EmployeeShift>();
    const futureAssignmentMap = new Map<string, EmployeeShift>();
    
    employeeAssignments.forEach((assignment) => {
      if (assignment.effective_from > today) {
        if (!futureAssignmentMap.has(assignment.employee_id)) {
          futureAssignmentMap.set(assignment.employee_id, assignment);
        }
      } else {
        if (!assignmentMap.has(assignment.employee_id)) {
          assignmentMap.set(assignment.employee_id, assignment);
        }
      }
    });

    return employees.map((employee) => {
      const explicitAssignment = assignmentMap.get(employee.id) ?? null;
      const futureAssignment = futureAssignmentMap.get(employee.id) ?? null;
      
      const currentShift = explicitAssignment
        ? shifts.find((shift) => shift.id === explicitAssignment.shift_id) ?? null
        : defaultShift;
        
      const nextShift = futureAssignment
        ? shifts.find((shift) => shift.id === futureAssignment.shift_id) ?? null
        : null;

      return { employee, explicitAssignment, currentShift, nextShift };
    });
  }, [defaultShift, employeeAssignments, employees, shifts]);

  const employeesPerShift = useMemo(() => {
    return assignmentRows.reduce<Record<string, number>>((acc, row) => {
      if (row.currentShift?.id) {
        acc[row.currentShift.id] = (acc[row.currentShift.id] ?? 0) + 1;
      }
      return acc;
    }, {});
  }, [assignmentRows]);

  const filteredAssignmentRows = useMemo(() => {
    if (!searchQuery.trim()) return assignmentRows;
    const query = searchQuery.toLowerCase();
    return assignmentRows.filter((row) => 
      row.employee.full_name.toLowerCase().includes(query) ||
      (row.employee.employee_code && row.employee.employee_code.toLowerCase().includes(query)) ||
      deptLabel(row.employee, "").toLowerCase().includes(query)
    );
  }, [assignmentRows, searchQuery, deptLabel]);

  async function saveShift(form: ShiftFormState, shiftId?: string) {
    if (!tenantId) return;
    if (!form.name.trim()) {
      toastError("Shift name is required.");
      return;
    }
    if (form.working_days.length === 0) {
      toastError("Select at least one working day.");
      return;
    }

    setSavingShift(true);
    try {
      const { data: savedShiftId, error: saveError } = await db.rpc("hr_save_shift", {
        p_tenant_id: tenantId,
        p_shift_id: shiftId ?? null,
        p_name: form.name.trim(),
        p_start_time: form.start_time,
        p_end_time: form.end_time,
        p_working_days: form.working_days,
        // formatTimeValue() returns the DISPLAY placeholder "--:--" for a null cutoff, and the
        // edit form is seeded from it (line ~114). "--:--" is truthy, so a bare `|| null` never
        // fired and Postgres rejected it with 22007 — which made every shift with no custom
        // cutoff (i.e. all of them) unsaveable. Create was unaffected because its form seeds "".
        p_half_day_cutoff_override: normalizeTimeInput(form.half_day_cutoff_override),
        p_punch_in_opens_minutes_before: Number(form.punch_in_opens_minutes_before || 60),
        p_is_default: form.is_default,
        p_working_hours_threshold_for_absent: Number(form.working_hours_threshold_for_absent || 0),
        p_working_hours_threshold_for_half_day: Number(form.working_hours_threshold_for_half_day || 0),
        p_determine_check_in_and_check_out: form.determine_check_in_and_check_out,
        p_working_hours_calculation_based_on: form.working_hours_calculation_based_on,
        p_enable_late_entry_marking: form.enable_late_entry_marking,
        p_late_entry_grace_minutes: Number(form.late_entry_grace_minutes || 10),
        p_enable_early_exit_marking: form.enable_early_exit_marking,
        p_early_exit_grace_minutes: Number(form.early_exit_grace_minutes || 10),
        p_enable_auto_derivation: form.enable_auto_derivation,
        p_mark_attendance_on_holidays: form.mark_attendance_on_holidays,
        p_allowed_punch_sources: form.allowed_punch_sources,
      });
      if (saveError) throw saveError;
      success(shiftId ? "Shift updated." : "Shift created.");

      // ── Audit log: shift.override_modified ──────────────────────────────────
      void logAction("shift.override_modified", "shifts", shiftId ?? String(savedShiftId ?? "new"), {
        shift_name: form.name.trim(),
        start_time: form.start_time,
        end_time: form.end_time,
        punch_in_opens_minutes_before: form.punch_in_opens_minutes_before,
        severity: "INFO",
      });

      setShowAddForm(false);
      setShiftForm(defaultShiftForm);
      setEditingShiftId(null);
      setEditingShiftForm(defaultShiftForm);
      await fetchData();
    } catch (err) {
      console.error(err);
      toastError("Failed to save shift.");
    } finally {
      setSavingShift(false);
    }
  }

  async function deleteShift() {
    if (!tenantId || !deleteTarget?.id) return;

    // ── Guard: block deactivating the last active default shift ─────────────────
    // If the only default shift is removed, employees with no explicit assignment
    // silently fall back to raw punch_in_start arithmetic — wrong behavior.
    if (deleteTarget.is_default) {
      const remainingActiveDefaults = shifts.filter(
        (s) => s.is_default && s.is_active !== false && s.id !== deleteTarget.id,
      );
      if (remainingActiveDefaults.length === 0) {
        toastError("Cannot remove the only default shift. Set another shift as default first.");
        return;
      }
    }

    setSavingShift(true);
    try {
      // ── Soft-delete: set is_active = false instead of hard DELETE ───────────
      // Hard DELETE cascades to employee_shifts (ON DELETE CASCADE), wiping all
      // historical assignments and breaking payroll/attendance reproducibility.
      // Soft-delete hides the shift from all UI dropdowns (they filter is_active)
      // while keeping the DB row and all foreign key references intact.
      const { error: softDeleteError } = await db.rpc("hr_deactivate_shift", {
        p_tenant_id: tenantId,
        p_shift_id: deleteTarget.id,
      });
      if (softDeleteError) throw softDeleteError;

      // Audit log — UTC timestamp intentional for audit records.
      void logAction("shift.deactivated", "shifts", deleteTarget.id, {
        shift_name: deleteTarget.name,
        was_default: deleteTarget.is_default,
        deactivated_at: new Date().toISOString(),
      });

      success(`"${deleteTarget.name}" has been deactivated and hidden from assignments.`);
      setDeleteTarget(null);
      await fetchData();
    } catch (err) {
      console.error(err);
      toastError("Failed to deactivate shift.");
    } finally {
      setSavingShift(false);
    }
  }

  async function scheduleShiftChange(row: EmployeeAssignmentRow, newShiftId: string) {
    if (!tenantId || !newShiftId || row.currentShift?.id === newShiftId) return;
    const tomorrow = tomorrowString();

    const { error: scheduleError } = await db.rpc("hr_schedule_shift_change", {
      p_tenant_id: tenantId,
      p_employee_id: row.employee.id,
      p_shift_id: newShiftId,
      p_effective_from: tomorrow,
    });
    if (scheduleError) throw scheduleError;
  }

  async function handleSingleAssignment(row: EmployeeAssignmentRow, newShiftId: string) {
    setSavingAssignments(true);
    try {
      await scheduleShiftChange(row, newShiftId);

      // Audit log — non-blocking, failure never surfaces to user.
      void logAction("shift.assignment", "employee_shifts", row.employee.id, {
        employee_name: row.employee.full_name,
        old_shift_id: row.currentShift?.id ?? null,
        old_shift_name: row.currentShift?.name ?? null,
        new_shift_id: newShiftId,
        effective_from: tomorrowString(),
        assigned_at: new Date().toISOString(),
      });

      success("Shift change scheduled for tomorrow.");
      await fetchData();
    } catch (err) {
      console.error(err);
      toastError(err instanceof Error ? err.message : "Failed to change employee shift.");
    } finally {
      setSavingAssignments(false);
    }
  }

  async function handleBulkAssignment() {
    if (!bulkShiftId) {
      toastError("Select a shift for the bulk assignment.");
      return;
    }

    const selectedRows = assignmentRows.filter((row) => selectedEmployees[row.employee.id]);
    if (selectedRows.length === 0) {
      toastError("Select at least one employee.");
      return;
    }

    // ── Per-employee error isolation ─────────────────────────────────────────
    // The previous implementation aborted the entire loop on the first failure,
    // leaving partial assignments with no visibility into which succeeded or failed.
    // We now run each employee's assignment in its own try/catch so:
    //   1. Failures never cancel remaining employees.
    //   2. HR sees a detailed summary of successes and failures.
    //   3. Retries are idempotent — scheduleShiftChange cleans up future conflicts.
    const succeeded: string[] = [];
    const failed: { name: string; reason: string }[] = [];
    const effectiveFrom = tomorrowString();
    const newShift = shifts.find((s) => s.id === bulkShiftId);

    setSavingAssignments(true);
    try {
      for (const row of selectedRows) {
        try {
          await scheduleShiftChange(row, bulkShiftId);
          succeeded.push(row.employee.full_name);
        } catch (err) {
          console.error(`Bulk assignment failed for ${row.employee.full_name}:`, err);
          failed.push({
            name: row.employee.full_name,
            reason: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      // ── Show detailed summary to HR ────────────────────────────────────────
      if (failed.length === 0) {
        success(
          `${succeeded.length} employee${succeeded.length !== 1 ? "s" : ""} scheduled for "${
            newShift?.name ?? bulkShiftId
          }" from tomorrow.`,
        );
      } else {
        const failureDetails = failed.map((f) => `${f.name} (${f.reason})`).join("; ");
        toastError(
          `${succeeded.length} succeeded, ${failed.length} failed. Failed: ${failureDetails}`,
        );
      }

      // ── Audit log for the entire bulk operation ────────────────────────────
      // Non-blocking. Includes succeeded + failed lists for full traceability.
      void logAction("shift.bulk_assignment", "shifts", bulkShiftId, {
        new_shift_id: bulkShiftId,
        new_shift_name: newShift?.name ?? bulkShiftId,
        effective_from: effectiveFrom,
        initiated_at: new Date().toISOString(),
        succeeded_employees: succeeded,
        failed_employees: failed,
      });

      setSelectedEmployees({});
      setBulkShiftId("");
      await fetchData();
    } finally {
      setSavingAssignments(false);
    }
  }

  if (loading) {
    return (
      <section className="space-y-5">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-80 w-full rounded-2xl" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Shift Management</h2>
          <p className="text-sm text-slate-500">Create shifts, set the default shift, and schedule employee shift changes.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowAddForm((current) => !current);
            setEditingShiftId(null);
            setEditingShiftForm(defaultShiftForm);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" /> Add Shift
        </button>
      </div>

      {showAddForm ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">New Shift</h3>
          <ShiftFormFields form={shiftForm} onChange={setShiftForm} />
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setShiftForm(defaultShiftForm);
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveShift(shiftForm)}
              disabled={savingShift}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <Save className="h-4 w-4" /> {savingShift ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {/* DESKTOP VIEW */}
        <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Shift name</th>
                <th className="px-4 py-3 font-semibold">Start time</th>
                <th className="px-4 py-3 font-semibold">End time</th>
                <th className="px-4 py-3 font-semibold">Working days</th>
                <th className="px-4 py-3 font-semibold">Employees</th>
                <th className="px-4 py-3 font-semibold">Default</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {shifts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10">
                    <EmptyState icon={Clock} title="No shifts found" description="Create the first shift for this tenant." />
                  </td>
                </tr>
              ) : (
                shifts.map((shift) => {
                  const assignedEmployees = employeesPerShift[shift.id ?? ""] ?? 0;
                  const isEditing = editingShiftId === shift.id;
                  return (
                    <>
                      <tr key={shift.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{shift.name}</td>
                        <td className="px-4 py-3 text-slate-700">{formatTimeValue(shift.start_time)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatTimeValue(shift.end_time)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatWorkingDays(shift.working_days)}</td>
                        <td className="px-4 py-3 text-slate-700">{assignedEmployees}</td>
                        <td className="px-4 py-3">
                          {shift.is_default ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Default</span> : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingShiftId(shift.id ?? null);
                                setEditingShiftForm(toShiftForm(shift));
                                setShowAddForm(false);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                            >
                              <Pencil className="h-3 w-3" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(shift)}
                              disabled={assignedEmployees > 0}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3" /> Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isEditing ? (
                        <tr key={`${shift.id}-edit`}>
                          <td colSpan={7} className="bg-slate-50 px-4 py-4">
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                              {employeeAssignments.some((a) => a.shift_id === shift.id && a.effective_from < todayString()) && (
                                <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                                  <span>
                                    <strong>Historical shift:</strong> This shift has been used in past assignments. Editing its times or working days may affect how past attendance and lateness calculations are displayed. Consider creating a new shift instead.
                                  </span>
                                </div>
                              )}
                              <ShiftFormFields form={editingShiftForm} onChange={setEditingShiftForm} />
                              <div className="mt-4 flex justify-end gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingShiftId(null);
                                    setEditingShiftForm(defaultShiftForm);
                                  }}
                                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void saveShift(editingShiftForm, shift.id)}
                                  disabled={savingShift}
                                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                                >
                                  <Save className="h-4 w-4" /> {savingShift ? "Saving..." : "Save"}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* MOBILE VIEW */}
        <div className="md:hidden grid gap-3">
          {shifts.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <EmptyState icon={Clock} title="No shifts found" description="Create the first shift for this tenant." />
            </div>
          ) : (
            shifts.map((shift) => {
              const assignedEmployees = employeesPerShift[shift.id ?? ""] ?? 0;
              const isEditing = editingShiftId === shift.id;
              return (
                <div key={shift.id} className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                  {isEditing ? (
                    <div className="p-4 bg-slate-50">
                      {employeeAssignments.some((a) => a.shift_id === shift.id && a.effective_from < todayString()) && (
                        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                          <span><strong>Historical shift:</strong> Past assignments exist.</span>
                        </div>
                      )}
                      <ShiftFormFields form={editingShiftForm} onChange={setEditingShiftForm} />
                      <div className="mt-4 flex justify-end gap-2">
                        <button onClick={() => { setEditingShiftId(null); setEditingShiftForm(defaultShiftForm); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
                        <button onClick={() => void saveShift(editingShiftForm, shift.id)} disabled={savingShift} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"><Save className="h-4 w-4" /> Save</button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-bold text-slate-900">{shift.name}</h4>
                        {shift.is_default && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Default</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                        <div className="rounded-lg bg-slate-50 p-2">
                          <p className="text-[10px] font-semibold text-slate-500 uppercase">Start Time</p>
                          <p className="font-medium text-slate-900">{formatTimeValue(shift.start_time)}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2">
                          <p className="text-[10px] font-semibold text-slate-500 uppercase">End Time</p>
                          <p className="font-medium text-slate-900">{formatTimeValue(shift.end_time)}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2">
                          <p className="text-[10px] font-semibold text-slate-500 uppercase">Working Days</p>
                          <p className="font-medium text-slate-900 truncate">{formatWorkingDays(shift.working_days)}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2">
                          <p className="text-[10px] font-semibold text-slate-500 uppercase">Employees</p>
                          <p className="font-medium text-slate-900">{assignedEmployees}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => { setEditingShiftId(shift.id ?? null); setEditingShiftForm(toShiftForm(shift)); setShowAddForm(false); }} className="flex-1 justify-center inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                        <button onClick={() => setDeleteTarget(shift)} disabled={assignedEmployees > 0} className="flex-1 justify-center inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Assign Employees to Shifts</h3>
            <p className="text-sm text-slate-500">Shift changes are scheduled for the next day to preserve today’s attendance rules.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search employees..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full sm:w-64 rounded-lg border border-slate-300 pl-9 pr-4 py-2 text-sm outline-none transition-shadow focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div className="flex items-center gap-2">
              <SelectDropdown
                value={bulkShiftId}
                onChange={setBulkShiftId}
                options={[
                  { value: "", label: "Select shift" },
                  ...shifts.filter((shift) => shift.is_active !== false).map((shift) => ({ value: shift.id, label: shift.name })),
                ]}
                containerClassName="min-w-[150px] flex-1 sm:flex-none"
                triggerClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
              <button
                type="button"
                onClick={() => void handleBulkAssignment()}
                disabled={savingAssignments}
                className="whitespace-nowrap rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {savingAssignments ? "Applying..." : "Assign"}
              </button>
            </div>
          </div>
        </div>

        {/* DESKTOP VIEW */}
        <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">
                  <input
                    type="checkbox"
                    checked={filteredAssignmentRows.length > 0 && filteredAssignmentRows.every((row) => selectedEmployees[row.employee.id])}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelectedEmployees((current) => {
                        const next = { ...current };
                        filteredAssignmentRows.forEach(row => {
                          next[row.employee.id] = checked;
                        });
                        return next;
                      });
                    }}
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                  />
                </th>
                <th className="px-4 py-3 font-semibold">Employee name</th>
                <th className="px-4 py-3 font-semibold">Department</th>
                <th className="px-4 py-3 font-semibold">Current shift</th>
                <th className="px-4 py-3 font-semibold">Change shift</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {filteredAssignmentRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-10">
                    <EmptyState 
                      icon={Users} 
                      title={searchQuery ? "No employees found" : "No active employees"} 
                      description={searchQuery ? `No employees match "${searchQuery}"` : "Active employees will appear here for shift assignment."} 
                    />
                  </td>
                </tr>
              ) : (
                filteredAssignmentRows.map((row) => (
                  <tr key={row.employee.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedEmployees[row.employee.id])}
                        onChange={(event) => setSelectedEmployees((current) => ({ ...current, [row.employee.id]: event.target.checked }))}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{row.employee.full_name}</td>
                    <td className="px-4 py-3 text-slate-700 capitalize">{deptLabel(row.employee, "-")}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <div>{row.currentShift?.name ?? "Standard shift"}</div>
                      {row.nextShift && row.nextShift.id !== row.currentShift?.id && (
                        <div className="mt-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-inset ring-brand-600/20">
                            Changes to {row.nextShift.name} tomorrow
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <SelectDropdown
                        value={row.nextShift?.id ?? row.currentShift?.id ?? ""}
                        onChange={(value) => void handleSingleAssignment(row, value)}
                        options={[
                          { value: "", label: "Select shift" },
                          ...shifts.filter((shift) => shift.is_active !== false).map((shift) => ({ value: shift.id, label: shift.name })),
                        ]}
                        containerClassName="w-full min-w-[140px]"
                        triggerClassName="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* MOBILE VIEW */}
        <div className="md:hidden grid gap-3">
          {filteredAssignmentRows.length > 0 && (
            <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700 border border-slate-200 shadow-sm cursor-pointer active:bg-slate-100 transition-colors">
              <input
                type="checkbox"
                checked={filteredAssignmentRows.every((row) => selectedEmployees[row.employee.id])}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSelectedEmployees((current) => {
                    const next = { ...current };
                    filteredAssignmentRows.forEach(row => {
                      next[row.employee.id] = checked;
                    });
                    return next;
                  });
                }}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              Select All Employees
            </label>
          )}
          {filteredAssignmentRows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <EmptyState 
                icon={Users} 
                title={searchQuery ? "No employees found" : "No active employees"} 
                description={searchQuery ? `No employees match "${searchQuery}"` : "Active employees will appear here for shift assignment."} 
              />
            </div>
          ) : (
            filteredAssignmentRows.map((row) => (
              <label
                key={row.employee.id}
                className={`flex flex-col gap-3 rounded-2xl border ${selectedEmployees[row.employee.id] ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50/20' : 'border-slate-100 bg-white'} p-4 shadow-sm transition-all cursor-pointer`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedEmployees[row.employee.id])}
                    onChange={(e) => setSelectedEmployees((current) => ({ ...current, [row.employee.id]: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-900 truncate">{row.employee.full_name}</p>
                    <p className="text-xs font-medium text-slate-500 capitalize">{deptLabel(row.employee, "No Dept")}</p>
                  </div>
                </div>
                <div className="pl-7 space-y-3 text-sm">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Current Shift</span>
                    <span className="font-semibold text-slate-700">{row.currentShift?.name ?? "Standard shift"}</span>
                  </div>
                  {row.nextShift && row.nextShift.id !== row.currentShift?.id && (
                    <div className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700 border border-brand-100">
                      Changes to <strong className="font-bold">{row.nextShift.name}</strong> tomorrow
                    </div>
                  )}
                  <div onClick={(e) => e.preventDefault()} className="pt-2 border-t border-slate-100">
                    <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block mb-1">Change Shift (Effective Tomorrow)</span>
                    <SelectDropdown
                      value={row.nextShift?.id ?? row.currentShift?.id ?? ""}
                      onChange={(value) => void handleSingleAssignment(row, value)}
                      options={[
                        { value: "", label: "Select shift" },
                        ...shifts.filter((shift) => shift.is_active !== false).map((shift) => ({ value: shift.id, label: shift.name })),
                      ]}
                      containerClassName="w-full"
                      triggerClassName="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-shadow hover:bg-slate-50 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
                    />
                  </div>
                </div>
              </label>
            ))
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void deleteShift()}
        title="Delete shift"
        message={deleteTarget ? `Delete ${deleteTarget.name}? This cannot be undone.` : ""}
        confirmText="Delete"
        confirmColor="red"
        isSubmitting={savingShift}
      />
    </section>
  );
}
