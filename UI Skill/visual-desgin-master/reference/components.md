# Components: Cards, Forms & Tables — Visual Design Master Reference

Sources: Practical UI · Refactoring UI · industry practice

---

## Cards

Cards are the most overused component in modern UI. Used correctly, they group related content clearly. Used incorrectly, they fragment the layout into visual noise.

### When to Use Cards

**Use cards for:**
- Content blocks that are independently navigable (product in a grid, article preview)
- Dashboard widgets that can be rearranged or dismissed
- Items in a collection where each item needs clear boundaries

**Don't use cards for:**
- Every section of a form (over-nesting creates confusion)
- Lists of similar items that would be better as rows
- Page regions that are just structural layout (sidebar, header area)

### Card Anatomy

```
┌─────────────────────────────┐   ← Card container
│  [Image / media area]       │      border-radius: 10–12px
│                             │      padding: 16–24px
│  Card title        ───────  │      background: white
│  Supporting text            │      shadow: shadow-sm
│                             │
│  Metadata · Metadata        │   ← Footer area
│                    [Action] │
└─────────────────────────────┘
```

### Card Visual Specs

```css
.card {
  background: white;
  border-radius: 12px;          /* Consistent with your system */
  padding: 20px 24px;
  box-shadow: var(--shadow-sm);  /* OR border, not both */
  /* border: 1px solid var(--border-default); */
}
```

**Separation methods (pick one):**
- Shadow only (`shadow-sm`) — floating, elevated feel
- Border only (`1px solid gray-200`) — flat, structured feel
- Background color only (`gray-100` background on `gray-50` page) — minimal feel
- Never: shadow + border + background all together — triple decoration

### Card Sizes

| Card variant | Padding | Radius | Shadow |
|---|---|---|---|
| Compact (dashboard stat) | 12px 16px | 8px | xs |
| Standard (content card) | 16px 20px | 10px | sm |
| Featured (hero card) | 24px 28px | 12px | md |
| Full-width section | 24px 32px | 12–16px | sm or none |

### Card Grid Layout

```css
/* Auto-responsive — no breakpoints needed */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}

/* 3-column on desktop */
.card-grid--3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

/* Constrain max card width so wide cards don't look sparse */
.card { max-width: 480px; }
```

### Card Anti-Patterns

- Card inside a card (nested rounding) — breaks depth hierarchy
- Card with no visible action — where does the user tap?
- Card grid where cards vary wildly in height — use `align-items: start` not `stretch` in many cases
- Full-width card that could be a page section — cards imply individual items

---

## Forms

Forms are where users are most likely to fail. Every design decision either increases or decreases completion rate.

### Label Placement

**Always above the field.** Never use placeholder-only labels.

```html
<!-- ✅ Correct -->
<label for="email">Email address</label>
<input id="email" type="email" placeholder="you@example.com">

<!-- ❌ Wrong — placeholder disappears on focus -->
<input id="email" type="email" placeholder="Email address">
```

- Label: `text-sm font-medium text-gray-700`
- Helper text: below field, `text-xs text-gray-500`
- Error message: below field, `text-xs text-red-600`

### Input Visual Specs

```css
.input {
  width: 100%;
  padding: 10px 14px;             /* 10px vertical minimum */
  font-size: 14–16px;
  border: 1px solid var(--gray-300);
  border-radius: 8px;
  background: white;
  color: var(--gray-900);
  transition: border-color 150ms, box-shadow 150ms;
}

.input::placeholder { color: var(--gray-400); }
.input:hover        { border-color: var(--gray-400); }
.input:focus        {
  outline: none;
  border-color: var(--primary-500);
  box-shadow: 0 0 0 3px var(--primary-100);
}
.input.error        {
  border-color: var(--red-500);
  box-shadow: 0 0 0 3px var(--red-100);
}
```

### Form Layout

**Single column** unless there is a clear, natural reason for two columns. Multi-column forms increase scanning complexity and completion time.

Natural two-column groupings:
- First name | Last name
- City | State
- Card month | Card year

Unnatural two-column groupings:
- Email | Phone (these are logically separate)
- Username | Password (same)

**Field width should communicate expected input length:**
- Full width: email, name, address, message
- 50% width: city, date
- 30% width: zip, state, country code
- 20% width: quantity

### Field Grouping and Spacing

```
Label
Input field                ← 4px gap between label and field

Error message              ← 6px below field if error

                           ← 20–24px between fields in same group
Next field label
Next field

                           ← 32px between groups (billing vs shipping)
Next section heading
```

### Form Validation

- **Inline, below each field** — not a summary at the top
- **Show on blur** (when field loses focus) — not as the user types (too aggressive)
- Keep the error message short and actionable: "Enter a valid email address" not "Error: email validation failed"
- Color (`red-600`) + icon (⚠) + text — never color alone

### Buttons in Forms

- Primary submit button: full-width on mobile, auto/fixed width on desktop
- Destructive action (Delete, Cancel): always visually different from the primary (outlined or text button style)
- Disable the submit button after first click to prevent double submission
- Loading state: spinner inside the button, label becomes "Saving..." — don't disable the entire form

### Form Section Headers

For long forms (> 5 fields), divide with clear section headers:

```
─────────────────────────
Personal Information
─────────────────────────
[Fields]

─────────────────────────
Payment Details
─────────────────────────
[Fields]
```

Section header style: `text-base font-semibold text-gray-900` + full-width top border `1px solid gray-200`

---

## Tables

Tables are among the most information-dense UI components. Small improvements compound significantly.

### Alignment Rules (Absolute)

| Content type | Alignment |
|---|---|
| Text (names, descriptions) | Left |
| Numbers, currency | Right |
| Status badges, icons | Center |
| Actions (Edit, Delete) | Right (trailing) |
| Checkboxes | Left (leading) |
| Date/time | Left or right (be consistent) |

**Why right-align numbers:** Decimal points and digits align vertically, making comparison immediate. Left-aligned numbers look like text, not data.

### Table Visual Structure

```css
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

th {
  text-align: left;
  padding: 10px 16px;
  background: var(--gray-50);
  border-bottom: 1px solid var(--gray-200);
  font-size: 12px;
  font-weight: 600;
  color: var(--gray-500);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--gray-100);
  color: var(--gray-900);
  vertical-align: middle;
}

tr:hover td { background: var(--gray-50); }
tr:last-child td { border-bottom: none; }
```

### Table Hierarchy

Primary column (name, title, ID): `font-medium text-gray-900`  
Secondary columns (metadata, dates): `text-gray-600`  
Tertiary (timestamps, IDs, references): `text-gray-400 text-xs`

### Status Badges in Tables

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 9999px;    /* Pill shape */
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.badge--success { background: var(--green-50);  color: var(--green-700);  }
.badge--warning { background: var(--amber-50);  color: var(--amber-700);  }
.badge--error   { background: var(--red-50);    color: var(--red-700);    }
.badge--neutral { background: var(--gray-100);  color: var(--gray-600);   }
```

### Empty State in Tables

```
┌────────────────────────────────┐
│  Col 1   Col 2   Col 3         │  ← Always keep the header visible
├────────────────────────────────┤
│                                │
│    📭                          │
│    No results found            │  ← Clear title
│    Try adjusting your filters  │  ← Actionable suggestion
│    [Clear filters]             │  ← CTA
│                                │
└────────────────────────────────┘
```

### Responsive Tables

On mobile, data tables cannot be scrolled horizontally without extra design work:

**Option 1:** Horizontal scroll within a `overflow-x: auto` container — simple, keeps table structure
**Option 2:** Card-based mobile view — each row becomes a card with label + value pairs
**Option 3:** Column prioritization — hide less-important columns on mobile with `hidden md:table-cell`

Never let a table overflow the viewport with no affordance for the hidden content.