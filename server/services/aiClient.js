/**
 * aiClient.js — Thin wrapper around Google Gemini 2.0 Flash.
 *
 * Provides a single callAI(systemPrompt, messages, userId) function that
 * returns the model's text reply. All callers (agenticEngine, autonomousAgentService)
 * use this instead of importing Groq directly.
 *
 * Model: gemini-2.0-flash  (free tier via Google AI Studio)
 * JSON mode: responseMimeType = 'application/json' (equivalent to Groq's json_object)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import db from '../db/database.js';

const MODEL = 'gemini-2.0-flash';

export function getAIClient(userId) {
  const row = userId
    ? db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'gemini_api_key'").get(userId)
    : null;
  const apiKey = row?.value || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key is not configured. Add it in Settings.');
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Call Gemini with a system prompt + OpenAI-style message array.
 * Always requests JSON output.
 *
 * @param {string} systemPrompt
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {string} userId
 * @returns {Promise<string>} — raw JSON string from the model
 */
export async function callAI(systemPrompt, messages, userId) {
  const genAI = getAIClient(userId);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 4000,
      temperature: 0.1, // low temp for deterministic SQL/JSON generation
    },
  });

  // Convert OpenAI-style messages to Gemini history format.
  // Gemini uses 'model' instead of 'assistant', and the last message must be 'user'.
  const history = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const m = messages[i];
    history.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    });
  }

  const lastMessage = messages[messages.length - 1];
  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastMessage.content);
  return result.response.text();
}
