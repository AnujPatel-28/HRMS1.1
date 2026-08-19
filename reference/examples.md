# Before / After Examples from Family

These are direct examples from Benji Taylor's essay — the "without" state and what Family does instead. Use these to understand the spirit of each principle.

---

## Simplicity Examples

### Onboarding with many paths
- **Without tray system:** User sees all paths at once, full-screen modal stack, disorienting
- **Family approach:** Stacked card animation shows the journey map. User picks a path. Trays progressively reveal each step. At every point, user knows where they are in the flow.

### Swap approval
- **Without:** Full-screen modal pops in from nowhere. Context (the swap screen) is gone.
- **Family approach:** The approval tray *emerges from the swap interface itself*. The user never left the swap screen — they dived deeper into it.

### Tutorial on first use of a feature
- **Without:** Separate tutorial screen before letting the user in.
- **Family approach:** Tutorial is woven into the first tray shown for that feature. It disappears naturally once dismissed, never to return.

---

## Fluidity Examples

### Tab switching
- **Without:** Content snaps to new tab instantly.
- **Family approach:** Flash of directional motion. Left tab → transition slides left. Right tab → transition slides right. User builds a mental map of where things live.

### Chevron in multi-step flow
- **Without:** Chevron (›) icon on screen A is statically replaced by different icon on screen B.
- **Family approach:** The chevron rotates and transforms (› → ‹) as part of the view transition. A tiny detail that confirms the navigation direction.

### Continue → Confirm button
- **Without:** Button label snaps from "Continue" to "Confirm" — user might not even notice.
- **Family approach:** Text morphs. "Con" stays planted. "-tinue" slides out upward. "-firm" slides in from below. The change is unmistakable, non-jarring, and confirms the user is taking a more serious action.

### Wallet grouping / sorting
- **Without:** Addresses rearrange instantly. Before → after, no animation. User isn't sure what changed.
- **Family approach:** Addresses visually move themselves into their new positions. The grouping is immediately understood because the user *watched it happen*.

### Send flow (entering → confirming amount)
- **Without:** Input screen with "1.5 ETH" dissolves. Confirmation screen appears with "1.5 ETH". User has to re-read to confirm they match.
- **Family approach:** The amount travels from the input screen to its position on the confirmation screen. The user knows with certainty that the amount being confirmed is the amount they entered. Trust is built through motion.

### Post-transaction spinner
- **Without:** Transaction completes. User doesn't know where to check status.
- **Family approach:** A spinner animates from the confirmation button into the bottom navigation bar, moving to land on the Activity tab. It visually tells the user "your transaction is now here."

### Speed-up transaction
- **Without:** Confirming a speed-up navigates away from the pending tray.
- **Family approach:** The speed-up spinner flies from the confirmation into the original pending tray. The user sees the speed-up being *applied* to the original transaction rather than creating a new one.

### Wallet cards
- **Without:** Wallet card in list view disappears; a card appears in detail view.
- **Family approach:** The wallet card *travels* from the list to the detail view via shared element transition. No duplication, no disappear/reappear.

### Price charts
- **Without (Cash App example):** Switching time ranges snaps the chart to a new state.
- **Family approach:** Chart morphs between states with a fluid transition. Perception of speed actually increases because the transition is smooth rather than disorienting.

---

## Delight Examples

### Wallet creation (very low frequency)
- **Without:** "Your wallet has been created. Continue →"
- **Family approach:** Interactive animation marks the occasion. The moment is made memorable. Because users do this rarely (sometimes only once), the theatrical treatment is appropriate and won't become annoying.

### QR code screen (low frequency, used enough to reward discovery)
- **Easter egg 1:** Tap the QR code → gentle ripple effect emanates from the tap point.
- **Easter egg 2:** Swipe finger across QR code → dots transform into a sequin-like pattern.
- The feature is used "just enough to make an easter egg placed here enjoyable rather than annoying."

### Token number input (high frequency — light delight only)
- Commas in the number shift position visually as digits are added (1,000 → 10,000).
- Deliberately light. Daily use means anything heavier would quickly irritate.

### Exceeding maximum balance (contextual easter egg)
- When the user enters an amount larger than their balance, a surprise easter egg plays.
- Keeps high-frequency features from feeling corporate without overloading them.

### Token deletion (infrequent)
- Tokens and collectibles visually tumble into a skeuomorphic trash can.
- A satisfying sound effect plays on completion.
- Skeuomorphism is used *here*, not everywhere — its rarity makes it land.

### In-app browser first open (once per user)
- Empty state has an animated arrow guiding the user toward creating their first tab.
- Transforms an empty screen from a dead end into an invitation.

### Token reorder (infrequent)
- Smooth drag-and-drop with attractive stacking animations (cards stack behind the dragged item).
- Reordering becomes "satisfying rather than tedious."

### Stealth mode (infrequent toggle)
- A gentle shimmer persists across the holdings while stealth mode is active.
- Signals that values are hidden but still updating — an ambient animation that communicates state rather than merely decorating.

### Chart scrubbing (regular interaction)
- Scrubbing left/right visibly flips a direction arrow up or down in sync with the price movement.
- Small, responsive, always correct. Adds to the feeling that the interface is in sync with the user's intention.

### Wallet backup (rare achievement)
- Confetti briefly fills the screen after a successful backup.
- Rewards completing an important security task in a way that feels like a celebration, not a notification.

---

## The Test: Remove It

Benji Taylor temporarily removed animations from Family's most important flows to demonstrate their value. The results:

| Feature | Without animation | With animation |
|---|---|---|
| Swap approval tray | Context is lost; feels like a new screen | Connection is maintained; feels like diving deeper |
| Wallet grouping | "Digital whiplash" — the change is invisible | Movement explains itself; grouping is immediately understood |
| Send flow (confirm) | User must re-read to verify amount | Amount travels to confirmation screen; trust is built visually |

If removing the animation makes the interaction feel worse or less clear — the animation belongs.
If removing it makes no difference — reconsider adding it at all.