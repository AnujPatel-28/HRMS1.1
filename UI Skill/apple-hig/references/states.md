# States: Empty, Error & Loading — Apple HIG Reference

Source: developer.apple.com/design/human-interface-guidelines/loading  
         developer.apple.com/design/human-interface-guidelines/empty-states

A blank screen with no guidance is a UX failure. Every possible state — loading, empty, error — must be designed. These are not edge cases. They are part of the core experience.

---

## Empty States

An empty state appears when a list or content area has no items yet.

### What every empty state must include
1. **An image or icon** — system SF Symbol or custom illustration that visually represents the category
2. **A headline** — explains what this space is for ("No Messages Yet", "Your Library is Empty")
3. **Supporting text** — brief explanation of what happens here ("Messages from friends will appear here")
4. **A primary action** — a button that gets the user started ("Send a Message", "Add Your First Item")

### What empty states must NOT do
- Show a blank screen or only a message with no path forward
- Apologize: "Sorry, nothing here yet" — just tell the user what to do
- Explain technical reasons for emptiness ("Data hasn't synced yet")
- Use error-like framing for a normal first-run state

### Patterns for different empty state causes

**First run (user hasn't created anything yet):**
- Welcoming, inviting tone
- Strong visual: illustration, not a tiny icon
- Single clear CTA to get started
- Optional: brief explanation of the value

**Filtered to zero results:**
- "No results for 'query'" — show the actual search term
- Suggest broadening the search or clearing filters
- Do not show a generic "nothing here" — be specific to what they searched/filtered

**Waiting for others (e.g., a shared space with no collaborators yet):**
- Explain that the space will populate when others join
- Offer an action to invite or share

**SwiftUI:**
```swift
// In a List or ScrollView when items is empty
if items.isEmpty {
    ContentUnavailableView(
        "No Messages",
        systemImage: "message",
        description: Text("Your conversations will appear here.")
    )
}

// For search with no results:
ContentUnavailableView.search(text: query)
```

---

## Loading States

Loading states tell the user the app is working and they should wait.

### Principles
- Show a loading indicator **immediately** when work starts — within one frame of the user's action
- Never show a blank screen while loading — it reads as frozen or crashed
- Use optimistic updates where possible: show the expected result immediately and reconcile after

### Loading Indicator Types

**ProgressView (spinner):**
- Use for indeterminate loading (unknown duration)
- Centered in the space that will contain the content
- Label optional ("Loading messages…") for slower operations

```swift
ProgressView()                              // Indeterminate spinner
ProgressView("Syncing…")                    // With label
ProgressView(value: 0.6, total: 1.0)       // Determinate progress bar
```

**Skeleton screens:**
- Show the shape of incoming content as grey placeholder blocks
- Animate with a shimmer sweep from left to right
- Match the layout exactly — don't show a generic skeleton that doesn't resemble the real content
- Replace skeleton with real content via a cross-fade (not a jump-cut)

**Progress bar:**
- Use when you know the percentage complete (file upload, multi-step onboarding)
- Pair with a text label showing percentage or step count
- Never fake progress — don't advance the bar faster than actual progress

**Pull-to-refresh:**
- Standard for lists that update manually
- Use `.refreshable {}` in SwiftUI — it shows a system spinner and handles timing

### When to block vs. background load
- **Block (show loading over content):** first load with no cached data, critical content that can't be partially shown
- **Background (show stale content while refreshing):** subsequent refreshes, non-critical updates
- **Never block for >10 seconds** without giving the user a way to cancel or try again

### Loading Don'ts
- Don't show a spinner with no indication of progress for operations >3 seconds — add a label
- Don't disable all interaction while loading in the background
- Don't flash a loading state for operations <200ms — it's jarring. Show loading only if the operation might take longer

---

## Error States

Error states appear when something goes wrong. The goal is to explain what happened and give the user a clear path forward.

### Error State Anatomy
1. **Icon** — `exclamationmark.triangle` or `wifi.slash` — contextually appropriate SF Symbol
2. **Title** — What went wrong, in plain terms: "Can't Load Messages", "No Internet Connection"
3. **Body** — One sentence: why this happened and what to do ("Check your connection and try again")
4. **Action** — A button to retry: "Try Again", "Check Settings", "Reload"

### Writing Error Messages

**Bad:**
- "Error 403: Forbidden" — technical, not actionable
- "Something went wrong" — vague, tells the user nothing
- "Request failed with status code 500" — developer-facing, not user-facing
- "We're sorry, an error occurred" — apology without action

**Good:**
- "Can't Connect to Server" → "Check your internet connection and try again." → [Try Again]
- "Payment Declined" → "Your card was declined. Update your payment method to continue." → [Update Payment]
- "Photo Upload Failed" → "The file is too large. Reduce the image size and try again." → [Choose Different Photo]

**Template: [What happened] → [Why / What it means] → [What to do]**

### Error State Patterns

**Network error (offline):**
```swift
ContentUnavailableView(
    "No Internet Connection",
    systemImage: "wifi.slash",
    description: Text("Check your connection and try again.")
) {
    Button("Try Again") { retry() }
}
```

**Content not found (404-equivalent):**
- "This item no longer exists" + back/home button

**Permission denied:**
- Explain exactly which permission is needed and why
- "Messages requires access to your contacts to find friends."
- Provide a button that opens Settings directly: `UIApplication.openSettingsURLString`

**Auth error (session expired):**
- Don't show an error — redirect to sign in with context: "You've been signed out. Sign in to continue."

### Inline Validation (Form Errors)
- Show validation errors **below the specific field**, not in an alert
- Show errors after the user leaves a field (on blur), not as they type
- Error text: red, `.caption` size, paired with a red border on the field
- Success state: optional green checkmark for important fields (password strength, unique username)

### Error Don'ts
- Don't use alerts for errors the user can fix in-context (inline is better)
- Don't dismiss an error state automatically without the user taking action
- Don't show a red banner toast for errors the user caused (e.g., invalid form input) — use inline validation
- Don't lose the user's data when showing an error — preserve form inputs across error states