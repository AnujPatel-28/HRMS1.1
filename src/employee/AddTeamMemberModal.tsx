import { useState } from "react";
import { X, UserPlus } from "lucide-react";
import { db } from "../insforge/client";
import { useAuth } from "../hooks/useAuth";
import { useTenant } from "../contexts/TenantContext";
import { useToast } from "../shared/ToastContext";
import { useOrgStructure } from "../hooks/useOrgStructure";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function AddTeamMemberModal({ onClose, onCreated }: Props) {
  const { currentEmployee } = useAuth();
  const { tenantId } = useTenant();
  const { success, error } = useToast();
  const { jobTitles } = useOrgStructure();

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    job_title_id: "",
    date_of_joining: "",
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentEmployee?.id || !tenantId) return;
    if (!form.full_name.trim() || !form.email.trim() || !form.job_title_id) {
      error("Name, email, and job title are required.");
      return;
    }

    setSubmitting(true);
    try {
      // Check email uniqueness within tenant
      const { data: existing } = await db
        .from("employees")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("email", form.email.trim().toLowerCase())
        .limit(1);

      if (existing && existing.length > 0) {
        error("An employee with this email already exists.");
        setSubmitting(false);
        return;
      }

      const { error: insertErr } = await db.from("employees").insert([{
        tenant_id: tenantId,
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        job_title_id: form.job_title_id,
        date_of_joining: form.date_of_joining || null,
        status: "inactive",
        manager_id: currentEmployee.id,
        user_id: null,
      }]);

      if (insertErr) throw insertErr;

      // Insert notification
      await db.from("notifications").insert([{
        tenant_id: tenantId,
        employee_id: currentEmployee.id, // self-reference as placeholder or HR notification
        title: "New Team Member Draft Created",
        body: `${currentEmployee.full_name} added ${form.full_name.trim()} as a draft. Please review and activate.`,
        type: "general",
        reference_id: null,
      }]);

      success(`${form.full_name.trim()} added as a draft. HR has been notified.`);
      onCreated();
      onClose();
    } catch (err: any) {
      error(err.message || "Failed to add team member.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-semibold text-slate-900">Add Team Member</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <p className="text-sm text-slate-500">
            Fill in the basics. HR will complete the rest (salary, KYC, documents) and activate the account.
          </p>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Full Name *
            </label>
            <input
              required
              value={form.full_name}
              onChange={(e) => setForm(p => ({ ...p, full_name: e.target.value }))}
              placeholder="e.g. Priya Sharma"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Work Email *
            </label>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))}
              placeholder="priya@company.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Role / Designation *
            </label>
            {/* A picker, not free text: employees.designation was dropped (06 §5 step 6), so a
                title only exists as a job_titles row. */}
            <select
              required
              value={form.job_title_id}
              onChange={(e) => setForm(p => ({ ...p, job_title_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 bg-white"
            >
              <option value="">Select a job title…</option>
              {jobTitles.map((jobTitle) => (
                <option key={jobTitle.id} value={jobTitle.id}>{jobTitle.title}</option>
              ))}
            </select>
            {jobTitles.length === 0 && (
              <span className="mt-1 block text-[11px] text-amber-600">
                No job titles exist yet — ask HR to add them under Organisation Structure.
              </span>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Expected Joining Date
            </label>
            <input
              type="date"
              value={form.date_of_joining}
              onChange={(e) => setForm(p => ({ ...p, date_of_joining: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {submitting ? "Adding..." : "Add to Team"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
