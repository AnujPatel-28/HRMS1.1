/**
 * B8 phase 3 -- ZKTeco / eSSL ADMS ("push SDK") adapter.
 *
 * This is a WIRE-FORMAT TRANSLATOR AND NOTHING ELSE. It parses the device's plain-text protocol
 * and calls device_ingest_punch, the same seam the kiosk uses. No attendance logic lives here:
 * direction inference, idempotency, source policy, lockout, tenant resolution and the append-only
 * write all happen in the seam. If you find yourself adding an attendance rule to this file, it
 * belongs in the seam instead -- that is the whole point of the adapter boundary.
 *
 * The device speaks HTTP with query-string identity and a tab-separated body:
 *   GET  /adms-cdata?SN=<serial>&options=all      -> handshake; expects a plain-text config block
 *   POST /adms-cdata?SN=<serial>&table=ATTLOG     -> attendance rows, TSV, one punch per line
 *   GET  /adms-cdata?SN=<serial>&type=getrequest  -> command poll; we have no commands, reply OK
 * Responses MUST be plain text. A JSON body makes the device treat the exchange as failed and
 * retry the same logs forever.
 *
 * AUTHENTICATION. An ADMS unit sends its serial and no credential -- most firmware exposes only
 * host and port, so there is often nowhere to put a secret. Two supported modes, both handled by
 * the seam, not here:
 *   - preferred: the tenant configures a path/query secret, passed through as `secret` below;
 *   - fallback: the device row has allow_serial_only = true, an explicit per-device opt-in that
 *     stamps auth_mode='serial_only' onto every event it produces.
 * This function never decides which applies. It forwards what it received and lets the seam rule.
 *
 * Required function secrets (same as every other function here):
 *   INSFORGE_BASE_URL, INSFORGE_ADMIN_KEY (falls back to the reserved API_KEY).
 */

import { createClient } from "npm:@insforge/sdk";

const BASE_URL = Deno.env.get("INSFORGE_BASE_URL");
const ADMIN_KEY = Deno.env.get("INSFORGE_ADMIN_KEY") || Deno.env.get("API_KEY");

/** Plain text, always. See the note above on why JSON breaks the device. */
function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * The handshake reply. These are the device's polling parameters, not ours to invent -- the
 * values below are the conventional defaults: report continuously, push in real time, no
 * encryption (we rely on HTTPS), and transmit attendance + operation logs.
 */
function handshake(serial: string) {
  return [
    `GET OPTION FROM: ${serial}`,
    "Stamp=9999",
    "OpStamp=0",
    "ErrorDelay=30",
    "Delay=10",
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    "TransFlag=1111000000",
    "Realtime=1",
    "Encrypt=0",
  ].join("\n");
}

/**
 * ATTLOG row: PIN <tab> YYYY-MM-DD HH:MM:SS <tab> status <tab> verify <tab> workcode <tab> ...
 * Some firmware pads with spaces rather than tabs, so split on any whitespace run.
 */
function parseAttlogLine(line: string) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const pin = parts[0];
  // Date and time arrive as two whitespace-separated tokens.
  const stamp = `${parts[1]} ${parts[2]}`;
  const status = parts.length > 3 ? parts[3] : "";
  if (!pin || !/^\d{4}-\d{2}-\d{2}$/.test(parts[1]) || !/^\d{2}:\d{2}:\d{2}$/.test(parts[2])) {
    return null;
  }
  return { pin, stamp, status };
}

/**
 * Direction from the device's status byte.
 *
 * 1 means check-out and is trustworthy: no device emits 1 as a default. 0 nominally means
 * check-in, but many cheap units emit 0 for EVERY punch regardless of direction -- trusting it
 * would make every event an "in" and no employee would ever punch out. So 0 (and every other
 * value) returns null, which asks the seam to infer direction from whether an open session
 * exists. Inference is correct for both well-behaved and lazy hardware; trusting 0 is correct
 * only for well-behaved hardware and silently breaks the rest.
 */
function directionFromStatus(status: string): "in" | "out" | null {
  return status === "1" ? "out" : null;
}

export default async function (request: Request) {
  if (!BASE_URL || !ADMIN_KEY) return text("ERROR: server not configured", 500);

  const url = new URL(request.url);
  const serial = (url.searchParams.get("SN") || "").trim();
  // Optional shared secret, for firmware that can carry one in the path or query string.
  const secret = (url.searchParams.get("secret") || url.searchParams.get("key") || "").trim();

  if (!serial) return text("ERROR: missing SN", 400);

  // Command poll. We issue no device commands, so the answer is always OK.
  if (url.searchParams.get("type") === "getrequest" || url.pathname.endsWith("/getrequest")) {
    return text("OK");
  }

  if (request.method === "GET") return text(handshake(serial));

  if (request.method !== "POST") return text("OK");

  const table = (url.searchParams.get("table") || "").toUpperCase();
  const body = await request.text();

  // OPERLOG and friends are device housekeeping, not attendance. Acknowledge so the device stops
  // resending, and ignore -- silently dropping an unknown table with an error would make the unit
  // retry it forever.
  if (table && table !== "ATTLOG") return text("OK: 0");

  const client = createClient({ baseUrl: BASE_URL, anonKey: ADMIN_KEY });

  // The device sends LOCAL wall-clock time with no offset. Resolving it needs the tenant's
  // timezone, which is reachable from the device row. This is genuinely adapter work: decoding
  // what the wire format meant. The seam still owns everything after that.
  let tz = "UTC";
  try {
    const { data } = await client.database
      .from("attendance_devices")
      .select("tenant_id, tenants(timezone)")
      .eq("serial", serial)
      .maybeSingle();
    const t = (data as Record<string, unknown> | null)?.tenants as { timezone?: string } | undefined;
    if (t?.timezone) tz = t.timezone;
  } catch (err) {
    console.error("[adms-cdata] timezone lookup failed, defaulting to UTC:", err);
  }

  const lines = body.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let accepted = 0;

  for (const line of lines) {
    const row = parseAttlogLine(line);
    if (!row) {
      console.warn("[adms-cdata] unparseable ATTLOG line:", line);
      continue;
    }

    // Local wall clock -> instant, using the tenant's zone. Recorded at its TRUE time, which is
    // what lets a unit that has been offline for days land its backlog on the right days (E15)
    // rather than collapsing onto the moment it reconnected.
    const occurredAt = zonedToInstant(row.stamp, tz);

    try {
      const { data, error } = await client.database.rpc("device_ingest_punch", {
        p_serial: serial,
        p_secret: secret || null,
        p_employee_ref: row.pin,
        p_pin: null,
        p_occurred_at: occurredAt,
        p_direction: directionFromStatus(row.status),
        // The raw line is the device's own record id for this punch. Keeping it makes a disputed
        // punch traceable back to what the hardware actually sent.
        p_source_ref: `${serial}:${row.stamp}`,
        p_evidence: { adms_status: row.status, adms_raw: line.trim() },
      });

      if (error) {
        console.error("[adms-cdata] ingest error:", error.message, "line:", line);
        continue;
      }
      if (data && data.success === false) {
        // Expected and non-fatal: an unenrolled PIN, a locked-out device, a shift that does not
        // accept device punches. Log and keep going -- one bad row must not fail the batch, or the
        // device resends the whole batch forever and no row ever lands.
        console.warn("[adms-cdata] rejected:", data.error, "pin:", row.pin);
        continue;
      }
      accepted += 1;
    } catch (err) {
      console.error("[adms-cdata] unexpected error on line:", line, err);
    }
  }

  // Always acknowledge. The device treats a non-OK reply as "resend everything", and the seam is
  // already idempotent, so acknowledging a partially-rejected batch is both safe and necessary.
  return text(`OK: ${accepted}`);
}

/**
 * "YYYY-MM-DD HH:MM:SS" in zone `tz` -> ISO instant.
 * Deno has no zoned-time constructor, so this measures the zone's offset at that moment via
 * Intl and subtracts it. Done in two passes because the offset itself depends on the instant --
 * one pass is wrong for the hour on either side of a DST transition.
 */
function zonedToInstant(local: string, tz: string): string {
  const naive = `${local.replace(" ", "T")}Z`;
  let guess = new Date(naive);
  for (let i = 0; i < 2; i++) {
    const offset = offsetMinutes(guess, tz);
    guess = new Date(Date.parse(naive) - offset * 60_000);
  }
  return guess.toISOString();
}

function offsetMinutes(at: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour === "24" ? "00" : p.hour), Number(p.minute), Number(p.second),
  );
  return (asUTC - at.getTime()) / 60_000;
}
