import { TransientError } from "../../src/shared/errors.js";

/** Behaves like the mock world: a repeated key is replayed rather than executed. */
export class FakeWorld {
  calls = [];
  failures = [];
  #seen = new Map();

  #record(action, payload, key) {
    const failure = this.failures.shift();
    if (failure) throw failure;
    const replayed = this.#seen.has(key);
    this.calls.push({ action, payload, key, replayed });
    if (!replayed) this.#seen.set(key, { delivered: true, reference_id: `ref_${this.#seen.size}` });
    return { status: 200, body: this.#seen.get(key), replayed };
  }

  notify(params, key) {
    return Promise.resolve().then(() => this.#record(`notify.${params.channel}`, params, key));
  }

  orderAction(params, key) {
    return Promise.resolve().then(() => this.#record(`order.${params.action}`, params, key));
  }

  executed(action) {
    return this.calls.filter((call) => call.action === action && !call.replayed);
  }
}

export class FakeHttp {
  calls = [];
  responses = [];

  async request(request) {
    this.calls.push(request);
    const next = this.responses.shift() ?? { status: 200, body: { status: "processing" } };
    if (next instanceof Error) throw next;
    return { replayed: false, ...next };
  }
}

export class FakeAi {
  calls = [];
  #replies;

  constructor(...replies) {
    this.#replies = replies;
  }

  async complete(request) {
    this.calls.push(request);
    const reply = this.#replies.shift();
    if (reply instanceof Error) throw reply;
    return {
      output: reply,
      attempts: [{ at: "t", outcome: "succeeded" }],
      tokens: { prompt: 7, completion: 3 },
      flags: [],
    };
  }
}

export const transient = () => new TransientError("upstream_error", "503 from the world");
