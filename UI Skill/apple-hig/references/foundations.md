# Foundations — Apple HIG Reference

Source: developer.apple.com/design/human-interface-guidelines/foundations

Covers: Typography · Color · Spacing & Layout · Safe Areas · SF Symbols · Liquid Glass (iOS 26)

---

## Typography

### Fonts
- **SF Pro** — primary system font for UI. Use via `.font(.body)` etc. — never reference "SF Pro" by name in code
- **SF Pro Text** — optimized for sizes 19pt and below
- **SF Pro Display** — optimized for 20pt and above (auto-switched by system)
- **SF Mono** — for code, terminal, and monospaced content
- **New York** — serif, for editorial/reading contexts

**Rule:** Use system fonts via semantic text styles. Custom fonts are allowed but must still support Dynamic Type — use `UIFontMetrics` to scale them.

### Type Hierarchy in Practice

iOS differentiates text primarily with **weight and color**, not size:

```
Primary label:     17pt, Regular, label color
Secondary label:   15pt, Regular, secondaryLabel color
Tertiary:          13pt, Regular, tertiaryLabel color

Title (large):     34pt, Regular         → Screen root before scroll
Title inline:      17pt, Semibold        → After scroll / in nav bar
Section header:    13pt, Regular, uppercase, secondaryLabel
```

**Don't use ALL CAPS for body text** — only for section headers at footnote size.

### Line Length
- Optimal: 50–75 characters per line on iPhone
- On iPad: constrain text columns to ~66 characters; don't let text span the full width

---

## Color

### Semantic Colors (Always Use These)
Semantic colors automatically adapt to Light Mode, Dark Mode, and Increase Contrast. Never hardcode hex values for UI elements.

```swift
// Text
Color(.label)                    // Primary text
Color(.secondaryLabel)           // Secondary text
Color(.tertiaryLabel)            // Hint text
Color(.quaternaryLabel)          // Disabled text

// Backgrounds
Color(.systemBackground)         // Main screen bg
Color(.secondarySystemBackground) // Cards, grouped list bg
Color(.tertiarySystemBackground)  // Table cell bg on grouped lists

// Separators
Color(.separator)                // Standard divider
Color(.opaqueSeparator)          // When blur won't work

// System Colors (auto light/dark swap)
Color(.systemBlue)    // Interactive tint
Color(.systemRed)     // Destructive
Color(.systemGreen)   // Success
Color(.systemOrange)  // Warning
Color(.systemYellow)  // Alert
Color(.systemGray)    // Neutral
// systemGray2–systemGray6 for lighter grays
```

### Tint Color
- Your app's accent color (set via `accentColor` in SwiftUI / `UIView.tintColor`)
- Applied to: interactive text, button highlights, selected indicators
- Must pass 4.5:1 contrast on white/black backgrounds at your app's standard sizes

### Dark Mode
- Dark Mode is **not optional** — ship with full dark mode support from day one
- Don't invert your color scheme manually. Use semantic colors and they handle it
- Test: all text readable, all icons visible, all borders/separators visible, images have dark variants if needed
- Custom images/icons: provide both light and dark assets in the Asset Catalog

---

## Spacing & Layout

### The 8pt Grid
iOS layouts align to an **8pt grid** (4pt for fine adjustments). This is a convention observed in Apple's own apps, not a formally mandated rule, but following it keeps layouts consistent and decisions fast.

```
Standard margins:         16pt horizontal
Content group spacing:     8pt (between related items)
Section spacing:          24–32pt (between unrelated groups)
Minimum touch target:     44pt
Standard row height:      44pt minimum
Icon sizes:               28pt, 32pt, 44pt, 60pt (common multiples)
Corner radius:            10pt (compact), 12–16pt (cards), 20pt (large sheets)
```

### Safe Areas
Content must not overlap hardware features: the Dynamic Island / notch, home indicator, and (on iPad) the rounded corners.

```swift
// SwiftUI respects safe areas automatically — don't override unless intentional
.ignoresSafeArea(.all)          // ⚠️ Only for backgrounds and edge-to-edge images
.safeAreaInset(edge: .bottom) { // Add content above the safe area
    BottomBar()
}
```

**Home indicator zone (21pt):** Never place interactive elements in this zone. The system reserves it.

### Layout Adaptivity
- Design for **390pt** width first (iPhone 16 base). Test on 320pt (SE) and 440pt (Plus) before shipping
- Use relative sizing (`GeometryReader`, `ViewThatFits`) rather than fixed widths
- On iPad: use NavigationSplitView (sidebar + detail) not a tab bar for most app structures
- Respond to size class changes: `horizontalSizeClass == .compact` (iPhone) vs `.regular` (iPad landscape)

### Content Priority (Z-axis)
iOS 26 Liquid Glass makes the layer model explicit:
1. **Base content layer** — the app's primary content (scrolls under controls)
2. **Liquid Glass layer** — navigation bars, tab bar, toolbars (float above content)
3. **Modal layer** — sheets, alerts (sit above everything)

Place primary content actions (FAB, "New" button) **in the content layer**, not in the tab bar.

---

## SF Symbols

SF Symbols is Apple's icon library — 6,000+ symbols designed to match SF Pro at all weights and sizes.

**Using SF Symbols:**
```swift
Image(systemName: "heart.fill")
    .font(.title)                    // Size via font; symbol scales to match
    .imageScale(.large)
    .symbolVariant(.fill)            // Use .fill for selected/active states
    .symbolRenderingMode(.hierarchical) // Multi-color with hierarchy
```

**Variable color (iOS 16+):**
```swift
Image(systemName: "speaker.wave.3")
    .symbolVariant(.none)
    .foregroundStyle(.blue)
    .symbolEffect(.variableColor.iterative, value: volume) // Animates fill level
```

**Rules:**
- Use the **outline** variant for unselected/inactive states
- Use the **fill** variant for selected/active states
- Don't mix SF Symbols and custom icons at the same visual weight — they'll look inconsistent
- Set accessibility labels on SF Symbol images used for actions
- Use `.symbolAnimation` to transition between symbol variants — it cross-fades with intent

**Common symbols reference:**

| Action | Symbol |
|---|---|
| Delete | `trash` / `trash.fill` |
| Edit | `pencil` |
| Share | `square.and.arrow.up` |
| Add | `plus` |
| Close | `xmark` |
| Search | `magnifyingglass` |
| Settings | `gear` |
| Back | `chevron.left` |
| More options | `ellipsis` |
| Checkmark | `checkmark` |
| Favourite | `heart` / `heart.fill` |
| Bookmark | `bookmark` / `bookmark.fill` |
| Filter | `line.3.horizontal.decrease.circle` |
| Sort | `arrow.up.arrow.down` |

---

## Liquid Glass (iOS 26)

Introduced at WWDC 2025. The most significant visual redesign since iOS 7.

### What It Is
A translucent material that bends and refracts the content behind it (actual lensing — not just blur). It responds to device motion, ambient light, and the colors of underlying content.

### Where It Appears
- Navigation bars (float above scrolling content)
- Tab bar (inset capsule floating above content)
- Toolbars (both top and bottom)
- Prominent system buttons

### Design Rules for Liquid Glass Apps
1. **Let content scroll under the nav bar and tab bar** — they are now visually floating layers
2. **Ensure safe area insets** at top and bottom for your own content — the glass elements sit above, so bottom content needs extra padding to not hide under the tab bar
3. **High-contrast text still needed** — glass backgrounds shift based on content; don't assume white or dark
4. **Avoid stacking glass layers** — don't put a glass card inside a glass tab bar — it becomes visually noise ("glass sandwich")
5. **Content-first:** The point of glass is to make content visible through the chrome. Don't fight this with opaque overlapping elements

### SwiftUI
```swift
// Liquid Glass is applied automatically to system components in iOS 26
// For custom glass surfaces:
.background(.ultraThinMaterial)   // Blurred translucency
.glassBackgroundEffect()          // Full Liquid Glass (available in visionOS, coming to iOS 26 APIs)
```

**Note:** If supporting iOS 17 and earlier alongside iOS 26, test both. Liquid Glass degrades gracefully to standard translucent material on older OS versions.