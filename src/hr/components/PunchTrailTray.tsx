import { useCallback, useEffect, useState } from "react";
import {
  Fingerprint, LogIn, LogOut, MapPin, MonitorSmartphone, Pencil,
  Smartphone, Upload, X,
} from "lucide-react";
import { db } from "../../insforge/client";

// B7d: the evidence behind a derived day.
//
// Until now nothing in the product read attendance_events at all -- HR could see that someone was
// marked present, late or absent, but not the punches that led there. When an employee disputes a
// day, "the system says so" is not an answer.
//
// A tray rather than a page, deliberately: a derived day is the destination and its trail is a
// transient detail, so the attendance table stays underneath and HR never loses their place. The
// day being examined travels into the tray header rather than vanishing, so it is obvious which
// row this belongs to.
//
// HR opens this rarely, which is what earns the staggered reveal -- on a screen used many times a
// day the same animation would be an irritation.

type EventRow = {
  id: string;
  event_time: string;
  direction: "in" | "out" | null;
  source: string;
  source_ref: string | null;
  attendance_id: string | null;
  skip_derivation: boolean;
  void_reason: string | null;
  lat: number | string | null;
  lng: number | string | null;
  location_status: string | null;
  evidence: Record<string, unknown> | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  employeeId: string;
  employeeName: string;
  date: string;
  attendanceId?: string | null;
  derivationSource?: string | null;
};

const SOURCE_META: Record<string, { label: string; Icon: typeof Smartphone }> = {
  app: { label: "Mobile app", Icon: Smartphone },
  kiosk: { label: "Kiosk", Icon: MonitorSmartphone },
  device: { label: "Biometric device", Icon: Fingerprint },
  manual: { label: "Manual entry", Icon: Pencil },
  import: { label: "Imported", Icon: Upload },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export default function PunchTrailTray({
  open, onClose, tenantId, employeeId, employeeName, date, attendanceId, derivationSource,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(false);

  const load = useCallback(async () => {
    if (!open || !tenantId || !employeeId) return;
    setLoading(true);
    setFailed(false);
    try {
      // A day either side of the date: a night shift's punches legitimately fall outside the
      // calendar day they belong to, and clipping to midnight would hide exactly the punches most
      // likely to be disputed.
      const from = new Date(`${date}T00:00:00`);
      from.setDate(from.getDate() - 1);
      const to = new Date(`${date}T00:00:00`);
      to.setDate(to.getDate() + 2);

      const { data, error } = await db
        .from("attendance_events")
        .select("id, event_time, direction, source, source_ref, attendance_id, skip_derivation, void_reason, lat, lng, location_status, evidence")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employeeId)
        .gte("event_time", from.toISOString())
        .lt("event_time", to.toISOString())
        .order("event_time", { ascending: true });

      if (error) throw error;
      setEvents((data ?? []) as EventRow[]);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [open, tenantId, employeeId, date]);

  useEffect(() => { void load(); }, [load]);

  // Mount, then flip on the next frame so the tray has a state to animate out of.
  useEffect(() => {
    if (!open) { setShown(false); return; }
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close punch trail"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 transition-opacity"
        style={{ opacity: shown ? 1 : 0, transitionDuration: "200ms" }}
      />

      <section
        className="relative w-full max-w-lg overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        style={{
          transform: shown ? "translateY(0)" : "translateY(16px)",
          opacity: shown ? 1 : 0,
          transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* The day travels in with the tray rather than being replaced by it. */}
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800">{employeeName}</p>
            <p className="text-sm text-slate-500">
              Punch trail ·{" "}
              {new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", {
                weekday: "short", day: "numeric", month: "short", year: "numeric",
              })}
            </p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : failed ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Could not load the punch trail. Please try again.
            </p>
          ) : events.length === 0 ? (
            // Empty is the COMMON case at launch, not an edge case -- the event log only started
            // recording partway through the product's life. So it must say WHY it is empty, or HR
            // will read "no punches" as "this person did not come in".
            <div className="py-10 text-center">
              <MonitorSmartphone className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 font-medium text-slate-700">No punch events for this day</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                {derivationSource == null
                  ? "This day was recorded before the punch event log existed, so there is no underlying trail to show. Days recorded since then will have one."
                  : "This day was derived without any punches — it was marked from the work calendar, an approved leave, or as absent."}
              </p>
            </div>
          ) : (
            <ol className="relative space-y-3 border-l border-slate-200 pl-5">
              {events.map((event, index) => {
                const meta = SOURCE_META[event.source] ?? { label: event.source, Icon: Smartphone };
                const excluded = event.skip_derivation || Boolean(event.void_reason);
                const authMode = (event.evidence as { auth_mode?: string } | null)?.auth_mode;
                return (
                  <li
                    key={event.id}
                    className="relative rounded-lg border border-slate-200 bg-white p-3"
                    style={{
                      opacity: shown ? 1 : 0,
                      transform: shown ? "translateY(0)" : "translateY(6px)",
                      // Staggered, but capped: past a handful the wait stops reading as
                      // craft and starts reading as lag.
                      transition: `opacity 220ms ease ${Math.min(index, 6) * 45}ms, transform 220ms ease ${Math.min(index, 6) * 45}ms`,
                    }}
                  >
                    <span
                      className={`absolute -left-[26px] top-4 grid h-4 w-4 place-items-center rounded-full ring-4 ring-white ${
                        event.direction === "out" ? "bg-slate-400" : "bg-brand-500"
                      }`}
                      aria-hidden="true"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {event.direction === "out"
                        ? <LogOut className="h-4 w-4 text-slate-500" />
                        : <LogIn className="h-4 w-4 text-brand-600" />}
                      <span className="font-medium text-slate-800">
                        {event.direction === "out" ? "Punch out" : event.direction === "in" ? "Punch in" : "Punch"}
                      </span>
                      <span className="text-sm text-slate-500">{fmt(event.event_time)}</span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <meta.Icon className="h-3.5 w-3.5" />
                        {meta.label}
                      </span>
                      {event.lat != null && event.lng != null ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {Number(event.lat).toFixed(4)}, {Number(event.lng).toFixed(4)}
                        </span>
                      ) : null}
                      {event.location_status ? <span>{event.location_status.replace(/_/g, " ")}</span> : null}
                      {event.source_ref ? <span className="font-mono">{event.source_ref}</span> : null}
                    </div>

                    {authMode === "serial_only" ? (
                      <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        Recorded by a device trusted on its serial number alone, with no secret.
                      </p>
                    ) : null}

                    {excluded ? (
                      <p className="mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                        Excluded from derivation
                        {event.void_reason ? <>: {event.void_reason}</> : null}
                      </p>
                    ) : event.attendance_id == null ? (
                      <p className="mt-2 text-xs text-slate-400">Not yet processed by derivation.</p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <footer className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-500">
          Punch events are an append-only record. They are never edited or deleted, including by this
          screen{attendanceId ? "" : ""}.
        </footer>
      </section>
    </div>
  );
}
