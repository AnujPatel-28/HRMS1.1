---
name: apple-hig
description: >
  Apple Human Interface Guidelines (HIG) — the official source for iOS/iPadOS UX and interaction design. Use this skill whenever you're unsure how an interaction should work, designing or building ANY iOS or iPadOS UI, or reviewing an existing design for HIG compliance. Trigger on: "iPhone app", "iPad layout", "SwiftUI", "UIKit", "iOS design", "native feel", "HIG", "tab bar", "navigation bar", "sheet", "modal", "bottom sheet", "gesture", "haptic", "SF Symbols", "Dynamic Type", "VoiceOver", "safe area", "loading state", "empty state", "error state", "form design", "list design", "card UI", "search bar", or any question about how an iOS component should behave. Also trigger for "does this feel native?", "is this the right pattern?", or any comparison between design options in an iOS context. Updated for iOS 26 / Liquid Glass (WWDC 2025).
---

# Apple Human Interface Guidelines (HIG)

**Source:** developer.apple.com/design/human-interface-guidelines  
**Current version:** iOS 26 (updated WWDC 2025, includes Liquid Glass)

This skill is your reference for every interaction decision in iOS/iPadOS design. When in doubt, check here first.

---

## Three Core Principles

Every HIG decision roots back to these three. Apply them as filters when evaluating any design choice:

**1. Clarity** — Every element must be legible and purposeful. Text is readable at every size. Icons are precise. The interface communicates function without explanation. If a button doesn't look like a button, it has failed clarity.

**2. Deference** — The UI exists to serve content, not announce itself. Controls recede. White space does hierarchy work. Chrome (nav bars, toolbars) shrinks or disappears when content fills the viewport. The app should feel like it disappears and leaves you with your content.

**3. Consistency** — Users carry mental models from system apps. When your app honors those models (where the back button lives, how a sheet dismisses, what a tab bar does), trust is earned instantly. Break the models and users don't think "interesting choice" — they think something is broken.

---

## Quick Reference: What to Load

| You need guidance on... | Load |
|---|---|
| Navigation, tab bars, nav bars, routing | `references/navigation.md` |
| Buttons, lists, cards, forms, modals, sheets, search | `references/components.md` |
| Gestures, animations, haptics, motion | `references/motion-haptics.md` |
| VoiceOver, Dynamic Type, contrast, touch targets | `references/accessibility.md` |
| Empty states, error states, loading states | `references/states.md` |
| Typography, color, spacing, layout, Liquid Glass | `references/foundations.md` |

Load **all** reference files if the task touches multiple areas. It is always better to have more context.

---

## The HIG Anti-Pattern Checklist

These are the most common violations — check against these before finalising any design:

- [ ] Touch targets smaller than 44×44pt
- [ ] Custom navigation that blocks swipe-to-go-back gesture
- [ ] Tab bar used for actions, not destinations
- [ ] Content overlapping safe area (notch, home indicator)
- [ ] Modal with no clear dismiss path
- [ ] Red used for non-destructive actions
- [ ] Text with fixed sizes (not supporting Dynamic Type)
- [ ] Hamburger/drawer replacing tab bar on iPhone
- [ ] Tab bar hidden mid-flow (outside of modal context)
- [ ] Duplicate component visible during an animation
- [ ] Empty screen with no guidance or next action
- [ ] Error state that describes what went wrong, not what to do next
- [ ] Missing VoiceOver labels on custom controls
- [ ] Haptic feedback on every single interaction (overuse)
- [ ] Animations that ignore `prefers-reduced-motion`

---

## How to Use This Skill

1. Identify which area(s) of HIG you need
2. Load the relevant reference file(s) from the table above
3. Apply the guidance to the specific interaction or component in question
4. Run the anti-pattern checklist before finalising

When a question can't be answered from these reference files, the authoritative source is: **developer.apple.com/design/human-interface-guidelines**