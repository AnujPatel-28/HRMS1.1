import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Check, Copy, Fingerprint, KeyRound, Loader2,
  MonitorSmartphone, Plus, ShieldAlert, X,
} from "lucide-react";
import { db } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import { useAuditLog } from "../hooks/useAuditLog";
import { Skeleton } from "../shared/Skeleton";
import { useToast } from "../shared/ToastContext";

// B9: provisioning for the B8 device seam. Two things HR must be able to do before a kiosk or a
// biometric unit can be used at all:
//   1. register the device and capture its secret (shown exactly once)
//   2. give each employee the credential their device type resolves them by --
//      a kiosk PIN, or the id they are enrolled under on a biometric unit
//
// The RPCs behind this all existed before this screen; without it a kiosk could only be
// provisioned by hand against the database.

type DeviceRow = {
  id: string;
  name: string;
  device_type: "kiosk" | "biometric";
  serial: string;
  source: string;
  is_active: boolean;
  allow_serial_only: boolean;
  last_seen_at: string | null;
  created_at: string;
};

type CredentialRow = {
  employee_id: string;
  full_name: string;
  employee_code: string | null;
  pin_set: boolean;
  attendance_device_id: string | null;
};

function formatSeen(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function AttendanceDevices() {
  const { tenantId } = useTenant();
  const { logAction } = useAuditLog();
  const { success, error: toastError } = useToast();

  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);

  // Register form
  const [registerOpen, setRegisterOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [deviceType, setDeviceType] = useState<"kiosk" | "biometric">("kiosk");
  const [serial, setSerial] = useState("");

  // The one-time secret. Held in state ONLY -- never re-fetchable, never persisted here.
  const [issued, setIssued] = useState<{ serial: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Credential editing
  const [pinFor, setPinFor] = useState<CredentialRow | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [deviceIdEditing, setDeviceIdEditing] = useState<string | null>(null);
  const [deviceIdValue, setDeviceIdValue] = useState("");

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [devRes, credRes] = await Promise.all([
        db.from("attendance_devices")
          // secret_hash is deliberately NOT selected -- there is no reason for a browser to hold it.
          .select("id, name, device_type, serial, source, is_active, allow_serial_only, last_seen_at, created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        db.rpc("hr_list_kiosk_credentials", { p_tenant_id: tenantId }),
      ]);
      if (devRes.error) throw devRes.error;
      if (credRes.error) throw credRes.error;
      setDevices((devRes.data ?? []) as DeviceRow[]);
      setCredentials((credRes.data ?? []) as CredentialRow[]);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to load attendance devices.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toastError]);

  useEffect(() => { void load(); }, [load]);

  const handleRegister = async () => {
    if (!tenantId || saving) return;
    if (!name.trim() || !serial.trim()) {
      toastError("Device name and serial are both required.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await db.rpc("hr_register_attendance_device", {
        p_tenant_id: tenantId,
        p_name: name.trim(),
        p_device_type: deviceType,
        p_serial: serial.trim(),
        p_location_id: null,
      });
      if (error) throw error;
      setIssued({ serial: data.serial, secret: data.secret });
      setCopied(false);
      setRegisterOpen(false);
      setName("");
      setSerial("");
      void logAction("attendance_device.registered", "attendance_devices", data.device_id);
      void load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to register device.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (device: DeviceRow) => {
    if (!tenantId) return;
    try {
      const { error } = await db
        .from("attendance_devices")
        .update({ is_active: !device.is_active })
        .eq("tenant_id", tenantId)
        .eq("id", device.id);
      if (error) throw error;
      success(device.is_active ? "Device deactivated." : "Device activated.");
      void load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to update device.");
    }
  };

  const handleSetPin = async () => {
    if (!tenantId || !pinFor || pinSaving) return;
    if (!/^\d{4,8}$/.test(pinValue)) {
      toastError("PIN must be 4 to 8 digits.");
      return;
    }
    setPinSaving(true);
    try {
      const { error } = await db.rpc("hr_set_employee_kiosk_pin", {
        p_tenant_id: tenantId,
        p_employee_id: pinFor.employee_id,
        p_pin: pinValue,
      });
      if (error) throw error;
      success(`PIN set for ${pinFor.full_name}.`);
      setPinFor(null);
      setPinValue("");
      void load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to set PIN.");
    } finally {
      setPinSaving(false);
    }
  };

  const handleSaveDeviceId = async (row: CredentialRow) => {
    if (!tenantId) return;
    const next = deviceIdValue.trim();
    try {
      const { error } = await db
        .from("employees")
        .update({ attendance_device_id: next === "" ? null : next })
        .eq("tenant_id", tenantId)
        .eq("id", row.employee_id);
      if (error) throw error;
      success(`Biometric ID updated for ${row.full_name}.`);
      setDeviceIdEditing(null);
      void load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to update biometric ID.");
    }
  };

  const copySecret = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.secret);
      setCopied(true);
    } catch {
      toastError("Could not copy. Select the secret and copy it manually.");
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Attendance Devices</h1>
          <p className="mt-1 text-sm text-slate-500">
            Register the kiosks and biometric machines that may record attendance, and give employees the
            credential their device identifies them by.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRegisterOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" />
          Register device
        </button>
      </div>

      {/* ── The one-time secret ────────────────────────────────────────────────────
          This is the only moment this value exists outside the database, and it is a
          rare, consequential action -- so it gets the emphasis rather than a toast that
          scrolls away. Dismissal is deliberate: there is no way to recover it. */}
      {issued ? (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-amber-900">Save this device secret now</h2>
              <p className="mt-1 text-sm text-amber-800">
                This is the only time it will be shown. It cannot be recovered — if it is lost, delete the
                device and register it again. Enter it once on the kiosk tablet at{" "}
                <code className="rounded bg-amber-100 px-1">/kiosk</code>.
              </p>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <dt className="w-16 shrink-0 text-amber-700">Serial</dt>
                  <dd className="font-mono text-amber-900">{issued.serial}</dd>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <dt className="w-16 shrink-0 pt-1 text-amber-700">Secret</dt>
                  <dd className="min-w-0 flex-1">
                    <code className="block break-all rounded border border-amber-300 bg-white p-2 font-mono text-xs text-slate-800">
                      {issued.secret}
                    </code>
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copySecret}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-700"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy secret"}
                </button>
                <button
                  type="button"
                  onClick={() => setIssued(null)}
                  className="rounded-lg border border-amber-400 px-3 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
                >
                  I have saved it
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Devices ───────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <header className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Registered devices</h2>
        </header>

        {devices.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <MonitorSmartphone className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 font-medium text-slate-700">No devices yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Register a <strong>kiosk</strong> to turn a shared tablet into a punch station, or a{" "}
              <strong>biometric</strong> device to connect an existing ZKTeco or eSSL machine.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100">
                  {device.device_type === "kiosk"
                    ? <MonitorSmartphone className="h-5 w-5 text-slate-600" />
                    : <Fingerprint className="h-5 w-5 text-slate-600" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-800">{device.name}</p>
                  <p className="truncate font-mono text-xs text-slate-500">{device.serial}</p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p className="capitalize">{device.device_type}</p>
                  <p>Last seen {formatSeen(device.last_seen_at)}</p>
                </div>
                {device.allow_serial_only ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800"
                    title="This device is trusted on its serial number alone, with no secret. Punches it records are marked as such."
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Serial only
                  </span>
                ) : null}
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    device.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {device.is_active ? "Active" : "Inactive"}
                </span>
                <button
                  type="button"
                  onClick={() => handleToggleActive(device)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  {device.is_active ? "Deactivate" : "Activate"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Employee credentials ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <header className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Employee credentials</h2>
          <p className="mt-1 text-sm text-slate-500">
            A kiosk identifies someone by their employee code and PIN. A biometric machine identifies them
            by the ID they are enrolled under on the device itself.
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Employee</th>
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Kiosk PIN</th>
                <th className="px-5 py-3 font-medium">Biometric ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {credentials.map((row) => (
                <tr key={row.employee_id}>
                  <td className="px-5 py-3 font-medium text-slate-800">{row.full_name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">
                    {row.employee_code || <span className="text-rose-600">Not set</span>}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className={row.pin_set ? "text-emerald-700" : "text-slate-400"}>
                        {row.pin_set ? "Set" : "Not set"}
                      </span>
                      <button
                        type="button"
                        onClick={() => { setPinFor(row); setPinValue(""); }}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        <KeyRound className="h-3 w-3" />
                        {row.pin_set ? "Reset" : "Set PIN"}
                      </button>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {deviceIdEditing === row.employee_id ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={deviceIdValue}
                          onChange={(e) => setDeviceIdValue(e.target.value)}
                          className="w-28 rounded border border-slate-300 px-2 py-1 text-xs"
                          placeholder="e.g. 102"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveDeviceId(row)}
                          className="rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeviceIdEditing(null)}
                          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setDeviceIdEditing(row.employee_id);
                          setDeviceIdValue(row.attendance_device_id ?? "");
                        }}
                        className="font-mono text-xs text-slate-600 underline decoration-dotted underline-offset-2 hover:text-slate-900"
                      >
                        {row.attendance_device_id || "Not enrolled"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Register modal ────────────────────────────────────────────────────────── */}
      {registerOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Register a device</h2>
              <button type="button" onClick={() => setRegisterOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Reception tablet"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>

              <fieldset>
                <legend className="mb-1 block text-sm font-medium text-slate-700">Type</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(["kiosk", "biometric"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setDeviceType(type)}
                      className={`rounded-lg border px-3 py-2 text-sm capitalize transition ${
                        deviceType === type
                          ? "border-brand-600 bg-brand-50 font-medium text-brand-700"
                          : "border-slate-300 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {deviceType === "kiosk"
                    ? "A shared tablet running the punch screen. Choose any serial you like — it just names this tablet."
                    : "An existing ZKTeco or eSSL machine. The serial must match the device's own serial number exactly, because that is how it identifies itself."}
                </p>
              </fieldset>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Serial</span>
                <input
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder={deviceType === "kiosk" ? "RECEPTION-01" : "ZK8472913"}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRegisterOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRegister}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Register
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Set PIN modal ─────────────────────────────────────────────────────────── */}
      {pinFor ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-800">
              {pinFor.pin_set ? "Reset" : "Set"} kiosk PIN
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              For <span className="font-medium text-slate-700">{pinFor.full_name}</span>. Tell them the PIN
              directly — it is stored hashed and cannot be looked up later.
            </p>
            {!pinFor.employee_code ? (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                This employee has no employee code, so a kiosk cannot identify them. Add a code first.
              </p>
            ) : null}

            <input
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              autoFocus
              placeholder="4 to 8 digits"
              className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-xl tracking-[0.4em]"
            />

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setPinFor(null); setPinValue(""); }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSetPin}
                disabled={pinSaving || !/^\d{4,8}$/.test(pinValue)}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {pinSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save PIN
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
