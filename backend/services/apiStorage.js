/**
 * services/apiStorage.js
 * ───────────────────────
 * Persistence layer for API observation data.
 * Flat services path — no subfolders.
 */

import { v4 as uuidv4 } from 'uuid';

function sanitiseHeaders(headers = {}) {
  const SENSITIVE = /^(authorization|cookie|set-cookie|x-auth-token|x-api-key|token)$/i;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

export async function saveObservation(client, { runId, testResultId, observation: obs }) {
  const requestId = uuidv4();

  await client.query(
    `INSERT INTO api_requests (
       id, run_id, test_result_id, method, url, pathname, auth_label, initiator_type,
       request_headers, request_payload,
       response_status, response_headers, response_payload, response_time_ms,
       is_auth_related, error, captured_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      requestId, runId, testResultId,
      obs.method, obs.url, obs.pathname ?? null, obs.authLabel ?? null, obs.initiatorType ?? null,
      JSON.stringify(sanitiseHeaders(obs.requestHeaders ?? {})),
      obs.requestPayload != null ? JSON.stringify(obs.requestPayload) : null,
      obs.responseStatus  ?? null,
      JSON.stringify(sanitiseHeaders(obs.responseHeaders ?? {})),
      obs.responsePayload != null ? JSON.stringify(obs.responsePayload) : null,
      obs.responseTimeMs  ?? null,
      obs.isAuthRelated   ?? false,
      obs.error           ?? null,
      obs.capturedAt      != null ? new Date(obs.capturedAt) : null,
    ]
  );

  const responseId = uuidv4();
  await client.query(
    `INSERT INTO api_responses (
       id, api_request_id, run_id, test_result_id,
       response_status, response_headers, response_payload,
       response_content_type, response_time_ms, error
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      responseId, requestId, runId, testResultId,
      obs.responseStatus       ?? null,
      JSON.stringify(sanitiseHeaders(obs.responseHeaders ?? {})),
      obs.responsePayload != null ? JSON.stringify(obs.responsePayload) : null,
      obs.responseContentType  ?? null,
      obs.responseTimeMs       ?? null,
      obs.error                ?? null,
    ]
  );

  return { requestId, responseId };
}

export async function saveFindings(client, { runId, testResultId, requestId, responseId, findings }) {
  for (const f of findings) {
    await client.query(
      `INSERT INTO api_findings (
         id, run_id, api_request_id, api_response_id, test_result_id,
         severity, category, message, explain, detail
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        uuidv4(), runId, requestId ?? null, responseId ?? null, testResultId,
        f.severity, f.category, f.message, f.explain ?? null, JSON.stringify(f.detail ?? {}),
      ]
    );
  }
}

export async function saveObservationBatch(pool, { runId, testResultId, observations }) {
  const saved  = [];
  const errors = [];

  for (const obs of observations) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ids = await saveObservation(client, { runId, testResultId, observation: obs });
      await client.query('COMMIT');
      saved.push({ observation: obs, ...ids });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[apiStorage] Failed to save obs ${obs.method} ${obs.url}: ${err.message}`);
      errors.push({ observation: obs, error: err });
    } finally {
      client.release();
    }
  }

  return { saved, errors };
}

export async function saveFindingsBatch(pool, { runId, testResultId, findings, observationMap }) {
  if (!findings.length) return;

  const urlIndex = new Map();
  for (const entry of observationMap) {
    urlIndex.set(entry.observation.url, { requestId: entry.requestId, responseId: entry.responseId });
  }

  const groups = new Map();
  for (const f of findings) {
    const url = f.detail?.url ?? null;
    const ids = url ? urlIndex.get(url) : null;
    const key = ids?.requestId ?? '__unlinked__';
    if (!groups.has(key)) {
      groups.set(key, { requestId: ids?.requestId ?? null, responseId: ids?.responseId ?? null, findings: [] });
    }
    groups.get(key).findings.push(f);
  }

  for (const { requestId, responseId, findings: gf } of groups.values()) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await saveFindings(client, { runId, testResultId, requestId, responseId, findings: gf });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[apiStorage] Failed to save findings group: ${err.message}`);
    } finally {
      client.release();
    }
  }
}

export async function saveCrossRunFindings(pool, { runId, findings }) {
  if (!findings.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const f of findings) {
      await client.query(
        `INSERT INTO api_findings (id, run_id, severity, category, message, explain, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uuidv4(), runId, f.severity, f.category, f.message, f.explain ?? null, JSON.stringify(f.detail ?? {})]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[apiStorage] Cross-run findings error: ${err.message}`);
  } finally {
    client.release();
  }
}