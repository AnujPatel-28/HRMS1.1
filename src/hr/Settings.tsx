import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Bell, CalendarDays, Clock, ImagePlus, Save, Settings as SettingsIcon, ShieldCheck, Filter } from "lucide-react";
import { db, storage } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import { useAuditLog } from "../hooks/useAuditLog";
import { Skeleton } from "../shared/Skeleton";
import { useToast } from "../shared/ToastContext";

type TabKey = "profile" | "attendance" | "leave" | "notifications" | "audit";

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

type LeaveSettings = {
  leave_casual_per_year: string;
  leave_sick_per_year: string;
  leave_earned_per_year: string;
  leave_carry_forward: boolean;
  leave_min_notice_days: string;
};

type NotificationSettings = {
  email_on_punch_in: boolean;
  email_on_punch_out: boolean;
  email_on_leave_request: boolean;
  email_on_task_submit: boolean;
  hr_notification_email: string;
};

const tabs: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "profile", label: "Company Profile", icon: Building2 },
  { key: "attendance", label: "Attendance Rules", icon: Clock },
  { key: "leave", label: "Leave Policy", icon: CalendarDays },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "audit", label: "Audit Log", icon: ShieldCheck },
];

function getFriendlyActionLabel(action: string) {
  const map: Record<string, string> = {
    "employee.created": "Created employee profile",
    "employee.updated": "Updated employee profile",
    "employee.terminated": "Terminated employee",
    "leave.approved": "Approved leave request",
    "leave.rejected": "Rejected leave request",
    "task.approved": "Approved task",
    "task.rejected": "Rejected task",
    "punch_in": "Punched in",
    "punch_out": "Punched out",
    "policy.uploaded": "Uploaded HR policy",
    "policy.deleted": "Deleted HR policy",
    "payroll.approved": "Approved payroll run",
    "settings.updated": "Updated tenant settings",
    "login.success": "Logged in successfully",
    "login.failed": "Failed login attempt",
  };
  return map[action] || action;
}

function AuditLogsTab({ tenantId }: { tenantId: string }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState("all");
  
  useEffect(() => {
    let active = true;
    const fetchLogs = async () => {
      setLoading(true);
      const { data: logsData } = await db.from("audit_logs").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100);
      if (!active) return;
      
      const actorIds = Array.from(new Set((logsData ?? []).map((l: any) => l.actor_id).filter(Boolean)));
      let employeesMap: Record<string, any> = {};
      if (actorIds.length > 0) {
        const { data: emps } = await db.from("employees").select("id, full_name, email").eq("tenant_id", tenantId).in("id", actorIds);
        if (emps) {
          emps.forEach((e: any) => employeesMap[e.id] = e);
        }
      }
      
      setLogs((logsData ?? []).map((l: any) => ({ ...l, actor: employeesMap[l.actor_id] })));
      setLoading(false);
    };
    void fetchLogs();
    return () => { active = false; };
  }, [tenantId]);

  const filteredLogs = logs.filter(l => filterAction === "all" || l.action === filterAction);

  const actions = Array.from(new Set(logs.map(l => l.action)));

  if (loading) return <div className="p-10 flex justify-center"><Skeleton className="h-8 w-8 rounded-full" /></div>;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">Security Audit Log</h3>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select value={filterAction} onChange={e => setFilterAction(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none ring-brand-600 focus:ring">
            <option value="all">All Actions</option>
            {actions.map(a => <option key={a} value={a}>{getFriendlyActionLabel(a)}</option>)}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="min-w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-xs uppercase tracking-wide sticky top-0">
            <tr>
              <th className="px-5 py-3">Timestamp</th>
              <th className="px-5 py-3">Actor</th>
              <th className="px-5 py-3">Action</th>
              <th className="px-5 py-3">Target</th>
              <th className="px-5 py-3 max-w-[200px]">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredLogs.map(l => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                  {new Date(l.created_at).toLocaleString("en-IN", { day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit"})}
                </td>
                <td className="px-5 py-3">
                  <p className="font-medium text-slate-900">{l.actor?.full_name ?? "System / Unknown"}</p>
                  <p className="text-xs text-slate-500 capitalize">{l.actor_role}</p>
                </td>
                <td className="px-5 py-3">
                  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {getFriendlyActionLabel(l.action)}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-600 capitalize">
                  {l.target_type ? `${l.target_type}` : "—"}
                </td>
                <td className="px-5 py-3 text-xs text-slate-500 max-w-[200px] truncate" title={l.details ? JSON.stringify(l.details) : ""}>
                  {l.details ? JSON.stringify(l.details) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredLogs.length === 0 && <div className="p-10 text-center text-slate-500">No logs found.</div>}
      </div>
    </div>
  );
}

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

const defaultLeaveSettings: LeaveSettings = {
  leave_casual_per_year: "12",
  leave_sick_per_year: "6",
  leave_earned_per_year: "15",
  leave_carry_forward: false,
  leave_min_notice_days: "1",
};

const defaultNotificationSettings: NotificationSettings = {
  email_on_punch_in: false,
  email_on_punch_out: false,
  email_on_leave_request: true,
  email_on_task_submit: true,
  hr_notification_email: "",
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
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-brand-600" />
        <span className="absolute left-1 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-brand-600 focus:ring";

export default function HRSettings() {
  const { tenantId, refreshTenant } = useTenant();
  const { logAction } = useAuditLog();
  const { success, error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>("profile");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<TabKey | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [tenantForm, setTenantForm] = useState<TenantForm>(defaultTenantForm);
  const [leaveSettings, setLeaveSettings] = useState<LeaveSettings>(defaultLeaveSettings);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(defaultNotificationSettings);

  const logoPreview = useMemo(() => {
    if (logoFile) return URL.createObjectURL(logoFile);
    return tenantForm.logo_url || "";
  }, [logoFile, tenantForm.logo_url]);

  useEffect(() => {
    return () => {
      if (logoPreview.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  const loadSettings = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [tenantRes, settingsRes] = await Promise.all([
        db.from("tenants").select(tenantColumns).eq("id", tenantId).maybeSingle(),
        db.from("tenant_settings").select("key,value").eq("tenant_id", tenantId),
      ]);

      if (tenantRes.error) throw tenantRes.error;
      if (settingsRes.error) throw settingsRes.error;

      const tenant = tenantRes.data as Partial<TenantForm> | null;
      const settings = settingMap((settingsRes.data ?? []) as { key: string; value: string }[]);

      setTenantForm({
        company_name: String(tenant?.company_name ?? defaultTenantForm.company_name),
        logo_url: String(tenant?.logo_url ?? ""),
        timezone: String(tenant?.timezone ?? defaultTenantForm.timezone),
        punch_in_start: normalizeTime(tenant?.punch_in_start, defaultTenantForm.punch_in_start),
        punch_in_cutoff: normalizeTime(tenant?.punch_in_cutoff, defaultTenantForm.punch_in_cutoff),
        work_hours_per_day: String(tenant?.work_hours_per_day ?? defaultTenantForm.work_hours_per_day),
        lunch_break_minutes: String(tenant?.lunch_break_minutes ?? defaultTenantForm.lunch_break_minutes),
        punch_out_gate_enabled: tenant?.punch_out_gate_enabled ?? defaultTenantForm.punch_out_gate_enabled,
      });

      setLeaveSettings({
        leave_casual_per_year: settings.leave_casual_per_year ?? defaultLeaveSettings.leave_casual_per_year,
        leave_sick_per_year: settings.leave_sick_per_year ?? defaultLeaveSettings.leave_sick_per_year,
        leave_earned_per_year: settings.leave_earned_per_year ?? defaultLeaveSettings.leave_earned_per_year,
        leave_carry_forward: boolValue(settings.leave_carry_forward, defaultLeaveSettings.leave_carry_forward),
        leave_min_notice_days: settings.leave_min_notice_days ?? defaultLeaveSettings.leave_min_notice_days,
      });

      setNotificationSettings({
        email_on_punch_in: boolValue(settings.email_on_punch_in, defaultNotificationSettings.email_on_punch_in),
        email_on_punch_out: boolValue(settings.email_on_punch_out, defaultNotificationSettings.email_on_punch_out),
        email_on_leave_request: boolValue(settings.email_on_leave_request, defaultNotificationSettings.email_on_leave_request),
        email_on_task_submit: boolValue(settings.email_on_task_submit, defaultNotificationSettings.email_on_task_submit),
        hr_notification_email: settings.hr_notification_email ?? defaultNotificationSettings.hr_notification_email,
      });
    } catch (err) {
      console.error(err);
      toastError("Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toastError]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function uploadLogo() {
    if (!logoFile || !tenantId) return tenantForm.logo_url || null;
    const ext = logoFile.name.split(".").pop() || "png";
    const path = `${tenantId}/logo-${Date.now()}.${ext}`;
    const { error: uploadError } = await storage.from("company-assets").upload(path, logoFile);
    if (uploadError) throw uploadError;
    return storage.from("company-assets").getPublicUrl(path);
  }

  async function saveCompanyProfile() {
    if (!tenantId) return;
    setSaving("profile");
    try {
      const logoUrl = await uploadLogo();
      const { error: updateError } = await db
        .from("tenants")
        .update({
          company_name: tenantForm.company_name.trim(),
          logo_url: logoUrl,
          timezone: tenantForm.timezone,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tenantId);
      if (updateError) throw updateError;
      setTenantForm((current) => ({ ...current, logo_url: logoUrl ?? "" }));
      setLogoFile(null);
      await refreshTenant();
      void logAction("settings.updated", "tenant", tenantId, { section: "profile" });
      success("Company profile saved.");
    } catch (err) {
      console.error(err);
      toastError("Failed to save company profile.");
    } finally {
      setSaving(null);
    }
  }

  async function saveAttendanceRules() {
    if (!tenantId) return;
    setSaving("attendance");
    try {
      const { error: updateError } = await db
        .from("tenants")
        .update({
          punch_in_start: tenantForm.punch_in_start,
          punch_in_cutoff: tenantForm.punch_in_cutoff,
          work_hours_per_day: Number(tenantForm.work_hours_per_day || defaultTenantForm.work_hours_per_day),
          lunch_break_minutes: Number(tenantForm.lunch_break_minutes || defaultTenantForm.lunch_break_minutes),
          punch_out_gate_enabled: tenantForm.punch_out_gate_enabled,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tenantId);
      if (updateError) throw updateError;
      await refreshTenant();
      void logAction("settings.updated", "tenant", tenantId, { section: "attendance" });
      success("Attendance rules saved.");
    } catch (err) {
      console.error(err);
      toastError("Failed to save attendance rules.");
    } finally {
      setSaving(null);
    }
  }

  async function saveSettingRows(rows: { key: string; value: string }[], message: string, tab: TabKey) {
    if (!tenantId) return;
    setSaving(tab);
    try {
      const payload = rows.map((row) => ({
        tenant_id: tenantId,
        key: row.key,
        value: row.value,
        updated_at: new Date().toISOString(),
      }));
      const { error: upsertError } = await db
        .from("tenant_settings")
        .upsert(payload, { onConflict: "tenant_id,key" });
      if (upsertError) throw upsertError;
      void logAction("settings.updated", "tenant", tenantId, { section: tab });
      success(message);
    } catch (err) {
      console.error(err);
      toastError("Failed to save settings.");
    } finally {
      setSaving(null);
    }
  }

  function saveLeavePolicy() {
    return saveSettingRows(
      [
        { key: "leave_casual_per_year", value: leaveSettings.leave_casual_per_year },
        { key: "leave_sick_per_year", value: leaveSettings.leave_sick_per_year },
        { key: "leave_earned_per_year", value: leaveSettings.leave_earned_per_year },
        { key: "leave_carry_forward", value: String(leaveSettings.leave_carry_forward) },
        { key: "leave_min_notice_days", value: leaveSettings.leave_min_notice_days },
      ],
      "Leave policy saved.",
      "leave",
    );
  }

  function saveNotifications() {
    return saveSettingRows(
      [
        { key: "email_on_punch_in", value: String(notificationSettings.email_on_punch_in) },
        { key: "email_on_punch_out", value: String(notificationSettings.email_on_punch_out) },
        { key: "email_on_leave_request", value: String(notificationSettings.email_on_leave_request) },
        { key: "email_on_task_submit", value: String(notificationSettings.email_on_task_submit) },
        { key: "hr_notification_email", value: notificationSettings.hr_notification_email.trim() },
      ],
      "Notification settings saved.",
      "notifications",
    );
  }

  if (loading) {
    return (
      <section className="space-y-5">
        <Skeleton className="h-16 w-72" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <SettingsIcon className="h-5 w-5 text-brand-600" />
          Settings
        </h2>
        <p className="text-sm text-slate-500">Manage company-wide configuration for the current tenant.</p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`inline-flex min-w-fit flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
              activeTab === key ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div className="space-y-4">
              <FieldLabel label="Company name">
                <input
                  value={tenantForm.company_name}
                  onChange={(event) => setTenantForm((current) => ({ ...current, company_name: event.target.value }))}
                  className={inputClass}
                />
              </FieldLabel>
              <FieldLabel label="Timezone">
                <select
                  value={tenantForm.timezone}
                  onChange={(event) => setTenantForm((current) => ({ ...current, timezone: event.target.value }))}
                  className={inputClass}
                >
                  <option value="Asia/Kolkata">Asia/Kolkata</option>
                </select>
              </FieldLabel>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">More timezones coming soon.</p>
              <button
                type="button"
                onClick={() => void saveCompanyProfile()}
                disabled={saving === "profile"}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving === "profile" ? "Saving..." : "Save Company Profile"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "attendance" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <FieldLabel label="Employees can punch in from this time">
              <input
                type="time"
                value={tenantForm.punch_in_start}
                onChange={(event) => setTenantForm((current) => ({ ...current, punch_in_start: event.target.value }))}
                className={inputClass}
              />
            </FieldLabel>
            <FieldLabel label="Employees punching in after this time are marked as half day">
              <input
                type="time"
                value={tenantForm.punch_in_cutoff}
                onChange={(event) => setTenantForm((current) => ({ ...current, punch_in_cutoff: event.target.value }))}
                className={inputClass}
              />
            </FieldLabel>
            <FieldLabel label="Expected working hours per full day">
              <input
                type="number"
                min={1}
                max={16}
                value={tenantForm.work_hours_per_day}
                onChange={(event) => setTenantForm((current) => ({ ...current, work_hours_per_day: event.target.value }))}
                className={inputClass}
              />
            </FieldLabel>
            <FieldLabel label="Assumed lunch break (subtracted from total work hours)">
              <input
                type="number"
                min={0}
                max={120}
                value={tenantForm.lunch_break_minutes}
                onChange={(event) => setTenantForm((current) => ({ ...current, lunch_break_minutes: event.target.value }))}
                className={inputClass}
              />
            </FieldLabel>
            <div className="md:col-span-2">
              <Toggle
                checked={tenantForm.punch_out_gate_enabled}
                onChange={(checked) => setTenantForm((current) => ({ ...current, punch_out_gate_enabled: checked }))}
                label="Require task approval before employees can punch out"
                description="When enabled, employees cannot punch out until HR approves their assigned task for the day."
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void saveAttendanceRules()}
            disabled={saving === "attendance"}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving === "attendance" ? "Saving..." : "Save Attendance Rules"}
          </button>
        </div>
      )}

      {activeTab === "leave" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-3">
            <FieldLabel label="Casual leaves per year">
              <input type="number" min={0} value={leaveSettings.leave_casual_per_year} onChange={(event) => setLeaveSettings((current) => ({ ...current, leave_casual_per_year: event.target.value }))} className={inputClass} />
            </FieldLabel>
            <FieldLabel label="Sick leaves per year">
              <input type="number" min={0} value={leaveSettings.leave_sick_per_year} onChange={(event) => setLeaveSettings((current) => ({ ...current, leave_sick_per_year: event.target.value }))} className={inputClass} />
            </FieldLabel>
            <FieldLabel label="Earned leaves per year">
              <input type="number" min={0} value={leaveSettings.leave_earned_per_year} onChange={(event) => setLeaveSettings((current) => ({ ...current, leave_earned_per_year: event.target.value }))} className={inputClass} />
            </FieldLabel>
            <FieldLabel label="Minimum notice days for leave">
              <input type="number" min={0} value={leaveSettings.leave_min_notice_days} onChange={(event) => setLeaveSettings((current) => ({ ...current, leave_min_notice_days: event.target.value }))} className={inputClass} />
            </FieldLabel>
            <div className="md:col-span-2">
              <Toggle
                checked={leaveSettings.leave_carry_forward}
                onChange={(checked) => setLeaveSettings((current) => ({ ...current, leave_carry_forward: checked }))}
                label="Allow leave carry forward"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void saveLeavePolicy()}
            disabled={saving === "leave"}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving === "leave" ? "Saving..." : "Save Leave Policy"}
          </button>
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-3">
            <Toggle checked={notificationSettings.email_on_punch_in} onChange={(checked) => setNotificationSettings((current) => ({ ...current, email_on_punch_in: checked }))} label="Email when employee punches in" />
            <Toggle checked={notificationSettings.email_on_punch_out} onChange={(checked) => setNotificationSettings((current) => ({ ...current, email_on_punch_out: checked }))} label="Email when employee punches out" />
            <Toggle checked={notificationSettings.email_on_leave_request} onChange={(checked) => setNotificationSettings((current) => ({ ...current, email_on_leave_request: checked }))} label="Email when leave request submitted" />
            <Toggle checked={notificationSettings.email_on_task_submit} onChange={(checked) => setNotificationSettings((current) => ({ ...current, email_on_task_submit: checked }))} label="Email when task submitted" />
            <FieldLabel label="HR email for notifications">
              <input
                type="email"
                value={notificationSettings.hr_notification_email}
                onChange={(event) => setNotificationSettings((current) => ({ ...current, hr_notification_email: event.target.value }))}
                className={inputClass}
              />
            </FieldLabel>
          </div>
          <button
            type="button"
            onClick={() => void saveNotifications()}
            disabled={saving === "notifications"}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving === "notifications" ? "Saving..." : "Save Notifications"}
          </button>
        </div>
      )}

      {activeTab === "audit" && tenantId && (
        <AuditLogsTab tenantId={tenantId} />
      )}
    </section>
  );
}
