# Adaptive Layout — Material Design 3 Reference

Source: m3.material.io/foundations/layout  
         m3.material.io/foundations/adaptive-design/canonical-layouts

Adaptive UI is not a polish pass — it is a structural architecture decision made at the beginning of every project. M3's position: **every app must work well at every breakpoint from day one.**

---

## Window Size Classes (Breakpoints)

M3 defines five breakpoints based on available window width. These are **lower bounds** — a device is in a class if its width is ≥ the minimum value.

| Class | Width | Typical device | Columns |
|---|---|---|---|
| **Compact** | 0–599dp | Phone portrait | 4 |
| **Medium** | 600–839dp | Phone landscape, foldable portrait, small tablet | 12 |
| **Expanded** | 840–1199dp | Tablet landscape, large foldable | 12 |
| **Large** | 1200–1599dp | Desktop | 12 |
| **Extra Large** | 1600dp+ | Wide monitor | 12 |

**Critical rules:**
- Design for **Compact first** — it is the most constrained and forces good layout decisions
- Layouts must flex **between** breakpoints, not just at them — don't lock to fixed widths
- Use available window space, not physical screen size — multitasking windows are smaller than the screen
- Both width AND height are classified separately; your app has two size classes at any time

---

## Navigation Mapping (Most Important Adaptive Decision)

The navigation component changes at every breakpoint. This is the primary structural change:

| Window Size | Navigation Component | Why |
|---|---|---|
| Compact (< 600dp) | **Navigation Bar** (bottom) | Thumb reachable; compact |
| Medium (600–839dp) | **Navigation Rail** (left edge) | More space; horizontal content |
| Expanded (840dp+) | **Permanent Navigation Drawer** (left) | Persistent; room for labels |

**Implementation in Compose:**
```kotlin
// NavigationSuiteScaffold auto-switches between these based on window size:
NavigationSuiteScaffold(
    navigationSuiteItems = {
        items.forEach { item ->
            item(
                selected = currentDestination == item.destination,
                onClick = { navigate(item.destination) },
                icon = { Icon(item.icon, contentDescription = item.label) },
                label = { Text(item.label) }
            )
        }
    }
) {
    // Screen content
}
```

**Never:**
- Use navigation bar on a tablet in landscape (use rail or drawer)
- Use a hamburger/drawer menu as the only navigation on compact (no persistent navigation = lost users)
- Keep the same navigation component across all breakpoints without adaptation

---

## Canonical Layouts

M3 defines three canonical layout patterns. Every screen's layout should map to one of these, with configurations for each breakpoint.

### 1. List-Detail

**Use for:** Email, messages, contacts, file browsers — anything with a master list and item details.

| Compact | Medium | Expanded |
|---|---|---|
| Single pane (list). Tap → navigate to detail screen | Side-by-side panes: list (left) + empty detail state or first item | Side-by-side: list (narrower) + detail (wider) |

- Compact: Detail is a separate screen pushed onto the navigation stack
- Medium/Expanded: Both panes visible simultaneously; selecting an item updates the detail pane in-place
- Detail pane width: typically 60–70% of available width on expanded

**Compose:**
```kotlin
ListDetailPaneScaffold(
    listPane = { ReplyListPane() },
    detailPane = { ReplyDetailPane(selectedItem) }
)
```

### 2. Feed

**Use for:** News, social media, product grids — cards or tiles in a configurable grid.

| Compact | Medium | Expanded |
|---|---|---|
| Single column of cards | 2-column grid | 3–4 column grid |

- Cards scale responsively: fixed minimum width, flex to fill columns
- Avoid stretching individual cards to full screen width on wide layouts
- Use horizontal carousels to avoid vertical monopolization on large screens

### 3. Supporting Pane

**Use for:** Settings, document editors, dashboards — primary content with contextual side panel.

| Compact | Medium | Expanded |
|---|---|---|
| Only primary content. Supporting panel in bottom sheet or separate screen | Primary content + supporting pane appear conditionally | Both panes always visible |

- Supporting pane: 33% of width, pinned to trailing edge
- Primary content area adjusts to fill remaining space

---

## Layout Scaffold

Every screen is built from the same scaffold structure:

```
┌─────────────────────────────────────┐
│         Top App Bar (optional)       │
├────────┬────────────────────────────┤
│  Nav   │                            │
│  Rail  │        Body Content        │
│  or    │                            │
│ Drawer │                            │
├────────┴────────────────────────────┤
│      Navigation Bar (compact only)   │
└─────────────────────────────────────┘
```

**Body regions:**
- **Margins:** 16dp (compact), 24dp (medium), 24dp (expanded) — applied to body content, not nav chrome
- **Gutters:** 16dp between columns
- **Columns:** 4 (compact), 12 (medium+)

**Top App Bar behavior:**
- `TopAppBar` (small): Title stays inline, collapses and stays
- `MediumTopAppBar`: Large title at top, collapses to small on scroll
- `LargeTopAppBar`: Very large title, collapses on scroll (used for root screens)
- On scroll: elevation increases from Level 0 → Level 2 (tonal overlay signals content behind)

```kotlin
Scaffold(
    topBar = {
        TopAppBar(
            title = { Text("Screen Title") },
            scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
        )
    },
    bottomBar = {
        if (windowSizeClass == WindowWidthSizeClass.Compact) {
            NavigationBar { /* destinations */ }
        }
    },
    floatingActionButton = { FloatingActionButton(onClick = {}) { Icon(Icons.Default.Add, null) } }
) { padding ->
    // Body content with padding
}
```

---

## Component Visibility & Adaptation Rules

Components can:
1. **Remain fixed** — same component at all breakpoints (e.g., top app bar)
2. **Fluid expand** — component stretches to fill available space
3. **Switch** — replaced by a different component at a breakpoint (e.g., nav bar → nav rail)
4. **Appear/disappear** — visible only at certain breakpoints

### What changes at each breakpoint

| Element | Compact | Medium | Expanded |
|---|---|---|---|
| Navigation | Bottom Nav Bar | Navigation Rail | Permanent Drawer |
| Content layout | Single column | 2-column possible | 2–4 columns |
| FAB position | Bottom-right (above nav bar) | Bottom-right | Embedded in nav rail (top) |
| Dialog width | Full width (almost) | Fixed max 560dp centered | Fixed max 560dp centered |
| Snackbar width | Full width | Narrower, bottom-left or center | Fixed width, bottom-left |
| Cards | Full width | 2-column grid | 3–4 column grid |

---

## Foldables

Foldables add a third dimension — the **fold posture**:

- **Fully open (flat):** Treat as a large tablet. Use Expanded layout with canonical two-pane layouts
- **Half-open (tabletop / book):** Two distinct display areas separated by the hinge
  - **Tabletop:** Controls in bottom half; content in top half
  - **Book:** Two side-by-side portrait-ish panes

**Compose:**
```kotlin
val foldingFeatures = WindowInfoTracker.getOrCreate(context).windowLayoutInfo(activity)
// Detect hinge and adapt layout accordingly
```

---

## Common Mistakes

- Designing only for phone portrait and calling it "done"
- Using `fillMaxWidth()` on cards in a two-column layout (they need constrained width)
- Keeping the bottom nav bar visible on tablets — it wastes space and looks out of place
- Placing a FAB inside the navigation bar container on expanded layouts
- Not testing on a real foldable or at least the foldable emulator
- Content that looks fine at 360dp but breaks at 1200dp because widths weren't bounded