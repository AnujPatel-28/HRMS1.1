# 09 — Payroll correctness (edge cases) & physical attendance devices

Verified against `payroll/hr/payroll-calc.ts` (the engine) and `payroll/hr/RunPayroll.tsx` (the driver) on 2026-08-12.

## How the payroll actually works (so the edge cases make sense)
1. `RunPayroll.tsx` pulls the month's `attendance` rows and **auto-aggregates** per employee: `present → daysPresent`, `absent → daysAbsent`, `half_day → halfDays`, `leave → paid/unpaidLeaveDays` (unpaid determined by matching approved unpaid leaves). ✅ Good — days are derived from data, not typed by hand.
2. If an employee has **no attendance rows**, it defaults to `daysAbsent = workingDays` ("do not default to full pay"). ✅ Safe default.
3. `calcPayslip(struct, att, overtime, year, month, holidays, policy)` computes gross → proration (LOP) → PF/ESI/TDS/PT → net.
4. `workingDays = getWorkingDays(year, month, holidays)` = `daysInMonth − Sundays − non-Sunday holidays`.

The math inside `calcPayslip` (proration, ceilings, anomaly normalization, net floored at 0) is **internally correct**. The problems are what the engine **doesn't know about**.

---

## A. Payroll edge cases — verdict per case

### 🔴 1. Configurable weekly-offs are ignored (CONFIRMED BUG)
`getWorkingDays` / `countSundays` assume **Sunday is the only weekly off**. But the attendance & leave system uses a **configurable `working_days` array per shift** (leave RPCs respect it). So the two engines disagree.
- **Effect:** For any tenant on a **5-day week or alternate-Saturday** schedule, an employee present every actual working day (say 22 days) is measured against `workingDays = ~26` (Saturdays counted as working). The ~4 Saturdays become "unaccounted absences" → **the employee is under-paid** (22/26 instead of full pay).
- **Fix:** Compute `workingDays` from the employee's shift `working_days` + holidays (same source the leave engine uses), not hardcoded Sundays. This is the single most impactful payroll fix.

### 🟠 2. Mid-month JOINER — no `date_of_joining` awareness (PARTIALLY BROKEN)
`calcPayslip` has **no concept of the employment period**. A joiner is handled only implicitly: they have attendance rows only from their join date, so the "unaccounted days" before joining are treated as absences.
- **`working_days` method:** happens to be ~correct — joined on the 20th, worked 8 of the month's 26 working days → 8/26 of salary ≈ correct proration. ✅ by luck.
- **`calendar` method:** **wrong.** `daysRatio = (daysInMonth − totalDeductibleDays)/daysInMonth`, but `totalDeductibleDays` is counted in *working* days while divided by *calendar* days (unit mismatch). Joined 20th of a 30-day month → computes 0.40 vs correct 11/30 = 0.367 → **over-pays.**
- **Latent risk:** if attendance rows ever get auto-created for the whole month (bulk import, leave approval writing attendance for pre-joining dates), a joiner silently gets **full pay**. Nothing caps payable days at `(month_end − date_of_joining)`.
- **Fix:** Pass `date_of_joining` into the engine; derive the payable period from `max(month_start, date_of_joining) … month_end` and prorate against period working-days explicitly.

### 🟠 3. Mid-month LEAVER / Full-&-Final (MISSING)
Same blind spot in reverse: no `last_working_day`. Numerically the `working_days` method approximates it, but there is **no F&F engine**: no leave encashment, no gratuity, no notice-period pay/recovery, no recovery of excess-availed leave. Real HRMS run a distinct F&F settlement. **Gap.**

### 🟠 4. TDS is a static number, not computed (GAP)
`tds = struct.tds_monthly` — a fixed figure on the salary structure. You **have** an `it_declarations` table (80C etc.) and `it_declaration_windows`, but the engine **doesn't use them**. Real payroll projects annual income, applies the chosen regime (old/new), deductions, and spreads TDS across remaining months. **Gap** — currently TDS is only as right as a manual entry.

### 🟠 5. Professional Tax is hardcoded, not slab-based (GAP)
`DEFAULT_PROFESSIONAL_TAX_BY_STATE` is a flat ₹200 map for 6 states (+ manual override). Real PT is **slab-based by salary AND state**, and some states (e.g. Maharashtra) have a different February amount. Under/over-charges for many brackets. **Fix:** a PT slab table per state.

### 🟡 6. PF ceiling proration is debatable
`proratedPfCeiling = pfWageCeiling × daysRatio`, then `pfEligibleWage = min(proratedBasic, proratedPfCeiling)`. Prorating the ₹15,000 ceiling by attendance is defensible for LOP but not the universal EPFO practice; can under-contribute. Confirm against your compliance stance.

### 🟡 7. ESI mid-period continuation not handled
Eligibility uses full `grossMonthly ≤ 21000` (✅ correct to use un-prorated gross), but the statutory rule that an employee crossing ₹21k **mid-contribution-period continues ESI until period end** isn't modelled. Minor for most, matters at cusp salaries.

### 🟡 8. Missing earnings/adjustment types (GAP)
No mechanism in the payslip for: **arrears** (backdated revision), **salary revision mid-month** (two structures in one month), **variable pay/bonus/incentives**, **loans/advances recovery**, or **reimbursements** (the expenses module isn't folded into net pay). Real payroll has ad-hoc earning/deduction lines.

### 🟢 Handled correctly (don't regress)
Net floored at 0 (no negative salary) · attendance-anomaly normalization · PF excludes OT, ESI includes OT (✅ statute) · per-component rounding · safe zero-attendance default · working-day count excludes holidays that fall on Sundays (no double subtraction).

---

## B. What mature payroll systems do that yours doesn't
(Keka / greytHR / RazorpayX Payroll / Zoho Payroll)

| Capability | Them | TalentMesh |
|---|---|---|
| Employment-period proration (joiner/leaver from DOJ/LWD) | ✅ automatic | 🟠 implicit, unit-buggy in calendar mode |
| Configurable weekly-offs in payroll | ✅ | ❌ Sunday-only (bug) |
| Dynamic TDS from declarations + regime | ✅ | ❌ static number |
| Slab-based Professional Tax | ✅ | 🟠 flat/hardcoded |
| Full-&-Final settlement (gratuity, encashment, notice) | ✅ | ❌ |
| Arrears / revision / variable pay / bonus lines | ✅ | ❌ |
| Statutory outputs: Form 16, ECR (PF), ESI return, PT challan | ✅ | ❌ |
| Bank salary-disbursement (NEFT/advice) file | ✅ | ❓ verify |
| Loan/advance management & recovery | ✅ | ❌ |
| Reimbursement integration into net pay | ✅ | ❌ (separate expenses) |
| Server-side calc + immutable, audited payslip | ✅ | ❌ client-side calc |
| Locked pay periods / reprocessing controls | ✅ | 🟠 partial (`assert_date_range_unlocked` exists for leave) |

**Where ours falls:** the **core LOP/PF/ESI math is right**, but the engine is **attendance-days-driven, not employment-period- or compliance-driven**, runs client-side, and stops short of statutory outputs and F&F. It's a solid "monthly salary calculator," not yet a "compliant payroll system."

---

## C. Physical device compatibility for attendance

Today attendance = web/mobile punch + geo + selfie. To support on-premise hardware (what most Indian offices already own), add a **device-ingestion layer**:

### Device types & how to integrate
| Device | Integration | OSS / tool |
|---|---|---|
| **Biometric fingerprint/face** (ZKTeco, eSSL, Matrix, Realtime) — the India default | Two modes: **Push (ADMS/iclock)** — device HTTP-POSTs punches to your endpoint; or **Pull** — poll device over TCP | **node-zklib** / **zkteco-js** (Node), **pyzk** (Python) for pull; implement iclock HTTP routes for push |
| **RFID / smart-card readers** | Reader posts card-id → map to employee | vendor SDK + your endpoint |
| **Tablet kiosk at the door** | Capacitor app in kiosk mode + front-camera **face match** | Capacitor + **face-api.js** / **@vladmandic/human** (OSS on-device face recognition) |
| **QR check-in** | Rotating location QR; employee scans in the app | **qrcode.react** (already a dependency) |
| **Network-based** | Allow punch only on office Wi-Fi/IP; read SSID/public IP | Capacitor network plugin; server-side IP allowlist per `office_locations` |

### Recommended architecture
1. A small **compute service or edge function** exposes a device-ingestion endpoint (`/attendance/device-punch`) that accepts biometric push (ADMS) and/or polls devices via `node-zklib`.
2. Map **device_user_id → employee_id** (add a `device_mappings` table).
3. Normalize and write into the existing `attendance` table via a `SECURITY DEFINER` RPC (so RLS/tenant rules and dedup apply). Payroll already reads `attendance`, so **devices flow into payroll for free** once here.
4. **Dedup** across sources (device + app punch same day) with a unique/merge rule on `(employee_id, date)`.

### Other attendance gaps worth closing
- **Turn the selfie into verification, not just storage.** Right now it's captured; add on-device face-match against an enrolled photo (`face-api.js` / `@vladmandic/human`) for real presence proof.
- **Offline punch** for field staff: mobile app queues punches offline and syncs on reconnect (Capacitor + local store + a sync RPC).
- **Native GPS geofence** (see `08` Part A) — solves the accuracy problem the selfie was compensating for.
- **Mock-location rejection** on Android; **liveness** (blink/turn) if selfie becomes a verification gate.
- **Regularization** already exists (`attendance_corrections`) — good.

---

## D. Suggested fix order (payroll + devices)
1. 🔴 **Weekly-off bug** — payroll must use shift `working_days`, not Sunday-only. (Correctness for all non-Sunday-only tenants.)
2. 🔴 **Move payroll calc to a server-side RPC** — recompute + store immutable payslip (also closes the client-trust gap).
3. 🟠 **Employment-period proration** — pass `date_of_joining` / `last_working_day`; fix the calendar-method unit bug.
4. 🟠 **Dynamic TDS from `it_declarations`** + **slab-based PT table**.
5. 🟠 **F&F module** (gratuity, leave encashment, notice) + **arrears/variable-pay lines**.
6. 🟢 **Device-ingestion layer** (ZKTeco/eSSL push + `node-zklib`) writing into `attendance` via RPC.
7. 🟢 **Statutory outputs** (Form 16, ECR, ESI, PT) — build PDFs with `@react-pdf/renderer`, or integrate RazorpayX/ClearTax APIs for filing.
