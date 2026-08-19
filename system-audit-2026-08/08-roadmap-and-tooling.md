# 08 — Prioritized product roadmap, OSS tooling, mobile & accurate location

This turns the gaps (`07-market-benchmark.md`) and security findings (`04`) into a sequenced plan, with a prebuilt open-source library for every build so you move faster.

---

## Part A — The accurate punch-in location problem (solve this properly)

### Why the browser location is inaccurate (root cause)
The browser Geolocation API returns a position from whatever source is available, and its accuracy varies wildly:
- **GPS chip** (phones, outdoors): ~5–20 m ✅
- **Wi-Fi triangulation**: ~20–50 m
- **Cell towers**: hundreds of m – km
- **IP address** (desktops/laptops with no GPS): **city-level, kilometres** ❌

On a **laptop there is no GPS**, so the browser falls back to Wi‑Fi/IP → the huge errors you're seeing. Even on phones, `enableHighAccuracy: true` is a *request* the browser/OS may not honor in a mobile web view. **The selfie you added is a good presence/identity check, but it does not fix location accuracy — those are two different problems.** Keep the selfie for anti-spoof; fix location separately.

### The fix (this is what makes punch-in "best")
1. **Native GPS via the mobile app.** Inside a Capacitor app (Part B), use `@capacitor/geolocation` with `enableHighAccuracy: true`, `timeout`, and `maximumAge: 0`. This reads the **actual device GPS**, not a Wi‑Fi guess → metres-accurate. This single change is the biggest win.
2. **Enforce an accuracy threshold, server-side.** You already store `location_accuracy` (`coords.accuracy` = radius in metres). Reject/flag any punch where `accuracy > ~50–100 m` so a vague Wi‑Fi fix can't be accepted. Do this in the `punch_out`/punch-in RPC (ties to fixing S5).
3. **Geofence against the office.** You already have `office_locations` (lat/lng) + Leaflet. Compute distance with **turf.js** (`@turf/distance`, OSS) and allow punch only within the office radius. Enforce in the RPC, not just the UI.
4. **Anti-spoofing.** On Android, native GPS exposes mock-location (`isFromMockProvider`); reject mocked fixes. The selfie stays as a second factor. Optionally add device-attestation later.
5. **UX:** show the live accuracy radius on the Leaflet map and block the punch button until accuracy is good + inside geofence — so employees self-correct (walk outside, enable GPS).

**Net:** native GPS (accuracy) + accuracy-threshold + office-geofence (both server-enforced) + selfie (presence) = a reliable, hard-to-cheat punch. Libraries: `@capacitor/geolocation`, `@turf/turf`, existing Leaflet.

---

## Part B — Mobile app (yes, reuse your React)

You have a working React SPA, so **do NOT rewrite in React Native.** Two honest options:

| Option | Effort | Reuse | Native GPS/camera/push | Verdict |
|---|---|---|---|---|
| **Capacitor (Ionic)** | **Low** — wraps your existing SPA in a native shell | ~100% of current code | ✅ full (`@capacitor/geolocation`, `@capacitor/camera`, `@capacitor/push-notifications`, biometrics) | ✅ **Recommended** — fastest path, solves the GPS problem, ships to iOS + Android + keeps the web app. |
| React Native / Expo | High — new UI codebase | logic only, not `react-dom` UI | ✅ | Only if you later want a premium native feel. Not now. |
| PWA (installable web) | Lowest | 100% | ❌ still browser GPS | Doesn't fix your location problem — skip as the primary answer. |

**Recommendation: Capacitor.** Steps: `npm i @capacitor/core @capacitor/cli`, `npx cap init`, `npx cap add ios android`, point it at your Vite build, add the geolocation/camera/push plugins, wrap the punch flow with native GPS. Your entire existing HR/employee UI runs unchanged inside the app. Push notifications can be driven by your existing `notifications` table via **Novu** or Firebase Cloud Messaging.

---

## Part C — Prioritized roadmap (with an OSS library for each)

### 🔴 Phase 0 — Foundation & safety (Weeks 1–2, non-negotiable)
Ship *before* new features; these are what make it a real product.
| Work | OSS / tool |
|---|---|
| Fix audit S1–S4 (drop anon SQL/password RPCs, enable RLS, private buckets) | InsForge migrations |
| Test framework + RLS tests | **Vitest** (unit), **pgTAP** (Postgres/RLS policy tests), **Playwright** (E2E) |
| CI (lint+types+tests+RLS guard) | **GitHub Actions** |
| Error/uptime monitoring | **Sentry** (or **GlitchTip**, OSS Sentry-compatible) |

### 🟠 Phase 1 — Highest-value gaps + mobile (Weeks 3–8)
| Work | Why | OSS / tool |
|---|---|---|
| **Capacitor mobile app + native GPS punch** | Solves your location pain; ships mobile | **Capacitor** + `@capacitor/geolocation`/`camera`/`push`, **turf.js** |
| **Server-side payroll RPC** | Correctness, tamper-evidence, scale | Postgres RPC; PDF via **@react-pdf/renderer** or **pdfmake** |
| **Multi-level approval workflow engine** | #2 competitive gap (manager→HR chains) | DB `approval_chains` + RPC; optionally **n8n** (OSS automation) for routing/escalation |

### 🟡 Phase 2 — Competitive parity (Months 3–4)
| Work | Why | OSS / tool |
|---|---|---|
| **Performance management** (goals/OKRs, appraisals, 360) | #1 missing module | Custom schema; UI with **Tremor** components; reference data model from **OrangeHRM** (OSS) |
| **Reports & analytics** | Beyond dashboards | **Metabase** (OSS BI on your Postgres — embed dashboards, near-zero build) or **Apache Superset**; in-app charts with **Tremor** / **Recharts** |
| **e-Signature** (offer letters, policy sign-off) | Onboarding/compliance | **Documenso** (OSS DocuSign alternative, self-host) |

### 🟢 Phase 3 — Depth & delight (Months 5–6)
| Work | OSS / tool |
|---|---|
| Statutory completeness: Form 16, ECR/ESI returns, full-&-final | Form 16 PDF via **@react-pdf/renderer**; consider **RazorpayX Payroll / ClearTax APIs** (commercial) for filing rather than building |
| Employee surveys / eNPS | **Formbricks** (OSS experience management) |
| HR helpdesk / ticketing | **Chatwoot** (OSS — can also modernize your chat) or **FreeScout** |
| Unified notifications (in-app + email + push + SMS) | **Novu** (OSS notification infra — fits your `notifications` table) |
| Shift roster / calendar UI | **FullCalendar** (OSS) |
| LMS (optional/defer) | **Moodle** (heavy) or defer |

---

## Part D — Library cheat-sheet (all open-source unless noted)

- **Mobile:** Capacitor (+ geolocation, camera, push, biometrics)
- **Geospatial/geofence:** turf.js; Leaflet (already in use)
- **BI / reports:** Metabase, Apache Superset; in-app: Tremor, Recharts, visx
- **PDF (payslip / Form 16 / letters):** @react-pdf/renderer, pdfmake, Puppeteer (edge fn); html2pdf.js (already in use)
- **e-Signature:** Documenso
- **Surveys/eNPS:** Formbricks
- **Helpdesk/chat:** Chatwoot, Zammad, FreeScout
- **Notifications/push:** Novu (or Firebase Cloud Messaging)
- **Workflow automation:** n8n; (Temporal only if you need durable long-running workflows — heavy)
- **UI components:** shadcn/ui, Radix, Tremor (all Tailwind-friendly — matches your stack)
- **Testing:** Vitest, Playwright, pgTAP
- **Monitoring:** Sentry / GlitchTip
- **Reference HRMS (data models, not code reuse):** OrangeHRM (OSS)

> Rule of thumb: **buy/adopt for horizontal problems** (BI, e-sign, surveys, push, monitoring — Metabase/Documenso/Formbricks/Novu/Sentry) and **build for your HR domain core** (performance, approvals, payroll) where OSS doesn't fit your India-specific model. This gets you to parity months faster than building everything.
