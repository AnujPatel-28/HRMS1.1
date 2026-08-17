# Dashboard Layouts & Data Visualization — Visual Design Master Reference

Sources: Practical UI · industry practice · UK Data Services BI Dashboard research

---

## Dashboard Layout Principles

A dashboard is a tool for decision-making, not a canvas for data. Every element must earn its place by supporting a specific decision.

### Layout Architecture

**Standard dashboard shell:**
```
┌──────────────────────────────────────────────────┐
│  Sidebar nav (240px)  │  Top bar (header)        │
│                       ├──────────────────────────┤
│  [Logo]               │  KPI row (4 stat cards)  │
│                       ├──────────────────────────┤
│  • Home               │  ┌──────────┐ ┌────────┐ │
│  • Analytics          │  │  Chart   │ │ Chart  │ │
│  • Reports            │  │  (8 col) │ │ (4 col)│ │
│  • Settings           │  └──────────┘ └────────┘ │
│                       ├──────────────────────────┤
│                       │  Table (full width)       │
└───────────────────────┴──────────────────────────┘
```

### The F-Pattern and Z-Pattern for Dashboards

**F-pattern** (text-heavy dashboards): Users scan horizontally across the top, then down the left side. Put the most critical information top-left and along the left column.

**Z-pattern** (data-visual dashboards): Users read top-left → top-right → diagonal → bottom-left → bottom-right. KPIs top, charts in middle, tables at bottom.

### KPI / Stat Cards Row

This is the most common dashboard element — the row of "headline numbers" at the top.

```css
/* KPI stat card */
.stat-card {
  background: white;
  border: 1px solid var(--gray-200);
  border-radius: 12px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stat-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--gray-500);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--gray-900);
  line-height: 1.1;
}

.stat-change {           /* e.g., "+12.4% vs last month" */
  font-size: 12px;
  color: var(--green-600);  /* or red-600 for negative */
  display: flex;
  align-items: center;
  gap: 4px;
}
```

**Four stat cards per row is the golden standard.** Supports 12-col grid naturally (3 cols each).

### Information Hierarchy for Dashboards

1. **Top row:** 3–4 critical KPIs — the most important numbers the user needs to know
2. **Second row:** Primary chart(s) — trend, breakdown, or main visualization
3. **Third row:** Secondary charts or supporting data
4. **Bottom:** Detailed tables, logs, or lists for investigation

---

## Grid Configurations

| Layout type | Column config | Use |
|---|---|---|
| 4 equal KPIs | `repeat(4, 1fr)` | Stat row |
| Main chart + aside | `8fr 4fr` | Primary chart + small secondary |
| Two equal charts | `6fr 6fr` | Peer charts side by side |
| Three charts | `4fr 4fr 4fr` | Equal comparison |
| Full width | `1fr` | Table, detailed view |

```css
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 24px;
}

.span-4  { grid-column: span 4; }
.span-6  { grid-column: span 6; }
.span-8  { grid-column: span 8; }
.span-12 { grid-column: span 12; }
```

---

## Data Visualization

### Chart Type Selection Guide

| Data story | Chart type | When to use |
|---|---|---|
| Trend over time (single series) | Line chart | Revenue over 12 months, signups per week |
| Trend over time (multiple series) | Multi-line or area chart | Compare two metrics over time |
| Part-of-whole | Donut / pie | Only when showing 2–5 categories |
| Comparison across categories | Bar chart (vertical) | Revenue by product, users by country |
| Ranking | Horizontal bar | Long category labels, many categories |
| Distribution | Histogram | User ages, order values, load times |
| Correlation | Scatter plot | Price vs. rating, time on page vs. conversion |
| Progress toward goal | Progress bar / gauge | Quota attainment, KPI targets |
| Single metric status | Stat card | No chart needed for a single number |

**Never use pie/donut for > 5 categories.** The slices become unreadable. Use a bar chart instead.

### Chart Visual Specs

**Colors in charts:**
- Use 1–3 colors maximum for any single chart
- Use your primary brand color for the most important data series
- Secondary series: muted tones that don't compete
- Never use rainbow color schemes — they imply false category equivalence
- Limit the palette: 4 distinct colors max before switching to patterns or labels

```css
/* Chart color palette — limited, harmonious */
--chart-1: #6366f1;   /* Primary (indigo) */
--chart-2: #22d3ee;   /* Secondary (cyan) */
--chart-3: #f59e0b;   /* Tertiary (amber) */
--chart-4: #10b981;   /* Quaternary (emerald) */
--chart-muted: #e2e8f0; /* Baseline / background bars */
```

**Typography in charts:**
- Axis labels: `text-xs text-gray-500` (11–12px)
- Data labels on bars: `text-xs font-medium text-gray-700`
- Chart title: `text-sm font-semibold text-gray-900`
- Legend: `text-xs text-gray-600`
- Tooltip: white background, `shadow-md`, 12–14px

**Grid lines:**
- Horizontal grid lines: `1px solid rgba(0,0,0,0.06)` — very subtle
- No vertical grid lines on bar charts
- Y-axis: no line (just the labels)
- X-axis: subtle `1px solid gray-200`

### Axis and Labels

- Y-axis: human-readable numbers (1K, 10K, 1M — not 1000, 10000, 1000000)
- X-axis: if dates, use consistent format (Jan, Feb, Mar — not January, Feb., 3/15)
- Currency: $ prefix inside chart, in axis label header, not on every data point
- Percentages: % on axis label, not every data point

### Tooltips

Always on hover. Show the exact value (not approximated). Show units clearly.

```
┌──────────────────────┐
│  March 15, 2025      │
│  Revenue: $12,450    │
│  Orders: 234         │
└──────────────────────┘
```
Style: white background, `shadow-md`, 12px `border-radius`, `padding: 10px 14px`

### Empty and Loading States for Charts

**Loading:** Show a skeleton of the chart area — grey bars or lines in the expected positions. Don't show a spinner in the center of an empty chart area.

**Empty (no data):** Show the chart container with axes, but an empty state inside: "No data for this period" + suggestion to change the date range or add data.

**Error:** "Couldn't load this chart" + Retry button. Keep the chart container visible at full height.

---

## Dashboard Anti-Patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| KPIs without context ("Users: 12,453") | Means nothing without comparison | Show change vs. prior period ("↑12% vs. last month") |
| 8+ charts on one screen | Cognitive overload | Prioritize: show 2–4 key charts, link to detail views |
| Pie chart with 8 slices | Unreadable | Use horizontal bar chart |
| Rainbow colored charts | False visual equivalence | Max 4 colors, from a consistent palette |
| Charts sized differently in the same row | Looks unbalanced | All charts in a row share the same height |
| Pure numbers without units | Ambiguous ("12,453" — what?) | Always label: "12,453 users", "$12,453" |
| No loading state | Jarring content-pop | Skeleton loader matching chart shape |
| Chart title the same as the section title | Redundant | Chart title should describe what the data shows |
| Y-axis starting at a value > 0 on a bar chart | Visually misleads proportion | Start Y-axis at 0 for bar charts always |
| Legend below or above chart without clear link to series | User must decode | Color-match legend exactly to series; place close to the lines |