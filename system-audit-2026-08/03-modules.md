# 03 — Modules & how they are wired

For each module: the UI entry, the call path (component → hook → `db`/`db.rpc`/`functions.invoke` → table), and the enforcement point.

## Call-path legend
- **Direct RLS CRUD**: `db.from("table")...` — access controlled by table RLS policies.
- **RPC**: `db.rpc("fn", args)` — `SECURITY DEFINER` function centralizes the invariant.
- **Edge fn**: `functions.invoke("slug")` — Deno function for async/side-effects.

---

## Attendance / Time
- **UI:** `employee/PunchInOut.tsx` (1561 lines), `hr/Attendance.tsx`, `hr/ShiftManagement.tsx`; hook `hooks/useAttendance.ts`, `hooks/useEmployeeShift.ts`; utils `utils/attendance.ts`, `utils/geolocation.ts` (Leaflet map + haversine geo-fence).
- **Path:** punch-in → direct insert into `attendance` (policy `attendance_self_write` CHECK employee owns row). Punch-out → **RPC** `punch_out_attendance`. Breaks → RPC `start_employee_break` / `end_employee_break`. Selfies → `attendance_selfies` (self-insert policy joins attendance→employee). Corrections → `attendance_corrections` + HR RPCs `hr_approve_attendance_correction` / `hr_reject_attendance_correction`. Overtime → `overtime_records` + `hr_set_overtime_status`. Shifts → `hr_save_shift` / `hr_schedule_shift_change` / `hr_deactivate_shift`. Remote/location exceptions → `hr_create_remote_exception`, auto-expiry `expire_location_exceptions`.
- **Tables:** `attendance`, `attendance_breaks`, `attendance_selfies`, `attendance_corrections`, `attendance_location_exceptions`, `overtime_records`, `shifts`, `employee_shifts`.
- **Enforcement:** RLS self/HR + restrictive tenant isolation. ⚠️ **Weak spots:** `punch_out_attendance` trusts client `p_work_hours` and lacks an owner check (S5); `attendance_audit_logs` has RLS off (S3). Geo-fence is computed client-side and stored as `punch_*_location_status` — it's advisory, not enforced server-side (an attacker calling the API directly can send any coordinates/status).

## Leave
- **UI:** `employee/MyLeaves.tsx`, `hr/LeaveManagement.tsx`, `hr/PolicyCenter.tsx`; hook `hooks/useLeaves.ts`; util `utils/leave.ts`.
- **Path:** apply → RPC `employee_apply_leave_request`; cancel → `employee_cancel_pending_leave` / `cancel_leave_request`; approve → `approve_leave_request`; balances init → `initialize_leave_balances_transaction`; accrual cron `fn_accrue_monthly_leaves`.
- **Tables:** `leaves`, `leave_types`, `leave_balances`, `holidays`, writes `attendance` on approval.
- **Enforcement:** 🟢 Best-in-codebase. Transactional, row-locked, balance-safe, overlap-checked, notice/tenure-validated. Reads per-tenant config from `tenant_settings` — which is RLS-off (S3), so that config is cross-tenant tamperable (indirect risk to the leave engine's inputs).

## Tasks & Projects (PMS)
- **UI:** `hr/TaskManagement.tsx`, `employee/MyTasks.tsx`, `hr/pms/ProjectList.tsx` + `ProjectDetail.tsx`, `employee/pms/EmployeeProjectView.tsx`; hook `hooks/useTasks.ts`.
- **Path:** task submit → RPC `submit_task_request`; approve/reject → `approve_task_request` / `reject_task_request`; auto-redmark overdue → `fn_auto_redmark_tasks`; edge notifications `on-task-assigned/approved/rejected`.
- **Tables:** `tasks`, `task_submissions`, `projects`.
- **Enforcement:** RLS `*_hr_all` + self (`assigned_to` = my employee id). `projects` has a rich visibility model (`visibility_config` JSON: all/departments/people/manager/assigned-task) evaluated in the SELECT policy. 🟢 Solid. Note `approve_task_request` has **no fixed search_path** (S6).

## Payroll
- **UI:** `payroll/hr/SalaryStructures.tsx`, `SalaryForm.tsx`, `RunPayroll.tsx` (793 lines), `Payslips.tsx`, `payroll/employee/MyPayslips.tsx`, `TaxDeclarationHR.tsx`; logic `payroll/hr/payroll-calc.ts`, `payslip-pdf.ts`.
- **Path:** salary CRUD → `salary_structures` (HR-only RLS). Payroll run computed **in the browser** (`calcPayslip` in `payroll-calc.ts`), then inserted into `payslips` (policy `payslips_hr_insert` = `is_hr()`). Employee reads own via `employee_own_payslips` (JWT role + own employee_id). IT declarations → `it_declarations` + `it_declaration_windows`.
- **Tables:** `salary_structures`, `payroll_runs`, `payslips`, `it_declarations`, `it_declaration_windows`.
- **Enforcement:** RLS correctly limits payslip **writes to HR** and **reads to owner/HR**. 🟠 **Design concern:** all payroll math (proration, PF/ESI/TDS, LOP, `netOverride`) runs client-side with no server recomputation or validation. Since only HR can write payslips this isn't a privilege-escalation for employees, but it means the payslip figures are only as trustworthy as the HR client — there's no server-side audit that stored amounts match the salary structure + attendance. For a payroll system that carries legal/tax weight, the calc (or at least a verification pass) belongs in an RPC.

## Employee lifecycle (onboarding / offboarding)
- **UI:** `hr/EmployeeCreate.tsx`, `EmployeeDetail.tsx`, `employee/OnboardingWizard.tsx`, `hr/OffboardingManagement.tsx`, `hr/components/InitiateExitModal.tsx`, `employee/MyExit.tsx`.
- **Path:** create → `create_draft_employee` / `create_employee_transaction`; activate → `hr_activate_draft_employee`; resume onboarding → `check_onboarding_resumable`; set password → edge `set-employee-password` / RPC `set_employee_password_by_hr` (guarded ✅); exit → `exit_requests` + `complete_exit_transaction` + `update_exit_clearance_transaction` + `update_exit_interview_transaction`; cleanup `fn_cleanup_expired_onboarding`.
- **Tables:** `employees`, `employee_onboarding`, `employee_onboarding_self`, `exit_requests`, `exit_clearances` ⚠️(RLS off — S3), `exit_clearance_templates` ⚠️(RLS off — S3).
- **Enforcement:** Employee-creation and status guards are good; but **clearance data lives in RLS-off tables** — cross-tenant readable/writable. That undermines the offboarding module's integrity.

## Chat (realtime)
- **UI:** `shared/Chat.tsx`, `hr/Chat.tsx`, `employee/Chat.tsx`; hook `hooks/useChat.ts`.
- **Path:** direct CRUD on `chat_channels` / `chat_channel_members` / `chat_messages`; delete channel → RPC `delete_chat_channel`; realtime via `notify_chat_message` / `notify_chat_channel` triggers; `protect_chat_message_integrity` trigger.
- **Enforcement:** 🟢 The most elaborate RLS in the system — insert/select policies verify sender ownership **and** channel membership (global/department/custom), announcements are write-protected, soft-delete respected. Well done.

## Expenses / Insurance / Policies / Org / Notifications
- **Expenses:** `expenses` — self insert/delete(pending)/read, HR select/update. 🟢 clean. Receipts in **public** `expense-receipts` bucket ⚠️(S4).
- **Insurance:** `insurance_policies` — HR manage, self read; expiry cron `fn_check_insurance_expiries`; edge `insurance-expiry-check`. Docs in **private** `insurance-documents` bucket ✅.
- **Policy Center:** `hr_policies` + RPCs `get_hr_policy_library`, `get_employee_visible_hr_policies`, `acknowledge_policy_transaction`, `create_policy_notifications_transaction`. Department-scoped visibility in RLS. 🟢. Files in **public** `hr-policies` bucket ⚠️.
- **Org structure:** `employee_reporting_relationships` (RLS on), but `org_units`/`job_titles`/`locations`/`employment_types` are **RLS off** (S3); cycle prevention in `utils/managerCycleValidation.ts` is **client-side only** — no DB constraint prevents a reporting cycle if written via API.
- **Notifications:** `notifications` — self + HR, realtime trigger `notify_employee_notification`. 🟢.

## Super-admin / platform
- **UI:** `admin/*`. Tables `platform_admins`, `platform_audit_logs`, `platform_settings`, `admin_users`, `tenants`, `profiles`. `is_superadmin()` / `get_my_platform_role()` gate. Tenant lifecycle (suspend/cancel) enforced via `tenant_is_active()` in RLS + client guards. 🟢.
