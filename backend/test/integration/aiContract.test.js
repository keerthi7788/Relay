import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { AiClient } from "../../src/clients/aiClient.js";
import { HttpClient } from "../../src/clients/httpClient.js";
import { TransientError } from "../../src/shared/errors.js";
import { contractsDir } from "../support/testEnv.js";

const REQUEST = { prompt: "p", output_schema: { type: "object" }, untrusted_values: [] };
const CONTEXT = { runId: "run_1", nodeId: "classify" };
const TOKENS = { prompt: 1, completion: 1 };
const ATTEMPT = { at: "t", outcome: "failed", prompt_tokens: 1, completion_tokens: 1 };

describe("AiClient contract", () => {
  let server, client, nextResponse, lastRequest;

  before(async () => {
    server = createServer((req, res) => {
      lastRequest = req;
      req.resume();
      res.writeHead(nextResponse.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(nextResponse.body));
    });
    await new Promise((resolve) => server.listen(0, resolve));
    client = new AiClient(new HttpClient(2000), {
      baseUrl: `http://localhost:${server.address().port}`,
      token: "internal",
      contractsDir,
    });
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it("sends tracing and auth headers and returns the output", async () => {
    nextResponse = {
      status: 200,
      body: { output: { a: 1 }, model: "m", attempts: [], flags: [], tokens: TOKENS },
    };
    const result = await client.complete(REQUEST, CONTEXT);
    assert.deepEqual(result.output, { a: 1 });
    assert.equal(lastRequest.headers["x-internal-token"], "internal");
    assert.equal(lastRequest.headers["x-run-id"], "run_1");
  });

  it("maps 422 to a permanent schema failure, keeping attempts and tokens", async () => {
    nextResponse = {
      status: 422,
      body: {
        error: { code: "ai_schema_violation", message: "bad" },
        attempts: [ATTEMPT, ATTEMPT],
        flags: [],
        tokens: TOKENS,
      },
    };
    await assert.rejects(client.complete(REQUEST, CONTEXT), (error) => {
      assert.equal(error.code, "ai_schema_violation");
      assert.equal(error.trace.attempts.length, 2);
      return true;
    });
  });

  it("maps 503 to a transient failure", async () => {
    nextResponse = { status: 503, body: {} };
    await assert.rejects(client.complete(REQUEST, CONTEXT), TransientError);
  });

  it("maps other 4xx to a permanent failure", async () => {
    nextResponse = { status: 424, body: {} };
    await assert.rejects(client.complete(REQUEST, CONTEXT), { code: "upstream_rejected" });
  });

  it("rejects a response that breaks the contract", async () => {
    nextResponse = { status: 200, body: { output: { a: 1 } } };
    await assert.rejects(client.complete(REQUEST, CONTEXT), { code: "ai_contract_violation" });
  });

  it("rejects a request that breaks the contract before sending it", async () => {
    await assert.rejects(client.complete({ prompt: "" }, CONTEXT), {
      code: "ai_contract_violation",
    });
  });
});
