# API Observation — Changes & Integration Guide

## What was added

### `backend/models/ApiObservation.js`  (new file)

Single source of truth for everything related to capturing network activity.

| Export | Purpose |
|---|---|
| `AUTH_PATTERNS` | Array of `{ pattern: RegExp, label: string }` — 30 URL patterns covering login, logout, token refresh, OAuth, MFA, password flows, session endpoints, and more. |
| `classifyUrl(url)` | Returns `{ isAuthRelated: boolean, authLabel: string\|null }`. Tested against the pathname only so query-strings never cause false negatives. |
| `createObservation(method, url)` | Factory that returns a zero-value `ApiObservation` object with every field pre-defined. |
| `safeParseBody(text)` | Parses JSON; on failure returns `{ raw: text.substring(0, 2000) }` — never throws. |
| `shouldCapture(method, url)` | Returns `true` for any auth-related URL **or** any non-GET request. Keeps the captured list focused; static asset GETs are passed through without interception. |

#### `ApiObservation` shape

```js
{
  id:                  number,        // sequential index within the test case
  method:              string,        // 'POST', 'GET', …
  url:                 string,        // full URL
  pathname:            string,        // URL pathname only
  isAuthRelated:       boolean,
  authLabel:           string|null,   // e.g. 'login', 'refresh-token', 'oauth'
  requestHeaders:      Object,
  requestPayload:      any|null,      // parsed JSON or { raw } fallback
  responseStatus:      number|null,
  responseHeaders:     Object,
  responsePayload:     any|null,      // parsed JSON, truncated text, or null for binary
  responseContentType: string|null,
  responseTimeMs:      number|null,
  initiatorType:       'fetch'|'xhr'|'other'|null,
  error:               string|null,   // set only if request failed entirely
  capturedAt:          number,        // Date.now() at observation creation
}
```

---

### `backend/services/playwrightService.js`  (updated)

#### New private function: `attachApiObserver(page)`

Wires `page.route('**/*', …)` and returns a **live array reference** that is
populated as requests fire during the test.

Key behaviours:

1. **Selective capture** — calls `shouldCapture(method, url)`.  
   Non-auth GETs call `route.continue()` and are never stored.

2. **Request capture** — reads `req.postData()` and respects the
   `Content-Type` header: `application/json` → JSON parse,
   `application/x-www-form-urlencoded` → `URLSearchParams` → plain object,
   anything else → `safeParseBody` with `{ raw }` fallback.

3. **Response capture** — calls `route.fetch()` (the real upstream response),
   reads the body buffer **once**, parses it by content-type, stores it in
   the observation, then calls `route.fulfill({ body: buffer })` so the page
   still receives the real bytes.

4. **Timing** — `responseTimeMs` wraps only the `route.fetch()` round-trip,
   not Playwright overhead.

5. **Failure handling** — if `route.fetch()` rejects (server down, CORS
   abort, etc.), the observation is saved with `error` set and `responseStatus`
   / `responseTimeMs` left `null`, then `route.abort()` is called so
   Playwright doesn't hang.

6. **`initiatorType`** — inferred from Playwright's `req.resourceType()`
   (`'fetch'` / `'xhr'` / `'other'`).

#### `runTestCase()` changes

- Calls `attachApiObserver(page)` immediately after creating the page (before
  `page.goto`), so the very first redirect or preflight is captured.
- Returns `capturedRequests: ApiObservation[]` — the same array that the
  route handler populates — as part of its result object. Nothing else in the
  return signature changed.
- Logs a one-line summary per test case:  
  `[Playwright] "Valid Login" — status=passed | captured=4 requests (2 auth-related) | duration=3812ms`

---

## How existing code connects

`tests.js` already iterates `result.capturedRequests` and saves each entry to
`api_requests`.  Because `ApiObservation` fields map 1-to-1 to the INSERT
columns, **no changes to `tests.js` are needed** for the new structure to flow
into the database.

The renamed / new fields (`pathname`, `authLabel`, `responseContentType`,
`initiatorType`, `capturedAt`) are not yet persisted — they live in memory
during the test run and are available for any future processing step
(validation, report enrichment, real-time streaming) without a schema change.

---

## Auth patterns covered

| Label | Matched paths (examples) |
|---|---|
| `login` | `/login`, `/log-in` |
| `logout` | `/logout`, `/log-out` |
| `signin` / `signout` | `/signin`, `/sign-in`, `/sign-out` |
| `token` | `/token`, `/access-token` |
| `refresh-token` | `/refresh-token`, `/refresh_token` |
| `revoke` | `/revoke` |
| `auth` | `/auth/anything` |
| `authenticate` | `/authenticate` |
| `session` | `/session`, `/sessions` |
| `oauth` | `/oauth`, `/oauth/callback` |
| `oidc` | `/oidc` |
| `sso` | `/sso` |
| `saml` | `/saml` |
| `identity` | `/identity` |
| `oauth-callback` | `/callback` |
| `account` | `/account` |
| `user-self` | `/user/me`, `/me` |
| `profile` | `/profile` |
| `password` | `/password`, `/forgot-password`, `/reset-password`, `/change-password` |
| `mfa` / `otp` / `2fa` | `/mfa`, `/otp`, `/2fa` |
| `verify` | `/verify` |