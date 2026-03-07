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
  // Track whether the dropdown should open left-aligned to avoid clipping on narrow cards
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

  // Determine dropdown alignment when opening — if the trigger button is too
  // close to the left edge of the viewport, align the dropdown to the left
  // instead of the right so it doesn't clip off-screen.
  const handleSettingsToggle = () => {
    if (!showSettings && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // 192px = w-48 dropdown width
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
    ? new Date(widget.cached_at).toLocaleTimeString()
    : null;

  return (
    <div className="flex flex-col bg-gray-800 rounded-xl border border-gray-700 h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-gray-700 flex-shrink-0 min-h-[44px]">
        {isEditing ? (
          <input
            className="bg-gray-700 text-white text-sm font-medium rounded px-2 py-0.5 flex-1 mr-2 outline-none"
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => e.key === 'Enter' && handleRename()}
            autoFocus
          />
        ) : (
          // On mobile isMobile=true so dragging is disabled — remove cursor-grab to avoid confusion
          <h3
            className={`drag-handle text-sm font-medium text-white truncate transition-colors ${
              isMobile
                ? 'cursor-default'
                : 'cursor-grab active:cursor-grabbing hover:text-blue-400'
            }`}
            onDoubleClick={() => { if (!isMobile) setIsEditing(true); }}
            onTouchEnd={() => { if (isMobile) setIsEditing(true); }}
            title={isMobile ? undefined : 'Double-click to rename'}
          >
            {widget.title}
          </h3>
        )}

        {/* Action buttons — stopPropagation prevents drag hijacking */}
        <div className="flex items-center gap-0.5 ml-2 flex-shrink-0" onMouseDown={e => e.stopPropagation()}>
          <span className="text-xs text-gray-500 mr-1 hidden sm:block">{cachedAt}</span>

          {/* Refresh — min 44px touch target via padding */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center justify-center w-8 h-8 sm:w-7 sm:h-7 text-gray-500 hover:text-blue-400 focus-visible:outline-2 focus-visible:outline-blue-500 transition-colors rounded disabled:opacity-50"
            title="Refresh data"
          >
            <svg className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Three-dot settings menu */}
          <div className="relative" ref={settingsRef}>
            <button
              ref={triggerRef}
              onClick={handleSettingsToggle}
              className={`flex items-center justify-center w-8 h-8 sm:w-7 sm:h-7 rounded focus-visible:outline-2 focus-visible:outline-blue-500 transition-colors ${
                showSettings ? 'text-white bg-gray-700' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700'
              }`}
              title="Widget settings"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>

            {showSettings && (
              <div
                className={`absolute top-full mt-1 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 p-3 space-y-3 ${
                  dropdownAlignLeft ? 'left-0' : 'right-0'
                }`}
              >
                {/* Chart type */}
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1.5 uppercase tracking-wide">Chart type</p>
                  <div className="grid grid-cols-5 gap-1">
                    {CHART_TYPES.map(ct => (
                      <button
                        key={ct.type}
                        onClick={() => changeVisualizationType(widget.id, ct.type)}
                        title={ct.label}
                        className={`flex flex-col items-center gap-0.5 py-1.5 rounded transition-colors ${
                          widget.visualization_type === ct.type
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        {ct.icon}
                        <span className="text-[9px] leading-none">{ct.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Width — desktop only */}
                {!isMobile && (
                  <div>
                    <p className="text-xs text-gray-500 font-medium mb-1.5 uppercase tracking-wide">Width</p>
                    <div className="grid grid-cols-4 gap-1">
                      {SIZE_STEPS.map(s => (
                        <button
                          key={s.w}
                          onClick={() => resizeWidget(widget.id, s.w)}
                          className={`py-1.5 text-xs rounded transition-colors ${
                            widget.grid_w === s.w
                              ? 'bg-blue-600 text-white'
                              : 'text-gray-400 hover:text-white hover:bg-gray-700'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Divider + actions */}
                <div className="border-t border-gray-700 pt-2 space-y-0.5">
                  <button
                    onClick={() => { setShowInfo(v => !v); setShowSettings(false); }}
                    className="w-full text-left text-xs text-gray-400 hover:text-white hover:bg-gray-700 px-2 py-2 rounded transition-colors flex items-center gap-2"
                  >
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {showInfo ? 'Hide query info' : 'Show query info'}
                  </button>
                  <button
                    onClick={() => { removeWidget(widget.id); }}
                    className="w-full text-left text-xs text-red-400 hover:text-red-300 hover:bg-gray-700 px-2 py-2 rounded transition-colors flex items-center gap-2"
                  >
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div className="px-4 py-2 bg-gray-900/50 border-b border-gray-700 text-xs text-gray-400 flex-shrink-0">
          {widget.original_question && (
            <p><span className="text-gray-500">Q:</span> {widget.original_question}</p>
          )}
          {widget.interpretation && (
            <p className="mt-0.5"><span className="text-gray-500">AI:</span> {widget.interpretation}</p>
          )}
          <p className="mt-0.5 font-mono text-gray-600 break-all">{widget.suiteql_query}</p>
        </div>
      )}

      {/* Chart area */}
      <div className="flex-1 p-3 min-h-0 overflow-hidden">
        <WidgetRenderer widget={widget} />
      </div>
    </div>
  );
}
