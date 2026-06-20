export const meta = {
  name: 'Signup', description: 'Test user registration flows.',
  fieldHints:  ['email', 'username', 'name', 'register', 'signup'],
  submitHints: ['sign up', 'register', 'create account', 'join', 'get started', 'submit'],
};

export function testCases({ email = 'newuser@example.com', password = 'TestPass123!' } = {}) {
  const [, domain] = email.includes('@') ? email.split('@') : ['newuser', 'example.com'];
  const ts = Date.now();
  return [
    { name: 'Valid Signup',       description: 'Register with valid unique credentials.', email: `testuser_${ts}@${domain}`, password, confirmPassword: password,       expectedOutcome: 'success', expectedBehavior: 'Account created; user redirected or shown success message.' },
    { name: 'Existing Email',     description: 'Register with an already-used email.',   email,                             password, confirmPassword: password,       expectedOutcome: 'failure', expectedBehavior: 'Server returns error: email already registered.' },
    { name: 'Password Mismatch',  description: 'Confirm password does not match.',        email: `mismatch_${ts}@${domain}`, password, confirmPassword: password+'_x', expectedOutcome: 'failure', expectedBehavior: 'Validation error shown; form not submitted.' },
    { name: 'Empty Fields',       description: 'Submit with all fields empty.',           email: '', password: '', confirmPassword: '',                                  expectedOutcome: 'failure', expectedBehavior: 'Required-field validation blocks submission.' },
    { name: 'Long Username',      description: 'Username padded to 300 chars.',           email: `longuser_${ts}@${domain}`, password, username: 'u'.repeat(300), confirmPassword: password, expectedOutcome: 'failure', expectedBehavior: 'Server enforces username length limit.' },
    { name: 'Long Email',         description: 'Email padded to 300 chars.',              email: 'a'.repeat(290)+'@'+domain, password, confirmPassword: password,       expectedOutcome: 'failure', expectedBehavior: 'Server returns 400/413/422.' },
    { name: 'Invalid Email Format', description: 'Malformed email string.',               email: 'notanemail',               password, confirmPassword: password,       expectedOutcome: 'failure', expectedBehavior: 'Email format validation rejects input.' },
    { name: 'Weak Password',      description: 'Password too short or simple.',           email: `weakpw_${ts}@${domain}`,   password: '123', confirmPassword: '123',   expectedOutcome: 'failure', expectedBehavior: 'Password strength validation blocks submission.' },
    { name: 'Email Enumeration',  description: 'Error should not reveal account existence.', email,                         password, confirmPassword: password,       expectedOutcome: 'failure', expectedBehavior: 'Generic error message shown; no account existence revealed.' },
  ];
}

export function validate(observations, testName) {
  const findings = [];
  for (const obs of observations) {
    if (!obs.isAuthRelated) continue;
    if (testName === 'Email Enumeration' && obs.responseStatus >= 400) {
      const p = JSON.stringify(obs.responsePayload || '').toLowerCase();
      if (p.includes('already exists') || p.includes('already registered') || p.includes('email taken')) {
        findings.push({ severity: 'warning', category: 'email_enumeration', message: `${obs.method} ${obs.pathname} reveals whether an email is registered.`, explain: 'Use a generic error to prevent email enumeration attacks.', detail: { url: obs.url } });
      }
    }
  }
  return findings;
}

export function buildAiPrompt(pageContext, credentials) {
  return `You are a QA engineer testing a Signup page.
Page: ${pageContext.url}
Has confirm-password: ${pageContext.hasConfirmPassword}
OAuth: ${pageContext.oauthProviders?.join(', ') || 'none'}
Visible text: "${(pageContext.visibleText || '').substring(0, 300)}"
Email: ${credentials.email}, Password: ${credentials.password}

Core tests are ALREADY included. Generate 3-5 ADDITIONAL edge cases. No duplicates.
Return ONLY JSON array: [{"name","description","email","password","expectedOutcome","expectedBehavior"}]`;
}

export default { meta, testCases, validate, buildAiPrompt };