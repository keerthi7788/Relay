import { allRows, firstRow } from "../db/camelize.js";

const toJson = (value) => (value === undefined ? null : JSON.stringify(value));
const MAX_INT = 2147483647;
const ELAPSED_MS = `LEAST(EXTRACT(EPOCH FROM now() - started_at) * 1000, ${MAX_INT})::int`;

export class StepRepository {
  #db;

  constructor(db) {
    this.#db = db;
  }

  async listForRun(runId) {
    return allRows(
      await this.#db.query("SELECT * FROM steps WHERE run_id = $1 ORDER BY sequence", [runId]),
    );
  }

  async insert({ runId, sequence, nodeId, nodeType, idempotencyKey }) {
    return firstRow(
      await this.#db.query(
        `INSERT INTO steps (run_id, sequence, node_id, node_type, status, idempotency_key)
         VALUES ($1, $2, $3, $4, 'running', $5)
         RETURNING *`,
        [runId, sequence, nodeId, nodeType, idempotencyKey],
      ),
    );
  }

  async saveResolvedInput(runId, sequence, resolvedInput) {
    return firstRow(
      await this.#db.query(
        "UPDATE steps SET resolved_input = $3 WHERE run_id = $1 AND sequence = $2 RETURNING *",
        [runId, sequence, toJson(resolvedInput)],
      ),
    );
  }

  async startAttempt(runId, sequence) {
    return firstRow(
      await this.#db.query(
        `UPDATE steps SET status = 'running', attempt = attempt + 1
         WHERE run_id = $1 AND sequence = $2
         RETURNING *`,
        [runId, sequence],
      ),
    );
  }

  async suspend(runId, sequence, resumeAt, attempts = []) {
    await this.#db.query(
      `UPDATE steps
       SET status = 'waiting', resume_at = $3, attempts_log = attempts_log || $4::jsonb
       WHERE run_id = $1 AND sequence = $2`,
      [runId, sequence, resumeAt, toJson(attempts)],
    );
  }

  async markWaiting(runId, sequence) {
    await this.#db.query(
      "UPDATE steps SET status = 'waiting' WHERE run_id = $1 AND sequence = $2",
      [runId, sequence],
    );
  }

  async finish(runId, sequence, { status, output, attempts = [], tokens, flags = [] }) {
    await this.#db.query(
      `UPDATE steps
       SET status = $3,
           output = $4,
           attempts_log = attempts_log || $5::jsonb,
           tokens_prompt = $6,
           tokens_completion = $7,
           guardrail_flags = $8,
           resume_at = NULL,
           duration_ms = ${ELAPSED_MS}
       WHERE run_id = $1 AND sequence = $2`,
      [
        runId,
        sequence,
        status,
        toJson(output),
        toJson(attempts),
        tokens?.prompt ?? null,
        tokens?.completion ?? null,
        toJson(flags),
      ],
    );
  }

  async cancelOpen(runId, output) {
    await this.#db.query(
      `UPDATE steps
       SET status = 'cancelled', output = COALESCE($2, output), resume_at = NULL,
           duration_ms = ${ELAPSED_MS}
       WHERE run_id = $1 AND status IN ('running', 'waiting')`,
      [runId, toJson(output)],
    );
  }
}
