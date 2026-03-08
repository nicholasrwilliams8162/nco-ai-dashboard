import { useCallback, useEffect, useRef, useState } from 'react';
import GridLayout from 'react-grid-layout';
import { useDashboardStore } from '../../store/dashboardStore';
import { WidgetCard } from './WidgetCard';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const MOBILE_BREAKPOINT = 640;
const ROW_HEIGHT = 80;

// Per-type mobile heights — tables need room for pagination controls,
// KPIs are compact, charts need enough space for the Recharts container.
const MOBILE_HEIGHTS = {
  table: 420,
  kpi: 160,
  bar: 300,
  line: 300,
  pie: 300,
};
const MOBILE_HEIGHT_DEFAULT = 320;

function getMobileHeight(widget) {
  return MOBILE_HEIGHTS[widget.visualization_type] ?? MOBILE_HEIGHT_DEFAULT;
}

export function DashboardGrid() {
  const { widgets, updateLayout } = useDashboardStore();
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth - 48 : 800
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isMobile = containerWidth < MOBILE_BREAKPOINT;

  const layout = widgets.map(w => ({
    i: w.id,
    x: w.grid_x,
    y: w.grid_y,
    w: w.grid_w,
    h: w.grid_h,
    minW: 3,
    maxW: 12,
    minH: 3,
  }));

  const handleLayoutChange = useCallback(
    (newLayout) => { updateLayout(newLayout); },
    [updateLayout]
  );

  if (widgets.length === 0) {
    return (
      <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 280, textAlign: 'center', padding: '0 24px' }}>
        <svg style={{ width: 44, height: 44, marginBottom: 12, color: 'var(--text-4)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
        </svg>
        <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-2)', margin: '0 0 6px' }}>No widgets yet</p>
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0, lineHeight: 1.5 }}>Ask a question below and pin the result to your dashboard</p>
      </div>
    );
  }

  // Mobile: simple stacked list, no drag/resize, per-type heights
  if (isMobile) {
    return (
      <div ref={containerRef} className="flex flex-col gap-3">
        {widgets.map(widget => (
          <div key={widget.id} style={{ height: getMobileHeight(widget) }}>
            <WidgetCard widget={widget} isMobile />
          </div>
        ))}
      </div>
    );
  }

  // Desktop: full drag-and-drop grid
  return (
    <div ref={containerRef}>
      <GridLayout
        className="layout"
        layout={layout}
        cols={12}
        rowHeight={ROW_HEIGHT}
        width={containerWidth}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".drag-handle"
        compactType="horizontal"
        margin={[12, 12]}
      >
        {widgets.map(widget => (
          <div key={widget.id}>
            <WidgetCard widget={widget} />
          </div>
        ))}
      </GridLayout>
    </div>
  );
}
