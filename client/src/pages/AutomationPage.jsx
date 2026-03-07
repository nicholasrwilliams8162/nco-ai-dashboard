import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

// ─── Constants ──────────────────────────────────────────────────────────────

const SCHEDULE_OPTIONS = [
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Every 30 minutes', cron: '*/30 * * * *' },
  { label: 'Every hour',       cron: '0 * * * *' },
  { label: 'Every 6 hours',    cron: '0 */6 * * *' },
  { label: 'Daily at 6 AM',    cron: '0 6 * * *' },
  { label: 'Daily at 8 AM',    cron: '0 8 * * *' },
  { label: 'Daily at noon',    cron: '0 12 * * *' },
  { label: 'Weekly (Mon 8 AM)', cron: '0 8 * * 1' },
  { label: 'Custom…',          cron: 'custom' },
];

const NOTIFY_OPTIONS = [
  { value: 'immediate',    label: 'Immediate — notify on every run with results' },
  { value: 'run_summary',  label: 'Run summary — one notification per run' },
  { value: 'never',        label: 'Never — run silently' },
];

const STATUS_PILL = {
  completed: 'bg-green-900/40 text-green-300 border-green-700/50',
  running:   'bg-blue-900/40  text-blue-300  border-blue-700/50',
  failed:    'bg-red-900/40   text-red-300   border-red-700/50',
  pending:   'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
};

const TYPE_ICON = {
  flag:     '⚑',
  action:   '✓',
  error:    '✕',
  progress: '↻',
};

const EMPTY_FORM = {
  name: '',
  description: '',
  instructions: '',
  schedule: SCHEDULE_OPTIONS[4].cron, // Daily at 6 AM
  customCron: '',
  require_approval: true,
  notification_frequency: 'immediate',
};

function scheduleLabel(cron) {
  return SCHEDULE_OPTIONS.find(o => o.cron === cron)?.label ?? cron;
}

function relativeTime(dt) {
  if (!dt) return '—';
  const diff = Date.now() - new Date(dt + (dt.includes('Z') ? '' : 'Z')).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ─── Agent Form ──────────────────────────────────────────────────────────────

function AgentForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial
      ? { ...EMPTY_FORM, ...initial, description: initial.description ?? '' }
      : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isCustom = form.schedule === 'custom';
  const effectiveCron = isCustom ? form.customCron : form.schedule;

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.instructions.trim() || !effectiveCron.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        instructions: form.instructions.trim(),
        schedule: effectiveCron.trim(),
        require_approval: form.require_approval,
        notification_frequency: form.notification_frequency,
      };
      if (initial?.id) {
        await api.put(`/automation/agents/${initial.id}`, payload);
      } else {
        await api.post('/automation/agents', payload);
      }
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Name *</label>
        <input
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="e.g. Overdue order monitor"
          className="w-full bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          required
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Description <span className="text-gray-600">(optional)</span></label>
        <input
          value={form.description}
          onChange={e => set('description', e.target.value)}
          placeholder="Short note about what this agent does"
          className="w-full bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Instructions */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Instructions *</label>
        <textarea
          value={form.instructions}
          onChange={e => set('instructions', e.target.value)}
          placeholder={`Describe what to check and what to do. Be specific.\n\nExamples:\n• "Find all open sales orders over $10,000 that are more than 14 days old and flag them for review."\n• "Check for customers with overdue balances over $5,000 and put them on credit hold."\n• "Find any vendor bills over $50,000 created in the last 24 hours and flag them for approval."`}
          rows={6}
          className="w-full bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 resize-none"
          required
        />
        <p className="text-xs text-gray-600 mt-1">
          Plain English. Include what to find, any thresholds, and what action to take.
        </p>
      </div>

      {/* Schedule */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Schedule *</label>
          <select
            value={form.schedule}
            onChange={e => set('schedule', e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          >
            {SCHEDULE_OPTIONS.map(o => (
              <option key={o.cron} value={o.cron}>{o.label}</option>
            ))}
          </select>
        </div>
        {isCustom && (
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Cron expression</label>
            <input
              value={form.customCron}
              onChange={e => set('customCron', e.target.value)}
              placeholder="*/5 * * * *"
              className="w-full bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 font-mono"
              required
            />
          </div>
        )}
      </div>

      {/* Notifications */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Notifications</label>
        <select
          value={form.notification_frequency}
          onChange={e => set('notification_frequency', e.target.value)}
          className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        >
          {NOTIFY_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Require approval toggle */}
      <div className="flex items-center justify-between py-2 px-3 bg-gray-800/60 border border-gray-700 rounded-lg">
        <div>
          <p className="text-sm text-gray-200">Require approval before executing</p>
          <p className="text-xs text-gray-500 mt-0.5">
            When on, matching records go to the Approvals queue. When off, actions run automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => set('require_approval', !form.require_approval)}
          className={`relative ml-4 flex-shrink-0 w-11 h-6 rounded-full transition-colors ${
            form.require_approval ? 'bg-blue-600' : 'bg-gray-600'
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            form.require_approval ? 'translate-x-5' : 'translate-x-0'
          }`} />
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 border border-gray-600 text-gray-400 hover:text-white hover:border-gray-500 rounded-lg text-sm transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={saving || !form.name.trim() || !form.instructions.trim()}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
          {saving && (
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {initial?.id ? 'Save changes' : 'Create agent'}
        </button>
      </div>
    </form>
  );
}

// ─── Agent Card ──────────────────────────────────────────────────────────────

function AgentCard({ agent, onRefresh, onEdit }) {
  const [running, setRunning]     = useState(false);
  const [runError, setRunError]   = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [toggling, setToggling]   = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [expanded, setExpanded]   = useState(false);
  const [flags, setFlags]         = useState([]);
  const [loadingFlags, setLoadingFlags] = useState(false);

  const isActive = !!agent.enabled && !agent.paused;

  const loadFlags = async () => {
    setLoadingFlags(true);
    try {
      const res = await api.get(`/automation/notifications?agentId=${agent.id}&type=flag`);
      setFlags(res.data);
    } finally {
      setLoadingFlags(false);
    }
  };

  const handleToggleEnabled = async () => {
    setToggling(true);
    try {
      await api.put(`/automation/agents/${agent.id}`, { enabled: !agent.enabled });
      onRefresh();
    } finally {
      setToggling(false);
    }
  };

  const handlePauseResume = async () => {
    setToggling(true);
    try {
      await api.post(`/automation/agents/${agent.id}/${agent.paused ? 'resume' : 'pause'}`);
      onRefresh();
    } finally {
      setToggling(false);
    }
  };

  const handleRunNow = async () => {
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const res = await api.post(`/automation/agents/${agent.id}/run`);
      setRunResult(res.data);
      setExpanded(true);
      loadFlags();
      onRefresh();
    } catch (err) {
      setRunError(err.response?.data?.error || err.message);
      setExpanded(true);
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/automation/agents/${agent.id}`);
      onRefresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${
      isActive ? 'border-gray-700 bg-gray-800/40' : 'border-gray-700/50 bg-gray-800/20 opacity-70'
    }`}>
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          {/* Status dot */}
          <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
            !agent.enabled ? 'bg-gray-600' :
            agent.paused   ? 'bg-yellow-500' :
            'bg-green-500 shadow-[0_0_6px_rgba(74,222,128,0.5)]'
          }`} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium text-white">{agent.name}</h3>
              {agent.paused && agent.enabled && (
                <span className="text-xs text-yellow-400 bg-yellow-900/30 border border-yellow-700/40 rounded px-1.5 py-0.5">Paused</span>
              )}
              {!agent.enabled && (
                <span className="text-xs text-gray-500 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5">Disabled</span>
              )}
              {agent.require_approval ? (
                <span className="text-xs text-blue-400 bg-blue-900/20 border border-blue-700/30 rounded px-1.5 py-0.5">Approval required</span>
              ) : (
                <span className="text-xs text-purple-400 bg-purple-900/20 border border-purple-700/30 rounded px-1.5 py-0.5">Auto-execute</span>
              )}
            </div>

            {agent.description && (
              <p className="text-sm text-gray-400 mt-0.5">{agent.description}</p>
            )}

            <div className="flex items-center gap-4 mt-2 flex-wrap">
              <span className="text-xs text-gray-500">
                <span className="text-gray-600">Schedule:</span> {scheduleLabel(agent.schedule)}
              </span>
              <span className="text-xs text-gray-500">
                <span className="text-gray-600">Last run:</span> {relativeTime(agent.last_run_at)}
              </span>
              {agent.pending_todos > 0 && (
                <span className="text-xs text-yellow-300 bg-yellow-900/30 border border-yellow-700/40 rounded-full px-2 py-0.5">
                  {agent.pending_todos} pending approval
                </span>
              )}
              <span className="text-xs text-gray-600">{agent.total_runs ?? 0} runs total</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Run Now */}
            <button
              onClick={handleRunNow}
              disabled={running || !agent.enabled}
              title="Run now"
              className="p-1.5 text-gray-500 hover:text-blue-400 disabled:opacity-30 transition-colors rounded"
            >
              {running ? (
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </button>

            {/* Pause/Resume */}
            <button
              onClick={handlePauseResume}
              disabled={toggling || !agent.enabled}
              title={agent.paused ? 'Resume' : 'Pause'}
              className="p-1.5 text-gray-500 hover:text-yellow-400 disabled:opacity-30 transition-colors rounded"
            >
              {agent.paused ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </button>

            {/* Edit */}
            <button
              onClick={() => onEdit(agent)}
              title="Edit"
              className="p-1.5 text-gray-500 hover:text-white transition-colors rounded"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>

            {/* Enabled toggle */}
            <button
              onClick={handleToggleEnabled}
              disabled={toggling}
              title={agent.enabled ? 'Disable' : 'Enable'}
              className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 flex-shrink-0 ${
                agent.enabled ? 'bg-blue-600' : 'bg-gray-600'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                agent.enabled ? 'translate-x-4' : 'translate-x-0'
              }`} />
            </button>

            {/* Expand / instructions preview */}
            <button
              onClick={() => { setExpanded(v => { if (!v) loadFlags(); return !v; }); }}
              title="View instructions"
              className="p-1.5 text-gray-600 hover:text-gray-400 transition-colors rounded"
            >
              <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Delete */}
            <button
              onClick={handleDelete}
              disabled={deleting}
              title="Delete agent"
              className="p-1.5 text-gray-600 hover:text-red-400 disabled:opacity-30 transition-colors rounded"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-gray-700/60 space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Instructions</p>
              <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{agent.instructions}</p>
            </div>
            {runResult && (
              <div className="bg-green-900/20 border border-green-700/40 rounded-lg p-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-green-400 font-medium mb-0.5">Run complete</p>
                  {runResult.recordsFound === 0 ? (
                    <p className="text-xs text-gray-400">No records matched the criteria</p>
                  ) : (
                    <p className="text-xs text-gray-300">
                      {runResult.recordsFound} record{runResult.recordsFound !== 1 ? 's' : ''} found
                      {runResult.actionsCreated > 0 && ` — ${runResult.actionsCreated} ${agent.require_approval ? 'queued for approval' : 'action(s) taken'}`}
                      {agent.require_approval ? '. Check the Approvals tab.' : '. Check the Activity tab.'}
                    </p>
                  )}
                </div>
                <button onClick={() => setRunResult(null)} className="text-green-700 hover:text-green-500 flex-shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            {runError && (
              <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-3">
                <p className="text-xs text-red-400 font-medium mb-1">Run failed</p>
                <p className="text-xs text-red-300 whitespace-pre-wrap leading-relaxed">{runError}</p>
                <button onClick={() => setRunError(null)} className="text-xs text-red-600 hover:text-red-400 mt-1">Dismiss</button>
              </div>
            )}
            {/* Flagged results */}
            {loadingFlags ? (
              <p className="text-xs text-gray-600">Loading flags…</p>
            ) : flags.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-2">Flagged results ({flags.length})</p>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {flags.map(f => (
                    <div key={f.id} className="flex items-start gap-2 px-3 py-2 bg-yellow-900/10 border border-yellow-700/20 rounded-lg">
                      <span className="text-yellow-500 text-xs mt-0.5 flex-shrink-0">⚑</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-200">{f.message}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{relativeTime(f.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {agent.last_run_query && (
              <details>
                <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 select-none">Last run — generated query</summary>
                <pre className="text-xs text-blue-300 bg-gray-900 rounded-lg p-3 mt-2 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {agent.last_run_query}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Approvals Tab ────────────────────────────────────────────────────────────

function ApprovalsTab({ onCountChange }) {
  const [todos, setTodos]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [processing, setProcessing] = useState({}); // id -> 'approve'|'deny'
  const [denyingId, setDenyingId]   = useState(null);
  const [denyReason, setDenyReason] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/automation/todos');
      setTodos(res.data);
      onCountChange?.(res.data.length);
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => { load(); }, [load]);

  const handle = async (id, action, reason) => {
    setProcessing(p => ({ ...p, [id]: action }));
    try {
      if (action === 'approve') {
        await api.post(`/automation/todos/${id}/approve`);
      } else {
        await api.post(`/automation/todos/${id}/deny`, { reason: reason || null });
      }
      setTodos(t => t.filter(x => x.id !== id));
      setDenyingId(null);
      setDenyReason('');
      onCountChange?.(todos.length - 1);
    } catch (err) {
      alert(`Failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setProcessing(p => { const n = { ...p }; delete n[id]; return n; });
    }
  };

  if (loading) return <div className="text-gray-500 text-sm py-8 text-center">Loading…</div>;
  if (todos.length === 0) return (
    <div className="text-center py-16">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-800 flex items-center justify-center">
        <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <p className="text-gray-500 text-sm">No pending approvals</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {todos.map(todo => (
        <div key={todo.id} className="bg-gray-800 border border-yellow-700/30 rounded-xl overflow-hidden">
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-xs text-yellow-400 bg-yellow-900/30 border border-yellow-700/40 rounded px-1.5 py-0.5">
                    {todo.agent_name}
                  </span>
                  <span className="text-xs text-gray-500">{todo.action_tool}</span>
                  {todo.record_type && (
                    <span className="text-xs text-gray-600">{todo.record_type}</span>
                  )}
                </div>
                <p className="text-sm text-white leading-relaxed">{todo.description}</p>
                <p className="text-xs text-gray-600 mt-1">{relativeTime(todo.created_at)}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => { setDenyingId(todo.id); setDenyReason(''); }}
                  disabled={!!processing[todo.id]}
                  className="px-3 py-1.5 border border-gray-600 text-gray-400 hover:text-red-300 hover:border-red-700/60 rounded-lg text-sm transition-colors disabled:opacity-40"
                >
                  Deny
                </button>
                <button
                  onClick={() => handle(todo.id, 'approve')}
                  disabled={!!processing[todo.id]}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5"
                >
                  {processing[todo.id] === 'approve' ? (
                    <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : null}
                  Approve
                </button>
              </div>
            </div>

            {denyingId === todo.id && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  autoFocus
                  value={denyReason}
                  onChange={e => setDenyReason(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handle(todo.id, 'deny', denyReason)}
                  placeholder="Reason for denying (optional — helps agent learn)"
                  className="flex-1 bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-red-500"
                />
                <button
                  onClick={() => handle(todo.id, 'deny', denyReason)}
                  disabled={!!processing[todo.id]}
                  className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                >
                  {processing[todo.id] === 'deny' ? '…' : 'Confirm deny'}
                </button>
                <button onClick={() => setDenyingId(null)} className="text-xs text-gray-600 hover:text-gray-400">Cancel</button>
              </div>
            )}
            {todo.action_tool !== 'flag' && (
              <details className="mt-3">
                <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 select-none">View action details</summary>
                <pre className="text-xs text-gray-400 mt-2 bg-gray-900 rounded p-2 overflow-x-auto">
                  {JSON.stringify(todo.arguments, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Notifications Tab ────────────────────────────────────────────────────────

function NotificationsTab({ onMarkRead }) {
  const [notifs, setNotifs]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/automation/notifications');
      setNotifs(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markAllRead = async () => {
    await api.post('/automation/notifications/read', {});
    setNotifs(n => n.map(x => ({ ...x, read: 1 })));
    onMarkRead?.();
  };

  const unreadCount = notifs.filter(n => !n.read).length;

  if (loading) return <div className="text-gray-500 text-sm py-8 text-center">Loading…</div>;
  if (notifs.length === 0) return (
    <div className="text-center py-16">
      <p className="text-gray-500 text-sm">No notifications yet</p>
    </div>
  );

  return (
    <div>
      {unreadCount > 0 && (
        <div className="flex justify-end mb-3">
          <button onClick={markAllRead} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Mark all read
          </button>
        </div>
      )}
      <div className="space-y-1">
        {notifs.map(n => (
          <div key={n.id} className={`flex items-start gap-3 px-4 py-3 rounded-lg transition-colors ${
            n.read ? 'opacity-50' : 'bg-gray-800/60'
          }`}>
            <span className={`text-sm flex-shrink-0 ${
              n.type === 'error'    ? 'text-red-400' :
              n.type === 'flag'     ? 'text-yellow-400' :
              n.type === 'action'   ? 'text-green-400' :
              'text-blue-400'
            }`}>{TYPE_ICON[n.type] ?? '•'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200">{n.message}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-600">{n.agent_name}</span>
                <span className="text-xs text-gray-700">{relativeTime(n.created_at)}</span>
              </div>
            </div>
            {!n.read && <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Run History Tab ──────────────────────────────────────────────────────────

function RunHistoryTab() {
  const [runs, setRuns]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/automation/runs')
      .then(r => setRuns(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-500 text-sm py-8 text-center">Loading…</div>;
  if (runs.length === 0) return (
    <div className="text-center py-16">
      <p className="text-gray-500 text-sm">No runs yet</p>
    </div>
  );

  return (
    <div className="space-y-2">
      {runs.map(run => (
        <div key={run.id} className="flex items-start gap-3 px-4 py-3 bg-gray-800/40 border border-gray-700/50 rounded-lg">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-200 font-medium">{run.agent_name}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_PILL[run.status] ?? STATUS_PILL.completed}`}>
                {run.status}
              </span>
            </div>
            {run.plan_summary && (
              <p className="text-xs text-gray-400 mt-0.5">{run.plan_summary}</p>
            )}
            {run.error && (
              <p className="text-xs text-red-400 mt-0.5">{run.error}</p>
            )}
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-xs text-gray-600">{relativeTime(run.started_at)}</span>
              {run.records_found > 0 && (
                <span className="text-xs text-gray-500">{run.records_found} record(s) found</span>
              )}
              {run.actions_created > 0 && (
                <span className="text-xs text-gray-500">{run.actions_created} action(s)</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AutomationPage() {
  const [tab, setTab]           = useState(() => localStorage.getItem('automation_tab') || 'agents');
  const [agents, setAgents]     = useState([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadCount, setUnreadCount]   = useState(0);

  const loadAgents = useCallback(async () => {
    try {
      const res = await api.get('/automation/agents');
      setAgents(res.data);
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const res = await api.get('/automation/notifications/unread-count');
      setPendingCount(res.data.pending);
      setUnreadCount(res.data.unread);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    loadAgents();
    loadCounts();
    const interval = setInterval(loadCounts, 30000);
    return () => clearInterval(interval);
  }, [loadAgents, loadCounts]);

  const handleFormSave = () => {
    setShowForm(false);
    setEditingAgent(null);
    loadAgents();
  };

  const handleEdit = (agent) => {
    const scheduleOpt = SCHEDULE_OPTIONS.find(o => o.cron === agent.schedule && o.cron !== 'custom');
    setEditingAgent({
      ...agent,
      schedule: scheduleOpt ? agent.schedule : 'custom',
      customCron: scheduleOpt ? '' : agent.schedule,
    });
    setShowForm(true);
  };

  const TABS = [
    { id: 'agents',        label: 'Agents' },
    { id: 'approvals',     label: 'Approvals', badge: pendingCount },
    { id: 'notifications', label: 'Activity',  badge: unreadCount },
    { id: 'runs',          label: 'Run History' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Automation</h2>
            <p className="text-sm text-gray-400 mt-0.5">Scheduled agents that monitor and act on NetSuite data</p>
          </div>
          {tab === 'agents' && !showForm && (
            <button
              onClick={() => { setEditingAgent(null); setShowForm(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Agent
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); localStorage.setItem('automation_tab', t.id); setShowForm(false); setEditingAgent(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                tab === t.id
                  ? 'bg-gray-700 text-white font-medium'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {t.label}
              {t.badge > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center leading-none">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-3xl mx-auto">

          {/* ── Agents Tab ── */}
          {tab === 'agents' && (
            <>
              {showForm && (
                <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-5">
                  <h3 className="text-sm font-semibold text-white mb-4">
                    {editingAgent?.id ? 'Edit agent' : 'New agent'}
                  </h3>
                  <AgentForm
                    initial={editingAgent}
                    onSave={handleFormSave}
                    onCancel={() => { setShowForm(false); setEditingAgent(null); }}
                  />
                </div>
              )}

              {loadingAgents ? (
                <div className="text-gray-500 text-sm py-8 text-center">Loading agents…</div>
              ) : agents.length === 0 && !showForm ? (
                <div className="text-center py-20">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
                    <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-gray-400 font-medium">No agents yet</p>
                  <p className="text-gray-600 text-sm mt-1 mb-4">Create your first agent to start automating NetSuite workflows</p>
                  <button
                    onClick={() => setShowForm(true)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
                  >
                    Create an agent
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {agents.map(agent => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onRefresh={() => { loadAgents(); loadCounts(); }}
                      onEdit={handleEdit}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Approvals Tab ── */}
          {tab === 'approvals' && (
            <ApprovalsTab
              onCountChange={count => {
                setPendingCount(count);
                loadCounts();
              }}
            />
          )}

          {/* ── Notifications Tab ── */}
          {tab === 'notifications' && (
            <NotificationsTab onMarkRead={() => setUnreadCount(0)} />
          )}

          {/* ── Run History Tab ── */}
          {tab === 'runs' && <RunHistoryTab />}
        </div>
      </div>
    </div>
  );
}
