import axios from 'axios';
import { getValidToken } from './netsuiteClient.js';

function translateMcpError(err) {
  const status = err.response?.status;
  const body = err.response?.data;
  // Log the raw body so we can see exactly what NetSuite says
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

// Cache the tool list — it rarely changes
let cachedTools = null;
let toolsCachedAt = 0;
const TOOLS_CACHE_TTL = 5 * 60 * 1000;

async function mcpRequest(method, params = undefined) {
  const token = await getValidToken();
  const url = getMcpUrl(token.account_id);

  console.log(`[MCP] ${method} → ${url}`);

  const body = { jsonrpc: '2.0', id: Date.now(), method };
  if (params !== undefined) body.params = params;

  const response = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26',
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
async function mcpInitialize() {
  await mcpRequest('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: { roots: { listChanged: false }, sampling: {} },
    clientInfo: { name: 'netsuite-ai-dashboard', version: '1.0.0' },
  });
}

export async function listMcpTools(forceRefresh = false) {
  if (!forceRefresh && cachedTools && Date.now() - toolsCachedAt < TOOLS_CACHE_TTL) {
    return cachedTools;
  }

  try {
    await mcpInitialize();
    const result = await mcpRequest('tools/list');
    cachedTools = result?.tools || [];
    toolsCachedAt = Date.now();
    return cachedTools;
  } catch (err) {
    throw translateMcpError(err);
  }
}

export async function callMcpTool(toolName, args) {
  let result;
  try {
    await mcpInitialize();
    result = await mcpRequest('tools/call', { name: toolName, arguments: args });
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
