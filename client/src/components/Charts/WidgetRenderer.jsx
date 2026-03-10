import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { DataTable } from './DataTable';
import { KPIWidget } from './KPIWidget';

import { isCurrencyColumn, formatCurrency, formatCurrencyCompact } from './currencyUtils';

const COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#F97316', '#EC4899'];

// These are dynamically resolved from CSS vars at render time so both themes look right
function getThemeStyles() {
  const s = getComputedStyle(document.documentElement);
  const get = (v) => s.getPropertyValue(v).trim();
  return {
    tooltipStyle: {
      backgroundColor: get('--card-bg') || '#1C2333',
      border: `1px solid ${get('--border') || '#2A3349'}`,
      color: get('--text-1') || '#E8EDFB',
      borderRadius: '10px',
      boxShadow: get('--shadow-modal'),
      fontFamily: 'Manrope, sans-serif',
      fontSize: 12,
    },
    gridStroke: get('--border-soft') || '#202840',
    axisColor: get('--text-3') || '#546080',
  };
}

const axisStyle = { fontSize: 11 };

// When the AI pinned a widget as 'table', xAxis/yAxis may not be set.
// Auto-detect from the data so chart types still work after switching.
function resolveAxes(data, config) {
  if (config.xAxis && config.yAxis) return config;
  const keys = Object.keys(data[0] || {});
  const isNumeric = v => v !== null && v !== '' && !isNaN(Number(v));
  const xAxis = config.xAxis || keys.find(k => !isNumeric(data[0][k])) || keys[0];
  const yAxis = config.yAxis || keys.find(k => k !== xAxis && isNumeric(data[0][k])) || keys[1] || keys[0];
  return { ...config, xAxis, yAxis };
}

// Truncate long axis labels so they don't overlap on narrow containers
function truncateLabel(value, maxLen = 12) {
  if (typeof value !== 'string') return value;
  return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
}

export function WidgetRenderer({ widget }) {
  const { visualization_type: type, visualization_config: rawConfig = {}, cached_data: data } = widget;

  if (!data || data.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-3)', fontSize: 13 }}>
        No data — refresh to load
      </div>
    );
  }

  const config = resolveAxes(data, rawConfig);
  const { tooltipStyle, gridStroke, axisColor } = getThemeStyles();
  const tickStyle = { ...axisStyle, fill: axisColor };

  const yIsCurrency = isCurrencyColumn(config.yAxis);
  const yAxisWidth = yIsCurrency ? 70 : 40;

  switch (type) {
    case 'bar':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 10, bottom: 36, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis
              dataKey={config.xAxis}
              tick={tickStyle}
              angle={-35}
              textAnchor="end"
              interval="preserveStartEnd"
              tickFormatter={v => truncateLabel(String(v))}
            />
            <YAxis
              tick={tickStyle}
              width={yAxisWidth}
              tickFormatter={yIsCurrency ? formatCurrencyCompact : undefined}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={yIsCurrency ? (value) => [formatCurrency(value), config.yAxis] : undefined}
            />
            <Bar dataKey={config.yAxis} fill={COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={60} />
          </BarChart>
        </ResponsiveContainer>
      );

    case 'line':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis
              dataKey={config.xAxis}
              tick={tickStyle}
              interval="preserveStartEnd"
              tickFormatter={v => truncateLabel(String(v))}
            />
            <YAxis
              tick={tickStyle}
              width={yAxisWidth}
              tickFormatter={yIsCurrency ? formatCurrencyCompact : undefined}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={yIsCurrency ? (value) => [formatCurrency(value), config.yAxis] : undefined}
            />
            <Line type="monotone" dataKey={config.yAxis} stroke={COLORS[0]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      );

    case 'pie': {
      // NetSuite returns all values as strings — coerce yAxis to numbers so Recharts
      // can compute slice percentages. Filter out rows with no valid value.
      const pieData = data
        .map(d => ({ ...d, [config.yAxis]: Number(d[config.yAxis]) || 0 }))
        .filter(d => d[config.yAxis] > 0);

      if (pieData.length === 0) {
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-3)', fontSize: 13 }}>
            No numeric data to display
          </div>
        );
      }

      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey={config.yAxis}
              nameKey={config.xAxis}
              cx="50%"
              cy="50%"
              outerRadius="60%"
              label={({ name, percent }) => `${truncateLabel(String(name ?? ''), 10)} ${(percent * 100).toFixed(0)}%`}
              labelLine={true}
            >
              {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => [yIsCurrency ? formatCurrency(value) : Number(value).toLocaleString(), config.yAxis]}
            />
            <Legend
              formatter={(value) => truncateLabel(String(value ?? ''), 16)}
              wrapperStyle={{ fontSize: 11, color: axisColor }}
            />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    case 'kpi':
      return <KPIWidget data={data[0]} config={config} />;

    case 'table':
    default:
      return <DataTable data={data} hiddenColumns={config.hiddenColumns || []} />;
  }
}
