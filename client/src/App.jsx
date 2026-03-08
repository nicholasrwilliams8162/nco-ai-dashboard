import { useEffect, useState } from 'react';
import { SignIn, SignedIn, SignedOut, UserButton } from '@clerk/clerk-react';
import { useDashboardStore } from './store/dashboardStore';
import { DashboardGrid } from './components/Dashboard/DashboardGrid';
import { NaturalLanguageInput } from './components/QueryBar/NaturalLanguageInput';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { AgentPage } from './pages/AgentPage';
import { AutomationPage } from './pages/AutomationPage';

export default function App() {
  const {
    loadWidgets, dashboardInfo, isLoading, isRefreshing,
    lastRefreshed, renameDashboard, refreshAll,
    authStatus, checkAuth,
  } = useDashboardStore();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameEdit, setNameEdit] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [activePage, setActivePage] = useState(() => localStorage.getItem('active_page') || 'dashboard');
  const [automationPendingCount, setAutomationPendingCount] = useState(0);

  // Poll for pending approvals badge
  useEffect(() => {
    const fetchCounts = () => {
      fetch('/api/automation/notifications/unread-count')
        .then(r => r.ok ? r.json() : null)
        .then(d => d && setAutomationPendingCount(d.pending))
        .catch(() => {});
    };
    fetchCounts();
    const t = setInterval(fetchCounts, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('auth_error');
    if (err) setAuthError(decodeURIComponent(err));
    if (params.get('connected') === 'true' || err) {
      window.history.replaceState({}, '', '/');
    }

    checkAuth().then(() => {
      const { authStatus } = useDashboardStore.getState();
      if (authStatus.connected) {
        loadWidgets();
      }
    });
  }, []);

  const handleRenameDashboard = async () => {
    if (nameEdit.trim()) await renameDashboard(nameEdit.trim());
    setIsEditingName(false);
  };

  const lastRefreshedStr = lastRefreshed
    ? new Date(lastRefreshed).toLocaleTimeString()
    : null;

  return (
    <>
      <SignedOut>
        <div className="flex items-center justify-center h-screen bg-gray-900">
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
    <div className="flex flex-col h-screen bg-gray-900 text-white overflow-hidden">
      {/* Navbar — min-height 52px on mobile (safe touch area), 56px on desktop */}
      <header className="flex items-center justify-between px-3 sm:px-6 border-b border-gray-700 flex-shrink-0 min-h-[52px] sm:min-h-[56px]">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 py-2">
          {/* Logo mark */}
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>

          {isEditingName ? (
            <input
              className="bg-gray-700 text-white font-semibold rounded px-2 py-1 outline-none min-w-0 w-40 text-base"
              value={nameEdit}
              onChange={e => setNameEdit(e.target.value)}
              onBlur={handleRenameDashboard}
              onKeyDown={e => e.key === 'Enter' && handleRenameDashboard()}
              autoFocus
            />
          ) : (
            <h1
              className="font-semibold text-white cursor-pointer hover:text-blue-400 transition-colors truncate text-base leading-tight"
              onDoubleClick={() => { setNameEdit(dashboardInfo.name); setIsEditingName(true); }}
              title="Double-click to rename"
            >
              {dashboardInfo.name}
            </h1>
          )}
        </div>

        {/* Page nav */}
        <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg p-1 flex-shrink-0">
          {[
            { id: 'dashboard',  label: 'Dashboard' },
            { id: 'agent',      label: 'Agent' },
            { id: 'automation', label: 'Automation', badge: automationPendingCount },
          ].map(({ id, label, badge }) => (
            <button
              key={id}
              onClick={() => { setActivePage(id); localStorage.setItem('active_page', id); }}
              className={`relative px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                activePage === id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {label}
              {badge > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center leading-none">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 sm:gap-2 text-sm text-gray-400 flex-shrink-0 py-2">
          {lastRefreshedStr && (
            <span className="hidden md:block text-xs text-gray-500 mr-1">Updated {lastRefreshedStr}</span>
          )}
          {isRefreshing && (
            <svg className="animate-spin w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}

          {/* Refresh All — dashboard page only */}
          <button
            onClick={refreshAll}
            disabled={isRefreshing}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg transition-colors disabled:opacity-50 text-gray-300 min-h-[36px] sm:min-h-[34px] ${activePage !== 'dashboard' ? 'hidden' : ''}`}
            title="Refresh all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline text-sm">Refresh All</span>
          </button>

          {/* Settings gear — 44px touch target */}
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
            className="flex items-center justify-center w-9 h-9 text-gray-400 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-500 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* User avatar / sign out */}
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>

      {/* Page content */}
      {activePage === 'dashboard' ? (
        <>
          <main className="flex-1 overflow-auto px-3 sm:px-6 py-3 sm:py-4">
            {isLoading ? (
              <div className="flex items-center justify-center h-64 text-gray-500">
                <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
        <main className="flex-1 overflow-hidden">
          <AgentPage />
        </main>
      ) : (
        <main className="flex-1 overflow-hidden">
          <AutomationPage />
        </main>
      )}

      {/* Settings panel */}
      {(!authStatus.connected || showSettings) && (
        <SettingsPanel
          onClose={authStatus.connected ? () => setShowSettings(false) : null}
          initialError={authError}
        />
      )}
    </div>
      </SignedIn>
    </>
  );
}
