import { useEffect, useState, useMemo } from "react";
import { Calendar } from "lucide-react";
import type { Leave } from "../types";
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

type Tab = "apply" | "history";

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
  
  const [tab, setTab] = useState<Tab>("history");
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [holidays, setHolidays] = useState<string[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ leave_type_id: "", start_date: "", end_date: "", reason: "" });

  const { success, error } = useToast();
  const [cancelModal, setCancelModal] = useState<{ isOpen: boolean; leaveId: string | null; dates: string; type: string }>({ isOpen: false, leaveId: null, dates: "", type: "" });

  const fetchData = async () => {
    if (!employee?.id || !tenantId) return;
    try {
      const currentYear = new Date().getFullYear();
      
      const [leavesRes, typesRes, balancesRes, holidaysRes] = await Promise.all([
        db.from("leaves").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).order("applied_at", { ascending: false }),
        db.from("leave_types").select("id, name, code, is_active").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
        db.from("leave_balances").select("id, leave_type_id, balance").eq("tenant_id", tenantId).eq("employee_id", employee.id).eq("year", currentYear),
        db.from("holidays").select("date").eq("tenant_id", tenantId).gte("date", `${currentYear}-01-01`)
      ]);

      if (leavesRes.error) throw leavesRes.error;
      if (typesRes.error) throw typesRes.error;
      if (balancesRes.error) throw balancesRes.error;
      if (holidaysRes.error) throw holidaysRes.error;

      setLeaves((leavesRes.data ?? []) as Leave[]);
      const types = (typesRes.data ?? []) as LeaveType[];
      setLeaveTypes(types);
      setLeaveBalances((balancesRes.data ?? []) as LeaveBalance[]);
      setHolidays((holidaysRes.data ?? []).map((h: any) => h.date));
      
      if (types.length > 0 && !form.leave_type_id) {
        setForm(prev => ({ ...prev, leave_type_id: types[0].id }));
      }
    } catch (err) {
      error("Failed to load leave data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, [employee?.id, tenantId]);

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

  async function applyLeave(e: React.FormEvent) {
    e.preventDefault();
    if (!employee?.id || !tenantId || !form.start_date || !form.end_date || !form.reason || !form.leave_type_id) return;
    
    if (totalDays > selectedBalance) {
      error(`Insufficient balance. You only have ${selectedBalance} days available.`);
      return;
    }
    
    if (totalDays === 0) {
      error("The selected date range contains no working days.");
      return;
    }

    setSubmitting(true);
    try {
      const selectedType = leaveTypes.find(t => t.id === form.leave_type_id);
      
      const { error: insErr } = await db.from("leaves").insert([{
        employee_id: employee.id,
        tenant_id: tenantId,
        leave_type_id: form.leave_type_id,
        leave_type: selectedType?.name || "other", // Fallback for legacy column
        start_date: form.start_date,
        end_date: form.end_date,
        total_days: totalDays,
        reason: form.reason,
        status: "pending",
      }]);
      
      if (insErr) throw insErr;

      // Notify HR
      const { data: hrEmps } = await db.from("employees").select("id").eq("tenant_id", tenantId).eq("department", "operations");
      if (hrEmps && hrEmps.length > 0) {
        await db.from("notifications").insert(
          hrEmps.map((h: { id: string }) => ({
            employee_id: h.id,
            tenant_id: tenantId,
            title: "New Leave Request",
            body: `${employee.full_name} has requested ${selectedType?.name} from ${form.start_date} to ${form.end_date}.`,
            type: "general",
            reference_id: null,
          }))
        );
      }
      
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
      const { error: delErr } = await db.from("leaves").delete().eq("tenant_id", tenantId).eq("id", cancelModal.leaveId).eq("status", "pending");
      if (delErr) throw delErr;
      success("Leave request cancelled.");
      setCancelModal({ isOpen: false, leaveId: null, dates: "", type: "" });
      void fetchData();
    } catch (err) {
      error("Failed to cancel leave request.");
    }
  }

  const pendingCount = leaves.filter(l => l.status === "pending").length;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">My Leaves</h2>
        <p className="text-sm text-slate-500">Apply for leave and track your requests.</p>
      </div>

      {/* Leave balance */}
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

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {([["history","My History"],["apply","+ Apply Leave"]] as const).map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab===k ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Apply Form */}
      {tab === "apply" && (
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
                {["Type","Dates","Days","Reason","Status","Action"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(6)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[100px]" /></td>
                    ))}
                  </tr>
                ))
              ) : leaves.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8">
                    <EmptyState 
                      icon={Calendar} 
                      title="You haven't applied for any leaves yet" 
                      description="When you apply for a leave, its history will show up here."
                      action={<button onClick={() => setTab("apply")} className="text-brand-600 font-medium text-sm hover:underline">Apply for Leave</button>}
                    />
                  </td>
                </tr>
              ) : leaves.map(l => {
                const typeName = l.leave_type_id ? leaveTypes.find(t => t.id === l.leave_type_id)?.name : l.leave_type;
                return (
                  <tr key={l.id} className="hover:bg-slate-50 transition">
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
                      {l.status === "pending" && (
                        <button onClick={() => setCancelModal({ isOpen: true, leaveId: l.id, dates: `${l.start_date} to ${l.end_date}`, type: typeName || l.leave_type || "Leave" })}
                          className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">
                          Cancel
                        </button>
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
