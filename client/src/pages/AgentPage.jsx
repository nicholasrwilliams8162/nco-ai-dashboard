import { useState, useEffect, useRef } from 'react';
import api from '../api/client';

const RISK_COLORS = {
  low: 'text-green-400 bg-green-900/30 border-green-700/50',
  medium: 'text-yellow-400 bg-yellow-900/30 border-yellow-700/50',
  high: 'text-red-400 bg-red-900/30 border-red-700/50',
};
const RISK_LABELS = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };

const EXAMPLES = [
  'Create a customer named Acme Corp with email acme@corp.com',
  'Update customer 12345 — set their credit limit to 50000',
  'Create a new vendor named Office Supplies Co',
  'Find all customers with overdue balances over $10,000',
  'Get details for customer ID 456',
];

const STATUS_STYLES = {
  success:  { background: 'var(--green-light)', color: 'var(--green)', border: '1px solid color-mix(in srgb, var(--green) 30%, transparent)' },
  reverted: { background: 'var(--card-bg-2)',   color: 'var(--text-3)', border: '1px solid var(--border)' },
  error:    { background: 'var(--red-light)',   color: 'var(--red)',   border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)' },
};

function HistoryItem({ item, onReverted }) {
  const [open, setOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState(null);

  const canRevert = (item.tool === 'createRecord' || item.tool === 'updateRecord') &&
    item.record_id && item.status !== 'reverted';

  const handleRevert = async (e) => {
    e.stopPropagation();
    if (!window.confirm(`Revert this ${item.tool === 'createRecord' ? 'create' : 'update'} on ${item.record_type} ${item.record_id}?`)) return;
    setReverting(true);
    setRevertError(null);
    try {
      await api.post(`/agent/history/${item.id}/revert`);
      onReverted();
    } catch (err) {
      setRevertError(err.response?.data?.error || err.message);
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className={`border border-border rounded-lg overflow-hidden ${item.status === 'reverted' ? 'opacity-60' : ''}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left hover:bg-card2 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-t1 truncate">{item.instruction}</p>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 5, flexShrink: 0,
              ...(STATUS_STYLES[item.status] || STATUS_STYLES.success)
            }}>
              {item.status || 'success'}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-xs text-t3">{item.tool}</p>
            {item.record_type && <p className="text-xs text-t4">{item.record_type} #{item.record_id}</p>}
            <p className="text-xs text-t4">{new Date(item.created_at).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {canRevert && (
            <button
              onClick={handleRevert}
              disabled={reverting}
              className="text-xs px-2 py-1 border border-border text-t3 hover:text-orange-300 hover:border-orange-600 rounded transition-colors disabled:opacity-50"
            >
              {reverting ? 'Reverting…' : 'Revert'}
            </button>
          )}
          {item.status === 'reverted' && item.reverted_at && (
            <span className="text-xs text-t4">reverted {new Date(item.reverted_at).toLocaleString()}</span>
          )}
          <svg className={`w-4 h-4 text-t3 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {revertError && (
        <div className="px-4 py-2 bg-red-900/20 border-t border-red-800/50 text-xs text-red-400">{revertError}</div>
      )}
      {open && (
        <div className="px-4 pb-3 space-y-2 border-t border-border pt-3">
          <div>
            <p className="text-xs text-t3 mb-1">Arguments</p>
            <pre className="text-xs text-t2 bg-card2 rounded p-2 overflow-x-auto font-mono">
              {JSON.stringify(item.arguments, null, 2)}
            </pre>
          </div>
          {item.before_state && (
            <div>
              <p className="text-xs text-t3 mb-1">Before state (revertible)</p>
              <pre className="text-xs text-t2 bg-card2 rounded p-2 overflow-x-auto font-mono">
                {JSON.stringify(item.before_state, null, 2)}
              </pre>
            </div>
          )}
          {item.result && (
            <div>
              <p className="text-xs text-t3 mb-1">Result</p>
              <p className="text-xs text-t2 bg-card2 rounded p-2 whitespace-pre-wrap">{item.result}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentPage() {
  const [instruction, setInstruction] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const [clarifications, setClarifications] = useState([]);
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [clarificationAnswer, setClarificationAnswer] = useState('');

  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  const clarificationInputRef = useRef(null);

  const loadHistory = async () => {
    try {
      const res = await api.get('/agent/history');
      setHistory(res.data);
    } catch { /* non-critical */ }
  };

  useEffect(() => { loadHistory(); }, []);

  useEffect(() => {
    if (pendingQuestion) clarificationInputRef.current?.focus();
  }, [pendingQuestion]);

  const callPlan = async (currentClarifications) => {
    setIsPlanning(true);
    setError(null);
    try {
      const res = await api.post('/agent/plan', { instruction, clarifications: currentClarifications });
      const data = res.data;

      if (data.status === 'clarify') {
        setPendingQuestion(data.question);
        setClarificationAnswer('');
      } else if (data.status === 'ready') {
        setPendingQuestion(null);
        setPlan(data);
      } else {
        setError(data.message || 'Could not process that instruction.');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setIsPlanning(false);
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!instruction.trim() || isPlanning) return;
    setClarifications([]);
    setPendingQuestion(null);
    setPlan(null);
    setResult(null);
    setError(null);
    await callPlan([]);
  };

  const handleAnswerSubmit = async (e) => {
    e?.preventDefault();
    if (!clarificationAnswer.trim() || isPlanning) return;
    const newClarifications = [...clarifications, { question: pendingQuestion, answer: clarificationAnswer.trim() }];
    setClarifications(newClarifications);
    setPendingQuestion(null);
    await callPlan(newClarifications);
  };

  const handleExecute = async () => {
    if (!plan?.planId || isExecuting) return;
    setIsExecuting(true);
    setError(null);
    try {
      const res = await api.post('/agent/execute', { planId: plan.planId });
      setResult(res.data.result);
      setPlan(null);
      setClarifications([]);
      setInstruction('');
      loadHistory();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleReset = () => {
    setPlan(null);
    setPendingQuestion(null);
    setClarifications([]);
    setClarificationAnswer('');
    setError(null);
    setResult(null);
  };

  const handleExample = (ex) => {
    setInstruction(ex);
    handleReset();
  };

  const isActive = !!pendingQuestion || !!plan;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-header with History toggle */}
      <div className="px-6 flex-shrink-0 flex items-center justify-end" style={{ height: 44, borderBottom: '1px solid var(--border)' }}>
        <button
          className="topbar-btn"
          onClick={() => { setShowHistory(v => !v); if (!showHistory) loadHistory(); }}
          style={showHistory ? { background: 'var(--card-bg-2)', color: 'var(--text-1)' } : {}}
        >
          <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          History
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-5">

          {/* Instruction input */}
          <form onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-t2 mb-2">What would you like to do?</label>
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
              placeholder="e.g. Create a customer named Acme Corp with email acme@corp.com"
              rows={3}
              disabled={isPlanning || isActive}
              className="w-full bg-card border border-border text-t1 placeholder-t3 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent transition-colors resize-none disabled:opacity-60"
              style={{ boxShadow: 'var(--shadow-card)' }}
            />
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-t3">⌘↵ or click Plan</p>
              <div className="flex gap-2">
                {isActive && (
                  <button type="button" onClick={handleReset}
                    className="px-4 py-2 border border-border text-t2 hover:text-t1 hover:border-border rounded-xl text-sm transition-colors">
                    Start over
                  </button>
                )}
                <button type="submit" disabled={!instruction.trim() || isPlanning || isActive}
                  className="px-5 py-2.5 bg-accent hover:bg-accent-mid disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-2">
                  {isPlanning && !pendingQuestion && (
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  Plan
                </button>
              </div>
            </div>
          </form>

          {/* Example chips */}
          {!isActive && !result && (
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map(ex => (
                <button key={ex} onClick={() => handleExample(ex)}
                  className="text-xs text-t2 hover:text-t1 bg-card border border-border rounded-full px-3 py-1.5 transition-colors"
                  style={{ boxShadow: 'var(--shadow-card)' }}>
                  {ex}
                </button>
              ))}
            </div>
          )}

          {/* Clarification Q&A history */}
          {clarifications.length > 0 && (
            <div className="space-y-2">
              {clarifications.map((c, i) => (
                <div key={i} className="text-sm space-y-1 px-1">
                  <p className="text-t3"><span className="text-t2 font-medium">Q:</span> {c.question}</p>
                  <p className="text-t2"><span className="text-t2 font-medium">A:</span> {c.answer}</p>
                </div>
              ))}
            </div>
          )}

          {/* Pending clarification question */}
          {pendingQuestion && (
            <div className="bg-card border border-accent/40 rounded-xl overflow-hidden">
              <div className="flex items-start gap-3 px-5 py-4">
                <svg className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-t1 leading-relaxed">{pendingQuestion}</p>
              </div>
              <form onSubmit={handleAnswerSubmit} className="px-5 pb-4 flex gap-2">
                <input
                  ref={clarificationInputRef}
                  type="text"
                  value={clarificationAnswer}
                  onChange={e => setClarificationAnswer(e.target.value)}
                  placeholder="Your answer…"
                  disabled={isPlanning}
                  className="flex-1 bg-input border border-border text-t1 placeholder-t3 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
                />
                <button type="submit" disabled={!clarificationAnswer.trim() || isPlanning}
                  className="px-4 py-2 bg-accent hover:bg-accent-mid disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
                  {isPlanning && (
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {isPlanning ? 'Thinking…' : 'Answer'}
                </button>
              </form>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-3 px-4 py-3 bg-red-900/20 border border-red-700/40 rounded-xl">
              <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm text-red-300">{error}</p>
              </div>
              <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Action plan confirmation */}
          {plan && (
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-card">
              <div className="px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <span className="text-sm font-semibold text-t1">Action Plan</span>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${RISK_COLORS[plan.riskLevel] || RISK_COLORS.medium}`}>
                    {RISK_LABELS[plan.riskLevel] || 'Medium risk'}
                  </span>
                </div>
                <p className="text-sm text-t1 leading-relaxed">{plan.confirmation}</p>
              </div>

              <div className="px-5 py-3 bg-card2 border-b border-border">
                <p className="text-xs text-t3 mb-1">Tool</p>
                <code className="text-xs text-accent font-mono">{plan.tool}</code>
                <details className="mt-2">
                  <summary className="text-xs text-t3 cursor-pointer hover:text-t2 select-none">View arguments</summary>
                  <pre className="text-xs text-t2 mt-2 overflow-x-auto font-mono">{JSON.stringify(plan.arguments, null, 2)}</pre>
                </details>
              </div>

              <div className="px-5 py-4 flex items-center justify-between gap-3">
                <button onClick={handleReset} disabled={isExecuting}
                  className="px-4 py-2 border border-border text-t2 hover:text-t1 hover:bg-card2 rounded-lg text-sm transition-colors disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleExecute} disabled={isExecuting}
                  className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                    plan.riskLevel === 'high' ? 'bg-red-700 hover:bg-red-600 text-white' : 'bg-accent hover:bg-accent-mid text-white'
                  }`}>
                  {isExecuting && (
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {isExecuting ? 'Executing…' : plan.riskLevel === 'high' ? 'Confirm (High Risk)' : 'Confirm & Execute'}
                </button>
              </div>
            </div>
          )}

          {/* Success result */}
          {result && (
            <div className="bg-card border border-green-700/40 rounded-xl overflow-hidden shadow-card">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-sm font-semibold text-green-400">Done</span>
              </div>
              <div className="px-5 py-4">
                <p className="text-sm text-t1 whitespace-pre-wrap">{result}</p>
              </div>
              <div className="px-5 pb-4">
                <button onClick={() => { setResult(null); setInstruction(''); }}
                  className="text-sm text-accent hover:text-accent-light transition-colors">
                  Run another action →
                </button>
              </div>
            </div>
          )}

          {/* History / Audit Log */}
          {showHistory && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-t2">Audit Log</h3>
                <button onClick={loadHistory} className="text-xs text-t3 hover:text-t2 transition-colors">Refresh</button>
              </div>
              {history.length === 0
                ? <p className="text-sm text-t3">No actions yet.</p>
                : <div className="space-y-2">{history.map(item => <HistoryItem key={item.id} item={item} onReverted={loadHistory} />)}</div>
              }
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
