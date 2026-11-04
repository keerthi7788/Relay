import { allRows, firstRow } from "../db/camelize.js";

export class WorkflowRepository {
  #db;

  constructor(db) {
    this.#db = db;
  }

  async list({ limit, offset } = {}) {
    return allRows(
      await this.#db.query("SELECT * FROM workflows ORDER BY created_at, id LIMIT $1 OFFSET $2", [
        limit ?? null,
        offset ?? 0,
      ]),
    );
  }

  async lock(id) {
    return firstRow(await this.#db.query("SELECT * FROM workflows WHERE id = $1 FOR UPDATE", [id]));
  }

  async find(id) {
    return firstRow(await this.#db.query("SELECT * FROM workflows WHERE id = $1", [id]));
  }

  async insertDraft(definition, secretHash) {
    const { rowCount } = await this.#db.query(
      `INSERT INTO workflows (id, name, description, status, draft_definition, webhook_secret_hash)
       VALUES ($1, $2, $3, 'draft', $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [
        definition.id,
        definition.name ?? definition.id,
        definition.description ?? null,
        definition,
        secretHash,
      ],
    );
    return rowCount === 1;
  }

  async insertPublishedIfMissing(definition, secretHash) {
    await this.#db.query(
      `INSERT INTO workflows
         (id, name, description, status, draft_definition, published_definition, webhook_secret_hash)
       VALUES ($1, $2, $3, 'published', $4, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [definition.id, definition.name, definition.description ?? null, definition, secretHash],
    );
  }

  async updateDraft(definition) {
    await this.#db.query(
      `UPDATE workflows
       SET name = $2, description = $3, draft_definition = $4, updated_at = now()
       WHERE id = $1`,
      [definition.id, definition.name ?? definition.id, definition.description ?? null, definition],
    );
  }

  async setSecretHash(id, secretHash) {
    await this.#db.query(
      "UPDATE workflows SET webhook_secret_hash = $2, updated_at = now() WHERE id = $1",
      [id, secretHash],
    );
  }

  async publish(id, definition) {
    await this.#db.query(
      `UPDATE workflows
       SET status = 'published', published_definition = $2, updated_at = now()
       WHERE id = $1`,
      [id, definition],
    );
  }
}
