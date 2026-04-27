import { useState } from "react";
import { Eye, EyeOff, MessageCircle } from "lucide-react";
import { useEmployee } from "../hooks/useEmployee";
import { Skeleton } from "../shared/Skeleton";

function MaskedField({ value, label }: { value: string | null; label: string }) {
  const [shown, setShown] = useState(false);
  const masked = value ? ("•".repeat(Math.max(0, value.length - 4)) + value.slice(-4)) : "—";
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-slate-900 font-mono">{shown ? (value ?? "—") : masked}</p>
        {value && (
          <button onClick={() => setShown(!shown)} className="text-slate-400 hover:text-slate-600 transition">
            {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-slate-900 capitalize">{value || "—"}</p>
    </div>
  );
}

export default function MyProfile() {
  const { employee } = useEmployee();
  const [showContact, setShowContact] = useState(false);

  if (!employee) return (
    <div className="space-y-6">
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-96 w-full rounded-2xl" />
    </div>
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">My Profile</h2>
          <p className="text-sm text-slate-500">Your personal and job information on file.</p>
        </div>
        <button
          onClick={() => setShowContact(!showContact)}
          className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 transition">
          <MessageCircle className="h-4 w-4" /> Request Update
        </button>
      </div>

      {showContact && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          📧 Please contact HR to update your information.
        </div>
      )}

      {/* Avatar & Basic */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {employee.profile_photo_url ? (
          <img src={employee.profile_photo_url} alt="" className="h-24 w-24 rounded-2xl object-cover shadow-sm ring-2 ring-brand-100" />
        ) : (
          <div className="grid h-24 w-24 place-items-center rounded-2xl bg-brand-100 text-2xl font-bold text-brand-700 shadow-sm">
            {employee.full_name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1">
          <h3 className="text-2xl font-bold text-slate-900">{employee.full_name}</h3>
          <p className="text-slate-500 mt-0.5">{employee.designation ?? "—"}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {employee.department && (
              <span className="rounded-full bg-brand-100 text-brand-700 px-3 py-1 text-xs font-semibold capitalize">{employee.department}</span>
            )}
            {employee.employment_type && (
              <span className="rounded-full bg-slate-100 text-slate-600 px-3 py-1 text-xs font-semibold capitalize">{employee.employment_type.replace("_", " ")}</span>
            )}
            <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${employee.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-600"}`}>
              {employee.status}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Personal Info */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Personal Information</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Full Name" value={employee.full_name} />
            <Field label="Email" value={employee.email} />
            <Field label="Phone" value={employee.phone} />
            <Field label="Gender" value={employee.gender} />
            <Field label="Date of Birth" value={employee.date_of_birth} />
            <Field label="City" value={employee.city} />
            <Field label="State" value={employee.state} />
            <Field label="Pincode" value={employee.pincode} />
            <div className="col-span-2"><Field label="Address" value={employee.address} /></div>
          </div>
        </div>

        {/* Job Info */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Job Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee Code" value={employee.employee_code} />
            <Field label="Department" value={employee.department} />
            <Field label="Designation" value={employee.designation} />
            <Field label="Employment Type" value={employee.employment_type?.replace("_", " ")} />
            <Field label="Date of Joining" value={employee.date_of_joining} />
            <Field label="Status" value={employee.status} />
          </div>
        </div>

        {/* Sensitive */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Identity Documents</h3>
          <div className="grid grid-cols-2 gap-4">
            <MaskedField label="Aadhaar Number" value={employee.aadhaar_number} />
            <MaskedField label="PAN Number" value={employee.pan_number} />
          </div>
        </div>

        {/* Bank */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Bank Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Bank Name" value={employee.bank_name} />
            <Field label="IFSC Code" value={employee.ifsc_code} />
            <MaskedField label="Account Number" value={employee.account_number} />
          </div>
        </div>

        {/* Emergency Contact */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Emergency Contact</h3>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Name" value={employee.emergency_contact_name} />
            <Field label="Phone" value={employee.emergency_contact_phone} />
            <Field label="Relation" value={employee.emergency_contact_relation} />
          </div>
        </div>
      </div>
    </section>
  );
}
