export type EmployeeRole = "hr" | "employee" | "superadmin";

export interface Employee {
  id: string;
  tenant_id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  employee_code: string | null;
  date_of_joining: string | null;
  employment_type: string | null;
  status: "active" | "inactive" | "terminated" | "draft" | "pending_hr_review" | "pending_onboarding";
  aadhaar_number: string | null;
  pan_number: string | null;
  bank_name: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  profile_photo_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  work_mode?: "office" | "remote" | "hybrid";
  manager_id?: string | null;
  grade?: string | null;
  blood_group?: string | null;
  work_location?: string | null;
  linkedin_url?: string | null;
  employee_bio?: string | null;
  manager_name?: string | null;
  role?: EmployeeRole | null;
  probation_end_date?: string | null;
  employment_confirmed_at?: string | null;
  probation_status?: "on_probation" | "confirmed" | "extended" | "not_applicable" | null;
  secondary_manager_id?: string | null;
  org_unit_id?: string | null;
  job_title_id?: string | null;
  location_id?: string | null;
  employment_type_id?: string | null;
  grade_id?: string | null;
}

/** Pay/seniority band. `employees.grade` (text) is the legacy form and is dropped once tenants populate these. */
export interface EmployeeGrade {
  id: string;
  tenant_id: string;
  name: string;
  level: number;
  default_notice_days: number | null;
  default_probation_months: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Effective-dated org-unit membership. `employees.org_unit_id` is a denormalised pointer to the row
 * with `effective_to IS NULL`, maintained by the `employee_unit_assignment_sync` trigger — never
 * written from the client.
 */
export interface EmployeeUnitAssignment {
  id: string;
  tenant_id: string;
  employee_id: string;
  org_unit_id: string;
  effective_from: string;
  /** NULL = the current assignment. */
  effective_to: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface OrgUnit {
  id: string;
  tenant_id: string;
  parent_id: string | null;
  name: string;
  unit_type: "company" | "business_unit" | "division" | "department" | "team" | "sub_team" | "project" | "other";
  code: string | null;
  description?: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  // Slice A (06-organisation-management.md §3.2). `type_id` is the tenant-named type that supersedes
  // the `unit_type` text; `path` is materialised ancestry maintained by a DB trigger — never written
  // from the client.
  type_id?: string | null;
  head_employee_id?: string | null;
  path?: string | null;
}

export interface OrgUnitType {
  id: string;
  tenant_id: string;
  name: string;
  structural_role: "division" | "department" | "team";
  level_order: number;
  is_active: boolean;
  created_at: string;
}

export interface JobTitle {
  id: string;
  tenant_id: string;
  title: string;
  code: string | null;
  grade: string | null;
  level: string | null;
  description?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkLocation {
  id: string;
  tenant_id: string;
  name: string;
  code?: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  timezone?: string | null;
  is_remote?: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmploymentTypeOption {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExitRequest {
  id: string;
  tenant_id: string;
  employee_id: string;
  exit_type: "resignation" | "termination" | "retirement" | "contract_end" | "absconding";
  initiated_by: string;
  initiated_by_role: "employee" | "hr";
  last_working_date: string | null;
  notice_period_days: number | null;
  reason: string | null;
  hr_notes: string | null;
  // Note: "clearance_pending" means "All clearances are approved/completed, final HR completion is pending".
  status: "pending_approval" | "notice_period" | "clearance_pending" | "completed" | "withdrawn" | "rejected";
  clearance_assets: boolean;
  clearance_it: boolean;
  clearance_finance: boolean;
  clearance_hr: boolean;
  clearance_admin: boolean;
  exit_interview_done: boolean;
  exit_feedback: string | null;
  created_at: string;
  updated_at: string;
  employee?: {
    full_name: string;
    job_title_id: string | null;
    org_unit_id: string | null;
    profile_photo_url: string | null;
  };
  clearances?: ExitClearance[];
  exit_interview_data?: ExitInterviewData;
  exit_interview_completed_at?: string | null;
  exit_interview_completed_by?: string | null;
}

export interface ExitClearance {
  id: string;
  tenant_id: string;
  exit_request_id: string;
  template_id: string | null;
  department: string;
  label: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  approved_by: string | null;
  approved_at: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
  /** Snapshot of whether this clearance was required at the time of seeding. Defaults true. */
  is_required?: boolean;
}

export interface ExitInterviewData {
  primary_reason?: "career_growth" | "compensation" | "manager" | "relocation" | "personal" | "performance" | "culture" | "other";
  reason_notes?: string;
  manager_feedback?: string;
  work_environment_rating?: number;
  compensation_rating?: number;
  growth_rating?: number;
  rehire_eligible?: boolean;
  risk_level?: "low" | "medium" | "high";
  knowledge_transfer_done?: boolean;
  company_property_notes?: string;
  hr_action_items?: string[];
  completed_by_name?: string;
  completed_at?: string;
  /** Populated when migrated from legacy exit_feedback text */
  legacy_feedback?: string;
  migration_source?: string;
}

export interface OnboardingSelfProgress {
  id: string;
  tenant_id: string;
  employee_id: string;
  personal_details_completed: boolean;
  bank_details_completed: boolean;
  documents_completed: boolean;
  emergency_contact_completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attendance {
  id: string;
  tenant_id: string;
  employee_id: string;
  date: string;
  punch_in: string | null;
  punch_out: string | null;
  punch_out_allowed: boolean;
  punch_in_ip: string | null;
  punch_out_ip: string | null;
  work_hours: number | null;
  status: "present" | "absent" | "half_day" | "on_leave";
  session_status: "open" | "closed";
  notes: string | null;
  created_at: string;
  total_break_minutes: number;
  current_break_id: string | null;
  current_break_start: string | null;
  location_accuracy?: number | null;
  location_confidence?: "high" | "medium" | "low" | "very_low" | null;
  location_status?: "office_verified" | "remote_approved" | "outside_geofence" | "gps_low_confidence" | "gps_denied" | "gps_unavailable" | "manual_override" | "selfie_missing" | null;
  remote_exception_id?: string | null;
  verification_snapshot?: Record<string, any> | null;
}

export interface AttendanceLocationException {
  id: string;
  tenant_id: string;
  employee_id: string;
  exception_type: "work_from_home" | "client_visit" | "business_travel" | "field_work" | "other";
  start_date: string;
  end_date: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceSelfie {
  id: string;
  attendance_id: string;
  tenant_id: string;
  employee_id: string;
  type: "punch_in" | "punch_out";
  storage_path: string;
  captured_at: string;
  created_at: string;
}

export interface Shift {
  id?: string;
  tenant_id?: string;
  name: string;
  start_time: string;
  end_time: string;
  working_days: number[];
  half_day_cutoff_override: string | null;
  punch_in_opens_minutes_before: number;
  late_mark_grace_override: number | null;
  is_default?: boolean;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface EmployeeShift {
  id: string;
  tenant_id: string;
  employee_id: string;
  shift_id: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

export interface Leave {
  id: string;
  tenant_id: string;
  employee_id: string;
  leave_type_id?: string;
  leave_type: "casual" | "sick" | "earned" | "unpaid" | "maternity" | "paternity" | "other" | null;
  start_date: string;
  end_date: string;
  total_days: number | null;
  approved_business_days?: number | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  applied_at: string;
}

export interface Holiday {
  id: string;
  tenant_id: string;
  name: string;
  date: string;
  type: "national" | "company" | "optional" | null;
  description: string | null;
  created_at: string;
}

export interface HRPolicy {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  file_url: string;
  file_name: string | null;
  uploaded_by: string | null;
  visible_to: "all" | "hr_only" | "department-specific";
  department_filter: string | null;
  org_unit_id?: string | null;
  org_unit_name?: string | null;
  storage_path?: string | null;
  version_number: number;
  effective_date?: string | null;
  expires_at?: string | null;
  requires_acknowledgement: boolean;
  supersedes_policy_id?: string | null;
  acknowledged_count?: number;
  total_targeted?: number;
  created_at: string;
  updated_at: string;
}

export interface EmployeeVisibleHRPolicy {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  file_name: string | null;
  file_url: string;
  visible_to: "all" | "department-specific";
  department_filter: string | null;
  org_unit_id?: string | null;
  org_unit_name?: string | null;
  storage_path?: string | null;
  version_number: number;
  effective_date?: string | null;
  expires_at?: string | null;
  requires_acknowledgement: boolean;
  supersedes_policy_id?: string | null;
  acknowledged_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  assigned_by: string;
  department_filter: string | null;
  // Slice B target column (20260820160000). department_filter is kept alongside it for
  // display; org_unit_id is the stable target the assign flow filters on.
  org_unit_id?: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  due_time: string | null;
  attendance_lock_date?: string | null;
  status: "assigned" | "in_progress" | "submitted" | "approved" | "rejected" | "overdue";
  created_at: string;
  updated_at: string;
  project_id?: string | null;
}

export interface TaskSubmission {
  id: string;
  tenant_id: string;
  task_id: string;
  employee_id: string;
  notes: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  status: "pending" | "approved" | "rejected";
}

export interface CalendarEvent {
  id: string;
  tenant_id: string;
  employee_id: string;
  date: string;
  type: "green" | "red" | "absent" | "leave" | "holiday" | null;
  task_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface ChatChannel {
  id: string;
  name: string;
  description: string | null;
  type: "global" | "department" | "custom";
  target_departments: string[];
  // Slice B target-side column (doc/architecture/06-organisation-management.md §5 step 3). Nullable —
  // the column has no default, and is only populated by department-type channels created after this
  // write path shipped. Slice B is APPLIED — target_org_unit_ids is what every chat policy reads;
  // target_departments survives only for the legacy client-side display fallback.
  target_org_unit_ids?: string[] | null;
  created_by: string | null;
  created_at: string;
  is_announcement: boolean;
}

export interface ChatMessage {
  id: string;
  tenant_id: string;
  sender_id: string;
  channel: string;
  channel_id: string | null;
  content: string;
  attachment_url: string | null;
  attachment_name: string | null;
  is_deleted: boolean;
  created_at: string;
  client_message_id?: string;
  delivery_status?: 'sending' | 'sent' | 'failed';
  upload_status?: 'none' | 'uploading' | 'success' | 'failed';
}

export interface Notification {
  id: string;
  tenant_id: string;
  employee_id: string;
  title: string;
  body: string;
  type:
    | "task_assigned"
    | "task_approved"
    | "task_rejected"
    | "leave_approved"
    | "leave_rejected"
    | "punch_unlock"
    | "new_policy"
    | "general"
    | null;
  reference_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: "planning" | "active" | "on_hold" | "completed" | "cancelled";
  manager_id: string | null;
  start_date: string | null;
  end_date: string | null;
  visibility_config: {
    type: "all" | "departments" | "people";
    departments?: string[];
    // Slice B target-side key (doc/architecture/06-organisation-management.md §5 step 3), written
    // alongside `departments` — Slice B is APPLIED, so RLS reads `org_unit_ids` only.
    org_unit_ids?: string[];
    employee_ids?: string[];
  };
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  tenant_id: string;
  employee_id: string;
  title: string;
  amount: number;
  currency: string;
  category: "travel" | "food" | "accommodation" | "equipment" | "medical" | "other";
  expense_date: string;
  description: string | null;
  receipt_url: string | null;
  receipt_name: string | null;
  status: "pending" | "approved" | "rejected" | "reimbursed";
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  payroll_run_id: string | null;
  reimbursed_at: string | null;
  created_at: string;
}
