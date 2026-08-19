import { useCallback, useEffect, useState } from "react";
import { Blocks, Lock, AlertCircle } from "lucide-react";
import { db } from "../insforge/client";

type ModuleRow = {
  key: string;
  name: string;
  description: string | null;
  is_core: boolean;
  sort_order: number;
};

/**
 * Per-tenant module entitlement toggles.
 *
 * Writes to `tenant_modules`, which only platform admins may modify
 * (policy `tenant_modules_platform_all`). The switch is enforced in RLS — a disabled module's tables
 * become unreadable through the API, not merely hidden in the tenant's nav.
 * See doc/architecture/02-module-registry.md.
 */
export function TenantModulesPanel({ tenantId }: { tenantId: string }) {
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [catalogue, entitlements] = await Promise.all([
      db.from("modules").select("key,name,description,is_core,sort_order").order("sort_order"),
      db.from("tenant_modules").select("module_key,enabled").eq("tenant_id", tenantId),
    ]);

    if (catalogue.error || entitlements.error) {
      setError("Could not load modules.");
      setLoading(false);
      return;
    }

    setModules((catalogue.data ?? []) as ModuleRow[]);
    setEnabled(
      new Set(
        ((entitlements.data ?? []) as { module_key: string; enabled: boolean }[])
          .filter((r) => r.enabled)
          .map((r) => r.module_key),
      ),
    );
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (key: string, next: boolean) => {
    setSaving(key);
    setError(null);

    // Optimistic — reverted below if the write is refused.
    const previous = new Set(enabled);
    const optimistic = new Set(enabled);
    if (next) optimistic.add(key);
    else optimistic.delete(key);
    setEnabled(optimistic);

    // A row may not exist yet for a module added after the tenant was created.
    const { data: existing } = await db
      .from("tenant_modules")
      .select("module_key")
      .eq("tenant_id", tenantId)
      .eq("module_key", key)
      .maybeSingle();

    // .select() matters: RLS refuses a write by matching zero rows, which comes back as a SUCCESSFUL
    // empty response rather than an error. Without checking the returned rows, a refused toggle would
    // look like it worked and the UI would drift from the database.
    const { data: written, error: writeError } = existing
      ? await db
          .from("tenant_modules")
          .update({ enabled: next, enabled_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
          .eq("module_key", key)
          .select()
      : await db
          .from("tenant_modules")
          .insert({ tenant_id: tenantId, module_key: key, enabled: next })
          .select();

    if (writeError || !written || (written as unknown[]).length === 0) {
      setEnabled(previous);
      setError(
        writeError?.message ||
          "Change was rejected. Only platform administrators can change a company's modules.",
      );
    }
    setSaving(null);
  };

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Loading modules…</div>;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <Blocks className="h-4 w-4 text-slate-400" />
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Modules</p>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Turning a module off hides it from this company and blocks its data through the API.
        Nothing is deleted — switching it back on restores everything.
      </p>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-1">
        {modules.map((m) => {
          const isOn = m.is_core || enabled.has(m.key);
          const isBusy = saving === m.key;

          return (
            <div
              key={m.key}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-slate-800">{m.name}</span>
                  {m.is_core && (
                    <span
                      title="Core module — every other module depends on it, so it cannot be disabled"
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
                    >
                      <Lock className="h-2.5 w-2.5" /> Core
                    </span>
                  )}
                </div>
                {m.description && <p className="truncate text-xs text-slate-500">{m.description}</p>}
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={isOn}
                aria-label={`${m.name} module`}
                disabled={m.is_core || isBusy}
                onClick={() => void toggle(m.key, !isOn)}
                className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${
                  isOn ? "bg-brand-600" : "bg-slate-300"
                } ${m.is_core || isBusy ? "cursor-not-allowed opacity-50" : "hover:opacity-90"}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    isOn ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
