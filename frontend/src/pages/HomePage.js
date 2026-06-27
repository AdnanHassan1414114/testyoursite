import { apiUrl } from '../apiConfig';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import './HomePage.css';

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

const EXAMPLE_URLS = {
  login:             ['https://app.example.com/login', 'https://demo.example.com/signin'],
  signup:            ['https://app.example.com/signup', 'https://demo.example.com/register'],
  logout:            ['https://app.example.com/logout', 'https://demo.example.com/signout'],
  forgotPassword:    ['https://app.example.com/forgot-password'],
  resetPassword:     ['https://app.example.com/reset-password'],
  emailVerification: ['https://app.example.com/verify-email'],
  otpVerification:   ['https://app.example.com/verify-otp', 'https://app.example.com/2fa'],
  sessionManagement: ['https://app.example.com/login'],
};

/**
 * Defines which credential fields each feature needs in the modal.
 *
 * Fields:
 *   email           — test account email
 *   password        — test account password
 *   username        — username (some apps separate from email)
 *   confirmPassword — only shown where the form has a confirm field
 *   token           — reset / verification token placeholder
 *   otp             — OTP/2FA code placeholder
 *
 * required: true  → field is highlighted as recommended (still optional to the backend)
 * hint            → per-field helper text shown below the input
 * noModal: true   → skip modal entirely, fire run immediately
 */
const FEATURE_CREDENTIAL_CONFIG = {
  login: {
    title: 'Login Test Credentials',
    description: 'Used for the "Valid Login" test case. All other cases use invalid/boundary values.',
    fields: [
      { key: 'email',    label: 'Test Email',    type: 'email',    placeholder: 'testuser@yourapp.com', required: true,  hint: 'A real account on the target app.' },
      { key: 'password', label: 'Test Password', type: 'password', placeholder: '••••••••',             required: true,  hint: 'The correct password for the above account.' },
    ],
  },

  signup: {
    title: 'Signup Test Credentials',
    description: 'Used for the "Valid Signup" and "Existing Email" test cases.',
    fields: [
      { key: 'email',           label: 'Base Email',         type: 'email',    placeholder: 'newuser@yourapp.com', required: true,  hint: 'Used as the "existing email" for duplicate tests. A unique variant is auto-generated for the valid signup.' },
      { key: 'password',        label: 'Test Password',      type: 'password', placeholder: '••••••••',            required: true,  hint: 'Must meet the app\'s password policy.' },
      { key: 'username',        label: 'Base Username',      type: 'text',     placeholder: 'testuser',            required: false, hint: 'Optional — only needed if the signup form has a username field.' },
    ],
  },

  logout: {
    title: 'Logout Test Credentials',
    description: 'The agent logs in first with these credentials, then tests the logout flow.',
    fields: [
      { key: 'email',    label: 'Test Email',    type: 'email',    placeholder: 'testuser@yourapp.com', required: true,  hint: 'A real account — the agent needs to be logged in to test logout.' },
      { key: 'password', label: 'Test Password', type: 'password', placeholder: '••••••••',             required: true,  hint: 'The correct password for the above account.' },
    ],
  },

  forgotPassword: {
    title: 'Forgot Password Credentials',
    description: 'Only an email is needed — no password required for this flow.',
    fields: [
      { key: 'email', label: 'Registered Email', type: 'email', placeholder: 'testuser@yourapp.com', required: true, hint: 'A real registered email to test the "reset email sent" case. A non-existent variant is auto-generated.' },
    ],
  },

  resetPassword: {
    title: 'Reset Password Credentials',
    description: 'Provide a valid reset token if you have one, otherwise the agent uses placeholder tokens.',
    fields: [
      { key: 'email',    label: 'Test Email',        type: 'email',    placeholder: 'testuser@yourapp.com', required: false, hint: 'The account email associated with the reset token.' },
      { key: 'password', label: 'New Password',      type: 'password', placeholder: 'NewSecure123!',        required: false, hint: 'The new password to set — must meet the app\'s policy.' },
      { key: 'token',    label: 'Valid Reset Token',  type: 'text',     placeholder: 'Paste token from reset email', required: false, hint: 'Optional. Without a real token, only invalid/expired token tests will run meaningfully.' },
    ],
  },

  emailVerification: {
    title: 'Email Verification Credentials',
    description: 'Provide a valid verification token to test the happy path.',
    fields: [
      { key: 'email', label: 'Test Email',              type: 'email', placeholder: 'testuser@yourapp.com',       required: false, hint: 'The account email that received the verification link.' },
      { key: 'token', label: 'Valid Verification Token', type: 'text',  placeholder: 'Paste token from email link', required: false, hint: 'Optional. Without a real token, only invalid/expired token tests run.' },
    ],
  },

  otpVerification: {
    title: 'OTP / 2FA Credentials',
    description: 'Provide login credentials and optionally a live OTP code.',
    fields: [
      { key: 'email',    label: 'Test Email',    type: 'email',    placeholder: 'testuser@yourapp.com', required: true,  hint: 'Account that has 2FA enabled.' },
      { key: 'password', label: 'Test Password', type: 'password', placeholder: '••••••••',             required: true,  hint: 'Password to reach the OTP step.' },
      { key: 'otp',      label: 'Live OTP Code', type: 'text',     placeholder: '123456',               required: false, hint: 'Optional live code. Without it only invalid/expired OTP tests run.' },
    ],
  },

  sessionManagement: {
    title: 'Session Management Credentials',
    description: 'The agent needs a real account to create and test session lifecycle.',
    fields: [
      { key: 'email',    label: 'Test Email',    type: 'email',    placeholder: 'testuser@yourapp.com', required: true,  hint: 'A real account on the target app.' },
      { key: 'password', label: 'Test Password', type: 'password', placeholder: '••••••••',             required: true,  hint: 'The correct password for the above account.' },
    ],
  },
};

export default function HomePage({ onRunStarted }) {
  const [features, setFeatures]         = useState([]);
  const [selectedFeature, setFeature]   = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropSearch, setDropSearch]     = useState('');
  const [url, setUrl]                   = useState('');
  const [urlError, setUrlError]         = useState('');
  const [showModal, setShowModal]       = useState(false);
  const [loading, setLoading]           = useState(false);
  const [submitError, setSubmitError]   = useState('');
  const [showPwFields, setShowPwFields]  = useState(new Set());
  const togglePw = (key) => setShowPwFields(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const [focusedIdx, setFocusedIdx]     = useState(-1);
  const [toast, setToast]               = useState('');
  const firstInputRef = useRef(null);
  const toastRef      = useRef(null);

  // Single credential store — keys match FEATURE_CREDENTIAL_CONFIG field keys.
  // Persists across feature switches so the user doesn't re-enter common fields.
  const [credentials, setCredentials]   = useState({
    email: '', password: '', username: '', token: '', otp: '',
  });
  const [fieldErrors, setFieldErrors]   = useState({});

  const dropRef = useRef(null);

  // ── Update document title ─────────────────────────────────────────────────
  useEffect(() => {
    document.title = 'AuthQA — Authentication Testing';
  }, []);

  // ── Load features ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(apiUrl('/api/tests/features'))
      .then(r => r.json())
      .then(data => { setFeatures(data); if (data.length) setFeature(data[0]); })
      .catch(() => {
        const fallback = [
          { key: 'login',             name: 'Login',              description: 'Test login flows' },
          { key: 'signup',            name: 'Signup',             description: 'Test registration' },
          { key: 'logout',            name: 'Logout',             description: 'Test logout flows' },
          { key: 'forgotPassword',    name: 'Forgot Password',    description: 'Test password reset request' },
          { key: 'resetPassword',     name: 'Reset Password',     description: 'Test password reset completion' },
          { key: 'emailVerification', name: 'Email Verification', description: 'Test email verification' },
          { key: 'otpVerification',   name: 'OTP Verification',   description: 'Test OTP/2FA flows' },
          { key: 'sessionManagement', name: 'Session Management', description: 'Test session lifecycle' },
        ];
        setFeatures(fallback);
        setFeature(fallback[0]);
      });
  }, []);

  // ── Close dropdown on outside click ───────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setDropdownOpen(false);
        setDropSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Filtered features (must be defined before keyboard useEffect) ──────────
  const filteredFeatures = features.filter(f =>
    f.name.toLowerCase().includes(dropSearch.toLowerCase()) ||
    f.description.toLowerCase().includes(dropSearch.toLowerCase())
  );

  // ── Keyboard: Escape closes, ArrowUp/Down navigates dropdown ─────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (showModal && !loading) { closeModal(); return; }
        if (dropdownOpen) { setDropdownOpen(false); setDropSearch(''); setFocusedIdx(-1); }
        return;
      }
      if (!dropdownOpen) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIdx(i => Math.min(i + 1, filteredFeatures.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && focusedIdx >= 0) {
        const f = filteredFeatures[focusedIdx];
        if (f) { setFeature(f); setDropdownOpen(false); setDropSearch(''); setFocusedIdx(-1); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showModal, loading, dropdownOpen, focusedIdx, filteredFeatures]);

  const validateUrl = useCallback((val) => {
    if (!val.trim()) { setUrlError('URL is required.'); return false; }
    try { new URL(val); setUrlError(''); return true; }
    catch { setUrlError('Invalid URL. Include https://'); return false; }
  }, []);

  const setField = (key, value) => {
    setCredentials(prev => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) setFieldErrors(prev => ({ ...prev, [key]: '' }));
  };

  // ── Fire the actual API call ──────────────────────────────────────────────
  const startRun = async (creds = {}) => {
    setLoading(true);
    setSubmitError('');
    try {
      const body = {
        url,
        feature:      selectedFeature?.key ?? 'login',
        testEmail:    creds.email    || undefined,
        testPassword: creds.password || undefined,
        testUsername: creds.username || undefined,
        testToken:    creds.token    || undefined,
        testOtp:      creds.otp      || undefined,
      };
      const res  = await fetch(apiUrl('/api/tests/run'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || 'Failed to start test run.');
        setLoading(false);
        return;
      }
      closeModal();
      setCredentials({ email: '', password: '', username: '', token: '', otp: '' }); // reset only on successful run start
      setLoading(false);
      showToast('Test run started successfully');
      onRunStarted(data.runId);
    } catch (err) {
      setSubmitError(`Network error: ${err.message}`);
      setLoading(false);
    }
  };

  // ── Handle Run click ──────────────────────────────────────────────────────
  const handleRun = () => {
    if (!validateUrl(url)) return;
    setSubmitError('');
    setFieldErrors({});
    setShowModal(true);
  };

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 2800);
  };

  const closeModal = () => {
    setShowModal(false);
    setFieldErrors({});
    setSubmitError('');
    // FIX: credentials are preserved across close/reopen — only reset after a run actually starts
  };

  // ── Focus first field when modal opens ───────────────────────────────────
  useEffect(() => {
    if (showModal && firstInputRef.current) {
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [showModal]);

  // ── Handle modal confirm ──────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!validateUrl(url)) return;

    const config = FEATURE_CREDENTIAL_CONFIG[selectedFeature?.key] ?? { fields: [] };
    const errors = {};

    for (const field of config.fields) {
      const val = (credentials[field.key] || '').trim();
      if (field.key === 'email' && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        errors[field.key] = 'Enter a valid email address.';
      }
    }

    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    await startRun(credentials);
  };

  const featureKey = selectedFeature?.key;
  const config     = FEATURE_CREDENTIAL_CONFIG[featureKey] ?? { fields: [] };
  const examples   = featureKey ? (EXAMPLE_URLS[featureKey] ?? []) : [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="home">
      <div className="home-hero">
        <div className="hero-badge">
          <span className="hero-badge-dot" />
          AI-Powered Auth Testing
        </div>
        <h1 className="hero-title">Authentication QA, automated.</h1>
        <p className="hero-sub">
          Select a feature, paste your login URL, and get a full suite of security
          and UX tests — login, signup, OTP, sessions, and more.
        </p>
      </div>

      <div className="hp-bar-wrap">
        <div className="hp-bar">

          {/* ── Feature dropdown ── */}
          <div className="hp-feat-wrap" ref={dropRef}>
            <button
              className={`hp-feat-btn ${dropdownOpen ? 'hp-feat-btn--open' : ''}`}
              onClick={() => { setDropdownOpen(o => !o); setFocusedIdx(-1); }}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
            >
              <span>{selectedFeature ? FEATURE_ICONS[selectedFeature.key] ?? '🔐' : '🔐'}</span>
              <span className="hp-feat-label">
                {selectedFeature ? selectedFeature.name : 'Select Feature'}
              </span>
              <span className={`hp-feat-caret ${dropdownOpen ? 'hp-feat-caret--open' : ''}`}>▾</span>
            </button>

            {dropdownOpen && (
              <div className="hp-dropdown" role="listbox">
                <div className="hp-drop-search-wrap">
                  <span className="hp-drop-search-icon">🔍</span>
                  <input
                    className="hp-drop-search"
                    placeholder="Search features…"
                    value={dropSearch}
                    onChange={e => setDropSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="hp-drop-list">
                  {filteredFeatures.length === 0 && (
                    <div className="hp-drop-empty">No features found</div>
                  )}
                  {filteredFeatures.map(f => (
                    <div
                      key={f.key}
                      className={`hp-drop-item ${selectedFeature?.key === f.key ? 'hp-drop-item--selected' : ''} ${filteredFeatures.indexOf(f) === focusedIdx ? 'hp-drop-item--focused' : ''}`}
                      role="option"
                      aria-selected={selectedFeature?.key === f.key}
                      onClick={() => {
                        setFeature(f);
                        setDropdownOpen(false);
                        setDropSearch('');
                        setFieldErrors({});
                      }}
                    >
                      <span>{FEATURE_ICONS[f.key] ?? '🔐'}</span>
                      <div className="hp-drop-item-info">
                        <div className="hp-drop-item-label">{f.name}</div>
                        <div className="hp-drop-item-desc">{f.description}</div>
                      </div>
                      {selectedFeature?.key === f.key && <span className="hp-drop-item-check">✓</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── URL input ── */}
          <div className="hp-url-wrap">
            <input
              className={`hp-url-input ${urlError ? 'hp-url-input--error' : ''}`}
              type="url"
              placeholder={
                selectedFeature
                  ? `https://yourapp.com/${selectedFeature.key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
                  : 'https://yourapp.com/login'
              }
              value={url}
              onChange={e => { setUrl(e.target.value); if (urlError) validateUrl(e.target.value); }}
              onKeyDown={e => e.key === 'Enter' && handleRun()}
              aria-label="Page URL to test"
            />
            {url && (
              <button
                className="hp-url-clear"
                onClick={() => { setUrl(''); setUrlError(''); }}
                aria-label="Clear URL"
              >✕</button>
            )}
          </div>

          {/* ── Run button ── */}
          <div className="hp-run-wrap">
            <button
              className="hp-run-btn"
              onClick={handleRun}
              disabled={!url || !selectedFeature || loading}
              aria-label="Run authentication tests"
            >
              ▶ Run Test
            </button>
          </div>
        </div>

        {urlError && <div className="hp-url-error">{urlError}</div>}

        {examples.length > 0 && (
          <div className="hp-examples">
            <span className="hp-examples-label">examples:</span>
            {examples.map(ex => (
              <button key={ex} className="hp-example-chip" onClick={() => { setUrl(ex); setUrlError(''); }}>
                {ex.replace('https://', '')}
              </button>
            ))}
          </div>
        )}

        {selectedFeature && (
          <p className="hp-feature-desc">{selectedFeature.description}</p>
        )}
      </div>

      {/* ── Dynamic credential modal ── */}
      {showModal && (
        <div
          className="modal-backdrop"
          onClick={e => e.target === e.currentTarget && !loading && closeModal()}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">

            {/* Header */}
            <div className="modal-header">
              <div className="modal-title-wrap">
                <span className="modal-icon">
                  {selectedFeature ? FEATURE_ICONS[selectedFeature.key] ?? '🔐' : '🔐'}
                </span>
                <div>
                  <div className="modal-title" id="modal-title">
                    {config.title ?? `${selectedFeature?.name} Test Run`}
                  </div>
                  <div className="modal-subtitle">{url}</div>
                </div>
              </div>
              <button
                className="modal-close"
                onClick={() => !loading && closeModal()}
                aria-label="Close"
              >✕</button>
            </div>

            {/* Feature-specific description */}
            {config.description && (
              <div className="modal-warning">
                <span className="modal-warning-icon">ℹ</span>
                <span>{config.description}</span>
              </div>
            )}

            {/* Dynamic fields */}
            <div className="modal-body">
              {config.fields.map(field => (
                <div className="modal-field" key={field.key}>
                  <label className="modal-label" htmlFor={`modal-${field.key}`}>
                    {field.label}
                    {field.required && (
                      <span style={{ color: 'var(--yellow)', marginLeft: '4px', fontSize: '0.65rem' }}>
                        recommended
                      </span>
                    )}
                  </label>

                  {field.type === 'password' ? (
                    <div className="modal-pw-wrap">
                      <input
                        id={`modal-${field.key}`}
                        className={`modal-input modal-pw-input ${fieldErrors[field.key] ? 'input-error' : ''}`}
                        type={showPwFields.has(field.key) ? 'text' : 'password'}
                        placeholder={field.placeholder}
                        value={credentials[field.key] || ''}
                        onChange={e => setField(field.key, e.target.value)}
                        disabled={loading}
                        autoComplete="new-password"
                      />
                      <button
                        className="modal-pw-toggle"
                        type="button"
                        onClick={() => togglePw(field.key)}
                        tabIndex={-1}
                      >
                        {showPwFields.has(field.key) ? '🙈' : '👁'}
                      </button>
                    </div>
                  ) : (
                    <input
                      id={`modal-${field.key}`}
                      ref={config.fields.indexOf(field) === 0 ? firstInputRef : null}
                      className={`modal-input ${fieldErrors[field.key] ? 'input-error' : ''}`}
                      type={field.type}
                      placeholder={field.placeholder}
                      value={credentials[field.key] || ''}
                      onChange={e => setField(field.key, e.target.value)}
                      disabled={loading}
                      autoComplete="off"
                    />
                  )}

                  {fieldErrors[field.key] && (
                    <span className="input-error-msg">{fieldErrors[field.key]}</span>
                  )}
                  {field.hint && !fieldErrors[field.key] && (
                    <span className="modal-hint">{field.hint}</span>
                  )}
                </div>
              ))}

              <p className="modal-hint">
                All fields are optional — leave blank to run only negative and boundary tests.
              </p>

              {submitError && <div className="modal-error">{submitError}</div>}
            </div>

            {/* Footer */}
            <div className="modal-footer">
              <button
                className="modal-cancel-btn"
                onClick={() => closeModal()}
                disabled={loading}
              >Cancel</button>
              <button
                className="modal-confirm-btn"
                onClick={handleConfirm}
                disabled={loading}
              >
                {loading
                  ? <span className="btn-loading"><span className="spinner" />Starting…</span>
                  : `Run ${selectedFeature?.name ?? 'Test'}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Toast ── */}
      {toast && (
        <div className="hp-toast" role="status" aria-live="polite">{toast}</div>
      )}
    </div>
  );
}