# Design Tokens — Material Design 3 Reference

Source: m3.material.io/foundations/design-tokens

Design tokens are the **single source of truth** for every visual decision in M3. The same token names are used in Figma, Compose, Flutter, and CSS — no translation needed across tools.

---

## Token Hierarchy

```
md.ref.*  ────►  md.sys.*  ────►  md.comp.*
Reference         System            Component

Raw values        Semantic roles    Per-component
(hex, sizes,      (primary,         overrides
font names)        on-surface)       (button-container-color)
```

**Rule:** Style components using `md.sys.*` tokens only. Reference tokens hold raw values with no meaning attached. Component tokens are for single-component overrides only. Theming always happens at the system level.

---

## Color Tokens

M3 generates six tonal palettes from a seed color: primary, secondary, tertiary, error, neutral, neutral-variant. Each palette has 13 tones (0 = black, 100 = white). Color roles map to specific tones per theme.

### Key Color Roles (`md.sys.color.*`)

| Role | Light tone | Dark tone | Use |
|---|---|---|---|
| `primary` | primary40 | primary80 | Key components, interactive |
| `on-primary` | primary100 | primary20 | Content on primary surfaces |
| `primary-container` | primary90 | primary30 | Less prominent primary fills |
| `on-primary-container` | primary10 | primary90 | Content on primary-container |
| `secondary` | secondary40 | secondary80 | Supporting interactive |
| `secondary-container` | secondary90 | secondary30 | Nav active indicator, chips |
| `on-secondary-container` | secondary10 | secondary90 | Content on secondary-container |
| `tertiary` | tertiary40 | tertiary80 | Contrasting accent |
| `error` | error40 | error80 | Error states |
| `on-error` | error100 | error20 | Content on error |
| `surface` | neutral98 | neutral6 | Main background |
| `surface-variant` | neutral-variant90 | neutral-variant30 | Alternative surface |
| `surface-container` | neutral94 | neutral12 | Cards, drawers |
| `surface-container-high` | neutral92 | neutral17 | Higher-emphasis containers |
| `surface-container-highest` | neutral90 | neutral22 | Highest-emphasis containers |
| `on-surface` | neutral10 | neutral90 | Primary text / icons on surface |
| `on-surface-variant` | neutral-variant30 | neutral-variant80 | Secondary text / icons |
| `outline` | neutral-variant50 | neutral-variant60 | Borders, dividers, text field outlines |
| `outline-variant` | neutral-variant80 | neutral-variant30 | Subtle borders |
| `inverse-surface` | neutral20 | neutral90 | Snackbar background |
| `inverse-on-surface` | neutral95 | neutral20 | Snackbar text |
| `inverse-primary` | primary80 | primary40 | Snackbar action text |
| `scrim` | neutral0 | neutral0 | Modal overlays (always black) |

### CSS Custom Properties
```css
:root {
  --md-sys-color-primary: #6750A4;
  --md-sys-color-on-primary: #FFFFFF;
  --md-sys-color-primary-container: #EADDFF;
  --md-sys-color-on-primary-container: #21005D;
  --md-sys-color-secondary: #625B71;
  --md-sys-color-surface: #FEF7FF;
  --md-sys-color-on-surface: #1D1B20;
  --md-sys-color-surface-container: #F3EDF7;
  --md-sys-color-outline: #79747E;
}
```

### Compose / Kotlin
```kotlin
MaterialTheme.colorScheme.primary
MaterialTheme.colorScheme.onSurface
MaterialTheme.colorScheme.surfaceContainer
MaterialTheme.colorScheme.secondaryContainer
```

### Dark Mode
Dark mode inverts tone values automatically. Light: low-numbered tones for dark content on light backgrounds. Dark: high-numbered tones for light content on dark backgrounds. This is **automatic** when using semantic roles — never build dark mode by inverting light mode colors manually.

---

## Typography Tokens (`md.sys.typescale.*`)

M3 defines 15 type roles (+ 15 emphasized variants in M3 Expressive). Each role specifies font, size, weight, line height, and tracking.

| Role | Size | Weight | Line height | Use |
|---|---|---|---|---|
| `display-large` | 57sp | 400 | 64sp | Hero, landing |
| `display-medium` | 45sp | 400 | 52sp | Prominent header |
| `display-small` | 36sp | 400 | 44sp | Sub-hero |
| `headline-large` | 32sp | 400 | 40sp | Screen title (large) |
| `headline-medium` | 28sp | 400 | 36sp | Screen title (medium) |
| `headline-small` | 24sp | 400 | 32sp | Card headers |
| `title-large` | 22sp | 400 | 28sp | App bar title |
| `title-medium` | 16sp | 500 | 24sp | Section labels |
| `title-small` | 14sp | 500 | 20sp | Sub-section labels |
| `body-large` | 16sp | 400 | 24sp | Primary body text |
| `body-medium` | 14sp | 400 | 20sp | Secondary body text |
| `body-small` | 12sp | 400 | 16sp | Captions |
| `label-large` | 14sp | 500 | 20sp | Button labels, prominent |
| `label-medium` | 12sp | 500 | 16sp | Navigation labels, tabs |
| `label-small` | 11sp | 500 | 16sp | Overlines, smallest labels |

**M3 Expressive emphasized styles (2025):** Higher-weight versions added for bold, selected, and emphasis contexts. Use alongside baseline styles — not as replacements. Applied to active states, selected items, and key UI elements that need stronger visual weight.

**Always sentence case.** Never ALL CAPS for UI labels or button text.

```kotlin
Text("Body text", style = MaterialTheme.typography.bodyLarge)
Text("Section", style = MaterialTheme.typography.titleMedium)
Text("Button", style = MaterialTheme.typography.labelLarge)
```

---

## Shape Tokens (`md.sys.shape.corner.*`)

Shape is a primary brand expression tool in M3. Corner radius communicates personality: more rounded = more expressive; less rounded = more structured.

| Token | Value | Used on |
|---|---|---|
| `corner.none` | 0dp | Full-bleed elements, dividers |
| `corner.extra-small` | 4dp | Menus, tooltips, snackbars |
| `corner.small` | 8dp | Chips, text fields, small cards |
| `corner.medium` | 12dp | Cards, dialogs |
| `corner.large` | 16dp | Navigation drawers, large containers |
| `corner.extra-large` | 28dp | Extended FAB, large modal elements |
| `corner.full` | 50% (pill) | Buttons, badges, FAB, toggles |

```kotlin
MaterialTheme.shapes.extraSmall  // 4dp
MaterialTheme.shapes.small       // 8dp
MaterialTheme.shapes.medium      // 12dp
MaterialTheme.shapes.large       // 16dp
MaterialTheme.shapes.extraLarge  // 28dp
```

```css
--md-sys-shape-corner-extra-small: 4px;
--md-sys-shape-corner-small: 8px;
--md-sys-shape-corner-medium: 12px;
--md-sys-shape-corner-large: 16px;
--md-sys-shape-corner-extra-large: 28px;
```

---

## Spacing Tokens (`md.sys.measurement.space*`)

Base unit: **8dp** (`space100`). All recommended spacing is built from multiples of 4dp.

| Token | Value | Common use |
|---|---|---|
| `space025` | 2dp | Icon internal padding |
| `space050` | 4dp | Tight gaps between related elements |
| `space100` | 8dp | Default unit — between related items |
| `space150` | 12dp | Component internal padding (small) |
| `space200` | 16dp | Standard screen margins, component padding |
| `space300` | 24dp | Section spacing, medium margins |
| `space400` | 32dp | Large section separation |
| `space600` | 48dp | Hero spacing, very large gaps |

**Layout margins by breakpoint:**  
- Compact: 16dp horizontal margin  
- Medium: 24dp horizontal margin  
- Expanded: 24dp+ horizontal margin  

**Non-multiple values in component specs:** 2dp, 4dp, 6dp, 10dp appear in specific components. Always check the per-component spec — don't estimate.