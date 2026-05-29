import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Attendance, Employee, Leave, Task } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db, storage, insforge } from "../insforge/client";
import { useAuditLog } from "../hooks/useAuditLog";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { File, Calendar, ClipboardList, MoreVertical } from "lucide-react";

type TabKey = "personal" | "identity" | "documents" | "attendance" | "leaves" | "tasks";

type StorageDoc = {
  key: string;
  url: string;
  uploadedAt: string;
  size: number;
};

const tabs: { key: TabKey; label: string }[] = [
  { key: "personal", label: "Personal & Job Info" },
  { key: "identity", label: "Identity & Bank" },
  { key: "documents", label: "Documents" },
  { key: "attendance", label: "Attendance History" },
  { key: "leaves", label: "Leave History" },
  { key: "tasks", label: "Tasks" },
];

import { formatLocalDate } from "../utils/date";

const maskValue = (value: string | null, visible: boolean, minVisible = 4) => {
  if (!value) return "—";
  if (visible) return value;
  if (value.length <= minVisible) return "*".repeat(value.length);
  return `${"*".repeat(Math.max(value.length - minVisible, 0))}${value.slice(-minVisible)}`;
};

export default function EmployeeDetail() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const { logAction } = useAuditLog();

  const [activeTab, setActiveTab] = useState<TabKey>("personal");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [editForm, setEditForm] = useState<Partial<Employee>>({});
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [documents, setDocuments] = useState<StorageDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showSensitive, setShowSensitive] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Reset Password states (isolated from all other logic) ──
  type ResetStep = null | "sending" | "sent" | "confirming" | "done";
  const [resetStep, setResetStep] = useState<ResetStep>(null);
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const loadData = async () => {
    if (!employeeId) return;

    setLoading(true);
    setError(null);

    const employeeRes = await db
      .from("employees")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", employeeId)
      .maybeSingle();
    if (employeeRes.error || !employeeRes.data) {
      setError(employeeRes.error?.message ?? "Employee not found.");
      setLoading(false);
      return;
    }

    const currentEmployee = employeeRes.data as Employee;
    setEmployee(currentEmployee);
    setEditForm(currentEmployee);

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 29);

    const [attendanceRes, leavesRes, tasksRes, docsRes] = await Promise.all([
      db
        .from("attendance")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", currentEmployee.id)
        .gte("date", formatLocalDate(fromDate))
        .order("date", { ascending: true }),
      db.from("leaves").select("*").eq("tenant_id", tenantId).eq("employee_id", currentEmployee.id).order("applied_at", { ascending: false }),
      db.from("tasks").select("*").eq("tenant_id", tenantId).eq("assigned_to", currentEmployee.id).order("created_at", { ascending: false }),
      storage.from("employee-documents").list({ prefix: `employees/${currentEmployee.id}/`, limit: 200, offset: 0 }),
    ]);

    setAttendance((attendanceRes.data as Attendance[]) ?? []);
    setLeaves((leavesRes.data as Leave[]) ?? []);
    setTasks((tasksRes.data as Task[]) ?? []);

    if (docsRes.data?.objects) {
      setDocuments(
        docsRes.data.objects.map((item) => ({
          key: item.key,
          url: item.url,
          uploadedAt: item.uploadedAt,
          size: item.size,
        })),
      );
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, [employeeId, tenantId]);

  const attendanceMap = useMemo(() => {
    return attendance.reduce<Record<string, Attendance["status"]>>((acc, item) => {
      acc[item.date] = item.status;
      return acc;
    }, {});
  }, [attendance]);

  const lastThirtyDays = useMemo(() => {
    return Array.from({ length: 30 }).map((_, index) => {
      const day = new Date();
      day.setDate(day.getDate() - (29 - index));
      return day;
    });
  }, []);

  const updateField = (field: keyof Employee, value: string) => {
    setEditForm((current) => ({ ...current, [field]: value }));
  };

  const statusBadgeClass = (status: string) => {
    if (["active", "approved", "present", "in_progress"].includes(status)) return "bg-emerald-100 text-emerald-700";
    if (["inactive", "pending", "assigned", "submitted", "half_day", "on_leave"].includes(status)) return "bg-amber-100 text-amber-700";
    return "bg-rose-100 text-rose-700";
  };

  const saveChanges = async () => {
    if (!employee) return;

    setSaving(true);
    setError(null);

    const payload = {
      full_name: editForm.full_name,
      email: editForm.email,
      phone: editForm.phone,
      date_of_birth: editForm.date_of_birth,
      gender: editForm.gender,
      address: editForm.address,
      city: editForm.city,
      state: editForm.state,
      pincode: editForm.pincode,
      department: editForm.department,
      designation: editForm.designation,
      employee_code: editForm.employee_code,
      date_of_joining: editForm.date_of_joining,
      employment_type: editForm.employment_type,
      aadhaar_number: editForm.aadhaar_number,
      pan_number: editForm.pan_number,
      bank_name: editForm.bank_name,
      account_number: editForm.account_number,
      ifsc_code: editForm.ifsc_code,
      emergency_contact_name: editForm.emergency_contact_name,
      emergency_contact_phone: editForm.emergency_contact_phone,
      emergency_contact_relation: editForm.emergency_contact_relation,
    };

    const { error: updateError } = await db.from("employees").update(payload).eq("tenant_id", tenantId).eq("id", employee.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    void logAction("employee.updated", "employee", employee.id, { fields_changed: Object.keys(payload) });

    await loadData();
    setIsEditing(false);
    setSaving(false);
  };

  const updateStatus = async (status: Employee["status"]) => {
    if (!employee) return;
    setSaving(true);
    const { error: updateError } = await db.from("employees").update({ status }).eq("tenant_id", tenantId).eq("id", employee.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    if (status === "terminated") {
      void logAction("employee.terminated", "employee", employee.id);
    }

    await loadData();
    setSaving(false);
  };

  // ── Reset Password handlers ──
  const openPasswordReset = () => {
    if (!employee?.email) return;
    setResetError(null);
    setResetNewPassword("");
    setResetStep("sent");
  };

  const confirmPasswordReset = async () => {
    if (!employee?.email || resetNewPassword.trim().length < 8) return;
    setResetLoading(true);
    setResetError(null);
    setResetStep("confirming");
    try {
      const fnRes = await insforge.functions.invoke("set-employee-password", {
        body: { email: employee.email, password: resetNewPassword.trim(), tenant_id: tenantId },
      });
      if (fnRes.error || !fnRes.data?.success) {
        const msg: string = fnRes.data?.error ?? fnRes.error?.message ?? "Failed to update password.";
        setResetError(msg);
        setResetStep("sent");
      } else {
        setResetStep("done");
        setResetNewPassword("");
      }
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Failed to update password.");
      setResetStep("sent");
    } finally {
      setResetLoading(false);
    }
  };

  const cancelReset = () => {
    setResetStep(null);
    setResetNewPassword("");
    setResetError(null);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-sm text-rose-600">{error ?? "Employee not found."}</p>
        <button
          type="button"
          onClick={() => navigate("/hr/employees")}
          className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          Back to list
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {employee.profile_photo_url ? (
            <img src={employee.profile_photo_url} alt={employee.full_name} className="h-14 w-14 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="grid h-14 w-14 place-items-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700 shrink-0">
              {employee.full_name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-slate-900 truncate">{employee.full_name}</h2>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-500 min-w-0">
              <span className="truncate">{employee.employee_code ?? "No employee code"}</span>
              <span className="text-slate-300 shrink-0">&bull;</span>
              <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusBadgeClass(employee.status)}`}>
                <span className={`h-1 w-1 rounded-full ${employee.status === 'active' ? 'bg-emerald-500' : employee.status === 'inactive' ? 'bg-amber-500' : 'bg-rose-500'}`}></span>
                {employee.status}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 relative shrink-0">
          {isEditing ? (
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setEditForm(employee);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 transition"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 transition"
            >
              Edit
            </button>
          )}
          {isEditing ? (
            <button
              type="button"
              onClick={() => {
                void saveChanges();
              }}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition"
            >
              Save
            </button>
          ) : null}
          
          {/* Action Menu Toggle */}
          <button
            type="button"
            onClick={() => setShowActionsMenu(!showActionsMenu)}
            className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-100 transition shadow-sm"
            title="More Actions"
          >
            <MoreVertical className="h-5 w-5" />
          </button>

          {/* Action Menu Dropdown */}
          {showActionsMenu && (
            <div 
              className="fixed inset-0 z-40 cursor-default" 
              onClick={() => setShowActionsMenu(false)} 
              onTouchEnd={(e) => {
                e.preventDefault();
                setShowActionsMenu(false);
              }}
              aria-hidden="true"
            />
          )}
          <div className={`absolute right-0 top-full mt-2 w-48 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl z-50 ${showActionsMenu ? "flex" : "hidden"}`}>
            <button
              type="button"
              disabled={saving || resetLoading || resetStep !== null}
              onClick={() => {
                openPasswordReset();
                setShowActionsMenu(false);
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition"
            >
              Reset Password
            </button>
            {employee.status !== "active" && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void updateStatus("active");
                  setShowActionsMenu(false);
                }}
                className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 transition"
              >
                Reactivate
              </button>
            )}
            <button
              type="button"
              disabled={saving || employee.status === "inactive"}
              onClick={() => {
                void updateStatus("inactive");
                setShowActionsMenu(false);
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60 transition"
            >
              Deactivate
            </button>
            <button
              type="button"
              disabled={saving || employee.status === "terminated"}
              onClick={() => {
                void updateStatus("terminated");
                setShowActionsMenu(false);
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60 transition"
            >
              Terminate
            </button>
          </div>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

      {/* ── Inline Reset Password panel ── */}
      {(resetStep === "sent" || resetStep === "confirming" || resetStep === "done") && (
        <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
          {resetStep === "done" ? (
            <div className="flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-violet-900">Password updated successfully!</p>
                <p className="text-xs text-violet-700 mt-0.5">The employee can now log in with their new password.</p>
              </div>
              <button type="button" onClick={cancelReset} className="ml-auto text-xs text-violet-600 underline hover:no-underline">Dismiss</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-violet-900">Reset Employee Password</p>
                  <p className="text-xs text-violet-700 mt-0.5">
                    Set a new login password for <strong>{employee.email}</strong>. The employee can use it immediately after saving.
                  </p>
                </div>
                <button type="button" onClick={cancelReset} className="shrink-0 text-xs text-violet-500 underline hover:no-underline">Cancel</button>
              </div>

              {resetError && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{resetError}</p>
              )}

              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="New password, minimum 8 characters"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  className="flex-1 rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm outline-none ring-violet-400 focus:ring"
                />
                <button
                  type="button"
                  disabled={resetLoading || resetNewPassword.trim().length < 8}
                  onClick={() => { void confirmPasswordReset(); }}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  {resetStep === "confirming" ? "Saving…" : "Set Password"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2 border-b border-slate-200 pb-3 overflow-x-auto hide-scrollbar snap-x">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors snap-start ${
              activeTab === tab.key ? "bg-brand-50 text-brand-700 shadow-sm" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "personal" ? (
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Full Name</span>
            <input
              value={editForm.full_name ?? ""}
              onChange={(event) => updateField("full_name", event.target.value)}
              disabled={!isEditing}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Email</span>
            <input
              value={editForm.email ?? ""}
              onChange={(event) => updateField("email", event.target.value)}
              disabled={true} // Hard-disabled to prevent Auth desync
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-500 outline-none transition-all disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100 cursor-not-allowed"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Phone</span>
            <input
              value={editForm.phone ?? ""}
              onChange={(event) => updateField("phone", event.target.value)}
              disabled={!isEditing}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Date of Joining</span>
            <input
              type="date"
              value={editForm.date_of_joining ?? ""}
              onChange={(event) => updateField("date_of_joining", event.target.value)}
              disabled={!isEditing}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Department</span>
            <input
              value={editForm.department ?? ""}
              onChange={(event) => updateField("department", event.target.value)}
              disabled={!isEditing}
              className="w-full capitalize rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Designation</span>
            <input
              value={editForm.designation ?? ""}
              onChange={(event) => updateField("designation", event.target.value)}
              disabled={!isEditing}
              className="w-full capitalize rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Address</span>
            <textarea
              value={editForm.address ?? ""}
              onChange={(event) => updateField("address", event.target.value)}
              disabled={!isEditing}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:resize-none disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Emergency Contact Name</span>
            <input
              value={editForm.emergency_contact_name ?? ""}
              onChange={(event) => updateField("emergency_contact_name", event.target.value)}
              disabled={!isEditing}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Emergency Contact Phone</span>
            <input
              value={editForm.emergency_contact_phone ?? ""}
              onChange={(event) => updateField("emergency_contact_phone", event.target.value)}
              disabled={!isEditing}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-semibold disabled:opacity-100"
            />
          </label>
        </div>
      ) : null}

      {activeTab === "identity" ? (
        <div className="mt-4">
          {!isEditing && (
            <button
              type="button"
              onClick={() => setShowSensitive((value) => !value)}
              className="mb-5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
            >
              {showSensitive ? "Hide" : "Show"} sensitive fields
            </button>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Aadhaar Number</span>
                {isEditing ? (
                  <input
                    value={editForm.aadhaar_number ?? ""}
                    onChange={(event) => updateField("aadhaar_number", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                ) : (
                  <p className="font-semibold text-slate-900">{maskValue(employee.aadhaar_number, showSensitive)}</p>
                )}
              </label>
            </div>
            <div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">PAN Number</span>
                {isEditing ? (
                  <input
                    value={editForm.pan_number ?? ""}
                    onChange={(event) => updateField("pan_number", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                ) : (
                  <p className="font-semibold text-slate-900">{maskValue(employee.pan_number, showSensitive)}</p>
                )}
              </label>
            </div>
            <div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Bank Name</span>
                {isEditing ? (
                  <input
                    value={editForm.bank_name ?? ""}
                    onChange={(event) => updateField("bank_name", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                ) : (
                  <p className="font-semibold text-slate-900">{employee.bank_name ?? "—"}</p>
                )}
              </label>
            </div>
            <div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Account Number</span>
                {isEditing ? (
                  <input
                    value={editForm.account_number ?? ""}
                    onChange={(event) => updateField("account_number", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                ) : (
                  <p className="font-semibold text-slate-900">{maskValue(employee.account_number, showSensitive)}</p>
                )}
              </label>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">IFSC Code</span>
                {isEditing ? (
                  <input
                    value={editForm.ifsc_code ?? ""}
                    onChange={(event) => updateField("ifsc_code", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                ) : (
                  <p className="font-semibold text-slate-900">{maskValue(employee.ifsc_code, showSensitive, 2)}</p>
                )}
              </label>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "documents" ? (
        <div className="mt-4 space-y-3">
          {documents.length === 0 ? (
            <div className="py-4"><EmptyState icon={File} title="No documents" description="No uploaded documents found in storage." /></div>
          ) : (
            documents.map((doc) => (
              <div key={doc.key} className="flex flex-wrap items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-500/20">
                     <File className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{doc.key.split("/").pop()}</p>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">{new Date(doc.uploadedAt).toLocaleString()} — {(doc.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 md:mt-0 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600 transition-colors shadow-sm"
                >
                  Download
                </a>
              </div>
            ))
          )}
        </div>
      ) : null}

      {activeTab === "attendance" ? (
        <div className="mt-4">
          <p className="mb-4 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Last 30 days mini calendar</p>
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-7 md:grid-cols-10">
            {lastThirtyDays.map((day) => {
              const dateKey = formatLocalDate(day);
              const status = attendanceMap[dateKey];
              const isFuture = day > new Date();

              const colorClass = isFuture
                ? "bg-slate-50 text-slate-400 border border-slate-100 opacity-60"
                : status === "present"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-100 ring-1 ring-emerald-500/20 shadow-sm"
                  : status === "half_day"
                    ? "bg-amber-50 text-amber-700 border border-amber-100 ring-1 ring-amber-500/20 shadow-sm"
                    : status === "on_leave"
                      ? "bg-cyan-50 text-cyan-700 border border-cyan-100 ring-1 ring-cyan-500/20 shadow-sm"
                      : status === "absent"
                        ? "bg-rose-50 text-rose-700 border border-rose-100 ring-1 ring-rose-500/20 shadow-sm"
                        : "bg-white text-slate-500 border border-slate-200 shadow-sm";

              return (
                <div key={dateKey} className={`rounded-xl p-2 text-center transition-transform hover:scale-105 cursor-default ${colorClass}`} title={`${dateKey} - ${isFuture ? "Future" : status || "No Record"}`}>
                  <div className="text-[10px] font-bold opacity-70">{day.getDate()}</div>
                  <div className="mt-1 text-sm font-bold uppercase">
                    {isFuture ? "—" : status === "on_leave" ? "L" : status === "present" ? "P" : status === "half_day" ? "H" : status === "absent" ? "A" : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeTab === "leaves" ? (
        <div className="mt-4 space-y-2">
          {leaves.length === 0 ? (
            <div className="py-4"><EmptyState icon={Calendar} title="No leaves" description="No leave records found." /></div>
          ) : (
            leaves.map((leave) => (
              <div key={leave.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{leave.leave_type ?? "leave"} ({leave.start_date} — {leave.end_date})</p>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(leave.status)}`}>
                    {leave.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{leave.reason}</p>
              </div>
            ))
          )}
        </div>
      ) : null}

      {activeTab === "tasks" ? (
        <div className="mt-4 space-y-2">
          {tasks.length === 0 ? (
            <div className="py-4"><EmptyState icon={ClipboardList} title="No tasks" description="No assigned tasks found." /></div>
          ) : (
            tasks.map((task) => (
              <div key={task.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(task.status)}`}>
                    {task.status}
                  </span>
                </div>
                {task.description ? <p className="mt-1 text-sm text-slate-600">{task.description}</p> : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
