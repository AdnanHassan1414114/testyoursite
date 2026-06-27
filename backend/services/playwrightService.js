/**
 * services/playwrightService.js
 * ──────────────────────────────
 * Framework-agnostic Playwright execution layer.
 *
 * NO CSS class selectors. Elements located by:
 *   input[type], placeholder, aria-label, autocomplete,
 *   name/id attributes, button visible text, role="button"
 *
 * Works across: React, Next.js, Angular, Vue, Bootstrap,
 * Tailwind CSS, Material UI, Ant Design, plain HTML.
 */

import { chromium }      from 'playwright';
import path              from 'path';
import { fileURLToPath } from 'url';
import fs                from 'fs';
import { execSync }      from 'child_process';
import { createObservation, shouldCapture, safeParseBody } from '../models/ApiObservation.js';

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, '../screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// ── Chrome detection ──────────────────────────────────────────────────────────

function findChromePath() {
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch (_) {}

  const candidates = [
    // ── Nix / Railway ──
    '/run/current-system/sw/bin/chromium',
    '/nix/var/nix/profiles/default/bin/chromium',
    // ── Linux ──
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    // ── macOS ──
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // ── Puppeteer cache (local) ──
    `${process.env.HOME}/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome`,
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  for (const cmd of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      const found = execSync(`which ${cmd} 2>/dev/null`).toString().trim();
      if (found && fs.existsSync(found)) return found;
    } catch (_) {}
  }
  return null;
}

const CHROME_PATH = findChromePath();
if (CHROME_PATH) {
  console.log(`[Playwright] Using Chrome at: ${CHROME_PATH}`);
} else {
  console.error('[Playwright] WARNING: No Chrome found. Run: npx playwright install chromium');
}

async function launchBrowser() {
  if (!CHROME_PATH) throw new Error('No Chrome executable found. Run: npx playwright install chromium');
  return chromium.launch({
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true,
  });
}

// ── Semantic input selectors (no CSS classes) ─────────────────────────────────

function buildInputSelectors(fieldType) {
  switch (fieldType) {
    case 'email':
      return [
        'input[type="email"]',
        'input[autocomplete="email"]',
        'input[autocomplete="username"]',
        'input[name="email"]',
        'input[name="username"]',
        'input[name="user"]',
        'input[name="login"]',
        'input[id*="email" i]',
        'input[id*="user" i]',
        'input[placeholder*="email" i]',
        'input[placeholder*="username" i]',
        'input[aria-label*="email" i]',
        'input[aria-label*="username" i]',
      ];
    case 'password':
      return [
        'input[type="password"][autocomplete="current-password"]',
        'input[type="password"][name*="password" i]',
        'input[type="password"]:not([name*="confirm" i]):not([id*="confirm" i])',
        'input[type="password"]',
      ];
    case 'confirmPassword':
      return [
        'input[type="password"][name*="confirm" i]',
        'input[type="password"][name*="repeat" i]',
        'input[type="password"][id*="confirm" i]',
        'input[type="password"][autocomplete="new-password"]',
        'input[type="password"][placeholder*="confirm" i]',
        'input[type="password"][aria-label*="confirm" i]',
      ];
    case 'otp':
      return [
        'input[name*="otp" i]',
        'input[name*="code" i]',
        'input[id*="otp" i]',
        'input[id*="code" i]',
        'input[placeholder*="code" i]',
        'input[aria-label*="code" i]',
        'input[aria-label*="otp" i]',
        'input[maxlength="6"]',
        'input[inputmode="numeric"]',
      ];
    case 'username':
      return [
        'input[name="username"]',
        'input[name="user"]',
        'input[id*="username" i]',
        'input[placeholder*="username" i]',
        'input[aria-label*="username" i]',
        'input[autocomplete="username"]',
      ];
    case 'token':
      return [
        'input[name*="token" i]',
        'input[name*="reset" i]',
        'input[id*="token" i]',
        'input[placeholder*="token" i]',
        'input[aria-label*="token" i]',
      ];
    default:
      return ['input'];
  }
}

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Sign in")',
  'button:has-text("Sign In")',
  'button:has-text("Log in")',
  'button:has-text("Log In")',
  'button:has-text("Login")',
  'button:has-text("Continue")',
  'button:has-text("Submit")',
  'button:has-text("Sign Up")',
  'button:has-text("Register")',
  'button:has-text("Create Account")',
  'button:has-text("Reset Password")',
  'button:has-text("Send")',
  'button:has-text("Verify")',
  'button:has-text("Confirm")',
  '[role="button"][aria-label*="submit" i]',
  '[role="button"][aria-label*="login" i]',
  '[role="button"][aria-label*="sign" i]',
];

async function findFirstSelector(page, selectors, timeout = 5000) {
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout, state: 'visible' });
      return sel;
    } catch (_) {}
  }
  return null;
}

// ── detectPageElements ────────────────────────────────────────────────────────

export async function detectPageElements(url) {
  const browser = await launchBrowser();
  const page    = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    const detected = await page.evaluate(() => {
      function firstMatch(selectors) {
        for (const s of selectors) {
          try { const el = document.querySelector(s); if (el) return s; } catch (_) {}
        }
        return null;
      }

      const emailSel = firstMatch([
        'input[type="email"]', 'input[autocomplete="email"]',
        'input[name="email"]', 'input[name="username"]',
        'input[id*="email" i]', 'input[placeholder*="email" i]',
        'input[aria-label*="email" i]', 'input[aria-label*="username" i]',
      ]);
      const passwordSel = firstMatch(['input[type="password"]']);
      const buttonEl    = document.querySelector(
        'button[type="submit"], input[type="submit"], button, [role="button"]'
      );
      const buttonSel  = buttonEl
        ? (buttonEl.id ? `#${buttonEl.id}` : buttonEl.type === 'submit' ? 'button[type="submit"]' : 'button')
        : 'button[type="submit"]';
      const buttonText = buttonEl ? (buttonEl.textContent || buttonEl.value || 'Submit').trim() : 'Submit';

      return {
        emailSelector:    emailSel,
        passwordSelector: passwordSel,
        buttonSelector:   buttonSel,
        buttonText,
        hasEmailField:    !!emailSel,
        hasPasswordField: !!passwordSel,
        title:            document.title,
      };
    });

    return { url, ...detected };
  } finally {
    await browser.close();
  }
}

// ── API observer ──────────────────────────────────────────────────────────────

async function attachApiObserver(page, pageUrl) {
  const capturedRequests = [];
  let   observationIndex = 0;

  await page.route('**/*', async (route) => {
    const req    = route.request();
    const method = req.method();
    const url    = req.url();

    if (!shouldCapture(method, url)) { await route.continue(); return; }

    const obs = createObservation(method, url, pageUrl);
    obs.id    = observationIndex++;
    obs.requestHeaders = req.headers();

    const rawPost = req.postData();
    if (rawPost) {
      const ct = (obs.requestHeaders['content-type'] || '').toLowerCase();
      if (ct.includes('application/json')) {
        obs.requestPayload = safeParseBody(rawPost);
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        try { obs.requestPayload = Object.fromEntries(new URLSearchParams(rawPost)); }
        catch { obs.requestPayload = { raw: rawPost.substring(0, 2000) }; }
      } else {
        obs.requestPayload = safeParseBody(rawPost) ?? { raw: rawPost.substring(0, 2000) };
      }
    }

    try {
      const t0       = Date.now();
      const response = await route.fetch();
      obs.responseTimeMs      = Date.now() - t0;
      obs.responseStatus      = response.status();
      obs.responseHeaders     = response.headers();
      const ct                = (obs.responseHeaders['content-type'] || '').toLowerCase();
      obs.responseContentType = ct || null;

      const bodyBuffer = await response.body();
      const bodyText   = bodyBuffer.toString('utf-8');

      if (ct.includes('application/json') || ct.includes('text/json')) {
        obs.responsePayload = safeParseBody(bodyText);
      } else if (ct.includes('text/')) {
        obs.responsePayload = bodyText.length > 0 ? { raw: bodyText.substring(0, 4000) } : null;
      }

      try {
        const rt = req.resourceType();
        obs.initiatorType = rt === 'fetch' ? 'fetch' : rt === 'xhr' ? 'xhr' : 'other';
      } catch { obs.initiatorType = 'other'; }

      capturedRequests.push(obs);
      await route.fulfill({ status: obs.responseStatus, headers: obs.responseHeaders, body: bodyBuffer });

    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      const isNavAbort =
        msg.includes('navigation') || msg.includes('page closed') ||
        msg.includes('target closed') || msg.includes('execution context was destroyed') ||
        msg.includes('frame was detached') || msg.includes('request context disposed') ||
        msg.includes('route was handled') || msg.includes('context or browser has been closed');

      if (isNavAbort) {
        obs.navigationAborted = true;
        obs.error = null;
        capturedRequests.push(obs);
        try { await route.abort(); } catch (_) {}
        return;
      }
      obs.error = err.message;
      capturedRequests.push(obs);
      try { await route.abort(); } catch (_) {}
    }
  });

  return capturedRequests;
}

// ── runTestCase ───────────────────────────────────────────────────────────────

export async function runTestCase(testCase, pageInfo, runId) {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page    = await context.newPage();

  const consoleErrors = [];
  const networkErrors = [];
  const startTime     = Date.now();

  page.on('console',       msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('requestfailed', req => {
    networkErrors.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'failed'}`);
  });

  const capturedRequests = await attachApiObserver(page, pageInfo.url);

  let status        = 'passed';
  let errorMessage  = null;
  let screenshotPath = null;

  try {
    await page.goto(pageInfo.url, { waitUntil: 'networkidle', timeout: 30_000 });

    // Fill email / username
    if (testCase.email !== undefined) {
      const emailSel = pageInfo.emailSelector ||
        await findFirstSelector(page, buildInputSelectors('email'));
      if (emailSel) {
        await page.waitForSelector(emailSel, { timeout: 10_000 });
        await page.fill(emailSel, testCase.email);
      }
    }

    // Fill username (separate field, e.g. signup)
    if (testCase.username !== undefined) {
      const unSel = await findFirstSelector(page, buildInputSelectors('username'));
      if (unSel) await page.fill(unSel, testCase.username);
    }

    // Fill password
    if (testCase.password !== undefined) {
      const pwSel = pageInfo.passwordSelector ||
        await findFirstSelector(page, buildInputSelectors('password'));
      if (pwSel) {
        await page.waitForSelector(pwSel, { timeout: 10_000 });
        await page.fill(pwSel, testCase.password);
      }
    }

    // Fill confirm password (signup / reset password)
    if (testCase.confirmPassword !== undefined) {
      const cpSel = await findFirstSelector(page, buildInputSelectors('confirmPassword'));
      if (cpSel) await page.fill(cpSel, testCase.confirmPassword);
    }

    // Fill token (reset password / email verification)
    if (testCase.token !== undefined) {
      const tokenSel = await findFirstSelector(page, buildInputSelectors('token'));
      if (tokenSel) await page.fill(tokenSel, testCase.token);
    }

    // Fill OTP
    if (testCase.otp !== undefined) {
      const otpSel = await findFirstSelector(page, buildInputSelectors('otp'));
      if (otpSel) await page.fill(otpSel, testCase.otp);
    }

    // Click submit
    const btnSel = pageInfo.buttonSelector ||
      await findFirstSelector(page, SUBMIT_SELECTORS, 8000);
    if (btnSel) {
      await page.waitForSelector(btnSel, { timeout: 10_000 });
      await page.click(btnSel);
    }

    await page.waitForTimeout(2500);

    // ── Outcome heuristics ────────────────────────────────────────────────
    // NOTE: these are page-level signals only (URL/DOM text). They do NOT
    // know about captured API responses (status codes, tokens, cookies).
    // AuthenticationAgent.js combines this result with API findings to
    // produce the final severity shown in the UI — see _combineSeverity().
    const currentUrl  = page.url();
    const pageContent = await page.content();

    const errorPatterns   = [/invalid/i, /incorrect/i, /wrong/i, /error/i, /failed/i, /not found/i, /unauthorized/i, /bad credentials/i];
    const successPatterns = [/dashboard/i, /home/i, /welcome/i, /logout/i, /sign out/i];

    const hasError = errorPatterns.some(p => p.test(pageContent)) ||
      (consoleErrors.length > 0 && testCase.expectedOutcome === 'success');

    // A same-origin navigation to a page matching a known success pattern
    // is meaningful. A bare URL change is NOT — third-party identity
    // providers (Google/OAuth, MFA prompts, consent screens) change the
    // URL constantly without indicating the test's outcome either way.
    let originChanged = false;
    try {
      originChanged = new URL(currentUrl).origin !== new URL(pageInfo.url).origin;
    } catch (_) {}

    const hasSuccess = successPatterns.some(p => p.test(currentUrl)) ||
      (currentUrl !== pageInfo.url && !originChanged);

    if (testCase.expectedOutcome === 'success') {
      if (!hasSuccess || hasError) {
        status       = 'failed';
        errorMessage = hasError
          ? 'Expected success but got an error response.'
          : 'Expected success but no success indicator (URL/page change) was observed.';
      }
    } else {
      if (hasSuccess && !hasError) {
        status       = 'failed';
        errorMessage = 'Expected failure but the action appeared to succeed.';
      }
    }

  } catch (err) {
    status       = 'failed';
    errorMessage = err.message;
  }

  // Screenshot
  const screenshotName = `${runId}_${testCase.name.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.png`;
  screenshotPath = path.join(SCREENSHOTS_DIR, screenshotName);
  try {
    await page.screenshot({ path: screenshotPath, fullPage: false });
  } catch (_) { screenshotPath = null; }

  const durationMs = Date.now() - startTime;
  await browser.close();

  const authHits = capturedRequests.filter(r => r.isAuthRelated);
  console.log(
    `[Playwright] "${testCase.name}" — ${status} | ` +
    `captured=${capturedRequests.length} (${authHits.length} auth) | ${durationMs}ms`
  );

  return {
    status, errorMessage, consoleErrors, networkErrors,
    capturedRequests,
    screenshotPath: screenshotPath ? `/screenshots/${screenshotName}` : null,
    durationMs,
  };
}