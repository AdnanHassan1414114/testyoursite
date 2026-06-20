/**
 * services/failureAnalysisService.js
 * ────────────────────────────────────
 * AI-powered failure analysis engine.
 * Accepts a structured failure context, calls OpenAI, returns RootCauseAnalysis.
 * Falls back to deterministic rule-based analysis when OpenAI is unavailable.
 *
 * Never throws — always returns a valid analysis object.
 * Never touches the database — caller (AuthenticationAgent) persists the result.
 */

import OpenAI  from 'openai';
import dotenv  from 'dotenv';
dotenv.config();

const MODEL             = 'gpt-4o-mini';
const MAX_TOKENS        = 500;
const TIMEOUT_MS        = 25_000;
const MAX_NETWORK_LOGS  = 3;
const MAX_PAYLOAD_CHARS = 500;

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeFailure(ctx) {
  const apiKey = process.env.OPENAI_API_KEY;
  const hasKey = apiKey && apiKey !== 'your_openai_api_key_here' && apiKey.trim() !== '';

  if (!hasKey) {
    console.info('[failureAnalysis] No OPENAI_API_KEY — using rule-based fallback.');
    return ruleBasedAnalysis(ctx);
  }

  try {
    const analysis = await callOpenAI(apiKey, ctx);
    console.info(`[failureAnalysis] "${ctx.testName}" — AI analysis complete (confidence: ${analysis.confidence}%)`);
    return analysis;
  } catch (err) {
    console.warn(`[failureAnalysis] OpenAI failed for "${ctx.testName}": ${err.message}. Using fallback.`);
    return ruleBasedAnalysis(ctx);
  }
}

// ── OpenAI call ───────────────────────────────────────────────────────────────

async function callOpenAI(apiKey, ctx) {
  const openai = new OpenAI({ apiKey });

  const networkSummary = buildNetworkSummary(ctx.capturedRequests, ctx.apiFindings);
  const consoleSummary = ctx.consoleErrors?.length
    ? ctx.consoleErrors.slice(0, 5).join('\n')
    : 'None';

  const userPrompt = `
Test Name: ${ctx.testName}
Description: ${ctx.testDescription || 'N/A'}

Expected Result:
${ctx.expectedResult}

Actual Result:
${ctx.actualResult}

Console Errors:
${consoleSummary}

Network Logs (auth-related requests only):
${networkSummary}

${ctx.apiFindings?.length
  ? `Validator Findings:\n${ctx.apiFindings.map(f => `[${f.severity}] ${f.category}: ${f.message}`).join('\n')}`
  : ''
}

Return ONLY a valid JSON object, no markdown, no explanation outside the JSON:
{
  "rootCause": "<one-sentence probable cause>",
  "impact": "<user-facing or system-level consequence>",
  "suggestedFix": "<concrete remediation step>",
  "confidence": <integer 0-100>
}`.trim();

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await openai.chat.completions.create(
      {
        model:       MODEL,
        max_tokens:  MAX_TOKENS,
        temperature: 0.2,
        messages: [
          {
            role:    'system',
            content: 'You are a senior QA Engineer specialising in web authentication systems. ' +
                     'Analyse test failures and return ONLY a JSON object with rootCause, ' +
                     'impact, suggestedFix, and confidence (integer 0–100). ' +
                     'Be specific and technical. Never include markdown or prose outside the JSON.',
          },
          { role: 'user', content: userPrompt },
        ],
      },
      { signal: controller.signal }
    );
  } finally {
    clearTimeout(timeout);
  }

  const raw     = response.choices[0].message.content.trim();
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed  = JSON.parse(cleaned);

  return {
    rootCause:    String(parsed.rootCause    || '').trim() || 'Root cause could not be determined.',
    impact:       String(parsed.impact       || '').trim() || 'Impact unknown.',
    suggestedFix: String(parsed.suggestedFix || '').trim() || 'No fix suggested.',
    confidence:   clampInt(parsed.confidence, 0, 100),
    source:       'openai',
  };
}

// ── Rule-based fallback ───────────────────────────────────────────────────────

function ruleBasedAnalysis(ctx) {
  const authRequests = (ctx.capturedRequests || []).filter(r => r.isAuthRelated);
  const statuses     = authRequests.map(r => r.responseStatus).filter(Boolean);
  const has5xx       = statuses.some(s => s >= 500);
  const has4xx       = statuses.some(s => s >= 400 && s < 500);
  const has429       = statuses.includes(429);
  const hasNetwork   = authRequests.some(r => r.responseStatus === null);

  const name   = (ctx.testName    || '').toLowerCase();
  const actual = (ctx.actualResult || '').toLowerCase();

  if (has5xx) {
    const status = statuses.find(s => s >= 500);
    return {
      rootCause:    `The authentication endpoint returned HTTP ${status}, indicating an unhandled server-side exception. This commonly occurs with oversized input, unexpected encoding, or unhandled edge cases.`,
      impact:       'Users submitting similar inputs may encounter a server error instead of a validation message.',
      suggestedFix: 'Add server-side input validation (length, encoding, character set) before the authentication handler. Return 400/422 for invalid input rather than allowing exceptions to propagate.',
      confidence:   78, source: 'fallback',
    };
  }

  if (has429) {
    return {
      rootCause:    'The server is rate-limiting authentication requests (HTTP 429). Running multiple tests in quick succession likely triggered the threshold.',
      impact:       'Legitimate users making repeated attempts may be blocked. Also affects automated testing pipelines.',
      suggestedFix: 'Add delays between test cases, whitelist the test runner IP, or disable rate limiting in the test environment.',
      confidence:   85, source: 'fallback',
    };
  }

  if (hasNetwork) {
    return {
      rootCause:    'No HTTP response was received from the authentication endpoint. The server may be unreachable, CORS may have blocked the preflight, or the endpoint URL has changed.',
      impact:       'Users cannot authenticate — the authentication flow is completely broken.',
      suggestedFix: 'Verify the server is running and the endpoint URL is correct. Check CORS configuration.',
      confidence:   72, source: 'fallback',
    };
  }

  if (name.includes('long') || name.includes('boundary')) {
    return {
      rootCause:    'The server did not return the expected validation error for an oversized input. Input validation may be missing or applied inconsistently.',
      impact:       'Malformed inputs may cause unpredictable behaviour or silent failures.',
      suggestedFix: 'Implement consistent server-side validation for length limits. Return 400/422 for out-of-range inputs.',
      confidence:   70, source: 'fallback',
    };
  }

  if (name.includes('injection') || name.includes('sql') || name.includes('xss')) {
    return {
      rootCause:    'The test submitted a potentially malicious payload and the result did not match the expected rejection. Input sanitisation may not be applied.',
      impact:       'If injection payloads reach the database, the application may be vulnerable to authentication bypass.',
      suggestedFix: 'Ensure all authentication inputs use parameterised queries and are HTML-escaped before rendering.',
      confidence:   65, source: 'fallback',
    };
  }

  if (actual.includes('succeed') || actual.includes('appeared to succeed')) {
    return {
      rootCause:    'A test case that should have been rejected appeared to succeed. The server may not be enforcing the expected validation rule.',
      impact:       'Users may be able to bypass authentication checks under certain conditions.',
      suggestedFix: 'Review server-side validation logic for this scenario and ensure the appropriate rejection response is returned.',
      confidence:   68, source: 'fallback',
    };
  }

  if (has4xx) {
    const status = statuses.find(s => s >= 400 && s < 500);
    return {
      rootCause:    `The authentication endpoint returned HTTP ${status}. The UI test outcome did not match what was expected.`,
      impact:       'The login flow may not be handling error responses consistently.',
      suggestedFix: `Verify that the UI correctly interprets and displays the HTTP ${status} error response.`,
      confidence:   60, source: 'fallback',
    };
  }

  return {
    rootCause:    `The test "${ctx.testName}" did not produce the expected outcome. No specific API error signal was detected.`,
    impact:       'The specific impact cannot be determined without additional signals. Review the screenshot and console errors.',
    suggestedFix: 'Inspect the screenshot captured at failure time and the browser console errors. Consider adding explicit waits for slow-loading elements.',
    confidence:   40, source: 'fallback',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildNetworkSummary(capturedRequests, apiFindings) {
  if (!capturedRequests?.length) return 'No network requests captured.';

  const authReqs = capturedRequests.filter(r => r.isAuthRelated).slice(0, MAX_NETWORK_LOGS);
  if (!authReqs.length) return 'No auth-related requests captured during this test.';

  return authReqs.map(r => {
    const payload  = r.requestPayload  ? JSON.stringify(r.requestPayload).substring(0, MAX_PAYLOAD_CHARS)  : 'none';
    const response = r.responsePayload ? JSON.stringify(r.responsePayload).substring(0, MAX_PAYLOAD_CHARS) : 'none';
    const timing   = r.responseTimeMs != null ? `${r.responseTimeMs}ms` : '—';
    const status   = r.responseStatus  != null ? String(r.responseStatus)  : 'no response';
    const label    = r.authLabel ? ` [${r.authLabel}]` : '';
    return [
      `${r.method} ${r.pathname ?? r.url}${label}`,
      `  Status: ${status}`,
      `  Response time: ${timing}`,
      `  Request payload: ${payload}`,
      `  Response payload: ${response}`,
    ].join('\n');
  }).join('\n\n');
}

function clampInt(val, min, max) {
  const n = parseInt(val, 10);
  if (Number.isNaN(n)) return Math.round((min + max) / 2);
  return Math.min(max, Math.max(min, n));
}