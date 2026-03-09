import { useState, useEffect } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import api from '../../api/client';

function ColumnSelect({ label, value, columns, onChange, optional = false }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-4)', display: 'block', marginBottom: 5 }}>
        {label}{optional && <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 4 }}>(optional)</span>}
      </label>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value || null)}
        style={{
          width: '100%', padding: '7px 10px', borderRadius: 7,
          background: 'var(--input-bg)', border: '1.5px solid var(--border)',
          color: value ? 'var(--text-1)' : 'var(--text-4)',
          fontSize: 13, fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
        }}
      >
        {optional && <option value="">— none —</option>}
        {columns.map(col => (
          <option key={col} value={col}>{col}</option>
        ))}
      </select>
    </div>
  );
}

export function EditWidgetPanel({ widget, onClose }) {
  const { updateWidgetConfig } = useDashboardStore();

  // Derive available columns from cached data, strip NetSuite's injected 'links' col
  const columns = widget.cached_data?.length
    ? Object.keys(widget.cached_data[0]).filter(k => k !== 'links')
    : [];

  const cfg = widget.visualization_config || {};
  const type = widget.visualization_type;

  // Column config state
  const [xAxis, setXAxis] = useState(cfg.xAxis || columns[0] || '');
  const [yAxis, setYAxis] = useState(cfg.yAxis || columns[1] || '');
  const [valueColumn, setValueColumn] = useState(cfg.valueColumn || columns[0] || '');
  const [labelColumn, setLabelColumn] = useState(cfg.labelColumn || '');
  const [hiddenColumns, setHiddenColumns] = useState(cfg.hiddenColumns || []);

  // Re-ask state
  const [question, setQuestion] = useState(widget.original_question || '');
  const [isRunning, setIsRunning] = useState(false);
  const [reaskError, setReaskError] = useState(null);
  const [reaskPreview, setReaskPreview] = useState(null); // { rowCount, interpretation }

  // Active tab
  const [tab, setTab] = useState(columns.length > 0 ? 'columns' : 'reask');

  const toggleHiddenColumn = (col) => {
    setHiddenColumns(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const handleSaveColumns = async () => {
    const patch = { visualization_config: { ...cfg } };
    if (type === 'bar' || type === 'line') {
      patch.visualization_config.xAxis = xAxis;
      patch.visualization_config.yAxis = yAxis;
    } else if (type === 'pie') {
      patch.visualization_config.xAxis = xAxis;
      patch.visualization_config.yAxis = yAxis;
    } else if (type === 'kpi') {
      patch.visualization_config.valueColumn = valueColumn;
      patch.visualization_config.labelColumn = labelColumn || null;
    } else if (type === 'table') {
      patch.visualization_config.hiddenColumns = hiddenColumns;
    }
    await updateWidgetConfig(widget.id, patch);
    onClose();
  };

  const handleReask = async () => {
    if (!question.trim()) return;
    setIsRunning(true);
    setReaskError(null);
    setReaskPreview(null);
    try {
      const res = await api.post('/ai/query', { question: question.trim() });
      if (!res.data.success) {
        setReaskError(res.data.interpretation || 'Query returned no results.');
      } else {
        setReaskPreview({
          rowCount: res.data.data?.length ?? 0,
          interpretation: res.data.interpretation,
          result: res.data,
        });
      }
    } catch (err) {
      setReaskError(err.response?.data?.error || err.message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleApplyReask = async () => {
    const { result } = reaskPreview;
    await updateWidgetConfig(widget.id, {
      suiteql_query: result.query,
      original_question: question.trim(),
      interpretation: result.interpretation,
      visualization_type: result.visualization.type,
      visualization_config: {
        xAxis: result.visualization.xAxis,
        yAxis: result.visualization.yAxis,
        valueColumn: result.visualization.valueColumn,
        labelColumn: result.visualization.labelColumn,
        description: result.visualization.description,
      },
      cached_data: result.data,
    });
    onClose();
  };

  const tabStyle = (active) => ({
    flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontSize: 12, fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.15s',
    background: active ? 'var(--blue)' : 'transparent',
    color: active ? '#fff' : 'var(--text-3)',
  });

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.35)',
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 101,
        width: 320, maxWidth: '100vw',
        background: 'var(--card-bg)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px', borderBottom: '1px solid var(--border-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 2px' }}>Edit Widget</p>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>
              {widget.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--card-bg-2)', borderRadius: 8, padding: 3 }}>
            <button style={tabStyle(tab === 'columns')} onClick={() => setTab('columns')}>
              Columns
            </button>
            <button style={tabStyle(tab === 'reask')} onClick={() => setTab('reask')}>
              Re-ask AI
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

          {tab === 'columns' && (
            <>
              {columns.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No data loaded yet — refresh the widget first.</p>
              ) : (
                <>
                  {/* Bar / Line */}
                  {(type === 'bar' || type === 'line') && (
                    <>
                      <ColumnSelect label="X Axis (categories)" value={xAxis} columns={columns} onChange={setXAxis} />
                      <ColumnSelect label="Y Axis (values)" value={yAxis} columns={columns} onChange={setYAxis} />
                    </>
                  )}

                  {/* Pie */}
                  {type === 'pie' && (
                    <>
                      <ColumnSelect label="Slice labels" value={xAxis} columns={columns} onChange={setXAxis} />
                      <ColumnSelect label="Slice values" value={yAxis} columns={columns} onChange={setYAxis} />
                    </>
                  )}

                  {/* KPI */}
                  {type === 'kpi' && (
                    <>
                      <ColumnSelect label="Value" value={valueColumn} columns={columns} onChange={setValueColumn} />
                      <ColumnSelect label="Label" value={labelColumn} columns={columns} onChange={setLabelColumn} optional />
                    </>
                  )}

                  {/* Table */}
                  {type === 'table' && (
                    <>
                      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 10 }}>
                        Visible columns
                      </p>
                      {columns.map(col => (
                        <label key={col} style={{
                          display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px',
                          borderRadius: 6, cursor: 'pointer', marginBottom: 2,
                          background: hiddenColumns.includes(col) ? 'transparent' : 'var(--card-bg-2)',
                        }}>
                          <input
                            type="checkbox"
                            checked={!hiddenColumns.includes(col)}
                            onChange={() => toggleHiddenColumn(col)}
                            style={{ accentColor: 'var(--blue)', width: 14, height: 14 }}
                          />
                          <span style={{ fontSize: 13, color: hiddenColumns.includes(col) ? 'var(--text-4)' : 'var(--text-1)', fontFamily: 'DM Mono, monospace' }}>
                            {col}
                          </span>
                        </label>
                      ))}
                    </>
                  )}

                  <button
                    onClick={handleSaveColumns}
                    style={{
                      marginTop: 18, width: '100%', padding: '9px 0', borderRadius: 8,
                      background: 'var(--blue)', color: '#fff', border: 'none',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Apply
                  </button>
                </>
              )}
            </>
          )}

          {tab === 'reask' && (
            <>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 8 }}>
                Question
              </p>
              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="Ask a new question..."
                rows={4}
                style={{
                  width: '100%', padding: '9px 11px', borderRadius: 8,
                  background: 'var(--input-bg)', border: '1.5px solid var(--border)',
                  color: 'var(--text-1)', fontSize: 13, fontFamily: 'inherit',
                  resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                  lineHeight: 1.5,
                }}
                onFocus={e => e.target.style.borderColor = 'var(--blue)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />

              <button
                onClick={handleReask}
                disabled={isRunning || !question.trim()}
                style={{
                  marginTop: 10, width: '100%', padding: '9px 0', borderRadius: 8,
                  background: isRunning || !question.trim() ? 'var(--card-bg-2)' : 'var(--blue)',
                  color: isRunning || !question.trim() ? 'var(--text-4)' : '#fff',
                  border: 'none', fontSize: 13, fontWeight: 600,
                  cursor: isRunning || !question.trim() ? 'default' : 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.15s',
                }}
              >
                {isRunning ? 'Running…' : 'Run Query'}
              </button>

              {reaskError && (
                <div style={{
                  marginTop: 12, padding: '10px 12px', borderRadius: 8,
                  background: 'var(--red-light)', border: '1px solid var(--red)',
                  color: 'var(--red)', fontSize: 12, lineHeight: 1.5,
                }}>
                  {reaskError}
                </div>
              )}

              {reaskPreview && (
                <div style={{
                  marginTop: 12, padding: '12px', borderRadius: 8,
                  background: 'var(--card-bg-2)', border: '1px solid var(--border)',
                }}>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, margin: '0 0 4px' }}>
                    {reaskPreview.interpretation}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '0 0 12px' }}>
                    {reaskPreview.rowCount} row{reaskPreview.rowCount !== 1 ? 's' : ''} returned
                  </p>
                  <button
                    onClick={handleApplyReask}
                    style={{
                      width: '100%', padding: '8px 0', borderRadius: 7,
                      background: 'var(--blue)', color: '#fff', border: 'none',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Apply to widget
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
