import { formatLocalDate } from "./date";

/**
 * Iterates through a date range and identifies actual working dates
 * by skipping weekends (based on shift) and tenant holidays.
 *
 * @param startDateStr - "YYYY-MM-DD" start date
 * @param endDateStr - "YYYY-MM-DD" end date
 * @param workingDays - Array of day indices (0=Sun, 1=Mon, ..., 6=Sat). E.g., [1,2,3,4,5] for Mon-Fri.
 * @param holidays - Array of holiday dates ["YYYY-MM-DD", ...]
 * @returns Object containing the total business days and the exact working dates.
 */
export function calculateBusinessDays(
  startDateStr: string,
  endDateStr: string,
  workingDays: number[],
  holidays: string[]
): { total_days: number; working_dates: string[] } {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  // Validate dates
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return { total_days: 0, working_dates: [] };
  }

  const workingDates: string[] = [];
  let currentDate = new Date(start);

  const holidaySet = new Set(holidays);

  while (currentDate <= end) {
    // getDay() returns 0 for Sunday, 1 for Monday, etc.
    const dayOfWeek = currentDate.getDay();
    const currentDateStr = formatLocalDate(currentDate);

    // Check if it's a scheduled working day AND not a holiday
    if (workingDays.includes(dayOfWeek) && !holidaySet.has(currentDateStr)) {
      workingDates.push(currentDateStr);
    }

    // Advance by 1 day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return {
    total_days: workingDates.length,
    working_dates: workingDates,
  };
}
