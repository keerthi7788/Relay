import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "../shared/logger.js";

export class WorkerLoop {
  #workerId;
  #queue;
  #runner;
  #settings;
  #running = false;
  #finished;

  constructor({ workerId, queue, runner, settings }) {
    this.#workerId = workerId;
    this.#queue = queue;
    this.#runner = runner;
    this.#settings = settings;
  }

  start() {
    this.#running = true;
    this.#finished = this.#loop();
  }

  async stop() {
    this.#running = false;
    await this.#finished;
  }

  async #loop() {
    const { pollMs, leaseSeconds, errorBackoffMs } = this.#settings;
    while (this.#running) {
      try {
        const job = await this.#queue.claim(this.#workerId, leaseSeconds);
        if (job) await this.#process(job);
        else await sleep(pollMs);
      } catch (error) {
        logger.error({ err: error }, "Worker loop error");
        await sleep(errorBackoffMs);
      }
    }
  }

  async #process(job) {
    const { leaseSeconds, renewMs, errorBackoffMs } = this.#settings;
    const renewal = setInterval(() => {
      this.#queue
        .renewLease(job, leaseSeconds)
        .catch((error) => logger.error({ err: error, runId: job.runId }, "Lease renewal failed"));
    }, renewMs);

    try {
      const outcome = await this.#runner.advance(job.runId, this.#workerId);
      if (outcome.type === "stop") await this.#queue.remove(job);
      else if (outcome.type === "lease_lost") logger.warn({ runId: job.runId }, "Lease lost");
      else await this.#queue.release(job, outcome.until ?? new Date());
    } catch (error) {
      logger.error({ err: error, runId: job.runId }, "Step could not be processed");
      await this.#queue.release(job, new Date(Date.now() + errorBackoffMs));
    } finally {
      clearInterval(renewal);
    }
  }
}
