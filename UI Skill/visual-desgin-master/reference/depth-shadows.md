# Depth: Shadows, Borders & Corner Radius — Visual Design Master Reference

Sources: Refactoring UI · Practical UI · Tailwind CSS · industry practice

Depth is how elements communicate their position in the z-axis. A well-designed depth system tells users what is floating, what is resting, and what is in the background — without needing labels.

---

## Shadow System

Use a **5-level shadow scale**. Each level has a specific semantic meaning. Never use shadows randomly.

### The 5-Level System

```css
:root {
  /* Level 0: No elevation — flat surface, part of the page */
  --shadow-none: none;

  /* Level 1: Barely lifted — subtle card separation from page */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.04),
               0 1px 3px rgba(0, 0, 0, 0.06);

  /* Level 2: Soft card — standard cards, panels */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06),
               0 2px 8px rgba(0, 0, 0, 0.08);

  /* Level 3: Floating element — dropdowns, popovers, sticky elements */
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08),
               0 2px 4px rgba(0, 0, 0, 0.04);

  /* Level 4: Modal — dialogs, drawers, sheets */
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12),
               0 4px 8px rgba(0, 0, 0, 0.06);

  /* Level 5: Command palette, critical overlay */
  --shadow-xl: 0 16px 48px rgba(0, 0, 0, 0.15),
               0 8px 16px rgba(0, 0, 0, 0.08);
}
```

### What Each Level Is For

| Level | Opacity / Blur | Use |
|---|---|---|
| `shadow-none` | — | Inline content, no elevation |
| `shadow-xs` | Very subtle | Input focus ring, very flat card |
| `shadow-sm` | Soft, low spread | Default card, panel, sidebar item |
| `shadow-md` | Medium blur | Dropdown menus, popovers, tooltips |
| `shadow-lg` | Deep, wide | Modals, dialogs, command palette |
| `shadow-xl` | Very deep | Full-screen overlays, critical modals |

### The Two-Shadow Technique (Refactoring UI)

Real shadows have two components: a direct shadow (sharp, small, dark) + an ambient shadow (soft, large, lighter). Combining them looks more realistic.

```css
/* Two-shadow pattern */
--shadow-realistic: 
  0 1px 3px rgba(0,0,0,0.12),      /* Direct — close and sharp */
  0 4px 16px rgba(0,0,0,0.08);     /* Ambient — further and soft */
```

### Shadow + Interaction

Shadows communicate state changes elegantly:
```css
.card {
  box-shadow: var(--shadow-sm);
  transition: box-shadow 200ms ease, transform 200ms ease;
}
.card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);  /* Subtle lift */
}
```

### Shadow Rules

- **Use at most 2 shadow levels on any single screen** — having xs, sm, md, lg, and xl all visible simultaneously destroys the hierarchy
- **Shadow opacity below 15%** in light mode — heavier shadows look printed-on, not floating
- **Dark mode:** reduce or eliminate shadows entirely — use borders instead
- **Never use colored shadows** in product UI — they read as gimmicky
- **Don't shadow everything** — a page where every element has a shadow has no hierarchy

---

## Border System

### When to Use Borders vs. Alternatives

| Separation method | When to prefer it |
|---|---|
| Borders | When elements would be ambiguous without a clear visual edge (form inputs, table cells) |
| Shadow | When an element is elevated above the surface (cards, dropdowns) |
| Background color | When grouping related content inside a container |
| Whitespace | When elements are simply adjacent — default to whitespace first |

> "Borders are a great way to distinguish elements, but using too many of them makes your design feel busy and cluttered." — Refactoring UI

### Border Scale

```css
:root {
  --border-width-thin:   1px;  /* Standard — almost always correct */
  --border-width-medium: 1.5px; /* Input focus ring */
  --border-width-thick:  2px;  /* Selected state, active indicator */
  --border-width-heavy:  3px;  /* Focus ring, very strong emphasis */
}
```

**Rule: Never use > 1px borders for structural dividers.** Use 2px only for selected states and focus rings.

### Border Color Scale

```css
:root {
  --border-default:    var(--gray-200);  /* Standard, low-emphasis */
  --border-subtle:     var(--gray-100);  /* Very subtle, barely visible */
  --border-strong:     var(--gray-300);  /* More defined separation */
  --border-focus:      var(--primary-500); /* Input focus */
  --border-error:      var(--red-500);   /* Validation error */
  --border-success:    var(--green-500); /* Validation success */
}
```

### Usage Patterns

**Form inputs:**
```css
.input {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}
.input:hover { border-color: var(--border-strong); }
.input:focus { 
  border-color: var(--border-focus);
  outline: 2px solid var(--primary-200);  /* Outer focus ring */
  outline-offset: 1px;
}
.input.error { border-color: var(--border-error); }
```

**Reducing border clutter:**
- Inside a card: often remove inner element borders; rely on padding to separate
- Table cells: use background on header rows instead of heavy borders
- Don't put a border on a card AND a shadow — pick one

---

## Corner Radius System

Corner radius communicates personality and scale. Small radius = structured, data-dense, professional. Large radius = friendly, consumer, expressive.

### The Scale

```css
:root {
  --radius-none: 0;
  --radius-sm:   4px;   /* Compact controls, tags, badges */
  --radius-md:   8px;   /* Inputs, buttons, small cards */
  --radius-lg:   12px;  /* Cards, panels, section containers */
  --radius-xl:   16px;  /* Modals, large cards */
  --radius-2xl:  20px;  /* Bottom sheets (top corners only) */
  --radius-full: 9999px; /* Pills, toggles, full-round badges */
}
```

### What Radius to Apply Where

| Component | Radius |
|---|---|
| Badge, tag, chip (compact) | 4–6px or `full` (pill) |
| Button (standard) | 6–8px |
| Text input | 6–8px |
| Small card / list item highlight | 8px |
| Card (standard) | 10–12px |
| Panel, section background | 12–16px |
| Modal / dialog | 12–16px |
| Bottom sheet | 20px (top-left, top-right only) |
| Avatar | `full` (circle) |
| Toggle | `full` |
| Full pill button | `full` |

### The Nesting Rule (Critical)

When a rounded container holds rounded children, the **child's radius must be smaller than the parent's radius** by the approximate padding between them.

```
Parent radius = Child radius + Container padding
```

```css
/* Parent card: 12px radius, 16px padding */
.card { border-radius: 12px; padding: 16px; }

/* Child element inside: 12 - 4 = 8px (approximately) */
.card-inner { border-radius: 8px; }
```

**Anti-pattern:** Parent card with `border-radius: 12px` containing an image with `border-radius: 12px` — the image's corner bleeds outside the card's inner curve, creating a "corner mismatch" gap.

### Consistency Rule

**All components of the same type use the same radius.** Don't use 8px buttons in one section and 12px buttons in another. Establish the system once, use it everywhere.

### Radius Personality Guide

| Radius level | Visual personality | Good for |
|---|---|---|
| 0 | Hard, industrial, enterprise | Dense admin tools, financial platforms |
| 2–4px | Professional, structured | Developer tools, data dashboards |
| 6–8px | Modern, neutral | SaaS, productivity, B2B apps |
| 10–14px | Friendly, approachable | Consumer apps, social products |
| 16–20px | Soft, expressive | Health apps, lifestyle, design tools |
| Pill (`full`) | Fun, energetic | Buttons in marketing, badges, social features |

---

## Depth Anti-Patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Every card has the same shadow | No hierarchy | Most should be `shadow-sm`; feature cards `shadow-md` |
| Shadow + border on the same card | Visual noise, confusion | Pick one |
| Dark mode with the same shadow as light mode | Shadow invisible on dark | Use border or background difference instead |
| All corners the same radius regardless of component size | Incoherent system | Small elements (badges): smaller radius; large elements (cards): larger |
| Child corner radius ≥ parent corner radius | "Rounded corner inside rounded corner" gap | Child radius = parent radius − padding |
| 4px border on a divider | Looks like an accented element | 1px for dividers, always |