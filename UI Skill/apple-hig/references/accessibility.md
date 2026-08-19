# Accessibility — Apple HIG Reference

Source: developer.apple.com/design/human-interface-guidelines/accessibility

Accessibility is not a polish pass. It is a structural decision that affects component choices, layout logic, and testing from the first sprint. Miss it early and you're rewriting label hierarchies on a deadline.

---

## VoiceOver (Screen Reader)

VoiceOver reads every element a sighted user can see or interact with. Your job: make sure every interactive element has a meaningful label, and the reading order makes sense.

### Accessibility Labels
- Every interactive element needs an `.accessibilityLabel()` — especially icon-only buttons
- Labels describe **what the element is**, not what it looks like: "Delete message" not "Trash icon"
- Images need `.accessibilityLabel()` if they convey meaning; use `.accessibilityHidden(true)` if decorative
- Don't repeat the role in the label — VoiceOver adds "Button" automatically: "Delete" not "Delete button"

```swift
Button(action: deleteItem) {
    Image(systemName: "trash")
}
.accessibilityLabel("Delete item")

Image("decorative-background")
    .accessibilityHidden(true)
```

### Accessibility Hints
- Optional, brief phrase describing what happens when the element is activated: "Deletes the selected message"
- Only add if the action isn't obvious from the label alone

### Accessibility Values
- For sliders, steppers, or custom progress indicators: provide `.accessibilityValue()`
- Example: A custom rating control should report "3 stars" as its value

### Reading Order
- SwiftUI uses view hierarchy order by default — this is usually correct
- Use `.accessibilitySortPriority()` to reorder if layout and reading order diverge
- Group related elements with `.accessibilityElement(children: .combine)` so VoiceOver treats them as one

### Custom Controls
Every custom interactive element needs:
```swift
CustomToggle()
    .accessibilityLabel("Enable notifications")
    .accessibilityValue(isOn ? "On" : "Off")
    .accessibilityAddTraits(.isButton)
    .accessibilityAction { toggle() }
```

---

## Dynamic Type

Users set their preferred text size system-wide. Your app must respect it at all sizes, including the largest accessibility sizes (AX1–AX5).

### Rules
- Use only **semantic text styles**, never fixed font sizes:
  ```swift
  Text("Title").font(.title)          // ✅ Scales with Dynamic Type
  Text("Title").font(.system(size: 28)) // ❌ Fixed, doesn't scale
  ```
- Test at **"Accessibility Large"** (AX3 or AX5) — this is where most apps break
- When text grows: layouts should reflow, not clip. Use `minimumScaleFactor` only as a last resort
- Multi-line text must never be clipped — use `.fixedSize(horizontal: false, vertical: true)`
- Avoid truncation in lists — let rows grow in height

### Text Style Scale (iOS, Large preset)

| Style | Size | Weight | Use |
|---|---|---|---|
| Large Title | 34pt | Regular | Screen root title (collapses on scroll) |
| Title 1 | 28pt | Regular | Section headers |
| Title 2 | 22pt | Regular | Card headers |
| Title 3 | 20pt | Regular | Subsection headers |
| Headline | 17pt | Semibold | Row primary label, emphasized body |
| Body | 17pt | Regular | Default body text |
| Callout | 16pt | Regular | Secondary body in two-column layouts |
| Subheadline | 15pt | Regular | Secondary label in rows |
| Footnote | 13pt | Regular | Captions, metadata |
| Caption 1 | 12pt | Regular | Timestamps, supplementary |
| Caption 2 | 11pt | Regular | Smallest text, sparingly |

---

## Color Contrast

Minimum contrast ratios (WCAG 2.1 AA):
- **4.5:1** — body text, labels
- **3:1** — large text (18pt+ regular, 14pt+ bold), icons, UI components

Use **semantic colors** — they automatically adapt to Light Mode, Dark Mode, and high-contrast mode:

| Semantic Name | Light | Dark | Use |
|---|---|---|---|
| `label` | #000000 | #FFFFFF | Primary text |
| `secondaryLabel` | #3C3C43 @ 60% | #EBEBF5 @ 60% | Secondary text |
| `systemBackground` | #FFFFFF | #000000 | Base screen background |
| `secondarySystemBackground` | #F2F2F7 | #1C1C1E | Grouped content background |
| `systemBlue` | #007AFF | #0A84FF | Interactive tint |
| `systemRed` | #FF3B30 | #FF453A | Destructive |
| `systemGreen` | #34C759 | #30D158 | Success |
| `systemOrange` | #FF9500 | #FF9F0A | Warning |

**Never use color as the only differentiator.** A user who is color-blind (affecting ~8% of males) must be able to understand your UI without relying on color. Pair color with shape, label, or icon.

---

## Touch Targets & Motor Accessibility

- Minimum touch target: **44×44pt** for every interactive element
- Recommended: 44–48pt minimum, larger in thumb zones
- Don't rely on small icons with no padding
- Use `.contentShape(Rectangle())` to expand the hit area without changing visuals:
  ```swift
  Image(systemName: "xmark")
      .contentShape(Rectangle())
      .frame(width: 44, height: 44)
  ```

**Switch Control:** Users navigate with external switches. Every interactive element must be reachable and operable via Switch Control — this is guaranteed if VoiceOver works correctly.

---

## Reduce Transparency & Reduce Motion

Always check and respect:
```swift
@Environment(\.accessibilityReduceTransparency) var reduceTransparency
@Environment(\.accessibilityReduceMotion) var reduceMotion
```

- **Reduce Transparency:** Replace blurred/translucent backgrounds with solid colors
- **Reduce Motion:** Replace slide/scale transitions with cross-fades or instant state changes (see `motion-haptics.md`)

---

## Accessibility Audit Checklist

Run before shipping any screen:

- [ ] Every button and interactive element has a meaningful `.accessibilityLabel()`
- [ ] Decorative images are `.accessibilityHidden(true)`
- [ ] Custom controls have `.accessibilityValue()` and `.accessibilityAddTraits()`
- [ ] Reading order with VoiceOver matches visual order
- [ ] All text uses semantic type styles (not fixed sizes)
- [ ] Tested at Accessibility Large type size — nothing clips or overflows
- [ ] Color contrast meets 4.5:1 for body text, 3:1 for large text/icons
- [ ] No information communicated by color alone
- [ ] All touch targets are ≥ 44×44pt
- [ ] Reduce Motion replaces animations with cross-fades
- [ ] Reduce Transparency replaces blur with solid fills
- [ ] Increase Contrast mode tested — borders and separators are visible