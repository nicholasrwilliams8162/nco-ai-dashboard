import axios from 'axios';
import { getValidToken, sanitizeSuiteQL } from './netsuiteClient.js';

function translateMcpError(err) {
  const status = err.response?.status;
  const body = err.response?.data;
  console.error('[MCP] HTTP', status, 'response body:', JSON.stringify(body));

  const nsDetail =
    body?.['o:errorDetails']?.[0]?.detail ||
    body?.error_description ||
    body?.error ||
    body?.message ||
    (typeof body === 'string' ? body : null);

  if (status === 401) {
    return new Error(`NetSuite MCP 401: ${nsDetail || 'Unauthorized'}. Check that "MCP Server Connection" permission is on the role AND the integration record has REST Web Services scope.`);
  }
  if (status === 403) {
    return new Error(`NetSuite MCP 403: ${nsDetail || 'Forbidden'}. Add "MCP Server Connection" permission to your integration role.`);
  }
  if (status === 404) {
    return new Error(`NetSuite MCP 404: ${nsDetail || 'Not found'}. Install the MCP Standard Tools SuiteApp (Bundle 522506) from the SuiteApp Marketplace.`);
  }
  return new Error(`NetSuite MCP ${status || 'error'}: ${nsDetail || err.message}`);
}

function getMcpUrl(accountId) {
  const host = accountId.replace(/_/g, '-').toLowerCase();
  return `https://${host}.suitetalk.api.netsuite.com/services/mcp/v1/all`;
}

// Per-user tools cache — key: userId || 'default'
const toolsCache = new Map();
const TOOLS_CACHE_TTL = 5 * 60 * 1000;

async function mcpRequest(method, params = undefined, userId = null) {
  const token = await getValidToken(userId);
  const url = getMcpUrl(token.account_id);

  console.log(`[MCP] ${method} → ${url}`);

  const body = { jsonrpc: '2.0', id: Date.now(), method };
  if (params !== undefined) body.params = params;

  const response = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
    },
    timeout: 30000,
  });

  if (response.data?.error) {
    const msg = response.data.error.message || JSON.stringify(response.data.error);
    throw new Error(`MCP error: ${msg}`);
  }

  return response.data?.result;
}

// MCP requires an initialize handshake before other methods.
// We send it before every real request since the endpoint is stateless.
async function mcpInitialize(userId = null) {
  await mcpRequest('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: { roots: { listChanged: false }, sampling: {} },
    clientInfo: { name: 'netsuite-ai-dashboard', version: '1.0.0' },
  }, userId);
}

export async function listMcpTools(forceRefresh = false, userId = null) {
  const cacheKey = userId || 'default';
  const cached = toolsCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.at < TOOLS_CACHE_TTL) {
    return cached.tools;
  }

  try {
    await mcpInitialize(userId);
    const result = await mcpRequest('tools/list', undefined, userId);
    const tools = result?.tools || [];
    toolsCache.set(cacheKey, { tools, at: Date.now() });
    return tools;
  } catch (err) {
    throw translateMcpError(err);
  }
}

export async function callMcpTool(toolName, args, userId = null) {
  let result;
  try {
    await mcpInitialize(userId);
    result = await mcpRequest('tools/call', { name: toolName, arguments: args }, userId);
  } catch (err) {
    throw translateMcpError(err);
  }

  // MCP result content is an array of typed blocks — extract the text
  if (result?.content) {
    const textBlock = result.content.find(c => c.type === 'text');
    return {
      raw: result,
      text: textBlock?.text || JSON.stringify(result.content),
      isError: result.isError || false,
    };
  }

  return { raw: result, text: JSON.stringify(result), isError: false };
}

/**
 * Run a SuiteQL query through MCP and return { items, totalResults, hasMore }
 * — same shape as netsuiteClient.runSuiteQL() so callers can migrate transparently.
 */
export async function runMcpSuiteQL(query, userId = null) {
  console.log('[MCP SuiteQL] Raw query:\n', query);
  const sanitized = sanitizeSuiteQL(query);
  if (sanitized !== query) {
    console.log('[MCP SuiteQL] Auto-corrected to:\n', sanitized);
  }

  const mcpResult = await callMcpTool('ns_runCustomSuiteQL', { sqlQuery: sanitized, description: 'Dashboard query' }, userId);

  if (mcpResult.isError) {
    throw new Error(`NetSuite MCP SuiteQL error: ${mcpResult.text}`);
  }

  // Parse the text result — NetSuite may return several shapes
  let parsed;
  try {
    parsed = JSON.parse(mcpResult.text);
  } catch {
    // If unparseable, treat as fatal
    throw new Error(`MCP runSuiteQL returned unexpected response: ${mcpResult.text?.slice(0, 200)}`);
  }

  // Handle known response shapes
  if (Array.isArray(parsed)) {
    // Error: [{ error: "..." }]
    if (parsed.length === 1 && parsed[0]?.error) {
      throw new Error(`NetSuite SuiteQL error: ${parsed[0].error}`);
    }
    // ns_runCustomSuiteQL shape: [{ data: [...], resultCount: N, numberOfPages: N, ... }]
    if (parsed.length === 1 && parsed[0]?.data !== undefined) {
      const r = parsed[0];
      return {
        items: r.data || [],
        totalResults: r.resultCount ?? r.data?.length ?? 0,
        hasMore: (r.numberOfPages ?? 1) > 1,
      };
    }
    return { items: parsed, totalResults: parsed.length, hasMore: false };
  }
  // Error returned as object: { error: "..." }
  if (parsed.error) {
    throw new Error(`NetSuite SuiteQL error: ${parsed.error}`);
  }
  // ns_runCustomSuiteQL shape: { data: [...], resultCount: N, numberOfPages: N, ... }
  if (parsed.data !== undefined) {
    return {
      items: parsed.data || [],
      totalResults: parsed.resultCount ?? parsed.data?.length ?? 0,
      hasMore: (parsed.numberOfPages ?? 1) > 1,
    };
  }
  if (parsed.items !== undefined) {
    return {
      items: parsed.items || [],
      totalResults: parsed.totalResults ?? parsed.items?.length ?? 0,
      hasMore: parsed.hasMore || false,
    };
  }
  if (parsed.rows !== undefined) {
    return { items: parsed.rows, totalResults: parsed.count ?? parsed.rows.length, hasMore: false };
  }
  // Fallback: wrap whatever we got
  return { items: [parsed], totalResults: 1, hasMore: false };
}

/**
 * Fetch record type metadata from NetSuite via MCP and return a compact
 * human-readable text block suitable for injection into a Groq system prompt.
 */
export async function getMcpRecordTypeMetadata(recordType, userId = null) {
  const mcpResult = await callMcpTool('ns_getSuiteQLMetadata', { recordType }, userId);

  if (mcpResult.isError) {
    throw new Error(`NetSuite MCP metadata error: ${mcpResult.text}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(mcpResult.text);
  } catch {
    return mcpResult.text?.slice(0, 1500) || '';
  }

  // ns_getSuiteQLMetadata returns { success, metadata: { type, properties: { fieldName: { title, type, ... } } } }
  if (parsed.metadata?.properties) {
    const props = parsed.metadata.properties;
    const lines = Object.entries(props).slice(0, 100).map(([name, f]) => {
      const nullable = f.nullable ? ' [nullable]' : '';
      const joinable = f['x-n:joinable'] ? ` [joinable→${f['x-n:recordType'] || '?'}]` : '';
      return `  ${name}: ${f.type || '?'}${nullable}${joinable}${f.title ? ` (${f.title})` : ''}`;
    });
    return `Record type "${recordType}" fields:\n${lines.join('\n')}`;
  }

  // Fallback: older array shape { fields: [...] }
  const fields = Array.isArray(parsed) ? parsed : parsed.fields || parsed.body || [];
  if (!fields.length) return `No field metadata returned for "${recordType}".`;
  const lines = fields.slice(0, 80).map(f => {
    const req = f.isRequired || f.mandatory ? ' [required]' : '';
    return `  ${f.name || f.id}: ${f.type || f.fieldType || '?'}${req}${f.label ? ` (${f.label})` : ''}`;
  });
  return `Record type "${recordType}" fields:\n${lines.join('\n')}`;
}
