import { useCallback, useEffect, useState } from 'react';
import { SignIn, SignedIn, SignedOut, UserButton } from '@clerk/clerk-react';
import { useDashboardStore } from './store/dashboardStore';
import { DashboardGrid } from './components/Dashboard/DashboardGrid';
import { NaturalLanguageInput } from './components/QueryBar/NaturalLanguageInput';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { AgentPage } from './pages/AgentPage';
import { AutomationPage } from './pages/AutomationPage';

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconGrid() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function IconAgent() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8 1.402 1.402c1 1 .27 2.716-1.08 2.716H4.878c-1.35 0-2.08-1.716-1.08-2.716L5 14.5" />
    </svg>
  );
}
function IconAutomation() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
function IconRefresh() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
function IconSun() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>
  );
}
function IconMoon() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
    </svg>
  );
}
function IconLogoMark() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'dashboard',  label: 'Dashboard',  Icon: IconGrid },
  { id: 'agent',      label: 'Agent',      Icon: IconAgent },
  { id: 'automation', label: 'Automation', Icon: IconAutomation },
];

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ activePage, setActivePage, onSettings, automationBadge, theme, onToggleTheme }) {
  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-divider)',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 0',
        height: '100%',
      }}
    >
      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 20px 20px', borderBottom: '1px solid var(--sidebar-divider)',
        marginBottom: 16,
      }}>
        <div style={{
          width: 32, height: 32, background: 'var(--blue)',
          borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <span style={{ width: 16, height: 16, color: '#fff', display: 'flex' }}>
            <IconLogoMark />
          </span>
        </div>
        <span style={{
          fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-1)',
        }}>
          NCO Dashboard
        </span>
      </div>

      {/* Nav section label */}
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
        color: 'var(--text-4)', padding: '0 20px', marginBottom: 6,
      }}>
        Pages
      </span>

      {/* Nav items */}
      <nav style={{ flex: 1 }}>
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const active = activePage === id;
          return (
            <button
              key={id}
              onClick={() => { setActivePage(id); localStorage.setItem('active_page', id); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 20px', margin: '1px 10px',
                borderRadius: 9, cursor: 'pointer', width: 'calc(100% - 20px)',
                fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em',
                border: 'none', textAlign: 'left', transition: 'all 0.15s',
                background: active ? 'var(--sidebar-active-bg)' : 'transparent',
                color: active ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
                position: 'relative',
              }}
            >
              <span style={{
                width: 16, height: 16, display: 'flex', flexShrink: 0,
                color: active ? 'var(--sidebar-icon-active)' : 'var(--sidebar-icon)',
              }}>
                <Icon />
              </span>
              {label}
              {id === 'automation' && automationBadge > 0 && (
                <span style={{
                  marginLeft: 'auto', fontSize: 10, fontWeight: 700,
                  background: 'var(--blue)', color: '#fff',
                  minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {automationBadge}
                </span>
              )}
            </button>
          );
        })}

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--sidebar-divider)', margin: '12px 20px' }} />

        {/* Settings */}
        <button
          onClick={onSettings}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 20px', margin: '1px 10px',
            borderRadius: 9, cursor: 'pointer', width: 'calc(100% - 20px)',
            fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em',
            border: 'none', textAlign: 'left', transition: 'all 0.15s',
            background: 'transparent',
            color: 'var(--sidebar-text)',
          }}
        >
          <span style={{ width: 16, height: 16, display: 'flex', flexShrink: 0, color: 'var(--sidebar-icon)' }}>
            <IconSettings />
          </span>
          Settings
        </button>
      </nav>

      {/* Footer — theme toggle + user */}
      <div style={{
        borderTop: '1px solid var(--sidebar-divider)',
        padding: '16px 20px 0',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 10px', borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--card-bg-2)', cursor: 'pointer',
            color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600,
            transition: 'all 0.15s',
          }}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <span style={{ width: 15, height: 15, display: 'flex' }}>
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </span>
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>

        {/* User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    </aside>
  );
}

// ─── Top bar (inside main content area) ──────────────────────────────────────

function TopBar({ page, lastRefreshed, isRefreshing, onRefreshAll }) {
  const PAGE_TITLES = {
    dashboard: 'Dashboard',
    agent: 'Agent',
    automation: 'Automation',
  };
  const PAGE_SUBS = {
    dashboard: 'Your NetSuite metrics at a glance',
    agent: 'Natural language NetSuite operations',
    automation: 'Scheduled agents and approvals',
  };

  const lastRefreshedStr = lastRefreshed
    ? new Date(lastRefreshed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '20px 28px 0', flexShrink: 0,
    }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--text-1)', margin: 0, lineHeight: 1.2 }}>
          {PAGE_TITLES[page]}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '3px 0 0', lineHeight: 1 }}>
          {PAGE_SUBS[page]}
        </p>
      </div>

      {page === 'dashboard' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastRefreshedStr && (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              Updated {lastRefreshedStr}
            </span>
          )}
          {isRefreshing && (
            <svg style={{ width: 14, height: 14, color: 'var(--blue)', animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
              <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          <button
            onClick={onRefreshAll}
            disabled={isRefreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 9,
              border: '1px solid var(--border)',
              background: 'var(--card-bg)', cursor: 'pointer',
              color: 'var(--text-2)', fontSize: 13, fontWeight: 600,
              transition: 'all 0.15s', opacity: isRefreshing ? 0.5 : 1,
            }}
          >
            <span style={{ width: 14, height: 14, display: 'flex' }}><IconRefresh /></span>
            Refresh All
          </button>
        </div>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const {
    loadWidgets, dashboardInfo, isLoading, isRefreshing,
    lastRefreshed, refreshAll, authStatus, checkAuth,
  } = useDashboardStore();

  const [showSettings, setShowSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [activePage, setActivePage] = useState(
    () => localStorage.getItem('active_page') || 'dashboard'
  );
  const [automationPendingCount, setAutomationPendingCount] = useState(0);
  const [theme, setTheme] = useState(
    () => localStorage.getItem('theme') || 'dark'
  );

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  // Poll for pending approvals badge
  const fetchCounts = useCallback(() => {
    fetch('/api/automation/notifications/unread-count')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setAutomationPendingCount(d.pending))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchCounts();
    const t = setInterval(fetchCounts, 30000);
    return () => clearInterval(t);
  }, [fetchCounts]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('auth_error');
    if (err) setAuthError(decodeURIComponent(err));
    if (params.get('connected') === 'true' || err) {
      window.history.replaceState({}, '', '/');
    }
    checkAuth().then(() => {
      const { authStatus } = useDashboardStore.getState();
      if (authStatus.connected) loadWidgets();
    });
  }, []);

  return (
    <>
      <SignedOut>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--page-bg)' }}>
          <SignIn routing="hash" />
        </div>
      </SignedOut>

      <SignedIn>
        {/* Add spin keyframe */}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--page-bg)' }}>
          {/* Sidebar */}
          <Sidebar
            activePage={activePage}
            setActivePage={setActivePage}
            onSettings={() => setShowSettings(true)}
            automationBadge={automationPendingCount}
            theme={theme}
            onToggleTheme={toggleTheme}
          />

          {/* Main content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <TopBar
              page={activePage}
              lastRefreshed={lastRefreshed}
              isRefreshing={isRefreshing}
              onRefreshAll={refreshAll}
            />

            {/* Page body */}
            {activePage === 'dashboard' ? (
              <>
                <main style={{ flex: 1, overflow: 'auto', padding: '16px 28px 0' }}>
                  {isLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--text-3)' }}>
                      <svg style={{ width: 20, height: 20, marginRight: 8, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
                        <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Loading dashboard…
                    </div>
                  ) : (
                    <DashboardGrid />
                  )}
                </main>
                <NaturalLanguageInput />
              </>
            ) : activePage === 'agent' ? (
              <main style={{ flex: 1, overflow: 'hidden' }}>
                <AgentPage />
              </main>
            ) : (
              <main style={{ flex: 1, overflow: 'hidden' }}>
                <AutomationPage onApprovalChange={fetchCounts} />
              </main>
            )}
          </div>
        </div>

        {/* Settings panel */}
        {(!authStatus.connected || showSettings) && (
          <SettingsPanel
            onClose={authStatus.connected ? () => setShowSettings(false) : null}
            initialError={authError}
          />
        )}
      </SignedIn>
    </>
  );
}
