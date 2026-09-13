#!/usr/bin/env node
/**
 * Seeds the two synthetic candidate tenants on TB-M1M2.
 *
 * Deterministic by construction: fixed UUIDs and fixed subdomains, so every lane refers to the
 * same fixtures by id rather than by name or by row count. Idempotent: re-running changes nothing.
 *
 * Company A is the candidate tenant; Company B is the isolation control that every cross-tenant
 * negative test reads against. Two tenants in one backend prove tenant isolation; the separately
 * keyed ISOLATION_CONTROL project in `_target.mjs` is what proves *backend* isolation.
 *
 * Payroll and Insurance are explicitly disabled on both, per contracts.md §12.5. This matters more
 * than it looks: new tenants are born fully entitled here, so "no row" and "disabled" are different
 * states and the check below counts `enabled = true` rather than counting rows.
 *
 * Scope boundary: this seeds tenants and module entitlement only. Auth users and the eight
 * personas are deliberately NOT created here — `create-employee-user`, `create-hr-admin-user` and
 * `set-employee-password` are P1-02's files, and provisioning personas through a path P1-02 is
 * about to rewrite would bake in the behaviour that package exists to change.
 */
import { guardedMutation, HarnessBlockedError, runSql } from "../_harness.mjs";

/** Fixed fixture identities. Never reuse these ids for anything else. */
export const COMPANY_A = Object.freeze({
  id: "a0000000-0000-4000-8000-000000000001",
  name: "M1M2 Company A",
  subdomain: "m1m2-a",
});
export const COMPANY_B = Object.freeze({
  id: "b0000000-0000-4000-8000-000000000002",
  name: "M1M2 Company B (isolation control)",
  subdomain: "m1m2-b",
});

/** Disabled for every candidate tenant — contracts.md §12.5. */
const EXCLUDED_MODULES = ["payroll", "insurance"];

const tenantValues = [COMPANY_A, COMPANY_B]
  .map((t) => `('${t.id}'::uuid, '${t.name.replace(/'/g, "''")}', '${t.subdomain}', 'active')`)
  .join(", ");

const SEED_SQL = `
WITH seeded(id, company_name, subdomain, status) AS (VALUES ${tenantValues}),
ins_tenant AS (
  INSERT INTO public.tenants (id, company_name, subdomain, status)
  SELECT id, company_name, subdomain, status FROM seeded
  ON CONFLICT (id) DO UPDATE
    SET company_name = EXCLUDED.company_name,
        subdomain    = EXCLUDED.subdomain,
        status       = EXCLUDED.status
  RETURNING id
),
-- Entitle every catalogue module, then switch the excluded ones off. Written as one statement so
-- a tenant is never briefly entitled to Payroll between two round trips.
ins_modules AS (
  INSERT INTO public.tenant_modules (tenant_id, module_key, enabled, enabled_at)
  SELECT s.id, m.key, NOT (m.key = ANY (ARRAY[${EXCLUDED_MODULES.map((m) => `'${m}'`).join(", ")}])), now()
  FROM seeded s CROSS JOIN public.modules m
  ON CONFLICT (tenant_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled
  RETURNING tenant_id
)
SELECT (SELECT count(*) FROM ins_tenant) AS tenants_written,
       (SELECT count(*) FROM ins_modules) AS module_rows_written;
`;

const VERIFY_SQL = `
SELECT t.subdomain,
       count(*) FILTER (WHERE tm.enabled) AS enabled_modules,
       count(*) FILTER (WHERE tm.enabled AND tm.module_key IN (${EXCLUDED_MODULES.map((m) => `'${m}'`).join(", ")})) AS excluded_still_enabled
FROM public.tenants t
JOIN public.tenant_modules tm ON tm.tenant_id = t.id
WHERE t.id IN ('${COMPANY_A.id}', '${COMPANY_B.id}')
GROUP BY t.subdomain ORDER BY t.subdomain;
`;

function rowsOf(result) {
  return result?.rows ?? result?.data?.rows ?? [];
}

try {
  await guardedMutation("M1M2 synthetic seed", async (verified) => {
    runSql(SEED_SQL.trim());

    const verification = rowsOf(runSql(VERIFY_SQL.trim()));
    if (verification.length !== 2) {
      throw new HarnessBlockedError(
        "SEED_VERIFY_MISSING_TENANT",
        `Expected both fixture tenants after seeding; found ${verification.length}.`,
      );
    }
    for (const row of verification) {
      if (Number(row.excluded_still_enabled) !== 0) {
        throw new HarnessBlockedError(
          "SEED_EXCLUSION_VIOLATED",
          `${row.subdomain} still has an excluded module enabled; contracts.md §12.5 is not satisfied.`,
        );
      }
      if (Number(row.enabled_modules) === 0) {
        throw new HarnessBlockedError(
          "SEED_NO_ENTITLEMENT",
          `${row.subdomain} has no enabled modules; the fixture would test nothing.`,
        );
      }
    }

    for (const row of verification) {
      console.log(
        `  ${row.subdomain}: ${row.enabled_modules} modules enabled, ${EXCLUDED_MODULES.join("/")} off.`,
      );
    }
    console.log(
      `M1M2 synthetic seed: Company A (${COMPANY_A.id}) and Company B (${COMPANY_B.id}) ` +
        `are present on ${verified.projectName}. Personas remain P1-02 scope.`,
    );
  });
} catch (error) {
  const code = error instanceof HarnessBlockedError ? error.code : "SEED_ERROR";
  console.error(`${code}: ${error.message}`);
  process.exit(1);
}
