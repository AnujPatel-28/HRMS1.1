import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { CheckCircle, Clock, LogIn, LogOut, Settings, WifiOff, XCircle } from "lucide-react";
import { rawFunctions } from "../insforge/client";

// B8 phase 2: kiosk adapter. No employee login is involved anywhere on this screen -- the tablet
// itself is the authenticated thing (device serial + secret, configured once below and stored
// only in this browser's localStorage), and the employee identifies themselves with just an
// employee code + kiosk PIN. See functions/kiosk-punch for the HTTP boundary this screen calls.
//
// Uses rawFunctions (not the tenant-stamping `functions` wrapper) deliberately: the tenant for a
// kiosk punch is derived server-side from the device row, never from anything this browser sends.

const SERIAL_KEY = "kiosk_serial";
const SECRET_KEY = "kiosk_secret";
const RESET_DELAY_MS = 5000;
const PIN_MAX_LENGTH = 8;
const CODE_MAX_LENGTH = 20;
const REQUEST_TIMEOUT_MS = 15000;

// A hung network call must never leave the kiosk stuck on "Punching..." with no way back to the
// entry screen for the next person -- race it against a timeout so it always lands in the normal
// error path below.
function withTimeout(promise: Promise<any>, ms: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// One easing curve for every transition on this screen. A consistent signature is what makes
// motion feel like it belongs to one physical world rather than several unrelated components.
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

// A punch can fail in ways that demand OPPOSITE reactions from the person at the tablet: a wrong
// PIN means "type it again", a lockout means "stop typing and wait", a network drop means "this
// is not your fault". Rendering all three as one red card is the difference between a screen that
// works and one that leaves a queue of people guessing.
type ResultKind = "success" | "locked" | "offline" | "error";

type PunchResult = {
  kind: ResultKind;
  success: boolean;
  message: string;
  hint?: string;
  employeeName?: string | null;
  direction?: "in" | "out";
  occurredAt?: string;
};

const KIND_STYLES: Record<ResultKind, { border: string; bg: string; accent: string }> = {
  success: { border: "border-emerald-700", bg: "bg-emerald-950", accent: "text-emerald-300" },
  locked:  { border: "border-amber-700",   bg: "bg-amber-950",   accent: "text-amber-300" },
  offline: { border: "border-slate-600",   bg: "bg-slate-800",   accent: "text-slate-200" },
  error:   { border: "border-rose-700",    bg: "bg-rose-950",    accent: "text-rose-300" },
};

type ActiveField = "code" | "pin";

function formatTime(iso: string | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function Kiosk() {
  const [serial, setSerial] = useState(() => localStorage.getItem(SERIAL_KEY));
  const [secret, setSecret] = useState(() => localStorage.getItem(SECRET_KEY));

  // ── Setup form state (only used while unconfigured) ──────────────────────────
  const [serialInput, setSerialInput] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);

  // ── Entry form state ──────────────────────────────────────────────────────────
  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");
  const [activeField, setActiveField] = useState<ActiveField>("code");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PunchResult | null>(null);

  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Drives the drain bar on the result screen. Starts false so the width transition has
  // something to animate FROM on the first frame.
  const [drainStarted, setDrainStarted] = useState(false);

  const configured = Boolean(serial && secret);

  // Auto-reset back to the entry screen a few seconds after a result is shown, so the next
  // person in line can punch without anyone touching the tablet. This is the one behavior on
  // this screen that must never silently fail to fire.
  useEffect(() => {
    if (!result) {
      setDrainStarted(false);
      return;
    }
    // Flip on the next frame so the card's entrance and the drain bar have a "from" state to
    // animate out of. Without the rAF both would jump straight to their end value.
    const raf = requestAnimationFrame(() => setDrainStarted(true));
    resetTimerRef.current = setTimeout(() => {
      setResult(null);
      setEmployeeCode("");
      setPin("");
      setActiveField("code");
    }, RESET_DELAY_MS);
    return () => {
      cancelAnimationFrame(raf);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, [result]);

  const handleSaveSetup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedSerial = serialInput.trim();
    const trimmedSecret = secretInput.trim();
    if (!trimmedSerial || !trimmedSecret) {
      setSetupError("Both device serial and secret are required.");
      return;
    }
    localStorage.setItem(SERIAL_KEY, trimmedSerial);
    localStorage.setItem(SECRET_KEY, trimmedSecret);
    setSerial(trimmedSerial);
    setSecret(trimmedSecret);
    // Never keep the secret around in this form's state once it's saved.
    setSerialInput("");
    setSecretInput("");
    setSetupError(null);
  };

  const handleReconfigure = () => {
    if (!window.confirm("Reconfigure this kiosk? You will need the device serial and secret again.")) return;
    localStorage.removeItem(SERIAL_KEY);
    localStorage.removeItem(SECRET_KEY);
    setSerial(null);
    setSecret(null);
    setResult(null);
    setEmployeeCode("");
    setPin("");
  };

  const pressDigit = (digit: string) => {
    if (activeField === "pin") {
      setPin((prev) => (prev.length < PIN_MAX_LENGTH ? prev + digit : prev));
    } else {
      setEmployeeCode((prev) => (prev.length < CODE_MAX_LENGTH ? prev + digit : prev));
    }
  };

  const pressBackspace = () => {
    if (activeField === "pin") setPin((prev) => prev.slice(0, -1));
    else setEmployeeCode((prev) => prev.slice(0, -1));
  };

  const pressClear = () => {
    if (activeField === "pin") setPin("");
    else setEmployeeCode("");
  };

  const handlePunch = async () => {
    if (submitting || !serial || !secret) return;
    const code = employeeCode.trim();
    const pinValue = pin.trim();
    if (!code || !pinValue) {
      setResult({ kind: "error", success: false, message: "Enter your employee code and PIN." });
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await withTimeout(
        rawFunctions.invoke("kiosk-punch", {
          body: { serial, secret, employee_code: code, pin: pinValue },
        }),
        REQUEST_TIMEOUT_MS,
      );

      if (error || !data) {
        setResult({
          kind: "offline",
          success: false,
          message: "No connection",
          hint: "The kiosk could not reach the server. Your punch was not recorded - please try again.",
        });
      } else if (data.success) {
        setResult({
          kind: "success",
          success: true,
          message: data.direction === "out" ? "Punched out" : "Punched in",
          employeeName: data.employee_name,
          direction: data.direction,
          occurredAt: data.occurred_at,
        });
      } else if (data.code === "LOCKED_OUT") {
        // Deliberately no countdown and no cause: telling someone which key tripped, and exactly
        // when it clears, hands an attacker the schedule for their next attempt.
        setResult({
          kind: "locked",
          success: false,
          message: "Too many attempts",
          hint: "Please wait a few minutes before trying again, or ask HR for help.",
        });
      } else {
        setResult({
          kind: "error",
          success: false,
          message: data.error || "Punch failed. Please try again.",
          hint: data.code === "EMPLOYEE_NOT_RESOLVED" ? "Check your employee code, then re-enter your PIN." : undefined,
        });
      }
    } catch {
      setResult({
        kind: "offline",
        success: false,
        message: "No connection",
        hint: "The kiosk could not reach the server. Your punch was not recorded - please try again.",
      });
    } finally {
      setSubmitting(false);
      setEmployeeCode("");
      setPin("");
      setActiveField("code");
    }
  };

  // ── Setup screen ──────────────────────────────────────────────────────────────
  if (!configured) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 p-4">
        <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-8 shadow-lg">
          <div className="flex items-center gap-2 text-slate-300">
            <Settings className="h-5 w-5" />
            <p className="text-sm font-semibold uppercase tracking-wide">Kiosk Setup</p>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-white">Configure this device</h1>
          <p className="mt-1 text-sm text-slate-400">
            Enter the device serial and secret HR gave you when this kiosk was registered. The secret is
            shown only once at registration and will not be shown again after saving.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSaveSetup}>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-300">Device Serial</span>
              <input
                type="text"
                value={serialInput}
                onChange={(event) => setSerialInput(event.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white outline-none ring-brand-600 focus:ring"
                autoComplete="off"
                required
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-slate-300">Device Secret</span>
              <input
                type="password"
                value={secretInput}
                onChange={(event) => setSecretInput(event.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white outline-none ring-brand-600 focus:ring"
                autoComplete="off"
                required
              />
            </label>

            {setupError ? <p className="text-sm text-rose-400">{setupError}</p> : null}

            <button
              type="submit"
              className="w-full rounded-lg bg-brand-600 px-4 py-2 font-medium text-white transition hover:bg-brand-700"
            >
              Save & Continue
            </button>
          </form>
        </section>
      </main>
    );
  }

  // ── Result screen ─────────────────────────────────────────────────────────────
  // This is the highest-frequency screen in the whole product -- every employee, twice a day --
  // so per the Delight-Impact Curve it gets micro-interactions and NOTHING theatrical. The only
  // motion here is a bar draining toward the auto-reset, which is not decoration: it tells the
  // next person in the queue that the tablet is about to be ready, so nobody prods at it.
  if (result) {
    const style = KIND_STYLES[result.kind];
    const Icon =
      result.kind === "success" ? CheckCircle
      : result.kind === "locked" ? Clock
      : result.kind === "offline" ? WifiOff
      : XCircle;

    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 p-4">
        <section
          className={`w-full max-w-lg overflow-hidden rounded-3xl border shadow-lg ${style.border} ${style.bg}`}
          style={{
            // Rises into place rather than cutting in, so the result reads as having come FROM
            // the entry screen instead of replacing it. EASE is the screen's single signature.
            opacity: drainStarted ? 1 : 0,
            transform: drainStarted ? "translateY(0)" : "translateY(8px)",
            transition: `opacity 220ms ${EASE}, transform 220ms ${EASE}`,
          }}
        >
          <div className="p-12 text-center">
            <Icon className={`mx-auto mb-4 h-24 w-24 ${style.accent}`} aria-hidden="true" />

            {/* Identity leads on success: the one thing a person must verify at a glance is that
                THEIR punch registered, not someone else's. break-words + line-clamp so a long
                name wraps instead of bursting the card. */}
            {result.kind === "success" && result.employeeName ? (
              <p className="mx-auto line-clamp-2 max-w-full break-words text-3xl font-semibold text-white">
                {result.employeeName}
              </p>
            ) : null}

            <h1 className={`mt-2 break-words text-4xl font-bold ${style.accent}`}>{result.message}</h1>

            {result.occurredAt ? (
              <p className="mt-2 text-lg text-slate-300">{formatTime(result.occurredAt)}</p>
            ) : null}

            {result.hint ? (
              <p className="mx-auto mt-4 max-w-sm text-base text-slate-300">{result.hint}</p>
            ) : null}
          </div>

          {/* Drains to empty over exactly the reset delay. */}
          <div className="h-1.5 w-full bg-black/30" aria-hidden="true">
            <div
              className={`h-full ${result.kind === "success" ? "bg-emerald-400" : "bg-slate-400"}`}
              style={{
                width: drainStarted ? "0%" : "100%",
                transition: `width ${RESET_DELAY_MS}ms linear`,
              }}
            />
          </div>
        </section>
      </main>
    );
  }

  // ── Entry screen ──────────────────────────────────────────────────────────────
  return (
    <main className="grid min-h-screen place-items-center bg-slate-900 p-4">
      <section className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-800 p-8 shadow-lg">
        <p className="text-center text-sm font-semibold uppercase tracking-wide text-brand-500">
          TalentMesh Attendance Kiosk
        </p>

        <div className="mt-6 space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-300">Employee Code</span>
            <input
              type="text"
              value={employeeCode}
              onFocus={() => setActiveField("code")}
              onChange={(event) => setEmployeeCode(event.target.value.slice(0, CODE_MAX_LENGTH))}
              className={`w-full rounded-xl border bg-slate-900 px-4 py-3 text-center text-2xl font-semibold tracking-wide text-white outline-none ${
                activeField === "code" ? "border-brand-600 ring-2 ring-brand-600" : "border-slate-600"
              }`}
              autoComplete="off"
              placeholder="e.g. EMP-1001"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-slate-300">PIN</span>
            <input
              type="password"
              value={pin}
              onFocus={() => setActiveField("pin")}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, PIN_MAX_LENGTH))}
              inputMode="numeric"
              className={`w-full rounded-xl border bg-slate-900 px-4 py-3 text-center text-2xl font-semibold tracking-[0.5em] text-white outline-none ${
                activeField === "pin" ? "border-brand-600 ring-2 ring-brand-600" : "border-slate-600"
              }`}
              autoComplete="off"
              placeholder="----"
            />
          </label>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => pressDigit(digit)}
              className="rounded-xl bg-slate-700 py-4 text-2xl font-bold text-white transition hover:bg-slate-600 active:scale-95"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            onClick={pressClear}
            className="rounded-xl bg-slate-700 py-4 text-sm font-bold uppercase text-slate-300 transition hover:bg-slate-600 active:scale-95"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => pressDigit("0")}
            className="rounded-xl bg-slate-700 py-4 text-2xl font-bold text-white transition hover:bg-slate-600 active:scale-95"
          >
            0
          </button>
          <button
            type="button"
            onClick={pressBackspace}
            aria-label="Backspace"
            className="grid place-items-center rounded-xl bg-slate-700 py-4 text-2xl font-bold text-white transition hover:bg-slate-600 active:scale-95"
          >
            ⌫
          </button>
        </div>

        <button
          type="button"
          onClick={handlePunch}
          disabled={submitting || !employeeCode.trim() || !pin.trim()}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-5 text-xl font-bold text-white shadow-md transition hover:bg-brand-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            "Punching..."
          ) : (
            <>
              <LogIn className="h-6 w-6" />
              Punch
              <LogOut className="h-6 w-6" />
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleReconfigure}
          className="mt-6 w-full text-center text-xs text-slate-500 hover:text-slate-300"
        >
          Reconfigure kiosk
        </button>
      </section>
    </main>
  );
}
