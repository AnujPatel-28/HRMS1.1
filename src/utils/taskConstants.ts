/**
 * Task workflow constants — single source of truth for all task status groupings.
 *
 * Used across:
 *  - PunchInOut.tsx   (punch-out gate enforcement, DB query, UI lock state)
 *  - TaskManagement.tsx (HR dashboard filters, active tab query, submission fetch)
 *  - Any future analytics, reporting, or cron payloads
 *
 * The matching list on the database side lives in:
 *  - insforge-task-policy-hardening.sql  (`punch_out_attendance` and `fn_auto_redmark_tasks`)
 *
 * If you add a new task status, update BOTH this file and the SQL function.
 */

import type { Task } from "../types";

/**
 * Statuses that represent an unresolved task — i.e. the employee has not yet
 * received HR approval.  Used to gate punch-out and display lock warnings.
 */
export const BLOCKING_TASK_STATUSES = [
  "assigned",
  "submitted",
  "rejected",
  "overdue",
] as const satisfies ReadonlyArray<Task["status"]>;

export type BlockingTaskStatus = (typeof BLOCKING_TASK_STATUSES)[number];

/** Returns true if a task status is considered unresolved / blocking. */
export function isBlockingStatus(status: Task["status"]): status is BlockingTaskStatus {
  return (BLOCKING_TASK_STATUSES as ReadonlyArray<string>).includes(status);
}

/**
 * All possible task statuses in their natural workflow order.
 * Used for filter dropdowns and badge rendering.
 */
export const ALL_TASK_STATUSES = [
  "assigned",
  "in_progress",
  "submitted",
  "approved",
  "rejected",
  "overdue",
] as const satisfies ReadonlyArray<Task["status"]>;

/**
 * Statuses for which a task_submission record may exist.
 * Used to decide which task IDs to batch-fetch submissions for.
 */
export const SUBMITTED_TASK_STATUSES = [
  "submitted",
  "approved",
  "rejected",
  "overdue",
] as const satisfies ReadonlyArray<Task["status"]>;

/**
 * Punch-out structured error codes returned by the `punch_out_attendance` RPC.
 * Must stay in sync with ERRCODE values in insforge-task-policy-hardening.sql.
 */
export const PUNCH_OUT_ERROR_MESSAGES: Record<string, string> = {
  P0001: "Your session appears corrupted. Please contact HR.",
  P0002: "This attendance period is locked for payroll processing.",
  P0003: "You have pending task approvals. Ask HR to approve your tasks before punching out.",
  P0004: "Attendance data is in an invalid state. HR has been notified.",
};
