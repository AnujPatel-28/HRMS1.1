import type { FormEvent } from "react";
import { useState } from "react";
import { Building2, Globe, CreditCard, Mail, User, Users, CheckCircle, Copy, Check, AlertCircle, Server, Cloud } from "lucide-react";
import { db } from "../insforge/client";
import { insforge } from "../insforge/client";
import {
  BASE_DOMAIN,
  VERCEL_CNAME_TARGET,
  dnsRecordName,
  normalizeSubdomain,
  rootDomain,
  slugifyCompanyName,
  tenantHost,
  tenantUrl,
  validateSubdomain,
} from "../utils/domain";

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
  const pick = (str: string) => str[crypto.getRandomValues(new Uint32Array(1))[0] % str.length];
  const chars = [
    pick(upper), pick(upper),
    pick(lower), pick(lower), pick(lower), pick(lower),
    pick(digits), pick(digits),
  ];
  // Shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function getErrorMessage(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return typeof err === "string" ? err : fallback;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
        copied
          ? "border-emerald-600 bg-emerald-600 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

/** Shown when VITE_BASE_DOMAIN is missing — without it we cannot produce a real login URL. */
function MissingDomainConfig() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <div className="flex">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-400" aria-hidden="true" />
          <div className="ml-3">
            <h3 className="text-sm font-semibold text-red-800">VITE_BASE_DOMAIN is not configured</h3>
            <p className="mt-2 text-sm text-red-700">
              Onboarding is disabled because the console cannot build a tenant login URL without it, and
              handing an HR admin a wrong URL is worse than not onboarding them.
            </p>
            <p className="mt-2 text-sm text-red-700">
              Set <span className="rounded bg-red-100 px-1 font-mono">VITE_BASE_DOMAIN</span> (e.g.{" "}
              <span className="font-mono">hrms.talentmeshsolutions.com</span>) in the Vercel project
              environment variables and redeploy.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SuccessData {
  companyName: string;
  subdomain: string;
  hrEmail: string;
  tempPassword: string;
  tenantId: string;
}

function ProvisioningSteps({ subdomain }: { subdomain: string }) {
  const host = tenantHost(subdomain) ?? subdomain;
  const record = dnsRecordName(subdomain) ?? subdomain;
  const zone = rootDomain() ?? "";

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
      <div className="bg-amber-50 px-6 py-4">
        <h3 className="text-sm font-semibold text-amber-800">Required: publish this subdomain</h3>
        <p className="mt-1 text-xs text-amber-700">
          There is no wildcard domain yet, so <span className="font-mono">{host}</span> will not resolve
          until you complete both steps below. The company shows as <strong>Pending</strong> in All
          Companies until you mark it live.
        </p>
      </div>

      <ol className="divide-y divide-slate-100">
        <li className="p-6">
          <div className="mb-3 flex items-center gap-2">
            <Cloud className="h-4 w-4 text-slate-400" />
            <p className="text-sm font-semibold text-slate-900">1. Vercel → Project → Settings → Domains → Add</p>
          </div>
          <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="break-all font-mono text-sm text-slate-900">{host}</span>
            <CopyButton text={host} label="Copy domain" />
          </div>
        </li>

        <li className="p-6">
          <div className="mb-3 flex items-center gap-2">
            <Server className="h-4 w-4 text-slate-400" />
            <p className="text-sm font-semibold text-slate-900">
              2. GoDaddy → DNS for {zone} → Add record
            </p>
          </div>
          <dl className="space-y-2">
            {[
              { label: "Type", value: "CNAME", copyable: false },
              { label: "Name", value: record, copyable: true },
              { label: "Value", value: VERCEL_CNAME_TARGET, copyable: true },
              { label: "TTL", value: "1 hour (default)", copyable: false },
            ].map(({ label, value, copyable }) => (
              <div key={label} className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-baseline gap-3">
                  <dt className="w-14 flex-shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
                  <dd className="break-all font-mono text-sm text-slate-900">{value}</dd>
                </div>
                {copyable && <CopyButton text={value} />}
              </div>
            ))}
          </dl>
        </li>
      </ol>
    </div>
  );
}

function SuccessScreen({ data, onReset }: { data: SuccessData; onReset: () => void }) {
  const loginUrl = tenantUrl(data.subdomain) ?? "";
  const host = tenantHost(data.subdomain) ?? data.subdomain;

  const credentialText = `TalentMesh HR Admin Credentials
================================
Company: ${data.companyName}
Login URL: ${loginUrl}
HR Admin Email: ${data.hrEmail}
Temporary Password: ${data.tempPassword}
================================
Note: Please change your password on first login.`;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Company Created</h1>
          <p className="text-sm text-slate-500">{data.companyName} is set up. Two manual steps remain.</p>
        </div>
      </div>

      <ProvisioningSteps subdomain={data.subdomain} />

      <div className="mb-6 overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
        <div className="bg-emerald-50 px-6 py-4">
          <h3 className="text-sm font-semibold text-emerald-800">Login Credentials</h3>
        </div>
        <div className="p-6">
          <dl className="divide-y divide-slate-100">
            <div className="flex flex-col py-3 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-sm font-medium text-slate-500">Login URL</dt>
              <dd className="mt-1 text-sm text-slate-900 sm:mt-0">
                <a href={loginUrl} className="break-all font-mono text-brand-600 hover:underline">
                  {host}
                </a>
              </dd>
            </div>
            <div className="flex flex-col py-3 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-sm font-medium text-slate-500">HR Admin Email</dt>
              <dd className="mt-1 break-all text-sm text-slate-900 sm:mt-0">{data.hrEmail}</dd>
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
              This password is shown once and is not stored anywhere you can read it back. Copy it now,
              share it with the HR admin over a private channel, and ask them to change it on first login.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <CopyButton text={credentialText} label="Copy all credentials" />
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
  const [subdomainTouched, setSubdomainTouched] = useState(false);
  const [plan, setPlan] = useState("trial");
  const [hrEmail, setHrEmail] = useState("");
  const [hrName, setHrName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessData | null>(null);
  const selectedPlan = PLAN_CONFIG[plan] ?? PLAN_CONFIG.trial;
  const subdomainError = validateSubdomain(subdomain);

  const handleCompanyNameChange = (val: string) => {
    setCompanyName(val);
    if (!subdomainManual) {
      setSubdomain(slugifyCompanyName(val));
    }
  };

  const handleSubdomainChange = (val: string) => {
    setSubdomain(normalizeSubdomain(val));
    setSubdomainManual(true);
    setSubdomainTouched(true);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const cleanSubdomain = subdomain.trim();
    const validationError = validateSubdomain(cleanSubdomain);
    if (validationError) {
      setSubdomainTouched(true);
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      // 1. Validate subdomain uniqueness
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
        const createMessage = (fnData as Record<string, unknown>)?.error as string ?? fnErr?.message ?? "Failed to create HR admin user.";

        // Roll the tenant back so a failed onboarding does not leave an orphan
        // row holding the subdomain. `count` is checked because an RLS denial
        // deletes zero rows without reporting an error.
        const rollback = await db.from("tenants").delete().eq("id", tenantId).select("id");
        const rolledBack = !rollback.error && (rollback.data?.length ?? 0) > 0;
        const rollbackMessage = rolledBack
          ? ""
          : ` The company record could not be rolled back and still holds the subdomain "${cleanSubdomain}" — delete it from All Companies before retrying.${rollback.error ? ` (${rollback.error.message})` : ""}`;

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
    setSubdomainTouched(false);
    setPlan("trial");
    setHrEmail("");
    setHrName("");
    setError(null);
  };

  if (!BASE_DOMAIN) {
    return <MissingDomainConfig />;
  }

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
                onBlur={() => setSubdomainTouched(true)}
                placeholder="acme-corp"
                aria-invalid={Boolean(subdomainTouched && subdomainError)}
                className={`block w-full min-w-0 flex-1 rounded-none border px-3 py-2 focus:outline-none focus:ring-1 sm:text-sm ${
                  subdomainTouched && subdomainError
                    ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                    : "border-slate-300 focus:border-brand-500 focus:ring-brand-500"
                }`}
              />
              <span className="inline-flex items-center rounded-r-lg border border-l-0 border-slate-300 bg-slate-50 px-3 text-slate-500 sm:text-sm">
                .{BASE_DOMAIN}
              </span>
            </div>
            {subdomainTouched && subdomainError ? (
              <p className="mt-2 text-xs text-red-600">{subdomainError}</p>
            ) : (
              <p className="mt-2 break-all text-xs text-slate-500">
                Preview: {tenantHost(subdomain) ?? `subdomain.${BASE_DOMAIN}`}
              </p>
            )}
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
                    {cfg.label} · {cfg.rate}
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
                value={selectedPlan.maxEmployees === 9999 ? "Unlimited" : selectedPlan.maxEmployees}
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
              disabled={submitting || !companyName.trim() || Boolean(subdomainError) || !hrEmail.trim() || !hrName.trim()}
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
