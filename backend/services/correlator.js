/**
 * services/correlator.js
 * ───────────────────────
 * Pure correlation engine — no database calls, no Express.
 * Connects UI test results to API calls and findings.
 *
 * Correlation types:
 *   'ui_and_api_failed'       — UI failed AND auth API had error/warning findings
 *   'ui_failed_no_api_signal' — UI failed but no API error signal
 *   'ui_passed_api_errors'    — UI passed but auth API returned server errors
 *   'clean'                   — UI passed, no API problems
 */

function safePathname(url) {
  try { return new URL(url).pathname; } catch { return url ?? '—'; }
}

function toApiSummary(row) {
  return {
    method:         row.method,
    pathname:       row.pathname ?? safePathname(row.url),
    status:         row.response_status   ?? row.responseStatus   ?? null,
    responseTimeMs: row.response_time_ms  ?? row.responseTimeMs   ?? null,
    authLabel:      row.auth_label        ?? null,
  };
}

function toFindingSummary(row) {
  return {
    severity: row.severity,
    category: row.category,
    message:  row.message,
    explain:  row.explain ?? null,
  };
}

export function buildCorrelations({ testResults, apiRequests, apiFindings }, opts = {}) {
  const { includeClean = false } = opts;
  const correlations = [];

  for (const result of testResults) {
    const relatedRequests = apiRequests.filter(
      r => r.test_result_id === result.id && r.is_auth_related
    );
    const allFindings = apiFindings.filter(f => f.test_result_id === result.id);
    const errorOrWarnFindings = allFindings.filter(
      f => f.severity === 'error' || f.severity === 'warning'
    );

    const hasApiProblems = errorOrWarnFindings.length > 0;
    const hasServerCrash = errorOrWarnFindings.some(f => f.category === 'server_error');
    const uiFailed       = result.status === 'failed';

    let type, linked, note;

    if (uiFailed && hasApiProblems) {
      type   = 'ui_and_api_failed';
      linked = true;
      note   = buildNote_uiAndApiFailed(result, relatedRequests, errorOrWarnFindings);

    } else if (uiFailed && !hasApiProblems) {
      type   = 'ui_failed_no_api_signal';
      linked = false;
      note   = `"${result.test_name}" failed but no auth API errors were recorded. ` +
               `The failure may be a front-end validation issue or a Playwright timeout.`;

    } else if (!uiFailed && hasServerCrash) {
      type   = 'ui_passed_api_errors';
      linked = true;
      note   = `"${result.test_name}" appeared to pass in the browser but the auth API ` +
               `returned a server error. The application may be masking backend failures.`;

    } else {
      if (!includeClean) continue;
      type   = 'clean';
      linked = false;
      note   = null;
    }

    correlations.push({
      type, linked,
      uiTestName:  result.test_name,
      uiStatus:    result.status,
      uiError:     result.error_message ?? null,
      note,
      relatedApis:  relatedRequests.map(toApiSummary),
      apiFindings:  errorOrWarnFindings.map(toFindingSummary),
    });
  }

  return correlations;
}

export function buildCorrelationSummary(correlations, runRow) {
  const linkedFailures   = correlations.filter(c => c.type === 'ui_and_api_failed').length;
  const unlinkedFailures = correlations.filter(c => c.type === 'ui_failed_no_api_signal').length;
  const silentFailures   = correlations.filter(c => c.type === 'ui_passed_api_errors').length;
  const totalFailed      = runRow.failed ?? 0;

  const lines = [];
  if (totalFailed === 0) {
    lines.push('All tests passed with no API errors detected.');
  } else {
    lines.push(`${totalFailed} failure${totalFailed !== 1 ? 's' : ''} detected.`);
    if (linkedFailures > 0) {
      lines.push(`${linkedFailures} failure${linkedFailures !== 1 ? 's' : ''} linked to backend authentication API errors.`);
    }
    if (unlinkedFailures > 0) {
      lines.push(`${unlinkedFailures} failure${unlinkedFailures !== 1 ? 's' : ''} have no corresponding API signal — likely front-end or Playwright issues.`);
    }
  }
  if (silentFailures > 0) {
    lines.push(`${silentFailures} test${silentFailures !== 1 ? 's' : ''} passed in the browser but triggered backend server errors — possible silent failures.`);
  }

  return { linkedFailures, unlinkedFailures, silentFailures, summaryText: lines.join(' ') };
}

function buildNote_uiAndApiFailed(result, requests, findings) {
  const topFinding = findings.find(f => f.severity === 'error') ?? findings[0];
  const topRequest = requests.find(r =>
    topFinding?.message?.includes(r.pathname ?? safePathname(r.url))
  ) ?? requests[0];

  if (!topRequest) {
    return `"${result.test_name}" failed. API findings recorded but no auth requests captured.`;
  }

  const endpoint = topRequest.pathname ?? safePathname(topRequest.url);
  const status   = topRequest.response_status ?? '—';
  const category = topFinding ? topFinding.category.replace(/_/g, ' ') : 'API issue';

  return (
    `"${result.test_name}" failed. ` +
    `${topRequest.method} ${endpoint} returned ${status} (${category}). ` +
    `${topFinding?.explain ?? ''}`
  ).trim();
}