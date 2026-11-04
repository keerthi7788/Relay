import { firstRow } from "../db/camelize.js";

export class ScheduleRepository {
  #db;

  constructor(db) {
    this.#db = db;
  }

  async upsert({ workflowId, cron, input, nextFireAt }) {
    await this.#db.query(
      `INSERT INTO schedules (workflow_id, cron, input, next_fire_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workflow_id)
       DO UPDATE SET cron = $2, input = $3, next_fire_at = $4`,
      [workflowId, cron, input, nextFireAt],
    );
  }

  async remove(workflowId) {
    await this.#db.query("DELETE FROM schedules WHERE workflow_id = $1", [workflowId]);
  }

  async find(workflowId) {
    return firstRow(
      await this.#db.query("SELECT * FROM schedules WHERE workflow_id = $1", [workflowId]),
    );
  }

  async lockNextDue() {
    return firstRow(
      await this.#db.query(
        `SELECT * FROM schedules
         WHERE next_fire_at <= now()
         ORDER BY next_fire_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      ),
    );
  }

  async setNextFire(workflowId, nextFireAt) {
    await this.#db.query("UPDATE schedules SET next_fire_at = $2 WHERE workflow_id = $1", [
      workflowId,
      nextFireAt,
    ]);
  }
}
