# P6 PACKAGE REVIEW — P1-00

Reviewer: independent senior HRMS architect / security engineer (Opus 5), PACKAGE mode
Date: 2026-09-13 IST
Under review: the P1-00 implementation as it stands in the working tree, and the live state of the
recorded `TB-M1M2` target.
Reviewed against: `tasks.md` v0.4 (P1-00 AC1–AC11 and the Execution controls), `contracts.md` v0.4
(§12.5, §14.1–§14.3), `baseline.md`, `reviews/contract-review-v0.4.md`, `reconciliation.md`.

**VERDICT: CHANGES REQUIRED — P1-01 REMAINS BLOCKED**

Nothing was modified. Every backend call made in this review was read-only (`current`,
`schedules list`, `pg_policies` via the existing drift script) and no credential value was printed.
The local harness self-test was run; it performs no network I/O.

---

## 0. Headline

Two things dominate this review.

1. **The cross-target contamination described as fixed in `reconciliation.md` §2 is not fixed.** It is
   live, active, fired today and is scheduled to fire again within the hour. This is a P0 and it is
   independent of every other finding.
2. **P1-01 cannot satisfy its own acceptance criteria even after P1-00's outstanding items are
   closed**, because the personas AC1 and AC7 require do not exist and cannot be created inside
   P1-01's allowed-file list. This needs a `tasks.md` revision, not an implementation fix.

The package is not close to done in the way `reconciliation.md` implies. Its own record marks five
ACs outstanding/partial/blocked; my grading makes it seven FAIL, one BLOCKED, one UNVERIFIED.
That said, the engineering judgement in the package is good: the branch decision, the `db export`
rejection and the drift-script schema extension are correct calls, well evidenced, and I would not
reverse any of them.

---

## 1. Acceptance criteria

| AC | Grade | One-line basis |
|---|---|---|
| **AC1** wrong-project run stops before mutation; credentials never logged | **UNVERIFIED** | Guard logic PASS — all four fail-closed vectors observed green in the self-test, and CLI output suppression is by construction. UNVERIFIED **solely** because the *reviewer-observed real mis-target denial* the review requirement demands was not re-staged. (B1 is not an AC1 failure; it is booked against the Execution controls, where it belongs) |
| **AC2** correct run provisions/resets **only synthetic Company A/B personas** deterministically | **FAIL** | No personas exist. `seed.mjs` creates two tenants and module rows only; `reconciliation.md` §10 declares personas out of scope by design. `reset.mjs` is a whole-branch T0 rollback, not a fixture reset |
| **AC3** no literal passwords, admin keys, schedule headers or personal data in harness/fixtures | **PASS** | Scanned `tests/` for `ik_*`, JWTs, password literals, anon keys and org e-mail: clean. `_target.mjs` is identifiers only. `.insforge` is git-ignored. Nothing in `tests/` imports `scratch/` |
| **AC4** drift covers `public`, `storage`, `realtime` **and passes** on reproduced state | **FAIL** | Coverage extended correctly; the AC's second half is false. Reproduced independently: **50 of 293 untracked** |
| **AC5** all live-only policies classified intended/stale; only reviewed intended definitions enter `179500` | **FAIL** | Enumerated, none classified. `migrations/20260912179500_m1m2_reproducibility_baseline.sql` does not exist |
| **AC6** migration dispositions | **PASS** | Verified: `20260812140000` absent locally, both `migrations-pending-deploy/` files present and marked DEFER, `20260904120000` present-and-untracked and marked inherited/immutable. All four decisions given and sound |
| **AC7** deployed-only bodies captured **and assessed for membership/tenant bypasses** | **FAIL** | Five bodies captured (line counts confirmed). No assessment written — and there are real bypasses to assess (B4) |
| **AC8** `check-punch-out-gate` / `on-leave-reviewed` drift, authoritative side named | **FAIL** | No decision recorded anywhere in the package |
| **AC9** rotation confirmed without values; unsafe scratch credentials not reused | **FAIL** | Not done. Aggravated: an admin key appears in **19 git-tracked** `scratch/` files, several pointed at the production parent |
| **AC10** C8 baseline erratum recorded | **PASS** | Independently verified: `migrations/20260813080000_offboarding-safety-foundations.sql:106-113` permits all six relationship types. The erratum is correctly stated |
| **AC11** every DB function classified; migration-only rebuild succeeds | **BLOCKED** | Unachievable as written; requires formal contract revision of `contracts.md` §14.2. No function classification recorded either — that half is owed regardless |

---

## 2. Blockers

### B1 — P0, LIVE NOW: `TB-M1M2`'s hourly schedule drives writes into `BASELINE-RO`

*Booked against `tasks.md` Execution controls, not against any single AC. It is the control the whole
package exists to serve, which makes it a stronger citation than AC1's narrower text.*

**What is wrong.** `reconciliation.md` §2 records this defect as found and fixed: "Repointed to
`https://rq3qmu8y-j9g.function2.insforge.app/run-attendance-derivation` and verified." It is not
repointed. The branch's schedule still targets the parent and is active.

**Evidence** (read-only, 2026-09-13, repo linked to `fb9a8659-9950-4637-a58e-4a882ef24419` / `tb-m1m2`,
confirmed by `current`):

```
name           attendance-derivation-hourly
cronSchedule   20 * * * *
functionUrl    https://rq3qmu8y.function2.insforge.app/run-attendance-derivation   <- PARENT
isActive       true
lastExecutedAt 2026-09-13T07:20:00Z
nextRun        2026-09-13T08:20:00Z
```

`rq3qmu8y` is BASELINE-RO. `rq3qmu8y-j9g` is the branch. `updatedAt` equals `lastExecutedAt`, so
there is no evidence the repoint was ever persisted.

**Why it matters.** Three separate ways:

- It is the precise cross-target contamination P1-00 exists to prevent, arriving through a channel
  the harness guard structurally cannot see, and `tasks.md` Execution controls forbid it on
  BASELINE-RO in terms ("Never … alter schedules … here"). The guard being sound (AC1) is not a
  defence, because this path does not run in this repository.
- **`reconciliation.md` §2 is a false verification record.** A reviewer reading it would conclude the
  hazard is closed. That is worse than not having recorded it, and it puts every other "verified"
  claim in the document under suspicion.
- **The branch's own derivation has never run.** Every hourly tick has gone to the parent. Any
  P2-02/P2-04 work assuming derived attendance rows on `TB-M1M2` will be silently wrong.

The most likely cause is the second-order hazard the package did not consider: `branch reset`
restores T0, and T0 predates the repoint. If so, `npm run test:m1m2:reset` re-arms this every time,
and nothing in `resetBranchToSnapshot` re-audits it.

**Boundary of this evidence.** I did not enumerate BASELINE-RO's own schedules — doing so requires
re-linking to the parent, which is a mutation I declined. So I cannot say whether the parent
additionally runs its own copy of this job. That changes the **blast radius**, not the control
violation: a test target must not hold an active cron whose target host is production, regardless of
what production runs for itself. The claim that the branch's own derivation has never run is
independent of that question and stands on `functionUrl` alone.

**Minimum safe correction.**
1. Immediately set `isActive: false` on the branch schedule, or repoint it to `rq3qmu8y-j9g`.
   Disabling is safer: the branch does not need hourly derivation until P2, and a disabled schedule
   cannot silently re-arm to the wrong host.
2. Determine empirically whether `branch reset` restores schedule configuration, and record the
   answer.
3. Add a post-reset schedule assertion to `resetBranchToSnapshot()` that fails closed if any schedule
   on the target has a `functionUrl` host other than the recorded `TB_M1M2.functionsUrl`. This is the
   correction that makes the guard cover the channel it currently misses.
4. Correct `reconciliation.md` §2 to state what is actually true, with the measurement.

**Type.** Implementation fix (plus a factual correction to the record). No contract change.

---

### B2 — P1-01 cannot satisfy AC1 or AC7 with the files it is allowed to touch

**What is wrong.** P1-00 deferred all eight personas to P1-02 by explicit decision
(`reconciliation.md` §10). Ordering runs P1-01 **before** P1-02 (`tasks.md` steps 4 and 5). P1-01's
acceptance criteria require composed persona sessions:

- AC1: "Employee-only sees My Work; HR+employee sees My Work, applicable Team and Administration;
  **non-employee Company Admin** sees Administration and no personal record."
- AC7: "…deep-link to the correct surface **in a composed session**."

**Evidence.**
- `tests/m1m2/fixtures/seed.mjs` writes `public.tenants` and `public.tenant_modules` only. No auth
  user, no `employees` row, no role. Schema coherence confirmed against
  `migrations/20260817200000_module-registry.sql:11-27`.
- P1-01's Exact allowed files (`tasks.md`) list `src/*`, `migrations/20260912180000_…` and
  `tests/m1m2/p1_capability_contract.mjs`. **No fixture file.** P1-01 may not edit `seed.mjs`.
- Persona provisioning runs through `create-employee-user`, `create-hr-admin-user` and
  `set-employee-password` — all three are **P1-02's** allowed files.
- Worse than a seeding gap: "non-employee Company Admin" is not merely unseeded, it is
  **unrepresentable**. `contracts.md` §6 requires `membershipId`, `membershipStatus`, `accessVersion`,
  `responsibilities[]` and `grants[]`; the tables backing those are created by migration
  `20260912181000`, which is **P1-02's**. Every authority source available to P1-01 (`employees`,
  `employee_roles`, JWT metadata, `is_hr()`) is employee-based by construction (`contracts.md` §2.5).

**Why it matters.** This is the answer to "what blocks P1-01 now." Even if B1 and every AC5/AC7/AC8/AC9
item were closed this afternoon, P1-01 would start, build the seam, and then be unable to produce
evidence for two of its eight ACs. Under `contracts.md` §14.8 that forces "labelled incomplete,"
which cascades into P1-02 consuming a seam that was never demonstrated against the one principal
shape it exists to introduce.

**Minimum safe correction.** One of these three, chosen deliberately and reviewed:

- **(a) Preferred.** Add a persona fixture to P1-00's allowed files — `tests/m1m2/fixtures/personas.mjs`
  — provisioning the employee-only and HR+employee personas through direct SQL plus the auth API,
  explicitly **not** through `create-employee-user` / `create-hr-admin-user`, so P1-02's rewrite is
  not pre-empted. Then move P1-01 AC1's third clause (non-employee Company Admin) and the
  corresponding part of AC7 to **P1-02**, where the membership table that makes the principal
  representable actually lands.
- **(b)** Re-order: P1-02 before P1-01. Rejected — P1-01 owns and freezes the §6 wire shape that
  P1-02 must implement (`contracts.md` §6, `tasks.md` P1-01 Dependencies). The order is correct;
  the AC placement is not.
- **(c)** Grant P1-01 a minimal membership stub in migration `180000`. Rejected — it collides
  head-on with P1-02's ownership of `181000` and would create exactly the two-owner ambiguity the
  v0.4 contract review flagged as its item 1.

**Type.** **Formal `tasks.md` revision requiring P6 re-review.** An implementation agent must not
resolve this by widening its own file list or by inventing a persona path.

---

### B3 — AC5 has no artifact, and the untracked set is the tenant fence itself

**What is wrong.** 50 policies classified: zero. `migrations/20260912179500_m1m2_reproducibility_baseline.sql`
does not exist.

**Evidence.** `node scripts/check-policy-drift.mjs` against the linked branch, reproduced by me:
`POLICY DRIFT: 50 of 293`. Composition:

- **32 public** — of which the large majority are `tenant_isolation` and `tenant_active_restrictive`
  across `attendance`, `calendar_events`, `chat_channel_members`, `chat_channels`, `chat_messages`,
  `employee_documents`, `employee_shifts`, `holidays`, `hr_policies`, `leaves`, `notifications`,
  `task_submissions`, `tasks`, `tenant_settings`, plus `projects` / `shifts` (`tenant_isolation`) and
  `employees` (`employees_hr_all`, `employees_self_select`, `employees_self_update`,
  `tenant_active_restrictive`).
- **18 `storage.objects`** — no migration in this repository creates any storage policy at all.
- **0 realtime** — consistent with RLS being off on `realtime.channels` / `realtime.messages`.

**Why it matters.** The untracked public set is not incidental drift — it *is* the RESTRICTIVE
tenant-isolation fence that the whole security model rests on, and the `employees` policies are the
same family that caused the 42P17 outage on 2026-08-14. Capturing them into `179500` is what makes
the fence reviewable and reproducible; until then, no environment can be rebuilt and no P2/P3 lane can
diff its own changes against a known-good policy set. `storage.objects` matters separately:
P3-01 and P3-03 both depend on that surface being reproducible, and it has never been under the gate.

**Minimum safe correction.** Classify all 50 intended/stale with a recorded disposition each, and
write only reviewed `intended` definitions into `179500` as `DROP POLICY IF EXISTS` + `CREATE POLICY`,
**preserving `AS RESTRICTIVE` exactly**. Re-run the drift check to zero. Note explicitly that
`Public profiles are viewable by everyone` and the `Authenticated users can …employee documents`
family are candidates for `stale`, not automatic `intended` — they are the public-PII-bucket exposure
already on the audit record.

**Type.** Implementation fix.

---

### B4 — AC7: the captured bodies contain real bypasses, and the assessment is the deliverable

**What is wrong.** Capture is done; assessment is not. AC7 conjoins both. Reading the captures
myself, the assessment is not a formality.

**Evidence — `functions/admin-auth-login/index.ts`:**

```ts
function normalizeRole(role, email) {
  if (role) return role;
  if (email.endsWith('@talentmesh.com') || email === 'admin@talentmesh.com') return 'super_admin';
  return 'candidate';
}
```

- The `super_admin` branch fires whenever the `profiles` row is **missing or role-null**.

  I resolved which case is live, read-only against the branch: `public.profiles` **exists**, holds
  **20 rows**, and `role` is nullable with default `'candidate'` — **0 rows** have a null or blank
  role. So the role-null path is dead and the **missing-row** path is the reachable one: it is the
  state of every account created through ordinary signup, because only the separate `auth-signup`
  function writes `profiles`, and open signup is enabled on this backend. Twenty profile rows against
  a backend carrying 23 employees plus non-employee accounts means such accounts already exist.
- Reachability is gated on holding an `@talentmesh.com` address, so this is a design defect rather
  than a demonstrated external exploit. Note the domain is **not** the one HR uses
  (`@talentmeshsolutions.com`), and `admin@talentmesh.com` is additionally hardcoded as an exact
  match — a second, separate identity-as-authority rule.
- `tm_admin_access=true` is set **before** the MFA check; `requiresMfa` is returned to the client as
  advice only. MFA is not enforced server-side.
- There is **no tenant scoping anywhere in the function**. It resolves authority from an e-mail
  domain string.

**Evidence — `functions/daily-incomplete-task-marker/index.ts`:** unauthenticated HTTP,
`Access-Control-Allow-Origin: *`, no caller check, and it iterates `tasks` and writes
`calendar_events` with **no tenant filter** — cross-tenant by construction, fenced only by whatever
the anon key's RLS happens to be. Its own comment claims "The InsForge platform calls it daily at
11:30 PM"; no such schedule exists (only the one in B1), so the job has never run.

**Evidence — provenance.** `profiles`, `mfa_enabled`, `recruiter`/`candidate`, `resumes` and
`recruiter_documents` are the **sister ATS product's** vocabulary, and `grep` finds **no call to any of
these five functions anywhere in `src/`**. These look like foreign artifacts deployed onto the HRMS
backend, not HRMS code.

**Why it matters.** `tasks.md` hands four of the five to P1-02 as editable files in a "sequential
handoff," which presumes they are ours to maintain. The correct disposition may well be **delete**,
not edit — and that decision belongs to P1-00's assessment, before P1-02 spends effort hardening code
that should not be deployed. Separately, an e-mail-domain-to-`super_admin` rule with no tenant fence
is a latent privilege-escalation design defect that must be recorded even though its reachability
depends on controlling that mail domain: it is not a demonstrated external exploit, and should not be
written up as one.

**Minimum safe correction.** Write the AC7 assessment: for each of the five, record (i) does it
enforce tenant scope, (ii) does it enforce caller authentication, (iii) does it derive authority from
anything other than verified server state, and (iv) disposition — `keep`, `harden under P1-02`, or
`delete`. The `public.profiles` question is answered above; carry that measurement into the
assessment rather than re-deriving it. Do not hand any function to P1-02 before its disposition is
`harden`.

**Type.** Implementation fix. If the disposition is `delete` for any of the four handed to P1-02,
that is a `tasks.md` file-list change and needs re-review.

---

### B5 — AC9: an admin key is in 19 git-tracked files, several pointed at production

**What is wrong.** No rotation performed. The hazard `reconciliation.md` §6 describes as "standing"
is understated: the credentials are not merely in loose scratch files, they are **committed**.

**Evidence.** 36 tracked files under `scratch/` contain an admin key or a literal password.
`ik_48f0f767…` appears in 19 of them; `ik_1a616463…` in 2. Base URLs embedded alongside include
`https://rq3qmu8y.ap-southeast.insforge.app` — the production parent. `scratch/` is **not** in
`.gitignore`. `package.json` — a file P1-00 owns and modified — still ships
`"test:hrms-workflows": "node scratch/test-exceptions.js && node scratch/test-leave-approval.js"`,
wiring credential-embedding scripts into the npm script surface.

**Why it matters.** Rotation is not a formality here even though nothing is launched, because the key
is in history and cannot be un-published by editing a file. Until it is rotated, `BASELINE-RO`'s
"read-only" designation is aspirational: anyone with repo access holds write credentials to it.
This also means the branch's isolation claim has a hole — see B6.

**Minimum safe correction.** Rotate `api-key` and `anon-key` on both parent and `tb-m1m2`; rotate the
InsForge account password; record confirmation in `reconciliation.md` §6 **without values**. Add
`scratch/` to `.gitignore` and stop referencing it from `package.json` scripts. Removing the keys from
git history is a separate, larger decision — flag it, do not attempt it inside this package.

**Type.** Implementation fix plus user action.

---

### B6 — A branch was substituted for the "dedicated non-production project" the controls require

**What is wrong.** `tasks.md` Execution controls define `TB-M1M2` as "a dedicated non-production
project with **isolated database, auth, storage, functions, realtime and schedules**." A full branch
gives isolated database, storage, functions and realtime — but it **shares the parent's
`JWT_SECRET`** (`reconciliation.md` §6 states this), so auth is not isolated: a token minted on the
parent validates on the branch and vice versa. And per B1, schedules were not isolated either.

**Why it matters.** I want to be clear that **the branch decision is correct** and I would not reverse
it. The evidence in `reconciliation.md` §1 is strong: `migrations/` genuinely is not a schema source
(verified — no repo SQL creates `public.tenants` or `public.employees`), and the `db export`
measurement showing all 84 RESTRICTIVE policies rendered PERMISSIVE is a disqualifying,
well-found result that was rightly reported upstream. The problem is procedural: a frozen execution
control was changed and the package marked itself substantially complete rather than escalating.
`_target.mjs` records the target's `status` as `"AUTHORIZED"` on its own authority, while `tasks.md`
still reads `BLOCKED: project ID/base URL not verified or authorized`.

Combined with B5, the shared `JWT_SECRET` plus an unrotated parent admin key in git means the two
backends are not meaningfully separated today.

**Minimum safe correction.** Amend `tasks.md`'s Execution controls to define `TB-M1M2` as a full
branch, state the shared-`JWT_SECRET` limitation explicitly, and record that cross-**backend**
isolation negatives run against `ISOLATION_CONTROL` while the branch proves cross-**tenant**
isolation only — which `_target.mjs` already says correctly in its own comments. Then mark the target
authorized in `tasks.md`, not only in code.

**Type.** **Formal `tasks.md` revision requiring P6 re-review** (a frozen control changes). Small,
but it should not be ratified silently by a reviewer under time pressure.

---

### B7 — AC11 is unachievable as written; `contracts.md` §14.2 must change

**What is wrong.** §14.2 states: "`TB-M1M2` is not reproducible until a clean rebuild succeeds from
`migrations/` alone, without root-level ad-hoc SQL." `migrations/` has never contained the core
schema, so no amount of implementation effort satisfies this.

**Evidence.** Verified independently: 110 `.sql` files in `migrations/`, and no `CREATE TABLE` for
`tenants` or `employees` anywhere in them. `reconciliation.md` §1 measures 45 referenced-but-uncreated
objects. The obvious tool, `db export`, is disqualified on its own measurement (§1).

**Why it matters.** Beyond the gate: with no repository schema source there is no way to stand up
staging, onboard a second environment, or rebuild after a loss, and this project has no backup/DR
policy. The reconciliation is right that this is cheapest to fix now, while all data is dummy.

**Minimum safe correction.** I am **not** granting this in a PACKAGE review, and I will not reinterpret
the frozen text to obtain acceptance. I do endorse the shape `reconciliation.md` §8 proposes, for the
contract owner to take to formal review:

1. Redefine M1 reproducibility as "a reviewed baseline snapshot **plus** `migrations/` applied on
   top," with repository-only reproducibility scheduled as explicit work rather than assumed.
2. Schedule the real capture — `pg_dump --schema-only` via `db connection-string`, or InsForge
   `backups` — as a named deliverable with an owner.

**Separately and regardless of the contract outcome:** the function-classification half of AC11 is
owed and is entirely achievable today. Not one of the eight named functions
(`exec_sql`, `query_json`, `update_user_password`, `close_stale_attendance`, `get_auth_tenant_id`,
`can_access_tenant`, `is_superadmin`, `tenant_is_active`) has a recorded disposition. "Present on the
branch and inherited faithfully" is a provenance statement, not a classification. `exec_sql`,
`query_json` and `update_user_password` are exactly the three §14.2 says must not be copied forward
merely because a rebuild discovers them.

**Type.** **Formal `contracts.md` revision requiring P6 re-review** for the rebuild clause; the
function classification is an implementation fix that should proceed now.

---

## 3. Non-blocking findings

1. **The CLI is not actually pinned.** `package.json` declares `"@insforge/cli": "^0.2.8"` — a caret
   range. `_target.mjs` names `REQUIRED_CLI = "@insforge/cli@0.2.8"` and both it and `_harness.mjs`
   comment that the version is "genuinely pinned." 0.2.9 would resolve silently on the next install.
   Given that a stale 0.1.73 is what produced the original misdiagnosis, use an exact version.
2. **`resetBranchToSnapshot()` leaves a window linked to BASELINE-RO.** It runs
   `branch switch --parent`, then `branch reset`, then switches back in a `finally`. An interrupt
   between them leaves the repository linked to the production parent. The next guarded run catches
   it, but an unguarded `npx insforge db query` by a human would not. Re-verify target identity after
   switch-back, and log the parent-context window explicitly.
3. **`reset.mjs` is broader than AC2 describes** and than its name suggests: it discards all applied
   migrations, so any lane that has applied `180000` loses it. The docstring says so, the console
   message says so, but the package script is called `test:m1m2:reset` and reads like a fixture reset.
   Consider `test:m1m2:reset-backend`.
4. **`check-policy-drift.mjs` does not verify which project it is querying.** It reads whatever is
   linked. Read-only, so harmless today, but its "OK — all N live RLS policies are defined in
   migrations/" line carries no target identity, and AC4 is specifically about *reproduced `TB-M1M2`*
   state. Print the verified project id, or route it through `verifyTarget()`.
5. **The whole package is uncommitted.** `tests/`, `doc/execution/`, the five function captures and
   the migration `20260904120000` are all untracked; `package.json` and `check-policy-drift.mjs` are
   modified in the working tree. `contracts.md` §14.5 requires each package to report its exact
   revision — there is nothing to cite. Commit the package before re-review.
6. **The four pre-existing limiter edits are intact.** `functions/create-employee-user.ts`,
   `finalize-onboarding.ts`, `set-employee-password.ts` and `verify-employee-code.ts` still carry
   their uncommitted changes. The "preservation of existing user changes" gate is met. They remain
   unverified against a running backend — P1-02 AC12 owns that.
7. **The drift-script hardening is good work and should be called out.** Matching the
   `(schema, table, policy)` triple rather than a bare name substring, and extending to `storage` and
   `realtime`, is what surfaced the 18 storage policies that no gate had ever seen. That is the single
   most valuable thing this package produced.

---

## 4. What is genuinely done

To be fair to the package, these hold up under independent check and P1-01 can rely on them:

- The target guard fails closed on all four vectors, verified by running the self-test:
  `WRONG_PROJECT`, `BASELINE_RO_DENIED`, `BRANCH_LINEAGE_MISMATCH`, `CLI_ARGUMENT_DENIED`.
- Link metadata is coherent with the guard's expectations (`oss_host` carries a scheme,
  `branched_from` is populated, `project_id` is the branch) — so the recorded AC1/AC2 runs are
  mechanically plausible.
- `seed.mjs` is genuinely deterministic and idempotent, and its SQL is coherent with
  `migrations/20260817200000_module-registry.sql`. Counting `enabled = true` rather than rows is the
  right call for a backend where new tenants are born fully entitled.
- AC6's four dispositions are correct and independently verified.
- AC10's erratum is correct and independently verified.
- AC3 is clean as scoped.

---

## 5. Correction classification

| Blocker | Implementation fix | Contract / task revision + P6 re-review |
|---|---|---|
| B1 schedule contaminating BASELINE-RO | yes (P0, today) | — |
| B2 P1-01 personas / AC placement | — | yes — `tasks.md` |
| B3 AC5 policy classification + `179500` | yes | — |
| B4 AC7 bypass assessment | yes | only if a disposition is `delete` |
| B5 AC9 rotation and `scratch/` hygiene | yes | — |
| B6 branch vs. dedicated project | — | yes — `tasks.md` Execution controls |
| B7 AC11 rebuild clause | function classification: yes | yes — `contracts.md` §14.2 |

---

## 6. Scope of this review

**Verified by execution** (all read-only, all against the linked branch): harness self-test (local
only, no network); `insforge current`; `insforge schedules list` (header values redacted, names only);
`scripts/check-policy-drift.mjs`; `information_schema` lookups for `public.profiles` existence and
`profiles.role` nullability; one aggregate-only `count(*)` over `profiles` (no row content read).

**Verified by source inspection:** all five captured function bodies in full; `_harness.mjs`,
`_target.mjs`, `seed.mjs`, `reset.mjs`, `check-policy-drift.mjs`; `package.json` diff; the module
registry, offboarding and pending-deploy migrations; `migrations/` for core-table creation;
`.gitignore`; `git ls-files scratch` credential scan; P1-00 and P1-01 allowed-file lists;
`contracts.md` §1–§3, §6, §7, §12, §13, §14.

**Not verified:** anything requiring a mutation. I did not re-stage the real mis-target denial, since
re-linking to BASELINE-RO is itself a link-state mutation and `reconciliation.md` §9 records that the
parent link returns stale. I did not fix B1 — it is reported for the lead to action. No credential
value was read or printed at any point.

---

## Verdict

**CHANGES REQUIRED — P1-01 REMAINS BLOCKED**

**P1-01 eligible: NO.**

Close B1 today regardless of everything else. B3, B4, B5 and the function-classification half of B7
are ordinary implementation work inside the frozen contract. B2 and B6 need a `tasks.md` revision and
B7's rebuild clause needs a `contracts.md` revision — take those three to formal review together,
in one pass, rather than discovering them one at a time.
