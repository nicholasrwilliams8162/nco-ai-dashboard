# NetSuite AI Dashboard — Progress Notes

## What was done

### OAuth 2.0 (complete)
Migrated from TBA (OAuth 1.0a) to OAuth 2.0 Authorization Code flow with PKCE. All credentials managed through Settings UI.

**Key bug fixed:** PKCE state stored in DB (`oauth_pending` table) instead of session — the Vite proxy binds the session cookie to localhost:5173 but NetSuite redirects back to localhost:3001 directly, so session was always empty at callback time.

**NetSuite setup required:**
- OAuth 2.0 enabled: Setup → Company → Enable Features → SuiteCloud → Manage Authentication → OAuth 2.0
- Integration record: Authorization Code Grant + **REST Web Services scope** both checked
- Redirect URI: `http://localhost:3001/api/auth/netsuite/callback`

### Groq AI (complete — replaced Anthropic → Gemini → Groq)
Using Groq (llama-3.3-70b-versatile) as the free AI provider.
- API key stored in `app_settings` SQLite table under key `groq_api_key`
- `response_format: { type: 'json_object' }` to force clean JSON output
- `max_tokens: 4000`
- Self-correction pass: re-prompts with error if SuiteQL fails

**To get a free Groq API key:** console.groq.com

### SuiteQL Schema Context (accurate, sourced from timdietrich.me/blog)
- Customer balance: `balancesearch`, `overduebalancesearch`, `unbilledorderssearch`
- Transaction status: single-char codes — filter with `BUILTIN.DF(status) LIKE '%Open%'`
- Transaction type codes: `CustInvc`, `SalesOrd`, `VendBill`, `Journal`, `PurchOrd`, `CustPymt` etc.
- Boolean fields: `'T'` / `'F'`
- `mainline = 'T'` on transactionline avoids duplicate rows
- ROWNUM cannot be combined with GROUP BY

### Dashboard UI (complete)
- **Three-dot settings menu** per widget: chart type picker + width selector + query info toggle + remove
- **Chart type switching** — bar/line/pie/table/kpi; auto-detects xAxis/yAxis from data when config missing (fixes blank charts when switching from table type)
- **Widget resizing** — 4 width steps (¼ ½ ¾ full) saved to DB via layout endpoint
- **Horizontal compaction** — `compactType="horizontal"` so widgets flow side-by-side when resized
- **Drag handle** on title `<h3>` only; buttons use `onMouseDown stopPropagation`

### DataTables (complete)
- Using `datatables.net-dt` directly via `useEffect` + `useRef` (not the React wrapper — it caused column detection bugs)
- NetSuite `links` column stripped before DataTables sees it
- Import named `DTLib` to avoid clash with exported `DataTable` function name
- Dark theme overrides in `index.css` under `.dt-wrapper`
- `scrollX: true`, no responsive plugin (mobile handled by stacked layout instead)

### Mobile Responsive (complete)
- **DashboardGrid**: uses `ResizeObserver` for accurate width; below 640px switches to stacked single-column layout (no drag/resize); per-type heights (table=420px, chart=300px, kpi=160px)
- **Header**: icon-only on mobile, "Refresh All" text hidden, "Updated" timestamp hidden below md
- **Query bar**: 16px input font (prevents iOS Safari zoom), horizontal-scroll example chips, two-row result preview header
- **SettingsPanel**: bottom sheet on mobile, centered modal on sm+
- **WidgetCard**: 32px touch targets, drag cursor removed on mobile, dropdown aligns left if near viewport edge
- **Charts**: `preserveStartEnd` tick interval, label truncation, fixed YAxis width

### Agent Page — Write Operations + Audit Log (complete)
New dedicated page accessible via **Dashboard / Agent** toggle in the navbar.

Allows users to create and update NetSuite records using natural language. Executes directly via the **NetSuite REST Record API** — no MCP SuiteApp required.

**How it works:**
1. User types a natural language instruction (e.g. "Create a customer named Acme Corp")
2. `POST /api/agent/plan` — Groq plans what to do. If required info is missing, it returns a clarifying question instead of acting. User answers, clarifications are passed back as Groq conversation context, loop repeats until Groq has enough to act.
3. UI shows a confirmation card: plain-English summary, tool name, expandable raw arguments, risk badge (low/medium/high). High-risk gets red button.
4. User clicks "Confirm & Execute" → `POST /api/agent/execute` — calls the REST Record API, returns the result.
5. Fully logged to `agent_history` with record type, record ID, before-state, and status.

**Clarification flow:**
- Groq returns `{ "action": "clarify", "question": "..." }` when required fields are missing or ambiguous (e.g. person vs. company, missing name)
- Each Q&A pair is appended to `clarifications[]` and replayed as Groq message history on the next plan call
- All previous Q&A shown above the current question for context

**Architecture:**
- `server/services/restRecordClient.js` — `createRecord`, `updateRecord` (with before-state capture), `getRecord`, `inactivateRecord`; `normalizeValues()` converts `"T"`/`"F"` → JSON booleans for REST API
- `server/services/agentService.js` — Groq planning layer. `AGENT_TOOLS` + `FIELD_HINTS` prompt context. Pending plans in-memory Map with 5-min TTL.
- `server/routes/agent.js` — `POST /api/agent/plan`, `POST /api/agent/execute`, `GET /api/agent/history`, `POST /api/agent/history/:id/revert`
- `client/src/pages/AgentPage.jsx` — full page with clarification loop, confirmation card, audit log panel

**NetSuite REST API field gotchas:**
- Booleans must be JSON `true`/`false` (not SuiteQL's `"T"`/`"F"`)
- `isperson: true` → requires `firstname` + `lastname`, no `companyname`
- `isperson: false` → requires `companyname`, no `firstname`/`lastname`
- Reference fields (subsidiary, entity, etc.) → `{ "id": "123" }`

### Audit Log + Revert (complete)
Every agent action is written to `agent_history` with full audit fields:

| Column | Description |
|---|---|
| `instruction` | Original user instruction |
| `tool` | `createRecord` / `updateRecord` / `getRecord` / `runSuiteQL` |
| `arguments` | JSON arguments passed to the tool |
| `record_type` | NetSuite record type (e.g. `customer`) |
| `record_id` | Internal ID of the affected record |
| `before_state` | Field values before an update (enables revert) |
| `status` | `success` or `reverted` |
| `reverted_at` | Timestamp of revert |

**Revert behavior:**
- **Creates** → inactivates the record (`isinactive: true`) via `inactivateRecord()`
- **Updates** → restores `before_state` fields via `updateRecord()`
- Revert button shown on any create/update that hasn't been reverted; requires `window.confirm`
- After revert, row dims and shows "reverted at [timestamp]"

### Autonomous Agents (complete)
Scheduled automation system that runs SuiteQL queries and takes actions on NetSuite records on a cron schedule.

**How it works:**
1. User creates an agent with natural language instructions + cron schedule
2. Groq generates a SuiteQL query + action plan (cached — no Groq call on repeat runs unless memories change)
3. Agent runs on schedule: queries NetSuite, then per-row either flags, queues for approval, or auto-executes
4. Self-correction: if the query fails, Groq gets the error and fixes the query automatically
5. Agent learns from approve/deny decisions — memories injected into future prompts

**Key features:**
- Approval/denial workflow queue with deny reasons saved as memories
- Duplicate pending todo prevention (skips re-queueing same record on re-runs)
- Flagged results shown inline on the agent card
- Collapsible last query shown on the card for debugging
- Plan caching — skips Groq entirely on repeat runs with no new memories
- Schema section selection — only sends relevant schema sections (~54-67% token reduction)
- Pause/resume, enable/disable, manual run trigger
- Tab state persisted to localStorage

**Architecture:**
- `server/services/autonomousAgentService.js` — core execution engine (plan, query, act, memory)
- `server/services/schedulerService.js` — node-cron scheduler, loads agents on server start
- `server/routes/autonomousAgents.js` — full REST API (agents, todos, notifications, runs)
- `client/src/pages/AutomationPage.jsx` — full UI with 4 tabs: Agents, Approvals, Activity, Run History
- `server/db/database.js` — 5 new tables: `autonomous_agents`, `agent_runs`, `agent_todos`, `agent_notifications`, `agent_memories`

**REST API write fixes:**
- `restRecordClient.js`: write timeout raised to 90s, before-state GET and PATCH run in parallel via `Promise.allSettled`, retry once on timeout

**SuiteQL corrections discovered:**
- `foreigntotal` not `amount` on transaction table
- `mainline` is on `transactionline`, never on `transaction`
- SalesOrd "open" = `NOT LIKE '%Billed%' AND NOT LIKE '%Closed%' AND NOT LIKE '%Cancelled%'` (no "Open" label exists)
- Record type normalization: display names ("Sales Order") → REST API names ("salesorder")

---

### Railway Deployment (complete)
Deployed to Railway as a persistent server — cron scheduler runs continuously.

- `server/index.js` serves built React static files in production (`NODE_ENV=production`)
- `DATA_DIR` env var controls SQLite path (points to Railway volume mount `/data` when available)
- CORS disabled in production (same-origin)
- `railway.json` + `nixpacks.toml` (includes `nodejs_20`, `python3`, `gcc`, `gnumake` for better-sqlite3 native build)
- Root `package.json` `build` + `start` scripts used by Railway
- Live at: `https://nco-ai-dashboard-production.up.railway.app`
- GitHub repo: `https://github.com/nicholasrwilliams8162/nco-ai-dashboard`
- Every `git push master` triggers auto-redeploy

**Note:** No persistent volume yet (requires Railway Pro). DB resets on redeploy. Add volume at `/data` + `DATA_DIR=/data` env var when upgrading.

---

### Electron Desktop App (complete)
Packaged as a standalone Mac desktop app with system tray and auto-launch at login.

**How it works:**
- Electron main process spawns the Express server as a child process (system `node` in dev, `ELECTRON_RUN_AS_NODE=1` in prod)
- Waits for server health check before opening window
- Window hides to tray on close (keeps running in background)
- Tray icon: right-click → Open Dashboard / Quit
- Auto-registers for login startup via `auto-launch`
- SQLite DB stored in `app.getPath('userData')` (persists across app updates)

**Key files:**
- `electron/main.cjs` — Electron main process
- `dist-electron/NCO AI Dashboard-1.0.0-arm64.dmg` — Mac installer (arm64)

**Scripts:**
- `npm run electron:dev` — dev mode (builds client, opens Electron window)
- `npm run electron:dist` — builds DMG installer

**Known limitations:**
- No code signing (Apple Developer cert required) — users must right-click → Open on first launch
- Default Electron icon (no custom .icns yet)
- Auto-launch requires user permission on macOS Ventura+

---

### Multi-Tenant User Authentication — Clerk (complete)
The app is now a proper multi-user product. Each user creates their own account and manages their own data independently.

**Auth provider:** Clerk (managed service — handles sessions, JWTs, password resets, email verification)

**Sign-in methods:**
- Email/password
- Google OAuth ("Continue with Google")

**How it works:**
- `<ClerkProvider>` wraps the React app — `<SignedOut>` shows the Clerk `<SignIn />` component, `<SignedIn>` shows the dashboard
- Every API request carries a Clerk JWT in `Authorization: Bearer <token>` (axios interceptor)
- `clerkMiddleware()` on the Express server validates tokens globally
- `requireClerkAuth` middleware extracts `req.userId` (Clerk user ID) and gates all protected routes
- NetSuite OAuth: `user_id` stored in `oauth_pending` at initiate time, read back at callback (no Clerk session during redirect)

**Data isolation:**
- `user_id` column added to: `netsuite_tokens`, `oauth_pending`, `dashboards`, `query_history`, `agent_history`, `autonomous_agents`
- New `user_settings` table `(user_id, key, value)` replaces the global `app_settings` for per-user Groq API key, etc.
- All queries, agent runs, and scheduled tasks are scoped to the owning user
- Scheduled autonomous agents use `agent.user_id` from DB — no request context needed

**Key files:**
- `server/middleware/auth.js` — `requireClerkAuth` middleware
- `client/src/main.jsx` — `<ClerkProvider>` wrapper
- `client/src/App.jsx` — `<SignedIn>/<SignedOut>` + `<UserButton>` in navbar
- `client/src/api/client.js` — axios interceptor attaches Bearer token

**Env vars required:**
- `client/.env`: `VITE_CLERK_PUBLISHABLE_KEY=pk_...`
- `server/.env`: `CLERK_SECRET_KEY=sk_...` + `CLERK_PUBLISHABLE_KEY=pk_...`

---

### Autonomous Agent Fixes (complete)
Three bugs fixed in the same session:

**1. `{{NOW_UNIX}}` timestamp replaced with empty string on approval**
- Root cause: `fillTemplate()` treated `{{NOW_UNIX}}` like a row column — when not found it became `""`
- Fix: Added `RUNTIME_TOKENS = new Set(['NOW_UNIX', 'NOW_ISO', 'NOW_DATE'])` — `fillTemplate` now preserves these tokens unchanged; new `resolveRuntimeTokens()` resolves them at execution time (approve click / auto-execute)
- Planner prompt updated with RUNTIME TOKENS section so Groq knows to use them

**2. Schedules not running after Mac sleep**
- Fix: `electron/main.cjs` — `powerMonitor.on('resume', ...)` calls `POST /api/internal/catchup` on system wake
- `server/services/schedulerService.js` exports `catchUpMissedRuns()` — uses `cron-parser` to detect any agents whose next scheduled run was missed while asleep and fires them immediately
- `/api/internal/catchup` is a localhost-only endpoint (no Clerk auth, guarded by `requireLocalhost`)

**3. Dock badge for pending approvals**
- `electron/main.cjs` — `updateBadge()` polls `/api/internal/pending-count` every 30s and calls `app.setBadgeCount(n)`
- `/api/internal/pending-count` — localhost-only endpoint, queries `agent_todos WHERE status='pending'`
- Badge also refreshes 5s after wake catch-up runs

**Post-approval UI refresh chain:**
- `ApprovalsTab` calls `onApprovalChange` after approve/deny
- `AutomationPage` increments `notifReloadSignal` state → `NotificationsTab` reloads
- `App.jsx` passes `fetchCounts` (wrapped in `useCallback`) as `onApprovalChange` → navbar badge updates immediately

---

### Design System v3 (complete)
Full UI redesign — sidebar navigation, dual light/dark theme, Manrope font.

**Design direction:** High-contrast, readable, business-grade. Reference: Phonerun-style dashboard with sidebar nav.

**Color system (CSS custom properties on `[data-theme]`):**
- Light: `#EEF1F6` page bg, white cards, `#0F1729` near-black text, `#2563EB` blue
- Dark: `#0D1117` page bg, `#1C2333` cards, `#E8EDFB` text, `#3B82F6` blue
- Full token set: `--page-bg`, `--sidebar-bg`, `--card-bg`, `--card-bg-2`, `--input-bg`, `--border`, `--border-soft`, `--text-1`…`--text-4`, `--blue`/`--blue-light`/`--blue-mid`/`--blue-dark`, `--green`/`--red`/`--amber` + light variants, `--shadow-card`/`--shadow-modal`

**Typography:**
- Manrope (400/500/600/700/800) for all UI text — 800 weight for page headings
- DM Mono for data values, KPI numbers, code, query display
- Google Fonts loaded in `client/index.html`

**Layout change — sidebar replaces top navbar:**
- 220px left sidebar: logo mark + "NCO Dashboard", nav items with icons, settings link, theme toggle, Clerk `<UserButton>`
- Page content area: `TopBar` with page title/subtitle + Refresh All (dashboard only), then page body
- Theme toggle pill in sidebar footer — persisted to `localStorage` as `theme` key, applied as `data-theme` attribute on `<html>`

**Components updated:**
- `App.jsx` — sidebar layout, inline `Sidebar` + `TopBar` components, theme state
- `WidgetCard.jsx` — CSS var styling, card shadow + hover lift, redesigned header/dropdown
- `KPIWidget.jsx` — clamp-based font size, DM Mono for currency values
- `NaturalLanguageInput.jsx` — floating send button, example chips, CSS var error states
- `SettingsPanel.jsx` — full modal redesign with CSS vars, new input component
- `WidgetRenderer.jsx` — `getThemeStyles()` reads CSS vars at render time for chart tooltips/grid/axis
- `DashboardGrid.jsx` — empty state uses CSS vars
- `tailwind.config.js` — semantic tokens (`t1`, `t2`, `card`, `accent`, etc.) mapped to CSS vars
- `index.css` — full CSS var declaration for both themes, DataTables retheming, Tailwind gray overrides for Agent/Automation pages in light mode

**Reference file:** `design-system.html` — standalone HTML/CSS design system doc (all tokens, components, app shell mockup)

---

## Current status

**Mostly working.** Dashboard queries, agent write operations, autonomous scheduled agents, Railway cloud deployment, Electron desktop app, multi-tenant Clerk auth, and v4 design system all functional. Agentic engine refactor complete — MCP calls blocked on 401 until NetSuite-side setup (Bundle 522506 + permission) is done. Old `aiService.js` / `agentService.js` retained as fallback until MCP is validated.

## Key files

```
server/
  index.js                          # Express app, static serving in prod, internal endpoints
  routes/ai.js                      # POST /api/ai/query, GET /api/ai/history
  routes/agent.js                   # POST /api/agent/plan|execute, history, revert
  routes/auth.js                    # OAuth PKCE flow + Groq key + settings
  routes/dashboard.js               # Widget CRUD, layout, refresh
  routes/autonomousAgents.js        # Agents, todos, notifications, runs CRUD
  services/agenticEngine.js         # NEW — unified agentic loop (replaces aiService + agentService)
  services/docSearchService.js      # NEW — timdietrich.me doc fetcher (5s timeout, 10min cache)
  services/aiService.js             # Groq query pipeline + self-correction (superseded, kept for fallback)
  services/agentService.js          # Agent planning + plan execution (superseded, kept for fallback)
  services/autonomousAgentService.js # Autonomous agent execution engine (now uses MCP calls)
  services/schedulerService.js      # node-cron scheduler + catchUpMissedRuns()
  services/restRecordClient.js      # NetSuite REST Record API
  services/netsuiteClient.js        # SuiteQL + token refresh
  services/schemaContext.js         # Section-selected schema context
  db/database.js                    # SQLite init + all migrations
  middleware/auth.js                # requireClerkAuth (Clerk JWT validation)

client/
  index.html                        # Google Fonts (Manrope + DM Mono), data-theme="dark"
  tailwind.config.js                # Semantic tokens mapped to CSS vars
  src/
    index.css                       # CSS custom properties (light/dark), DT theme, overrides
    App.jsx                         # Sidebar layout, theme toggle, page routing
    pages/AgentPage.jsx             # Manual agent write operations
    pages/AutomationPage.jsx        # Autonomous agents + approvals + activity
    components/Dashboard/DashboardGrid.jsx
    components/Dashboard/WidgetCard.jsx
    components/Charts/WidgetRenderer.jsx
    components/Charts/KPIWidget.jsx
    components/QueryBar/NaturalLanguageInput.jsx
    components/Settings/SettingsPanel.jsx

electron/
  main.cjs                          # Electron: tray, server spawn, dock badge, wake catch-up

design-system.html                  # Standalone design system reference (tokens, components)
CLAUDE.md                           # NEW — commands, architecture, SuiteQL conventions for Claude Code
```

## To resume
- **Web dev**: `cd ~/netsuite-ai-dashboard && npm run dev` → http://localhost:5173
- **Electron dev**: `npm run electron:dev`
- **Build installer**: `npm run electron:dist`
- **Deploy**: `git push master` (Railway auto-deploys)
- If port 3001 stuck: `lsof -ti :3001 | xargs kill -9`
- If sqlite3 ABI error: `cd server && npm rebuild better-sqlite3`

## Ideas / next steps
- Apply design tokens to AgentPage and AutomationPage (currently using old Tailwind gray classes with light-mode CSS overrides)
- Code signing for Mac distribution
- Multi-dashboard support per user
- Windows build (NSIS installer)
- Persistent volume on Railway (Pro plan)
- Deploy Railway with Clerk env vars for cloud multi-tenant use
- Switch Clerk from development mode to production keys
- Agent multi-step workflows
- Export dashboard as PDF/image
- Billing / subscription gating per user (Stripe)

---

### Design System v4 — Enterprise UI (complete)

Full visual overhaul targeting a modern enterprise SaaS aesthetic (Linear / Vercel / FinCorp style).

**Font**
- Switched from Manrope → **Plus Jakarta Sans** (rounder, crisper at small sizes)
- Antialiasing changed to `subpixel-antialiased` — sharper rendering, less fuzzy
- Removed `text-rendering: optimizeLegibility` (caused blur at small sizes)

**Light mode redesign**
- Dark navy sidebar (`#0E2255`) with white/muted-blue text — matches FinCorp reference
- Light blue-gray page background (`#E8EFF8`) — distinctive, enterprise feel
- White topbar and cards elevated above page background
- Active nav indicator: white left border (visible against navy)
- Sidebar hover: subtle white overlay

**Sidebar**
- New geometric "NCO" logo mark (N in rounded square SVG)
- Stacked "NCO" / "Dashboard" wordmark, 28px mark
- Left-border active indicator (Linear signature) — uses `--sidebar-text-active` color
- CSS-driven hover states via `.sidebar-nav-btn` class
- Theme toggle condensed to icon-only button in footer alongside UserButton

**TopBar**
- Removed fixed height — uses `padding: 20px 28px` for breathing room
- 20px bold title + 13px muted subtitle
- White background (`var(--card-bg)`) for visual elevation
- `.topbar-btn` ghost button class for Refresh All

**Widget cards**
- 12px border-radius, 44px header
- Drag dots icon (6-dot SVG) that fades in on card hover via CSS
- `.widget-icon-btn` class with hover ring for action buttons
- Dropdown menu items have mouse-enter/leave hover backgrounds

**Automation tabs**
- Linear-style underline indicator via `box-shadow: inset 0 -2px 0 var(--blue)` (no layout reflow / no flicker)
- `.auto-tab` CSS class, `height: 44px` matches sub-header

**Status badges**
- All status pills (completed/running/failed/pending, success/error/reverted) now use CSS vars
- `--green-light` / `--green`, `--red-light` / `--red`, `--amber-light` / `--amber`, `--blue-light` / `--blue`
- Readable in both light and dark mode

**CSS tokens**
- Added `--blue-glow` for focus rings
- Focus ring: `2px solid var(--blue)` + `box-shadow: 0 0 0 4px var(--blue-glow)`
- Darker light mode `--text-3` / `--text-4` for readable muted text
- `--sidebar-active-indicator` uses `--sidebar-text-active` (white in light, blue in dark)

**Bug fixes**
- Removed duplicate page headings from AgentPage and AutomationPage (TopBar is single source)
- Settings panel no longer force-opens when not connected — users can freely browse all pages
- Automation tab badge flicker fixed — removed redundant `loadCounts()` call inside `onCountChange`
- Query bar background was `var(--sidebar-bg)` (dark navy) — fixed to `var(--card-bg)`
- Form inputs / chips use `bg-card` (white) instead of `bg-input` which blended into page background

### Design System v4.1 — Activity tab & badge polish (complete)

**Activity (Notifications) tab**
- Switched from opacity-wash read/unread to card-per-row layout matching Run History tab
- Each notification is a white card (`bg-card`, `border-border`, `rounded-lg`, `space-y-2`)
- Read items show with dimmed text (`--text-3`), unread show full `--text-1` + blue dot indicator
- Icon colors use CSS vars (`--green`, `--red`, `--amber`, `--blue`) — theme-aware in both modes

**Agent status badges**
- "Disabled", "Approval required", "Auto-execute" badges migrated from hardcoded dark-mode Tailwind classes to CSS vars
- "Auto-execute" changed to green (`--green-light` / `--green`) for clearer positive signal
- "Approval required" uses blue (`--blue-light` / `--blue`)
- "Disabled" uses neutral gray (`--card-bg-2` / `--text-3`)

**Electron app**
- Identified and documented port 3001 conflict (dev server vs packaged server) — must kill dev server before launching installed app
- Build/install flow: `npm run electron:dist` → mount DMG → copy to `/Applications` → launch

---

### Dashboard Improvements (complete)

**Custom app icon**
- SCAI logo added as app icon for all platforms
- `build/icon.icns` (macOS), `build/icon.ico` (Windows), `build/icon.png` (Linux) generated from source PNG using `sips` + `iconutil` + Python Pillow
- `package.json` electron-builder config updated with explicit icon paths per platform

**SuiteQL query generation fixes**
- Added dedicated "revenue by month" example to `schemaContext.js` — uses `transaction.foreigntotal` directly with no `transactionline` join (the previous example used item-level line data, causing empty results for "total revenue by month this year")
- Added "revenue by quarter" example with `TRUNC(date, 'Q')`
- Split the old generic GROUP BY example into "top items by item" (transactionline) vs. revenue by period (transaction only)
- `S_SYNTAX` now explicitly bans `YEAR()` / `MONTH()` functions (not valid in SuiteQL) — instructs AI to use `TRUNC(t.trandate,'YEAR') = TRUNC(SYSDATE,'YEAR')` pattern instead
- Example picker bumped from 2 → 3 most-relevant examples included in prompt

**Pie chart fix**
- NetSuite returns all values as strings — Recharts `PieChart` couldn't compute slice percentages
- `WidgetRenderer.jsx`: coerces `yAxis` column values to `Number()` before passing to `<PieChart>`, filters out zero/null rows, shows "No numeric data" empty state if nothing is valid
- Added `<Legend>` to pie chart for readability
- Re-enabled `labelLine`, `null`-safe label rendering via `String(name ?? '')`
- Tooltip formatter shows localized number + column name

**Edit widget panel**
- New slide-in panel (right side) accessible via widget three-dot menu → "Edit widget"
- Two tabs:
  - **Columns** — contextual axis/column pickers per chart type:
    - Bar/Line: X Axis (categories) + Y Axis (values) dropdowns
    - Pie: Slice labels + Slice values dropdowns
    - KPI: Value column + optional Label column dropdowns
    - Table: checkbox list to show/hide individual columns
  - **Re-ask AI** — editable textarea with original question, Run Query button, shows row count + AI interpretation as preview before committing; Apply replaces query, data, axes, and chart type in one operation
- `PATCH /api/dashboard/widgets/:id` extended to accept `suiteql_query`, `visualization_config`, `original_question`, `interpretation`, `cached_data` in addition to existing `title`/`visualization_type`
- New `updateWidgetConfig(widgetId, patch)` Zustand store action
- `DataTable` accepts `hiddenColumns` prop — merged with always-hidden NetSuite `links` column, reinitializes when column visibility changes

**Key files:**
- `client/src/components/Dashboard/EditWidgetPanel.jsx` — new component
- `client/src/components/Dashboard/WidgetCard.jsx` — Edit widget menu item + panel mount
- `client/src/components/Charts/WidgetRenderer.jsx` — pie fix + hiddenColumns passthrough
- `client/src/components/Charts/DataTable.jsx` — hiddenColumns support
- `client/src/store/dashboardStore.js` — `updateWidgetConfig` action
- `server/routes/dashboard.js` — extended PATCH endpoint
- `server/services/schemaContext.js` — revenue examples + YEAR()/MONTH() ban

---

### OpenSuiteMCP-Style Agentic Engine — 2026-03-09 (complete)

Major architectural overhaul replacing the NetSuite integration engine with a unified agentic loop modelled on OpenSuiteMCP. All NetSuite calls now route through MCP rather than directly through the REST Record API or a raw SuiteQL client.

**New files:**
- `server/services/agenticEngine.js` — Unified agentic loop that replaces both `aiService.js` and `agentService.js`. Widget queries use a 3-step loop (generate → execute → metadata introspect on failure). Agent writes use a 5-step loop with dynamic MCP tool discovery. All NetSuite calls route through MCP.
- `server/services/docSearchService.js` — Lightweight timdietrich.me documentation fetcher. 5-second timeout, 10-minute in-memory cache. Non-fatal — returns empty string on failure so the agentic loop is never blocked.
- `CLAUDE.md` — New project-level file documenting commands, architecture, NetSuite/SuiteQL conventions, and key gotchas for future Claude Code sessions.

**Files modified:**
- `server/services/mcpClient.js` — Added `runMcpSuiteQL()` and `getMcpRecordTypeMetadata()` typed wrappers. Threaded `userId` through all functions. Changed tools cache from a module-level variable to a per-user `Map` to avoid cross-user cache collisions.
- `server/services/netsuiteClient.js` — Exported `sanitizeSuiteQL` so `mcpClient.js` can import and reuse the existing sanitizer logic.
- `server/services/autonomousAgentService.js` — Swapped all call sites in both `executeAgent()` and `executeTodo()`: `runSuiteQL` → `runMcpSuiteQL`, `createRecord`/`updateRecord` → `callMcpTool('ns_createRecord')`/`callMcpTool('ns_updateRecord')`.
- `server/routes/ai.js` — Import changed from `aiService` to `agenticEngine`.
- `server/routes/agent.js` — Import changed from `agentService` to `agenticEngine`.

**Blocked — MCP endpoint returning 401:**
Requires NetSuite-side setup before MCP calls succeed:
1. Install MCP Standard Tools SuiteApp (Bundle 522506)
2. Add "MCP Server Connection" permission to the integration role

**Old files kept but no longer imported** (safe to delete after MCP validation):
- `server/services/aiService.js`
- `server/services/agentService.js`

---

### Autonomous Agent Write Operations Fixed — 2026-03-10 (complete)

Three bugs fixed that prevented autonomous agent approvals from actually updating NetSuite records.

**Bug 1 — Wrong MCP parameter names for writes**
`executeTodo` and the auto-execute path in `executeAgent` were calling `ns_updateRecord` with `{ id, values }` but the actual MCP tool schema requires `{ recordId, data }` where `data` is a **stringified JSON string**. Same for `ns_createRecord` — requires `{ data }` not `{ values }`. NetSuite silently ignored all previous update calls because the required params were missing.

Fixed by fetching the live tool schema via `listMcpTools` and correcting both call sites in `autonomousAgentService.js`:
```js
// updateRecord
{ recordType, recordId: String(args.id), data: JSON.stringify(args.values) }
// createRecord
{ recordType, data: JSON.stringify(args.values) }
```

**Bug 2 — `isError` response not checked**
`executeTodo` called `callMcpTool` but discarded the return value. If MCP returned `isError: true` in the JSON-RPC response (without throwing), the todo was still marked `approved`. Added explicit check: throws `"NetSuite rejected the update: ..."` if `mcpResult.isError`.

**Bug 3 — Groq generating SuiteQL functions as field values**
Groq kept generating `"SYSDATE"`, `"SYSTIMESTAMP"`, or hardcoded dates instead of the `{{NOW_DATE}}`/`{{NOW_ISO}}` runtime tokens. Fixed by rewriting the RUNTIME TOKENS section in `buildPlannerPrompt` with explicit negative examples:
- ✗ NEVER write `"SYSDATE"`, `"SYSTIMESTAMP"`, `"NOW()"` — stored as literal strings
- ✗ NEVER hardcode a date
- ✓ ALWAYS use `{{NOW_DATE}}` / `{{NOW_ISO}}` for dynamic timestamps

**Bug 4 — MCP write timeout**
`ns_updateRecord` on NetSuite takes longer than 30s to respond for write operations. Raised `mcpClient.js` axios timeout from 30s → 90s. The update was succeeding server-side but the client received a timeout error.

**Debug endpoint added** (permanent, auth-protected):
- `GET /api/netsuite/mcp-tools` — returns live MCP tool list with full input schemas
- `POST /api/netsuite/mcp-call` — calls any MCP tool directly with provided args

---

### MCP Pipeline Fully Validated — 2026-03-10 (complete)

End-to-end MCP integration confirmed working against a live NetSuite trial account (TSTDRV2309831).

**Root causes fixed:**

1. **OAuth scope** — Changed from `rest_webservices` to `mcp` in `auth.js`. These scopes are mutually exclusive; the MCP endpoint rejects REST-scoped tokens with 401. A new integration record with *only* "NetSuite AI Connector Service" checked is required.

2. **MCP Protocol Version** — Updated header and initialize params from `2025-03-26` → `2025-06-18`.

3. **Wrong tool name** — Changed `runSuiteQL` → `ns_runCustomSuiteQL` (the actual MCP tool name).

4. **Wrong parameter name** — Changed `query` → `sqlQuery` for `ns_runCustomSuiteQL`.

5. **Response shape mismatch** — `ns_runCustomSuiteQL` returns `{ data: [...], resultCount: N, numberOfPages: N }`, not `{ items: [...] }`. Added correct parsing branch in `runMcpSuiteQL()`.

6. **Metadata tool** — Changed `ns_getRecordTypeMetadata` → `ns_getSuiteQLMetadata`. New response shape: `{ success, metadata: { properties: { fieldName: { title, type, nullable, x-n:joinable } } } }`.

7. **dashboard.js stale import** — `refreshWidgetData` was still imported from `aiService.js`. Changed to `agenticEngine.js`.

**NetSuite setup required (one-time):**
- Integration record: *only* "NetSuite AI Connector Service" scope checked (cannot be combined with REST Web Services)
- Role: "MCP Server Connection" permission added
- Bundle 522506 (MCP Standard Tools SuiteApp) installed

**Zero-row self-correction** — Agentic engine now detects when a revenue query returns 0 rows due to filtering on `CustInvc` (a transaction type that may not exist in all accounts). It sets `lastQueryResult = null` and injects a targeted hint instructing Groq to retry with `SalesOrd`. Widget query `maxIterations` raised from 3 → 5 to allow the retry without hitting the cap.

---

### Currency Formatting — 2026-03-10 (complete)

Numeric values that represent money are now automatically formatted as USD currency (`$1,234.56`) across all widget types.

**Detection** — `isCurrencyColumn(key)` in `currencyUtils.js` matches column names containing: amount, total, revenue, balance, price, cost, value, subtotal, tax, payment, sales, income, expense, budget, profit, margin.

**Chart widgets (bar / line):**
- Y-axis ticks: compact format (`$48.5K`, `$1.2M`) via `formatCurrencyCompact()`
- Tooltips: full format (`$48,472.43`) via `formatCurrency()`
- Y-axis width auto-expands to 70px for currency columns (was 40px)

**Pie chart:** tooltip shows full currency format.

**KPI widget:** detects currency column by name and formats with `$` sign.

**Data table:** DataTables `render` function formats currency columns inline.

**Key files:**
- `client/src/components/Charts/currencyUtils.js` — shared helpers (new)
- `client/src/components/Charts/WidgetRenderer.jsx` — chart formatting
- `client/src/components/Charts/KPIWidget.jsx` — KPI formatting
- `client/src/components/Charts/DataTable.jsx` — table column rendering

---

### Test Query Panel for Agent Creation — 2026-03-10 (complete)

New iterative query refinement workflow built into the "Create Agent" form on the Automation page.

**Problem solved:** Agents were being created with incorrect queries, so the data they operated on was wrong. Users had no way to verify a query before activating an agent.

**How it works:**
1. User fills in agent instructions (e.g. "Find sales orders over $10,000")
2. Clicks "Run Test" → `POST /api/automation/test-query` generates the SuiteQL query and runs it against NetSuite
3. UI shows: generated SQL query, total result count, and a 5-row preview table
4. Three refinement options:
   - **Accept this query** — locks the plan; sent as `cachedPlan` when saving the agent (skips Groq on first run)
   - **Results look wrong** → feedback textarea → "Refine & retry" — sends previous plan + feedback to Groq for correction
   - **Edit SQL** — turns query into an editable textarea → "Run edited query" sends `customQuery` directly
5. Changing the instructions text invalidates any accepted plan

**Architecture:**
- `POST /api/automation/test-query` — no side effects, supports `{ instructions, feedback, previousPlan, customQuery }` — runs via `testAgentQuery()` in `autonomousAgentService.js`
- `testAgentQuery()` bypasses plan cache, supports manual SQL override, saves `correction` memory when user edits
- `POST /api/automation/agents` and `PUT /api/automation/agents/:id` both accept `cachedPlan` to seed the plan on create/update

**Key files:**
- `server/services/autonomousAgentService.js` — `testAgentQuery()` function
- `server/routes/autonomousAgents.js` — `POST /api/automation/test-query` endpoint
- `client/src/pages/AutomationPage.jsx` — Test Query panel in `AgentForm`

---

### SuiteQL Status Filter Fix — 2026-03-10 (complete)

**Problem:** AI was adding `NOT LIKE '%Billed%'` status filters to sales order queries even when the user did not ask for "open" or "unbilled" orders. This caused some valid records to be excluded.

**Root cause:** The schema context guidance was ambiguous, and the single "sales order" example had status filters baked in.

**Fix:**
- Added `CRITICAL:` note to `S_TRANSACTION` in `schemaContext.js`: only add status filters when instructions explicitly mention "open", "unbilled", "not billed", "pending", or similar
- Split the single sales order example into two separate variants:
  - `open/unbilled` (tagged: `open order`, `unbilled`, `not billed`) — with full status filters
  - `all orders` (tagged: `sales order`, `salesord`, `all sales orders`) — no status filters at all
- `S_SYNTAX` already bans `YEAR()` / `MONTH()` functions

---

### NetSuite Live Schema Integration — 2026-03-10 (complete)

Integrated the full 25.6MB NetSuite JSON schema export into the AI decision-making pipeline.

**Problem:** The hand-curated schema in `schemaContext.js` only covered ~15 tables. When users asked about less common tables (e.g. `opportunity`, `supportcase`, `item`), the AI had to guess field names and often got them wrong.

**Solution — Parse once → SQLite → keyword lookup at query time:**
1. `netsuite-schema.json` (2,123 tables, 55,984 columns, 72,127 relationships) imported into SQLite via `importNetSuiteSchema.js`
2. `schemaLookup.js` does keyword-based table matching at query time — finds relevant tables, fetches their real column names and data types, formats into a compact prompt block (~200-600 tokens)
3. `schemaContext.js` `buildSchemaContext()` appends the live schema block after the hand-curated sections
4. `POST /api/netsuite/import-schema` endpoint lets admins re-import via API after schema updates

**Token efficiency:** Always includes `transaction`, `transactionline`, `customer` (3 core tables). Adds up to 6 more tables matched by keyword. Max 20 columns per table. At most 15 join relationships.

**Key files:**
- `server/scripts/importNetSuiteSchema.js` — one-time import script (re-runnable)
- `server/services/schemaLookup.js` — keyword search + compact prompt formatting
- `server/services/schemaContext.js` — updated `buildSchemaContext()` to append live schema
- `server/routes/netsuite.js` — `GET /api/netsuite/schema-stats`, `POST /api/netsuite/import-schema`
- `server/db/database.js` — `ns_schema_tables`, `ns_schema_columns`, `ns_schema_relationships` tables + indexes
