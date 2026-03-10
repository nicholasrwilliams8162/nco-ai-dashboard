/**
 * Lightweight NetSuite doc search — fetches relevant snippets from timdietrich.me
 * when the agentic loop requests documentation help.
 *
 * Always non-fatal: any error returns '' so the agentic loop continues unblocked.
 */

const cache = new Map(); // keywords → { text, at }
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const TIMEOUT_MS = 5000;
const MAX_SNIPPET_CHARS = 2000;

// Known useful pages on timdietrich.me for SuiteQL help
const DOC_PAGES = [
  'https://timdietrich.me/blog/netsuite-suiteql-guide/',
  'https://timdietrich.me/suiteql-query-library/',
];

/**
 * Extract readable text from HTML — strips tags, collapses whitespace.
 */
function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Score a text block by keyword relevance (simple substring count).
 */
function scoreRelevance(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.toLowerCase().split(/\s+/).reduce((n, kw) => {
    let pos = 0, count = 0;
    while ((pos = lower.indexOf(kw, pos)) !== -1) { count++; pos++; }
    return n + count;
  }, 0);
}

/**
 * Fetch one URL with a timeout, return raw text or null on failure.
 */
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search timdietrich.me for content relevant to the given keywords.
 * Returns a string of relevant snippets (max 2000 chars) or '' on failure.
 */
export async function searchNetSuiteDocs(keywords) {
  const key = keywords.toLowerCase().trim();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return cached.text;
  }

  try {
    const results = await Promise.all(DOC_PAGES.map(fetchWithTimeout));

    const snippets = [];
    for (const html of results) {
      if (!html) continue;
      const text = extractText(html);
      // Split into ~500-char paragraphs and score each
      const paras = text.match(/.{1,500}/g) || [];
      for (const para of paras) {
        const score = scoreRelevance(para, keywords);
        if (score > 0) snippets.push({ text: para.trim(), score });
      }
    }

    // Sort by relevance, take top results up to MAX_SNIPPET_CHARS
    snippets.sort((a, b) => b.score - a.score);
    let combined = '';
    for (const s of snippets) {
      if (combined.length + s.text.length > MAX_SNIPPET_CHARS) break;
      combined += (combined ? '\n\n' : '') + s.text;
    }

    const result = combined || '';
    cache.set(key, { text: result, at: Date.now() });
    return result;
  } catch {
    // Non-fatal — return empty string
    return '';
  }
}
