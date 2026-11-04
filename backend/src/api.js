import { ApprovalService } from "./services/approvalService.js";
import { createApp } from "./app.js";
import { Database } from "./db/database.js";
import { migrate } from "./db/migrate.js";
import { UnitOfWork } from "./db/unitOfWork.js";
import { AuthService } from "./services/authService.js";
import { HealthService } from "./services/healthService.js";
import { RunService } from "./services/runService.js";
import { loadConfig } from "./shared/config.js";
import { installShutdown } from "./shared/lifecycle.js";
import { logger } from "./shared/logger.js";
import { NodeCatalog } from "./domain/nodeCatalog.js";
import { PublishValidator } from "./domain/publishValidator.js";
import { WorkflowService } from "./services/workflowService.js";

const config = loadConfig();
const database = new Database(config.databaseUrl);
await migrate(database, config.migrationsDir);

const uow = new UnitOfWork(database);
const catalog = NodeCatalog.load(config.dataDir);
const workflows = new WorkflowService(uow, new PublishValidator(catalog), catalog, config.dataDir);
await workflows.loadSeeds(config.dataDir);

const auth = new AuthService(uow, { secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
await auth.ensureUser(config.adminEmail, config.adminPassword);

const services = {
  workflows,
  runs: new RunService(uow),
  approvals: new ApprovalService(uow),
  health: new HealthService(database),
  auth,
};
const server = createApp({ services, demoToken: config.demoToken }).listen(config.port, () => {
  logger.info({ port: config.port }, "API listening");
});

installShutdown(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeIdleConnections();
  });
  await database.close();
}, config.shutdownTimeoutMs.api);
