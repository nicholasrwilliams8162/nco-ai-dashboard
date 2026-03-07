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

## Current status

**Fully working.** Dashboard queries, agent write operations, autonomous scheduled agents, Railway cloud deployment, and Electron desktop app all functional.

## Key files

```
server/
  index.js                          # Express app, static serving in prod
  routes/ai.js                      # POST /api/ai/query, GET /api/ai/history
  routes/agent.js                   # POST /api/agent/plan|execute, history, revert
  routes/auth.js                    # OAuth PKCE flow + Groq key + settings
  routes/dashboard.js               # Widget CRUD, layout, refresh
  routes/autonomousAgents.js        # Agents, todos, notifications, runs CRUD
  services/aiService.js             # Groq query pipeline + self-correction
  services/agentService.js          # Agent planning + plan execution
  services/autonomousAgentService.js # Autonomous agent execution engine
  services/schedulerService.js      # node-cron scheduler
  services/restRecordClient.js      # NetSuite REST Record API
  services/netsuiteClient.js        # SuiteQL + token refresh
  services/schemaContext.js         # Section-selected schema context
  db/database.js                    # SQLite init + all migrations

client/src/
  App.jsx                           # Root — 3-tab nav (Dashboard/Agent/Automation)
  pages/AgentPage.jsx               # Manual agent write operations
  pages/AutomationPage.jsx          # Autonomous agents + approvals + activity
  components/Dashboard/
  components/Charts/
  components/QueryBar/
  components/Settings/

electron/
  main.cjs                          # Electron main process (tray, window, server spawn)
```

## To resume
- **Web dev**: `cd ~/netsuite-ai-dashboard && npm run dev` → http://localhost:5173
- **Electron dev**: `npm run electron:dev`
- **Build installer**: `npm run electron:dist`
- **Deploy**: `git push master` (Railway auto-deploys)
- If port 3001 stuck: `lsof -ti :3001 | xargs kill -9`

## Ideas / next steps
- Multi-dashboard support
- Custom app icon for Electron (.icns)
- Code signing for Mac distribution
- Windows build (NSIS installer)
- Persistent volume on Railway (Pro plan)
- Agent multi-step workflows
- Export dashboard as PDF/image
