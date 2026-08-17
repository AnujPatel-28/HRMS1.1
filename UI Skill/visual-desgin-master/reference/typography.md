# Typography — Visual Design Master Reference

Sources: Practical UI (Dannaway) · Refactoring UI (Wathan & Schoger) · Every Layout · industry practice

Typography is the foundation of visual hierarchy. Get it right and color, spacing, and everything else becomes easier.

---

## Font Choice: The Decision Tree

### Category 1: Product / SaaS / App UI
Use a **geometric or humanist sans-serif** with a wide weight range and strong legibility at small sizes.

**Tier 1 (best choices):**
- **Inter** — The industry default for product UI. Neutral, extremely legible, massive weight range. Free.
- **Geist** — Vercel's type family. Clean, modern, slight personality. Free.
- **DM Sans** — Slightly warmer than Inter. Better for consumer-facing products. Free.
- **Outfit** — Rounder, more expressive. Consumer apps, fintech dashboards. Free.

**Tier 2 (when you need more personality):**
- **Plus Jakarta Sans** — More character than Inter, still professional.
- **Manrope** — Friendly but precise. Works well for both UI and marketing.
- **Space Grotesk** — Distinct geometric quirkiness. Developer tools, startups.

### Category 2: Editorial / Marketing / Branding
Pair a serif for headings with a sans for body. Common pairs:
- **Fraunces** (display serif) + **Inter** (body)
- **Playfair Display** + **Source Sans Pro**
- **Libre Baskerville** + **Lato**

### Category 3: System / No Custom Font
`system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` — Use when load performance is critical or you're building an OS-integrated tool.

### Avoid:
- Multiple Google Fonts on the same page (>2 fonts = visual confusion, load cost)
- Decorative fonts in UI body text
- Fonts that don't include at least 400, 500, and 700 weights

---

## The Type Scale

Use a **hand-picked, non-linear scale**. Never pick sizes at random. A good scale has perceptible jumps between steps.

### Recommended scale (base 16px)
```
xs:    12px  (captions, timestamps, badges)
sm:    14px  (secondary labels, table cells, helper text)
base:  16px  (body text, form inputs, standard UI text)
lg:    18px  (emphasized body, lead paragraphs)
xl:    20px  (card headings, small section titles)
2xl:   24px  (section headings)
3xl:   30px  (page titles, modal headings)
4xl:   36px  (hero section headings)
5xl:   48px  (landing page display)
6xl:   60px  (large marketing display)
```

**CSS:**
```css
:root {
  --text-xs:   0.75rem;   /* 12px */
  --text-sm:   0.875rem;  /* 14px */
  --text-base: 1rem;      /* 16px */
  --text-lg:   1.125rem;  /* 18px */
  --text-xl:   1.25rem;   /* 20px */
  --text-2xl:  1.5rem;    /* 24px */
  --text-3xl:  1.875rem;  /* 30px */
  --text-4xl:  2.25rem;   /* 36px */
  --text-5xl:  3rem;      /* 48px */
}
```

**Tailwind equivalents:** `text-xs` / `text-sm` / `text-base` / `text-lg` / `text-xl` / `text-2xl` / `text-3xl` / `text-4xl` / `text-5xl`

---

## Font Weight Usage

Limit to **3 weights** in a single UI. More creates visual noise.

| Weight | Value | Use |
|---|---|---|
| Regular | 400 | Body text, secondary labels, metadata |
| Medium | 500 | Navigation labels, emphasized body, form labels |
| Semibold | 600 | Card headings, section headings, important labels |
| Bold | 700 | Page titles, strong emphasis, CTAs |

**Rules:**
- Never bold every heading — bold loses meaning when everything is bold
- Don't use font weight as the only differentiator — pair with size or color change
- Weight contrast is most visible when the heavier weight is also larger or darker

---

## Line Height

Line height and font size are **inversely proportional** — larger text needs less; smaller text needs more.

| Context | Line Height |
|---|---|
| Display / Hero (36px+) | 1.1–1.2 |
| Section headings (24–36px) | 1.2–1.35 |
| Card headings / subheadings (18–24px) | 1.3–1.4 |
| Body text (14–18px) | 1.5–1.6 |
| Long-form reading (16px+) | 1.6–1.75 |
| Small UI text / labels (12–14px) | 1.4–1.5 |

```css
/* System */
--leading-tight: 1.15;
--leading-snug:  1.3;
--leading-normal: 1.5;
--leading-relaxed: 1.625;
--leading-loose: 1.75;
```

---

## Letter Spacing

Letter spacing defaults should almost always be 0. Adjustments apply in specific cases only:

| Context | Tracking | Why |
|---|---|---|
| Body text | 0 (default) | Never add tracking to body text |
| Large headings (36px+) | Slightly negative (−0.01 to −0.03em) | Large type optically loose |
| UPPERCASE labels / overlines | +0.05 to +0.15em | ALL CAPS needs tracking to be legible |
| Small capitals (12px) | +0.02 to +0.06em | Tight at small size |

**Rule:** Letter spacing is in `em` units so it scales relative to font size.

---

## Line Length (Measure)

Optimal reading line length: **50–75 characters** (45–90 on screens for UI text).

```css
/* Constrain prose */
.prose { max-width: 65ch; }

/* Tailwind */
<p class="max-w-prose">...</p>   /* 65ch */
<p class="max-w-lg">...</p>      /* 32rem */
```

- Never allow body text to run the full width of a 1440px screen
- Long lines (100+ chars) increase reading effort and cognitive load
- Short lines (<40 chars) cause too many line breaks and disrupt reading rhythm

---

## Text Alignment

| Situation | Alignment |
|---|---|
| Body text (3+ lines) | Left-aligned (always) |
| Short headings (1–2 lines) in a centered hero | Centered acceptable |
| Form labels | Left-aligned |
| Table: text columns | Left-aligned |
| Table: numeric columns | Right-aligned (decimal point aligned) |
| Card heading | Left-aligned unless 1 line in a symmetrical card |
| Metadata, timestamps | Often right-aligned (trailing position) |

**Never center body paragraphs.** Centered text looks fine for 1–2 lines in marketing contexts. For anything the user must read, left-alignment gives the eye a consistent anchor.

---

## Hierarchy with Typography: The Three Levers

Create hierarchy by using **size + weight + color** together. Never rely on just one.

| Level | Strategy |
|---|---|
| Primary (page title, card heading) | Largest on screen · Heaviest weight · Darkest text color |
| Secondary (section subheading, emphasized text) | Medium size · Medium-semibold weight · Standard text color |
| Body | Base size · Regular weight · Standard text color |
| Supporting (labels, metadata, captions) | Small size · Regular weight · Muted text color (60–70% opacity or grey) |
| Disabled / placeholder | Small-base size · Regular weight · Very muted (40% opacity or light grey) |

**Practical technique:** If your heading looks too prominent, reduce its weight before reducing its size. Semibold at a given size often reads better than Bold at a smaller size.

---

## Typography Anti-Patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Pure black `#000` for text | Harsh, creates harsh contrast | Use `#111827` or `#1a1a2e` (near-black) |
| Same size for everything | No hierarchy | Size difference ≥2 scale steps for hierarchy |
| Centered long text | Hard to scan | Left-align anything 3+ lines |
| 10+ font sizes across UI | Visual noise | Constrain to the defined scale |
| Grey text on colored background | Kills contrast | Match grey hue to background hue |
| Placeholder text as the label | Disappears on focus | Always show the label above the field |
| Font weight 300 for body | Too thin, low contrast | Use 400 minimum for body text |