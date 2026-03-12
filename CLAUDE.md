# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start both client and server in dev mode (concurrent)
npm run dev

# Install all dependencies (root + server + client)
npm run install:all

# Production build (installs deps + builds client)
npm run build

# Run server only (production)
npm start

# Electron desktop app
npm run electron:dev   # build + launch Electron
npm run electron:dist  # package to dist-electron/
```

Individual workspaces:
```bash
# Server only (port 3001)
cd server && npm run dev   # nodemon
cd server && npm start     # node

# Client only (port 5173)
cd client && npm run dev   # vite
```

No test suite exists in this project.

Kill stuck port: `lsof -ti :3001 | xargs kill -9`

## Architecture Overview

Three deployment targets share the same server + client code:
1. **Web** — Express serves the React build at production; Vite proxy in dev
2. **Railway** — `railway.json` + `nixpacks.toml` for cloud hosting; persistent DB at `/data` via `DATA_DIR` env var
3. **Electron** — `electron/main.cjs` spawns the Express server as a child process, loads the React build in a `BrowserWindow`, adds a system tray icon

### Server (`server/`)

Express app (`server/index.js`) with these route groups, all prefixed `/api/`:
- `/auth` — NetSuite OAuth 2.0 PKCE flow, Clerk auth status, settings
- `/ai` — Natural language → SuiteQL → widget creation
- `/dashboard` — Widget CRUD, data refresh (cached in SQLite)
- `/netsuite` — Direct SuiteQL query execution
- `/agent` — Two-phase MCP write operations (plan → confirm → execute)
- `/automation` — Autonomous agents, scheduling, approval queue

**Auth middleware** (`server/middleware/auth.js`): `requireClerkAuth` extracts `userId` from Clerk JWT via `@clerk/express`. All routes except `/api/auth/netsuite/callback` are protected. The `userId` is threaded through every DB query so each user sees only their own data.

**SQLite database** (`server/db/database.js`): `better-sqlite3` with WAL mode. Schema is applied from `schema.sql` on startup; migrations run inline via `ALTER TABLE` with column existence checks. No migration framework — add new migrations at the bottom of `database.js`.

**Key services:**
- `netsuiteClient.js` — `getValidToken()` (auto-refreshes OAuth tokens), `runSuiteQL()`, query sanitizer that rewrites `JOIN item` → `BUILTIN.DF()`. **Always use `getValidToken(userId)` — never read the token row directly.**
- `aiService.js` — Groq LLM call (model: `llama-3.3-70b-versatile`) with `response_format: { type: 'json_object' }` and `max_tokens: 4000`. Reads Groq API key from `user_settings` table (per-user) or `GROQ_API_KEY` env.
- `agentService.js` — Two-step MCP agent: `/plan` has Groq pick a tool+args, `/execute` calls the NetSuite MCP endpoint.
- `autonomousAgentService.js` — Runs agents on schedule, self-corrects on SuiteQL failure, stores memories.
- `schedulerService.js` — `node-cron` scheduler, initialized on server start via `initScheduler()`.
- `mcpClient.js` — JSON-RPC 2.0 wrapper for `https://<accountid>.suitetalk.api.netsuite.com/services/mcp/v1/all`.
- `schemaContext.js` — Injects relevant SuiteQL schema hints into AI system prompts.
- `restRecordClient.js` — NetSuite REST Record API for create/update/delete operations.

### Client (`client/src/`)

React 18 + Vite SPA. State managed with **Zustand** (`store/dashboardStore.js`). API calls via axios instance in `api/client.js`.

Three pages rendered by `App.jsx` based on `activePage` state (persisted in `localStorage`):
- **Dashboard** — `DashboardGrid` (react-grid-layout, `compactType="horizontal"`) + `NaturalLanguageInput` query bar
- **Agent** — `pages/AgentPage.jsx` — two-phase MCP write UI
- **Automation** — `pages/AutomationPage.jsx` — agent management, run history, approval queue

Theme (dark/light) toggled via `data-theme` attribute on `<html>`; CSS variables in `index.css` handle the theming.

Sidebar navigation persists `active_page` to `localStorage`. Automation tab shows a badge with pending approval count (polled every 30 s).

### Environment Variables

Server reads from `.env` (via `dotenv`):
```
CLERK_SECRET_KEY=       # Required for Clerk auth
CLERK_PUBLISHABLE_KEY=  # (client uses VITE_CLERK_PUBLISHABLE_KEY)
SESSION_SECRET=         # Express session secret
REDIRECT_URI=           # NetSuite OAuth callback URL
FRONTEND_URL=           # For redirect after OAuth
PORT=3001               # Optional
DATA_DIR=               # Optional: persistent volume path for SQLite (Railway)
GROQ_API_KEY=           # Fallback if not set per-user in DB
```

Client reads `VITE_CLERK_PUBLISHABLE_KEY` from `client/.env`.

## NetSuite / SuiteQL Conventions

**Before suggesting any SuiteQL fix**, validate that every field and table actually exists — do not guess. State uncertainty explicitly rather than trying a non-existent field and waiting for a runtime error.

### Fields that do NOT exist in SuiteQL (confirmed failures)
- `billaddresslist` — not exposed; use `billingaddress` text fields on the transaction
- `amount` on `transaction` — unreliable; use `foreigntotal` instead
- `mainline` on `transaction` — only exists on `transactionline`; never use `t.mainline`
- `balance` / `overduebalancesearch` direct field — use saved search virtual fields

### Required patterns
- **Item display name**: `BUILTIN.DF(tl.item) AS item_name` — never JOIN to the `item` table (permission denied on integration role)
- **Employee names**: use `firstname` and `lastname` columns — `entityid` returns inconsistent formats
- **Transaction totals**: use `foreigntotal` — `amount` is not reliable for SalesOrd/CustInvc/VendBill
- **Open SalesOrd**: `BUILTIN.DF(t.status) LIKE '%Pending%'` — covers Pending Approval, Pending Fulfillment, Pending Billing/Partially Fulfilled, Pending Billing. `LIKE '%Open%'` matches nothing. `NOT LIKE '%Billed%'` is wrong — it excludes "Pending Billing" orders.
- **ROWNUM + GROUP BY**: wrap in subquery — `SELECT * FROM (...GROUP BY...ORDER BY...) WHERE ROWNUM <= N`
- **Booleans**: `'T'` / `'F'` (not `TRUE`/`FALSE`)
- **Current date**: `SYSDATE` (not hardcoded `TO_DATE`)
- **mainline = 'T'**: header/summary line (no item detail); `mainline = 'F'`: item lines

### Debugging approach for NetSuite errors
1. Read the relevant server-side file(s) first
2. Identify every SuiteQL field and table used
3. Cross-check each field against known-working fields above before proposing a fix
4. Check permissions as root cause before assuming a query logic bug — "Record not found" often means missing integration role permission, not a bad query

### Transaction type codes (SuiteQL `type` column)
`CustInvc`, `SalesOrd`, `VendBill`, `Journal`, `PurchOrd`, `CustPymt`, `VendCred`, `Estimate`, `ItemRcpt`, `ItemShip`, `Check`, `Deposit`, `ExpRept`, `CashSale`, `RtnAuth`, `InvAdjst`, `InvTrnfr`

### REST Record API type names (lowercase, for MCP/write operations)
`salesorder`, `invoice`, `vendorbill`, `purchaseorder`, `estimate`, `itemreceipt`, `itemfulfillment`, `journalentry`, `customer`, `vendor`, `contact`, `employee`

## Key Patterns and Gotchas

**SuiteQL** — The query sanitizer in `netsuiteClient.js` auto-rewrites `JOIN item alias ON ...` → `BUILTIN.DF()` when only display name fields are used. Do not fight this pattern.

**DB migrations** — No migration runner; just add `db.exec(...)` blocks with `IF NOT EXISTS` or column-existence checks at the bottom of `database.js`. The file runs top-to-bottom on every server start.

**Agent writes are two-phase** — `/api/agent/plan` calls Groq (read-only, no NS side effects), stores pending plan in memory, returns plan for user confirmation. `/api/agent/execute` retrieves the plan and executes via MCP. Plans expire after ~5 minutes.

**react-grid-layout** — `draggableHandle=".drag-handle"` is set on the grid. Buttons inside widgets need `onMouseDown={e => e.stopPropagation()}` to prevent drag capture.

**DataTables** — Use `datatables.net-dt` directly via `useEffect`/`useRef`. NetSuite always injects a `links` column — strip it from keys and rows before passing to DataTables. Check `DTLib.isDataTable(el)` before init to handle HMR.
