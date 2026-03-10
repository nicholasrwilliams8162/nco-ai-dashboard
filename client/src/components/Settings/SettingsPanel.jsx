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
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <code style={{
        flex: 1, fontSize: 11, background: 'var(--page-bg)', border: '1px solid var(--border)',
        borderRadius: 7, padding: '6px 10px', color: 'var(--blue)',
        fontFamily: 'DM Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </code>
      <button
        onClick={copy}
        style={{
          flexShrink: 0, fontSize: 12, padding: '5px 12px', background: 'var(--card-bg-2)',
          border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer',
          color: 'var(--text-2)', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap',
          minHeight: 30,
        }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 14px',
  background: 'var(--input-bg)', border: '1.5px solid var(--border)',
  borderRadius: 9, color: 'var(--text-1)',
  fontSize: 14, fontFamily: 'inherit', fontWeight: 500,
  outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
};

function StyledInput({ type = 'text', value, onChange, onKeyDown, placeholder, mono = false }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      style={{ ...inputStyle, fontFamily: mono ? 'DM Mono, monospace' : 'inherit', fontSize: mono ? 13 : 14 }}
      onFocus={e => {
        e.target.style.borderColor = 'var(--blue)';
        e.target.style.boxShadow = '0 0 0 3px var(--blue-light)';
      }}
      onBlur={e => {
        e.target.style.borderColor = 'var(--border)';
        e.target.style.boxShadow = 'none';
      }}
    />
  );
}

export function SettingsPanel({ onClose, initialError }) {
  const { authStatus, openrouterKeySet, checkAuth } = useDashboardStore();
  const [accountId, setAccountId] = useState(authStatus.accountId || '');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState(initialError || null);
  const [showSetup, setShowSetup] = useState(false);

  const [openrouterKey, setOpenrouterKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keyError, setKeyError] = useState(null);
  const [keySaved, setKeySaved] = useState(false);

  const handleSaveOpenrouterKey = async () => {
    if (!openrouterKey.trim()) { setKeyError('API key is required.'); return; }
    setIsSavingKey(true);
    setKeyError(null);
    setKeySaved(false);
    try {
      await api.post('/auth/settings', { openrouterApiKey: openrouterKey.trim() });
      await checkAuth();
      setOpenrouterKey('');
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
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)', padding: 24,
    }}>
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: 16, boxShadow: 'var(--shadow-modal)',
        width: '100%', maxWidth: 480, maxHeight: '90vh',
        overflowY: 'auto',
      }}>
        <div style={{ padding: '24px 28px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-1)', margin: 0 }}>
              Settings
            </h2>
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none', background: 'var(--card-bg-2)', borderRadius: 8, cursor: 'pointer',
                  color: 'var(--text-3)', transition: 'all 0.15s',
                }}
              >
                <svg style={{ width: 15, height: 15 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Section label */}
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 14 }}>
            NetSuite Connection
          </p>

          {authStatus.connected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '12px 16px', background: 'var(--green-light)',
                border: '1px solid var(--green)', borderRadius: 10,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--green)' }}>
                  Connected — {authStatus.accountId}
                </span>
              </div>
              {error && <p style={{ fontSize: 13, color: 'var(--red)', margin: 0 }}>{error}</p>}
              <button
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                style={{
                  width: '100%', padding: '11px 16px', background: 'var(--red-light)',
                  color: 'var(--red)', border: '1px solid transparent', borderRadius: 9,
                  fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                  opacity: isDisconnecting ? 0.6 : 1, fontFamily: 'inherit',
                  transition: 'all 0.15s', minHeight: 44,
                }}
              >
                {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Setup instructions — collapsible */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <button
                  onClick={() => setShowSetup(s => !s)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '11px 14px', fontSize: 13.5, fontWeight: 600, color: 'var(--text-2)',
                    background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    minHeight: 44,
                  }}
                >
                  NetSuite setup requirements
                  <svg style={{ width: 14, height: 14, transform: showSetup ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showSetup && (
                  <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ paddingTop: 12 }}>
                      <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-2)', marginBottom: 4 }}>1. Enable OAuth 2.0</p>
                      <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
                        Setup → Company → Enable Features → SuiteCloud → Manage Authentication → check <strong style={{ color: 'var(--text-2)' }}>OAuth 2.0</strong>
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-2)', marginBottom: 4 }}>2. Create Integration record</p>
                      <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
                        Setup → Integration → Manage Integrations → New. Enable Authorization Code Grant + REST Web Services. Set redirect URI:
                      </p>
                      <CopyField value={REDIRECT_URI} />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 6 }}>Account ID</label>
                <StyledInput
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  placeholder="e.g. 1234567 or 1234567_SB1"
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 6 }}>Client ID</label>
                <StyledInput
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="Consumer Key from integration record"
                  mono
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 6 }}>Client Secret</label>
                <StyledInput
                  type="password"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleConnect()}
                  placeholder="Consumer Secret from integration record"
                  mono
                />
              </div>

              {error && (
                <div style={{ padding: '10px 14px', background: 'var(--red-light)', border: '1px solid var(--red)', borderRadius: 9 }}>
                  <p style={{ fontSize: 13, color: 'var(--red)', margin: 0 }}>{error}</p>
                </div>
              )}

              <button
                onClick={handleConnect}
                disabled={isConnecting}
                style={{
                  width: '100%', padding: '11px 16px',
                  background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 9,
                  fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                  opacity: isConnecting ? 0.7 : 1, fontFamily: 'inherit',
                  boxShadow: '0 1px 3px rgba(37,99,235,0.3)', minHeight: 44,
                }}
              >
                {isConnecting ? 'Redirecting to NetSuite…' : 'Connect to NetSuite'}
              </button>
            </div>
          )}

          {/* OpenRouter API Key */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20, marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', margin: 0 }}>
                OpenRouter API Key
              </p>
              {openrouterKeySet ? (
                <span style={{ fontSize: 11, padding: '2px 8px', background: 'var(--green-light)', color: 'var(--green)', borderRadius: 6, fontWeight: 700 }}>
                  Saved
                </span>
              ) : (
                <span style={{ fontSize: 11, padding: '2px 8px', background: 'var(--amber-light)', color: 'var(--amber)', borderRadius: 6, fontWeight: 700 }}>
                  Not set
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <StyledInput
                  type="password"
                  value={openrouterKey}
                  onChange={e => setOpenrouterKey(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveOpenrouterKey()}
                  placeholder={openrouterKeySet ? 'Enter new key to replace…' : 'sk-or-…'}
                  mono
                />
              </div>
              <button
                onClick={handleSaveOpenrouterKey}
                disabled={isSavingKey}
                style={{
                  flexShrink: 0, padding: '10px 16px',
                  background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 9,
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  opacity: isSavingKey ? 0.7 : 1, fontFamily: 'inherit', minHeight: 44,
                }}
              >
                {isSavingKey ? 'Saving…' : keySaved ? 'Saved!' : 'Save'}
              </button>
            </div>
            {keyError && <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{keyError}</p>}
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
              Get a free key at <span style={{ color: 'var(--text-2)' }}>openrouter.ai</span> → Keys. Model: Llama 3.3 70B. Never sent to the browser after saving.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
