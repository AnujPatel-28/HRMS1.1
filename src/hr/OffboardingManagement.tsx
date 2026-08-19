import { useEffect, useState, useCallback, useMemo } from "react";
import { LogOut, CheckCircle2, ShieldAlert, DoorOpen, Loader2, ClipboardCheck, ArrowRight } from "lucide-react";
import { db } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import type { ExitClearance, ExitInterviewData, ExitRequest } from "../types";
import InitiateExitModal from "./components/InitiateExitModal";

export default function OffboardingManagement() {
  const { tenantId } = useTenant();
  const { success, error: toastError } = useToast();

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<ExitRequest[]>([]);
  const [activeTab, setActiveTab] = useState<"active" | "completed" | "rejected">("active");
  const [initiateModalOpen, setInitiateModalOpen] = useState(false);
  
  // Detail Panel / Drawer State
  const [selectedRequest, setSelectedRequest] = useState<ExitRequest | null>(null);
  const [savingClearance, setSavingClearance] = useState(false);

  // Structured exit interview state
  const [interviewData, setInterviewData] = useState<Partial<ExitInterviewData>>({});
  const [interviewNotes, setInterviewNotes] = useState("");
  const [submittingInterview, setSubmittingInterview] = useState(false);

  const clearanceDefinitions = [
    { key: "clearance_assets", department: "assets", label: "Asset Clearance" },
    { key: "clearance_it", department: "it", label: "IT / Accounts Deactivation" },
    { key: "clearance_finance", department: "finance", label: "Finance / Final Settlement" },
    { key: "clearance_hr", department: "hr", label: "HR Clearance & Documentation" },
    { key: "clearance_admin", department: "admin", label: "Admin / Access Card Revocation" }
  ] as const;

  // Compute department pending counts.
  // A clearance is blocking only when:
  //   - is_required is not explicitly false (defaults true if absent)
  //   - status is not 'approved' or 'cancelled'
  const pendingCounts = useMemo(() => {
    const counts: Record<string, number> = { assets: 0, it: 0, finance: 0, hr: 0, admin: 0 };
    requests.forEach((req) => {
      if (["notice_period", "clearance_pending"].includes(req.status)) {
        clearanceDefinitions.forEach((def) => {
          const clearance = req.clearances?.find((c) => c.department === def.department);
          if (clearance) {
            // Use normalized clearance row: skip cancelled and optional rows
            const isBlocking =
              clearance.is_required !== false &&
              clearance.status !== "approved" &&
              clearance.status !== "cancelled";
            if (isBlocking) counts[def.department] = (counts[def.department] || 0) + 1;
          } else {
            // Legacy boolean fallback for requests without clearance rows
            const isApproved = !!(req as any)[def.key];
            if (!isApproved) counts[def.department] = (counts[def.department] || 0) + 1;
          }
        });
      }
    });
    return counts;
  }, [requests]);


  // Sync interview state when selectedRequest changes
  useEffect(() => {
    if (selectedRequest) {
      const existing = selectedRequest.exit_interview_data;
      setInterviewData(existing ?? {});
      setInterviewNotes(selectedRequest.exit_feedback || "");
    } else {
      setInterviewData({});
      setInterviewNotes("");
    }
  }, [selectedRequest]);

  const handleSubmitInterview = async () => {
    if (!selectedRequest) return;
    setSubmittingInterview(true);
    try {
      const payload: ExitInterviewData = {
        ...interviewData,
        completed_by_name: "HR",
        completed_at: new Date().toISOString(),
      };
      // Generate a plain-text compatibility summary for exit_feedback
      const summaryParts: string[] = [];
      if (payload.primary_reason) summaryParts.push(`Reason: ${payload.primary_reason.replace(/_/g, " ")}`);
      if (payload.reason_notes) summaryParts.push(payload.reason_notes);
      if (payload.risk_level) summaryParts.push(`Risk: ${payload.risk_level}`);
      if (typeof payload.rehire_eligible === "boolean")
        summaryParts.push(`Rehire eligible: ${payload.rehire_eligible ? "Yes" : "No"}`);
      if (interviewNotes) summaryParts.push(interviewNotes);
      const feedbackSummary = summaryParts.join(" | ");

      const { error } = await db.rpc("update_exit_interview_transaction", {
        p_request_id: selectedRequest.id,
        p_exit_interview_data: payload,
        p_exit_feedback: feedbackSummary,
      });

      if (error) throw error;
      success("Exit interview completed successfully.");
      setSelectedRequest(prev => prev ? { ...prev, exit_interview_done: true, exit_interview_data: payload, exit_feedback: feedbackSummary } : null);
      void fetchRequests();
    } catch (err: any) {
      console.error(err);
      toastError(err.message || "Failed to submit exit interview.");
    } finally {
      setSubmittingInterview(false);
    }
  };


  const fetchRequests = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await db
        .from("exit_requests")
        .select(`
          *,
          employee:employees!exit_requests_employee_id_fkey (
            full_name,
            designation,
            department,
            profile_photo_url
          )
        `)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      const exitRequests = (data ?? []) as ExitRequest[];
      const requestIds = exitRequests.map((request) => request.id);

      if (requestIds.length === 0) {
        setRequests([]);
        return;
      }

      const { data: clearances, error: clearancesError } = await db
        .from("exit_clearances")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("exit_request_id", requestIds)
        .order("created_at", { ascending: true });

      if (clearancesError) throw clearancesError;

      const clearancesByRequest = new Map<string, ExitClearance[]>();
      ((clearances ?? []) as ExitClearance[]).forEach((clearance) => {
        const list = clearancesByRequest.get(clearance.exit_request_id) ?? [];
        list.push(clearance);
        clearancesByRequest.set(clearance.exit_request_id, list);
      });

      setRequests(exitRequests.map((request) => ({
        ...request,
        clearances: clearancesByRequest.get(request.id) ?? []
      })));
    } catch (err) {
      console.error(err);
      toastError("Failed to fetch offboarding requests.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toastError]);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  const filteredRequests = requests.filter((req) => {
    if (activeTab === "active") {
      return ["pending_approval", "notice_period", "clearance_pending"].includes(req.status);
    }
    if (activeTab === "completed") {
      return req.status === "completed";
    }
    return ["withdrawn", "rejected"].includes(req.status);
  });

  const getStatusStyle = (status: ExitRequest["status"]) => {
    switch (status) {
      case "pending_approval":
        return "bg-amber-50 text-amber-700 border-amber-100";
      case "notice_period":
        return "bg-blue-50 text-blue-700 border-blue-100";
      case "clearance_pending":
        // Note: clearance_pending status is set when all checklist items are approved. It indicates that final HR completion is pending.
        return "bg-orange-50 text-orange-700 border-orange-100";
      case "completed":
        return "bg-emerald-50 text-emerald-700 border-emerald-100";
      case "rejected":
        return "bg-rose-50 text-rose-700 border-rose-100";
      case "withdrawn":
      default:
        return "bg-slate-50 text-slate-700 border-slate-100";
    }
  };

  const handleUpdateStatus = async (requestId: string, newStatus: ExitRequest["status"]) => {
    try {
      const { error } = await db
        .from("exit_requests")
        .update({ status: newStatus })
        .eq("id", requestId);
      if (error) throw error;

      success(`Request status updated to ${newStatus.replace("_", " ")}.`);
      void fetchRequests();
      if (selectedRequest?.id === requestId) {
        setSelectedRequest(prev => prev ? { ...prev, status: newStatus } : null);
      }
    } catch (err) {
      console.error(err);
      toastError("Failed to update status.");
    }
  };

  const handleToggleClearance = async (field: keyof ExitRequest, value: boolean) => {
    if (!selectedRequest) return;
    setSavingClearance(true);
    try {
      const definition = clearanceDefinitions.find((item) => item.key === field);
      if (!definition) throw new Error("Unknown clearance item.");

      const { data, error } = await db.rpc("update_exit_clearance_transaction", {
        p_request_id: selectedRequest.id,
        p_department: definition.department,
        p_approved: value,
        p_remarks: null
      });

      if (error) throw error;

      const result = data as { exit_request?: ExitRequest; clearances?: ExitClearance[] } | null;
      if (result?.exit_request) {
        setSelectedRequest(prev => prev ? {
          ...prev,
          ...result.exit_request,
          employee: prev.employee,
          clearances: result.clearances ?? prev.clearances ?? []
        } : null);
      }

      void fetchRequests();
    } catch (err) {
      console.error(err);
      toastError("Failed to update clearance status.");
    } finally {
      setSavingClearance(false);
    }
  };

  const handleCompleteExit = async () => {
    if (!selectedRequest) return;
    try {
      const { error: completeError } = await db.rpc("complete_exit_transaction", {
        p_request_id: selectedRequest.id
      });

      if (completeError) throw completeError;

      success("Offboarding process completed successfully.");
      setSelectedRequest(null);
      void fetchRequests();
    } catch (err) {
      console.error(err);
      toastError("Failed to complete offboarding.");
    }
  };

  // A clearance blocks completion if is_required is not false AND status is not approved/cancelled
  const allRequiredClearancesApproved = selectedRequest &&
    (selectedRequest.clearances && selectedRequest.clearances.length > 0
      ? selectedRequest.clearances
          .filter((c) => c.is_required !== false)
          .filter((c) => c.status !== "cancelled")
          .every((c) => c.status === "approved")
      : selectedRequest.clearance_assets &&
        selectedRequest.clearance_it &&
        selectedRequest.clearance_finance &&
        selectedRequest.clearance_hr &&
        selectedRequest.clearance_admin);
  const allClearancesChecked = allRequiredClearancesApproved;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Offboarding & Exit Management</h1>
          <p className="text-sm text-slate-500">Track notice periods, exit clearances, and complete departures.</p>
        </div>
        <button
          onClick={() => setInitiateModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 shadow-sm transition"
        >
          <LogOut className="h-4 w-4" />
          Initiate Exit Process
        </button>
      </div>

      {/* Tabs Layout */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab("active")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
            activeTab === "active"
              ? "border-rose-600 text-rose-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Active Exits
        </button>
        <button
          onClick={() => setActiveTab("completed")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
            activeTab === "completed"
              ? "border-rose-600 text-rose-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Completed
        </button>
        <button
          onClick={() => setActiveTab("rejected")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
            activeTab === "rejected"
              ? "border-rose-600 text-rose-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Withdrawn / Rejected
        </button>
      </div>

      {/* Department-level Pending Clearance Cards */}
      {activeTab === "active" && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {clearanceDefinitions.map((def) => {
            const count = pendingCounts[def.department] || 0;
            return (
              <div key={def.department} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">{def.label.split(" ")[0]} Clearance</span>
                <div className="flex items-baseline justify-between mt-2">
                  <span className={`text-2xl font-bold ${count > 0 ? "text-rose-600" : "text-slate-650"}`}>{count}</span>
                  <span className="text-[9px] font-semibold text-slate-450 uppercase tracking-wider">Pending</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main List Table */}
      <div className="grid gap-6 lg:grid-cols-3 items-start">
        <div className="lg:col-span-2 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-rose-600" />
              <span>Loading offboarding requests...</span>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-4">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600 mb-3">
                <DoorOpen className="h-6 w-6" />
              </div>
              <h4 className="text-sm font-semibold text-slate-800">No requests found</h4>
              <p className="text-xs text-slate-500 mt-1">There are no exit requests matching this status.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm text-slate-500">
                <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200">
                  <tr>
                    <th scope="col" className="px-6 py-4">Employee</th>
                    <th scope="col" className="px-6 py-4">Exit Details</th>
                    <th scope="col" className="px-6 py-4">Last Working Date</th>
                    <th scope="col" className="px-6 py-4">Status</th>
                    <th scope="col" className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRequests.map((req) => {
                    const initials = req.employee?.full_name?.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() || "EE";
                    return (
                      <tr
                        key={req.id}
                        onClick={() => setSelectedRequest(req)}
                        className={`hover:bg-slate-50/50 transition duration-150 cursor-pointer ${
                          selectedRequest?.id === req.id ? "bg-rose-50/20 font-semibold" : ""
                        }`}
                      >
                        <td className="px-6 py-4 flex items-center gap-3">
                          {req.employee?.profile_photo_url ? (
                            <img src={req.employee.profile_photo_url} alt="" className="h-9 w-9 rounded-full object-cover shadow-sm" />
                          ) : (
                            <div className="grid h-9 w-9 place-items-center rounded-full bg-rose-50 text-xs font-bold text-rose-700 border border-rose-100">
                              {initials}
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-slate-900">{req.employee?.full_name}</p>
                            <p className="text-[10px] text-slate-400 capitalize">{req.employee?.designation || "Staff"}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="capitalize text-xs font-semibold text-slate-700 block">{req.exit_type}</span>
                          <span className="text-[10px] text-slate-400">Initiated by {req.initiated_by_role}</span>
                        </td>
                        <td className="px-6 py-4 font-medium text-slate-900">
                          {req.last_working_date ? new Date(req.last_working_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border capitalize ${getStatusStyle(req.status)}`}>
                            {req.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => setSelectedRequest(req)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-700 hover:underline"
                          >
                            Manage
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Detail Panel Drawer */}
        <div className="lg:col-span-1">
          {selectedRequest ? (
            <div className="border border-slate-200 rounded-xl bg-white shadow-sm p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-950">Exit Details</h3>
                <button
                  onClick={() => setSelectedRequest(null)}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-600"
                >
                  Close
                </button>
              </div>

              {/* Employee Info Header */}
              <div className="flex items-center gap-3">
                {selectedRequest.employee?.profile_photo_url ? (
                  <img src={selectedRequest.employee.profile_photo_url} alt="" className="h-12 w-12 rounded-full object-cover shadow-sm ring-1 ring-slate-100" />
                ) : (
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-rose-50 text-sm font-bold text-rose-700">
                    {selectedRequest.employee?.full_name?.slice(0, 2).toUpperCase() || "EE"}
                  </div>
                )}
                <div>
                  <h4 className="font-bold text-slate-900">{selectedRequest.employee?.full_name}</h4>
                  <p className="text-xs text-slate-500 capitalize">{selectedRequest.employee?.designation} • {selectedRequest.employee?.department}</p>
                </div>
              </div>

              {/* Core Details */}
              <div className="grid grid-cols-2 gap-4 text-xs border-y border-slate-100 py-3">
                <div>
                  <span className="text-slate-400 block font-medium uppercase tracking-wider text-[10px]">Exit Type</span>
                  <span className="font-bold text-slate-700 capitalize">{selectedRequest.exit_type}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium uppercase tracking-wider text-[10px]">Notice Days</span>
                  <span className="font-bold text-slate-700">{selectedRequest.notice_period_days ?? 30} days</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium uppercase tracking-wider text-[10px]">Last Working Date</span>
                  <span className="font-bold text-slate-700">
                    {selectedRequest.last_working_date ? new Date(selectedRequest.last_working_date).toLocaleDateString() : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium uppercase tracking-wider text-[10px]">Status</span>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border capitalize mt-1 ${getStatusStyle(selectedRequest.status)}`}>
                    {selectedRequest.status.replace("_", " ")}
                  </span>
                </div>
              </div>

              {/* Reason */}
              {selectedRequest.reason && (
                <div className="text-xs">
                  <span className="text-slate-400 block font-medium uppercase tracking-wider text-[10px] mb-1">Reason Shared</span>
                  <p className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-slate-700 italic">
                    "{selectedRequest.reason}"
                  </p>
                </div>
              )}

              {/* HR Approval controls for Pending Approval status */}
              {selectedRequest.status === "pending_approval" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdateStatus(selectedRequest.id, "rejected")}
                    className="flex-1 px-3 py-2 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition"
                  >
                    Reject Exit
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(selectedRequest.id, "notice_period")}
                    className="flex-1 px-3 py-2 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition shadow-sm"
                  >
                    Approve exit
                  </button>
                </div>
              )}

              {/* Clearances Checklist Area */}
              {["notice_period", "clearance_pending"].includes(selectedRequest.status) && (
                <div className="space-y-4">
                  {/* Clearances */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase">
                      <ClipboardCheck className="h-4 w-4 text-slate-500" />
                      <span>Department Clearances</span>
                    </div>
                    <div className="space-y-2 border border-slate-100 rounded-xl p-3 bg-slate-50/50">
                      {clearanceDefinitions.map((item) => {
                        const normalizedClearance = selectedRequest.clearances?.find((clearance) => clearance.department === item.department);
                        const checked = normalizedClearance ? normalizedClearance.status === "approved" : !!(selectedRequest as any)[item.key];
                        return (
                          <label key={item.key} className="flex items-center gap-3 text-xs text-slate-700 py-1 cursor-pointer">
                            <input
                              type="checkbox"
                              disabled={savingClearance}
                              checked={checked}
                              onChange={(e) => handleToggleClearance(item.key as any, e.target.checked)}
                              className="rounded border-slate-200 text-brand-600 focus:ring-brand-500 h-4 w-4"
                            />
                            <span className={checked ? "line-through text-slate-400 font-medium" : "font-medium"}>
                              {normalizedClearance?.label ?? item.label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Exit Interview Form */}
                  <div className="space-y-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase">
                      <DoorOpen className="h-4 w-4 text-slate-500" />
                      <span>Exit Interview</span>
                    </div>

                    {selectedRequest.exit_interview_done ? (
                      <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-3 text-xs space-y-2">
                        <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <span>Interview Completed</span>
                        </div>
                        {selectedRequest.exit_interview_data?.primary_reason && (
                          <p className="text-slate-600 font-medium capitalize">
                            Reason: {selectedRequest.exit_interview_data.primary_reason.replace(/_/g, " ")}
                          </p>
                        )}
                        {selectedRequest.exit_interview_data?.risk_level && (
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                            selectedRequest.exit_interview_data.risk_level === "high"
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : selectedRequest.exit_interview_data.risk_level === "medium"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-100"
                          }`}>
                            Risk: {selectedRequest.exit_interview_data.risk_level}
                          </span>
                        )}
                        {typeof selectedRequest.exit_interview_data?.rehire_eligible === "boolean" && (
                          <p className="text-slate-500">
                            Rehire eligible: <span className="font-semibold">{selectedRequest.exit_interview_data.rehire_eligible ? "Yes" : "No"}</span>
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3 bg-slate-50/80 border border-slate-150 rounded-xl p-3">
                        {/* Primary Reason */}
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Primary Reason</label>
                          <select
                            value={interviewData.primary_reason ?? ""}
                            onChange={(e) => setInterviewData(d => ({ ...d, primary_reason: e.target.value as ExitInterviewData["primary_reason"] }))}
                            className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
                          >
                            <option value="">Select reason...</option>
                            <option value="career_growth">Career Growth</option>
                            <option value="compensation">Compensation</option>
                            <option value="manager">Manager Relationship</option>
                            <option value="relocation">Relocation</option>
                            <option value="personal">Personal Reasons</option>
                            <option value="performance">Performance</option>
                            <option value="culture">Culture Fit</option>
                            <option value="other">Other</option>
                          </select>
                        </div>

                        {/* Reason Notes */}
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Reason Notes</label>
                          <textarea
                            rows={2}
                            value={interviewData.reason_notes ?? ""}
                            onChange={(e) => setInterviewData(d => ({ ...d, reason_notes: e.target.value }))}
                            placeholder="Additional context about departure..."
                            className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
                          />
                        </div>

                        {/* Ratings row */}
                        <div className="grid grid-cols-3 gap-2">
                          {([
                            { key: "work_environment_rating", label: "Work Env" },
                            { key: "compensation_rating", label: "Compensation" },
                            { key: "growth_rating", label: "Growth" },
                          ] as { key: keyof ExitInterviewData; label: string }[]).map(({ key, label }) => (
                            <div key={key}>
                              <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">{label} (1-5)</label>
                              <input
                                type="number" min={1} max={5}
                                value={(interviewData as any)[key] ?? ""}
                                onChange={(e) => setInterviewData(d => ({ ...d, [key]: e.target.value ? Number(e.target.value) : undefined }))}
                                className="w-full rounded-lg border border-slate-200 p-1.5 text-xs bg-white outline-none focus:border-rose-500"
                              />
                            </div>
                          ))}
                        </div>

                        {/* Risk + Rehire row */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Risk Level</label>
                            <select
                              value={interviewData.risk_level ?? ""}
                              onChange={(e) => setInterviewData(d => ({ ...d, risk_level: e.target.value as ExitInterviewData["risk_level"] }))}
                              className="w-full rounded-lg border border-slate-200 p-1.5 text-xs bg-white outline-none focus:border-rose-500"
                            >
                              <option value="">Select...</option>
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Rehire Eligible</label>
                            <select
                              value={typeof interviewData.rehire_eligible === "boolean" ? String(interviewData.rehire_eligible) : ""}
                              onChange={(e) => setInterviewData(d => ({ ...d, rehire_eligible: e.target.value === "" ? undefined : e.target.value === "true" }))}
                              className="w-full rounded-lg border border-slate-200 p-1.5 text-xs bg-white outline-none focus:border-rose-500"
                            >
                              <option value="">Select...</option>
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </select>
                          </div>
                        </div>

                        {/* Knowledge transfer + HR Notes */}
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">HR Notes / Action Items</label>
                          <textarea
                            rows={2}
                            value={interviewNotes}
                            onChange={(e) => setInterviewNotes(e.target.value)}
                            placeholder="Knowledge transfer status, action items, follow-up notes..."
                            className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handleSubmitInterview}
                          disabled={submittingInterview || !interviewData.primary_reason}
                          className="w-full py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:bg-slate-250 disabled:text-slate-400 rounded-lg transition shadow-sm"
                        >
                          {submittingInterview ? "Submitting..." : "Complete Exit Interview"}
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {allClearancesChecked && (
                    <div className="space-y-2 pt-3 border-t border-slate-100">
                      {!selectedRequest.exit_interview_done && (
                        <p className="text-[10px] text-amber-700 font-semibold flex items-center gap-1 bg-amber-50 border border-amber-100 rounded-lg p-2">
                          ⚠️ Clearances approved, but exit interview is pending.
                        </p>
                      )}
                      <button
                        onClick={handleCompleteExit}
                        disabled={!selectedRequest.exit_interview_done}
                        className="w-full px-4 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 rounded-lg transition shadow flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Complete Offboarding
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Completed Status State */}
              {selectedRequest.status === "completed" && (
                <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs font-bold rounded-lg justify-center">
                  <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
                  <span>Offboarding Completed (Employee Inactive)</span>
                </div>
              )}

              {selectedRequest.status === "rejected" && (
                <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-100 text-rose-800 text-xs font-bold rounded-lg justify-center">
                  <ShieldAlert className="h-4.5 w-4.5 text-rose-600" />
                  <span>Exit Request Rejected</span>
                </div>
              )}
            </div>
          ) : (
            <div className="border border-dashed border-slate-200 rounded-xl py-12 px-4 text-center text-slate-400 text-xs font-medium">
              Select an exit request from the table to manage clearances.
            </div>
          )}
        </div>
      </div>

      {/* Scaffolding Modal */}
      <InitiateExitModal
        isOpen={initiateModalOpen}
        onClose={() => setInitiateModalOpen(false)}
        onSuccess={fetchRequests}
      />
    </div>
  );
}
