/**
 * db.js  (backend root)
 * ──────────────────────
 * Database connection pool + schema initialisation.
 *
 * Placed at backend root so routes/ and agents/ can import it as:
 *   import { pool } from '../db.js';
 *
 * Changes vs original:
 *   • test_runs gains a `feature` column (TEXT DEFAULT 'login')
 *     so every run records which authentication feature was tested.
 *   • All other tables are unchanged from the original schema.
 */

import pg      from 'pg';
import dotenv  from 'dotenv';
dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://postgres:password@localhost:5432/login_tester',
});

async function addColumnIfMissing(client, table, column, definition) {
  await client.query(`
    DO $$ BEGIN
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition};
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);
}

export async function initDb() {
  const client = await pool.connect();
  try {

    // ── Core tables ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_runs (
        id            UUID        PRIMARY KEY,
        url           TEXT        NOT NULL,
        status        TEXT        NOT NULL DEFAULT 'pending',
        feature       TEXT        NOT NULL DEFAULT 'login',
        test_email    TEXT,
        test_password TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        completed_at  TIMESTAMPTZ,
        total_tests   INT         DEFAULT 0,
        passed        INT         DEFAULT 0,
        failed        INT         DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS test_results (
        id              UUID        PRIMARY KEY,
        run_id          UUID        REFERENCES test_runs(id) ON DELETE CASCADE,
        test_name       TEXT        NOT NULL,
        description     TEXT,
        email           TEXT,
        password        TEXT,
        status          TEXT        NOT NULL,
        error_message   TEXT,
        console_errors  JSONB       DEFAULT '[]',
        network_errors  JSONB       DEFAULT '[]',
        screenshot_path TEXT,
        duration_ms     INT,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── api_requests ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_requests (
        id               UUID        PRIMARY KEY,
        run_id           UUID        REFERENCES test_runs(id)    ON DELETE CASCADE,
        test_result_id   UUID        REFERENCES test_results(id) ON DELETE CASCADE,
        method           TEXT        NOT NULL,
        url              TEXT        NOT NULL,
        pathname         TEXT,
        auth_label       TEXT,
        initiator_type   TEXT,
        request_headers  JSONB       DEFAULT '{}',
        request_payload  JSONB,
        response_status  INT,
        response_headers JSONB       DEFAULT '{}',
        response_payload JSONB,
        response_time_ms INT,
        is_auth_related  BOOLEAN     DEFAULT FALSE,
        error            TEXT,
        captured_at      TIMESTAMPTZ,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── api_responses ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_responses (
        id                    UUID        PRIMARY KEY,
        api_request_id        UUID        NOT NULL REFERENCES api_requests(id)  ON DELETE CASCADE,
        run_id                UUID        NOT NULL REFERENCES test_runs(id)     ON DELETE CASCADE,
        test_result_id        UUID                 REFERENCES test_results(id)  ON DELETE CASCADE,
        response_status       INT,
        response_headers      JSONB       DEFAULT '{}',
        response_payload      JSONB,
        response_content_type TEXT,
        response_time_ms      INT,
        error                 TEXT,
        created_at            TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_api_responses_request ON api_responses (api_request_id);
      CREATE INDEX IF NOT EXISTS idx_api_responses_run     ON api_responses (run_id);
      CREATE INDEX IF NOT EXISTS idx_api_responses_result  ON api_responses (test_result_id);
    `);

    // ── api_findings ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_findings (
        id              UUID        PRIMARY KEY,
        run_id          UUID        REFERENCES test_runs(id)     ON DELETE CASCADE,
        api_request_id  UUID        REFERENCES api_requests(id)  ON DELETE CASCADE,
        api_response_id UUID        REFERENCES api_responses(id) ON DELETE CASCADE,
        test_result_id  UUID        REFERENCES test_results(id)  ON DELETE CASCADE,
        severity        TEXT        NOT NULL,
        category        TEXT        NOT NULL,
        message         TEXT        NOT NULL,
        explain         TEXT,
        detail          JSONB,
        resolved_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_api_findings_run      ON api_findings (run_id);
      CREATE INDEX IF NOT EXISTS idx_api_findings_result   ON api_findings (test_result_id);
      CREATE INDEX IF NOT EXISTS idx_api_findings_severity ON api_findings (severity);
    `);

    // ── root_causes ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS root_causes (
        id              UUID        PRIMARY KEY,
        test_run_id     UUID        NOT NULL REFERENCES test_runs(id)    ON DELETE CASCADE,
        test_result_id  UUID        NOT NULL REFERENCES test_results(id) ON DELETE CASCADE,
        root_cause      TEXT        NOT NULL,
        impact          TEXT        NOT NULL,
        suggested_fix   TEXT        NOT NULL,
        confidence      INT         NOT NULL CHECK (confidence BETWEEN 0 AND 100),
        analysis_source TEXT        NOT NULL DEFAULT 'openai',
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT uq_root_cause_per_result UNIQUE (test_result_id)
      );

      CREATE INDEX IF NOT EXISTS idx_root_causes_run    ON root_causes (test_run_id);
      CREATE INDEX IF NOT EXISTS idx_root_causes_result ON root_causes (test_result_id);
    `);

    // ── Indexes ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_api_requests_run    ON api_requests (run_id);
      CREATE INDEX IF NOT EXISTS idx_api_requests_result ON api_requests (test_result_id);
      CREATE INDEX IF NOT EXISTS idx_api_requests_auth   ON api_requests (is_auth_related);
      CREATE INDEX IF NOT EXISTS idx_test_results_run    ON test_results (run_id);
    `);

    // ── Safe migrations for pre-existing databases ────────────────────────────
    await addColumnIfMissing(client, 'test_runs', 'feature', "TEXT NOT NULL DEFAULT 'login'");
    await addColumnIfMissing(client, 'test_runs', 'test_email',    'TEXT');
    await addColumnIfMissing(client, 'test_runs', 'test_password', 'TEXT');
    await addColumnIfMissing(client, 'api_requests', 'pathname',       'TEXT');
    await addColumnIfMissing(client, 'api_requests', 'auth_label',     'TEXT');
    await addColumnIfMissing(client, 'api_requests', 'initiator_type', 'TEXT');
    await addColumnIfMissing(client, 'api_requests', 'error',          'TEXT');
    await addColumnIfMissing(client, 'api_requests', 'captured_at',    'TIMESTAMPTZ');
    await addColumnIfMissing(client, 'api_requests', 'test_result_id',
      'UUID REFERENCES test_results(id) ON DELETE CASCADE');
    await addColumnIfMissing(client, 'api_findings', 'explain',     'TEXT');
    await addColumnIfMissing(client, 'api_findings', 'resolved_at', 'TIMESTAMPTZ');
    await addColumnIfMissing(client, 'api_findings', 'api_response_id',
      'UUID REFERENCES api_responses(id) ON DELETE CASCADE');

    console.log('[db] Schema initialised / migrated successfully.');
  } finally {
    client.release();
  }
}