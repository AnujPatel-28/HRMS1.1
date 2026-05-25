import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, CalendarDays, Check, Clock, ImagePlus, IndianRupee, Save, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { db, storage } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import { useAuditLog } from "../hooks/useAuditLog";
import { Skeleton } from "../shared/Skeleton";
import { useToast } from "../shared/ToastContext";
import { getTenantDate, getTenantYear } from "../utils/date";
import { validateAttendancePolicy, validateTaskPolicy, validateLeavePolicy, validateSalaryPolicy, validateLeaveType } from "../utils/policyValidation";

type TabKey = "attendance" | "leave" | "salary" | "task" | "company";

type TenantForm = {
  company_name: string;
  logo_url: string;
  timezone: string;
  punch_in_start: string;
  punch_in_cutoff: string;
  work_hours_per_day: string;
  lunch_break_minutes: string;
  punch_out_gate_enabled: boolean;
};

export type AttendancePolicyForm = {
  late_mark_enabled: boolean;
  late_mark_grace_minutes: string;
  late_mark_threshold: string;
  late_mark_deduction_hours: string;
  overtime_enabled: boolean;
  overtime_rate: string;
  geofence_enabled: boolean;
  office_lat: string;
  office_lng: string;
  geofence_radius_meters: string;
  geofence_mode: "warn" | "strict";
  regularization_enabled: boolean;
  regularization_window_days: string;
  payroll_lock_date: string;
};

export type LeavePolicyForm = {
  leave_min_notice_days: string;
  leave_carry_forward: boolean;
};

export type SalaryPolicyForm = {
  lop_calculation_method: "calendar" | "fixed_26" | "working_days";
  pf_wage_ceiling: string;
  esi_gross_ceiling: string;
  professional_tax_state: string;
  professional_tax_manual_amount: string;
};

export type TaskPolicyForm = {
  punch_out_gate_enabled: boolean;
  task_eod_redmark_time: string;
  task_grace_period_minutes: string;
};

type LeaveTypeRow = {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  days_per_year: number;
  accrual_type: "lump_sum" | "monthly";
  carry_forward_enabled: boolean;
  carry_forward_max_days: number | null;
  encashment_enabled: boolean;
  applicable_from_day: number;
  probation_restricted: boolean;
  requires_document: boolean;
  min_notice_days: number;
  max_consecutive_days: number | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

type LeaveBalanceRow = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
};

type SalaryTemplate = {
  department: string;
  basic_percent: number;
  hra_percent: number;
  special_allowance: number;
  pf_applicable: boolean;
  esi_applicable: boolean;
};

export type LeaveTypeForm = {
  id: string | null;
  name: string;
  code: string;
  days_per_year: string;
  accrual_type: "lump_sum" | "monthly";
  carry_forward: boolean;
  max_carry_forward_days: string;
  encashment_allowed: boolean;
  applicable_after_days: string;
  restrict_during_probation: boolean;
  requires_document: boolean;
  minimum_notice_days: string;
  maximum_consecutive_days: string;
  is_active: boolean;
  updated_at: string | null;
};

type SalaryTemplateForm = {
  department: string;
  basic_percent: string;
  hra_percent: string;
  special_allowance: string;
  pf_applicable: boolean;
  esi_applicable: boolean;
};

const tabs: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "attendance", label: "Attendance", icon: Clock },
  { key: "leave", label: "Leave", icon: CalendarDays },
  { key: "salary", label: "Salary", icon: IndianRupee },
  { key: "task", label: "Task", icon: Check },
  { key: "company", label: "Company", icon: Building2 },
];

const departments = ["sales", "dev", "marketing", "operations", "design", "other"] as const;

const defaultTenantForm: TenantForm = {
  company_name: "TalentMesh Solutions",
  logo_url: "",
  timezone: "Asia/Kolkata",
  punch_in_start: "09:00",
  punch_in_cutoff: "10:30",
  work_hours_per_day: "8",
  lunch_break_minutes: "60",
  punch_out_gate_enabled: true,
};

const defaultAttendancePolicy: AttendancePolicyForm = {
  late_mark_enabled: false,
  late_mark_grace_minutes: "0",
  late_mark_threshold: "3",
  late_mark_deduction_hours: "0.5",
  overtime_enabled: false,
  overtime_rate: "1.5",
  geofence_enabled: false,
  office_lat: "",
  office_lng: "",
  geofence_radius_meters: "500",
  geofence_mode: "warn",
  regularization_enabled: false,
  regularization_window_days: "7",
  payroll_lock_date: "",
};

const defaultLeavePolicy: LeavePolicyForm = {
  leave_min_notice_days: "1",
  leave_carry_forward: false,
};

const defaultSalaryPolicy: SalaryPolicyForm = {
  lop_calculation_method: "fixed_26",
  pf_wage_ceiling: "15000",
  esi_gross_ceiling: "21000",
  professional_tax_state: "karnataka",
  professional_tax_manual_amount: "",
};

const defaultTaskPolicy: TaskPolicyForm = {
  punch_out_gate_enabled: true,
  task_eod_redmark_time: "23:30",
  task_grace_period_minutes: "0",
};

const defaultLeaveTypeForm: LeaveTypeForm = {
  id: null,
  name: "",
  code: "",
  days_per_year: "",
  accrual_type: "lump_sum",
  carry_forward: false,
  max_carry_forward_days: "",
  encashment_allowed: false,
  applicable_after_days: "0",
  restrict_during_probation: false,
  requires_document: false,
  minimum_notice_days: "0",
  maximum_consecutive_days: "",
  is_active: true,
  updated_at: null,
};

const defaultSalaryTemplateForm: SalaryTemplateForm = {
  department: "sales",
  basic_percent: "40",
  hra_percent: "50",
  special_allowance: "0",
  pf_applicable: true,
  esi_applicable: false,
};

const tenantColumns = [
  "company_name",
  "logo_url",
  "timezone",
  "punch_in_start",
  "punch_in_cutoff",
  "work_hours_per_day",
  "lunch_break_minutes",
  "punch_out_gate_enabled",
].join(",");

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-brand-600 focus:ring";

function normalizeTime(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value) return fallback;
  return value.slice(0, 5);
}

function settingMap(rows: { key: string; value: string }[]) {
  return rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

function boolValue(value: string | undefined, fallback: boolean) {
  if (value == null) return fallback;
  return value === "true";
}


function formatJson<T>(value: T) {
  return JSON.stringify(value);
}

function parseSalaryTemplate(value: string | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as SalaryTemplate;
  } catch {
    return null;
  }
}

function suggestLeaveCode(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("").slice(0, 5);
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <span>
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {description ? <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span> : null}
      </span>
      <span className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
        <span className="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-brand-600" />
        <span className="absolute left-1 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function SectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function SaveButton({ label, saving, onClick }: { label: string; saving: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
    >
      <Save className="h-4 w-4" />
      {saving ? "Saving..." : label}
    </button>
  );
}

export default function PolicyCenter() {
  const { tenantId, refreshTenant } = useTenant();
  const { logAction } = useAuditLog();
  const { success, error: toastError } = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>("attendance");
  const [loading, setLoading] = useState(true);
  const [savingTab, setSavingTab] = useState<TabKey | "leave-type" | "salary-template" | "leave-balances" | null>(null);
  const [showUnsavedBanner, setShowUnsavedBanner] = useState(false);

  const [tenantForm, setTenantForm] = useState<TenantForm>(defaultTenantForm);
  const [attendancePolicy, setAttendancePolicy] = useState<AttendancePolicyForm>(defaultAttendancePolicy);
  const [leavePolicy, setLeavePolicy] = useState<LeavePolicyForm>(defaultLeavePolicy);
  const [salaryPolicy, setSalaryPolicy] = useState<SalaryPolicyForm>(defaultSalaryPolicy);
  const [taskPolicy, setTaskPolicy] = useState<TaskPolicyForm>(defaultTaskPolicy);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRow[]>([]);
  const [leaveBalanceRows, setLeaveBalanceRows] = useState<LeaveBalanceRow[]>([]);
  const [activeEmployeeIds, setActiveEmployeeIds] = useState<string[]>([]);
  const [shiftCount, setShiftCount] = useState(0);
  const [customShiftEmployeeCount, setCustomShiftEmployeeCount] = useState(0);
  const [salaryTemplates, setSalaryTemplates] = useState<Record<string, SalaryTemplate>>({});

  const [leaveTypeModalOpen, setLeaveTypeModalOpen] = useState(false);
  const [leaveTypeForm, setLeaveTypeForm] = useState<LeaveTypeForm>(defaultLeaveTypeForm);
  const [salaryTemplateModalOpen, setSalaryTemplateModalOpen] = useState(false);
  const [salaryTemplateIsEditing, setSalaryTemplateIsEditing] = useState(false);
  const [salaryTemplateForm, setSalaryTemplateForm] = useState<SalaryTemplateForm>(defaultSalaryTemplateForm);

  const [baselineTenantForm, setBaselineTenantForm] = useState(defaultTenantForm);
  const [baselineAttendancePolicy, setBaselineAttendancePolicy] = useState(defaultAttendancePolicy);
  const [baselineLeavePolicy, setBaselineLeavePolicy] = useState(defaultLeavePolicy);
  const [baselineSalaryPolicy, setBaselineSalaryPolicy] = useState(defaultSalaryPolicy);
  const [baselineTaskPolicy, setBaselineTaskPolicy] = useState(defaultTaskPolicy);
  const [tenantUpdatedAt, setTenantUpdatedAt] = useState<string | null>(null);
  const [settingUpdatedAtMap, setSettingUpdatedAtMap] = useState<Record<string, string>>({});
  const [showDryRun, setShowDryRun] = useState(false);
  const [dryRunStats, setDryRunStats] = useState({ total: 0, existing: 0, new: 0, targetYear: 0 });

  // Business-calendar date for shift assignment queries.
  // Must be local timezone — not toISOString() which returns UTC date.
  const today = getTenantDate(tenantForm.timezone || "UTC");

  const logoPreview = useMemo(() => {
    if (logoFile) return URL.createObjectURL(logoFile);
    return tenantForm.logo_url || "";
  }, [logoFile, tenantForm.logo_url]);

  useEffect(() => {
    return () => {
      if (logoPreview.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  const dirtyTabs = useMemo(() => {
    const next = new Set<TabKey>();
    if (formatJson(tenantForm) !== formatJson(baselineTenantForm) || logoFile) next.add("company");
    if (formatJson(attendancePolicy) !== formatJson(baselineAttendancePolicy) || tenantForm.punch_in_start !== baselineTenantForm.punch_in_start || tenantForm.punch_in_cutoff !== baselineTenantForm.punch_in_cutoff || tenantForm.work_hours_per_day !== baselineTenantForm.work_hours_per_day || tenantForm.lunch_break_minutes !== baselineTenantForm.lunch_break_minutes) next.add("attendance");
    if (formatJson(leavePolicy) !== formatJson(baselineLeavePolicy)) next.add("leave");
    if (formatJson(salaryPolicy) !== formatJson(baselineSalaryPolicy)) next.add("salary");
    if (formatJson(taskPolicy) !== formatJson(baselineTaskPolicy) || tenantForm.punch_out_gate_enabled !== baselineTenantForm.punch_out_gate_enabled) next.add("task");
    return next;
  }, [attendancePolicy, baselineAttendancePolicy, baselineLeavePolicy, baselineSalaryPolicy, baselineTaskPolicy, baselineTenantForm, leavePolicy, logoFile, salaryPolicy, taskPolicy, tenantForm]);

  const loadPolicyCenter = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [tenantRes, settingsRes, leaveTypesRes, shiftsRes, shiftAssignmentsRes, employeesRes, leaveBalancesRes] = await Promise.all([
        db.from("tenants").select(tenantColumns).eq("id", tenantId).maybeSingle(),
        db.from("tenant_settings").select("key,value").eq("tenant_id", tenantId),
        db.from("leave_types").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: true }),
        db.from("shifts").select("id,is_default").eq("tenant_id", tenantId),
        db
          .from("employee_shifts")
          .select("*")
          .eq("tenant_id", tenantId)
          .lte("effective_from", today)
          .or(`effective_to.is.null,effective_to.gte.${today}`),
        db.from("employees").select("id").eq("tenant_id", tenantId).eq("status", "active"),
        db.from("leave_balances").select("id,employee_id,leave_type_id,year").eq("tenant_id", tenantId),
      ]);

      if (tenantRes.error) throw tenantRes.error;
      if (settingsRes.error) throw settingsRes.error;
      if (leaveTypesRes.error) throw leaveTypesRes.error;
      if (shiftsRes.error) throw shiftsRes.error;
      if (shiftAssignmentsRes.error) throw shiftAssignmentsRes.error;
      if (employeesRes.error) throw employeesRes.error;
      if (leaveBalancesRes.error) throw leaveBalancesRes.error;

      const tenantData = tenantRes.data as Partial<TenantForm> | null;
      const rawSettings = (settingsRes.data ?? []) as { key: string; value: string; updated_at?: string }[];
      const settings = settingMap(rawSettings);
      
      const newSettingUpdatedAtMap: Record<string, string> = {};
      for (const row of rawSettings) {
        if (row.updated_at) newSettingUpdatedAtMap[row.key] = row.updated_at;
      }
      
      const nextTenantForm: TenantForm = {
        company_name: String(tenantData?.company_name ?? defaultTenantForm.company_name),
        logo_url: String(tenantData?.logo_url ?? ""),
        timezone: String(tenantData?.timezone ?? defaultTenantForm.timezone),
        punch_in_start: normalizeTime(tenantData?.punch_in_start, defaultTenantForm.punch_in_start),
        punch_in_cutoff: normalizeTime(tenantData?.punch_in_cutoff, defaultTenantForm.punch_in_cutoff),
        work_hours_per_day: String(tenantData?.work_hours_per_day ?? defaultTenantForm.work_hours_per_day),
        lunch_break_minutes: String(tenantData?.lunch_break_minutes ?? defaultTenantForm.lunch_break_minutes),
        punch_out_gate_enabled: tenantData?.punch_out_gate_enabled ?? defaultTenantForm.punch_out_gate_enabled,
      };
      const nextAttendancePolicy: AttendancePolicyForm = {
        late_mark_enabled: boolValue(settings.late_mark_enabled, defaultAttendancePolicy.late_mark_enabled),
        late_mark_grace_minutes: settings.late_mark_grace_minutes ?? defaultAttendancePolicy.late_mark_grace_minutes,
        late_mark_threshold: settings.late_mark_threshold ?? defaultAttendancePolicy.late_mark_threshold,
        late_mark_deduction_hours: settings.late_mark_deduction_hours ?? defaultAttendancePolicy.late_mark_deduction_hours,
        overtime_enabled: boolValue(settings.overtime_enabled, defaultAttendancePolicy.overtime_enabled),
        overtime_rate: settings.overtime_rate ?? defaultAttendancePolicy.overtime_rate,
        geofence_enabled: boolValue(settings.geofence_enabled, defaultAttendancePolicy.geofence_enabled),
        office_lat: settings.office_lat ?? defaultAttendancePolicy.office_lat,
        office_lng: settings.office_lng ?? defaultAttendancePolicy.office_lng,
        geofence_radius_meters: settings.geofence_radius_meters ?? defaultAttendancePolicy.geofence_radius_meters,
        geofence_mode: (settings.geofence_mode as "warn" | "strict" | undefined) ?? defaultAttendancePolicy.geofence_mode,
        regularization_enabled: boolValue(settings.regularization_enabled, defaultAttendancePolicy.regularization_enabled),
        regularization_window_days: settings.regularization_window_days ?? defaultAttendancePolicy.regularization_window_days,
        payroll_lock_date: settings.payroll_lock_date ?? defaultAttendancePolicy.payroll_lock_date,
      };
      const nextLeavePolicy: LeavePolicyForm = {
        leave_min_notice_days: settings.leave_min_notice_days ?? defaultLeavePolicy.leave_min_notice_days,
        leave_carry_forward: boolValue(settings.leave_carry_forward, defaultLeavePolicy.leave_carry_forward),
      };
      const nextSalaryPolicy: SalaryPolicyForm = {
        lop_calculation_method: (settings.lop_calculation_method as SalaryPolicyForm["lop_calculation_method"] | undefined) ?? defaultSalaryPolicy.lop_calculation_method,
        pf_wage_ceiling: settings.pf_wage_ceiling ?? defaultSalaryPolicy.pf_wage_ceiling,
        esi_gross_ceiling: settings.esi_gross_ceiling ?? defaultSalaryPolicy.esi_gross_ceiling,
        professional_tax_state: settings.professional_tax_state ?? defaultSalaryPolicy.professional_tax_state,
        professional_tax_manual_amount: settings.professional_tax_manual_amount ?? defaultSalaryPolicy.professional_tax_manual_amount,
      };
      const nextTaskPolicy: TaskPolicyForm = {
        punch_out_gate_enabled: tenantData?.punch_out_gate_enabled ?? defaultTaskPolicy.punch_out_gate_enabled,
        task_eod_redmark_time: settings.task_eod_redmark_time ?? defaultTaskPolicy.task_eod_redmark_time,
        task_grace_period_minutes: settings.task_grace_period_minutes ?? defaultTaskPolicy.task_grace_period_minutes,
      };

      const nextLeaveTypes = (leaveTypesRes.data ?? []) as LeaveTypeRow[];
      const activeLeaveTypes = nextLeaveTypes.filter((leaveType) => leaveType.is_active);
      const shiftRows = (shiftsRes.data ?? []) as { id: string; is_default?: boolean | null }[];
      const shiftMap = new Map(shiftRows.map((shift) => [shift.id, shift]));
      const customAssignments = ((shiftAssignmentsRes.data ?? []) as { employee_id: string; shift_id: string }[])
        .filter((assignment) => shiftMap.get(assignment.shift_id)?.is_default === false);
      const activeEmployees = ((employeesRes.data ?? []) as { id: string }[]).map((employee) => employee.id);
      const templateSettings = Object.entries(settings)
        .filter(([key]) => key.startsWith("salary_template_"))
        .reduce<Record<string, SalaryTemplate>>((acc, [key, value]) => {
          const department = key.replace("salary_template_", "");
          const template = parseSalaryTemplate(value);
          if (template) acc[department] = template;
          return acc;
        }, {});

      setTenantForm(nextTenantForm);
      setAttendancePolicy(nextAttendancePolicy);
      setLeavePolicy(nextLeavePolicy);
      setSalaryPolicy(nextSalaryPolicy);
      setTaskPolicy(nextTaskPolicy);
      setBaselineTenantForm(nextTenantForm);
      setBaselineAttendancePolicy(nextAttendancePolicy);
      setBaselineLeavePolicy(nextLeavePolicy);
      setBaselineSalaryPolicy(nextSalaryPolicy);
      setBaselineTaskPolicy(nextTaskPolicy);
      setTenantUpdatedAt((tenantRes.data as any)?.updated_at || null);
      setSettingUpdatedAtMap(newSettingUpdatedAtMap);
      setLeaveTypes(nextLeaveTypes);
      setShiftCount(shiftRows.length);
      setCustomShiftEmployeeCount(new Set(customAssignments.map((assignment) => assignment.employee_id)).size);
      setActiveEmployeeIds(activeEmployees);
      setLeaveBalanceRows((leaveBalancesRes.data ?? []) as LeaveBalanceRow[]);
      setSalaryTemplates(templateSettings);
      setShowUnsavedBanner(false);
      if (activeLeaveTypes.length === 0) {
        setLeaveBalanceRows([]);
      }
    } catch (err) {
      console.error(err);
      toastError("Failed to load policy center.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toastError, today]);

  useEffect(() => {
    void loadPolicyCenter();
  }, [loadPolicyCenter]);

  const activeLeaveTypes = useMemo(() => leaveTypes.filter((leaveType) => leaveType.is_active), [leaveTypes]);

  const leaveBalanceStatus = useMemo(() => {
    if (activeEmployeeIds.length === 0 || activeLeaveTypes.length === 0) {
      return { initializedEmployees: 0, totalEmployees: activeEmployeeIds.length };
    }
    const displayYear = getTenantYear(tenantForm.timezone || "UTC");
    const balanceKeys = new Set(
      leaveBalanceRows
        .filter((row) => row.year === displayYear)
        .map((row) => `${row.employee_id}:${row.leave_type_id}`),
    );
    const initializedEmployees = activeEmployeeIds.filter((employeeId) =>
      activeLeaveTypes.every((leaveType) => balanceKeys.has(`${employeeId}:${leaveType.id}`)),
    ).length;
    return { initializedEmployees, totalEmployees: activeEmployeeIds.length };
  }, [activeEmployeeIds, activeLeaveTypes, tenantForm.timezone, leaveBalanceRows]);

  const attendancePreviewText = useMemo(() => {
    const threshold = Number(attendancePolicy.late_mark_threshold || 0);
    const deduction = Number(attendancePolicy.late_mark_deduction_hours || 0);
    const excess = Math.max(0, 5 - threshold);
    return `Example: If threshold is ${threshold} and employee has 5 late marks, ${excess} excess late marks × ${deduction}h = ${(excess * deduction).toFixed(1)} hour deducted from salary`;
  }, [attendancePolicy.late_mark_deduction_hours, attendancePolicy.late_mark_threshold]);

  const lopPreview = useMemo(() => {
    if (salaryPolicy.lop_calculation_method === "calendar") return "Per-day rate = Monthly gross ÷ days in month";
    if (salaryPolicy.lop_calculation_method === "working_days") return "Per-day rate = Monthly gross ÷ working days this month";
    return "Per-day rate = Monthly gross ÷ 26";
  }, [salaryPolicy.lop_calculation_method]);


  const sortedTemplates = useMemo(
    () => Object.entries(salaryTemplates).sort(([a], [b]) => a.localeCompare(b)),
    [salaryTemplates],
  );

  function handleTabChange(nextTab: TabKey) {
    if (nextTab !== activeTab && dirtyTabs.size > 0) {
      toastError(`Please save your changes in the ${Array.from(dirtyTabs).join(", ")} tab(s) before switching.`);
      setShowUnsavedBanner(true);
      return;
    }
    setActiveTab(nextTab);
  }

  function handleInitializeClick() {
    const freshYear = getTenantYear(tenantForm.timezone || "UTC");
    const existingKeys = new Set(
      leaveBalanceRows
        .filter((row) => row.year === freshYear)
        .map((row) => `${row.employee_id}:${row.leave_type_id}`),
    );
    let newCount = 0;
    let existingCount = 0;
    for (const emp of activeEmployeeIds) {
      for (const lt of activeLeaveTypes) {
        if (existingKeys.has(`${emp}:${lt.id}`)) {
          existingCount++;
        } else {
          newCount++;
        }
      }
    }
    setDryRunStats({ total: activeEmployeeIds.length * activeLeaveTypes.length, existing: existingCount, new: newCount, targetYear: freshYear });
    setShowDryRun(true);
  }

  async function uploadLogo() {
    if (!logoFile || !tenantId) return tenantForm.logo_url || null;
    const ext = logoFile.name.split(".").pop() || "png";
    const path = `${tenantId}/logo-${Date.now()}.${ext}`;
    const { error: uploadError } = await storage.from("company-assets").upload(path, logoFile);
    if (uploadError) throw uploadError;
    return storage.from("company-assets").getPublicUrl(path);
  }

  async function saveSettingRows(rows: { key: string; value: string }[], section: string, successMessage: string, tab: TabKey) {
    if (!tenantId) return;
    
    const keys = rows.map((r) => r.key);
    const { data: currentSettings, error: fetchError } = await db
      .from("tenant_settings")
      .select("key, updated_at")
      .eq("tenant_id", tenantId)
      .in("key", keys);
    if (fetchError) throw fetchError;

    const currentMap = new Map((currentSettings || []).map(s => [s.key, s.updated_at]));
    for (const key of keys) {
      if (currentMap.has(key) && currentMap.get(key) !== settingUpdatedAtMap[key]) {
        throw new Error("STALE_WRITE");
      }
    }

    const now = new Date().toISOString();
    for (const row of rows) {
      if (currentMap.has(row.key)) {
        const { error: updateError } = await db
          .from("tenant_settings")
          .update({ value: row.value, updated_at: now })
          .eq("tenant_id", tenantId)
          .eq("key", row.key)
          .eq("updated_at", settingUpdatedAtMap[row.key] as string);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await db
          .from("tenant_settings")
          .insert([{ tenant_id: tenantId, key: row.key, value: row.value, updated_at: now }]);
        if (insertError) throw insertError;
      }
    }

    const nextSettingMap = { ...settingUpdatedAtMap };
    for (const key of keys) nextSettingMap[key] = now;
    setSettingUpdatedAtMap(nextSettingMap);

    void logAction("settings.updated", "tenant", tenantId, { section });
    success(successMessage);
    if (tab === "attendance") setBaselineAttendancePolicy(attendancePolicy);
    if (tab === "leave") setBaselineLeavePolicy(leavePolicy);
    if (tab === "salary") setBaselineSalaryPolicy(salaryPolicy);
    if (tab === "task") setBaselineTaskPolicy(taskPolicy);
    dirtyTabs.delete(tab);
    setShowUnsavedBanner(false);
  }

  async function saveAttendancePolicy() {
    if (!tenantId) return;

    const validation = validateAttendancePolicy(attendancePolicy);
    if (!validation.valid) {
      toastError(Object.values(validation.errors)[0]);
      return;
    }

    setSavingTab("attendance");
    try {
      let query = db.from("tenants").update({
        punch_in_start: tenantForm.punch_in_start,
        punch_in_cutoff: tenantForm.punch_in_cutoff,
        work_hours_per_day: Number(tenantForm.work_hours_per_day || defaultTenantForm.work_hours_per_day),
        lunch_break_minutes: Number(tenantForm.lunch_break_minutes || defaultTenantForm.lunch_break_minutes),
        updated_at: new Date().toISOString(),
      }).eq("id", tenantId);
      
      if (tenantUpdatedAt) query = query.eq("updated_at", tenantUpdatedAt);
      
      const { data: updateData, error: tenantUpdateError } = await query.select("updated_at").maybeSingle();
      if (tenantUpdateError) throw tenantUpdateError;
      if (tenantUpdatedAt && !updateData) throw new Error("STALE_WRITE");
      
      setTenantUpdatedAt(updateData.updated_at);
      await saveSettingRows([
        { key: "late_mark_enabled", value: String(attendancePolicy.late_mark_enabled) },
        { key: "late_mark_grace_minutes", value: attendancePolicy.late_mark_grace_minutes || "0" },
        { key: "late_mark_threshold", value: attendancePolicy.late_mark_threshold || "3" },
        { key: "late_mark_deduction_hours", value: attendancePolicy.late_mark_deduction_hours || "0.5" },
        { key: "overtime_enabled", value: String(attendancePolicy.overtime_enabled) },
        { key: "overtime_rate", value: attendancePolicy.overtime_rate || "1.5" },
        { key: "geofence_enabled", value: String(attendancePolicy.geofence_enabled) },
        { key: "office_lat", value: attendancePolicy.office_lat.trim() },
        { key: "office_lng", value: attendancePolicy.office_lng.trim() },
        { key: "geofence_radius_meters", value: attendancePolicy.geofence_radius_meters || "500" },
        { key: "geofence_mode", value: attendancePolicy.geofence_mode },
        { key: "regularization_enabled", value: String(attendancePolicy.regularization_enabled) },
        { key: "regularization_window_days", value: attendancePolicy.regularization_window_days || "7" },
        { key: "payroll_lock_date", value: attendancePolicy.payroll_lock_date || "" },
      ], "attendance-policy", "Attendance policy saved", "attendance");
      await refreshTenant();
      setBaselineTenantForm((current) => ({
        ...current,
        punch_in_start: tenantForm.punch_in_start,
        punch_in_cutoff: tenantForm.punch_in_cutoff,
        work_hours_per_day: tenantForm.work_hours_per_day,
        lunch_break_minutes: tenantForm.lunch_break_minutes,
      }));
    } catch (err: any) {
      console.error(err);
      if (err.message === "STALE_WRITE") {
        toastError("Another admin has modified these settings. Please refresh.");
      } else {
        toastError("Failed to save attendance policy.");
      }
    } finally {
      setSavingTab(null);
    }
  }

  async function saveLeavePolicy() {
    const validation = validateLeavePolicy(leavePolicy);
    if (!validation.valid) {
      toastError(Object.values(validation.errors)[0]);
      return;
    }
    setSavingTab("leave");
    try {
      await saveSettingRows([
        { key: "leave_min_notice_days", value: leavePolicy.leave_min_notice_days || "0" },
        { key: "leave_carry_forward", value: String(leavePolicy.leave_carry_forward) },
      ], "leave-policy", "Leave policy saved", "leave");
    } catch (err) {
      console.error(err);
      toastError("Failed to save leave policy.");
    } finally {
      setSavingTab(null);
    }
  }

  async function saveSalaryPolicy() {
    const validation = validateSalaryPolicy(salaryPolicy);
    if (!validation.valid) {
      toastError(Object.values(validation.errors)[0]);
      return;
    }
    setSavingTab("salary");
    try {
      await saveSettingRows([
        { key: "lop_calculation_method", value: salaryPolicy.lop_calculation_method },
        { key: "pf_wage_ceiling", value: salaryPolicy.pf_wage_ceiling || "15000" },
        { key: "esi_gross_ceiling", value: salaryPolicy.esi_gross_ceiling || "21000" },
        { key: "professional_tax_state", value: salaryPolicy.professional_tax_state },
        { key: "professional_tax_manual_amount", value: salaryPolicy.professional_tax_manual_amount.trim() },
      ], "salary-policy", "Salary policy saved", "salary");
    } catch (err) {
      console.error(err);
      toastError("Failed to save salary policy.");
    } finally {
      setSavingTab(null);
    }
  }

  async function saveTaskPolicy() {
    if (!tenantId) return;

    const validation = validateTaskPolicy(taskPolicy);
    if (!validation.valid) {
      toastError(Object.values(validation.errors)[0]);
      return;
    }

    setSavingTab("task");
    try {
      let query = db.from("tenants").update({
        punch_out_gate_enabled: taskPolicy.punch_out_gate_enabled,
        updated_at: new Date().toISOString(),
      }).eq("id", tenantId);
      
      if (tenantUpdatedAt) query = query.eq("updated_at", tenantUpdatedAt);
      
      const { data: updateData, error: tenantUpdateError } = await query.select("updated_at").maybeSingle();
      if (tenantUpdateError) throw tenantUpdateError;
      if (tenantUpdatedAt && !updateData) throw new Error("STALE_WRITE");
      
      setTenantUpdatedAt(updateData.updated_at);
      await saveSettingRows([
        { key: "task_eod_redmark_time", value: taskPolicy.task_eod_redmark_time || "23:30" },
        { key: "task_grace_period_minutes", value: taskPolicy.task_grace_period_minutes || "0" },
      ], "task-policy", "Task policy saved", "task");
      await refreshTenant();
      setBaselineTenantForm((current) => ({ ...current, punch_out_gate_enabled: taskPolicy.punch_out_gate_enabled }));
    } catch (err: any) {
      console.error(err);
      if (err.message === "STALE_WRITE") {
        toastError("Another admin has modified these settings. Please refresh.");
      } else {
        toastError("Failed to save task policy.");
      }
    } finally {
      setSavingTab(null);
    }
  }

  async function saveCompanyProfile() {
    if (!tenantId) return;
    setSavingTab("company");
    const oldLogoUrl = baselineTenantForm.logo_url;
    let logoUrl: string | null = null;
    try {
      logoUrl = await uploadLogo();
      
      let query = db.from("tenants").update({
        company_name: tenantForm.company_name.trim(),
        logo_url: logoUrl,
        timezone: tenantForm.timezone,
        updated_at: new Date().toISOString(),
      }).eq("id", tenantId);
      
      if (tenantUpdatedAt) query = query.eq("updated_at", tenantUpdatedAt);
      
      const { data: updateData, error: tenantUpdateError } = await query.select("updated_at").maybeSingle();
      if (tenantUpdateError) throw tenantUpdateError;
      if (tenantUpdatedAt && !updateData) throw new Error("STALE_WRITE");
      
      setTenantUpdatedAt(updateData.updated_at);
      
      // Cleanup orphaned logo strictly bounded to this tenant
      if (logoUrl && oldLogoUrl && oldLogoUrl !== logoUrl) {
        try {
          const urlObj = new URL(oldLogoUrl);
          const pathSegments = urlObj.pathname.split('/');
          const bucketIndex = pathSegments.indexOf('company-assets');
          if (bucketIndex !== -1 && bucketIndex < pathSegments.length - 1) {
            const pathInBucket = pathSegments.slice(bucketIndex + 1).join('/');
            if (pathInBucket.startsWith(`${tenantId}/`)) {
              await (storage.from("company-assets").remove as any)([pathInBucket]);
            }
          }
        } catch (cleanupError) {
          console.error("Non-fatal: failed to clean up old logo", cleanupError);
        }
      }

      const nextTenantForm = { ...tenantForm, logo_url: logoUrl ?? "" };
      setTenantForm(nextTenantForm);
      setBaselineTenantForm((current) => ({ ...current, company_name: nextTenantForm.company_name, logo_url: nextTenantForm.logo_url, timezone: nextTenantForm.timezone }));
      setLogoFile(null);
      setShowUnsavedBanner(false);
      await refreshTenant();
      void logAction("settings.updated", "tenant", tenantId, { section: "company" });
      success("Company profile saved.");
    } catch (err: any) {
      console.error(err);
      
      // Cleanup orphaned logo on ANY failure (STALE_WRITE, Network disconnect, 500s)
      if (typeof logoUrl === 'string' && logoUrl && logoUrl !== oldLogoUrl) {
        try {
          const urlObj = new URL(logoUrl);
          const pathSegments = urlObj.pathname.split('/');
          const bucketIndex = pathSegments.indexOf('company-assets');
          if (bucketIndex !== -1 && bucketIndex < pathSegments.length - 1) {
            const pathInBucket = pathSegments.slice(bucketIndex + 1).join('/');
            if (pathInBucket.startsWith(`${tenantId}/`)) {
              await (storage.from("company-assets").remove as any)([pathInBucket]);
            }
          }
        } catch (cleanupError) {
          console.error("Non-fatal: failed to clean up new logo after failed save", cleanupError);
        }
      }

      if (err.message === "STALE_WRITE") {
        toastError("Another admin has modified these settings. Please refresh.");
      } else {
        toastError("Failed to save company profile.");
      }
    } finally {
      setSavingTab(null);
    }
  }

  function openLeaveTypeModal(leaveType?: LeaveTypeRow) {
    if (leaveType) {
      setLeaveTypeForm({
        id: leaveType.id,
        name: leaveType.name,
        code: leaveType.code,
        days_per_year: String(leaveType.days_per_year),
        accrual_type: leaveType.accrual_type,
        carry_forward: leaveType.carry_forward_enabled,
        max_carry_forward_days: leaveType.carry_forward_max_days != null ? String(leaveType.carry_forward_max_days) : "",
        encashment_allowed: leaveType.encashment_enabled,
        applicable_after_days: String(leaveType.applicable_from_day ?? 0),
        restrict_during_probation: leaveType.probation_restricted,
        requires_document: leaveType.requires_document,
        minimum_notice_days: String(leaveType.min_notice_days ?? 0),
        maximum_consecutive_days: leaveType.max_consecutive_days != null ? String(leaveType.max_consecutive_days) : "",
        is_active: leaveType.is_active,
        updated_at: leaveType.updated_at || null,
      });
    } else {
      setLeaveTypeForm(defaultLeaveTypeForm);
    }
    setLeaveTypeModalOpen(true);
  }

  async function saveLeaveType() {
    if (!tenantId) return;
    
    const validation = validateLeaveType(leaveTypeForm as any);
    if (!validation.valid) {
      toastError(Object.values(validation.errors)[0]);
      return;
    }

    setSavingTab("leave-type");
    try {
      const payload = {
        tenant_id: tenantId,
        name: leaveTypeForm.name.trim(),
        code: leaveTypeForm.code.trim().toUpperCase().slice(0, 5),
        days_per_year: Number(leaveTypeForm.days_per_year || 0),
        accrual_type: leaveTypeForm.accrual_type,
        carry_forward_enabled: leaveTypeForm.carry_forward,
        carry_forward_max_days: leaveTypeForm.carry_forward && leaveTypeForm.max_carry_forward_days.trim() ? Number(leaveTypeForm.max_carry_forward_days) : 0,
        encashment_enabled: leaveTypeForm.encashment_allowed,
        applicable_from_day: Number(leaveTypeForm.applicable_after_days || 0),
        probation_restricted: leaveTypeForm.restrict_during_probation,
        requires_document: leaveTypeForm.requires_document,
        min_notice_days: Number(leaveTypeForm.minimum_notice_days || 0),
        max_consecutive_days: leaveTypeForm.maximum_consecutive_days.trim() ? Number(leaveTypeForm.maximum_consecutive_days) : null,
        is_active: leaveTypeForm.is_active,
      };

      if (leaveTypeForm.id) {
        const now = new Date().toISOString();
        const { data: updateData, error: updateError } = await db.from("leave_types").update({ ...payload, updated_at: now }).eq("tenant_id", tenantId).eq("id", leaveTypeForm.id).eq("updated_at", leaveTypeForm.updated_at as string).select("id").maybeSingle();
        if (updateError) throw updateError;
        if (leaveTypeForm.updated_at && !updateData) throw new Error("STALE_WRITE");
      } else {
        const { error: insertError } = await db.from("leave_types").insert([{ ...payload, updated_at: new Date().toISOString() }]);
        if (insertError) throw insertError;
      }

      success("Leave type saved.");
      setLeaveTypeModalOpen(false);
      setLeaveTypeForm(defaultLeaveTypeForm);
      void loadPolicyCenter();
    } catch (err: any) {
      console.error(err);
      if (err.message === "STALE_WRITE") {
        toastError("Another admin has modified this leave type. Please refresh.");
      } else {
        toastError("Failed to save leave type.");
      }
    } finally {
      setSavingTab(null);
    }
  }

  async function deactivateLeaveType(leaveTypeId: string) {
    if (!tenantId) return;
    setSavingTab("leave-type");
    try {
      const { error: deactivateError } = await db.from("leave_types").update({ is_active: false, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", leaveTypeId);
      if (deactivateError) throw deactivateError;
      success("Leave type deactivated.");
      void loadPolicyCenter();
    } catch (err) {
      console.error(err);
      toastError("Failed to deactivate leave type.");
    } finally {
      setSavingTab(null);
    }
  }

  async function setupDefaultLeaveTypes() {
    if (!tenantId) return;
    setSavingTab("leave-type");
    try {
      const defaults = [
        { name: "Casual Leave", code: "CL", days_per_year: 12, accrual_type: "lump_sum" as const },
        { name: "Sick Leave", code: "SL", days_per_year: 6, accrual_type: "lump_sum" as const },
        { name: "Earned Leave", code: "EL", days_per_year: 15, accrual_type: "monthly" as const },
      ];
      const { error: upsertError } = await db.from("leave_types").upsert(defaults.map((item) => ({
        tenant_id: tenantId,
        ...item,
        carry_forward_enabled: item.code === "EL",
        carry_forward_max_days: item.code === "EL" ? 15 : 0,
        encashment_enabled: item.code === "EL",
        applicable_from_day: 0,
        probation_restricted: false,
        requires_document: false,
        min_notice_days: 0,
        max_consecutive_days: null,
        is_active: true,
      })), { onConflict: "tenant_id,code", ignoreDuplicates: true });
      if (upsertError) throw upsertError;
      success("Default leave types created.");
      void loadPolicyCenter();
    } catch (err) {
      console.error(err);
      toastError("Failed to set up default leave types.");
    } finally {
      setSavingTab(null);
    }
  }

  async function initializeLeaveBalances() {
    if (!tenantId) return;
    setSavingTab("leave-balances");
    try {
      const { data: freshEmployees, error: empError } = await db.from("employees").select("id").eq("tenant_id", tenantId).eq("status", "active");
      if (empError) throw empError;
      const liveEmployeeIds = (freshEmployees || []).map(e => e.id);

      const targetYear = dryRunStats.targetYear;
      const existingKeys = new Set(
        leaveBalanceRows
          .filter((row) => row.year === targetYear)
          .map((row) => `${row.employee_id}:${row.leave_type_id}`),
      );
      const rowsToInsert = liveEmployeeIds.flatMap((employeeId) =>
        activeLeaveTypes
          .filter((leaveType) => !existingKeys.has(`${employeeId}:${leaveType.id}`))
          .map((leaveType) => ({
            tenant_id: tenantId,
            employee_id: employeeId,
            leave_type_id: leaveType.id,
            year: targetYear,
            total_allocated: leaveType.days_per_year,
            used_days: 0,
            carried_forward: 0,
            balance: leaveType.accrual_type === "monthly" ? 0 : leaveType.days_per_year,
          })),
      );

      if (rowsToInsert.length > 0) {
        const { error: insertError } = await db.from("leave_balances").upsert(rowsToInsert, { onConflict: "tenant_id,employee_id,leave_type_id,year", ignoreDuplicates: true });
        if (insertError) throw insertError;
      }

      success(`Leave balances set up for ${rowsToInsert.length} employee-leave combinations.`);
      setShowDryRun(false);
      void loadPolicyCenter();
    } catch (err) {
      console.error(err);
      toastError("Failed to initialize leave balances.");
    } finally {
      setSavingTab(null);
    }
  }

  function openSalaryTemplateModal(department?: string) {
    const template = department ? salaryTemplates[department] : null;
    if (template) {
      setSalaryTemplateIsEditing(true);
      setSalaryTemplateForm({
        department,
        basic_percent: String(template.basic_percent),
        hra_percent: String(template.hra_percent),
        special_allowance: String(template.special_allowance),
        pf_applicable: template.pf_applicable,
        esi_applicable: template.esi_applicable,
      });
    } else {
      setSalaryTemplateIsEditing(false);
      setSalaryTemplateForm(defaultSalaryTemplateForm);
    }
    setSalaryTemplateModalOpen(true);
  }

  async function saveSalaryTemplate() {
    if (!tenantId) return;
    if (!salaryTemplateIsEditing && salaryTemplates[salaryTemplateForm.department]) {
      toastError(`A template for the ${salaryTemplateForm.department} department already exists. Please edit the existing one.`);
      return;
    }
    setSavingTab("salary-template");
    try {
      const template: SalaryTemplate = {
        department: salaryTemplateForm.department,
        basic_percent: Number(salaryTemplateForm.basic_percent || 40),
        hra_percent: Number(salaryTemplateForm.hra_percent || 50),
        special_allowance: Number(salaryTemplateForm.special_allowance || 0),
        pf_applicable: salaryTemplateForm.pf_applicable,
        esi_applicable: salaryTemplateForm.esi_applicable,
      };
      const key = `salary_template_${salaryTemplateForm.department}`;
      if (salaryTemplateIsEditing) {
        const now = new Date().toISOString();
        const { data: updateData, error: updateError } = await db.from("tenant_settings").update({
          value: JSON.stringify(template),
          updated_at: now,
        }).eq("tenant_id", tenantId).eq("key", key).eq("updated_at", settingUpdatedAtMap[key] as string).select("key").maybeSingle();
        if (updateError) throw updateError;
        if (settingUpdatedAtMap[key] && !updateData) throw new Error("STALE_WRITE");
        setSettingUpdatedAtMap((current) => ({ ...current, [key]: now }));
      } else {
        const { error: insertError } = await db.from("tenant_settings").insert([{
          tenant_id: tenantId,
          key,
          value: JSON.stringify(template),
          updated_at: new Date().toISOString(),
        }]);
        if (insertError) {
          if (insertError.code === "23505") {
            toastError("Another administrator already created a template for this department.");
            return;
          }
          throw insertError;
        }
      }
      setSalaryTemplates((current) => ({ ...current, [salaryTemplateForm.department]: template }));
      setSalaryTemplateModalOpen(false);
      setSalaryTemplateForm(defaultSalaryTemplateForm);
      success("Salary template saved.");
    } catch (err: any) {
      console.error(err);
      if (err.message === "STALE_WRITE") {
        toastError("Another admin has modified this template. Please refresh.");
      } else {
        toastError("Failed to save salary template.");
      }
    } finally {
      setSavingTab(null);
    }
  }

  if (loading) {
    return (
      <section className="space-y-5">
        <Skeleton className="h-16 w-72" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-[720px] w-full rounded-2xl" />
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Settings2 className="h-5 w-5 text-brand-600" />
          Policy Center
        </h2>
        <p className="text-sm text-slate-500">Manage attendance, leave, salary, task and company-wide policies from one place.</p>
      </div>

      {showUnsavedBanner && dirtyTabs.size > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You have unsaved changes in {Array.from(dirtyTabs).join(", ")}.
        </div>
      ) : null}

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => handleTabChange(key)}
            className={`inline-flex min-w-fit flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
              activeTab === key ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "attendance" ? (
        <div className="space-y-4">
          <SectionCard title="Shift Management">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-sm font-medium text-slate-700">{shiftCount} shifts configured | {customShiftEmployeeCount} employees on custom shifts</p>
              <Link to="/hr/shifts" className="text-sm font-semibold text-brand-700 hover:text-brand-800">Manage Shifts →</Link>
            </div>
          </SectionCard>

          <SectionCard title="Punch Rules">
            <div className="grid gap-4 md:grid-cols-2">
              <FieldLabel label="Punch-in opens at">
                <input type="time" value={tenantForm.punch_in_start} onChange={(event) => setTenantForm((current) => ({ ...current, punch_in_start: event.target.value }))} className={inputClass} />
              </FieldLabel>
              <FieldLabel label="Half-day cutoff">
                <input type="time" value={tenantForm.punch_in_cutoff} onChange={(event) => setTenantForm((current) => ({ ...current, punch_in_cutoff: event.target.value }))} className={inputClass} />
              </FieldLabel>
              <FieldLabel label="Work hours per day">
                <input type="number" min={1} value={tenantForm.work_hours_per_day} onChange={(event) => setTenantForm((current) => ({ ...current, work_hours_per_day: event.target.value }))} className={inputClass} />
              </FieldLabel>
              <FieldLabel label="Lunch break (minutes)">
                <input type="number" min={0} value={tenantForm.lunch_break_minutes} onChange={(event) => setTenantForm((current) => ({ ...current, lunch_break_minutes: event.target.value }))} className={inputClass} />
              </FieldLabel>
            </div>
          </SectionCard>

          <SectionCard title="Late Mark Rules">
            <div className="space-y-4">
              <Toggle checked={attendancePolicy.late_mark_enabled} onChange={(checked) => setAttendancePolicy((current) => ({ ...current, late_mark_enabled: checked }))} label="Enable late mark tracking" />
              {attendancePolicy.late_mark_enabled ? (
                <div className="grid gap-4 md:grid-cols-3">
                  <FieldLabel label="Grace period (minutes)">
                    <input type="number" min={0} value={attendancePolicy.late_mark_grace_minutes} onChange={(event) => setAttendancePolicy((current) => ({ ...current, late_mark_grace_minutes: event.target.value }))} className={inputClass} />
                    <p className="mt-1 text-xs text-slate-500">Minutes after shift start before marking as late (0 = strict)</p>
                  </FieldLabel>
                  <FieldLabel label="Monthly threshold">
                    <input type="number" min={0} value={attendancePolicy.late_mark_threshold} onChange={(event) => setAttendancePolicy((current) => ({ ...current, late_mark_threshold: event.target.value }))} className={inputClass} />
                    <p className="mt-1 text-xs text-slate-500">Number of late marks allowed before salary deduction begins</p>
                  </FieldLabel>
                  <FieldLabel label="Deduction per excess late mark">
                    <input type="number" min={0} step="0.1" value={attendancePolicy.late_mark_deduction_hours} onChange={(event) => setAttendancePolicy((current) => ({ ...current, late_mark_deduction_hours: event.target.value }))} className={inputClass} />
                    <p className="mt-1 text-xs text-slate-500">Hours deducted from salary for each late mark beyond threshold</p>
                  </FieldLabel>
                </div>
              ) : null}
              {attendancePolicy.late_mark_enabled ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{attendancePreviewText}</div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Overtime Rules">
            <div className="space-y-4">
              <Toggle checked={attendancePolicy.overtime_enabled} onChange={(checked) => setAttendancePolicy((current) => ({ ...current, overtime_enabled: checked }))} label="Track overtime" />
              {attendancePolicy.overtime_enabled ? (
                <FieldLabel label="Overtime rate">
                  <input type="number" min={1} step="0.1" value={attendancePolicy.overtime_rate} onChange={(event) => setAttendancePolicy((current) => ({ ...current, overtime_rate: event.target.value }))} className={inputClass} />
                  <p className="mt-1 text-xs text-slate-500">Multiplier applied to hourly rate for overtime hours</p>
                  <p className="mt-1 text-xs text-slate-500">1.5 = 1.5× regular rate (time and a half)</p>
                </FieldLabel>
              ) : null}
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Overtime hours are calculated automatically on punch-out. HR reviews and approves overtime in the Attendance → Overtime tab.</p>
            </div>
          </SectionCard>

          <SectionCard title="Geo-fence Rules">
            <div className="space-y-4">
              <Toggle checked={attendancePolicy.geofence_enabled} onChange={(checked) => setAttendancePolicy((current) => ({ ...current, geofence_enabled: checked }))} label="Require location on punch-in" />
              {attendancePolicy.geofence_enabled ? (
                <>
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
                    <div>
                      <p className="text-sm font-medium text-brand-900">Multi-branch Geo-fencing is active.</p>
                      <p className="mt-1 text-xs text-brand-700">Employees can punch in from any active office location.</p>
                    </div>
                    <Link to="/hr/office-locations" className="shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition hover:bg-slate-50">
                      Manage Office Locations →
                    </Link>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold text-slate-600">Geo-fence mode</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={`rounded-xl border px-4 py-3 text-sm ${attendancePolicy.geofence_mode === "warn" ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"}`}>
                        <input type="radio" name="geofence_mode" checked={attendancePolicy.geofence_mode === "warn"} onChange={() => setAttendancePolicy((current) => ({ ...current, geofence_mode: "warn" }))} className="mr-2" />
                        Warn only (employees can punch in but HR sees the flag)
                      </label>
                      <label className={`rounded-xl border px-4 py-3 text-sm ${attendancePolicy.geofence_mode === "strict" ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"}`}>
                        <input type="radio" name="geofence_mode" checked={attendancePolicy.geofence_mode === "strict"} onChange={() => setAttendancePolicy((current) => ({ ...current, geofence_mode: "strict" }))} className="mr-2" />
                        Strict (employees outside fence cannot punch in)
                      </label>
                    </div>
                  </div>
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Currently set to warn-only. Employees outside the fence can still punch in but their record is flagged for HR review.</p>
                </>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Regularization">
            <div className="space-y-4">
              <Toggle checked={attendancePolicy.regularization_enabled} onChange={(checked) => setAttendancePolicy((current) => ({ ...current, regularization_enabled: checked }))} label="Allow employees to request missed punch corrections" />
              {attendancePolicy.regularization_enabled ? (
                <FieldLabel label="Correction window (days)">
                  <input type="number" min={1} value={attendancePolicy.regularization_window_days} onChange={(event) => setAttendancePolicy((current) => ({ ...current, regularization_window_days: event.target.value }))} className={inputClass} />
                  <p className="mt-1 text-xs text-slate-500">Employees can request corrections for punches within the last X days</p>
                </FieldLabel>
              ) : null}
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Correction requests appear in Attendance → Corrections tab for HR review.</p>
            </div>
          </SectionCard>

          <SectionCard title="Payroll & Audit Settings">
            <div className="space-y-4">
              <FieldLabel label="Payroll lock date (YYYY-MM-DD)">
                <input type="date" value={attendancePolicy.payroll_lock_date} onChange={(event) => setAttendancePolicy((current) => ({ ...current, payroll_lock_date: event.target.value }))} className={inputClass} />
                <p className="mt-1 text-xs text-slate-500">Attendance and overtime cannot be modified on or before this date.</p>
              </FieldLabel>
            </div>
          </SectionCard>

          <SaveButton label="Save Attendance Policy" saving={savingTab === "attendance"} onClick={() => void saveAttendancePolicy()} />
        </div>
      ) : null}

      {activeTab === "leave" ? (
        <div className="space-y-4">
          <SectionCard title="Leave Types Manager">
            {leaveTypes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center">
                <p className="text-sm text-slate-700">You haven't configured leave types yet. Set them up to enable proper leave balance tracking for your employees.</p>
                <button type="button" onClick={() => void setupDefaultLeaveTypes()} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60" disabled={savingTab === "leave-type"}>
                  {savingTab === "leave-type" ? "Setting up..." : "Set up leave types"}
                </button>
              </div>
            ) : null}

            <div className="mb-4 flex items-center justify-end">
              <button type="button" onClick={() => openLeaveTypeModal()} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Add Leave Type
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    {["Leave type", "Code", "Days/year", "Accrual", "Carry forward", "Status", "Actions"].map((heading) => (
                      <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {leaveTypes.map((leaveType) => (
                    <tr key={leaveType.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">{leaveType.name}</td>
                      <td className="px-4 py-3 text-slate-700">{leaveType.code}</td>
                      <td className="px-4 py-3 text-slate-700">{leaveType.days_per_year}</td>
                      <td className="px-4 py-3 text-slate-700">{leaveType.accrual_type === "monthly" ? "Monthly" : "Lump sum"}</td>
                      <td className="px-4 py-3 text-slate-700">{leaveType.carry_forward_enabled ? `Yes${leaveType.carry_forward_max_days ? ` (${leaveType.carry_forward_max_days})` : ""}` : "No"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${leaveType.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                          {leaveType.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button type="button" onClick={() => openLeaveTypeModal(leaveType)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                          {leaveType.is_active ? (
                            <button type="button" onClick={() => void deactivateLeaveType(leaveType.id)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">Deactivate</button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="Leave Balance Initialization">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div>
                <p className="text-sm font-medium text-slate-700">Leave balances initialized for {leaveBalanceStatus.initializedEmployees} of {leaveBalanceStatus.totalEmployees} employees</p>
                <p className="mt-1 text-xs text-slate-500">Monthly accrual runs automatically on the 1st of each month for leave types with monthly accrual setting.</p>
              </div>
              <button type="button" onClick={handleInitializeClick} disabled={savingTab === "leave-balances"} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {savingTab === "leave-balances" ? "Processing..." : "Initialize / Refresh Leave Balances"}
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Other Leave Settings">
            <div className="grid gap-4 md:grid-cols-2">
              <FieldLabel label="Minimum notice days (global fallback, leave types can override)">
                <input type="number" min={0} value={leavePolicy.leave_min_notice_days} onChange={(event) => setLeavePolicy((current) => ({ ...current, leave_min_notice_days: event.target.value }))} className={inputClass} />
              </FieldLabel>
              <div>
                <Toggle checked={leavePolicy.leave_carry_forward} onChange={(checked) => setLeavePolicy((current) => ({ ...current, leave_carry_forward: checked }))} label="Allow leave carry forward (global toggle)" />
              </div>
            </div>
          </SectionCard>

          <SaveButton label="Save Leave Policy" saving={savingTab === "leave"} onClick={() => void saveLeavePolicy()} />
        </div>
      ) : null}

      {activeTab === "salary" ? (
        <div className="space-y-4">
          <SectionCard title="LOP Calculation Method">
            <FieldLabel label="How to calculate per-day salary for Loss of Pay">
              <select value={salaryPolicy.lop_calculation_method} onChange={(event) => setSalaryPolicy((current) => ({ ...current, lop_calculation_method: event.target.value as SalaryPolicyForm["lop_calculation_method"] }))} className={inputClass}>
                <option value="calendar">Calendar days (actual days in month: 28/29/30/31)</option>
                <option value="fixed_26">Fixed 26 working days</option>
                <option value="working_days">Working days only (exclude Sundays + holidays)</option>
              </select>
            </FieldLabel>
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{lopPreview}</div>
          </SectionCard>

          <SectionCard title="Statutory Settings">
            <div className="grid gap-4 md:grid-cols-2">
              <FieldLabel label="PF wage ceiling">
                <input type="number" min={0} value={salaryPolicy.pf_wage_ceiling} onChange={(event) => setSalaryPolicy((current) => ({ ...current, pf_wage_ceiling: event.target.value }))} className={inputClass} />
                <p className="mt-1 text-xs text-slate-500">PF calculated on first ₹{salaryPolicy.pf_wage_ceiling || "15000"} of basic salary only</p>
                <p className="mt-1 text-xs text-slate-500">As per EPFO rules. Employees earning basic &gt; ₹15,000 can opt to contribute on actual basic — enable per employee in their profile.</p>
              </FieldLabel>
              <FieldLabel label="ESI gross ceiling">
                <input type="number" min={0} value={salaryPolicy.esi_gross_ceiling} onChange={(event) => setSalaryPolicy((current) => ({ ...current, esi_gross_ceiling: event.target.value }))} className={inputClass} />
                <p className="mt-1 text-xs text-slate-500">ESI applies only if monthly gross is below ₹{salaryPolicy.esi_gross_ceiling || "21000"}</p>
              </FieldLabel>
              <FieldLabel label="Professional tax">
                <select value={salaryPolicy.professional_tax_state} onChange={(event) => setSalaryPolicy((current) => ({ ...current, professional_tax_state: event.target.value }))} className={inputClass}>
                  <option value="karnataka">Karnataka (₹200/month above ₹15k)</option>
                  <option value="maharashtra">Maharashtra (slab-based)</option>
                  <option value="tamil_nadu">Tamil Nadu (₹208/year)</option>
                  <option value="gujarat">Gujarat (₹200/year)</option>
                  <option value="manual">Manual entry</option>
                </select>
              </FieldLabel>
              {salaryPolicy.professional_tax_state === "manual" ? (
                <FieldLabel label="Monthly PT amount">
                  <input type="number" min={0} value={salaryPolicy.professional_tax_manual_amount} onChange={(event) => setSalaryPolicy((current) => ({ ...current, professional_tax_manual_amount: event.target.value }))} className={inputClass} />
                </FieldLabel>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Salary Templates">
            <div className="mb-4 flex items-center justify-end">
              <button type="button" onClick={() => openSalaryTemplateModal()} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Add template</button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    {["Department", "Basic %", "HRA %", "Special allowance", "Actions"].map((heading) => (
                      <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {sortedTemplates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">No salary templates configured yet.</td>
                    </tr>
                  ) : sortedTemplates.map(([department, template]) => (
                    <tr key={department}>
                      <td className="px-4 py-3 font-medium capitalize text-slate-900">{department}</td>
                      <td className="px-4 py-3 text-slate-700">{template.basic_percent}%</td>
                      <td className="px-4 py-3 text-slate-700">{template.hra_percent}%</td>
                      <td className="px-4 py-3 text-slate-700">₹{template.special_allowance.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => openSalaryTemplateModal(department)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SaveButton label="Save Salary Policy" saving={savingTab === "salary"} onClick={() => void saveSalaryPolicy()} />
        </div>
      ) : null}

      {activeTab === "task" ? (
        <div className="space-y-4">
          <SectionCard title="Task Policy">
            <div className="space-y-4">
              <Toggle checked={taskPolicy.punch_out_gate_enabled} onChange={(checked) => { setTaskPolicy((current) => ({ ...current, punch_out_gate_enabled: checked })); setTenantForm((current) => ({ ...current, punch_out_gate_enabled: checked })); }} label="Require task approval before employees can punch out" />
              <div className="grid gap-4 md:grid-cols-2">
                <FieldLabel label="End-of-day auto red-mark time">
                  <input type="time" value={taskPolicy.task_eod_redmark_time} onChange={(event) => setTaskPolicy((current) => ({ ...current, task_eod_redmark_time: event.target.value }))} className={inputClass} />
                  <p className="mt-1 text-xs text-slate-500">Time at which incomplete tasks are marked as red on HR calendar</p>
                  <p className="mt-1 text-xs text-slate-500">The daily edge function runs at this time to flag incomplete tasks.</p>
                </FieldLabel>
                <FieldLabel label="Task grace period (minutes)">
                  <input type="number" min={0} value={taskPolicy.task_grace_period_minutes} onChange={(event) => setTaskPolicy((current) => ({ ...current, task_grace_period_minutes: event.target.value }))} className={inputClass} />
                  <p className="mt-1 text-xs text-slate-500">Minutes after due time before task is considered overdue</p>
                </FieldLabel>
              </div>
            </div>
          </SectionCard>

          <SaveButton label="Save Task Policy" saving={savingTab === "task"} onClick={() => void saveTaskPolicy()} />
        </div>
      ) : null}

      {activeTab === "company" ? (
        <div className="space-y-4">
          <SectionCard title="Company">
            <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-600">Company logo</p>
                <div className="grid aspect-square place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Company logo" className="h-full w-full object-contain p-4" />
                  ) : (
                    <div className="text-center text-slate-400">
                      <ImagePlus className="mx-auto h-10 w-10" />
                      <p className="mt-2 text-xs font-medium">No logo uploaded</p>
                    </div>
                  )}
                </div>
                <label className="mt-3 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <ImagePlus className="h-4 w-4" />
                  Upload logo
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} />
                </label>
              </div>
              <div className="space-y-4">
                <FieldLabel label="Company name">
                  <input value={tenantForm.company_name} onChange={(event) => setTenantForm((current) => ({ ...current, company_name: event.target.value }))} className={inputClass} />
                </FieldLabel>
                <FieldLabel label="Timezone">
                  <select value={tenantForm.timezone} onChange={(event) => setTenantForm((current) => ({ ...current, timezone: event.target.value }))} className={inputClass}>
                    <option value="Asia/Kolkata">Asia/Kolkata</option>
                  </select>
                </FieldLabel>
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">More timezones coming soon.</p>
              </div>
            </div>
          </SectionCard>

          <SaveButton label="Save Company Settings" saving={savingTab === "company"} onClick={() => void saveCompanyProfile()} />
        </div>
      ) : null}

      {leaveTypeModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => setLeaveTypeModalOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">{leaveTypeForm.id ? "Edit Leave Type" : "Add Leave Type"}</h3>
            </div>
            <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
              <FieldLabel label="Leave type name">
                <input value={leaveTypeForm.name} onChange={(event) => setLeaveTypeForm((current) => ({ ...current, name: event.target.value, code: current.id ? current.code : suggestLeaveCode(event.target.value) }))} className={inputClass} />
              </FieldLabel>
              <FieldLabel label="Code">
                <input value={leaveTypeForm.code} maxLength={5} onChange={(event) => setLeaveTypeForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} className={inputClass} />
              </FieldLabel>
              <FieldLabel label="Days per year">
                <input type="number" min={0} value={leaveTypeForm.days_per_year} onChange={(event) => setLeaveTypeForm((current) => ({ ...current, days_per_year: event.target.value }))} className={inputClass} />
              </FieldLabel>
              <FieldLabel label="Accrual type">
                <select value={leaveTypeForm.accrual_type} onChange={(event) => setLeaveTypeForm((current) => ({ ...current, accrual_type: event.target.value as LeaveTypeForm["accrual_type"] }))} className={inputClass}>
                  <option value="lump_sum">All at once on Jan 1st</option>
                  <option value="monthly">Monthly (÷12 each month)</option>
                </select>
              </FieldLabel>
              <div className="md:col-span-2">
                <Toggle checked={leaveTypeForm.carry_forward} onChange={(checked) => setLeaveTypeForm((current) => ({ ...current, carry_forward: checked }))} label="Carry forward" />
              </div>
              {leaveTypeForm.carry_forward ? (
                <FieldLabel label="Max days to carry forward">
                  <input type="number" min={0} value={leaveTypeForm.max_carry_forward_days} onChange={(event) => setLeaveTypeForm((current) => ({ ...current, max_carry_forward_days: event.target.value }))} className={inputClass} />
                </FieldLabel>
              ) : null}
              <div className="md:col-span-2 grid gap-4 md:grid-cols-2">
                <Toggle checked={leaveTypeForm.encashment_allowed} onChange={(checked) => setLeaveTypeForm((current) => ({ ...current, encashment_allowed: checked }))} label="Encashment allowed" />
                <Toggle checked={leaveTypeForm.restrict_during_probation} onChange={(checked) => setLeaveTypeForm((current) => ({ ...current, restrict_during_probation: checked }))} label="Restrict during probation" />
                <Toggle checked={leaveTypeForm.requires_document} onChange={(checked) => setLeaveTypeForm((current) => ({ ...current, requires_document: checked }))} label="Requires document" description="Employee must upload a document when applying (e.g. medical certificate)" />
              </div>
              <FieldLabel label="Applicable after">
                <input type="number" min={0} value={leaveTypeForm.applicable_after_days} onChange={(event) => setLeaveTypeForm((current) => ({ ...current, applicable_after_days: event.target.value }))} className={inputClass} />
                <p className="mt-1 text-xs text-slate-500">Employee must work X days before this leave is available</p>
              </FieldLabel>
              <FieldLabel label="Minimum notice">
                <input type="number" min={0} value={leaveTypeForm.minimum_notice_days} onChange={(event) => setLeaveTypeForm((current) => ({ ...current, minimum_notice_days: event.target.value }))} className={inputClass} />
              </FieldLabel>
              <FieldLabel label="Maximum consecutive days">
                <input value={leaveTypeForm.maximum_consecutive_days} onChange={(event) => setLeaveTypeForm((current) => ({ ...current, maximum_consecutive_days: event.target.value }))} className={inputClass} />
              </FieldLabel>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setLeaveTypeModalOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => void saveLeaveType()} disabled={savingTab === "leave-type"} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {savingTab === "leave-type" ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {salaryTemplateModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => setSalaryTemplateModalOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Salary Template</h3>
            </div>
            <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
              <FieldLabel label="Department">
                <select value={salaryTemplateForm.department} onChange={(event) => setSalaryTemplateForm((current) => ({ ...current, department: event.target.value }))} className={inputClass}>
                  {departments.map((department) => <option key={department} value={department}>{department}</option>)}
                </select>
              </FieldLabel>
              <FieldLabel label="Basic %">
                <input type="number" min={0} value={salaryTemplateForm.basic_percent} onChange={(event) => setSalaryTemplateForm((current) => ({ ...current, basic_percent: event.target.value }))} className={inputClass} />
              </FieldLabel>
              <FieldLabel label="HRA % of basic">
                <input type="number" min={0} value={salaryTemplateForm.hra_percent} onChange={(event) => setSalaryTemplateForm((current) => ({ ...current, hra_percent: event.target.value }))} className={inputClass} />
              </FieldLabel>
              <FieldLabel label="Special allowance (₹/month fixed)">
                <input type="number" min={0} value={salaryTemplateForm.special_allowance} onChange={(event) => setSalaryTemplateForm((current) => ({ ...current, special_allowance: event.target.value }))} className={inputClass} />
              </FieldLabel>
              <div className="md:col-span-2 grid gap-4 md:grid-cols-2">
                <Toggle checked={salaryTemplateForm.pf_applicable} onChange={(checked) => setSalaryTemplateForm((current) => ({ ...current, pf_applicable: checked }))} label="PF applicable by default" />
                <Toggle checked={salaryTemplateForm.esi_applicable} onChange={(checked) => setSalaryTemplateForm((current) => ({ ...current, esi_applicable: checked }))} label="ESI applicable by default" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setSalaryTemplateModalOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => void saveSalaryTemplate()} disabled={savingTab === "salary-template"} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {savingTab === "salary-template" ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDryRun ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => setShowDryRun(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Leave Balance Initialization</h3>
            </div>
            <div className="p-5 space-y-4 text-sm text-slate-700">
              <p>This action will generate missing leave balances for the current year ({dryRunStats.targetYear}). Existing balances or deductions will not be overwritten.</p>
              <ul className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <li className="flex justify-between font-medium"><span className="text-slate-500">Total combinations:</span> <span>{dryRunStats.total}</span></li>
                <li className="flex justify-between font-medium"><span className="text-slate-500">Already initialized:</span> <span>{dryRunStats.existing}</span></li>
                <li className="flex justify-between font-medium"><span className="text-slate-500">New rows to create:</span> <span className="text-brand-600">{dryRunStats.new}</span></li>
                <li className="flex justify-between font-medium"><span className="text-slate-500">Rows overwritten:</span> <span className="text-emerald-600">0</span></li>
              </ul>
              {dryRunStats.new === 0 ? (
                <p className="text-emerald-600 font-semibold text-center">All leave balances are already up-to-date.</p>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setShowDryRun(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => void initializeLeaveBalances()} disabled={savingTab === "leave-balances" || dryRunStats.new === 0} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {savingTab === "leave-balances" ? "Processing..." : "Confirm Initialization"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
