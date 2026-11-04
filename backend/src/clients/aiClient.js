import { readFileSync } from "node:fs";
import path from "node:path";
import { Ajv } from "ajv";
import { PermanentError, TransientError, UpstreamRejectedError } from "../shared/errors.js";

const SCHEMA_FAILURE_CODE = "ai_schema_violation";

const toTrace = ({ attempts, tokens, flags } = {}) => ({ attempts, tokens, flags });

export class AiClient {
  #http;
  #baseUrl;
  #token;
  #validateRequest;
  #validateResponse;

  constructor(http, { baseUrl, token, contractsDir }) {
    this.#http = http;
    this.#baseUrl = baseUrl;
    this.#token = token;
    const ajv = new Ajv({ strict: false });
    const load = (file) => JSON.parse(readFileSync(path.join(contractsDir, file), "utf8"));
    this.#validateRequest = ajv.compile(load("ai-complete.request.schema.json"));
    this.#validateResponse = ajv.compile(load("ai-complete.response.schema.json"));
  }

  async complete(request, { runId, nodeId }) {
    this.#assertContract(this.#validateRequest, request, "request");
    try {
      const { body } = await this.#http.request({
        method: "POST",
        url: `${this.#baseUrl}/v1/complete`,
        headers: {
          "X-Internal-Token": this.#token,
          "X-Run-Id": runId,
          "X-Node-Id": nodeId,
        },
        body: request,
      });
      this.#assertContract(this.#validateResponse, body, "response");
      return { output: body.output, ...toTrace(body) };
    } catch (error) {
      throw this.#withTrace(error);
    }
  }

  #withTrace(error) {
    if (error instanceof UpstreamRejectedError && error.body?.error?.code === SCHEMA_FAILURE_CODE) {
      return new PermanentError(SCHEMA_FAILURE_CODE, error.body.error.message, toTrace(error.body));
    }
    if (error instanceof TransientError && error.body?.attempts?.length > 0) {
      return new TransientError(error.code, error.message, { trace: toTrace(error.body) });
    }
    return error;
  }

  #assertContract(validate, value, label) {
    if (!validate(value)) {
      throw new PermanentError(
        "ai_contract_violation",
        `AI ${label} broke the contract: ${JSON.stringify(validate.errors)}`,
      );
    }
  }
}
