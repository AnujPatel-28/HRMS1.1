import { useEffect, useState } from "react";
import { LogOut, Loader2, CheckCircle2, Clock, HelpCircle } from "lucide-react";
import { db } from "../insforge/client";
import { useAuth } from "../hooks/useAuth";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import { ConfirmModal } from "../shared/ConfirmModal";
import type { ExitClearance, ExitRequest } from "../types";

export default function MyExit() {
  const { currentEmployee } = useAuth();
  const { tenantId } = useTenant();
  const { success, error: toastError } = useToast();

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<ExitRequest | null>(null);
  
  // Submit Form State
  const [lastWorkingDate, setLastWorkingDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchExitDetails = async () => {
    if (!currentEmployee?.id || !tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await db
        .from("exit_requests")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("employee_id", currentEmployee.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;
      if (data && data.length > 0) {
        const latestRequest = data[0] as ExitRequest;
        const { data: clearances, error: clearancesError } = await db
          .from("exit_clearances")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("exit_request_id", latestRequest.id)
          .order("created_at", { ascending: true });

        if (clearancesError) throw clearancesError;
        setRequest({ ...latestRequest, clearances: (clearances ?? []) as ExitClearance[] });
      } else {
        setRequest(null);
      }
    } catch (err) {
      console.error(err);
      toastError("Failed to fetch resignation details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchExitDetails();
  }, [currentEmployee?.id, tenantId]);

  const [timeRemaining, setTimeRemaining] = useState<{ days: number; hours: number; minutes: number; seconds: number } | null>(null);

  useEffect(() => {
    if (!request?.last_working_date || !["notice_period", "clearance_pending"].includes(request.status)) {
      setTimeRemaining(null);
      return;
    }

    const calculateTime = () => {
      const target = new Date(request.last_working_date + "T23:59:59");
      const now = new Date();
      const difference = target.getTime() - now.getTime();

      if (difference <= 0) {
        setTimeRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      setTimeRemaining({
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      });
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [request?.last_working_date, request?.status]);

  const handleSubmitResignation = async () => {
    if (!currentEmployee?.id || !tenantId) return;
    if (!lastWorkingDate) {
      toastError("Please choose a last working date.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await db.from("exit_requests").insert([{
        tenant_id: tenantId,
        employee_id: currentEmployee.id,
        exit_type: "resignation",
        initiated_by: currentEmployee.id,
        initiated_by_role: "employee",
        last_working_date: lastWorkingDate,
        notice_period_days: 30, // Default 30 days notice
        reason: reason || null,
        status: "pending_approval"
      }]);

      if (error) throw error;

      success("Resignation submitted successfully to HR.");
      setConfirmOpen(false);
      void fetchExitDetails();
    } catch (err: any) {
      console.error(err);
      toastError(err.message || "Failed to submit resignation.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-rose-600" />
        <span>Loading details...</span>
      </div>
    );
  }

  // Get status label helper
  const getStatusDisplay = (status: ExitRequest["status"]) => {
    switch (status) {
      case "pending_approval":
        return { text: "Pending HR Approval", style: "bg-amber-50 text-amber-700 border-amber-100" };
      case "notice_period":
        return { text: "Notice Period Active", style: "bg-blue-50 text-blue-700 border-blue-100" };
      case "clearance_pending":
        // Note: clearance_pending status is set when all checklist items are approved. It indicates that final HR completion is pending.
        return { text: "Clearances Pending", style: "bg-orange-50 text-orange-700 border-orange-100" };
      case "completed":
        return { text: "Offboarding Complete", style: "bg-emerald-50 text-emerald-700 border-emerald-100" };
      case "rejected":
        return { text: "Resignation Rejected", style: "bg-rose-50 text-rose-700 border-rose-100" };
      case "withdrawn":
      default:
        return { text: "Withdrawn", style: "bg-slate-50 text-slate-700 border-slate-100" };
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Resignation & Exit</h1>
        <p className="text-sm text-slate-500">Initiate resignation or view your active clearance checklist status.</p>
      </div>

      {request ? (
        /* Status Timeline and Checklist View */
        <div className="border border-slate-200 rounded-xl bg-white p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="text-xs font-bold text-slate-400 uppercase">Exit Tracking</span>
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border capitalize ${getStatusDisplay(request.status).style}`}>
              {getStatusDisplay(request.status).text}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-slate-400 block font-medium uppercase tracking-wider text-[10px]">Submission Date</span>
              <span className="font-bold text-slate-700">{new Date(request.created_at).toLocaleDateString()}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium uppercase tracking-wider text-[10px]">Last Working Date</span>
              <span className="font-bold text-slate-700">
                {request.last_working_date ? new Date(request.last_working_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
              </span>
            </div>
          </div>

          {/* Countdown Timer */}
          {timeRemaining && (
            <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-lg border border-slate-800 flex flex-col items-center justify-center space-y-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-rose-500 animate-pulse" />
                Time Remaining Until Last Working Day
              </span>
              <div className="flex gap-4 text-center">
                <div className="flex flex-col">
                  <span className="text-3xl font-extrabold tracking-tight">{timeRemaining.days}</span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Days</span>
                </div>
                <span className="text-3xl font-extrabold text-slate-700">:</span>
                <div className="flex flex-col">
                  <span className="text-3xl font-extrabold tracking-tight">{String(timeRemaining.hours).padStart(2, "0")}</span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Hrs</span>
                </div>
                <span className="text-3xl font-extrabold text-slate-700">:</span>
                <div className="flex flex-col">
                  <span className="text-3xl font-extrabold tracking-tight">{String(timeRemaining.minutes).padStart(2, "0")}</span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Mins</span>
                </div>
                <span className="text-3xl font-extrabold text-slate-700">:</span>
                <div className="flex flex-col">
                  <span className="text-3xl font-extrabold tracking-tight text-rose-500">{String(timeRemaining.seconds).padStart(2, "0")}</span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Secs</span>
                </div>
              </div>
            </div>
          )}

          {/* Department Clearance Cards */}
          {["notice_period", "clearance_pending", "completed"].includes(request.status) && (
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <span className="text-xs font-bold text-slate-700 uppercase block">Your Department Clearances</span>
              <div className="grid gap-2 sm:grid-cols-2 text-xs">
                {(request.clearances && request.clearances.length > 0
                  ? request.clearances
                      // Hide cancelled rows: not applicable to employee view
                      .filter((c) => c.status !== "cancelled")
                      .map((clearance) => ({
                        checked: clearance.status === "approved",
                        label: clearance.label,
                        optional: clearance.is_required === false,
                      }))
                  : [
                      { checked: request.clearance_assets, label: "Asset Clearance", optional: false },
                      { checked: request.clearance_it, label: "IT & Accounts", optional: false },
                      { checked: request.clearance_finance, label: "Finance / Settlement", optional: false },
                      { checked: request.clearance_hr, label: "HR & Documents", optional: false },
                      { checked: request.clearance_admin, label: "Office Admin / Access Card", optional: false },
                    ]).map((item, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      item.checked
                        ? "bg-emerald-50/50 border-emerald-100 text-emerald-800"
                        : "bg-slate-50 border-slate-150 text-slate-500"
                    }`}
                  >
                    <span className="font-semibold">
                      {item.label}
                      {item.optional && (
                        <span className="ml-1.5 text-[9px] font-bold bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full uppercase">
                          Optional
                        </span>
                      )}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      item.checked ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                    }`}>
                      {item.checked ? "Cleared ✓" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}


          {/* Exit Interview status */}
          {["notice_period", "clearance_pending", "completed"].includes(request.status) && (
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <span className="text-xs font-bold text-slate-700 uppercase block">Exit Interview</span>
              {request.exit_interview_done ? (
                <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-3 text-xs space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                    <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
                    <span>Exit Interview Completed</span>
                  </div>
                  <p className="text-slate-500 leading-relaxed">
                    Your exit interview has been completed with HR. Thank you for your feedback.
                  </p>
                </div>
              ) : (
                <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-4 text-xs space-y-2 text-amber-800">
                  <div className="flex items-center gap-1.5 font-bold">
                    <HelpCircle className="h-4.5 w-4.5 text-amber-600 animate-pulse" />
                    <span>Exit Interview Pending</span>
                  </div>
                  <p className="leading-relaxed">
                    Your exit interview with HR is currently pending. HR will coordinate with you to complete this session shortly.
                  </p>
                </div>
              )}
            </div>
          )}


          {request.status === "pending_approval" && (
            <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-lg text-xs text-amber-800 leading-relaxed">
              <strong>Notice:</strong> Your resignation request is currently under review by the HR department. Once approved, the notice period timeline and clearance checklist will become active.
            </div>
          )}

          {request.status === "completed" && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs font-bold rounded-lg justify-center">
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
              <span>Exit Process Completed successfully. Thank you for your service!</span>
            </div>
          )}
        </div>
      ) : (
        /* Submission Form View */
        <div className="border border-slate-200 rounded-xl bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-rose-600 font-bold text-sm uppercase">
            <LogOut className="h-5 w-5" />
            <span>Initiate Resignation</span>
          </div>

          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Requested Last Working Date</label>
              <input
                type="date"
                value={lastWorkingDate}
                onChange={e => setLastWorkingDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">Notice period is typically 30 days as per company policy.</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Reason for Resignation</label>
              <textarea
                rows={4}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Please share your reason (optional)..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-semibold transition shadow-sm"
            >
              Submit Resignation
            </button>
          </div>

          <ConfirmModal
            isOpen={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            onConfirm={handleSubmitResignation}
            title="Confirm Resignation Submission"
            message="Are you sure you want to submit your resignation? This will initiate the offboarding clearance pipeline with HR and cannot be undone."
            confirmText="Submit"
            confirmColor="red"
            isSubmitting={submitting}
          />
        </div>
      )}
    </div>
  );
}
