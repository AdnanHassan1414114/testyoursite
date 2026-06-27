/**
 * ApiObservation.js
 * -----------------
 * Canonical data structure for a single captured network request/response pair.
 *
 * Every field produced by playwrightService.js conforms to this shape.
 * Nothing in this file talks to a database — it is a pure in-memory model
 * used during the test-execution lifecycle.
 */

// ---------------------------------------------------------------------------
// Auth-pattern registry
// ---------------------------------------------------------------------------
// Paths that strongly suggest an authentication API.  The list is ordered
// from most-specific to least-specific so that earlier matches "win" when
// we later add per-pattern metadata (e.g. severity, category).
export const AUTH_PATTERNS = [
  // Core auth verbs
  { pattern: /\/login/i,           label: 'login'         },
  { pattern: /\/logout/i,          label: 'logout'        },
  { pattern: /\/signin/i,          label: 'signin'        },
  { pattern: /\/signout/i,         label: 'signout'       },
  { pattern: /\/sign-in/i,         label: 'signin'        },
  { pattern: /\/sign-out/i,        label: 'signout'       },
  { pattern: /\/log-in/i,          label: 'login'         },
  { pattern: /\/log-out/i,         label: 'logout'        },

  // Token management
  { pattern: /\/token/i,           label: 'token'         },
  { pattern: /\/refresh[-_]?token/i, label: 'refresh-token' },
  { pattern: /\/access[-_]?token/i,  label: 'access-token'  },
  { pattern: /\/revoke/i,          label: 'revoke'        },

  // Auth namespaces
  { pattern: /\/auth\//i,          label: 'auth'          },
  { pattern: /\/authenticate/i,    label: 'authenticate'  },
  { pattern: /\/authorization/i,   label: 'authorization' },

  // Session management
  { pattern: /\/session/i,         label: 'session'       },
  { pattern: /\/sessions/i,        label: 'session'       },

  // Identity / SSO / OAuth
  { pattern: /\/oauth/i,           label: 'oauth'         },
  { pattern: /\/oidc/i,            label: 'oidc'          },
  { pattern: /\/sso/i,             label: 'sso'           },
  { pattern: /\/saml/i,            label: 'saml'          },
  { pattern: /\/identity/i,        label: 'identity'      },
  { pattern: /\/callback/i,        label: 'oauth-callback'},

  // Account / user self
  { pattern: /\/account/i,         label: 'account'       },
  { pattern: /\/user\/me/i,        label: 'user-self'     },
  { pattern: /\/me$/i,             label: 'user-self'     },
  { pattern: /\/profile/i,         label: 'profile'       },

  // Password flows
  { pattern: /\/password/i,        label: 'password'      },
  { pattern: /\/forgot[-_]?password/i, label: 'forgot-password' },
  { pattern: /\/reset[-_]?password/i,  label: 'reset-password'  },
  { pattern: /\/change[-_]?password/i, label: 'change-password' },

  // MFA / OTP
  { pattern: /\/mfa/i,             label: 'mfa'           },
  { pattern: /\/otp/i,             label: 'otp'           },
  { pattern: /\/2fa/i,             label: '2fa'           },
  { pattern: /\/verify/i,          label: 'verify'        },
];

/**
 * Classify a URL as auth-related.
 *
 * @param {string} url
 * @returns {{ isAuthRelated: boolean, authLabel: string|null }}
 */
export function classifyUrl(url) {
  let pathname = url;
  try { pathname = new URL(url).pathname; } catch { /* keep raw */ }

  for (const { pattern, label } of AUTH_PATTERNS) {
    if (pattern.test(pathname)) {
      return { isAuthRelated: true, authLabel: label };
    }
  }
  return { isAuthRelated: false, authLabel: null };
}

// ---------------------------------------------------------------------------
// Factory — creates a blank observation with all fields at their zero values.
// playwrightService fills these in during route interception.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ApiObservation
 * @property {string}       id               — locally unique (index in capturedRequests[])
 * @property {string}       method           — HTTP verb, upper-cased
 * @property {string}       url              — full request URL
 * @property {string}       pathname         — URL pathname only
 * @property {boolean}      isAuthRelated    — matched an AUTH_PATTERN
 * @property {string|null}  authLabel        — which auth category matched
 * @property {Object}       requestHeaders
 * @property {any|null}     requestPayload   — parsed JSON or { raw: string } fallback
 * @property {number|null}  responseStatus
 * @property {Object}       responseHeaders
 * @property {any|null}     responsePayload  — parsed JSON or { raw: string } fallback
 * @property {string|null}  responseContentType
 * @property {number|null}  responseTimeMs
 * @property {string|null}  initiatorType    — 'fetch' | 'xhr' | 'other'
 * @property {string|null}  error            — set if the request itself failed (no response)
 * @property {number}       capturedAt       — Date.now() at capture time
 */

/**
 * Create a zero-value ApiObservation.
 *
 * @param {string} method
 * @param {string} url
 * @param {string|null} [pageUrl]  — the URL of the page under test. Used to
 *   tag this request as same-site or third-party (e.g. a Google OAuth call
 *   triggered from your login page). Pass null/omit if unknown.
 * @returns {ApiObservation}
 */
export function createObservation(method, url, pageUrl = null) {
  let pathname = url;
  try { pathname = new URL(url).pathname; } catch { /* keep raw */ }

  const { isAuthRelated, authLabel } = classifyUrl(url);

  let isThirdParty = false;
  if (pageUrl) {
    try {
      isThirdParty = new URL(url).hostname !== new URL(pageUrl).hostname;
    } catch { /* leave as false if either URL is unparseable */ }
  }

  return {
    id: null,                   // caller may set to a sequential index or UUID
    method: method.toUpperCase(),
    url,
    pathname,
    isAuthRelated,
    authLabel,
    isThirdParty,                // true = a call to a domain other than the page under test (e.g. Google, an SSO provider)
    requestHeaders:      {},
    requestPayload:      null,
    responseStatus:      null,
    responseHeaders:     {},
    responsePayload:     null,
    responseContentType: null,
    responseTimeMs:      null,
    initiatorType:       null,
    error:               null,
    capturedAt:          Date.now(),
  };
}

/**
 * Safely parse a text body as JSON.
 * Falls back to { raw: firstN } so callers always get an object, never throw.
 *
 * @param {string|null} text
 * @param {number}      [maxRawLen=2000]
 * @returns {any|null}
 */
export function safeParseBody(text, maxRawLen = 2000) {
  if (!text || text.trim() === '') return null;
  try { return JSON.parse(text); } catch { return { raw: text.substring(0, maxRawLen) }; }
}

/**
 * Decide whether a request is interesting enough to intercept and capture.
 * We capture:
 *   - All auth-related requests regardless of method
 *   - All non-GET requests (POST / PUT / PATCH / DELETE) site-wide
 *
 * GET requests to non-auth paths are let through without capture to avoid
 * flooding the observations list with static-asset loads.
 *
 * @param {string} method
 * @param {string} url
 * @returns {boolean}
 */
export function shouldCapture(method, url) {
  const { isAuthRelated } = classifyUrl(url);
  if (isAuthRelated) return true;
  return method.toUpperCase() !== 'GET';
}