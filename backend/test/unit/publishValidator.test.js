import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { NodeCatalog } from "../../src/domain/nodeCatalog.js";
import { PublishValidator } from "../../src/domain/publishValidator.js";
import { approvalNode, define, notifyNode, refundNode } from "../support/definitions.js";
import { dataDir } from "../support/testEnv.js";

const validator = new PublishValidator(NodeCatalog.load(dataDir));
const errorCodes = (definition) => validator.validate(definition).errors.map(({ code }) => code);

describe("PublishValidator", () => {
  it("accepts every seed workflow", () => {
    const { workflows } = JSON.parse(
      readFileSync(path.join(dataDir, "seed_workflows.json"), "utf8"),
    );
    for (const seed of workflows) assert.deepEqual(errorCodes(seed), [], seed.id);
  });

  it("rejects an unknown node type", () => {
    const definition = define("w", [{ id: "n", type: "teleport", params: {}, next: null }]);
    assert.deepEqual(errorCodes(definition), ["invalid_node_type"]);
  });

  it("rejects a missing required param", () => {
    const definition = define("w", [
      { id: "n", type: "notify", params: { channel: "chat" }, next: null },
    ]);
    assert.ok(errorCodes(definition).includes("missing_required_param"));
  });

  it("treats a blank required param as missing", () => {
    const definition = define("w", [
      { id: "n", type: "notify", params: { channel: "chat", to: "", message: "m" }, next: null },
    ]);
    assert.deepEqual(errorCodes(definition), ["missing_required_param"]);
  });

  it("rejects a reference to a missing node", () => {
    assert.deepEqual(errorCodes(define("w", [notifyNode("n", "ghost")])), [
      "invalid_node_reference",
    ]);
  });

  it("rejects an entry pointing to a missing node", () => {
    assert.deepEqual(errorCodes(define("w", [notifyNode("n")], { entry: "ghost" })), [
      "invalid_entry",
    ]);
  });

  it("rejects malformed top-level fields instead of crashing", () => {
    for (const overrides of [
      { trigger: null },
      { limits: null },
      { trigger: "x" },
      { limits: 1 },
    ]) {
      assert.ok(errorCodes(define("w", [notifyNode("n")], overrides)).length > 0);
    }
    assert.deepEqual(errorCodes(define("w", [notifyNode("n")], { nodes: [null] })), [
      "invalid_definition",
    ]);
  });

  it("rejects a schedule with a bad cron, and accepts a good one", () => {
    const schedule = (cron) =>
      define("w", [notifyNode("n")], { trigger: { type: "schedule", cron } });
    assert.deepEqual(errorCodes(schedule("not cron")), ["invalid_trigger"]);
    assert.deepEqual(errorCodes(schedule("*/5 * * * *")), []);
  });

  it("enforces the safe ranges on limits", () => {
    const withLimits = (limits) => define("w", [notifyNode("n")], { limits });
    for (const limits of [
      { max_steps: 0 },
      { max_steps: 501 },
      { max_steps: 9007199254740991 },
      { max_steps: 5, timeout_seconds: 5 },
      { max_steps: 5, max_ai_tokens: 100001 },
      {},
    ]) {
      assert.deepEqual(
        errorCodes(withLimits(limits)),
        ["invalid_guardrails"],
        JSON.stringify(limits),
      );
    }
    assert.deepEqual(errorCodes(withLimits({ max_steps: 500, timeout_seconds: 3600 })), []);
  });

  it("enforces the safe ranges on guardrail settings", () => {
    const withGuardrails = (guardrails) => define("w", [notifyNode("n")], { guardrails });
    for (const guardrails of [
      { retry: { max_attempts: 6 } },
      { retry: { backoff_seconds: 0 } },
      { injection_detection: "ignore" },
      { allowed_notify_targets: "#ops" },
      { require_approval_for: ["teleport"] },
      { require_approval_for: ["approval"] },
      { strip_links_from_ai_text: "yes" },
      { max_input_kb: 2000 },
    ]) {
      assert.deepEqual(
        errorCodes(withGuardrails(guardrails)),
        ["invalid_guardrails"],
        JSON.stringify(guardrails),
      );
    }
    assert.deepEqual(errorCodes(withGuardrails({ require_approval_for: ["notify"] })), []);
  });

  it("refuses AI output in a param that decides where an action lands", () => {
    const ai = {
      id: "a",
      type: "ai",
      params: { prompt: "p", output_schema: { type: "object" } },
      next: "n",
    };
    const nodes = [
      {
        ...notifyNode("n"),
        params: { channel: "email", to: "{{nodes.a.output.t}}", message: "m" },
      },
      {
        id: "n",
        type: "http_request",
        params: { method: "GET", url: "http://x/{{nodes.a.output.t}}" },
        next: null,
      },
      {
        id: "n",
        type: "http_request",
        params: { method: "GET", url: "http://x", headers: { h: "{{nodes.a.output.t}}" } },
        next: null,
      },
      {
        id: "n",
        type: "order_action",
        params: { action: "refund", order_id: "{{nodes.a.output.t}}" },
        next: null,
      },
    ];
    for (const node of nodes) {
      assert.deepEqual(errorCodes(define("w", [ai, node])), ["ai_output_in_control_param"]);
    }
  });

  it("still allows AI text in a message, and payload fields in a target", () => {
    const ai = {
      id: "a",
      type: "ai",
      params: { prompt: "p", output_schema: { type: "object" } },
      next: "n",
    };
    const notify = {
      id: "n",
      type: "notify",
      params: { channel: "email", to: "{{trigger.body.email}}", message: "{{nodes.a.output.t}}" },
      next: null,
    };
    assert.deepEqual(errorCodes(define("w", [ai, notify])), []);
  });

  it("warns when an extra approval rule isn't met", () => {
    const definition = define("w", [notifyNode("n")], {
      guardrails: { require_approval_for: ["notify"] },
    });
    assert.equal(
      validator.validate(definition).warnings[0].code,
      "sensitive_node_without_approval",
    );
  });

  it("rejects a delay outside the safe range", () => {
    for (const seconds of [-1, 1e20]) {
      const definition = define("w", [{ id: "d", type: "delay", params: { seconds }, next: null }]);
      assert.deepEqual(errorCodes(definition), ["invalid_definition"]);
    }
  });

  it("rejects an output_schema that is invalid or not an object", () => {
    for (const output_schema of [{ type: "nope" }, { type: "array", items: {} }]) {
      const definition = define("w", [
        { id: "n", type: "ai", params: { prompt: "p", output_schema }, next: null },
      ]);
      assert.deepEqual(errorCodes(definition), ["invalid_definition"]);
    }
  });

  it("allows loops", () => {
    const definition = define("w", [
      { id: "a", type: "delay", params: { seconds: 1 }, next: "b" },
      { id: "b", type: "delay", params: { seconds: 1 }, next: "a" },
    ]);
    assert.deepEqual(errorCodes(definition), []);
  });

  it("warns, but allows, a sensitive node with no approval before it", () => {
    const { errors, warnings } = validator.validate(define("w", [refundNode()]));
    assert.deepEqual(errors, []);
    assert.equal(warnings[0].code, "sensitive_node_without_approval");
  });

  it("does not warn when an approval comes first", () => {
    const { warnings } = validator.validate(define("w", [approvalNode(), refundNode()]));
    assert.deepEqual(warnings, []);
  });
});
