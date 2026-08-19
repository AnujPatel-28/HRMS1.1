# Decisions I Need From You

**Last updated:** 2026-08-13

This is a list of choices I can't make for you — either because they're legal/tax questions that need a
CA, or because they're business decisions about what kind of product you want to sell.

I've written each one as: **what we do today → why it might be wrong → what I need from you.**

Nothing here is urgent enough to stop development. But **Part A must be settled before any real
company runs a real payroll**, because getting it wrong means wrong money in people's bank accounts.

**How to use this:** Part A can be forwarded to a CA as-is — Section A0 gives them the background they
need. Parts B, C and D are for you and me to brainstorm.

---

# PART A — Questions for a CA (payroll & statutory)

## A0. Context to give the CA

> *Copy this bit into your email/message to them.*
>
> We're building an HR/payroll system for Indian companies. It's multi-tenant — one system serving
> many client companies, each with their own employees. Right now we're at the testing stage with no
> real employee data.
>
> The system calculates monthly salary and deducts PF, ESI, Professional Tax and TDS. We've built the
> calculation logic from public sources and need it verified before any live payroll run.
>
> Below are the specific assumptions we've coded in. For each one we need either "yes that's correct"
> or "no, here's the right treatment."
>
> We operate on a monthly payroll cycle. Salary is prorated for unpaid leave (loss of pay).

---

## A1. Professional Tax — Karnataka slab conflict ⚠️ *most important*

**What we do today:** Employees earning up to ₹25,000/month pay nothing. Above ₹25,000 they pay
₹200/month.

**Why I'm unsure:** Published sources disagree. Some still show a middle band — ₹150/month for salary
between ₹15,001 and ₹25,000 — which appears to pre-date a 2025 amendment that raised the exemption
limit to ₹25,000. I couldn't confirm which is currently in force.

**Question for the CA:**
> For Karnataka Professional Tax as of today, is there any liability for a monthly salary between
> ₹15,001 and ₹25,000? Or is it nil up to ₹25,000 and ₹200 above it?

**Why it matters:** If we're wrong, every employee in that salary band is either over-deducted (we
take ₹0 when we should take ₹150) or under-deducted, every single month.

---

## A2. Professional Tax — which state applies when a company has multiple offices? ⚠️ *design decision*

**What we do today:** Each company sets **one** Professional Tax state for the whole company.

**Why that's probably wrong:** PT is a state tax. A company headquartered in Bengaluru with a branch
in Pune should deduct Karnataka PT for Bengaluru staff and Maharashtra PT for Pune staff. Today we'd
apply one state to everyone.

We already store each employee's `state` and `work_location`, so the data exists — we just don't use
it for PT.

**Question for the CA:**
> For an employee working in a different state from the company's registered office, which state's
> Professional Tax applies — the state where the employee physically works, the state where the
> company is registered, or the state of the office they're payrolled from?

**What I need from you (business side):** Do your target customers actually have offices in more than
one state? If yes this needs fixing before launch. If they're all single-state for now, we can note it
and defer.

---

## A3. Professional Tax — which figure is it calculated on?

**What we do today:** We use the employee's **full monthly gross salary**, ignoring unpaid leave.

**Example:** Someone on ₹30,000/month takes 10 days unpaid leave and is actually paid ₹20,000. We
still charge PT as if they earned ₹30,000.

**Our reasoning:** PT liability follows the wage the person is *engaged* at, not what they happened to
take home that month. Otherwise a month of unpaid leave would push them into a lower slab.

**Question for the CA:**
> Should Professional Tax be computed on contracted monthly gross, or on the actual amount paid after
> loss-of-pay deductions?

---

## A4. Professional Tax — Maharashtra's gender-based slabs

**What we do today:** We don't consider gender at all. Everyone above ₹10,000/month pays ₹200
(and ₹300 in February).

**Why I'm unsure:** Maharashtra reportedly exempts women earning up to ₹25,000/month.

**Question for the CA:**
> Does Maharashtra currently exempt women employees below a salary threshold? If so, what is the
> threshold and is it based on gender as recorded in employment records?

**Note from me:** If yes, I'd want to talk through how we record this — tying tax treatment to a
gender field has privacy implications and needs care for employees who don't identify within the
categories the tax rule assumes.

---

## A5. Professional Tax — Tamil Nadu half-yearly basis

**What we do today:** Tamil Nadu is charged twice a year, in September and March. We estimate the
half-year income as *current monthly gross × 6*, then apply the half-yearly slab.

**Why I'm unsure:** If someone got a raise in July, multiplying September's salary by 6 overstates
what they actually earned April–September.

**Question for the CA:**
> For Tamil Nadu PT, should the half-yearly slab be applied to actual cumulative earnings over the
> six-month period, or to an annualised figure from current salary? And is deducting the full
> half-yearly amount in a single month correct, or should it be spread across the six months?

---

## A6. Provident Fund — do we prorate the ₹15,000 ceiling for unpaid leave?

**What we do today:** We reduce the PF wage ceiling in proportion to days actually paid.

**Example:** Employee works half the month. We treat the ceiling as ₹7,500 instead of ₹15,000, so
maximum PF becomes ₹900 instead of ₹1,800.

**Why I'm unsure:** This is a genuine policy split. Some employers prorate the ceiling; others apply
the full ₹15,000 ceiling regardless of attendance.

**Question for the CA:**
> When an employee has loss-of-pay days, should the ₹15,000 PF wage ceiling be prorated for the days
> paid, or applied in full?

**What I need from you:** If the CA says "either is acceptable," tell me which you want as the default
— and I'll make it a per-company setting so clients can choose.

---

## A7. Provident Fund — employer contribution split (currently missing) 🔴

**What we do today:** We calculate employer PF as a single 12% figure.

**What's missing:** The employer's 12% is actually two components — **EPS 8.33%** (capped on ₹15,000
wages) and **EPF 3.67%**. We also don't calculate **EDLI** or **admin charges**.

**Why it matters:** Without the split you cannot generate an **ECR file**, which is what companies
upload to the EPFO portal every month. So today a customer literally cannot file their PF return from
our system.

**Question for the CA:**
> Please confirm the current employer-side PF breakdown and rates: EPS %, EPF %, EDLI %, and admin
> charges %, plus which wage each is capped on. Also — should the employer's contribution be shown on
> the employee's payslip, or only the employee's own deduction?

---

## A8. ESI — coverage lock-in (just implemented, please confirm)

**What we do today (as of today's fix):** ESI runs in two contribution periods — April–September and
October–March. If an employee is covered when a period starts, they stay covered until the period
ends, even if their salary rises above the ₹21,000 ceiling mid-period.

**Question for the CA:**
> Is that correct? And two edge cases: (a) an employee who joins mid-period on a salary **above**
> ₹21,000 — are they outside ESI immediately, or from the next period? (b) an employee whose salary
> **falls below** ₹21,000 mid-period — do they become covered immediately or from the next period?

---

## A9. ESI — rounding

**What we do today:** We round to two decimal places.

**Question for the CA:**
> Are ESI contributions required to be rounded up to the next whole rupee? If so, does that apply to
> employee share, employer share, or both?

---

## A10. TDS — we collect declarations but don't compute tax 🔴

**What we do today:** Employees submit investment declarations through the system, and HR reviews
them. But the actual monthly TDS figure is **typed in manually by HR** for each employee.

**What's missing:** The system should project annual income, apply the tax slab, subtract eligible
declarations, and divide across remaining months.

**Questions for the CA:**
> 1. Should new-vs-old tax regime be chosen per employee, and can they switch mid-year?
> 2. When an employee submits declarations late (say December), should the shortfall be spread across
>    remaining months or collected in one go?
> 3. What proof-verification is expected before allowing a declaration to reduce TDS?

**What I need from you:** This is the biggest gap in payroll. Confirm you want me to build automated
TDS computation, because it's a substantial piece of work.

---

## A11. Which states do you actually operate in?

**What I need from you:** A list of states where your customers' employees actually work. Right now
I've seeded PT rules for Karnataka, Maharashtra, Gujarat, Telangana, Andhra Pradesh and Tamil Nadu.

Any state not on that list currently deducts **zero** PT. That's silently wrong rather than loudly
wrong, which is worse. Tell me the real list and I'll make sure it's covered — or make unknown states
throw a visible error instead of quietly deducting nothing.

---

## A12. Not built at all — confirm whether you need these

- **Labour Welfare Fund (LWF)** — small state-level deduction, applies in Karnataka, Maharashtra,
  Tamil Nadu and others. *Ask the CA: which states, what rates, what frequency?*
- **Gratuity provisioning** — typically 4.81% of basic accrued monthly. *Ask: do we need to show this
  as a monthly provision, and is it on the payslip?*
- **Full & final settlement** — we have an offboarding flow, but it doesn't produce a final payslip
  with leave encashment, notice-period recovery and gratuity payout. *Ask: what must an F&F statement
  contain?*

---

# PART B — Business decisions (for you, no CA needed)

## B1. Do you sell modules separately?

Your UI/UX notes suggest an "App Store" where a company toggles modules on and off.

**The decision:** is that just a UI convenience, or a **pricing boundary**? They're very different
builds. If a small company can turn off Payroll and pay less, then module access needs to be enforced
in the backend security rules, not just hidden in the interface — otherwise anyone can call the API
directly and use what they haven't paid for.

**Relevant fact:** you already have `tenants.plan` and `tenants.max_employees` columns, but nothing
enforces them today.

**What I need:** "UI only for now" or "real pricing tiers." I'd suggest UI-only until you have paying
customers — enforcement is easy to add later, and hard to get right early.

## B2. What is a "manager" allowed to do?

**Today:** there is no manager role. Someone is a manager purely because other employees point at them
as their reporting manager. Permissions come from that relationship.

**The question:** should managers approve their team's leave? See their team's salary? Run reports?
Right now the rules are implicit and scattered.

**What I need:** a plain-English list — "a manager can do X, Y, Z but not A, B." I'll turn it into
enforced rules.

## B3. Who is allowed to approve a payroll run?

**Today:** whoever has HR access can run and approve payroll.

**The question:** do you want maker-checker — one person prepares, a different person approves? This
is standard in payroll because it's the highest-fraud-risk area in any HR system, and it's much easier
to build now than to retrofit.

## B4. Employee passwords

**Today:** HR sets employee passwords directly, which means HR knows every employee's password.

**Better:** the employee gets an invite link and sets their own password. Nobody else ever knows it.

**Blocker:** your email sending (SMTP) isn't configured, so the system currently *can't* send invite
emails. That's why the current approach exists.

**What I need:** a decision to set up email sending. It unblocks self-service passwords, password
resets, payslip delivery, and leave notifications — quite a lot depends on it.

---

# PART C — Technical decisions (I'd like your steer)

## C1. What order do we build in?

My suggested order, and why:

1. **Fix PF employer split** — small, and without it customers can't file PF returns.
2. **Build a payroll regression test harness** — freeze current payslips as test fixtures, so future
   changes can't silently alter people's pay.
3. **Salary component refactor** — the big one from the design doc. Do it *after* #2 so we can prove
   it changed nothing.
4. **Automated TDS.**
5. **Performance management** — the biggest missing module.

**What I need:** tell me if your customer conversations imply a different order. Customer pull beats
my technical instinct.

## C2. How much do we care about old payslips?

Payslips are legal documents. Our system already snapshots the rules used at the time, so a payslip
printed today looks the same in three years.

**The question:** if we discover a calculation was wrong for past months, do we (a) leave old payslips
untouched and correct going forward, or (b) reissue corrected payslips?

This affects how I build the correction tooling. Worth asking the CA too.

## C3. Cross-tenant testing

You now have proper security rules, which means it's possible to accidentally build a screen that
*looks* fine to you as an admin but is blocked for a normal employee.

**What I'd like:** a QA pass where you log in as each of the QA accounts and click through every
screen, telling me anything that looks empty or broken. That's the fastest way to catch
permission gaps.

---

# PART D — UI/UX direction

I read `doc/UiAndUxSuggestion.md`. The direction is right and I'd back most of it. My honest take on
what to do first, since it's a big rewrite if you do it all at once:

**Do these first — high value, low risk:**

1. **Command palette (Ctrl+K).** Genuinely the highest value-per-effort item in the whole document.
   It doesn't require restructuring anything — it sits on top of what exists. For HR staff doing the
   same six things daily it's transformative.
2. **Slide-over drawers for cross-module peeks.** Your payroll-to-attendance example is exactly right,
   and it's the single most common real workflow. Also lower risk than restructuring navigation.
3. **Breadcrumbs.** Cheap, and immediately reduces "where am I".

**Do this next, carefully:**

4. **App switcher + contextual sidebar.** The right end state — you have 14 modules in one sidebar,
   which is too many. But it touches every screen. Do it *after* the module boundaries have settled,
   or you'll do it twice.

**Think harder before doing:**

5. **Module on/off toggles.** See B1 — decide whether it's cosmetic or commercial first.
6. **Per-module colour coding.** Be careful: colour is also how you signal status (approved / pending /
   rejected). If green means both "Payroll module" and "approved", you've weakened both. I'd use colour
   for state and something quieter — an icon, or a subtle left border — for module identity.

**One thing missing from the doc:** *mobile*. You have geolocation punch-in with selfie capture, which
is inherently a phone activity — nobody punches in from a laptop at the office door. There's a
`mobile-ui` branch, so this is clearly on your mind. I'd argue the employee self-service portal should
be designed mobile-first and the HR portal desktop-first; they're genuinely different products used in
different postures. That's a bigger strategic call than any of the navigation items above.

---

# Quick summary — what I actually need

| # | Need | From | Blocking? |
|---|---|---|---|
| A1 | Karnataka PT — is there a ₹150 middle band? | CA | Before live payroll |
| A2 | Multi-state PT — which state applies? | CA + you | Before live payroll |
| A7 | Employer PF split (EPS/EPF/EDLI/admin) | CA | Customers can't file PF |
| A8 | Confirm ESI lock-in + joiner edge cases | CA | Before live payroll |
| A10 | Do you want automated TDS? | You | Big build, needs a decision |
| A11 | Which states do you operate in? | You | Silent wrong answers today |
| B1 | Modules — cosmetic or pricing? | You | Changes the build |
| B4 | Set up email sending? | You | Unblocks several features |
| C1 | Confirm build order | You | Nice to have |
| D | UI/UX — agree the phasing? | You | Nice to have |
