import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Pencil, Plus, Save, Trash2, Users } from "lucide-react";
import { db } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import type { Employee, EmployeeShift, Shift } from "../types";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { ConfirmModal } from "../shared/ConfirmModal";
import { formatLocalDate } from "../utils/date";

type ShiftFormState = {
  name: string;
  start_time: string;
  end_time: string;
  working_days: number[];
  half_day_cutoff_override: string;
  is_default: boolean;
};

type EmployeeAssignmentRow = {
  employee: Employee;
  explicitAssignment: EmployeeShift | null;
  currentShift: Shift | null;
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

const defaultShiftForm: ShiftFormState = {
  name: "",
  start_time: "09:00",
  end_time: "18:00",
  working_days: [1, 2, 3, 4, 5, 6],
  half_day_cutoff_override: "",
  is_default: false,
};

function formatTimeValue(value: string | null | undefined) {
  if (!value) return "--:--";
  return value.slice(0, 5);
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
    is_default: Boolean(shift.is_default),
  };
}

function normalizeShift(raw: Shift): Shift {
  return {
    ...raw,
    start_time: formatTimeValue(raw.start_time),
    end_time: formatTimeValue(raw.end_time),
    half_day_cutoff_override: raw.half_day_cutoff_override ? formatTimeValue(raw.half_day_cutoff_override) : null,
    working_days: Array.isArray(raw.working_days) ? raw.working_days.map(Number) : [1, 2, 3, 4, 5, 6],
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
    </div>
  );
}

export default function ShiftManagement() {
  const { tenantId } = useTenant();
  const { success, error: toastError } = useToast();
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
          .lte("effective_from", today)
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
    const assignmentMap = new Map<string, EmployeeShift>();
    employeeAssignments.forEach((assignment) => {
      if (!assignmentMap.has(assignment.employee_id)) {
        assignmentMap.set(assignment.employee_id, assignment);
      }
    });

    return employees.map((employee) => {
      const explicitAssignment = assignmentMap.get(employee.id) ?? null;
      const currentShift = explicitAssignment
        ? shifts.find((shift) => shift.id === explicitAssignment.shift_id) ?? null
        : defaultShift;
      return { employee, explicitAssignment, currentShift };
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
      if (form.is_default) {
        const { error: clearDefaultError } = await db
          .from("shifts")
          .update({ is_default: false, updated_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
          .eq("is_default", true);
        if (clearDefaultError) throw clearDefaultError;
      }

      const payload = {
        tenant_id: tenantId,
        name: form.name.trim(),
        start_time: form.start_time,
        end_time: form.end_time,
        working_days: form.working_days,
        half_day_cutoff_override: form.half_day_cutoff_override || null,
        is_default: form.is_default,
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      if (shiftId) {
        const { error: updateError } = await db.from("shifts").update(payload).eq("tenant_id", tenantId).eq("id", shiftId);
        if (updateError) throw updateError;
        success("Shift updated.");
      } else {
        const { error: insertError } = await db.from("shifts").insert([{ ...payload, created_at: new Date().toISOString() }]);
        if (insertError) throw insertError;
        success("Shift created.");
      }

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
    setSavingShift(true);
    try {
      const { error: deleteError } = await db.from("shifts").delete().eq("tenant_id", tenantId).eq("id", deleteTarget.id);
      if (deleteError) throw deleteError;
      success("Shift deleted.");
      setDeleteTarget(null);
      await fetchData();
    } catch (err) {
      console.error(err);
      toastError("Failed to delete shift.");
    } finally {
      setSavingShift(false);
    }
  }

  async function scheduleShiftChange(row: EmployeeAssignmentRow, newShiftId: string) {
    if (!tenantId || !newShiftId || !row.currentShift?.id || row.currentShift.id === newShiftId) return;
    const today = todayString();
    const tomorrow = tomorrowString();

    if (row.explicitAssignment?.id) {
      const { error: closeError } = await db
        .from("employee_shifts")
        .update({ effective_to: today })
        .eq("tenant_id", tenantId)
        .eq("id", row.explicitAssignment.id);
      if (closeError) throw closeError;
    }

    const { error: insertError } = await db.from("employee_shifts").insert([{
      tenant_id: tenantId,
      employee_id: row.employee.id,
      shift_id: newShiftId,
      effective_from: tomorrow,
    }]);
    if (insertError) throw insertError;
  }

  async function handleSingleAssignment(row: EmployeeAssignmentRow, newShiftId: string) {
    setSavingAssignments(true);
    try {
      await scheduleShiftChange(row, newShiftId);
      success("Shift change scheduled for tomorrow.");
      await fetchData();
    } catch (err) {
      console.error(err);
      toastError("Failed to change employee shift.");
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

    setSavingAssignments(true);
    try {
      for (const row of selectedRows) {
        await scheduleShiftChange(row, bulkShiftId);
      }
      success("Bulk shift changes scheduled for tomorrow.");
      setSelectedEmployees({});
      setBulkShiftId("");
      await fetchData();
    } catch (err) {
      console.error(err);
      toastError("Failed to apply bulk shift assignment.");
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
        <div className="overflow-x-auto rounded-xl border border-slate-200">
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
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Assign Employees to Shifts</h3>
            <p className="text-sm text-slate-500">Shift changes are scheduled for the next day to preserve today’s attendance rules.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bulkShiftId}
              onChange={(event) => setBulkShiftId(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
            >
              <option value="">Select shift</option>
              {shifts.filter((shift) => shift.is_active !== false).map((shift) => (
                <option key={shift.id} value={shift.id}>{shift.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleBulkAssignment()}
              disabled={savingAssignments}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {savingAssignments ? "Applying..." : "Assign selected employees to shift"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">
                  <input
                    type="checkbox"
                    checked={assignmentRows.length > 0 && assignmentRows.every((row) => selectedEmployees[row.employee.id])}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelectedEmployees(
                        assignmentRows.reduce<Record<string, boolean>>((acc, row) => {
                          acc[row.employee.id] = checked;
                          return acc;
                        }, {}),
                      );
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
              {assignmentRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-10">
                    <EmptyState icon={Users} title="No active employees" description="Active employees will appear here for shift assignment." />
                  </td>
                </tr>
              ) : (
                assignmentRows.map((row) => (
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
                    <td className="px-4 py-3 text-slate-700 capitalize">{row.employee.department ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-700">{row.currentShift?.name ?? "Standard shift"}</td>
                    <td className="px-4 py-3">
                      <select
                        value={row.currentShift?.id ?? ""}
                        onChange={(event) => void handleSingleAssignment(row, event.target.value)}
                        disabled={savingAssignments}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring"
                      >
                        <option value="">Select shift</option>
                        {shifts.filter((shift) => shift.is_active !== false).map((shift) => (
                          <option key={shift.id} value={shift.id}>{shift.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
