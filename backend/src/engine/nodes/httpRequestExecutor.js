import { PermanentError } from "../../shared/errors.js";
import { completed, sideEffectTrace } from "./nodeResult.js";

const IDEMPOTENCY_HEADER = "idempotency-key";

function withoutIdempotencyHeader(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== IDEMPOTENCY_HEADER),
  );
}

export class HttpRequestExecutor {
  #http;
  #allowedHosts;

  constructor(http, allowedHosts) {
    this.#http = http;
    this.#allowedHosts = new Set(allowedHosts);
  }

  hasSideEffect({ method }) {
    return method !== "GET";
  }

  async execute({ step, params: { method, url, headers, body } }) {
    this.#assertAllowed(url);
    const safeHeaders = withoutIdempotencyHeader(headers);
    if (step.idempotencyKey) safeHeaders["Idempotency-Key"] = step.idempotencyKey;

    const response = await this.#http.request({ method, url, headers: safeHeaders, body });
    return completed({ status: response.status, body: response.body }, sideEffectTrace(response));
  }

  #assertAllowed(url) {
    if (typeof url !== "string" || !URL.canParse(url)) {
      throw new PermanentError("invalid_request", `'${url}' is not a valid URL`);
    }
    const { host } = new URL(url);
    if (!this.#allowedHosts.has(host)) {
      throw new PermanentError("outbound_host_blocked", `Host '${host}' is not allowed`);
    }
  }
}
