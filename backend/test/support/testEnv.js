import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { Database } from "../../src/db/database.js";
import { migrate } from "../../src/db/migrate.js";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://relay:relay@localhost:5544/relay";
const TEST_DB = "relay_test";

export const dataDir = path.join(backendDir, "pack/data");
export const contractsDir = path.join(backendDir, "contracts");

async function ensureTestDatabase() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB]);
  if (rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
}

export async function openTestDatabase() {
  await ensureTestDatabase();
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB}`;
  const database = new Database(url.toString());
  await migrate(database, path.join(backendDir, "migrations"));
  return database;
}

export async function resetTables(database) {
  await database.query("TRUNCATE users, schedules, queue_jobs, approvals, steps, runs, workflows");
}
