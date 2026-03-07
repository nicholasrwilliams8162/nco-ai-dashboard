import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { DataTable } from './DataTable';
import { KPIWidget } from './KPIWidget';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];

const tooltipStyle = { backgroundColor: '#1f2937', border: '1px solid #374151', color: '#e5e7eb', borderRadius: '8px' };
const axisStyle = { fill: '#9ca3af', fontSize: 11 };

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
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        No data — refresh to load
      </div>
    );
  }

  const config = resolveAxes(data, rawConfig);

  switch (type) {
    case 'bar':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 10, bottom: 36, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            {/* interval="preserveStartEnd" lets Recharts auto-skip labels on narrow
                containers — far better than interval={0} which renders every label */}
            <XAxis
              dataKey={config.xAxis}
              tick={axisStyle}
              angle={-35}
              textAnchor="end"
              interval="preserveStartEnd"
              tickFormatter={v => truncateLabel(String(v))}
            />
            <YAxis tick={axisStyle} width={40} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey={config.yAxis} fill={COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={60} />
          </BarChart>
        </ResponsiveContainer>
      );

    case 'line':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey={config.xAxis}
              tick={axisStyle}
              interval="preserveStartEnd"
              tickFormatter={v => truncateLabel(String(v))}
            />
            <YAxis tick={axisStyle} width={40} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey={config.yAxis} stroke={COLORS[0]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      );

    case 'pie':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey={config.yAxis}
              nameKey={config.xAxis}
              cx="50%"
              cy="50%"
              outerRadius="65%"
              label={({ name, percent }) => `${truncateLabel(String(name), 10)} ${(percent * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
      );

    case 'kpi':
      return <KPIWidget data={data[0]} config={config} />;

    case 'table':
    default:
      return <DataTable data={data} />;
  }
}
