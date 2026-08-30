# 09 - Attendance Module: Edge Functions

Edge functions are small Deno (TypeScript) programs that run on the server, reachable over HTTP at:

```text
https://<project>.function2.insforge.app/<slug>
```

> **Note the host.** It is `function2`, not `function`. The older `.function.` host died with Deno Deploy classic, and the SDK has to be told the new one explicitly — see `src/insforge/client.ts`. Getting this wrong makes every function call fail with a confusing network error.

---

## 1. When to use an edge function (and when not to)

Most server logic in this module is a **database function (RPC)**, not an edge function. Reach for an edge function only when you genuinely need something a database function cannot do:

| Use an edge function when… | Example here |
|---|---|
| Something outside the app must POST to you over plain HTTP | `adms-cdata` — a biometric machine speaks its own text protocol |
| You need to run on a **schedule** | `run-attendance-derivation` |
| You need to translate a **wire format** | `adms-cdata` again |
| You need to call something with elevated rights that no browser role may have | `kiosk-punch` |

**Do not** put business rules in an edge function. The rule of thumb used throughout this module:

> **The edge function is the doorway. The database function is the logic.**

There is a concrete lesson behind that. An early draft of `run-attendance-derivation` looped over every tenant and every shift *in TypeScript*, calling the derivation passes one at a time. That meant a network round trip per shift, and the run bookkeeping was spread across separate calls that could each fail independently, leaving a run row stuck saying "running" forever. Moving that loop into `attendance_run_scheduled_derivation()` reduced the edge function to about twenty lines and made the whole run atomic.

---

## 2. The two authentication patterns

This is the thing to understand before writing one. There are exactly two patterns in this codebase, and picking the wrong one is a security bug.

### Pattern A — run as the caller (safe default)

```typescript
const authHeader = req.headers.get("Authorization");
const userToken = authHeader ? authHeader.replace("Bearer ", "") : null;

const client = createClient({
  baseUrl: Deno.env.get("INSFORGE_BASE_URL"),
  edgeFunctionToken: userToken,      // ← the caller's own session
});
```

The function acts **as the logged-in employee**. All normal RLS applies; they can only see what they could already see. Use this whenever the caller is a real logged-in user.

*Used by:* `check-punch-out-gate`, `calculate-late-marks`.

### Pattern B — run as `project_admin` (elevated)

```typescript
const ADMIN_KEY = Deno.env.get("INSFORGE_ADMIN_KEY") || Deno.env.get("API_KEY");

const client = createClient({
  baseUrl: Deno.env.get("INSFORGE_BASE_URL"),
  anonKey: ADMIN_KEY,                // ← full rights, RLS does not apply
});
```

The function acts with **full database rights**. RLS is not enforced. Use this **only** when there is no logged-in user to act as — a device, or a schedule.

*Used by:* `kiosk-punch`, `adms-cdata`, `run-attendance-derivation`.

> **If you choose Pattern B, you own the tenant fence yourself.** Nothing else will stop you writing into the wrong tenant. In this module that is handled by deriving the tenant from the *device row* rather than accepting it as a parameter — a device can then never be talked into another tenant.

### And if you use Pattern B, gate the caller

Pattern B functions are reachable by anyone who learns the URL, so each one needs to answer *"who is allowed to call me?"*:

- `kiosk-punch` — **deliberately open.** The device serial + secret in the body *are* the credential, and they are verified inside the database.
- `adms-cdata` — open by protocol necessity; the device is authenticated by serial (+ secret where the hardware can carry one).
- `run-attendance-derivation` — **requires a shared token header**, because it takes no user input and writes across every tenant. It also **fails closed**: if the secret is missing it refuses rather than running unprotected.

---

## 3. The Attendance Edge Functions

| Slug | Auth | Caller | What it does |
|---|---|---|---|
| `kiosk-punch` | B (admin) | Kiosk tablet | Turns a code + PIN into a punch via `device_ingest_punch()` |
| `adms-cdata` | B (admin) | ZKTeco / eSSL machine | Translates the ADMS text protocol into the same seam |
| `run-attendance-derivation` | B (admin) + token | The scheduler | Calls `attendance_run_scheduled_derivation()` |
| `check-punch-out-gate` | A (caller) | Punch screen | Read-only: may this person punch out yet? |
| `calculate-late-marks` | A (caller) | Punch screen | Read-only: late marks this month vs the tenant threshold |

### `kiosk-punch`
```http
POST /kiosk-punch
{ "serial": "...", "secret": "...", "employee_code": "...", "pin": "...." }
```
Returns `{ success, employee_name, direction, occurred_at }` or `{ success: false, error, code }`.

It maps the database's raw codes to friendly messages, and **deliberately never reveals which part was wrong** — "this kiosk is not recognised" versus "code or PIN is incorrect", never "the PIN was wrong but the serial was fine". `code` is returned alongside so the UI can render a lockout differently from a typo, since those need opposite reactions from the person standing there.

### `adms-cdata`
Three shapes on one URL — handshake (`GET`), punch upload (`POST … table=ATTLOG`), and a command poll. **Always replies in plain text**; a JSON body makes the device consider the exchange failed and resend forever. See `06-devices-and-ingestion.md` for the protocol details.

### `run-attendance-derivation`
```http
POST /run-attendance-derivation
x-trigger-token: <DERIVATION_TRIGGER_TOKEN>
{ "lookback_days": 2 }          // optional
```
Fired hourly by the schedule `attendance-derivation-hourly`. The body is optional — pass a larger `lookback_days` for a manual catch-up over a wider window.

### `check-punch-out-gate` and `calculate-late-marks`
Both **read-only**, both run as the caller. `check-punch-out-gate` reports whether the employee has unapproved tasks and whether `punch_out_allowed` is set.

> **Important:** `check-punch-out-gate` is a **UX pre-check, not the security boundary.** The real enforcement is inside `punch_out_attendance()`. If you ever remove or bypass the edge function, punch-out is still correctly gated. Never move that rule *out* of the database and into the edge function.

---

## 4. ⚠️ The Orphan Trap

**Some functions are deployed but have no source file in this repository.**

At the time of writing, 20 functions are deployed and several exist only on the server — including the attendance-relevant `check-punch-out-gate`. They were created directly against the backend at some point and never committed.

That means:

```bash
# ALWAYS do this before touching a function you did not just write
npx @insforge/cli functions list
npx @insforge/cli functions code <slug>     # fetch what is actually running
```

If you deploy from a local file with the same slug as an orphan, **you overwrite the live function with no way back** — the previous source existed nowhere else.

If you fetch an orphan, commit it. That is the only way the count ever goes down.

---

## 5. Working With Them

### Deploy
```bash
npx @insforge/cli functions deploy <slug> \
  --file functions/<slug>/index.ts \
  --name <slug> \
  --description "what it does"
```
Deploying is immediate and affects production. There is no staging step.

### Read what is running
```bash
npx @insforge/cli functions code <slug>
```

### Logs
```bash
npx @insforge/cli logs function.logs
```
`console.log` / `console.error` inside a function land here. This is the only way to debug a scheduled run after the fact, which is exactly why `run-attendance-derivation` logs its result rather than discarding it.

### Secrets
Read inside a function with `Deno.env.get("NAME")`.

| Secret | Used by |
|---|---|
| `INSFORGE_BASE_URL` | every function (reserved, always present) |
| `API_KEY` | Pattern B functions (reserved — this is the `project_admin` key) |
| `INSFORGE_ADMIN_KEY` | optional override, tried before `API_KEY` |
| `DERIVATION_TRIGGER_TOKEN` | `run-attendance-derivation` |

```bash
npx @insforge/cli secrets add MY_SECRET "value"
npx @insforge/cli secrets get API_KEY
```

### Schedules
```bash
npx @insforge/cli schedules list
npx @insforge/cli schedules logs <id>
npx @insforge/cli schedules create --name "..." --cron "20 * * * *" \
  --url "https://<project>.function2.insforge.app/<slug>" \
  --method POST --headers '{"x-trigger-token":"..."}'
```

> **pg_cron is installed but you cannot use it.** `project_admin` has no `USAGE` on the `cron` schema. Scheduling always goes through `schedules` calling an edge function. The extension being visible is exactly what makes this a time sink.

---

## 6. Rules for writing a new one

1. **Put the logic in a database function; keep the edge function thin.**
2. **Pick Pattern A unless you truly cannot.** If you use Pattern B, write down *why* in the file header.
3. **Gate the caller** on every Pattern B function, and **fail closed** if the gate's secret is missing.
4. **Never trust a client-supplied `tenant_id`.** Derive it from something the server already knows.
5. **Return errors the caller can act on, without leaking which check failed.**
6. **`console.error` on every failure path** — a scheduled function that fails silently is indistinguishable from one that never ran.
7. **Read an existing function first** and copy its structure. `kiosk-punch` is a good Pattern B example; `check-punch-out-gate` is a good Pattern A one.
8. **Commit the source.** Do not create another orphan.
