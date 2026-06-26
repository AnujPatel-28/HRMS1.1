import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Clock,
  Calendar,
  ClipboardList,
  TrendingUp,
  X,
  ChevronLeft,
  Check,
  Plus,
  Loader2,
  CheckCircle2,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Attendance, Leave, Task } from "../types";
import { db } from "../insforge/client";
import { useEmployee } from "../hooks/useEmployee";
import { useTenant } from "../contexts/TenantContext";
import { Skeleton } from "../shared/Skeleton";
import { useToast } from "../shared/ToastContext";
import { formatLocalDate, formatLocalMonthBoundary } from "../utils/date";
import { cn } from "../utils/cn";

// Business calendar dates — must use local timezone.
const TODAY = formatLocalDate(new Date());
const now = new Date();
const MONTH_START = formatLocalMonthBoundary(now.getFullYear(), now.getMonth(), "start");

interface LeaveType {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
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

// ── Confetti Burst Animation Component ──
function ConfettiBurst({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; color: string; scale: number; rotate: number }[]>([]);

  useEffect(() => {
    if (active) {
      const colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8", "#FFD166", "#06D6A0"];
      const newParticles = Array.from({ length: 80 }).map((_, idx) => ({
        id: idx,
        x: (Math.random() - 0.5) * 280, // horizontal spread
        y: -(Math.random() * 180 + 120), // shoot upwards
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
            y: p.y + 350, // fall down
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
                )
                }
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
    if (morphState === "success") return "Applied! 🎉";
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

// Helper to calculate business days
function calculateBusinessDays(startDateStr: string, endDateStr: string, holidays: string[]): number {
  if (!startDateStr || !endDateStr) return 0;
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay(); // 0 = Sun, 6 = Sat
    const dateString = formatLocalDate(current);
    const isWeekend = day === 0 || day === 6; // Default Saturday/Sunday off
    const isHoliday = holidays.includes(dateString);
    if (!isWeekend && !isHoliday) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export default function EmployeeDashboard() {
  const { employee } = useEmployee();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const { success: toastSuccess, error: toastError } = useToast();

  const [todayAtt, setTodayAtt] = useState<Attendance | null>(null);
  const [monthAtt, setMonthAtt] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  // Delight & Confetti triggers
  const [confettiActive, setConfettiActive] = useState(false);

  // Mobile Tray States
  const [activeTray, setActiveTray] = useState<"punch" | "task_details" | "leave_details" | "leave_apply" | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedLeave, setSelectedLeave] = useState<Leave | null>(null);

  // Task Completion Submission Form
  const [taskNotes, setTaskNotes] = useState("");
  const [taskSubmitting, setTaskSubmitting] = useState<"idle" | "busy" | "success">("idle");

  // Leave Apply Multi-Step Flow
  const [leaveStep, setLeaveStep] = useState<1 | 2 | 3>(1);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [globalMinNoticeDays, setGlobalMinNoticeDays] = useState(0);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    leave_type_id: "",
    start_date: "",
    end_date: "",
    reason: "",
  });
  const [leaveSubmittingState, setLeaveSubmittingState] = useState<"idle" | "busy" | "success">("idle");

  const fetchData = async () => {
    if (!employee?.id || !tenantId) return;
    const [attTodayRes, attMonthRes, leavesRes, tasksRes] = await Promise.all([
      db.from("attendance").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).eq("date", TODAY).maybeSingle(),
      db.from("attendance").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).gte("date", MONTH_START).lte("date", TODAY),
      db.from("leaves").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).order("applied_at", { ascending: false }).limit(5),
      db.from("tasks").select("*").eq("tenant_id", tenantId).eq("assigned_to", employee.id).order("created_at", { ascending: false }).limit(5),
    ]);
    setTodayAtt(attTodayRes.data as Attendance | null);
    setMonthAtt((attMonthRes.data ?? []) as Attendance[]);
    setLeaves((leavesRes.data ?? []) as Leave[]);
    setTasks((tasksRes.data ?? []) as Task[]);
  };

  useEffect(() => {
    if (!employee?.id || !tenantId) return;
    const init = async () => {
      setLoading(true);
      await fetchData();
      setLoading(false);
    };
    void init();
  }, [employee?.id, tenantId]);

  const daysPresent = monthAtt.filter((a) => a.status === "present" || a.status === "half_day").length;
  const daysLeave = monthAtt.filter((a) => a.status === "on_leave").length;
  const daysAbsent = new Date().getDate() - 1 - daysPresent - daysLeave;
  const pendingTasks = tasks.filter((t) => t.status === "assigned" || t.status === "in_progress" || t.status === "rejected").length;
  const pendingLeaves = leaves.filter((l) => l.status === "pending").length;

  const todayStatus = () => {
    if (!todayAtt) return { label: "Not Punched In", color: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" };
    if (todayAtt.status === "on_leave") return { label: "On Leave", color: "bg-purple-50 text-purple-700 border-purple-200", dot: "bg-purple-500" };
    if (todayAtt.status === "absent") return { label: "Marked Absent", color: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" };
    if (todayAtt.punch_out) return { label: "Punched Out", color: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" };
    return { label: "Clocked In", color: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" };
  };
  const status = todayStatus();

  // Load Leave metadata (balances, types, holidays) when starting application
  const loadLeaveData = async () => {
    if (!employee?.id || !tenantId) return;
    setLeaveLoading(true);
    try {
      const currentYear = new Date().getFullYear();
      const [typesRes, balancesRes, holidaysRes, settingsRes] = await Promise.all([
        db.from("leave_types").select("*").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
        db.from("leave_balances").select("*").eq("tenant_id", tenantId).eq("employee_id", employee.id).eq("year", currentYear),
        db.from("holidays").select("date").eq("tenant_id", tenantId).gte("date", `${currentYear}-01-01`),
        db.from("tenant_settings").select("key, value").eq("tenant_id", tenantId).in("key", ["leave_min_notice_days"]),
      ]);

      if (typesRes.error) throw typesRes.error;
      if (balancesRes.error) throw balancesRes.error;
      if (holidaysRes.error) throw holidaysRes.error;
      if (settingsRes.error) throw settingsRes.error;

      const types = (typesRes.data ?? []) as LeaveType[];
      setLeaveTypes(types);
      setLeaveBalances((balancesRes.data ?? []) as LeaveBalance[]);
      setHolidays((holidaysRes.data ?? []).map((h: any) => h.date));

      const settingsMap = ((settingsRes.data ?? []) as { key: string; value: string }[]).reduce<Record<string, string>>((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {});
      setGlobalMinNoticeDays(parseInt(settingsMap["leave_min_notice_days"] || "0", 10));

      if (types.length > 0) {
        setLeaveForm((prev) => ({ ...prev, leave_type_id: types[0].id }));
      }
    } catch (err) {
      console.error(err);
      toastError("Failed to fetch leave settings.");
    } finally {
      setLeaveLoading(false);
    }
  };

  // Submit Task Completion
  const handleSubmitTask = async () => {
    if (!employee?.id || !tenantId || !selectedTask) return;
    setTaskSubmitting("busy");
    try {
      const { error: rpcErr } = await db.rpc("submit_task_request", {
        p_task_id: selectedTask.id,
        p_employee_id: employee.id,
        p_notes: taskNotes || null,
        p_attachment_url: null,
        p_attachment_name: null,
      });
      if (rpcErr) throw rpcErr;

      // Notify manager
      if (employee.manager_id) {
        await db.from("notifications").insert([
          {
            employee_id: employee.manager_id,
            tenant_id: tenantId,
            title: "Task Submitted",
            body: `${employee.full_name} completed task: "${selectedTask.title}"`,
            type: "general",
            reference_id: selectedTask.id,
          },
        ]);
      }

      setTaskSubmitting("success");
      setConfettiActive(true);
      setTimeout(() => {
        setActiveTray(null);
        setSelectedTask(null);
        setTaskNotes("");
        setTaskSubmitting("idle");
        void fetchData();
      }, 1000);
    } catch (err) {
      console.error(err);
      toastError("Failed to submit task.");
      setTaskSubmitting("idle");
    }
  };

  // Cancel Leave Request
  const handleCancelLeave = async (leaveId: string) => {
    try {
      const { error: delErr } = await db.rpc("employee_cancel_pending_leave", {
        p_tenant_id: tenantId,
        p_leave_id: leaveId,
      });
      if (delErr) throw delErr;
      toastSuccess("Leave request cancelled.");
      setActiveTray(null);
      setSelectedLeave(null);
      void fetchData();
    } catch (err) {
      console.error(err);
      toastError("Failed to cancel leave request.");
    }
  };

  // Step 2 Validation of Leave Application
  const validateLeaveForm = (): boolean => {
    const selectedType = leaveTypes.find((t) => t.id === leaveForm.leave_type_id);
    if (!selectedType) return false;

    // Minimum notice period
    const perTypeNoticeDays = selectedType.min_notice_days ?? 0;
    const effectiveNoticeDays = Math.max(globalMinNoticeDays, perTypeNoticeDays);
    if (effectiveNoticeDays > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startDate = new Date(leaveForm.start_date);
      startDate.setHours(0, 0, 0, 0);
      const noticeDaysGiven = Math.floor((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (noticeDaysGiven < effectiveNoticeDays) {
        toastError(
          `Requires at least ${effectiveNoticeDays} days notice. ` +
            `Your start date is ${noticeDaysGiven < 0 ? "in the past" : `only ${noticeDaysGiven} days away`}.`
        );
        return false;
      }
    }

    // Maximum consecutive days
    const totalDays = calculateBusinessDays(leaveForm.start_date, leaveForm.end_date, holidays);
    if (selectedType.max_consecutive_days != null && totalDays > selectedType.max_consecutive_days) {
      toastError(
        `${selectedType.name} allows a maximum of ${selectedType.max_consecutive_days} consecutive days per request.`
      );
      return false;
    }

    // Probation eligibility
    if (selectedType.applicable_from_day != null && selectedType.applicable_from_day > 0 && employee?.date_of_joining) {
      const joining = new Date(employee.date_of_joining);
      joining.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysSinceJoining = Math.floor((today.getTime() - joining.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceJoining < selectedType.applicable_from_day) {
        toastError(`${selectedType.name} is only available after ${selectedType.applicable_from_day} days of employment.`);
        return false;
      }
    }

    // Balance check
    const balanceObj = leaveBalances.find((b) => b.leave_type_id === leaveForm.leave_type_id);
    const balance = balanceObj?.balance ?? 0;
    if (totalDays > balance) {
      toastError(`Insufficient balance. You only have ${balance} days available.`);
      return false;
    }

    if (totalDays === 0) {
      toastError("The selected date range contains no working days.");
      return false;
    }

    return true;
  };

  // Submit Leave Request
  const handleApplyLeave = async () => {
    if (!employee?.id || !tenantId || !leaveForm.start_date || !leaveForm.end_date || !leaveForm.reason || !leaveForm.leave_type_id) return;
    
    // Check overlaps
    const { data: overlapping, error: overlapErr } = await db
      .from("leaves")
      .select("id, start_date, end_date, status")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee.id)
      .in("status", ["pending", "approved"])
      .lte("start_date", leaveForm.end_date)
      .gte("end_date", leaveForm.start_date);

    if (overlapErr) {
      toastError("Could not verify leave overlap.");
      return;
    }
    if (overlapping && overlapping.length > 0) {
      toastError("You already have a pending or approved leave request overlapping these dates.");
      return;
    }

    setLeaveSubmittingState("busy");
    try {
      const { error: insErr } = await db.rpc("employee_apply_leave_request", {
        p_tenant_id: tenantId,
        p_leave_type_id: leaveForm.leave_type_id,
        p_start_date: leaveForm.start_date,
        p_end_date: leaveForm.end_date,
        p_reason: leaveForm.reason,
      });
      if (insErr) throw insErr;

      setLeaveSubmittingState("success");
      setConfettiActive(true);
      setTimeout(() => {
        setActiveTray(null);
        setLeaveForm({ leave_type_id: "", start_date: "", end_date: "", reason: "" });
        setLeaveStep(1);
        setLeaveSubmittingState("idle");
        void fetchData();
      }, 1200);
    } catch (err) {
      console.error(err);
      toastError("Failed to apply leave.");
      setLeaveSubmittingState("idle");
    }
  };

  const selectedLeaveType = leaveTypes.find((t) => t.id === leaveForm.leave_type_id);

  const computedDays = useMemo(() => {
    return calculateBusinessDays(leaveForm.start_date, leaveForm.end_date, holidays);
  }, [leaveForm.start_date, leaveForm.end_date, holidays]);

  if (loading) {
    return (
      <section className="space-y-6 pt-4 md:pt-0">
        <Skeleton className="h-16 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6 relative pt-4 md:pt-0">
      <ConfettiBurst active={confettiActive} />

      {/* Greeting & Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            Welcome back, {employee?.full_name?.split(" ")[0]} 👋
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Here's your day at a glance.</p>
        </div>

        {/* Mobile Quick Actions */}
        <button
          onClick={() => {
            setActiveTray("leave_apply");
            setLeaveStep(1);
            void loadLeaveData();
          }}
          className="md:hidden flex items-center gap-1.5 rounded-full bg-brand-700 px-4 py-2 text-xs font-semibold text-white shadow-md hover:bg-brand-600 active:scale-95 transition-all duration-150"
        >
          <Plus className="h-3.5 w-3.5" />
          Request Leave
        </button>
      </div>

      {/* ── Dashboard Stats/Summary Cards Grid ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Punch/Today Card */}
        <div
          onClick={() => {
            if (window.innerWidth < 768) {
              setActiveTray("punch");
            } else {
              navigate("/employee/punch");
            }
          }}
          className={cn(
            "flex flex-col gap-2 rounded-2xl border p-4 shadow-sm hover:shadow-md cursor-pointer active:scale-98 transition-all duration-200",
            status.color
          )}
        >
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full animate-pulse", status.dot)} />
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">Today</span>
          </div>
          <p className="text-base font-bold leading-tight font-display mt-1">{status.label}</p>
          {todayAtt?.punch_in && (
            <p className="text-[10px] opacity-75">
              Since {new Date(todayAtt.punch_in).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>

        {/* Attendance Statistics Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-slate-500 mb-2">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-wider">This Month</span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center mt-1">
            <div>
              <p className="text-base font-bold text-emerald-600 font-display">{daysPresent}</p>
              <p className="text-[9px] font-medium text-slate-400">Present</p>
            </div>
            <div>
              <p className="text-base font-bold text-blue-600 font-display">{daysLeave}</p>
              <p className="text-[9px] font-medium text-slate-400">Leave</p>
            </div>
            <div>
              <p className="text-base font-bold text-rose-600 font-display">{Math.max(0, daysAbsent)}</p>
              <p className="text-[9px] font-medium text-slate-400">Absent</p>
            </div>
          </div>
        </div>

        {/* Tasks Card */}
        <div
          onClick={() => navigate("/employee/tasks")}
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm hover:shadow-md cursor-pointer active:scale-98 transition-all duration-200"
        >
          <div className="flex items-center gap-1.5 text-amber-600 mb-2">
            <ClipboardList className="h-3.5 w-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Pending Tasks</span>
          </div>
          <p className="text-2xl font-bold text-amber-700 font-display mt-0.5">{pendingTasks}</p>
        </div>

        {/* Leaves Card */}
        <div
          onClick={() => navigate("/employee/leaves")}
          className="rounded-2xl border border-purple-200 bg-purple-50 p-4 shadow-sm hover:shadow-md cursor-pointer active:scale-98 transition-all duration-200"
        >
          <div className="flex items-center gap-1.5 text-purple-600 mb-2">
            <Calendar className="h-3.5 w-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Leaves Pending</span>
          </div>
          <p className="text-2xl font-bold text-purple-700 font-display mt-0.5">{pendingLeaves}</p>
        </div>
      </div>

      {/* ── Recent Activity / Lists Grid ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        
        {/* Recent Attendance Column */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-slate-400" />
            <h3 className="font-semibold text-slate-800 font-display text-sm">Recent Attendance</h3>
          </div>
          <div className="space-y-2">
            {monthAtt.slice(-5).reverse().map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-xl px-3.5 py-2.5 bg-slate-50 border border-slate-100 text-xs transition-colors hover:bg-slate-100"
              >
                <span className="font-medium text-slate-600">
                  {new Date(a.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[9px] font-bold capitalize shadow-xs border",
                    a.status === "present"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                      : a.status === "on_leave"
                      ? "bg-blue-50 text-blue-700 border-blue-100"
                      : "bg-rose-50 text-rose-700 border-rose-100"
                  )}
                >
                  {a.status.replace("_", " ")}
                </span>
              </div>
            ))}
            {monthAtt.length === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-slate-400">
                <Info className="h-5 w-5 mb-1.5 stroke-1" />
                <p className="text-xs">No records this month</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Tasks Column */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList className="h-4 w-4 text-slate-400" />
            <h3 className="font-semibold text-slate-800 font-display text-sm">Recent Tasks</h3>
          </div>
          <div className="space-y-2.5">
            {tasks.slice(0, 3).map((t) => (
              <div
                key={t.id}
                onClick={() => {
                  if (window.innerWidth < 768) {
                    setSelectedTask(t);
                    setTaskNotes("");
                    setActiveTray("task_details");
                  } else {
                    navigate(`/employee/tasks`);
                  }
                }}
                className="rounded-xl p-3.5 bg-slate-50 border border-slate-100 cursor-pointer transition-all hover:bg-slate-100 hover:border-slate-200 active:scale-98"
              >
                <p className="text-xs font-semibold text-slate-800 truncate font-display">{t.title}</p>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-bold capitalize border",
                      t.status === "approved"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                        : t.status === "submitted"
                        ? "bg-purple-50 text-purple-700 border-purple-100"
                        : t.status === "rejected"
                        ? "bg-rose-50 text-rose-700 border-rose-100"
                        : "bg-amber-50 text-amber-700 border-amber-100"
                    )}
                  >
                    {t.status.replace("_", " ")}
                  </span>
                  {t.due_date && <span className="text-[9px] text-slate-400 font-medium">Due {t.due_date}</span>}
                </div>
              </div>
            ))}
            {tasks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-slate-400">
                <Info className="h-5 w-5 mb-1.5 stroke-1" />
                <p className="text-xs">No tasks assigned</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Leaves Column */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="h-4 w-4 text-slate-400" />
            <h3 className="font-semibold text-slate-800 font-display text-sm">Recent Leaves</h3>
          </div>
          <div className="space-y-2.5">
            {leaves.slice(0, 3).map((l) => (
              <div
                key={l.id}
                onClick={() => {
                  if (window.innerWidth < 768) {
                    setSelectedLeave(l);
                    setActiveTray("leave_details");
                  } else {
                    navigate(`/employee/leaves`);
                  }
                }}
                className="rounded-xl p-3.5 bg-slate-50 border border-slate-100 cursor-pointer transition-all hover:bg-slate-100 hover:border-slate-200 active:scale-98"
              >
                <p className="text-xs font-semibold text-slate-800 capitalize font-display">
                  {l.leave_type} Leave
                </p>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[9px] font-bold capitalize border",
                      l.status === "approved"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                        : l.status === "rejected"
                        ? "bg-rose-50 text-rose-700 border-rose-100"
                        : "bg-amber-50 text-amber-700 border-amber-100"
                    )}
                  >
                    {l.status}
                  </span>
                  <span className="text-[9px] text-slate-400 font-medium">
                    {l.start_date} → {l.end_date}
                  </span>
                </div>
              </div>
            ))}
            {leaves.length === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-slate-400">
                <Info className="h-5 w-5 mb-1.5 stroke-1" />
                <p className="text-xs">No leave requests</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── MOBILE TRAYS / BOTTOM SHEETS ── */}

      {/* 1. Today's Status & Punch Control Tray */}
      <MobileTray
        isOpen={activeTray === "punch"}
        onClose={() => setActiveTray(null)}
        title="Attendance & Punch"
      >
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold">Shift Schedule</span>
              <span className="font-medium bg-slate-200 px-2 py-0.5 rounded-md">General Shift</span>
            </div>
            <div className="flex items-center justify-between font-display text-sm font-bold text-slate-800 mt-1">
              <span>09:30 AM → 06:30 PM</span>
              <span className="text-slate-400 font-medium text-xs">(9 Hours)</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-100 p-3 bg-white text-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Punch In</span>
              <span className="text-sm font-bold text-slate-800 block mt-1">
                {todayAtt?.punch_in
                  ? new Date(todayAtt.punch_in).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                  : "--:--"
                }
              </span>
            </div>
            <div className="rounded-xl border border-slate-100 p-3 bg-white text-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Punch Out</span>
              <span className="text-sm font-bold text-slate-800 block mt-1">
                {todayAtt?.punch_out
                  ? new Date(todayAtt.punch_out).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                  : "--:--"
                }
              </span>
            </div>
          </div>

          <div className="pt-3">
            <button
              onClick={() => {
                setActiveTray(null);
                navigate("/employee/punch");
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-700 hover:bg-brand-600 py-3 text-sm font-bold text-white shadow-md active:scale-98 transition-all"
            >
              <Clock className="h-4 w-4" />
              Open Clocking Terminal
            </button>
            <p className="text-[10px] text-slate-400 text-center mt-2.5 leading-normal">
              Clocking requires geolocation verification & optional selfie capture. Opening terminal.
            </p>
          </div>
        </div>
      </MobileTray>

      {/* 2. Task Details Tray */}
      <MobileTray
        isOpen={activeTray === "task_details"}
        onClose={() => {
          setActiveTray(null);
          setSelectedTask(null);
        }}
        title="Task details"
      >
        {selectedTask && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-100 px-2 py-0.5 rounded-md">
                  Priority: {selectedTask.priority}
                </span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-100 px-2 py-0.5 rounded-md">
                  Status: {selectedTask.status.replace("_", " ")}
                </span>
              </div>
              <h4 className="text-base font-bold text-slate-900 mt-2 font-display">{selectedTask.title}</h4>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed bg-slate-50 border border-slate-100 rounded-xl p-3">
                {selectedTask.description || "No description provided."}
              </p>
            </div>

            {selectedTask.due_date && (
              <div className="flex items-center justify-between text-xs border-y border-slate-100 py-2.5">
                <span className="text-slate-500 font-semibold">Deadline</span>
                <span className="font-bold text-slate-800">
                  {selectedTask.due_date} {selectedTask.due_time ? `@ ${selectedTask.due_time}` : ""}
                </span>
              </div>
            )}

            {/* Submit completion form if active */}
            {(selectedTask.status === "assigned" ||
              selectedTask.status === "in_progress" ||
              selectedTask.status === "rejected") ? (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Completion Notes</label>
                  <textarea
                    rows={3}
                    placeholder="Provide any comments or links related to your submission..."
                    value={taskNotes}
                    onChange={(e) => setTaskNotes(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:border-brand-600 focus:outline-none transition-colors"
                  />
                </div>
                <MorphingButton
                  label="Submit Task Completion"
                  morphState={taskSubmitting}
                  onClick={handleSubmitTask}
                  className="w-full rounded-xl bg-brand-700 hover:bg-brand-600 py-3 text-sm font-bold text-white shadow-md"
                />
              </div>
            ) : (
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 flex items-start gap-2.5 text-xs text-emerald-800">
                <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Task Completed</p>
                  <p className="text-[10px] text-emerald-700/95 mt-0.5">This task has been submitted and/or approved.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </MobileTray>

      {/* 3. Leave Details Tray */}
      <MobileTray
        isOpen={activeTray === "leave_details"}
        onClose={() => {
          setActiveTray(null);
          setSelectedLeave(null);
        }}
        title="Leave Request Details"
      >
        {selectedLeave && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 capitalize">{selectedLeave.leave_type} Leave</span>
              <span
                className={cn(
                  "rounded-full px-3 py-0.5 text-[10px] font-bold capitalize border",
                  selectedLeave.status === "approved"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                    : selectedLeave.status === "rejected"
                    ? "bg-rose-50 text-rose-700 border-rose-100"
                    : "bg-amber-50 text-amber-700 border-amber-100"
                )}
              >
                {selectedLeave.status}
              </span>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Duration</span>
                <span className="font-bold text-slate-800">
                  {selectedLeave.start_date} → {selectedLeave.end_date}
                </span>
              </div>
              <div className="flex justify-between text-xs border-t border-slate-200/50 pt-2">
                <span className="text-slate-500">Reason</span>
                <span className="font-medium text-slate-700 text-right max-w-[65%] truncate">
                  {selectedLeave.reason || "N/A"}
                </span>
              </div>
            </div>

            {selectedLeave.rejection_reason && (
              <div className="rounded-xl bg-rose-50 border border-rose-100 p-3.5">
                <span className="text-[10px] font-bold text-rose-800 uppercase tracking-wider block">Manager Notes</span>
                <p className="text-xs text-rose-700 mt-1">{selectedLeave.rejection_reason}</p>
              </div>
            )}

            {selectedLeave.status === "pending" && (
              <button
                onClick={() => handleCancelLeave(selectedLeave.id)}
                className="w-full rounded-xl bg-rose-50 border border-rose-100 hover:bg-rose-100 text-rose-700 py-3 text-sm font-bold transition-all active:scale-98"
              >
                Cancel Leave Request
              </button>
            )}
          </div>
        )}
      </MobileTray>

      {/* 4. Leave Application Progressive Tray */}
      <MobileTray
        isOpen={activeTray === "leave_apply"}
        onClose={() => {
          setActiveTray(null);
          setLeaveForm({ leave_type_id: "", start_date: "", end_date: "", reason: "" });
          setLeaveStep(1);
        }}
        title={`Request Leave — Step ${leaveStep} of 3`}
        showBack={leaveStep > 1}
        onBack={() => setLeaveStep((prev) => (prev - 1) as 1 | 2 | 3)}
      >
        {leaveLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-brand-700" />
            <span className="text-xs">Loading leave balances...</span>
          </div>
        ) : (
          <div className="relative">
            {/* Step 1: Choose Type */}
            {leaveStep === 1 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-4"
              >
                <div className="text-xs text-slate-500">Choose the type of leave you wish to request:</div>
                <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                  {leaveTypes.map((type) => {
                    const balance = leaveBalances.find((b) => b.leave_type_id === type.id)?.balance ?? 0;
                    const isSelected = leaveForm.leave_type_id === type.id;
                    return (
                      <div
                        key={type.id}
                        onClick={() => {
                          setLeaveForm((prev) => ({ ...prev, leave_type_id: type.id }));
                          setLeaveStep(2);
                        }}
                        className={cn(
                          "flex items-center justify-between rounded-xl p-3.5 border cursor-pointer transition-all active:scale-98",
                          isSelected
                            ? "bg-brand-50 border-brand-600 shadow-xs"
                            : "bg-slate-50 border-slate-100 hover:bg-slate-100"
                        )}
                      >
                        <div>
                          <span className="text-xs font-bold text-slate-800 block capitalize">{type.name}</span>
                          {type.min_notice_days > 0 && (
                            <span className="text-[9px] text-slate-400 font-medium">
                              Requires {type.min_notice_days} days notice
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-bold text-brand-700 bg-brand-100/60 px-2.5 py-0.5 rounded-full">
                          {balance} Days Left
                        </span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* Step 2: Input Details */}
            {leaveStep === 2 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-4"
              >
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 flex justify-between items-center">
                  <span className="text-xs text-slate-500">Leave Type Selected:</span>
                  <span className="text-xs font-bold text-slate-800 capitalize">{selectedLeaveType?.name}</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={leaveForm.start_date}
                      onChange={(e) => setLeaveForm((prev) => ({ ...prev, start_date: e.target.value }))}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 focus:bg-white focus:outline-none focus:border-brand-600"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={leaveForm.end_date}
                      onChange={(e) => setLeaveForm((prev) => ({ ...prev, end_date: e.target.value }))}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 focus:bg-white focus:outline-none focus:border-brand-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                    Reason
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Provide details about your request..."
                    value={leaveForm.reason}
                    onChange={(e) => setLeaveForm((prev) => ({ ...prev, reason: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-brand-600"
                  />
                </div>

                <button
                  onClick={() => {
                    if (!leaveForm.start_date || !leaveForm.end_date || !leaveForm.reason) {
                      toastError("Please fill out all fields.");
                      return;
                    }
                    if (validateLeaveForm()) {
                      setLeaveStep(3);
                    }
                  }}
                  className="w-full rounded-xl bg-brand-700 hover:bg-brand-600 py-3 text-sm font-bold text-white shadow-md active:scale-98 transition-all"
                >
                  Continue
                </button>
              </motion.div>
            )}

            {/* Step 3: Review & Morph Confirm */}
            {leaveStep === 3 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-4"
              >
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Leave Type</span>
                    <span className="font-bold text-slate-800 capitalize">{selectedLeaveType?.name}</span>
                  </div>
                  <div className="flex justify-between text-xs border-t border-slate-200/50 pt-2">
                    <span className="text-slate-500">Dates</span>
                    <span className="font-bold text-slate-800">
                      {leaveForm.start_date} to {leaveForm.end_date}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs border-t border-slate-200/50 pt-2">
                    <span className="text-slate-500">Total Requested</span>
                    <span className="font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded">
                      {computedDays} Working Day{computedDays !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs border-t border-slate-200/50 pt-2">
                    <span className="text-slate-500">Reason</span>
                    <span className="font-medium text-slate-700 max-w-[65%] truncate">{leaveForm.reason}</span>
                  </div>
                </div>

                <MorphingButton
                  label="Submit Request"
                  morphState={leaveSubmittingState}
                  onClick={handleApplyLeave}
                  className="w-full rounded-xl bg-brand-700 hover:bg-brand-600 py-3 text-sm font-bold text-white shadow-md mt-2"
                />
              </motion.div>
            )}
          </div>
        )}
      </MobileTray>
    </section>
  );
}
