export const meta = {
  name: 'Logout', description: 'Test logout flows: session invalidation, token removal, redirect, and repeated attempts.',
  fieldHints: [], submitHints: ['logout', 'log out', 'sign out', 'signout', 'exit'],
};
export function testCases({ email = 'test@example.com', password = 'TestPass123!' } = {}) {
  return [
    { name: 'Successful Logout',             description: 'Logged-in user clicks logout.',                            email, password, action: 'logout',                  expectedOutcome: 'success', expectedBehavior: 'User redirected to login or home page.' },
    { name: 'Session Invalidated',           description: 'After logout, protected page should redirect to login.',   email, password, action: 'logout_then_protected',    expectedOutcome: 'failure', expectedBehavior: 'Protected page inaccessible; user redirected to login.' },
    { name: 'Redirect Behaviour',            description: 'Verify redirect destination after logout is appropriate.', email, password, action: 'logout',                  expectedOutcome: 'success', expectedBehavior: 'User lands on login or public home page; no 404 or error.' },
    { name: 'Token Removal',                 description: 'Auth cookie cleared from browser after logout.',           email, password, action: 'logout',                  expectedOutcome: 'success', expectedBehavior: 'Set-Cookie header clears session cookie (Max-Age=0 or expired).' },
    { name: 'Multiple Logout Attempts',      description: 'Clicking logout twice should not cause an error.',         email, password, action: 'double_logout',            expectedOutcome: 'success', expectedBehavior: 'Second attempt handled gracefully; no 500 or crash.' },
  ];
}
export function validate(observations, testName) {
  const findings = [];
  for (const obs of observations) {
    if (!obs.isAuthRelated) continue;
    if (testName === 'Token Removal' && obs.responseStatus < 400) {
      const setCookie = Object.entries(obs.responseHeaders ?? {}).find(([k]) => k.toLowerCase() === 'set-cookie')?.[1] ?? '';
      const clears = setCookie.toLowerCase().includes('max-age=0') || setCookie.toLowerCase().includes('expires=');
      if (!clears && !setCookie) {
        findings.push({ severity: 'warning', category: 'session_not_cleared', message: `${obs.method} ${obs.pathname} did not clear the session cookie.`, explain: 'A secure logout should explicitly expire the session cookie.', detail: { url: obs.url } });
      }
    }
  }
  return findings;
}
export function buildAiPrompt(pageContext, credentials) {
  return `You are a QA engineer testing a Logout flow.
Page: ${pageContext.url}, Email: ${credentials.email}
Core logout tests (successful, session invalidated, redirect, token removal, multiple attempts) are ALREADY included.
Generate 3-4 ADDITIONAL edge cases (e.g. logout from multiple tabs, logout with expired token, CSRF).
Return ONLY JSON array: [{"name","description","email","password","expectedOutcome","expectedBehavior"}]`;
}
export default { meta, testCases, validate, buildAiPrompt };