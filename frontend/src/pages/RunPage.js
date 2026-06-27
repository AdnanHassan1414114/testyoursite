import { apiUrl } from '../apiConfig';
import React, { useState, useEffect, useRef } from 'react';
import './RunPage.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  pending: 'Pending', detecting: 'Detecting page',
  generating: 'Generating tests', running: 'Running',
  completed: 'Completed', failed: 'Failed', error: 'Error',
};

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

// ── Pure helpers ──────────────────────────────────────────────────────────────

function safePathname(url) {
  try { return new URL(url).pathname; } catch { return url ?? '—'; }
}

function parseJson(val) {
  if (!val) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

function fmtMs(ms) {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function deriveTag(r) {
  const n = (r.test_name || '').toLowerCase();
  if (n.includes('sql') || n.includes('injection') || n.includes('xss')) return 'SEC';
  if (n.includes('long') || n.includes('unicode') || n.includes('boundary')) return 'EDGE';
  if (n.includes('empty') || n.includes('blank')) return 'VAL';
  return null;
}

// ── Atoms ─────────────────────────────────────────────────────────────────────

function Badge({ status, severity }) {
  // severity (from test_results.severity) reflects BOTH Playwright's outcome
  // AND API findings. A 'passed' test with warning/error findings should not
  // show a plain green PASS — that's the exact bug where "Valid Login" showed
  // PASS next to 4 warnings about a missing auth token.
  if (status === 'passed' && severity === 'warning') {
    return <span className="rp-badge rp-badge--warning">△ PASS WITH ISSUES</span>;
  }
  if (status === 'passed' && severity === 'error') {
    return <span className="rp-badge rp-badge--failed">✗ FAIL</span>;
  }
  return (
    <span className={`rp-badge rp-badge--${status}`}>
      {status === 'passed' ? '✓ PASS' : '✗ FAIL'}
    </span>
  );
}

function Chip({ severity }) {
  return <span className={`rp-chip rp-chip--${severity}`}>{severity}</span>;
}

function Method({ m }) {
  return <span className={`rp-method rp-method--${(m||'').toLowerCase()}`}>{m}</span>;
}

function Code({ n }) {
  if (!n) return <span className="rp-code rp-code--null">—</span>;
  const t = n >= 500 ? '5' : n >= 400 ? '4' : n >= 300 ? '3' : '2';
  return <span className={`rp-code rp-code--${t}xx`}>{n}</span>;
}

// ── Skeleton row (shown while tests run before data arrives) ──────────────────

function SkeletonRow() {
  return (
    <div className="rp-skeleton-row">
      <div className="rp-skeleton rp-sk-name" />
      <div className="rp-skeleton rp-sk-svc" />
      <div className="rp-skeleton rp-sk-badge" />
    </div>
  );
}

// ── Live progress bar ─────────────────────────────────────────────────────────

function ProgressBar({ done, total, status }) {
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="rp-progress-wrap">
      <div className="rp-progress-bar">
        <div
          className={`rp-progress-fill ${status === 'error' ? 'rp-pf--error' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="rp-progress-label">{done}/{total}</span>
    </div>
  );
}

// ── ApiCard ───────────────────────────────────────────────────────────────────

function ApiCard({ req, findings, onCopy, copied }) {
  const [open, setOpen] = useState(false);
  const path = req.pathname ?? safePathname(req.url);
  const rf = findings.filter(f => f.api_request_id === req.id);

  return (
    <div className={`rp-api-card ${req.is_auth_related ? 'rp-api-card--auth' : ''}`}>
      <div className="rp-api-row" onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <Method m={req.method} />
        <span className="rp-api-path">{path}</span>
        {req.is_auth_related && <span className="rp-auth-pill">AUTH</span>}
        {req.auth_label && <span className="rp-label-pill">{req.auth_label}</span>}
        <div className="rp-api-right">
          <Code n={req.response_status} />
          {req.response_time_ms != null && (
            <span className={`rp-timing ${req.response_time_ms > 3000 ? 'rp-timing--slow' : ''}`}>
              {req.response_time_ms}ms
            </span>
          )}
          {rf.length > 0 && <span className="rp-issue-pill">{rf.length} issue{rf.length > 1 ? 's' : ''}</span>}
          <span className="rp-chevron">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div className="rp-api-body">
          {rf.length > 0 && (
            <div className="rp-api-section">
              <div className="rp-api-section-title">Findings</div>
              {rf.map((f, i) => (
                <div key={i} className={`rp-finding-inline rp-finding-inline--${f.severity}`}>
                  <Chip severity={f.severity} />
                  <span>{f.message}</span>
                </div>
              ))}
            </div>
          )}
          {req.request_payload && (
            <div className="rp-api-section">
              <div className="rp-api-section-title" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                Request
                <button className="rp-copy-btn" onClick={() => onCopy?.(JSON.stringify(parseJson(req.request_payload), null, 2), `req-${req.id}`)}>
                  {copied === `req-${req.id}` ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <pre className="rp-json">{JSON.stringify(parseJson(req.request_payload), null, 2)}</pre>
            </div>
          )}
          {req.response_payload && (
            <div className="rp-api-section">
              <div className="rp-api-section-title" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                Response
                <button className="rp-copy-btn" onClick={() => onCopy?.(JSON.stringify(parseJson(req.response_payload), null, 2), `resp-${req.id}`)}>
                  {copied === `resp-${req.id}` ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <pre className="rp-json">{JSON.stringify(parseJson(req.response_payload), null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── FindingCard ───────────────────────────────────────────────────────────────

function FindingCard({ finding: f }) {
  const [open, setOpen] = useState(false);
  const detail = parseJson(f.detail) ?? {};

  return (
    <div className={`rp-finding-card rp-finding-card--${f.severity}`}>
      <div className="rp-finding-top" onClick={() => setOpen(!open)}>
        <Chip severity={f.severity} />
        <span className="rp-finding-cat">{(f.category || '').replace(/_/g, ' ')}</span>
        <span className="rp-finding-msg">{f.message}</span>
        <span className="rp-chevron">{open ? '▲' : '▼'}</span>
      </div>

      {/* Expected vs actual evidence row */}
      {(detail.expected || detail.responseTimeMs) && (
        <div className="rp-ev-row">
          {detail.expected && (
            <>
              <span className="rp-ev-label">Expected</span>
              <span className="rp-ev-val">{detail.expected.join(' / ')}</span>
              <span className="rp-ev-sep">→</span>
              <span className={`rp-ev-actual ${detail.expected.includes(detail.status) ? 'ok' : 'bad'}`}>
                Got {detail.status ?? '—'}
              </span>
            </>
          )}
          {detail.responseTimeMs && (
            <>
              <span className="rp-ev-label">Timing</span>
              <span className="rp-ev-val">&gt;3000ms threshold</span>
              <span className="rp-ev-sep">→</span>
              <span className="rp-ev-actual bad">Got {detail.responseTimeMs}ms</span>
            </>
          )}
        </div>
      )}

      {open && (
        <div className="rp-finding-body">
          {f.explain && <p className="rp-finding-explain">{f.explain}</p>}
          {detail.hint && (
            <div className="rp-hint">
              <span>💡</span> {detail.hint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── RootCauseBlock ────────────────────────────────────────────────────────────

function RootCauseBlock({ rc, compact = false }) {
  if (!rc) return null;
  const rootCause    = rc.root_cause    ?? rc.rootCause    ?? '';
  const suggestedFix = rc.suggested_fix ?? rc.suggestedFix ?? '';
  const source       = rc.analysis_source ?? rc.analysisSource ?? 'fallback';
  const confidence   = rc.confidence ?? 0;
  const impact       = rc.impact ?? '';
  const isAI  = source !== 'fallback';
  const pct   = Math.min(100, Math.max(0, confidence));
  const color = pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)';

  return (
    <div className={`rp-rc ${compact ? 'rp-rc--compact' : ''}`}>
      <div className="rp-rc-head">
        <span className={`rp-rc-source ${isAI ? 'rp-rc-source--ai' : 'rp-rc-source--rule'}`}>
          {isAI ? '✦ AI' : '⚙ Rule'}
        </span>
        <div className="rp-rc-meter">
          <div className="rp-rc-bar">
            <div className="rp-rc-fill" style={{ width: `${pct}%`, background: color }} />
          </div>
          <span className="rp-rc-pct" style={{ color }}>{pct}%</span>
        </div>
      </div>
      <div className="rp-rc-body">
        <div className="rp-rc-row">
          <span className="rp-rc-label">Cause</span>
          <span className="rp-rc-val rp-rc-val--cause">{rootCause}</span>
        </div>
        <div className="rp-rc-row">
          <span className="rp-rc-label">Impact</span>
          <span className="rp-rc-val">{impact}</span>
        </div>
        <div className="rp-rc-row rp-rc-row--fix">
          <span className="rp-rc-label">Fix</span>
          <span className="rp-rc-val rp-rc-val--fix">{suggestedFix}</span>
        </div>
      </div>
    </div>
  );
}

// ── CorrelationCard ───────────────────────────────────────────────────────────

function CorrCard({ corr }) {
  const cls = corr.type === 'ui_and_api_failed'   ? 'rp-corr--linked' :
              corr.type === 'ui_passed_api_errors' ? 'rp-corr--silent' : 'rp-corr--unlinked';
  const tag = corr.type === 'ui_and_api_failed'   ? 'API caused' :
              corr.type === 'ui_passed_api_errors' ? 'Silent' : 'Frontend';

  return (
    <div className={`rp-corr ${cls}`}>
      <div className="rp-corr-head">
        <Badge status={corr.uiStatus} />
        <span className="rp-corr-name">{corr.uiTestName}</span>
        <span className="rp-corr-tag">{tag}</span>
      </div>
      {corr.uiError && <div className="rp-corr-err">{corr.uiError}</div>}
      {corr.note && <div className="rp-corr-note">{corr.note}</div>}
      {corr.relatedApis?.map((a, i) => (
        <div key={i} className="rp-corr-api">
          <span className="rp-corr-arrow">↳</span>
          <Method m={a.method} />
          <span className="rp-corr-apipath">{a.pathname}</span>
          <Code n={a.status} />
          {a.responseTimeMs != null && <span className="rp-timing">{a.responseTimeMs}ms</span>}
        </div>
      ))}
      {corr.apiFindings?.map((f, i) => (
        <div key={i} className="rp-corr-finding">
          <span className="rp-corr-arrow">↳</span>
          <Chip severity={f.severity} />
          <span className="rp-corr-fmsg">{f.message}</span>
        </div>
      ))}
    </div>
  );
}

// ── FullReport ────────────────────────────────────────────────────────────────

function FullReport({ runId }) {
  const [d, setD]   = useState(null);
  const [err, setE] = useState(null);

  useEffect(() => {
    fetch(apiUrl(`/api/reports/${runId}`))
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setD).catch(e => setE(e.message));
  }, [runId]);

  if (!d && !err) return (
    <div className="rp-report-loading">
      <div className="rp-spinner" />
      Building report…
    </div>
  );
  if (err) return <div className="rp-empty">Could not load report: {err}</div>;

  const {
    summary, uiFindings = [], apiEndpointFindings = [],
    correlations = [], failures = [],
  } = d;

  const linkedCorrs   = correlations.filter(c => c.type === 'ui_and_api_failed');
  const silentCorrs   = correlations.filter(c => c.type === 'ui_passed_api_errors');
  const unlinkedCorrs = correlations.filter(c => c.type === 'ui_failed_no_api_signal');

  return (
    <div className="rp-report">

      <div className="rp-report-header">
        <div className="rp-report-header-left">
          <div className="rp-report-title">
            {((summary.feature || 'login')
              .replace(/([A-Z])/g, ' $1')
              .trim()
              .toUpperCase())} QA REPORT
          </div>
          <div className="rp-report-url">{summary.url}</div>
          <div className="rp-report-meta">
            {summary.completedAt && new Date(summary.completedAt).toLocaleString()}
            {summary.durationMs && ` · ${fmtMs(summary.durationMs)}`}
          </div>
        </div>
        <div className="rp-report-header-right">
          <button
            className="rp-export-btn"
            onClick={() => {
              const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
              const url  = URL.createObjectURL(blob);
              const a    = document.createElement('a');
              a.href     = url;
              a.download = `authqa-report-${runId}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            ↓ Export JSON
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="rp-report-stats">
        {[
          { v: summary.totalTests, l: 'Tests', c: '' },
          { v: summary.passed,     l: 'Passed', c: 'green' },
          { v: summary.failed,     l: 'Failed', c: summary.failed > 0 ? 'red' : '' },
          { v: `${summary.passRate ?? 0}%`, l: 'Pass Rate', c: 'accent' },
          { v: summary.authApiCount  ?? 0, l: 'Auth Calls',  c: 'blue' },
          { v: summary.apiErrorCount ?? 0, l: 'API Errors',  c: summary.apiErrorCount > 0 ? 'red' : 'green' },
          { v: summary.apiWarnCount  ?? 0, l: 'API Warnings', c: summary.apiWarnCount > 0 ? 'yellow' : '' },
        ].map((s, i) => (
          <div key={i} className="rp-report-stat">
            <div className={`rp-report-stat-num ${s.c}`}>{s.v}</div>
            <div className="rp-report-stat-label">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="rp-report-summary-text">{summary.summaryText}</div>

      {/* UI Findings */}
      <div className="rp-report-section">
        <div className="rp-report-section-title">UI Findings</div>
        {uiFindings.map((f, i) => (
          <div key={i} className="rp-report-ui-row">
            <span className={`rp-report-icon ${f.status}`}>{f.status === 'passed' ? '✓' : '✗'}</span>
            <span className="rp-report-test-name">{f.testName}</span>
            {f.durationMs && <span className="rp-report-dur">{fmtMs(f.durationMs)}</span>}
            {f.errorMessage && <span className="rp-report-err">{f.errorMessage}</span>}
          </div>
        ))}
      </div>

      {/* API Findings */}
      {apiEndpointFindings.length > 0 && (
        <div className="rp-report-section">
          <div className="rp-report-section-title">API Findings</div>
          {apiEndpointFindings.map((ep, i) => (
            <div key={i} className="rp-report-api-block">
              <div className="rp-report-ep-head">
                {ep.method && <Method m={ep.method} />}
                <span className="rp-report-ep-path">{ep.pathname}</span>
                {ep.requests[ep.requests.length - 1] && (
                  <Code n={ep.requests[ep.requests.length - 1].status} />
                )}
              </div>
              {ep.findings.length === 0
                ? <div className="rp-report-ok">✓ No issues</div>
                : ep.findings.map((f, fi) => (
                  <div key={fi} className="rp-report-finding">
                    <Chip severity={f.severity} />
                    <div>
                      <div className="rp-report-finding-msg">{f.message}</div>
                      {f.explain && <div className="rp-report-finding-explain">{f.explain}</div>}
                    </div>
                  </div>
                ))
              }
            </div>
          ))}
        </div>
      )}

      {/* Correlation */}
      {[...linkedCorrs, ...silentCorrs, ...unlinkedCorrs].length > 0 && (
        <div className="rp-report-section">
          <div className="rp-report-section-title">Correlation — UI ↔ API</div>
          {linkedCorrs.length > 0 && (
            <div className="rp-report-corr-group rp-report-corr-group--error">
              ● API-caused failures ({linkedCorrs.length})
            </div>
          )}
          {linkedCorrs.map((c, i) => <CorrCard key={i} corr={c} />)}
          {silentCorrs.length > 0 && (
            <div className="rp-report-corr-group rp-report-corr-group--warn">
              ⚠ Silent failures ({silentCorrs.length})
            </div>
          )}
          {silentCorrs.map((c, i) => <CorrCard key={i} corr={c} />)}
          {unlinkedCorrs.length > 0 && (
            <div className="rp-report-corr-group rp-report-corr-group--info">
              ○ Frontend failures ({unlinkedCorrs.length})
            </div>
          )}
          {unlinkedCorrs.map((c, i) => <CorrCard key={i} corr={c} />)}
        </div>
      )}

      {/* AI Root Cause */}
      {failures.filter(f => f.rootCause).length > 0 && (
        <div className="rp-report-section">
          <div className="rp-report-section-title">
            AI Root Cause Analysis
            {summary.aiAnalysisCount > 0 && (
              <span className="rp-report-ai-badge">{summary.aiAnalysisCount} analysed</span>
            )}
          </div>
          {failures.filter(f => f.rootCause).map((f, i) => (
            <div key={i} className="rp-report-rc-entry">
              <div className="rp-report-rc-head">
                <span className="rp-icon-fail">✗</span>
                <span className="rp-report-rc-name">{f.test_name}</span>
                {f.error_message && <span className="rp-report-rc-err">{f.error_message}</span>}
              </div>
              {f.topApi && (
                <div className="rp-report-rc-api">
                  <span className="rp-corr-arrow">↳ API</span>
                  <Method m={f.topApi.method} />
                  <span className="rp-report-ep-path">{f.topApi.pathname}</span>
                  <Code n={f.topApi.responseStatus} />
                </div>
              )}
              <RootCauseBlock rc={f.rootCause} />
            </div>
          ))}
        </div>
      )}

      <div className="rp-report-footer">
        <span className="rp-report-footer-text">{summary.summaryText}</span>
        {summary.backendIssueCount > 0 && (
          <span className="rp-report-footer-warn">
            · {summary.backendIssueCount} likely backend issue{summary.backendIssueCount > 1 ? 's' : ''} found
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main RunPage ──────────────────────────────────────────────────────────────

export default function RunPage({ runId, onBack, onRetry }) {
  const [data, setData]     = useState(null);
  const [tab, setTab]       = useState('ui');
  const [open, setOpen]     = useState(null); // expanded result id
  const [filter, setFilter] = useState('all');  // 'all' | 'passed' | 'failed'
  const [copied, setCopied] = useState(null);   // key of copied item
  const [fetchErr, setErr]  = useState(null);
  const [showThirdParty, setShowThirdParty] = useState(new Set()); // test ids with third-party calls expanded
  const pollRef = useRef(null);
  const retries  = useRef(0);
  const copyRef  = useRef(null);

  const copyToClipboard = (text, key) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      clearTimeout(copyRef.current);
      copyRef.current = setTimeout(() => setCopied(null), 1800);
    }).catch(() => {});
  };

  const toggleThirdParty = (testId) => {
    setShowThirdParty(prev => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId); else next.add(testId);
      return next;
    });
  };

  // ── Polling — start immediately, show skeleton while waiting ─────────────
  // ── Document title ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!data) { document.title = 'AuthQA — Loading…'; return; }
    const domain = (() => { try { return new URL(data.run?.url || '').hostname; } catch { return 'run'; } })();
    const status = data.run?.status ?? '';
    document.title = `AuthQA — ${status === 'completed' ? '✓' : status === 'error' ? '✗' : '⏳'} ${domain}`;
  }, [data]);

  useEffect(() => {
    // Reset all state when switching runs
    setData(null);
    setErr(null);
    setTab('ui');
    setOpen(null);
    setFilter('all');
    retries.current = 0;

    const poll = async () => {
      try {
        const r = await fetch(apiUrl(`/api/tests/run/${runId}`));
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setErr(j.error || `Server ${r.status}`);
          return;
        }
        const json = await r.json();
        setErr(null);
        setData(json);
        if (!['completed', 'failed', 'error'].includes(json.run?.status)) {
          pollRef.current = setTimeout(poll, 1800);
        }
      } catch (e) {
        retries.current++;
        setErr(`Cannot reach backend (${e.message})`);
        if (retries.current < 10) pollRef.current = setTimeout(poll, 2500);
      }
    };
    poll();
    return () => clearTimeout(pollRef.current);
  }, [runId]);

  // ── Hard error before first data ─────────────────────────────────────────
  if (fetchErr && !data) return (
    <div className="rp-error-state">
      <div className="rp-error-icon">!</div>
      <div className="rp-error-title">Connection Error</div>
      <div className="rp-error-body">{fetchErr}</div>
      <button className="rp-back-btn" onClick={onBack}>← Back</button>
    </div>
  );

  // ── Instant skeleton before first response ────────────────────────────────
  if (!data) return (
    <div className="run-page">
      <div className="rp-header">
        <button className="rp-back-btn" onClick={onBack}>← Back</button>
        <div className="rp-header-info">
          <div className="rp-skeleton rp-sk-url" />
          <div className="rp-skeleton rp-sk-status" />
        </div>
      </div>
      <div className="rp-stat-strip rp-stat-strip--loading">
        <div className="rp-stat-group">
          <div className="rp-stat-group-label">Run Summary</div>
          <div className="rp-stat-group-cards">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rp-stat-card">
                <div className="rp-skeleton rp-sk-num" />
                <div className="rp-skeleton rp-sk-lbl" />
              </div>
            ))}
          </div>
        </div>
        <div className="rp-stat-divider" />
        <div className="rp-stat-group">
          <div className="rp-stat-group-label">API Coverage</div>
          <div className="rp-stat-group-cards">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rp-stat-card">
                <div className="rp-skeleton rp-sk-num" />
                <div className="rp-skeleton rp-sk-lbl" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="rp-skeleton-list">
        {[...Array(6)].map((_, i) => <SkeletonRow key={i} />)}
      </div>
    </div>
  );

  const { run, results = [], apiRequests = [], apiFindings = [], rootCauses = [] } = data;
  const isRunning  = !['completed', 'failed', 'error'].includes(run.status);
  const passRate   = run.total_tests > 0 ? Math.round((run.passed / run.total_tests) * 100) : 0;
  const authApis   = apiRequests.filter(r => r.is_auth_related);
  const errFinds   = apiFindings.filter(f => f.severity === 'error');
  const warnFinds  = apiFindings.filter(f => f.severity === 'warning');
  const rcMap      = new Map(rootCauses.map(rc => [rc.test_result_id, rc]));
  const failedWithApi = results.filter(r =>
    r.status === 'failed' &&
    apiFindings.some(f => f.test_result_id === r.id && (f.severity === 'error' || f.severity === 'warning'))
  ).length;

  return (
    <div className="run-page">

      {/* ── Header ── */}
      <div className="rp-header">
        <button className="rp-back-btn" onClick={onBack}>
          <span className="rp-back-arrow">←</span> Back
        </button>

        <div className="rp-header-url-block">
          <span className="rp-header-domain">
            {(() => { try { return new URL(run.url).hostname; } catch { return run.url; } })()}
          </span>
          <span className="rp-header-path">
            {(() => { try { return new URL(run.url).pathname; } catch { return ''; } })()}
          </span>
        </div>

        <span className="rp-run-feature">
          {FEATURE_ICONS[run.feature] ?? '🔐'}{' '}
          {(run.feature || 'login')
            .replace(/([A-Z])/g, ' $1')
            .trim()
            .replace(/^\w/, c => c.toUpperCase())}
        </span>

        <span className={`rp-run-status rp-run-status--${run.status}`}>
          {isRunning && <span className="rp-spin">↻</span>}
          {STATUS_LABELS[run.status]}
        </span>

        <div className="rp-header-meta">
          {run.completed_at && (
            <span className="rp-header-time">
              {new Date(run.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {run.completed_at && run.created_at && (
            <span className="rp-header-duration">
              {fmtMs(new Date(run.completed_at) - new Date(run.created_at))}
            </span>
          )}
        </div>

        {isRunning && (
          <ProgressBar done={results.length} total={run.total_tests} status={run.status} />
        )}

        {onRetry && !isRunning && (
          <button className="rp-rerun-btn" onClick={() => onRetry(run.url, run.feature, { testEmail: run.test_email ?? undefined })}>
            ↺ Re-run
          </button>
        )}
      </div>

      {/* ── Stat strip — always visible ── */}
      <div className="rp-stat-strip">

        {/* ── Run metrics group ── */}
        <div className="rp-stat-group">
          <div className="rp-stat-group-label">Run Summary</div>
          <div className="rp-stat-group-cards">
            <div className="rp-stat-card rp-stat-card--wide">
              <div className={`rp-stat-big ${passRate === 100 ? 'green' : passRate >= 50 ? 'yellow' : 'red'}`}>
                {passRate}<span className="rp-stat-pct">%</span>
              </div>
              <div className="rp-stat-label">Pass Rate</div>
            </div>
            <div className="rp-stat-card">
              <div className="rp-stat-big">{run.total_tests || 0}</div>
              <div className="rp-stat-label">Tests</div>
            </div>
            <div className="rp-stat-card">
              <div className={`rp-stat-big ${(run.passed||0) > 0 ? 'green' : ''}`}>{run.passed || 0}</div>
              <div className="rp-stat-label">Passed</div>
            </div>
            <div className="rp-stat-card">
              <div className={`rp-stat-big ${(run.failed||0) > 0 ? 'red' : 'green'}`}>{run.failed || 0}</div>
              <div className="rp-stat-label">Failed</div>
            </div>
          </div>
        </div>

        <div className="rp-stat-divider" />

        {/* ── API metrics group ── */}
        <div className="rp-stat-group">
          <div className="rp-stat-group-label">API Coverage</div>
          <div className="rp-stat-group-cards">
            <div className="rp-stat-card">
              <div className="rp-stat-big blue">{authApis.length}</div>
              <div className="rp-stat-label">APIs Hit</div>
            </div>
            <div className="rp-stat-card">
              <div className={`rp-stat-big ${errFinds.length > 0 ? 'red' : 'green'}`}>{errFinds.length}</div>
              <div className="rp-stat-label">API Errors</div>
            </div>
            <div className="rp-stat-card">
              <div className={`rp-stat-big ${warnFinds.length > 0 ? 'yellow' : 'green'}`}>{warnFinds.length}</div>
              <div className="rp-stat-label">Warnings</div>
            </div>
          </div>
        </div>

      </div>

      {/* ── Running banner ── */}
      {isRunning && (
        <div className="rp-running-bar">
          <span className="rp-pulse" />
          {STATUS_LABELS[run.status]}…
          {results.length > 0 && (
            <span className="rp-running-count">{results.length}/{run.total_tests} done</span>
          )}
        </div>
      )}

      {run.status === 'error' && (
        <div className="rp-error-bar">
          <span className="rp-error-bar-icon">!</span>
          Run encountered an error.
          {results.length > 0 ? ` ${results.length} test(s) completed before failure.` : ' Check backend logs.'}
        </div>
      )}

      {/* ── Tabs ── */}
      {(results.length > 0 || run.status !== 'pending') && (
        <div className="rp-tabs">
          {[
            {
              id:    'ui',
              label: 'Tests',
              icon:  '▣',
              count: results.length,
              red:   false,
            },
            {
              id:    'api',
              label: 'API',
              icon:  '⇄',
              count: authApis.length,
              red:   false,
            },
            {
              id:    'findings',
              label: 'Issues',
              icon:  '⚑',
              count: apiFindings.length,
              red:   errFinds.length > 0,
              warn:  errFinds.length === 0 && warnFinds.length > 0,
            },
            {
              id:    'correlation',
              label: 'Correlation',
              icon:  '⬡',
              count: failedWithApi,
              red:   failedWithApi > 0,
            },
            {
              id:    'report',
              label: 'Report',
              icon:  '≡',
              count: rootCauses.length,
              red:   false,
            },
          ].map(t => (
            <button
              key={t.id}
              className={`rp-tab ${tab === t.id ? 'rp-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="rp-tab-icon">{t.icon}</span>
              {t.label}
              {t.count != null && (
                <span className={`rp-tab-count ${t.red ? 'rp-tab-count--red' : t.warn ? 'rp-tab-count--warn' : ''}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ════ Tab: Tests ════ */}
      {tab === 'ui' && (
        <div className="rp-test-list">
          {results.length === 0 && isRunning && (
            [...Array(Math.max(run.total_tests || 4, 4))].map((_, i) => <SkeletonRow key={i} />)
          )}

          {results.length > 0 && (
            <div className="rp-filter-bar">
              <div className="rp-filter-btns">
                {[
                  { key: 'all',    label: 'All',    count: results.length,                                        icon: null },
                  { key: 'passed', label: 'Passed', count: results.filter(r => r.status === 'passed').length, icon: '✓' },
                  { key: 'failed', label: 'Failed', count: results.filter(r => r.status === 'failed').length, icon: '✗' },
                ].map(f => (
                  <button
                    key={f.key}
                    className={`rp-filter-btn rp-filter-btn--${f.key} ${filter === f.key ? 'rp-filter-btn--active' : ''}`}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.icon && <span className="rp-filter-icon">{f.icon}</span>}
                    {f.label}
                    <span className="rp-filter-count">{f.count}</span>
                  </button>
                ))}
              </div>
              <div className="rp-filter-summary">
                {filter === 'all'
                  ? `Showing all ${results.length} test${results.length !== 1 ? 's' : ''}`
                  : filter === 'passed'
                  ? `${results.filter(r => r.status === 'passed').length} test${results.filter(r => r.status === 'passed').length !== 1 ? 's' : ''} passed`
                  : `${results.filter(r => r.status === 'failed').length} test${results.filter(r => r.status === 'failed').length !== 1 ? 's' : ''} failed`}
              </div>
            </div>
          )}

          {results.filter(r => filter === 'all' || r.status === filter).map(r => {
            const relApis    = apiRequests.filter(a => a.test_result_id === r.id && a.is_auth_related);
            const yourApis   = relApis.filter(a => !a.is_third_party);
            const otherApis  = relApis.filter(a => a.is_third_party);
            const relFinds = apiFindings.filter(f => f.test_result_id === r.id);
            const rc       = rcMap.get(r.id);
            const tag      = deriveTag(r);
            const expanded = open === r.id;
            const hasErrors = relFinds.some(f => f.severity === 'error');
            const hasWarns  = relFinds.some(f => f.severity === 'warning');
            const isSlow    = r.duration_ms > 3000;

            return (
              <div
                key={r.id}
                className={`rp-test-row rp-test-row--${r.status} ${expanded ? 'rp-test-row--open' : ''}`}
                onClick={() => setOpen(expanded ? null : r.id)}
              >
                {/* Left accent border */}
                <span className={`rp-test-accent rp-test-accent--${r.status}`} />

                <div className="rp-test-main">
                  <div className="rp-test-left">
                    <span className="rp-test-name">{r.test_name}</span>

                    <div className="rp-test-badges">
                      {tag && (
                        <span className={`rp-tag rp-tag--${tag.toLowerCase()}`}>{tag}</span>
                      )}
                      {relFinds.length > 0 && (
                        <span className={`rp-issue-pill ${hasErrors ? 'rp-issue-pill--red' : 'rp-issue-pill--yellow'}`}>
                          {hasErrors ? '⚑' : '△'}{' '}
                          {relFinds.length} {relFinds.length === 1 ? 'issue' : 'issues'}
                        </span>
                      )}
                      {r.status === 'failed' && rc && (
                        <span className="rp-rc-pill">
                          {(rc.analysis_source ?? rc.analysisSource) !== 'fallback' ? '✦ AI' : '⚙ RCA'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rp-test-right">
                    {r.duration_ms > 0 && (
                      <span className={`rp-timing ${isSlow ? 'rp-timing--slow' : ''}`}>
                        {isSlow ? '⚠ ' : ''}{r.duration_ms}ms
                      </span>
                    )}
                    <Badge status={r.status} severity={r.severity} />
                    <span className="rp-chevron">{expanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {expanded && (
                  <div className="rp-test-detail">
                    {/* Verdict — one plain sentence, shown before anything else */}
                    {r.summary && (
                      <div className={`rp-verdict rp-verdict--${r.severity || 'clean'}`}>
                        {r.summary}
                      </div>
                    )}

                    {/* Credentials used for this test */}
                    <div className="rp-detail-grid">
                      <div className="rp-detail-row">
                        <span className="rp-detail-label">Email</span>
                        <code className="rp-detail-val">{r.email || '(empty)'}</code>
                      </div>
                      <div className="rp-detail-row">
                        <span className="rp-detail-label">Password</span>
                        <code className="rp-detail-val">
                          {r.password?.length > 30
                            ? `${r.password.substring(0, 30)}… (${r.password.length}ch)`
                            : r.password || '(empty)'}
                        </code>
                      </div>
                      {r.error_message && (
                        <div className="rp-detail-row">
                          <span className="rp-detail-label">Error</span>
                          <code className="rp-detail-val rp-detail-val--err">{r.error_message}</code>
                        </div>
                      )}
                    </div>

                    {/* Your app's auth calls — third-party (Google, etc.) hidden by default */}
                    {yourApis.length > 0 && (
                      <div className="rp-detail-section">
                        <div className="rp-detail-title">What your app called</div>
                        {yourApis.map(a => (
                          <div key={a.id} className="rp-inline-api">
                            <Method m={a.method} />
                            <span className="rp-api-path">{a.pathname ?? safePathname(a.url)}</span>
                            <Code n={a.response_status} />
                            {a.response_time_ms != null && (
                              <span className={`rp-timing ${a.response_time_ms > 3000 ? 'rp-timing--slow' : ''}`}>
                                {a.response_time_ms}ms
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {otherApis.length > 0 && (
                      <div className="rp-detail-section">
                        <button
                          className="rp-thirdparty-toggle"
                          onClick={(e) => { e.stopPropagation(); toggleThirdParty(r.id); }}
                        >
                          {showThirdParty.has(r.id) ? '▲' : '▼'}{' '}
                          {otherApis.length} call{otherApis.length !== 1 ? 's' : ''} to other services (not your app)
                        </button>
                        {showThirdParty.has(r.id) && (
                          <div className="rp-thirdparty-list">
                            {otherApis.map(a => (
                              <div key={a.id} className="rp-inline-api rp-inline-api--muted">
                                <Method m={a.method} />
                                <span className="rp-api-path">{a.pathname ?? safePathname(a.url)}</span>
                                <Code n={a.response_status} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Issues — plain language, only when something needs attention */}
                    {relFinds.length > 0 && (
                      <div className="rp-detail-section">
                        <div className="rp-detail-title">What needs attention</div>
                        {relFinds.map((f, i) => (
                          <div key={i} className={`rp-finding-inline rp-finding-inline--${f.severity}`}>
                            <Chip severity={f.severity} />
                            <span>{f.message}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Root cause — only for genuine failures */}
                    {r.status === 'failed' && rc && (
                      <div className="rp-detail-section">
                        <div className="rp-detail-title">Likely cause</div>
                        <RootCauseBlock rc={rc} compact />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* List footer */}
          {results.length > 0 && !isRunning && (
            <div className="rp-list-footer">
              {results.length} test{results.length !== 1 ? 's' : ''} completed
              {run.completed_at && run.created_at && (
                <> · {fmtMs(new Date(run.completed_at) - new Date(run.created_at))}</>
              )}
            </div>
          )}
        </div>
      )}

      {/* ════ Tab: API ════ */}
      {tab === 'api' && (
        <div className="rp-api-wrap">
          {apiRequests.length === 0
            ? <div className="rp-empty">No API requests captured yet.</div>
            : results.map(r => {
              const relApis = apiRequests.filter(a => a.test_result_id === r.id);
              if (!relApis.length) return null;
              return (
                <div key={r.id} className="rp-api-group">
                  <div className="rp-api-group-head">
                    <Badge status={r.status} severity={r.severity} />
                    <span className="rp-api-group-name">{r.test_name}</span>
                    <span className="rp-api-group-count">{relApis.length} req</span>
                  </div>
                  {relApis.map(req => <ApiCard key={req.id} req={req} findings={apiFindings} onCopy={copyToClipboard} copied={copied} />)}
                </div>
              );
            })
          }
        </div>
      )}

      {/* ════ Tab: Issues ════ */}
      {tab === 'findings' && (
        <div className="rp-issues-wrap">
          {apiFindings.length === 0
            ? <div className="rp-all-pass">✓ No issues found</div>
            : (
              <>
                <div className="rp-issues-bar">
                  <span className="rp-issues-total">{apiFindings.length} issue{apiFindings.length !== 1 ? 's' : ''}</span>
                  {errFinds.length > 0 && <span className="rp-chip rp-chip--error">{errFinds.length} error{errFinds.length !== 1 ? 's' : ''}</span>}
                  {warnFinds.length > 0 && <span className="rp-chip rp-chip--warning">{warnFinds.length} warn{warnFinds.length !== 1 ? 's' : ''}</span>}
                </div>
                {results.map(r => {
                  const rf = apiFindings.filter(f => f.test_result_id === r.id);
                  if (!rf.length) return null;
                  return (
                    <div key={r.id} className="rp-issues-group">
                      <div className="rp-issues-group-head">
                        <Badge status={r.status} severity={r.severity} />
                        <span className="rp-issues-group-name">{r.test_name}</span>
                        <span className={`rp-issue-pill ${rf.some(f => f.severity === 'error') ? 'rp-issue-pill--red' : 'rp-issue-pill--yellow'}`}>
                          {rf.length}
                        </span>
                      </div>
                      {rf.map((f, i) => <FindingCard key={i} finding={f} />)}
                    </div>
                  );
                })}
              </>
            )
          }
        </div>
      )}

      {/* ════ Tab: Correlation ════ */}
      {tab === 'correlation' && (
        <div className="rp-corr-wrap">
          {(() => {
            const linked   = results.filter(r => r.status === 'failed' &&
              apiFindings.some(f => f.test_result_id === r.id && f.severity === 'error'));
            const warned   = results.filter(r => r.status === 'passed' &&
              apiFindings.some(f => f.test_result_id === r.id && f.category === 'server_error'));
            const unlinked = results.filter(r => r.status === 'failed' &&
              !apiFindings.some(f => f.test_result_id === r.id &&
                (f.severity === 'error' || f.severity === 'warning')));

            if (!linked.length && !warned.length && !unlinked.length) {
              return <div className="rp-all-pass">✓ No correlated failures — all tests clean</div>;
            }

            const mk = (r, type) => ({
              type, linked: type !== 'ui_failed_no_api_signal',
              uiTestName: r.test_name, uiStatus: r.status, uiError: r.error_message, note: null,
              relatedApis: apiRequests.filter(a => a.test_result_id === r.id && a.is_auth_related).map(a => ({
                method: a.method, pathname: a.pathname ?? safePathname(a.url),
                status: a.response_status, responseTimeMs: a.response_time_ms, authLabel: a.auth_label,
              })),
              apiFindings: apiFindings.filter(f => f.test_result_id === r.id &&
                (f.severity === 'error' || f.severity === 'warning')).map(f => ({
                severity: f.severity, category: f.category, message: f.message, explain: f.explain,
              })),
            });

            return (
              <>
                {linked.length > 0 && (
                  <>
                    <div className="rp-corr-group-head rp-corr-group-head--error">
                      ● {linked.length} failure{linked.length > 1 ? 's' : ''} — API caused
                    </div>
                    {linked.map(r => <CorrCard key={r.id} corr={mk(r, 'ui_and_api_failed')} />)}
                  </>
                )}
                {warned.length > 0 && (
                  <>
                    <div className="rp-corr-group-head rp-corr-group-head--warn">
                      ⚠ {warned.length} silent failure{warned.length > 1 ? 's' : ''} — UI passed, API errored
                    </div>
                    {warned.map(r => <CorrCard key={r.id} corr={mk(r, 'ui_passed_api_errors')} />)}
                  </>
                )}
                {unlinked.length > 0 && (
                  <>
                    <div className="rp-corr-group-head rp-corr-group-head--info">
                      ○ {unlinked.length} failure{unlinked.length > 1 ? 's' : ''} — no API signal
                    </div>
                    {unlinked.map(r => <CorrCard key={r.id} corr={mk(r, 'ui_failed_no_api_signal')} />)}
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ════ Tab: Report ════ */}
      {tab === 'report' && (
        run.status === 'completed'
          ? <FullReport runId={runId} />
          : <div className="rp-empty">Report available after run completes.</div>
      )}
    </div>
  );
}