import { randomUUID } from "node:crypto";
import { AiClient } from "./clients/aiClient.js";
import { HttpClient } from "./clients/httpClient.js";
import { MockWorldClient } from "./clients/mockWorldClient.js";
import { Database } from "./db/database.js";
import { migrate } from "./db/migrate.js";
import { UnitOfWork } from "./db/unitOfWork.js";
import { createStepRunner } from "./engine/createStepRunner.js";
import { WorkerLoop } from "./engine/workerLoop.js";
import { Scheduler } from "./scheduler/scheduler.js";
import { RunService } from "./services/runService.js";
import { loadConfig } from "./shared/config.js";
import { installShutdown } from "./shared/lifecycle.js";
import { logger } from "./shared/logger.js";
import { NodeCatalog } from "./domain/nodeCatalog.js";

const CRASH_EXIT_CODE = 137;

const config = loadConfig();
const database = new Database(config.databaseUrl);
await migrate(database, config.migrationsDir);

const uow = new UnitOfWork(database);
const http = new HttpClient(config.timeouts.mockWorldMs);

const runner = createStepRunner({
  uow,
  http,
  catalog: NodeCatalog.load(config.dataDir),
  world: new MockWorldClient(http, config.mockWorldUrl),
  ai: new AiClient(new HttpClient(config.timeouts.aiServiceMs), {
    baseUrl: config.aiServiceUrl,
    token: config.aiServiceToken,
    contractsDir: config.contractsDir,
  }),
  retry: config.retry,
  outboundHosts: config.outboundHosts,
  // Lets the crash-window drill die after a side effect lands and before it is recorded.
  afterExecute: (node) => {
    if (node.id === config.crashAfterNode) process.exit(CRASH_EXIT_CODE);
  },
});

const worker = new WorkerLoop({
  workerId: `worker-${randomUUID()}`,
  queue: uow.repos.queue,
  runner,
  settings: config.queue,
});
worker.start();

const scheduler = new Scheduler(new RunService(uow), config.scheduler.intervalMs);
scheduler.start();
logger.info("Worker started");

installShutdown(async () => {
  scheduler.stop();
  await worker.stop();
  await database.close();
}, config.shutdownTimeoutMs.worker);
