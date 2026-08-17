# 01 — Engineering principles

Rules every module must follow. Each one exists because something in *this* codebase broke without it —
the evidence is cited, so none of these are style preferences.

---

## P1. Schema changes live in `migrations/`. No exceptions.

**Rule.** Every table, policy, function, grant, and index is created by a file in `migrations/`.
Nothing is applied through the dashboard, a root-level `.sql` script, or a one-off `db query`.

**Evidence.** 105 of 211 live RLS policies (50%) exist in no `.sql` file in the repo. On 2026-08-14
three of those untracked policies took the entire application down with
`42P17 infinite recursion detected in policy for relation "employees"` — every authenticated read on
every table that references `employees` returned 500. Because they were untracked, no code review
could have caught them. Full detail: `system-audit-2026-08/10-policy-provenance-drift.md`.

**How it is enforced.** A CI check fails the build when a policy exists in `pg_policies` but in no
migration file. Without the check this principle decays back to where it started — it already did once.

**Corollary.** Migrations are forward-only. Never edit an applied migration; write a new one. Don't put
`BEGIN`/`COMMIT` in a migration file — the CLI wraps each in its own transaction.

---

## P2. A policy on a table must never subquery that same table.

**Rule.** Inside an RLS policy, resolve the caller's identity through a `SECURITY DEFINER` helper, never
an inline subquery on the table being protected.

```sql
-- NEVER — recurses, takes the whole app down
USING (manager_id = (SELECT id FROM employees WHERE user_id = auth.uid() LIMIT 1))

-- ALWAYS
USING (manager_id = public.get_my_employee_id())
```

**Why.** An inline subquery in a policy expression runs as the **invoking** role, so RLS re-applies and
re-enters the policy. A `SECURITY DEFINER` function runs as its owner and does not.

**Evidence.** Exactly this caused the 2026-08-14 outage. Verified after the fix: calling
`get_my_employee_id()` as `hr-qa` returns cleanly where the inline form recursed.

**Helper requirements.** Every such helper is `STABLE`, `SECURITY DEFINER`, `SET search_path TO ''`, and
has EXECUTE revoked from `PUBLIC` and granted to `authenticated`. New functions grant EXECUTE to PUBLIC
by default — which includes `anon`. Forgetting the revoke is how an internal helper becomes a public API.

Current helpers: `get_auth_tenant_id()`, `can_access_tenant()`, `is_hr()`, `is_manager_of()`,
`can_view_employee()`, `has_role()`, `get_my_employee_id()`, `get_my_platform_role()`.

---

## P3. Balances are derived from immutable entries, never stored as counters.

**Rule.** Any running total — leave balance, comp-off, expense budget, ledger-like quantity — is the
`SUM` of append-only entries. Corrections are new reversing entries, never `UPDATE`s.

**Evidence.** `leave_balances.balance` is a stored counter. `fn_accrue_monthly_leaves` increments
`balance` without touching `total_allocated`, so `balance` stops being derivable from its own columns.
Live check on 2026-08-14:

```
total_rows  balance_not_derivable  accrued_rows
10          2                      2
```

Both already-drifted rows are exactly the two that have been accrued. The invariant is broken in
production data today. This is not a hypothetical race — see P4 for what *isn't* wrong.

**Why it matters beyond correctness.** A counter cannot answer "why is this number 12.5?". A ledger
can, which is what makes disputes, audits, and mid-year policy changes tractable.

---

## P4. Verify a claim against the database before designing around it.

**Rule.** Repo documentation is a lead, not a source of truth. Check `pg_policies`, `pg_proc`, and the
data before building on any documented claim.

**Evidence — two claims that were wrong:**

- `session_context_2026-08-13.md`: "concurrent approvals can corrupt `leave_balances`". **False.** Both
  `approve_leave_request` and `cancel_leave_request` take `FOR UPDATE`. Had we redesigned for
  concurrency we would have solved a problem that does not exist and missed the accrual drift that does.
- `scratch/seed-qa.sql:14`: hash commented `Password@123`. **It is not that password** — verified with
  bcrypt. QA credentials had never worked, which is why the QA click-through in the session doc's open
  items had never actually been performed.

**Reusable technique.** To reproduce RLS exactly as the browser sees it: mint a real user JWT via
`POST /api/auth/sessions`, then call `GET /api/database/records/<table>` with it. The app's generic
error toast hides which table failed; this names it.

---

## P5. Invariants live in the database, not the client.

**Rule.** If a rule must hold, it is enforced by RLS, a constraint, a trigger, or a `SECURITY DEFINER`
RPC. Client-side checks are UX, and are assumed bypassed.

**Evidence in the current system:**

- Payroll math runs entirely in the browser (`payroll-calc.ts`), then HR writes the result. Stored
  payslip amounts are trusted, never re-derived server-side.
- Geo-fence status is computed client-side and stored as `punch_*_location_status` — advisory only.
- Reporting-cycle prevention is `utils/managerCycleValidation.ts`, client-side. Nothing stops a cycle
  written via the API.

None of these are privilege-escalation for employees today, because the write paths are HR-only. They
are *integrity* gaps: the data is only as trustworthy as the browser that produced it. For a system
carrying pay and statutory weight, that is the wrong default.

---

## P6. Access control is deny-by-default and tenant-scoped.

**Rule.** Every table carries `tenant_id` and is covered by the RESTRICTIVE tenant predicate. Permissive
policies grant narrowly on top. `TO public` means `anon` — it is never correct for tenant data.

**Evidence.** `announcements` carries `"Anyone can read active announcements"` —
`FOR SELECT TO public USING (true)`, with no tenant filter and no `is_active` filter despite its name.
An anon-key request returns 200 today. It leaks nothing only because the table is empty; the first row
written becomes world-readable across all tenants.

**Corollary — PERMISSIVE policies OR together.** Adding a policy can only ever widen access. Narrowing
requires a RESTRICTIVE policy or removing the permissive one. `employees` currently carries both
`employees_self_read` (with a tenant condition) and `employees_self_select` (without) — the broader wins,
making the first one's tenant clause dead weight.

---

## P7. Prefer the boring shape at current scale.

**Rule.** With 12 tenants and 16 employees, no design is justified by throughput. Choose the shape that
stays *correct* as volume grows; do not pre-optimise for load that does not exist.

This principle exists to bound the others. P3's ledger is deliberately more rows than a counter — that
cost is accepted for auditability, not performance. Where a simpler design serves 10,000 employees fine,
take the simpler design and write down why.

---

## P8. State what was left undone.

**Rule.** When work is partial, blocked, or deliberately scoped out, say so explicitly in the same place
the work is reported. A silent omission reads as completion.

This applies to migrations (what the migration does *not* cover), to modules (which edge cases are
unhandled), and to these documents.
