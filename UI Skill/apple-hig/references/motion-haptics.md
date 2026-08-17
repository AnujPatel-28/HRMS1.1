# Motion, Gestures & Haptics — Apple HIG Reference

Source: developer.apple.com/design/human-interface-guidelines/motion
         developer.apple.com/design/human-interface-guidelines/gestures

---

## Motion & Animation

### Principles
Motion in iOS serves three purposes: **orient** (show where content came from and where it went), **respond** (confirm user input immediately), **delight** (make the app feel alive without being distracting).

> "Add motion purposefully, supporting the experience without overshadowing it." — HIG

**Rules:**
- Animate for meaning, not decoration
- Keep animations under **300ms** for transitions; shorter (80–150ms) for micro-interactions
- Don't animate frequent interactions with elaborate effects — they compound into fatigue
- Every system element already has animation built in. Don't double-animate standard components
- Motion should match the gesture: a swipe-up should result in content moving up

### Required: Respect Reduce Motion
Always check `UIAccessibility.isReduceMotionEnabled` / SwiftUI's `@Environment(\.accessibilityReduceMotion)`:

```swift
@Environment(\.accessibilityReduceMotion) var reduceMotion

var body: some View {
    content
        .animation(reduceMotion ? .none : .spring(response: 0.3, dampingFraction: 0.7), value: isExpanded)
}
```

**When Reduce Motion is on:**
- Replace slide/scale animations with cross-fades
- Eliminate parallax effects
- Reduce or stop looping/ambient animations
- Never eliminate feedback entirely — replace motion with instant state changes

### Animation Types & When to Use Them

| Animation | Use Case | Duration |
|---|---|---|
| Spring (default) | Sheet presentation, card expansion, button press | 250–400ms |
| Ease-out | Content entering screen | 200–300ms |
| Ease-in | Content leaving screen | 150–250ms |
| Linear | Progress bars, loading spinners | continuous |
| Cross-fade | Tab switches when content is unrelated spatially | 150–200ms |

**SwiftUI defaults (preferred):**
```swift
.animation(.spring(response: 0.35, dampingFraction: 0.75), value: state)
.transition(.move(edge: .trailing))          // Push navigation
.transition(.move(edge: .bottom))            // Sheet
.transition(.opacity)                        // Contextual appearance
```

### Navigation Transitions
- **Push/pop (NavigationStack):** Right-to-left push, left-to-right pop. Never swap these directions
- **Sheet:** Slides up from bottom; user can drag down to dismiss
- **Full-screen modal:** Slides up and covers fully; no drag-to-dismiss by default
- **Tab switch:** Cross-fade by default; directional slide only if tabs have explicit spatial order

### Do Not
- Do not use bounce animations on destructive confirmations (trivializes severity)
- Do not loop animations in UI elements the user interacts with constantly
- Do not animate layout changes that the user didn't initiate
- Do not animate things faster than 16ms (60fps floor) — dropped frames feel worse than no animation

---

## Gestures

iOS gestures are a shared contract with the user. Honor them — don't override or conflict.

### Standard iOS Gestures (never reassign)

| Gesture | System Meaning | You Must Not... |
|---|---|---|
| Swipe from left edge | Navigate back (pop) | Override or disable this |
| Swipe down on sheet | Dismiss sheet | Prevent without intercepting and confirming |
| Swipe up from bottom | Go to home screen | Consume this gesture |
| Long press | Context menu | Use for a completely different action |
| Pinch | Zoom | Use for anything else in a zoomable view |

### App Gestures You May Implement

**Tap** — Primary select / activate. Should have immediate visual feedback (highlight, scale, color change).

**Double tap** — Zoom to fit / zoom to fill in media contexts. Avoid in non-media views where it may conflict.

**Long press** — Reveals context menu. The menu appears instantly (no delay >0.5s). Don't use long press as the primary way to perform common actions.

**Swipe (horizontal, within content):**
- Leading swipe on list row: secondary positive actions (Archive, Pin)
- Trailing swipe on list row: destructive actions (Delete)
- Horizontal swipe between siblings (photos, cards in a page)

**Swipe (vertical, within content):**
- Scroll — system-managed, don't interfere
- Pull-to-refresh: standard `refreshable {}` modifier

**Drag:**
- Drag-to-reorder in lists: standard `.onMove {}` modifier
- Drag-to-rearrange: use proper spring physics on the dragged item (scale up slightly, shadow)

**Pinch/spread:** Standard zoom in maps, photos, PDFs. Don't use in non-zoomable content.

### Touch Targets
- **Minimum:** 44×44pt for any interactive element
- **Preferred:** 44–48pt for important controls, larger in thumb-reach zones
- Add invisible hit area padding to small icons:
  ```swift
  Image(systemName: "ellipsis")
      .frame(width: 44, height: 44) // Actual hit area
  ```
- Place primary actions in the **thumb zone** (bottom 60% of the screen). Secondary actions can be in the nav bar.

### Gesture Conflict Resolution
When two gestures could conflict:
- System gestures always win. Build around them, not against them
- Use `.highPriorityGesture()` only when absolutely required
- Use `.simultaneousGesture()` for cases where both should fire
- Test on a real device — the simulator does not replicate gesture priority accurately

---

## Haptics

Haptic feedback communicates through the sense of touch. It confirms actions, signals events, and adds physicality to interactions.

### Haptic Types (UIFeedbackGenerator)

| Type | When to Use |
|---|---|
| **Impact** (light) | Toggle, switch flip, drag start/stop |
| **Impact** (medium) | Button press confirmation, item selection |
| **Impact** (heavy) | Significant action (delete confirmed, large change) |
| **Notification — success** | Completion of a task (form submitted, sync done) |
| **Notification — warning** | Alert that something needs attention |
| **Notification — error** | Failed action (auth error, network failure) |
| **Selection** | Picker scrolling, segmented control tap |

### Rules

**Use haptics to confirm, not announce.** Haptics support visual feedback — they don't replace it.

**Don't use haptics for:**
- Every single tap (overuse destroys meaning)
- Background or passive events the user didn't trigger
- Repeated rapid sequences (feels like a vibration alarm, not feedback)
- Informational content the user is just reading

**Do use haptics for:**
- Completing a meaningful action (sent, saved, deleted)
- Destructive confirmation
- Toggles and switches changing state
- Pull-to-refresh triggering
- Drag reaching a snap point

**SwiftUI:**
```swift
let impact = UIImpactFeedbackGenerator(style: .medium)
impact.prepare()        // Call early to reduce latency
impact.impactOccurred() // Call at the moment of impact

let notify = UINotificationFeedbackGenerator()
notify.notificationOccurred(.success)
notify.notificationOccurred(.error)

let selection = UISelectionFeedbackGenerator()
selection.selectionChanged() // On picker scroll
```

**Prepare before triggering:**  
Call `.prepare()` 1–2 frames before the expected interaction so the Taptic Engine is warmed up and latency is imperceptible.

### Haptic Don'ts
- Never use haptics to substitute for missing visual feedback
- Don't add custom haptic patterns unless you have a very specific physical metaphor (instruments, games)
- Don't use `.heavy` impact for minor interactions — reserve it for weighty moments
- Don't fire haptics during system-managed animations (sheets, alerts) — they already include haptics