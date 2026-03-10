import { isCurrencyColumn, formatCurrency } from './currencyUtils';

export function KPIWidget({ data, config }) {
  if (!data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-3)', fontSize: 13 }}>
      No data
    </div>
  );

  const valueKey = config?.valueColumn || Object.keys(data)[0];
  const labelKey = config?.labelColumn;
  const value = data[valueKey];
  const label = labelKey ? data[labelKey] : null;

  const isCurrency = isCurrencyColumn(valueKey);

  const formatted =
    isCurrency && (typeof value === 'number' || !isNaN(Number(value)))
      ? formatCurrency(value)
      : typeof value === 'number'
        ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : value;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 8, padding: '0 16px',
    }}>
      <div style={{
        fontSize: 'clamp(26px, 5vw, 40px)',
        fontWeight: 800,
        letterSpacing: '-0.035em',
        color: 'var(--text-1)',
        lineHeight: 1,
        textAlign: 'center',
        fontFamily: 'DM Mono, monospace',
        wordBreak: 'break-word',
      }}>
        {formatted}
      </div>
      {label && (
        <div style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', fontWeight: 500 }}>
          {label}
        </div>
      )}
    </div>
  );
}
