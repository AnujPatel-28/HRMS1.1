import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTenant } from "../contexts/TenantContext";
import { insforge, db } from "../insforge/client";
import { useAuditLog } from "../hooks/useAuditLog";

interface FormState {
  full_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  gender: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  department: string;
  designation: string;
  employee_code: string;
  date_of_joining: string;
  employment_type: string;
  aadhaar_number: string;
  pan_number: string;
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relation: string;
}

const initialState: FormState = {
  full_name: "",
  email: "",
  phone: "",
  date_of_birth: "",
  gender: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  department: "sales",
  designation: "",
  employee_code: "",
  date_of_joining: "",
  employment_type: "full_time",
  aadhaar_number: "",
  pan_number: "",
  bank_name: "",
  account_number: "",
  ifsc_code: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  emergency_contact_relation: "",
};

const stepTitles = [
  "Personal Details",
  "Employment Info",
  "KYC & Banking",
  "Emergency Contact",
  "Review & Create",
];

interface UploadedDoc {
  label: string;
  url: string;
}

interface Credentials {
  email: string;
  password: string;
}

export default function EmployeeCreate() {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const { logAction } = useAuditLog();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(initialState);
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const [aadhaarDoc, setAadhaarDoc] = useState<File | null>(null);
  const [panDoc, setPanDoc] = useState<File | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  
  type AuthStep = "idle" | "verifying" | "setting-password" | "done";
  const [authStep, setAuthStep] = useState<AuthStep>("idle");
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isCreated, setIsCreated] = useState(false);
  const [otpValue, setOtpValue] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Prevents double-click: when Next is clicked, the Confirm & Create button
  // appears in the same DOM position — disable it briefly to absorb the extra click.
  const [justNavigated, setJustNavigated] = useState(false);

  const [insertedEmployeeId, setInsertedEmployeeId] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState({ profile: false, aadhaar: false, pan: false });

  const validateFile = (file: File | null, type: string, allowedTypes: string[]) => {
    if (!file) return null;
    if (file.size > 5 * 1024 * 1024) return `${type} exceeds 5MB size limit.`;
    if (!allowedTypes.includes(file.type)) return `${type} has unsupported format. Allowed: ${allowedTypes.map(t => t.split('/')[1].toUpperCase()).join(', ')}.`;
    return null;
  };

  const isLastStep = step === 5;

  const canMoveToNext = useMemo(() => {
    if (step === 1) {
      return Boolean(form.full_name.trim() && form.email.trim() && form.phone.trim() && authStep === "done");
    }
    if (step === 2) {
      return Boolean(form.department && form.designation.trim() && form.employee_code.trim() && form.date_of_joining);
    }
    if (step === 3) {
      return Boolean(form.aadhaar_number.trim() && form.pan_number.trim());
    }
    if (step === 4) {
      return Boolean(form.emergency_contact_name.trim() && form.emergency_contact_phone.trim());
    }
    return true;
  }, [step, form, authStep]);

  useEffect(() => {
    if (justNavigated) {
      const timer = setTimeout(() => setJustNavigated(false), 400);
      return () => clearTimeout(timer);
    }
  }, [justNavigated]);

  useEffect(() => {
    const draft = sessionStorage.getItem(`hrms_employee_draft_${tenantId}`);
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed.form) setForm(parsed.form);
        if (parsed.createdUserId) setCreatedUserId(parsed.createdUserId);
        if (parsed.authStep) setAuthStep(parsed.authStep);
        if (parsed.insertedEmployeeId) setInsertedEmployeeId(parsed.insertedEmployeeId);
        if (parsed.uploadStatus) setUploadStatus(parsed.uploadStatus);
        if (parsed.step) setStep(parsed.step);
        if (parsed.credentials) setCredentials(parsed.credentials);
        if (parsed.pendingEmail) setPendingEmail(parsed.pendingEmail);
        if (parsed.isCreated) setIsCreated(parsed.isCreated);
      } catch (e) {
        console.error("Failed to parse employee draft", e);
      }
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      if (isCreated) {
        sessionStorage.removeItem(`hrms_employee_draft_${tenantId}`);
      } else {
        sessionStorage.setItem(`hrms_employee_draft_${tenantId}`, JSON.stringify({
          form, createdUserId, authStep, insertedEmployeeId, uploadStatus, step, credentials, pendingEmail, isCreated
        }));
      }
    }
  }, [form, createdUserId, authStep, insertedEmployeeId, uploadStatus, step, credentials, pendingEmail, isCreated, tenantId]);

  const handleChange = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleEmployeeCode = (value: string) => {
    handleChange("employee_code", value);
  };

  const goNext = () => {
    if (step < 5) {
      setJustNavigated(true);
      setStep((s) => s + 1);
    }
  };
  const goBack = () => {
    if (step > 1) setStep((s) => s - 1);
  };

  const makePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  };

  const uploadFileToEmployeeFolder = async (employeeId: string, file: File, label: string): Promise<UploadedDoc> => {
    const fileName = `employees/${employeeId}/${Date.now()}_${file.name}`;
    const { data, error: uploadErr } = await insforge.storage.from("employee-documents").upload(fileName, file);
    if (uploadErr || !data) throw new Error(`Upload failed for ${label}: ${uploadErr?.message ?? "Unknown error"}`);
    return { label, url: data.url };
  };

  const handleSendOTP = async () => {
    const normalizedEmail = form.email.trim().toLowerCase();
    if (!normalizedEmail || !form.full_name.trim()) {
      setAuthError("Please enter full name and email first.");
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const emailCheck = await db
        .from("employees")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("email", normalizedEmail)
        .limit(1);
      if (emailCheck.data && emailCheck.data.length > 0) {
        throw new Error(`An employee with the email "${normalizedEmail}" already exists.`);
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
        console.error("Function Error:", fnRes);
        // Attempt to parse the error if it's a stringified JSON or inside the error object
        let parsedData = fnRes.data;
        if (fnRes.error && !parsedData) {
            try {
               // Sometimes the error object itself has the data or context
               const errObj = fnRes.error as any;
               if (errObj.context && typeof errObj.context.json === 'function') {
                   parsedData = await errObj.context.json();
               }
            } catch(e) {}
        }

        const serverMsg: string =
          parsedData?.error ??
          parsedData?.message ??
          (fnRes.error as { message?: string } | null)?.message ??
          "Failed to create auth account (Unknown Error)";
          
        const isOrphaned = parsedData?.code === "ORPHANED_AUTH_USER";
        const displayMsg = isOrphaned
          ? `This email already has an auth account from a previous attempt. Go to InsForge Dashboard → Authentication → Users, delete "${normalizedEmail}", then try again.`
          : serverMsg || "Failed to create auth account. Please try again.";
        throw new Error(displayMsg);
      }

      setCreatedUserId(fnRes.data.userId as string);
      setPendingEmail(normalizedEmail);
      setAuthStep("verifying");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!createdUserId || authStep !== "done") {
      setError("Please complete email verification first.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const fileErrors = [
      validateFile(profilePhoto, "Profile Photo", ['image/jpeg', 'image/png']),
      validateFile(aadhaarDoc, "Aadhaar Document", ['image/jpeg', 'image/png', 'application/pdf']),
      validateFile(panDoc, "PAN Document", ['image/jpeg', 'image/png', 'application/pdf'])
    ].filter(Boolean);

    if (fileErrors.length > 0) {
      setError(fileErrors.join(" "));
      setSubmitting(false);
      return;
    }

    try {
      let currentEmployeeId = insertedEmployeeId;

      if (!currentEmployeeId) {
        // Double check email uniqueness server-side
        const check = await db.from("employees").select("id").eq("tenant_id", tenantId).eq("email", form.email.trim().toLowerCase()).limit(1);
        if (check.data && check.data.length > 0) {
          throw new Error(`Email ${form.email.trim().toLowerCase()} is already registered in the system.`);
        }

        // ── Insert employee record using the HR session (satisfies RLS) ──
        const insertRes = await db
          .from("employees")
          .insert([
            {
              user_id: createdUserId,
              tenant_id: tenantId,
              full_name: form.full_name.trim(),
              email: form.email.trim().toLowerCase(),
              phone: form.phone.trim(),
              date_of_birth: form.date_of_birth || null,
              gender: form.gender || null,
              address: form.address.trim() || null,
              city: form.city.trim() || null,
              state: form.state.trim() || null,
              pincode: form.pincode.trim() || null,
              department: form.department,
              designation: form.designation.trim(),
              employee_code: form.employee_code.trim(),
              date_of_joining: form.date_of_joining,
              employment_type: form.employment_type,
              aadhaar_number: form.aadhaar_number.trim(),
              pan_number: form.pan_number.trim(),
              bank_name: form.bank_name.trim() || null,
              account_number: form.account_number.trim() || null,
              ifsc_code: form.ifsc_code.trim() || null,
              emergency_contact_name: form.emergency_contact_name.trim(),
              emergency_contact_phone: form.emergency_contact_phone.trim(),
              emergency_contact_relation: form.emergency_contact_relation.trim() || null,
              status: "active",
            },
          ])
          .select()
          .single();

        if (insertRes.error || !insertRes.data?.id) {
          throw new Error(
            insertRes.error?.message ??
            "Employee profile could not be saved. Please try again."
          );
        }

        currentEmployeeId = insertRes.data.id as string;
        setInsertedEmployeeId(currentEmployeeId);
      }

      // ── Upload documents (optional) ──
      const newUploadStatus = { ...uploadStatus };
      let hasUploadError = false;
      const uploadErrors: string[] = [];

      if (profilePhoto && !newUploadStatus.profile) {
        try {
          const uploaded = await uploadFileToEmployeeFolder(currentEmployeeId, profilePhoto, "Profile Photo");
          await db.from("employees").update({ profile_photo_url: uploaded.url }).eq("tenant_id", tenantId).eq("id", currentEmployeeId);
          newUploadStatus.profile = true;
        } catch (e) {
          hasUploadError = true;
          uploadErrors.push("Profile Photo: " + (e as Error).message);
        }
      }

      if (aadhaarDoc && !newUploadStatus.aadhaar) {
        try {
          await uploadFileToEmployeeFolder(currentEmployeeId, aadhaarDoc, "Aadhaar");
          newUploadStatus.aadhaar = true;
        } catch(e) {
          hasUploadError = true;
          uploadErrors.push("Aadhaar: " + (e as Error).message);
        }
      }

      if (panDoc && !newUploadStatus.pan) {
        try {
          await uploadFileToEmployeeFolder(currentEmployeeId, panDoc, "PAN");
          newUploadStatus.pan = true;
        } catch(e) {
          hasUploadError = true;
          uploadErrors.push("PAN: " + (e as Error).message);
        }
      }

      setUploadStatus(newUploadStatus);

      if (hasUploadError) {
        throw new Error("Failed to upload some documents:\n" + uploadErrors.join("\n") + "\n\nClick 'Confirm & Create' to retry failed uploads.");
      }

      setIsCreated(true);
      void logAction("employee.created", "employee", currentEmployeeId);
      sessionStorage.removeItem(`hrms_employee_draft_${tenantId}`);

    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const copyCredentials = async () => {
    if (!credentials) return;
    const payload = `Email: ${credentials.email}\nPassword: ${credentials.password}`;
    await navigator.clipboard.writeText(payload);
  };

  const sendViaEmailHref = credentials
    ? `mailto:${credentials.email}?subject=${encodeURIComponent("Your TalentMesh HRMS Login Credentials")}&body=${encodeURIComponent(`Welcome to TalentMesh HRMS!\n\nYour login credentials:\nEmail: ${credentials.email}\nPassword: ${credentials.password}\n\nPlease sign in and change your password after first login.`)}`
    : "#";

  // ── OTP verification ──
  const handleVerifyOtp = async () => {
    if (!pendingEmail || otpValue.length !== 6) return;
    setOtpLoading(true);
    setOtpError(null);
    try {

      const res = await insforge.functions.invoke("verify-employee-code", {
        body: { email: pendingEmail, otp: otpValue },
      });
      if (res.error || !res.data?.success) {
        const msg: string = res.data?.error ?? res.error?.message ?? "Invalid code. Please try again.";
        setOtpError(msg);
      } else {
        setOtpValue("");
        setOtpError(null);
        setAuthStep("setting-password");
      }
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : "Verification failed. Please try again.");
    } finally {
      setOtpLoading(false);
    }
  };

  // ── Set employee password ──
  const handleSetPassword = async () => {
    if (!pendingEmail || !pwValue.trim()) return;
    setPwLoading(true);
    setPwError(null);
    try {
      const res = await insforge.functions.invoke("set-employee-password", {
        body: { email: pendingEmail, password: pwValue.trim(), tenant_id: tenantId },
      });
      if (res.error || !res.data?.success) {
        const msg: string = res.data?.error ?? (res.error as any)?.error ?? res.error?.message ?? "Failed to set password.";
        setPwError(msg);
      } else {
        setCredentials({ email: pendingEmail, password: pwValue.trim() });
        setAuthStep("done");
        setPwValue("");
      }
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Failed to set password.");
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Create Employee</h2>
          <p className="text-sm text-slate-500">Step {step} of 5 — {stepTitles[step - 1]}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/hr/employees")}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          Back to list
        </button>
      </div>

      <div className="hide-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
        {stepTitles.map((label, index) => {
          const stepNo = index + 1;
          const completed = stepNo < step;
          const current = stepNo === step;
          return (
            <div
              key={label}
              className={`min-w-[150px] rounded-lg border px-3 py-2 text-center text-xs font-semibold sm:min-w-0 sm:flex-1 ${
                completed
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : current
                    ? "border-brand-200 bg-brand-50 text-brand-700"
                    : "border-slate-200 bg-slate-50 text-slate-500"
              }`}
            >
              {label}
            </div>
          );
        })}
      </div>

      {!isCreated && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {step === 1 ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Full Name *</span>
                <input
                  type="text"
                  placeholder="e.g. Jane Doe"
                  maxLength={100}
                  value={form.full_name}
                  onChange={(event) => handleChange("full_name", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring disabled:bg-slate-100 disabled:text-slate-500"
                  required
                  disabled={authStep !== "idle"}
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Email *</span>
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="e.g. jane.doe@example.com"
                    maxLength={100}
                    value={form.email}
                    onChange={(event) => handleChange("email", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring disabled:bg-slate-100 disabled:text-slate-500"
                    required
                    disabled={authStep !== "idle"}
                  />
                  {authStep === "idle" && (
                    <button
                      type="button"
                      onClick={() => { void handleSendOTP(); }}
                      disabled={authLoading || !form.email.trim() || !form.full_name.trim()}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
                    >
                      {authLoading ? "Sending..." : "Verify"}
                    </button>
                  )}
                  {authStep === "done" && (
                    <span className="flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-600 border border-emerald-200 whitespace-nowrap">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Verified
                    </span>
                  )}
                </div>
                {authError && <p className="mt-1 text-xs text-rose-500">{authError}</p>}
                {authStep === "idle" && <p className="mt-1 text-xs text-slate-500">Enter full name and email to verify.</p>}
              </label>

              {/* ── Step A: OTP Verification ── */}
              {authStep === "verifying" && pendingEmail && (
                <div className="md:col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-5 space-y-4 mt-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-600">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">1</span>
                    <span>Verify Email</span>
                    <span className="mx-1 text-blue-300">/</span>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-blue-300 text-blue-400">2</span>
                    <span className="text-blue-400">Set Password</span>
                  </div>

                  <div>
                    <h3 className="text-base font-semibold text-blue-900">Verify Employee Email</h3>
                    <p className="mt-1 text-sm text-blue-700">
                      A <strong>6-digit verification code</strong> was sent to{" "}
                      <strong>{pendingEmail}</strong>. Ask the employee to check their email and share the code with you.
                    </p>
                  </div>

                  {otpError && (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{otpError}</p>
                  )}

                  <div className="flex gap-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="Enter 6-digit code"
                      value={otpValue}
                      onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="w-48 rounded-lg border border-blue-300 bg-white px-3 py-2 text-center text-lg font-mono tracking-widest outline-none ring-blue-400 focus:ring"
                    />
                    <button
                      type="button"
                      disabled={otpLoading || otpValue.length !== 6}
                      onClick={() => { void handleVerifyOtp(); }}
                      className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {otpLoading ? "Verifying…" : "Verify Code"}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Step B: Set Password ── */}
              {authStep === "setting-password" && pendingEmail && (
                <div className="md:col-span-2 rounded-xl border border-violet-200 bg-violet-50 p-5 space-y-4 mt-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-violet-600">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="text-emerald-600">Email Verified</span>
                    <span className="mx-1 text-violet-300">/</span>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white">2</span>
                    <span>Set Password</span>
                  </div>

                  <div>
                    <h3 className="text-base font-semibold text-violet-900">Set Employee Login Password</h3>
                    <p className="mt-1 text-sm text-violet-700">
                      Email verified ✅ — now create a password for <strong>{pendingEmail}</strong>. Share it with the employee so they can log in.
                    </p>
                  </div>

                  {pwError && (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{pwError}</p>
                  )}

                  <div className="flex gap-3">
                    <input
                      type="text"
                      placeholder="Create a password"
                      value={pwValue}
                      onChange={(e) => setPwValue(e.target.value)}
                      className="flex-1 rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm outline-none ring-violet-400 focus:ring"
                    />
                    <button
                      type="button"
                      disabled={pwLoading || !pwValue.trim()}
                      onClick={() => { void handleSetPassword(); }}
                      className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                    >
                      {pwLoading ? "Saving…" : "Set Password & Finish"}
                    </button>
                  </div>
                </div>
              )}
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Phone *</span>
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  maxLength={15}
                  value={form.phone}
                  onChange={(event) => handleChange("phone", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Date of Birth</span>
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(event) => handleChange("date_of_birth", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Gender</span>
                <select
                  value={form.gender}
                  onChange={(event) => handleChange("gender", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                >
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Address</span>
                <textarea
                  placeholder="e.g. 123 Main St, Apt 4B"
                  maxLength={500}
                  value={form.address}
                  onChange={(event) => handleChange("address", event.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">City</span>
                <input
                  type="text"
                  placeholder="e.g. Mumbai"
                  maxLength={50}
                  value={form.city}
                  onChange={(event) => handleChange("city", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">State</span>
                <input
                  type="text"
                  placeholder="e.g. Maharashtra"
                  maxLength={50}
                  value={form.state}
                  onChange={(event) => handleChange("state", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Pincode</span>
                <input
                  type="text"
                  placeholder="e.g. 400001"
                  maxLength={10}
                  value={form.pincode}
                  onChange={(event) => handleChange("pincode", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Profile Photo</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setProfilePhoto(event.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Department *</span>
                <select
                  value={form.department}
                  onChange={(event) => handleChange("department", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                >
                  <option value="sales">Sales</option>
                  <option value="dev">Development</option>
                  <option value="marketing">Marketing</option>
                  <option value="operations">Operations</option>
                  <option value="design">Design</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Designation *</span>
                <input
                  type="text"
                  placeholder="e.g. Software Engineer"
                  maxLength={100}
                  value={form.designation}
                  onChange={(event) => handleChange("designation", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Employee Code *</span>
                <input
                  type="text"
                  placeholder="e.g. EMP-1001"
                  maxLength={20}
                  value={form.employee_code}
                  onChange={(event) => handleEmployeeCode(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Date of Joining *</span>
                <input
                  type="date"
                  value={form.date_of_joining}
                  onChange={(event) => handleChange("date_of_joining", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Employment Type</span>
                <select
                  value={form.employment_type}
                  onChange={(event) => handleChange("employment_type", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                >
                  <option value="full_time">Full Time</option>
                  <option value="part_time">Part Time</option>
                  <option value="contract">Contract</option>
                  <option value="intern">Intern</option>
                </select>
              </label>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Aadhaar Number *</span>
                <input
                  type="text"
                  placeholder="e.g. 1234 5678 9012"
                  maxLength={14}
                  value={form.aadhaar_number}
                  onChange={(event) => handleChange("aadhaar_number", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">PAN Number *</span>
                <input
                  type="text"
                  placeholder="e.g. ABCDE1234F"
                  maxLength={10}
                  value={form.pan_number}
                  onChange={(event) => handleChange("pan_number", event.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Upload Aadhaar Document</span>
                <input
                  type="file"
                  onChange={(event) => setAadhaarDoc(event.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Upload PAN Document</span>
                <input
                  type="file"
                  onChange={(event) => setPanDoc(event.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Bank Name</span>
                <input
                  type="text"
                  placeholder="e.g. HDFC Bank"
                  maxLength={100}
                  value={form.bank_name}
                  onChange={(event) => handleChange("bank_name", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Account Number</span>
                <input
                  type="text"
                  placeholder="e.g. 1234567890"
                  maxLength={30}
                  value={form.account_number}
                  onChange={(event) => handleChange("account_number", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">IFSC Code</span>
                <input
                  type="text"
                  placeholder="e.g. HDFC0001234"
                  maxLength={11}
                  value={form.ifsc_code}
                  onChange={(event) => handleChange("ifsc_code", event.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Emergency Contact Name *</span>
                <input
                  type="text"
                  placeholder="e.g. John Doe"
                  maxLength={100}
                  value={form.emergency_contact_name}
                  onChange={(event) => handleChange("emergency_contact_name", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Emergency Contact Phone *</span>
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  maxLength={15}
                  value={form.emergency_contact_phone}
                  onChange={(event) => handleChange("emergency_contact_phone", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Relationship</span>
                <input
                  value={form.emergency_contact_relation}
                  onChange={(event) => handleChange("emergency_contact_relation", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                />
              </label>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
              {Object.entries(form).map(([key, value]) => (
                <div key={key} className="text-sm">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{key.replace(/_/g, " ")}</p>
                  <p className="font-medium text-slate-900">{value || "—"}</p>
                </div>
              ))}
              <div className="text-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Profile Photo</p>
                <p className="font-medium text-slate-900">{profilePhoto?.name ?? "Not uploaded"}</p>
              </div>
              <div className="text-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Aadhaar / PAN Docs</p>
                <p className="font-medium text-slate-900">{aadhaarDoc?.name ?? "No Aadhaar doc"} / {panDoc?.name ?? "No PAN doc"}</p>
              </div>
            </div>
          ) : null}

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <span className="mt-0.5 shrink-0 text-rose-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-rose-700">Could not create employee</p>
                <p className="mt-0.5 text-sm text-rose-600">{error}</p>
              </div>
              <button type="button" onClick={() => setError(null)} className="shrink-0 rounded p-0.5 hover:bg-rose-100 text-rose-400 hover:text-rose-600">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 1 || submitting}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Previous
            </button>

            {isLastStep ? (
              <button
                type="submit"
                disabled={submitting || justNavigated}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Creating employee..." : "Confirm & Create"}
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                disabled={!canMoveToNext || submitting}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            )}
          </div>
        </form>
      )}



      {/* ── Step C: Done ── */}
      {isCreated && credentials && (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <h3 className="text-base font-semibold text-emerald-900">Employee account is fully set up 🎉</h3>
          </div>
          <p className="mt-1 text-sm text-emerald-800">Account verified and password set. Share the credentials below.</p>

          <div className="mt-3 rounded-lg bg-white p-3 text-sm border border-emerald-200">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Login credentials</p>
            <p><span className="font-semibold">Email:</span> {credentials.email}</p>
            <p><span className="font-semibold">Password:</span> {credentials.password}</p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { void copyCredentials(); }}
              className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
            >
              Copy credentials
            </button>
            <a
              href={sendViaEmailHref}
              className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
            >
              Send via mail client
            </a>
            <button
              type="button"
              onClick={() => navigate("/hr/employees")}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Go to employee list
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
