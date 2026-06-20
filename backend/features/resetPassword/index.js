export const meta = {
  name: 'Reset Password', description: 'Test password reset flows using tokens: valid/expired/invalid tokens, password rules, success.',
  fieldHints: ['password', 'new password', 'confirm password', 'reset'],
  submitHints: ['reset password', 'set new password', 'update password', 'save', 'submit'],
};
export function testCases({ email = 'test@example.com', password = 'TestPass123!' } = {}) {
  return [
    { name: 'Valid Reset Token',       description: 'Submit new password with valid unexpired token.',  email, password: 'NewSecurePass456!', token: 'VALID_TOKEN_PLACEHOLDER',   confirmPassword: 'NewSecurePass456!', expectedOutcome: 'success', expectedBehavior: 'Password updated; user redirected to login.' },
    { name: 'Expired Token',           description: 'Submit with an expired reset token.',              email, password: 'NewSecurePass456!', token: 'EXPIRED_TOKEN_PLACEHOLDER', confirmPassword: 'NewSecurePass456!', expectedOutcome: 'failure', expectedBehavior: 'Server returns error: token expired.' },
    { name: 'Invalid Token',           description: 'Submit with a tampered or invalid token.',         email, password: 'NewSecurePass456!', token: 'invalid_token_xyz_000',     confirmPassword: 'NewSecurePass456!', expectedOutcome: 'failure', expectedBehavior: 'Server rejects token with 400/401/422.' },
    { name: 'Password Mismatch',       description: 'New password and confirm do not match.',           email, password: 'NewSecurePass456!', token: 'VALID_TOKEN_PLACEHOLDER',   confirmPassword: 'DifferentPass789!', expectedOutcome: 'failure', expectedBehavior: 'Validation error; password not changed.' },
    { name: 'Weak Password',           description: 'Submit a new password that is too weak.',          email, password: '123',               token: 'VALID_TOKEN_PLACEHOLDER',   confirmPassword: '123',               expectedOutcome: 'failure', expectedBehavior: 'Password strength validation rejects input.' },
    { name: 'Successful Password Reset', description: 'Complete the full reset with valid token.',      email, password: 'BrandNew$ecure2025!', token: 'VALID_TOKEN_PLACEHOLDER', confirmPassword: 'BrandNew$ecure2025!', expectedOutcome: 'success', expectedBehavior: 'Password updated; old token invalidated.' },
  ];
}
export function validate(observations, testName) {
  const findings = [];
  for (const obs of observations) {
    if (!obs.isAuthRelated) continue;
    if (testName === 'Invalid Token' && obs.responseStatus === 200) {
      findings.push({ severity: 'error', category: 'token_not_validated', message: `${obs.method} ${obs.pathname} accepted an invalid reset token (returned 200).`, explain: 'Password reset endpoints must validate tokens before allowing changes.', detail: { url: obs.url } });
    }
  }
  return findings;
}
export function buildAiPrompt(pageContext, credentials) {
  return `You are a QA engineer testing a Reset Password page.
Page: ${pageContext.url}, Email: ${credentials.email}
Core tests (valid token, expired, invalid, mismatch, weak password, successful reset) are ALREADY included.
Generate 3-5 ADDITIONAL edge cases (e.g. token reuse, brute-force, CSRF).
Return ONLY JSON array: [{"name","description","email","password","expectedOutcome","expectedBehavior"}]`;
}
export default { meta, testCases, validate, buildAiPrompt };