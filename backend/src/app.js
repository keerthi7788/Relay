import express from "express";
import { rateLimit } from "express-rate-limit";
import { AuthController } from "./controllers/authController.js";
import { ApprovalController } from "./controllers/approvalController.js";
import { CatalogController } from "./controllers/catalogController.js";
import { HealthController } from "./controllers/healthController.js";
import { HookController } from "./controllers/hookController.js";
import { RunController } from "./controllers/runController.js";
import { WorkflowController } from "./controllers/workflowController.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { rejectNonJsonBody, rejectNullBytes } from "./middleware/requestGuards.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { RateLimitedError } from "./shared/errors.js";
import { approvalRoutes } from "./routes/approvalRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { catalogRoutes } from "./routes/catalogRoutes.js";
import { healthRoutes } from "./routes/healthRoutes.js";
import { hookRoutes } from "./routes/hookRoutes.js";
import { runRoutes } from "./routes/runRoutes.js";
import { workflowRoutes } from "./routes/workflowRoutes.js";

// The largest guardrails.max_input_kb; each workflow's own limit is checked when a run starts.
const MAX_BODY_SIZE = "1024kb";
const RATE_WINDOW_MS = 60_000;
const DEFAULT_WEBHOOKS_PER_MINUTE = 300;
const LOGINS_PER_MINUTE = 10;

const perMinute = (limit) =>
  rateLimit({
    windowMs: RATE_WINDOW_MS,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new RateLimitedError()),
  });

export function createApp({
  services: { workflows, runs, approvals, health, auth },
  demoToken,
  webhooksPerMinute = DEFAULT_WEBHOOKS_PER_MINUTE,
}) {
  const app = express();
  const authenticated = requireAuth(auth, demoToken);
  const webhookLimit = perMinute(webhooksPerMinute);

  app.disable("x-powered-by");
  app.use(requestLogger);

  app.use(rejectNonJsonBody);
  app.use(express.json({ limit: MAX_BODY_SIZE }));
  app.use(rejectNullBytes);
  app.use(healthRoutes(new HealthController(health)));
  app.use(
    "/auth",
    authRoutes(new AuthController(auth), authenticated, perMinute(LOGINS_PER_MINUTE)),
  );
  app.use("/hooks", webhookLimit, hookRoutes(new HookController(runs)));
  app.use("/workflows", authenticated, workflowRoutes(new WorkflowController(workflows, runs)));
  app.use("/runs", authenticated, runRoutes(new RunController(runs)));
  app.use("/approvals", authenticated, approvalRoutes(new ApprovalController(approvals)));
  app.use(catalogRoutes(new CatalogController(workflows), authenticated));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
