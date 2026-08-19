---
name: family-values-design
description: >
  Design skill based on Benji Taylor's "Family Values" essay (benji.org/family-values) — the philosophy behind Family, a crypto wallet praised for its uniquely polished, human feel. Encodes three interlocking principles: Simplicity (progressive disclosure through tray systems, one action at a time), Fluidity (every element can transform into another, avoid static transitions, shared element continuity), and Delight (selective emphasis via the Delight-Impact Curve — the less frequent the feature, the more theatrical the moment). Use this skill whenever the user wants to build or redesign any UI — web, mobile, or component-level — and wants it to feel intentional, alive, and genuinely cared for rather than assembled from a component library. Trigger especially when the user says things like "make it feel polished", "add nice animations", "make it feel premium", "make it feel like a real app", "improve UX", or "make transitions smooth". Also use for any mobile-first UI, wallet/fintech UI, onboarding flows, and any multi-step interaction design.
---

# Family Values Design Philosophy

Based on Benji Taylor's essay documenting the design of *Family*, a self-custody crypto wallet that became widely celebrated for its feel and sensibilities. The essay is at benji.org/family-values.

Three principles define this approach: **Simplicity**, **Fluidity**, and **Delight**. They are not independent — they interlock. Simplicity makes room for fluidity; fluidity makes the path feel coherent; delight makes users feel valued.

> "This is about how we made something complex feel welcoming."

---

## Principle 1 — Simplicity: Gradual Revelation

### The Core Idea

Don't present everything at once. Surface features as they become relevant. Overwhelming a user is a design failure, not a feature.

> "Family has hundreds of potential paths, requiring intentional design to achieve simplicity."

### The Dynamic Tray System

The primary pattern for achieving simplicity. Trays are contextual containers that appear, expand, contract, and dismiss in response to user actions — rather than replacing the entire screen.

**Rules for trays:**

1. **User-initiated.** Trays are triggered by tapping buttons, icons, or push notifications — never auto-shown without a clear cause.

2. **Overlay, don't replace.** Trays appear *on top of* the current screen, preserving context. Unlike full-screen transitions, the user knows exactly where they came from.

3. **Vary heights between steps.** When presenting a sequence of trays, each must differ in height from the last. This makes it visually unmistakable that something new has happened.

4. **One thing per tray.** Each tray is dedicated to a single piece of content (educational text, a warning) or a single action (confirming a step, completing a checklist). Never bundle multiple decisions.

5. **Title + dismiss/back icon always present.** Every tray has a brief descriptive title and an icon that either dismisses the tray (first in a sequence) or navigates back (subsequent trays).

6. **Theme adapts to context.** A tray inside a dark-themed flow uses a darker colour scheme. Trays are contextually aware.

7. **Trays can launch full-screen flows.** A tray can be the entry point for a more elaborate flow. It starts compact, then expands.

**When to use trays vs full-screen:**
- **Tray:** transient actions, confirmations, warnings, educational overlays, step-by-step sequences
- **Full-screen:** destinations the user returns to, primary navigation targets, flows with many steps that need full attention

### The Mental Model: Rooms in a House

> "Imagine seeing parts of a room through an open doorway. As you approach and enter, the space and its contents are gradually revealed."

Design the interface like a series of interconnected rooms. As the user acts, the space unfolds around them. They are never surprised by where they are — they watched themselves get there.

### Cognitive Load as a Design Metric

Treat complexity as debt. Every decision forced on the user without context is friction. The interface should always know *where the user is in their journey* and show only what belongs at that moment.

---

## Principle 2 — Fluidity: Seamless Transitions

### The Core Idea

Every element in the interface can theoretically transform into any other, given a strong enough rationale. Nothing teleports. Nothing duplicates. Everything moves with purpose.

> "My definition of a fluid interface is akin to moving through water — you float rather than walk through it."

> "We fly instead of teleport."

### Rule: Avoid Static Transitions

Static = lifeless. A product with no transitions "feels like a dead product, and a dead product feels uncared for."

Every transition between screens, states, or components should express what happened — where the user came from, where they are going, and why.

### The Specific Patterns

#### Direction-aware navigation
When switching tabs or sections, the transition direction should reflect the spatial layout:
- Tap left tab → transition moves left
- Tap right tab → transition moves right

This creates a "mental map" of the UI. Users develop a spatial intuition. They know where things live.

#### Shared element continuity (the single most important technique)
If a component exists on screen A and will also exist on screen B, it should travel between them — not disappear and reappear. A wallet card, an amount, a button — if it persists, it moves.

> "If a component occupies a space and will persist in the next phase of the user's journey, it should remain consistent."

Apply to:
- Cards moving between list and detail view
- Amounts moving from input to confirmation screen
- Partial text that doesn't change ("Add 1 wallet" → "Add 2 wallets" — only the number and suffix travel)

**Never duplicate a visible component during an animation.** If it's already on screen, it shouldn't flash away and reappear — it should morph or move.

#### Text morphing (torph)
When a button label changes — "Continue" → "Confirm" — don't swap it instantly. Morph it. Shared letters between the two words animate in place; new letters arrive; departing letters leave. This signals to the user that something has shifted, making the transition noticeable but smooth.

> "We visually morph the text. This highlights the transition in a way that's both noticeable and smooth."

Shared prefix logic: "Con" in Continue and Confirm stays planted; the differing suffixes animate in/out.

Apply text morphing to:
- Button label changes in multi-step flows
- Counter text that updates ("Add 3 wallets", "3 items selected")
- Any UI text that changes meaning while the surrounding component persists

#### Micro-transitions compound
Small animations don't feel small in aggregate. A chevron rotating as the user drills into a screen is tiny individually. Across hundreds of interactions, it builds a feeling of care.

> "Details such as this contribute to a sense of fluidity throughout the app and quickly compound over time."

Look for opportunities at the component level: icon state changes, input focus, list reordering, toggles.

#### The easing signature
Use a single, deliberate cubic-bezier easing curve across all transitions (e.g. `cubic-bezier(0.34, 1.56, 0.64, 1)` for springy, or a custom ease-out for directional motion). Consistency in easing makes transitions feel like they belong to the same physical world.

### The Test: Remove It

To validate whether a transition is adding value, remove it temporarily. If the result "feels like digital whiplack" or the contextual connection is lost, the animation belongs. If the result is barely different, reconsider.

> "With the animation removed, the sense of connection is lost and the contextual continuity is gone."

Use this test especially on: swap/approval flows, onboarding sequences, data grouping animations, send/confirm screens.

### What Fluidity Is NOT
- Motion for decoration
- Transitions that play while the user waits
- Animations that obscure what happened (the opposite of their purpose)
- Random or inconsistent easing/timing across components

---

## Principle 3 — Delight: Selective Emphasis

### The Core Idea

Delight is not about adding fun. It's about making software feel human — that someone cared enough about *this specific moment* to make it special.

> "Delight is more than just adding fun interactions. It's about creating moments that resonate on a personal level — making software feel more human and responsive."

### The Delight-Impact Curve

The less frequently a feature is used, the *more* theatrical its delightful moment should be.

```
  HIGH
   │         ╭─────
   │        ╱
   │       ╱
Delight   ╱
 Impact  ╱
   │    ╱
   │   ╱
  LOW  ──────────────
       High         Low
       Frequency    Frequency
```

**Frequently used features:** Light delight only. Small micro-interactions, elegant transitions. Anything heavier becomes annoying fast.
- Example: commas shifting position as a number is typed

**Infrequently used features:** Go theatrical. An animation, a sound, a confetti moment. The user won't experience it often enough for it to become irritating — and the surprise compounds the delight.
- Example: confetti after a wallet backup (important but rare)
- Example: items tumbling into a skeuomorphic trash can with a sound effect

### Delight Patterns from Family

| Feature | Frequency | Delight Pattern |
|---|---|---|
| Token input (daily) | High | Commas shift position as numbers grow |
| Tab navigation (daily) | High | Direction-aware slide transition |
| Send flow (regular) | Medium | Full text morphing at confirmation |
| Wallet creation (once) | Very low | Interactive animation marks the occasion |
| QR code screen | Low | Tap = ripple; swipe = sequin transformation |
| In-app browser first open | Low | Animated arrow guides toward first action |
| Token reorder | Low | Smooth drag-and-drop with stacking animations |
| Stealth mode activation | Low | Gentle shimmer that persists while active |
| Backing up wallet | Very low | Confetti burst after completion |
| Deleting tokens | Rare | Items tumble into skeuomorphic trash can + sound |

### Easter Eggs
Place them where the feature is used *just enough* that discovery feels like a reward, not a nuisance. Avoid placing easter eggs in critical flows.

> "The feature is used just enough to make an easter egg placed here enjoyable rather than annoying."

### Polish Everywhere
Users notice when any part of an app is less polished — it poisons the whole.

> "Like going to a fancy restaurant but finding it has a dirty bathroom."

Every part of the app must achieve a consistent baseline of polish *before* adding delight. Delight is not a substitute for polish — it sits on top of it.

Ensure: loading states, empty states, error states, and edge-case screens are all considered. An animated arrow in an empty state is a small detail that signals care.

---

## Putting It Together: Implementation Checklist

When building any UI component or flow using this philosophy, run through this:

### Simplicity check
- [ ] Is the user being shown *only* what they need right now?
- [ ] Should this be a tray (transient, contextual) or a full screen (primary destination)?
- [ ] Does each tray have: one action/concept, a title, a dismiss/back icon?
- [ ] If it's a sequence of trays, does each one differ in height?
- [ ] Is context preserved? Does the user know where they came from?

### Fluidity check
- [ ] Are there any static transitions between related screens? If so, can they be animated?
- [ ] Do any components persist between screens but currently disappear/reappear? → Make them travel.
- [ ] Are there any button labels that change during a flow? → Implement text morphing.
- [ ] Is the easing curve consistent across all transitions?
- [ ] Are navigation transitions direction-aware?
- [ ] Run the "remove it" test: does removing the animation feel worse?

### Delight check
- [ ] What is the frequency of this feature? (daily / weekly / monthly / once)
- [ ] Does the delight intensity match the Delight-Impact Curve?
- [ ] Is this feature currently a "dirty bathroom" — functional but unfinished feeling?
- [ ] Is there an opportunity for a subtle easter egg? Is the feature used enough to reward discovery without becoming annoying?
- [ ] If there's a satisfying completion moment (backup, delete, milestone) — is there an appropriate payoff (confetti, sound, animation)?

---

## References

See `references/patterns.md` for specific code patterns, easing values, and implementation notes.
See `references/examples.md` for concrete before/after descriptions of each interaction from the blog.