import { completed, suspended } from "./nodeResult.js";

// The wake-up time is persisted on first entry, so a restart doesn't restart the delay.
export class DelayExecutor {
  waitsInPlace = true;

  hasSideEffect() {
    return false;
  }

  async execute({ step, params }) {
    const resumeAt = step.resumeAt ?? new Date(Date.now() + params.seconds * 1000);
    return Date.now() >= resumeAt.getTime() ? completed({}) : suspended(resumeAt);
  }
}
