import { allRows, firstRow } from "../db/camelize.js";

export class ApprovalRepository {
  #db;

  constructor(db) {
    this.#db = db;
  }

  async insert({ id, runId, nodeId, sequence, message }) {
    await this.#db.query(
      `INSERT INTO approvals (id, run_id, node_id, sequence, message, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (run_id, node_id, sequence) DO NOTHING`,
      [id, runId, nodeId, sequence, message],
    );
  }

  async find(id) {
    return firstRow(await this.#db.query("SELECT * FROM approvals WHERE id = $1", [id]));
  }

  async findForStep(runId, nodeId, sequence) {
    return firstRow(
      await this.#db.query(
        "SELECT * FROM approvals WHERE run_id = $1 AND node_id = $2 AND sequence = $3",
        [runId, nodeId, sequence],
      ),
    );
  }

  async listByStatus({ status, limit, offset }) {
    return allRows(
      await this.#db.query(
        "SELECT * FROM approvals WHERE status = $1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3",
        [status, limit ?? null, offset ?? 0],
      ),
    );
  }

  async listForRun(runId) {
    return allRows(
      await this.#db.query("SELECT * FROM approvals WHERE run_id = $1 ORDER BY sequence", [runId]),
    );
  }

  async hasApproved(runId) {
    const { rowCount } = await this.#db.query(
      "SELECT 1 FROM approvals WHERE run_id = $1 AND status = 'approved' LIMIT 1",
      [runId],
    );
    return rowCount === 1;
  }

  async decide(id, status, decidedBy) {
    return firstRow(
      await this.#db.query(
        `UPDATE approvals SET status = $2, decided_by = $3, decided_at = now()
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [id, status, decidedBy],
      ),
    );
  }

  async closePending(runId) {
    await this.#db.query(
      "UPDATE approvals SET status = 'closed' WHERE run_id = $1 AND status = 'pending'",
      [runId],
    );
  }
}
