import { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import api from '../../api/client';

const REDIRECT_URI = 'http://localhost:3001/api/auth/netsuite/callback';

function CopyField({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-2 mt-1">
      <code className="flex-1 text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-blue-300 font-mono truncate">
        {value}
      </code>
      <button
        onClick={copy}
        className="flex-shrink-0 text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors min-h-[32px]"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

// Shared input class — text-base (16px) prevents iOS Safari auto-zoom on focus
const inputClass =
  'w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-base sm:text-sm transition-colors';

export function SettingsPanel({ onClose, initialError }) {
  const { authStatus, groqKeySet, checkAuth } = useDashboardStore();
  const [accountId, setAccountId] = useState(authStatus.accountId || '');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState(initialError || null);
  const [showSetup, setShowSetup] = useState(false);

  const [groqKey, setGroqKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keyError, setKeyError] = useState(null);
  const [keySaved, setKeySaved] = useState(false);

  const handleSaveGroqKey = async () => {
    if (!groqKey.trim()) { setKeyError('API key is required.'); return; }
    setIsSavingKey(true);
    setKeyError(null);
    setKeySaved(false);
    try {
      await api.post('/auth/settings', { groqApiKey: groqKey.trim() });
      await checkAuth();
      setGroqKey('');
      setKeySaved(true);
      setTimeout(() => setKeySaved(false), 3000);
    } catch {
      setKeyError('Failed to save API key.');
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleConnect = async () => {
    if (!accountId.trim()) { setError('Account ID is required.'); return; }
    if (!clientId.trim()) { setError('Client ID is required.'); return; }
    if (!clientSecret.trim()) { setError('Client Secret is required.'); return; }

    setIsConnecting(true);
    setError(null);
    try {
      const res = await api.post('/auth/netsuite/initiate', {
        accountId: accountId.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      window.location.href = res.data.authUrl;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to initiate connection.');
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    setError(null);
    try {
      await api.post('/auth/netsuite/disconnect');
      await checkAuth();
      setAccountId('');
      setClientId('');
      setClientSecret('');
    } catch {
      setError('Failed to disconnect.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    // Overlay — full screen on mobile so modal has room to breathe
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4">
      {/* Sheet — slides up on mobile (items-end), centered modal on sm+ */}
      <div className="bg-gray-800 border border-gray-700 rounded-t-2xl sm:rounded-xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] sm:max-h-[90vh] overflow-y-auto">
        {/* Drag handle indicator on mobile */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-gray-600 rounded-full" />
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-white">NetSuite Connection</h2>
            {onClose && (
              // 44px touch target for close button
              <button
                onClick={onClose}
                className="flex items-center justify-center w-10 h-10 -mr-2 text-gray-400 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-500 rounded-lg transition-colors"
                aria-label="Close settings"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {authStatus.connected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-4 py-3 bg-green-900/40 border border-green-700/50 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                <span className="text-green-300 text-sm font-medium">
                  Connected — {authStatus.accountId}
                </span>
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="w-full px-4 py-3 bg-red-700 hover:bg-red-600 text-white rounded-lg transition-colors disabled:opacity-50 text-sm font-medium min-h-[44px]"
              >
                {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Setup instructions — collapsible */}
              <div className="border border-gray-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowSetup(s => !s)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors min-h-[44px]"
                >
                  <span className="font-medium">NetSuite setup requirements</span>
                  <svg
                    className={`w-4 h-4 transition-transform flex-shrink-0 ${showSetup ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showSetup && (
                  <div className="px-4 pb-4 space-y-3 text-xs text-gray-400 border-t border-gray-700">
                    <div className="pt-3">
                      <p className="font-semibold text-gray-300 mb-1">1. Enable OAuth 2.0 feature</p>
                      <p>Setup → Company → Enable Features → SuiteCloud tab → Manage Authentication → check <strong className="text-gray-200">OAuth 2.0</strong></p>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-300 mb-1">2. Create an Integration record</p>
                      <p>Setup → Integration → Manage Integrations → New</p>
                      <ul className="mt-1 space-y-0.5 list-disc list-inside">
                        <li>Check <strong className="text-gray-200">Authorization Code Grant</strong></li>
                        <li>Check <strong className="text-gray-200">REST Web Services</strong> scope</li>
                        <li>Set the redirect URI below exactly:</li>
                      </ul>
                      <CopyField value={REDIRECT_URI} />
                      <p className="mt-2">After saving, copy the <strong className="text-gray-200">Consumer Key</strong> (Client ID) and <strong className="text-gray-200">Consumer Secret</strong> (Client Secret) — they're only shown once.</p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Account ID</label>
                <input
                  type="text"
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  placeholder="e.g. 1234567 or 1234567_SB1"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Client ID</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="Consumer Key from integration record"
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Client Secret</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleConnect()}
                  placeholder="Consumer Secret from integration record"
                  className={`${inputClass} font-mono`}
                />
              </div>

              {error && (
                <div className="px-3 py-2 bg-red-900/40 border border-red-700/50 rounded-lg">
                  <p className="text-red-300 text-sm">{error}</p>
                  {(error.includes('invalid') || error.toLowerCase().includes('login')) && (
                    <p className="text-red-400 text-xs mt-1">
                      Tip: Check that OAuth 2.0 is enabled in NetSuite (see setup requirements above) and that your Client ID matches exactly.
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 text-sm font-medium min-h-[44px]"
              >
                {isConnecting ? 'Redirecting to NetSuite…' : 'Connect to NetSuite'}
              </button>
            </div>
          )}

          {/* Groq API Key section */}
          <div className="border-t border-gray-700 pt-5 mt-5">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-gray-300">Groq API Key</h3>
              {groqKeySet
                ? <span className="text-xs px-2 py-0.5 bg-green-900/50 text-green-400 border border-green-700/50 rounded-full">Saved</span>
                : <span className="text-xs px-2 py-0.5 bg-yellow-900/50 text-yellow-400 border border-yellow-700/50 rounded-full">Not set</span>
              }
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={groqKey}
                onChange={e => setGroqKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveGroqKey()}
                placeholder={groqKeySet ? 'Enter new key to replace…' : 'gsk_…'}
                className={`${inputClass} flex-1 font-mono`}
              />
              <button
                onClick={handleSaveGroqKey}
                disabled={isSavingKey}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 text-sm font-medium flex-shrink-0 min-h-[44px]"
              >
                {isSavingKey ? 'Saving…' : keySaved ? 'Saved!' : 'Save'}
              </button>
            </div>
            {keyError && <p className="text-red-400 text-xs mt-1.5">{keyError}</p>}
            <p className="text-gray-500 text-xs mt-1.5">
              Get a free key at <span className="text-gray-400">console.groq.com</span>. Never sent to the browser after saving.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
