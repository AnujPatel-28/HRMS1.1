# Dark Mode — Visual Design Master Reference

Sources: Refactoring UI · Practical UI · RAXXO Studios (20yr practitioner) · industry practice

Dark mode is not an inversion of light mode. It is a separate surface system with its own rules for background layering, text contrast, borders, shadows, and semantic colors. Building it by inverting your light palette produces interfaces that look harsh, amateur, or like an "AI-generated" template.

> "Dark mode amplifies typography problems. On a light background, mediocre font sizing and spacing can hide behind visual density. On a dark background, every heading, every line of body text, every label is isolated against empty space. Bad type sticks out." — RAXXO Studios

---

## The Background Layering System

Dark mode uses **multiple dark surfaces** to create depth through subtle lightness differences. One flat dark background creates a dead, undifferentiated layout.

### Standard 4-Surface Stack (Light to Dark = Higher to Lower)

```css
:root[data-theme="dark"] {
  /* Base canvas — the very bottom */
  --bg-base:        #0f172a;  /* slate-950: deepest background */

  /* Main surface — page background, behind cards */
  --bg-surface:     #1e293b;  /* slate-800 */

  /* Elevated surface — cards, panels, sidebar */
  --bg-surface-2:   #334155;  /* slate-700 */

  /* Highest surface — modals, dropdowns, tooltips */
  --bg-surface-3:   #475569;  /* slate-600 */
}
```

**Alternative with true black:**
```css
--bg-base:      #000000;
--bg-surface:   #111111;   /* #111 — softer than pure black */
--bg-surface-2: #1a1a1a;
--bg-surface-3: #242424;
```

**Warm-tinted dark (slightly purple-grey):**
```css
--bg-base:      #0d0d14;
--bg-surface:   #16161f;
--bg-surface-2: #1e1e2a;
--bg-surface-3: #27273a;
```

**Rule:** Background steps should differ by ~10–15% lightness in HSL — enough to be visible, not enough to be jarring.

---

## Text Hierarchy in Dark Mode

Three clear tiers. White text on dark is too harsh — use slightly off-white.

```css
:root[data-theme="dark"] {
  /* Tier 1: Primary text — headings, values, important content */
  --text-primary:    #f1f5f9;   /* Near-white — not pure white */

  /* Tier 2: Secondary text — body text, labels, standard content */
  --text-secondary:  #94a3b8;   /* slate-400 — legible but recedes */

  /* Tier 3: Muted text — placeholders, timestamps, captions */
  --text-muted:      #64748b;   /* slate-500 — very subtle */
}
```

**Typography tips for dark mode specifically:**
- Font weight below 600 (semibold) loses distinction on dark backgrounds. Weight differences of 400 vs 500 are nearly invisible. Use **size** as the primary hierarchy lever, not weight.
- Body text at `line-height: 1.6` reads more comfortably on dark backgrounds than the tighter 1.5
- Avoid light font weights (100–300) entirely in dark mode — they disappear
- Don't use color-tinted text for decorative hierarchy — it reduces contrast

---

## Borders in Dark Mode

Shadows are nearly invisible on dark backgrounds — **borders carry the separation work instead**.

```css
:root[data-theme="dark"] {
  --border-default:  rgba(255, 255, 255, 0.08);  /* Subtle white edge */
  --border-strong:   rgba(255, 255, 255, 0.14);  /* More visible */
  --border-focus:    #818cf8;                    /* Primary-400 for focus */
}
```

**Border-first approach for dark mode:**
```css
/* Light mode: shadow */
.card { box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

/* Dark mode: border instead */
[data-theme="dark"] .card {
  box-shadow: none;
  border: 1px solid rgba(255,255,255,0.08);
}
```

White-alpha borders (`rgba(255,255,255,0.08)`) work on any dark surface because they adapt to whatever is behind them. This is better than a specific dark hex value, which can look wrong as surfaces change.

---

## Shadows in Dark Mode

Shadows don't disappear in dark mode — they become invisible. Use them sparingly and at higher opacity if you need them:

```css
:root[data-theme="dark"] {
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.5),    /* Much higher opacity than light mode */
               0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.6);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.7);
}
```

**Practically:** Use borders for cards in dark mode. Reserve shadows for modals, dropdowns, and command palettes.

---

## Semantic Colors in Dark Mode

Saturated semantic colors (green, red, amber, blue) used directly from light mode look harsh on dark backgrounds. Desaturate and lighten them:

```css
:root {
  /* Light mode */
  --color-success: #16a34a;  /* green-600 */
  --color-error:   #dc2626;  /* red-600 */
  --color-warning: #d97706;  /* amber-600 */
  --color-info:    #2563eb;  /* blue-600 */
}

:root[data-theme="dark"] {
  /* Dark mode: lighter, less saturated */
  --color-success: #4ade80;  /* green-400 */
  --color-error:   #f87171;  /* red-400 */
  --color-warning: #fbbf24;  /* amber-400 */
  --color-info:    #60a5fa;  /* blue-400 */
}
```

**Background tints for badges and banners in dark mode:**
```css
:root[data-theme="dark"] {
  --bg-success: rgba(74, 222, 128, 0.12);   /* green-400 at 12% */
  --bg-error:   rgba(248, 113, 113, 0.12);  /* red-400 at 12% */
  --bg-warning: rgba(251, 191, 36, 0.12);   /* amber-400 at 12% */
}
```

---

## Dark Mode Implementation (CSS)

### Method 1: CSS class on root
```css
:root { /* light mode tokens */ }
:root.dark { /* dark mode overrides */ }
/* Toggle via JS: document.documentElement.classList.toggle('dark') */
```

### Method 2: prefers-color-scheme (system preference)
```css
@media (prefers-color-scheme: dark) {
  :root { /* dark mode tokens */ }
}
```

### Method 3: CSS custom properties layered (cleanest)
```css
/* Define all tokens, then override in dark */
:root {
  --bg-surface: #ffffff;
  --text-primary: #111827;
  --border-default: #e5e7eb;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-surface: #1e293b;
    --text-primary: #f1f5f9;
    --border-default: rgba(255,255,255,0.08);
  }
}
```

### Tailwind Dark Mode
```html
<!-- With Tailwind's class strategy: -->
<div class="bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100">
  <p class="text-gray-600 dark:text-slate-400">Secondary text</p>
  <div class="border border-gray-200 dark:border-white/10">Card border</div>
</div>
```

---

## What Makes Dark Mode Look "AI-Generated" (Avoid These)

The "default AI dark mode" aesthetic — dark background + neon accent + glassmorphism cards + gradient orbs — has become so ubiquitous it reads as a template, not a design.

| Pattern | Why it reads as generic | Alternative |
|---|---|---|
| Dark background + bright purple/cyan neon accent | Every AI-generated dark UI does this | Use a desaturated, lower-chroma accent. Or go monochrome. |
| Glassmorphism (backdrop-blur cards) | Overused from 2021–2024 | Use opaque surfaces with subtle borders |
| Gradient orbs / blobs in background | Visual noise with no hierarchy function | Clean flat surfaces; gradients only in branded hero sections |
| Rainbow-colored text | Unreadable, unfocused | One accent color, used sparingly |
| Pure black (`#000`) background | Harsh; OLED burn-in concern | Near-black: `#111`, `#0f172a`, `#111827` |
| All interactive elements the same accent color | No hierarchy | Reserve accent for 1 primary action |

---

## Dark Mode Anti-Patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Pure white text (`#FFF`) on dark | Too harsh, strains eyes | Use `#f1f5f9` or `#e2e8f0` |
| Single flat dark background | No depth, layout has no structure | Minimum 3 surface levels |
| Same saturated semantic colors from light mode | Harsh against dark, too vibrant | Use 400-level tones, lower saturation |
| Same shadow system from light mode | Shadows invisible on dark | Switch to borders; increase shadow opacity dramatically |
| Good contrast only at default font size | Thin weights fail at 14px on dark | Use 400+ font weight, rely on size for hierarchy |
| Dark mode as an afterthought | Broken states, missing tokens | Build dark mode tokens alongside light mode from day one |