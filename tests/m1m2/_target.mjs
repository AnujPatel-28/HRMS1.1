/**
 * P1-00 target lock.
 *
 * Identifiers only: never add an anon/admin key, password, schedule header or token here.
 * Credentials stay in the git-ignored InsForge link state, and every mutation still passes
 * the fresh identity guard in `_harness.mjs`.
 *
 * TB-M1M2 is a **full backend branch of the parent**, not a standalone project. That choice is
 * load-bearing and was made on evidence, 2026-09-13:
 *
 *   - `migrations/` is not a schema source. No SQL in this repository creates `public.tenants`
 *     or `public.employees`; 45 objects referenced by migrations are created by no repo file.
 *     A fresh empty project therefore cannot be brought up with `db migrations up --all`.
 *   - `db export --no-data` is not a safe substitute. Measured against the parent it dropped
 *     all 70 primary keys, every GRANT/REVOKE, and — critically — rendered all 275 policies as
 *     PERMISSIVE when 84 of them are RESTRICTIVE. Importing that would silently convert the
 *     tenant-isolation fence into a grant. See doc/execution/non-payroll-monday/reconciliation.md.
 *   - `branch create --mode full` clones at the infrastructure level and was verified to preserve
 *     191 PERMISSIVE + 84 RESTRICTIVE policies, 70 primary keys, grants, 486 functions, all 20
 *     edge functions, all 15 buckets and the schedule.
 *
 * The standalone project below is retained as a second, separately-keyed backend. It has its own
 * JWT_SECRET, so it is the correct target for cross-backend isolation negatives that a branch
 * (which shares the parent's JWT_SECRET) cannot prove.
 */
export const BASELINE_RO_PROJECT_ID = "0431f0f6-225f-4fb1-86b7-3fd32684c7f4";

const TB_M1M2_RECORD = Object.freeze({
  name: "tb-m1m2",
  projectId: "fb9a8659-9950-4637-a58e-4a882ef24419",
  baseUrl: "https://rq3qmu8y-j9g.ap-southeast.insforge.app",
  functionsUrl: "https://rq3qmu8y-j9g.function2.insforge.app",
  /** Branch name as `insforge branch` addresses it. `branch reset` restores this to its T0 snapshot. */
  branchName: "tb-m1m2",
  branchedFrom: BASELINE_RO_PROJECT_ID,
  status: "AUTHORIZED",
});

/**
 * v0.9.0 release rehearsal: a full branch of production, created 2026-09-23 and deleted after the
 * release (doc/release/v0.9.0-production-promotion-runbook.md, Gate 1). Selected only with
 * `M1M2_TARGET=rehearsal`; every guard in `_harness.mjs` applies to it unchanged.
 */
const REHEARSAL_RECORD = Object.freeze({
  name: "rehearsal-v090",
  projectId: "e3d7dea3-5c76-450f-b9b1-f143553b0e3d",
  baseUrl: "https://rq3qmu8y-hqb.ap-southeast.insforge.app",
  functionsUrl: "https://rq3qmu8y-hqb.function2.insforge.app",
  branchName: "rehearsal-v090",
  branchedFrom: BASELINE_RO_PROJECT_ID,
  status: "AUTHORIZED",
});

const TARGETS = { tb: TB_M1M2_RECORD, rehearsal: REHEARSAL_RECORD };
const selected = process.env.M1M2_TARGET ?? "tb";
if (!TARGETS[selected]) throw new Error(`Unknown M1M2_TARGET "${selected}"; use one of: ${Object.keys(TARGETS).join(", ")}`);

/** The active test target (TB-M1M2 unless M1M2_TARGET selects another). Suites use this name. */
export const TB_M1M2 = TARGETS[selected];

/**
 * Second isolated backend, separately keyed. NOT a mutation target for the fixture scripts —
 * it is reserved for cross-backend negative tests where a distinct JWT_SECRET is the thing
 * under test. Kept here so no lane re-provisions it by accident.
 */
export const ISOLATION_CONTROL = Object.freeze({
  name: "TB-M1M2-CONTROL",
  projectId: "38640ffd-91ee-48f9-bbc0-4bbd3a12337f",
  baseUrl: "https://np87xpma.ap-southeast.insforge.app",
  status: "PROVISIONED_EMPTY",
});

/** Minimum CLI that supports `branch` and `backups`. The repo previously resolved a stale 0.1.73. */
export const REQUIRED_CLI = "@insforge/cli@0.2.8";
