/**
 * features/login/index.js
 * ────────────────────────
 * Login feature — predefined test cases, feature validator, AI prompt builder.
 */

export const meta = {
  name:        'Login',
  description: 'Test authentication login flows including valid, invalid, boundary, and security cases.',
  fieldHints:  ['email', 'username', 'user', 'login'],
  submitHints: ['login', 'sign in', 'signin', 'log in', 'submit', 'continue', 'enter'],
};

export function testCases({ email = 'test@example.com', password = 'TestPass123!' } = {}) {
  const [local, domain] = email.includes('@') ? email.split('@') : ['test', 'example.com'];
  const wrongEmail    = `notreal_${local}@${domain}`;
  const wrongPassword = password + 'X';

  return [
    { name: 'Valid Login',       description: 'Login with correct credentials.',         email,       password,         expectedOutcome: 'success', expectedBehavior: 'User authenticated and redirected away from login page.' },
    { name: 'Invalid Password',  description: 'Correct email, wrong password.',          email,       password: wrongPassword, expectedOutcome: 'failure', expectedBehavior: 'Authentication rejected; error message shown.' },
    { name: 'Invalid Email',     description: 'Non-existent account email.',             email: wrongEmail, password, expectedOutcome: 'failure', expectedBehavior: 'Account not found; error message shown.' },
    { name: 'Empty Email',       description: 'Submit with empty email field.',          email: '',   password,         expectedOutcome: 'failure', expectedBehavior: 'Required-field validation blocks submission.' },
    { name: 'Empty Password',    description: 'Submit with empty password field.',       email,       password: '',     expectedOutcome: 'failure', expectedBehavior: 'Required-field validation blocks submission.' },
    { name: 'Long Email',        description: 'Email padded to 300 characters.',         email: 'a'.repeat(290) + '@' + domain, password, expectedOutcome: 'failure', expectedBehavior: 'Server returns 400/413/422.' },
    { name: 'Long Password',     description: 'Password padded to 1000 characters.',    email,       password: password + 'A'.repeat(Math.max(0, 1000 - password.length)), expectedOutcome: 'failure', expectedBehavior: 'Server returns 400/413/422; does not crash.' },
    { name: 'SQL Injection',     description: "SQL injection payload in password.",      email,       password: "' OR '1'='1", expectedOutcome: 'failure', expectedBehavior: 'Server returns 400/401; no authentication bypass.' },
    { name: 'XSS Attempt',       description: 'Script tag in password field.',           email,       password: '<script>alert(1)</script>', expectedOutcome: 'failure', expectedBehavior: 'Input sanitised or rejected; no script execution.' },
  ];
}

export function validate(observations, testName, expectedOutcome) {
  const findings = [];
  for (const obs of observations) {
    if (!obs.isAuthRelated) continue;
    if (testName === 'Valid Login' && expectedOutcome === 'success') {
      const payload = obs.responsePayload;
      const headers = obs.responseHeaders ?? {};
      const hasToken = payload && typeof payload === 'object' &&
        ['token', 'access_token', 'accessToken', 'jwt', 'session', 'user'].some(k => k in payload);
      const hasCookie = Object.keys(headers).some(h => h.toLowerCase() === 'set-cookie');
      if (obs.responseStatus === 200 && !hasToken && !hasCookie) {
        findings.push({
          severity: 'warning', category: 'missing_auth_token',
          message:  `${obs.method} ${obs.pathname} returned 200 with no token or session cookie.`,
          explain:  'A successful login response should contain a session token or cookie.',
          detail:   { url: obs.url },
        });
      }
    }
  }
  return findings;
}

export function buildAiPrompt(pageContext, credentials) {
  const { email, password } = credentials;
  const [local, domain] = email.split('@');
  return `You are a senior QA engineer testing a Login page.

Page: ${pageContext.url}
OAuth providers: ${pageContext.oauthProviders?.join(', ') || 'none'}
MFA detected: ${pageContext.mfaHints?.join(', ') || 'none'}
CAPTCHA: ${pageContext.hasCaptcha}
Remember-me: ${pageContext.hasRememberMe}
Visible text: "${(pageContext.visibleText || '').substring(0, 300)}"

Valid email: ${email}
Valid password: ${password}
Wrong email: notreal_${local}@${domain}

Core tests (valid, invalid creds, empty fields, long input, SQL injection, XSS) are ALREADY included.
Generate 4-6 ADDITIONAL edge cases specific to this page's features. Do NOT duplicate core tests.

Return ONLY a JSON array: [{"name","description","email","password","expectedOutcome","expectedBehavior"}]`;
}

export default { meta, testCases, validate, buildAiPrompt };