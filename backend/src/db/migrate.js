import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIGRATION_LOCK = 727001;

export async function migrate(database, migrationsDir) {
  await database.transaction(async (client) => {
    // The API and worker may start together; the lock makes the second one wait.
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );

    const { rows } = await client.query("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((row) => row.name));
    const pending = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql") && !applied.has(file))
      .sort();

    for (const file of pending) {
      await client.query(readFileSync(path.join(migrationsDir, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    }
  });
}
