import { useEffect, useState, useMemo } from "react";
import { Calendar, FileText } from "lucide-react";
import type { Leave, Employee } from "../types";
import { db } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { useEmployeeShift } from "../hooks/useEmployeeShift";
import { useToast } from "../shared/ToastContext";
import { ConfirmModal } from "../shared/ConfirmModal";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { formatLocalDate } from "../utils/date";
import { calculateBusinessDays } from "../utils/leave";
import { useManagerView } from "../hooks/useManagerView";

type Tab = "apply" | "history" | "team_requests";

const TODAY = formatLocalDate(new Date());

const STATUS_BADGE: Record<Leave["status"], string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

interface LeaveType {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  // Policy enforcement fields (Gap #6)
  min_notice_days: number;
  max_consecutive_days: number | null;
  applicable_from_day: number;
  requires_document: boolean;
}

interface LeaveBalance {
  id: string;
  leave_type_id: string;
  balance: number;
}

export default function MyLeaves() {
  const { employee } = useEmployee();
  const { tenantId } = useTenant();
  const { shift } = useEmployeeShift();
  const { isManagerMode, directReportIds } = useManagerView();
  
  const [tab, setTab] = useState<Tab>("history");
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [holidays, setHolidays] = useState<string[]>([]);
  // Gap #6b: global leave minimum notice days from tenant settings.
  const [globalMinNoticeDays, setGlobalMinNoticeDays] = useState(0);
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ leave_type_id: "", start_date: "", end_date: "", reason: "" });

  const { success, error } = useToast();
  const [cancelModal, setCancelModal] = useState<{ isOpen: boolean; leaveId: string | null; dates: string; type: string }>({ isOpen: false, leaveId: null, dates: "", type: "" });

  // Manager-specific states
  const [teamEmployees, setTeamEmployees] = useState<Employee[]>([]);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (isManagerMode) {
      setTab("team_requests");
    } else {
      setTab("history");
    }
  }, [isManagerMode]);

  const fetchData = async () => {
    if (!employee?.id || !tenantId) return;
    try {
      const currentYear = new Date().getFullYear();
      
      const leavesQuery = isManagerMode
        ? db.from("leaves").select("*").eq("tenant_id", tenantId).in("employee_id", directReportIds.length > 0 ? directReportIds : ["none"]).order("applied_at", { ascending: false })
        : db.from("leaves").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).order("applied_at", { ascending: false });

      const [leavesRes, typesRes, balancesRes, holidaysRes, settingsRes] = await Promise.all([
        leavesQuery,
        // Gap #6a: fetch all policy-relevant leave_type columns.
        db.from("leave_types").select("id, name, code, is_active, min_notice_days, max_consecutive_days, applicable_from_day, requires_document").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
        db.from("leave_balances").select("id, leave_type_id, balance").eq("tenant_id", tenantId).eq("employee_id", employee.id).eq("year", currentYear),
        db.from("holidays").select("date").eq("tenant_id", tenantId).gte("date", `${currentYear}-01-01`),
        // Gap #6b: read global leave minimum notice days.
        db.from("tenant_settings").select("key, value").eq("tenant_id", tenantId).in("key", ["leave_min_notice_days"]),
      ]);

      if (leavesRes.error) throw leavesRes.error;
      if (typesRes.error) throw typesRes.error;
      if (balancesRes.error) throw balancesRes.error;
      if (holidaysRes.error) throw holidaysRes.error;
      if (settingsRes.error) throw settingsRes.error;

      setLeaves((leavesRes.data ?? []) as Leave[]);
      const types = (typesRes.data ?? []) as LeaveType[];
      setLeaveTypes(types);
      setLeaveBalances((balancesRes.data ?? []) as LeaveBalance[]);
      setHolidays((holidaysRes.data ?? []).map((h: any) => h.date));

      // Parse global notice days setting.
      const settingsMap = ((settingsRes.data ?? []) as { key: string; value: string }[]).reduce<Record<string, string>>((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {});
      setGlobalMinNoticeDays(parseInt(settingsMap["leave_min_notice_days"] || "0", 10));
      
      if (types.length > 0 && !form.leave_type_id) {
        setForm(prev => ({ ...prev, leave_type_id: types[0].id }));
      }

      // Fetch team employees if in manager view
      if (isManagerMode && directReportIds.length > 0) {
        const { data: teamData, error: teamErr } = await db
          .from("employees")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("id", directReportIds);
        if (!teamErr && teamData) {
          setTeamEmployees(teamData as Employee[]);
        }
      } else {
        setTeamEmployees([]);
      }
    } catch (err) {
      error("Failed to load leave data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, [employee?.id, tenantId, isManagerMode, directReportIds]);

  // Calculate dynamic business days
  const { total_days: totalDays } = useMemo(() => {
    if (!form.start_date || !form.end_date) return { total_days: 0, working_dates: [] };
    return calculateBusinessDays(form.start_date, form.end_date, shift?.working_days || [1,2,3,4,5,6], holidays);
  }, [form.start_date, form.end_date, shift?.working_days, holidays]);

  const selectedBalance = useMemo(() => {
    if (!form.leave_type_id) return 0;
    const balanceObj = leaveBalances.find(b => b.leave_type_id === form.leave_type_id);
    return balanceObj?.balance ?? 0;
  }, [form.leave_type_id, leaveBalances]);

  async function handleApprove(leave: Leave) {
    setActionLoading(true);
    try {
      const { error: rpcErr } = await db.rpc("approve_leave_request", {
        p_leave_id: leave.id,
        p_working_dates: null,
        p_approved_business_days: null,
      });

      if (rpcErr) throw rpcErr;
      success("Leave approved successfully.");
      void fetchData();
    } catch (err: any) {
      console.error(err);
      error(err.message || "Failed to approve leave.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject(leave: Leave) {
    if (!rejectReason.trim()) {
      error("Please enter a rejection reason.");
      return;
    }
    setActionLoading(true);
    try {
      const { error: rpcErr } = await db.rpc("cancel_leave_request", {
        p_leave_id: leave.id,
        p_rejection_reason: rejectReason,
        p_new_status: "rejected",
      });
      
      if (rpcErr) throw rpcErr;
      success("Leave request rejected.");
      setRejectId(null);
      setRejectReason("");
      void fetchData();
    } catch (err: any) {
      console.error(err);
      error(err.message || "Failed to reject leave.");
    } finally {
      setActionLoading(false);
    }
  }

  async function applyLeave(e: React.FormEvent) {
    e.preventDefault();
    if (!employee?.id || !tenantId || !form.start_date || !form.end_date || !form.reason || !form.leave_type_id) return;

    const selectedType = leaveTypes.find(t => t.id === form.leave_type_id);

    // ── Gap #6: Policy enforcement checks ─────────────────────────────────────

    // 1. Global & per-type minimum notice period
    const perTypeNoticeDays = selectedType?.min_notice_days ?? 0;
    const effectiveNoticeDays = Math.max(globalMinNoticeDays, perTypeNoticeDays);
    if (effectiveNoticeDays > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startDate = new Date(form.start_date);
      startDate.setHours(0, 0, 0, 0);
      const noticeDaysGiven = Math.floor((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (noticeDaysGiven < effectiveNoticeDays) {
        error(
          `This leave requires at least ${effectiveNoticeDays} day${effectiveNoticeDays !== 1 ? "s" : ""} notice. ` +
          `Your selected start date is ${noticeDaysGiven < 0 ? "in the past" : `only ${noticeDaysGiven} day${noticeDaysGiven !== 1 ? "s" : ""} away`}.`
        );
        return;
      }
    }

    // 2. Maximum consecutive days
    if (selectedType?.max_consecutive_days != null && totalDays > selectedType.max_consecutive_days) {
      error(
        `${selectedType.name} allows a maximum of ${selectedType.max_consecutive_days} consecutive working day${selectedType.max_consecutive_days !== 1 ? "s" : ""} per request. ` +
        `Your selection covers ${totalDays} working day${totalDays !== 1 ? "s" : ""}.`
      );
      return;
    }

    // 3. Applicable-after-days (probation / tenure check)
    if (selectedType?.applicable_from_day != null && selectedType.applicable_from_day > 0 && employee.date_of_joining) {
      const joining = new Date(employee.date_of_joining);
      joining.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysSinceJoining = Math.floor((today.getTime() - joining.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceJoining < selectedType.applicable_from_day) {
        const daysRemaining = selectedType.applicable_from_day - daysSinceJoining;
        error(
          `${selectedType.name} is only available after ${selectedType.applicable_from_day} days of employment. ` +
          `You become eligible in ${daysRemaining} more day${daysRemaining !== 1 ? "s" : ""}.`
        );
        return;
      }
    }

    // 4. Leave balance
    if (totalDays > selectedBalance) {
      error(`Insufficient balance. You only have ${selectedBalance} days available.`);
      return;
    }
    
    if (totalDays === 0) {
      error("The selected date range contains no working days.");
      return;
    }

    // ── Gap #7: Overlap check ─────────────────────────────────────────────────
    // Check for existing pending or approved leaves that overlap the requested range.
    const { data: overlapping, error: overlapErr } = await db
      .from("leaves")
      .select("id, start_date, end_date, status")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee.id)
      .in("status", ["pending", "approved"])
      .lte("start_date", form.end_date)
      .gte("end_date", form.start_date);
    if (overlapErr) {
      error("Could not verify leave overlap. Please try again.");
      return;
    }
    if (overlapping && overlapping.length > 0) {
      const existing = overlapping[0] as { start_date: string; end_date: string; status: string };
      error(
        `You already have a ${existing.status} leave from ${existing.start_date} to ${existing.end_date} that overlaps these dates. ` +
        `Please cancel or adjust that request first.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const { error: insErr } = await db.rpc("employee_apply_leave_request", {
        p_tenant_id: tenantId,
        p_leave_type_id: form.leave_type_id,
        p_start_date: form.start_date,
        p_end_date: form.end_date,
        p_reason: form.reason,
      });
      if (insErr) throw insErr;
      
      success("Leave application submitted!");
      setForm({ leave_type_id: leaveTypes[0]?.id || "", start_date: "", end_date: "", reason: "" });
      setTab("history");
      void fetchData();
    } catch (err) {
      console.error(err);
      error("Failed to submit leave request.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelLeave() {
    if (!cancelModal.leaveId) return;
    try {
      const { error: delErr } = await db.rpc("employee_cancel_pending_leave", {
        p_tenant_id: tenantId,
        p_leave_id: cancelModal.leaveId,
      });
      if (delErr) throw delErr;
      success("Leave request cancelled.");
      setCancelModal({ isOpen: false, leaveId: null, dates: "", type: "" });
      void fetchData();
    } catch (err) {
      error("Failed to cancel leave request.");
    }
  }

  const pendingCount = leaves.filter(l => l.status === "pending").length;

  const tabOptions = isManagerMode
    ? ([["team_requests", "Team Requests"], ["history", "Team History"]] as const)
    : ([["history", "My History"], ["apply", "+ Apply Leave"]] as const);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{isManagerMode ? "Team Leaves" : "My Leaves"}</h2>
        <p className="text-sm text-slate-500">
          {isManagerMode ? "Manage leave requests from your direct reports." : "Apply for leave and track your requests."}
        </p>
      </div>

      {/* Leave balance / Team stats */}
      {!isManagerMode ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {leaveTypes.slice(0, 3).map(type => {
            const bal = leaveBalances.find(b => b.leave_type_id === type.id)?.balance ?? 0;
            return (
              <div key={type.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <p className="text-xs font-medium text-slate-500">{type.name} Balance</p>
                <p className="text-2xl font-bold text-brand-600 mt-1">{bal}</p>
                <p className="text-xs text-slate-400">days left</p>
              </div>
            );
          })}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <p className="text-xs font-medium text-slate-500">Total Pending</p>
            <p className="text-2xl font-bold text-rose-600 mt-1">{pendingCount}</p>
            <p className="text-xs text-slate-400">requests</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm col-span-2 sm:col-span-1">
            <p className="text-xs font-medium text-slate-500">Pending Team Requests</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">
              {leaves.filter(l => l.status === "pending").length}
            </p>
            <p className="text-xs text-slate-400">awaiting review</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm col-span-2 sm:col-span-1">
            <p className="text-xs font-medium text-slate-500">Total Direct Reports</p>
            <p className="text-2xl font-bold text-brand-600 mt-1">{teamEmployees.length}</p>
            <p className="text-xs text-slate-400">team members</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {tabOptions.map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab===k ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Team Leave Requests Tab */}
      {tab === "team_requests" && isManagerMode && (
        <div className="space-y-4">
          {loading ? (
            [...Array(2)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)
          ) : leaves.filter(l => l.status === "pending").length === 0 ? (
            <div className="py-10">
              <EmptyState
                icon={Calendar}
                title="No pending team requests"
                description="Your direct reports have not submitted any pending leave requests."
              />
            </div>
          ) : (
            leaves.filter(l => l.status === "pending").map((leave) => {
              const emp = teamEmployees.find((e) => e.id === leave.employee_id);
              const typeName = leave.leave_type_id ? leaveTypes.find(t => t.id === leave.leave_type_id)?.name : leave.leave_type;
              return (
                <div key={leave.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {emp?.profile_photo_url ? (
                        <img src={emp.profile_photo_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                      ) : (
                        <div className="grid h-11 w-11 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                          {emp?.full_name?.slice(0, 2).toUpperCase() ?? "??"}
                        </div>
                      )}
                      <div>
                        <p className="font-semibold text-slate-900">{emp?.full_name ?? "Unknown"}</p>
                        <p className="text-xs capitalize text-slate-500">{emp?.department ?? "—"} · {emp?.designation ?? "—"}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize">{typeName || leave.leave_type || "Leave"}</span>
                      <span>{leave.start_date} → {leave.end_date}</span>
                      <span className="font-semibold text-slate-800">{leave.total_days ?? "?"} days</span>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-slate-700"><span className="font-medium">Reason:</span> {leave.reason}</p>
                  
                  {rejectId === leave.id ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Rejection reason (required)…"
                        rows={2}
                        required
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-rose-500 focus:ring"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => handleReject(leave)} disabled={actionLoading}
                          className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                          Confirm Reject
                        </button>
                        <button onClick={() => { setRejectId(null); setRejectReason(""); }}
                          className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => handleApprove(leave)} disabled={actionLoading}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                        Approve
                      </button>
                      <button onClick={() => setRejectId(leave.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-100">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Apply Form */}
      {tab === "apply" && !isManagerMode && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm max-w-lg">
          <h3 className="font-semibold text-slate-800 mb-4">Apply for Leave</h3>
          {leaveTypes.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Leave types are not configured yet. Please contact HR.
            </div>
          ) : (
            <form onSubmit={applyLeave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Leave Type</label>
                <select value={form.leave_type_id} onChange={e => setForm({...form, leave_type_id: e.target.value})}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring">
                  {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <p className="mt-1 text-[10px] font-semibold text-brand-600">Available Balance: {selectedBalance} days</p>
              </div>

              {/* Gap #6g: requires_document warning banner */}
              {leaveTypes.find(t => t.id === form.leave_type_id)?.requires_document && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span>
                    <span className="font-semibold">Supporting document required.</span>{" "}
                    HR may ask you to submit a supporting document (e.g. medical certificate) for this leave type. Please keep it ready.
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Start Date</label>
                  <input type="date" min={TODAY} value={form.start_date}
                    onChange={e => setForm({...form, start_date: e.target.value, end_date: e.target.value})} required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">End Date</label>
                  <input type="date" min={form.start_date || TODAY} value={form.end_date}
                    onChange={e => setForm({...form, end_date: e.target.value})} required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />
                </div>
              </div>
              {totalDays > 0 && (
                <div className={`rounded-lg border px-3 py-2 text-sm font-semibold ${totalDays > selectedBalance ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-brand-50 border-brand-200 text-brand-700"}`}>
                  Calculated Working Days: {totalDays}
                  {totalDays > selectedBalance && " (Exceeds Balance)"}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Reason *</label>
                <textarea value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} rows={3} required
                  placeholder="Describe the reason for your leave…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />
              </div>
              <button type="submit" disabled={submitting || totalDays > selectedBalance || totalDays === 0}
                className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                {submitting ? "Submitting…" : "Submit Leave Request"}
              </button>
            </form>
          )}
        </div>
      )}

      {/* History */}
      {tab === "history" && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {isManagerMode && (
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Employee</th>
                )}
                {["Type","Dates","Days","Reason","Status","Action"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i}>
                    {isManagerMode && <td className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[100px]" /></td>}
                    {[...Array(6)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[100px]" /></td>
                    ))}
                  </tr>
                ))
              ) : leaves.length === 0 ? (
                <tr>
                  <td colSpan={isManagerMode ? 7 : 6} className="p-8">
                    <EmptyState 
                      icon={Calendar} 
                      title={isManagerMode ? "No team leaves recorded" : "You haven't applied for any leaves yet"} 
                      description={isManagerMode ? "Team members' approved/rejected/cancelled leaves will appear here." : "When you apply for a leave, its history will show up here."}
                      action={!isManagerMode && <button onClick={() => setTab("apply")} className="text-brand-600 font-medium text-sm hover:underline">Apply for Leave</button>}
                    />
                  </td>
                </tr>
              ) : leaves.map(l => {
                const typeName = l.leave_type_id ? leaveTypes.find(t => t.id === l.leave_type_id)?.name : l.leave_type;
                const emp = teamEmployees.find((e) => e.id === l.employee_id);
                return (
                  <tr key={l.id} className="hover:bg-slate-50 transition">
                    {isManagerMode && (
                      <td className="px-4 py-3 font-semibold text-slate-900">{emp?.full_name ?? "—"}</td>
                    )}
                    <td className="px-4 py-3 capitalize font-medium text-slate-800">{typeName || l.leave_type || "—"}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">{l.start_date} → {l.end_date}</td>
                    <td className="px-4 py-3 text-slate-600">{l.total_days ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[200px] truncate" title={l.reason}>{l.reason}</td>
                    <td className="px-4 py-3">
                      <div>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${STATUS_BADGE[l.status]}`}>{l.status}</span>
                        {l.rejection_reason && (
                          <p className="text-[10px] text-rose-600 mt-1">{l.rejection_reason}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isManagerMode ? (
                        l.status === "pending" && (
                          <div className="flex gap-1">
                            <button onClick={() => handleApprove(l)} disabled={actionLoading}
                              className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                              Approve
                            </button>
                            <button onClick={() => setRejectId(l.id)}
                              className="rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100">
                              Reject
                            </button>
                          </div>
                        )
                      ) : (
                        l.status === "pending" && (
                          <button onClick={() => setCancelModal({ isOpen: true, leaveId: l.id, dates: `${l.start_date} to ${l.end_date}`, type: typeName || l.leave_type || "Leave" })}
                            className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">
                            Cancel
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        isOpen={cancelModal.isOpen}
        onClose={() => setCancelModal({ isOpen: false, leaveId: null, dates: "", type: "" })}
        onConfirm={handleCancelLeave}
        title="Cancel Leave Request"
        message={`Cancel your ${cancelModal.type} leave from ${cancelModal.dates}?`}
        confirmText="Cancel Request"
        confirmColor="red"
      />
    </section>
  );
}
