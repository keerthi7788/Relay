import { logger } from "../shared/logger.js";

export class Scheduler {
  #runs;
  #intervalMs;
  #timer;

  constructor(runs, intervalMs) {
    this.#runs = runs;
    this.#intervalMs = intervalMs;
  }

  start() {
    this.#timer = setInterval(() => {
      this.#runs
        .fireDueSchedules()
        .catch((error) => logger.error({ err: error }, "Schedule check failed"));
    }, this.#intervalMs);
  }

  stop() {
    clearInterval(this.#timer);
  }
}
