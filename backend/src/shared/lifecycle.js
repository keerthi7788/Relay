import { logger } from "./logger.js";

const CLEAN_EXIT = 0;
const FAILED_EXIT = 1;

export function installShutdown(stop, timeoutMs) {
  let stopping = false;

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => process.exit(FAILED_EXIT), timeoutMs).unref();
    await stop();
    process.exit(CLEAN_EXIT);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled promise rejection");
    process.exit(FAILED_EXIT);
  });
}
