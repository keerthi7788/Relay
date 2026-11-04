import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

dotenv.config({ path: path.join(backendDir, "../.env"), quiet: true });

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  DEMO_TOKEN: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(12, "ADMIN_PASSWORD must be at least 12 characters"),
  MOCK_WORLD_URL: z.string().url().default("http://localhost:9210"),
  AI_SERVICE_URL: z.string().url().default("http://localhost:8090"),
  AI_SERVICE_TOKEN: z.string().min(1),
  OUTBOUND_ALLOWLIST: z.string().default(""),
  WORKER_CRASH_AFTER_NODE: z.string().optional(),
});

export function loadConfig(env = process.env) {
  const parsed = schema.parse(env);
  return {
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.PORT,
    demoToken: parsed.DEMO_TOKEN,
    jwtSecret: parsed.JWT_SECRET,
    jwtExpiresIn: "8h",
    adminEmail: parsed.ADMIN_EMAIL,
    adminPassword: parsed.ADMIN_PASSWORD,
    mockWorldUrl: parsed.MOCK_WORLD_URL,
    aiServiceUrl: parsed.AI_SERVICE_URL,
    aiServiceToken: parsed.AI_SERVICE_TOKEN,
    crashAfterNode: parsed.WORKER_CRASH_AFTER_NODE,
    outboundHosts: [
      new URL(parsed.MOCK_WORLD_URL).host,
      ...parsed.OUTBOUND_ALLOWLIST.split(",")
        .map((host) => host.trim())
        .filter(Boolean),
    ],
    shutdownTimeoutMs: { api: 10_000, worker: 80_000 },
    dataDir: path.join(backendDir, "pack/data"),
    migrationsDir: path.join(backendDir, "migrations"),
    contractsDir: path.join(backendDir, "contracts"),
    timeouts: { mockWorldMs: 5_000, aiServiceMs: 70_000 },
    retry: { maxAttempts: 5, baseDelayMs: 2_000 },
    scheduler: { intervalMs: 15_000 },
    queue: { pollMs: 200, leaseSeconds: 10, renewMs: 3_000, errorBackoffMs: 5_000 },
  };
}
