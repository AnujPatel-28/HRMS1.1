# Motion — Material Design 3 Reference

Source: m3.material.io/styles/motion  
         m3.material.io/styles/motion/easing-and-duration

Motion in M3 makes interactions feel **responsive and natural**. M3 Expressive (2025) replaces traditional easing-only curves with a physics-based spring model for more lifelike, emotionally resonant animations.

---

## Four Principles of M3 Motion

1. **Informative** — Motion explains what happened and previews what will happen. Spatial transitions show where things came from and where they went.
2. **Focused** — Animate one dominant element per transition. Don't animate everything simultaneously.
3. **Expressive** — Motion reflects the character of the product. Physics-based springs feel alive; linear motion feels robotic.
4. **Efficient** — Never make users wait for animations. Short enough to not block; long enough to comprehend.

---

## M3 Easing Curves (`md.sys.motion.easing.*`)

### Standard (Most common)
```
cubic-bezier(0.2, 0, 0, 1)
```
Use for: elements moving between positions on-screen; size and property changes.  
Character: fast start, slow graceful arrival at destination.

### Deceleration (Elements entering)
```
cubic-bezier(0, 0, 0, 1)
```
Use for: elements entering the screen from off-screen.  
Character: enters at full velocity, decelerates to rest. Signals arrival.

### Acceleration (Elements exiting)
```
cubic-bezier(0.3, 0, 1, 1)
```
Use for: elements leaving the screen.  
Character: starts slow, exits at full velocity. Exiting elements need less visual attention — use shorter duration too.

### Emphasized (Expressive, two-part)
A distinctive two-part path: extremely fast exit from the start state, then a slow, deliberate arrival at the end state. Used for the most important transitions.
```
// Approximated cubic-bezier (actual is a custom path):
cubic-bezier(0.2, 0, 0, 1) with longer duration (≥400ms)
```
Use for: screen-to-screen transitions, container morphing, significant layout changes.

---

## Duration Guidelines

### Mobile baseline
| Category | Duration range | Examples |
|---|---|---|
| Micro-interactions | 50–150ms | State changes, icon swaps, ripple |
| Component transitions | 200–400ms | Expand/collapse, tray appear/dismiss |
| Screen transitions | 300–500ms | Navigation between screens |
| Complex / theatrical | 500–1000ms | Onboarding, container transform |

**General rule for components:** 200–300ms on mobile.  
**Absolute maximum for frequent interactions:** 400ms — anything longer feels like lag.

### Device scaling
- **Tablet/large screen:** +30% duration (elements travel larger distances at the same velocity as mobile)
- **Wearable:** −30% duration (small screen, everything should be snappy)
- **Desktop:** Match mobile for small components; scale up only for full-screen transitions

---

## M3 Expressive: Spring Physics (2025)

M3 Expressive replaces all remaining bezier curves with **springs** for interactive and state-driven animations. Springs are defined by physical properties — not timing — so they always feel responsive regardless of how they're triggered.

**Spring properties:**
- **Stiffness:** How quickly the spring resolves. High = snappy. Low = slow and floaty.
- **Damping ratio:** How quickly oscillation stops. 1.0 = no bounce (critically damped). < 1.0 = bouncy (underdamped).
- **Initial velocity:** Speed at the start (useful for drag-release animations that continue the gesture's momentum).

### Recommended Spring Presets

| Preset | Stiffness | Damping | Character | Use |
|---|---|---|---|---|
| Spatial — Expressive | ~380 | 0.8 | Snappy, slight overshoot | Hero transitions, FAB animation |
| Spatial — Calm | ~200 | 0.9 | Gentle, no bounce | Cards, drawers, sheets |
| Effects — Expressive | ~280 | 0.75 | Bouncy, playful | Delight moments, achievement |
| Effects — Calm | ~160 | 1.0 | Smooth, no overshoot | Progress, loading indicators |

```kotlin
// Compose spring animation
val scale by animateFloatAsState(
    targetValue = if (isPressed) 0.95f else 1f,
    animationSpec = spring(
        stiffness = Spring.StiffnessMediumLow,
        dampingRatio = Spring.DampingRatioMediumBouncy
    )
)

// For state-driven transitions:
AnimatedContent(
    targetState = currentStep,
    transitionSpec = {
        slideInVertically(
            animationSpec = spring(stiffness = Spring.StiffnessMedium)
        ) togetherWith slideOutVertically(
            animationSpec = spring(stiffness = Spring.StiffnessMedium)
        )
    }
) { step -> StepContent(step) }
```

### Springs vs. Bezier: When to Use Each
- **Springs:** Interactive responses (drag-release, toggle, expand/collapse from user gesture)
- **Bezier:** Navigation transitions, progress bars, timed/looping animations, anything with a fixed endpoint that must land exactly

---

## Transition Patterns

These are the four canonical M3 transition patterns. Match the pattern to the relationship between screens.

### 1. Shared Axis — Spatial relationship exists

Used when there is a clear directional relationship between origin and destination.

| Axis | When to use | Direction |
|---|---|---|
| X (horizontal) | Forward/back navigation | Forward → slide left; Back → slide right |
| Y (vertical) | Expand/collapse; parent → child vertically | Down → expand; Up → collapse |
| Z (scale) | Drill-down to detail; zooming in/out | Zoom in for detail; zoom out to overview |

```kotlin
// With material-motion-compose library:
materialSharedAxisX(forward = true)    // Navigate forward
materialSharedAxisX(forward = false)   // Navigate back
materialSharedAxisZ(forward = true)    // Zoom into detail view
```

### 2. Fade Through — No spatial relationship

Used when switching between content that has no implied direction or relationship (e.g., tab switching).

- Outgoing content fades out and scales down slightly (95% → hidden)
- Brief moment where neither is visible
- Incoming content fades in and scales up (95% → 100%)

```kotlin
materialFadeThrough()
```

### 3. Container Transform — Element morphs into destination

Used when an element (card, thumbnail, chip) expands into a full screen or sheet.

- The container's shape, size, and position animate continuously from source to destination
- Content inside cross-fades during the morph
- Return journey: destination collapses back to the originating element

```kotlin
// Requires shared element transition or MaterialContainerTransform
materialContainerTransform()
```

### 4. Fade (Simple)

Used for elements appearing/disappearing without a spatial origin.

- Simple opacity fade (with optional scale: 80% → 100% on enter)
- Dialogs, tooltips, dropdowns, overlays

---

## Reducing Motion

Always respect the user's system preference.

```kotlin
// Compose
@Composable
fun isReducedMotion(): Boolean {
    val uriHandler = LocalUriHandler.current
    return LocalWindowInfo.current.isWindowFocused.let {
        // Check accessibility settings
        LocalContext.current.let { ctx ->
            android.provider.Settings.Global.getFloat(
                ctx.contentResolver,
                android.provider.Settings.Global.TRANSITION_ANIMATION_SCALE, 1f
            ) == 0f
        }
    }
}

// Simpler approach using animationSpec:
val spec = if (reduceMotion) snap() else spring(stiffness = Spring.StiffnessMedium)
val scale by animateFloatAsState(targetValue, animationSpec = spec)
```

```css
/* Web / CSS */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

**With reduced motion active:**
- Replace slide/scale/morph → instant state change or cross-fade
- Stop looping/ambient animations
- Keep ripple (it's direct user feedback, not decoration)
- Never remove all feedback — only the motion

---

## Common Motion Anti-Patterns

| Anti-pattern | Why it's wrong | Fix |
|---|---|---|
| Animating everything simultaneously | Chaos; no focal point | Stagger elements; animate one dominant thing |
| Same easing on every animation | Feels mechanical, unnatural | Match easing to motion's semantic meaning |
| Duration > 400ms on frequent interactions | Makes users wait; feels broken | Keep to 200–300ms for repeated interactions |
| Linear easing for UI transitions | Feels robotic, digital, cheap | Use springs or standard easing curves |
| Container transform for unrelated screens | Incorrect spatial implication | Use fade-through for unrelated screens |
| Bounce on destructive confirmations | Trivializes severity | Use calm spring (no bounce) for serious moments |