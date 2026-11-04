import { PermanentError, TransientError, UpstreamRejectedError } from "../shared/errors.js";

const isRetryableStatus = (status) => status >= 500 || status === 429;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks).toString("utf8");
    size += value.length;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new PermanentError("response_too_large", "The response was larger than 1 MB");
    }
    chunks.push(value);
  }
}

function assertValidRequest({ method, url, body }) {
  if (typeof url !== "string" || !URL.canParse(url)) {
    throw new PermanentError("invalid_request", `'${url}' is not a valid URL`);
  }
  if (method === "GET" && body !== undefined) {
    throw new PermanentError("invalid_request", "A GET request can't have a body");
  }
}

export class HttpClient {
  #timeoutMs;

  constructor(timeoutMs) {
    this.#timeoutMs = timeoutMs;
  }

  async request({ method, url, headers = {}, body }) {
    assertValidRequest({ method, url, body });

    let response;
    let text;
    try {
      response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
        redirect: "error",
      });
      text = await readLimited(response);
    } catch (error) {
      if (error instanceof PermanentError) throw error;
      throw new TransientError("upstream_unreachable", `${method} ${url} failed: ${error.message}`);
    }

    const parsed = parseBody(text);
    if (isRetryableStatus(response.status)) {
      throw new TransientError("upstream_error", `${method} ${url} returned ${response.status}`, {
        body: parsed,
      });
    }
    if (!response.ok) {
      throw new UpstreamRejectedError(
        response.status,
        parsed,
        `${method} ${url} returned ${response.status}: ${parsed?.error?.message ?? "rejected"}`,
      );
    }
    return {
      status: response.status,
      body: parsed,
      replayed: response.headers.get("x-mockworld-replayed") === "true",
    };
  }
}
