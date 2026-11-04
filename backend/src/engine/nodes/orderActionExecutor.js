import { completed, sideEffectTrace } from "./nodeResult.js";

export class OrderActionExecutor {
  #world;

  constructor(world) {
    this.#world = world;
  }

  hasSideEffect() {
    return true;
  }

  async execute({ step, params }) {
    const response = await this.#world.orderAction(params, step.idempotencyKey);
    return completed(response.body, sideEffectTrace(response));
  }
}
