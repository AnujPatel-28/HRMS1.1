# Navigation — Apple HIG Reference

Source: developer.apple.com/design/human-interface-guidelines/navigation-and-search

---

## Navigation Patterns

iOS uses three primary navigation models. Choose based on your content's structure — don't mix patterns on the same level.

### 1. Hierarchical (Stack) Navigation
**Use when:** Content has a clear parent → child relationship (Settings → Display → Brightness).

- Navigate forward by pushing views onto a navigation stack
- Navigate backward with the Back button (top-left, shows previous screen title) or edge swipe
- Never remove or hide the back button — it is how users orient themselves
- Large titles appear on root screens and collapse to inline on scroll
- The navigation bar title should match the destination, not the action that got there

**Rules:**
- Back button label = title of the previous screen, truncated if needed
- Use disclosure indicators (›) to signal drill-down paths
- Don't use push transitions for modally-presented content (use sheet instead)
- Navigation stacks can be nested inside sheets, but keep depth shallow

### 2. Flat Navigation (Tab Bar)
**Use when:** App has 2–5 peer top-level sections users switch between frequently.

**Tab bar rules (critical):**
- 2–5 tabs maximum on iPhone. If more destinations exist, use a "More" tab (5th position)
- Each tab = a distinct top-level *destination* with its own world of content
- Tabs are for **navigation**, not **actions** — a "+" or "Scan" tab is an anti-pattern
- The tab bar is always visible throughout the app, **except** when a modal sheet is open
- Never change the selected tab programmatically — only the user selects tabs
- Never use a tab bar and a toolbar together at the bottom of the same view
- Tapping an already-selected tab scrolls that tab's content back to the top

**iOS 26 (Liquid Glass):** Tab bar is now an inset floating capsule with Liquid Glass material. Search is a separate circular element to the right. Content scrolls visually beneath it.

**Tab label guidelines:**
- Single word only: "Home", "Search", "Library" — not "Your Library" or "Browse Music"
- Use SF Symbols for icons; fill variant for selected, outline for unselected
- Add badges (red dot or count) for unread/pending counts — never for decorative purposes

**iPad:** Replace the bottom tab bar with a sidebar (NavigationSplitView). Sidebar shows labels and icons. Tab bar is still valid for compact-width iPad (e.g., slide-over panel).

### 3. Content-Driven / Experience Navigation
**Use when:** Content IS the navigation — photo galleries, readers, onboarding flows.

- Horizontal swipe between siblings (Photos: swipe left/right between images)
- Page controls for finite, ordered sets of content
- No persistent back button — contextual close/done button suffices

---

## Navigation Bar

The top bar that appears in hierarchical navigation.

**Anatomy:**
- Left: Back button (previous screen title) or Cancel/Close for modals
- Center: Screen title (inline) or nothing (for large title screens)
- Right: Up to 2–3 action buttons using SF Symbol icons

**Large titles:**
- Used on root/list screens (Mail inbox, Settings root)
- Collapse to inline title on scroll — this is system behavior, don't override
- Large title = `navigationBarTitleDisplayMode(.large)` in SwiftUI

**Rules:**
- Don't put a custom close button in both left and right corners simultaneously
- Modal screens use "Done" (right) + "Cancel" (left) or a single "Done" on the right
- Destructive modal confirmation: "Done" should be blue; destructive action in the body, not nav bar

---

## Modal Presentation

Modals focus attention on a self-contained task. The user must take an action to dismiss.

**When to use a modal:**
- The user needs to complete a task before returning (compose email, create event)
- The content is loosely related to but not part of the main flow
- The task requires full attention (payment confirmation, permission requests)

**When NOT to use a modal:**
- For primary navigation between app sections (use tab bar)
- For displaying information the user will simply read (use push navigation)
- For drill-down content that belongs in the hierarchy

**Dismissal rules (non-negotiable):**
- Every modal must have a clear, visible dismiss path
- "Cancel" must never directly discard user data — always show a confirmation ("Discard changes?")
- In an alert, Cancel must never be the destructive action
- Swipe-to-dismiss (drag down) must be supported for sheets unless content would be lost

**Full-screen modal vs. sheet:**
- Sheet (default): for tasks that can be abandoned easily, resizable, swipeable
- Full-screen: for immersive tasks where accidental dismiss would be harmful (camera, video recording)

---

## Routing Decisions: Quick Reference

| Situation | Pattern |
|---|---|
| Drilling into detail of a list item | Push (NavigationStack) |
| Top-level app sections (2–5) | Tab bar |
| Transient task (compose, create, edit) | Sheet |
| Blocking decision required | Alert or full-screen modal |
| Contextual options menu | Context menu or action sheet |
| Quick option selection | Menu (UIMenu / .contextMenu) |
| Warning before destructive action | Alert with destructive button |
| Onboarding / first-run | Full-screen modal or page-based flow |