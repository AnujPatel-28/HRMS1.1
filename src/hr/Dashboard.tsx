import { useCallback, useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  CalendarCheck,
  Clock,
  AlertCircle,
  TrendingUp,
  CheckCircle2,
  XCircle,
  ArrowRight,
  CheckCircle,
  Bell,
  X,
  ChevronLeft,
  Loader2,
  Check
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Attendance, Employee, Leave, Notification, Shift, EmployeeShift } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { db } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useToast } from "../shared/ToastContext";
import { Skeleton } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { formatLocalDate } from "../utils/date";
import { cn } from "../utils/cn";

interface KPI {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ── Confetti Burst Animation Component ──
function ConfettiBurst({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; color: string; scale: number; rotate: number }[]>([]);

  useEffect(() => {
    if (active) {
      const colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4"];
      const newParticles = Array.from({ length: 80 }).map((_, idx) => ({
        id: idx,
        x: (Math.random() - 0.5) * 280,
        y: -(Math.random() * 180 + 120),
        color: colors[Math.floor(Math.random() * colors.length)],
        scale: Math.random() * 0.6 + 0.4,
        rotate: Math.random() * 360,
      }));
      setParticles(newParticles);
      const timer = setTimeout(() => setParticles([]), 2500);
      return () => clearTimeout(timer);
    }
  }, [active]);

  if (particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[1000] flex items-center justify-center">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0, rotate: 0 }}
          animate={{
            x: p.x,
            y: p.y + 350,
            opacity: [1, 1, 0],
            scale: p.scale,
            rotate: p.rotate + 360,
          }}
          transition={{
            duration: 1.8 + Math.random() * 0.6,
            ease: "easeOut",
          }}
          className="absolute w-2.5 h-2.5"
          style={{
            backgroundColor: p.color,
            borderRadius: Math.random() > 0.5 ? "50%" : "2px",
          }}
        />
      ))}
    </div>
  );
}

// ── Reusable Mobile Bottom Sheet / Tray ──
function MobileTray({
  isOpen,
  onClose,
  title,
  children,
  onBack,
  showBack = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  onBack?: () => void;
  showBack?: boolean;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed -inset-10 z-[110] bg-slate-900/60 backdrop-blur-xs md:hidden"
            onClick={onClose}
          />

          {/* Bottom Sheet container */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed bottom-0 left-0 right-0 z-[120] max-h-[90vh] overflow-y-auto rounded-t-[28px] border-t border-slate-200 bg-white p-6 shadow-2xl md:hidden pb-safe flex flex-col"
          >
            {/* Visual drag indicator handle */}
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200 shrink-0" />

            {/* Header */}
            <div className="mb-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                {showBack && onBack && (
                  <button
                    onClick={onBack}
                    className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                )}
                <h3 className="text-lg font-bold text-slate-900 font-display">{title}</h3>
              </div>
              <button
                onClick={onClose}
                className="rounded-full bg-slate-100 p-1.5 text-slate-500 hover:bg-slate-200 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto pb-10">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Text Morphing Button ──
function MorphingButton({
  label,
  morphState,
  onClick,
  disabled = false,
  className = "",
}: {
  label: string;
  morphState: "idle" | "busy" | "success";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const displayLabel = () => {
    if (morphState === "busy") return "Processing...";
    if (morphState === "success") return "Done! 🎉";
    return label;
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || morphState !== "idle"}
      className={cn(
        "relative overflow-hidden transition-all duration-200 active:scale-98 disabled:opacity-70",
        className
      )}
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={displayLabel()}
          initial={{ y: 15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -15, opacity: 0 }}
          transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.25 }}
          className="flex items-center justify-center gap-1.5 w-full"
        >
          {morphState === "busy" && <Loader2 className="h-4 w-4 animate-spin" />}
          {morphState === "success" && <Check className="h-4 w-4" />}
          {displayLabel()}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export default function HRDashboard() {
  const navigate = useNavigate();
  const { employee } = useEmployee();
  const { tenantId, tenant } = useTenant();
  const { error: toastError } = useToast();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<(Leave & { employee?: Employee })[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<Attendance[]>([]);
  const [recentNotifs, setRecentNotifs] = useState<Notification[]>([]);

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employeeShifts, setEmployeeShifts] = useState<EmployeeShift[]>([]);
  const [selectedShift, setSelectedShift] = useState<string>("all");

  const [loading, setLoading] = useState(true);
  const [confettiActive, setConfettiActive] = useState(false);

  // Mobile Tray States
  const [activeTray, setActiveTray] = useState<"leave_approval" | "activity_detail" | null>(null);
  const [selectedLeave, setSelectedLeave] = useState<(Leave & { employee?: Employee }) | null>(null);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);

  // Leave Approval Action States
  const [approveState, setApproveState] = useState<"idle" | "busy" | "success">("idle");
  const [rejectState, setRejectState] = useState<"idle" | "busy" | "success">("idle");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const today = formatLocalDate(new Date());

  const fetchAll = useCallback(async () => {
    try {
      const [empRes, leaveRes, attRes, notifRes, shiftRes, empShiftRes] = await Promise.all([
        db.from("employees").select("*").eq("tenant_id", tenantId).eq("status", "active"),
        db.from("leaves").select("*").eq("tenant_id", tenantId).eq("status", "pending").order("applied_at", { ascending: false }).limit(5),
        db.from("attendance").select("*").eq("tenant_id", tenantId).eq("date", today),
        db.from("notifications").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(6),
        db.from("shifts").select("*").eq("tenant_id", tenantId).eq("is_active", true),
        db.from("employee_shifts").select("*").eq("tenant_id", tenantId)
          .lte("effective_from", today)
          .or(`effective_to.is.null,effective_to.gte.${today}`),
      ]);

      if (empRes.error) throw empRes.error;
      if (leaveRes.error) throw leaveRes.error;
      if (attRes.error) throw attRes.error;
      if (notifRes.error) throw notifRes.error;
      if (shiftRes.error) throw shiftRes.error;
      if (empShiftRes.error) throw empShiftRes.error;

      const emps = (empRes.data ?? []) as Employee[];
      const empMap: Record<string, Employee> = {};
      emps.forEach((e) => { empMap[e.id] = e; });

      setEmployees(emps);
      setPendingLeaves(((leaveRes.data ?? []) as Leave[]).map((l) => ({ ...l, employee: empMap[l.employee_id] })));
      setTodayAttendance((attRes.data ?? []) as Attendance[]);
      setRecentNotifs((notifRes.data ?? []) as Notification[]);
      setShifts((shiftRes.data ?? []) as Shift[]);
      setEmployeeShifts((empShiftRes.data ?? []) as EmployeeShift[]);
    } catch (err) {
      toastError("Failed to load dashboard data.");
    }
  }, [tenantId, today, toastError]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchAll();
      setLoading(false);
    };
    void init();
  }, [fetchAll]);

  const filteredEmployees = useMemo(() => {
    if (selectedShift === "all") return employees;
    const assignedIds = new Set(
      employeeShifts
        .filter((es) => es.shift_id === selectedShift)
        .map((es) => es.employee_id)
    );
    const isDefault = shifts.find(s => s.id === selectedShift)?.is_default;
    const hasAnyAssignment = new Set(employeeShifts.map(es => es.employee_id));

    return employees.filter(emp => {
      if (assignedIds.has(emp.id)) return true;
      if (isDefault && !hasAnyAssignment.has(emp.id)) return true;
      return false;
    });
  }, [selectedShift, employees, employeeShifts, shifts]);

  const filteredAttendance = useMemo(() => {
    if (selectedShift === "all") return todayAttendance;
    const validEmpIds = new Set(filteredEmployees.map(e => e.id));
    return todayAttendance.filter(a => validEmpIds.has(a.employee_id));
  }, [selectedShift, todayAttendance, filteredEmployees]);

  const presentCount = filteredAttendance.filter((a) => ["present", "half_day"].includes(a.status)).length;
  const absentCount = filteredEmployees.length - filteredAttendance.length;
  const onLeaveCount = filteredAttendance.filter((a) => a.status === "on_leave").length;

  const kpis: KPI[] = [
    {
      label: "Total Employees",
      value: filteredEmployees.length,
      sub: "Active headcount",
      icon: <Users className="h-5 w-5" />,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Present Today",
      value: presentCount,
      sub: `${filteredEmployees.length > 0 ? Math.round((presentCount / filteredEmployees.length) * 100) : 0}% attendance rate`,
      icon: <CalendarCheck className="h-5 w-5" />,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Absent / No Punch",
      value: absentCount,
      sub: "Missing today",
      icon: <AlertCircle className="h-5 w-5" />,
      color: "text-rose-600",
      bg: "bg-rose-50",
    },
    {
      label: "On Leave Today",
      value: onLeaveCount,
      sub: "Approved leaves",
      icon: <Clock className="h-5 w-5" />,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
  ];

  const leaveBadge = (status: Leave["status"]) => {
    if (status === "approved") return "bg-emerald-100 text-emerald-700";
    if (status === "rejected") return "bg-rose-100 text-rose-700";
    return "bg-amber-100 text-amber-700";
  };

  // Leave Approval Action Handler
  const handleApproveLeave = async () => {
    if (!selectedLeave) return;
    setApproveState("busy");
    try {
      const { error: rpcErr } = await db.rpc("approve_leave_request", {
        p_leave_id: selectedLeave.id,
        p_working_dates: null,
        p_approved_business_days: null,
      });
      if (rpcErr) throw rpcErr;

      setApproveState("success");
      setConfettiActive(true);
      setTimeout(() => {
        setActiveTray(null);
        setSelectedLeave(null);
        setApproveState("idle");
        void fetchAll();
      }, 1000);
    } catch (err: any) {
      console.error(err);
      toastError(err.message || "Failed to approve leave.");
      setApproveState("idle");
    }
  };

  // Leave Rejection Action Handler
  const handleRejectLeave = async () => {
    if (!selectedLeave || !rejectReason.trim()) {
      toastError("Please enter a rejection reason.");
      return;
    }
    setRejectState("busy");
    try {
      const { error: rpcErr } = await db.rpc("cancel_leave_request", {
        p_leave_id: selectedLeave.id,
        p_rejection_reason: rejectReason,
        p_new_status: "rejected",
      });
      if (rpcErr) throw rpcErr;

      setRejectState("success");
      setTimeout(() => {
        setActiveTray(null);
        setSelectedLeave(null);
        setShowRejectForm(false);
        setRejectReason("");
        setRejectState("idle");
        void fetchAll();
      }, 1000);
    } catch (err: any) {
      console.error(err);
      toastError(err.message || "Failed to reject leave.");
      setRejectState("idle");
    }
  };

  if (loading) {
    return (
      <section className="space-y-6 pt-4 md:pt-0">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6 relative pt-4 md:pt-0">
      <ConfettiBurst active={confettiActive} />

      {/* Welcome Card Banner */}
      <div
        className="rounded-2xl border border-brand-100 p-6 text-white shadow-xl bg-cover bg-center bg-no-repeat bg-[url('/full.svg')] min-[912px]:bg-[url('/green%20gradiant.svg')] relative overflow-hidden"
        style={{ backgroundColor: "#059669" }}
      >
        <div className="relative z-10 w-full md:w-2/3">
          <p className="text-sm font-medium opacity-85">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"},
          </p>
          <h2 className="mt-0.5 text-2xl font-bold font-display">{employee?.full_name ?? "HR Manager"} 👋</h2>
          <p className="mt-1 text-xs opacity-75 leading-relaxed">
            Here's what's happening at {tenant?.company_name ?? "TalentMesh"} today —{" "}
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            .
          </p>
        </div>

        {/* Desktop Illustration */}
        <img
          src="/illu1.svg"
          alt=""
          className="absolute right-4 bottom-0 h-[135%] w-auto object-contain object-bottom hidden min-[912px]:block pointer-events-none z-0"
        />
      </div>

      {/* ── Today's Overview header & Shift Pill Slider ── */}
      <div className="flex flex-col gap-4 sm:gap-6 lg:bg-white lg:rounded-3xl lg:border lg:border-slate-200 lg:shadow-sm lg:p-6">
        <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-2 lg:px-0">
          <h3 className="text-base font-bold text-slate-900 font-display">Today's Overview</h3>

          {/* MOBILE SHIFT FILTER PILL SLIDER */}
          {shifts.length > 0 && (
            <div className="md:hidden w-full bg-slate-100/80 border border-slate-200/30 rounded-xl p-1 flex gap-1 items-center select-none overflow-x-auto hide-scrollbar">
              <button
                onClick={() => setSelectedShift("all")}
                className={cn(
                  "flex-1 text-center py-2 text-xs font-semibold rounded-lg transition-all duration-200 relative z-10 shrink-0 min-w-[80px]",
                  selectedShift === "all" ? "text-white font-bold" : "text-slate-500 hover:text-slate-800"
                )}
              >
                {selectedShift === "all" && (
                  <motion.div
                    layoutId="hr-active-shift"
                    className="absolute inset-0 bg-brand-700 shadow-sm border border-brand-600/20 rounded-lg -z-10"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                All Shifts
              </button>
              {shifts.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedShift(s.id ?? "")}
                  className={cn(
                    "flex-1 text-center py-2 text-xs font-semibold rounded-lg transition-all duration-200 relative z-10 shrink-0 min-w-[80px]",
                    selectedShift === s.id ? "text-white font-bold" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  {selectedShift === s.id && (
                    <motion.div
                      layoutId="hr-active-shift"
                      className="absolute inset-0 bg-brand-700 shadow-sm border border-brand-600/20 rounded-lg -z-10"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  {s.name}
                </button>
              ))}
            </div>
          )}


          {/* DESKTOP SHIFT SELECTOR */}
          <div className="hidden md:flex items-center">
            {shifts.length === 0 ? (
              <div className="inline-flex items-center rounded-xl bg-white p-1 shadow-sm border border-slate-200">
                <span className="px-3 py-1.5 text-sm text-slate-400">No shifts yet</span>
                <button
                  onClick={() => navigate("/hr/shifts")}
                  className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-brand-50 text-brand-700 shadow-sm ring-1 ring-brand-200 hover:bg-brand-100"
                >
                  + Add Shift
                </button>
              </div>
            ) : (
              <div className="inline-flex items-center rounded-xl bg-white p-1 shadow-sm border border-slate-200">
                <button
                  onClick={() => setSelectedShift("all")}
                  className={cn(
                    "px-4 py-1.5 text-sm font-semibold rounded-lg transition-all",
                    selectedShift === "all"
                      ? "bg-brand-50 text-brand-700 shadow-sm ring-1 ring-brand-200"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  )}
                >
                  All Shifts
                </button>
                {shifts.map((shift) => (
                  <button
                    key={shift.id}
                    onClick={() => setSelectedShift(shift.id ?? "")}
                    className={cn(
                      "px-4 py-1.5 text-sm font-semibold rounded-lg transition-all",
                      selectedShift === shift.id
                        ? "bg-brand-50 text-brand-700 shadow-sm ring-1 ring-brand-200"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    )}
                  >
                    {shift.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {kpis.map((k) => {
          const glowMap: Record<string, string> = {
            "text-blue-600": "bg-blue-400",
            "text-emerald-600": "bg-emerald-400",
            "text-rose-600": "bg-rose-400",
            "text-amber-600": "bg-amber-400",
          };
          const glowClass = glowMap[k.color] || "bg-slate-400";
          return (
            <div key={k.label} className="h-full">
              {/* MOBILE KPI CARD */}
              <div className="relative h-full overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-sm flex flex-col justify-between lg:hidden">
                <div className={`absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl opacity-15 ${glowClass}`} />
                <div className="relative z-10 flex items-start justify-between mb-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-tight pr-1">
                    {k.label.replace(" / No Punch", "")}
                  </p>
                  <span className={`shrink-0 rounded-xl p-1.5 ${k.bg} ${k.color} shadow-xs border border-white/50`}>
                    {k.icon}
                  </span>
                </div>
                <div className="relative z-10 mt-1">
                  <p className={`text-2xl font-black font-display tracking-tight ${k.color}`}>{k.value}</p>
                  <p className="text-[9px] font-medium text-slate-400 mt-0.5">{k.sub}</p>
                </div>
              </div>

              {/* DESKTOP KPI CARD */}
              <div className="hidden lg:flex relative overflow-hidden h-full rounded-2xl border border-slate-100 bg-slate-50/50 p-5 lg:min-h-[170px] flex-col justify-between transition-all hover:bg-white hover:shadow-md hover:-translate-y-0.5">
                <div className={`absolute -right-10 -top-10 h-32 w-32 rounded-full blur-3xl opacity-20 ${glowClass}`} />
                <div className="relative z-10 flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-500">{k.label}</p>
                  <span className={`rounded-xl p-2 ${k.bg} ${k.color}`}>{k.icon}</span>
                </div>
                <div className="relative z-10">
                  <p className={`text-3xl font-bold font-display ${k.color}`}>{k.value}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{k.sub}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Lists Section */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending Leave Requests */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 font-display text-sm">Pending Leave Requests</h3>
            <button
              onClick={() => navigate("/hr/leaves")}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
            >
              View all <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          {pendingLeaves.length === 0 ? (
            <div className="py-4">
              <EmptyState icon={CheckCircle} title="All caught up!" description="No pending leave requests." />
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingLeaves.map((l) => (
                <div
                  key={l.id}
                  onClick={() => {
                    if (window.innerWidth < 768) {
                      setSelectedLeave(l);
                      setShowRejectForm(false);
                      setRejectReason("");
                      setActiveTray("leave_approval");
                    } else {
                      navigate("/hr/leaves");
                    }
                  }}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3 cursor-pointer transition-all hover:bg-slate-100 hover:border-slate-200 active:scale-98"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 border border-brand-200">
                      {l.employee?.full_name.slice(0, 2).toUpperCase() ?? "??"}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-800 font-display">
                        {l.employee?.full_name ?? "Unknown"}
                      </p>
                      <p className="text-[10px] capitalize text-slate-400 font-medium mt-0.5">
                        {l.leave_type} · {fmt(l.start_date)} → {fmt(l.end_date)}
                      </p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[9px] font-bold capitalize border ${leaveBadge(l.status)}`}>
                    {l.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Today's Attendance Snapshot */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 font-display text-sm">Today's Attendance</h3>
            <button
              onClick={() => navigate("/hr/attendance")}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
            >
              Full view <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          <div className="space-y-3">
            {[
              { label: "Present", count: presentCount, total: filteredEmployees.length, color: "bg-emerald-500" },
              { label: "Absent", count: absentCount, total: filteredEmployees.length, color: "bg-rose-400" },
              { label: "On Leave", count: onLeaveCount, total: filteredEmployees.length, color: "bg-blue-400" },
            ].map(({ label, count, total, color }) => {
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-xs text-slate-500 font-medium">
                    <span>{label}</span>
                    <span className="font-bold text-slate-800">
                      {count} <span className="font-normal text-slate-400">/ {total}</span>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${color}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Employee avatars present list */}
          {filteredAttendance.filter((a) => ["present", "half_day"].includes(a.status)).length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Punched in today</p>
              <div className="flex flex-wrap gap-1.5">
                {filteredAttendance
                  .filter((a) => ["present", "half_day"].includes(a.status))
                  .slice(0, 10)
                  .map((a) => {
                    const emp = filteredEmployees.find((e) => e.id === a.employee_id);
                    return (
                      <div
                        key={a.id}
                        title={emp?.full_name}
                        className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-700 ring-2 ring-white border border-emerald-200"
                      >
                        {emp?.full_name.slice(0, 2).toUpperCase() ?? "?"}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity Section */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 font-semibold text-slate-800 font-display text-sm">Recent Activity</h3>
        {recentNotifs.length === 0 ? (
          <div className="py-4">
            <EmptyState icon={Bell} title="No activity" description="No recent notifications to display." />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentNotifs.map((n) => (
              <div
                key={n.id}
                onClick={() => {
                  if (window.innerWidth < 768) {
                    setSelectedNotification(n);
                    setActiveTray("activity_detail");
                  }
                }}
                className="flex items-start gap-3 py-3 cursor-pointer md:cursor-default hover:bg-slate-50/50 rounded-xl px-2 -mx-2 transition-colors"
              >
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded-full p-1.5 border shadow-xs",
                    n.is_read
                      ? "bg-slate-50 text-slate-400 border-slate-100"
                      : "bg-brand-50 text-brand-600 border-brand-100"
                  )}
                >
                  {n.type?.includes("approved") ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : n.type?.includes("rejected") ? (
                    <XCircle className="h-3.5 w-3.5 text-rose-600" />
                  ) : (
                    <TrendingUp className="h-3.5 w-3.5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800 font-display">{n.title}</p>
                  <p className="truncate text-xs text-slate-400 font-medium mt-0.5">{n.body}</p>
                </div>
                <span className="ml-auto shrink-0 text-[10px] text-slate-400 font-medium">
                  {new Date(n.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── MOBILE SHEETS / TRAYS ── */}

      {/* 1. Leave Approval Action Sheet */}
      <MobileTray
        isOpen={activeTray === "leave_approval"}
        onClose={() => {
          setActiveTray(null);
          setSelectedLeave(null);
          setShowRejectForm(false);
          setRejectReason("");
        }}
        title="Leave Request Review"
        showBack={showRejectForm}
        onBack={() => setShowRejectForm(false)}
      >
        {selectedLeave && (
          <div className="space-y-4">
            {/* Employee info */}
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700 border border-brand-200">
                {selectedLeave.employee?.full_name.slice(0, 2).toUpperCase() ?? "??"}
              </div>
              <div>
                <span className="text-sm font-bold text-slate-800 block font-display">
                  {selectedLeave.employee?.full_name}
                </span>
                <span className="text-[10px] text-slate-400 font-medium capitalize mt-0.5">
                  {selectedLeave.employee?.department || "Operations"} Department
                </span>
              </div>
            </div>

            {/* Leave Details Box */}
            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 space-y-3.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500 font-medium">Leave Category</span>
                <span className="font-bold text-slate-800 capitalize">{selectedLeave.leave_type} Leave</span>
              </div>
              <div className="flex justify-between text-xs border-t border-slate-200/50 pt-2.5">
                <span className="text-slate-500 font-medium">Dates Requested</span>
                <span className="font-bold text-slate-800">
                  {selectedLeave.start_date} → {selectedLeave.end_date}
                </span>
              </div>
              <div className="flex justify-between text-xs border-t border-slate-200/50 pt-2.5">
                <span className="text-slate-500 font-medium">Reason Details</span>
                <span className="font-medium text-slate-700 max-w-[65%] truncate">{selectedLeave.reason || "N/A"}</span>
              </div>
            </div>

            {/* Action Area */}
            {!showRejectForm ? (
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => setShowRejectForm(true)}
                  className="rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 py-3 text-xs font-bold transition-all active:scale-98"
                >
                  Reject Request
                </button>
                <MorphingButton
                  label="Approve Request"
                  morphState={approveState}
                  onClick={handleApproveLeave}
                  className="rounded-xl bg-brand-700 hover:bg-brand-600 py-3 text-xs font-bold text-white shadow-md w-full"
                />
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3 pt-1"
              >
                <div>
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                    Rejection Reason
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Provide comments or reason for rejecting this leave request..."
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-brand-600"
                  />
                </div>
                <MorphingButton
                  label="Confirm Rejection"
                  morphState={rejectState}
                  onClick={handleRejectLeave}
                  className="w-full rounded-xl bg-rose-600 hover:bg-rose-500 py-3 text-xs font-bold text-white shadow-md"
                />
              </motion.div>
            )}
          </div>
        )}
      </MobileTray>

      {/* 2. Notification/Activity details Tray */}
      <MobileTray
        isOpen={activeTray === "activity_detail"}
        onClose={() => {
          setActiveTray(null);
          setSelectedNotification(null);
        }}
        title="Activity Log"
      >
        {selectedNotification && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-100 px-2 py-0.5 rounded">
                Logged Action
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                {new Date(selectedNotification.created_at).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900 font-display">{selectedNotification.title}</h4>
              <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 border border-slate-100 rounded-xl p-3.5 mt-2">
                {selectedNotification.body}
              </p>
            </div>
            <button
              onClick={() => setActiveTray(null)}
              className="w-full rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 py-2.5 text-xs font-bold transition-all mt-2"
            >
              Close
            </button>
          </div>
        )}
      </MobileTray>
    </section>
  );
}
