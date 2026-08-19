---
name: material-design-3
description: >
  Material Design 3 (M3 / Material You) — Google's official design system. The authoritative reference for component behavior, accessibility, design tokens, elevation, motion, adaptive layout, and interaction states. Use this skill whenever you're designing or building any Android, Flutter, or web UI with Material Design 3. Trigger on: "Material Design", "Material You", "M3", "Jetpack Compose", "Flutter Material", "Material Web", "md.sys.color", "dynamic color", "navigation rail", "navigation bar", "FAB", "snackbar", "dialog", "chip", "menu", "bottom sheet", "top app bar", "state layer", "elevation level", "window size class", "canonical layout", "compact / medium / expanded", "color role", "tonal palette", "on-surface", "surface container", or any question about how an M3 component should behave. Also trigger for "does this follow Material?", "which navigation pattern for tablet?", "what token should I use?", or any design system review on Android / Flutter / web. Updated for M3 Expressive (Google I/O 2025).
---

# Material Design 3 (Material You)

**Source:** m3.material.io  
**Current version:** M3 + Expressive (2025)  
**Platforms:** Android (Jetpack Compose / Views), Flutter, Web (Material Web Components)

M3 is Google's design system for building personal, adaptive, and expressive products. Every decision flows from three goals: **personalization** (dynamic color from user wallpaper), **adaptability** (scales from phone to large monitor), and **expressiveness** (physics-based motion, shape, and typography that communicate personality).

---

## Three Foundational Concepts

**1. Dynamic Color**  
M3 generates a full color scheme from a seed color (or the user's wallpaper on Android 12+). This produces six tonal palettes and 30+ color roles automatically. Never hardcode hex values — always reference semantic color roles: `colorScheme.primary`, `--md-sys-color-primary`.

**2. Design Token Hierarchy (Reference → System → Component)**  
- **Reference** (`md.ref.*`) — Raw values: hex colors, font names, pixel sizes
- **System** (`md.sys.*`) — Semantic roles consumed by all components: `primary`, `on-surface`, `surface-container`
- **Component** (`md.comp.*`) — Per-component overrides: `filled-button-container-color`  
Never apply reference tokens directly to component styling. Route through system tokens.

**3. Window Size Classes → Adaptive Navigation**  
M3 replaces fixed breakpoints with 5 window size classes. The navigation component is the primary element that changes at each class. Architecture decision — make it on day one.

---

## Quick Reference: What to Load

| You need guidance on... | Load |
|---|---|
| Color roles, typography scale, shape, spacing tokens | `references/tokens.md` |
| Elevation levels, state layers (hover/pressed/focused/disabled) | `references/elevation-states.md` |
| Buttons, chips, FABs, dialogs, snackbars, menus, navigation | `references/components.md` |
| Motion: easing, duration, springs, transitions | `references/motion.md` |
| Window size classes, canonical layouts, responsive navigation | `references/adaptive-layout.md` |
| Touch targets, contrast, labels, keyboard, ARIA | `references/accessibility.md` |

Load all relevant files for complex tasks. Wrong patterns are expensive to fix later.

---

## M3 Anti-Pattern Checklist

- [ ] Hardcoded hex colors instead of semantic color roles
- [ ] Using `md.ref.*` tokens directly in component styling
- [ ] Touch targets smaller than 48×48dp
- [ ] Text contrast below 4.5:1 (body) or 3:1 (large text / icons)
- [ ] Navigation bar used on tablets or expanded screens
- [ ] Navigation rail used on compact phones
- [ ] FAB placed below navigation destinations in the rail
- [ ] Stacking multiple snackbars (queue them instead)
- [ ] Snackbar covering the FAB (should appear above it)
- [ ] Disabled components with state layer opacity on wrong layer
- [ ] Dialog with more than 2 action buttons
- [ ] Tonal button used as the sole action (it's secondary)
- [ ] Missing state layers on custom interactive components
- [ ] Color as the only differentiator (no shape / text / icon backup)
- [ ] Animations that ignore `prefers-reduced-motion`

---

## Official Source
m3.material.io — Design · Styles · Components · Tokens · Motion · Foundations