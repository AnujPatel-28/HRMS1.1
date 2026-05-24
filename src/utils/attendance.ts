/**
 * Normalizes punch in and out times strings into full Date objects,
 * accounting for night shifts that cross midnight.
 *
 * @param date The attendance date (YYYY-MM-DD)
 * @param punchIn The punch in time (HH:MM)
 * @param punchOut The punch out time (HH:MM)
 * @returns Object with Date objects for in and out, and a boolean indicating if it's a night shift
 */
export function normalizeShiftTimes(date: string, punchIn: string, punchOut: string) {
  const inDate = new Date(`${date}T${punchIn}:00`);
  const outDate = new Date(`${date}T${punchOut}:00`);
  let isNightShift = false;

  // If punch out is chronologically earlier in the day than punch in, it must be the next day
  if (outDate.getTime() < inDate.getTime()) {
    outDate.setDate(outDate.getDate() + 1);
    isNightShift = true;
  }

  return { inDate, outDate, isNightShift };
}

/**
 * Calculates work hours from punch in/out times, handling night shifts and validating maximum duration.
 * 
 * @param punchIn Punch in time (HH:MM)
 * @param punchOut Punch out time (HH:MM)
 * @param lunchMinutes Minutes to deduct for lunch
 * @returns Work hours (null if invalid or missing) and error message if applicable
 */
export function calculateShiftDuration(punchIn: string | null, punchOut: string | null, lunchMinutes: number): { hours: number | null, error?: string } {
  if (!punchIn || !punchOut) return { hours: null };

  // Use a dummy date to evaluate the time difference
  const { inDate, outDate } = normalizeShiftTimes('1970-01-01', punchIn, punchOut);
  
  const rawHours = (outDate.getTime() - inDate.getTime()) / (1000 * 60 * 60);
  
  if (rawHours > 18) {
    return { hours: null, error: 'Shift duration exceeds maximum limit of 18 hours.' };
  }

  const netHours = Math.max(0, rawHours - (lunchMinutes / 60));
  return { hours: parseFloat(netHours.toFixed(2)) };
}

/**
 * Calculates if an employee is late, properly handling night shifts that cross midnight.
 * 
 * @param attendanceDate The date of the shift (YYYY-MM-DD)
 * @param shiftStart The expected start time (HH:MM)
 * @param actualPunchIn The actual punch in time (HH:MM)
 * @param graceMinutes Allowed grace period in minutes
 */
export function calculateLateness(attendanceDate: string, shiftStart: string, actualPunchIn: string, graceMinutes: number): boolean {
  const expectedStart = new Date(`${attendanceDate}T${shiftStart}:00`);
  const actualIn = new Date(`${attendanceDate}T${actualPunchIn}:00`);

  // If the actual punch in is very early in the day (e.g. 00:15) but the shift 
  // started late the previous day (e.g. 23:00), actualIn could erroneously appear 
  // to be BEFORE expectedStart by ~23 hours.
  // We assume if actualIn is > 12 hours before expectedStart, it's actually the next day.
  if (actualIn.getTime() < expectedStart.getTime() - 12 * 60 * 60 * 1000) {
    actualIn.setDate(actualIn.getDate() + 1);
  }
  
  const lateThresholdMs = expectedStart.getTime() + (graceMinutes * 60000);
  return actualIn.getTime() > lateThresholdMs;
}

/**
 * Converts a date and time into a full ISO string timestamp, 
 * optionally advancing to the next day if the punch out crossed midnight.
 */
export function toAttendanceTimestamp(date: string, time: string | null, isNextDay = false): string | null {
  if (!time) return null;
  const d = new Date(`${date}T${time}:00`);
  if (isNextDay) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString();
}
