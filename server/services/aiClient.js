/**
 * aiClient.js — Anthropic Claude Haiku 4.5
 *
 * Fast, cost-effective model for SuiteQL generation.
 * Model: claude-haiku-4-5-20251001
 *
 * Get an API key at console.anthropic.com → API Keys.
 * Keys start with sk-ant-...
 */

import Anthropic from '@anthropic-ai/sdk';
import db from '../db/database.js';

const MODEL = 'claude-haiku-4-5-20251001';

/** Walk forward from `start` to find the matching closing brace. */
function extractFirstObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

export async function callAI(systemPrompt, messages, userId) {
  const row = userId
    ? db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'anthropic_api_key'").get(userId)
    : null;
  const apiKey = row?.value || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Anthropic API key is not configured. Add it in Settings.');

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: systemPrompt + '\n\nRespond with ONLY a valid JSON object. No markdown, no explanation, no text outside the JSON.',
    messages: [
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      // Prefill forces the model to begin the JSON object immediately
      { role: 'assistant', content: '{' },
    ],
  });

  const text = '{' + (response.content[0]?.text || '');
  const json = extractFirstObject(text);
  if (!json) throw new Error('AI did not return valid JSON');
  return json;
}
