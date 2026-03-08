import { useEffect, useRef, useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { WidgetRenderer } from '../Charts/WidgetRenderer';

const CHART_TYPES = [
  {
    type: 'bar',
    label: 'Bar',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <rect x="3" y="10" width="4" height="11" rx="1" />
        <rect x="10" y="6" width="4" height="15" rx="1" />
        <rect x="17" y="3" width="4" height="18" rx="1" />
      </svg>
    ),
  },
  {
    type: 'line',
    label: 'Line',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <polyline points="3,17 8,11 13,14 21,5" />
      </svg>
    ),
  },
  {
    type: 'pie',
    label: 'Pie',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2a10 10 0 0 1 10 10H12V2z" />
        <path d="M12 12L4.93 19.07A10 10 0 0 1 12 2v10z" opacity=".5" />
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    type: 'table',
    label: 'Table',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M3 15h18M9 3v18" />
      </svg>
    ),
  },
  {
    type: 'kpi',
    label: 'KPI',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
      </svg>
    ),
  },
];

const SIZE_STEPS = [
  { w: 3, label: '¼' },
  { w: 6, label: '½' },
  { w: 9, label: '¾' },
  { w: 12, label: 'Full' },
];

export function WidgetCard({ widget, isMobile = false }) {
  const { refreshWidget, removeWidget, renameWidget, changeVisualizationType, resizeWidget } = useDashboardStore();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(widget.title);
  const [showInfo, setShowInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef(null);
  const [dropdownAlignLeft, setDropdownAlignLeft] = useState(false);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!widget.refresh_interval || widget.refresh_interval <= 0) return;
    const interval = setInterval(() => refreshWidget(widget.id), widget.refresh_interval * 1000);
    return () => clearInterval(interval);
  }, [widget.id, widget.refresh_interval]);

  useEffect(() => {
    if (!showSettings) return;
    const handler = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSettings]);

  const handleSettingsToggle = () => {
    if (!showSettings && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownAlignLeft(rect.right < 192);
    }
    setShowSettings(v => !v);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshWidget(widget.id);
    setIsRefreshing(false);
  };

  const handleRename = async () => {
    if (editTitle.trim() && editTitle !== widget.title) {
      await renameWidget(widget.id, editTitle.trim());
    }
    setIsEditing(false);
  };

  const cachedAt = widget.cached_at
    ? new Date(widget.cached_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: 'var(--card-bg)',
      borderRadius: 14,
      border: '1px solid var(--border)',
      boxShadow: 'var(--shadow-card)',
      height: '100%',
      overflow: 'hidden',
      transition: 'box-shadow 0.2s',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px',
        borderBottom: '1px solid var(--border-soft)',
        flexShrink: 0, minHeight: 48,
      }}>
        {isEditing ? (
          <input
            style={{
              background: 'var(--input-bg)', color: 'var(--text-1)',
              border: '1.5px solid var(--blue)', borderRadius: 7,
              padding: '4px 10px', flex: 1, marginRight: 8, outline: 'none',
              fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
            }}
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => e.key === 'Enter' && handleRename()}
            autoFocus
          />
        ) : (
          <h3
            className={`drag-handle ${isMobile ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
            style={{
              fontSize: 14, fontWeight: 700, letterSpacing: '-0.015em',
              color: 'var(--text-1)', margin: 0, overflow: 'hidden',
              whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1,
              transition: 'color 0.15s',
            }}
            onDoubleClick={() => { if (!isMobile) setIsEditing(true); }}
            onTouchEnd={() => { if (isMobile) setIsEditing(true); }}
            title={isMobile ? undefined : 'Double-click to rename'}
          >
            {widget.title}
          </h3>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 8, flexShrink: 0 }}
          onMouseDown={e => e.stopPropagation()}>
          {cachedAt && (
            <span style={{ fontSize: 11, color: 'var(--text-4)', marginRight: 4, display: 'none' }}
              className="sm:block">{cachedAt}</span>
          )}

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, border: 'none', background: 'transparent',
              cursor: 'pointer', borderRadius: 7, color: 'var(--text-3)',
              transition: 'all 0.15s', opacity: isRefreshing ? 0.5 : 1,
            }}
            title="Refresh data"
          >
            <svg style={{ width: 14, height: 14, animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Three-dot menu */}
          <div style={{ position: 'relative' }} ref={settingsRef}>
            <button
              ref={triggerRef}
              onClick={handleSettingsToggle}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 30, border: 'none',
                background: showSettings ? 'var(--card-bg-2)' : 'transparent',
                cursor: 'pointer', borderRadius: 7, color: 'var(--text-3)',
                transition: 'all 0.15s',
              }}
              title="Widget settings"
            >
              <svg style={{ width: 14, height: 14 }} fill="currentColor" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>

            {showSettings && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', zIndex: 50,
                width: 196, padding: 12,
                background: 'var(--card-bg)', border: '1px solid var(--border)',
                borderRadius: 12, boxShadow: 'var(--shadow-modal)',
                ...(dropdownAlignLeft ? { left: 0 } : { right: 0 }),
              }}>
                {/* Chart type */}
                <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
                  Chart type
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 12 }}>
                  {CHART_TYPES.map(ct => (
                    <button
                      key={ct.type}
                      onClick={() => changeVisualizationType(widget.id, ct.type)}
                      title={ct.label}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                        padding: '6px 4px', borderRadius: 7, border: 'none', cursor: 'pointer',
                        transition: 'all 0.15s',
                        background: widget.visualization_type === ct.type ? 'var(--blue)' : 'transparent',
                        color: widget.visualization_type === ct.type ? '#fff' : 'var(--text-3)',
                      }}
                    >
                      {ct.icon}
                      <span style={{ fontSize: 9, lineHeight: 1 }}>{ct.label}</span>
                    </button>
                  ))}
                </div>

                {/* Width — desktop only */}
                {!isMobile && (
                  <>
                    <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
                      Width
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 12 }}>
                      {SIZE_STEPS.map(s => (
                        <button
                          key={s.w}
                          onClick={() => resizeWidget(widget.id, s.w)}
                          style={{
                            padding: '5px 4px', borderRadius: 7, border: 'none', cursor: 'pointer',
                            fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                            background: widget.grid_w === s.w ? 'var(--blue)' : 'transparent',
                            color: widget.grid_w === s.w ? '#fff' : 'var(--text-3)',
                          }}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Divider + actions */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <button
                    onClick={() => { setShowInfo(v => !v); setShowSettings(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '7px 8px', borderRadius: 7,
                      border: 'none', background: 'transparent', cursor: 'pointer',
                      fontSize: 12.5, color: 'var(--text-2)', textAlign: 'left',
                      transition: 'all 0.15s', fontFamily: 'inherit',
                    }}
                  >
                    <svg style={{ width: 13, height: 13, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {showInfo ? 'Hide query info' : 'Show query info'}
                  </button>
                  <button
                    onClick={() => removeWidget(widget.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '7px 8px', borderRadius: 7,
                      border: 'none', background: 'transparent', cursor: 'pointer',
                      fontSize: 12.5, color: 'var(--red)', textAlign: 'left',
                      transition: 'all 0.15s', fontFamily: 'inherit',
                    }}
                  >
                    <svg style={{ width: 13, height: 13, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Remove widget
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info panel */}
      {showInfo && (
        <div style={{
          padding: '10px 18px', borderBottom: '1px solid var(--border-soft)',
          background: 'var(--card-bg-2)', flexShrink: 0,
        }}>
          {widget.original_question && (
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 2 }}>
              <span style={{ color: 'var(--text-4)' }}>Q: </span>{widget.original_question}
            </p>
          )}
          {widget.interpretation && (
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 2 }}>
              <span style={{ color: 'var(--text-4)' }}>AI: </span>{widget.interpretation}
            </p>
          )}
          <p style={{ fontSize: 11, fontFamily: 'DM Mono, monospace', color: 'var(--text-4)', wordBreak: 'break-all', marginTop: 4 }}>
            {widget.suiteql_query}
          </p>
        </div>
      )}

      {/* Chart area */}
      <div style={{ flex: 1, padding: 12, minHeight: 0, overflow: 'hidden' }}>
        <WidgetRenderer widget={widget} />
      </div>
    </div>
  );
}
