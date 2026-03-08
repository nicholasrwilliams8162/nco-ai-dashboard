import { useState } from 'react';
import api from '../../api/client';
import { useDashboardStore } from '../../store/dashboardStore';
import { WidgetRenderer } from '../Charts/WidgetRenderer';

const EXAMPLES = [
  'Total revenue by month this year',
  'Customers with highest open balance',
  'Top 10 items by sales quantity',
  'Open sales orders by status',
  'Total accounts receivable',
];

export function NaturalLanguageInput() {
  const { pinWidget } = useDashboardStore();
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isPinning, setIsPinning] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!question.trim() || isLoading) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post('/ai/query', { question });
      setResult(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePin = async () => {
    if (!result || isPinning) return;
    setIsPinning(true);
    try {
      await pinWidget(result);
      setResult(null);
      setQuestion('');
      setError(null);
    } catch (err) {
      setError(`Failed to pin: ${err.message}`);
    } finally {
      setIsPinning(false);
    }
  };

  const handleDismiss = () => { setResult(null); setError(null); };
  const handleExample = (ex) => { setQuestion(ex); setResult(null); setError(null); };

  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      background: 'var(--sidebar-bg)',
      flexShrink: 0,
    }}>
      {/* Successful result preview */}
      {result && result.success && (
        <div style={{ padding: '12px 28px 0' }}>
          <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--border)',
            borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-card)',
          }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
                    {result.visualization?.title}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>
                    {result.interpretation}
                  </p>
                </div>
                <button onClick={handleDismiss} style={{
                  flexShrink: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  color: 'var(--text-3)', borderRadius: 7,
                }}>
                  <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {result.totalResults} row{result.totalResults !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={handlePin}
                  disabled={isPinning}
                  style={{
                    padding: '7px 16px', borderRadius: 9, border: 'none',
                    background: 'var(--blue)', color: '#fff',
                    fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                    opacity: isPinning ? 0.6 : 1, fontFamily: 'inherit',
                    boxShadow: '0 1px 3px rgba(37,99,235,0.3)',
                  }}
                >
                  {isPinning ? 'Pinning…' : 'Pin to Dashboard'}
                </button>
              </div>
            </div>
            <div style={{ height: 180, padding: 12 }}>
              <WidgetRenderer widget={{ ...result, cached_data: result.data, visualization_config: result.visualization }} />
            </div>
          </div>
        </div>
      )}

      {/* AI returned not-success */}
      {result && !result.success && (
        <div style={{ padding: '12px 28px 0' }}>
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
            background: 'var(--amber-light)', border: '1px solid var(--amber)',
            borderRadius: 12, padding: '12px 16px',
          }}>
            <p style={{ fontSize: 13, color: 'var(--amber)', margin: 0 }}>{result.interpretation}</p>
            <button onClick={handleDismiss} style={{
              flexShrink: 0, width: 24, height: 24, border: 'none', background: 'transparent',
              cursor: 'pointer', color: 'var(--amber)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: '12px 28px 0' }}>
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
            background: 'var(--red-light)', border: '1px solid var(--red)',
            borderRadius: 12, padding: '12px 16px',
          }}>
            <p style={{ fontSize: 13, color: 'var(--red)', margin: 0 }}>{error}</p>
            <button onClick={() => setError(null)} style={{
              flexShrink: 0, width: 24, height: 24, border: 'none', background: 'transparent',
              cursor: 'pointer', color: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Input row */}
      <div style={{ padding: '14px 28px' }}>
        <form onSubmit={handleSubmit} style={{ position: 'relative' }}>
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Ask anything about your NetSuite data…"
            style={{
              width: '100%', padding: '13px 56px 13px 18px',
              background: 'var(--card-bg)', border: '1.5px solid var(--border)',
              borderRadius: 12, color: 'var(--text-1)',
              fontSize: 15, fontFamily: 'inherit', fontWeight: 400,
              outline: 'none', boxShadow: 'var(--shadow-card)',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
            onFocus={e => {
              e.target.style.borderColor = 'var(--blue)';
              e.target.style.boxShadow = '0 0 0 4px var(--blue-light), var(--shadow-card)';
            }}
            onBlur={e => {
              e.target.style.borderColor = 'var(--border)';
              e.target.style.boxShadow = 'var(--shadow-card)';
            }}
            disabled={isLoading}
          />

          {isLoading ? (
            <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
              <svg style={{ width: 15, height: 15, color: 'var(--blue)', animation: 'spin 1s linear infinite' }}
                fill="none" viewBox="0 0 24 24">
                <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : (
            <button
              type="submit"
              disabled={!question.trim()}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: question.trim() ? 'var(--blue)' : 'var(--border)',
                border: 'none', borderRadius: 9, cursor: question.trim() ? 'pointer' : 'default',
                transition: 'all 0.15s',
                boxShadow: question.trim() ? '0 2px 8px rgba(37,99,235,0.35)' : 'none',
              }}
            >
              <svg style={{ width: 15, height: 15, color: '#fff' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          )}
        </form>

        {/* Example chips */}
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {EXAMPLES.map(ex => (
            <button
              key={ex}
              onClick={() => handleExample(ex)}
              style={{
                fontSize: 12, color: 'var(--text-3)', background: 'var(--card-bg-2)',
                border: '1px solid var(--border)', borderRadius: 20,
                padding: '5px 12px', cursor: 'pointer', transition: 'all 0.15s',
                fontFamily: 'inherit', fontWeight: 500, whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.target.style.color = 'var(--text-1)'; e.target.style.borderColor = 'var(--blue-mid)'; }}
              onMouseLeave={e => { e.target.style.color = 'var(--text-3)'; e.target.style.borderColor = 'var(--border)'; }}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
