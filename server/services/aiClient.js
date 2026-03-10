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

// Free models tried in order — falls back to next on 429/overload
const MODELS = [
  'stepfun/step-3.5-flash:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'nvidia/llama-nemotron-embed-vl-1b-v2:free',
];
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

  let lastError;
  for (const model of MODELS) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });
      if (response.choices?.[0]?.message?.content) {
        if (model !== MODELS[0]) console.log(`[AI] Using fallback model: ${model}`);
        return response.choices[0].message.content;
      }
      lastError = new Error(`Empty response from ${model}`);
    } catch (err) {
      const status = err?.status || err?.response?.status;
      if (status === 429 || status === 503 || status === 404 || (err.message || '').includes('overloaded') || (err.message || '').includes('No endpoints')) {
        console.warn(`[AI] ${model} unavailable (${status}), trying next…`);
        lastError = err;
        continue;
      }
      throw err; // non-rate-limit error — propagate immediately
    }
  }
  throw lastError || new Error('All OpenRouter models unavailable');
}
