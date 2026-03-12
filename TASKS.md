# Project Tasks

## Email Agent Integration (Gmail + Outlook)
**Status:** Planned — not started
**Priority:** High

### Overview
Allow users to connect their Gmail and/or Outlook accounts so automation agents can monitor email inboxes, extract invoice data from emails and PDF attachments using AI, and create/update NetSuite records (vendor bills etc.) through the existing approval queue.

### New Files to Create
- `server/routes/emailAuth.js` — Gmail + Outlook OAuth initiate/callback/disconnect/status routes
- `server/services/gmailClient.js` — Gmail REST API wrapper (token refresh, list messages, get message, get attachment)
- `server/services/outlookClient.js` — Microsoft Graph API wrapper (same interface as gmailClient)
- `server/services/pdfExtractor.js` — `pdf-parse` + Claude vision fallback for scanned PDFs; `extractInvoiceData()` via AI
- `server/services/emailAgentService.js` — `executeEmailAgent(agentId)` engine mirroring existing `autonomousAgentService.js`

### Files to Modify
- `server/db/database.js` — add `email_connections`, `email_processing_log` tables; add `source`/`provider`/`email_filter` columns to `autonomous_agents`; add `service` column to `oauth_pending`
- `server/index.js` — register `emailAuthRoutes`, increase JSON body limit to 10mb
- `server/routes/auth.js` — extend `/api/auth/settings` to return `gmailConnected`, `gmailEmail`, `outlookConnected`, `outlookEmail`
- `server/routes/autonomousAgents.js` — accept `source`/`provider`/`email_filter` in agent create/update; add `POST /api/automation/email/test-fetch` dry-run endpoint
- `server/services/autonomousAgentService.js` — add `if (agent.source === 'email') return executeEmailAgent(agentId)` dispatch at top of `executeAgent()`
- `client/src/components/Settings/SettingsPanel.jsx` — add "Email Connections" section with Connect Gmail + Connect Outlook buttons
- `client/src/pages/AutomationPage.jsx` — add source toggle ("NetSuite Query" / "Email Monitor"), provider select, email filter sub-form, "Test Email Fetch" button

### New Dependencies
```bash
cd server && npm install pdf-parse
```

### Environment Variables Required
```
GOOGLE_CLIENT_ID=        # Google Cloud Console → OAuth 2.0 Client ID
GOOGLE_CLIENT_SECRET=
GMAIL_REDIRECT_URI=      # http://localhost:3001/api/auth/gmail/callback

MICROSOFT_CLIENT_ID=     # Azure Portal → App registrations
MICROSOFT_CLIENT_SECRET=
OUTLOOK_REDIRECT_URI=    # http://localhost:3001/api/auth/outlook/callback
```

### Setup Notes
- **Google**: console.cloud.google.com → New project → Enable Gmail API → Credentials → OAuth 2.0 Web Client → add redirect URI
- **Microsoft**: portal.azure.com → App registrations → New → "Accounts in any organizational directory and personal Microsoft accounts" → Web redirect URI

### Email Filter Schema (stored as JSON in `email_filter` column)
```json
{
  "senders": "billing@vendor.com",
  "subjectContains": "invoice",
  "hasAttachment": true,
  "maxAgeDays": 7
}
```

### Processing Flow
1. Agent runs on schedule → fetches unprocessed emails matching filter
2. Downloads PDF attachments → `pdf-parse` extracts text (Claude vision fallback for scanned PDFs)
3. AI extracts invoice data: vendor, amount, date, line items, invoice number
4. AI maps to NetSuite fields → creates `agent_todos` for approval
5. User approves → NetSuite vendor bill created via MCP

### Duplicate Prevention
`email_processing_log` table stores `(user_id, provider, message_id, agent_id)` — same email never processed twice by the same agent.
