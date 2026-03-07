import axios from 'axios';
import { getValidToken } from './netsuiteClient.js';

function getRecordBase(accountId) {
  const host = accountId.replace(/_/g, '-').toLowerCase();
  return `https://${host}.suitetalk.api.netsuite.com/services/rest/record/v1`;
}

// Normalize values: REST API uses JSON booleans, not SuiteQL "T"/"F" strings
function normalizeValues(values) {
  if (!values || typeof values !== 'object') return values;
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === 'T') out[k] = true;
    else if (v === 'F') out[k] = false;
    else out[k] = v;
  }
  return out;
}

const TIMEOUTS = {
  read:  30_000,  // GET requests
  write: 90_000,  // POST / PATCH — complex records (sales orders, etc.) can be slow
};

function nsError(err) {
  const detail =
    err.response?.data?.['o:errorDetails']?.[0]?.detail ||
    err.response?.data?.message ||
    err.message;
  throw new Error(`NetSuite REST error: ${detail}`);
}

// Retry once on timeout — NetSuite occasionally has transient slowness
async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      console.warn('[REST] Timeout — retrying once…');
      return await fn();
    }
    throw err;
  }
}

export async function createRecord(recordType, values) {
  const token = await getValidToken();
  const url = `${getRecordBase(token.account_id)}/${recordType}`;
  console.log(`[REST] POST ${url}`, values);

  try {
    const res = await withRetry(() => axios.post(url, normalizeValues(values), {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
      timeout: TIMEOUTS.write,
    }));
    const location = res.headers?.location || '';
    const id = location.split('/').pop();
    return {
      id,
      recordType,
      beforeState: null,
      text: `${recordType} created successfully. Internal ID: ${id}`,
    };
  } catch (err) {
    nsError(err);
  }
}

export async function updateRecord(recordType, id, values) {
  const token = await getValidToken();
  const base = getRecordBase(token.account_id);
  const url = `${base}/${recordType}/${id}`;
  const headers = { Authorization: `Bearer ${token.access_token}` };
  console.log(`[REST] PATCH ${url}`, values);

  // Fetch before-state and send the PATCH in parallel — before-state is non-blocking
  const fields = Object.keys(normalizeValues(values)).join(',');
  const [beforeResult, patchResult] = await Promise.allSettled([
    axios.get(`${url}?fields=${fields}`, { headers, timeout: TIMEOUTS.read }),
    withRetry(() => axios.patch(url, normalizeValues(values), {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: TIMEOUTS.write,
    })),
  ]);

  if (patchResult.status === 'rejected') {
    nsError(patchResult.reason);
  }

  let beforeState = null;
  if (beforeResult.status === 'fulfilled') {
    beforeState = {};
    for (const field of Object.keys(values)) {
      if (beforeResult.value.data[field] !== undefined) {
        beforeState[field] = beforeResult.value.data[field];
      }
    }
  } else {
    console.warn('[REST] Could not capture before-state:', beforeResult.reason?.message);
  }

  return {
    id: String(id),
    recordType,
    beforeState,
    text: `${recordType} ${id} updated successfully.`,
  };
}

export async function getRecord(recordType, id, fields = []) {
  const token = await getValidToken();
  const params = fields.length ? `?fields=${fields.join(',')}` : '';
  const url = `${getRecordBase(token.account_id)}/${recordType}/${id}${params}`;
  console.log(`[REST] GET ${url}`);

  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      timeout: 30000,
    });
    return {
      id: String(id),
      recordType,
      beforeState: null,
      record: res.data,
      text: JSON.stringify(res.data, null, 2),
    };
  } catch (err) {
    nsError(err);
  }
}

// Used by the revert endpoint — inactivate a created record
export async function inactivateRecord(recordType, id) {
  return updateRecord(recordType, id, { isinactive: true });
}
