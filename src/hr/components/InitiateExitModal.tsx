import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { db, auth } from "../../insforge/client";
import { useTenant } from "../../contexts/TenantContext";
import { useToast } from "../../shared/ToastContext";
import type { Employee } from "../../types";

interface InitiateExitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedEmployeeId?: string | null;
}

export default function InitiateExitModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedEmployeeId
}: InitiateExitModalProps) {
  const { tenantId } = useTenant();
  const { success, error: toastError } = useToast();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [exitType, setExitType] = useState<"resignation" | "termination" | "retirement" | "contract_end" | "absconding">("resignation");
  const [lastWorkingDate, setLastWorkingDate] = useState("");
  const [noticePeriod, setNoticePeriod] = useState("30");
  const [reason, setReason] = useState("");
  const [hrNotes, setHrNotes] = useState("");

  useEffect(() => {
    if (isOpen && tenantId) {
      setLoadingEmployees(true);
      db.from("employees")
        .select("id, full_name, designation, department")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("full_name")
        .then(({ data, error }) => {
          if (error) {
            console.error("Failed to load active employees", error);
            toastError("Failed to load active employees.");
          } else if (data) {
            setEmployees(data as Employee[]);
          }
          setLoadingEmployees(false);
        });
    }
  }, [isOpen, tenantId, toastError]);

  useEffect(() => {
    if (preselectedEmployeeId) {
      setSelectedEmpId(preselectedEmployeeId);
    }
  }, [preselectedEmployeeId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    if (!selectedEmpId) {
      toastError("Please select an employee.");
      return;
    }
    if (!lastWorkingDate) {
      toastError("Please select a last working date.");
      return;
    }

    setSubmitting(true);
    try {
      // Find current user's employee record to get actor ID
      const { data: userData } = await auth.getCurrentUser();
      const currentUserId = userData?.user?.id;
      
      let initiatedBy = "";
      if (currentUserId) {
        const { data: hrEmp } = await db
          .from("employees")
          .select("id")
          .eq("user_id", currentUserId)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (hrEmp) {
          initiatedBy = hrEmp.id;
        }
      }

      if (!initiatedBy) {
        // Fallback to employeeId being processed if no hr employee found
        initiatedBy = selectedEmpId;
      }

      // Check if there is already an active exit request
      const { data: existing } = await db
        .from("exit_requests")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("employee_id", selectedEmpId)
        .in("status", ["pending_approval", "notice_period", "clearance_pending"])
        .limit(1);

      if (existing && existing.length > 0) {
        throw new Error("An active exit request already exists for this employee.");
      }

      const { error: insertErr } = await db.from("exit_requests").insert([{
        tenant_id: tenantId,
        employee_id: selectedEmpId,
        exit_type: exitType,
        initiated_by: initiatedBy,
        initiated_by_role: "hr",
        last_working_date: lastWorkingDate,
        notice_period_days: parseInt(noticePeriod, 10) || 0,
        reason: reason || null,
        hr_notes: hrNotes || null,
        status: "pending_approval"
      }]);

      if (insertErr) throw insertErr;

      // Update employee status to inactive if absconding or immediate termination
      if (exitType === "absconding") {
        await db.from("employees").update({ status: "inactive" }).eq("id", selectedEmpId);
      }

      success("Exit request initiated successfully.");
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error(err);
      toastError(err.message || "Failed to initiate exit request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-950">Initiate Exit Process</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Employee Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Select Employee</label>
              {loadingEmployees ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
                  Loading active employees...
                </div>
              ) : (
                <select
                  disabled={!!preselectedEmployeeId}
                  value={selectedEmpId}
                  onChange={e => setSelectedEmpId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-70"
                >
                  <option value="">-- Choose Employee --</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} ({emp.designation || "No Title"} - {emp.department || "No Dept"})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Exit Type */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Exit Type</label>
                <select
                  value={exitType}
                  onChange={e => setExitType(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="resignation">Resignation</option>
                  <option value="termination">Termination</option>
                  <option value="retirement">Retirement</option>
                  <option value="contract_end">Contract End</option>
                  <option value="absconding">Absconding</option>
                </select>
              </div>

              {/* Notice Period */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Notice Period (Days)</label>
                <input
                  type="number"
                  min="0"
                  value={noticePeriod}
                  onChange={e => setNoticePeriod(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>

            {/* Last Working Date */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Last Working Date</label>
              <input
                type="date"
                value={lastWorkingDate}
                onChange={e => setLastWorkingDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            {/* Reason */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Reason for Exit</label>
              <textarea
                rows={3}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Reason details..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            {/* HR Notes */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">HR Internal Notes</label>
              <textarea
                rows={2}
                value={hrNotes}
                onChange={e => setHrNotes(e.target.value)}
                placeholder="Internal details, handovers, clearance requirements..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-5 py-4 bg-slate-50 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg focus:outline-none transition disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? "Initiating..." : "Initiate Exit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
