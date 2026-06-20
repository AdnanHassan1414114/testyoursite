export const meta = {
  name: 'Email Verification', description: 'Test email verification link flows: valid/expired/invalid links, resend, verified user.',
  fieldHints: ['verification', 'verify', 'token', 'code'],
  submitHints: ['verify email', 'confirm email', 'verify', 'confirm', 'resend'],
};
export function testCases({ email = 'test@example.com', password = 'TestPass123!' } = {}) {
  return [
    { name: 'Valid Verification Link', description: 'Click a valid unexpired verification link.',     email, password, token: 'VALID_VERIFICATION_TOKEN',      expectedOutcome: 'success', expectedBehavior: 'Email verified; user redirected to app.' },
    { name: 'Expired Link',           description: 'Click a verification link after it expired.',    email, password, token: 'EXPIRED_VERIFICATION_TOKEN',     expectedOutcome: 'failure', expectedBehavior: 'Error shown; resend option offered.' },
    { name: 'Invalid Link',           description: 'Click a tampered or invalid verification link.', email, password, token: 'invalid_verification_token_xyz', expectedOutcome: 'failure', expectedBehavior: 'Server rejects token with 400/401/422.' },
    { name: 'Resend Verification',    description: 'Request verification email be sent again.',      email, password, action: 'resend_verification',             expectedOutcome: 'success', expectedBehavior: 'New verification email dispatched; success message shown.' },
    { name: 'Verified User Flow',     description: 'Already-verified user re-clicks the link.',     email, password, token: 'ALREADY_USED_TOKEN',              expectedOutcome: 'success', expectedBehavior: 'Graceful handling; user is already verified; redirected to app.' },
  ];
}
export function validate(observations, testName) {
  const findings = [];
  for (const obs of observations) {
    if (!obs.isAuthRelated) continue;
    if (testName === 'Invalid Link' && obs.responseStatus === 200) {
      findings.push({ severity: 'error', category: 'token_not_validated', message: `${obs.method} ${obs.pathname} accepted an invalid verification token.`, explain: 'Email verification endpoints must validate tokens. Accepting any token defeats email verification.', detail: { url: obs.url } });
    }
  }
  return findings;
}
export function buildAiPrompt(pageContext, credentials) {
  return `You are a QA engineer testing an Email Verification page.
Page: ${pageContext.url}, Email: ${credentials.email}
Core tests (valid link, expired, invalid, resend, already-verified) are ALREADY included.
Generate 3-5 ADDITIONAL edge cases (e.g. different browser, multiple pending verifications, resend rate limiting).
Return ONLY JSON array: [{"name","description","email","password","expectedOutcome","expectedBehavior"}]`;
}
export default { meta, testCases, validate, buildAiPrompt };