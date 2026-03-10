import axios from 'axios';
import db from '../db/database.js';

function getBaseUrl(accountId) {
  const accountIdForUrl = accountId.replace(/_/g, '-').toLowerCase();
  return `https://${accountIdForUrl}.suitetalk.api.netsuite.com/services/rest`;
}

function getTokenUrl(accountId) {
  const accountIdForUrl = accountId.replace(/_/g, '-').toLowerCase();
  return `https://${accountIdForUrl}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
}

export async function getValidToken(userId) {
  const row = userId
    ? db.prepare('SELECT * FROM netsuite_tokens WHERE user_id = ?').get(userId)
    : db.prepare('SELECT * FROM netsuite_tokens WHERE id = 1').get();

  if (!row) {
    throw new Error('Not connected to NetSuite. Please connect in Settings.');
  }

  const nowSecs = Math.floor(Date.now() / 1000);

  // Refresh if token expires within 60 seconds
  if (row.expires_at - 60 < nowSecs) {
    if (!row.refresh_token) {
      throw new Error('NetSuite token expired and no refresh token available. Please reconnect in Settings.');
    }

    const tokenUrl = getTokenUrl(row.account_id);
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
    });

    const credentials = Buffer.from(`${row.client_id}:${row.client_secret}`).toString('base64');

    const response = await axios.post(tokenUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
    });

    const { access_token, refresh_token, expires_in, scope } = response.data;
    const newExpiresAt = nowSecs + (expires_in || 3600);

    if (userId) {
      db.prepare(`
        UPDATE netsuite_tokens
        SET access_token = ?, refresh_token = ?, expires_at = ?, scope = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(access_token, refresh_token || row.refresh_token, newExpiresAt, scope || row.scope, userId);
    } else {
      db.prepare(`
        UPDATE netsuite_tokens
        SET access_token = ?, refresh_token = ?, expires_at = ?, scope = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `).run(access_token, refresh_token || row.refresh_token, newExpiresAt, scope || row.scope);
    }

    return { ...row, access_token, expires_at: newExpiresAt };
  }

  return row;
}

/**
 * Auto-correct common SuiteQL query mistakes before sending to NetSuite.
 * The AI model repeatedly generates patterns that cause NetSuite API errors.
 * Fixing them here ensures correctness regardless of what the model generates.
 */
/**
 * Rewrite `JOIN item alias ON alias.id = tlAlias.item` → BUILTIN.DF(tlAlias.item)
 *
 * The `item` table requires "Lists - Items" permission on the integration role.
 * If that permission is missing, every JOIN to item fails with
 * "Record 'item' was not found" — even with LEFT OUTER JOIN and IS NOT NULL guards.
 *
 * BUILTIN.DF(tl.item) resolves the display name of any foreign key without
 * needing the target table's permission, so we use it unconditionally.
 *
 * Only rewrites when the item alias is used solely for displayname/itemid/name/id.
 * If the query needs other item columns (salesprice, itemtype, etc.) we leave it
 * unchanged and let the query fail with a meaningful error.
 */
function rewriteItemJoin(q) {
  // Match: LEFT OUTER JOIN item <itemAlias> ON <itemAlias>.id = <tlAlias>.item
  //     OR: LEFT OUTER JOIN item <itemAlias> ON <tlAlias>.item = <itemAlias>.id
  //     OR: [INNER] JOIN item <itemAlias> ON ...
  const joinRe = /(?:LEFT\s+OUTER\s+|INNER\s+)?JOIN\s+item\s+(\w+)\s+ON\s+(?:(\w+)\.id\s*=\s*(\w+)\.item|(\w+)\.item\s*=\s*(\w+)\.id)/i;
  const jm = joinRe.exec(q);
  if (!jm) return q;

  const itemAlias = jm[1];
  // tlAlias is whichever side of the ON has .item
  const tlAlias = jm[3] || jm[4];

  // Collect all columns referenced from the item alias
  const colRe = new RegExp(`\\b${itemAlias}\\.(\\w+)`, 'gi');
  const usedCols = [...q.matchAll(colRe)].map(m => m[1].toLowerCase());
  const safe = ['displayname', 'itemid', 'name', 'id'];
  if (!usedCols.length || !usedCols.every(c => safe.includes(c))) return q;

  // Remove the JOIN clause
  q = q.replace(/\s*(?:LEFT\s+OUTER\s+|INNER\s+)?JOIN\s+item\s+\w+\s+ON\s+\S+\s*=\s*\S+/gi, '');

  // Replace alias.displayname / alias.itemid / alias.name → BUILTIN.DF(tlAlias.item) AS col
  q = q.replace(new RegExp(`\\b${itemAlias}\\.(displayname|itemid|name)\\b`, 'gi'),
    (_, col) => `BUILTIN.DF(${tlAlias}.item) AS ${col}`);
  // alias.id → raw foreign key value
  q = q.replace(new RegExp(`\\b${itemAlias}\\.id\\b`, 'gi'), `${tlAlias}.item`);

  // Oracle/SuiteQL does not allow AS aliases in GROUP BY — strip them
  q = q.replace(/(GROUP\s+BY\s+)([\s\S]*?)(\s+(?:ORDER\s+BY|HAVING|WHERE|$|\)))/gi,
    (match, gb, cols, tail) => {
      const cleaned = cols.replace(/\bBUILTIN\.DF\([^)]+\)\s+AS\s+\w+/gi,
        expr => expr.replace(/\s+AS\s+\w+/i, ''));
      return gb + cleaned + tail;
    });

  return q;
}

export function sanitizeSuiteQL(query) {
  return rewriteItemJoin(query);
}

export async function runSuiteQL(query, { limit = 500, offset = 0, userId } = {}) {
  console.log('[SuiteQL] Raw query from AI:\n', query);
  const sanitized = sanitizeSuiteQL(query);
  if (sanitized !== query) {
    console.log('[SuiteQL] Auto-corrected to:\n', sanitized);
  } else {
    console.log('[SuiteQL] No corrections needed, sending as-is.');
  }
  const token = await getValidToken(userId);
  const baseUrl = getBaseUrl(token.account_id);
  const url = `${baseUrl}/query/v1/suiteql?limit=${limit}&offset=${offset}`;

  try {
    const response = await axios.post(
      url,
      { q: sanitized },
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'Content-Type': 'application/json',
          prefer: 'transient',
        },
        timeout: 30000,
      }
    );

    return {
      items: response.data.items || [],
      totalResults: response.data.totalResults || 0,
      hasMore: response.data.hasMore || false,
    };
  } catch (error) {
    const nsError = error.response?.data;
    const message = nsError?.['o:errorDetails']?.[0]?.detail || nsError?.message || error.message;
    throw new Error(`NetSuite API error: ${message}`);
  }
}

export async function testConnection() {
  const result = await runSuiteQL('SELECT id, companyname FROM subsidiary WHERE ROWNUM <= 1');
  return { connected: true, subsidiaries: result.items };
}
