import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useEmployee } from "../hooks/useEmployee";
import { insforge, db, storage } from "../insforge/client";

type Department = "sales" | "dev" | "marketing" | "operations" | "design" | "other";
type EmploymentType = "full_time" | "part_time" | "contract" | "intern";

type FormState = {
  full_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  gender: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  department: Department;
  designation: string;
  employee_code: string;
  date_of_joining: string;
  employment_type: EmploymentType;
  aadhaar_number: string;
  pan_number: string;
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relation: string;
};

type UploadedDoc = {
  label: string;
  url: string;
};

type Credentials = {
  email: string;
  password: string;
};

const initialState: FormState = {
  full_name: "",
  email: "",
  phone: "",
  date_of_birth: "",
  gender: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  department: "sales",
  designation: "",
  employee_code: "",
  date_of_joining: "",
  employment_type: "full_time",
  aadhaar_number: "",
  pan_number: "",
  bank_name: "",
  account_number: "",
  ifsc_code: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  emergency_contact_relation: "",
};

const stepTitles = [
  "Personal Info",
  "Job Info",
  "Identity & Bank",
  "Emergency Contact",
  "Review & Create",
] as const;

const makePassword = () => {
  const token = Math.random().toString(36).slice(-6);
  return `Tmp@${token}9A`;
};

const makeEmployeeCode = (department: Department, fullName: string) => {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase() ?? "")
    .join("") || "EM";

  const dep = department.slice(0, 3).toUpperCase();
  const unique = String(Math.floor(Math.random() * 9000) + 1000);
  return `${dep}-${initials}-${unique}`;
};

const normalizeNullable = (value: string) => value.trim() || null;

export default function EmployeeCreate() {
  const navigate = useNavigate();
  const { employee: hrEmployee } = useEmployee();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(initialState);
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const [aadhaarDoc, setAadhaarDoc] = useState<File | null>(null);
  const [panDoc, setPanDoc] = useState<File | null>(null);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [codeEdited, setCodeEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Prevents double-click: when Next is clicked, the Confirm & Create button
  // appears in the same DOM position — disable it briefly to absorb the extra click.
  const [justNavigated, setJustNavigated] = useState(false);

  const isLastStep = step === 5;

  const canMoveToNext = useMemo(() => {
    if (step === 1) {
      return Boolean(form.full_name.trim() && form.email.trim() && form.phone.trim());
    }
    if (step === 2) {
      return Boolean(form.department && form.designation.trim() && form.employee_code.trim() && form.date_of_joining);
    }
    if (step === 3) {
      return Boolean(form.aadhaar_number.trim() && form.pan_number.trim());
    }
    if (step === 4) {
      return Boolean(form.emergency_contact_name.trim() && form.emergency_contact_phone.trim());
    }
    return true;
  }, [step, form]);

  const handleChange = (field: keyof FormState, value: string) => {
    setForm((current) => {
      const next = { ...current, [field]: value };

      if ((field === "department" || field === "full_name") && !codeEdited) {
        next.employee_code = makeEmployeeCode(next.department, next.full_name);
      }

      return next;
    });
  };

  const handleEmployeeCode = (value: string) => {
    setCodeEdited(true);
    setForm((current) => ({ ...current, employee_code: value }));
  };

  const goNext = () => {
    if (!canMoveToNext || step >= 5) return;
    setError(null);
    setJustNavigated(true);
    setStep((current) => current + 1);
    // Disable submit button for 600 ms to absorb accidental double-clicks
    setTimeout(() => setJustNavigated(false), 600);
  };

  const goBack = () => {
    if (step <= 1) return;
    setError(null);
    setStep((current) => current - 1);
  };

  const uploadFileToEmployeeFolder = async (employeeId: string, file: File, label: string) => {
    const safeName = file.name.replace(/\s+/g, "-");
    const key = `employees/${employeeId}/${Date.now()}-${safeName}`;

    const result = await storage.from("employee-documents").upload(key, file);
    if (result.error || !result.data) {
      throw new Error(result.error?.message ?? `Unable to upload ${label}.`);
    }

    return { label, url: result.data.url };
  };

 const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  if (!isLastStep || submitting) return;

  setSubmitting(true);
  setError(null);

  try {
    // ── Pre-check: email must not already exist in employees table ──
    const emailCheck = await db
      .from("employees")
      .select("id")
      .eq("email", form.email.trim())
      .limit(1);
    if (emailCheck.data && emailCheck.data.length > 0) {
      throw new Error(`An employee with the email "${form.email.trim()}" already exists.`);
    }

    const tempPassword = makePassword();

    // ── Step 1: Create auth user via edge function (admin key, no 409 conflicts) ──
    const fnRes = await insforge.functions.invoke("create-employee-user", {
      body: {
        email: form.email.trim(),
        password: tempPassword,
        name: form.full_name.trim(),
      },
    });

    if (fnRes.error || !fnRes.data?.userId) {
      const serverMsg: string = fnRes.data?.error ?? fnRes.error?.message ?? "";
      throw new Error(serverMsg || "Failed to create auth account. Please try again.");
    }

    const userId = fnRes.data.userId as string;

    // ── Step 2: Insert employee record using the HR session (satisfies RLS) ──
    const insertRes = await db
      .from("employees")
      .insert([
        {
          user_id: userId,
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          phone: normalizeNullable(form.phone),
          date_of_birth: normalizeNullable(form.date_of_birth),
          gender: normalizeNullable(form.gender),
          address: normalizeNullable(form.address),
          city: normalizeNullable(form.city),
          state: normalizeNullable(form.state),
          pincode: normalizeNullable(form.pincode),
          department: form.department,
          designation: normalizeNullable(form.designation),
          employee_code: normalizeNullable(form.employee_code),
          date_of_joining: normalizeNullable(form.date_of_joining),
          employment_type: form.employment_type,
          aadhaar_number: normalizeNullable(form.aadhaar_number),
          pan_number: normalizeNullable(form.pan_number),
          bank_name: normalizeNullable(form.bank_name),
          account_number: normalizeNullable(form.account_number),
          ifsc_code: normalizeNullable(form.ifsc_code),
          emergency_contact_name: normalizeNullable(form.emergency_contact_name),
          emergency_contact_phone: normalizeNullable(form.emergency_contact_phone),
          emergency_contact_relation: normalizeNullable(form.emergency_contact_relation),
          created_by: hrEmployee?.id ?? null,
        },
      ])
      .select("id")
      .single();

    if (insertRes.error || !insertRes.data?.id) {
      throw new Error(
        insertRes.error?.message ??
        "Employee profile could not be saved. The auth account was created — please delete it from InsForge Auth and try again."
      );
    }

    const employeeId = insertRes.data.id as string;
    const docs: UploadedDoc[] = [];

    // ── Step 3: Upload documents (optional) ──
    if (profilePhoto) {
      const uploaded = await uploadFileToEmployeeFolder(employeeId, profilePhoto, "Profile Photo");
      docs.push(uploaded);
      await db.from("employees").update({ profile_photo_url: uploaded.url }).eq("id", employeeId);
    }
    if (aadhaarDoc) docs.push(await uploadFileToEmployeeFolder(employeeId, aadhaarDoc, "Aadhaar"));
    if (panDoc) docs.push(await uploadFileToEmployeeFolder(employeeId, panDoc, "PAN"));

    setUploadedDocs(docs);
    setCredentials({ email: form.email.trim(), password: tempPassword });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
    setError(message);
  } finally {
    setSubmitting(false);
  }
};



    




  const copyCredentials = async () => {
    if (!credentials) return;
    const payload = `Email: ${credentials.email}\nTemporary Password: ${credentials.password}`;
    await navigator.clipboard.writeText(payload);
  };

  const sendViaEmailHref = credentials
    ? `mailto:${credentials.email}?subject=${encodeURIComponent("Your TalentMesh HRMS Login Credentials")}&body=${encodeURIComponent(`Welcome to TalentMesh HRMS.%0D%0A%0D%0AEmail: ${credentials.email}%0D%0ATemporary Password: ${credentials.password}%0D%0A%0D%0APlease sign in and change your password after first login.`)}`
    : "#";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Create Employee</h2>
          <p className="text-sm text-slate-500">Step {step} of 5 � {stepTitles[step - 1]}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/hr/employees")}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          Back to list
        </button>
      </div>

      <div className="mb-5 grid grid-cols-5 gap-2">
        {stepTitles.map((label, index) => {
          const stepNo = index + 1;
          const completed = stepNo < step;
          const current = stepNo === step;
          return (
            <div
              key={label}
              className={`rounded-lg border px-2 py-2 text-center text-xs font-semibold ${
                completed
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : current
                    ? "border-brand-200 bg-brand-50 text-brand-700"
                    : "border-slate-200 bg-slate-50 text-slate-500"
              }`}
            >
              {label}
            </div>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {step === 1 ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Full Name *</span>
              <input
                value={form.full_name}
                onChange={(event) => handleChange("full_name", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Email *</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => handleChange("email", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Phone *</span>
              <input
                value={form.phone}
                onChange={(event) => handleChange("phone", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Date of Birth</span>
              <input
                type="date"
                value={form.date_of_birth}
                onChange={(event) => handleChange("date_of_birth", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
              />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-slate-600">Gender</span>
              <select
                value={form.gender}
                onChange={(event) => handleChange("gender", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
              >
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-slate-600">Address</span>
              <textarea
                value={form.address}
                onChange={(event) => handleChange("address", event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">City</span>
              <input
                value={form.city}
                onChange={(event) => handleChange("city", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">State</span>
              <input
                value={form.state}
                onChange={(event) => handleChange("state", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Pincode</span>
              <input
                value={form.pincode}
                onChange={(event) => handleChange("pincode", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
              />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-slate-600">Profile Photo</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setProfilePhoto(event.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Department *</span>
              <select
                value={form.department}
                onChange={(event) => handleChange("department", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                required
              >
                <option value="sales">Sales</option>
                <option value="dev">Development</option>
                <option value="marketing">Marketing</option>
                <option value="operations">Operations</option>
                <option value="design">Design</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Designation *</span>
              <input
                value={form.designation}
                onChange={(event) => handleChange("designation", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Employee Code *</span>
              <input
                value={form.employee_code}
                onChange={(event) => handleEmployeeCode(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Date of Joining *</span>
              <input
                type="date"
                value={form.date_of_joining}
                onChange={(event) => handleChange("date_of_joining", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                required
              />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-slate-600">Employment Type</span>
              <select
                value={form.employment_type}
                onChange={(event) => handleChange("employment_type", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
              >
                <option value="full_time">Full Time</option>
                <option value="part_time">Part Time</option>
                <option value="contract">Contract</option>
                <option value="intern">Intern</option>
              </select>
            </label>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Aadhaar Number *</span>
              <input
                value={form.aadhaar_number}
                onChange={(event) => handleChange("aadhaar_number", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">PAN Number *</span>
              <input
                value={form.pan_number}
                onChange={(event) => handleChange("pan_number", event.target.value.toUpperCase())}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Upload Aadhaar Document</span>
              <input
                type="file"
                onChange={(event) => setAadhaarDoc(event.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Upload PAN Document</span>
              <input
                type="file"
                onChange={(event) => setPanDoc(event.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Bank Name</span>
              <input
                value={form.bank_name}
                onChange={(event) => handleChange("bank_name", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Account Number</span>
              <input
                value={form.account_number}
                onChange={(event) => handleChange("account_number", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
              />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-slate-600">IFSC Code</span>
              <input
                value={form.ifsc_code}
                onChange={(event) => handleChange("ifsc_code", event.target.value.toUpperCase())}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
              />
            </label>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-slate-600">Emergency Contact Name *</span>
              <input
                value={form.emergency_contact_name}
                onChange={(event) => handleChange("emergency_contact_name", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Emergency Contact Phone *</span>
              <input
                value={form.emergency_contact_phone}
                onChange={(event) => handleChange("emergency_contact_phone", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Relationship</span>
              <input
                value={form.emergency_contact_relation}
                onChange={(event) => handleChange("emergency_contact_relation", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-brand-600 focus:ring"
              />
            </label>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
            {Object.entries(form).map(([key, value]) => (
              <div key={key} className="text-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">{key.replace(/_/g, " ")}</p>
                <p className="font-medium text-slate-900">{value || "�"}</p>
              </div>
            ))}
            <div className="text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">Profile Photo</p>
              <p className="font-medium text-slate-900">{profilePhoto?.name ?? "Not uploaded"}</p>
            </div>
            <div className="text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">Aadhaar / PAN Docs</p>
              <p className="font-medium text-slate-900">{aadhaarDoc?.name ?? "No Aadhaar doc"} / {panDoc?.name ?? "No PAN doc"}</p>
            </div>
          </div>
        ) : null}

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
            <span className="mt-0.5 shrink-0 text-rose-500">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-rose-700">Could not create employee</p>
              <p className="mt-0.5 text-sm text-rose-600">{error}</p>
            </div>
            <button type="button" onClick={() => setError(null)} className="shrink-0 rounded p-0.5 hover:bg-rose-100 text-rose-400 hover:text-rose-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1 || submitting}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Previous
          </button>

          {isLastStep ? (
            <button
              type="submit"
              disabled={submitting || justNavigated}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Creating employee..." : "Confirm & Create"}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!canMoveToNext || submitting}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Next
            </button>
          )}
        </div>
      </form>

      {credentials ? (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="text-base font-semibold text-emerald-900">Employee created successfully</h3>
          <p className="mt-1 text-sm text-emerald-800">Share these login credentials with the employee:</p>
          <div className="mt-3 rounded-lg bg-white p-3 text-sm">
            <p><span className="font-semibold">Email:</span> {credentials.email}</p>
            <p><span className="font-semibold">Temp Password:</span> {credentials.password}</p>
          </div>

          {uploadedDocs.length > 0 ? (
            <div className="mt-3 text-sm text-emerald-900">
              <p className="font-semibold">Uploaded documents</p>
              <ul className="mt-1 space-y-1">
                {uploadedDocs.map((doc) => (
                  <li key={doc.url}>
                    <a href={doc.url} target="_blank" rel="noreferrer" className="underline hover:no-underline">
                      {doc.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void copyCredentials();
              }}
              className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
            >
              Copy credentials
            </button>
            <a
              href={sendViaEmailHref}
              className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
            >
              Send via email
            </a>
            <button
              type="button"
              onClick={() => navigate("/hr/employees")}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Go to employee list
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
