# Design Skill Router

## Purpose

This repository contains multiple specialized design skills.

Each skill has a single responsibility.

Whenever you need design guidance, first determine the type of design problem, then load only the skill that is responsible for that area.

Do not mix responsibilities between skills unless a task genuinely requires multiple domains.

Always prefer the most specialized skill over general assumptions.

---

# Skill Responsibilities

## 1. Family Values

**Responsibility**
Product philosophy and design principles.

This skill defines **why** the product should be designed a certain way.

Use this skill whenever the task involves:

- Product philosophy
- User experience principles
- Emotional design
- Product personality
- Simplicity vs complexity
- Interaction philosophy
- User trust
- Product consistency
- Overall product feel
- Design decision trade-offs
- When deciding what experience is best for users

Typical questions include:

- How should the product feel?
- What emotion should users experience?
- Should this be simplified?
- What interaction philosophy should be followed?
- How should motion contribute to the experience?

This skill establishes the design direction before implementation.

---

## 2. Apple Human Interface Guidelines (Apple HIG)

**Responsibility**
Interaction design and UX patterns.

This skill defines **how users interact with the interface**.

Use this skill whenever you need guidance for:

- Navigation
- Information architecture
- Buttons
- Cards
- Lists
- Tables
- Forms
- Search
- Filters
- Menus
- Dialogs
- Modals
- Bottom sheets
- Context menus
- Toolbars
- Tabs
- Gestures
- Scrolling behavior
- Selection patterns
- Drag and drop
- Keyboard interactions
- Loading states
- Empty states
- Error states
- Success states
- Haptics
- Motion behavior
- Interaction animations

Whenever you're unsure how an interaction should behave, this is the primary reference.

This skill focuses on usability rather than visual styling.

---

## 3. Visual Design Master

**Responsibility**
Visual design and interface aesthetics.

This skill defines **how the interface should look**.

Use this skill whenever the task involves:

- Typography
- Font hierarchy
- Layout
- White space
- Spacing systems
- 4px / 8px grid
- Color systems
- Brand colors
- Shadows
- Borders
- Corner radius
- Icons
- Visual hierarchy
- Dashboard layouts
- Cards
- Tables
- Forms
- Charts
- Data visualization
- Dark mode
- Visual consistency
- Premium UI
- Polish
- Professional appearance

Typical questions include:

- How can this UI look more premium?
- How should spacing be improved?
- Which typography hierarchy should be used?
- How should colors be balanced?
- How can visual clutter be reduced?

This skill is responsible for the overall visual quality of the interface.

---

## 4. Material Design 3

**Responsibility**
Component specifications, accessibility, scalability, and adaptive behavior.

This skill defines **how components should behave across different devices and accessibility scenarios**.

Use this skill whenever the task involves:

- Accessibility
- WCAG compliance
- Design tokens
- Elevation
- Motion specifications
- Responsive layouts
- Adaptive layouts
- Component specifications
- Component states
- Hover
- Focus
- Pressed
- Disabled
- Navigation rails
- Navigation drawers
- FABs
- Snackbars
- Dialogs
- Chips
- Menus
- Sheets
- Component behavior
- Cross-device layouts
- Large screens
- Tablet layouts

Whenever you're implementing reusable UI components or ensuring accessibility, this is the primary reference.

---

# Skill Selection Guide

Use the following decision tree:

**Need product philosophy?**
→ Family Values

**Need interaction or UX behavior?**
→ Apple Human Interface Guidelines

**Need visual polish or premium aesthetics?**
→ Visual Design Master

**Need accessibility, component specifications, responsive behavior, or design system guidance?**
→ Material Design 3

---

# Combining Skills

Some tasks require multiple skills.

Use them in the following order:

1. Family Values
2. Apple Human Interface Guidelines
3. Visual Design Master
4. Material Design 3

This order ensures that:

- Product philosophy is established first.
- Interaction patterns are designed second.
- Visual design is refined third.
- Accessibility, responsiveness, and component specifications are validated last.

Never substitute one skill for another when a dedicated skill exists.

Always consult the most relevant specialized skill before making design decisions.