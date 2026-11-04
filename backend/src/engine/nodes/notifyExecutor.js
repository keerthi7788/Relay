import { isNotifyTargetAllowed } from "../../domain/guardrailSettings.js";
import { PermanentError } from "../../shared/errors.js";
import { completed, sideEffectTrace } from "./nodeResult.js";

export class NotifyExecutor {
  #world;

  constructor(world) {
    this.#world = world;
  }

  hasSideEffect() {
    return true;
  }

  async execute({ step, params, settings }) {
    if (!isNotifyTargetAllowed(String(params.to), settings.allowedNotifyTargets)) {
      throw new PermanentError(
        "notify_target_blocked",
        `'${params.to}' isn't in this workflow's allowed notify targets`,
      );
    }
    const response = await this.#world.notify(params, step.idempotencyKey);
    return completed(response.body, sideEffectTrace(response));
  }
}
