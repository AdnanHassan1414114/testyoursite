/**
 * routes/tests.js
 * ────────────────
 * POST /api/tests/run      — Start a new authentication feature test run
 * GET  /api/tests/run/:id  — Poll run status
 * GET  /api/tests/runs     — List recent runs (sidebar)
 * GET  /api/tests/features — List all available authentication features
 */

import express           from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool }          from '../db.js';
import { AuthenticationAgent } from '../agents/AuthenticationAgent.js';
import { listFeatures }  from '../features/registry.js';

export const testRoutes = express.Router();

// ── GET /features ─────────────────────────────────────────────────────────────

testRoutes.get('/features', (_req, res) => {
  try {
    res.json(listFeatures());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /run ─────────────────────────────────────────────────────────────────

testRoutes.post('/run', async (req, res) => {
  const {
    url,
    feature      = 'login',
    testEmail,
    testPassword,
    testUsername,   // signup: separate username field
    testToken,      // resetPassword / emailVerification: token from email
    testOtp,        // otpVerification: live OTP code
  } = req.body;

  if (!url) return res.status(400).json({ error: 'URL is required.' });
  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL format. Include https://' });
  }
  if (testEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
    return res.status(400).json({ error: 'testEmail is not a valid email address.' });
  }

  const runId = uuidv4();

  try {
    await pool.query(
      `INSERT INTO test_runs (id, url, status, feature, test_email, test_password)
       VALUES ($1, $2, 'pending', $3, $4, $5)`,
      [runId, url, feature, testEmail || null, testPassword || null]
    );

    res.json({ runId, feature, message: `Authentication test run started for feature: ${feature}` });

    // Fire-and-forget the agent
    const agent = new AuthenticationAgent({
      runId,
      url,
      feature,
      credentials: {
        email:    testEmail    || null,
        password: testPassword || null,
        username: testUsername || null,
        token:    testToken    || null,
        otp:      testOtp      || null,
      },
      pool,
      onStatus: async (status) => {
        const extra = (status === 'error' || status === 'completed') ? ', completed_at = NOW()' : '';
        await pool.query(
          `UPDATE test_runs SET status = $1${extra} WHERE id = $2`,
          [status, runId]
        ).catch(() => {});
      },
      onProgress: (msg) => console.log(msg),
    });

    agent.run().catch(err =>
      console.error(`[tests] Agent run failed for ${runId}:`, err.message)
    );

  } catch (err) {
    console.error('[POST /run] DB error:', err.message);
    res.status(500).json({ error: `Database error: ${err.message}. Is PostgreSQL running?` });
  }
});

// ── GET /run/:id ──────────────────────────────────────────────────────────────

testRoutes.get('/run/:id', async (req, res) => {
  try {
    const run = await pool.query(`SELECT * FROM test_runs WHERE id = $1`, [req.params.id]);
    if (!run.rows.length) return res.status(404).json({ error: 'Run not found' });

    const [results, apiRequests, apiFindings, rootCauses] = await Promise.all([
      pool.query(`SELECT * FROM test_results WHERE run_id = $1 ORDER BY created_at ASC`, [req.params.id]),
      pool.query(`SELECT * FROM api_requests  WHERE run_id = $1 ORDER BY created_at ASC`, [req.params.id]),
      pool.query(`SELECT * FROM api_findings  WHERE run_id = $1 ORDER BY created_at ASC`, [req.params.id]),
      pool.query(`SELECT * FROM root_causes   WHERE test_run_id = $1 ORDER BY created_at ASC`, [req.params.id])
        .catch(() => ({ rows: [] })),
    ]);

    const apiResponses = await pool.query(
      `SELECT * FROM api_responses WHERE run_id = $1 ORDER BY created_at ASC`, [req.params.id]
    ).catch(() => ({ rows: [] }));

    const runRow = { ...run.rows[0] };
    if (runRow.test_password) {
      runRow.test_password_masked = '•'.repeat(Math.min(runRow.test_password.length, 12));
      delete runRow.test_password;
    }

    res.json({
      run:          runRow,
      results:      results.rows,
      apiRequests:  apiRequests.rows,
      apiResponses: apiResponses.rows,
      apiFindings:  apiFindings.rows,
      rootCauses:   rootCauses.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /runs ─────────────────────────────────────────────────────────────────

testRoutes.get('/runs', async (_req, res) => {
  try {
    const runs = await pool.query(
      `SELECT id, url, status, feature, test_email, created_at, completed_at,
              total_tests, passed, failed
       FROM test_runs
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json(runs.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});