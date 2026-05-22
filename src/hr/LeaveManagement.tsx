import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, XCircle, Filter, Download, Calendar, Plus, Trash2, Upload, FileBox } from "lucide-react";
import type { Employee, Holiday, Leave } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import { useAuditLog } from "../hooks/useAuditLog";
import { useEmployee } from "../hooks/useEmployee";
import { useToast } from "../shared/ToastContext";
import { ConfirmModal } from "../shared/ConfirmModal";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";

type Tab = "pending" | "all" | "holidays";

interface LeaveWithEmployee extends Leave {
  employee?: Employee;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function leaveBadge(status: Leave["status"]) {
  if (status === "approved") return "bg-emerald-100 text-emerald-700";
  if (status === "rejected") return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-700";
}

function exportCSV(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  a.click();
}

export default function LeaveManagement() {
  const { employee: hrEmployee } = useEmployee();
  const { tenantId } = useTenant();
  const { logAction } = useAuditLog();
  const [tab, setTab] = useState<Tab>("pending");
  const { success, error: toastError } = useToast();
  const [deleteHolId, setDeleteHolId] = useState<string | null>(null);

  // ── shared
  const [employees, setEmployees] = useState<Employee[]>([]);
  useEffect(() => {
    let active = true;
    db.from("employees").select("*").eq("tenant_id", tenantId).order("full_name").then(({ data }) => {
      if (active && data) setEmployees(data as Employee[]);
    });
    return () => { active = false; };
  }, [tenantId]);

  // ── PENDING TAB
  const [pendingLeaves, setPendingLeaves] = useState<LeaveWithEmployee[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const { data, error: fetchErr } = await db.from("leaves").select("*").eq("tenant_id", tenantId).eq("status", "pending").order("applied_at", { ascending: false });
      if (fetchErr) throw fetchErr;
      const leaves = (data ?? []) as Leave[];
      const empMap: Record<string, Employee> = {};
      employees.forEach((e) => { empMap[e.id] = e; });
      setPendingLeaves(leaves.map((l) => ({ ...l, employee: empMap[l.employee_id] })));
    } catch (err) {
      toastError("Failed to fetch pending leaves.");
    } finally {
      setPendingLoading(false);
    }
  }, [employees, tenantId, toastError]);

  useEffect(() => {
    if (tab === "pending" && employees.length > 0) void fetchPending();
  }, [tab, fetchPending, employees]);

  async function handleApprove(leave: LeaveWithEmployee) {
    if (!hrEmployee?.id) return;
    setActionLoading(true);
    try {
      await db.from("leaves").update({ status: "approved", reviewed_by: hrEmployee.id, reviewed_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", leave.id);

      // create attendance rows for each leave day
      const start = new Date(leave.start_date);
      const end = new Date(leave.end_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const existing = await db.from("attendance").select("id").eq("tenant_id", tenantId).eq("employee_id", leave.employee_id).eq("date", dateStr);
        if (existing.data && existing.data.length > 0) {
          await db.from("attendance").update({ status: "on_leave", punch_out_allowed: true }).eq("tenant_id", tenantId).eq("employee_id", leave.employee_id).eq("date", dateStr);
        } else {
          await db.from("attendance").insert([{ employee_id: leave.employee_id, tenant_id: tenantId, date: dateStr, status: "on_leave", punch_out_allowed: true }]);
        }
      }

      // notification
      await db.from("notifications").insert([{
        tenant_id: tenantId,
        employee_id: leave.employee_id,
        title: "Leave Approved",
        body: `Your ${leave.leave_type ?? "leave"} from ${fmt(leave.start_date)} to ${fmt(leave.end_date)} has been approved.`,
        type: "leave_approved",
        reference_id: leave.id,
      }]);

      void logAction("leave.approved", "leave", leave.id);
      success("Leave approved.");
    } catch (err) {
      toastError("Failed to approve leave.");
    } finally {
      setActionLoading(false);
      void fetchPending();
    }
  }

  async function handleReject(leave: LeaveWithEmployee) {
    if (!hrEmployee?.id) return;
    setActionLoading(true);
    try {
      await db.from("leaves").update({ status: "rejected", reviewed_by: hrEmployee.id, reviewed_at: new Date().toISOString(), rejection_reason: rejectReason }).eq("tenant_id", tenantId).eq("id", leave.id);
      await db.from("notifications").insert([{
        tenant_id: tenantId,
        employee_id: leave.employee_id,
        title: "Leave Rejected",
        body: `Your ${leave.leave_type ?? "leave"} request was rejected. ${rejectReason ? `Reason: ${rejectReason}` : ""}`,
        type: "leave_rejected",
        reference_id: leave.id,
      }]);
      void logAction("leave.rejected", "leave", leave.id, { reason: rejectReason });
      success("Leave rejected.");
      setRejectId(null);
      setRejectReason("");
    } catch (err) {
      toastError("Failed to reject leave.");
    } finally {
      setActionLoading(false);
      void fetchPending();
    }
  }

  // ── ALL LEAVES TAB
  const [allLeaves, setAllLeaves] = useState<LeaveWithEmployee[]>([]);
  const [allLoading, setAllLoading] = useState(false);
  const [filterEmp, setFilterEmp] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const fetchAll = useCallback(async () => {
    setAllLoading(true);
    try {
      let q = db.from("leaves").select("*").eq("tenant_id", tenantId).order("applied_at", { ascending: false });
      if (filterEmp !== "all") q = q.eq("employee_id", filterEmp);
      if (filterType !== "all") q = q.eq("leave_type", filterType);
      if (filterStatus !== "all") q = q.eq("status", filterStatus);
      if (filterFrom) q = q.gte("start_date", filterFrom);
      if (filterTo) q = q.lte("end_date", filterTo);
      const { data, error: fetchErr } = await q;
      if (fetchErr) throw fetchErr;
      const leaves = (data ?? []) as Leave[];
      const empMap: Record<string, Employee> = {};
      employees.forEach((e) => { empMap[e.id] = e; });
      setAllLeaves(leaves.map((l) => ({ ...l, employee: empMap[l.employee_id] })));
    } catch (err) {
      toastError("Failed to fetch leaves.");
    } finally {
      setAllLoading(false);
    }
  }, [employees, filterEmp, filterType, filterStatus, filterFrom, filterTo, tenantId, toastError]);

  useEffect(() => {
    if (tab === "all" && employees.length > 0) void fetchAll();
  }, [tab, fetchAll, employees]);

  // ── HOLIDAYS TAB
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holLoading, setHolLoading] = useState(false);
  const [holName, setHolName] = useState("");
  const [holDate, setHolDate] = useState("");
  const [holType, setHolType] = useState<Holiday["type"]>("national");
  const [holDesc, setHolDesc] = useState("");
  const [holAdding, setHolAdding] = useState(false);
  const [showAddHol, setShowAddHol] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [showBulk, setShowBulk] = useState(false);

  const fetchHolidays = useCallback(async () => {
    setHolLoading(true);
    try {
      const { data, error: fetchErr } = await db.from("holidays").select("*").eq("tenant_id", tenantId).order("date");
      if (fetchErr) throw fetchErr;
      setHolidays((data ?? []) as Holiday[]);
    } catch (err) {
      toastError("Failed to fetch holidays.");
    } finally {
      setHolLoading(false);
    }
  }, [tenantId, toastError]);

  useEffect(() => {
    if (tab === "holidays") void fetchHolidays();
  }, [tab, fetchHolidays]);

  async function addHoliday() {
    if (!holName || !holDate) return;
    setHolAdding(true);
    try {
      const { error: insErr } = await db.from("holidays").insert([{ name: holName, tenant_id: tenantId, date: holDate, type: holType, description: holDesc || null }]);
      if (insErr) throw insErr;
      success("Holiday added.");
      setHolName(""); setHolDate(""); setHolDesc(""); setShowAddHol(false);
      void fetchHolidays();
    } catch (err) {
      toastError("Failed to add holiday.");
    } finally {
      setHolAdding(false);
    }
  }

  async function deleteHoliday() {
    if (!deleteHolId) return;
    try {
      const { error: delErr } = await db.from("holidays").delete().eq("tenant_id", tenantId).eq("id", deleteHolId);
      if (delErr) throw delErr;
      success("Holiday deleted.");
      setDeleteHolId(null);
      void fetchHolidays();
    } catch (err) {
      toastError("Failed to delete holiday.");
    }
  }

  async function importBulk() {
    const lines = csvText.trim().split("\n").filter(Boolean);
    const rows = lines.map((line) => {
      const [name, date, type, description] = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      return { name, tenant_id: tenantId, date, type: (type ?? "national") as Holiday["type"], description: description ?? null };
    }).filter((r) => r.name && r.date);
    if (rows.length === 0) return;
    try {
      const { error: insErr } = await db.from("holidays").insert(rows);
      if (insErr) throw insErr;
      success(`Imported ${rows.length} holidays.`);
      setCsvText(""); setShowBulk(false);
      void fetchHolidays();
    } catch (err) {
      toastError("Failed to import holidays.");
    }
  }

  // ── Leave Policy Stats
  const policyStats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const approved = allLeaves.filter((l) => l.status === "approved" && l.start_date >= monthStart).length;
    const pending = allLeaves.filter((l) => l.status === "pending").length;
    const typeCount: Record<string, number> = {};
    allLeaves.forEach((l) => { if (l.leave_type) typeCount[l.leave_type] = (typeCount[l.leave_type] ?? 0) + 1; });
    const common = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    return { approved, pending, common };
  }, [allLeaves]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Leave Management</h2>
          <p className="text-sm text-slate-500">Review requests, manage holidays and policies.</p>
        </div>
      </div>

      {/* Policy Stats Card */}
      {tab === "all" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[
            { label: "Approved This Month", value: policyStats.approved, color: "text-emerald-600" },
            { label: "Pending Approvals", value: policyStats.pending, color: "text-amber-600" },
            { label: "Most Common Type", value: policyStats.common, color: "text-blue-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">{label}</p>
              <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="hide-scrollbar flex w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 sm:w-fit">
        {(["pending", "all", "holidays"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition ${tab === t ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {t === "pending" ? "Pending Approvals" : t === "all" ? "All Leaves" : "Holiday List"}
          </button>
        ))}
      </div>

      {/* ── PENDING TAB */}
      {tab === "pending" && (
        <div className="space-y-4">
          {pendingLoading ? (
            [...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)
          ) : pendingLeaves.length === 0 ? (
            <div className="py-10"><EmptyState icon={CheckCircle} title="No pending leave requests" description="You're all caught up!" /></div>
          ) : (
            pendingLeaves.map((leave) => (
              <div key={leave.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {leave.employee?.profile_photo_url ? (
                      <img src={leave.employee.profile_photo_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                    ) : (
                      <div className="grid h-11 w-11 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                        {leave.employee?.full_name.slice(0, 2).toUpperCase() ?? "??"}
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-slate-900">{leave.employee?.full_name ?? "Unknown"}</p>
                      <p className="text-xs capitalize text-slate-500">{leave.employee?.department ?? "—"} · {leave.employee?.designation ?? "—"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize">{leave.leave_type ?? "Leave"}</span>
                    <span>{fmt(leave.start_date)} → {fmt(leave.end_date)}</span>
                    <span className="font-semibold text-slate-800">{leave.total_days ?? "?"} days</span>
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-700"><span className="font-medium">Reason:</span> {leave.reason}</p>

                {rejectId === leave.id ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Rejection reason (optional)"
                      rows={2}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-rose-500 focus:ring"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => handleReject(leave)} disabled={actionLoading}
                        className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                        Confirm Reject
                      </button>
                      <button onClick={() => setRejectId(null)} className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => handleApprove(leave)} disabled={actionLoading}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                      <CheckCircle className="h-4 w-4" /> Approve
                    </button>
                    <button onClick={() => setRejectId(leave.id)}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-100">
                      <XCircle className="h-4 w-4" /> Reject
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── ALL LEAVES TAB */}
      {tab === "all" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Filter className="h-4 w-4 text-slate-400" />
            <select value={filterEmp} onChange={(e) => setFilterEmp(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none ring-brand-600 focus:ring sm:flex-none">
              <option value="all">All Employees</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none ring-brand-600 focus:ring sm:flex-none">
              <option value="all">All Types</option>
              {["casual","sick","earned","unpaid","maternity","paternity","other"].map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none ring-brand-600 focus:ring sm:flex-none">
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none ring-brand-600 focus:ring sm:flex-none" />
            <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none ring-brand-600 focus:ring sm:flex-none" />
            <button onClick={() => void fetchAll()} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">Apply</button>
            <button onClick={() => exportCSV([
              ["Employee","Type","Start","End","Days","Status","Reason"],
              ...allLeaves.map((l) => [l.employee?.full_name ?? l.employee_id, l.leave_type ?? "", l.start_date, l.end_date, String(l.total_days ?? ""), l.status, l.reason])
            ], "leaves_export.csv")} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 sm:ml-auto">
              <Download className="h-4 w-4" /> Export
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  {["Employee","Type","Start","End","Days","Status","Reason"].map((h) => (
                    <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {allLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(7)].map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[100px]" /></td>
                      ))}
                    </tr>
                  ))
                ) : allLeaves.length === 0 ? (
                  <tr><td colSpan={7} className="p-10"><EmptyState icon={FileBox} title="No records found" description="No leaves match the given filters." /></td></tr>
                ) : (
                  allLeaves.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{l.employee?.full_name ?? "—"}</td>
                      <td className="px-4 py-3 capitalize text-slate-700">{l.leave_type ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{fmt(l.start_date)}</td>
                      <td className="px-4 py-3 text-slate-700">{fmt(l.end_date)}</td>
                      <td className="px-4 py-3 text-slate-700">{l.total_days ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${leaveBadge(l.status)}`}>{l.status}</span>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-slate-600">{l.reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── HOLIDAYS TAB */}
      {tab === "holidays" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-800">Holiday List</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setShowBulk(!showBulk)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                <Upload className="h-4 w-4" /> Bulk Import
              </button>
              <button onClick={() => setShowAddHol(!showAddHol)} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
                <Plus className="h-4 w-4" /> Add Holiday
              </button>
            </div>
          </div>

          {showBulk && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <p className="text-sm font-medium text-slate-700">Paste CSV rows: <code className="text-xs text-slate-500">name, date (YYYY-MM-DD), type, description</code></p>
              <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={5} placeholder={"Republic Day, 2025-01-26, national, National holiday\nHoli, 2025-03-14, national,"} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono outline-none ring-brand-600 focus:ring" />
              <div className="flex gap-2">
                <button onClick={importBulk} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">Import</button>
                <button onClick={() => setShowBulk(false)} className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              </div>
            </div>
          )}

          {showAddHol && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <input value={holName} onChange={(e) => setHolName(e.target.value)} placeholder="Holiday Name" className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring col-span-2 md:col-span-1" />
                <input type="date" value={holDate} onChange={(e) => setHolDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring" />
                <select value={holType ?? "national"} onChange={(e) => setHolType(e.target.value as Holiday["type"])} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring">
                  <option value="national">National</option>
                  <option value="company">Company</option>
                  <option value="optional">Optional</option>
                </select>
                <input value={holDesc} onChange={(e) => setHolDesc(e.target.value)} placeholder="Description (optional)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-600 focus:ring col-span-2 md:col-span-1" />
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={addHoliday} disabled={holAdding} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">Save</button>
                <button onClick={() => setShowAddHol(false)} className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {holLoading ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(5)].map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[100px]" /></td>
                      ))}
                    </tr>
                  ))
                ) : holidays.length === 0 ? (
                  <tr><td colSpan={5} className="p-10"><EmptyState icon={Calendar} title="No holidays added" description="Add some holidays to the calendar." /></td></tr>
                ) : (
                  holidays.map((h) => (
                    <tr key={h.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        <span className="mr-2"><Calendar className="inline h-4 w-4 text-brand-600" /></span>{h.name}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{new Date(h.date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${h.type === "national" ? "bg-blue-100 text-blue-700" : h.type === "company" ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-600"}`}>
                          {h.type ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{h.description ?? "—"}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => setDeleteHolId(h.id)} className="rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteHolId}
        onClose={() => setDeleteHolId(null)}
        onConfirm={deleteHoliday}
        title="Delete Holiday"
        message="Are you sure you want to delete this holiday?"
        confirmText="Delete"
        confirmColor="red"
      />
    </section>
  );
}
