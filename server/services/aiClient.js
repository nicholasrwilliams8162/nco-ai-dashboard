/**
 * aiClient.js — OpenRouter wrapper.
 *
 * OpenRouter is OpenAI-API-compatible and routes to many models.
 * Using meta-llama/llama-3.3-70b-instruct:free as default free model —
 * better instruction-following than raw Groq.
 *
 * Get a free key at openrouter.ai → Keys.
 * Keys start with sk-or-...
 */

import OpenAI from 'openai';
import db from '../db/database.js';

const MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const BASE_URL = 'https://openrouter.ai/api/v1';

export async function callAI(systemPrompt, messages, userId) {
  const row = userId
    ? db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'openrouter_api_key'").get(userId)
    : null;
  const apiKey = row?.value || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OpenRouter API key is not configured. Add it in Settings.');

  const client = new OpenAI({
    apiKey,
    baseURL: BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': 'https://nco-ai-dashboard.app',
      'X-Title': 'NCO AI Dashboard',
    },
  });

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    temperature: 0.1,
  });

  return response.choices[0].message.content;
}
