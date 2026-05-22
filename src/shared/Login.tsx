import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { auth } from "../insforge/client";
import { useAuth } from "../hooks/useAuth";
import { useAuditLog } from "../hooks/useAuditLog";

export default function Login() {
  const navigate = useNavigate();
  const { login, verifyEmail, role, user, loading } = useAuth();
  const { logAction } = useAuditLog();

  // Step 1: credentials
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Step 2: OTP verification
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [pendingEmail, setPendingEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  const getPostLoginPath = (userId: string, currentRole: typeof role) => {
    if (currentRole === "superadmin") return "/admin/dashboard";
    const lastProduct = localStorage.getItem(`talentmesh_last_product_${userId}`);
    if (currentRole === "hr" && lastProduct === "hr") return "/hr/dashboard";
    if (currentRole === "employee" && lastProduct === "employee") return "/employee/dashboard";
    return "/select";
  };

  useEffect(() => {
    if (user?.id && role) navigate(getPostLoginPath(user.id, role), { replace: true });
  }, [role, user?.id, navigate]);

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-slate-500">Loading...</div>;
  }

  if (user && role) {
    return <Navigate to={getPostLoginPath(user.id, role)} replace />;
  }

  // ── Step 1: Sign In ──────────────────────────────────────────────────────────
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await login(email, password);

    if (result.requiresVerification) {
      // Email verification required – switch to OTP step
      setPendingEmail(result.email);
      setOtp(["", "", "", "", "", ""]);
      setOtpError(null);
      setStep("otp");
      setSubmitting(false);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
      return;
    }

    if (result.error) {
      void logAction("login.failed", "employee", undefined, { email });
      setError(result.error);
    } else {
      const { data } = await auth.getCurrentUser();
      if (data?.user?.id) {
        void logAction("login.success", "employee", data.user.id, { email });
      }
    }

    setSubmitting(false);
  };

  // ── Step 2: Verify OTP ───────────────────────────────────────────────────────
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return; // digits only
    const next = [...otp];
    next[index] = value;
    setOtp(next);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      setOtp(text.split(""));
      otpRefs.current[5]?.focus();
    }
  };

  const handleVerifyOtp = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = otp.join("");
    if (code.length < 6) {
      setOtpError("Please enter the full 6-digit code.");
      return;
    }
    setVerifying(true);
    setOtpError(null);

    const result = await verifyEmail(pendingEmail, code);
    if (result.error) {
      void logAction("login.failed", "employee", undefined, { email: pendingEmail });
      setOtpError(result.error);
      setVerifying(false);
      return;
    } else {
      const { data } = await auth.getCurrentUser();
      if (data?.user?.id) {
        void logAction("login.success", "employee", data.user.id, { email: pendingEmail });
      }
    }
    // verifyEmail sets user+role in context → useEffect navigates automatically
  };

  const handleResend = async () => {
    setResending(true);
    setResendMsg(null);
    const { data } = await auth.resendVerificationEmail({ email: pendingEmail });
    setResendMsg(data?.success ? "A new code has been sent to your email." : "Failed to resend. Try again.");
    setResending(false);
  };

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">TalentMesh HRMS</p>

        {step === "credentials" ? (
          <>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">Sign In</h1>
            <p className="mt-1 text-sm text-slate-500">Use your HR or employee credentials.</p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                  required
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Password</span>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 outline-none ring-brand-600 focus:ring"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.857-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
              </label>

              {error ? <p className="text-sm text-rose-600">{error}</p> : null}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-brand-600 px-4 py-2 font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Signing in..." : "Sign In"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">Verify Your Email</h1>
            <p className="mt-1 text-sm text-slate-500">
              We sent a 6-digit code to{" "}
              <span className="font-medium text-slate-700">{pendingEmail}</span>. Enter it below
              to complete sign-in.
            </p>

            <form className="mt-6 space-y-5" onSubmit={handleVerifyOtp}>
              {/* OTP boxes */}
              <div className="flex justify-center gap-2">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    onPaste={i === 0 ? handleOtpPaste : undefined}
                    className="h-12 w-10 rounded-lg border border-slate-300 text-center text-lg font-bold outline-none ring-brand-600 focus:ring"
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              {otpError ? <p className="text-center text-sm text-rose-600">{otpError}</p> : null}
              {resendMsg ? <p className="text-center text-sm text-emerald-600">{resendMsg}</p> : null}

              <button
                type="submit"
                disabled={verifying || otp.join("").length < 6}
                className="w-full rounded-lg bg-brand-600 px-4 py-2 font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {verifying ? "Verifying..." : "Verify & Sign In"}
              </button>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => setStep("credentials")}
                  className="text-slate-500 hover:text-slate-700"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="text-brand-600 hover:underline disabled:opacity-60"
                >
                  {resending ? "Sending..." : "Resend code"}
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
