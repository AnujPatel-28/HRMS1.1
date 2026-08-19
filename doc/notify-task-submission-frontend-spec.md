# Frontend spec — `20260820090000_notify-task-submission-server-side.sql`

**Audience:** the agent doing the frontend half. **Read the migration header first** — it contains the
evidence behind every instruction here, and several of them contradict what
`doc/org-module-status-2026-08-19.md` §3c(d) says.

**Sequencing:** the SQL is **additive** and can be applied before or after this work. Nothing here is
urgent-before-apply. Do **not** commit or push without the user's say-so — `main` auto-deploys.

---

## 0. The one-paragraph version

§3c(d) says six employee-role notification inserts are refused. Verified against the live database
on 2026-08-20, **only two are.** Both are the same event — task submission — and the migration moves
that notification into `submit_task_request` server-side. So your job at those two sites is a
**deletion**, not a rewrite. The other four sites are blocked by something else entirely, and
"fixing the notification" there will accomplish nothing; they are written up in §3 so you do not
rediscover them as mysteries.

---

## 1. Two deletions

The RPC now writes the notification inside the same transaction as the submission. The client block
is redundant, and if left in place it produces a second, refused round trip and a misleading
`console.error` on every successful submission.

### 1a. `src/employee/MyTasks.tsx` — inside `submitTask()`

**Delete lines 180-203**, i.e. everything from the comment down to the closing brace of the `else`:

```ts
      // Notify the manager, else the unit head chain (06 §9.1: own unit head → parent unit head → HR)
      const targetNotifyIds = employee.manager_id
        ? [employee.manager_id]
        : await resolveTaskNotificationTargets(tenantId, employee.id, employee.org_unit_id);

      if (targetNotifyIds.length > 0) {
        // .select() matters: RLS refuses a write by matching zero rows, which comes back as a
        // SUCCESSFUL empty response rather than an error.
        const { data: notified, error: notifyErr } = await db.from("notifications").insert(
          targetNotifyIds.map((id) => ({ /* ... */ }))
        ).select();
        if (notifyErr || !notified || (notified as unknown[]).length === 0) {
          console.error("Task submitted, but the submission notification was refused.", notifyErr);
        }
      } else {
        console.error("Task submitted, but no notification recipient could be resolved.");
      }
```

Leave `success("Task submitted successfully!")` and everything after it untouched.

### 1b. `src/employee/pms/EmployeeProjectView.tsx` — inside `handleSubmitTask()`

**Delete lines 161-184** — the identical block, differing only in the notification title/body
strings. Both strings are now composed server-side (the RPC branches on `tasks.project_id`, so the
"in project …" variant is preserved without the screen having to say which it is).

### 1c. Orphans your deletion creates

Per `CLAUDE.md` §3, remove what *your* change orphaned — and nothing else:

- `src/employee/MyTasks.tsx:12` — `import { resolveTaskNotificationTargets } from "../utils/notificationTargets";`
- `src/employee/pms/EmployeeProjectView.tsx:11` — the same import.
- `src/utils/notificationTargets.ts` — **delete the file.** After the two imports go it has zero
  callers (`grep -rn "resolveTaskNotificationTargets\|notificationTargets" src/` must return
  nothing). It was written on 2026-08-19 for exactly these two call sites and its logic now lives in
  the RPC's step 6, reproduced branch for branch. If the user would rather keep it, say so and leave
  it — but do not leave it imported.

Do **not** touch the `tenantId` / `employee` reads above the deleted block; the surrounding
`submit_task_request` call still needs neither.

---

## 2. What replaces it: check the RPC's return

There is no new call to add. The existing call gains a return value worth checking.

```ts
const { data, error: rpcErr } = await db.rpc("submit_task_request", {
  p_task_id: task.id,
  p_notes: notes || null,
  p_attachment_url: attachment_url,
  p_attachment_name: attachment_name,
});
if (rpcErr) throw rpcErr;
```

The function now returns:

```json
{ "success": true, "submission_id": "<uuid>", "notified": 2 }
```

`notified` is the number of notification rows actually written.

**Rules:**

1. **Arguments are unchanged.** Same four, same names. Do not add a recipient argument — the whole
   point of the design is that the client supplies no recipient. In particular, do **not**
   reintroduce `p_employee_id`; that overload was dropped by `20260819190000` because it let any
   caller submit as any employee.
2. **`notified === 0` is a warning, not a failure.** It means no reviewer resolved — legitimately
   possible today (see §4). Log it; still show the success toast. The submission itself succeeded,
   and `rpcErr` is the only thing that says otherwise.
3. **Verify the shape before relying on it.** The SDK may hand back the jsonb directly or wrapped.
   Read it defensively (`const notified = (data as any)?.notified ?? (data as any)?.[0]?.notified;`)
   and if it is `undefined`, log once and move on — never block the user's flow on a
   telemetry-shaped field.

```ts
const notifiedCount = (data as any)?.notified ?? (data as any)?.[0]?.notified;
if (notifiedCount === 0) {
  console.warn("Task submitted, but no reviewer was resolved to notify.");
}
```

---

## 3. The four sites that are NOT fixed — do not "migrate" them

§3c(d) lists these as refused notification inserts. They are not. Each is blocked upstream, and
each needs a separate authorisation decision that is explicitly **out of scope for this task**.
Report them; do not fix them here, and do not paper over them by making the notification "work".

| Site | What actually blocks it |
|---|---|
| `src/employee/Expenses.tsx:188` | **The notification is never attempted.** It is guarded by `if (hrEmployees && hrEmployees.length > 0)`, and `hrEmployees` comes from `db.from("employees").select("id").eq("role","hr")` at :172. Live `employees` policies let an employee-role caller SELECT only their own row plus their direct reports, so that query returns `[]`. Fixing this means sourcing HR from `employee_directory_public` (the view that exists for exactly this) or from a server-side fan-out — **not** widening `employees`. |
| `src/employee/MyTasks.tsx:238` | **The task insert fails first.** `tasks` has no permissive INSERT policy other than `tasks_hr_all` (`is_hr()`), so an employee-role manager cannot create a task at all. The notification is downstream of a row that was never written. The peer-assignment UI is inert end to end. |
| `src/employee/MyTasks.tsx:274` | **`approve_task_request` throws first.** It hard-requires `auth.users.metadata->>'role' = 'hr'` and raises `Insufficient role: HR privileges required` otherwise. For an HR caller the insert is *permitted* (via `notifications_hr_all`), so this site is never refused — it is unreachable or fine. |
| `src/employee/MyTasks.tsx:303` | Same, via `reject_task_request`. |

If you touch any of these files for the deletions above, **leave these blocks exactly as they are.**

---

## 4. Behaviour you should expect after both halves ship

Recipient resolution is reproduced from the shipped client code, in order:

1. `employees.manager_id`, if set (used raw — no active/tenant filter, matching the shipped code)
2. else the submitter's own `org_units.head_employee_id`, if active, in-tenant, and not the submitter
3. else the **parent** unit's head, same filters
4. else every active `role = 'hr'` employee in the tenant

Live data as of 2026-08-20: 5 of 16 employees have a `manager_id`; **0 of 10 `org_units` have a
`head_employee_id`**; 3 active HR. So today steps 2 and 3 resolve for nobody, and every submitter
without a manager notifies the three HR admins. `notified` of 1 or 3 is the normal result. Do not
treat "always HR" as a bug you introduced.

**Known spec discrepancy, flagged not resolved:** `notificationTargets.ts`'s docstring cites
`06 §9.1` as "own unit head → parent unit head → HR" with no manager step, while the code it
documents puts `manager_id` first. The RPC preserves the *code*. Reconciling §9.1 with the code is a
separate task — mention it, do not decide it.

---

## 5. The `.select()` rule — still applies, with a corrected reason

**Every write you leave behind or add must be able to detect refusal.** Chain `.select()` and treat
an empty result as failure:

```ts
const { data, error } = await db.from("x").insert([row]).select();
if (error || !data || data.length === 0) { /* it did not happen */ }
```

Correction to how this is described in `§3c(d)` and repeated in `session_context_2026-08-18.md §3`:

- **UPDATE / DELETE** refused by RLS match zero rows → PostgREST returns **200 with `[]`**. This is
  the silent case, and it is real.
- **INSERT** refused by RLS raises `42501 new row violates row-level security policy` → PostgREST
  returns **403 with an error body**. It is *not* a 200.

So the silence at 16 of the 18 notification call sites is not "RLS returned 200" — it is that the
code **discards the returned `error` object** (`await db.from(...).insert(...)` with no destructuring).
The remedy is the same, which is why the rule does not change: check `error` **and** check for a
non-empty result, because `.select()` also comes back empty when the row was written but the SELECT
policy will not read it back.

While you are in these files, do not go on a sweep fixing unrelated unguarded writes. Guard what you
touch; list what you noticed.

---

## 6. Definition of done

- [ ] Both notification blocks deleted; both imports removed; `notificationTargets.ts` deleted (or
      explicitly kept at the user's request).
- [ ] `grep -rn "resolveTaskNotificationTargets\|notificationTargets" src/` returns nothing.
- [ ] `npm run build` green — `tsc -b && vite build`, 0 TypeScript errors.
- [ ] `grep -rn "p_employee_id" src/employee/MyTasks.tsx src/employee/pms/EmployeeProjectView.tsx`
      returns nothing (the dropped overload must not creep back).
- [ ] The four §3 sites are byte-identical to before your change.
- [ ] Nothing committed, nothing pushed.
- [ ] Your report names: the two files changed, the file deleted, and the four defects from §3 as
      still-open, so they are not mistaken for finished work.
