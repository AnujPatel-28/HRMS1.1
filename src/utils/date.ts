/**
 * ─────────────────────────────────────────────────────────────────────────────
 * BUSINESS DATE UTILITIES — src/utils/date.ts
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE
 * -------
 * All business-calendar date strings (attendance, leave, payroll, shift) MUST be
 * derived from the browser's local wall-clock time, NOT from UTC.
 *
 * WHY THIS MATTERS
 * ----------------
 * JavaScript's `Date.toISOString()` always returns UTC time in ISO format.
 * For users in UTC+ timezones (e.g. IST = UTC+5:30), calling
 *   new Date().toISOString().slice(0, 10)
 * at 00:00–05:29 local time will return **yesterday's date** in UTC, causing
 * attendance records, leave boundaries, payroll ranges, and shift assignments
 * to land on the wrong calendar date.
 *
 * RULES
 * -----
 *  ✅  Use `formatLocalDate(date)` anywhere you need a YYYY-MM-DD string for:
 *        - Attendance date (punch-in / punch-out / corrections)
 *        - Leave start/end dates and boundary filters
 *        - Payroll month start/end calculations
 *        - Shift effective_from / effective_to
 *        - Any database query with a `.eq("date", ...)` or `.gte/.lte("date", ...)`
 *
 *  ❌  Never use `toISOString().slice(0, 10)` for business-calendar logic.
 *      `toISOString()` is only appropriate for:
 *        - UTC audit log timestamps  (e.g. `created_at`, `reviewed_at`, `punch_in`)
 *        - Server-side operational logging
 *        - System events where UTC is the intended timezone
 *
 * FUTURE DIRECTION
 * ----------------
 * When tenant-configured timezone support is added, these functions should
 * accept an optional `tenantTimezone` string and use the Intl.DateTimeFormat
 * API to derive the correct local date for each tenant.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Formats a Date to a YYYY-MM-DD string using the browser's LOCAL timezone.
 *
 * Correctly handles month/year boundaries:
 *   - April 30 → May 1   (month rollover)
 *   - December 31 → January 1  (year rollover)
 *   - Midnight transitions in any UTC+ timezone
 *
 * @example
 *   // At 00:15 IST on May 1 (= 18:45 UTC April 30):
 *   formatLocalDate(new Date())  // → "2026-05-01"  ✅
 *   new Date().toISOString().slice(0, 10)  // → "2026-04-30"  ❌ wrong
 */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns the local-timezone first or last day of a given month as YYYY-MM-DD.
 *
 * Uses the JavaScript Date constructor which correctly handles:
 *   - Month overflow: new Date(2026, 11, 1) → December 1, 2026
 *   - new Date(year, month+1, 0).getDate() gives last day of month — handles
 *     leap years (Feb 29) and 30/31 day months automatically.
 *
 * @param year   Full 4-digit year (e.g. 2026)
 * @param month  0-indexed month (0 = January, 11 = December)
 * @param bound  "start" → first day, "end" → last day
 *
 * @example
 *   formatLocalMonthBoundary(2026, 3, "end")    // → "2026-04-30"
 *   formatLocalMonthBoundary(2026, 11, "end")   // → "2026-12-31"
 *   formatLocalMonthBoundary(2024, 1, "end")    // → "2024-02-29" (leap year)
 */
export function formatLocalMonthBoundary(year: number, month: number, bound: "start" | "end"): string {
  if (bound === "start") {
    return formatLocalDate(new Date(year, month, 1));
  } else {
    // Day 0 of the next month = last day of the current month
    return formatLocalDate(new Date(year, month + 1, 0));
  }
}

/**
 * Safely parses a YYYY-MM-DD business date string into a local Date object.
 * 
 * Prevents timezone-shift bugs that occur when using `new Date("YYYY-MM-DD")`,
 * which strictly evaluates to UTC midnight and can shift to the previous
 * day in negative timezone offsets (like the Americas).
 *
 * @example
 *   parseLocalDate("2026-05-01") // → Local Date object at 00:00:00 on May 1st
 */
export function parseLocalDate(dateString: string): Date {
  if (!dateString) return new Date();
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Returns the current date in the given IANA timezone.
 */
export function getTenantNow(timezone: string = "UTC"): Date {
  // A robust way to get current time in a specific timezone as a Date object representing that local time
  const str = new Date().toLocaleString("en-US", { timeZone: timezone });
  return new Date(str);
}

/**
 * Returns a YYYY-MM-DD string for the current date in the tenant timezone.
 */
export function getTenantDate(timezone: string = "UTC"): string {
  const date = getTenantNow(timezone);
  return formatLocalDate(date);
}

/**
 * Returns the 4-digit year for the current date in the tenant timezone.
 */
export function getTenantYear(timezone: string = "UTC"): number {
  return getTenantNow(timezone).getFullYear();
}
