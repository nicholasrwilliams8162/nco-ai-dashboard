import { Router } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import db from '../db/database.js';
import { requireClerkAuth } from '../middleware/auth.js';

const router = Router();

const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3001/api/auth/netsuite/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function getAuthUrl(accountId) {
  const host = accountId.replace(/_/g, '-').toLowerCase();
  return `https://${host}.app.netsuite.com/app/login/oauth2/authorize.nl`;
}

function getTokenUrl(accountId) {
  const host = accountId.replace(/_/g, '-').toLowerCase();
  return `https://${host}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
}

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// GET /api/auth/netsuite/status
router.get('/netsuite/status', requireClerkAuth, (req, res) => {
  const row = db.prepare('SELECT account_id FROM netsuite_tokens WHERE user_id = ?').get(req.userId);
  if (!row) return res.json({ connected: false, accountId: null });
  res.json({ connected: true, accountId: row.account_id });
});

// POST /api/auth/netsuite/initiate
router.post('/netsuite/initiate', requireClerkAuth, (req, res) => {
  const { accountId, clientId, clientSecret } = req.body;

  if (!accountId || !clientId || !clientSecret) {
    return res.status(400).json({ error: 'accountId, clientId, and clientSecret are required' });
  }

  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString('hex');

  // Store PKCE state in DB (not session) so it survives the cross-origin redirect
  db.prepare(`
    INSERT INTO oauth_pending (state, verifier, account_id, client_id, client_secret, user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(state, verifier, accountId, clientId, clientSecret, req.userId);

  // Clean up stale pending rows older than 10 minutes
  db.prepare('DELETE FROM oauth_pending WHERE created_at < unixepoch() - 600').run();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'mcp',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `${getAuthUrl(accountId)}?${params.toString()}`;
  console.log('[OAuth] Authorization URL:', authUrl);
  res.json({ authUrl });
});

// GET /api/auth/netsuite/callback
router.get('/netsuite/callback', async (req, res) => {
  const { code, state, error } = req.query;
  console.log('[OAuth callback] query:', req.query);

  if (error) {
    console.error('[OAuth callback] NetSuite returned error:', error, req.query.error_description);
    return res.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent(req.query.error_description || error)}`);
  }

  if (!state) {
    return res.redirect(`${FRONTEND_URL}?auth_error=invalid_state`);
  }

  const pending = db.prepare('SELECT * FROM oauth_pending WHERE state = ?').get(state);
  if (!pending) {
    return res.redirect(`${FRONTEND_URL}?auth_error=invalid_state`);
  }
  db.prepare('DELETE FROM oauth_pending WHERE state = ?').run(state);

  const { verifier: oauthVerifier, account_id: oauthAccountId, client_id: oauthClientId, client_secret: oauthClientSecret } = pending;

  try {
    const credentials = Buffer.from(`${oauthClientId}:${oauthClientSecret}`).toString('base64');

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: oauthVerifier,
    });

    const response = await axios.post(getTokenUrl(oauthAccountId), params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
    });

    const { access_token, refresh_token, expires_in, scope } = response.data;
    const expiresAt = Math.floor(Date.now() / 1000) + (expires_in || 3600);

    const tokenUserId = pending.user_id;
    db.prepare(`
      INSERT INTO netsuite_tokens (user_id, account_id, client_id, client_secret, access_token, refresh_token, expires_at, scope)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        account_id    = excluded.account_id,
        client_id     = excluded.client_id,
        client_secret = excluded.client_secret,
        access_token  = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at    = excluded.expires_at,
        scope         = excluded.scope,
        updated_at    = CURRENT_TIMESTAMP
    `).run(tokenUserId, oauthAccountId, oauthClientId, oauthClientSecret, access_token, refresh_token || null, expiresAt, scope || null);

    res.redirect(`${FRONTEND_URL}?connected=true`);
  } catch (err) {
    console.error('OAuth callback error:', err.response?.data || err.message);
    const msg = err.response?.data?.error_description || err.response?.data?.error || 'Token exchange failed';
    res.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent(msg)}`);
  }
});

// GET /api/auth/settings — returns which keys are set (never the values)
router.get('/settings', requireClerkAuth, (req, res) => {
  const row = db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'groq_api_key'").get(req.userId);
  const envKey = process.env.GROQ_API_KEY;
  const isSet = !!(row?.value || envKey);
  res.json({ groqKeySet: isSet });
});

// POST /api/auth/settings — save API keys
router.post('/settings', requireClerkAuth, (req, res) => {
  const { groqApiKey } = req.body;
  if (groqApiKey !== undefined) {
    if (!groqApiKey.trim()) {
      db.prepare("DELETE FROM user_settings WHERE user_id = ? AND key = 'groq_api_key'").run(req.userId);
    } else {
      db.prepare("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'groq_api_key', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value")
        .run(req.userId, groqApiKey.trim());
    }
  }
  res.json({ ok: true });
});

// POST /api/auth/netsuite/disconnect
router.post('/netsuite/disconnect', requireClerkAuth, (req, res) => {
  db.prepare('DELETE FROM netsuite_tokens WHERE user_id = ?').run(req.userId);
  res.json({ ok: true });
});

export default router;
