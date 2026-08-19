# Spacing & Layout — Visual Design Master Reference

Sources: Refactoring UI · Practical UI · Every Layout · industry practice

Spacing is invisible infrastructure. Users can't name it, but they feel it. Arbitrary spacing (15px here, 23px there) registers subconsciously as "cheap" even when colors and typography are perfect. A consistent rhythm built from a scale is what separates "polished" from "template".

---

## The Spacing Scale

### Base 4px Scale (full range)
Use only values from this list. No in-between values.

```css
:root {
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-7:  28px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
}
```

**Tailwind:** `p-1`(4px) `p-2`(8px) `p-3`(12px) `p-4`(16px) `p-5`(20px) `p-6`(24px) `p-8`(32px) `p-10`(40px) `p-12`(48px) `p-16`(64px)

### Condensed Scale (data-dense UIs)
For dashboards, tables, admin tools where density matters:
```
2, 4, 6, 8, 10, 12, 16, 20, 24, 32px
```

### Looser Scale (marketing, landing pages)
```
8, 16, 24, 32, 48, 64, 96, 128, 192px
```

---

## The Core Spacing Rule

> "Related things should have less space between them than unrelated things."  
> — Refactoring UI

This is **proximity as hierarchy**. It is more important than borders, backgrounds, or any visual decoration for communicating which elements belong together.

**Example:**
```
Section heading
     ↑ 8px (tight — belongs with the content below)
Body text of that section
Body text continues...

     ↑ 32px (wide — signals a new, unrelated section)
Next section heading
```

If a heading has the same space above and below it, the layout doesn't communicate what belongs to what.

---

## Component Internal Padding: By Size

| Component size | Padding |
|---|---|
| Compact (tags, badges, chips) | 2px 8px or 4px 10px |
| Small (buttons sm, inputs sm) | 6px 12px |
| Default (buttons, inputs, cards) | 8–12px 16px |
| Medium (section panels, modals) | 16px 20–24px |
| Large (page sections, hero cards) | 24–32px |
| Extra large (full-width sections) | 48–64px |

---

## Page Margins

| Viewport | Horizontal page margin |
|---|---|
| Mobile (< 640px) | 16px |
| Tablet (640–1024px) | 24–32px |
| Desktop (1024–1280px) | 48px |
| Wide (1280px+) | 64px or centered with max-width |
| Marketing / hero sections | Can expand to full-bleed |

**Max content width:** 1280px centered for application UIs. 768px for prose/editorial. Never let text columns span > 75 characters.

---

## White Space Strategy

White space is not empty space — it is structural. It is how you encode relationships, breathing room, and hierarchy without adding visual elements.

### Start too spacious, then tighten
When designing from scratch: add more whitespace than feels comfortable, then remove what makes the layout feel disconnected. Most designers err toward too little whitespace, not too much.

### Use whitespace to separate, not borders
Before reaching for a divider line or border: increase the space between elements. Whitespace is a cleaner, less noisy separator than a drawn line.

### Dense vs. breathable: match the use case
- **Data-dense tools** (analytics dashboards, admin panels): tighter spacing, more content per viewport. Users are experts who scan quickly.
- **Consumer apps / marketing**: generous whitespace communicates quality and trust. Give content room to breathe.
- **Forms**: more padding per field (at least 12–16px vertical) reduces perceived cognitive load.

---

## The 4px Grid in Practice

Every element lives on a 4px grid: its height, its padding, its margin, its position. The rule is simple: all spatial values are multiples of 4.

**Why it works:**
- Creates consistent visual rhythm the eye recognizes without consciously seeing
- Eliminates the "off by 1" feeling of arbitrary spacing
- Makes developer handoff mechanical — no guessing

**Common multiples in use:**
- 4px — icon padding, tightest inline spacing
- 8px — default gap between related elements
- 12px — compact component padding
- 16px — standard component padding, default gap
- 24px — section internal spacing
- 32px — between sections on a page
- 48px — major section breaks
- 64px — hero/section gap on marketing pages

---

## Layout Grid Systems

### 12-Column Grid (Web standard)
```
Columns: 12
Gutter: 16–24px (16px compact, 24px standard)
Margin: 16–64px (scales with viewport)
```

Common column spans:
- Full width: 12 cols
- Main content: 8 cols + 4 sidebar
- Two columns: 6 + 6
- Three columns: 4 + 4 + 4
- Form + aside: 7 + 5

### Card Grids
```css
/* Responsive card grid — no media queries needed */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}
```

Cards are never stretched to fill an unusually wide column. Set a max width on cards (e.g. `max-width: 380px`).

### Dashboard Sidebar Layouts
```css
/* Classic sidebar + main */
.layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  /* or: 72px (collapsed icon rail) | 240px (expanded) | 1fr */
  gap: 0;
}
```

---

## Alignment

**The rule:** Align to a consistent edge. Don't center when left-aligned would make the grid obvious. Don't use multiple different alignments on the same type of element.

**Left-align as default.** Center only for:
- Single hero statements
- Card headers in a symmetrical 3-column grid where all cards are the same height
- Dialog headings

**Right-align for:**
- Numbers in tables (decimal-aligned)
- Trailing metadata (timestamps, statuses)
- Action buttons in dialog footers

**Never mix left and center alignment in a card grid.**

---

## Spacing Anti-Patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Equal space above and below headings | Ambiguous grouping | Less space below heading than above |
| Cramped form fields (< 8px vertical padding) | Looks dated, hard to tap | Minimum 10–12px vertical padding |
| Same gap between all items regardless of relationship | No visual grouping | More gap between sections than within |
| Padding that doesn't match the scale (e.g., 13px, 17px) | Subconscious "off" feeling | Snap to scale |
| Content at the very edge of a container (0 padding) | Claustrophobic | Minimum 16px from any container edge |
| Negative space filled with decorations | Anxiety-inducing, busy | Let whitespace do the work |