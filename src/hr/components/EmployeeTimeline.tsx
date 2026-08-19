import { useEffect, useState } from "react";
import { Calendar, User, ArrowRight, Activity, Loader2 } from "lucide-react";
import { db } from "../../insforge/client";

// Maps database column names → human-readable labels for the timeline UI.
// Any field not listed here falls back to title-casing the column name.
const FIELD_LABELS: Record<string, string> = {
  full_name: "Full Name",
  email: "Email",
  phone: "Phone Number",
  date_of_birth: "Date of Birth",
  gender: "Gender",
  address: "Address",
  city: "City",
  state: "State",
  pincode: "Pincode",
  department: "Department (legacy)",
  org_unit_id: "Department",
  designation: "Designation (legacy)",
  job_title_id: "Job Title",
  employee_code: "Employee Code",
  date_of_joining: "Date of Joining",
  employment_type: "Employment Type (legacy)",
  employment_type_id: "Employment Type",
  work_mode: "Work Mode",
  work_location: "Work Location (legacy)",
  location_id: "Work Location",
  grade: "Grade",
  manager_id: "Reporting Manager",
  secondary_manager_id: "Secondary Manager",
  role: "System Role",
  status: "Employment Status",
  aadhaar_number: "Aadhaar Number",
  pan_number: "PAN Number",
  bank_name: "Bank Name",
  account_number: "Bank Account Number",
  ifsc_code: "IFSC Code",
  emergency_contact_name: "Emergency Contact Name",
  emergency_contact_phone: "Emergency Contact Phone",
  emergency_contact_relation: "Emergency Contact Relation",
  profile_photo_url: "Profile Photo",
  probation_period: "Probation Period",
  probation_status: "Probation Status",
  probation_end_date: "Probation End Date",
  employment_confirmed_at: "Employment Confirmed At",
  employee_bio: "Bio",
};

function toFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface TimelineEvent {
  id: string;
  action: string;
  actor_role: string;
  details: {
    from?: string;
    to?: string;
    fields_changed?: string[];
    [key: string]: any;
  } | null;
  created_at: string;
}

interface EmployeeTimelineProps {
  employeeId: string;
  tenantId: string;
}

export default function EmployeeTimeline({ employeeId, tenantId }: EmployeeTimelineProps) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  const fetchTimeline = async () => {
    if (!employeeId || !tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await db
        .from("audit_logs")
        .select("id, action, actor_role, details, created_at")
        .eq("tenant_id", tenantId)
        .in("target_type", ["employee", "employees"])
        .eq("target_id", employeeId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      setEvents((data as TimelineEvent[]) || []);
    } catch (err) {
      console.error("Failed to load employee timeline", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTimeline();
  }, [employeeId, tenantId]);

  const getActionLabel = (action: string) => {
    switch (action) {
      case "employee.created":
        return "Profile Created";
      case "employee.activated":
        return "Onboarding Finalized & Activated";
      case "employee.manager_changed":
        return "Manager Transfer";
      case "employee.department_changed":
        return "Department / Org Unit Transfer";
      case "employee.status_changed":
        return "Employment Status Transition";
      case "employee.terminated":
        return "Employment Terminated";
      case "employee.updated":
        return "Profile Fields Updated";
      case "employee.avatar_updated":
        return "Profile Photo Updated";
      case "employee.document_viewed":
        return "Document Inspected";
      default:
        return action.replace("employee.", "").replace(/_/g, " ");
    }
  };

  const getActionColor = (action: string) => {
    if (action.includes("created")) return "bg-blue-100 text-blue-700 border-blue-200";
    if (action.includes("activated")) return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (action.includes("terminated")) return "bg-rose-100 text-rose-700 border-rose-200";
    if (action.includes("changed") || action.includes("transfer")) return "bg-purple-100 text-purple-700 border-purple-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  const renderDetails = (event: TimelineEvent) => {
    const details = event.details;
    if (!details) return null;

    if (event.action === "employee.manager_changed") {
      return (
        <p className="mt-1 text-xs text-slate-500 flex items-center gap-1">
          <span>Changed manager:</span>
          <span className="font-semibold text-slate-700">{details.from || "None"}</span>
          <ArrowRight className="h-3 w-3 text-slate-400" />
          <span className="font-semibold text-slate-700">{details.to || "None"}</span>
        </p>
      );
    }

    if (event.action === "employee.department_changed") {
      return (
        <p className="mt-1 text-xs text-slate-500 flex items-center gap-1">
          <span>Transferred department:</span>
          <span className="font-semibold text-slate-700">{details.from || "None"}</span>
          <ArrowRight className="h-3 w-3 text-slate-400" />
          <span className="font-semibold text-slate-700">{details.to || "None"}</span>
        </p>
      );
    }

    if (event.action === "employee.status_changed") {
      return (
        <p className="mt-1 text-xs text-slate-500 flex items-center gap-1">
          <span>Status changed:</span>
          <span className="font-semibold text-slate-700 capitalize">{details.from || "None"}</span>
          <ArrowRight className="h-3 w-3 text-slate-400" />
          <span className="font-semibold text-slate-700 capitalize">{details.to || "None"}</span>
        </p>
      );
    }

    if (event.action === "employee.updated" && details.fields_changed) {
      const labels = (details.fields_changed as string[]).map(toFieldLabel);
      return (
        <div className="mt-2 flex flex-wrap gap-1">
          {labels.map((label) => (
            <span
              key={label}
              className="inline-block rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
            >
              {label}
            </span>
          ))}
        </div>
      );
    }

    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400 gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
        <span>Loading lifecycle history...</span>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-10 text-slate-400 text-sm">
        <Activity className="h-8 w-8 mx-auto text-slate-300 mb-2" />
        No lifecycle events recorded for this employee yet.
      </div>
    );
  }

  return (
    <div className="relative border-l-2 border-slate-150 pl-5 ml-4 mt-4 space-y-6">
      {events.map((event) => (
        <div key={event.id} className="relative">
          {/* Timeline Node Dot */}
          <span className="absolute -left-[27px] top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white ring-2 ring-slate-200">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          </span>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.01)] hover:shadow-sm transition-shadow">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getActionColor(event.action)}`}>
                {getActionLabel(event.action)}
              </span>
              <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(event.created_at).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>

            {renderDetails(event)}

            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 font-semibold border-t border-slate-50 pt-2">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                Actor: <span className="text-slate-500 capitalize">{event.actor_role}</span>
              </span>
              {event.details?.ip_address && (
                <span>IP: {event.details.ip_address}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
