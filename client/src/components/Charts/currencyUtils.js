const CURRENCY_KEYS = ['amount', 'total', 'revenue', 'balance', 'price', 'cost', 'value',
  'subtotal', 'tax', 'payment', 'sales', 'income', 'expense', 'budget', 'profit', 'margin'];

export function isCurrencyColumn(key) {
  const lower = (key || '').toLowerCase();
  return CURRENCY_KEYS.some(kw => lower.includes(kw));
}

const fullFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export function formatCurrency(value) {
  const num = Number(value);
  return isNaN(num) ? String(value) : fullFmt.format(num);
}

export function formatCurrencyCompact(value) {
  const num = Number(value);
  if (isNaN(num)) return String(value);
  if (Math.abs(num) >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (Math.abs(num) >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}
