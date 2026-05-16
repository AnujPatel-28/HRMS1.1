import type { FormEvent } from "react";
import { useState } from "react";
import { Building2, Globe, CreditCard, Mail, User, Users, CheckCircle, Copy, Check, AlertCircle } from "lucide-react";
import { db } from "../insforge/client";
import { insforge } from "../insforge/client";

const PLAN_CONFIG: Record<string, { label: string; maxEmployees: number; rate: string; colorClass: string; bgClass: string; borderClass: string; textClass: string }> = {
  trial: { label: "Trial", maxEmployees: 10, rate: "Free", colorClass: "text-amber-600", bgClass: "bg-amber-50", borderClass: "border-amber-200", textClass: "text-amber-700" },
  starter: { label: "Starter", maxEmployees: 25, rate: "₹99/user", colorClass: "text-brand-600", bgClass: "bg-brand-50", borderClass: "border-brand-200", textClass: "text-brand-700" },
  growth: { label: "Growth", maxEmployees: 100, rate: "₹149/user", colorClass: "text-purple-600", bgClass: "bg-purple-50", borderClass: "border-purple-200", textClass: "text-purple-700" },
  pro: { label: "Pro", maxEmployees: 9999, rate: "₹249/user", colorClass: "text-cyan-600", bgClass: "bg-cyan-50", borderClass: "border-cyan-200", textClass: "text-cyan-700" },
};

function generateTempPassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const rand = (str: string) => str[Math.floor(Math.random() * str.length)];
  const chars = [
    rand(upper), rand(upper),
    rand(lower), rand(lower), rand(lower), rand(lower),
    rand(digits), rand(digits),
  ];
  // Shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
}

function getErrorMessage(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return typeof err === "string" ? err : fallback;
}

interface SuccessData {
  companyName: string;
  subdomain: string;
  hrEmail: string;
  tempPassword: string;
  tenantId: string;
}

function SuccessScreen({ data, onReset }: { data: SuccessData; onReset: () => void }) {
  const [copied, setCopied] = useState(false);

  const credentialText = `TalentMesh HR Admin Credentials
================================
Company: ${data.companyName}
Login URL: https://${data.subdomain}.talentmesh.in
HR Admin Email: ${data.hrEmail}
Temporary Password: ${data.tempPassword}
================================
Note: Please change your password on first login.`;

  const handleCopy = () => {
    void navigator.clipboard.writeText(credentialText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Company Onboarded!</h1>
          <p className="text-sm text-slate-500">{data.companyName} is ready to use TalentMesh.</p>
        </div>
      </div>

      <div className="mb-6 overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
        <div className="bg-emerald-50 px-6 py-4">
          <h3 className="text-sm font-semibold text-emerald-800">Login Credentials</h3>
        </div>
        <div className="p-6">
          <dl className="divide-y divide-slate-100">
            <div className="flex flex-col py-3 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-sm font-medium text-slate-500">Login URL</dt>
              <dd className="mt-1 text-sm text-slate-900 sm:mt-0">
                <a href={`https://${data.subdomain}.talentmesh.in`} className="font-mono text-brand-600 hover:underline">
                  https://{data.subdomain}.talentmesh.in
                </a>
              </dd>
            </div>
            <div className="flex flex-col py-3 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-sm font-medium text-slate-500">HR Admin Email</dt>
              <dd className="mt-1 text-sm text-slate-900 sm:mt-0">{data.hrEmail}</dd>
            </div>
            <div className="flex flex-col py-3 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-sm font-medium text-slate-500">Temporary Password</dt>
              <dd className="mt-1 sm:mt-0">
                <span className="rounded bg-slate-100 px-2 py-1 font-mono text-sm tracking-widest text-slate-900">
                  {data.tempPassword}
                </span>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <AlertCircle className="h-5 w-5 text-amber-400" aria-hidden="true" />
          </div>
          <div className="ml-3">
            <p className="text-sm text-amber-700">
              Share these credentials with the HR admin. They should change their password on first login.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          onClick={handleCopy}
          className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            copied
              ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus:ring-brand-500"
          }`}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied!" : "Copy all credentials"}
        </button>
        <button
          onClick={onReset}
          className="inline-flex items-center justify-center rounded-lg border border-transparent bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          Add Another Company
        </button>
      </div>
    </div>
  );
}

export default function AddCompany() {
  const [companyName, setCompanyName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [subdomainManual, setSubdomainManual] = useState(false);
  const [plan, setPlan] = useState("trial");
  const [hrEmail, setHrEmail] = useState("");
  const [hrName, setHrName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessData | null>(null);
  const selectedPlan = PLAN_CONFIG[plan] ?? PLAN_CONFIG.trial;

  const handleCompanyNameChange = (val: string) => {
    setCompanyName(val);
    if (!subdomainManual) {
      setSubdomain(slugify(val));
    }
  };

  const handleSubdomainChange = (val: string) => {
    setSubdomain(val.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30));
    setSubdomainManual(true);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // 1. Validate subdomain uniqueness
      const cleanSubdomain = subdomain.trim();
      const { data: existing, error: existingErr } = await db.from("tenants").select("id").eq("subdomain", cleanSubdomain).maybeSingle();
      if (existingErr) {
        setError(existingErr.message);
        setSubmitting(false);
        return;
      }

      if (existing) {
        setError("This subdomain is already taken. Please choose another.");
        setSubmitting(false);
        return;
      }

      const maxEmployees = selectedPlan.maxEmployees;

      // 2. Insert new tenant
      const { data: newTenant, error: insertErr } = await db.from("tenants").insert([{
        company_name: companyName.trim(),
        subdomain: cleanSubdomain,
        plan,
        status: plan === "trial" ? "trial" : "active",
        max_employees: maxEmployees,
      }]).select("id").single();

      if (insertErr || !newTenant) {
        setError(insertErr?.message ?? "Failed to create company.");
        setSubmitting(false);
        return;
      }

      const tenantId = (newTenant as { id: string }).id;
      const tempPassword = generateTempPassword();

      // 3. Create HR admin user via edge function
      const { data: fnData, error: fnErr } = await insforge.functions.invoke("create-hr-admin-user", {
        body: {
          email: hrEmail.trim().toLowerCase(),
          name: hrName.trim(),
          tenant_id: tenantId,
          temp_password: tempPassword,
        },
      });

      if (fnErr || (fnData as Record<string, unknown>)?.error) {
        // Rollback tenant insert if user creation fails
        const rollback = await db.from("tenants").delete().eq("id", tenantId);
        const createMessage = (fnData as Record<string, unknown>)?.error as string ?? fnErr?.message ?? "Failed to create HR admin user.";
        const rollbackMessage = rollback.error ? ` The company record also could not be rolled back: ${rollback.error.message}` : "";
        setError(`${createMessage}${rollbackMessage}`);
        setSubmitting(false);
        return;
      }

      setSuccess({ companyName: companyName.trim(), subdomain: cleanSubdomain, hrEmail: hrEmail.trim().toLowerCase(), tempPassword, tenantId });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create company."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSuccess(null);
    setCompanyName("");
    setSubdomain("");
    setSubdomainManual(false);
    setPlan("trial");
    setHrEmail("");
    setHrName("");
    setError(null);
  };

  if (success) {
    return (
      <div className="mx-auto max-w-3xl">
        <SuccessScreen data={success} onReset={handleReset} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Add Company</h1>
        <p className="mt-1 text-sm text-slate-500">Onboard a new client company onto the TalentMesh platform.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
          
          {/* Company Name */}
          <div>
            <label className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
              <Building2 className="h-4 w-4 text-slate-400" />
              Company Name
            </label>
            <input
              type="text"
              required
              value={companyName}
              onChange={e => handleCompanyNameChange(e.target.value)}
              placeholder="Acme Corp"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-sm"
            />
          </div>

          {/* Subdomain */}
          <div>
            <label className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
              <Globe className="h-4 w-4 text-slate-400" />
              Subdomain
            </label>
            <div className="mt-1 flex rounded-lg shadow-sm">
              <span className="inline-flex items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 text-slate-500 sm:text-sm">
                https://
              </span>
              <input
                type="text"
                required
                value={subdomain}
                onChange={e => handleSubdomainChange(e.target.value)}
                placeholder="acme-corp"
                pattern="[a-z0-9-]+"
                className="block w-full min-w-0 flex-1 rounded-none border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-sm"
              />
              <span className="inline-flex items-center rounded-r-lg border border-l-0 border-slate-300 bg-slate-50 px-3 text-slate-500 sm:text-sm">
                .talentmesh.in
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Preview: {subdomain || "subdomain"}.talentmesh.in
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Plan */}
            <div>
              <label className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
                <CreditCard className="h-4 w-4 text-slate-400" />
                Plan
              </label>
              <select
                required
                value={plan}
                onChange={e => setPlan(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-sm"
              >
                {Object.entries(PLAN_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>
                    {cfg.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Max Employees */}
            <div>
              <label className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
                <Users className="h-4 w-4 text-slate-400" />
                Max Employees
              </label>
              <input
                type="text"
                readOnly
                value={selectedPlan.maxEmployees === 9999 ? "9999" : selectedPlan.maxEmployees}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-700 shadow-sm sm:text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* HR Admin email */}
            <div>
              <label className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
                <Mail className="h-4 w-4 text-slate-400" />
                HR Admin Email
              </label>
              <input
                type="email"
                required
                value={hrEmail}
                onChange={e => setHrEmail(e.target.value)}
                placeholder="hr@acmecorp.com"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-sm"
              />
            </div>

            {/* HR Admin name */}
            <div>
              <label className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
                <User className="h-4 w-4 text-slate-400" />
                HR Admin Name
              </label>
              <input
                type="text"
                required
                value={hrName}
                onChange={e => setHrName(e.target.value)}
                placeholder="Jane Smith"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-sm"
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <AlertCircle className="h-5 w-5 text-red-400" aria-hidden="true" />
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Error</h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>{error}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="pt-4">
            <button
              type="submit"
              disabled={submitting || !companyName.trim() || !subdomain.trim() || !hrEmail.trim() || !hrName.trim()}
              className="flex w-full justify-center rounded-lg border border-transparent bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:bg-brand-400"
            >
              {submitting ? "Onboarding Company..." : "Onboard Company"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
