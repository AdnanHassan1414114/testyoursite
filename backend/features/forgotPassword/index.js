export const meta = {
  name: 'Forgot Password', description: 'Test forgot-password flows: valid/invalid email, non-existent users, and error handling.',
  fieldHints: ['email', 'username', 'forgot', 'reset', 'recover'],
  submitHints: ['send reset link', 'reset password', 'send link', 'submit', 'continue', 'recover'],
};
export function testCases({ email = 'test@example.com' } = {}) {
  const [, domain] = email.includes('@') ? email.split('@') : ['test', 'example.com'];
  return [
    { name: 'Valid Email',         description: 'Submit with a registered email address.',          email,                                   password: '', expectedOutcome: 'success', expectedBehavior: 'Success message shown; reset email sent.' },
    { name: 'Invalid Email Format',description: 'Submit a malformed email string.',                 email: 'notanemail',                      password: '', expectedOutcome: 'failure', expectedBehavior: 'Email format validation rejects input.' },
    { name: 'Empty Email',         description: 'Submit with empty email field.',                   email: '',                               password: '', expectedOutcome: 'failure', expectedBehavior: 'Required-field validation blocks submission.' },
    { name: 'Non-Existing User',   description: 'Submit email not in the system.',                  email: `notregistered_${Date.now()}@${domain}`, password: '', expectedOutcome: 'success', expectedBehavior: 'Generic success message shown; no email-existence revealed.' },
    { name: 'Reset Email Sent',    description: 'Verify success state confirms email dispatched.',  email,                                   password: '', expectedOutcome: 'success', expectedBehavior: 'UI shows "Check your email" or similar message.' },
    { name: 'Error Handling',      description: 'Server error during forgot-password submission.',  email: `error_${Date.now()}@${domain}`,  password: '', expectedOutcome: 'failure', expectedBehavior: 'Graceful error message shown; no stack trace exposed.' },
  ];
}
export function validate(observations, testName) {
  const findings = [];
  for (const obs of observations) {
    if (!obs.isAuthRelated) continue;
    if (testName === 'Non-Existing User' && obs.responseStatus === 404) {
      findings.push({ severity: 'warning', category: 'email_enumeration', message: `${obs.method} ${obs.pathname} returned 404 for a non-existent account.`, explain: 'Returning 404 reveals which emails are registered. Always return 200 with a generic message.', detail: { url: obs.url, status: obs.responseStatus } });
    }
  }
  return findings;
}
export function buildAiPrompt(pageContext, credentials) {
  return `You are a QA engineer testing a Forgot Password page.
Page: ${pageContext.url}, Registered email: ${credentials.email}
Core tests (valid, invalid format, empty, non-existing user, reset sent, error) are ALREADY included.
Generate 3-5 ADDITIONAL edge cases (e.g. rate limiting, repeated requests, very long email).
Return ONLY JSON array: [{"name","description","email","password","expectedOutcome","expectedBehavior"}]`;
}
export default { meta, testCases, validate, buildAiPrompt };