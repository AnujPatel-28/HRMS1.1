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
  department: "sales" | "dev" | "marketing" | "operations" | "design" | "other" | null;
  designation: string | null;
  employee_code: string | null;
  date_of_joining: string | null;
  employment_type: "full_time" | "part_time" | "contract" | "intern" | null;
  status: "active" | "inactive" | "terminated";
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
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  due_time: string | null;
  attendance_lock_date?: string | null;
  status: "assigned" | "in_progress" | "submitted" | "approved" | "rejected" | "overdue";
  created_at: string;
  updated_at: string;
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
