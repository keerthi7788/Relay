import { randomUUID } from "node:crypto";
import { logger } from "../shared/logger.js";

const SAFE_REQUEST_ID = /^[\w-]{1,64}$/;
const QUIET_PATHS = new Set(["/health", "/ready"]);

export function requestLogger(req, res, next) {
  const provided = req.get("x-request-id");
  req.id = provided && SAFE_REQUEST_ID.test(provided) ? provided : randomUUID();
  res.setHeader("X-Request-Id", req.id);

  const startedAt = Date.now();
  // Read now, because Express strips the mount prefix from req.path once routing starts.
  const { path } = req;
  res.on("finish", () => {
    if (QUIET_PATHS.has(path)) return;
    logger.info(
      {
        requestId: req.id,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
      "Request handled",
    );
  });
  next();
}
