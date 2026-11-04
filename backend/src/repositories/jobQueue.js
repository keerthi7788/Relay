import { firstRow } from "../db/camelize.js";

export class JobQueue {
  #db;

  constructor(db) {
    this.#db = db;
  }

  async enqueue(runId) {
    await this.#db.query(
      `INSERT INTO queue_jobs (run_id) VALUES ($1)
       ON CONFLICT (run_id) DO UPDATE SET run_after = now(), locked_by = NULL, locked_until = NULL`,
      [runId],
    );
  }

  // A job whose lease expired belonged to a dead worker, so it can be claimed again.
  async claim(workerId, leaseSeconds) {
    return firstRow(
      await this.#db.query(
        `UPDATE queue_jobs
         SET locked_by = $1, locked_until = now() + make_interval(secs => $2)
         WHERE id = (
           SELECT id FROM queue_jobs
           WHERE run_after <= now() AND (locked_until IS NULL OR locked_until < now())
           ORDER BY run_after, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING id, run_id, locked_by`,
        [workerId, leaseSeconds],
      ),
    );
  }

  // Fences a stalled worker: once another worker has the job, its writes must be dropped.
  async holdsLease(runId, workerId) {
    const { rowCount } = await this.#db.query(
      "SELECT 1 FROM queue_jobs WHERE run_id = $1 AND locked_by = $2 FOR UPDATE",
      [runId, workerId],
    );
    return rowCount === 1;
  }

  async renewLease(job, leaseSeconds) {
    await this.#db.query(
      `UPDATE queue_jobs SET locked_until = now() + make_interval(secs => $3)
       WHERE id = $1 AND locked_by = $2`,
      [job.id, job.lockedBy, leaseSeconds],
    );
  }

  // A cancel requested during the step must not wait out the time being set here.
  async release(job, runAfter) {
    await this.#db.query(
      `UPDATE queue_jobs
       SET run_after = CASE
             WHEN (SELECT cancel_requested FROM runs WHERE runs.run_id = queue_jobs.run_id) THEN now()
             ELSE $3::timestamptz
           END,
           locked_by = NULL,
           locked_until = NULL
       WHERE id = $1 AND locked_by = $2`,
      [job.id, job.lockedBy, runAfter],
    );
  }

  async remove(job) {
    await this.#db.query("DELETE FROM queue_jobs WHERE id = $1 AND locked_by = $2", [
      job.id,
      job.lockedBy,
    ]);
  }

  async removeForRun(runId) {
    await this.#db.query("DELETE FROM queue_jobs WHERE run_id = $1", [runId]);
  }

  async wake(runId) {
    await this.#db.query("UPDATE queue_jobs SET run_after = now() WHERE run_id = $1", [runId]);
  }
}
