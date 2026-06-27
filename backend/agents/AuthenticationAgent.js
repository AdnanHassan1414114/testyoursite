/**
 * agents/AuthenticationAgent.js
 * ──────────────────────────────
 * The Authentication Agent is the single orchestrator that drives every
 * authentication feature through the common eight-step testing pipeline:
 *
 *   1. Analyze Page         — detectPageElements() + scanPageForContext()
 *   2. Load Feature         — resolve the feature module from the registry
 *   3. Generate Test Cases  — predefined template + AI edge cases
 *   4. Execute Tests        — Playwright runTestCase() per test
 *   5. Monitor APIs         — API observations captured during execution
 *   6. Capture Failures     — persist test_results rows
 *   7. AI Analysis          — analyzeFailure() for every failed test
 *   8. Generate Report      — correlations + root causes persisted to DB
 *
 * Feature-specific behaviour lives exclusively inside each feature module.
 * This file contains zero feature-specific logic.
 */

import { v4 as uuidv4 }        from 'uuid';
import { detectPageElements, runTestCase }        from '../services/playwrightService.js';
import { scanPageForContext, generateEdgeCases }  from '../services/aiService.js';
import { validateApiRequests, validateSchemaConsistency, buildPlainSummary } from '../services/apiValidator.js';
import { saveObservationBatch, saveFindingsBatch, saveCrossRunFindings } from '../services/apiStorage.js';
import { analyzeFailure }       from '../services/failureAnalysisService.js';
import { getFeature }           from '../features/registry.js';

export class AuthenticationAgent {
  /**
   * @param {{
   *   runId:       string,
   *   url:         string,
   *   feature:     string,
   *   credentials: { email: string|null, password: string|null },
   *   pool:        import('pg').Pool,
   *   onStatus:    (status: string) => Promise<void>,
   *   onProgress:  (msg: string) => void,
   * }} opts
   */
  constructor({ runId, url, feature, credentials, pool, onStatus, onProgress }) {
    this.runId       = runId;
    this.url         = url;
    this.featureKey  = feature;
    this.credentials = credentials ?? {};
    this.pool        = pool;
    this.onStatus    = onStatus   ?? (async () => {});
    this.onProgress  = onProgress ?? (() => {});
  }

  // ── Public entry point ─────────────────────────────────────────────────────

  async run() {
    const { runId, url, featureKey, credentials, pool } = this;
    const allTestObservations = [];

    try {
      // ── Step 1: Analyze Page ───────────────────────────────────────────────
      await this.onStatus('detecting');
      this.onProgress(`[AuthAgent] Analyzing page: ${url}`);

      let pageInfo, pageContext;
      try {
        [pageInfo, pageContext] = await Promise.all([
          detectPageElements(url),
          scanPageForContext(url),
        ]);
      } catch (err) {
        const msg = `Could not open URL: ${err.message}`;
        this.onProgress(`[AuthAgent] ERROR: ${msg}`);
        await this.onStatus('error');
        await this._savePageDetectionError(msg);
        return;
      }

      // ── Step 2: Load Feature ───────────────────────────────────────────────
      let featureModule;
      try {
        featureModule = getFeature(featureKey);
      } catch (err) {
        await this.onStatus('error');
        await this._savePageDetectionError(`Unknown feature: ${featureKey}`);
        return;
      }

      this.onProgress(
        `[AuthAgent] Feature loaded: ${featureModule.meta.name} | ` +
        `Page type detected: ${pageContext.pageType}`
      );

      // ── Step 3: Generate Test Cases ────────────────────────────────────────
      await this.onStatus('generating');

      const credentialsObj = {
        email:    credentials.email    || 'test@example.com',
        password: credentials.password || 'TestPass123!',
        username: credentials.username || null,
        token:    credentials.token    || null,
        otp:      credentials.otp      || null,
      };

      // 3a. Predefined core cases from the feature module
      const coreCases = featureModule.testCases(credentialsObj);
      this.onProgress(`[AuthAgent] Predefined test cases: ${coreCases.length}`);

      // 3b. AI-generated edge cases using the feature's own prompt
      let edgeCases = [];
      try {
        const prompt = featureModule.buildAiPrompt(pageContext, credentialsObj);
        edgeCases = await generateEdgeCases(prompt);
        this.onProgress(`[AuthAgent] AI edge cases generated: ${edgeCases.length}`);
      } catch (err) {
        this.onProgress(`[AuthAgent] AI edge case generation skipped: ${err.message}`);
      }

      const testCases = [...coreCases, ...edgeCases];

      await pool.query(
        `UPDATE test_runs SET total_tests = $1 WHERE id = $2`,
        [testCases.length, runId]
      );
      await this.onStatus('running');

      let passed = 0;
      let failed = 0;

      // ── Steps 4 + 5 + 6: Execute, Monitor, Capture ────────────────────────
      for (const testCase of testCases) {
        const resultId = uuidv4();
        let result;

        // 4. Execute via Playwright
        try {
          result = await runTestCase(testCase, pageInfo, runId);
        } catch (err) {
          this.onProgress(`[AuthAgent] Playwright error for "${testCase.name}": ${err.message}`);
          result = {
            status:           'failed',
            errorMessage:     `Playwright error: ${err.message}`,
            consoleErrors:    [],
            networkErrors:    [],
            capturedRequests: [],
            screenshotPath:   null,
            durationMs:       0,
          };
        }

        if (result.status === 'passed') passed++;
        else failed++;

        // 6. Persist test_results row
        try {
          await pool.query(
            `INSERT INTO test_results
               (id, run_id, test_name, description, email, password, status, error_message,
                console_errors, network_errors, screenshot_path, duration_ms)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              resultId, runId,
              testCase.name,        testCase.description ?? '',
              testCase.email ?? '',  testCase.password ?? '',
              result.status,        result.errorMessage ?? null,
              JSON.stringify(result.consoleErrors  ?? []),
              JSON.stringify(result.networkErrors  ?? []),
              result.screenshotPath ?? null,
              result.durationMs     ?? 0,
            ]
          );
        } catch (dbErr) {
          this.onProgress(`[AuthAgent] DB error saving result: ${dbErr.message}`);
          continue;
        }

        const observations = result.capturedRequests ?? [];

        // Accumulate for cross-test schema consistency check
        allTestObservations.push({
          testName:     testCase.name,
          observations: observations.filter(o => o.isAuthRelated),
        });

        // 5. Persist API observations
        const { saved: savedObservations } = await saveObservationBatch(pool, {
          runId,
          testResultId: resultId,
          observations,
        });

        // Validate: base rules + feature-specific rules
        const baseFindings    = validateApiRequests(observations, testCase.name, testCase.expectedOutcome);
        const featureFindings = featureModule.validate(observations, testCase.name, testCase.expectedOutcome);
        const allFindings     = [...baseFindings, ...featureFindings];

        if (allFindings.length) {
          await saveFindingsBatch(pool, {
            runId,
            testResultId:   resultId,
            findings:       allFindings,
            observationMap: savedObservations,
          });
        }

        // Combine Playwright's page-level outcome with API-level findings into
        // a single severity so the UI badge can't show green "PASS" next to
        // red/amber issues — see _combineSeverity() for the rule.
        const severity = this._combineSeverity(result.status, allFindings);
        // One plain-English sentence explaining the result — shown first in
        // the UI, before any raw API data, so a non-technical tester knows
        // what happened without reading logs.
        const summary = buildPlainSummary(result.status, allFindings);
        await pool.query(
          `UPDATE test_results SET severity = $1, summary = $2 WHERE id = $3`,
          [severity, summary, resultId]
        ).catch(err => this.onProgress(`[AuthAgent] Could not persist severity/summary: ${err.message}`));

        // ── Step 7: AI Failure Analysis ──────────────────────────────────────
        if (result.status === 'failed') {
          try {
            const analysis = await analyzeFailure({
              testName:         testCase.name,
              testDescription:  testCase.description      ?? '',
              expectedResult:   testCase.expectedBehavior ?? testCase.expectedOutcome ?? 'Test should pass',
              actualResult:     result.errorMessage       ?? 'Test failed',
              consoleErrors:    result.consoleErrors       ?? [],
              networkErrors:    result.networkErrors       ?? [],
              screenshotPath:   result.screenshotPath      ?? null,
              capturedRequests: observations,
              apiFindings:      allFindings,
            });

            await this._saveRootCause(resultId, analysis);

            this.onProgress(
              `[AuthAgent] Root cause stored for "${testCase.name}" — ` +
              `confidence: ${analysis.confidence}% source: ${analysis.source}`
            );
          } catch (analysisErr) {
            this.onProgress(`[AuthAgent] AI analysis failed for "${testCase.name}": ${analysisErr.message}`);
          }
        }

        // Update running totals
        await pool.query(
          `UPDATE test_runs SET passed = $1, failed = $2 WHERE id = $3`,
          [passed, failed, runId]
        ).catch(() => {});

        this.onProgress(
          `[AuthAgent] "${testCase.name}" — ${result.status} | ` +
          `obs=${observations.length} | findings=${allFindings.length}`
        );
      }

      // ── Cross-test schema consistency ──────────────────────────────────────
      const consistencyFindings = validateSchemaConsistency(allTestObservations);
      if (consistencyFindings.length) {
        await saveCrossRunFindings(pool, { runId, findings: consistencyFindings });
        this.onProgress(`[AuthAgent] Schema consistency: ${consistencyFindings.length} finding(s) saved.`);
      }

      // ── Step 8: Mark run complete ──────────────────────────────────────────
      await pool.query(
        `UPDATE test_runs
           SET status = 'completed', completed_at = NOW(),
               passed = $1, failed = $2, feature = $3
         WHERE id = $4`,
        [passed, failed, featureKey, runId]
      ).catch(() => {});

      this.onProgress(
        `[AuthAgent] Run ${runId} complete — ` +
        `feature=${featureKey} passed=${passed} failed=${failed} total=${passed + failed}`
      );

    } catch (err) {
      this.onProgress(`[AuthAgent] Unhandled error: ${err.message}`);
      await this.onStatus('error').catch(() => {});
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Combine Playwright's page-level pass/fail with API-level findings into
   * one severity value: 'clean' | 'warning' | 'error'.
   *
   * Rationale: Playwright's heuristic only looks at the page (URL/DOM text).
   * It can't see that a "successful" login returned no token/cookie, or that
   * a request silently 404'd. Findings catch that — but were previously only
   * shown as a side pill, disconnected from the green/red badge. This makes
   * the badge reflect the worst signal across BOTH sources.
   *
   * @param {'passed'|'failed'} playwrightStatus
   * @param {Array<{severity: 'error'|'warning'|'info'}>} findings
   * @returns {'clean'|'warning'|'error'}
   */
  _combineSeverity(playwrightStatus, findings) {
    if (playwrightStatus === 'failed') return 'error';
    if (findings.some(f => f.severity === 'error'))   return 'error';
    if (findings.some(f => f.severity === 'warning')) return 'warning';
    return 'clean';
  }

  async _saveRootCause(resultId, analysis) {
    await this.pool.query(
      `INSERT INTO root_causes
         (id, test_run_id, test_result_id,
          root_cause, impact, suggested_fix, confidence, analysis_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (test_result_id) DO UPDATE SET
         root_cause      = EXCLUDED.root_cause,
         impact          = EXCLUDED.impact,
         suggested_fix   = EXCLUDED.suggested_fix,
         confidence      = EXCLUDED.confidence,
         analysis_source = EXCLUDED.analysis_source,
         created_at      = NOW()`,
      [
        uuidv4(), this.runId, resultId,
        analysis.rootCause,
        analysis.impact,
        analysis.suggestedFix,
        analysis.confidence,
        analysis.source ?? 'openai',
      ]
    );
  }

  async _savePageDetectionError(message) {
    await this.pool.query(
      `INSERT INTO test_results
         (id, run_id, test_name, description, status, error_message, console_errors, network_errors)
       VALUES ($1,$2,'Page Detection','Agent tried to analyze the URL','failed',$3,'[]','[]')`,
      [uuidv4(), this.runId, message]
    ).catch(() => {});
  }
}