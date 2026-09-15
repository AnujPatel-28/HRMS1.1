# TalentMesh HRMS — direction review, second opinion

**Date:** 2026-09-09. **Reviews:** `product_validation_2026-09-09.md` and
`discussionOnProduct_validaation.md`, against the live parent backend `rq3qmu8y` and current `src/`.
**Nothing was changed** — no migrations applied, no functions deployed, no data written.

This is a *second opinion on the validation doc*, not a replacement for it. Where I agree I say so
briefly. The value here is in the three places I disagree, one production defect neither document
caught as live, and direct answers to the questions you actually asked.

---

## 0. Your questions, answered in one line each

| Your question | Answer |
|---|---|
| Is the overall direction right? | **Yes.** Multi-tenant shared schema + subdomain + platform console + module registry is the standard architecture for this product category. Do not restructure again. |
| Is the role/permission flow correct? | **No — but it is not broken either. It is *unfinished*, and it is unfinished in the right shape.** The table exists (`employee_roles`, role + scope). It has no writer and 3 rows. See §3. |
| Subdomain approach? | **Correct. Keep it.** One caveat that matters for React Native: the hostname must stay a *lookup*, never an authorization input. It already is. §5 |
| Super admin (you) controls tenants' modules? | **Correct, and it matches every competitor.** But the seeding trigger currently contradicts it — every new tenant is born with all 13 modules enabled. §6 |
| Assign an HR Admin, or build an "HR admin panel"? | **Both, and they are not alternatives.** Invite a *named person* as the first admin (never a shared panel login); the *area* they land in is called Company Administration. §4 |
| Permissions per role? | Build the **resolver** now, the **10-role matrix** later. Splitting roles before a customer asks you to split them is the expensive mistake. §3 |
| Payroll last? | **Yes, still right** — and it is now also the cheapest place to introduce fine-grained permissions, because it is the one module being written from scratch. §7 |
| Will this compete without being weird/confusing? | Yes, but the confusion risk is **not** the role model. It is the split HR/employee navigation and the month-end bulk gap. §8 |

---

## 1. STOP — HR onboarding is hard-blocked in production right now

This outranks every strategic item below. **Verified live today:**

```
select has_function_privilege('authenticated',
  'public.check_rate_limit(uuid,uuid,text,integer,interval)','EXECUTE');   -> false
select count(*) from system.custom_migrations where version = 20260904120000;  -> 1  (APPLIED)
select max(version) from system.custom_migrations;                            -> 20260904120000
```

The 2026-09-04 hardening migration **was applied** (the session handoff still says "staged,
UNAPPLIED" — that is now stale). Its REVOKE list was justified by "verified no frontend `.rpc()`
caller". That check was correct and still missed the real callers: **the edge functions call it with
the caller's token, not the admin key.**

Four deployed functions, all confirmed against the *deployed* source, not just the repo:

| Function | Deployed line | Client used |
|---|---|---|
| `create-employee-user` | 244 | `createClient({ edgeFunctionToken: callerToken })` |
| `verify-employee-code` | 86 | `edgeFunctionToken: callerToken` |
| `set-employee-password` | 108 | `edgeFunctionToken: userToken` |
| `finalize-onboarding` | 93 | `edgeFunctionToken: userToken` |

Every one of them returns HTTP 500 on `rateLimitErr`. So the whole HR-driven onboarding chain —
create employee → verify code → set password → finalize — fails for any caller whose token resolves
to `authenticated`. The §2a smoke test in the 09-04 handoff was never run.

**The one step I did not execute, and why I am confident anyway.** I did not call an edge function to
reproduce the 500 (it would mutate accounts and possibly send mail), so I have not *directly* observed
that `edgeFunctionToken` resolves to the `authenticated` role. Three things make it near-certain:

- The ACL is exhaustive and admits nothing else: `proacl = {project_admin=X/project_admin}`. No
  `anon`, no `authenticated`, no `PUBLIC`.
- The same client is used two lines earlier for `client.auth.getCurrentUser()`, and the function then
  reads `user.metadata.role` off the result to check HR-ness. That only works if the token is acting
  *as the caller*, which is the whole purpose of `edgeFunctionToken`.
- **It already happened, in this codebase, by this exact mechanism.** From 2026-08-17 to 2026-09-02,
  `check_rate_limit` was revoked, `create-employee-user` called it on a caller-token client, and HR
  could not create a single employee for two weeks. That is empirical proof that a caller-token
  client hits the `authenticated` ACL here.

**Data corroborates it.** Last employee created anywhere in the system: **2026-09-02 17:44 UTC** —
hours after the round-1 fix. **Zero employees created since the migration landed on 2026-09-04.**
Suggestive rather than conclusive on its own (nobody may have tried in five days), but it points the
same way as everything else. If you want certainty before touching code, one HR-authenticated call to
`create-employee-user` in a throwaway tenant settles it.

**The bitter part:** the comment sitting directly above the failing call in
`create-employee-user.ts:249` documents this exact failure happening once before, from 2026-08-17,
and explains that it was hidden for weeks. The migration recreated it.

### The fix — one line per function, no migration, hardening preserved

Do **not** re-`GRANT EXECUTE ... TO authenticated`. `check_rate_limit(p_tenant_id, p_user_id, ...)`
is fully caller-parameterised: an authenticated user who can execute it can burn or reset *another*
user's counter. The REVOKE was the right call.

Instead, run the limiter on the **server** client. Verified live: `project_admin` **does** hold
EXECUTE (`postgres` and `project_admin` true; `anon` and `authenticated` false). Every one of the
four functions already builds an admin client
(`createClient({ baseUrl: BASE_URL, anonKey: ADMIN_KEY })`) somewhere in the same file.

```diff
- const { data: rateLimitOk, error: rateLimitErr } = await client.database.rpc("check_rate_limit", {
+ const { data: rateLimitOk, error: rateLimitErr } = await adminClient.database.rpc("check_rate_limit", {
```

This is also *more* correct than the original, not a workaround: caller identity is already verified
above the call (role + tenant match), and a rate limiter should never be executed by the subject it
is limiting. Keep passing the verified `user.id` / `actorId` as `p_user_id` — those values are
server-derived from the validated token, not from the request body.

**Before you ship it:** confirm each function has an admin client *in scope at the call site*.
`create-employee-user` and `verify-employee-code` build theirs earlier in the handler;
`finalize-onboarding` builds one only at line 103, **after** the limiter call at line 90 — that one
needs the construction moved up. Then smoke-test one real employee creation end to end.

> **Process lesson worth writing down:** "no frontend `.rpc()` caller" is not the same as "no
> authenticated caller." Edge functions that impersonate the caller *are* authenticated callers.
> Grep `functions/` as well as `src/` before any REVOKE — and grep the **deployed** source, since
> six functions have no local copy.

---

## 2. Verdict on the validation doc: right about *what*, wrong about *when*

`product_validation_2026-09-09.md` is a good document. Its security findings are real, its role
taxonomy is sane, and its refusal to endorse a rewrite is correct. I checked the factual claims I
could check and found them accurate, including its corrections table.

My disagreement is about **proportion**, and it rests on numbers neither document states:

| Fact | Live value |
|---|---|
| Tenants | 15 (10 of them empty, per FRD decision #12) |
| Employee records, **all tenants combined** | **23** |
| Rows in `employee_roles` | **3** — all `owner`, all `scope_type = tenant` |
| Frontend/edge code that *writes* `employee_roles` | **none** (two references, both comments) |
| RLS policies whose `USING`/`WITH CHECK` calls `is_hr()` | **80**, across 68 tables |
| SECURITY DEFINER functions whose body calls `is_hr()` | **22** |

Read those two blocks together. You have **zero paying customers** and **102 places** where
"HR-ness" is a hardcoded boolean. The validation doc recommends, before launch: 10 role templates,
named permissions, a scope system, an effective-permissions API, a provisioning job with idempotency
keys, a company setup wizard, and a shared approval foundation.

Every one of those is a *correct eventual target*. Delivered as a pre-launch programme, it is
**three to six weeks of rewriting the security layer you just spent a month hardening** — and you
would be choosing which permissions to split without a single customer having told you which splits
they need. That is designing the abstraction before you have the requirement.

It also sits in **direct, unacknowledged conflict** with your own 2026-09-02 target-state FRD §9,
which says: *"Constraint: launch as fast as possible. V1 is defined by what can be cut."* That FRD
explicitly **cuts** the approval-chain engine and the leave-ledger rebuild. The 09-09 validation doc
puts an equivalent-sized programme back in front of launch, and never mentions that it is
overturning a decision you already made.

**Pick the FRD's order.** It was made with the same evidence and a clearer head about cost. Then
take from the validation doc only the items that are either (a) security, or (b) *cheaper now than
later*. §3.3 sorts them on exactly that axis.

---

## 2A. "An HRMS is a crucial system — is it responsible to put a real company on this?"

The objection is correct and it changes the shape of the answer, so it gets its own section. A
customer runs their operations and stores their people's personal data here. Getting it wrong is not
a bad demo; it is someone's salary, someone's leave record, someone's Aadhaar number.

**But "build it completely first" is the wrong conclusion, for a reason worth being precise about.**
There are two different axes here and they are being treated as one:

| Axis | What incompleteness means | Does it hurt the customer? |
|---|---|---|
| **Breadth** — how many modules exist | Payroll absent, no performance module, no roster grid | **No**, provided you are honest. A customer who knows payroll isn't included keeps using their CA. This is a *sales* limitation |
| **Trustworthiness** — does what is present do what it claims | A setting that displays but doesn't enforce; a payroll screen that computes wrong; chat that crosses tenants; a punch that silently vanishes | **Yes. This is the whole risk.** |

The validation doc's ten-role matrix sits on the **breadth** axis. Building it does not make one
byte of customer data safer. What follows is the trustworthiness axis, and here I would set the bar
*higher* than either document does.

### 2A.1 The trust bar — non-negotiable before any real company touches this

Each item below is verified, not hypothetical.

**T1 — Nothing half-built may be reachable.** ✅ **Live: `payroll` is enabled on 14 of 15 tenants.**
You have told me payroll is unfinished and pending a redesign. Right now a customer handed this
system would see a Payroll menu, use it, and get numbers you do not stand behind. **This is the exact
harm you are worried about, and it is not caused by a missing feature — it is caused by an unfinished
feature being switched on.** Turn it off at the entitlement layer (§6.1). Same question for
`insurance`, `expenses` and `connect`, each enabled on 13 tenants: for every module, either it is
trustworthy or it is off. There is no third state.

**T2 — Every visible control must actually do something.** Your own
`policy_center_settings_inventory_2026-09-03.md` found **42 controls of which 12 enforce**. A
customer who sets "late mark after 15 minutes", sees it save, and finds it was never applied has been
actively misled — worse than the setting not existing, because they made staffing decisions believing
it. Every non-enforcing control must be removed or visibly disabled before a customer sees it.

**T3 — Tenant isolation must be provable, not assumed.** Global realtime chat channels and public PII
buckets (§3.3). Under India's DPDP Act this is your liability, not the customer's.

**T4 — Recoverability must be demonstrated.** I searched the entire `doc/` tree: **there is no
backup, restore, or disaster-recovery policy anywhere**, and neither the validation doc nor the FRD
mentions one. For a system of record that is a larger gap than anything in the role model. Before a
customer's data goes in, you need a known answer to "a tenant's data was corrupted on Tuesday — how
far back can we go, and how long does it take?", and you need to have **actually performed a
restore**, not assumed the platform does it. (The CLI installed here has no `backups` command — it is
stale; confirm what the platform offers rather than trusting either fact.)

**T5 — The system must tell you when it breaks.** This is the one your own history argues hardest
for. Employee onboarding has been completely broken **twice**, for two weeks and then five days, and
**both times nobody found out until someone went looking.** No amount of additional building fixes
that; error visibility does. A customer whose HR cannot onboard for two weeks does not care how many
roles you support.

**T6 — No vendor-held credentials.** You currently generate and see every tenant admin's password
(§4). For a system holding other people's PII this is the single least defensible thing in the
product.

**T7 — Corrections leave a trail.** In a system of record, "who changed this attendance row, when,
and why" is not a nice-to-have. Attendance already has this. Confirm it before each module goes live,
not after.

Notice what is *not* on this list: role granularity, approval chains, bulk tooling, payroll. Those
decide whether the product is *good*. T1–T7 decide whether it is *safe*. Ship on safety; iterate on
good.

### 2A.2 The doctrine that removes the risk entirely: parallel run

The fear underneath your question is *"if it breaks, the customer's operations break."* There is a
standard answer, and it is how real HRMS and payroll migrations are actually done — nobody cuts over
on day one:

> **The first customer runs TalentMesh alongside their existing process for one full month, and
> reconciles the two at month end.** Their old register/spreadsheet stays authoritative. TalentMesh is
> shadow-running.

This changes everything about the risk profile:

- Their operations are **never** dependent on you during the month that finds the bugs.
- A discrepancy is *information*, not an incident. Reconciliation is the test — and it is a far
  better test than the 29 unrun QA cases, because it is a real month of real human behaviour.
- It gives you a defensible commercial framing: a **paid pilot with a named design partner**, agreed
  in writing as a pilot. Not "launch". You are not claiming completeness, so you are not lying.
- It converts the FRD's exit criterion ("one real company, 50+ people, one full month, CA accepts the
  export") from a leap of faith into a controlled experiment.

Only after a clean reconciliation month does that customer stop dual-running. Repeat for customers
two and three. This is slower to *revenue* and dramatically faster to *trust*.

### 2A.3 Why waiting to build more actually increases the risk

The instinct "build it more completely, then expose it to a customer" feels safer and is not,
for one specific reason:

- Your flagship attendance feature — punch, selfie, GPS — **has never been exercised by a real person
  on a real phone** (FRD §9.2 item 7, still open).
- 29 QA cases remain unrun.
- Onboarding broke twice and stayed broken because nobody was using it.

**Every one of those is a "nobody is using this" problem, not a "not enough is built" problem.**
Another three months of building without a real user produces more unexercised code, more undetected
breakage, and the same uncertainty about whether it is good for a customer — because that question
can only be answered by a customer. The parallel run is how you get the answer without putting anyone
at risk.

So: I am not arguing for a lower bar than you want. I am arguing for the bar to sit on T1–T7 —
which is a **higher** bar than either existing document sets, and which your product does not
currently clear — rather than on module count, where clearing it changes nothing for the customer.

---

## 3. The permission model — the one place both documents are actually wrong

### 3.1 The two-sources "inconsistency" is a deliberate design, and it is right

Both documents flag this as a defect. The ChatGPT explainer escalates it hardest:

> "Your UI, database and edge functions don't agree on the same role model. That's bad."

The *finding* is real — `src/types/index.ts:1` allows only `hr | employee | superadmin`, `App.tsx`
gates are exclusive (`currentRole !== role`), while live `is_hr()` accepts **either** metadata
`role = 'hr'` **or** an active `employee_roles.role = 'hr_admin'`. I verified all of that.

But the recommended cure — "one authoritative permission model", i.e. unify the sources — is wrong,
and your repo already knows why. `migrations/20260821120000` carries a long comment block explaining
that unification was **attempted and proven not buildable**:

- Four HR admins have **no `employees` row at all** — `create-hr-admin-user` provisions a tenant's
  first admin as an auth user only.
- `employee_roles.employee_id` is `NOT NULL REFERENCES employees(id)`.
- Therefore those people **cannot physically hold a row** in the RBAC table.
- And copying `hr` into `employee_roles` anyway stores the fact twice with only one writer — which
  is precisely how `employees.department` came to contradict `org_units` on 7 of 16 rows.

So the two sources are non-overlapping **on purpose**: the JWT answers *"is this session HR, and in
which tenant"*; `employee_roles` answers *"which scoped grants exist that a JWT cannot express."*

### 3.2 The correct fix: one *resolver*, not one *source*

What is actually missing is not a unified store. It is that **every client re-implements the
question**. The frontend reads `user.metadata.role` and stops; `is_hr()` reads both branches;
`create-employee-user` insists on metadata `role === 'hr'` and rejects a delegated `hr_admin`
outright.

Build a single server-side resolver that composes both branches, and make React, the edge functions
and (later) React Native all read it:

```sql
create or replace function public.get_my_access()
returns jsonb
language sql stable security definer set search_path to ''
as $fn$
  select jsonb_build_object(
    'user_id',           (select auth.uid()),
    'tenant_id',         public.get_auth_tenant_id(),
    'is_hr',             public.is_hr(),
    'is_platform_admin', public.get_my_platform_role() is not null,
    'employee_id',       (select e.id from public.employees e
                           where e.user_id = (select auth.uid())),
    'grants',            coalesce((
                           select jsonb_agg(jsonb_build_object(
                                    'role',       r.role,
                                    'scope_type', r.scope_type,
                                    'scope_id',   r.scope_id))
                           from public.employee_roles r
                           join public.employees me on me.id = r.employee_id
                           where me.user_id = (select auth.uid())
                             and r.is_active), '[]'::jsonb)
  );
$fn$;
```

Two properties make this safe and worth doing now:

1. **It calls the same functions the 80 policies call** (`is_hr()`, `get_auth_tenant_id()`) rather
   than re-deriving their logic. A reimplementation would become a second authority that drifts from
   the RLS layer — the same failure mode as §3.1.
2. **It takes no parameters and reports only on the caller.** That sidesteps the param-blindness trap
   that produced 14 unfenced DEFINER functions (memory `hrms-rls-not-a-backstop-in-definer-rpcs`).

Cost: roughly one day, including repointing `AuthContext` and the four onboarding functions'
`callerRole !== 'hr'` checks at it. Benefit: from that day on a delegated `hr_admin` works
everywhere, and every future permission split is a change *inside one function* rather than across
three layers. (`get_my_platform_role()` exists live with zero arguments ✅, so the sample above
compiles as written.)

> ⚠️ **Write this rule in the function's comment, or it will be misused within a week.**
> `get_my_access()` is for **rendering** — deciding which menu items and buttons to draw. It is
> **never** authorization. The database layer must keep enforcing independently, exactly as it does
> today. The blob it returns is not a credential: the moment someone passes it into an edge function
> as proof of HR-ness, you have rebuilt the browser-supplied-role hole the validation doc correctly
> warns about. Every server-side path must re-derive authority from `auth.uid()` itself.

### 3.3 What to build now vs. later — sorted by whether the cost grows

The sort key is not importance. It is **does this get more expensive the longer I wait?**

**Do now — cost scales with customer/data count, and you have almost none:**

| Item | Why now | Size |
|---|---|---|
| Fix the four rate-limit calls (§1) | Prod is down | hours |
| `get_my_access()` resolver + all clients read it (§3.2) | Every later split routes through it | ~1 day |
| **HR gets self-service** — replace exclusive `RequireRole` gates with permission checks | An HR admin today cannot open their own leave or payslips. Every evaluator finds this in 5 minutes | ~1 day |
| **Membership as a first-class row** — a `tenant_members` row that does *not* require an `employees` row | This is what unblocks §3.1 permanently, fixes the orphan classifier, and lets a consultant or a two-company user exist | 2–3 days |
| `seed_tenant_modules` → seed *purchased* modules, not all 13 | 15 tenants to correct today; 500 later | hours |
| Public buckets → private + signed URLs | **15 objects total.** Rewriting stored URLs is trivial now and awful at 50k files | 1–2 days |
| Realtime per-tenant channel names | You are rebuilding chat anyway — fold it in, don't do it twice | in the rebuild |

**Do later — code-shaped, costs the same whenever you do it:**

10-role template matrix · named-permission catalogue (`payroll.approve` &c.) across all 80 policies ·
effective-permission caching and invalidation · approval-chain engine · delegation and escalation ·
auditor / clearance-assignee role.

**Do not touch any of the 80 hardened policies in this pass.** They are the layer the 09-04 audit
found genuinely sound. Rewriting them to take a permission name is how you turn a working security
model into a month of regressions.

> ⚠️ **`tenant_members` is a third store of "who is in this tenant" — settle its authority before you
> create it, or §3.1 happens again.** There are already two: `auth.users.metadata.tenant_id` (what
> `get_auth_tenant_id()` reads, and therefore load-bearing in all 80 policies) and
> `employees.tenant_id`. A third, added carelessly, is `employees.department` vs `org_units` all over
> again.
>
> The rule that keeps it safe: **`tenant_members` is additive, and the JWT stays authoritative for
> tenancy.** `get_auth_tenant_id()` does not change and the 80 policies do not change.
> `tenant_members` exists to carry the two facts the JWT cannot: *people who have no `employees` row*
> (your four orphan admins), and *scoped grants*. It must have **exactly one writer** — the same
> provisioning path that sets the JWT metadata, writing both in one transaction — and a reconciliation
> query you can run on demand to prove the two agree. If you cannot commit to the single writer, do
> not build the table; keep using the JWT alone and accept that delegated admins need an `employees`
> row.

### 3.4 The cheap on-ramp for the full matrix: build it inside payroll only

Earn the permission abstraction before you pay for it. Payroll is the perfect place:

- It is being **written from scratch**, so there is no migration cost.
- It is the **one module with a genuine separation of duty** — the person who enters a salary must
  not be the person who releases the run. That is not theory; it is the control an auditor checks.
- It is a **small, self-contained set of tables**, so `has_perm('payroll.prepare')` /
  `has_perm('payroll.approve')` lands in ~6–10 policies, not 80.

If the pattern proves itself there, extend it outward — `employees.read_sensitive`, `reports.export`,
`roles.assign` — one permission at a time, driven by a customer actually asking. If it does not prove
itself, you have lost nothing and touched nothing that was working.

`is_hr()` remains the coarse gate everywhere else. It is not technical debt; it is **the correct
level of granularity for a 30-person company**, which is your target buyer.

### 3.5 "Is it actually OK to defer this? It's their company data."

The fair challenge to §3.3. Answered precisely, because the honest answer is *conditional*, not yes.

**First — separate two things that are being merged.** Deferring the role **matrix** is not deferring
**access control**. What is *not* deferred, and must be true before any customer:

| Boundary | Status |
|---|---|
| One company cannot see another's data | ✅ Sound — RESTRICTIVE `tenant_isolation` on every content table, confirmed by the 09-04 audit |
| An ordinary employee cannot read colleagues' salary/PII | ✅ Policy-enforced |
| Enforcement lives in the database, not the browser | ✅ True today |
| Realtime channels + storage buckets respect that boundary | ❌ **Broken — and in the "do now" list, not deferred** |

**Second — name exactly what the deferral costs.** The *only* thing the coarse model cannot express
is **tiering within the HR population**. Everyone the customer designates as HR sees everything HR
sees. So:

- Customer with **one HR person** → the split is a no-op. Zero exposure.
- Customer with **an HR manager + two executives** → the executives see salary and every document.
  Real exposure.
- **Payroll** → one person can enter *and* approve a salary. No maker-checker. Real control gap.

For your stated target — 30–200 employees, one or two trusted HR people — a single HR role is not a
compromise. It **matches the customer's actual org structure**. Modelling four HR tiers for a company
with one HR person is fiction, and fiction in a permission system is its own risk.

**Third — the reassurance that actually carries weight: you already own the hard part.**
`employee_roles` has `role`, `scope_type`, `scope_id`, `is_active` and a scope-integrity CHECK. The
**data model can already express a scoped grant.** What is missing is a writer and the enforcement
checks. That is the right thing to defer: schema is expensive to retrofit, checks are cheap to add.
If the schema *couldn't* express it, my advice would be the opposite — fix it now.

**Fourth — the two hard triggers that end the deferral.** Not "later"; these:

1. **A customer asks for a tiered HR team.** Build it then, against a real requirement instead of a
   guess. Until then, see the honesty constraint below.
2. **Payroll goes live.** Maker-checker is a financial control, not a nicety — and this is already
   where §3.4 puts `has_perm()`. The sequencing lines up on its own.

### 3.6 The one thing this question moves from "later" to "now": audit the reads

This is a genuine change to §3.3, prompted by the objection.

When roles are coarse, **the compensating control is accountability**: if you cannot *prevent* an HR
user from seeing something, you must *record* that they did. That is a normal, defensible security
posture — it is how small finance teams operate. What is not defensible is coarse roles **and** no
record.

You are half way there already. ✅ Live: `audit_logs` is a real base table with 65 rows and
meaningful actions — `attendance.edited`, `leave.approved`, `overtime.approved`, `org_unit.created`
(`audit_log` is a VIEW over it, not drift). But **every action logged is a write.**

The gap: **sensitive reads are not logged at all.** Add entries for

- viewing salary, bank details, Aadhaar/PAN,
- downloading an employee document,
- any bulk export or report of employee data,
- (from §6.3) a platform admin entering a tenant.

Also note ⚠️ `attendance_audit_logs` has **0 rows** — the most-built module's dedicated audit table
has never been written to. Either wire it up or drop it; an empty audit table that looks like an
audit trail is worse than none, because it will be trusted in an incident.

Cost: small — one helper and a call at each sensitive read path. Value: it converts "we trust HR"
into "we can show the customer exactly what HR looked at", which is what a DPDP review or a
customer's own auditor will ask for.

**So the honest answer.** Deferring the role matrix is **OK for a customer whose HR team is one or
two trusted people, provided you add read auditing (§3.6) and clear the trust bar (§2A.1).** It is
**not OK** for a customer who needs a tiered HR team — and the correct response there is not to ship
it anyway, it is **not to sell to them yet**. Say that plainly in a sales conversation. Refusing a
customer you cannot serve safely is a stronger trust signal than any feature.

---

## 4. "Assign an HR Admin" or "build an HR admin panel"? — both, and don't confuse them

This is the question where the wording is doing damage, and the validation doc's answer is right.

**They are different kinds of thing:**

- **HR Admin is a *person with a role*.** It is who may act.
- **HR Administration is an *area of the product*.** It is where they act.

So: when a tenant is created you **invite a named human being** — not "create the HR panel login."
That person lands in **Company Administration**, inside which sit HR Administration and the Policy
Center. Both exist. Neither replaces the other.

**Why a named invite rather than a provisioned shared login — this is the part that matters:**

Today `AddCompany.tsx` inserts the tenant in React and calls `create-hr-admin-user`, which mints an
auth user with a **temporary password that you, the vendor, generate and display on screen**. That
means:

- You know the customer's admin password. So does anyone who screenshots the provisioning page.
- There is no non-repudiation. If salary data walks out of that account, the customer can point at you.
- Your own memory note `hrms-no-employee-password-self-service` records that HR already permanently
  knows every employee password. This is the same defect one level up, and worse — the account it
  applies to is the account that can see everything.

The invite flow (already decided in target-state FRD §9A.5, and now nearly free since SMTP is live
via Resend) fixes all three: the named owner receives a link, verifies their own address, and sets a
password nobody else has ever seen.

**Industry confirms the separation.** BambooHR maintains a distinct **Account Owner** vs **Full
Admin** distinction as its own documented topic, and lists "Payroll Admin, Full Admin, and Account
Owner" as separate roles. Zoho People's "Super Administrator" is the *customer's* primary account
holder — note the name collision with your own platform-level "superadmin", which is exactly the
confusion the validation doc warns about. Keka ships predefined HR Admin / HR Executive / Payroll
Admin roles with location and department scopes.

**Two naming decisions I would make today, because renaming later is a migration:**

1. Stop using `superadmin` for *your* platform role in any customer-visible string. Zoho and Keka
   both use "Super Admin" to mean the *customer's* top user. Call yours **Platform Admin**.
2. Call the tenant area **Company Administration**, not "HR Panel".

**And settle FRD decision #11 now:** either give the first admin an `employees` row flagged
non-payroll, or give them a `tenant_members` row without one (§3.3). Either works. Leaving it
undecided is what produced the four orphan accounts that block `employee_roles` in the first place.

---

## 5. Subdomain — correct, keep it, one caveat

`company.hrms.talentmeshsolutions.com` on a shared deployment with stable tenant UUIDs is right, and
the important property is **already true in your backend**: tenant identity resolves from
`auth.users` metadata, not from the hostname. The hostname is a lookup and a branding hook. Keep it
that way — the moment the host becomes an authorization input, changing a URL becomes a privilege
escalation.

Two things to hold:

- **Do not build wildcard DNS automation yet.** Target-state FRD §9.3 is right: manual DNS is fine
  for 10–20 customers, and at that scale you want to talk to each one anyway. Revisit when
  self-serve trials become real. (If you do it, note the validation doc's correct catch: a wildcard
  CNAME alone is insufficient — wildcard TLS issuance needs the provider's supported DNS setup.)
- **React Native cannot use `window.location.hostname`.** The app must discover the tenant from the
  invite deep-link or a company code, then confirm membership server-side. This is another reason to
  land `get_my_access()` (§3.2) *before* the mobile client exists — otherwise you will write
  tenant-resolution logic a second time, differently.

---

## 6. Super admin owning modules — correct, with one contradiction to fix

Your model — you (the vendor) provision tenants, set plans, and control which modules each company
has — is correct and is what every competitor does. The platform surface is also more real than the
docs suggest: tenant create / suspend / cancel / delete and module toggling are all enforced **in the
database** by policy, not merely hidden in the UI, and suspension genuinely cuts API access. That is
good work and worth not breaking.

Three gaps:

1. **The seeding trigger contradicts the whole entitlement model.** Live `seed_tenant_modules`
   inserts *every* row from `modules` with `enabled = true`. A customer who bought attendance-only is
   born with payroll, chat and everything else switched on — so your composable-module thesis, the
   actual differentiator, is unenforced at the exact moment it should be established. Seed **core +
   purchased/trial** instead. Hours of work; 15 tenants to correct today.
2. **`TenantContext.tsx:187` shows all modules if entitlement loading fails.** That is fail-open on
   entitlements. Make it an explicit "unavailable, retry" state. Missing information must never read
   as enabled — the same rule as your own "unknown is never zero" contract for payroll inputs.
3. **A platform admin can enter any tenant's portal, and reads are not logged.** The capability is
   legitimate (support impersonation). The gap is that `tenants_platform_audit` logs row *changes*,
   not *views*. With one owner account that is a small risk; the day you hire support staff it is a
   compliance question a customer's IT will ask you directly. Log `tenant_portal_entered` and show a
   persistent banner during an impersonated session. Cheap now.

---

## 7. Payroll last — still right, and now better-motivated

Keep it last. Two reasons beyond the ones already recorded:

- **Commercially it is your wedge, not your weakness.** Target-state FRD §9.1 is right that
  "attendance and leave your CA can actually use" is sellable *because* payroll is absent — factoHR,
  HROne, Keka and Darwinbox all bundle payroll from the entry tier and cannot sell that
  configuration. Do not lose the positioning by shipping a weak payroll.
- **It is where the permission work pays for itself** (§3.4).

The validation doc's payroll requirements are correct and I would not soften any of them:
effective-dated salary components, immutable input snapshots, period locks, correction/reversal
handling, server-authoritative calculation, and a hard prepare/approve split. Add your own already-
recorded rules: the `payroll_period_input` contract, **"unknown is never zero"** (missing attendance
must block or demand a source, never silently become zero pay), and the working-days-source switch so
a payroll-only customer can supply days from import instead of your attendance module.

Statutory calculation (PF / ESI / PT / TDS) needs a jurisdiction-specific review before release. That
is not a coding task, and it is the single most likely thing to be wrong in a way a customer notices
in month one.

**React Native:** the validation doc is right that this is not a conversion — RN uses native
components, so the DOM/Tailwind layer does not carry over. What *does* carry over is exactly what
§3.2 asks you to build: types, validation, API contracts, and a single server-side authorization
answer. Prove employee self-service and manager approvals on web first, then build the app against
those contracts rather than alongside them.

---

## 8. "Will it look weird next to other HRMS products?"

Not for the reason you are worried about. Your role model being simpler than Keka's is **not** a
competitive problem at 30–200 employees — it is an advantage, because Keka's role setup is one of the
things buyers of that size complain about.

The three things that will actually read as "unfinished" to an evaluator:

1. **The split navigation.** An HR admin today literally cannot open their own leave or payslip page
   — `RequireRole` gates on `currentRole !== role`. No commercial HRMS behaves that way; HR people
   are employees too. This is a five-minute discovery in any demo, and it is fixable in a day (§3.3).
2. **The month-end gap (G1 in the FRD).** No unmarked-days view, no bulk mark, no range
   regularisation. At 150 employees this is not "slow", it is unusable — and it is the workflow HR
   evaluates you on. The FRD already has it as V1 item 5. Keep it there.
3. **Empty state after provisioning.** A new tenant with no shifts, no leave types and no holidays
   looks broken regardless of how good the engine is. FRD decision #8 recommends trigger-seeded India
   defaults now, industry presets later. Agreed — and note it interacts with §6.1: seed *defaults for
   purchased modules*, not defaults for all 13.

What genuinely differentiates you is already built and under-sold: **work mode is configurable per
tenant *and* per employee, with dated WFH approvals.** Your own FRD §8.0 verified this live. Lead
with it. "Attendance that matches how your company actually works — office, remote, hybrid, or a mix"
is a better pitch than any role matrix.

---

## 9. The sequence I would actually run

Gates, not dates. Do not start a step until the previous step's gate is green.

**Step 0 — today.** Fix the four rate-limit calls (§1). **Gate:** create one employee end to end in a
test tenant — create → verify code → set password → finalize — and watch it succeed.

**Step 1 — the seam (~3–4 days).** `get_my_access()`; `AuthContext` and the four onboarding functions
read it; replace exclusive `RequireRole` gates with permission checks so HR has self-service.
**Gate:** a user holding *only* `employee_roles.role = 'hr_admin'` (no metadata role) can use HR
screens, and an HR admin can open their own leave page.

**Step 2 — cheap-now items (~1 week).** `tenant_members` membership row; `seed_tenant_modules` seeds
purchased modules only; entitlement fail-closed; buckets private + signed URLs; platform-entry audit
logging. **Gate:** provision a fresh attendance-only tenant and confirm it has attendance enabled,
payroll absent, seeded defaults present, and no public PII.

**Step 3 — invite flow + first-run defaults.** Named owner invite replacing the vendor-generated
password; seeded India defaults. **Gate:** you can provision a customer without ever knowing their
password.

**Step 3.5 — clear the trust bar (§2A.1).** Turn off every module you do not stand behind, starting
with payroll on its 14 tenants. Remove or disable the 30 Policy Center controls that do not enforce.
Perform and document one real restore. Add error visibility so a broken edge function surfaces within
hours, not weeks. **Gate:** T1–T7 all answered in writing. **This step, not Step 4, is the one that
decides whether it is responsible to put a real company on the system.**

**Step 4 — the V1 functional gap: G1 bulk attendance tooling + the monthly CSV export.** This is what
makes the product usable at 100+ people. **Gate:** FRD §9.4 — one real company, 50+ people, one full
month, and their CA accepts the export without a phone call — run as a **parallel run** (§2A.2), with
their existing process still authoritative for that month.

**Step 5 — chat / connect rebuild**, with per-tenant realtime channels folded in.

**Step 6 — payroll**, on `has_perm()` (§3.4). **Step 7 — React Native**, on the Step 1 contracts.

The 10-role matrix, approval-chain engine and effective-permission caching sit **after Step 4**, and
should be driven by what a real customer asks for — not by a taxonomy written before the first sale.

---

## 10. Scope and honesty of this review

**Verified live today:** migration head and `20260904120000` applied · `check_rate_limit` EXECUTE by
role · deployed source of `create-employee-user`, `set-employee-password`, `verify-employee-code`,
`finalize-onboarding` · `is_hr()` and `get_auth_tenant_id()` definitions · `seed_tenant_modules` body
· counts for tenants / employees / `employee_roles` / `platform_admins` / `tenant_modules` · 80
policies and 22 DEFINER functions referencing `is_hr()` · frontend role type, `App.tsx` gates, module
gating call sites, and the absence of any `employee_roles` writer.

**Not verified — treat as unconfirmed:** I did not create an employee, send mail, or reproduce the
500 by calling an edge function (that would mutate accounts), so the single unobserved link in §1 is
that `edgeFunctionToken` resolves to the `authenticated` role — argued from the ACL, the adjacent
`getCurrentUser()` call, and the identical 2026-08-17 incident, but not directly executed. I did not
test cross-tenant realtime
receipt with two sessions, download bucket objects, inspect DNS/Vercel, run the QA matrix, or audit
the other 13 edge functions. The BambooHR help article would not render for fetch — the Account Owner
/ Full Admin distinction is supported by that article's own title and by BambooHR product pages
listing the roles separately, not by a fetched body.

**Stale documents to correct:** `session_context_2026-09-04-definer-hardening.md` says the migration
is "staged, UNAPPLIED" — it is applied. `CLAUDE.md` §16 says `tenant_settings` has RLS off — resolved.

Sources: [BambooHR — Account Owner vs. Full Admin Access](https://help.bamboohr.com/s/article/925390) ·
[BambooHR access levels](https://www.bamboohr.com/blog/access-levels-bamboohr) ·
[Zoho People user access control](https://help.zoho.com/portal/en/kb/people/administrator-guide/settings/manage-accounts/articles/user-access-control-zoho-people) ·
[Keka user roles](https://help.keka.com/hc/en-us/articles/39946742389521-Understanding-User-Roles)
