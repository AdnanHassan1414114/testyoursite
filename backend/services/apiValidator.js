/**
 * services/apiValidator.js
 * ─────────────────────────
 * Pure validation layer — no database calls.
 * Takes ApiObservation[] and returns Finding[].
 *
 * Feature modules call this first, then apply their own rules on top.
 * Exports: validateApiRequests, validateSchemaConsistency
 */

const SLOW_MS      = 3_000;
const VERY_SLOW_MS = 8_000;

// ── Expected status codes per test name ──────────────────────────────────────

const EXPECTED_STATUS_MAP = {
  // Login
  'Valid Login':                { success: [200, 201, 204, 302] },
  'Invalid Password':           { failure: [400, 401, 403, 422] },
  'Wrong Password':             { failure: [400, 401, 403, 422] },
  'Invalid Email':              { failure: [400, 401, 403, 422] },
  'Wrong Email':                { failure: [400, 401, 403, 404, 422] },
  'Empty Email':                { failure: [400, 401, 422] },
  'Empty Password':             { failure: [400, 401, 422] },
  'Both Fields Empty':          { failure: [400, 401, 422] },
  'SQL Injection':              { failure: [400, 401, 403, 422] },
  'XSS Attempt':                { failure: [400, 401, 403, 422] },
  'Long Email':                 { failure: [400, 413, 422] },
  'Long Password':              { failure: [400, 413, 422] },
  'Unicode Password':           { failure: [400, 401, 422] },
  // Signup
  'Valid Signup':               { success: [200, 201, 204] },
  'Existing Email':             { failure: [400, 409, 422] },
  'Password Mismatch':          { failure: [400, 422] },
  'Weak Password':              { failure: [400, 422] },
  'Invalid Email Format':       { failure: [400, 422] },
  'Email Enumeration':          { failure: [400, 409, 422] },
  'Long Username':              { failure: [400, 413, 422] },
  'Empty Fields':               { failure: [400, 422] },
  // Logout
  'Successful Logout':          { success: [200, 204, 302] },
  'Token Removal':              { success: [200, 204] },
  'Multiple Logout Attempts':   { success: [200, 204, 400, 401] },
  'Session Invalidated':        { failure: [401, 403] },
  'Redirect Behaviour':         { success: [200, 204, 302] },
  // Forgot Password
  'Valid Email':                { success: [200, 204] },
  'Non-Existing User':          { success: [200, 204] },
  'Reset Email Sent':           { success: [200, 204] },
  'Error Handling':             { failure: [400, 422, 500] },
  // Reset Password
  'Valid Reset Token':          { success: [200, 201, 204] },
  'Expired Token':              { failure: [400, 401, 403, 410, 422] },
  'Invalid Token':              { failure: [400, 401, 403, 422] },
  'Successful Password Reset':  { success: [200, 201, 204] },
  // Email Verification
  'Valid Verification Link':    { success: [200, 201, 204] },
  'Expired Link':               { failure: [400, 401, 403, 410, 422] },
  'Invalid Link':               { failure: [400, 401, 403, 422] },
  'Resend Verification':        { success: [200, 204] },
  'Verified User Flow':         { success: [200, 204] },
  // OTP
  'Valid OTP':                  { success: [200, 201, 204] },
  'Invalid OTP':                { failure: [400, 401, 403, 422] },
  'Expired OTP':                { failure: [400, 401, 410, 422] },
  'Multiple Failed Attempts':   { failure: [400, 401, 403, 423, 429] },
  'Resend OTP':                 { success: [200, 204] },
  'Empty OTP':                  { failure: [400, 422] },
  // Session Management
  'Session Creation':           { success: [200, 201] },
  'Session Renewal':            { success: [200, 201] },
  'Logout Session Cleanup':     { failure: [401, 403] },
};

const EXPLAIN = {
  network:            'The request was dispatched but no response was received. The server may be unreachable, a CORS preflight may have failed, or the endpoint does not exist.',
  server_error:       'The server returned a 5xx status — an unhandled exception occurred on the backend.',
  rate_limit:         'HTTP 429 — the server is throttling requests. Running many tests quickly may trigger the threshold.',
  method_not_allowed: 'HTTP 405 — the endpoint rejected the HTTP method. The endpoint may only accept POST.',
  unexpected_status:  'The server returned a status code that does not match the expected outcome for this test.',
  slow_response:      'The authentication endpoint is responding slowly (>3s). This may degrade the user experience.',
  very_slow_response: 'The authentication endpoint response time exceeds 8 seconds — a significant performance issue.',
};

function dedup(findings) {
  const seen = new Set();
  return findings.filter(f => {
    const key = `${f.category}|${f.detail?.url}|${f.detail?.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateApiRequests(observations, testName, expectedOutcome) {
  const findings = [];

  for (const obs of observations) {
    if (!obs.isAuthRelated)       continue;
    if (obs.navigationAborted)    continue;

    // Network failure
    if (obs.error && obs.responseStatus === null) {
      findings.push({
        severity: 'error', category: 'network_failure',
        message:  `${obs.method} ${obs.pathname} failed with no response: ${obs.error}`,
        explain:  EXPLAIN.network, detail: { url: obs.url },
      });
      continue;
    }

    if (!obs.responseStatus) continue;

    // 5xx
    if (obs.responseStatus >= 500) {
      findings.push({
        severity: 'error', category: 'server_error',
        message:  `${obs.method} ${obs.pathname} returned HTTP ${obs.responseStatus}.`,
        explain:  EXPLAIN.server_error, detail: { url: obs.url, status: obs.responseStatus },
      });
    }

    // 429
    if (obs.responseStatus === 429) {
      findings.push({
        severity: 'warning', category: 'rate_limited',
        message:  `${obs.method} ${obs.pathname} returned HTTP 429 (rate limited).`,
        explain:  EXPLAIN.rate_limit, detail: { url: obs.url },
      });
    }

    // 405
    if (obs.responseStatus === 405) {
      findings.push({
        severity: 'error', category: 'method_not_allowed',
        message:  `${obs.method} ${obs.pathname} returned HTTP 405.`,
        explain:  EXPLAIN.method_not_allowed, detail: { url: obs.url },
      });
    }

    // Slow response
    if (obs.responseTimeMs !== null) {
      if (obs.responseTimeMs > VERY_SLOW_MS) {
        findings.push({
          severity: 'error', category: 'very_slow_response',
          message:  `${obs.method} ${obs.pathname} took ${obs.responseTimeMs}ms.`,
          explain:  EXPLAIN.very_slow_response, detail: { url: obs.url, responseTimeMs: obs.responseTimeMs },
        });
      } else if (obs.responseTimeMs > SLOW_MS) {
        findings.push({
          severity: 'warning', category: 'slow_response',
          message:  `${obs.method} ${obs.pathname} took ${obs.responseTimeMs}ms.`,
          explain:  EXPLAIN.slow_response, detail: { url: obs.url, responseTimeMs: obs.responseTimeMs },
        });
      }
    }

    // Expected status check
    const expected = EXPECTED_STATUS_MAP[testName];
    if (expected && obs.method !== 'GET') {
      const bucket = expectedOutcome === 'success' ? expected.success : expected.failure;
      if (bucket && !bucket.includes(obs.responseStatus)) {
        findings.push({
          severity: 'warning', category: 'unexpected_status',
          message:  `${obs.method} ${obs.pathname} returned ${obs.responseStatus}; expected [${bucket.join(', ')}] for "${testName}".`,
          explain:  EXPLAIN.unexpected_status, detail: { url: obs.url, status: obs.responseStatus, expected: bucket },
        });
      }
    }
  }

  return dedup(findings);
}

export function validateSchemaConsistency(allTestObservations) {
  const findings       = [];
  const endpointSchemas = new Map();

  for (const { testName, observations } of allTestObservations) {
    for (const obs of observations) {
      if (!obs.isAuthRelated || !obs.responsePayload || typeof obs.responsePayload !== 'object') continue;
      const key  = `${obs.method} ${obs.pathname}`;
      const keys = Object.keys(obs.responsePayload).sort().join(',');
      if (!endpointSchemas.has(key)) {
        endpointSchemas.set(key, { schemas: new Set(), tests: [] });
      }
      const entry = endpointSchemas.get(key);
      entry.schemas.add(keys);
      entry.tests.push(testName);
    }
  }

  for (const [endpoint, { schemas, tests }] of endpointSchemas) {
    if (schemas.size > 1) {
      findings.push({
        severity: 'warning', category: 'schema_inconsistency',
        message:  `${endpoint} returned different response shapes across ${tests.length} tests.`,
        explain:  'Inconsistent response schemas make client-side error handling fragile.',
        detail:   { endpoint, schemas: [...schemas], tests },
      });
    }
  }

  return findings;
}