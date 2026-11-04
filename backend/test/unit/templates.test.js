import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildScope, resolveValue, substitutedValues } from "../../src/domain/templates.js";

const scope = {
  trigger: {
    body: { amount: 250, email: "a@b.co", nested: { x: 1 }, evil: "{{trigger.body.email}}" },
  },
  nodes: { classify: { output: { category: "complaint" } } },
};

describe("templates", () => {
  it("resolves payload and node paths", () => {
    assert.equal(resolveValue("{{trigger.body.email}}", scope), "a@b.co");
    assert.equal(resolveValue("{{nodes.classify.output.category}}", scope), "complaint");
  });

  it("keeps the JSON type when the param is exactly one template", () => {
    assert.equal(resolveValue("{{trigger.body.amount}}", scope), 250);
    assert.deepEqual(resolveValue("{{trigger.body.nested}}", scope), { x: 1 });
  });

  it("interpolates into surrounding text, including a dollar prefix", () => {
    assert.equal(resolveValue("Cost ${{trigger.body.amount}}!", scope), "Cost $250!");
  });

  it("resolves inside nested objects", () => {
    assert.deepEqual(resolveValue({ a: { b: "{{trigger.body.email}}" } }, scope), {
      a: { b: "a@b.co" },
    });
  });

  it("fails on an unresolvable path instead of rendering nothing", () => {
    assert.throws(() => resolveValue("{{trigger.body.missing}}", scope), {
      code: "template_unresolved",
    });
  });

  it("never expands template syntax inside a payload value", () => {
    assert.equal(resolveValue("{{trigger.body.evil}}", scope), "{{trigger.body.email}}");
    assert.equal(resolveValue("x {{trigger.body.evil}}", scope), "x {{trigger.body.email}}");
  });

  it("can only read trigger.body and node outputs", () => {
    for (const path of ["process.env.SECRET", "trigger.secret", "nodes.classify.params"]) {
      assert.throws(() => resolveValue(`{{${path}}}`, scope), { code: "template_out_of_scope" });
    }
  });

  it("does not reach object prototypes", () => {
    assert.throws(() => resolveValue("{{trigger.body.__proto__}}", scope), {
      code: "template_unresolved",
    });
  });

  it("uses a node's latest succeeded execution in a loop", () => {
    const steps = [
      { nodeId: "poll", status: "succeeded", output: { n: 1 } },
      { nodeId: "poll", status: "succeeded", output: { n: 2 } },
      { nodeId: "poll", status: "failed", output: null },
    ];
    assert.equal(resolveValue("{{nodes.poll.output.n}}", buildScope({}, steps)), 2);
  });

  it("lists the values a prompt pulls in", () => {
    assert.deepEqual(substitutedValues("Mail {{trigger.body.email}}", scope), ["a@b.co"]);
  });
});
