import React, { useState, useEffect, useRef, useCallback } from 'react';
import HomePage from './pages/HomePage';
import RunPage  from './pages/RunPage';
import './App.css';

const FEATURE_ICONS = {
  login:             '🔐',
  signup:            '✍️',
  logout:            '🚪',
  forgotPassword:    '🔑',
  resetPassword:     '🔄',
  emailVerification: '📧',
  otpVerification:   '🔢',
  sessionManagement: '🕐',
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  1) return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function groupRunsByDate(runs) {
  const groups = [];
  const today     = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const thisWeek  = new Date(today); thisWeek.setDate(thisWeek.getDate() - 7);

  const buckets = { Today: [], Yesterday: [], 'This Week': [], Older: [] };

  for (const run of runs) {
    const d = new Date(run.created_at); d.setHours(0,0,0,0);
    if (d >= today)          buckets['Today'].push(run);
    else if (d >= yesterday) buckets['Yesterday'].push(run);
    else if (d >= thisWeek)  buckets['This Week'].push(run);
    else                     buckets['Older'].push(run);
  }

  for (const [label, items] of Object.entries(buckets)) {
    if (items.length > 0) groups.push({ label, items });
  }
  return groups;
}

function Sidebar({ page, navigate, activeRunId, refreshTrigger, sidebarOpen, setSidebarOpen }) {
  const [runs,    setRuns]    = useState([]);
  const [hoverId, setHoverId] = useState(null);
  const pollRef               = useRef(null);

  const fetchRuns = useCallback(() => {
    fetch('/api/tests/runs')
      .then(r => r.json())
      .then(setRuns)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchRuns();
    pollRef.current = setInterval(fetchRuns, 5000);
    return () => clearInterval(pollRef.current);
  }, [page, fetchRuns]);

  useEffect(() => {
    if (refreshTrigger) fetchRuns();
  }, [refreshTrigger, fetchRuns]);

  const handleRunClick = (id) => {
    navigate('run', id);
    setSidebarOpen(false);
  };

  const groups = groupRunsByDate(runs);

  return (
    <>
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-top">
          <div className="sidebar-logo" onClick={() => { navigate('home'); setSidebarOpen(false); }}>
            <span className="logo-icon">AQ</span>
            <span className="logo-text">AuthQA</span>
          </div>
          <button className="new-test-btn" onClick={() => { navigate('home'); setSidebarOpen(false); }}>
            <span className="new-test-icon">+</span>
            New Test Run
          </button>
        </div>

        <nav className="sidebar-history">
          {runs.length === 0 && (
            <div className="sidebar-empty">No runs yet. Start a test to see results here.</div>
          )}

          {groups.map(({ label, items }) => (
            <div key={label} className="sidebar-group">
              <div className="sidebar-group-label">{label}</div>

              {items.map(run => {
                const isActive  = activeRunId === run.id;
                const isRunning = !['completed', 'failed', 'error'].includes(run.status);
                const isHovered = hoverId === run.id;

                const domain = (() => {
                  try {
                    const u = new URL(run.url);
                    return u.hostname.replace(/^www\./, '');
                  } catch { return run.url; }
                })();
                const path        = (() => { try { return new URL(run.url).pathname; } catch { return ''; } })();
                const featureKey  = run.feature ?? 'login';
                const featureIcon = FEATURE_ICONS[featureKey] ?? '🔐';
                const passRate    = run.total_tests > 0
                  ? Math.round((run.passed / run.total_tests) * 100)
                  : null;

                return (
                  <button
                    key={run.id}
                    className={`sidebar-run-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleRunClick(run.id)}
                    onMouseEnter={() => setHoverId(run.id)}
                    onMouseLeave={() => setHoverId(null)}
                    title={`${featureKey} — ${run.url}`}
                  >
                    <span className={`sidebar-run-dot ${run.status}`} />

                    <div className="sidebar-run-body">
                      <div className="sidebar-run-top">
                        <span className="sidebar-run-domain">{domain}</span>
                        {path && path !== '/' && (
                          <span className="sidebar-run-path">{path}</span>
                        )}
                      </div>
                      <div className="sidebar-run-bottom">
                        <span className="sidebar-run-feature-tag">
                          {featureIcon} {featureKey.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                        {isRunning
                          ? <span className="sidebar-run-spinner" />
                          : passRate !== null
                          ? <span className={`sidebar-run-rate ${passRate === 100 ? 'green' : passRate >= 50 ? 'yellow' : 'red'}`}>
                              {passRate}%
                            </span>
                          : null
                        }
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

export default function App() {
  const [page,           setPage]           = useState('home');
  const [activeRunId,    setActiveRunId]    = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [sidebarOpen,    setSidebarOpen]    = useState(false);

  const navigate = (p, runId = null) => {
    setPage(p);
    if (runId) setActiveRunId(runId);
  };

  const handleRunStarted = (id) => {
    navigate('run', id);
    setRefreshTrigger(t => t + 1);
  };

  const handleRetry = async (url, feature, credentials = {}) => {
    try {
      const res  = await fetch('/api/tests/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url, feature, ...credentials }),
      });
      const data = await res.json();
      if (res.ok) {
        navigate('run', data.runId);
        setRefreshTrigger(t => t + 1);
      }
    } catch (_) {}
  };

  // Update document title based on current page
  useEffect(() => {
    document.title = page === 'home' ? 'AuthQA — Authentication Testing' : 'AuthQA — Test Run';
  }, [page]);

  return (
    <div className="app-shell">
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(o => !o)}
        aria-label="Toggle sidebar"
      >☰</button>

      <Sidebar
        page={page}
        navigate={navigate}
        activeRunId={activeRunId}
        refreshTrigger={refreshTrigger}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />

      <main className="app-main">
        {page === 'home' && <HomePage onRunStarted={handleRunStarted} />}
        {page === 'run'  && (
          <RunPage
            runId={activeRunId}
            onBack={() => navigate('home')}
            onRetry={handleRetry}
          />
        )}
      </main>
    </div>
  );
}