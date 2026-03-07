import Groq from 'groq-sdk';
import { buildSchemaContext } from './schemaContext.js';
import { runSuiteQL } from './netsuiteClient.js';
import db from '../db/database.js';

function getGroqClient() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'groq_api_key'").get();
  const apiKey = row?.value || process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('Groq API key is not configured. Add it in Settings.');
  }
  return new Groq({ apiKey });
}

function buildSystemPrompt(userQuestion) {
  return `You are a NetSuite data analyst assistant. Your job is to:
1. Interpret natural language questions about business data
2. Generate valid SuiteQL queries to answer them
3. Determine the best visualization type for the results
4. Return structured JSON responses

${buildSchemaContext(userQuestion)}

You MUST respond with a JSON object in this exact structure:
{
  "interpretation": "Plain English explanation of what you understood",
  "query": "The SuiteQL query string, or null if unanswerable",
  "visualization": {
    "type": "bar" | "line" | "pie" | "table" | "kpi",
    "title": "Widget title for the dashboard",
    "xAxis": "column name for x-axis (bar/line charts)",
    "yAxis": "column name for y-axis / value (bar/line/pie charts)",
    "valueColumn": "column name for the single number (kpi type)",
    "labelColumn": "column name for kpi label (optional)",
    "description": "Brief description of what this shows"
  },
  "suggestedRefreshInterval": 300
}

Visualization selection:
- bar: comparisons across categories (sales by region, orders by status)
- line: trends over time (monthly revenue, weekly orders) — xAxis should be a date/period column
- pie: part-to-whole with <= 8 slices (revenue by customer type)
- table: multi-column detail data, no obvious chart story
- kpi: single numeric value (total open AR, this month revenue, overdue invoice count)

suggestedRefreshInterval in seconds: 60 for real-time, 300 for operational, 3600 for summary.

Row limiting rules:
- Simple queries (no GROUP BY): add WHERE ROWNUM <= 500
- Top-N with GROUP BY: use a subquery wrapper — SELECT * FROM (...GROUP BY...ORDER BY...) WHERE ROWNUM <= N
- Never put WHERE ROWNUM after ORDER BY in the same query level
Today's date: ${new Date().toISOString().split('T')[0]}`;
}

function parseAiJson(text) {
  // Strip markdown code fences if present
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  // Extract the first complete JSON object by tracking brace depth
  const start = stripped.indexOf('{');
  if (start === -1) throw new Error('No JSON found in AI response');
  let depth = 0;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') {
      depth--;
      if (depth === 0) return JSON.parse(stripped.slice(start, i + 1));
    }
  }
  throw new Error('Malformed JSON in AI response');
}

async function callGroq(client, systemPrompt, messages) {
  const response = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  });
  return response.choices[0].message.content;
}

export async function processNaturalLanguageQuery(userQuestion) {
  const client = getGroqClient();
  const systemPrompt = buildSystemPrompt(userQuestion);
  const messages = [{ role: 'user', content: userQuestion }];

  // Step 1: Generate SuiteQL
  const planText = await callGroq(client, systemPrompt, messages);
  let aiResult = parseAiJson(planText);

  if (!aiResult.query) {
    return { success: false, interpretation: aiResult.interpretation, data: null, visualization: null };
  }

  // Step 2: Execute query
  console.log("[AI] Generated query:", aiResult.query);
  let queryResult;
  try {
    queryResult = await runSuiteQL(aiResult.query);
    console.log("[AI] Query returned", queryResult.items?.length, "rows");
  } catch (nsError) {
    // Step 3: Self-correction pass
    const correctionMessages = [
      ...messages,
      { role: 'assistant', content: planText },
      { role: 'user', content: `The query failed: "${nsError.message}". Please fix it and return the corrected JSON.` },
    ];
    const correctionText = await callGroq(client, systemPrompt, correctionMessages);
    aiResult = parseAiJson(correctionText);
    if (!aiResult.query) throw new Error(`Could not generate a valid query: ${nsError.message}`);
    queryResult = await runSuiteQL(aiResult.query);
  }

  return {
    success: true,
    interpretation: aiResult.interpretation,
    query: aiResult.query,
    data: queryResult.items,
    totalResults: queryResult.totalResults,
    visualization: aiResult.visualization,
    suggestedRefreshInterval: aiResult.suggestedRefreshInterval || 300,
  };
}

export async function refreshWidgetData(savedQuery) {
  const result = await runSuiteQL(savedQuery);
  return {
    data: result.items,
    totalResults: result.totalResults,
    refreshedAt: new Date().toISOString(),
  };
}
