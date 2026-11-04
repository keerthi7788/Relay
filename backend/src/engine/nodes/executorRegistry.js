export class ExecutorRegistry {
  #executors;

  constructor(executors) {
    this.#executors = new Map(Object.entries(executors));
  }

  forType(type) {
    const executor = this.#executors.get(type);
    if (!executor) throw new Error(`No executor registered for node type '${type}'`);
    return executor;
  }
}
