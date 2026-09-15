# Session context — 2026-09-04. Full module/security/flow audit + DEFINER-fence hardening migration.

Read this first, then `doc/audit_2026-09-04_module_security_flow.md` (the audit report this session
produced) and memory `hrms-audit-2026-09-04-definer-realtime`.

```
DB head (applied)   20260903170557      unchanged this session
Staged, UNAPPLIED   migrations/20260904120000_harden-definer-tenant-fences.sql
Repo                main                report + migration + this handoff are new, uncommitted
Build               not rebuilt (no frontend change this session)
```

---

## 0. What this session did

1. **Audited the whole HRMS** — module by module, vulnerabilities, resource-management flow, Policy
   Center per module, payroll state — **live-verified against parent `rq3qmu8y`**, not from docs.
   Output: `doc/audit_2026-09-04_module_security_flow.md`. **No app changes were made by the audit.**
2. **Wrote one hardening migration** for the DEFINER-function holes (§2.6 of the report). It is
   **staged but NOT applied** — see §2.

## 1. The audit's headline (verified)

The security boundary is three-layered; only the **table-RLS layer** is hardened, and it is genuinely
sound (every content table has a RESTRICTIVE `tenant_isolation (tenant_id = get_auth_tenant_id())`
that ANDs on top of the many bare-`is_hr()` permissive policies — so they are NOT holes). The real
exposure is in the layers that **bypass RLS**:

- **SECURITY DEFINER RPCs** — `is_hr()`/`can_view_employee()` are param-blind (caller's own tenant
  only). 14/94 authenticated-DEFINER fns are unfenced. → **this migration.**
- **Realtime** — zero policies; `Chat.tsx:271` subscribes to GLOBAL `chat_messages`/`chat_channels`
  streams → plausibly any authenticated user receives every tenant's chat. → **user is rebuilding
  chat + connect and will fix it there.** NOT in this migration.
- **Public storage buckets** — `employee-documents` (15 PII objects), `hr-policies`,
  `task-attachments` are public → no tenant fence possible. → follow-up: make private + signed URLs.

**Stale facts corrected:** admin key IS rotated (live `ik_99bf…`); all RLS-off tables resolved;
`leave_min_notice_days` IS server-enforced. `seed_tenant_modules` still grants every module to every
new tenant (contradicts the composable-module vision). Payroll still raw-table-writes.

## 2. The migration — STAGED, awaiting apply

`migrations/20260904120000_harden-definer-tenant-fences.sql`. Two mechanisms:

- **9 × `REVOKE EXECUTE FROM authenticated`** — fns only called by the service role (edge functions
  via admin key = `project_admin`) or PERFORMed internally by other DEFINER fns; verified no frontend
  `.rpc()` caller. Bodies untouched. (`check_rate_limit`, `get_user_id_by_email`,
  `check_employee_exists_by_email`×2, `attendance_check_impossible_travel`, `attendance_event_ingest`,
  `expire_location_exceptions`, `fn_cleanup_expired_onboarding`, `fn_auto_redmark_tasks`.)
- **5 × guarded body** (derived from live `pg_get_functiondef()`, guard-only insert, diff-proven):
  `punch_out_attendance` (+`can_access_tenant`), `start_employee_break`/`end_employee_break`
  (+tenant fence +own-break-unless-HR), `delete_chat_channel` (+`tenant_id = get_auth_tenant_id()`
  on the DELETE), `set_employee_password_by_hr` (reject `superadmin/admin/hr` targets).

**Verification done:** every changed body is the exact live definition with only guard lines added
(the ONLY removed line in the whole migration is the old `delete_chat_channel` DELETE, swapped for
the tenant-scoped one). All 9 REVOKE signatures resolve (`::regprocedure`). IF/END-IF balanced.

**Deliberately deferred (do NOT assume these are fixed):**
- **EXISTS-employee-row clause** on `set_employee_password_by_hr` — would close claiming the 7
  role-less orphan auth accounts, but `set-employee-password.ts` does NOT create the employees row
  and the onboarding ordering is unconfirmed, so it risked blocking employee creation. The
  privileged-role guard (the severe 2-superadmin-takeover case) IS in the migration.
- `punch_in_attendance` (intra-tenant dangling ref only), `close_stale_attendance` +
  `increment_announcement_*` (cosmetic).

### 2a. HOW TO APPLY (blocked from the agent this session)
Branch rehearsal was impossible — `branch list` → **Insufficient permissions** — so this applies
straight to parent/prod. The agent's `db migrations up` was blocked by the Claude Code auto-mode
classifier (a write-command gate). Apply it from the session prompt:

```
! npx @insforge/cli db migrations up 20260904120000
```

**Immediately after applying:**
1. **Smoke-test one employee onboarding** (HR: create employee → set password) — the only path with
   any residual risk (the password fn changed).
2. Verify a normal employee can still punch in/out and start/end a break.
3. `npx @insforge/cli diagnose` — confirm no new advisor findings.
4. Spot-check the guards took:
   `select has_function_privilege('authenticated','public.check_rate_limit(uuid,uuid,text,integer,interval)','EXECUTE');`
   → should be **false**; and `pg_get_functiondef` on `punch_out_attendance` should show the
   `can_access_tenant(p_tenant_id)` guard.

## 3. Next steps (in the user's stated order)
1. **Apply this migration** (§2a) + smoke test.
2. **Rebuild chat + connect** — fold in the realtime cross-tenant fix (per-tenant channel names
   `chat:<tenant_id>:…` or realtime RLS on `realtime.channels`/`realtime.messages`). `delete_chat_channel`
   is already fenced by this migration; keep that behaviour in the rebuild.
3. Follow-ups from the report §6: `employee-documents`→private, `attendance_derivation_runs` policy
   (`USING (true)`→`can_access_tenant`), `seed_tenant_modules` default, delete `src/hr/Settings.tsx`,
   drop `salary_template_<dept>`, invite-based onboarding.
4. Payroll last (working-days-source switch; hardened txn write path instead of raw table writes).

## 4. Traps confirmed this session
- **`is_hr()` is param-blind** — reads like a tenant check, proves only the caller's own tenant. Never
  use it as the sole gate in a DEFINER fn that takes `p_tenant_id`. See memory
  `hrms-rls-not-a-backstop-in-definer-rpcs`.
- **A guard-insert can anchor to the wrong line.** The break owner-guard first landed before the row
  was loaded because the tenant-guard I inserted added its own `END IF;`. Fixed by inserting the
  owner-guard first. Always diff the derived body AND check placement, not just "it compiles".
- **REVOKE > body-guard** when a fn has no authenticated caller — smaller blast radius, no body risk.
- Branches are unusable for this CLI user (`Insufficient permissions`); `db migrations up` is blocked
  by the auto-mode classifier — the user must apply writes via `!` from the prompt.
