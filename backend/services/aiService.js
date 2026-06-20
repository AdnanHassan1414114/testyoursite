/**
 * services/aiService.js
 * ──────────────────────
 * AI service layer.
 *
 * Exports:
 *   scanPageForContext(url)        — deep Playwright page scan
 *   generateEdgeCases(prompt)      — calls OpenAI with feature-specific prompt,
 *                                    returns additional TestCase[]
 *
 * The AI only generates EXTRA edge cases.
 * Core predefined tests live in each feature module.
 */

import OpenAI   from 'openai';
import { chromium } from 'playwright';
import fs        from 'fs';
import { execSync } from 'child_process';
import dotenv    from 'dotenv';
dotenv.config();

const MODEL       = 'gpt-4o-mini';
const MAX_TOKENS  = 2000;
const TEMPERATURE = 0.3;

// ── Chrome detection ──────────────────────────────────────────────────────────

function findChromePath() {
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch (_) {}

  const candidates = [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',      '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/opt/google/chrome/chrome',
    `${process.env.HOME}/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome`,
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      const found = execSync(`which ${cmd} 2>/dev/null`).toString().trim();
      if (found && fs.existsSync(found)) return found;
    } catch (_) {}
  }
  return null;
}

// ── scanPageForContext ────────────────────────────────────────────────────────

/**
 * Deep Playwright scan — returns a rich PageContext object used by each
 * feature module's buildAiPrompt() to generate page-specific edge cases.
 *
 * Framework-agnostic: uses type/name/placeholder/aria — no CSS classes.
 *
 * @param {string} url
 * @returns {Promise<PageContext>}
 */
export async function scanPageForContext(url) {
  const chromePath = findChromePath();
  if (!chromePath) {
    console.warn('[aiService] No Chrome found — using minimal context.');
    return {
      url, title: '', pageType: 'unknown',
      oauthProviders: [], mfaHints: [], inputFields: [], visibleText: '',
      hasEmailField: false, hasPasswordField: false, hasConfirmPassword: false,
      hasRememberMe: false, hasCaptcha: false,
    };
  }

  let browser;
  try {
    browser = await chromium.launch({
      executablePath: chromePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      headless: true,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    const ctx = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));

      // ── Field presence (type/name/placeholder/aria — no CSS classes) ──────
      const hasEmailField = inputs.some(i =>
        ['email', 'username', 'user', 'login'].some(k =>
          (i.type || '').includes(k) || (i.name || '').includes(k) ||
          (i.id   || '').includes(k) || (i.placeholder || '').toLowerCase().includes(k)
        )
      );
      const hasUsernameField    = inputs.some(i =>
        (i.name || '').toLowerCase().includes('user') ||
        (i.id   || '').toLowerCase().includes('user')
      );
      const hasPasswordField    = inputs.some(i => i.type === 'password');
      const hasConfirmPassword  = inputs.filter(i => i.type === 'password').length >= 2;
      const hasRememberMe       = inputs.some(i =>
        i.type === 'checkbox' &&
        ['remember', 'keep', 'stay'].some(k => (i.name || i.id || '').toLowerCase().includes(k))
      );
      const hasCaptcha =
        !!document.querySelector('[data-sitekey], .g-recaptcha, .h-captcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]');

      // ── OAuth providers ───────────────────────────────────────────────────
      const bodyText = (document.body.innerText || '').toLowerCase();
      const oauthProviders = [];
      const PROVIDERS = {
        Google:    ['google', 'sign in with google', 'continue with google'],
        GitHub:    ['github'],
        Facebook:  ['facebook', 'sign in with facebook'],
        Apple:     ['apple', 'sign in with apple'],
        Twitter:   ['twitter', 'x.com'],
        LinkedIn:  ['linkedin'],
        Microsoft: ['microsoft'],
        Discord:   ['discord'],
        Slack:     ['slack'],
      };
      for (const [name, keywords] of Object.entries(PROVIDERS)) {
        if (keywords.some(k => bodyText.includes(k))) oauthProviders.push(name);
      }

      // ── MFA hints ─────────────────────────────────────────────────────────
      const mfaHints = [];
      if (['otp', '2fa', 'two-factor', 'authenticator', 'verification code', 'sms code'].some(k => bodyText.includes(k)))
        mfaHints.push('OTP/2FA');
      if (['passkey', 'webauthn', 'biometric'].some(k => bodyText.includes(k)))
        mfaHints.push('Passkey/WebAuthn');

      // ── Page type ─────────────────────────────────────────────────────────
      const pageType =
        ['sign up', 'create account', 'register', 'join'].some(k => bodyText.includes(k)) && hasConfirmPassword
          ? 'signup'
          : ['forgot', 'reset', 'recover'].some(k => bodyText.includes(k))
            ? 'forgot-password'
            : ['otp', '2fa', 'verification code'].some(k => bodyText.includes(k))
              ? 'otp'
              : ['verify', 'confirm your email'].some(k => bodyText.includes(k))
                ? 'email-verification'
                : ['sign in', 'log in', 'login', 'welcome back'].some(k => bodyText.includes(k))
                  ? 'login'
                  : 'unknown';

      // ── Links ─────────────────────────────────────────────────────────────
      const links = Array.from(document.querySelectorAll('a')).map(a => ({
        text: (a.textContent || '').trim().toLowerCase(),
        href: a.href || '',
      }));
      const forgotLink = links.find(l => ['forgot', 'reset', 'recover'].some(k => l.text.includes(k)));
      const signupLink = links.find(l => ['sign up', 'register', 'create account', 'join', 'get started'].some(k => l.text.includes(k)));

      const inputFields = inputs
        .filter(i => i.type !== 'hidden' && i.type !== 'submit')
        .map(i => ({ name: i.name || '', type: i.type || 'text', placeholder: i.placeholder || '', id: i.id || '' }));

      return {
        title: document.title,
        pageType,
        hasEmailField,
        hasUsernameField,
        hasPasswordField,
        hasConfirmPassword,
        hasRememberMe,
        hasCaptcha,
        forgotPasswordLink: forgotLink?.href || null,
        signupLink:         signupLink?.href || null,
        oauthProviders,
        mfaHints,
        inputFields,
        formAction: document.querySelector('form')?.action || null,
        visibleText: (document.body.innerText || '').replace(/\s+/g, ' ').trim().substring(0, 800),
      };
    });

    return { url, ...ctx };

  } catch (err) {
    console.warn(`[aiService] Page scan failed: ${err.message} — using minimal context`);
    return {
      url, title: '', pageType: 'unknown',
      oauthProviders: [], mfaHints: [], inputFields: [], visibleText: '',
      hasEmailField: false, hasPasswordField: false, hasConfirmPassword: false,
      hasRememberMe: false, hasCaptcha: false,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── generateEdgeCases ─────────────────────────────────────────────────────────

/**
 * Calls OpenAI with the feature module's prompt and returns additional
 * TestCase objects. Returns [] if no API key or AI fails.
 *
 * @param {string} featurePrompt  — built by featureModule.buildAiPrompt()
 * @returns {Promise<TestCase[]>}
 */
export async function generateEdgeCases(featurePrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  const hasKey = apiKey && apiKey !== 'your_openai_api_key_here' && apiKey.trim() !== '';

  if (!hasKey) {
    console.info('[aiService] No OPENAI_API_KEY — skipping AI edge case generation.');
    return [];
  }

  try {
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model:       MODEL,
      max_tokens:  MAX_TOKENS,
      temperature: TEMPERATURE,
      messages: [
        {
          role:    'system',
          content: 'You are a senior QA engineer. You generate additional edge-case test cases for web authentication features. You ALWAYS return a valid JSON array and nothing else.',
        },
        { role: 'user', content: featurePrompt },
      ],
    });

    const raw     = response.choices[0].message.content.trim();
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    const cases  = normaliseTestCases(parsed);
    console.info(`[aiService] Generated ${cases.length} AI edge cases.`);
    return cases;

  } catch (err) {
    console.warn(`[aiService] generateEdgeCases failed: ${err.message}`);
    return [];
  }
}

// ── Normalise ─────────────────────────────────────────────────────────────────

function normaliseTestCases(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(tc => tc && typeof tc === 'object')
    .map(tc => ({
      name:             String(tc.name             || 'AI Edge Case').trim(),
      description:      String(tc.description      || '').trim(),
      email:            tc.email    != null ? String(tc.email)    : '',
      password:         tc.password != null ? String(tc.password) : '',
      expectedOutcome:  ['success', 'failure'].includes(tc.expectedOutcome) ? tc.expectedOutcome : 'failure',
      expectedBehavior: String(tc.expectedBehavior || '').trim(),
    }))
    .filter(tc => tc.name.length > 0);
}