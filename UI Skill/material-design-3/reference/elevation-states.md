# Elevation & States — Material Design 3 Reference

Source: m3.material.io/styles/elevation  
         m3.material.io/foundations/interaction/states

---

## Elevation

M3 elevation is expressed via **tonal color overlays**, not just drop shadows. Higher elevation = more primary color tint blended into the surface. This works especially well in dark mode, where shadows are invisible — tonal overlays carry all the hierarchy signal.

### The Five Elevation Levels

| Level | Shadow (dp) | Primary tint overlay | Default component examples |
|---|---|---|---|
| **Level 0** | 0dp | 0% | Cards at rest, surfaces, backgrounds |
| **Level 1** | 1dp | 5% | Surface variants, nav drawer resting |
| **Level 2** | 3dp | 8% | Filled cards on hover, top app bar on scroll |
| **Level 3** | 6dp | 11% | FAB at rest, dialogs |
| **Level 4** | 8dp | 12% | FAB on hover |
| **Level 5** | 12dp | 14% | Modal bottom sheets, open navigation drawer |

### Component Default Elevations

| Component | Resting | On hover | Notes |
|---|---|---|---|
| FAB | Level 3 | Level 4 | Returns to Level 3 on press |
| Dialog | Level 3 | — | Always Level 3 |
| Top app bar | Level 0 | — | Becomes Level 2 when scrolled |
| Modal sheet | Level 1 | — | Level 5 for full-screen modal |
| Filled button | Level 0 | Level 1 | |
| Elevated card | Level 1 | Level 2 | |
| Filled card | Level 0 | Level 2 | |

**Rule:** Don't change a component's default resting elevation without a strong reason. Changing elevation changes the implied importance of an element.

### Compose
```kotlin
// Tonal elevation (adds primary color tint automatically)
Surface(tonalElevation = 6.dp) { /* FAB-level content */ }
Card(elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)) { }

// Animating elevation on hover/press:
val elevation by animateDpAsState(
    targetValue = if (isHovered) 8.dp else 6.dp
)
```

### CSS (Material Web)
```css
.fab { --md-elevation-level: 3; }
.fab:hover { --md-elevation-level: 4; }
/* Animate between levels: */
.fab {
  transition-duration: 250ms;
  transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
}
```

---

## States

States are visual overlays (state layers) that communicate the interactive status of a component. The **state layer color** always matches the component's content color. Only **opacity** changes per state.

### State Layer Opacity Values

| State | Opacity | Notes |
|---|---|---|
| **Hover** | 8% | Desktop/web cursor hover only |
| **Focus** | 10% | Keyboard focus + visible focus ring |
| **Pressed** | 10% | Touch/click + ripple animation |
| **Dragged** | 16% | Drag-to-reorder + elevation increase |
| **Disabled content** | 38% `on-surface` | Text, icons on disabled component |
| **Disabled container** | 12% `on-surface` | Background of disabled component |

**One state layer at a time.** If focused then hovered, hover shows until cursor leaves, then focus indicator returns. Priority: `Dragged > Pressed > Focused > Hovered > Enabled > Disabled`.

### Hover

Triggered by cursor pausing over an interactive element. Desktop and web only — mobile users never see it, so never make hover the primary affordance.

- Applies an 8% content-color overlay to the component surface
- Some components also gain +1 elevation level (FAB, cards)

### Focus

Triggered by keyboard navigation (Tab, arrow keys) or programmatic `requestFocus()`.

- 10% content-color state layer
- **Visible focus ring required** — 3dp ring in `md.sys.color.secondary`, 3dp offset from component

```kotlin
// Compose — focus ring is automatic on all standard M3 components.
// For custom focusable elements:
Box(
    modifier = Modifier
        .focusable()
        .onFocusChanged { if (it.isFocused) showCustomFocusRing = true }
)
```

```css
/* Web — never suppress without replacement */
:focus-visible {
  outline: 3px solid var(--md-sys-color-secondary);
  outline-offset: 3px;
  border-radius: 4px;
}
```

### Pressed (Ripple)

Triggered by touch, mouse click, or Enter/Space keypress.

- 10% content-color state layer
- **Ripple animation** emanates from the point of contact, expanding to fill the component boundary
- Duration: ~200ms expand; instant removal on lift

```kotlin
// Ripple is built into all M3 components automatically.
// Custom components:
Box(
    modifier = Modifier.clickable(
        interactionSource = remember { MutableInteractionSource() },
        indication = rememberRipple()
    ) { onClick() }
)
```

### Disabled

A disabled component cannot be interacted with in any way — no hover, focus, press, or drag.

- Container: `on-surface` at **12% opacity**
- Content (text, icon): `on-surface` at **38% opacity**
- No state layer ever applied

```kotlin
Button(enabled = false, onClick = {}) { Text("Submit") }
// All M3 components handle disabled styling automatically.
// Never manually apply opacity to a component to simulate disabled state.
```

**Don't hide disabled elements** — keep them visible so users understand what actions exist. Exception: elements that only appear conditionally and haven't been triggered yet.

### Dragged

Applied while an element is being actively repositioned by the user.

- 16% content-color state layer
- Elevation increases to Level 4 (for surfaces that support drag)
- Item appears to lift off the surface

```kotlin
// framer-motion style in Compose — LazyColumn reordering:
items(items, key = { it.id }) { item ->
    ReorderableItem(state, key = item.id) { isDragging ->
        val elevation by animateDpAsState(if (isDragging) 8.dp else 0.dp)
        Surface(shadowElevation = elevation) { ItemContent(item) }
    }
}
```

### Selected / Activated

For navigation items, checkboxes, chips, radio buttons. Not a state layer — a distinct visual treatment.

- Navigation items: active indicator pill in `secondary-container`, filled icon
- Checkboxes / radio: filled with `primary`
- Filter chips: background fills with `secondary-container`, checkmark icon appears

Selected states can combine with hover, focus, or pressed — but only one state-layer state at a time, shown over the selected visual.

---

## Custom Component State Checklist

When building a non-standard interactive element, implement all of these:

- [ ] Hover: 8% `on-[container]` overlay (desktop only)
- [ ] Focus: 10% overlay + visible 3dp focus ring in `secondary`, 3dp offset
- [ ] Pressed: 10% overlay + ripple from point of contact
- [ ] Disabled: container 12% `on-surface`, content 38% `on-surface`, no interactions
- [ ] Dragged (if applicable): 16% overlay + Level 4 elevation
- [ ] Touch target: 48×48dp minimum
- [ ] Only one state layer visible at a time
- [ ] Disabled cannot receive hover, focus, press, or drag