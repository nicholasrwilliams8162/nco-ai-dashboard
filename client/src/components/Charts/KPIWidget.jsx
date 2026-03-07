export function KPIWidget({ data, config }) {
  if (!data) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data</div>;

  const valueKey = config?.valueColumn || Object.keys(data)[0];
  const labelKey = config?.labelColumn;
  const value = data[valueKey];
  const label = labelKey ? data[labelKey] : null;

  const formatted =
    typeof value === 'number'
      ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : value;

  // Use clamp-based sizing so large numbers shrink on narrow mobile cards
  // rather than overflowing. text-3xl on mobile → text-4xl on sm+
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 px-4">
      <div className="text-3xl sm:text-4xl font-bold text-white text-center break-words leading-tight">
        {formatted}
      </div>
      {label && <div className="text-sm text-gray-400 text-center">{label}</div>}
    </div>
  );
}
