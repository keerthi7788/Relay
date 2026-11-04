import pg from "pg";
import { logger } from "../shared/logger.js";

export class Database {
  #pool;

  constructor(connectionString) {
    this.#pool = new pg.Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 30_000,
    });
    // Without a listener, a dropped idle connection would crash the process.
    this.#pool.on("error", (error) => logger.warn({ err: error }, "Idle database connection lost"));
  }

  query(text, values) {
    return this.#pool.query(text, values);
  }

  async transaction(work) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  close() {
    return this.#pool.end();
  }
}
