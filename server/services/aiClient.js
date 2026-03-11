/**
 * aiClient.js — Anthropic Claude Haiku 4.5
 *
 * Best instruction-following for SuiteQL generation + JSON output.
 * Cost: ~$0.006/call ($0.80/M input, $4/M output)
 *
 * Get an API key at console.anthropic.com → API Keys.
 * Keys start with sk-ant-...
 */

import Anthropic from '@anthropic-ai/sdk';
import db from '../db/database.js';

const MODEL = 'claude-haiku-4-5-20251001';

export async function callAI(systemPrompt, messages, userId) {
  const row = userId
    ? db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'anthropic_api_key'").get(userId)
    : null;
  const apiKey = row?.value || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Anthropic API key is not configured. Add it in Settings.');

  const client = new Anthropic({ apiKey });

  // Claude uses system as a top-level param, not a message role
  const response = await client.messages.create({
    model: MODEL,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    max_tokens: 4000,
    temperature: 0.1,
  });

  const text = response.content[0]?.text || '';

  // Extract JSON — Claude reliably returns JSON when system prompt requests it
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Claude did not return valid JSON');
  return text.slice(start, end + 1);
}
