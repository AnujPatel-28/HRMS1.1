# 04 — Configurability substrate

**The requirement:** every company has a different hierarchy, a different way of working, and a
different way of calculating things. The system must absorb that **as data**, not as forks, tenant
branches, or `if (tenantId === ...)`.

**The trap this avoids:** shipping ten more modules with hardcoded rules leaves ten hardcoded workflows
to retrofit later. The RLS drift already demonstrated what retrofitting across a wide surface costs.
Every module from Phase 1 onward is built **on** this substrate.

Three capabilities, one per phrase in the requirement:

| Requirement | Capability | Status |
|---|---|---|
| "different hierarchy of working" | Approval-chain engine | §2 — build in Phase 1 |
| "different company structure" | Custom fields | §3 — build in Phase 5 |
| "different way of calculation" | Rule / formula engine | §4 — build alongside Phase 2 |

---

## 1. What already exists — do not rebuild it

The instinct is already in this codebase. It is applied unevenly, which is the actual problem.

| Existing | What it already gives us |
|---|---|
| `employee_roles` | `role × scope_type (self / direct_reports / org_unit / department / tenant) + scope_id`. **Authorization as data.** The approval engine resolves approvers through this rather than inventing a parallel model. |
| `tenant_settings` | Per-tenant key/value store. Already the right shape for scalar config. |
| `leave_types` | 15 config columns — accrual, carry-forward, notice, probation, max consecutive, is_paid. Policy-as-data, for one domain. |
| `projects.visibility_config` | JSON rules **evaluated inside an RLS policy**. Proof the pattern works here. |
| `shifts` | Per-shift `half_day_cutoff_override`, `late_mark_grace_override`, `punch_in_opens_minutes_before`. |
| `hr_policies` | `visible_to`, `department_filter`, `org_unit_id`, versioning, effective dating. |
| `is_manager_of()` | Honours `manager_id`, `secondary_manager_id`, and effective-dated `employee_reporting_relationships`. The approval engine's `reporting_manager` resolver is this function. |

**Consequence:** none of the three capabilities below starts from zero, and none of them should
introduce a second way to express something already expressible.

---

## 2. Approval-chain engine

**Decision:** a configurable **approver chain**, not a general state machine.

**Why not a full Frappe-style state machine.** Frappe's `Workflow` doctype (states + transitions +
role-gated actions + conditions) is strictly more powerful. It is also an arbitrary directed graph a
tenant admin can misconfigure into a deadlock or an unreachable state, and it needs a UI to author
graphs safely. An ordered chain with conditions covers the overwhelming majority of real HR approvals —
leave, expense, attendance correction, exit clearance, appraisal sign-off — and is small enough to test
exhaustively. If a tenant ever genuinely needs a cyclic or branching graph, that is the moment to
revisit, with a real case in hand.

### Schema

```sql
CREATE TABLE public.approval_chains (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id),
  doc_type   text NOT NULL,            -- 'leave' | 'expense' | 'attendance_correction' | ...
  name       text NOT NULL,
  condition  jsonb,                    -- when this chain applies; NULL = default
  priority   integer NOT NULL DEFAULT 100,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, doc_type, name)
);

CREATE TABLE public.approval_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id      uuid NOT NULL REFERENCES public.approval_chains(id) ON DELETE CASCADE,
  step_no       integer NOT NULL,
  approver_kind text NOT NULL CHECK (approver_kind IN
                  ('reporting_manager','dept_head','org_unit_head','role','specific_employee')),
  approver_ref  uuid,                  -- employee id, or NULL for resolved kinds
  approver_role text,                  -- when kind = 'role'
  is_optional   boolean NOT NULL DEFAULT false,
  escalate_after_hours integer,        -- NULL = never escalate
  UNIQUE (chain_id, step_no)
);

-- Runtime state. One row per document per step.
CREATE TABLE public.approval_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id),
  doc_type     text NOT NULL,
  doc_id       uuid NOT NULL,
  chain_id     uuid NOT NULL REFERENCES public.approval_chains(id),
  step_no      integer NOT NULL,
  approver_id  uuid REFERENCES public.employees(id),   -- resolved at runtime
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','skipped','escalated')),
  acted_by     uuid REFERENCES public.employees(id),
  acted_at     timestamptz,
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_type, doc_id, step_no)
);

CREATE INDEX approval_requests_inbox
  ON public.approval_requests (tenant_id, approver_id, status) WHERE status = 'pending';
```

### Worked examples

```
Leave, ≤ 2 days       : step 1 reporting_manager
Leave, > 2 days       : step 1 reporting_manager → step 2 role:hr_admin
Expense, ≤ ₹5,000     : step 1 reporting_manager
Expense, > ₹50,000    : step 1 reporting_manager → step 2 dept_head → step 3 role:payroll_admin
Attendance correction : step 1 reporting_manager  (escalate to HR after 48h)
```

Chain selection: highest-`priority` active chain for `(tenant, doc_type)` whose `condition` matches;
the `condition IS NULL` chain is the fallback. Exactly one chain is chosen per document, at submit
time, and **pinned** — later config edits never rewrite in-flight approvals. That pinning is what makes
config changes safe to make on a live tenant.

### Approver resolution

`reporting_manager` and `dept_head` resolve through the **existing** org model — `is_manager_of()` and
`employee_roles` scopes. No parallel hierarchy is introduced.

Resolution happens at **submit** time and the result is stored in `approval_requests.approver_id`, so a
reorg mid-approval does not silently move a pending item. Escalation and delegation write new rows
rather than mutating the existing one, keeping the audit trail intact (P3's reasoning, applied to
process rather than balances).

### Edge cases that must be handled

| Case | Handling |
|---|---|
| Approver is the applicant (manager applies for own leave) | Skip the step; fall through to the next. Never self-approve. |
| Approver has no manager (CEO applies) | `reporting_manager` resolves to nobody → skip to next step, or auto-approve if it was the only one |
| Approver is inactive / has exited | Escalate immediately to their manager |
| Chain edited while requests are in flight | Pinned `chain_id` — in-flight documents finish on the chain they started |
| Every step optional and all skipped | Document auto-approves; must be an explicit, logged outcome |
| Rejection at step 2 of 3 | Whole document rejected; step 3 never created |
| Same person on two steps | Second step auto-approves — do not ask twice |
| Delegation while on leave | New row, `acted_by` records the delegate, not the delegator |

### Interaction with module entitlement

`approval_requests` is **cross-module** — its `doc_type` spans leave, expense, attendance correction and
more — so it is owned by no module and `02-module-registry.md` §3's "one RESTRICTIVE policy per owned
table" does not apply to it directly.

**Decision:** an approval row is visible only if the module owning its `doc_type` is enabled for that
tenant. If Payroll is switched off mid-flight, its pending approvals disappear from every inbox and
reappear untouched when it is re-enabled — consistent with §4 of the registry doc, where disabling
hides data and never deletes it. A disabled module must not be actionable through a side door, and the
approval inbox is the most obvious such door.

Mechanically this is a RESTRICTIVE policy on `approval_requests` that maps `doc_type` to a module key
and calls `tenant_has_module()`, rather than a per-table predicate:

```sql
CREATE POLICY approval_requests_module_enabled ON public.approval_requests
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.tenant_has_module(public.module_for_doc_type(doc_type))));
```

`module_for_doc_type()` is a small `IMMUTABLE` mapping function, maintained by migration alongside the
module registry.

### Migration path

Today `approve_leave_request` hardcodes `is_hr()`. The migration seeds every existing tenant with a
single-step `role:hr_admin` chain per doc type — **behaviour is identical on day one**, and tenants then
customise from a working baseline. This is the same non-destructive shape used for the leave ledger:
change the mechanism, keep the behaviour, prove equivalence, then let it diverge.

---

## 3. Custom fields

**Decision:** a `custom_fields jsonb` column per major entity, plus a per-tenant definition table.

**Why not EAV.** One `custom_field_values` table is more relational and easier to query across tenants,
but rendering a single employee record needs N joins or a pivot, and it degrades as fields multiply.
JSONB keeps a record in one row, indexes with GIN, and reads naturally. The cost is weaker typing and no
FK integrity on values — accepted, because custom fields are by definition tenant-private data that no
core code joins against.

```sql
CREATE TABLE public.custom_field_defs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id),
  entity     text NOT NULL,            -- 'employee' | 'leave' | 'expense' | ...
  key        text NOT NULL,            -- 'cost_center'
  label      text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN
               ('text','number','date','boolean','select','multiselect')),
  options    jsonb,                    -- for select/multiselect
  is_required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, entity, key)
);

ALTER TABLE public.employees ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX employees_custom_fields_gin ON public.employees USING gin (custom_fields);
```

Validation against `custom_field_defs` happens in the write RPC, not the client (**P5**). The frontend
renders form controls from the definitions — one generic renderer, not per-tenant components.

> ⚠️ **`custom_fields` is data only. It must never appear in an RLS policy expression** — not in a
> `USING` clause, not in a `WITH CHECK`, not inside a helper a policy calls. This is a stronger rule than
> §5's "no custom RLS", which only forbids *tenants* authoring policies; this forbids *our own* code
> reading `custom_fields` from inside one. The reason is specific: `employees` is the table 45 other
> policies subquery, and it is the table that caused the 2026-08-14 outage (**P2**). A visibility rule
> driven by a JSONB field on that table is precisely how recursion gets reintroduced. If custom-field
> values ever need to affect access, that is a core feature with a real column and a migration — not a
> custom field.

**Deliberately scheduled for Phase 5, not now.** Designing this against imagined fields produces the
wrong field types and the wrong validation rules. Several modules ship first; by then we will know what
tenants actually ask for. This is P7 applied to features rather than performance.

---

## 4. Rule / formula engine

**The capability payroll ultimately needs — built early, on lower-stakes ground.**

"Every company calculates differently" applies well before payroll: overtime multipliers, late-mark
thresholds, half-day cutoffs, leave accrual rates, comp-off eligibility. Those are the proving ground.
By the time payroll arrives, the engine is production-proven and payroll reduces to statutory research
plus configuration.

```sql
CREATE TABLE public.calculation_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id),
  domain     text NOT NULL,   -- 'overtime' | 'late_mark' | 'leave_accrual' | 'salary_component'
  key        text NOT NULL,
  expression jsonb NOT NULL,  -- structured AST, NOT a code string
  effective_from date NOT NULL,
  effective_to   date,
  is_active  boolean NOT NULL DEFAULT true
);
```

### Structured AST, not `eval`

Frappe stores salary-component formulas as Python expressions and evaluates them. **We will not do
that.** A tenant-editable code string evaluated server-side is a remote-code-execution surface, and this
system already had `exec_sql` reachable by `anon` (finding S1). A structured AST is safe to evaluate,
safe to validate up front, and safe to render in a UI builder:

```json
{ "if":   { ">": [{ "var": "hours_worked" }, { "var": "shift.standard_hours" }] },
  "then": { "*": [{ "-": [{ "var": "hours_worked" }, { "var": "shift.standard_hours" }] },
                  { "var": "rate.overtime_multiplier" }] },
  "else": 0 }
```

Constraints, all non-negotiable: no loops, no I/O, a whitelisted variable namespace per domain, a fixed
operator set, `numeric` arithmetic throughout (never floating point for money), and a hard evaluation
step limit.

### Effective dating is mandatory

Rules are **never** edited in place — a change closes the old row with `effective_to` and inserts a new
one. Recomputing March must use March's rule, not today's. This is the same immutability argument as the
leave ledger (**P3**), and it is what makes historical payroll defensible to an auditor.

---

## 5. What this substrate does not do

- **No per-tenant custom code.** No scripts, no hooks, no plugins. Configuration is data within the
  shapes above. Anything needing genuine code is a product feature, built for everyone.
- **No custom entities.** Tenants add *fields*, not *tables*. Frappe lets users create DocTypes; that
  requires a metadata-driven ORM this system does not have and should not grow.
- **No custom UI layout.** Field order and grouping, yes. Arbitrary page composition, no.
- **No custom RLS.** Access control stays in migration-controlled policies (**P1**). Tenants configure
  *approval routing*, never *visibility rules*.
- **Edge functions are not covered.** The 17 deployed functions bypass RLS and would bypass these
  checks too. Any function touching a configurable domain must call the same resolvers. This is the
  most likely bypass and needs an explicit pass when the engine lands.
