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
  success: 'text-green-400 bg-green-900/30 border-green-700/50',
  reverted: 'text-gray-400 bg-gray-800 border-gray-600',
  error: 'text-red-400 bg-red-900/30 border-red-700/50',
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
    <div className={`border rounded-lg overflow-hidden ${item.status === 'reverted' ? 'opacity-60' : 'border-gray-700'}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-700/40 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-white truncate">{item.instruction}</p>
            <span className={`text-xs px-1.5 py-0.5 rounded border flex-shrink-0 ${STATUS_STYLES[item.status] || STATUS_STYLES.success}`}>
              {item.status || 'success'}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-xs text-gray-500">{item.tool}</p>
            {item.record_type && <p className="text-xs text-gray-600">{item.record_type} #{item.record_id}</p>}
            <p className="text-xs text-gray-600">{new Date(item.created_at).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {canRevert && (
            <button
              onClick={handleRevert}
              disabled={reverting}
              className="text-xs px-2 py-1 border border-gray-600 text-gray-400 hover:text-orange-300 hover:border-orange-600 rounded transition-colors disabled:opacity-50"
            >
              {reverting ? 'Reverting…' : 'Revert'}
            </button>
          )}
          {item.status === 'reverted' && item.reverted_at && (
            <span className="text-xs text-gray-600">reverted {new Date(item.reverted_at).toLocaleString()}</span>
          )}
          <svg className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {revertError && (
        <div className="px-4 py-2 bg-red-900/20 border-t border-red-800/50 text-xs text-red-400">{revertError}</div>
      )}
      {open && (
        <div className="px-4 pb-3 space-y-2 border-t border-gray-700 pt-3">
          <div>
            <p className="text-xs text-gray-500 mb-1">Arguments</p>
            <pre className="text-xs text-gray-300 bg-gray-900 rounded p-2 overflow-x-auto">
              {JSON.stringify(item.arguments, null, 2)}
            </pre>
          </div>
          {item.before_state && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Before state (revertible)</p>
              <pre className="text-xs text-gray-400 bg-gray-900 rounded p-2 overflow-x-auto">
                {JSON.stringify(item.before_state, null, 2)}
              </pre>
            </div>
          )}
          {item.result && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Result</p>
              <p className="text-xs text-gray-300 bg-gray-900 rounded p-2 whitespace-pre-wrap">{item.result}</p>
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

  // clarifications: [{ question, answer }] — accumulated Q&A for the current instruction
  const [clarifications, setClarifications] = useState([]);
  const [pendingQuestion, setPendingQuestion] = useState(null); // current question waiting for answer
  const [clarificationAnswer, setClarificationAnswer] = useState('');

  const [plan, setPlan] = useState(null);   // status === 'ready'
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

  // Focus the clarification input when a question appears
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
      {/* Page header */}
      <div className="px-6 py-5 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Agent</h2>
            <p className="text-sm text-gray-400 mt-0.5">Create and update NetSuite records using natural language</p>
          </div>
          <button
            onClick={() => { setShowHistory(v => !v); if (!showHistory) loadHistory(); }}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
              showHistory ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            History
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-5">

          {/* Instruction input */}
          <form onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-gray-300 mb-2">What would you like to do?</label>
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
              placeholder="e.g. Create a customer named Acme Corp with email acme@corp.com"
              rows={3}
              disabled={isPlanning || isActive}
              className="w-full bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors resize-none disabled:opacity-60"
            />
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-gray-600">⌘↵ or click Plan</p>
              <div className="flex gap-2">
                {isActive && (
                  <button type="button" onClick={handleReset}
                    className="px-4 py-2 border border-gray-600 text-gray-400 hover:text-white hover:border-gray-500 rounded-xl text-sm transition-colors">
                    Start over
                  </button>
                )}
                <button type="submit" disabled={!instruction.trim() || isPlanning || isActive}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-2">
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
                  className="text-xs text-gray-500 hover:text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full px-3 py-1.5 transition-colors">
                  {ex}
                </button>
              ))}
            </div>
          )}

          {/* Clarification Q&A history (previous rounds) */}
          {clarifications.length > 0 && (
            <div className="space-y-2">
              {clarifications.map((c, i) => (
                <div key={i} className="text-sm space-y-1 px-1">
                  <p className="text-gray-500"><span className="text-gray-400 font-medium">Q:</span> {c.question}</p>
                  <p className="text-gray-300"><span className="text-gray-400 font-medium">A:</span> {c.answer}</p>
                </div>
              ))}
            </div>
          )}

          {/* Pending clarification question */}
          {pendingQuestion && (
            <div className="bg-gray-800 border border-blue-700/50 rounded-xl overflow-hidden">
              <div className="flex items-start gap-3 px-5 py-4">
                <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-white leading-relaxed">{pendingQuestion}</p>
              </div>
              <form onSubmit={handleAnswerSubmit} className="px-5 pb-4 flex gap-2">
                <input
                  ref={clarificationInputRef}
                  type="text"
                  value={clarificationAnswer}
                  onChange={e => setClarificationAnswer(e.target.value)}
                  placeholder="Your answer…"
                  disabled={isPlanning}
                  className="flex-1 bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
                />
                <button type="submit" disabled={!clarificationAnswer.trim() || isPlanning}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
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
            <div className="flex items-start gap-3 px-4 py-3 bg-red-900/30 border border-red-700/50 rounded-xl">
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
            <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-700">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <span className="text-sm font-medium text-white">Action Plan</span>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${RISK_COLORS[plan.riskLevel] || RISK_COLORS.medium}`}>
                    {RISK_LABELS[plan.riskLevel] || 'Medium risk'}
                  </span>
                </div>
                <p className="text-sm text-gray-200 leading-relaxed">{plan.confirmation}</p>
              </div>

              <div className="px-5 py-3 bg-gray-900/50 border-b border-gray-700">
                <p className="text-xs text-gray-500 mb-1">Tool</p>
                <code className="text-xs text-blue-300 font-mono">{plan.tool}</code>
                <details className="mt-2">
                  <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 select-none">View arguments</summary>
                  <pre className="text-xs text-gray-400 mt-2 overflow-x-auto">{JSON.stringify(plan.arguments, null, 2)}</pre>
                </details>
              </div>

              <div className="px-5 py-4 flex items-center justify-between gap-3">
                <button onClick={handleReset} disabled={isExecuting}
                  className="px-4 py-2 border border-gray-600 text-gray-400 hover:text-white hover:border-gray-500 rounded-lg text-sm transition-colors disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleExecute} disabled={isExecuting}
                  className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                    plan.riskLevel === 'high' ? 'bg-red-700 hover:bg-red-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
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
            <div className="bg-gray-800 border border-green-700/50 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-700">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-sm font-medium text-green-300">Done</span>
              </div>
              <div className="px-5 py-4">
                <p className="text-sm text-gray-200 whitespace-pre-wrap">{result}</p>
              </div>
              <div className="px-5 pb-4">
                <button onClick={() => { setResult(null); setInstruction(''); }}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
                  Run another action →
                </button>
              </div>
            </div>
          )}

          {/* History / Audit Log */}
          {showHistory && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-400">Audit Log</h3>
                <button onClick={loadHistory} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Refresh</button>
              </div>
              {history.length === 0
                ? <p className="text-sm text-gray-600">No actions yet.</p>
                : <div className="space-y-2">{history.map(item => <HistoryItem key={item.id} item={item} onReverted={loadHistory} />)}</div>
              }
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
