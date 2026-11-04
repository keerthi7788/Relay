import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { HttpClient } from "../../src/clients/httpClient.js";
import { isNotifyTargetAllowed } from "../../src/domain/guardrailSettings.js";
import { PermanentError, TransientError } from "../../src/shared/errors.js";
import { ConditionExecutor } from "../../src/engine/nodes/conditionExecutor.js";
import { HttpRequestExecutor } from "../../src/engine/nodes/httpRequestExecutor.js";
import { RetryPolicy } from "../../src/engine/retryPolicy.js";
import { canTransition, isTerminal } from "../../src/domain/runStateMachine.js";
import { FakeHttp } from "../support/fakes.js";

describe("run state machine", () => {
  it("allows the documented transitions", () => {
    assert.ok(canTransition("queued", "running"));
    assert.ok(canTransition("running", "waiting_approval"));
    assert.ok(canTransition("waiting_approval", "queued"));
  });

  it("refuses illegal transitions", () => {
    assert.ok(!canTransition("queued", "succeeded"));
    assert.ok(!canTransition("waiting_approval", "running"));
    assert.ok(!canTransition("succeeded", "running"));
  });

  it("knows the terminal states", () => {
    for (const status of ["succeeded", "failed", "cancelled"]) assert.ok(isTerminal(status));
    assert.ok(!isTerminal("waiting_approval"));
  });
});

describe("RetryPolicy", () => {
  const policy = new RetryPolicy({ maxAttempts: 5, baseDelayMs: 2000 }, () => 0);

  it("backs off exponentially", () => {
    assert.deepEqual(
      [1, 2, 3, 4].map((attempt) => policy.nextDelayMs(attempt)),
      [2000, 4000, 8000, 16000],
    );
  });

  it("uses a workflow's own retry settings", () => {
    const settings = { max_attempts: 2, backoff_seconds: 3 };
    assert.equal(policy.nextDelayMs(1, settings), 3000);
    assert.equal(policy.nextDelayMs(2, settings), null);
  });

  it("stops at the attempt limit", () => {
    assert.equal(policy.nextDelayMs(5), null);
  });
});

describe("notify target patterns", () => {
  it("allows everything with no patterns, and matches wildcards otherwise", () => {
    const patterns = ["*@example.com", "#support"];
    assert.ok(isNotifyTargetAllowed("anyone@evil.test", []));
    assert.ok(isNotifyTargetAllowed("maya@EXAMPLE.com", patterns));
    assert.ok(isNotifyTargetAllowed("#support", patterns));
    assert.ok(!isNotifyTargetAllowed("attacker@evil.test", patterns));
    assert.ok(!isNotifyTargetAllowed("#support-private", patterns));
  });
});

describe("HttpClient", () => {
  it("doesn't retry requests that can never succeed", async () => {
    const http = new HttpClient(100);
    await assert.rejects(http.request({ method: "GET", url: "not a url" }), PermanentError);
    await assert.rejects(
      http.request({ method: "GET", url: "http://localhost:1/", body: { a: 1 } }),
      PermanentError,
    );
  });

  it("stops reading a response over 1 MB", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("x".repeat(2 * 1024 * 1024));
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const url = `http://localhost:${server.address().port}/`;
    await assert.rejects(new HttpClient(2000).request({ method: "GET", url }), {
      code: "response_too_large",
    });
    server.closeAllConnections();
    server.close();
  });

  it("doesn't follow redirects", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(302, { Location: "http://localhost:1/" });
      res.end();
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const url = `http://localhost:${server.address().port}/`;
    await assert.rejects(new HttpClient(1000).request({ method: "GET", url }), TransientError);
    server.close();
  });

  it("treats a response that stalls mid-body as a retryable timeout", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write("{");
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const url = `http://localhost:${server.address().port}/`;
    await assert.rejects(new HttpClient(100).request({ method: "GET", url }), TransientError);
    server.closeAllConnections();
    server.close();
  });
});

describe("ConditionExecutor", () => {
  const evaluate = async (left, op, right) =>
    (await new ConditionExecutor().execute({ params: { left, op, right } })).output.result;

  it("compares numbers numerically", async () => {
    assert.equal(await evaluate("250", "greater_than", "100"), true);
    assert.equal(await evaluate(40, "greater_than", "100"), false);
    assert.equal(await evaluate("9", "less_than", "10"), true);
  });

  it("fails a numeric comparison on a non-number", async () => {
    await assert.rejects(evaluate("abc", "greater_than", "1"), { code: "invalid_comparison" });
  });

  it("refuses values that only look numeric after coercion", async () => {
    for (const value of ["  ", "", [], [500], true, null, "0x10", "1e3"]) {
      await assert.rejects(evaluate(value, "greater_than", "100"), { code: "invalid_comparison" });
    }
  });

  it("compares objects by their contents", async () => {
    assert.equal(await evaluate({ x: 1 }, "equals", { y: 2 }), false);
    assert.equal(await evaluate({ x: 1 }, "equals", { x: 1 }), true);
  });

  it("handles equals, not_equals and contains", async () => {
    assert.equal(await evaluate("a", "equals", "a"), true);
    assert.equal(await evaluate("a", "not_equals", "a"), false);
    assert.equal(await evaluate("abc", "contains", "b"), true);
  });
});

describe("HttpRequestExecutor idempotency", () => {
  it("treats only non-GET requests as side effects", () => {
    const executor = new HttpRequestExecutor(new FakeHttp(), ["w"]);
    assert.equal(executor.hasSideEffect({ method: "GET" }), false);
    assert.equal(executor.hasSideEffect({ method: "POST" }), true);
  });

  it("does not let a workflow override the engine's key", async () => {
    const http = new FakeHttp();
    await new HttpRequestExecutor(http, ["w"]).execute({
      step: { idempotencyKey: "engine-key" },
      params: { method: "POST", url: "http://w/x", headers: { "idempotency-KEY": "attacker" } },
    });
    assert.deepEqual(http.calls[0].headers, { "Idempotency-Key": "engine-key" });
  });
});
