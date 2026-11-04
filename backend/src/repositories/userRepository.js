import { firstRow } from "../db/camelize.js";

export class UserRepository {
  #db;

  constructor(db) {
    this.#db = db;
  }

  async find(email) {
    return firstRow(await this.#db.query("SELECT * FROM users WHERE email = $1", [email]));
  }

  async save(email, passwordHash) {
    await this.#db.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [email, passwordHash],
    );
  }
}
