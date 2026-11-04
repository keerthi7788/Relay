import { allRows, firstRow } from "../db/camelize.js";
import { assertTransition, isTerminal } from "../domain/runStateMachine.js";

export class RunRepository {
  #db;

  constructor(db) {
    this.#db = db;
  }

  async insert({ runId, workflowId, definitionSnapshot, triggerType, input }) {
    await this.#db.query(
      `INSERT INTO runs (run_id, workflow_id, definition_snapshot, status, trigger_type, input, current_node_id)
       VALUES ($1, $2, $3, 'queued', $4, $5, $6)`,
      [runId, workflowId, definitionSnapshot, triggerType, input, definitionSnapshot.entry],
    );
  }

  async find(runId) {
    return firstRow(await this.#db.query("SELECT * FROM runs WHERE run_id = $1", [runId]));
  }

  async lock(runId) {
    return firstRow(
      await this.#db.query("SELECT * FROM runs WHERE run_id = $1 FOR UPDATE", [runId]),
    );
  }

  async list({ workflowId, status, limit, offset }) {
    return allRows(
      await this.#db.query(
        `SELECT * FROM runs
         WHERE ($1::text IS NULL OR workflow_id = $1)
           AND ($2::text IS NULL OR status = $2)
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [workflowId ?? null, status ?? null, limit ?? null, offset ?? 0],
      ),
    );
  }

  async transition(runId, from, to, error) {
    assertTransition(from, to);
    const { rowCount } = await this.#db.query(
      `UPDATE runs
       SET status = $3,
           error = COALESCE($4, error),
           started_at = CASE WHEN $3 = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
           finished_at = CASE WHEN $5 THEN now() ELSE finished_at END
       WHERE run_id = $1 AND status = $2`,
      [runId, from, to, error ?? null, isTerminal(to)],
    );
    return rowCount === 1;
  }

  async latestForWorkflows(workflowIds) {
    return allRows(
      await this.#db.query(
        `SELECT DISTINCT ON (workflow_id) workflow_id, run_id, status, created_at
         FROM runs
         WHERE workflow_id = ANY($1)
         ORDER BY workflow_id, created_at DESC`,
        [workflowIds],
      ),
    );
  }

  async countStepStarted(runId) {
    await this.#db.query("UPDATE runs SET steps_executed = steps_executed + 1 WHERE run_id = $1", [
      runId,
    ]);
  }

  async setCurrentNode(runId, nodeId) {
    await this.#db.query("UPDATE runs SET current_node_id = $2 WHERE run_id = $1", [runId, nodeId]);
  }

  async addTokens(runId, tokens) {
    await this.#db.query("UPDATE runs SET ai_tokens_used = ai_tokens_used + $2 WHERE run_id = $1", [
      runId,
      tokens,
    ]);
  }

  async requestCancel(runId) {
    await this.#db.query("UPDATE runs SET cancel_requested = true WHERE run_id = $1", [runId]);
  }
}
