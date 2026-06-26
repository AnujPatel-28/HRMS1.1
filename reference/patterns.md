# Implementation Patterns

Concrete code patterns and values for implementing the Family Values design philosophy.

---

## Easing & Timing

### Recommended easing curves
```css
/* Springy entrance — for trays, cards, modals appearing */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

/* Smooth directional — for tab switches, screen transitions */
--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);

/* Natural exit — for elements dismissing */
--ease-in-quart: cubic-bezier(0.5, 0, 0.75, 0);

/* Text morph — for label transformations */
--ease-text: cubic-bezier(0.16, 1, 0.3, 1);
```

### Timing scale
```css
--duration-micro:  80ms;   /* Icon rotations, checkbox ticks */
--duration-fast:   150ms;  /* Button state changes, hover */
--duration-normal: 250ms;  /* Tray appear/dismiss, tab switch */
--duration-slow:   400ms;  /* Full-screen transitions */
--duration-theatrical: 600ms; /* Delight moments — confetti setup, wallet creation */
```

---

## Tray System (CSS + JS)

### Base tray CSS
```css
.tray {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--tray-bg, #fff);
  border-radius: 20px 20px 0 0;
  padding: 20px;
  
  /* Entry animation */
  transform: translateY(100%);
  transition: transform var(--duration-normal) var(--ease-spring);
}

.tray.is-open {
  transform: translateY(0);
}

/* Dark context variant */
.tray--dark {
  --tray-bg: #1a1a1a;
  color: #fff;
}
```

### Varying tray heights (critical for sequence clarity)
```css
/* Each step in a sequence should have a meaningfully different height */
.tray--step-1 { min-height: 240px; }
.tray--step-2 { min-height: 320px; }
.tray--step-3 { min-height: 180px; }

/* Or use content-driven heights with explicit padding variation */
.tray--compact  { padding: 16px 20px 32px; }
.tray--regular  { padding: 24px 20px 40px; }
.tray--expanded { padding: 32px 20px 48px; }
```

### Tray header (required on every tray)
```html
<div class="tray-header">
  <button class="tray-back" aria-label="Go back">
    <!-- chevron-left icon when in sequence, X icon when first tray -->
    <svg>...</svg>
  </button>
  <h2 class="tray-title">Confirm Swap</h2>
</div>
```

---

## Text Morphing (Torph)

For transforming button labels like "Continue" → "Confirm":

### Concept
Split both strings into characters. Find the longest common prefix/suffix. Animate:
- Shared prefix: stays in place (opacity 1 throughout)
- Departing suffix: fades + slides out (translateY up, opacity → 0)
- Arriving suffix: fades + slides in (translateY from below, opacity 0 → 1)

### React implementation sketch
```jsx
import { useState, useEffect } from "react";

function MorphButton({ label, onClick }) {
  const [displayLabel, setDisplayLabel] = useState(label);
  const [morphState, setMorphState] = useState("idle"); // idle | out | in

  useEffect(() => {
    if (label !== displayLabel) {
      setMorphState("out");
      setTimeout(() => {
        setDisplayLabel(label);
        setMorphState("in");
        setTimeout(() => setMorphState("idle"), 200);
      }, 150);
    }
  }, [label]);

  return (
    <button
      onClick={onClick}
      className={`morph-btn morph-btn--${morphState}`}
    >
      {displayLabel}
    </button>
  );
}
```

```css
.morph-btn { transition: all 150ms var(--ease-text); }
.morph-btn--out { opacity: 0; transform: translateY(-4px); }
.morph-btn--in  { opacity: 0; transform: translateY(4px); }
.morph-btn--idle { opacity: 1; transform: translateY(0); }
```

For a more sophisticated approach (per-character morphing), use the `torph` library or implement character-level FLIP animations.

---

## Shared Element Transitions

### CSS FLIP technique
```js
// 1. Read — capture element's position before transition
const first = element.getBoundingClientRect();

// 2. DOM change happens (navigate, update state)
updateState();

// 3. Read again after paint
requestAnimationFrame(() => {
  const last = element.getBoundingClientRect();

  // 4. Invert — apply transform to "undo" the movement
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const dw = first.width / last.width;
  const dh = first.height / last.height;

  element.style.transform = `translate(${dx}px, ${dy}px) scale(${dw}, ${dh})`;
  element.style.transition = "none";

  // 5. Play — remove the inverted transform to let it animate forward
  requestAnimationFrame(() => {
    element.style.transition = `transform ${duration}ms var(--ease-out-quart)`;
    element.style.transform = "";
  });
});
```

### React with `framer-motion`
```jsx
import { motion, AnimatePresence } from "framer-motion";

// layoutId ties elements across screens — they will travel between renders
<motion.div layoutId="wallet-card-{id}">
  <WalletCard />
</motion.div>
```

---

## Direction-Aware Tab Transitions

```js
const tabs = ["Home", "Activity", "Settings"];
let currentIndex = 0;

function switchTab(newIndex) {
  const direction = newIndex > currentIndex ? 1 : -1;
  currentIndex = newIndex;

  // direction: 1 = slide left, -1 = slide right
  animateSlide(direction);
}
```

```css
.tab-content {
  transition: transform var(--duration-normal) var(--ease-out-quart),
              opacity var(--duration-fast) ease;
}

.tab-content--exit-left  { transform: translateX(-20px); opacity: 0; }
.tab-content--exit-right { transform: translateX(20px);  opacity: 0; }
.tab-content--enter      { transform: translateX(0);     opacity: 1; }
```

---

## Delight Patterns

### Confetti (low-frequency completion moments)
```js
// Use canvas-confetti or tsparticles for lightweight confetti
import confetti from "canvas-confetti";

function celebrateWalletBackup() {
  confetti({
    particleCount: 120,
    spread: 70,
    origin: { y: 0.6 },
    colors: ["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8"],
  });
}
```

### Sound effects (rare, satisfying actions)
```js
// Only play for truly satisfying, infrequent moments (delete, achievement)
async function playTrashSound() {
  const ctx = new AudioContext();
  const response = await fetch("/sounds/trash.mp3");
  const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
}
```

### Shimmer (active/hidden state signal)
```css
@keyframes shimmer {
  0%   { background-position: -200% center; }
  100% { background-position: 200% center; }
}

.stealth-mode-active {
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255,255,255,0.15) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: shimmer 2.5s ease-in-out infinite;
}
```

### Ripple on tap (QR code, easter egg)
```css
@keyframes ripple {
  to { transform: scale(3); opacity: 0; }
}

.ripple-effect::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: rgba(255,255,255,0.3);
  animation: ripple 600ms var(--ease-out-quart) forwards;
}
```

### List reorder with stacking animation
```jsx
// framer-motion approach
<Reorder.Group axis="y" values={items} onReorder={setItems}>
  {items.map((item) => (
    <Reorder.Item key={item.id} value={item}
      whileDrag={{ scale: 1.03, boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      {item.content}
    </Reorder.Item>
  ))}
</Reorder.Group>
```

---

## Reduced Motion Compliance

Always respect `prefers-reduced-motion`. The delight and fluidity principles apply to users who want them. For users who don't:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

In JS:
```js
const prefersReducedMotion = 
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const duration = prefersReducedMotion ? 0 : 250;
```