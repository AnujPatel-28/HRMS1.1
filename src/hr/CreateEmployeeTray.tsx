import { useState, useMemo, useEffect, useRef } from "react";
import { ChevronDown, ChevronLeft, X, Eye, EyeOff, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Employee } from "../types";
import { useTenant } from "../contexts/TenantContext";
import { insforge, db } from "../insforge/client";
import { useAuditLog } from "../hooks/useAuditLog";
import { getTenantYear } from "../utils/date";
import { useToast } from "../shared/ToastContext";

// ── Text Morphing Button Helper ──
interface MorphingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  isLoading?: boolean;
}

function MorphingButton({ label, isLoading, className, disabled, ...props }: MorphingButtonProps) {
  const [displayLabel, setDisplayLabel] = useState(label);
  const [morphState, setMorphState] = useState<"idle" | "out" | "in">("idle");

  useEffect(() => {
    if (label !== displayLabel) {
      setMorphState("out");
      const timer1 = setTimeout(() => {
        setDisplayLabel(label);
        setMorphState("in");
        const timer2 = setTimeout(() => setMorphState("idle"), 200);
        return () => clearTimeout(timer2);
      }, 120);
      return () => clearTimeout(timer1);
    }
  }, [label, displayLabel]);

  return (
    <button
      {...props}
      disabled={disabled || isLoading}
      className={`${className} relative overflow-hidden transition-all duration-150 active:scale-95`}
    >
      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.span
            key="loader"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center justify-center gap-2"
          >
            <svg className="h-4 w-4 animate-spin text-current" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Processing...
          </motion.span>
        ) : (
          <span
            className={`inline-block transition-all duration-150 ${
              morphState === "out" ? "opacity-0 -translate-y-1.5" :
              morphState === "in" ? "opacity-0 translate-y-1.5" :
              "opacity-100 translate-y-0"
            }`}
          >
            {displayLabel}
          </span>
        )}
      </AnimatePresence>
    </button>
  );
}

// ── Multi-Step FormState Interface ──
interface FormState {
  full_name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  employee_code: string;
  date_of_joining: string;
  employment_type: string;
  work_mode: "office" | "remote" | "hybrid";
  grade: string;
  work_location: string;
  manager_id: string;
}

const initialState: FormState = {
  full_name: "",
  email: "",
  phone: "",
  department: "sales",
  designation: "",
  employee_code: "",
  date_of_joining: "",
  employment_type: "full_time",
  work_mode: "office",
  grade: "",
  work_location: "",
  manager_id: "",
};

const stepHeights = [
  390, // Step 1: Personal Details
  280, // Step 2: OTP Verification
  280, // Step 3: Set Password
  510, // Step 4: Employment Details
  390, // Step 5: Review & Submit
];

export default function CreateEmployeeTray({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { tenantId } = useTenant();
  const { logAction } = useAuditLog();
  const toast = useToast();

  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = backward
  const [form, setForm] = useState<FormState>(initialState);

  // Auth/OTP/Password states
  type AuthStep = "idle" | "verifying" | "setting-password" | "done";
  const [authStep, setAuthStep] = useState<AuthStep>("idle");
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);
  const [insertedEmployeeId, setInsertedEmployeeId] = useState<string | null>(null);

  const [authLoading, setAuthLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [otpValue, setOtpValue] = useState("");
  const [pwValue, setPwValue] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Managers fetching
  const [activeEmployees, setActiveEmployees] = useState<Employee[]>([]);
  const [managerSearch, setManagerSearch] = useState("");
  const [isManagerDropdownOpen, setIsManagerDropdownOpen] = useState(false);
  const managerDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tenantId && isOpen) {
      db.from("employees")
        .select("id, full_name, designation, profile_photo_url")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("full_name")
        .then(({ data }) => {
          if (data) setActiveEmployees(data as Employee[]);
        });
    }
  }, [tenantId, isOpen]);

  // Click outside to close reporting manager dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (managerDropdownRef.current && !managerDropdownRef.current.contains(event.target as Node)) {
        setIsManagerDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedManager = useMemo(() => {
    return activeEmployees.find((emp) => emp.id === form.manager_id);
  }, [activeEmployees, form.manager_id]);

  useEffect(() => {
    if (selectedManager && !isManagerDropdownOpen) {
      setManagerSearch(selectedManager.full_name);
    } else if (!form.manager_id && !isManagerDropdownOpen) {
      setManagerSearch("");
    }
  }, [selectedManager, form.manager_id, isManagerDropdownOpen]);

  const filteredManagers = useMemo(() => {
    const q = managerSearch.toLowerCase().trim();
    if (!q) return activeEmployees;
    return activeEmployees.filter(emp => emp.full_name.toLowerCase().includes(q));
  }, [activeEmployees, managerSearch]);

  const handleChange = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // Helper to generate temporary password
  const makePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  };

  // ── STEP 1: Verify Email (Send OTP) ──
  const handleSendOTP = async () => {
    const normalizedEmail = form.email.trim().toLowerCase();
    if (!normalizedEmail || !form.full_name.trim() || !form.phone.trim()) {
      setErrorMsg("Please enter Full Name, Email, and Phone first.");
      return;
    }
    setAuthLoading(true);
    setErrorMsg(null);
    try {
      // 1. Check if there is an existing, resumable onboarding flow
      const { data: resumable, error: resErr } = await db.rpc("check_onboarding_resumable", {
        p_email: normalizedEmail,
        p_tenant_id: tenantId
      });

      if (resErr) throw new Error(resErr.message);

      if (resumable && resumable.length > 0) {
        const flow = resumable[0];
        const confirmResume = window.confirm(
          `An incomplete onboarding flow already exists for this email. Would you like to resume it?`
        );
        if (confirmResume) {
          void logAction("employee.onboarding_resumed", "employee_onboarding", flow.employee_id || flow.auth_user_id, {
            employee_id: flow.employee_id || null,
            previous_status: flow.status,
            tenant_id: tenantId
          });

          setCreatedUserId(flow.auth_user_id);
          setPendingEmail(normalizedEmail);

          if (flow.status === "pending_auth" || flow.status === "expired") {
            setAuthStep("verifying");
            setDirection(1);
            setStep(2);
          } else if (flow.status === "otp_verified") {
            setAuthStep("setting-password");
            setDirection(1);
            setStep(3);
          } else if (flow.status === "password_set") {
            setAuthStep("done");
            setDirection(1);
            setStep(4);
          }

          if (flow.employee_id) {
            setInsertedEmployeeId(flow.employee_id);
            const { data: empData } = await db.from("employees").select("*").eq("id", flow.employee_id).single();
            if (empData) {
              if (empData.tenant_id !== tenantId) throw new Error("Security check failed: Tenant mismatch.");
              setForm({
                full_name: empData.full_name || "",
                email: empData.email || "",
                phone: empData.phone || "",
                department: empData.department || "sales",
                designation: empData.designation || "",
                employee_code: empData.employee_code || "",
                date_of_joining: empData.date_of_joining || "",
                employment_type: empData.employment_type || "full_time",
                work_mode: empData.work_mode || "office",
                grade: empData.grade || "",
                work_location: empData.work_location || "",
                manager_id: empData.manager_id || "",
              });
            }
          }
          setAuthLoading(false);
          return;
        } else {
          throw new Error("Please use a different email address or resume the existing flow.");
        }
      }

      // Check unique email
      const emailCheck = await db.from("employees").select("id").eq("tenant_id", tenantId).eq("email", normalizedEmail).limit(1);
      if (emailCheck.data && emailCheck.data.length > 0) {
        throw new Error(`An employee with email "${normalizedEmail}" already exists.`);
      }

      const tempPassword = makePassword();
      const fnRes = await insforge.functions.invoke("create-employee-user", {
        body: {
          email: normalizedEmail,
          password: tempPassword,
          name: form.full_name.trim(),
          tenant_id: tenantId,
        },
      });

      if (fnRes.error || !fnRes.data?.userId) {
        let parsedData = fnRes.data;
        if (fnRes.error && !parsedData) {
          try {
            const errObj = fnRes.error as any;
            if (errObj.context && typeof errObj.context.json === 'function') {
              parsedData = await errObj.context.json();
            }
          } catch(e) {}
        }
        const serverMsg: string = parsedData?.error ?? parsedData?.message ?? (fnRes.error as any)?.message ?? "Failed to create auth account";
        throw new Error(serverMsg);
      }

      setCreatedUserId(fnRes.data.userId as string);
      setPendingEmail(normalizedEmail);
      setAuthStep("verifying");
      setDirection(1);
      setStep(2);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to verify email.");
    } finally {
      setAuthLoading(false);
    }
  };

  // ── STEP 2: Verify OTP ──
  const handleVerifyOtp = async () => {
    if (!pendingEmail || otpValue.length !== 6) return;
    setOtpLoading(true);
    setErrorMsg(null);
    try {
      const res = await insforge.functions.invoke("verify-employee-code", {
        body: { email: pendingEmail, otp: otpValue },
      });
      if (res.error || !res.data?.success) {
        throw new Error(res.data?.error ?? res.error?.message ?? "Invalid verification code.");
      }
      setOtpValue("");
      setAuthStep("setting-password");
      setDirection(1);
      setStep(3);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setOtpLoading(false);
    }
  };

  // ── STEP 3: Set Password ──
  const handleSetPassword = async () => {
    if (!pendingEmail || !pwValue.trim()) return;
    setPwLoading(true);
    setErrorMsg(null);
    try {
      const res = await insforge.functions.invoke("set-employee-password", {
        body: { email: pendingEmail, password: pwValue.trim(), tenant_id: tenantId },
      });
      if (res.error || !res.data?.success) {
        throw new Error(res.data?.error ?? res.error?.message ?? "Failed to set password.");
      }
      setAuthStep("done");
      setPwValue("");
      setDirection(1);
      setStep(4);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to set password.");
    } finally {
      setPwLoading(false);
    }
  };

  // ── STEP 4: Employment Details Validation ──
  const handleEmploymentSubmit = () => {
    if (!form.department || !form.designation.trim() || !form.employee_code.trim() || !form.date_of_joining) {
      setErrorMsg("Please fill out all required fields marked with *.");
      return;
    }
    setErrorMsg(null);
    setDirection(1);
    setStep(5);
  };

  // ── STEP 5: Create Employee record ──
  const handleFinalSubmit = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      let currentEmployeeId = insertedEmployeeId;

      if (!currentEmployeeId) {
        // Double check email uniqueness
        const check = await db.from("employees").select("id").eq("tenant_id", tenantId).eq("email", form.email.trim().toLowerCase()).limit(1);
        if (check.data && check.data.length > 0) {
          throw new Error(`Email ${form.email.trim().toLowerCase()} is already registered.`);
        }

        const insertRes = await db
          .from("employees")
          .insert([
            {
              user_id: createdUserId,
              tenant_id: tenantId,
              full_name: form.full_name.trim(),
              email: form.email.trim().toLowerCase(),
              phone: form.phone.trim(),
              department: form.department,
              designation: form.designation.trim(),
              employee_code: form.employee_code.trim(),
              date_of_joining: form.date_of_joining,
              employment_type: form.employment_type,
              status: "active",
              work_mode: form.work_mode,
              grade: form.grade.trim() || null,
              work_location: form.work_location || null,
              manager_id: form.manager_id || null,
            },
          ])
          .select()
          .single();

        if (insertRes.error || !insertRes.data?.id) {
          throw new Error(insertRes.error?.message ?? "Failed to save profile.");
        }

        currentEmployeeId = insertRes.data.id as string;
        setInsertedEmployeeId(currentEmployeeId);

        // Leave balance seeding
        try {
          const { data: tenantSettings } = await db.from("tenant_settings").select("timezone").eq("tenant_id", tenantId).maybeSingle();
          const tz = tenantSettings?.timezone || "UTC";
          const currentYear = new Date().getFullYear();
          const targetYear = getTenantYear(tz);
          const { data: leaveTypesData } = await db
            .from("leave_types")
            .select("id, days_per_year, accrual_type")
            .eq("tenant_id", tenantId)
            .eq("is_active", true);

          if (leaveTypesData && leaveTypesData.length > 0) {
            const balanceRows = leaveTypesData.map((lt) => {
              let initialBalance = lt.days_per_year;
              if (lt.accrual_type === "monthly") {
                if (targetYear === currentYear) {
                  const elapsedMonths = new Date().getMonth() + 1;
                  initialBalance = Number(((lt.days_per_year / 12) * elapsedMonths).toFixed(2));
                } else if (targetYear > currentYear) {
                  initialBalance = 0;
                }
              }
              return {
                tenant_id: tenantId,
                employee_id: currentEmployeeId as string,
                leave_type_id: lt.id,
                year: targetYear,
                total_allocated: lt.days_per_year,
                used_days: 0,
                carried_forward: 0,
                balance: initialBalance,
              };
            });
            await db.from("leave_balances").upsert(balanceRows, { onConflict: "tenant_id,employee_id,leave_type_id,year", ignoreDuplicates: true });
          }
        } catch (leaveErr) {
          console.warn("Could not seed leave balances:", leaveErr);
        }
      } else {
        // Update existing record
        const updateRes = await db
          .from("employees")
          .update({
            full_name: form.full_name.trim(),
            phone: form.phone.trim(),
            department: form.department,
            designation: form.designation.trim(),
            employee_code: form.employee_code.trim(),
            date_of_joining: form.date_of_joining,
            employment_type: form.employment_type,
            work_mode: form.work_mode,
            grade: form.grade.trim() || null,
            work_location: form.work_location || null,
            manager_id: form.manager_id || null,
          })
          .eq("tenant_id", tenantId)
          .eq("id", currentEmployeeId);
        if (updateRes.error) throw new Error("Failed to update profile: " + updateRes.error.message);
      }

      // Finalize Onboarding
      const finalizeRes = await insforge.functions.invoke("finalize-onboarding", {
        body: { email: form.email.trim().toLowerCase(), tenant_id: tenantId },
      });
      if (finalizeRes.error || !finalizeRes.data?.success) {
        throw new Error(finalizeRes.data?.error ?? finalizeRes.error?.message ?? "Failed to finalize onboarding.");
      }

      void logAction("employee.created", "employee", currentEmployeeId);
      sessionStorage.removeItem(`hrms_employee_draft_${tenantId}`);

      toast.success("Employee created successfully!");
      onSuccess();
      onClose();
      // Reset state
      setForm(initialState);
      setStep(1);
      setAuthStep("idle");
      setInsertedEmployeeId(null);
      setCreatedUserId(null);
      setPendingEmail(null);
    } catch (err) {
      let message = err instanceof Error ? err.message : "Something went wrong.";
      if (message.includes("employees_email_key")) {
        message = "This email is already registered to an employee.";
      }
      setErrorMsg(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStepBack = () => {
    if (step > 1) {
      setDirection(-1);
      setStep((s) => s - 1);
      setErrorMsg(null);
    }
  };

  const currentHeight = stepHeights[step - 1];

  // Motion variants for step slide transitions
  const stepVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? "100%" : "-100%",
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? "-100%" : "100%",
      opacity: 0,
    }),
  };

  if (!isOpen) return null;

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

          {/* Bottom Sheet Tray */}
          <motion.div
            data-auth-step={authStep}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            style={{ minHeight: `${currentHeight}px` }}
            className="fixed bottom-0 left-0 right-0 z-[120] max-h-[95vh] rounded-t-[28px] border-t border-slate-200 bg-white shadow-2xl md:hidden pb-safe flex flex-col transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] overflow-hidden"
          >
            {/* Handle Bar */}
            <div className="mx-auto mt-3 mb-2 h-1.5 w-12 rounded-full bg-slate-200 shrink-0" />

            {/* Header */}
            <div className="px-6 flex items-center justify-between border-b border-slate-50 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <AnimatePresence mode="wait">
                  {step > 1 ? (
                    <motion.button
                      key="back-btn"
                      initial={{ scale: 0.8, opacity: 0, rotate: -45 }}
                      animate={{ scale: 1, opacity: 1, rotate: 0 }}
                      exit={{ scale: 0.8, opacity: 0, rotate: 45 }}
                      onClick={handleStepBack}
                      className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 active:scale-95 transition"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </motion.button>
                  ) : null}
                </AnimatePresence>
                <div>
                  <h3 className="text-base font-bold text-slate-900 font-display">Add New Employee</h3>
                  <p className="text-[10px] font-semibold text-brand-600 tracking-wide uppercase">
                    Step {step} of 5 — {
                      step === 1 ? "Personal Info" :
                      step === 2 ? "Verify Email" :
                      step === 3 ? "Set Password" :
                      step === 4 ? "Employment Info" : "Review & Submit"
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-full bg-slate-100 p-1.5 text-slate-500 hover:bg-slate-200 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Error Message Alert */}
            {errorMsg && (
              <div className="mx-6 mt-3 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50/50 p-3 text-xs text-rose-700 font-medium animate-fade-in shrink-0">
                <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Steps Container */}
            <div className="flex-1 relative overflow-hidden px-6 pt-3 pb-4">
              <AnimatePresence custom={direction} initial={false} mode="wait">
                <motion.div
                  key={step}
                  custom={direction}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
                  className="w-full h-full flex flex-col justify-between"
                >
                  {/* STEP 1: Personal Details */}
                  {step === 1 && (
                    <div className="space-y-3.5 flex-1">
                      <label className="block text-xs font-semibold text-slate-700">
                        <span className="mb-1 block text-slate-600">Full Name *</span>
                        <input
                          type="text"
                          placeholder="e.g. Jane Doe"
                          value={form.full_name}
                          onChange={(e) => handleChange("full_name", e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/30 px-3.5 py-2.5 text-xs outline-none focus:border-brand-600 focus:bg-white transition-all ring-offset-2 focus:ring-2 focus:ring-brand-600/20"
                        />
                      </label>
                      <label className="block text-xs font-semibold text-slate-700">
                        <span className="mb-1 block text-slate-600">Email *</span>
                        <input
                          type="email"
                          placeholder="e.g. jane.doe@company.com"
                          value={form.email}
                          onChange={(e) => handleChange("email", e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/30 px-3.5 py-2.5 text-xs outline-none focus:border-brand-600 focus:bg-white transition-all ring-offset-2 focus:ring-2 focus:ring-brand-600/20"
                        />
                      </label>
                      <label className="block text-xs font-semibold text-slate-700">
                        <span className="mb-1 block text-slate-600">Phone *</span>
                        <input
                          type="tel"
                          placeholder="e.g. 9876543210"
                          value={form.phone}
                          onChange={(e) => handleChange("phone", e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/30 px-3.5 py-2.5 text-xs outline-none focus:border-brand-600 focus:bg-white transition-all ring-offset-2 focus:ring-2 focus:ring-brand-600/20"
                        />
                      </label>

                      <div className="pt-3">
                        <MorphingButton
                          label="Send Verification Code"
                          isLoading={authLoading}
                          onClick={handleSendOTP}
                          className="w-full rounded-xl bg-brand-700 py-3 text-xs font-bold text-white shadow-lg shadow-brand-700/20 hover:bg-brand-600"
                        />
                      </div>
                    </div>
                  )}

                  {/* STEP 2: OTP Verification */}
                  {step === 2 && (
                    <div className="space-y-4 flex-1 flex flex-col justify-between">
                      <div className="space-y-2.5 text-center">
                        <h4 className="text-sm font-bold text-slate-900">Verify Employee Email</h4>
                        <p className="text-xs text-slate-500 px-2 leading-relaxed">
                          A 6-digit OTP code was sent to <strong className="text-slate-800">{form.email}</strong>. Enter it below to link their authentication user.
                        </p>
                      </div>

                      <div className="flex justify-center py-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="000000"
                          value={otpValue}
                          onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          className="w-48 rounded-xl border border-slate-200 bg-slate-50/50 py-3 text-center text-xl font-mono font-bold tracking-[0.6em] pl-4 outline-none focus:border-brand-600 focus:bg-white transition-all"
                        />
                      </div>

                      <div>
                        <MorphingButton
                          label="Verify Code"
                          isLoading={otpLoading}
                          disabled={otpValue.length !== 6}
                          onClick={handleVerifyOtp}
                          className="w-full rounded-xl bg-brand-700 py-3 text-xs font-bold text-white shadow-lg shadow-brand-700/20 hover:bg-brand-600 disabled:opacity-50 disabled:pointer-events-none"
                        />
                      </div>
                    </div>
                  )}

                  {/* STEP 3: Set Password */}
                  {step === 3 && (
                    <div className="space-y-4 flex-1 flex flex-col justify-between">
                      <div className="space-y-2.5 text-center">
                        <h4 className="text-sm font-bold text-slate-900">Create Login Password</h4>
                        <p className="text-xs text-slate-500 px-2 leading-relaxed">
                          Create a login password for <strong className="text-slate-800">{form.email}</strong>. Share it with the employee to login.
                        </p>
                      </div>

                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          placeholder="Enter a strong password"
                          value={pwValue}
                          onChange={(e) => setPwValue(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/30 px-3.5 py-3 text-xs outline-none focus:border-brand-600 focus:bg-white transition-all pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>

                      <div>
                        <MorphingButton
                          label="Set Password & Continue"
                          isLoading={pwLoading}
                          disabled={!pwValue.trim()}
                          onClick={handleSetPassword}
                          className="w-full rounded-xl bg-brand-700 py-3 text-xs font-bold text-white shadow-lg shadow-brand-700/20 hover:bg-brand-600 disabled:opacity-50 disabled:pointer-events-none"
                        />
                      </div>
                    </div>
                  )}

                  {/* STEP 4: Employment Details */}
                  {step === 4 && (
                    <div className="space-y-3.5 flex-1 flex flex-col justify-between">
                      <div className="flex-1 overflow-y-auto max-h-[340px] space-y-3.5 pr-1">
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block text-xs font-semibold text-slate-700">
                            <span className="mb-1 block text-slate-600">Department *</span>
                            <select
                              value={form.department}
                              onChange={(e) => handleChange("department", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-xs outline-none focus:border-brand-600 focus:bg-white transition-all"
                            >
                              <option value="sales">Sales</option>
                              <option value="dev">Development</option>
                              <option value="marketing">Marketing</option>
                              <option value="operations">Operations</option>
                              <option value="design">Design</option>
                              <option value="other">Other</option>
                            </select>
                          </label>
                          <label className="block text-xs font-semibold text-slate-700">
                            <span className="mb-1 block text-slate-600">Designation *</span>
                            <input
                              type="text"
                              placeholder="e.g. Software Engineer"
                              value={form.designation}
                              onChange={(e) => handleChange("designation", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/30 px-3 py-2.5 text-xs outline-none focus:border-brand-600 focus:bg-white transition-all"
                            />
                          </label>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <label className="block text-xs font-semibold text-slate-700">
                            <span className="mb-1 block text-slate-600">Employee Code *</span>
                            <input
                              type="text"
                              placeholder="e.g. EMP-1001"
                              value={form.employee_code}
                              onChange={(e) => handleChange("employee_code", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/30 px-3 py-2.5 text-xs outline-none focus:border-brand-600 focus:bg-white transition-all"
                            />
                          </label>
                          <label className="block text-xs font-semibold text-slate-700">
                            <span className="mb-1 block text-slate-600">Date of Joining *</span>
                            <input
                              type="date"
                              value={form.date_of_joining}
                              onChange={(e) => handleChange("date_of_joining", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/30 px-3 py-2.5 text-xs outline-none focus:border-brand-600 focus:bg-white transition-all"
                            />
                          </label>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <label className="block text-xs font-semibold text-slate-700">
                            <span className="mb-1 block text-slate-600">Employment Type</span>
                            <select
                              value={form.employment_type}
                              onChange={(e) => handleChange("employment_type", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-xs outline-none focus:border-brand-600 focus:bg-white transition-all"
                            >
                              <option value="full_time">Full Time</option>
                              <option value="part_time">Part Time</option>
                              <option value="contract">Contract</option>
                              <option value="intern">Intern</option>
                            </select>
                          </label>
                          <label className="block text-xs font-semibold text-slate-700">
                            <span className="mb-1 block text-slate-600">Work Mode</span>
                            <select
                              value={form.work_mode}
                              onChange={(e) => handleChange("work_mode", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-xs outline-none focus:border-brand-600 focus:bg-white transition-all"
                            >
                              <option value="office">Office</option>
                              <option value="remote">Remote</option>
                              <option value="hybrid">Hybrid</option>
                            </select>
                          </label>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <label className="block text-xs font-semibold text-slate-700">
                            <span className="mb-1 block text-slate-600">Grade</span>
                            <input
                              type="text"
                              placeholder="e.g. M3"
                              value={form.grade}
                              onChange={(e) => handleChange("grade", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/30 px-3 py-2.5 text-xs outline-none focus:border-brand-600 focus:bg-white transition-all"
                            />
                          </label>
                          <label className="block text-xs font-semibold text-slate-700">
                            <span className="mb-1 block text-slate-600">Work Location</span>
                            <select
                              value={form.work_location}
                              onChange={(e) => handleChange("work_location", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-xs outline-none focus:border-brand-600 focus:bg-white transition-all"
                            >
                              <option value="">Select Location</option>
                              <option value="Head Office">Head Office</option>
                              <option value="Branch Office">Branch Office</option>
                              <option value="Remote">Remote</option>
                              <option value="Work From Home">Work From Home</option>
                              <option value="Other">Other</option>
                            </select>
                          </label>
                        </div>

                        {/* Reporting Manager Search */}
                        <div className="relative text-xs font-semibold text-slate-700" ref={managerDropdownRef}>
                          <span className="mb-1 block text-slate-600 font-normal">Reporting Manager</span>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="Search reporting manager..."
                              value={managerSearch}
                              onFocus={() => {
                                setIsManagerDropdownOpen(true);
                                if (selectedManager) setManagerSearch("");
                              }}
                              onChange={(e) => {
                                setManagerSearch(e.target.value);
                                setIsManagerDropdownOpen(true);
                              }}
                              className="w-full rounded-xl border border-slate-200 pl-3 pr-10 py-2.5 outline-none focus:border-brand-600 focus:bg-white font-normal text-slate-900 transition-all text-xs"
                            />
                            {form.manager_id && (
                              <button
                                type="button"
                                onClick={() => {
                                  handleChange("manager_id", "");
                                  setManagerSearch("");
                                }}
                                className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[10px] font-bold"
                              >
                                Clear
                              </button>
                            )}
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                              <ChevronDown className="h-4.5 w-4.5" />
                            </div>
                          </div>

                          {/* Selected manager pill */}
                          {selectedManager && !isManagerDropdownOpen && (
                            <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5 text-[10px] text-slate-700 font-normal">
                              {selectedManager.profile_photo_url ? (
                                <img src={selectedManager.profile_photo_url} alt="" className="h-5 w-5 rounded-full object-cover" />
                              ) : (
                                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[8px] font-bold text-slate-600">
                                  {selectedManager.full_name.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <span>{selectedManager.full_name} ({selectedManager.designation || "No Designation"})</span>
                            </div>
                          )}

                          {/* Options Dropdown */}
                          <AnimatePresence>
                            {isManagerDropdownOpen && (
                              <motion.div
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                              >
                                {filteredManagers.length === 0 ? (
                                  <div className="p-3 text-center text-xs text-slate-400 font-normal">No managers found</div>
                                ) : (
                                  filteredManagers.map((emp) => (
                                    <button
                                      key={emp.id}
                                      type="button"
                                      onClick={() => {
                                        handleChange("manager_id", emp.id);
                                        setManagerSearch(emp.full_name);
                                        setIsManagerDropdownOpen(false);
                                      }}
                                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-normal text-slate-700 hover:bg-slate-50 transition"
                                    >
                                      {emp.profile_photo_url ? (
                                        <img src={emp.profile_photo_url} alt="" className="h-5.5 w-5.5 rounded-full object-cover" />
                                      ) : (
                                        <div className="flex h-5.5 w-5.5 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600">
                                          {emp.full_name.charAt(0).toUpperCase()}
                                        </div>
                                      )}
                                      <div>
                                        <p className="font-semibold text-slate-800">{emp.full_name}</p>
                                        <p className="text-[9px] text-slate-400">{emp.designation || "No designation"}</p>
                                      </div>
                                    </button>
                                  ))
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>

                      <div className="pt-2">
                        <MorphingButton
                          label="Continue to Review"
                          onClick={handleEmploymentSubmit}
                          className="w-full rounded-xl bg-brand-700 py-3 text-xs font-bold text-white shadow-lg shadow-brand-700/20 hover:bg-brand-600"
                        />
                      </div>
                    </div>
                  )}

                  {/* STEP 5: Review & Submit */}
                  {step === 5 && (
                    <div className="space-y-4 flex-1 flex flex-col justify-between">
                      <div className="flex-1 overflow-y-auto max-h-[250px] space-y-3 pr-1 text-slate-600 text-xs">
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-2">
                          <div className="flex justify-between border-b border-slate-100 pb-1.5">
                            <span className="font-medium text-slate-400">Full Name</span>
                            <span className="font-bold text-slate-800">{form.full_name}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 pb-1.5">
                            <span className="font-medium text-slate-400">Email</span>
                            <span className="font-bold text-slate-850 break-all">{form.email}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 pb-1.5">
                            <span className="font-medium text-slate-400">Phone</span>
                            <span className="font-bold text-slate-800">{form.phone}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 pb-1.5">
                            <span className="font-medium text-slate-400">Department</span>
                            <span className="font-bold text-slate-800 capitalize">{form.department}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 pb-1.5">
                            <span className="font-medium text-slate-400">Designation</span>
                            <span className="font-bold text-slate-800">{form.designation}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 pb-1.5">
                            <span className="font-medium text-slate-400">Employee Code</span>
                            <span className="font-bold text-slate-800">{form.employee_code}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-medium text-slate-400">Reporting Manager</span>
                            <span className="font-bold text-slate-800">{selectedManager?.full_name ?? "Not assigned"}</span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2">
                        <MorphingButton
                          label="Confirm & Create Employee"
                          isLoading={submitting}
                          onClick={handleFinalSubmit}
                          className="w-full rounded-xl bg-brand-700 py-3 text-xs font-bold text-white shadow-lg shadow-brand-700/20 hover:bg-brand-600"
                        />
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
