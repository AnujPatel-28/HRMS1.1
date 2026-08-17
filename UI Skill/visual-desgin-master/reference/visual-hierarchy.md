# Visual Hierarchy, Icons & White Space — Visual Design Master Reference

Sources: Refactoring UI · Practical UI · Laws of UX · Every Layout

---

## Visual Hierarchy: The Core Framework

Every element on screen has one of four roles. The design fails if it's unclear which role an element has.

| Role | Treatment | Frequency |
|---|---|---|
| **Primary** | Largest, heaviest, darkest, most contrast | 1 per screen / section |
| **Secondary** | Medium size, medium weight, standard color | 2–5 per section |
| **Supporting** | Smaller, lighter weight, muted color | Many |
| **Background** | Lightest, lowest contrast, no weight | Structural only |

**The #1 hierarchy mistake:** making secondary elements compete with primary ones. If everything is bold, nothing is bold.

### The Two-Way Hierarchy Lever

De-emphasizing is as powerful as emphasizing. When you need to make something stand out, first try making everything else stand out less:

- Reduce font weight of surrounding text
- Lighten surrounding text color (gray-500 instead of gray-900)
- Reduce surrounding icon sizes
- Give the surrounding elements less padding

> "If you want something to stand out, try de-emphasizing everything else first." — Refactoring UI

### Separating Visual Hierarchy from Document Hierarchy

In documents: h1 > h2 > h3 by visual size. In apps: the document title might use `text-sm font-medium text-gray-500` because the content it labels is what matters, not the title itself.

Section titles like "Account Settings", "Filters", "Recent Activity" often look better smaller and muted — acting as labels — while the interactive content beneath gets all the visual emphasis.

---

## The Five Visual Hierarchy Tools

### 1. Size
Biggest element = most important. But: don't overdo size differences. 2–3 scale steps of difference is usually enough. 5 scale steps looks cartoonish.

### 2. Weight
Bold text reads as more important than regular weight at the same size. Reserve bold for truly important text. Semibold (600) is usually enough for hierarchy without feeling shouted.

### 3. Color / Contrast
High contrast (dark text on white) = primary. Low contrast (gray text on white) = supporting. The contrast difference communicates importance.

**For icons:** When an icon sits next to text, it often looks too emphasized because it has solid fill. Reduce the icon's color to a muted grey to de-emphasize it and let the text take priority.

### 4. Spacing / Position
Upper-left position gets seen first (F-pattern scanning). Center gets seen in Z-pattern (marketing pages). The most important action should live where the eye naturally lands first.

### 5. Visual Weight (non-text)
Solid shapes feel heavier than outlines. Dark colors feel heavier than light. Large elements feel heavier. Balance visual weight across the composition.

---

## Icons

### Icon Size Scale

```css
:root {
  --icon-xs:  12px;  /* Inline with xs text, compact badges */
  --icon-sm:  14px;  /* Alongside sm text */
  --icon-md:  16px;  /* Standard — alongside base/sm text */
  --icon-lg:  20px;  /* Section headers, nav items */
  --icon-xl:  24px;  /* Feature highlights, empty states */
  --icon-2xl: 32px;  /* Card decorations, illustrations */
  --icon-3xl: 48px;  /* Empty state illustrations */
}
```

### Icon + Text Alignment

Icons must be visually centered with their adjacent text — not mathematically centered with the line box.

```css
.icon-text {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* Icon should match the cap height of the text, not the full line-height */
```

**Common mistake:** Using `align-items: center` with multiline text — the icon centers on the full text block rather than the first line. For multiline text, use `align-items: flex-start`.

### Choosing Icon Style

| Icon style | Use | Examples |
|---|---|---|
| Outline | Default, unselected, inactive states | Navigation items (unselected), list icons |
| Filled/solid | Selected, active, important states | Navigation items (selected), CTA buttons |
| Duotone | Feature highlights, empty states | Two-color icons for decorative purposes |
| Color | Status indicators, semantic meaning | Success checkmark (green), error triangle (red) |

**Rule:** Use the **outline** variant as default; switch to **filled** to indicate selection or active state. This creates a natural selected/unselected toggle.

### Icon Libraries (Production-Ready)

| Library | Style | Use case | License |
|---|---|---|---|
| **Lucide** | Outline, consistent stroke | SaaS, developer tools | MIT Free |
| **Heroicons** | Outline + solid pairs | Tailwind apps, clean products | MIT Free |
| **Phosphor** | 6 weights, very consistent | Versatile, any product type | MIT Free |
| **Radix Icons** | Very compact, precise | Dense UI, developer tools | MIT Free |
| **Tabler** | 4,000+ icons, consistent | Large products needing variety | MIT Free |
| **Feather** | Minimal, clean lines | Products needing minimal style | MIT Free |

**Rule:** Pick one icon library and use it everywhere. Never mix two libraries in the same UI — weight and stroke differences create visual discord.

### Icon Color

- Match icon color to adjacent text color by default
- **De-emphasize:** Set icon to `text-gray-400` when it's decorative beside emphasized text
- **Semantic:** Use `text-green-500`, `text-red-500` etc. only when the icon itself carries semantic meaning (status, alert)
- Never use multiple icon colors decoratively — semantic color should always have semantic meaning

---

## White Space Strategy

White space is not decoration — it is hierarchy encoded in space.

### The Proximity Principle (Gestalt)

Elements close together are perceived as related. Elements far apart are perceived as separate. Design your spacing to reflect your content structure — before reaching for headers, dividers, or borders.

```
Card title         ← 4px gap ← tight grouping signals "belongs together"
Card subtitle
                   ← 24px gap ← wide gap signals "different section"
Card body text
Card body text
```

### White Space as a Tier System

Set three tiers of white space for a consistent rhythm:

```
Micro (within components):    4–8px   (icon ↔ label, tag ↔ tag)
Component (internal padding): 12–16px (card padding, button padding)
Section (between components): 24–32px (card ↔ card, section ↔ next section)
Page (major breaks):          48–64px (hero ↔ content, footer ↔ last section)
```

### "More whitespace than feels comfortable"

A consistent principle from both Practical UI and Refactoring UI: **when starting a design, add more whitespace than feels right, then tighten**. The mistake of too little whitespace is far more common than too much.

Signs your UI has too little whitespace:
- Content feels cramped near container edges
- Different sections blur into each other
- The page feels dense and heavy to look at
- Users feel anxiety ("where do I start?")

Signs your UI has the right whitespace:
- Each section of the page feels like it has its own space
- Content has room to "breathe"
- The hierarchy is clear from the spacing alone, without labels

### White Space in Dark Mode

In dark mode, shadows are less visible and borders are harder to see. **White space must do more structural work.** Increase spacing between sections by 25–50% when transitioning from light to dark — the absence of white paper means the eye needs more space to separate regions.

---

## Visual Hierarchy Anti-Patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| All body text the same size and weight | No hierarchy — wall of text | Apply the 4-role hierarchy system |
| Primary action same weight as secondary | User can't find the call to action | Primary CTA: filled + high contrast. Secondary: outlined or text |
| Icon same color as accompanying text | Icon competes with text | Set icon to muted color (`gray-400`) when decorative |
| Mixed icon libraries | Visual discord, inconsistent stroke weight | One library, everywhere |
| Section titles as large as content headings | No document hierarchy | Section labels: small, muted; content headings: large, dark |
| Equal space between all elements | Structure invisible | Proximity must reflect relationships |