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

---

## Current status

**Fully working, mobile responsive.** Queries run, results display, widgets pin to dashboard, chart types switchable, DataTables rendering correctly. Agent page live — creates/updates real NetSuite records, clarification flow prevents bad data, full audit log with revert support.

## Key files

```
server/
  index.js                      # Express app, all routes mounted
  routes/ai.js                  # POST /api/ai/query, GET /api/ai/history
  routes/agent.js               # POST /api/agent/plan|execute, GET /history, POST /history/:id/revert
  routes/auth.js                # OAuth PKCE flow + Groq key + settings
  routes/dashboard.js           # Widget CRUD, layout, refresh
  services/aiService.js         # Groq query pipeline + self-correction
  services/agentService.js      # Agent planning + plan execution (5-min TTL store)
  services/restRecordClient.js  # NetSuite REST Record API (create/update/get/inactivate)
  services/netsuiteClient.js    # SuiteQL + token refresh (getValidToken exported)
  services/schemaContext.js     # SuiteQL schema prompt context
  db/database.js                # SQLite init + migrations (incl. agent_history)

client/src/
  App.jsx                       # Root — auth gating, navbar, Dashboard/Agent toggle
  pages/AgentPage.jsx           # Agent page (plan → confirm → execute flow)
  components/Dashboard/DashboardGrid.jsx
  components/Dashboard/WidgetCard.jsx
  components/Charts/WidgetRenderer.jsx
  components/Charts/DataTable.jsx
  components/QueryBar/NaturalLanguageInput.jsx
  components/Settings/SettingsPanel.jsx
  store/dashboardStore.js
```

## To resume
1. `cd ~/netsuite-ai-dashboard && npm run dev`
2. Open http://localhost:5173 (or 5174 if port taken)
3. If port 3001 stuck: `lsof -ti :3001 | xargs kill -9`

## Ideas / next steps
- Multi-dashboard support (create / switch dashboards)
- Query history UI on dashboard page
- Agent multi-step workflows (find customer → update)
- Custom MCP tool builder via SuiteScript
- Scheduled refresh notifications
- Export dashboard as PDF/image
- Production deployment (Docker, env config)
