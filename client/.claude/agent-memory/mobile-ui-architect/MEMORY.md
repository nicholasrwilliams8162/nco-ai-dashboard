# Mobile UI Architect — Project Memory

## Project Identity
NetSuite AI Dashboard — React + Vite + Tailwind + Recharts + react-grid-layout.
Dark theme: gray-900 bg, gray-800 cards, gray-700 borders, blue-600 primary.
Client at `~/netsuite-ai-dashboard/client/src/`.

## Key File Paths
- `src/App.jsx` — shell layout (header, main scroll area, query bar)
- `src/components/Dashboard/DashboardGrid.jsx` — grid (react-grid-layout desktop, stacked mobile)
- `src/components/Dashboard/WidgetCard.jsx` — widget card + three-dot settings dropdown
- `src/components/QueryBar/NaturalLanguageInput.jsx` — bottom query bar + result preview
- `src/components/Charts/WidgetRenderer.jsx` — Recharts bar/line/pie/kpi/table switcher
- `src/components/Charts/DataTable.jsx` — DataTables.net integration
- `src/components/Charts/KPIWidget.jsx` — single-value KPI display
- `src/components/Settings/SettingsPanel.jsx` — OAuth + Groq key modal
- `src/index.css` — global styles, DataTables dark overrides, react-grid-layout overrides

## Established Patterns

### Mobile breakpoint
- MOBILE_BREAKPOINT = 640px (measured via ResizeObserver on container, not window)
- Below 640px: stacked widget list, no drag/resize
- At/above 640px: full react-grid-layout grid

### Widget mobile heights (per visualization_type)
- table: 420px (needs room for pagination controls)
- kpi: 160px (compact — single value)
- bar/line/pie: 300px
- default fallback: 320px
- Do NOT use a single fixed height for all types

### react-grid-layout constraints
- `draggableHandle=".drag-handle"` on the GridLayout — class goes on `<h3>` title only
- Buttons inside widget headers need `onMouseDown={e => e.stopPropagation()}`
- On mobile (isMobile=true), remove cursor-grab from h3; rename via onTouchEnd instead of onDoubleClick

### Touch targets
- Minimum 44x44px for primary actions; achieved with `w-9 h-9` or `min-h-[44px]`
- Icon-only buttons: use `w-8 h-8` on mobile, `w-7 h-7` on sm+ (`w-8 h-8 sm:w-7 sm:h-7`)

### iOS Safari zoom prevention
- All inputs must use `text-base` (16px) or `text-base sm:text-sm` — 14px triggers auto-zoom
- Apply consistently in: NaturalLanguageInput query input, SettingsPanel all inputs

### SettingsPanel mobile pattern
- Use `items-end` bottom sheet on mobile, `sm:items-center` centered modal on desktop
- `rounded-t-2xl sm:rounded-xl` for bottom sheet feel
- Add drag handle indicator div (visual only) at top on mobile
- `max-h-[92vh] sm:max-h-[90vh] overflow-y-auto` for tall content

### Three-dot dropdown clipping fix
- Track button's `getBoundingClientRect().right` on open
- If `right < 192` (dropdown width), use `left-0` alignment; otherwise `right-0`
- Store in `dropdownAlignLeft` state, set in `handleSettingsToggle`

### Recharts on mobile
- Always wrap in `<ResponsiveContainer width="100%" height="100%">`
- Bar/Line XAxis: use `interval="preserveStartEnd"` NOT `interval={0}` — avoids label crush on narrow containers
- Truncate long axis labels with a helper (e.g. max 12 chars + ellipsis)
- YAxis: `width={40}` to prevent label clipping; margins: `right: 10, left: 0`
- Pie labels: truncate name to ~10 chars to avoid overflow

### DataTables dark theme
- Wrapper class `dt-wrapper` must be on the outer div — all CSS selectors are scoped to it
- Remove `nowrap` from DataTable className — it prevents the responsive plugin from collapsing columns
- Use `className="display w-full"` (not `display nowrap w-full`)
- `autoWidth: false` prevents DT from measuring the full viewport width
- `scrollCollapse: true` lets table body shrink when few rows
- On mobile (<640px): dt-layout-row goes column direction, search input full width

### Query bar result preview
- Split header into two rows on mobile: title+dismiss on top, row count+pin on bottom
- Preview chart height: `h-44 sm:h-52` (176px mobile, 208px desktop)
- Dismiss/close buttons: `w-8 h-8` flex-centered for 44px touch area with padding

### Example prompt chips
- `overflow-x-auto no-scrollbar` on mobile, `sm:flex-wrap sm:overflow-x-visible` on desktop
- Each chip: `whitespace-nowrap flex-shrink-0 sm:flex-shrink sm:whitespace-normal`

### KPI widget
- Use `text-3xl sm:text-4xl` (not a fixed text-4xl) so large numbers shrink on narrow cards
- Add `break-words leading-tight px-4` to prevent overflow

## CSS Notes
- `overscroll-behavior: none` on body prevents bounce-scroll revealing gray behind app shell
- `@media (prefers-reduced-motion: reduce)` block sets all animations/transitions to 0.01ms
- DataTables CSS import order matters: `dataTables.dataTables.css` then `responsive.dataTables.css`

## Known Design Debt
- NaturalLanguageInput result preview uses fixed heights — if a table result previews in `h-44`, pagination controls may be cut off; could be improved with type-aware preview height
- SettingsPanel does not trap focus (no focus lock) — accessibility gap for modal
- Widget rename on mobile uses onTouchEnd which fires after scroll — could accidentally trigger rename; a long-press pattern would be better UX
