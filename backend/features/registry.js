/**
 * features/registry.js
 * ─────────────────────
 * Maps feature keys to their module implementations.
 *
 * To add a new feature:
 *   1. Create features/myFeature/index.js following the feature contract.
 *   2. Add one import + one entry below.
 *   3. Zero changes to the core pipeline.
 */
import login             from './login/index.js';
import signup            from './signup/index.js';
import logout            from './logout/index.js';
import forgotPassword    from './forgotPassword/index.js';
import resetPassword     from './resetPassword/index.js';
import emailVerification from './emailVerification/index.js';
import otpVerification   from './otpVerification/index.js';
import sessionManagement from './sessionManagement/index.js';
export const authenticationFeatureRegistry = {
  login,
  signup,
  logout,
  forgotPassword,
  resetPassword,
  emailVerification,
  otpVerification,
  sessionManagement,
};
/**
 * Get a feature module by key. Throws a clear error if not found.
 * @param {string} featureKey
 */
export function getFeature(featureKey) {
  const feature = authenticationFeatureRegistry[featureKey];
  if (!feature) {
    const available = Object.keys(authenticationFeatureRegistry).join(', ');
    throw new Error(
      `Unknown authentication feature: "${featureKey}". Available: ${available}`
    );
  }
  return feature;
}
/**
 * List all registered features — used by GET /api/tests/features.
 */
export function listFeatures() {
  return Object.entries(authenticationFeatureRegistry).map(([key, mod]) => ({
    key,
    name:        mod.meta.name,
    description: mod.meta.description,
  }));
}