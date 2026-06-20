export const meta = {
  name: 'Session Management', description: 'Test session lifecycle: creation, expiration, renewal, multi-device, and logout cleanup.',
  fieldHints: ['session', 'token', 'remember', 'stay signed in'],
  submitHints: ['login', 'sign in', 'continue'],
};
export function testCases({ email = 'test@example.com', password = 'TestPass123!' } = {}) {
  return [
    { name: 'Session Creation',          description: 'After successful login, a valid session is established.',           email, password, expectedOutcome: 'success', expectedBehavior: 'Session token or cookie issued; subsequent requests authenticated.' },
    { name: 'Session Expiration',        description: 'After TTL elapses, protected resources are inaccessible.',         email, password, action: 'wait_for_session_expiry', expectedOutcome: 'failure', expectedBehavior: 'Expired session redirects to login with appropriate message.' },
    { name: 'Session Renewal',           description: 'Active session refreshed before expiration.',                      email, password, action: 'trigger_session_renewal', expectedOutcome: 'success', expectedBehavior: 'New token issued; expiry extended; user stays logged in.' },
    { name: 'Multiple Device Sessions',  description: 'Login from two contexts; both sessions active simultaneously.',    email, password, action: 'multi_device_login',      expectedOutcome: 'success', expectedBehavior: 'Both sessions valid unless single-session policy enforced.' },
    { name: 'Logout Session Cleanup',    description: 'After logout, session token is invalidated server-side.',          email, password, action: 'logout_then_reuse_token', expectedOutcome: 'failure', expectedBehavior: 'Reusing token after logout returns 401; session invalidated.' },
  ];
}
export function validate(observations, testName) {
  const findings = [];
  for (const obs of observations) {
    if (!obs.isAuthRelated) continue;
    if (testName === 'Session Creation' && obs.responseStatus === 200) {
      const headers = obs.responseHeaders ?? {};
      const hasSessionCookie = Object.keys(headers).some(h => h.toLowerCase() === 'set-cookie');
      const hasToken = obs.responsePayload && typeof obs.responsePayload === 'object' &&
        ['token', 'access_token', 'accessToken', 'session', 'sessionToken'].some(k => k in obs.responsePayload);
      if (!hasSessionCookie && !hasToken) {
        findings.push({ severity: 'warning', category: 'missing_session_token', message: `${obs.method} ${obs.pathname} returned 200 but issued no session token or cookie.`, explain: 'A successful login must issue a session identifier for the client to authenticate future requests.', detail: { url: obs.url } });
      }
      const setCookieHeader = Object.entries(headers).find(([k]) => k.toLowerCase() === 'set-cookie')?.[1] ?? '';
      if (setCookieHeader && !setCookieHeader.toLowerCase().includes('httponly')) {
        findings.push({ severity: 'warning', category: 'insecure_cookie', message: 'Session cookie is missing the HttpOnly flag.', explain: 'HttpOnly cookies cannot be accessed by JavaScript, protecting against XSS-based session hijacking.', detail: { url: obs.url } });
      }
    }
  }
  return findings;
}
export function buildAiPrompt(pageContext, credentials) {
  return `You are a QA engineer testing session management behaviour.
Page: ${pageContext.url}, Email: ${credentials.email}
Core session tests (creation, expiration, renewal, multi-device, logout cleanup) are ALREADY included.
Generate 3-5 ADDITIONAL edge cases (e.g. session fixation, cookie theft, remember-me vs short session).
Return ONLY JSON array: [{"name","description","email","password","expectedOutcome","expectedBehavior"}]`;
}
export default { meta, testCases, validate, buildAiPrompt };