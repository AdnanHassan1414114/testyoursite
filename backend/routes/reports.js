/**
 * routes/reports.js
 * ──────────────────
 * GET /api/reports/:runId
 * Builds the full QA report for a completed run.
 */

import express from 'express';
import { pool } from '../db.js';
import { buildCorrelations, buildCorrelationSummary } from '../services/correlator.js';

export const reportRoutes = express.Router();

reportRoutes.get('/:runId', async (req, res) => {
  const { runId } = req.params;

  try {
    // ── 1. Run ────────────────────────────────────────────────────────────────
    const runResult = await pool.query(`SELECT * FROM test_runs WHERE id = $1`, [runId]);
    if (!runResult.rows.length) return res.status(404).json({ error: 'Run not found' });
    const run = runResult.rows[0];
    if (run.test_password) {
      run.test_password_masked = '•'.repeat(Math.min(run.test_password.length, 12));
      delete run.test_password;
    }

    // ── 2. Test results ───────────────────────────────────────────────────────
    const testResults = (await pool.query(
      `SELECT * FROM test_results WHERE run_id = $1 ORDER BY created_at ASC`, [runId]
    )).rows;

    // ── 3. API requests ───────────────────────────────────────────────────────
    const apiRequests = (await pool.query(
      `SELECT * FROM api_requests WHERE run_id = $1 ORDER BY created_at ASC`, [runId]
    )).rows;

    // ── 4. API responses ──────────────────────────────────────────────────────
    let apiResponses = [];
    try {
      apiResponses = (await pool.query(
        `SELECT * FROM api_responses WHERE run_id = $1 ORDER BY created_at ASC`, [runId]
      )).rows;
    } catch (_) {}

    const responseByRequestId = new Map();
    for (const r of apiResponses) responseByRequestId.set(r.api_request_id, r);

    const mergedRequests = apiRequests.map(req => {
      const resp = responseByRequestId.get(req.id);
      return {
        ...req,
        response_status:       resp?.response_status       ?? req.response_status,
        response_time_ms:      resp?.response_time_ms      ?? req.response_time_ms,
        response_payload:      resp?.response_payload      ?? req.response_payload,
        response_headers:      resp?.response_headers      ?? req.response_headers,
        response_content_type: resp?.response_content_type ?? null,
      };
    });

    // ── 5. Findings ───────────────────────────────────────────────────────────
    const apiFindings = (await pool.query(
      `SELECT * FROM api_findings WHERE run_id = $1 ORDER BY created_at ASC`, [runId]
    )).rows;

    // ── 6. Root causes ────────────────────────────────────────────────────────
    let rootCauses = [];
    try {
      rootCauses = (await pool.query(
        `SELECT * FROM root_causes WHERE test_run_id = $1 ORDER BY created_at ASC`, [runId]
      )).rows;
    } catch (_) {}

    const rootCauseByResultId = new Map();
    for (const rc of rootCauses) rootCauseByResultId.set(rc.test_result_id, rc);

    // ── 7. Correlations ───────────────────────────────────────────────────────
    const correlations = buildCorrelations({ testResults, apiRequests: mergedRequests, apiFindings });
    const corrSummary  = buildCorrelationSummary(correlations, run);

    // ── 8. UI findings ────────────────────────────────────────────────────────
    const uiFindings = testResults.map(r => ({
      testName:     r.test_name,
      status:       r.status,
      errorMessage: r.error_message ?? null,
      durationMs:   r.duration_ms   ?? null,
      email:        r.email         ?? null,
    }));

    // ── 9. API endpoint findings ──────────────────────────────────────────────
    const endpointMap = new Map();
    for (const req of mergedRequests.filter(r => r.is_auth_related)) {
      const key = `${req.method} ${req.pathname ?? safePathname(req.url)}`;
      if (!endpointMap.has(key)) {
        endpointMap.set(key, {
          method:   req.method,
          pathname: req.pathname ?? safePathname(req.url),
          requests: [],
          findings: [],
        });
      }
      endpointMap.get(key).requests.push({
        testResultId:   req.test_result_id,
        status:         req.response_status,
        responseTimeMs: req.response_time_ms,
        authLabel:      req.auth_label,
      });
    }
    for (const f of apiFindings) {
      const linkedReq = apiRequests.find(r => r.id === f.api_request_id);
      if (linkedReq) {
        const key = `${linkedReq.method} ${linkedReq.pathname ?? safePathname(linkedReq.url)}`;
        if (endpointMap.has(key)) {
          endpointMap.get(key).findings.push({
            severity: f.severity,
            category: f.category,
            message:  f.message,
            explain:  f.explain ?? null,
          });
        }
      }
    }
    const apiEndpointFindings = [...endpointMap.values()];

    // ── 10. Enriched failures ─────────────────────────────────────────────────
    const failures = testResults.filter(r => r.status === 'failed').map(r => {
      const rc = rootCauseByResultId.get(r.id) ?? null;
      const rootCause = rc ? {
        rootCause:      rc.root_cause,
        impact:         rc.impact,
        suggestedFix:   rc.suggested_fix,
        confidence:     rc.confidence,
        analysisSource: rc.analysis_source,
      } : null;
      const authApis  = mergedRequests.filter(a => a.test_result_id === r.id && a.is_auth_related);
      const topApiRow = authApis.find(a => a.response_status >= 400) ?? authApis[0] ?? null;
      const topApi    = topApiRow ? {
        method:         topApiRow.method,
        pathname:       topApiRow.pathname ?? safePathname(topApiRow.url),
        responseStatus: topApiRow.response_status,
        responseTimeMs: topApiRow.response_time_ms,
        authLabel:      topApiRow.auth_label,
      } : null;
      return { ...r, rootCause, topApi };
    });

    // ── 11. Summary ───────────────────────────────────────────────────────────
    const durationMs          = run.completed_at ? new Date(run.completed_at) - new Date(run.created_at) : null;
    const aiAnalysisCount     = rootCauses.length;
    const highConfidenceCount = rootCauses.filter(rc => rc.confidence >= 80).length;
    const backendIssueCount   = failures.filter(f =>
      f.rootCause && f.rootCause.confidence >= 65 &&
      f.topApi    && f.topApi.responseStatus >= 500
    ).length;

    res.json({
      run,
      summary: {
        feature:          run.feature ?? 'login',
        url:              run.url,
        status:           run.status,
        totalTests:       run.total_tests,
        passed:           run.passed,
        failed:           run.failed,
        passRate:         run.total_tests > 0 ? Math.round((run.passed / run.total_tests) * 100) : 0,
        durationMs,
        createdAt:        run.created_at,
        completedAt:      run.completed_at,
        authApiCount:     mergedRequests.filter(r => r.is_auth_related).length,
        apiErrorCount:    apiFindings.filter(f => f.severity === 'error').length,
        apiWarnCount:     apiFindings.filter(f => f.severity === 'warning').length,
        apiInfoCount:     apiFindings.filter(f => f.severity === 'info').length,
        linkedFailures:   corrSummary.linkedFailures,
        unlinkedFailures: corrSummary.unlinkedFailures,
        silentFailures:   corrSummary.silentFailures,
        summaryText:      corrSummary.summaryText,
        aiAnalysisCount,
        highConfidenceCount,
        backendIssueCount,
      },
      uiFindings,
      apiEndpointFindings,
      correlations,
      failures,
      results:     testResults,
      apiRequests: mergedRequests,
      apiResponses,
      apiFindings,
      rootCauses,
    });

  } catch (err) {
    console.error('[reports] Error building report:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function safePathname(url) {
  try { return new URL(url).pathname; } catch { return url ?? '—'; }
}