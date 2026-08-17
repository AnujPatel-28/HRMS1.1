# Accessibility — Material Design 3 Reference

Source: m3.material.io/foundations/designing/elements  
         m3.material.io/foundations/overview/principles

Accessibility is built into M3's token system — semantic color roles guarantee "On-" pairs that meet contrast requirements by design. This is the foundation. The rest is implementation discipline.

---

## Touch Targets

**Minimum:** 48×48dp for every interactive element, regardless of visual size.

This is non-negotiable. A 24dp icon button must have a 48×48dp invisible touch area surrounding it.

```kotlin
// Compose — expand touch target:
IconButton(
    onClick = {},
    modifier = Modifier.size(48.dp) // Already default in M3 IconButton
) {
    Icon(Icons.Default.Close, contentDescription = "Close")
}

// For custom elements without a built-in touch target:
Box(
    modifier = Modifier
        .size(48.dp)              // Full touch target
        .clickable { onClick() },
    contentAlignment = Alignment.Center
) {
    Icon(
        imageVector = Icons.Default.Star,
        contentDescription = "Favourite",
        modifier = Modifier.size(24.dp) // Visual size only
    )
}
```

**Spacing between targets:** Minimum 8dp gap between adjacent touch targets.

---

## Color Contrast

M3's semantic "On-" color roles are designed to meet WCAG 2.1 AA contrast by default. Using them correctly means most contrast requirements are satisfied automatically.

### Minimum Contrast Ratios (WCAG 2.1 AA)

| Content type | Minimum ratio |
|---|---|
| Body text, labels | **4.5:1** |
| Large text (18sp+ regular, 14sp+ bold) | **3:1** |
| UI components, icons, borders | **3:1** |

### M3 "On-" Pairs (always use together)

| Surface | Content | Contrast guaranteed |
|---|---|---|
| `primary` | `on-primary` | ✅ Yes |
| `primary-container` | `on-primary-container` | ✅ Yes |
| `secondary-container` | `on-secondary-container` | ✅ Yes |
| `surface` | `on-surface` | ✅ Yes |
| `surface-variant` | `on-surface-variant` | ✅ Yes (3:1 min — check for body text) |
| `error` | `on-error` | ✅ Yes |
| `inverse-surface` | `inverse-on-surface` | ✅ Yes (used in snackbars) |

**Critical:** `on-surface-variant` meets 3:1 only — do not use it for body text (requires 4.5:1). Use `on-surface` for primary body text.

### Color Alone Is Never Enough

Never use color as the **only** differentiator. Always pair color with:
- Shape (error input field: red border + error icon)
- Text (error state: red text label with error message)
- Icon (success: green + checkmark icon)

8% of males have color vision deficiency. If removing color from your design makes it ambiguous, it fails accessibility.

---

## Accessibility Labels

Every interactive element needs a meaningful label for screen readers (TalkBack on Android, VoiceOver on iOS, screen readers on web).

### Rules

1. **Describe the purpose**, not the appearance
   - ✅ "Delete message" not "Trash icon" or "Red button"
2. **Don't include the component type** — screen readers say it automatically
   - ✅ "Send" not "Send button" (TalkBack will say "Send, button")
3. **Be concise** — 2–5 words ideal
4. **Use active language** — "Add to cart" not "Shopping cart addition"
5. **For icons with visible labels:** `contentDescription = null` (the Text composable handles it)
6. **For icons without visible labels:** Always provide `contentDescription`

```kotlin
// Icon button — must have contentDescription
IconButton(onClick = { share() }) {
    Icon(Icons.Default.Share, contentDescription = "Share article")
}

// Icon inside a labeled button — contentDescription = null
Button(onClick = { save() }) {
    Icon(Icons.Default.Save, contentDescription = null) // Text label below handles it
    Text("Save")
}

// Decorative image — no description needed
Image(painter = ..., contentDescription = null)

// Informative image — needs description
Image(painter = ..., contentDescription = "Profile photo of Maya Johnson")
```

### ARIA Roles (Web)

```html
<!-- Web: use semantic HTML first -->
<button>Save</button>        <!-- Implicit role="button" -->
<a href="/home">Home</a>     <!-- Implicit role="link" -->

<!-- For custom interactive elements, add role explicitly -->
<div role="button" tabindex="0" aria-label="Close dialog"
     onclick="close()" onkeydown="if(event.key==='Enter') close()">
  ×
</div>

<!-- ARIA labels for icon-only buttons -->
<button aria-label="Delete message">
  <svg>...</svg>
</button>

<!-- Status regions for dynamic content -->
<div role="status" aria-live="polite">Message sent</div>  <!-- Snackbar -->
<div role="alert" aria-live="assertive">Error: invalid email</div>  <!-- Errors -->
```

**ARIA roles for common M3 patterns:**
- Navigation bar: `<nav>` with `aria-label="Main"`
- Dialog: `role="dialog"` + `aria-modal="true"` + `aria-labelledby` pointing to title
- Snackbar: `role="status"` + `aria-live="polite"` (not "assertive" unless critical)
- Filter chips: `role="checkbox"` when toggleable; `aria-checked` for state
- Menu: `role="menu"` + `role="menuitem"` per item + `aria-haspopup` on trigger

---

## Keyboard Navigation

Every action available by touch must be reachable by keyboard. No exceptions.

### Tab Order
- Follows visual reading order (top-left to bottom-right in LTR)
- Logical, not DOM order — visual position drives expectation
- Focus trap inside dialogs: Tab cycles only within the dialog until dismissed

### Required Key Behaviors

| Component | Key | Action |
|---|---|---|
| Button, link | Enter / Space | Activate |
| Checkbox | Space | Toggle |
| Radio button | Arrow keys | Select within group |
| Select / Dropdown | Enter / Space | Open; Arrow to navigate; Enter/Escape to close |
| Dialog | Escape | Dismiss (if not destructive) |
| Menu | Escape | Close; Arrow keys to navigate items |
| Navigation items | Arrow keys | Navigate between items; Enter to activate |
| Chips (filter) | Space | Toggle selection |
| Slider | Arrow keys | Increment/decrement |
| Modal | Tab cycles inside | Focus must not escape |

### Focus Indicators

All interactive elements must have a **visible focus ring** when focused via keyboard.

M3 focus ring spec:
- Color: `md.sys.color.secondary` (on light) / `md.sys.color.secondary` (on dark)  
- Width: 3dp
- Offset from element: 3dp gap between element boundary and ring

**Never suppress focus indicators.** `outline: none` in CSS without providing a custom replacement is an accessibility failure.

```css
/* Web: Never do this */
:focus { outline: none; } /* ❌ Removes focus indicator for keyboard users */

/* Do this instead */
:focus-visible {
  outline: 3px solid var(--md-sys-color-secondary);
  outline-offset: 3px;
  border-radius: 4px;
}
:focus:not(:focus-visible) {
  outline: none; /* Removes ring on mouse click only */
}
```

---

## Screen Reader Behavior

### Reading Order (Compose)
```kotlin
// Merge child elements into a single readable unit
Column(modifier = Modifier.semantics(mergeDescendants = true) {}) {
    Text("Maya Johnson")
    Text("Software Engineer")
}
// TalkBack reads: "Maya Johnson, Software Engineer"

// Custom reading order when visual layout doesn't match logical order
Row {
    Text("Price:", modifier = Modifier.semantics { traversalIndex = 1f })
    Text("$29.99", modifier = Modifier.semantics { traversalIndex = 0f })
}
```

### Live Regions (Dynamic Content)
```kotlin
// Announce content changes to screen reader
Text(
    text = snackbarMessage,
    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }
)

// For urgent alerts (errors):
Text(
    text = errorMessage,
    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive }
)
```

### State Announcements
```kotlin
// Custom toggle — announce state change
Box(modifier = Modifier.semantics {
    role = Role.Switch
    stateDescription = if (isOn) "On" else "Off"
    contentDescription = "Notifications"
    toggleableState = ToggleableState(isOn)
})
```

---

## Text Accessibility

- All text must support **system font size scaling**. Never use `sp` values that don't scale, or hardcode layout heights that would clip scaled text.
- Minimum 14sp for any text users need to read comfortably
- Minimum 16sp for body content
- Never use light font weights (100–300) at small sizes — contrast suffers
- Line length: 40–60 characters ideal. Longer lines reduce readability

```kotlin
// Correct: uses sp (scales with system font settings)
Text("Hello", style = MaterialTheme.typography.bodyLarge) // 16sp, scales

// Problematic: fixed dp height clips scaled text
Box(Modifier.height(48.dp)) { Text("This may clip if user increases font size") }
// Fix: use wrapContentHeight() or IntrinsicSize
```

---

## Accessibility Audit Checklist

Run before shipping any screen:

- [ ] Every icon button has a meaningful `contentDescription`
- [ ] Decorative images have `contentDescription = null`
- [ ] All text meets 4.5:1 contrast (body) or 3:1 (large text)
- [ ] No information conveyed by color alone
- [ ] All touch targets ≥ 48×48dp
- [ ] Focus ring visible on all interactive elements (keyboard test)
- [ ] Tab order matches visual reading order
- [ ] Dialog traps focus (Tab cannot escape to background)
- [ ] Dialogs have `aria-labelledby` / `semantics { contentDescription }` pointing to title
- [ ] Dynamic content regions announce via `LiveRegionMode.Polite` (or Assertive for errors)
- [ ] Custom interactive components declare `role` and `stateDescription`
- [ ] Text scales correctly with system large font settings (test at 200% font size)
- [ ] `prefers-reduced-motion` reduces/eliminates animations
- [ ] High-contrast mode tested (borders/separators remain visible)
- [ ] All navigation destinations reachable via keyboard alone