# Components — Material Design 3 Reference

Source: m3.material.io/components

---

## Buttons

Five variants, each with a specific hierarchy role. One primary action per screen maximum.

| Variant | Fill | Emphasis | Role |
|---|---|---|---|
| **Filled** | `primary` | Highest | The single most important action |
| **Filled Tonal** | `secondary-container` | High | Important but not primary |
| **Outlined** | Transparent + outline | Medium | Secondary action, pairs with Filled |
| **Elevated** | `surface-container-low` | Medium | Lower-emphasis in complex layouts |
| **Text** | Transparent | Lowest | Tertiary, inline, inside dialogs |

**Specs:** Height 40dp · Shape `corner.full` (pill) · Label `label-large` · Padding 24dp horizontal (16dp when icon present) · Min width 48dp · Icon size 18dp

**Rules:**
- Never place two Filled buttons side by side — hierarchy collapses
- Labels always **sentence case** — never ALL CAPS
- Destructive actions: use `error` color on Text or Outlined button, paired with a confirmation dialog
- Disabled: container at 12% `on-surface`, label at 38% `on-surface`

```kotlin
Button(onClick = {}) { Text("Save") }                   // Filled
FilledTonalButton(onClick = {}) { Text("Continue") }    // Tonal
OutlinedButton(onClick = {}) { Text("Cancel") }         // Outlined
ElevatedButton(onClick = {}) { Text("Learn more") }     // Elevated
TextButton(onClick = {}) { Text("Skip") }               // Text
```

---

## Floating Action Buttons (FABs)

The FAB is the screen's primary action. It persists and stays highly visible.

| Variant | Size | Shape |
|---|---|---|
| **FAB** (standard) | 56×56dp | `corner.large` (16dp) |
| **Small FAB** | 40×40dp | `corner.medium` (12dp) |
| **Large FAB** | 96×96dp | `corner.extra-large` (28dp) |
| **Extended FAB** | 56dp tall, variable width | `corner.extra-large` (28dp) |

**Color:** Default `primary-container` bg + `on-primary-container` icon. Use `secondary-container` or `tertiary-container` for variation within a screen.

**Elevation:** Level 3 at rest → Level 4 on hover.

**Rules:**
- One FAB per screen maximum
- Position: bottom-right on compact; top of navigation rail on medium/expanded
- FAB goes at the **top** of the rail, above destinations — **never** below them
- Snackbars always appear **above** the FAB — never covering it
- Use **Extended FAB** when the icon alone isn't self-explanatory
- Extended FAB expands/collapses as the layout widens (compact → expanded nav)

```kotlin
FloatingActionButton(onClick = {}) {
    Icon(Icons.Default.Add, contentDescription = "Add item")
}
LargeFloatingActionButton(onClick = {}) {
    Icon(Icons.Default.Edit, contentDescription = "Compose", modifier = Modifier.size(36.dp))
}
ExtendedFloatingActionButton(
    text = { Text("New message") },
    icon = { Icon(Icons.Default.Add, contentDescription = null) },
    onClick = {}
)
```

---

## Chips

Compact interactive elements for filtering, actions, and tagged inputs.

| Type | Selectable | Use |
|---|---|---|
| **Assist** | No | Smart / suggested actions contextual to content |
| **Filter** | Toggle (single / multi-select) | Narrow down a content set |
| **Input** | Removable | Represent user-entered values (tags, recipients) |
| **Suggestion** | No (one-shot) | Dynamic AI / contextual suggestions |

**Specs:** Height 32dp · Shape `corner.small` (8dp) · Label `label-large` · Leading icon 18dp · Horizontal padding 16dp (8dp with icon) · Checkmark on selected filter chips

**Filter chips:** Show a checkmark when selected. Arrange in horizontal scrollable rows or wrapped lines. Don't mix types in the same row group.

**Input chips:** Avatar + label + × button. Commonly used for email recipients and tag inputs.

```kotlin
FilterChip(
    selected = isSelected,
    onClick = { isSelected = !isSelected },
    label = { Text("Nearby") },
    leadingIcon = if (isSelected) {
        { Icon(Icons.Default.Check, contentDescription = null, Modifier.size(18.dp)) }
    } else null
)
AssistChip(onClick = {}, label = { Text("Set a reminder") },
    leadingIcon = { Icon(Icons.Default.Schedule, null, Modifier.size(18.dp)) })
InputChip(selected = true, onClick = {}, label = { Text("alex@example.com") },
    trailingIcon = { Icon(Icons.Default.Close, "Remove tag") })
```

---

## Dialogs

Dialogs interrupt and require a decision before the user can continue.

**Use for:**
- Decisions that require focus (destructive action confirmation, critical choices)
- Information that must be acknowledged before proceeding

**Don't use for:**
- Informational messages (use snackbar or banner)
- Complex tasks with many steps (use bottom sheet or full screen)
- Errors the user can fix in context (use inline validation)

**Anatomy:**

1. Container: `surface` · Level 3 elevation · `corner.medium` (12dp) · max-width 560dp
2. Optional icon: centered, `secondary` color, 24dp
3. Headline: `headline-small` · centered with icon / left-aligned without
4. Supporting text: `body-medium` · `on-surface-variant` color
5. Actions: 1–2 **Text buttons** · trailing-aligned · right = confirm, left = cancel/dismiss

**Rules:**
- Maximum **2 action buttons**. If 3 are needed, use a full-screen flow or bottom sheet
- "Cancel" must **never** be destructive
- Destructive confirm: use `error` color text on the confirm button, not the cancel
- Pressing the scrim (backdrop) or Back dismisses the dialog unless data would be lost
- Never scroll inside a basic dialog — use a full-screen dialog for long content

```kotlin
AlertDialog(
    onDismissRequest = { showDialog = false },
    title = { Text("Delete conversation?") },
    text = { Text("This can't be undone.") },
    confirmButton = {
        TextButton(onClick = { delete(); showDialog = false }) {
            Text("Delete", color = MaterialTheme.colorScheme.error)
        }
    },
    dismissButton = {
        TextButton(onClick = { showDialog = false }) { Text("Cancel") }
    }
)
```

---

## Snackbars

Brief, low-interruption feedback about an app operation.

**Use for:** Confirming completed actions ("Saved", "Deleted") · Offering Undo · Non-critical, non-blocking errors.

**Don't use for:** Critical errors needing a decision (use dialog) · Persistent status (use banner) · Multiple concurrent messages (queue them).

**Anatomy:**
- Container: `inverse-surface` · `corner.extra-small` (4dp)
- Text: `inverse-on-surface` · `body-medium` · max 2 lines
- Optional action button: `inverse-primary` text color · 1 action max
- Optional dismiss icon: `inverse-on-surface`

**Positioning:**
- Mobile: bottom-center, above FAB and nav bar — never covering them
- Tablet/desktop: bottom-left or center, narrower than full width (max ~344dp on wide screens)

**Timing:**
- Short: 4 seconds — simple confirmation with no action
- Long: 10 seconds — when an action button is included
- Persistent (with close icon): until manually dismissed

**Never stack snackbars.** If a second message arrives while one is showing, queue it and show after the first dismisses.

```kotlin
val snackbarHostState = remember { SnackbarHostState() }

Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { innerPadding ->
    // Screen content
}

// Trigger:
scope.launch {
    val result = snackbarHostState.showSnackbar(
        message = "Message archived",
        actionLabel = "Undo",
        duration = SnackbarDuration.Long
    )
    if (result == SnackbarResult.ActionPerformed) { undo() }
}
```

---

## Menus

Menus present a list of choices on a temporary surface. They appear near their trigger and close on selection, escape, or outside tap.

| Type | Trigger | Use |
|---|---|---|
| **Dropdown menu** | Button or icon (usually `MoreVert`) | Options for the current context |
| **Context menu** | Right-click or long-press on content | Content-specific actions |
| **Exposed dropdown** | Text field | Selecting a value from a bounded list |

**Specs:** Container: `surface-container` · Level 2 elevation · `corner.extra-small` (4dp) · Min width 112dp · Max width 280dp · Item height 48dp · Label: `label-large`

**Rules:**
- Item labels: sentence case only — never ALL CAPS
- Max 1 leading icon per item (16dp); optional trailing chevron (›) for submenus
- Destructive items: `error` text color, no red background
- Group related items with dividers (not section headers in basic menus)
- Disable (don't hide) temporarily unavailable items
- Keyboard: arrow keys to navigate, Enter to select, Escape to dismiss

```kotlin
var expanded by remember { mutableStateOf(false) }

Box {
    IconButton(onClick = { expanded = true }) {
        Icon(Icons.Default.MoreVert, contentDescription = "More options")
    }
    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
        DropdownMenuItem(text = { Text("Edit") }, onClick = { onEdit(); expanded = false },
            leadingIcon = { Icon(Icons.Default.Edit, null) })
        HorizontalDivider()
        DropdownMenuItem(text = { Text("Delete", color = MaterialTheme.colorScheme.error) },
            onClick = { onDelete(); expanded = false },
            leadingIcon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) })
    }
}
```

---

## Navigation Bar (Bottom Nav)

Use on **compact** screens (< 600dp width) with 3–5 primary destinations.

**Specs:** Height 80dp · Icon 24dp · Label `label-medium` · Active indicator: pill shape in `secondary-container` · Active icon: filled variant in `on-secondary-container` · Inactive icon: outlined variant in `on-surface-variant`

**Rules:**
- 3 destinations minimum. 2 or fewer → use tabs
- 5 destinations maximum. More → add a "More" destination or use a drawer
- All destination labels always visible (never icon-only on nav bar)
- Never on tablets or desktop — use navigation rail or drawer
- FAB appears **above** the nav bar, not inside it
- Tab temporarily hidden by keyboard or bottom sheet (not permanently)

---

## Navigation Rail

Use on **medium** (600–839dp) and **expanded** (840dp+) screens with 3–7 destinations.

**Variants:**
- **Collapsed:** 80dp wide · icons + optional labels · 3–7 destinations
- **Expanded:** 360dp wide · icons + labels + secondary destinations visible · replaces navigation drawer

**Specs:** Item height 56dp · Icon 24dp · Active indicator: wide pill in `secondary-container`

**Rules:**
- Rail runs along the **leading edge** (left in LTR) — never right or bottom
- FAB placed at the **top** of the rail, above navigation items — never below
- Top-aligned destinations by default; center-aligned on tablets for ergonomics
- Menu icon at top transitions between collapsed ↔ expanded
- Destinations remain fixed when content scrolls vertically
- When expanded: FAB becomes Extended FAB; secondary destinations are revealed

```kotlin
NavigationRail(header = {
    FloatingActionButton(onClick = { compose() }) {
        Icon(Icons.Default.Edit, "Compose")
    }
}) {
    destinations.forEach { dest ->
        NavigationRailItem(
            selected = currentDest == dest,
            onClick = { navigate(dest) },
            icon = { Icon(dest.icon, contentDescription = dest.label) },
            label = { Text(dest.label) }
        )
    }
}
```

---

## Navigation Drawer

Use on **expanded** screens (840dp+) when there are 5+ destinations or complex hierarchy.

| Type | Use |
|---|---|
| **Permanent** | Always visible; pushes content. 360dp wide. Large screens only |
| **Modal** | Slides over content as overlay. Any screen size when needed |
| **Dismissible** | Pushes content but can be hidden. Expanded screens |

- Permanent drawer: never on compact phones — it permanently consumes screen space
- Modal drawer: closes on tap-outside, swipe-away, or Escape key
- Expanded/dismissed state persists across sessions (save to preferences)

---

## Bottom Sheets

| Type | Use |
|---|---|
| **Modal** | Blocking — dims content behind, requires dismissal |
| **Standard** | Non-blocking — content remains interactive behind the sheet |

**Specs:** `corner.extra-large` (28dp) top corners · Drag handle: 32×4dp, centered, `on-surface-variant` at 40% · Maximum height: screen height − status bar − 8dp top gap

**Rules:**
- Standard sheets: content behind is still interactive (unlike modal)
- Modal sheets: scrim behind, content not interactive
- Never use a bottom sheet when a simple dialog would suffice
- Full-screen content → use a full-screen modal, not a max-height sheet