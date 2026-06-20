export const meta = {
  name: 'OTP Verification', description: 'Test OTP/2FA flows: valid/invalid/expired codes, brute force, and resend.',
  fieldHints: ['otp', 'code', 'verification code', 'one-time', '2fa', 'mfa', 'authenticator'],
  submitHints: ['verify', 'confirm', 'submit', 'continue', 'validate'],
};
export function testCases({ email = 'test@example.com', password = 'TestPass123!' } = {}) {
  return [
    { name: 'Valid OTP',              description: 'Enter the correct unexpired OTP code.',             email, password, otp: '123456',          expectedOutcome: 'success', expectedBehavior: 'OTP accepted; user gains access.' },
    { name: 'Invalid OTP',            description: 'Enter a completely wrong OTP code.',                email, password, otp: '000000',          expectedOutcome: 'failure', expectedBehavior: 'OTP rejected with invalid-code error.' },
    { name: 'Expired OTP',            description: 'Enter a valid-format OTP after its window passed.', email, password, otp: 'EXPIRED_OTP',     expectedOutcome: 'failure', expectedBehavior: 'Server returns error: OTP expired.' },
    { name: 'Multiple Failed Attempts', description: 'Enter incorrect OTP multiple times.',             email, password, otp: '999999', repeatCount: 5, action: 'repeat_invalid_otp', expectedOutcome: 'failure', expectedBehavior: 'Account locked or rate-limited after multiple failures.' },
    { name: 'Resend OTP',             description: 'Request a new OTP be sent.',                       email, password, action: 'resend_otp',     expectedOutcome: 'success', expectedBehavior: 'New OTP dispatched; previous OTP invalidated.' },
    { name: 'Empty OTP',              description: 'Submit OTP form with empty code field.',            email, password, otp: '',                 expectedOutcome: 'failure', expectedBehavior: 'Required-field validation blocks submission.' },
  ];
}
export function validate(observations, testName) {
  const findings = [];
  for (const obs of observations) {
    if (!obs.isAuthRelated) continue;
    if (testName === 'Multiple Failed Attempts' && obs.responseStatus === 200) {
      findings.push({ severity: 'warning', category: 'missing_rate_limit', message: `${obs.method} ${obs.pathname} returned 200 on a repeated invalid OTP attempt.`, explain: 'Brute-force protection should throttle or lock accounts after several consecutive invalid OTP submissions.', detail: { url: obs.url } });
    }
  }
  return findings;
}
export function buildAiPrompt(pageContext, credentials) {
  return `You are a QA engineer testing an OTP/2FA verification page.
Page: ${pageContext.url}, Email: ${credentials.email}
MFA hints: ${pageContext.mfaHints?.join(', ') || 'none'}
Core tests (valid, invalid, expired, multiple failures, resend, empty) are ALREADY included.
Generate 3-5 ADDITIONAL edge cases (e.g. OTP with spaces, OTP reuse, very long input, special chars).
Return ONLY JSON array: [{"name","description","email","password","expectedOutcome","expectedBehavior"}]`;
}
export default { meta, testCases, validate, buildAiPrompt };