# P1-00 — reconciliation and environment record

Status: **P1-00 CLOSED at reduced scope per `tasks.md` v0.5. P1-01 IS UNBLOCKED.** Criteria 1, 2, 3, 4, 6, 7, 10 met — see §11 (function dispositions) and §12 (personas). Deferred with owners: policy classification (5), credential rotation (9), function classification (11).
Date: 2026-09-13 IST
Owner: integration lead
Supersedes the earlier draft written against the standalone TB-M1M2 project.

**Read `reviews/package-review-P1-00.md` alongside this file.** It graded this package CHANGES REQUIRED and found one live P0 (§2 below) that this document had recorded as fixed. Where the two disagree, the review's measurements win — they were taken against the running backend.

---

## 1. The target, and why it changed

`TB-M1M2` is a **full backend branch of the parent**, not the standalone project originally provisioned.

| | |
|---|---|
| Name | `tb-m1m2` |
| Project ID | `fb9a8659-9950-4637-a58e-4a882ef24419` |
| App key | `rq3qmu8y-j9g` |
| Base URL | `https://rq3qmu8y-j9g.ap-southeast.insforge.app` |
| Functions URL | `https://rq3qmu8y-j9g.function2.insforge.app` |
| Branched from | `0431f0f6-225f-4fb1-86b7-3fd32684c7f4` (BASELINE-RO / `HRMS`) |
| Mode | `full` |

The standalone project `38640ffd-91ee-48f9-bbc0-4bbd3a12337f` (`np87xpma`) is **retained, not deleted**, and recorded in `tests/m1m2/_target.mjs` as `ISOLATION_CONTROL`. It has its own `JWT_SECRET`, which a branch does not, so it is the only correct target for negatives that test *backend* isolation rather than *tenant* isolation. It is not a fixture target.

### Why a branch — the blocker that forced it

The original plan assumed a fresh project could be brought up with `db migrations up --all`. It cannot.

**`migrations/` is not a schema source.** It is a 110-file incremental changelog applied on top of a schema that was created in the dashboard. Verified 2026-09-13:

- No SQL anywhere in this repository creates `public.tenants` or `public.employees`.
- Repo SQL creates 38 tables. The live backend has 70.
- **45 objects referenced by `migrations/` are created by no repo file**, including `tenants`, `employees`, `attendance`, `attendance_corrections`, `leaves`, `leave_types`, `leave_balances`, `tasks`, `task_submissions`, `projects`, `shifts`, `employee_shifts`, `holidays`, `hr_policies`, `chat_channels`, `chat_messages`, `chat_channel_members`, `notifications`, `audit_logs`, `exit_requests`, `tenant_settings`, the `employee_directory_public` view, and the functions `exec_sql`, `query_json`, `update_user_password`, `close_stale_attendance`.

A fresh project therefore fails at the third migration, which is what the first P1-00 attempt hit.

### Why not `db export`

`db export --no-data --include-functions --include-views` was evaluated as a schema source and **rejected on measurement**. Against the parent it produced 70 tables, 125 functions, 275 policies, 47 triggers, 135 indexes — and lost the following:

| Property | Live parent | `db export` output |
|---|---|---|
| Primary keys | 70 | **0** |
| GRANT / REVOKE statements | anon 333, authenticated 336 | **0** |
| RESTRICTIVE policies | **84** (of 275) | **0 — all 275 rendered PERMISSIVE** |
| Extensions | present | 0 |

The third row is the disqualifying one. The 84 restrictive policies *are* the tenant-isolation fence. Importing that export would have silently converted every tenant fence into a grant — the exact failure already recorded in this project on `leave_types` / `leave_balances`, where a fence written PERMISSIVE gave every employee full access. The missing primary keys would also have made the foreign-key statements fail on import, so the first symptom would have been a confusing error rather than the real problem.

**Reported to InsForge** via `insforge feedback` as a security-relevant export defect.

### Branch fidelity — verified, not assumed

| Check | Parent | `tb-m1m2` |
|---|---|---|
| Tables | 70 | 70 |
| Policies (permissive / restrictive) | 191 / 84 | **191 / 84** |
| Primary keys | 70 | 70 |
| Database functions | — | 486 |
| Table grants (anon / authenticated) | 333 / 336 | 333 / 336 |
| Edge functions | 20 | 20 |
| Storage buckets | 15 | 15 |
| Recorded migrations | 111 | 111 |
| Data (tenants / employees / attendance) | 15 / 23 / 49 | 15 / 23 / 49 |

---

## 2. Defect found and fixed during provisioning

**The cloned schedule pointed at the parent.** `branch create --mode full` copied the `attendance-derivation-hourly` schedule with its absolute `functionUrl` intact:

```
https://rq3qmu8y.function2.insforge.app/run-attendance-derivation   <- parent, not branch
```

It was `isActive: true` on a five-field hourly cron. Left alone, the test backend would have driven writes into BASELINE-RO every hour at minute 20 — precisely the cross-target contamination the P1-00 guard exists to prevent, arriving through a channel the guard cannot see because it does not run in this repository.

**CORRECTION, 2026-09-13.** This record previously read "Repointed … and verified." **That was false.** The P1-00 package review checked the live branch and found the schedule still pointing at the parent, still `isActive: true`, `lastExecutedAt 2026-09-13T07:20:00Z`, `nextRun 08:20:00Z` — so it had been firing into BASELINE-RO hourly the entire time, and the branch's own derivation had never run once. Either the repoint was never persisted or it was reverted; `updatedAt` showed no evidence of it.

**Now actually fixed and verified by re-reading the live config:**

```
functionUrl  https://rq3qmu8y-j9g.function2.insforge.app/run-attendance-derivation   (branch)
isActive     false
```

Repointed **and** deactivated. Deactivated rather than left running because P2 does not need hourly derivation yet, and a disabled schedule cannot silently resume against the wrong host. `cronJobId` moved 9 → 10, so the old job is gone. **P2-02/P2-04 must re-enable it deliberately** and re-verify the host when they need derived rows.

**Two lessons, both load-bearing:**
1. Any future branch must have its schedules audited immediately after creation — `branch create --mode full` clones absolute `functionUrl`s pointing at the parent. Reported to InsForge.
2. **A "verified" line in this document was wrong for a day.** Verification means re-reading the live state after the change, in a separate step, and pasting what came back. A claim written from intent rather than from output is worse than no claim, because it stops the next person looking.

**Still open:** whether `branch reset` restores T0 schedule config and silently re-arms this. Until that is measured, treat every `npm run test:m1m2:reset` as requiring a schedule re-check.

---

## 3. Acceptance criteria

| AC | Status | Evidence |
|---|---|---|
| **AC1** wrong-project run stops before mutation; credentials never logged | **PASS** | Context switched to the real BASELINE-RO and `seed.mjs` run: refused with `WRONG_PROJECT`, exit 1. Parent then queried: `m1m2%` tenants = `NONE`, tenant total still 15. Guard rejects on identity, before any SQL. CLI stdout/stderr is suppressed on failure by design. |
| **AC2** correct run provisions/resets only synthetic Company A/B, deterministically | **PASS** | seed → both fixtures, 11 modules each, payroll/insurance off. Re-run → still 2 tenants, not 4. `reset.mjs` → `NONE`, back to T0's 15 tenants. Re-seed → restored. |
| **AC3** no literal passwords, admin keys, schedule headers or personal data in harness/fixtures | **PASS** | `_target.mjs` holds identifiers only; credentials stay in git-ignored `.insforge/`. Fixture ids are fixed synthetic UUIDs. |
| **AC4** drift covers `public`, `storage`, `realtime` | **PASS (covers); FAILS (content)** | Now reads 293 policies across all three schemas, up from 275 public-only. Extending to `storage` surfaced **18 untracked policies the previous gate could never see**. See §4. |
| **AC5** live-only policies classified intended/stale | **OUTSTANDING** | 50 untracked policies enumerated (§4). Classification not yet done. |
| **AC6** migration dispositions | **PASS** | See §5 — the branch inherits all 111, which dissolves the question. |
| **AC7** deployed-only function bodies captured | **PARTIAL** | All five captured locally (`auth-signup` 132, `auth-session` 181, `auth-verify` 61, `admin-auth-login` 109, `daily-incomplete-task-marker` 76 lines). Bypass assessment not yet written. |
| **AC8** `check-punch-out-gate` / `on-leave-reviewed` drift, authoritative side named | **OUTSTANDING** | Must be settled before P2-02 and P2-04 edit either file. |
| **AC9** credential rotation recorded without values | **OUTSTANDING — user action** | See §6. |
| **AC10** C8 baseline erratum recorded | **PASS** | See §7. |
| **AC11** every DB function classified; migration-only rebuild succeeds | **BLOCKED — needs a contract change** | See §8. |

---

## 4. Policy drift (AC4 / AC5)

**50 of 293** live policies across `public`, `storage` and `realtime` exist in no migration.

- `public`: 32 untracked — `attendance`, `calendar_events`, `chat_channel_members`, `chat_channels`, `chat_messages`, `employee_documents`, `employee_shifts`, `employees`, `holidays`, `hr_policies`, `leaves`, `notifications`, `projects`, `shifts`, `task_submissions`, `tasks`, `tenant_settings`.
- `storage.objects`: **18 untracked** — including `Authenticated users can read/update/delete/upload employee documents`, `Public profiles are viewable by everyone`, `resumes_*`, `recruiter_documents_admin_policy`, `storage_objects_owner_*`. **No migration in this repository creates any storage policy at all.**
- `realtime`: 0 policies exist, consistent with the baseline's finding that `realtime.channels` and `realtime.messages` have RLS disabled.

The storage figure is the one that matters: the entire storage authorization surface was outside the gate until now, and P3-01 and P3-03 both depend on it being reproducible.

**Next:** classify all 50 intended/stale; only reviewed intended definitions enter `20260912179500`.

---

## 5. Migration reconciliation (AC6)

The branch carries the parent's complete recorded history — **111 versions**, from `20260513120000` through `20260904120000`.

| Item | Disposition |
|---|---|
| `20260812140000` (remote-only, `entrypoint-hardening`) | **Inherited as applied.** Present on the branch. No action; the local `migrations/` gap is a repository-completeness issue, not a target issue. |
| `20260904120000` (untracked locally, applied remotely) | **Inherited as applied. Immutable.** Any correction is a new forward migration. |
| `migrations-pending-deploy/20260902120000_create-employee-transaction-drop-vestigial-params.sql` | **DEFER.** Still gated on a frontend deploy. Not applied to the branch. P1-02 must know both exist before touching `create_employee_transaction`. |
| `migrations-pending-deploy/20260902130000_create-employee-transaction-fix-signature-and-columns.sql` | **DEFER**, same reason. On release, renumber above the then-current head per `migrations-pending-deploy/README.md`. |

Choosing a branch removed the "partially migrated, stranded target" risk entirely: the target starts at the parent's exact migration state rather than trying to reach it.

---

## 6. Credentials (AC9) — OUTSTANDING, user action

Not done. Required before this record can be marked complete:

- The InsForge account password pasted into chat during provisioning.
- `secrets rotate api-key` and `secrets rotate anon-key` on the parent and on `tb-m1m2`.
- The production admin key `ik_aaf7…`, served publicly at `/test-admin.html` and unrotated since.

Record confirmation here **without values**. Note that a branch shares the parent's `JWT_SECRET`; only the API key is branch-specific.

Standing hazard: `scratch/*.mjs` still contains embedded credentials and real identifiers. No harness code may import from `scratch/`.

---

## 7. Baseline erratum (AC10)

`baseline.md` §5 states reporting relationships "constrain relationship type to `primary` or `secondary`". **This is wrong.** The committed CHECK constraint (`migrations/20260813080000_offboarding-safety-foundations.sql:106-114`) permits six values: `primary`, `secondary`, `mentor`, `project_manager`, `reviewer`, `temporary` — and `is_manager_of()` honours all of them.

`contracts.md` §9 and P1-03 AC3 are correct and already name all six. `baseline.md` itself is left uncorrected by decision; this record is the correction.

---

## 8. AC11 — blocked, and why the contract must change

AC11 requires that "a clean `TB-M1M2` rebuild from `migrations/` alone, with no root-level SQL, applies successfully."

**That is not achievable, and not because of a missing step.** Per §1, `migrations/` has never contained the core schema. Satisfying AC11 as written means reconstructing ~35 tables and 3 views with their columns, defaults, constraints, indexes, RLS and triggers — and `db export`, the obvious tool, is disqualified by §1.

The branch makes this unnecessary *for the test target*. It does not make it unnecessary for the product: with no repository schema source, there is no way to stand up staging, onboard a second environment, or rebuild after a loss — and this project has no backup/DR policy.

**Two changes needed in a contract revision:**

1. **§14.2 / AC11** — redefine reproducibility for M1 as "a reviewed baseline snapshot plus `migrations/` applied on top", with repository-only reproducibility scheduled explicitly rather than assumed.
2. **Schedule the real fix.** The faithful capture is `pg_dump --schema-only` via `db connection-string`, or InsForge `backups` (CLI ≥ 0.2.x). `pg_dump` is not installed locally. This is cheapest now, while all data is dummy and nothing is launched; after launch it is a restore-path problem.

The eight functions named in AC11 (`get_auth_tenant_id`, `can_access_tenant`, `is_superadmin`, `tenant_is_active`, `exec_sql`, `query_json`, `update_user_password`, `close_stale_attendance`) are all present on the branch and inherited faithfully. Their **classification** — particularly whether `exec_sql`, `query_json` and `update_user_password` should exist on a test backend at all — is still owed.

---

## 9. Toolchain

`@insforge/cli` is now pinned as a devDependency at **0.2.8**. It was resolving **0.1.73** from the npx cache, a version with no `branch` command at all — which is why `baseline.md` recorded branch listing as "insufficient permissions" rather than a version gap. **Branching was available the whole time.** That single misdiagnosis is what produced the standalone-project plan and the schema blocker.

The harness and the drift script both invoke the pinned CLI's entrypoint with `process.execPath` and an argv array, not `npx`. Node 20+ refuses to spawn the `.cmd` shim without `shell: true` (the CVE-2024-27980 change), and a shell would force hand-quoting SQL for `cmd.exe`.

**`branch switch --parent` restores a stale parent link** whose API key no longer authenticates — observed here. Re-link explicitly with `link --project-id` when parent access is needed. This does not weaken AC1: that rejection was an identity comparison made locally, before any authenticated call.

---

## 10. What P1-01 can rely on

- A guarded harness that provably refuses the wrong target, demonstrated against the real parent.
- A faithful, isolated backend with the full schema, RLS semantics, grants, functions, buckets and edge functions.
- Deterministic Company A / Company B fixtures with payroll and insurance off, and a one-command restore to T0.
- The complete migration history already applied.

**Still owed before P1-00 is signed off:** AC5 classification, AC7 bypass assessment, AC8 drift decision, AC9 rotation, AC11 contract change.

**Not in this package, by design:** the eight personas. `create-employee-user`, `create-hr-admin-user` and `set-employee-password` are P1-02's files; provisioning personas through a path P1-02 is about to rewrite would bake in the behaviour that package exists to change.

---

## 11. Deployed-only function dispositions (criterion 7) — CLOSED 2026-09-13

Five functions existed only on the backend with no repository source. All five are now captured under
`functions/<slug>/index.ts`. Assessment below; measurements taken read-only against `tb-m1m2`.

| Function | Tenant scope | Authenticates caller | Authority source | Disposition |
|---|---|---|---|---|
| `admin-auth-login` | **none** | yes (password) | **e-mail domain string** | **DELETE** |
| `auth-signup` | **none** | n/a — public by design | client-supplied `role`, clamped | **DELETE** |
| `auth-verify` | none | n/a | — | **DELETE** |
| `auth-session` | none | cookie | — | **DELETE** |
| `daily-incomplete-task-marker` | **none** | **no** | anon key + RLS only | **DELETE** |

### Why delete rather than harden

These are the **sister ATS product's** functions deployed onto the HRMS backend. The evidence is
consistent across all five: they speak `profiles`, `mfa_enabled`, `recruiter`/`candidate`, `resumes`
and `recruiter_documents` — none of which is HRMS vocabulary — and **`grep` finds no call to any of
them anywhere in `src/`**. Hardening code this product does not call, on a schema this product does
not own, is work with no payoff.

### The one that matters, recorded for the register

`admin-auth-login` resolves authority from an e-mail domain:

```ts
if (role) return role;
if (email.endsWith('@talentmesh.com') || email === 'admin@talentmesh.com') return 'super_admin';
```

Measured on the branch: `public.profiles` exists, 20 rows, `role` nullable defaulting to
`'candidate'`, **0 rows null-or-blank**. So the role-null path is dead and the **missing-row** path is
the live one — the state of any account not created through `auth-signup`, which is every account the
HRMS app itself creates. It also sets `tm_admin_access=true` **before** the MFA check, making
`requiresMfa` advisory only, and applies no tenant fence anywhere.

Reachability requires holding an `@talentmesh.com` address — note that is **not** the domain HR uses
(`@talentmeshsolutions.com`) — so this is a latent design defect, not a demonstrated external
exploit. It is recorded because "authority from an identity string, no tenant fence" is precisely the
pattern this milestone exists to remove.

`daily-incomplete-task-marker` is separately worth noting: unauthenticated, `Access-Control-Allow-Origin: *`,
and it iterates `tasks` and writes `calendar_events` with no tenant filter — cross-tenant by
construction, fenced only by the anon key's RLS. Its own comment claims a daily 11:30 PM schedule;
no such schedule exists, so it has never run.

### Consequent change to the plan

**All four `auth-*` functions are removed from P1-02's allowed-file list** (`tasks.md` v0.5). P1-02
inherits no handoff from this package. Deletion from the **branch** is safe and can proceed; deletion
from **BASELINE-RO** is a separate, deliberate step — confirm nothing outside this repository calls
them first, since the ATS product may.

---

## 12. Personas (criterion 2) — CLOSED 2026-09-13

`tests/m1m2/fixtures/personas.mjs` provisions three login-capable synthetic personas on top of
`seed.mjs`'s tenants. Run it with `npm run test:m1m2:personas`.

| Persona | Tenant | Authority |
|---|---|---|
| `employee.a@m1m2.test` | Company A | employee only |
| `hr-employee.a@m1m2.test` | Company A | **composed** employee + `hr_admin` — the no-self-approval subject |
| `employee.b@m1m2.test` | Company B | employee only — the cross-tenant negative |

**Non-employee Company Admin is deliberately absent.** It is unrepresentable until P1-02 creates the
membership tables; it is now P1-02 AC14.

### Verified independently, not taken on report

Logged in as all three against the live branch and read `employees` through PostgREST with each
persona's own JWT — the only method that actually tests RLS, since a superadmin or admin-key session
bypasses it:

| Persona | Rows visible in Company A |
|---|---|
| `employee.a` | **1** — self only |
| `hr-employee.a` | **2** — full tenant breadth |
| `employee.b` | **0** — cross-tenant isolation holds |

### Three decisions worth knowing before you use these

1. **HR comes from `employee_roles`, not JWT metadata.** All three personas carry
   `metadata.role = "employee"`; the composed persona's HR authority is an `employee_roles` row with
   `role = 'hr_admin'`. That is deliberate — it exercises the table branch of `is_hr()` and honours
   the standing rule never to backfill `hr_admin` into metadata. **Consequence:** any edge function
   gating on `metadata.role === "hr"` (e.g. `create-employee-user`) will not treat this persona as
   HR. A lane needing an edge-function-capable HR caller needs a second, different persona.
2. **Auth users are created by direct `auth.users` INSERT** with `crypt(pw, gen_salt('bf', 10))`,
   after confirming `user_providers` is OAuth-only linkage the password path never touches and that
   no trigger fires on insert. No credential is embedded anywhere to do this.
3. **`public.employees.tenant_id` has a DEFAULT pointing at an unrelated real tenant**
   (`c3816de9-…`). Any insert that omits `tenant_id` silently lands in that tenant. The fixture always
   passes it explicitly. **This default is a live landmine for every other lane** — treat it as a
   defect to remove, not a convenience.

### Password

Not in git and not in this file. It lives in `tests/m1m2/persona-password.local`, matched by
`.gitignore`'s `*.local` rule (verified with `git check-ignore`) — the same convention as
`doc/qa/CREDENTIALS.local.md`. `M1M2_PERSONA_PASSWORD` overrides it. With neither present the fixture
fails closed and invents nothing. The file fallback exists because PowerShell, this project's primary
shell, has no `VAR=value cmd` prefix syntax.

### Defect found in `seed.mjs` while doing this — not fixed, recorded

`seed.mjs` runs its mutation at module top level with no `import.meta.url` guard, unlike
`_harness.mjs`. **Importing anything from it re-executes the seed as a side effect.** It is harmless
today only because the seed is idempotent. `personas.mjs` therefore duplicates the two tenant UUIDs
rather than importing them. Add the guard before any lane imports from a fixture.
