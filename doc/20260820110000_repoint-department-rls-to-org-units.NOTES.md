# `include_descendants` is an access-control widening, not a schema change

Read before applying `20260819120000_repoint-department-rls-to-org-units.sql`.

---

## 1. The hazard, concretely

Today `hr_policies.policies_visible_to_all` decides who may read a policy document by comparing two
strings for exact equality:

```sql
EXISTS (SELECT 1 FROM employees e
        WHERE e.user_id = auth.uid() AND e.department = hr_policies.department_filter)
```

Two things follow from "exact string equality", and the second is the one that costs money.

**It matches too little by accident.** A policy filed against `Hr` is invisible to an employee whose
row says `HR`. That is the drift this whole step exists to remove.

**It has no notion of a hierarchy at all.** A policy scoped to `Engineering` reaches employees whose
department string is exactly `Engineering` — nobody else. Someone in `Backend`, a team *inside*
Engineering, does not match and never has. Under a text comparison there is no way for them to match,
because `Backend` is not the string `Engineering`.

The migration replaces that comparison with a subtree test against the materialised `org_units.path`,
and `include_descendants` defaults to `true`. So on the day it is applied, every employee in every
unit *below* a scoped unit starts matching a policy they have never matched before.

That is not a migration artefact to be smoothed over. **It is a real grant of read access, to real
documents, for real people, on production data.** HR policy documents are exactly the category where
a division-wide document may be deliberately withheld from one team, and where "who has seen this"
is sometimes a compliance question. The default is right for most policies — a division leave policy
should reach the division — which is precisely why it is dangerous: it will be correct often enough
that nobody looks at the exceptions.

**The requirement is therefore a deliberate review pass over existing `hr_policies` rows before
apply, with a named person signing off, not a silent DDL statement.** 06 §9.2 says the same thing;
this note exists so the sign-off is executable rather than aspirational.

## 2. The review pass

Run this against the live backend **at apply time**, not from memory of what it returned when the
migration was authored. As of 2026-08-19 it returns zero rows — `hr_policies` holds one row, and it
is `visible_to = 'all'` — but the gate below has been unmet since 30 June, so apply may be weeks out
and any HR admin can create a scoped policy in the meantime.

```sql
SELECT p.id,
       p.tenant_id,
       p.title,
       p.department_filter,
       p.org_unit_id,
       ou.name  AS target_unit,
       ou.path  AS target_path,
       (SELECT count(*) FROM public.org_units d
         WHERE d.tenant_id = p.tenant_id
           AND d.path LIKE ou.path || '%'
           AND d.id <> ou.id)                       AS descendant_units_newly_included,
       (SELECT count(*) FROM public.employees e
          JOIN public.org_units d ON d.id = e.org_unit_id
         WHERE e.tenant_id = p.tenant_id
           AND e.status = 'active'
           AND d.tenant_id = p.tenant_id
           AND d.path LIKE ou.path || '%'
           AND d.id <> ou.id)                       AS employees_newly_granted
FROM public.hr_policies p
LEFT JOIN public.org_units ou ON ou.id = p.org_unit_id
WHERE p.visible_to = 'department-specific'
ORDER BY employees_newly_granted DESC;
```

For every row returned, decide one of two things and record it:

- the document *should* reach the subtree → leave `include_descendants` at its default;
- it should not → `UPDATE public.hr_policies SET include_descendants = false WHERE id = '…';`
  immediately after the migration, in the same maintenance window.

Two rows need attention beyond that:

- `org_unit_id IS NULL` **and** `department_filter IS NOT NULL` — the backfill found no org unit whose
  name matches, case-insensitively, within that tenant. That policy becomes visible to nobody but HR.
  It fails closed, which is the safe direction, but it is a live visibility change. Fix by creating or
  renaming the org unit, or by setting `org_unit_id` by hand.
- `descendant_units_newly_included = 0` — no widening for that row, whatever the toggle says. Today
  every one of the 10 live units is a root, so this is the expected shape until tenants build trees.

## 3. Apply order and preconditions

The migration is one file on purpose. `include_descendants NOT NULL DEFAULT true` **is** the widening,
so it must not land ahead of the review that authorises it.

```
gate ──►  frontend deploy, BOTH hosts, from a green build
  │       (rq3qmu8y.insforge.site and hrms.talentmeshsolutions.com are two Vercel
  │        projects with different bundles; both are stale since 2026-06-30)
  │
  ├─ 1. write paths must exist in that build — see below, they do not yet
  ├─ 2. §9.2 review pass above, signed off
  └─ 3. move the .sql into migrations/ and `db migrations up <version>`
```

**The gate is larger than "deploy the frontend."** Of the three target-side writes the migration
needs, only one exists in any branch:

| Target side | Written by | State |
|---|---|---|
| `hr_policies.org_unit_id` | `src/hr/PolicyUpload.tsx:139` | ✅ exists, shipped in source |
| `chat_channels.target_org_unit_ids` | — | ❌ **no write path anywhere in `src/`** — not authored |
| `projects.visibility_config.org_unit_ids` | — | ❌ **no write path anywhere in `src/`** — not authored |

`ProjectList.tsx:182`, `ProjectDetail.tsx:239` and the channel-creation UI still write department
*names*. So the precondition is not "deploy what is in the working tree" — it is "author two frontend
changes that nobody has written, then deploy both hosts." Until then, applying the migration means any
**newly created** department channel or department-scoped project grants access to nobody. That fails
closed rather than open, and existing rows are backfilled, but it is a functional regression, not a
no-op.

Release check, per this folder's README — verify the **live bundle**, not `src/`:

```bash
for H in https://rq3qmu8y.insforge.site https://hrms.talentmeshsolutions.com; do
  B=$(curl -s "$H/" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
  curl -s "$H$B" | grep -oE 'target_org_unit_ids|org_unit_ids' | sort -u
done
# both hosts must show the new keys before applying.
```

## 3b. APPLIED 2026-08-20 — and one expectation in §4 below is WRONG

Applied as `20260820110000` (renumbered; the head had moved past `20260819120000`). Gate evidence:
served bundle carried both write paths with the right value shape, `rq3qmu8y.insforge.site` now serves
a "Decommissioned" page so only `hrms.talentmeshsolutions.com` counts, and the §9.2 review query
returned **zero rows**. All three backfills were no-ops.

**§4's anon check below is unreachable, and always was.** It says an anon
`GET /chat_messages` must return `[]` rather than `permission denied`. It returns
**`permission denied for table users`** — for anon *and* for every authenticated caller.

The cause is not the function grants this migration adds. `chat_messages_select` contains two
`EXISTS (SELECT 1 FROM auth.users u ...)` subqueries, reproduced byte-identical from the baseline, and
**only `project_admin` holds SELECT on `auth.users`** — `anon` and `authenticated` hold nothing:

```sql
select grantee, privilege_type from information_schema.table_privileges
where table_schema='auth' and table_name='users';   -- project_admin only
```

An inline table read inside a policy runs as the invoking role, so the privilege check fails before
any grant on a helper function matters.

**This migration did not cause it.** Proof: `chat_channels.channels_hr_all` and
`chat_channel_members.members_hr_all` carry the same inline `auth.users` subquery, were **not touched
by this migration**, and fail identically. Three policies, one cause:

```sql
select tablename, policyname from pg_policies
where coalesce(qual,'') like '%auth.users%' or coalesce(with_check,'') like '%auth.users%';
```

**Consequence: the chat module is non-functional in production and has been.** `Chat.tsx` reads
through `db.from("chat_channels")` and `db.from("chat_messages")` directly, so both error. The fix is
the P2 pattern this migration already uses everywhere else — route the `auth.users` metadata check
through a SECURITY DEFINER helper — applied to all three policies. Not done here: it is outside the
five this file enumerates, and an unrequested policy rewrite does not belong in an authorisation
migration.

## 4. After applying

Re-run the regression baseline from `doc/session_context_2026-08-18.md` §1 — 7/7 HR dashboard
queries, employee-qa 1 row / manager-qa 5 / hr-qa 6, 0 cross-tenant — plus one check this migration
specifically needs: an **anon** `GET /api/database/records/chat_messages` must return `[]`, not
`permission denied for function`. `chat_messages_select` is `TO public` and now calls two SECURITY
DEFINER helpers; the migration grants both to `PUBLIC` for exactly this reason, and that grant is the
thing most likely to be "tidied up" by a later hardening pass.

Then `npm run check:policy-drift` — five policies and three new functions, so the baseline
files and the live database must be re-reconciled.
