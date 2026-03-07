import { useState } from 'react';
import api from '../../api/client';
import { useDashboardStore } from '../../store/dashboardStore';
import { WidgetRenderer } from '../Charts/WidgetRenderer';

const EXAMPLES = [
  'Show total revenue by month this year',
  'Which customers have the highest open balance?',
  'Top 10 items by sales quantity this quarter',
  'Count of open sales orders by status',
  'What is my total accounts receivable?',
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

  const handleDismiss = () => {
    setResult(null);
    setError(null);
  };

  const handleExample = (ex) => {
    setQuestion(ex);
    setResult(null);
    setError(null);
  };

  return (
    <div className="border-t border-gray-700 bg-gray-900 flex-shrink-0">
      {/* Successful result preview */}
      {result && result.success && (
        <div className="px-3 sm:px-6 pt-3">
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            {/* Preview header — two-row on mobile, single row on sm+ */}
            <div className="px-4 py-2.5 border-b border-gray-700">
              {/* Top row: title + dismiss */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white leading-snug">{result.visualization?.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 sm:line-clamp-1">{result.interpretation}</p>
                </div>
                {/* Dismiss — 44px touch target */}
                <button
                  onClick={handleDismiss}
                  className="flex-shrink-0 flex items-center justify-center w-8 h-8 text-gray-500 hover:text-gray-300 focus-visible:outline-2 focus-visible:outline-blue-500 rounded transition-colors"
                  title="Dismiss"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Bottom row: row count + pin button */}
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-500">{result.totalResults} row{result.totalResults !== 1 ? 's' : ''}</span>
                <button
                  onClick={handlePin}
                  disabled={isPinning}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors min-h-[36px]"
                >
                  {isPinning ? 'Pinning…' : 'Pin to Dashboard'}
                </button>
              </div>
            </div>

            {/* Chart preview — taller on mobile for table results, shorter for charts */}
            <div className="h-44 sm:h-52 p-3">
              <WidgetRenderer widget={{ ...result, cached_data: result.data, visualization_config: result.visualization }} />
            </div>
          </div>
        </div>
      )}

      {/* AI returned not-success (query built but no data / uncertain) */}
      {result && !result.success && (
        <div className="px-3 sm:px-6 pt-3">
          <div className="flex items-start justify-between gap-3 bg-yellow-900/30 border border-yellow-700/50 rounded-xl px-4 py-3">
            <p className="text-sm text-yellow-300">{result.interpretation}</p>
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 flex items-center justify-center w-8 h-8 text-yellow-500 hover:text-yellow-300 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Network / API error */}
      {error && (
        <div className="px-3 sm:px-6 pt-3">
          <div className="flex items-start justify-between gap-3 bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3">
            <p className="text-sm text-red-300">{error}</p>
            <button
              onClick={() => setError(null)}
              className="flex-shrink-0 flex items-center justify-center w-8 h-8 text-red-500 hover:text-red-300 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Input row */}
      <div className="px-3 sm:px-6 py-3 sm:py-4">
        <form onSubmit={handleSubmit} className="flex gap-2 sm:gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Ask a question about your NetSuite data…"
              // 16px font prevents iOS Safari from auto-zooming on focus
              className="w-full bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-xl px-4 py-3 pr-12 text-base sm:text-sm focus:outline-none focus:border-blue-500 transition-colors"
              disabled={isLoading}
            />
            {isLoading && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="animate-spin w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
          </div>
          {/* Ask button — minimum 44px height for touch */}
          <button
            type="submit"
            disabled={!question.trim() || isLoading}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors flex-shrink-0 min-h-[48px]"
          >
            Ask
          </button>
        </form>

        {/* Example prompt chips — horizontal scroll on mobile, wrap on sm+
            no-scrollbar hides the scrollbar track while keeping scroll gesture */}
        <div className="flex gap-2 mt-2.5 overflow-x-auto pb-safe sm:flex-wrap sm:overflow-x-visible no-scrollbar">
          {EXAMPLES.map(ex => (
            <button
              key={ex}
              onClick={() => handleExample(ex)}
              className="text-xs text-gray-500 hover:text-gray-300 active:text-white bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 rounded-full px-3 py-1.5 transition-colors whitespace-nowrap flex-shrink-0 sm:flex-shrink sm:whitespace-normal min-h-[32px]"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
