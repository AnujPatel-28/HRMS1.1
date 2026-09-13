import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, KeyRound, RefreshCw, Shield, UserPlus, Users } from "lucide-react";

import { useAuth } from "../hooks/useAuth";
import { db, functions } from "../insforge/client";
import { useToast } from "../shared/ToastContext";

type AccessMember = {
  id: string;
  userId: string;
  email: string;
  status: "active" | "suspended" | "revoked";
  accessVersion: number;
  employeeId: string | null;
  templates: string[];
  isOwner: boolean;
};

type PendingInvitation = {
  id: string;
  email: string;
  templateKey: string;
  status: string;
};

type AccessSnapshot = {
  memberships: AccessMember[];
  pendingInvitations: PendingInvitation[];
};

const templates = [
  ["company_admin", "Company Admin"],
  ["hr_admin", "HR Admin"],
  ["manager", "Manager"],
  ["employee", "Employee"],
  ["project_manager", "Project Manager"],
  ["communication_moderator", "Communication Moderator"],
] as const;

const templateLabel = (key: string) => templates.find(([value]) => value === key)?.[1] ?? key;

export default function UsersAccess() {
  const { capability, hasGrant, refreshCapabilities } = useAuth();
  const { success, error: toastError } = useToast();
  const [snapshot, setSnapshot] = useState<AccessSnapshot>({ memberships: [], pendingInvitations: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [templateKey, setTemplateKey] = useState("company_admin");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const canManage = hasGrant("access.manage", "company");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db.rpc("list_tenant_access");
    if (error) toastError(error.message || "Could not load users and access.");
    else setSnapshot((data ?? { memberships: [], pendingInvitations: [] }) as AccessSnapshot);
    setLoading(false);
  }, [toastError]);

  useEffect(() => { void load(); }, [load]);

  const mutate = useCallback(async (operation: string, payload: Record<string, unknown>) => {
    if (!capability) return null;
    setBusy(operation);
    const { data, error } = await functions.invoke("manage-tenant-access", {
      method: "POST",
      body: { operation, payload, expectedAccessVersion: capability.accessVersion },
    });
    setBusy(null);
    if (error) {
      toastError(error.message || "Access operation failed.");
      await refreshCapabilities();
      return null;
    }
    const result = (data as { data?: Record<string, unknown> } | null)?.data ?? data;
    await Promise.all([load(), refreshCapabilities()]);
    return result as Record<string, unknown>;
  }, [capability, load, refreshCapabilities, toastError]);

  const invite = async () => {
    const result = await mutate("invitation.create", { email, templateKey, scopeType: "company" });
    if (!result) return;
    setIssuedToken(typeof result.token === "string" ? result.token : null);
    setEmail("");
    success("Invitation created. The acceptance token is shown once.");
  };

  const members = useMemo(() => snapshot.memberships, [snapshot]);

  if (!canManage) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <div className="flex items-center gap-3"><AlertTriangle className="h-5 w-5" /><h1 className="text-lg font-semibold">Access management unavailable</h1></div>
        <p className="mt-2 text-sm">This membership does not hold access.manage at company scope.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Administration</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Users & access</h1>
          <p className="mt-1 text-sm text-slate-500">Fixed templates, explicit membership lifecycle, and protected ownership.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Database / RPC", "Enforced", true],
          ["Access edge functions", "Enforced", true],
          ["Private storage", "Not enabled for this package", false],
          ["Realtime access events", "Disabled — instant disconnect unproven", false],
        ].map(([label, state, complete]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {complete ? <Check className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
              {label}
            </div>
            <p className="mt-2 text-xs text-slate-500">{state}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-brand-600" /><h2 className="font-semibold text-slate-900">Invite a member</h2></div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_240px_auto]">
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="person@company.com" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500" />
          <select value={templateKey} onChange={(event) => setTemplateKey(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500">
            {templates.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button onClick={() => void invite()} disabled={!email || busy !== null} className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">Create invite</button>
        </div>
        {issuedToken && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">One-time acceptance token</p>
            <div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-xs text-amber-950">{issuedToken}</code><button onClick={() => void navigator.clipboard.writeText(issuedToken)} className="rounded-lg p-2 hover:bg-amber-100" aria-label="Copy token"><Copy className="h-4 w-4" /></button></div>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><Users className="h-5 w-5 text-brand-600" /><h2 className="font-semibold text-slate-900">Memberships</h2><span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{members.length}</span></div>
        <div className="divide-y divide-slate-100">
          {members.map((member) => (
            <div key={member.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2"><p className="font-semibold text-slate-900">{member.email}</p>{member.isOwner && <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700"><KeyRound className="h-3 w-3" />Owner</span>}</div>
                  <p className="mt-1 text-xs text-slate-500">{member.employeeId ? `Employee ${member.employeeId}` : "No employee association"} · access v{member.accessVersion}</p>
                  <div className="mt-3 flex flex-wrap gap-2">{member.templates.map((template) => <span key={template} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">{templateLabel(template)}</span>)}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!member.isOwner && member.status === "active" && member.id !== capability?.membershipId && <button onClick={() => void mutate("owner.transfer.begin", { targetMembershipId: member.id, reason: "UI owner transfer" })} disabled={busy !== null} className="rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50">Transfer ownership</button>}
                  {!member.isOwner && member.status !== "revoked" && member.id !== capability?.membershipId && <button onClick={() => void mutate("membership.revoke", { membershipId: member.id, reason: "Revoked from Users & access" })} disabled={busy !== null} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Revoke</button>}
                </div>
              </div>
            </div>
          ))}
          {!loading && members.length === 0 && <div className="p-10 text-center text-sm text-slate-500">No memberships are visible.</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2"><Shield className="h-5 w-5 text-brand-600" /><h2 className="font-semibold text-slate-900">Pending invitations</h2></div>
        <div className="mt-3 space-y-2">{snapshot.pendingInvitations.map((invite) => <div key={invite.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><span>{invite.email}</span><span className="text-xs text-slate-500">{templateLabel(invite.templateKey)}</span></div>)}{snapshot.pendingInvitations.length === 0 && <p className="text-sm text-slate-500">No pending invitations.</p>}</div>
      </section>
    </div>
  );
}
